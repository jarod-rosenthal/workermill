import { ensureOllamaContext, ensureLmStudioContext } from "./engine/model-factory.js";
import { execSync } from "child_process";
import * as logger from "./logger.js";
import { CostTracker } from "./cost-tracker.js";
import type { CliConfig } from "./config.js";
import { getProviderForPersona, loadConfig, saveConfig } from "./config.js";
import { runLifecycleHooks } from "./hooks.js";
import {
  isGitRepo, getCurrentBranch, createFeatureBranch,
  deriveFeatureBranchName, localBranchExists, deleteLocalBranch,
  shellArg,
} from "./git-ops.js";
import { loadMemories } from "./memory.js";
import { saveShipRun, clearShipRun } from "./ship-state.js";
import { startAllMCPServers, autoDetectMCPServers } from "./mcp-client.js";
import { resolveSandboxMode } from "./sandbox-mode.js";
import { createRunManifest, saveRunManifest, type RunManifest } from "./run-manifest.js";
import { isLocalProvider, providerNeedsContextOverride } from "./provider-capabilities.js";

// ── Re-exports from sub-modules ──
// Types
export type { OrchestrationOutput, Story, OrchestrationResult, RetryPlan, StandaloneReviewResult } from "./orchestrator/types.js";

// Functions — public API
export { checkToolPermission } from "./orchestrator/execution.js";
export { runSpecCheck, classifyComplexity, applyQaParticipation } from "./orchestrator/planning.js";
export { getStoryDefinitionOfDone, validateStoryContractArtifacts } from "./orchestrator/execution.js";
export { extractStructuredMustFixItems, mergeMustFixItems, validateTechLeadReviewOutput, runStandaloneReview, runReviewLoop } from "./orchestrator/review.js";
export type { ReviewLoopResult, ReviewLoopParams } from "./orchestrator/review.js";

// ── Imports from sub-modules (used internally by runOrchestration) ──
import type { OrchestrationOutput, Story, OrchestrationResult, RetryPlan, SharedContext } from "./orchestrator/types.js";
import {
  resolveTaskInput,
  isAbortSignalLike, isAbortControllerLike,
} from "./orchestrator/utils.js";
import { planStories, topologicalSort, runSpecCheck as _runSpecCheck, applyQaParticipation as _applyQaParticipation } from "./orchestrator/planning.js";
import { executeStories } from "./orchestrator/execution.js";
import { runReviewLoop as _runReviewLoop } from "./orchestrator/review.js";
import { runQualityGates } from "./orchestrator/gates.js";
import { runCompletion } from "./orchestrator/completion.js";

// Re-export from completion module for backward compatibility
export { shouldTransitionTicketOnPrOpen } from "./orchestrator/completion.js";

