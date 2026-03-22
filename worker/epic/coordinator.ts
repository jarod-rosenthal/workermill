/**
 * Epic Coordinator
 *
 * Main coordination loop for multi-agent collaboration.
 * This is a thin orchestration hub that delegates to focused modules:
 *
 * - coordinator-utils.ts     — Shared helpers (logging, status updates, error classification)
 * - coordinator-commands.ts  — Dashboard command polling, message delivery, expert responses
 * - coordinator-questions.ts — Question routing between experts (answer-first, tiered routing)
 * - coordinator-stories.ts   — Story execution, mutex/file-overlap gating, failure handling
 * - coordinator-review.ts    — Tech Lead review, AI SDK review, deployment, revision triggering
 * - coordinator-ci.ts        — CI gate polling, CI fix agent, quality fix agent, CI-verified merge
 */

import * as path from "path";
import axios from "axios";
import { execSync } from "child_process";
import type {
  ExpertPersona,
  ExpertState,
  ReadyStory,
  EpicConfig,
  ResilienceConfig,
  EpicValidationResult,
  BuildReport,
} from "./types.js";
import { getAvailableExperts, matchPersonaToExpert, loadExpertRegistry } from "./experts.js";
import type { DecisionClient, EvaluateQualityResponse } from "./decision-client.js";
import { CoordinationClient } from "./coordination-client.js";
import { StoryExecutor } from "./executor.js";
import { GitOps } from "./git-ops.js";
import { BlockerManager } from "./blocker-manager.js";
import { TicketOps, GitHubCommentFormat } from "./ticket-ops.js";
import { InlineReviewer } from "./inline-reviewer.js";
import { InlineIntegrationFixer } from "./inline-integration-fixer.js";
import { InlineReviewFixer } from "./inline-review-fixer.js";
import { InlineImprover } from "./inline-improver.js";
import { InlineVerifier } from "./inline-verifier.js";
import { createMemoryClient, type MemoryClient, type MemoryContext, type EnhancedContext } from "./memory-client.js";
import { CredentialRotator } from "./credential-rotator.js";
import { runQualityVerification, postQualityMetrics, type QualityMetrics } from "./quality-runner.js";
import { runAutoFixWithTracking, formatAutoFixResult, type QualityGateResult as AutoFixQualityGateResult } from "./auto-fix-agent.js";

// Extracted modules
import {
  isTransientError,
  extractPrNumber,
  sleep,
  postLog,
  postDashboardLog,
  postProgressUpdate,
  updateTaskStatus,
} from "./coordinator-utils.js";
import {
  pollForCommands,
  checkExpertResponses,
  waitForResume,
} from "./coordinator-commands.js";
import {
  processAnswerFirst,
  processQuestions,
} from "./coordinator-questions.js";
import {
  hasMutexConflict,
  hasFileOverlap,
  registerRunningStory,
  unregisterRunningStory,
  scanRunningWorktrees,
  executeStoryAsync,
} from "./coordinator-stories.js";
import {
  runInlineReview,
  runDeploymentOnly,
  runReviewOnly,
  triggerRevision,
} from "./coordinator-review.js";
import {
  runCIGate,
  runQualityFixAgent,
} from "./coordinator-ci.js";

/**
 * Epic coordinator managing multi-agent collaboration.
 */
export class EpicCoordinator {
  private config: EpicConfig;
  private coordination: CoordinationClient;
  private executor: StoryExecutor;
  private gitOps: GitOps;
  private ticketOps: TicketOps;
  private decisionClient: DecisionClient;
  private expertStates: Map<ExpertPersona, ExpertState>;
  private missionActive: boolean = false;
  private pollIntervalMs: number = 5000;

  // Inline review and deployment tracking
  private revisionCount: number = 0;
  private maxRevisions: number;
  private maxPerStoryRevisions: number;
  private currentPrUrl: string | undefined;
  private currentPrNumber: number | undefined;
  private lastReviewFeedback: string | undefined;
  private revisionStoriesQueued: ReadyStory[] = [];
  private deploymentSucceeded: boolean = false;
  private reviewSkipped: boolean = false;
  private mergeFailed: boolean = false;

  // CI Fix Agent tracking
  private ciFixRetryCount: number = 0;
  private totalStories: number = 0;

  // Memory system (REQ-19) with Codebase RAG
  private memoryClient: MemoryClient;
  private memoryContext: MemoryContext | null = null;
  private enhancedContext: EnhancedContext | null = null;

  // Worker-reported learnings accumulated across stories
  private accumulatedLearnings: Array<{ learning: string; persona: string; storyIndex: number }> = [];

  // User feedback from Talk to Worker (command polling)
  private userFeedback: string | null = null;

  // Per-story review tracking
  private reviewedStoryIndices: Set<number> = new Set();
  private storyRevisionCounts: Map<number, number> = new Map();

  // Resilience: Track completed stories for resume after restart
  private completedStoryIndices: Set<number> = new Set();
  private loggedBlockedStories: Set<number> = new Set();
  private blockedStoryIndices: Set<number> = new Set();
  private failedStoryIndices: Set<number> = new Set();
  private locallyCompletedStoryIndices: Set<number> = new Set();
  private resilience: ResilienceConfig;
  // Active worktrees for graceful shutdown
  private activeWorktrees: Map<number, string> = new Map();
  private blockerManager: BlockerManager | null = null;
  // Mutex groups and file-overlap tracking
  private runningStoryMutexGroups: Map<number, string[]> = new Map();
  private runningStoryTargetFiles: Map<number, string[]> = new Map();
  // Credential rotation
  private credentialRotator: CredentialRotator;
  private rateLimitRetries: Map<number, number> = new Map();
  // In-flight quick answers tracking
  private inFlightQuickAnswers: Set<string> = new Set();
  // Story branch names
  private storyBranchNames: Map<number, string> = new Map();
  private gateBypassed: Set<number> = new Set();
  // Epic timing
  private epicStartTime: number = Date.now();
  private hasAnyCommittedCode: boolean = false;
  // Dependency merge conflict tracking
  private storyDepConflicts: Map<number, string[]> = new Map();
  // Post-rebase baseline SHAs
  private storyBaselineShas: Map<number, string> = new Map();
  // Proactive conflict detection counter
  private loopIterationCount: number = 0;
  // Server-side prompt templates
  private serverPromptTemplates?: import("./decision-client.js").WorkerConfigResponse["promptTemplates"];

  constructor(config: EpicConfig, resilience?: ResilienceConfig, decisionClient?: DecisionClient) {
    this.config = config;
    this.maxRevisions = config.maxReviewRevisions;
    this.maxPerStoryRevisions = config.maxPerStoryRevisions;
    this.coordination = new CoordinationClient(config);

    // Initialize decision client
    if (decisionClient) {
      this.decisionClient = decisionClient;
    } else {
      const { DecisionClient: DC } = require("./decision-client.js");
      this.decisionClient = new DC({
        apiBaseUrl: config.apiBaseUrl,
        orgApiKey: config.orgApiKey,
        logger: (msg: string) => console.log(msg),
      });
    }

    // Determine workspace directory
    const repoPath = process.env.REPO_PATH;
    let workDir: string;

    if (repoPath) {
      workDir = path.dirname(repoPath);
      console.log("[Epic] Using pre-cloned repo at:", repoPath);
    } else {
      const isLocalMode = process.env.EXECUTION_MODE === "local";
      workDir = isLocalMode
        ? process.env.WORKTREE_BASE_PATH || "/tmp/workermill-epic-workspace"
        : "/app/workspace";
      if (isLocalMode) {
        console.log("[Epic] Using local workspace:", workDir);
      }
    }

    this.gitOps = new GitOps({
      targetRepo: config.targetRepo,
      githubToken: process.env.SCM_TOKEN || config.githubToken,
      workDir,
      scmProvider: (process.env.SCM_PROVIDER as "github" | "gitlab" | "bitbucket") || "github",
      scmBaseUrl: process.env.SCM_BASE_URL,
      bitbucketUsername: process.env.BITBUCKET_USERNAME,
      skipClone: !!repoPath,
    }, (msg) => this.postDashboardLog(msg));

    this.resilience = resilience || {
      blockerMaxAutoRetries: 3,
      blockerAutoRetryEnabled: true,
      pushAfterCommit: true,
      gracefulShutdownEnabled: true,
    };

    this.executor = new StoryExecutor(config, this.coordination, this.gitOps, this.decisionClient, this.resilience);
    this.executor.onWorktreeCreated = (storyIndex, worktreePath, branchName) => {
      this.activeWorktrees.set(storyIndex, worktreePath);
      this.storyBranchNames.set(storyIndex, branchName);
    };
    this.ticketOps = new TicketOps(config.jiraIssueKey, config.ticketSystem);
    this.expertStates = new Map();

    this.blockerManager = new BlockerManager(
      this.coordination,
      config.parentTaskId,
      this.resilience,
      this.decisionClient
    );

    this.credentialRotator = new CredentialRotator();
    const accountCount = this.credentialRotator.discover();
    if (accountCount > 1) {
      console.log(`[Epic] Credential pool: ${accountCount} accounts available for rotation`);
    } else if (accountCount === 1) {
      console.log(`[Epic] Credential pool: 1 account (rotation will wait and retry same account)`);
    }

    this.memoryClient = createMemoryClient(config.apiBaseUrl, config.orgApiKey);

    for (const expert of getAvailableExperts()) {
      this.expertStates.set(expert, {
        persona: expert,
        status: "idle",
      });
    }
  }

  // =============================================================================
  // Public API
  // =============================================================================

