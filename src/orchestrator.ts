import { streamText, stepCountIs, type ToolSet } from "ai";
import { z } from "zod";
import { createModel, buildOllamaOptions, ensureOllamaContext, ensureLmStudioContext } from "./engine/model-factory.js";
import { createToolDefinitions } from "./engine/tools/index.js";
import type { AIProvider } from "./engine/types.js";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { loadPersona } from "./personas.js";
import { formatProjectInstructions } from "./instructions.js";
import * as logger from "./logger.js";
import { runGate } from "./gate-runner.js";
import { CostTracker } from "./cost-tracker.js";
import type { CliConfig } from "./config.js";
import { getProviderForPersona, loadConfig, saveConfig } from "./config.js";
import { runHooks, runLifecycleHooks, runPreHooksWithBlocking } from "./hooks.js";
import {
  isGitRepo, getCurrentBranch, createFeatureBranch,
  deriveFeatureBranchName, localBranchExists, deleteLocalBranch,
  commitStoryChanges, commitRevisionChanges,
  captureStoryPriorWork, getDiffForReview, getDiffSinceCommit,
  getHeadHash, shellArg, execGh,
} from "./git-ops.js";
import { loadMemories } from "./memory.js";
import { extractGithubIssueNumber } from "./ticket-ops.js";
import { withConcurrencyControl } from "./tool-concurrency.js";
import * as lspTool from "./engine/tools/lsp.js";
import { checkpoint } from "./checkpoints.js";
import { saveShipRun, clearShipRun } from "./ship-state.js";
import { startAllMCPServers, getMCPToolDefinitions, stopAllMCPServers, autoDetectMCPServers } from "./mcp-client.js";

// ── Re-exports from sub-modules ──
// Types
export type { OrchestrationOutput, Story, OrchestrationResult, RetryPlan, StandaloneReviewResult } from "./orchestrator/types.js";

// Functions — public API
export { checkToolPermission } from "./orchestrator/execution.js";
export { runSpecCheck, classifyComplexity, applyQaParticipation } from "./orchestrator/planning.js";
export { getStoryDefinitionOfDone, validateStoryContractArtifacts } from "./orchestrator/execution.js";
export { extractStructuredMustFixItems, mergeMustFixItems, validateTechLeadReviewOutput, runStandaloneReview } from "./orchestrator/review.js";

// ── Imports from sub-modules (used internally by runOrchestration) ──
import type { OrchestrationOutput, Story, OrchestrationResult, RetryPlan, SharedContext, ReviewMustFixItem } from "./orchestrator/types.js";
import {
  isRateLimitError, isBalanceOrQuotaError, MAX_RATE_LIMIT_RETRIES,
  getModelContext, formatContext, truncateForPrompt,
  normalizeErrorSignature, rateLimitSleep, clipLogText,
  parsePromptLengthError, extractExecErrorDetail, resolveTaskInput,
  extractDeclaredFileMarkers, isTransientError, classifyError,
  isAbortSignalLike, isAbortControllerLike, extractToolFilePath,
  buildReasoningOptions, emitReasoningDelta,
  getReviewWallTimeoutMs, createTimedAbortSignal, collectReviewStreamResult,
} from "./orchestrator/utils.js";
import { planStories, topologicalSort, runSpecCheck as _runSpecCheck, applyQaParticipation as _applyQaParticipation } from "./orchestrator/planning.js";
import {
  fitWorkerPromptToContext, checkToolPermission as _checkToolPermission,
  extractCheckpointTargets, formatToolCallDisplay,
  getStoryDefinitionOfDone as _getStoryDefinitionOfDone,
  validateStoryContractArtifacts as _validateStoryContractArtifacts,
  formatContractIssuesForPrompt, emitFailureCode,
} from "./orchestrator/execution.js";
import {
  parseRequiredReviewOutcome, extractReviewFeedback,
  parseAffectedStories, sanitizeAffectedStories,
  buildReviewBlockerSignature, extractStructuredMustFixItems as _extractStructuredMustFixItems,
  mergeMustFixItems as _mergeMustFixItems, formatMustFixItems,
} from "./orchestrator/review.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDef = any;

