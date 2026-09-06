import { ensureOllamaContext, ensureLmStudioContext } from "./engine/model-factory.js";
import path from "path";
import * as logger from "./logger.js";
import { CostTracker } from "./cost-tracker.js";
import type { CliConfig } from "./config.js";
import { getProviderForPersona, loadConfig, saveConfig } from "./config.js";
import { runLifecycleHooks } from "./hooks.js";
import { loadMemories } from "./memory.js";
import { saveShipRun, clearShipRun } from "./ship-state.js";
import { createMCPRunResources, autoDetectMCPServersForRun } from "./mcp-client.js";
import { createAttemptResources, ResourceCleanupError } from "./engine/run-resources.js";
import { resolveAutomaticSandboxUpgrade, resolveSandboxMode } from "./sandbox-mode.js";
import { createRunManifest, saveRunManifest, type TerminalReason, type RunManifestStoryAttempt } from "./run-manifest.js";
import { isLocalProvider, providerNeedsContextOverride } from "./provider-capabilities.js";
import { runProcess } from "./engine/process-runner.js";
import { runScopedProcess } from "./engine/scoped-process.js";
import { createPathScope } from "./engine/path-policy.js";
import { preflightReviewIdentity } from "./review-identity.js";
import { ticketEnvironment } from "./ticket-ops.js";

// ── Re-exports from sub-modules ──
// Types
export type { OrchestrationOutput, Story, OrchestrationResult, RetryPlan, StandaloneReviewResult } from "./orchestrator/types.js";

// Functions — public API
export { checkToolPermission } from "./orchestrator/execution.js";
export { runSpecCheck, runPlanCritic, classifyComplexity, applyQaParticipation } from "./orchestrator/planning.js";
export { getStoryDefinitionOfDone, validateStoryContractArtifacts } from "./orchestrator/execution.js";
export { extractStructuredMustFixItems, mergeMustFixItems, validateTechLeadReviewOutput, runStandaloneReview, runReviewLoop } from "./orchestrator/review.js";
export type { ReviewLoopResult, ReviewLoopParams } from "./orchestrator/review.js";

// ── Imports from sub-modules (used internally by runOrchestration) ──
import type { OrchestrationOutput, Story, OrchestrationResult, RetryPlan, SharedContext } from "./orchestrator/types.js";
import {
  resolveTaskInput,
  isAbortSignalLike, isAbortControllerLike,
} from "./orchestrator/utils.js";
import { planStories, topologicalSort, runSpecCheck as _runSpecCheck, runPlanCritic as _runPlanCritic, applyQaParticipation as _applyQaParticipation } from "./orchestrator/planning.js";
import { executeStories, type StoryAttemptEvent } from "./orchestrator/execution.js";
import { runReviewLoop as _runReviewLoop, type RevisionAttemptEvent, type ReviewRoundEvent } from "./orchestrator/review.js";
import { runQualityGates } from "./orchestrator/gates.js";
import { runCompletion } from "./orchestrator/completion.js";
import { prepareCandidate } from "./orchestrator/candidate.js";
import { captureRepositoryFingerprint } from "./repository-fingerprint.js";

// Re-export from completion module for backward compatibility
export { shouldTransitionTicketOnPrOpen } from "./orchestrator/completion.js";