  /**
   * Start the Epic coordination loop.
   */
  async start(): Promise<void> {
    console.log("[Epic] Starting Epic executor for task " + this.config.parentTaskId);
    this.missionActive = true;

    try {
      await loadExpertRegistry(this.config.apiBaseUrl, this.config.orgApiKey);

      this.expertStates.clear();
      for (const expert of getAvailableExperts()) {
        this.expertStates.set(expert, { persona: expert, status: "idle" });
      }

      await this.gitOps.cloneIfNeeded();
      await this.initializeWithResume();

      const workerConfig = await this.decisionClient.getWorkerConfig();
      this.executor.setIcons(workerConfig.personaIcons, workerConfig.providerIcons);

      if (workerConfig.promptTemplates) {
        this.executor.setPromptTemplates(workerConfig.promptTemplates);
        console.log("[Epic] Loaded 8 server-side prompt templates");
      }
      this.serverPromptTemplates = workerConfig.promptTemplates;

      // Detect and checkout existing branch for retry scenarios
      if (this.config.jiraIssueKey) {
        const priorWork = await this.gitOps.detectAndCheckoutExistingBranch(this.config.jiraIssueKey);
        if (priorWork) {
          console.log("[Epic] 🔄 RETRY SCENARIO: Found prior work on branch " + priorWork.branchName);
          console.log(`[Epic] Prior commits: ${priorWork.commits.length}`);
          if (priorWork.prUrl) {
            console.log(`[Epic] Existing PR: ${priorWork.prUrl} (${priorWork.prState})`);
            this.currentPrUrl = priorWork.prUrl;
            this.currentPrNumber = priorWork.prNumber;
          }
          if (priorWork.prReviewComments && priorWork.prReviewComments.length > 0) {
            console.log(`[Epic] Review comments to address: ${priorWork.prReviewComments.length}`);
          }
          this.config.priorWorkContext = this.gitOps.formatPriorWorkContext(priorWork);

          await this.ticketOps.postComment(
            `🔄 **Retry Scenario Detected**\n\n` +
            `Found existing branch: \`${priorWork.branchName}\`\n` +
            `Previous commits: ${priorWork.commits.length}\n` +
            (priorWork.prUrl ? `Existing PR: ${priorWork.prUrl}\n` : "") +
            (priorWork.prReviewComments?.length
              ? `Review comments to address: ${priorWork.prReviewComments.length}\n`
              : "")
          );
        }
      }

      // Fast path: deployment-only run
      const taskNotes = process.env.TASK_NOTES || "";
      if (taskNotes.includes("DEPLOYMENT_RUN")) {
        const prUrl = this.currentPrUrl || process.env.EXISTING_PR_URL;
        const prNumber = this.currentPrNumber || parseInt(process.env.EXISTING_PR_NUMBER || "0", 10);

        if (prUrl && prNumber) {
          console.log(`[Epic] DEPLOYMENT_RUN detected — skipping to deploy. PR: ${prUrl}`);
          await runDeploymentOnly(
            this.config, this.resilience, this.gitOps, this.ticketOps,
            prUrl, prNumber, this.serverPromptTemplates,
            {
              setDeploymentSucceeded: () => { this.deploymentSucceeded = true; },
              setMissionActive: (active) => { this.missionActive = active; },
            }
          );
          return;
        } else {
          console.warn("[Epic] DEPLOYMENT_RUN detected but no PR found — falling back to full run");
        }
      }

      // Fast path: review-only run
      if (taskNotes.includes("REVIEW_RUN")) {
        const prUrl = this.currentPrUrl || process.env.EXISTING_PR_URL;
        const prNumber = this.currentPrNumber || parseInt(process.env.EXISTING_PR_NUMBER || "0", 10);

        if (prUrl && prNumber) {
          console.log(`[Epic] REVIEW_RUN detected — running review on PR: ${prUrl}`);
          const needsRevision = await runReviewOnly(
            this.config, this.resilience, this.coordination, this.decisionClient,
            this.gitOps, this.ticketOps, prUrl, prNumber, this.serverPromptTemplates,
            {
              setRevisionCount: (count) => { this.revisionCount = count; },
              setLastReviewFeedback: (feedback) => { this.lastReviewFeedback = feedback; },
              setMissionActive: (active) => { this.missionActive = active; },
              setReviewFeedback: (feedback) => { this.config.reviewFeedback = feedback; },
            }
          );
          if (!needsRevision) {
            return;
          }
          console.log("[Epic] REVIEW_RUN: Revision needed, entering full coordination loop...");
        } else {
          console.warn("[Epic] REVIEW_RUN detected but no PR found — falling back to full run");
        }
      }

      await this.retrieveMemoryContext();
      await this.fetchTicketFromSource();
      if (!this.config.jiraRequirements) {
        await this.fetchJiraRequirements();
      }

      await this.ticketOps.transitionTo("In Progress");

      if (process.env.TICKET_SYSTEM === "github") {
        const model = process.env.CLAUDE_MODEL || process.env.WORKER_MODEL || "unknown";
        const branch = `feature/${this.config.jiraIssueKey?.toLowerCase() || "unknown"}`;
        await this.ticketOps.postComment(
          GitHubCommentFormat.workStarted(model, branch),
        );
      }

      this.coordination.connectSse();

      // Main coordination loop with transient error resilience
      let consecutiveErrors = 0;
      const MAX_CONSECUTIVE_ERRORS = 5;
      while (this.missionActive) {
        try {
          await this.coordinationLoop();
          consecutiveErrors = 0;
        } catch (loopError) {
          consecutiveErrors++;
          const transient = isTransientError(loopError);

          if (transient && consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
            const backoffMs = Math.min(consecutiveErrors * 5000, 30000);
            const errMsg = loopError instanceof Error ? loopError.message : String(loopError);
            console.warn(
              `[Epic] Transient error in coordination loop (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}), ` +
              `retrying in ${Math.round(backoffMs / 1000)}s: ${errMsg}`
            );
            this.postDashboardLog(
              `⚠️ Transient error (attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}), retrying...`
            );
            await sleep(backoffMs);
            continue;
          }

          if (transient && this.hasAnyCommittedCode) {
            const errMsg = loopError instanceof Error ? loopError.message : String(loopError);
            console.warn(
              `[Epic] ${MAX_CONSECUTIVE_ERRORS} consecutive transient errors, but code is committed on remote branches. Exiting gracefully.`
            );
            this.postDashboardLog(
              `⚠️ Coordination API unreachable after ${MAX_CONSECUTIVE_ERRORS} attempts, but all committed code is safely on remote branches. Stopping gracefully.`
            );
            try {
              await this.updateTaskStatus(
                "escalated",
                `Coordination API unreachable — code is on remote branches`,
                `${MAX_CONSECUTIVE_ERRORS} consecutive transient errors: ${errMsg}`,
                this.currentPrUrl
              );
            } catch {
              // Best-effort
            }
            this.missionActive = false;
            continue;
          }

          if (transient) {
            console.error(`[Epic] ${MAX_CONSECUTIVE_ERRORS} consecutive transient errors — giving up`);
          }
          throw loopError;
        }

        if (this.coordination.isSseConnected()) {
          let onNewData: (() => void) | undefined;
          const newDataPromise = new Promise<void>((resolve) => {
            onNewData = resolve;
            this.coordination.once("newData", resolve);
          });
          await Promise.race([newDataPromise, sleep(30000)]);
          if (onNewData) this.coordination.removeListener("newData", onNewData);
        } else {
          await sleep(this.pollIntervalMs);
        }
      }
    } catch (error) {
      console.error("[Epic] Fatal error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      try {
        const failureComment = process.env.TICKET_SYSTEM === "github"
          ? GitHubCommentFormat.failed(errorMessage, 0)
          : this.hasAnyCommittedCode
            ? `Epic failed: ${errorMessage} — committed code is on remote branches`
            : `Epic failed: ${errorMessage}`;
        await this.ticketOps.postComment(failureComment);
      } catch {
        // Don't let comment failure mask the real error
      }

      try {
        await this.updateTaskStatus(
          "failed",
          undefined,
          this.hasAnyCommittedCode
            ? `Epic failed: ${errorMessage} — committed code is on remote branches`
            : `Epic failed: ${errorMessage}`
        );
      } catch {
        // Don't let status update failure mask the real error
      }
      throw error;
    }
  }

  /**
   * Stop the Epic executor.
   */
  stop(): void {
    console.log("[Epic] Stopping Epic executor");
    this.missionActive = false;
    this.coordination.disconnectSse();
  }

  /**
   * Graceful shutdown: save work and post status before exiting.
   */
  async gracefulShutdown(): Promise<void> {
    if (!this.resilience.gracefulShutdownEnabled) {
      console.log("[Epic] Graceful shutdown disabled - stopping immediately");
      this.stop();
      return;
    }

    console.log("[Epic] Initiating graceful shutdown...");
    this.missionActive = false;

    try {
      const worktreePaths = Array.from(this.activeWorktrees.entries());
      for (const [storyIndex, worktreePath] of worktreePaths) {
        console.log(`[Epic] Saving work for story ${storyIndex}...`);
        try {
          const branchName = this.storyBranchNames.get(storyIndex) || `story/${(this.config.jiraIssueKey || "epic").toLowerCase()}/${storyIndex}`;
          const commitSha = await this.gitOps.commitUncommittedWork(
            worktreePath,
            `WIP: Interrupted - graceful shutdown`
          );
          if (commitSha) {
            console.log(`[Epic] Committed WIP for story ${storyIndex}: ${commitSha}`);
            await this.gitOps.pushBranchFromWorktree(worktreePath, branchName);
            console.log(`[Epic] Pushed story ${storyIndex} to remote`);
          }
        } catch (e) {
          console.warn(`[Epic] Failed to save story ${storyIndex}:`, e);
        }
      }

      await this.coordination.postContext(
        "blocker",
        "Container shutting down - work saved to remote branches",
        "system",
        this.config.parentTaskId,
        {
          shutdownReason: "graceful_shutdown",
          savedStories: Array.from(this.activeWorktrees.keys()),
          completedStories: Array.from(this.completedStoryIndices),
        }
      );

      console.log("[Epic] Graceful shutdown complete");
    } catch (error) {
      console.error("[Epic] Error during graceful shutdown:", error);
    }
  }

  /**
   * Get current expert states.
   */
  getExpertStates(): Map<ExpertPersona, ExpertState> {
    return new Map(this.expertStates);
  }

  /**
   * Check if mission is active.
   */
  isActive(): boolean {
    return this.missionActive;
  }

  /**
   * Get the current memory context (for external access if needed).
   */
  getMemoryContext(): MemoryContext | null {
    return this.memoryContext;
  }

  trackWorktree(storyIndex: number, worktreePath: string): void {
    this.activeWorktrees.set(storyIndex, worktreePath);
  }

  untrackWorktree(storyIndex: number): void {
    this.activeWorktrees.delete(storyIndex);
  }

  /**
   * Get and clear any pending user feedback.
   */
  getUserFeedback(): string | null {
    const feedback = this.userFeedback;
    this.userFeedback = null;
    return feedback;
  }

  // =============================================================================
  // Coordination Loop
  // =============================================================================