/** Run LSP diagnostics on touched files. Returns error count (0 = clean, -1 = no LSP). */
async function runDiagnosticsOnTouchedFiles(
  touchedFiles: string[],
  workingDir: string,
  log: (msg: string) => void,
): Promise<{ errorCount: number; section: string }> {
  if (touchedFiles.length === 0) return { errorCount: 0, section: "" };

  // Filter out tsconfig-excluded files (test files produce false-positive diagnostics)
  const excludes = lspTool.loadTsconfigExcludes(workingDir);
  const unique = [...new Set(touchedFiles)].filter((f) => {
    const rel = path.isAbsolute(f) ? path.relative(workingDir, f) : f;
    return !excludes.some((re) => re.test(rel));
  });
  if (unique.length === 0) return { errorCount: 0, section: "" };

  log(`Running diagnostics on ${unique.length} touched file(s)...`);
  let totalErrors = 0;
  let lspAvailable = true;
  const lines: string[] = [];
  for (const filePath of unique) {
    try {
      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(workingDir, filePath);
      if (!fs.existsSync(resolvedPath)) { log(`⚠ File not found: ${filePath}`); continue; }
      const r = await lspTool.execute({ action: "diagnostics", file: resolvedPath, format: "json" }, workingDir);
      if (r.success && r.content) {
        try {
          const parsed = JSON.parse(r.content);
          if (parsed.lsp_available === false) { lspAvailable = false; continue; }
          const errors = parsed.summary?.errors ?? parsed.diagnostics?.filter((d: { severity: string }) => d.severity === "error").length ?? 0;
          totalErrors += errors;
          const status = errors > 0 ? `✗ ${filePath}: ${errors} error(s)` : `✓ ${filePath}: clean`;
          log(status);
          lines.push(status);
          // Include first few error details for reviewer context
          if (errors > 0 && parsed.diagnostics) {
            for (const d of parsed.diagnostics.slice(0, 5)) {
              lines.push(`    ${d.line}:${d.col} ${d.message}`);
            }
            if (parsed.diagnostics.length > 5) lines.push(`    ... and ${parsed.diagnostics.length - 5} more`);
          }
        } catch {
          log(`✓ ${filePath}: ${r.content}`);
        }
      } else {
        log(`✗ ${filePath}: ${r.error}`);
      }
    } catch (err) {
      log(`✗ ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!lspAvailable && totalErrors === 0) return { errorCount: -1, section: "" };

  // Build a section for the reviewer
  const section = totalErrors > 0
    ? `\n\n## LSP Diagnostics — ${totalErrors} ERROR(S)\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n\nThese type errors were found in touched files. Factor them into your review — request revision if they indicate real bugs.`
    : lines.length > 0
      ? `\n\n## LSP Diagnostics — CLEAN\n\n${lines.map(l => `- ${l}`).join("\n")}`
      : "";

  return { errorCount: totalErrors, section };
}

export function shouldTransitionTicketOnPrOpen(ticketSystem: string | undefined): boolean {
  return (ticketSystem || "").toLowerCase() !== "github";
}

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
  if (defaultProvider.provider === "ollama") {
    const host = defaultProvider.host || config.providers[defaultProvider.provider]?.host || "http://localhost:11434";
    const ctx = config.providers[defaultProvider.provider]?.contextLength;
    if (ctx) {
      await ensureOllamaContext(host, defaultProvider.model, ctx);
    }
  } else if (defaultProvider.provider === "lmstudio") {
    const host = defaultProvider.host || config.providers[defaultProvider.provider]?.host || "http://localhost:1234/v1";
    const ctx = config.providers[defaultProvider.provider]?.contextLength;
    if (ctx) {
      await ensureLmStudioContext(host, defaultProvider.model, ctx);
    }
  }

  // Set abort controller on live view server
  if (liveViewServer && abortController) {
    liveViewServer.setAbortController(abortController);
  }

  // Start MCP servers — skip auto-detect for local models (tool overload causes XML fallback)
  const skipAutoDetect = defaultProvider.provider === "ollama" || defaultProvider.provider === "lmstudio";
  const mcpConfig = skipAutoDetect
    ? (config.mcp || {})
    : autoDetectMCPServers(config.mcp || {});
  if (Object.keys(mcpConfig).length > 0) {
    output.coordinatorLog(`Starting ${Object.keys(mcpConfig).length} MCP server(s)...`);
    await startAllMCPServers(mcpConfig);
  }

  const costTracker = new CostTracker();
  const persistedMemories = loadMemories();
  const context: SharedContext = {
    filesCreated: [],
    filesModified: [],
    decisions: [],
    learnings: [],
  };
  context.learnings.push(...persistedMemories.filter(m => m.type === "learning").map(m => m.content));
  const sessionAllow = new Set<string>();
  const workingDir = process.cwd();

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

  // Track failed and blocked stories — matches worker/epic/coordinator-stories.ts pattern
  const failedStories = new Set<string>();
  const skippedStories = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    if (await waitWhilePaused()) {
      return { stories: sorted, completedStoryIds, featureBranch, userTask };
    }

    // Check if user cancelled (ESC) before starting next story
    if (abortSignal?.aborted) {
      output.coordinatorLog("Build cancelled.");
      logger.info("Build cancelled by user before story start", { storyIndex: i });
      logRetryHint();
      return { stories: sorted, completedStoryIds, featureBranch, userTask };
    }

    const story = sorted[i];

    // Skip already-completed stories (retry mode)
    if (completedStoryIds.includes(story.id)) {
      output.log("system", `Skipping story ${i + 1}/${sorted.length}: "${story.title}" — already completed`);
      continue;
    }

    // Check if any dependency failed — block this story (cascade failure)
    if (story.dependsOn?.some(dep => failedStories.has(dep) || skippedStories.has(dep))) {
      const blockedBy = story.dependsOn.filter(dep => failedStories.has(dep) || skippedStories.has(dep));
      skippedStories.add(story.id);
      output.log("system", `Skipping story ${i + 1}/${sorted.length}: "${story.title}" — blocked by failed dependency: ${blockedBy.join(", ")}`);
      logger.info(`Story ${i + 1} skipped (dependency failed)`, { story: story.id, blockedBy });
      continue;
    }

    const persona = loadPersona(story.persona);
    if (!persona) {
      output.error(`Unknown persona: ${story.persona}`);
      failedStories.add(story.id);
      continue;
    }

    // Resolve provider for this persona
    const { provider, model: modelName, apiKey, host, contextLength } = getProviderForPersona(
      config,
      persona.provider || story.persona
    );

    // Set API key
    if (apiKey) {
      const envMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_GENERATIVE_AI_API_KEY" };
      const envVar = envMap[provider];
      if (envVar && !process.env[envVar]) process.env[envVar] = apiKey;
    }

    output.log("system", `--- Story ${i + 1}/${sorted.length} ---`);
    output.log(story.persona, `Starting ${story.title} (\x1b[38;5;208m${provider}/${modelName}\x1b[0m, ${formatContext(getModelContext(modelName, contextLength))} context)`);
    logger.info(`Story ${i + 1}/${sorted.length} started`, { persona: story.persona, title: story.title, provider, model: modelName });

    // Emit live view events
    if (liveViewServer) {
      liveViewServer.emitStoryStart(i + 1, story.title, story.persona, sorted.length);
    }

    output.status(`${story.persona}: ${story.title.slice(0, 60)}`);

    const model = createModel(provider as AIProvider, modelName, host, contextLength, apiKey);

    // Build tools filtered by persona's allowed tools
    const allTools = createToolDefinitions(workingDir, model, sandboxed);
    const storyHealth: { testResults?: string; buildErrors?: string; servicesRunning?: string[] } = {};
    const personaTools: Record<string, AnyToolDef> = {};
    // Loop detection — matches worker/ai-clients/ai-sdk-client.ts
    // Reset per revision so a tool loop on revision 0 doesn't permanently abort retries
    const LOOP_WINDOW = 6;
    const LOOP_THRESHOLD = 4;
    let recentToolSignatures: string[] = [];
    let loopAbort = new AbortController();
    for (const toolName of persona.tools) {
      const toolDef = allTools[toolName as keyof typeof allTools] as AnyToolDef;
      if (toolDef) {
        personaTools[toolName] = {
          ...toolDef,
          execute: async (input: Record<string, unknown>) => {
            const allowed = await _checkToolPermission(toolName, input, trustAll, sessionAllow, output, config.permissions);
            if (!allowed) return "Tool execution denied by user.";

            // Track for loop detection
            const sig = `${toolName}:${JSON.stringify(input).substring(0, 200)}`;
            recentToolSignatures.push(sig);
            if (recentToolSignatures.length > LOOP_WINDOW) recentToolSignatures.shift();
            if (recentToolSignatures.length >= LOOP_WINDOW) {
              const counts: Record<string, number> = {};
              for (const s of recentToolSignatures) counts[s] = (counts[s] || 0) + 1;
              const maxCount = Math.max(...Object.values(counts));
              if (maxCount >= LOOP_THRESHOLD) {
                logger.error("Tool call loop detected", { persona: story.persona, maxCount, window: LOOP_WINDOW });
                output.error(`Tool call loop detected (${maxCount}/${LOOP_WINDOW} identical calls) — aborting story`);
                loopAbort.abort();
                return "ABORTED: Tool call loop detected. Stop and report what you've accomplished so far.";
              }
            }

            output.toolCall(story.persona, toolName, input);
            for (const target of extractCheckpointTargets(toolName, input, workingDir)) {
              checkpoint(target.path, target.tool);
            }
            const hookResult = runPreHooksWithBlocking(toolName, config.hooks, workingDir, { input: JSON.stringify(input).substring(0, 10000) });
            if (hookResult.blocked) {
              return `Tool blocked by pre-hook: ${hookResult.reason}`;
            }
            const result = await toolDef.execute(input);
            runHooks("post", toolName, config.hooks, workingDir);

            // Log tool result to cli.log — full output, no truncation
            const resultStr = typeof result === "string" ? result : JSON.stringify(result);
            const isError = typeof result === "string" && result.startsWith("Error:");
            if (isError) {
              logger.error("Tool error", { persona: story.persona, tool: toolName, result: resultStr });
            } else {
              logger.debug("Tool result", { tool: toolName, result: resultStr });
            }

            // Track docker compose services for auto-cleanup
            if (toolName === "bash") {
              const cmd = (input as { command?: string }).command || "";
              if (/docker[\s-]compose\s+up/i.test(cmd)) {
                const resolvedCwd = (input as { cwd?: string }).cwd || workingDir;
                startedDockerCompose.add(resolvedCwd);
              }
            }

            // Parse structured bash output for story health context
            if (toolName === "bash" && typeof result === "string") {
              // Test results: jest/vitest/pytest/go test/playwright
              const testMatch = result.match(/(\d+)\s+(?:tests?\s+)?passed|(\d+)\s+(?:tests?\s+)?failed|Tests:\s+(\d+)\s+passed/i);
              if (testMatch) {
                storyHealth.testResults = result.split("\n").filter(l =>
                  /pass|fail|error|PASS|FAIL|ERROR|Tests:|test result/i.test(l)
                ).slice(-5).join("\n");
              }

              // Build errors: tsc, eslint, go build
              const errorLines = result.split("\n").filter(l =>
                /error\s+TS\d|SyntaxError|Cannot find module|error:|ERROR/i.test(l)
              );
              if (errorLines.length > 0) {
                storyHealth.buildErrors = errorLines.join("\n");
              }

              // Docker services
              const bashCmd = (input as { command?: string }).command || "";
              if (/docker.*(compose|ps)|CONTAINER\s+ID/i.test(bashCmd)) {
                const serviceLines = result.split("\n").filter(l => /Up|running|healthy/i.test(l));
                if (serviceLines.length > 0) {
                  storyHealth.servicesRunning = serviceLines.map(l => l.trim());
                }
              }
            }

            output.status("");
            return result;
          },
        };
      }
    }

    // Merge MCP tools into persona tools — same pattern as useAgent.ts
    const mcpTools = getMCPToolDefinitions();
    for (const [key, def] of Object.entries(mcpTools)) {
      personaTools[key] = def;
    }

    // TODO: Deferred tool loading — skipped in orchestrator because persona-based filtering
    // already limits tools per story. MCP tools are the only unbounded set. If MCP tool counts
    // become large, add partitionTools() here (see useAgent.ts for the pattern).

    // Add skill tool — lets story workers invoke custom skills mid-execution
    personaTools["skill"] = {
      description: "Invoke a custom skill by name. Skills are reusable workflows from .workermill/skills/.",
      inputSchema: z.object({
        name: z.string().describe("The skill name to invoke"),
        args: z.string().optional().describe("Optional arguments"),
      }),
      execute: async ({ name: skillName, args }: { name: string; args?: string }) => {
        const { loadCustomCommands } = await import("./custom-commands.js");
        const skills = loadCustomCommands();
        const match = skills.find(
          (s: { name: string }) => s.name.toLowerCase() === skillName.toLowerCase(),
        );
        if (!match) return `Skill "${skillName}" not found.`;
        return args ? `${match.prompt}\n\n**Arguments:** ${args}` : match.prompt;
      },
    };

    // Apply concurrency control — safe tools (read_file, list_dir, etc.) run in parallel
    for (const [name, td] of Object.entries(personaTools)) {
      if (td && typeof td.execute === "function") {
        const original = td.execute;
        (personaTools as any)[name] = { ...td, execute: withConcurrencyControl(name, original as any) };
      }
    }

    const startedDockerCompose = new Set<string>(); // tracks cwd where compose was started

    let revisionFeedback = "";
    let storyRateLimitRetries = 0;
    let contextOverflowRetries = 0;
    let contextOverflowSlackTokens = 0;
    const retryErrorSignatureCounts = new Map<string, number>();
    for (let revision = 0; revision <= 2; revision++) {

    // Reset loop detection for each revision attempt
    recentToolSignatures = [];
    loopAbort = new AbortController();

    // Build enriched context from prior stories — mirrors worker/epic/prompt-builder.ts
    const contextParts: string[] = [];

    // Sibling files warning — DO NOT DELETE (from worker prompt-builder.ts)
    if (context.filesCreated.length > 0) {
      contextParts.push(`\n## Files Created by Prior Stories — DO NOT DELETE\n${context.filesCreated.map(f => `- ${f}`).join("\n")}\nThese files were created by other experts. You may import or reference them but NEVER delete or overwrite them.`);
    }
    if (context.filesModified.length > 0) {
      contextParts.push(`\n## Files Modified by Prior Stories\n${context.filesModified.map(f => `- ${f}`).join("\n")}\nBe aware these files have been changed. Read them before making assumptions about their contents.`);
    }

    // Decisions as hard constraints (not informational — from worker coordinator pattern)
    if (context.decisions.length > 0) {
      contextParts.push(`\n## Architectural Decisions — FOLLOW THESE\n${context.decisions.map((d, idx) => `${idx + 1}. ${d}`).join("\n")}\nThese decisions were made by prior experts. Follow them — do not contradict or revisit unless the spec explicitly requires a different approach.`);
    }

    // Learnings as helpful context
    if (context.learnings.length > 0) {
      contextParts.push(`\n## Learnings from Prior Stories\n${context.learnings.map(l => `- ${l}`).join("\n")}`);
    }

    const contextBlock = contextParts.join("\n");

    const projectInstructions = formatProjectInstructions(workingDir);
    const contextWindow = getModelContext(modelName, contextLength);
    const fittedPrompt = fitWorkerPromptToContext({
      personaSystemPrompt: persona.systemPrompt,
      projectInstructions,
      userTask,
      story,
      contextBlock,
      revisionFeedback,
      workingDir,
      personaTools: personaTools as ToolSet,
      contextWindow,
      aggressive: contextOverflowRetries > 0,
      overflowTokens: contextOverflowSlackTokens,
    });
    const systemPrompt = fittedPrompt.systemPrompt;
    if (fittedPrompt.trimmedSections.length > 0) {
      output.log(
        "system",
        `Trimmed ${fittedPrompt.trimmedSections.join(", ")} to fit ${formatContext(contextWindow)} context (${Math.round(fittedPrompt.estimatedTokens / 1000)}K/${Math.round(fittedPrompt.budgetTokens / 1000)}K prompt budget)`,
      );
      logger.info("Worker prompt trimmed for context", {
        story: story.id,
        persona: story.persona,
        provider,
        model: modelName,
        contextWindow,
        estimatedTokens: fittedPrompt.estimatedTokens,
        budgetTokens: fittedPrompt.budgetTokens,
        trimmedSections: fittedPrompt.trimmedSections,
        aggressive: contextOverflowRetries > 0,
      });
    }

    try {
      // Combine user abort with loop detection abort
      const combinedAbort = new AbortController();
      if (abortSignal) abortSignal.addEventListener("abort", () => combinedAbort.abort());
      loopAbort.signal.addEventListener("abort", () => combinedAbort.abort());

      // Text repetition detection
      const recentTexts: string[] = [];
      const TEXT_LOOP_WINDOW = 8;
      const TEXT_SUPPRESS_THRESHOLD = 5;
      const TEXT_ABORT_THRESHOLD = 10;
      let textRepeatCount = 0;
      let textSuppressed = false;

      // Captures representative expert text for ticket comments.
      let expertSummary = "";
      let lastSyntheticThinkingSig = "";
      const reasoningLength = { value: 0 };

      // Track tool calls for structured ticket update
      const storyActions: Array<{ tool: string; detail: string }> = [];

      const storyStartMs = Date.now();
      const stream = streamText({
        model,
        abortSignal: combinedAbort.signal,
        system: systemPrompt,
        prompt: fittedPrompt.prompt,
        tools: personaTools as ToolSet,
        stopWhen: stepCountIs(100),
        timeout: { chunkMs: 120_000 },
        ...buildReasoningOptions(provider, modelName),
        ...buildOllamaOptions(provider as AIProvider, contextLength),
        onStepFinish({ text, toolCalls, reasoningText }) {
          emitReasoningDelta((line) => output.log(story.persona, line), reasoningText, reasoningLength);
          if (toolCalls && toolCalls.length > 0) {
            // Track actions for ticket update
            for (const tc of toolCalls) {
              const name = tc.toolName;
              const input = tc.input as Record<string, unknown>;
              const filePath = extractToolFilePath(name, input);
              if (name === "write_file" && filePath) {
                storyActions.push({ tool: "created", detail: filePath });
                if (liveViewServer) liveViewServer.emitFileChange(story.persona, i + 1, story.title, filePath, "created");
              } else if ((name === "edit_file" || name === "multi_edit_file" || name === "patch") && filePath) {
                storyActions.push({ tool: "edited", detail: filePath });
                if (liveViewServer) liveViewServer.emitFileChange(story.persona, i + 1, story.title, filePath, "edited");
              } else if (name === "bash" && input.command) {
                const cmd = String(input.command);
                // Only track meaningful commands, not reads
                if (/npm (test|run|install)|npx|yarn|pnpm|docker|go (build|test)|pytest|cargo|make|mvn|gradle/i.test(cmd)) {
                  storyActions.push({ tool: "ran", detail: cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd });
                }
              } else if (name === "verify" && input.command) {
                storyActions.push({ tool: "verified", detail: String(input.command).slice(0, 80) });
              }
            }
            if ((!text || !text.trim()) && toolCalls.length > 0) {
              const first = toolCalls[0];
              const detail = formatToolCallDisplay(first.toolName, first.input as Record<string, unknown>);
              const sig = `${first.toolName}:${detail}`;
              if (sig !== lastSyntheticThinkingSig) {
                output.log(story.persona, `${first.toolName}${detail ? ` ${detail}` : ""}`);
                lastSyntheticThinkingSig = sig;
              }
            }
          }

          if (text) {
            // Keep a representative sample for ticket comments.
            if (!expertSummary) expertSummary = text.slice(0, 2000);
            // Text loop detection
            // Normalize signature: trim, collapse whitespace, lowercase first 200 chars
            const textSig = text.trim().replace(/\s+/g, " ").substring(0, 200).toLowerCase();
            recentTexts.push(textSig);
            if (recentTexts.length > TEXT_LOOP_WINDOW) recentTexts.shift();
            if (recentTexts.length >= TEXT_LOOP_WINDOW) {
              const counts: Record<string, number> = {};
              for (const t of recentTexts) counts[t] = (counts[t] || 0) + 1;
              const maxCount = Math.max(...Object.values(counts));
              if (maxCount >= TEXT_SUPPRESS_THRESHOLD) {
                textRepeatCount++;
                if (!textSuppressed) {
                  textSuppressed = true;
                  output.log(story.persona, "(repeating output suppressed)");
                  logger.info("Text repetition suppressed", { persona: story.persona, count: textRepeatCount });
                }
                if (textRepeatCount >= TEXT_ABORT_THRESHOLD) {
                  logger.error("Text output loop — aborting after repeated output", { persona: story.persona });
                  output.error("Text output stuck in loop — aborting story");
                  combinedAbort.abort();
                }
                return;
              }
              textSuppressed = false;
            }

            const lines = text.split("\n").filter(l => l.trim());
            for (const line of lines) {
              if (line.includes("::decision::") || line.includes("::learning::") || line.includes("::remember::") ||
                  line.includes("::file_created::") || line.includes("::file_modified::")) continue;
              output.log(story.persona, line);
            }
            // Always log full text to cli.log — terminal may suppress but logs show truth
            logger.debug("Story output", { persona: story.persona, text });
          }
          output.status(`${story.persona}: working...`);
        },
      });

      // Drive the stream (required for streamText) — onStepFinish handles display
      try {
        for await (const _chunk of stream.textStream) { /* consumed */ }
      } catch {
        // Stream may throw on abort (user ESC or rambling detector) — that's expected
      }

      // Check abort immediately after stream ends — user may have pressed ESC
      if (abortSignal?.aborted) {
        output.coordinatorLog("Build cancelled.");
        logRetryHint();
        return { stories: sorted, completedStoryIds, featureBranch, userTask };
      }

      const text = await stream.text;
      const usage = await stream.totalUsage;

      output.statusDone();

      // Extract markers and display as WorkerMill-style persona activity
      const decisionMatches = text.match(/::decision::(.*?)(?=::\w+::|$)/gs);
      if (decisionMatches) {
        for (const m of decisionMatches) {
          const decision = m.replace("::decision::", "").trim();
          context.decisions.push(decision);
          output.log(story.persona, decision);
        }
      }

      // Learning extraction disabled — smaller models spam generic platitudes
      // ("follows best practices", "implementation is production-ready") that
      // pollute the memory system. Re-enable when we have quality filtering.

      context.filesCreated.push(...extractDeclaredFileMarkers(text, "file_created"));
      context.filesModified.push(...extractDeclaredFileMarkers(text, "file_modified"));

      // Track cost
      const inTokens = usage?.inputTokens || 0;
      const outTokens = usage?.outputTokens || 0;
      costTracker.addUsage(persona.name, provider, modelName, inTokens, outTokens);
      output.updateCost?.(costTracker.getTotalCost());
      output.updateUsageSummary?.(costTracker.getUsageSummary());

      // Track tok/s for worker model
      const storyElapsed = (Date.now() - storyStartMs) / 1000;
      if (outTokens > 0 && storyElapsed > 0) {
        const workerTokPerSec = Math.round(outTokens / storyElapsed);
        output.updateTokPerSec?.(`${provider}/${modelName}`, workerTokPerSec);
        logger.info("Model performance", { provider, model: modelName, tokPerSec: workerTokPerSec });
      }

      // Detect empty story — model returned nothing
      if (outTokens === 0 && !text.trim()) {
        logger.error(`Story ${i + 1} produced no output`, { persona: story.persona });
        if (revision < 2) {
          output.log(story.persona, `Story produced no output — retrying (${revision + 1}/3)`);
          continue; // retry this story
        }
        emitFailureCode(output, "worker_no_output", `Story ${i + 1} failed: model produced no output after 3 attempts`);
        failedStories.add(story.id);
        break;
      }

      // --- Post-execution validation ---
      // File existence check only. Build/lint/test verification is the expert's
      // responsibility — they have bash and verify tools. Auto-detecting and
      // running quality gates caused cascading failures when earlier stories
      // created broken configs that later stories couldn't fix.
      {
        const missingFiles = context.filesCreated.filter(f => {
          const fullPath = path.isAbsolute(f) ? f : path.join(workingDir, f);
          return !fs.existsSync(fullPath);
        });
        if (missingFiles.length > 0) {
          logger.info("Missing declared files", { persona: story.persona, files: missingFiles });
          if (revision < 2) {
            output.log(story.persona, `${missingFiles.length} declared file(s) missing — retrying`);
            revisionFeedback = `\n\n## Missing Files\nThese files were declared as created but don't exist on disk:\n${missingFiles.map(f => `- ${f}`).join("\n")}\n\nCreate them or remove the declarations.`;
            continue;
          }
        }
      }

      {
        const contractIssues = _validateStoryContractArtifacts(story, workingDir);
        if (contractIssues.length > 0) {
          logger.info("Story contract validation failed", {
            story: story.id,
            persona: story.persona,
            issues: contractIssues.map((issue) => ({ code: issue.code, path: issue.path, command: issue.command })),
          });
          if (revision < 2) {
            output.log(story.persona, `${contractIssues.length} definition-of-done issue(s) detected — retrying`);
            revisionFeedback = `\n\n## Definition Of Done Failures\n${formatContractIssuesForPrompt(contractIssues)}\n\nFix every blocking item above before finishing this story.`;
            continue;
          }

          for (const issue of contractIssues) {
            emitFailureCode(output, issue.code, `Story ${i + 1}: ${issue.message}`);
          }
          failedStories.add(story.id);
          break;
        }
      }

      // Detect stories that still produced no real file changes on disk.
      // This catches both pure narration and failed/no-op write tool attempts.
      {
        const fileActions = storyActions.filter(a => a.tool === "created" || a.tool === "edited");
        const canCheckGitChanges = isGitRepo(workingDir);
        let hasDiskChanges = false;
        if (canCheckGitChanges) {
          try {
            const diffOut = execSync("git diff HEAD --name-only", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
            const untrackedOut = execSync("git ls-files --others --exclude-standard", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
            hasDiskChanges = diffOut.length > 0 || untrackedOut.length > 0;
          } catch { /* best effort */ }
        }

        if (outTokens > 0 && canCheckGitChanges && !hasDiskChanges) {
          logger.info("Story produced output but no file changes on disk", {
            persona: story.persona,
            outTokens,
            fileActionCount: fileActions.length,
          });

          if (revision < 2) {
            output.log(story.persona, "No file changes detected — retrying with stronger guidance");
            const guidance = fileActions.length === 0
              ? "You described what to do but did NOT actually use tools to write code."
              : "You called file-edit tools, but they did not produce any persisted file changes.";
            revisionFeedback = `\n\n## No Changes Written\n${guidance} Your previous response left zero tracked or untracked file changes on disk.\n\n**You MUST use the edit_file, write_file, or multi_edit_file tools to make real edits.** Describing changes with ::file_modified:: markers is NOT the same as making them. Actually write the code now and ensure files are changed on disk.`;
            continue;
          }

          const reason = fileActions.length === 0
            ? "model narrated changes but never wrote code"
            : "model called write tools but produced no persisted file changes";
          output.error(`Story ${i + 1} failed: ${reason} after 3 attempts`);
          failedStories.add(story.id);
          break;
        }
      }

      // --- Diagnostics enforcement ---
      const diagResult = await runDiagnosticsOnTouchedFiles(
        [...context.filesCreated, ...context.filesModified],
        workingDir,
        (msg) => output.log(story.persona, msg),
      );
      const diagnosticErrors = diagResult.errorCount;

      // Check abort before completing
      if (abortSignal?.aborted) {
        output.coordinatorLog("Build cancelled.");
        logRetryHint();
        return { stories: sorted, completedStoryIds, featureBranch, userTask };
      }

      output.log(story.persona, `${story.title} — completed! (${i + 1}/${sorted.length})`);
      logger.info(`Story ${i + 1} completed`, { persona: story.persona, inputTokens: inTokens, outputTokens: outTokens });
      completedStoryIds.push(story.id);

      // Post story completion to ticket — structured update like a real team member
      if (ticketOps) {
        // Build structured summary from actual tool calls
        const created = [...new Set(storyActions.filter(a => a.tool === "created").map(a => a.detail))];
        const edited = [...new Set(storyActions.filter(a => a.tool === "edited").map(a => a.detail))];
        const commands = storyActions.filter(a => a.tool === "ran" || a.tool === "verified");

        const updateParts: string[] = [];

        // Lead with the expert's own summary if available
        if (expertSummary) {
          updateParts.push(expertSummary);
          updateParts.push("");
        }

        // Concrete actions taken
        const actionLines: string[] = [];
        if (created.length > 0) actionLines.push(`**Created:** ${created.map(f => `\`${f}\``).join(", ")}`);
        if (edited.length > 0) actionLines.push(`**Modified:** ${edited.map(f => `\`${f}\``).join(", ")}`);
        if (commands.length > 0) {
          const cmdList = commands.slice(0, 5).map(c => `\`${c.detail}\``).join(", ");
          actionLines.push(`**Ran:** ${cmdList}${commands.length > 5 ? ` +${commands.length - 5} more` : ""}`);
        }
        if (actionLines.length > 0) {
          updateParts.push("**Actions:**");
          updateParts.push(...actionLines);
        }

        // Fallback if no actions tracked
        if (updateParts.length === 0) {
          const changedFiles = [...new Set([...context.filesCreated, ...context.filesModified])];
          updateParts.push(`Implemented ${story.title}. ${changedFiles.length} file${changedFiles.length !== 1 ? "s" : ""} changed.`);
        }

        ticketOps.postComment(
          `### ${story.persona} (${provider}/${modelName}) — ${story.title} (${i + 1}/${sorted.length})\n\n${updateParts.join("\n")}`
        ).catch(() => {});
      }

      // Persist progress so /retry works across terminal restarts
      if (featureBranch) {
        saveShipRun({ workingDir, featureBranch, mainBranch, userTask, stories: sorted, completedStoryIds, updatedAt: "" });
      }

      // Commit story changes — creates a checkpoint on the feature branch
      // Gate: don't commit if LSP found errors (diagnosticErrors === -1 means no LSP, allow commit)
      if (featureBranch && diagnosticErrors <= 0) {
        const hash = commitStoryChanges(workingDir, i + 1, story.title, story.persona);
        if (hash) output.coordinatorLog(`Committed story ${i + 1}: ${hash}`);
      } else if (diagnosticErrors > 0) {
        output.coordinatorLog(`Story ${i + 1} has ${diagnosticErrors} diagnostic error(s) — commit skipped, will be caught in review`);
      }

      const storyElapsedForLiveView = (Date.now() - storyStartMs) / 1000;
      if (liveViewServer) liveViewServer.emitStoryComplete(i + 1, storyElapsedForLiveView);

          break; // Story succeeded, exit revision loop
    } catch (err) {
      output.statusDone();

      // If user cancelled (ESC), exit immediately — don't retry or classify
      if (abortSignal?.aborted) {
        output.coordinatorLog("Build cancelled.");
        logger.info("Build cancelled by user during story execution", { story: i + 1, persona: story.persona });
        logRetryHint();
        return { stories: sorted, completedStoryIds, featureBranch, userTask };
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Story ${i + 1} error`, { persona: story.persona, error: errMsg, revision });

      if (isBalanceOrQuotaError(errMsg)) {
        const shouldStop = await pauseForBalanceIssue(`Story ${i + 1}`);
        if (shouldStop) {
          return { stories: sorted, completedStoryIds, featureBranch, userTask };
        }
        // Retry same revision after user tops up or switches provider.
        continue;
      }

      const promptOverflow = parsePromptLengthError(err);
      if (promptOverflow && contextOverflowRetries < 1) {
        contextOverflowRetries++;
        contextOverflowSlackTokens = Math.max(0, promptOverflow.actualTokens - promptOverflow.limitTokens);
        output.log(
          "system",
          `Prompt exceeded model context (${formatContext(promptOverflow.actualTokens)} > ${formatContext(promptOverflow.limitTokens)}) — retrying with tighter prompt budget`,
        );
        logger.info("Retrying story after prompt-length overflow", {
          story: i + 1,
          persona: story.persona,
          provider,
          model: modelName,
          actualTokens: promptOverflow.actualTokens,
          limitTokens: promptOverflow.limitTokens,
        });
        continue;
      }

      // Rate limit retry with backoff — retry in-place before falling through to error classification
      const rl = isRateLimitError(err);
      if (rl && storyRateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
        storyRateLimitRetries++;
        const waitSec = Math.ceil(rl.retryAfterMs / 1000);
        output.log("system", `Rate limited — retrying in ${waitSec}s (${storyRateLimitRetries}/${MAX_RATE_LIMIT_RETRIES})`);
        logger.info("Rate limit retry", { story: i + 1, attempt: storyRateLimitRetries, waitSec });
        await rateLimitSleep(rl.retryAfterMs);
        continue; // retry same revision
      }

      // Classify error — from worker/epic/types.ts + worker-decision-engine.ts
      const errorClass = classifyError(errMsg);
      logger.info(`Error classified`, { category: errorClass.category, fixable: errorClass.fixable, persona: story.persona });
      const signature = `${errorClass.category}:${normalizeErrorSignature(errMsg)}`;
      const seenCount = (retryErrorSignatureCounts.get(signature) || 0) + 1;
      retryErrorSignatureCounts.set(signature, seenCount);

      // Transient errors — retry as-is
      if (errorClass.category === "transient" && revision < 2) {
        if (seenCount >= 2) {
          output.error(`Story ${i + 1} kept failing with the same transient error — stopping retries to avoid token waste.`);
          logger.info("Retry stopped on repeated transient error", { story: i + 1, signature });
          failedStories.add(story.id);
          break;
        }
        output.log(story.persona, `Transient error: ${errMsg} — retrying...`);
        logger.info(`Story ${i + 1} retrying (transient)`, { revision });
        continue;
      }

      // Fixable errors (typescript, lint, test, build) — retry with fix context
      if (errorClass.fixable && revision < 2) {
        if (seenCount >= 2) {
          output.error(`Story ${i + 1} repeated the same ${errorClass.category} error — stopping retries to avoid token waste.`);
          logger.info("Retry stopped on repeated fixable error", { story: i + 1, signature, category: errorClass.category });
          failedStories.add(story.id);
          break;
        }
        output.log(story.persona, `${errorClass.category} error detected — retrying with fix context (${revision + 1}/3)`);
        logger.info(`Story ${i + 1} retrying (fixable ${errorClass.category})`, { revision });
        const errorForPrompt = truncateForPrompt(errMsg, 2_500, "error details");
        revisionFeedback = `\n\n## Error During Execution — Fix This\n\nCategory: ${errorClass.category}\n\n${errorForPrompt}\n\n**${errorClass.fixHint}**`;
        continue;
      }

      // Non-fixable or retries exhausted
      if (errorClass.category === "rate_limit") {
        output.error(`Story ${i + 1} hit rate limit — stopping (wait and retry later)`);
      } else if (errorClass.category === "auth") {
        output.error(`Story ${i + 1} auth error — check your API key/credentials`);
      } else {
        output.error(`Story ${i + 1} failed: ${errMsg}`);
      }
      failedStories.add(story.id);
      break;
    }

    } // end revision loop

    // Auto-cleanup: stop any Docker Compose services started during this story
    for (const composeDir of startedDockerCompose) {
      try {
        execSync("docker compose down --timeout 5 2>/dev/null", { cwd: composeDir, timeout: 15_000 });
        output.log("system", "Auto-cleanup: stopped Docker services");
        logger.info("Auto-cleanup docker compose", { cwd: composeDir });
      } catch { /* non-fatal */ }
    }
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
  // Runs after ALL stories complete, before tech lead review.
  // Failures go to reviewer as context — no retry loop, no extra AI calls.
  //
  // Two sources of gates:
  //   1. config.qualityGates — static commands defined in .workermill/config.json
  //   2. story.verificationCommands — dynamic commands generated by the planner
  //      per story (verifyEnabled defaults to true — opt out with verifyEnabled: false)
  let gateResultsSection = "";
  const verifyEnabled = config.review?.verifyEnabled !== false;

  const staticGates = config.qualityGates ?? [];
  const requiredCommandGates = sorted
    .filter((s) => completedStoryIds.includes(s.id) && _getStoryDefinitionOfDone(s).requiredCommands.length > 0)
    .map((s) => ({ name: `required: ${s.title}`, commands: _getStoryDefinitionOfDone(s).requiredCommands }));
  const dynamicGates = verifyEnabled
    ? sorted
        .filter(s => completedStoryIds.includes(s.id) && s.verificationCommands?.length)
        .map(s => ({ name: `verify: ${s.title}`, commands: s.verificationCommands! }))
    : [];
  const allGates = [...staticGates, ...requiredCommandGates, ...dynamicGates];
  const requiredGateNames = new Set(requiredCommandGates.map((gate) => gate.name));

  if (allGates.length > 0 && completedStoryIds.length > 0) {
    output.coordinatorLog(`Running ${allGates.length} quality gate${allGates.length !== 1 ? "s" : ""}...`);
    output.status(`Running quality gates (${allGates.length})...`);
    const gateResults = await Promise.all(allGates.map(g => runGate(g, workingDir)));
    output.statusDone();

    const failed = gateResults.filter(r => !r.passed);
    const passed = gateResults.filter(r => r.passed);

    for (const r of passed) output.coordinatorLog(`  ✓ ${r.name}`);
    for (const r of failed) output.coordinatorLog(`  ✗ ${r.name} — failed`);

    logger.info("Quality gates complete", {
      total: gateResults.length,
      passed: passed.length,
      failed: failed.length,
    });

    const requiredFailures = failed.filter((result) => requiredGateNames.has(result.name));

    if (failed.length > 0) {
      gateResultsSection =
        `\n\n## Quality Gate Results — ${failed.length} FAILED\n\n` +
        failed.map(r =>
          `### ${r.name} — FAILED\n\`\`\`\n${r.output.slice(0, 2000)}\n\`\`\``
        ).join("\n\n") +
        "\n\nRequired command failures are blocking. Verification-gate failures remain reviewer context.";
    } else {
      gateResultsSection =
        "\n\n## Quality Gate Results — ALL PASSED\n\n" +
        passed.map(r => `- ✓ ${r.name}`).join("\n");
    }

    if (requiredFailures.length > 0) {
      for (const failure of requiredFailures) {
        emitFailureCode(output, "required_command_failed", `${failure.name} failed`);
      }
      output.coordinatorLog(`Definition-of-done check failed: ${requiredFailures.length} required command${requiredFailures.length !== 1 ? "s" : ""} failed.`);
      logger.info("Blocking required command failures", { failures: requiredFailures.map((result) => result.name) });
      return { stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch };
    }
  }

  // Run LSP diagnostics on touched files BEFORE review — so the reviewer sees type errors
  if (completedStoryIds.length > 0) {
    const diagResult = await runDiagnosticsOnTouchedFiles(
      [...context.filesCreated, ...context.filesModified],
      workingDir,
      (msg) => output.coordinatorLog(msg),
    );
    if (diagResult.section) {
      gateResultsSection += diagResult.section;
    }
  }

  // Review config
  const reviewEnabled = config.review?.enabled !== false; // default: true
  const maxRevisions = config.review?.maxRevisions ?? 3;
  let autoRevise = config.review?.autoRevise ?? false;

  // Run inline review with revision loop
  let finalReviewText = ""; // Captures the approved review for use in PR body
  const reviewer = reviewEnabled ? loadPersona("tech_lead") : null;
  if (reviewer) {
    const { provider: revProvider, model: revModel, apiKey: revApiKey, host: revHost, contextLength: revCtx } = getProviderForPersona(
      config,
      "tech_lead"
    );

    if (revApiKey) {
      const envMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_GENERATIVE_AI_API_KEY" };
      const envVar = envMap[revProvider];
      const key = revApiKey.startsWith("{env:") ? process.env[revApiKey.slice(5, -1)] : revApiKey;
      if (envVar && key && !process.env[envVar]) process.env[envVar] = key;
    }

    const reviewModel = createModel(revProvider as AIProvider, revModel, revHost, revCtx, revApiKey);
    const reviewTools = createToolDefinitions(workingDir, reviewModel, sandboxed);

    // Read-only tools for reviewer — emit structured tool calls so UI status
    // counters and activity indicators stay accurate during tech_lead review.
    const reviewerTools: Record<string, AnyToolDef> = {};
    for (const toolName of reviewer.tools) {
      const toolDef = reviewTools[toolName as keyof typeof reviewTools] as AnyToolDef;
      if (toolDef) {
        reviewerTools[toolName] = {
          ...toolDef,
          execute: async (input: Record<string, unknown>) => {
            output.toolCall("tech_lead", toolName, input);
            const result = await toolDef.execute(input);
            return result;
          },
        };
      }
    }

    let previousReviewFeedback = "";
    let openMustFixItems: ReviewMustFixItem[] = [];
    let lastBlockerSignature = "";
    let repeatedBlockerCount = 0;
    // Check if user cancelled before starting review
    if (abortSignal?.aborted) {
      output.coordinatorLog("Build cancelled.");
      logRetryHint();
      return { stories: sorted, completedStoryIds, featureBranch, userTask };
    }
    logger.info("Starting review loop", { maxRevisions, provider: revProvider, model: revModel });
    let preRevisionHash = ""; // Tracks HEAD before each revision — so reviewer sees only what changed
    for (let reviewRound = 1; reviewRound <= maxRevisions + 1; reviewRound++) {
      if (await waitWhilePaused()) {
        return { stories: sorted, completedStoryIds, featureBranch, userTask };
      }
      const isRevision = reviewRound > 1;
      logger.info(`Review round ${reviewRound}`, { isRevision, maxRevisions });
      output.coordinatorLog(isRevision ? `Starting Tech Lead review (revision ${reviewRound - 1}/${maxRevisions}, ${revProvider}/${revModel})...` : `Starting Tech Lead review (${revProvider}/${revModel})...`);
      output.log("tech_lead", `Reviewing with \x1b[35m${revProvider}/${revModel}\x1b[0m (${formatContext(getModelContext(revModel, revCtx))} context)`);

      output.status(isRevision ? "Reviewer -- Re-checking after revisions" : "Reviewer -- Checking code quality");

      try {
        // Build review prompt with full context — matches WorkerMill's inline-reviewer.ts buildReviewPrompt()
        const mustFixSection = isRevision && openMustFixItems.length > 0
          ? `## Open Must-Fix Items
These blockers are still active until the next review clears them:

${formatMustFixItems(openMustFixItems)}

---

`
          : "";
        const previousFeedbackSection = isRevision && previousReviewFeedback
          ? `${mustFixSection}## Previous Review Feedback (Round ${reviewRound})
This is a revision attempt. The previous code was reviewed and these issues were identified:

${truncateForPrompt(previousReviewFeedback, 6_000, "previous review feedback")}

**Evaluate whether the revision addressed the issues you raised.**
- If your major issues were fixed, approve — even if minor items remain
- If a cosmetic or minor issue persists after being flagged, note it in feedback but don't block on it again
- If a functional bug, security issue, or missing requirement persists, you MUST block on it again — these are real problems regardless of how many times they've been flagged
- If the revision introduced NEW bugs, request another revision for those specific issues
- Score honestly based on current code quality, not relative to last round

---

`
          : "";

        const storyPlanDetails = sorted.map((s, idx) => {
          const parts = [`### Story ${idx + 1}: ${s.title} (${s.persona})`];
          parts.push(s.description);
          if (s.targetFiles?.length) parts.push(`**Target files:** ${s.targetFiles.join(", ")}`);
          if (s.referenceFiles?.length) parts.push(`**Reference patterns:** ${s.referenceFiles.join(", ")}`);
          if (s.implementationNotes) parts.push(`**Guidance:** ${s.implementationNotes}`);
          return parts.join("\n");
        }).join("\n\n");

        // Get clean diff from feature branch vs main — matches worker's consolidated PR diff.
        // On revision rounds, ALSO show what changed since the last review so the reviewer
        // can see progress instead of re-evaluating everything from scratch.
        let codeDiff = "";
        if (featureBranch) {
          if (isRevision && preRevisionHash) {
            // Revision rounds: send ONLY what changed since last review.
            // The reviewer already saw the full diff — sending it again wastes context
            // and risks exceeding the model's context window on later rounds.
            const revisionDelta = getDiffSinceCommit(workingDir, preRevisionHash);
            if (revisionDelta) {
              codeDiff += `## What Changed Since Last Review\n\nThis diff shows ONLY what the revision workers changed. Use read_file to inspect any file in full.\n\n${revisionDelta}`;
            } else {
              codeDiff += "(no changes detected since last review)";
            }
          } else {
            // First review: send the full branch diff
            const { stat, diff } = getDiffForReview(workingDir, mainBranch);
            if (stat) codeDiff += `## Branch Diff (${mainBranch}..HEAD)\n${stat}\n\n`;
            if (diff) codeDiff += diff;
          }
        } else {
          // Fallback: uncommitted changes diff
          try {
            const stat = execSync("git diff --stat HEAD 2>/dev/null || git diff --stat 2>/dev/null", {
              cwd: workingDir, encoding: "utf-8", stdio: "pipe",
            }).trim();
            const diff = execSync("git diff HEAD 2>/dev/null || git diff 2>/dev/null", {
              cwd: workingDir, encoding: "utf-8", stdio: "pipe",
            }).trim();
            if (stat) codeDiff += `## Diff Summary\n${stat}\n\n`;
            if (diff) codeDiff += diff;
          } catch { /* not a git repo */ }
        }

        // Cap diff to fit within the reviewer model's context window.
        // Rough estimate: 1 token ≈ 4 chars. Reserve 40% of context for system prompt,
        // tools, instructions, and response. The diff gets the remaining 60%.
        const revContextWindow = getModelContext(revModel, revCtx);
        const maxDiffChars = Math.floor(revContextWindow * 3 * 0.5);
        if (codeDiff.length > maxDiffChars) {
          // Write full diff to a temp file so the reviewer can read_file it
          const diffFile = path.join(workingDir, ".workermill-review-diff.tmp");
          try { fs.writeFileSync(diffFile, codeDiff, "utf-8"); } catch { /* best effort */ }
          const stat = codeDiff.match(/## Branch Diff.*?\n([\s\S]*?)\n\n/)?.[1] || "";
          codeDiff = codeDiff.slice(0, maxDiffChars) +
            `\n\n... (diff truncated to fit ${formatContext(revContextWindow)} context window)\n\n` +
            `**Full diff saved to:** \`${diffFile}\` — use \`read_file ${diffFile}\` to review the complete diff.\n\n` +
            `${stat ? `File list:\n${stat}` : ""}`;
        }

        const reviewerProjectInstructions = formatProjectInstructions(workingDir);
        const loopGuardSection = isRevision && repeatedBlockerCount >= 2
          ? `## Loop Guard

Recent review rounds repeated similar blockers. Re-verify the current code directly before blocking again.

- Do NOT insist on a specific file path change unless that path is truly required for behavior correctness
- If behavior already works, approve and mention optional follow-ups as non-blocking
- If you still require revision, provide concrete failure evidence and the exact minimal fix needed
`
          : "";
        const reviewPrompt = `${previousFeedbackSection}${reviewerProjectInstructions ? `${reviewerProjectInstructions}\n\n` : ""}## Implementation Plan — THIS IS WHAT THE WORKERS WERE TOLD TO DO

Review the code against this plan. The planner analyzed the codebase and gave each worker specific guidance.

${storyPlanDetails}

## Code Changes

The diff below shows what was changed. For new files, use your read_file tool to inspect them.

Files created: ${context.filesCreated.join(", ") || "none"}
Files modified: ${context.filesModified.join(", ") || "none"}
${context.decisions.length > 0 ? `\nDecisions made:\n${context.decisions.map(d => `- ${d}`).join("\n")}` : ""}

${codeDiff || "(no code changes detected)"}${gateResultsSection}

## Original Spec (reference)

The plan above was derived from this spec. Use it to check completeness, but the plan is the workers' source of truth.

${userTask}

## Review Instructions

Review the actual code above. You also have tools (read_file, glob, grep) to examine files in more detail if needed.
${loopGuardSection ? `\n${loopGuardSection}` : ""}

## Feedback Guidelines

- **Be specific**: Point to exact files and issues when providing feedback
- **Be constructive**: Suggest alternatives, not just problems
- **Be balanced**: Acknowledge what's done well alongside improvements
- **Be pragmatic**: Distinguish must-fix from nice-to-have issues
- **Be evidence-based**: For blocking issues, cite concrete evidence (failing behavior, broken path, missing code, or reproducible command)

### APPROVE when:
- Code correctly implements the requirements from the original spec
- No obvious bugs or security issues
- Code follows existing patterns in the codebase
- Minor cosmetic issues are NOT grounds for revision — mention them in feedback but still approve

### REVISION_NEEDED when:
- Code has functional bugs that affect correctness
- Security vulnerabilities that must be fixed
- Missing required functionality from the task spec
- Broken imports, missing dependencies, or code that won't run
- You can provide concrete evidence of the failure from the current code state

### REJECT when:
- Fundamental approach is wrong and cannot be fixed with revisions

**Quality gate stance**: Make decisions based on impact and evidence, not preference.
- Block only for functional correctness, security, or missing-required-functionality issues backed by concrete evidence.
- Do NOT block for style or cosmetic preferences.
- If uncertain, inspect files or run lightweight verification before blocking.

## Output Format

You MUST write your detailed feedback FIRST, THEN add the decision markers at the end.

**1. Write your full review** — analyze the code, list specific issues with file paths, explain what's good and what needs fixing. This is the most important part. Workers read this to know what to fix. Be thorough.

**2. Then add these markers at the end:**

REVIEW_DECISION: approved (or revision_needed or rejected)
CODE_QUALITY_SCORE: ${config.review?.approvalThreshold ?? 9}
FEEDBACK: One-line summary of your decision

For REVISION_NEEDED decisions, also include:
BLOCKING_EVIDENCE: concrete proof from this code state (repro step, failing command, or exact missing/wrong implementation)
ACTIONABLE_FIX: minimal specific change required to get approval

**Score guide (1-10):** 1-3 = fundamentally broken, 4-5 = major issues, 6 = functional but rough, 7 = solid with minor issues, ${config.review?.approvalThreshold ?? 9}+ = quality-gate pass. Use the score with your evidence: below ${config.review?.approvalThreshold ?? 9} means you found real blocking issues; ${config.review?.approvalThreshold ?? 9}+ means no blocking issues remain.

### For REVISION_NEEDED Decisions - Specify Affected Stories

There are exactly ${sorted.length} stories (numbered 1 to ${sorted.length}):
${sorted.map((s, i) => `  ${i + 1}. ${s.title} (${s.persona})`).join("\n")}

AFFECTED_STORIES MUST only contain numbers from 1 to ${sorted.length}. Do NOT invent story numbers that don't exist.

\`\`\`
AFFECTED_STORIES: [2, 3]
AFFECTED_REASONS: {"2": "reason for story 2", "3": "reason for story 3"}
\`\`\`

**Guidelines:**
- Only reference story numbers 1-${sorted.length} — these are the ONLY stories that exist
- Only include stories that have ACTUAL implementation issues in their code
- If ALL stories need revision, you may omit AFFECTED_STORIES (all will re-run)
- Be specific in AFFECTED_REASONS so developers know exactly what to fix
- Do NOT list issues as separate "stories" — map issues back to the story that should have handled them`;

        // Use onStepFinish for reviewer — same as WorkerMill ai-sdk-client.ts
        // TODO: Rate limit retry for reviewer streamText — add isRateLimitError check in catch block
        // Accumulate only the reviewer's NEW output (not the echoed prompt/previous feedback)
        let reviewerOutput = "";
        let reviewerFinalText = "";
        const reviewStartMs = Date.now();
        const reviewTimeoutMs = getReviewWallTimeoutMs();
        const maxReviewAttempts = 2;
        let reviewUsage: { inputTokens?: number; outputTokens?: number } | undefined;
        let lastReviewError: unknown;
        for (let attempt = 1; attempt <= maxReviewAttempts; attempt++) {
          const timedAbort = createTimedAbortSignal(abortSignal, reviewTimeoutMs, "Tech Lead review");
          try {
            const reviewStream = streamText({
              model: reviewModel,
              abortSignal: timedAbort.signal,
              system: reviewer.systemPrompt,
              prompt: reviewPrompt,
              tools: reviewerTools,
              stopWhen: stepCountIs(100),
              timeout: { chunkMs: 120_000 },
              ...buildOllamaOptions(revProvider as AIProvider, revCtx),
              ...buildReasoningOptions(revProvider, revModel),
              onStepFinish({ text }) {
                if (text) {
                  reviewerOutput += text + "\n";
                  const lines = text.split("\n").filter(l => l.trim());
                  for (const line of lines) {
                    if (line.includes("::review_score::") || line.includes("::review_verdict::") || line.includes("::code_quality_score::")) continue;
                    output.log("tech_lead", line);
                  }
                }
              },
            });
            const result = await collectReviewStreamResult(
              reviewStream,
              reviewTimeoutMs,
              timedAbort,
              "Tech Lead review",
            );
            reviewerFinalText = result.finalText;
            reviewUsage = result.usage;
            lastReviewError = undefined;
            break;
          } catch (err) {
            lastReviewError = err;
            const transient = isTransientError(err);
            const canRetry = attempt < maxReviewAttempts && (timedAbort.didTimeout() || transient);
            if (!canRetry) throw err;
            const retryReason = timedAbort.didTimeout() ? "timed out" : "hit a transient provider error";
            output.coordinatorLog(`Tech Lead review ${retryReason}; retrying once...`);
            logger.warn("Retrying tech lead review", {
              attempt,
              provider: revProvider,
              model: revModel,
              reason: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            });
          } finally {
            timedAbort.dispose();
          }
        }
        if (lastReviewError) throw lastReviewError;

        // Some providers/models put the decisive final answer in stream.text
        // rather than step chunks; prefer that when it is richer.
        const stepText = reviewerOutput.trim();
        const reviewText = reviewerFinalText.length > stepText.length
          ? reviewerFinalText
          : (stepText || reviewerFinalText);
        logger.debug("Reviewer output", { reviewRound, text: reviewText });

        output.statusDone();

        // Extract review decision — 3-tier system matching WorkerMill worker
        const parsedReview = parseRequiredReviewOutcome(reviewText);
        const decision = parsedReview.decision;
        const score = parsedReview.score;

        // Score must meet threshold — the model's decision marker alone is not enough.
        const threshold = config.review?.approvalThreshold ?? 9;
        const approved = score >= threshold;
        const parsedAffected = sanitizeAffectedStories(parseAffectedStories(reviewText), sorted.length);
        if (!approved) {
          const blockerSignature = buildReviewBlockerSignature(reviewText, parsedAffected);
          if (blockerSignature && blockerSignature === lastBlockerSignature) {
            repeatedBlockerCount += 1;
          } else {
            repeatedBlockerCount = 1;
            lastBlockerSignature = blockerSignature;
          }
        } else {
          repeatedBlockerCount = 0;
          lastBlockerSignature = "";
        }
        const stuckOnSameBlocker = !approved && repeatedBlockerCount >= 2;
        const revInputTokens = reviewUsage?.inputTokens || 0;
        const revOutputTokens = reviewUsage?.outputTokens || 0;
        // Track tok/s for reviewer model
        const reviewElapsed = (Date.now() - reviewStartMs) / 1000;
        if (revOutputTokens > 0 && reviewElapsed > 0) {
          const reviewTokPerSec = Math.round(revOutputTokens / reviewElapsed);
          output.updateTokPerSec?.(`${revProvider}/${revModel}`, reviewTokPerSec);
          logger.info("Model performance", { provider: revProvider, model: revModel, tokPerSec: reviewTokPerSec });
        }
        logger.info(`Review round ${reviewRound} result`, { decision, score, approved, reviewTextLength: reviewText.length, inputTokens: revInputTokens, outputTokens: revOutputTokens });

        const feedback = extractReviewFeedback(reviewText, decision);
        if (approved) {
          openMustFixItems = [];
        } else {
          const currentMustFixItems = _extractStructuredMustFixItems(reviewText, parsedAffected);
          openMustFixItems = _mergeMustFixItems(openMustFixItems, currentMustFixItems);
        }

        // Display review result with horizontal rules
        output.log("tech_lead", "\u2500".repeat(60));
        output.log("tech_lead", `::code_quality_score::${score}/10`);
        output.log("tech_lead", `::review_decision::${approved ? "approved" : decision === "rejected" ? "rejected" : "needs_revision"}`);
        output.log("tech_lead", "\u2500".repeat(60));
        if (feedback) {
          output.log("tech_lead", "Fix context:");
          for (const line of feedback.split("\n").map((l) => l.trim()).filter(Boolean)) {
            output.log("tech_lead", line);
          }
        }
        output.coordinatorLog(approved ? `Review approved (${score}/10)` : `Review needs revision (${score}/10)`);
        if (stuckOnSameBlocker) {
          output.coordinatorLog(`Loop guard: reviewer repeated the same blockers for ${repeatedBlockerCount} rounds.`);
        }

        // Post review result to ticket — matches worker/epic/coordinator-review.ts
        if (ticketOps) {
          if (approved) {
            const roundLabel = reviewRound > 1 ? ` after ${reviewRound - 1} revision${reviewRound > 2 ? "s" : ""}` : "";
            ticketOps.postComment(
              `## ✅ Tech Lead Review — Approved${roundLabel} (${score}/10)\n\n${feedback}`
            ).catch(() => {});
          } else {
            ticketOps.postComment(
              `## 🔄 Tech Lead Review — Revision ${reviewRound}/${maxRevisions} (${score}/10)\n\n${feedback}`
            ).catch(() => {});
          }
        }

        // Save feedback for next review round — so tech_lead can check if issues were addressed
        previousReviewFeedback = reviewText;

        // Track reviewer cost
        costTracker.addUsage(`Reviewer (round ${reviewRound})`, revProvider, revModel,
          revInputTokens, revOutputTokens);
        output.updateCost?.(costTracker.getTotalCost());
        output.updateUsageSummary?.(costTracker.getUsageSummary());

        // If approved or out of revision attempts, done
        if (approved) {
          finalReviewText = reviewText;
          runLifecycleHooks("review_complete", config.hooks, workingDir, {
            WORKERMILL_REVIEW_SCORE: String(score),
            WORKERMILL_REVIEW_DECISION: "approved",
          });
          break;
        }
        const revisionsLeft = maxRevisions - (reviewRound - 1);
        if (revisionsLeft <= 0) {
          emitFailureCode(output, "review_blocker_unresolved", `Tech Lead review is still blocking after ${maxRevisions} revision attempt(s).`);
          output.coordinatorLog(`Max revisions (${maxRevisions}) reached, proceeding to commit.`);
          break;
        }

        // Ask user or auto-revise
        let shouldRevise = autoRevise;
        if (autoRevise && stuckOnSameBlocker) {
          output.coordinatorLog("Loop guard: pausing auto-revise because reviewer feedback repeated without new signal.");
          shouldRevise = false;
        }
        if (!autoRevise) {
          try {
            const rv = await output.confirm(`Revise and re-review? (${revisionsLeft} left)`);
            if (typeof rv === "object") {
              shouldRevise = rv.allowed;
              if (rv.mode === "always") {
                // Switch to auto-revise for remaining rounds
                autoRevise = true;
                output.coordinatorLog("Auto-revise enabled for remaining rounds.");
                // Persist globally so future /build runs behave consistently.
                // Users can revert with: /settings review.autoRevise false
                try {
                  const globalCfg = loadConfig();
                  if (globalCfg) {
                    globalCfg.review = { ...globalCfg.review, autoRevise: true };
                    saveConfig(globalCfg);
                    output.coordinatorLog("Saved globally: /settings review.autoRevise true");
                  }
                } catch (persistErr) {
                  logger.warn("Failed to persist review.autoRevise", {
                    error: persistErr instanceof Error ? persistErr.message : String(persistErr),
                  });
                }
              }
            } else {
              shouldRevise = rv;
            }
          } catch (err) {
            logger.debug("Revision prompt cancelled", { error: err instanceof Error ? err.message : String(err) });
            shouldRevise = false; // cancelled
          }
        } else {
          output.coordinatorLog(`Auto-revising (${revisionsLeft} left)...`);
        }

        if (!shouldRevise) {
          emitFailureCode(output, "review_blocker_unresolved", "Tech Lead review still has blocking issues and revision was declined.");
          break;
        }

        // Parse which stories need revision — send feedback back to the original workers
        // (selective revision from inline-reviewer.ts)
        const affected = parsedAffected;
        const affectedSet = affected && affected.stories.length > 0 ? new Set(affected.stories) : null;

        if (affected && affected.stories.length > 0) {
          const selectiveInfo = `stories ${affected.stories.join(", ")}`;
          output.coordinatorLog(`Selective revision: ${selectiveInfo}`);
          if (Object.keys(affected.reasons).length > 0) {
            for (const [idx, reason] of Object.entries(affected.reasons)) {
              output.coordinatorLog(`  Story ${idx}: ${reason}`);
            }
          }
        } else {
          output.coordinatorLog("Full revision (all stories)");
        }

        output.log("system", "--- Revision Pass ---");

        // Capture HEAD before revision — so next review shows only what changed
        if (featureBranch) {
          preRevisionHash = getHeadHash(workingDir);
        }

        for (let i = 0; i < sorted.length; i++) {
          if (await waitWhilePaused()) {
            return { stories: sorted, completedStoryIds, featureBranch, userTask };
          }
          const story = sorted[i];

          // Skip stories not affected by the review (selective revision)
          if (affectedSet && !affectedSet.has(i + 1)) {
            output.coordinatorLog(`Skipping story ${i + 1}/${sorted.length} — not affected`);
            continue;
          }

          const storyPersona = loadPersona(story.persona);
          if (!storyPersona) continue;

          const { provider: sProvider, model: sModel, apiKey: sApiKey, host: sHost, contextLength: sCtx } = getProviderForPersona(
            config, storyPersona.provider || story.persona
          );
          if (sProvider && sApiKey) {
              const envMap: Record<string, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_GENERATIVE_AI_API_KEY" };
              const envVar = envMap[sProvider];
              if (envVar && !process.env[envVar]) {
                const key = sApiKey.startsWith("{env:") ? process.env[sApiKey.slice(5, -1)] : sApiKey;
                if (key) process.env[envVar] = key;
              }
          }

          // Build per-story feedback: use AFFECTED_REASONS if available, otherwise full review text
          const storyReason = affected?.reasons?.[i + 1];
          const storyMustFixItems = openMustFixItems.filter((item) => item.storyNumber === undefined || item.storyNumber === i + 1);
          const fallbackReviewFeedback = truncateForPrompt(reviewText, 6_000, "review feedback");
          const storyFeedback = storyReason
            ? `Story ${i + 1} (${story.title}):\n${storyReason}`
            : fallbackReviewFeedback;
          const loopGuardReminder = stuckOnSameBlocker
            ? `

## Loop Guard
The reviewer has repeated similar blockers across rounds. Before changing code, verify whether the claimed gap is truly still present.
- If behavior already works, prefer minimal clarifying changes (focused tests or explicit handling) instead of broad rewrites
- If behavior is broken, fix only the smallest change needed and keep scope tight
`
            : "";

          output.coordinatorLog(`Revising story ${i + 1} of ${sorted.length}: ${story.title}`);
          logger.info(`Revision started`, { story: i + 1, persona: story.persona, title: story.title, hasSpecificFeedback: !!storyReason });
          output.log(story.persona, `Starting revision: ${story.title} (\x1b[38;5;208m${sProvider}/${sModel}\x1b[0m, ${formatContext(getModelContext(sModel, sCtx))} context)`);

          output.status(`${story.persona}: revising...`);

          const storyModel = createModel(sProvider as AIProvider, sModel, sHost, sCtx, sApiKey);
          const storyAllTools = createToolDefinitions(workingDir, storyModel, sandboxed);
          const storyTools: Record<string, AnyToolDef> = {};
          for (const toolName of storyPersona.tools) {
            const toolDef = storyAllTools[toolName as keyof typeof storyAllTools] as AnyToolDef;
            if (toolDef) {
              storyTools[toolName] = {
                ...toolDef,
                execute: async (input: Record<string, unknown>) => {
                  const allowed = await _checkToolPermission(toolName, input, trustAll, sessionAllow, output, config.permissions);
                  if (!allowed) return "Tool execution denied by user.";
                  output.toolCall(story.persona, toolName, input);
                  const revHookResult = runPreHooksWithBlocking(toolName, config.hooks, workingDir, { input: JSON.stringify(input).substring(0, 10000) });
                  if (revHookResult.blocked) {
                    return `Tool blocked by pre-hook: ${revHookResult.reason}`;
                  }
                  output.status(`${story.persona}: working...`);
                  const result = await toolDef.execute(input);
                  runHooks("post", toolName, config.hooks, workingDir);
                  output.status("");
                  return result;
                },
              };
            }
          }

          // Apply concurrency control to revision tools — same as story execution
          for (const [name, td] of Object.entries(storyTools)) {
            if (td && typeof td.execute === "function") {
              const original = td.execute;
              (storyTools as any)[name] = { ...td, execute: withConcurrencyControl(name, original as any) };
            }
          }

          // Revision prompt follows WorkerMill platform pattern (prompt-builder.ts):
          // Per-story feedback + what was tried before + efficiency tips + scope enforcement.
          // The worker gets enough context to fix its own mistakes without re-implementing.

          // Capture per-story prior work from git history — matches worker/epic/git-ops.ts:captureStoryBranchSummaries()
          const whatYouDidLastTime = featureBranch
            ? captureStoryPriorWork(workingDir, mainBranch, i + 1)
            : "";

          const revisionSystemPrompt = `${storyPersona.systemPrompt}

Working directory: ${workingDir}`;

          try {
            // TODO: Rate limit retry for revision streamText — add isRateLimitError check in catch block
            const revisionStartMs = Date.now();
            const revisionReasoningLength = { value: 0 };
            const revStream = streamText({
              model: storyModel,
              abortSignal,
              system: revisionSystemPrompt,
              prompt: `## ⚠️ REVISION REQUIRED — Tech Lead Feedback

### Your Story's Required Fix
${storyFeedback}
${loopGuardReminder}
${storyMustFixItems.length > 0 ? `## Structured Must-Fix Items\n${formatMustFixItems(storyMustFixItems)}\n\n` : ""}${whatYouDidLastTime}
## Your Story Scope
Story ${i + 1}: "${story.title}" — ${story.description}
${story.targetFiles?.length ? `**Target files:** ${story.targetFiles.join(", ")}` : ""}
${story.primaryPattern ? `\n**Primary pattern file:** ${story.primaryPattern}` : ""}
${story.integrationPoints?.length ? `\n**Integration points:** ${story.integrationPoints.join(", ")}` : ""}
${story.nonGoals?.length ? `\n**Non-goals:** ${story.nonGoals.join(", ")}` : ""}
${story.validationSignal ? `\n**Validation signal:** ${story.validationSignal}` : ""}
${story.implementationNotes ? `\n## Architect's Guidance\n${story.implementationNotes}` : ""}

**IMPORTANT: Only fix issues that are YOUR story's responsibility.**
- Fix the specific issues listed above
- Do NOT fix issues in files that belong to other stories
- Do NOT rewrite files from scratch — use edit_file for targeted changes
- READ each file BEFORE editing it

**EFFICIENCY TIP: Go straight to the files mentioned in the feedback.**
- You already built this code in the previous attempt
- Skip re-reading files unless they're directly relevant to the feedback
- Focus on the specific issues, not re-implementation

**Communication:** Think out loud with short progress updates. Before major tool calls, state intent; after tool calls, state what changed and next step.`,
              tools: storyTools as ToolSet,
              stopWhen: stepCountIs(100),
              timeout: { chunkMs: 120_000 },
              ...buildReasoningOptions(sProvider, sModel),
              ...buildOllamaOptions(sProvider as AIProvider, sCtx),
              onStepFinish({ text, toolCalls, reasoningText }) {
                emitReasoningDelta((line) => output.log(story.persona, line), reasoningText, revisionReasoningLength);
                if (toolCalls && toolCalls.length > 0) {
                  for (const tc of toolCalls) {
                    const filePath = extractToolFilePath(tc.toolName, tc.input as Record<string, unknown>);
                    if (!filePath) continue;
                    if (tc.toolName === "write_file") {
                      if (liveViewServer) liveViewServer.emitFileChange(story.persona, i + 1, story.title, filePath, "created");
                    } else if (tc.toolName === "edit_file" || tc.toolName === "multi_edit_file" || tc.toolName === "patch") {
                      if (liveViewServer) liveViewServer.emitFileChange(story.persona, i + 1, story.title, filePath, "edited");
                    }
                  }
                }
                if ((!text || !text.trim()) && toolCalls && toolCalls.length > 0) {
                  const first = toolCalls[0];
                  const detail = formatToolCallDisplay(first.toolName, first.input as Record<string, unknown>);
                  output.log(story.persona, `${first.toolName}${detail ? ` ${detail}` : ""}`);
                }
                if (text) {
                  const lines = text.split("\n").filter(l => l.trim());
                  for (const line of lines) {
                    if (line.includes("::")) continue;
                    output.log(story.persona, line);
                  }
                }
                output.status(`${story.persona}: working...`);
              },
            });

            for await (const _chunk of revStream.textStream) { /* drive */ }
            const revUsage = await revStream.totalUsage;

            costTracker.addUsage(`${storyPersona.name} (revision)`, sProvider, sModel,
              revUsage?.inputTokens || 0, revUsage?.outputTokens || 0);
            output.updateCost?.(costTracker.getTotalCost());
            output.updateUsageSummary?.(costTracker.getUsageSummary());

            // Track tok/s for revision worker model
            const revisionElapsed = (Date.now() - revisionStartMs) / 1000;
            const revisionOutTokens = revUsage?.outputTokens || 0;
            if (revisionOutTokens > 0 && revisionElapsed > 0) {
              const revisionTokPerSec = Math.round(revisionOutTokens / revisionElapsed);
              output.updateTokPerSec?.(`${sProvider}/${sModel}`, revisionTokPerSec);
              logger.info("Model performance", { provider: sProvider, model: sModel, tokPerSec: revisionTokPerSec });
            }

            logger.info(`Revision completed`, { story: i + 1, persona: story.persona, inputTokens: revUsage?.inputTokens || 0, outputTokens: revUsage?.outputTokens || 0 });
            output.log(story.persona, `${story.title} — revision complete!`);
          } catch (err) {
            output.statusDone();
            if (isBalanceOrQuotaError(err)) {
              const shouldStop = await pauseForBalanceIssue(`Revision story ${i + 1}`);
              if (shouldStop) {
                return { stories: sorted, completedStoryIds, featureBranch, userTask };
              }
              continue;
            }
            const revRl = isRateLimitError(err);
            if (revRl) {
              const waitSec = Math.ceil(revRl.retryAfterMs / 1000);
              output.log("system", `Revision rate limited — retrying in ${waitSec}s`);
              logger.info("Revision rate limit retry", { story: i + 1, waitSec });
              await rateLimitSleep(revRl.retryAfterMs);
              // Fall through to next review loop iteration which will re-attempt
            } else {
              const errMsg = err instanceof Error ? err.message : String(err);
              logger.error(`Revision failed`, { story: i + 1, persona: story.persona, error: errMsg });
              output.log("system", `Revision failed for story ${i + 1}: ${errMsg}`);
            }
          }

          // Commit revision changes — checkpoint on the feature branch
          if (featureBranch) {
            const hash = commitRevisionChanges(workingDir, i + 1, story.title, story.persona, reviewRound);
            if (hash) output.coordinatorLog(`Committed revision ${reviewRound} for story ${i + 1}: ${hash}`);
          }
        }
        // Loop back to review again
      } catch (err) {
        output.statusDone();
        if (isBalanceOrQuotaError(err)) {
          const shouldStop = await pauseForBalanceIssue("Tech Lead review");
          if (shouldStop) {
            return { stories: sorted, completedStoryIds, featureBranch, userTask };
          }
          continue;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error("Review failed", {
          error: errMsg,
          stack: err instanceof Error ? err.stack : undefined,
          provider: revProvider,
          model: revModel,
          reviewRound,
        });
        output.log("system", `Review skipped: ${errMsg}`);
        break;
      }
    } // end review loop
  }

  // --- Completion Summary ---
  try {
    if (featureBranch) {
      // Show branch summary
      const commitCount = execSync(`git rev-list --count ${mainBranch}..HEAD 2>/dev/null || echo 0`, { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();

      output.log("system", `Branch: ${featureBranch} (${commitCount} commits)`);

      // Commit any remaining uncommitted changes
      try {
        execSync("git add .", { cwd: workingDir, stdio: "pipe" });
        const status = execSync("git status --porcelain", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
        if (status) {
          execSync('git commit --no-verify -m "chore: uncommitted changes from /build session"', { cwd: workingDir, stdio: "pipe" });
        }
      } catch { /* nothing to commit */ }

      // Check if remote exists for PR
      let hasRemote = false;
      try {
        const remote = execSync("git remote get-url origin 2>/dev/null", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
        hasRemote = !!remote;
      } catch { /* no remote */ }

      if (hasRemote) {
        output.log("system", `To review the full diff first, say no and run: \`!git diff ${mainBranch}..HEAD\``);
        const cr = await output.confirm("Push branch and open a pull request?");
        const confirmed = typeof cr === "object" ? cr.allowed : cr;
        logger.info("PR prompt answered", { confirmed, featureBranch, mainBranch });
        if (confirmed) {
          try {
            output.status("Pushing branch...");
            let pushOutput = "";
            try {
              pushOutput = execSync(`git push -u origin ${shellArg(featureBranch)} 2>&1`, {
                cwd: workingDir,
                encoding: "utf-8",
                stdio: "pipe",
              }).trim();
            } catch (pushErr) {
              const msg = String(pushErr);
              const isDiverged = msg.includes("non-fast-forward") || msg.includes("Updates were rejected");
              if (isDiverged) {
                output.statusDone();
                output.log("system", `Push failed — remote branch \`${featureBranch}\` has divergent history from a previous run.`);
                const force = await output.confirm("Force-push with --force-with-lease? (safe if you reset the branch yourself)");
                const confirmed = typeof force === "object" ? force.allowed : force;
                if (confirmed) {
                  try {
                    pushOutput = execSync(`git push --force-with-lease -u origin ${shellArg(featureBranch)} 2>&1`, {
                      cwd: workingDir,
                      encoding: "utf-8",
                      stdio: "pipe",
                    }).trim();
                    output.statusDone();
                  } catch (forceErr) {
                    output.statusDone();
                    output.log("system", `Force-push also failed: ${String(forceErr)}`);
                    output.log("system", `Push manually: \`git push --force-with-lease -u origin ${featureBranch}\``);
                    return { stories: sorted, completedStoryIds, featureBranch, userTask };
                  }
                } else {
                  output.statusDone();
                  output.log("system", `Branch is local. Push manually: \`git push --force-with-lease -u origin ${featureBranch}\``);
                  return { stories: sorted, completedStoryIds, featureBranch, userTask };
                }
              } else {
                throw pushErr;
              }
            }
            logger.info("Branch push completed", {
              featureBranch,
              output: clipLogText(pushOutput),
            });
            output.statusDone();

            // Try to create PR with gh CLI
            try {
              const storyTitles = sorted.map(s => s.title).join(", ");
              const prTitle = storyTitles.length > 70 ? storyTitles.slice(0, 67) + "..." : storyTitles;
              logger.info("Creating pull request", { featureBranch, mainBranch, prTitle });

              // Build PR body: task overview + stories + tech lead review
              const prParts: string[] = [];
              prParts.push("## Task\n");
              prParts.push(userTask);
              prParts.push("\n## Stories\n");
              prParts.push(sorted.map((s, i) => `- **Story ${i + 1}** (${s.persona}): ${s.title}`).join("\n"));
              if (finalReviewText) {
                // Extract just the FEEDBACK section from the review, not the markers
                const feedbackMatch = finalReviewText.match(/FEEDBACK:\s*([\s\S]*?)(?=AFFECTED_|REVIEW_DECISION|CODE_QUALITY|$)/i);
                const feedback = feedbackMatch ? feedbackMatch[1].trim() : finalReviewText.split("\n").filter((l: string) => !l.includes("REVIEW_DECISION") && !l.includes("CODE_QUALITY_SCORE") && !l.includes("AFFECTED_")).join("\n").trim();
                if (feedback) {
                  prParts.push("\n## Tech Lead Review\n");
                  prParts.push(feedback);
                }
              }
              // Link PR to source issue in body so GitHub can auto-close on merge.
              if (ticketKey && resolvedTicketSystem === "github") {
                const issueNum = extractGithubIssueNumber(ticketKey);
                prParts.push(`\nCloses #${issueNum}`);
              }
              prParts.push("\n---\nShipped by [WorkerMill CLI](https://workermill.com)");
              const prBody = prParts.join("\n");
              const prUrl = execGh(
                ["pr", "create", "--title", prTitle, "--body-file", "-", "--head", featureBranch, "--base", mainBranch],
                { cwd: workingDir, input: prBody },
              );
              logger.info("Pull request created", { prUrl, featureBranch, mainBranch });
              output.log("system", `Pull request created: ${prUrl}`);

              // Close source ticket for non-GitHub trackers. GitHub issues should
              // close on merge via PR keywords (e.g. "Closes #123"), not on PR open.
              if (ticketOps && shouldTransitionTicketOnPrOpen(resolvedTicketSystem)) {
                try {
                  await ticketOps.transitionTo("done");
                  output.log("system", `Closed ${ticketKey}`);
                } catch {
                  // Non-critical — don't block on ticket system errors
                }
              }

              // Post the tech lead review as a proper GitHub PR review
              // Matches worker/epic/coordinator-review.ts ensureGitHubReviewPosted()
              if (finalReviewText) {
                try {
                  const parsedPrReview = parseRequiredReviewOutcome(finalReviewText);
                  const reviewScore = parsedPrReview.score;
                  const feedback = extractReviewFeedback(finalReviewText, parsedPrReview.decision);
                  const emoji = reviewScore >= (config.review?.approvalThreshold ?? 9) ? "✅" : "🔄";
                  const reviewBody = `## ${emoji} Tech Lead Review\n\n**Code Quality Score:** ${reviewScore}/10\n\n${feedback}`;
                  const reviewFlag = reviewScore >= (config.review?.approvalThreshold ?? 9) ? "--approve" : "--request-changes";
                  execSync(
                    `gh pr review --body-file - ${reviewFlag} 2>&1`,
                    { cwd: workingDir, encoding: "utf-8", input: reviewBody, stdio: ["pipe", "pipe", "pipe"], timeout: 15_000 },
                  );
                } catch (reviewCommentErr) {
                  logger.warn("Failed to post structured PR review comment", {
                    error: reviewCommentErr instanceof Error ? reviewCommentErr.message : String(reviewCommentErr),
                  });
                  // Non-critical — review comment is best-effort
                }
              }
            } catch (prErr) {
              const prDetail = extractExecErrorDetail(prErr);
              logger.error("Pull request creation failed", {
                featureBranch,
                mainBranch,
                summary: prDetail.summary,
                stdout: clipLogText(prDetail.stdout),
                stderr: clipLogText(prDetail.stderr),
              });
              output.log("system", `Branch pushed. Create a PR manually (gh CLI error: ${prDetail.summary})`);
            }
          } catch (pushErr) {
            output.statusDone();
            const pushDetail = extractExecErrorDetail(pushErr);
            logger.error("Branch push failed", {
              featureBranch,
              summary: pushDetail.summary,
              stdout: clipLogText(pushDetail.stdout),
              stderr: clipLogText(pushDetail.stderr),
            });
            output.log("system", `Push failed: ${pushDetail.summary}`);
            output.log("system", `Branch is local: \`${featureBranch}\`. Push manually with: git push -u origin ${featureBranch}`);
          }
        } else {
          logger.info("PR prompt declined", { featureBranch, mainBranch });
          output.log("system", `Branch is local: \`${featureBranch}\``);
          output.log("system", `To push later: git push -u origin ${featureBranch}`);
          output.log("system", `To create a PR: gh pr create --head ${featureBranch}`);
        }
      } else {
        output.log("system", `No remote configured. Branch: \`${featureBranch}\``);
      }
    } else {
      // No feature branch — old behavior, commit uncommitted changes
      const diff = execSync("git diff --stat 2>/dev/null || true", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
      const untracked = execSync("git ls-files --others --exclude-standard 2>/dev/null || true", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
      if (diff || untracked) {
        output.coordinatorLog(`${diff ? diff.split("\n").length : 0} modified, ${untracked ? untracked.split("\n").filter(Boolean).length : 0} new files`);
      }
    }
  } catch (err) {
    logger.debug("Completion summary failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // Final cost update
  output.updateCost?.(costTracker.getTotalCost());
  output.updateUsageSummary?.(costTracker.getUsageSummary());

  // On full success: clear retry state. Stay on the feature branch so the
  // developer can review, test, and push when ready.
  if (featureBranch && completedStoryIds.length === sorted.length) {
    clearShipRun(featureBranch);
  }

  runLifecycleHooks("ship_complete", config.hooks, workingDir, {
    WORKERMILL_COST: costTracker.getTotalCost().toFixed(4),
  });

  // Post final completion to ticket — matches worker/epic/coordinator-review.ts
  if (ticketOps) {
    try {
      const { GitHubCommentFormat } = await import("./ticket-ops.js");
      const completedCount = sorted.filter((s) => completedStoryIds.includes(s.id)).length;
      const storyList = sorted.map((s, i) => {
        const done = completedStoryIds.includes(s.id);
        return `${done ? "✅" : "❌"} **Story ${i + 1}** (${s.persona}): ${s.title}`;
      }).join("\n");
      const summary = `${completedCount}/${sorted.length} stories completed.\n\n${storyList}`;
      // prUrl is captured earlier if PR was created
      await ticketOps.postComment(GitHubCommentFormat.completed(summary));
    } catch {
      // Soft failure — don't crash on post-back errors
    }
  }

  // Clean up temp review diff file
  try { fs.unlinkSync(path.join(workingDir, ".workermill-review-diff.tmp")); } catch { /* may not exist */ }

  // Emit run complete event
  if (liveViewServer) {
    const commitCount = featureBranch ? parseInt(execSync(`git rev-list --count ${mainBranch}..HEAD 2>/dev/null || echo 0`, { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim()) : 0;
    liveViewServer.emitRunComplete(featureBranch || "main", commitCount);
  }

  // Stop MCP servers and language server
  stopAllMCPServers();
  const { shutdown: shutdownLSP } = await import("./engine/tools/lsp.js");
  shutdownLSP();

  // Keep live view server alive for the current CLI session so users can
  // keep the same browser tab open across multiple /build runs.

  return { stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch };
}