export async function runOrchestration(
  config: CliConfig,
  userTask: string,
  trustAll: boolean | (() => boolean),
  sandboxed: boolean | "os",
  output: OrchestrationOutput,
  abortControllerOrSignal?: AbortController | AbortSignal,
  retryPlan?: RetryPlan,
  ticketKey?: string,
  liveViewServer?: import("./live-view-server.js").LiveViewServer,
): Promise<OrchestrationResult> {
  // Resolve file references so "/build spec.md" becomes the full spec content
  userTask = resolveTaskInput(userTask, process.cwd());

  // Create run manifest — persisted throughout for debugging and analytics
  const manifest = createRunManifest(userTask, ticketKey);

  const abortController = isAbortControllerLike(abortControllerOrSignal)
    ? abortControllerOrSignal
    : undefined;
  const abortSignal = isAbortControllerLike(abortControllerOrSignal)
    ? abortControllerOrSignal.signal
    : isAbortSignalLike(abortControllerOrSignal)
      ? abortControllerOrSignal
      : undefined;

  if (abortControllerOrSignal != null && !abortController && !abortSignal) {
    logger.warn("Ignoring invalid abort argument passed to runOrchestration", {
      type: typeof abortControllerOrSignal,
    });
  }

  // Upgrade path sandbox to OS sandbox for /build — workers run autonomous code
  // from AI models, so process-level isolation is the right default. Falls back
  // silently to path sandbox if the platform doesn't support it.
  if (sandboxed === true) {
    const resolution = resolveSandboxMode("os");
    sandboxed = resolution.effective;
    if (resolution.warning) {
      logger.info("OS sandbox fallback in /build", { warning: resolution.warning });
    } else if (sandboxed === "os") {
      logger.info("OS sandbox enabled for /build");
    }
  }

  // Resolve ticket references — fetch from issue tracker if ticketKey is set
  if (ticketKey) {
    try {
      const { TicketOps } = await import("./ticket-ops.js");
      const ticketSystem = config.ticketSystem || "github";

      // Ensure credentials are available
      if (ticketSystem === "jira" && config.jira) {
        process.env.JIRA_BASE_URL = config.jira.baseUrl;
        process.env.JIRA_EMAIL = config.jira.email;
        process.env.JIRA_API_TOKEN = config.jira.apiToken;
      } else if (ticketSystem === "linear" && config.linear) {
        process.env.LINEAR_API_KEY = config.linear.apiKey;
      }
      if (ticketSystem === "github") {
        if (!process.env.GITHUB_TOKEN) {
          try {
            process.env.GITHUB_TOKEN = execSync("gh auth token 2>/dev/null", { encoding: "utf-8", stdio: "pipe" }).trim();
          } catch { /* gh not installed or not logged in */ }
        }
        if (!process.env.GITHUB_REPO) {
          try {
            const remote = execSync("git remote get-url origin 2>/dev/null", { encoding: "utf-8", stdio: "pipe" }).trim();
            const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
            if (match) process.env.GITHUB_REPO = match[1].replace(/\.git$/, "");
          } catch { /* not a git repo */ }
        }
      }

      const ops = new TicketOps(ticketKey, ticketSystem);
      if (!ops.isAvailable()) {
        const hints: Record<string, string> = {
          github: "Ensure GITHUB_TOKEN is set or run `gh auth login`. Repo detected from git remote.",
          jira: "Run `/setup` to add your Jira URL, email, and API token (generate at id.atlassian.com).",
          linear: "Run `/setup` to add your Linear API key (generate at linear.app/settings/api).",
        };
        output.error(`Cannot connect to ${ticketSystem} — credentials not found.\n${hints[ticketSystem] || "Run `/setup` to configure your issue tracker."}`);
        return { stories: [], completedStoryIds: [], featureBranch: null, userTask };
      }
      const ticket = await ops.fetchTicket();
      if (ticket) {
        userTask = `# ${ticket.title}\n\n${ticket.body}${ticket.labels?.length ? `\n\nLabels: ${ticket.labels.join(", ")}` : ""}`;
        output.coordinatorLog(`Fetched ${ticketKey}: ${ticket.title}`);
      } else {
        const hints: Record<string, string> = {
          github: `Verify the issue exists at github.com and your token has repo access.`,
          jira: `Verify ${ticketKey} exists and your API token has read permissions.`,
          linear: `Verify ${ticketKey} exists and your API key has access to this team.`,
        };
        output.error(`Could not fetch ${ticketKey} from ${ticketSystem}.\n${hints[ticketSystem] || ""}`);
        return { stories: [], completedStoryIds: [], featureBranch: null, userTask };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.error(`Failed to fetch ${ticketKey}: ${msg}`);
      return { stories: [], completedStoryIds: [], featureBranch: null, userTask };
    }
  }

  // Create a reusable TicketOps instance for posting updates throughout the run
  let ticketOps: InstanceType<typeof import("./ticket-ops.js").TicketOps> | null = null;
  let resolvedTicketSystem: string = config.ticketSystem || "github";
  if (ticketKey) {
    try {
      const { TicketOps } = await import("./ticket-ops.js");
      const ticketSystem = resolvedTicketSystem;
      const ops = new TicketOps(ticketKey, ticketSystem);
      logger.info("TicketOps availability check", {
        ticketKey, ticketSystem, isAvailable: ops.isAvailable(),
        hasToken: !!process.env.GITHUB_TOKEN,
        hasRepo: !!process.env.GITHUB_REPO,
      });
      if (ops.isAvailable()) ticketOps = ops;
    } catch { /* non-critical */ }
  }

  // Ensure local models are loaded with the correct context length
  const defaultProvider = getProviderForPersona(config);
  if (providerNeedsContextOverride(defaultProvider.provider)) {
    const ctx = config.providers[defaultProvider.provider]?.contextLength;
    if (ctx && defaultProvider.provider === "ollama") {
      const host = defaultProvider.host || config.providers[defaultProvider.provider]?.host || "http://localhost:11434";
      await ensureOllamaContext(host, defaultProvider.model, ctx);
    } else if (ctx && defaultProvider.provider === "lmstudio") {
      const host = defaultProvider.host || config.providers[defaultProvider.provider]?.host || "http://localhost:1234/v1";
      await ensureLmStudioContext(host, defaultProvider.model, ctx);
    }
  }

  // Set abort controller on live view server
  if (liveViewServer && abortController) {
    liveViewServer.setAbortController(abortController);
  }

  // Start MCP servers — skip auto-detect for local models (tool overload causes XML fallback)
  const skipAutoDetect = isLocalProvider(defaultProvider.provider);
  const mcpConfig = skipAutoDetect
    ? (config.mcp || {})
    : autoDetectMCPServers(config.mcp || {});
  if (Object.keys(mcpConfig).length > 0) {
    output.coordinatorLog(`Starting ${Object.keys(mcpConfig).length} MCP server(s)...`);
    await startAllMCPServers(mcpConfig);
  }

  const costTracker = new CostTracker();
  const workingDir = process.cwd();
  const persistedMemories = loadMemories(workingDir);
  const context: SharedContext = {
    filesCreated: [],
    filesModified: [],
    decisions: [],
    learnings: [],
  };
  context.learnings.push(...persistedMemories.filter(m => m.type === "learning").map(m => m.content));
  const sessionAllow = new Set<string>();

  runLifecycleHooks("ship_start", config.hooks, workingDir, { WORKERMILL_TASK: userTask.slice(0, 200) });

  // Track completed story IDs for the result (used by /retry)
  const completedStoryIds: string[] = [];

  let featureBranch: string | null;
  let mainBranch: string;
  let sorted: Story[];

  if (retryPlan) {
    // ── Retry mode: skip planning, resume on the existing feature branch ──
    featureBranch = retryPlan.featureBranch;
    mainBranch = retryPlan.mainBranch;
    const currentBranch = getCurrentBranch(workingDir);

    // Checkout the feature branch if we're not already on it
    if (currentBranch !== featureBranch) {
      // Verify branch exists
      try {
        execSync(`git rev-parse --verify ${shellArg(featureBranch)}`, { cwd: workingDir, stdio: "pipe" });
      } catch {
        output.error(`Branch \`${featureBranch}\` no longer exists. Nothing to retry.`);
        return { stories: retryPlan.stories, completedStoryIds: [...retryPlan.completedStoryIds], featureBranch, userTask };
      }

      output.coordinatorLog(`Switching to \`${featureBranch}\`...`);
      try {
        execSync(`git checkout ${shellArg(featureBranch)}`, { cwd: workingDir, stdio: "pipe" });
      } catch {
        output.error(`Could not checkout \`${featureBranch}\` — you have uncommitted changes. Commit or stash them first, then \`/retry\`.`);
        return { stories: retryPlan.stories, completedStoryIds: [...retryPlan.completedStoryIds], featureBranch, userTask };
      }
    }
    output.updateBranch?.(featureBranch);
    await new Promise(r => setTimeout(r, 0));

    sorted = retryPlan.stories;
    completedStoryIds.push(...retryPlan.completedStoryIds);
    const remaining = sorted.filter(s => !retryPlan.completedStoryIds.includes(s.id));
    const actionable = remaining.filter(s => !s.dependsOn?.some(dep => remaining.some(r => r.id === dep)));
    const blocked = remaining.length - actionable.length;
    const summary = blocked > 0
      ? `${retryPlan.completedStoryIds.length} done, ${actionable.length} to run, ${blocked} blocked by dependencies`
      : `${retryPlan.completedStoryIds.length} done, ${remaining.length} remaining`;
    output.coordinatorLog(`Retrying on branch: ${featureBranch} — ${summary}`);
    remaining.forEach((s, i) => {
      output.log("coordinator", `Story ${i + 1}/${remaining.length}: [${s.persona}] ${s.title}`);
    });
  } else {
    // ── Normal mode: plan on current branch, create feature branch after acceptance ──
    const originalBranch = getCurrentBranch(workingDir);
    mainBranch = originalBranch || "main";

    // Warn if starting from a non-trunk branch — new work will stack on top of it
    const trunkBranches = ["main", "master", "develop", "trunk"];
    if (originalBranch && !trunkBranches.includes(originalBranch)) {
      output.log("system", `You're on \`${originalBranch}\`, not a trunk branch. New work will stack on top of it and the PR will target \`${originalBranch}\` as its base.`);
      output.log("system", `If you want an independent task, cancel, run \`git checkout main\`, then \`/build\` again.`);
      const r = await output.confirm("Continue and stack on this branch?");
      const confirmed = typeof r === "object" ? r.allowed : r;
      if (!confirmed) {
        return { stories: [], completedStoryIds: [], featureBranch: null, userTask };
      }
    }

    // Spec check — identify ambiguities before the planner runs (off by default)
    if (config.review?.specCheck) {
      userTask = await _runSpecCheck(config, userTask, output, abortSignal);
    }

    // Planner runs on the current branch — no branch created yet
    const planResult = await planStories(config, userTask, workingDir, sandboxed, output, abortSignal);

    // Track planner cost
    costTracker.addUsage("Planner", planResult.provider, planResult.model, planResult.inputTokens, planResult.outputTokens);
    output.updateCost?.(costTracker.getTotalCost());
    output.updateUsageSummary?.(costTracker.getUsageSummary());

    // Handle planner rejection — still on original branch, nothing to clean up
    if (planResult.rejected) {
      output.log("system", `The planner determined this task should not proceed: ${planResult.rejectionReason || "unspecified reason"}`);
      output.log("system", "Refine your spec and try again.");
      return { stories: [], completedStoryIds: [], featureBranch: null, userTask };
    }

    const qaParticipation = config.qa?.participation ?? "auto";
    const plannerStories = _applyQaParticipation(planResult.stories, qaParticipation);
    if (qaParticipation === "off" && plannerStories.length !== planResult.stories.length) {
      output.log("planner", "QA participation is off — removed dedicated qa_engineer stories from this run.");
    } else if (qaParticipation === "always" && plannerStories.length > planResult.stories.length) {
      output.log("planner", "QA participation is always — added a dedicated qa_engineer validation story.");
    }

    // Show the plan — WorkerMill format
    output.log("planner", `Plan generated: ${plannerStories.length} stories`);
    plannerStories.forEach((s, i) => {
      output.log("planner", `Story ${i + 1}: [${s.persona}] ${s.title}${s.dependsOn?.length ? ` (after: ${s.dependsOn.join(", ")})` : ""}`);
      if (s.targetFiles?.length) output.log("planner", `  files: ${s.targetFiles.join(", ")}`);
      if (s.referenceFiles?.length) output.log("planner", `  patterns: ${s.referenceFiles.join(", ")}`);
      if (s.primaryPattern) output.log("planner", `  primary pattern: ${s.primaryPattern}`);
      if (s.integrationPoints?.length) output.log("planner", `  integration: ${s.integrationPoints.join(", ")}`);
      if (s.nonGoals?.length) output.log("planner", `  non-goals: ${s.nonGoals.join(", ")}`);
      if (s.validationSignal) output.log("planner", `  validation: ${s.validationSignal}`);
      if (s.implementationNotes) output.log("planner", `  guidance: ${s.implementationNotes.split("\n")[0].slice(0, 120)}...`);
    });
    output.log("planner", `Plan ready: ${plannerStories.length} stories queued for execution.`);


    // Ensure every story has a unique ID (some planners output stories without IDs)
    const seenIds = new Set<string>();
    for (let i = 0; i < plannerStories.length; i++) {
      if (!plannerStories[i].id || seenIds.has(plannerStories[i].id)) {
        plannerStories[i].id = `${i + 1}-${(plannerStories[i].title || "story").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
      }
      seenIds.add(plannerStories[i].id);
    }

    // Sort by dependencies
    sorted = topologicalSort(plannerStories);
    logger.info("Topological sort result", { input: plannerStories.length, output: sorted.length, ids: sorted.map(s => s.id) });

    // Prompt user to proceed (unless --trust mode)
    // Still on original branch — declining costs nothing
    if (!(typeof trustAll === "function" ? trustAll() : trustAll)) {
      let proceed = false;
      try {
        const r = await output.confirm("Execute this plan?");
        proceed = typeof r === "object" ? r.allowed : r;
      } catch (err) {
        logger.debug("Plan confirmation failed", { error: err instanceof Error ? err.message : String(err) });
      }
      if (!proceed) {
        output.log("system", "Plan cancelled.");
        return { stories: sorted, completedStoryIds: [], featureBranch: null, userTask };
      }
    }

    // ── Plan accepted — NOW create the feature branch ──
    // Ticket-driven: use ticket key as prefix, title as slug
    // File/inline: use repo name as prefix, task text as slug
    let branchPrefix: string | undefined;
    let branchLabel: string;
    if (ticketKey) {
      branchPrefix = ticketKey.startsWith("#")
        ? `GH-${ticketKey.slice(1)}`
        : ticketKey.toUpperCase();
      // Use just the title line (first line after "# ") not the whole body
      const titleMatch = userTask.match(/^# (.+)/m);
      branchLabel = titleMatch ? titleMatch[1] : userTask;
    } else {
      const fileRefForBranch = userTask.match(/[\w./-]+\.(?:md|txt|yaml|yml|json)\b/i);
      branchLabel = fileRefForBranch ? fileRefForBranch[0] : userTask;
    }
    // Warn if the branch already exists from a previous run
    const derivedBranch = deriveFeatureBranchName(workingDir, branchLabel, branchPrefix);
    let branchAlreadyAcknowledged = false;
    if (derivedBranch && localBranchExists(workingDir, derivedBranch)) {
      // User will engage with a branch dialog below — no need for a second prompt afterward
      branchAlreadyAcknowledged = true;
      output.log("system", `Branch \`${derivedBranch}\` already exists from a previous run.`);
      output.log("system", `- **Yes** → delete it and start fresh from \`${mainBranch}\``);
      output.log("system", `- **No** → continue on the existing branch`);
      const resetR = await output.confirm(`Reset \`${derivedBranch}\` and start fresh?`);
      const reset = typeof resetR === "object" ? resetR.allowed : resetR;
      if (reset) {
        try {
          deleteLocalBranch(workingDir, derivedBranch);
          output.coordinatorLog(`Deleted \`${derivedBranch}\` — starting fresh from \`${mainBranch}\``);
        } catch {
          output.error(`Could not delete \`${derivedBranch}\` — it may be checked out elsewhere.`);
          return { stories: sorted, completedStoryIds: [], featureBranch: null, userTask };
        }
      } else {
        const continueR = await output.confirm(`Continue on existing \`${derivedBranch}\`?`);
        const cont = typeof continueR === "object" ? continueR.allowed : continueR;
        if (!cont) {
          output.log("system", "Cancelled. Run `/build` again after resolving the branch.");
          return { stories: sorted, completedStoryIds: [], featureBranch: null, userTask };
        }
      }
    }

    // Branch creation prompt — makes the branch name visible before workers start.
    // Skipped if the user already acknowledged the branch (via the existing-branch dialog above)
    // or if they have previously selected "always" (autoBranch: true in config).
    if (!branchAlreadyAcknowledged && config.review?.autoBranch !== true && !(typeof trustAll === "function" ? trustAll() : trustAll)) {
      const branchName = derivedBranch ?? "a feature branch";
      const r = await output.confirm(`About to create and check out \`${branchName}\`. Continue?`);
      const result = typeof r === "object" ? r : { allowed: r, mode: undefined };
      if (!result.allowed) {
        output.coordinatorLog("Cancelled.");
        return { stories: sorted, completedStoryIds: [], featureBranch: null, userTask };
      }
      if (result.mode === "always") {
        // Persist to global config so this survives across sessions
        const globalCfg = loadConfig() ?? { providers: {}, default: "anthropic" };
        globalCfg.review = { ...globalCfg.review, autoBranch: true };
        saveConfig(globalCfg);
        config.review = { ...config.review, autoBranch: true };
        output.coordinatorLog("Got it — branch prompt disabled. Use `/settings review.autoBranch false` to re-enable.");
      }
    }

    featureBranch = createFeatureBranch(workingDir, branchLabel, branchPrefix);
    if (featureBranch) {
      output.coordinatorLog(`Created and checked out branch: \`${featureBranch}\``);
      output.updateBranch?.(featureBranch);
      // Yield to let Ink render the branch update
      await new Promise(r => setTimeout(r, 0));
    } else if (isGitRepo(workingDir)) {
      output.error("Could not create feature branch. You may have uncommitted changes — commit or stash them first.");
      return { stories: sorted, completedStoryIds: [], featureBranch: null, userTask };
    }
    // If not a git repo, featureBranch stays null — commits and state persistence are skipped
  }

  // Helper: consistent exit message when stories are incomplete
  let retryable = true; // set to false when run made no progress
  function logRetryHint(): void {
    if (!featureBranch || !retryable) return;
    const done = completedStoryIds.length;
    const total = sorted.length;
    if (done < total) {
      output.coordinatorLog(`Staying on branch \`${featureBranch}\` — ${done}/${total} stories completed. Run \`/retry\` to continue.`);
    }
  }

  async function waitWhilePaused(): Promise<boolean> {
    await output.waitIfPaused?.();
    if (!abortSignal?.aborted) return false;
    output.coordinatorLog("Build cancelled.");
    logger.info("Build cancelled while paused");
    logRetryHint();
    return true;
  }

  async function pauseForBalanceIssue(scope: string): Promise<boolean> {
    output.coordinatorLog(`${scope} paused: provider quota/balance appears exhausted.`);
    output.log(
      "system",
      "Paused: your provider credits/quota appear low. Top up your balance or switch providers with `/model <provider>/<model>`, then run `/pause` to resume.",
    );
    if (output.requestPause) {
      await output.requestPause();
    } else {
      const proceedResult = await output.confirm(
        "Provider balance/quota issue detected. Continue after updating provider credentials or balance?",
      );
      const proceed = typeof proceedResult === "object" ? proceedResult.allowed : proceedResult;
      if (!proceed) {
        return true;
      }
    }
    if (abortSignal?.aborted) {
      output.coordinatorLog("Build cancelled.");
      logRetryHint();
      return true;
    }
    output.coordinatorLog("Resuming after provider/account update...");
    return false;
  }

  // Persist the plan so /retry works even if the first story fails
  if (featureBranch) {
    saveShipRun({ workingDir, featureBranch, mainBranch, userTask, stories: sorted, completedStoryIds, updatedAt: "" });
  }

  // ── Story execution loop ──
  const execResult = await executeStories({
    sorted,
    completedStoryIds,
    config,
    output,
    trustAll,
    sandboxed,
    userTask,
    context,
    sessionAllow,
    workingDir,
    costTracker,
    featureBranch,
    mainBranch,
    abortSignal,
    liveViewServer,
    ticketOps,
    waitWhilePaused,
    pauseForBalanceIssue,
    logRetryHint,
  });

  const failedStories = execResult.failedStories;
  const skippedStories = execResult.skippedStories;

  // If the story loop exited early (user cancel, abort, balance issue), return immediately
  if (execResult.earlyExit) {
    return { stories: sorted, completedStoryIds, featureBranch, userTask };
  }



  // Report failed/skipped stories before review
  if (failedStories.size > 0 || skippedStories.size > 0) {
    const failedNames = sorted.filter(s => failedStories.has(s.id)).map(s => s.title);
    const skippedNames = sorted.filter(s => skippedStories.has(s.id)).map(s => s.title);
    if (failedNames.length > 0) output.coordinatorLog(`Failed stories: ${failedNames.join(", ")}`);
    if (skippedNames.length > 0) output.coordinatorLog(`Skipped (blocked by dependency): ${skippedNames.join(", ")}`);
    logger.info("Story execution summary", { failed: [...failedStories], skipped: [...skippedStories], completed: sorted.length - failedStories.size - skippedStories.size });

    // If no new stories completed in this run, the plan can't make progress.
    // Clear state so /retry doesn't repeat the same failures.
    const newCompletions = completedStoryIds.filter(id => !retryPlan?.completedStoryIds.includes(id));
    if (newCompletions.length === 0 && failedStories.size > 0) {
      output.coordinatorLog("No stories completed — this run made no progress. Edit your spec and `/build` again.");
      if (featureBranch) clearShipRun(featureBranch);
      retryable = false;
    }
  }

  // --- Post-execution quality gates ---
  const gatesResult = await runQualityGates({
    config, output, sorted, completedStoryIds, context, workingDir,
  });
  if (gatesResult.earlyExit) {
    return { stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch };
  }
  const { gateResultsSection } = gatesResult;

  // Run inline review with revision loop
  const reviewLoopResult = await _runReviewLoop({
    config, output, sorted, context, userTask,
    featureBranch, mainBranch, workingDir,
    costTracker, abortSignal, trustAll, sandboxed, sessionAllow,
    liveViewServer, ticketOps, gateResultsSection,
    waitWhilePaused, pauseForBalanceIssue, logRetryHint,
  });
  if (reviewLoopResult.aborted) {
    return { stories: sorted, completedStoryIds, featureBranch, userTask };
  }
  const finalReviewText = reviewLoopResult.finalReviewText;

  // --- Populate and save run manifest ---
  manifest.featureBranch = featureBranch;
  manifest.mainBranch = mainBranch;
  manifest.completedAt = new Date().toISOString();
  manifest.totalCost = costTracker.getTotalCost();
  if (typeof costTracker.getUsageSummary === "function") {
    const usageSummary = costTracker.getUsageSummary();
    manifest.totalInputTokens = usageSummary.total.inputTokens;
    manifest.totalOutputTokens = usageSummary.total.outputTokens;
  }
  manifest.stories = sorted.map(s => ({
    id: s.id,
    title: s.title,
    persona: s.persona,
    status: completedStoryIds.includes(s.id) ? "completed" as const
      : failedStories.has(s.id) ? "failed" as const
      : "skipped" as const,
    retryCount: 0,
  }));
  const allCompleted = completedStoryIds.length === sorted.length;
  const anyCompleted = completedStoryIds.length > 0;
  const reviewEnabled = config.review?.enabled !== false;
  const reviewScore = reviewLoopResult.finalReviewText
    ? (() => { const m = reviewLoopResult.finalReviewText.match(/CODE_QUALITY_SCORE:\s*(\d+)/); return m ? parseInt(m[1]) : null; })()
    : null;
  const reviewDecision = reviewLoopResult.finalReviewText
    ? (reviewScore !== null && reviewScore >= (config.review?.approvalThreshold ?? 9) ? "approved" : "revision_needed")
    : reviewEnabled ? "skipped" : "disabled";
  manifest.outcome = allCompleted ? "success" : anyCompleted ? "partial" : "failed";
  saveRunManifest(manifest);

  // --- Build Report ---
  {
    const completed = sorted.filter(s => completedStoryIds.includes(s.id));
    const failed = sorted.filter(s => failedStories.has(s.id));
    const skipped = sorted.filter(s => skippedStories.has(s.id));
    const lines: string[] = ["", `── Build Report (${manifest.id}) ──`, ""];
    lines.push("Stories:");
    for (const s of sorted) {
      const idx = sorted.indexOf(s) + 1;
      if (completedStoryIds.includes(s.id)) {
        lines.push(`  ✓ ${idx}. ${s.title} (${s.persona})`);
      } else if (failedStories.has(s.id)) {
        lines.push(`  ✗ ${idx}. ${s.title} (${s.persona}) — failed`);
      } else if (skippedStories.has(s.id)) {
        lines.push(`  ⊘ ${idx}. ${s.title} (${s.persona}) — skipped`);
      }
    }
    lines.push("");
    // Gate results
    if (gateResultsSection) {
      const gatesPassed = gateResultsSection.includes("ALL PASSED");
      lines.push(`Quality gates: ${gatesPassed ? "✓ all passed" : "✗ failures detected"}`);
    }
    // Review result
    if (reviewEnabled) {
      if (reviewScore !== null) {
        lines.push(`Review: ${reviewDecision === "approved" ? "✓" : "✗"} ${reviewScore}/10 (${reviewDecision})`);
      } else {
        lines.push(`Review: skipped`);
      }
    }
    lines.push("");
    lines.push(`Result: ${completed.length} passed · ${failed.length} failed · ${skipped.length} skipped`);
    if (featureBranch) lines.push(`Branch: ${featureBranch}`);
    lines.push(`Cost: ~$${costTracker.getTotalCost().toFixed(2)}`);
    lines.push(`Run: ${manifest.id}`);
    lines.push("");
    for (const line of lines) output.log("system", line);
  }

  // --- Completion: push, PR, ticket updates, cleanup ---
  return runCompletion({
    config, output, sorted, completedStoryIds, featureBranch, mainBranch,
    workingDir, userTask, costTracker, finalReviewText, ticketKey,
    ticketOps, resolvedTicketSystem, liveViewServer,
    hooks: config.hooks,
  });
}