  /**
   * Main coordination loop iteration.
   */
  private async coordinationLoop(): Promise<void> {
    // Proactive conflict detection: scan worktrees every 3rd iteration
    this.loopIterationCount++;
    if (this.loopIterationCount % 3 === 0) {
      scanRunningWorktrees(
        this.config, this.expertStates, this.activeWorktrees,
        this.runningStoryTargetFiles, this.gitOps
      );
    }

    // 0. Check for dashboard commands
    await pollForCommands(
      this.config, this.expertStates, this.activeWorktrees,
      this.resilience, this.coordination, this.missionActive,
      {
        setUserFeedback: (fb) => { this.userFeedback = fb; },
        getUserFeedback: () => this.getUserFeedback(),
        waitForResume: () => waitForResume(
          this.config, this.coordination,
          () => this.missionActive,
          (fb) => { this.userFeedback = fb; }
        ),
        setSelfReviewEnabled: (enabled) => { this.resilience.selfReviewEnabled = enabled; },
      }
    );

    // 0.1. Check for expert responses
    await checkExpertResponses(
      this.config, this.expertStates, this.activeWorktrees, this.coordination
    );

    this.coordination.startIteration();

    // 0.2. Check for expert execution timeouts (safety net for stuck experts)
    await this.checkExpertTimeouts();

    // 0.5. Check for blockers
    const blockerHandled = await this.checkAndHandleBlockers();
    if (blockerHandled) return;

    // 1. Answer-first workflow
    await processAnswerFirst(
      this.config, this.expertStates, this.activeWorktrees,
      this.coordination, this.decisionClient, this.executor,
      this.inFlightQuickAnswers
    );

    // 2. Process ready stories
    await this.processReadyStories();

    // 3. Route questions
    await processQuestions(
      this.config, this.expertStates, this.activeWorktrees,
      this.coordination, this.decisionClient, this.executor,
      this.inFlightQuickAnswers
    );

    // 4. Check per-story completions (review)
    await this.checkCompletions();

    // 5. Check if all stories are done
    await this.checkMissionComplete();
  }

  // =============================================================================
  // Initialization & Setup
  // =============================================================================