function quoteStartupArgument(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function deriveStartupBranch(label: string, prefix: string | undefined, workingDir: string): string | null {
  const slug = label
    .replace(/\.md$/i, "")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join("-")
    .toLowerCase()
    .replace(/-+/g, "-");
  return slug ? `${prefix ?? path.basename(workingDir)}/${slug}` : null;
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

  // Create run manifest — persisted throughout for debugging and analytics
  const manifest = createRunManifest(userTask, ticketKey);

  const suppliedAbortController = isAbortControllerLike(abortControllerOrSignal)
    ? abortControllerOrSignal
    : undefined;
  const suppliedAbortSignal = isAbortControllerLike(abortControllerOrSignal)
    ? abortControllerOrSignal.signal
    : isAbortSignalLike(abortControllerOrSignal)
      ? abortControllerOrSignal
      : undefined;
  // Every orchestration owns a controller, including signal-only callers.
  // This gives finalization one cancellation boundary without ever stopping a
  // concurrently running orchestration.
  const abortController = new AbortController();
  const abortSignal = abortController.signal;
  const forwardAbort = () => abortController.abort(suppliedAbortSignal?.reason);
  if (suppliedAbortSignal && suppliedAbortSignal !== abortSignal) {
    if (suppliedAbortSignal.aborted) forwardAbort();
    else suppliedAbortSignal.addEventListener("abort", forwardAbort, { once: true });
  }

  if (abortControllerOrSignal != null && !suppliedAbortController && !suppliedAbortSignal) {
    logger.warn("Ignoring invalid abort argument passed to runOrchestration", {
      type: typeof abortControllerOrSignal,
    });
  }

  const workingDir = process.cwd();
  const costTracker = new CostTracker();
  const completedStoryIds: string[] = [...(retryPlan?.completedStoryIds ?? [])];
  let featureBranch: string | null = retryPlan?.featureBranch ?? null;
  let mainBranch = retryPlan?.mainBranch ?? "main";
  let sorted: Story[] = retryPlan?.stories ?? [];
  let failedStories = new Set<string>();
  let terminalReason: TerminalReason = "provider_failed";
  manifest.priorRunId = retryPlan?.priorRunId;
  let returnedResult: OrchestrationResult | undefined;
  const returning = (result: OrchestrationResult): OrchestrationResult => {
    returnedResult = result;
    return result;
  };
  const attempts = new Map<string, RunManifestStoryAttempt>();
  const persistProgress = (): void => {
    manifest.featureBranch = featureBranch;
    manifest.mainBranch = mainBranch;
    manifest.plannedStories = sorted.map(({ id, title, persona }) => ({ id, title, persona }));
    manifest.stories = sorted.map((story) => {
      const actual = manifest.attempts.filter((attempt) => attempt.storyId === story.id);
      const last = actual.at(-1);
      return {
        id: story.id, title: story.title, persona: story.persona,
        provider: last?.provider, model: last?.model,
        status: completedStoryIds.includes(story.id) ? "completed"
          : failedStories.has(story.id) || last?.status === "failed" || last?.status === "cancelled" ? "failed" : "skipped",
        retryCount: Math.max(0, actual.length - 1), failureCode: last?.failureCode,
      };
    });
    manifest.totalCost = costTracker.getTotalCost();
    if (typeof costTracker.getUsageSummary === "function") {
      const usage = costTracker.getUsageSummary();
      manifest.totalInputTokens = usage.total.inputTokens;
      manifest.totalOutputTokens = usage.total.outputTokens;
    }
    saveRunManifest(manifest, workingDir);
  };
  const onAttempt = (event: StoryAttemptEvent | RevisionAttemptEvent): void => {
    if (event.status === "started") {
      const attempt: RunManifestStoryAttempt = {
        storyId: event.storyId,
        attempt: manifest.attempts.filter((item) => item.storyId === event.storyId).length + 1,
        role: event.role, provider: event.provider, model: event.model,
        status: "started", startedAt: event.at,
      };
      attempts.set(event.attemptId, attempt);
      manifest.attempts.push(attempt);
    } else {
      const attempt = attempts.get(event.attemptId);
      if (!attempt) throw new Error("Run evidence received a terminal attempt without a start");
      attempt.status = event.status;
      // Wall clocks can move backwards; preserve the record's chronology.
      attempt.completedAt = new Date(Math.max(Date.parse(event.at), Date.parse(attempt.startedAt))).toISOString();
      if ("failureCode" in event) attempt.failureCode = event.failureCode;
    }
    persistProgress();
  };
  const onReviewRound = (event: ReviewRoundEvent): void => {
    if (event.outcome) manifest.reviews.push({
      round: event.round, provider: event.provider, model: event.model,
      outcome: event.outcome, score: event.outcome.score, decision: event.outcome.decision,
      inputTokens: event.inputTokens, outputTokens: event.outputTokens,
    });
    persistProgress();
  };
  let mcpResources: ReturnType<typeof createMCPRunResources> | undefined;
  const resourceController = new AbortController();
  const resourceSignal = AbortSignal.any([abortSignal, resourceController.signal]);
  const resources = createAttemptResources(manifest.id, () => resourceController.abort(), [() => mcpResources?.close()]);
  const cleanupRunResources = async (): Promise<void> => {
    try { await resources.close(); }
    catch (error) {
      terminalReason = "cleanup_failed";
      output.error(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
  const startupProcess = async (
    executable: "git" | "gh",
    processArgs: string[],
    timeoutMs = 10_000,
    maxOutputBytes = 1024 * 1024,
  ): Promise<string> => {
    resourceSignal.throwIfAborted();
    const result = await runProcess({
      runId: manifest.id,
      command: [executable, ...processArgs].map(quoteStartupArgument).join(" "),
      cwd: workingDir,
      signal: resourceSignal,
      timeoutMs,
      maxOutputBytes,
      terminationGraceMs: 1_000,
    });
    resourceSignal.throwIfAborted();
    if (result.reason !== "exited" || result.exitCode !== 0 || result.outputTruncated) {
      // In particular, never include gh credential output in diagnostics.
      throw Object.assign(new Error(`${executable} startup command failed (${result.reason}, exit ${result.exitCode})`), {
        exitCode: result.exitCode, processReason: result.reason,
      });
    }
    return result.stdout.trim();
  };
  let startupScope: ReturnType<typeof createPathScope> | undefined;
  const startupMutation = async (processArgs: string[]): Promise<string> => {
    resourceSignal.throwIfAborted();
    const scope = startupScope ??= createPathScope(workingDir, config.sandboxCapabilities?.extraPathGrants ?? []);
    const result = await runScopedProcess({
      runId: manifest.id,
      command: ["git", ...processArgs].map(quoteStartupArgument).join(" "),
      cwd: scope.workspace,
      signal: resourceSignal,
      timeoutMs: 30_000,
      maxOutputBytes: 1024 * 1024,
      terminationGraceMs: 1_000,
    }, {
      sandbox: sandboxed,
      scope,
      capabilities: config.sandboxCapabilities,
    });
    resourceSignal.throwIfAborted();
    if (result.reason !== "exited" || result.exitCode !== 0 || result.outputTruncated) {
      throw new Error(`git startup mutation failed (${result.reason}, exit ${result.exitCode})`);
    }
    return result.stdout.trim();
  };
  const branchExists = async (branch: string): Promise<boolean> => {
    await startupProcess("git", ["check-ref-format", `refs/heads/${branch}`]);
    try {
      await startupProcess("git", ["-c", "core.fsmonitor=false", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
      return true;
    } catch (error) {
      resourceSignal.throwIfAborted();
      if (error && typeof error === "object" && "exitCode" in error && error.exitCode === 1
        && "processReason" in error && error.processReason === "exited") return false;
      throw error;
    }
  };

  try {
  persistProgress();
  if (abortSignal.aborted) {
    output.coordinatorLog("Build cancelled before startup.");
    return returning({ runId: manifest.id, stories: [], completedStoryIds: [], featureBranch: null, userTask });
  }
  // Retry plans can skip the planner's preflight, so enforce an explicit OS
  // request at the orchestration boundary before any provider or ticket work.
  if (sandboxed === "os") resolveSandboxMode("os");

  // The default path mode may be automatically upgraded for /build. Unlike an
  // explicit `sandbox: "os"` setting, this specific automatic policy can fall
  // back, and the user must see the effective mode in the run output.
  if (sandboxed === true) {
    const resolution = resolveAutomaticSandboxUpgrade();
    sandboxed = resolution.effective;
    if (resolution.warning) {
      logger.info("OS sandbox fallback in /build", { warning: resolution.warning });
      output.log("system", resolution.warning);
    } else if (sandboxed === "os") {
      logger.info("OS sandbox enabled for /build");
      output.log("system", "OS sandbox enabled for /build.");
    }
  }

  manifest.effectiveSandbox = sandboxed === "os" ? "os" : sandboxed ? "path" : "none";
  persistProgress();

  // Resolve ticket references — fetch from issue tracker if ticketKey is set
  const ticketEnv = ticketEnvironment();
  if (config.jira) {
    ticketEnv.JIRA_BASE_URL = config.jira.baseUrl;
    ticketEnv.JIRA_EMAIL = config.jira.email;
    ticketEnv.JIRA_API_TOKEN = config.jira.apiToken;
  }
  if (config.linear) ticketEnv.LINEAR_API_KEY = config.linear.apiKey;
  if (ticketKey) {
    try {
      const { TicketOps } = await import("./ticket-ops.js");
      const ticketSystem = config.ticketSystem || "github";

      if (ticketSystem === "github") {
        if (!ticketEnv.GITHUB_TOKEN) {
          try {
            ticketEnv.GITHUB_TOKEN = await startupProcess("gh", ["auth", "token"], 5_000, 64 * 1024);
          } catch { /* gh not installed or not logged in */ }
        }
        if (!ticketEnv.GITHUB_REPO) {
          try {
            const remote = await startupProcess("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "remote", "get-url", "origin"]);
            const match = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
            if (match) ticketEnv.GITHUB_REPO = match[1].replace(/\.git$/, "");
          } catch { /* not a git repo */ }
        }
      }

      const ops = new TicketOps(ticketKey, ticketSystem, { signal: abortSignal, environment: ticketEnv });
      if (!ops.isAvailable()) {
        const hints: Record<string, string> = {
          github: "Ensure GITHUB_TOKEN is set or run `gh auth login`. Repo detected from git remote.",
          jira: "Run `/setup` to add your Jira URL, email, and API token (generate at id.atlassian.com).",
          linear: "Run `/setup` to add your Linear API key (generate at linear.app/settings/api).",
        };
        output.error(`Cannot connect to ${ticketSystem} — credentials not found.\n${hints[ticketSystem] || "Run `/setup` to configure your issue tracker."}`);
        return returning({ runId: manifest.id, stories: [], completedStoryIds: [], featureBranch: null, userTask });
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
        return returning({ runId: manifest.id, stories: [], completedStoryIds: [], featureBranch: null, userTask });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.error(`Failed to fetch ${ticketKey}: ${msg}`);
      return returning({ runId: manifest.id, stories: [], completedStoryIds: [], featureBranch: null, userTask });
    }
  }

  // Create a reusable TicketOps instance for posting updates throughout the run
  let ticketOps: InstanceType<typeof import("./ticket-ops.js").TicketOps> | null = null;
  let resolvedTicketSystem: string = config.ticketSystem || "github";
  if (ticketKey) {
    try {
      const { TicketOps } = await import("./ticket-ops.js");
      const ticketSystem = resolvedTicketSystem;
      const ops = new TicketOps(ticketKey, ticketSystem, { signal: abortSignal, environment: ticketEnv });
      logger.info("TicketOps availability check", {
        ticketKey, ticketSystem, isAvailable: ops.isAvailable(),
        hasToken: !!ticketEnv.GITHUB_TOKEN,
        hasRepo: !!ticketEnv.GITHUB_REPO,
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

  // Start MCP servers as resources owned by this run. Global MCP teardown is
  // reserved for CLI exit and must never close another active run.
  const skipAutoDetect = isLocalProvider(defaultProvider.provider);
  mcpResources = createMCPRunResources({ runId: manifest.id, workspace: workingDir, signal: resourceSignal });
  const mcpConfig = skipAutoDetect
    ? (config.mcp || {})
    : await autoDetectMCPServersForRun(config.mcp || {}, { runId: manifest.id, workspace: workingDir, signal: abortSignal });
  if (Object.keys(mcpConfig).length > 0) {
    output.coordinatorLog(`Starting ${Object.keys(mcpConfig).length} MCP server(s)...`);
    mcpResources.register(mcpConfig);
    await mcpResources.ensureStarted();
  }

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

  terminalReason = "completion_blocked";

  if (retryPlan) {
    // ── Retry mode: skip planning, resume on the existing feature branch ──
    featureBranch = retryPlan.featureBranch;
    mainBranch = retryPlan.mainBranch;
    const currentBranch = await startupProcess("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "branch", "--show-current"]).catch(() => "");
    if (abortSignal.aborted) return returning({ runId: manifest.id, stories: retryPlan.stories, completedStoryIds: [...retryPlan.completedStoryIds], featureBranch, userTask });

    // Checkout the feature branch if we're not already on it
    if (currentBranch !== featureBranch) {
      // Verify branch exists
      try {
        if (!await branchExists(featureBranch)) {
          output.error(`Branch \`${featureBranch}\` no longer exists. Nothing to retry.`);
          return returning({ runId: manifest.id, stories: retryPlan.stories, completedStoryIds: [...retryPlan.completedStoryIds], featureBranch, userTask });
        }
      } catch {
        output.error("Could not verify the retry branch. Its saved state is retained.");
        return returning({ runId: manifest.id, stories: retryPlan.stories, completedStoryIds: [...retryPlan.completedStoryIds], featureBranch, userTask });
      }

      output.coordinatorLog(`Switching to \`${featureBranch}\`...`);
      try {
        await startupMutation(["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "switch", "--no-guess", "--", featureBranch]);
      } catch {
        output.error(`Could not checkout \`${featureBranch}\` — you have uncommitted changes. Commit or stash them first, then \`/retry\`.`);
        return returning({ runId: manifest.id, stories: retryPlan.stories, completedStoryIds: [...retryPlan.completedStoryIds], featureBranch, userTask });
      }
    }
    output.updateBranch?.(featureBranch);
    await new Promise(r => setTimeout(r, 0));

    sorted = retryPlan.stories;

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
    const originalBranch = await startupProcess("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "branch", "--show-current"]).catch(() => "");
    if (abortSignal.aborted) return returning({ runId: manifest.id, stories: [], completedStoryIds: [], featureBranch: null, userTask });
    mainBranch = originalBranch || "main";

    // Warn if starting from a non-trunk branch — new work will stack on top of it
    const trunkBranches = ["main", "master", "develop", "trunk"];
    if (originalBranch && !trunkBranches.includes(originalBranch)) {
      output.log("system", `You're on \`${originalBranch}\`, not a trunk branch. New work will stack on top of it and the PR will target \`${originalBranch}\` as its base.`);
      output.log("system", `If you want an independent task, cancel, run \`git checkout main\`, then \`/build\` again.`);
      const r = await output.confirm("Continue and stack on this branch?");
      if (abortSignal.aborted) return returning({ runId: manifest.id, stories: [], completedStoryIds: [], featureBranch: null, userTask });
      const confirmed = typeof r === "object" ? r.allowed : r;
      if (!confirmed) {
        return returning({ runId: manifest.id, stories: [], completedStoryIds: [], featureBranch: null, userTask });
      }
    }

    // Spec check — identify ambiguities before the planner runs (off by default)
    if (config.review?.specCheck) {
      userTask = await _runSpecCheck(config, userTask, output, abortSignal);
    }

    // Planner runs on the current branch — no branch created yet
    terminalReason = "planner_failed";
    const planResult = await planStories(config, userTask, workingDir, sandboxed, output, abortSignal);

    // Track planner cost
    costTracker.addUsage("Planner", planResult.provider, planResult.model, planResult.inputTokens, planResult.outputTokens);
    output.updateCost?.(costTracker.getTotalCost());
    output.updateUsageSummary?.(costTracker.getUsageSummary());

    // Handle planner rejection — still on original branch, nothing to clean up
    if (planResult.rejected) {
      terminalReason = planResult.failureReason === "planning_rejected" ? "planning_rejected"
        : planResult.failureReason === "provider_failed" ? "provider_failed"
        : planResult.failureReason === "cancelled" ? "cancelled" : "planner_failed";
      output.log("system", `The planner determined this task should not proceed: ${planResult.rejectionReason || "unspecified reason"}`);
      output.log("system", "Refine your spec and try again.");
      return returning({ runId: manifest.id, stories: [], completedStoryIds: [], featureBranch: null, userTask });
    }

    terminalReason = "planning_rejected";
    const qaParticipation = config.qa?.participation ?? "default";
    let plannerStories = _applyQaParticipation(planResult.stories, qaParticipation);
    if (qaParticipation === "always" && plannerStories.length > planResult.stories.length) {
      output.log("planner", "QA participation is always — added a dedicated qa_engineer validation story.");
    }

    // Planner critic — score the plan and refine it before any worker starts (off by default)
    if (config.review?.critic) {
      const critique = await _runPlanCritic(config, userTask, plannerStories, workingDir, output, abortSignal);
      plannerStories = _applyQaParticipation(critique.stories, qaParticipation);

      costTracker.addUsage("Critic", critique.provider, critique.model, critique.inputTokens, critique.outputTokens);
      output.updateCost?.(costTracker.getTotalCost());
      output.updateUsageSummary?.(costTracker.getUsageSummary());

      if (critique.cancelled || abortSignal?.aborted) {
        output.coordinatorLog("Build cancelled during plan critique.");
        return returning({ runId: manifest.id, stories: [], completedStoryIds: [], featureBranch: null, userTask });
      }

      if (!critique.approved) {
        const threshold = config.review?.criticThreshold ?? 8;
        output.log("critic", `Plan still scores ${critique.score}/10 after ${critique.iterations} rounds (needs ${threshold}).`);
        if (config.review?.strict) {
          output.error("Strict mode — the critic did not approve this plan. Refine the spec and try again.");
          return returning({ runId: manifest.id, stories: [], completedStoryIds: [], featureBranch: null, userTask });
        }
        output.log("critic", "Proceeding with the best plan produced — review it carefully before confirming.");
      }
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

    persistProgress();

    // Prompt user to proceed (unless --trust mode)
    // Still on original branch — declining costs nothing
    if (!(typeof trustAll === "function" ? trustAll() : trustAll)) {
      let proceed = false;
      try {
        const r = await output.confirm("Execute this plan?");
        if (abortSignal.aborted) return returning({ runId: manifest.id, stories: sorted, completedStoryIds: [], featureBranch: null, userTask });
        proceed = typeof r === "object" ? r.allowed : r;
      } catch (err) {
        logger.debug("Plan confirmation failed", { error: err instanceof Error ? err.message : String(err) });
      }
      if (!proceed) {
        output.log("system", "Plan cancelled.");
        return returning({ runId: manifest.id, stories: sorted, completedStoryIds: [], featureBranch: null, userTask });
      }
    }

    terminalReason = "completion_blocked";

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
      try {
        const remote = await startupProcess("git", ["-c", "core.fsmonitor=false", "remote", "get-url", "origin"]);
        branchPrefix = remote.match(/[/:]([^/]+?)(?:\.git)?$/)?.[1];
      } catch { resourceSignal.throwIfAborted(); /* no remote: retain directory-name fallback */ }
    }
    // Warn if the branch already exists from a previous run
    const derivedBranch = deriveStartupBranch(branchLabel, branchPrefix, workingDir);
    let branchAlreadyAcknowledged = false;
    let continueExistingBranch = false;
    const inRepository = await startupProcess("git", ["-c", "core.fsmonitor=false", "rev-parse", "--is-inside-work-tree"])
      .then((value) => value === "true", (error: unknown) => {
        resourceSignal.throwIfAborted();
        if (error && typeof error === "object" && "exitCode" in error && error.exitCode === 128) return false;
        throw error;
      });
    if (inRepository && derivedBranch && await branchExists(derivedBranch)) {
      // User will engage with a branch dialog below — no need for a second prompt afterward
      branchAlreadyAcknowledged = true;
      output.log("system", `Branch \`${derivedBranch}\` already exists from a previous run.`);
      output.log("system", `- **Yes** → delete it and start fresh from \`${mainBranch}\``);
      output.log("system", `- **No** → continue on the existing branch`);
      const resetR = await output.confirm(`Reset \`${derivedBranch}\` and start fresh?`);
      if (abortSignal.aborted) return returning({ runId: manifest.id, stories: sorted, completedStoryIds: [], featureBranch: null, userTask });
      const reset = typeof resetR === "object" ? resetR.allowed : resetR;
      if (reset) {
        try {
          await startupMutation(["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "branch", "-D", "--", derivedBranch]);
          output.coordinatorLog(`Deleted \`${derivedBranch}\` — starting fresh from \`${mainBranch}\``);
        } catch {
          output.error(`Could not delete \`${derivedBranch}\` — it may be checked out elsewhere.`);
          return returning({ runId: manifest.id, stories: sorted, completedStoryIds: [], featureBranch: null, userTask });
        }
      } else {
        const continueR = await output.confirm(`Continue on existing \`${derivedBranch}\`?`);
        if (abortSignal.aborted) return returning({ runId: manifest.id, stories: sorted, completedStoryIds: [], featureBranch: null, userTask });
        const cont = typeof continueR === "object" ? continueR.allowed : continueR;
        if (!cont) {
          output.log("system", "Cancelled. Run `/build` again after resolving the branch.");
          return returning({ runId: manifest.id, stories: sorted, completedStoryIds: [], featureBranch: null, userTask });
        }
        continueExistingBranch = true;
      }
    }

    // Branch creation prompt — ALWAYS ask. Branch creation is never silent.
    // Skipped only if the user already acknowledged the branch (via the existing-branch dialog above)
    // or if --trust mode was explicitly enabled at launch.
    if (!branchAlreadyAcknowledged && !(typeof trustAll === "function" ? trustAll() : trustAll)) {
      const branchName = derivedBranch ?? "a feature branch";
      const r = await output.confirm(`About to create and check out \`${branchName}\`. Continue?`);
      if (abortSignal.aborted) return returning({ runId: manifest.id, stories: sorted, completedStoryIds: [], featureBranch: null, userTask });
      const allowed = typeof r === "object" ? r.allowed : r;
      if (!allowed) {
        output.coordinatorLog("Cancelled.");
        return returning({ runId: manifest.id, stories: sorted, completedStoryIds: [], featureBranch: null, userTask });
      }
    }

    featureBranch = null;
    if (inRepository && derivedBranch) {
      try {
        await startupMutation(["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "switch",
          ...(continueExistingBranch ? ["--no-guess", "--", derivedBranch] : ["-c", derivedBranch])]);
        featureBranch = derivedBranch;
      } catch {
        featureBranch = null;
      }
    }
    if (featureBranch) {
      output.coordinatorLog(`Created and checked out branch: \`${featureBranch}\``);
      output.updateBranch?.(featureBranch);
      // Yield to let Ink render the branch update
      await new Promise(r => setTimeout(r, 0));
    } else if (inRepository) {
      output.error("Could not create feature branch. You may have uncommitted changes — commit or stash them first.");
      return returning({ runId: manifest.id, stories: sorted, completedStoryIds: [], featureBranch: null, userTask });
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
      if (abortSignal.aborted) return true;
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

  if (config.review?.enabled !== false) {
    const identity = preflightReviewIdentity({
      config, workers: sorted.map((story) => getProviderForPersona(config, story.persona)),
      reviewer: getProviderForPersona(config, "tech_lead"),
      requireDifferentModel: config.review?.requireDifferentModel,
    });
    if (identity.warning) output.log("system", identity.warning);
    if (!identity.allowed) {
      terminalReason = "permission_blocked";
      output.error("Reviewer identity requirement is not satisfied; no workers were started. Configure a known-different reviewer binding.");
      return returning({ runId: manifest.id, stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch });
    }
  }
  persistProgress();

  // Persist the plan so /retry works even if the first story fails
  if (featureBranch) {
    saveShipRun({ runId: manifest.id, workingDir, featureBranch, mainBranch, userTask, stories: sorted, completedStoryIds, updatedAt: "" });
  }

  // ── Story execution loop ──
  terminalReason = "provider_failed";
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
    runId: manifest.id,
    onStoryAttempt: onAttempt,
    getMCPToolDefinitions: () => mcpResources?.getToolDefinitions() ?? {},
    waitWhilePaused,
    pauseForBalanceIssue,
    logRetryHint,
  });

  failedStories = execResult.failedStories;
  persistProgress();
  const skippedStories = execResult.skippedStories;

  // If the story loop exited early (user cancel, abort, balance issue), return immediately
  if (execResult.earlyExit) {
    return returning({ runId: manifest.id, stories: sorted, completedStoryIds, featureBranch, userTask });
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

  // Final candidate preparation belongs before all final evidence. In
  // particular, completion must never create a commit after approval.
  // Worker/MCP/LSP lifetimes are closed before source-changing preparation so
  // neither a late tool result nor a server request can invalidate evidence.
  await cleanupRunResources();
  terminalReason = "verification_failed";
  const preparation = await prepareCandidate({
    config, workingDir, featureBranch, runId: manifest.id, signal: abortSignal, sandboxed,
  });
  if (!preparation.prepared) {
    output.error(`Candidate preparation failed: ${preparation.reason ?? "unknown error"}`);
    return returning({ runId: manifest.id, stories: sorted, completedStoryIds, featureBranch, userTask });
  }

  let gateFingerprint = await captureRepositoryFingerprint(workingDir, abortSignal);
  manifest.fingerprint = gateFingerprint;
  if (!gateFingerprint.verified) {
    output.error(`Could not verify candidate state before quality gates: ${gateFingerprint.reason}`);
    return returning({ runId: manifest.id, stories: sorted, completedStoryIds, featureBranch, userTask });
  }

  // Gates are permitted to change code, but their result is evidence only for
  // the state they leave behind. Stabilize a small finite number of times.
  let gatesResult;
  const gateStabilizationCap = 2;
  for (let attempt = 1; attempt <= gateStabilizationCap; attempt++) {
    gatesResult = await runQualityGates({
      config, output, sorted, completedStoryIds, context, workingDir, abortSignal, runId: manifest.id, sandboxed,
    });
    manifest.gates = gatesResult.gateResults;
    persistProgress();
    // R12's typed early exit is terminal. Do not run a second pass that can
    // replace the failed evidence with a later success.
    if (gatesResult.earlyExit) {
      terminalReason = "required_gate_failed";
      return returning({ runId: manifest.id, stories: sorted, completedStoryIds, featureBranch, userTask });
    }
    const afterGates = await captureRepositoryFingerprint(workingDir, abortSignal);
    manifest.fingerprint = afterGates;
    if (!afterGates.verified) {
      output.error(`Could not verify repository state after quality gates: ${afterGates.reason}`);
      return returning({ runId: manifest.id, stories: sorted, completedStoryIds, featureBranch, userTask });
    }
    if (afterGates.digest === gateFingerprint.digest && afterGates.head === gateFingerprint.head) {
      gateFingerprint = afterGates;
      break;
    }
    gateFingerprint = afterGates;
    if (attempt === gateStabilizationCap) {
      output.error("Quality gates changed the candidate repeatedly; publication is blocked with local work preserved.");
      return returning({ runId: manifest.id, stories: sorted, completedStoryIds, featureBranch, userTask });
    }
    // A gate can legitimately write generated source. Commit that exact
    // candidate before the next verification pass; otherwise a later push
    // could publish an older HEAD than the evidence described.
    const rePreparation = await prepareCandidate({
      config, workingDir, featureBranch, runId: `${manifest.id}-gate-${attempt}`,
      signal: abortSignal, sandboxed,
    });
    if (!rePreparation.prepared) {
      output.error(`Candidate preparation after quality gates failed: ${rePreparation.reason ?? "unknown error"}`);
      return returning({ runId: manifest.id, stories: sorted, completedStoryIds, featureBranch, userTask });
    }
    const preparedFingerprint = await captureRepositoryFingerprint(workingDir, abortSignal);
    manifest.fingerprint = preparedFingerprint;
    if (!preparedFingerprint.verified) {
      output.error(`Could not verify prepared candidate after quality gates: ${preparedFingerprint.reason}`);
      return returning({ runId: manifest.id, stories: sorted, completedStoryIds, featureBranch, userTask });
    }
    gateFingerprint = preparedFingerprint;
    output.coordinatorLog("Quality gates changed the candidate; re-running final verification once.");
  }
  // The loop either assigned it or returned above.
  let gateResultsSection = gatesResult!.gateResultsSection;

  // A required (or strict) gate failure is terminal for this run. Preserve the
  // feature branch and ship state so `/retry` can continue after the failure,
  // but do not let review or completion publish an unverified change.
  // Run inline review with revision loop
  terminalReason = "review_rejected";
  const reviewLoopResult = await _runReviewLoop({
    config, output, sorted, context, userTask,
    featureBranch, mainBranch, workingDir,
    costTracker, abortSignal, trustAll, sandboxed, sessionAllow,
    liveViewServer, ticketOps, gateResultsSection,
    onReviewRound, onRevisionAttempt: onAttempt,
    waitWhilePaused, pauseForBalanceIssue, logRetryHint,
  });
  const finalReviewText = reviewLoopResult.finalReviewText;
  const lastReview = manifest.reviews.at(-1);
  if (!lastReview || lastReview.outcome.kind !== reviewLoopResult.outcome.kind) {
    const reviewer = getProviderForPersona(config, "tech_lead");
    manifest.reviews.push({ round: lastReview?.round ?? 1, provider: lastReview?.provider ?? reviewer.provider, model: lastReview?.model ?? reviewer.model, outcome: reviewLoopResult.outcome });
  }
  persistProgress();
  if (reviewLoopResult.aborted) {
    terminalReason = reviewLoopResult.outcome.kind === "provider_failed" ? "provider_failed" : "review_rejected";
    return returning({ runId: manifest.id, stories: sorted, completedStoryIds, featureBranch, userTask });
  }

  if (config.review?.strict === true && config.review?.enabled !== false && !reviewLoopResult.outcome.approved) {
    output.error(`Strict mode requires a valid review approval (review: ${reviewLoopResult.outcome.kind}).`);
    return returning({ runId: manifest.id, stories: sorted, completedStoryIds, featureBranch, userTask });
  }
  if (config.review?.strict === true && reviewLoopResult.outcome.approved && !reviewLoopResult.fingerprint) {
    output.error("Strict mode cannot publish an approval without verified reviewer-state evidence.");
    return returning({ runId: manifest.id, stories: sorted, completedStoryIds, featureBranch, userTask });
  }

  // Review evidence must describe the current tree. Re-run gates only when
  // review/revisions changed it; unchanged candidates avoid redundant gates.
  terminalReason = "verification_failed";
  const afterReview = await captureRepositoryFingerprint(workingDir, abortSignal);
  manifest.fingerprint = afterReview;
  const reviewFingerprint = reviewLoopResult.fingerprint ?? (config.review?.enabled === false ? gateFingerprint : undefined);
  const reviewEvidenceStale = !afterReview.verified || (reviewFingerprint !== undefined
    && (afterReview.digest !== reviewFingerprint.digest || afterReview.head !== reviewFingerprint.head));
  if (reviewEvidenceStale) {
    output.error(`Final review evidence is stale${afterReview.verified ? "." : ` (${afterReview.reason})`}; publication is blocked.`);
    return returning({ runId: manifest.id, stories: sorted, completedStoryIds, featureBranch, userTask });
  }
  if (afterReview.digest !== gateFingerprint.digest || afterReview.head !== gateFingerprint.head) {
    const finalGates = await runQualityGates({
      config, output, sorted, completedStoryIds, context, workingDir, abortSignal, runId: manifest.id, sandboxed,
    });
    manifest.gates = finalGates.gateResults;
    persistProgress();
    if (finalGates.earlyExit) {
      terminalReason = "required_gate_failed";
      return returning({ runId: manifest.id, stories: sorted, completedStoryIds, featureBranch, userTask });
    }
    const afterFinalGates = await captureRepositoryFingerprint(workingDir, abortSignal);
    manifest.fingerprint = afterFinalGates;
    if (!afterFinalGates.verified || afterFinalGates.digest !== afterReview.digest || afterFinalGates.head !== afterReview.head) {
      output.error("Final quality gates changed the reviewed candidate; approval is invalid and publication is blocked.");
      return returning({ runId: manifest.id, stories: sorted, completedStoryIds, featureBranch, userTask });
    }
    gateFingerprint = afterFinalGates;
    gatesResult = finalGates;
    gateResultsSection = finalGates.gateResultsSection;
  }

  manifest.fingerprint = gateFingerprint;
  persistProgress();

  // --- Build Report ---
  {
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
    for (const line of lines) output.log("system", line);
  }

  // --- Completion: push, PR, ticket updates, cleanup ---
  terminalReason = "completion_blocked";
  const completion = await runCompletion({
    runId: manifest.id,
    config, output, sorted, completedStoryIds, featureBranch, mainBranch,
    workingDir, userTask, costTracker, finalReviewText, ticketKey,
    ticketOps, resolvedTicketSystem, liveViewServer,
    hooks: config.hooks,
    evidence: { fingerprint: gateFingerprint, gateResults: gatesResult!.gateResults, reviewOutcome: reviewLoopResult.outcome },
    abortSignal,
  });
  if (!completion.completionInvalidated) {
    terminalReason = sorted.length > 0 && completedStoryIds.length === sorted.length ? "success"
      : completedStoryIds.length > 0 ? "partial" : "no_progress";
  }
  return returning({ ...completion, runId: manifest.id });
  } catch (error) {
    if (error instanceof ResourceCleanupError) terminalReason = "cleanup_failed";
    throw error;
  } finally {
    if ((terminalReason === "no_progress" || terminalReason === "provider_failed")
      && manifest.attempts.some((attempt) => attempt.status === "failed"
        && ["denied", "permission_required", "hook_blocked"].includes(attempt.failureCode ?? ""))) {
      terminalReason = "permission_blocked";
    }
    // Capture caller cancellation before our own teardown aborts the run.
    if (abortSignal.aborted && terminalReason !== "cleanup_failed") terminalReason = "cancelled";
    abortController.abort(new Error("Orchestration finished"));
    suppliedAbortSignal?.removeEventListener("abort", forwardAbort);
    try {
      await cleanupRunResources();
    } finally {
      manifest.phase = "terminal";
      manifest.terminalReason = terminalReason;
      manifest.completedAt = new Date(Math.max(Date.now(), Date.parse(manifest.startedAt))).toISOString();
      manifest.outcome = terminalReason === "cancelled" ? "cancelled"
        : terminalReason === "success" ? "success"
        : terminalReason === "partial" ? "partial" : "failed";
      for (const attempt of manifest.attempts) {
        if (attempt.status === "started") {
          attempt.status = terminalReason === "cancelled" ? "cancelled" : "failed";
          attempt.completedAt = new Date(Math.max(Date.parse(manifest.completedAt), Date.parse(attempt.startedAt))).toISOString();
        }
      }
      persistProgress();
      if (returnedResult) {
        returnedResult.outcome = manifest.outcome;
        returnedResult.terminalReason = terminalReason;
      }
    }
  }
}