  private async initializeWithResume(): Promise<void> {
    console.log("[Epic] Checking for existing completions (resume mode)...");

    try {
      const completions = await this.coordination.getCurrentRevisionCompletions();

      for (const completion of completions) {
        const storyIndex = completion.metadata?.storyIndex as number;
        if (storyIndex !== undefined) {
          this.completedStoryIndices.add(storyIndex);
        }
      }

      if (this.completedStoryIndices.size > 0) {
        const indices = Array.from(this.completedStoryIndices).sort((a, b) => a - b);
        console.log(`[Epic] Found ${this.completedStoryIndices.size} already-completed stories: ${indices.join(", ")}`);
        console.log("[Epic] These stories will be skipped on resume");
      } else {
        console.log("[Epic] No previously completed stories found - starting fresh");
      }

      const claims = await this.coordination.getContextsByTypes(["story_claimed"]);
      const staleClaims = claims.filter((c) => {
        const idx = c.metadata?.storyIndex as number;
        return idx !== undefined && !this.completedStoryIndices.has(idx);
      });
      if (staleClaims.length > 0) {
        const staleIndices = staleClaims.map((c) => c.metadata?.storyIndex as number);
        console.log(`[Epic] Found ${staleClaims.length} stale claims: ${staleIndices.join(", ")}`);
        console.log("[Epic] Archiving stale claims so stories can be re-claimed...");
        await this.coordination.archiveStoryClaims(staleIndices);
        console.log("[Epic] Stale claims archived");
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.log("[Epic] ⚠️ Failed to check for existing completions: " + errMsg);
      this.postLog(`⚠️ Resume check failed: ${errMsg} — stale claims may cause retry loops`);
    }
  }

  private async retrieveMemoryContext(): Promise<void> {
    console.log("[Epic] Retrieving memory context for task (with Codebase RAG)...");

    try {
      const taskDescription = this.config.taskSummary || this.config.jiraIssueKey || "";
      const codebaseEnabled = process.env.CODEBASE_INDEXING_ENABLED === "true";

      if (codebaseEnabled && this.config.targetRepo) {
        const [memContext, codeResult] = await Promise.all([
          this.memoryClient.getMemoryContext(
            this.config.parentTaskId,
            taskDescription,
            { repository: this.config.targetRepo, limit: 5 }
          ),
          this.memoryClient.getCodeContext(
            this.config.targetRepo,
            taskDescription,
            { limit: 10 }
          ),
        ]);

        this.memoryContext = memContext;
        this.enhancedContext = {
          skills: memContext.skills,
          semanticMemories: memContext.semanticMemories,
          episodicMemories: memContext.episodicMemories,
          codeSnippets: codeResult?.snippets || [],
          formattedContext: memContext.formattedContext,
          skillCount: memContext.skills.length,
          codeSnippetCount: codeResult?.totalSnippets || 0,
          retrievedAt: memContext.retrievedAt,
        };

        const skillCount = memContext.skills.length;
        const codeCount = codeResult?.totalSnippets || 0;
        const semanticCount = memContext.semanticMemories.length;
        const episodicCount = memContext.episodicMemories.length;

        console.log(
          `[Epic] Enhanced context retrieved: ${skillCount} skills, ${codeCount} code snippets, ${semanticCount} patterns, ${episodicCount} experiences`
        );

        if (memContext.formattedContext) {
          this.config.memoryContext = memContext.formattedContext;
        }
        if (codeResult?.formattedText) {
          this.config.codeContext = codeResult.formattedText;
        }
      } else {
        this.memoryContext = await this.memoryClient.getMemoryContext(
          this.config.parentTaskId,
          taskDescription,
          { repository: this.config.targetRepo, limit: 5 }
        );

        if (this.memoryContext.formattedContext) {
          const skillCount = this.memoryContext.skills.length;
          const semanticCount = this.memoryContext.semanticMemories.length;
          const episodicCount = this.memoryContext.episodicMemories.length;

          console.log(`[Epic] Memory context retrieved: ${skillCount} skills, ${semanticCount} patterns, ${episodicCount} experiences`);
          this.config.memoryContext = this.memoryContext.formattedContext;
        } else {
          console.log("[Epic] No relevant memory context found");
        }
      }
    } catch (error) {
      console.log("[Epic] Memory retrieval failed (non-fatal):", error instanceof Error ? error.message : error);
    }
  }

  private async fetchJiraRequirements(): Promise<void> {
    try {
      const taskUrl = `${this.config.apiBaseUrl}/api/tasks/${this.config.parentTaskId}`;
      const response = await axios.get(taskUrl, {
        headers: { "x-api-key": this.config.orgApiKey },
        timeout: 10000,
      });

      const task = response.data;
      if (task.summary || task.description) {
        const parts: string[] = [];
        if (task.summary) parts.push(`**Summary:** ${task.summary}`);
        if (task.description) parts.push(`**Description:**\n${task.description}`);
        this.config.jiraRequirements = parts.join("\n\n");
        console.log(`[Epic] Loaded Jira requirements (${this.config.jiraRequirements.length} chars)`);
      }
    } catch (error) {
      console.warn("[Epic] Failed to fetch Jira requirements:", error instanceof Error ? error.message : error);
    }
  }

  private async fetchTicketFromSource(): Promise<void> {
    const ticketKey = this.config.jiraIssueKey;
    const system = this.config.ticketSystem;
    if (!ticketKey) return;

    if (system === "linear") {
      this.config.ticketUrl = `https://linear.app/issue/${ticketKey}`;
      const apiKey = process.env.LINEAR_API_KEY;
      if (!apiKey) {
        console.log("[Epic] No LINEAR_API_KEY — skipping direct ticket fetch");
        return;
      }

      try {
        const query = `
          query GetIssue($identifier: String!) {
            issue(id: $identifier) {
              title
              description
              url
              labels { nodes { name } }
              comments { nodes { body, user { name } } }
            }
          }
        `;

        const response = await axios.post(
          "https://api.linear.app/graphql",
          { query, variables: { identifier: ticketKey } },
          {
            headers: { Authorization: apiKey, "Content-Type": "application/json" },
            timeout: 10000,
          },
        );

        const issue = response.data?.data?.issue;
        if (issue) {
          const parts: string[] = [];
          if (issue.title) parts.push(`**Title:** ${issue.title}`);
          if (issue.description) parts.push(`**Description:**\n${issue.description}`);
          if (issue.labels?.nodes?.length > 0) {
            parts.push(`**Labels:** ${issue.labels.nodes.map((l: any) => l.name).join(", ")}`);
          }
          if (issue.comments?.nodes?.length > 0) {
            const comments = issue.comments.nodes.slice(-5);
            const commentText = comments
              .map((c: any) => `  - [${c.user?.name || "Unknown"}]: ${c.body}`)
              .join("\n");
            parts.push(`**Recent Comments:**\n${commentText}`);
          }
          if (issue.url) this.config.ticketUrl = issue.url;
          this.config.jiraRequirements = parts.join("\n\n");
          console.log(`[Epic] Fetched ticket directly from Linear (${this.config.jiraRequirements.length} chars)`);
        }
      } catch (error) {
        console.warn("[Epic] Direct Linear fetch failed, falling back to API copy:",
          error instanceof Error ? error.message : error);
      }
    } else if (system === "github") {
      this.config.ticketUrl = `https://github.com/${this.config.targetRepo}/issues/${ticketKey.replace(/\D/g, "")}`;
    }
  }

  // =============================================================================
  // Blocker Handling
  // =============================================================================

  private async checkAndHandleBlockers(): Promise<boolean> {
    if (!this.blockerManager) return false;

    const blocker = await this.blockerManager.checkForBlockers();
    if (!blocker) return false;

    console.log(`[Epic] ⚠️ BLOCKER DETECTED for story ${blocker.storyIndex}: ${blocker.errorCategory}`);
    console.log(`[Epic] Error: ${blocker.errorMessage.substring(0, 200)}...`);

    if (blocker.dependentStories.length > 0) {
      for (const depIndex of blocker.dependentStories) {
        this.blockedStoryIndices.add(depIndex);
      }
      console.log(`[Epic] Blocked dependent stories: ${blocker.dependentStories.join(", ")}`);
    }

    await this.updateTaskStatus(
      "escalated",
      `Story ${blocker.storyIndex} — blocked: ${blocker.errorCategory}`,
      blocker.errorMessage
    );

    const blockerTimeout = this.resilience.blockerWaitTimeoutMs;
    console.log(`[Epic] Waiting for human resolution (timeout: ${Math.round(blockerTimeout / 60_000)}min)...`);
    const response = await this.blockerManager.waitForBlockerResponse(blocker, blockerTimeout);

    if (!response) {
      console.log(`[Epic] Blocker resolution timed out - aborting mission`);
      this.missionActive = false;
      await this.updateTaskStatus("failed", undefined, "Blocker resolution timed out");
      return true;
    }

    await this.handleBlockerResponse(response, blocker);
    return true;
  }

  private async handleBlockerResponse(
    response: { action: "retry" | "skip" | "abort"; guidance?: string },
    blocker: { storyIndex: number; dependentStories: number[] }
  ): Promise<void> {
    console.log(`[Epic] Blocker resolved with action: ${response.action}`);

    switch (response.action) {
      case "retry":
        if (this.blockerManager?.hasExhaustedRetries(blocker.storyIndex)) {
          console.log(`[Epic] Story ${blocker.storyIndex} exhausted retries — auto-skipping`);
          this.completedStoryIndices.add(blocker.storyIndex);
          this.failedStoryIndices.delete(blocker.storyIndex);
          for (const depIndex of blocker.dependentStories) {
            this.completedStoryIndices.add(depIndex);
            this.blockedStoryIndices.delete(depIndex);
          }
          await this.updateTaskStatus("running", `Story ${blocker.storyIndex} auto-skipped (retries exhausted)`);
          break;
        }
        this.failedStoryIndices.delete(blocker.storyIndex);
        this.completedStoryIndices.delete(blocker.storyIndex);
        if (response.guidance) {
          this.userFeedback = response.guidance;
          console.log(`[Epic] Retry guidance: ${response.guidance}`);
        }
        for (const depIndex of blocker.dependentStories) {
          this.blockedStoryIndices.delete(depIndex);
        }
        {
          const allStories = await this.coordination.getReadyStories();
          const storyToRetry = allStories.find((s) => s.storyIndex === blocker.storyIndex);
          if (storyToRetry) {
            this.revisionStoriesQueued.push(storyToRetry);
            console.log(`[Epic] Re-queued story ${blocker.storyIndex} for revision execution`);
          } else {
            console.warn(`[Epic] Could not find story ${blocker.storyIndex} in ready stories`);
          }
        }
        await this.updateTaskStatus("running", `Retrying story ${blocker.storyIndex}`);
        break;

      case "skip":
        this.completedStoryIndices.add(blocker.storyIndex);
        this.failedStoryIndices.delete(blocker.storyIndex);
        console.log(`[Epic] Skipping story ${blocker.storyIndex} and all dependents`);
        for (const depIndex of blocker.dependentStories) {
          this.completedStoryIndices.add(depIndex);
          this.blockedStoryIndices.delete(depIndex);
          console.log(`[Epic] Skipping dependent story ${depIndex}`);
        }
        await this.updateTaskStatus("running", `Skipped story ${blocker.storyIndex}, continuing...`);
        break;

      case "abort":
        console.log(`[Epic] Aborting mission per user request`);
        this.missionActive = false;
        await this.updateTaskStatus("failed", undefined, "Aborted by user due to blocker");
        break;
    }
  }

  // =============================================================================
  // Expert Timeout Detection
  // =============================================================================

  /**
   * Detect experts stuck in "working" state beyond a safe threshold.
   * Safety net for cases where the async story execution hangs without
   * throwing (e.g., Ollama model unload, dropped connection).
   */
  private async checkExpertTimeouts(): Promise<void> {
    const EXPERT_TIMEOUT_MS = 45 * 60 * 1000; // 45 minutes

    for (const [persona, state] of this.expertStates) {
      if (state.status !== "working" || !state.startedAt) continue;

      const elapsed = Date.now() - state.startedAt.getTime();
      if (elapsed < EXPERT_TIMEOUT_MS) continue;

      const elapsedMin = Math.round(elapsed / 60_000);
      console.error(`[Epic] Expert ${persona} stuck in "working" for ${elapsedMin}min — forcing failure`);

      const storyIndex = state.currentStoryIndex;
      const storyId = state.currentStoryId;

      // Transition expert to blocked
      this.expertStates.set(persona, {
        persona,
        status: "blocked",
        currentStoryId: storyId,
        currentStoryIndex: storyIndex,
      });

      if (storyIndex !== undefined) {
        this.failedStoryIndices.add(storyIndex);

        // Unregister from mutex/file-overlap tracking
        unregisterRunningStory(storyIndex, this.runningStoryMutexGroups, this.runningStoryTargetFiles);

        // Clean up orphaned worktree
        if (this.activeWorktrees.has(storyIndex)) {
          const worktreePath = this.activeWorktrees.get(storyIndex)!;
          try {
            await this.gitOps.forceRemoveWorktree(worktreePath);
          } catch {
            // Ignore cleanup errors
          }
          this.activeWorktrees.delete(storyIndex);
        }
      }

      const errorMsg = `Expert ${persona} timed out after ${elapsedMin} minutes — execution appears stuck`;
      await this.postLog(errorMsg, "error");
      this.postDashboardLog(errorMsg);

      // Post blocker to coordination feed
      await this.coordination.postContext(
        "blocker",
        errorMsg,
        persona,
        this.config.parentTaskId,
        {
          storyIndex,
          storyTitle: `Story ${storyIndex}`,
          persona,
          errorCategory: "unknown",
          summary: errorMsg,
          isEscalated: true,
          isFixable: false,
        },
        `${persona}-story-${storyIndex}`
      );

      // Reset expert to idle after delay so coordinator can continue
      setTimeout(() => {
        this.expertStates.set(persona, { persona, status: "idle" });
      }, 2000);
    }
  }

  // =============================================================================
  // Story Processing (delegates to coordinator-stories.ts)
  // =============================================================================

  private async processReadyStories(): Promise<void> {
    // First, check if we have revision stories queued
    if (this.revisionStoriesQueued.length > 0) {
      await this.processRevisionStories();
      return;
    }

    const readyStories = await this.coordination.getReadyStories();

    // Update completed stories from coordination feed
    const completions = await this.coordination.getCurrentRevisionCompletions();
    for (const c of completions) {
      const storyIndex = c.metadata?.storyIndex as number;
      if (storyIndex !== undefined && !this.completedStoryIndices.has(storyIndex)) {
        this.completedStoryIndices.add(storyIndex);
        console.log(`[Epic] Story ${storyIndex} completed`);
      }
    }

    if (this.totalStories === 0 && readyStories.length > 0) {
      const maxIndex = Math.max(...readyStories.map(s => s.storyIndex), 0);
      this.totalStories = maxIndex + 1;
      console.log(`[Epic] Total stories in Epic: ${this.totalStories}`);
    }

    console.log(`[Epic] Processing ${readyStories.length} ready stories...`);
    for (const story of readyStories) {
      if (this.completedStoryIndices.has(story.storyIndex)) continue;
      if (this.blockedStoryIndices.has(story.storyIndex)) continue;
      if (this.failedStoryIndices.has(story.storyIndex)) continue;

      console.log(`[Epic] Checking story ${story.storyIndex}: persona=${story.persona}, id=${story.id}`);

      if (story.dependencies && story.dependencies.length > 0) {
        const unmetDeps = story.dependencies.filter(
          (depIndex) => !this.completedStoryIndices.has(depIndex)
        );
        if (unmetDeps.length > 0) {
          console.log(`[Epic] Story ${story.storyIndex} blocked - waiting for dependencies: ${unmetDeps.join(", ")}`);
          continue;
        }
      }

      if (hasMutexConflict(story, this.runningStoryMutexGroups)) continue;
      if (hasFileOverlap(this.config, story, this.resilience, this.runningStoryTargetFiles)) continue;

      const expertPersona = matchPersonaToExpert(story.persona);
      if (!expertPersona) {
        console.log("[Epic] No expert match for persona: " + story.persona);
        continue;
      }
      console.log(`[Epic] Matched to expert: ${expertPersona}`);

      const expertState = this.expertStates.get(expertPersona);
      console.log(`[Epic] Expert state: ${JSON.stringify(expertState)}`);
      if (!expertState || expertState.status !== "idle") {
        console.log(`[Epic] Expert ${expertPersona} not available (state: ${expertState?.status || 'undefined'})`);
        continue;
      }

      let claimResult: Awaited<ReturnType<typeof this.coordination.claimStory>>;
      try {
        claimResult = await this.coordination.claimStory(story.id, expertPersona);
      } catch (claimError) {
        const msg = claimError instanceof Error ? claimError.message : String(claimError);
        console.log(`[Epic] ⚠️ Claim threw for story ${story.storyIndex}: ${msg}`);
        this.postLog(`⚠️ Claim error for story ${story.storyIndex}: ${msg}`);
        continue;
      }
      if (!claimResult.success) {
        if (claimResult.alreadyClaimed && !this.completedStoryIndices.has(story.storyIndex)) {
          console.log(`[Epic] Story ${story.storyIndex} has stale claim — archiving`);
          this.postLog(`Archiving stale claim for story ${story.storyIndex} — will retry`);
          try {
            await this.coordination.archiveStoryClaims([story.storyIndex]);
          } catch (archiveErr) {
            console.log(`[Epic] Failed to archive stale claim: ${archiveErr instanceof Error ? archiveErr.message : String(archiveErr)}`);
          }
        } else {
          console.log(`[Epic] Claim failed for story ${story.storyIndex}`);
        }
        continue;
      }

      console.log("[Epic] " + expertPersona + " claimed story " + story.storyIndex);

      registerRunningStory(story.storyIndex, story.mutexGroups || [], story.targetFiles,
        this.runningStoryMutexGroups, this.runningStoryTargetFiles);

      this.expertStates.set(expertPersona, {
        persona: expertPersona,
        status: "working",
        currentStoryId: story.id,
        currentStoryIndex: story.storyIndex,
        startedAt: new Date(),
      });

      const feedback = this.getUserFeedback();
      if (feedback) {
        console.log(`[Epic] Passing user feedback to ${expertPersona}: "${feedback.substring(0, 50)}..."`);
        this.postLog(`Applying user feedback to story ${story.storyIndex}: ${story.title || "(untitled)"}`);
      }

      // Fire-and-forget: expert executes story in parallel
      executeStoryAsync(
        this.config, this.resilience, story, expertPersona, this.totalStories,
        this.executor, this.coordination, this.gitOps, this.blockerManager,
        this.expertStates, this.activeWorktrees, this.storyBranchNames,
        this.storyBaselineShas, this.storyDepConflicts,
        this.completedStoryIndices, this.locallyCompletedStoryIndices,
        this.failedStoryIndices, this.blockedStoryIndices,
        this.runningStoryMutexGroups, this.runningStoryTargetFiles,
        this.rateLimitRetries, this.accumulatedLearnings,
        { setHasAnyCommittedCode: () => { this.hasAnyCommittedCode = true; } },
        feedback || undefined
      );
    }
  }

  private async processRevisionStories(): Promise<void> {
    const completions = await this.coordination.getCurrentRevisionCompletions();
    for (const c of completions) {
      const storyIndex = c.metadata?.storyIndex as number;
      if (storyIndex !== undefined) {
        this.completedStoryIndices.add(storyIndex);
      }
    }

    const dispatched: number[] = [];

    for (const story of this.revisionStoriesQueued) {
      if (story.dependencies && story.dependencies.length > 0) {
        const unmetDeps = story.dependencies.filter(
          (depIndex) => !this.completedStoryIndices.has(depIndex)
        );
        if (unmetDeps.length > 0) {
          if (!this.loggedBlockedStories.has(story.storyIndex)) {
            console.log(`[Epic] Revision story ${story.storyIndex} blocked - waiting for dependencies: ${unmetDeps.join(", ")}`);
            this.loggedBlockedStories.add(story.storyIndex);
          }
          continue;
        }
      }

      if (hasMutexConflict(story, this.runningStoryMutexGroups)) continue;
      if (hasFileOverlap(this.config, story, this.resilience, this.runningStoryTargetFiles)) continue;

      const expertPersona = matchPersonaToExpert(story.persona);
      if (!expertPersona) continue;

      const expertState = this.expertStates.get(expertPersona);
      if (!expertState || expertState.status !== "idle") continue;

      dispatched.push(story.storyIndex);

      console.log(`[Epic] ${expertPersona} executing revision for story ${story.storyIndex}`);

      registerRunningStory(story.storyIndex, story.mutexGroups || [], story.targetFiles,
        this.runningStoryMutexGroups, this.runningStoryTargetFiles);

      this.expertStates.set(expertPersona, {
        persona: expertPersona,
        status: "working",
        currentStoryId: story.id,
        currentStoryIndex: story.storyIndex,
        startedAt: new Date(),
      });

      const revisionFeedback = this.getUserFeedback();
      if (revisionFeedback) {
        console.log(`[Epic] Passing user feedback to ${expertPersona} (revision): "${revisionFeedback.substring(0, 50)}..."`);
        this.postLog(`Applying user feedback to revision story ${story.storyIndex}: ${story.title || "(untitled)"}`);
      }

      executeStoryAsync(
        this.config, this.resilience, story, expertPersona, this.totalStories,
        this.executor, this.coordination, this.gitOps, this.blockerManager,
        this.expertStates, this.activeWorktrees, this.storyBranchNames,
        this.storyBaselineShas, this.storyDepConflicts,
        this.completedStoryIndices, this.locallyCompletedStoryIndices,
        this.failedStoryIndices, this.blockedStoryIndices,
        this.runningStoryMutexGroups, this.runningStoryTargetFiles,
        this.rateLimitRetries, this.accumulatedLearnings,
        { setHasAnyCommittedCode: () => { this.hasAnyCommittedCode = true; } },
        revisionFeedback || undefined
      );
    }

    if (dispatched.length > 0) {
      this.revisionStoriesQueued = this.revisionStoriesQueued.filter(
        (s) => !dispatched.includes(s.storyIndex)
      );
    }
  }

  // =============================================================================
  // Per-Story Review (checkCompletions)
  // =============================================================================

  private async checkCompletions(): Promise<void> {
    if (!this.config.reviewEnabled) return;
    if (this.maxPerStoryRevisions <= 0) return;

    for (const storyIndex of this.completedStoryIndices) {
      if (this.reviewedStoryIndices.has(storyIndex)) continue;

      const conflicts = this.storyDepConflicts.get(storyIndex);
      if (conflicts && conflicts.length > 0) {
        console.log(`[Epic] Skipping per-story review for story ${storyIndex} — ${conflicts.length} dependency merge conflict(s)`);
        this.postDashboardLog(`Story ${storyIndex} review skipped (dependency merge conflicts)`);
        this.reviewedStoryIndices.add(storyIndex);
        continue;
      }

      const branchName = this.storyBranchNames.get(storyIndex);
      const worktreePath = this.activeWorktrees.get(storyIndex);
      if (!branchName || !worktreePath) continue;

      const readyStories = await this.coordination.getReadyStories();
      const story = readyStories.find((s) => s.storyIndex === storyIndex);
      if (!story) {
        this.reviewedStoryIndices.add(storyIndex);
        continue;
      }

      const revisionCount = this.storyRevisionCounts.get(storyIndex) || 0;
      console.log(`[Epic] Reviewing story ${storyIndex} on branch ${branchName}...`);
      this.postDashboardLog(`Reviewing story ${storyIndex}: ${story.title}`);

      try {
        const reviewer = new InlineReviewer(this.config, worktreePath, this.serverPromptTemplates?.techLeadReviewPrompt);
        const storyContext = {
          storyIndex: story.storyIndex,
          title: story.title,
          description: story.description,
          totalStories: this.totalStories,
          targetFiles: story.targetFiles,
        };
        const baselineSha = this.storyBaselineShas.get(storyIndex);

        const storyContexts = await this.coordination.getContextsByTypes([
          "decision", "progress", "completion", "answer", "file_created", "file_modified",
        ]);
        const storyMessages = storyContexts
          .filter((ctx) => (ctx.metadata?.storyIndex as number) === storyIndex)
          .map((ctx) => `[${ctx.messageType}] ${ctx.persona}: ${ctx.content}`)
          .join("\n");

        const reviewResult = await reviewer.reviewBranch(
          branchName, storyIndex, revisionCount,
          revisionCount > 0 ? this.config.reviewFeedback : undefined,
          storyContext, baselineSha, storyMessages || undefined
        );

        if (!reviewResult.success) {
          console.warn(`[Epic] Story ${storyIndex} review failed: ${reviewResult.error} — approving by default`);
          this.reviewedStoryIndices.add(storyIndex);
          continue;
        }

        if (reviewResult.decision === "approved") {
          console.log(`[Epic] Story ${storyIndex} approved (score: ${reviewResult.codeQualityScore}/10)`);
          this.postDashboardLog(`Story ${storyIndex} approved by Tech Lead (score: ${reviewResult.codeQualityScore}/10)`);
          await this.coordination.postContext(
            "decision",
            `✅ Story ${storyIndex} approved (score: ${reviewResult.codeQualityScore}/10)`,
            "tech_lead"
          ).catch(() => {});
          this.reviewedStoryIndices.add(storyIndex);
        } else if (reviewResult.decision === "revision_needed") {
          const newCount = revisionCount + 1;
          this.storyRevisionCounts.set(storyIndex, newCount);

          if (newCount >= this.maxPerStoryRevisions) {
            console.log(`[Epic] Story ${storyIndex} max per-story revisions reached — approving`);
            this.postDashboardLog(`Story ${storyIndex} max per-story revisions reached — approving`);
            this.reviewedStoryIndices.add(storyIndex);
            continue;
          }

          console.log(`[Epic] Story ${storyIndex} needs revision (${newCount}/${this.maxPerStoryRevisions}): ${reviewResult.feedback}`);
          this.postDashboardLog(`Story ${storyIndex} revision ${newCount}/${this.maxPerStoryRevisions} requested`);

          this.config.reviewFeedback = reviewResult.feedback;

          // Attempt inline review fix on the existing worktree
          let inlineFixSucceeded = false;
          const existingWorktree = this.activeWorktrees.get(storyIndex);
          if (existingWorktree && reviewResult.feedback) {
            try {
              console.log(`[Epic] Attempting inline review fix for story ${storyIndex}...`);
              this.postDashboardLog(`Story ${storyIndex} — attempting inline review fix`);

              const reviewFixer = new InlineReviewFixer(
                this.config, existingWorktree, reviewResult.feedback,
                story.persona, story.title,
              );
              const fixResult = await reviewFixer.fix();

              if (fixResult.success) {
                console.log(`[Epic] Inline review fix succeeded for story ${storyIndex}: ${fixResult.summary}`);

                const storyBranch = this.storyBranchNames.get(storyIndex);
                if (existingWorktree && storyBranch) {
                  try {
                    await this.gitOps.pushBranchFromWorktree(existingWorktree, storyBranch);
                  } catch {
                    // Push may fail if agent already pushed
                  }
                }

                this.postDashboardLog(`Story ${storyIndex} review fix applied — re-entering review cycle`);
                inlineFixSucceeded = true;
                this.completedStoryIndices.add(storyIndex);
                await this.coordination.postRevisionRequest(newCount, reviewResult.feedback);
              } else {
                console.log(`[Epic] Inline review fix failed for story ${storyIndex}: ${fixResult.summary}`);
                this.postDashboardLog(`Story ${storyIndex} inline fix failed — falling back to full re-execution`);
              }
            } catch (e) {
              console.warn(`[Epic] Inline review fix error for story ${storyIndex}: ${e}`);
            }
          }

          // Fallback: destructive delete-and-requeue
          if (!inlineFixSucceeded) {
            this.completedStoryIndices.delete(storyIndex);
            await this.coordination.archiveStoryClaims([storyIndex]);

            try {
              const storyBranch = this.storyBranchNames.get(storyIndex);
              if (storyBranch) {
                const fallbackWorktree = this.activeWorktrees.get(storyIndex);
                if (fallbackWorktree) {
                  await this.gitOps.forceRemoveWorktree(fallbackWorktree);
                  this.activeWorktrees.delete(storyIndex);
                }
                const repoPath = this.gitOps.getRepoPath();
                execSync(`git -C "${repoPath}" branch -D "${storyBranch}" 2>/dev/null || true`);
                execSync(`git -C "${repoPath}" push origin --delete "${storyBranch}" 2>/dev/null || true`);
                this.storyBranchNames.delete(storyIndex);
              }
            } catch (e) {
              console.warn(`[Epic] Could not clean up story ${storyIndex} worktree/branch: ${e}`);
            }

            await this.coordination.postRevisionRequest(newCount, reviewResult.feedback);

            const allStories = await this.coordination.getReadyStories();
            const storyToRevise = allStories.find((s) => s.storyIndex === storyIndex);
            if (storyToRevise) {
              this.revisionStoriesQueued.push(storyToRevise);
            }
          }
        } else {
          console.warn(`[Epic] Story ${storyIndex} rejected — approving to continue`);
          this.reviewedStoryIndices.add(storyIndex);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[Epic] Story ${storyIndex} review error: ${msg} — approving by default`);
        this.reviewedStoryIndices.add(storyIndex);
      }
    }
  }

  // =============================================================================
  // Mission Completion (checkMissionComplete)
  // =============================================================================

  private async checkMissionComplete(): Promise<void> {
    const contexts = await this.coordination.getContextsByTypes(["story_ready", "story_claimed"]);

    const readyStories = contexts.filter((c) => c.messageType === "story_ready");
    const completions = await this.coordination.getCurrentRevisionCompletions();

    const allIdle = Array.from(this.expertStates.values()).every(
      (state) => state.status === "idle" || state.status === "completed"
    );

    const readyToClaim = readyStories.filter((ready) => {
      const storyIndex = (ready.metadata?.storyIndex as number) || 0;
      const storyPersona = (ready.metadata?.persona as string) || "";

      const isCompleted = completions.some(
        (c) => (c.metadata?.storyIndex as number) === storyIndex
      ) || this.locallyCompletedStoryIndices.has(storyIndex);
      if (isCompleted) return false;
      if (this.failedStoryIndices.has(storyIndex)) return false;
      if (this.blockedStoryIndices.has(storyIndex)) return false;

      const deps = (ready.metadata?.dependencies as number[]) || [];
      if (deps.length > 0) {
        const unmetDeps = deps.filter(
          (depIndex) =>
            !completions.some((c) => (c.metadata?.storyIndex as number) === depIndex) &&
            !this.locallyCompletedStoryIndices.has(depIndex)
        );
        if (unmetDeps.length > 0) return false;
      }

      const hasMatchingExpert = matchPersonaToExpert(storyPersona) !== null;
      if (!hasMatchingExpert) {
        console.log(`[Epic] Skipping story ${storyIndex} - no expert for persona: ${storyPersona}`);
        return false;
      }

      return true;
    });

    // Deadlock detection
    if (allIdle && readyToClaim.length === 0 && this.revisionStoriesQueued.length === 0 && (this.failedStoryIndices.size > 0 || this.blockedStoryIndices.size > 0) && completions.length > 0) {
      const failedList = Array.from(this.failedStoryIndices).sort((a, b) => a - b);
      const blockedList = Array.from(this.blockedStoryIndices).sort((a, b) => a - b);
      console.log(`[Epic] Partial completion — ${completions.length} stories done, ${failedList.length} failed, ${blockedList.length} blocked`);
      this.postLog(
        `${completions.length} of ${readyStories.length} stories completed. ` +
        `Story ${failedList.join(", ")} failed, stories ${blockedList.join(", ")} blocked. ` +
        `Proceeding with partial completion — creating PR with completed work.`
      );
    }

    if (allIdle && readyToClaim.length === 0 && this.revisionStoriesQueued.length === 0 && completions.length > 0) {
      const isPartialCompletion = this.failedStoryIndices.size > 0 || this.blockedStoryIndices.size > 0;
      if (isPartialCompletion) {
        console.log("[Epic] Partial completion — proceeding with completed stories...");
      } else {
        console.log("[Epic] All stories finished. Processing completion...");
      }

      const storyCompletions = completions.map((c) => ({
        storyIndex: (c.metadata?.storyIndex as number) || 0,
        title: (c.metadata?.title as string) || c.content,
        filesModified: (c.metadata?.filesModified as string[]) || [],
      }));

      const summaryParts = storyCompletions.map((s) => `S${s.storyIndex}`);
      let storyList = storyCompletions.map((s) => `- **${s.title}**`).join("\n");

      if (isPartialCompletion) {
        const failedList = Array.from(this.failedStoryIndices).sort((a, b) => a - b);
        const blockedList = Array.from(this.blockedStoryIndices).sort((a, b) => a - b);
        storyList += `\n\n⚠️ **Failed stories:** ${failedList.join(", ")}`;
        if (blockedList.length > 0) {
          storyList += `\n⚠️ **Blocked stories:** ${blockedList.join(", ")}`;
        }
        storyList += `\n\n*${completions.length} of ${readyStories.length} stories completed.*`;
      }

      // Run epic validation
      this.postDashboardLog("Running epic validation...");
      let capturedQualityMetrics: QualityMetrics | undefined;
      let qualityGateResult: EvaluateQualityResponse | undefined;

      const epicValidationResult = await Promise.allSettled([
        this.validateEpicCompletion(storyCompletions, this.totalStories),
      ]).then((r) => r[0]);

      if (epicValidationResult.status === "rejected") {
        console.warn("[Epic] Epic validation threw (non-fatal):", epicValidationResult.reason);
      } else {
        const validation = epicValidationResult.value;

        if (!validation.valid) {
          console.log("[Epic] Epic validation failed - stories missing");
          this.postDashboardLog("Epic validation failed — stories missing");
          await this.ticketOps.postComment(
            `⚠️ Epic validation failed - not all stories completed.\n\n` +
              `**Missing:**\n${validation.missing.map((m) => `- ${m}`).join("\n")}\n\n` +
              `*${validation.storiesCompleted}/${validation.storiesTotal} stories completed.*`,
          );
          await this.updateTaskStatus("failed", `Epic incomplete: ${validation.missing.length} stories missing`, `Validation failed: ${validation.missing.join(", ")}`);
          this.missionActive = false;
          return;
        }

        if (validation.unaddressedRequirements.length > 0) {
          console.log(`[Epic] Proceeding with ${validation.unaddressedRequirements.length} validation warnings`);
          await this.ticketOps.postComment(
            `⚠️ Epic validation warnings (non-blocking):\n\n` +
              validation.unaddressedRequirements.slice(0, 5).map((r) => `- ${r}`).join("\n") +
              (validation.unaddressedRequirements.length > 5 ? `\n... and ${validation.unaddressedRequirements.length - 5} more` : ""),
          );
        }
      }

      // Create consolidated PR
      let prUrl: string | undefined;
      let prNumber: number | undefined;
      let noChangesNeeded = false;

      const storiesWithChanges = storyCompletions.filter((s) => s.filesModified && s.filesModified.length > 0);

      if (storiesWithChanges.length === 0) {
        console.log("[Epic] No stories had file changes");
        noChangesNeeded = true;
      } else if (this.config.jiraIssueKey) {
        // Persist story completion data
        this.postDashboardLog("Persisting story completion data...");
        try {
          const featureBranch = `feature/${this.config.jiraIssueKey?.toLowerCase()}`;
          const storyBranches = await this.gitOps.getStoryBranches();
          await axios.post(
            `${this.config.apiBaseUrl}/api/control-center/tasks/${this.config.parentTaskId}/story-completions`,
            { storyCompletions, storyBranches, featureBranch },
            { headers: { "Content-Type": "application/json", "x-api-key": this.config.orgApiKey }, timeout: 10000 }
          );
        } catch (persistError) {
          console.warn("[Epic] Failed to persist story data (non-fatal):", persistError instanceof Error ? persistError.message : persistError);
        }

        console.log("[Epic] Creating consolidated PR...");
        this.postDashboardLog(`Creating consolidated PR from ${storyCompletions.length} story branches...`);

        const storyCount = storyCompletions.length;
        const firstStoryTitle = storyCompletions[0]?.title || "Implementation";
        const maxTitleLength = 230;
        const truncatedTitle = firstStoryTitle.length > maxTitleLength
          ? firstStoryTitle.substring(0, maxTitleLength - 3) + "..."
          : firstStoryTitle;
        const epicTitle = storyCount > 1
          ? `Epic: ${truncatedTitle} (+${storyCount - 1} more)`
          : `Epic: ${truncatedTitle}`;

        prUrl = await this.gitOps.createConsolidatedPR(this.config.jiraIssueKey, epicTitle, storyCompletions, undefined);
        if (prUrl) {
          console.log(`[Epic] Consolidated PR created: ${prUrl}`);
          this.postDashboardLog(`PR created: ${prUrl}`);
          prNumber = extractPrNumber(prUrl);
          this.currentPrUrl = prUrl;
          this.currentPrNumber = prNumber;
          await postProgressUpdate(this.config.apiBaseUrl, this.config.orgApiKey, this.config.parentTaskId, "review_requested", prUrl, prNumber);
        } else {
          console.error("[Epic] Failed to create consolidated PR");
          this.postDashboardLog("Failed to create consolidated PR");
        }

        if (this.gateBypassed.size > 0) {
          const bypassedList = [...this.gateBypassed].sort((a, b) => a - b).join(", ");
          this.postDashboardLog(`⚠️ Stories with gate bypass: ${bypassedList}`);
        }
      }

      // Run quality verification on consolidated branch
      if (prUrl && prNumber) {
        await this.gitOps.checkoutForReview(prNumber);
        this.postDashboardLog("Running quality checks on consolidated branch...");

        try {
          const repoPath = this.gitOps.getRepoPath();
          const metrics = await runQualityVerification(repoPath, this.config.qualityGateCommands);
          capturedQualityMetrics = metrics;
          this.postDashboardLog(`Quality: score=${metrics.qualityScore}/100, ${metrics.typeErrors} type errors, ${metrics.lintErrors} lint errors`);

          await postQualityMetrics(this.config.apiBaseUrl, this.config.orgApiKey, this.config.parentTaskId, metrics);

          if (this.config.qualityGateBypass) {
            qualityGateResult = { pass: true, reasons: ["bypass-quality-gate label set"], blockers: [] };
          } else {
            qualityGateResult = await this.decisionClient.evaluateQuality({
              metrics: {
                qualityScore: metrics.qualityScore,
                typeErrors: metrics.typeErrors > 0,
                testFailures: metrics.testsFailed > 0,
                e2eFailures: (metrics.e2eFailed ?? 0) > 0,
                testCoveragePercent: metrics.coverageLines || undefined,
                securityVulnsHigh: metrics.securityHigh,
              },
              qualityGateEnabled: true,
              storyDescription: this.config.jiraRequirements || undefined,
            });
          }

          const statusIcon = qualityGateResult.pass ? "PASSED ✅" : "FAILED ❌";
          console.log(`[Epic] Quality Gate: ${statusIcon}`);

          if (!qualityGateResult.pass) {
            const thresholds = this.config.qualityThresholds;
            let autoFixSucceeded = false;

            if (thresholds?.autoFixEnabled) {
              console.log("[Epic] Quality gate failed — attempting auto-fix...");
              this.postDashboardLog("Quality gate failed — running auto-fix agent");

              const toAutoFixGateResult = (evalResult: EvaluateQualityResponse): AutoFixQualityGateResult => ({
                passed: evalResult.pass,
                checks: [
                  ...evalResult.reasons.map((r) => ({ name: "quality", passed: false, message: r })),
                  ...evalResult.blockers.map((b) => ({ name: "blocker", passed: false, message: b })),
                ],
                summary: [...evalResult.reasons, ...evalResult.blockers].join("; "),
                failureReasons: [...evalResult.reasons, ...evalResult.blockers],
              });

              const recheckQuality = async () => {
                const recheckMetrics = await runQualityVerification(repoPath, this.config.qualityGateCommands);
                const evalResult = await this.decisionClient.evaluateQuality({
                  metrics: {
                    qualityScore: recheckMetrics.qualityScore,
                    typeErrors: recheckMetrics.typeErrors > 0,
                    testFailures: recheckMetrics.testsFailed > 0,
                    e2eFailures: (recheckMetrics.e2eFailed ?? 0) > 0,
                    testCoveragePercent: recheckMetrics.coverageLines || undefined,
                    securityVulnsHigh: recheckMetrics.securityHigh,
                  },
                  qualityGateEnabled: true,
                  storyDescription: this.config.jiraRequirements || undefined,
                });
                return { metrics: recheckMetrics, gateResult: toAutoFixGateResult(evalResult) };
              };

              const autoFixResult = await runAutoFixWithTracking(
                toAutoFixGateResult(qualityGateResult),
                capturedQualityMetrics!,
                { maxIterations: thresholds.autoFixMaxIterations, projectRoot: repoPath },
                recheckQuality,
                { baseUrl: this.config.apiBaseUrl, apiKey: this.config.orgApiKey },
              );

              console.log(formatAutoFixResult(autoFixResult));

              if (autoFixResult.success) {
                autoFixSucceeded = true;
                this.postDashboardLog(`Auto-fix succeeded after ${autoFixResult.totalIterations} iteration(s)`);
                execSync(`git -C "${repoPath}" add -A && git -C "${repoPath}" commit -m "fix: auto-fix quality gate issues" --no-verify || true`);
                const updatedMetrics = await runQualityVerification(repoPath, this.config.qualityGateCommands);
                capturedQualityMetrics = updatedMetrics;
                await postQualityMetrics(this.config.apiBaseUrl, this.config.orgApiKey, this.config.parentTaskId, updatedMetrics);
              }

              if (!autoFixSucceeded) {
                console.log("[Epic] Shell auto-fix incomplete — escalating to Claude fix agent...");
                this.postDashboardLog("Spawning Claude fix agent for quality issues...");

                const agentFixed = await runQualityFixAgent(this.config, this.decisionClient, repoPath, qualityGateResult.blockers);

                try {
                  const unpushed = execSync(`git -C "${repoPath}" log @{u}..HEAD --oneline`, { encoding: "utf-8" }).trim();
                  if (unpushed) {
                    execSync(`git -C "${repoPath}" push`, { encoding: "utf-8", timeout: 60_000 });
                  }
                } catch (pushErr) {
                  console.log(`[Epic] Failed to push fix agent commits: ${pushErr instanceof Error ? pushErr.message : pushErr}`);
                }

                if (agentFixed) {
                  autoFixSucceeded = true;
                  execSync(`git -C "${repoPath}" add -A && git -C "${repoPath}" commit -m "fix: auto-fix quality gate issues" --no-verify || true`);
                  const updatedMetrics = await runQualityVerification(repoPath, this.config.qualityGateCommands);
                  capturedQualityMetrics = updatedMetrics;
                  await postQualityMetrics(this.config.apiBaseUrl, this.config.orgApiKey, this.config.parentTaskId, updatedMetrics);
                } else {
                  this.postDashboardLog("Auto-fix incomplete — quality issues remain");
                }
              }
            } else {
              this.postDashboardLog("Auto-fix is disabled in org settings");
            }

            if (!autoFixSucceeded) {
              console.log("[Epic] Quality gate auto-fix incomplete — deferring to integration fixer");
              this.postDashboardLog("Quality gate auto-fix incomplete — integration fixer will attempt resolution");
            }
          }
        } catch (qualityError) {
          console.warn("[Epic] Quality verification failed (non-fatal):", qualityError instanceof Error ? qualityError.message : qualityError);
        }
      }

      // Run integration quality gates
      if (prUrl && prNumber && (this.config.qualityGateCommands?.length ?? 0) > 0) {
        await postProgressUpdate(this.config.apiBaseUrl, this.config.orgApiKey, this.config.parentTaskId, "integration_check", prUrl, prNumber);
        this.postDashboardLog("Running integration quality gates on consolidated branch...");
        await this.gitOps.checkoutForReview(prNumber);

        const integrationFixer = new InlineIntegrationFixer(this.config, this.gitOps.getRepoPath());
        const gateResult = await integrationFixer.fix(prNumber, this.config.qualityGateCommands!, this.config.maxFixRetries, completions);

        if (gateResult.decision === "passed") {
          this.postDashboardLog("Integration gates passed");
        } else if (gateResult.decision === "fixed") {
          this.postDashboardLog("Integration issues auto-fixed");
          await this.ticketOps.postComment(`🔧 Integration Fix Agent resolved cross-story issues:\n\n${gateResult.summary}`);
        } else {
          this.postDashboardLog(`Integration gates failed: ${gateResult.summary}`);
          await this.ticketOps.postComment(`⚠️ Integration issues could not be auto-fixed:\n\n${gateResult.summary}\n\nTech Lead will assess.`);
        }
      }

      // Run spec verification
      if (prUrl && prNumber) {
        this.postDashboardLog("Running spec verification against acceptance criteria...");
        await postProgressUpdate(this.config.apiBaseUrl, this.config.orgApiKey, this.config.parentTaskId, "integration_check", prUrl, prNumber);

        const storyAcceptanceCriteria = completions
          .map(c => {
            const meta = c.metadata || {};
            const description = (meta.description as string) || c.content;
            const criteriaMatch = description.match(/##+ Acceptance Criteria\n([\s\S]*?)(?=\n##|\n---|\n\n\n|$)/i);
            const criteriaText = criteriaMatch?.[1] || "";
            const criteria = criteriaText.split("\n").map(line => line.replace(/^[\s]*[-*•]\s*/, "").trim()).filter(line => line.length > 0);
            return { storyIndex: (meta.storyIndex as number) || 0, title: (meta.title as string) || c.content, criteria };
          })
          .filter(s => s.criteria.length > 0);

        if (storyAcceptanceCriteria.length > 0) {
          const verifier = new InlineVerifier(this.config, this.gitOps.getRepoPath());
          const verificationResult = await verifier.verify(storyAcceptanceCriteria);

          if (verificationResult.decision === "pass") {
            this.postDashboardLog("Spec verification passed");
          } else if (verificationResult.decision === "partial_pass") {
            this.postDashboardLog(`Spec verification: partial pass — ${verificationResult.failedCriteria?.length || 0} criteria failed`);
            await this.ticketOps.postComment(
              `⚠️ Spec verification found ${verificationResult.failedCriteria?.length || 0} unmet criteria:\n\n` +
              (verificationResult.failedCriteria || []).map(f => `- **Story ${f.storyIndex}**: "${f.criterion}" — ${f.reason}`).join("\n") +
              `\n\nTech Lead will assess.`
            );
          } else {
            this.postDashboardLog(`Spec verification failed: ${verificationResult.summary}`);
          }
        } else {
          this.postDashboardLog("No acceptance criteria found — skipping spec verification");
        }
      }

      // Run CI gate BEFORE Tech Lead review
      let ciStatus: { passed: boolean; fixed: boolean; log?: string } | undefined;
      if (prUrl && prNumber && (this.config.qualityGateCommands?.length ?? 0) > 0) {
        this.postDashboardLog("Running CI gate checks...");
        ciStatus = await runCIGate(this.config, this.resilience, this.gitOps, prNumber, this.config.maxFixRetries);
        if (ciStatus.passed) {
          this.postDashboardLog(ciStatus.fixed ? "CI gate passed after fix" : "CI gate passed");
        } else {
          this.postDashboardLog(`CI gate failed — Tech Lead will assess`);
        }
      }

      // Run inline Tech Lead review
      if (prUrl && prNumber && this.config.reviewEnabled) {
        await postProgressUpdate(this.config.apiBaseUrl, this.config.orgApiKey, this.config.parentTaskId, "reviewing", prUrl, prNumber);
        this.postDashboardLog("Launching Tech Lead review...");

        const reviewResult = await runInlineReview(
          this.config, this.resilience, this.coordination, this.decisionClient,
          this.gitOps, this.ticketOps, prUrl, prNumber,
          storyCompletions, summaryParts,
          this.revisionCount, this.maxRevisions, this.lastReviewFeedback,
          this.serverPromptTemplates,
          {
            setRevisionCount: (count) => { this.revisionCount = count; },
            setLastReviewFeedback: (feedback) => { this.lastReviewFeedback = feedback; },
            setReviewSkipped: () => { this.reviewSkipped = true; },
            setDeploymentSucceeded: () => { this.deploymentSucceeded = true; },
            setMergeFailed: () => { this.mergeFailed = true; },
            setMissionActive: (active) => { this.missionActive = active; },
            triggerRevision: async (feedback, affectedStories, affectedReasons) => {
              this.revisionStoriesQueued = await triggerRevision(
                this.config, this.coordination, this.gitOps,
                this.expertStates, this.completedStoryIndices,
                this.locallyCompletedStoryIndices, this.loggedBlockedStories,
                this.revisionStoriesQueued, this.revisionCount,
                feedback, affectedStories, affectedReasons
              );
            },
          },
          capturedQualityMetrics,
          ciStatus
        );

        if (reviewResult === "continue") return;
        if (!this.missionActive) return;
      }

      // Determine final status
      let taskStatus: "deployed" | "review_requested" | "pr_approved" | "failed" | "completed" | "escalated";
      let jiraComment: string;
      let errorMessage: string | undefined;

      const completionLabel = isPartialCompletion
        ? `${completions.length} of ${readyStories.length} stories completed`
        : `All ${completions.length} stories completed`;
      const completionEmoji = isPartialCompletion ? "⚠️" : "✅";

      if (this.deploymentSucceeded) {
        taskStatus = "deployed";
        jiraComment = "";
      } else if (prUrl) {
        if (this.reviewSkipped) {
          taskStatus = "escalated";
          jiraComment = `⚠️ **${completionLabel}**, but Tech Lead review could not complete.\n\n${storyList}\n\n📝 **PR**: ${prUrl}\n\n*Please review the PR manually.*`;
        } else if (this.mergeFailed) {
          taskStatus = "failed";
          errorMessage = "CI checks did not pass after all retry attempts — PR could not be merged";
          jiraComment = `❌ **${completionLabel}**, approved by Tech Lead, but **PR merge failed**.\n\n${storyList}\n\n📝 **PR**: ${prUrl}\n\n*Manual intervention required.*`;
        } else if (this.config.reviewEnabled) {
          taskStatus = isPartialCompletion ? "escalated" : "pr_approved";
          jiraComment = this.config.prdChildTask
            ? `${completionEmoji} **${completionLabel}**, approved by Tech Lead, and PR merged.\n\n${storyList}\n\n📝 **PR**: ${prUrl}`
            : `${completionEmoji} **${completionLabel}** and approved by Tech Lead.\n\n${storyList}\n\n📝 **PR**: ${prUrl}\n\n*Ready for merge.*`;
        } else {
          taskStatus = isPartialCompletion ? "escalated" : "review_requested";
          jiraComment = `${completionEmoji} **${completionLabel}.**\n\n${storyList}\n\n📝 **PR**: ${prUrl}\n\n*Ready for review and merge.*`;
        }
      } else if (noChangesNeeded) {
        taskStatus = "completed";
        jiraComment = `✅ **Analysis completed** — ${completions.length} stories analyzed.\n\n${storyList}\n\n*No code changes were required.*`;
      } else if (this.config.jiraIssueKey) {
        taskStatus = "failed";
        errorMessage = "PR creation failed";
        jiraComment = `❌ **PR creation failed.**\n\n${storyList}\n\n*Story branches may need manual consolidation.*`;
      } else {
        taskStatus = "completed";
        jiraComment = `✅ **${completions.length} stories completed.**\n\n${storyList}`;
      }

      if (jiraComment) {
        // For GitHub Issues, use the detailed jiraComment directly (it already has markdown formatting)
        // rather than replacing it with a generic message
        await this.ticketOps.postComment(jiraComment);
      }

      const partialTag = isPartialCompletion ? " (partial)" : "";
      let resultSummary: string;
      if (prUrl) {
        resultSummary = `Epic ${taskStatus}${partialTag}: ${summaryParts.join(", ")} (${completions.length}/${readyStories.length} stories) - PR: ${prUrl}`;
      } else if (taskStatus === "failed") {
        resultSummary = `Epic failed: ${summaryParts.join(", ")} (${completions.length} stories) - PR creation failed`;
      } else if (noChangesNeeded) {
        resultSummary = `Epic completed: ${summaryParts.join(", ")} (${completions.length} stories) - No code changes required`;
      } else {
        resultSummary = `Epic: ${summaryParts.join(", ")} (${completions.length} stories)`;
      }

      await this.updateTaskStatus(taskStatus, resultSummary, errorMessage, prUrl);
      await this.ticketOps.transitionTo("Done");

      console.log(`[Epic] Mission complete with status: ${taskStatus}`);

      // Emit build report
      try {
        const buildReport: BuildReport = {
          taskId: this.config.parentTaskId,
          repo: this.config.targetRepo,
          storyCount: this.totalStories,
          completedCount: completions.length,
          failedCount: this.failedStoryIndices.size,
          outcome: this.failedStoryIndices.size === 0 ? "success" : completions.length > 0 ? "partial_success" : "failure",
          totalRevisions: this.revisionCount,
          integrationFailures: [],
          verificationFailures: [],
          timings: { totalDurationMs: Date.now() - this.epicStartTime, storyDurationsMs: {} },
        };

        await axios.post(
          `${this.config.apiBaseUrl}/api/control-center/tasks/${this.config.parentTaskId}/build-report`,
          buildReport,
          { headers: { "Content-Type": "application/json", "x-api-key": this.config.orgApiKey }, timeout: 10000 }
        );
        console.log("[Epic] Build report emitted");
      } catch (reportErr) {
        console.warn("[Epic] Failed to emit build report (non-fatal):", reportErr instanceof Error ? reportErr.message : reportErr);
      }

      // Capture memories
      await this.captureTaskMemories(storyCompletions, taskStatus === "completed" || taskStatus === "deployed");

      // Run inline improvement analysis
      if (this.config.improvementEnabled) {
        console.log("[Epic] Running inline improvement analysis...");
        try {
          const improver = new InlineImprover(this.config, this.serverPromptTemplates?.improverPrompt);
          const improveResult = await improver.improve();

          if (improveResult.success && improveResult.improvementsApplied > 0) {
            console.log(`[Epic] Applied ${improveResult.improvementsApplied} improvements`);
          } else if (improveResult.success) {
            console.log("[Epic] No improvements needed");
          } else {
            console.log(`[Epic] Improvement analysis failed: ${improveResult.error}`);
          }
        } catch (improveError) {
          console.error("[Epic] Improvement error (non-fatal):", improveError);
        }
      }

      this.missionActive = false;
    }
  }

  // =============================================================================
  // Validation & Memory
  // =============================================================================

  private async validateEpicCompletion(
    storyCompletions: Array<{ storyIndex: number; title: string; filesModified?: string[] }>,
    totalStoriesExpected: number
  ): Promise<EpicValidationResult> {
    const missing: string[] = [];
    const unaddressedRequirements: string[] = [];

    console.log(`[Epic] Validating epic completion (${storyCompletions.length}/${totalStoriesExpected} stories)...`);

    const completedIndices = new Set(storyCompletions.map(s => s.storyIndex));
    for (let i = 0; i < totalStoriesExpected; i++) {
      if (!completedIndices.has(i)) {
        missing.push(`Story ${i} not completed`);
      }
    }

    const completions = await this.coordination.getCurrentRevisionCompletions();
    for (const completion of completions) {
      const validation = completion.metadata?.validation as { passed?: boolean; issues?: string[] } | undefined;
      if (validation && !validation.passed && validation.issues?.length) {
        for (const issue of validation.issues) {
          unaddressedRequirements.push(`Story ${completion.metadata?.storyIndex}: ${issue}`);
        }
      }
    }

    const taskDescription = this.config.taskSummary || "";
    const requirementPatterns = [
      /must\s+(.+?)(?:\.|$)/gi,
      /should\s+(.+?)(?:\.|$)/gi,
      /need to\s+(.+?)(?:\.|$)/gi,
      /^[\s]*[-*•]\s+(.+)$/gm,
    ];

    const extractedRequirements: string[] = [];
    for (const pattern of requirementPatterns) {
      let match;
      while ((match = pattern.exec(taskDescription)) !== null) {
        extractedRequirements.push(match[1].trim());
      }
    }

    const allModifiedFiles = storyCompletions.flatMap(s => s.filesModified || []);
    const allStoryTitles = storyCompletions.map(s => s.title.toLowerCase()).join(" ");

    for (const req of extractedRequirements) {
      const reqLower = req.toLowerCase();
      const keyTerms = reqLower.split(/\s+/).filter(term => term.length > 3 && !["must", "should", "need", "that", "with", "from", "this", "have", "been", "will"].includes(term));
      const addressed = keyTerms.some(term =>
        allStoryTitles.includes(term) || allModifiedFiles.some(f => f.toLowerCase().includes(term))
      );
      if (!addressed && keyTerms.length > 0) {
        const isGeneric = keyTerms.every(t => ["test", "work", "code", "file", "data", "user", "system"].includes(t));
        if (!isGeneric) {
          unaddressedRequirements.push(`Requirement may be unaddressed: "${req}"`);
        }
      }
    }

    const valid = missing.length === 0;

    if (!valid) {
      console.log(`[Epic] Validation FAILED: ${missing.length} stories missing`);
    }
    if (unaddressedRequirements.length > 0) {
      console.log(`[Epic] Validation WARNINGS: ${unaddressedRequirements.length} potential issues`);
    }
    if (valid && unaddressedRequirements.length === 0) {
      console.log(`[Epic] Validation PASSED: All ${storyCompletions.length} stories completed`);
    }

    return { valid, missing, storiesCompleted: storyCompletions.length, storiesTotal: totalStoriesExpected, unaddressedRequirements };
  }

  private async captureTaskMemories(
    storyCompletions: Array<{ storyIndex: number; title: string; filesModified: string[] }>,
    wasSuccessful: boolean
  ): Promise<void> {
    console.log("[Epic] Capturing task memories for insights...");

    const outcome = wasSuccessful ? "success" : "failure";
    const allFilesModified = storyCompletions.flatMap((s) => s.filesModified || []);
    const taskDescription = this.config.taskSummary || this.config.jiraIssueKey || "Unknown task";

    try {
      const episodicResult = await this.memoryClient.createEpisodicMemory({
        repository: this.config.targetRepo || "unknown",
        eventType: wasSuccessful ? "task_completed" : "task_failed",
        summary: `${wasSuccessful ? "Completed" : "Failed"}: ${taskDescription} (${storyCompletions.length} stories, ${allFilesModified.length} files)`,
        details: { filesAffected: allFilesModified.slice(0, 50), retryCount: this.revisionCount },
        outcome,
        outcomeDetails: wasSuccessful
          ? `Successfully completed ${storyCompletions.length} stories`
          : `Task failed after ${this.revisionCount} revision attempts`,
        taskId: this.config.parentTaskId,
        persona: "coordinator",
        model: this.config.model,
      });

      if (episodicResult) {
        console.log(`[Epic] Created episodic memory: ${episodicResult.id}`);
      }

      if (this.memoryContext && this.memoryContext.skills.length > 0) {
        console.log(`[Epic] Recording outcome for ${this.memoryContext.skills.length} injected skills`);
        await this.memoryClient.recordInjectedSkillsUsage(
          this.memoryContext.skills,
          wasSuccessful ? "success" : "failure",
          this.config.parentTaskId
        );
      }

      if (wasSuccessful && this.accumulatedLearnings.length > 0) {
        console.log(`[Epic] Creating ${this.accumulatedLearnings.length} skills from worker learnings...`);
        for (const { learning, persona, storyIndex } of this.accumulatedLearnings) {
          try {
            await this.memoryClient.createSkillFromLearning({
              learning,
              repository: this.config.targetRepo || "unknown",
              sourceTaskId: this.config.parentTaskId,
              persona,
              storyIndex,
            });
          } catch (err) {
            console.warn("[Epic] Failed to create skill from learning (non-fatal):", err instanceof Error ? err.message : err);
          }
        }
      } else if (wasSuccessful) {
        console.log("[Epic] No learnings reported, falling back to template extraction...");
        const extractionResult = await this.memoryClient.extractSkillsFromTask(
          this.config.parentTaskId,
          { autoCreate: true, minConfidence: 0.6 }
        );
        if (extractionResult) {
          console.log(`[Epic] Template extraction: ${extractionResult.skillsExtracted} candidates`);
        }
      }

      console.log("[Epic] Memory capture complete");
    } catch (error) {
      console.warn("[Epic] Memory capture failed (non-fatal):", error instanceof Error ? error.message : error);
    }
  }

  // =============================================================================
  // Convenience wrappers (delegate to coordinator-utils.ts)
  // =============================================================================

  private async postLog(message: string, type: string = "info"): Promise<void> {
    await postLog(this.config.apiBaseUrl, this.config.orgApiKey, this.config.parentTaskId, message, type);
  }

  private postDashboardLog(message: string): void {
    postDashboardLog(this.config.apiBaseUrl, this.config.orgApiKey, this.config.parentTaskId, message);
  }

  private async updateTaskStatus(
    status: "pr_approved" | "failed" | "review_requested" | "deployed" | "quality_gate_failed" | "completed" | "escalated" | "running",
    resultSummary?: string,
    errorMessage?: string,
    prUrl?: string
  ): Promise<void> {
    await updateTaskStatus(
      this.config.apiBaseUrl, this.config.orgApiKey, this.config.parentTaskId,
      this.revisionCount, status, resultSummary, errorMessage, prUrl
    );
  }
}
