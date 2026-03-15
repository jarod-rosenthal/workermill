/**
 * Epic Coordinator
 *
 * Main coordination loop for multi-agent collaboration.
 * Manages expert state, claims stories, routes questions, and coordinates execution.
 * Includes inline Tech Lead review with revision loop and DevOps deployment.
 */

import * as path from "path";
import axios from "axios";
import type {
  ExpertPersona,
  ExpertState,
  ReadyStory,
  EpicConfig,
  ContextMessage,
  ResilienceConfig,
  EpicValidationResult,
  BuildReport,
} from "./types.js";
import { getAvailableExperts, matchPersonaToExpert, loadExpertRegistry } from "./experts.js";
import type { DecisionClient } from "./decision-client.js";
import { CoordinationClient } from "./coordination-client.js";
import { StoryExecutor } from "./executor.js";
import { GitOps } from "./git-ops.js";
import { BlockerManager } from "./blocker-manager.js";
import { TicketOps } from "./ticket-ops.js";
import { InlineReviewer, type InlineReviewResult } from "./inline-reviewer.js";
import { InlineDeployer } from "./inline-deployer.js";
import { InlineImprover } from "./inline-improver.js";
import { InlineCIFixer } from "./inline-ci-fixer.js";
import { InlineIntegrationFixer } from "./inline-integration-fixer.js";
import { InlineReviewFixer } from "./inline-review-fixer.js";
import { InlineVerifier } from "./inline-verifier.js";
import { createMemoryClient, type MemoryClient, type MemoryContext, type EnhancedContext } from "./memory-client.js";
import { CredentialRotator } from "./credential-rotator.js";
import { spawn, execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "fs";
import { runQualityVerification, postQualityMetrics, type QualityMetrics, findBoardGateCommand } from "./quality-runner.js";
import { detectLanguage } from "../lib/language-profile.js";
import type { EvaluateQualityResponse } from "./decision-client.js";
import { runAutoFixWithTracking, formatAutoFixResult, type QualityGateResult as AutoFixQualityGateResult } from "./auto-fix-agent.js";
import { runAgent, type AgentResult } from "./agent-sdk.js";
import { loadRepoContext } from "./gate-utils.js";

/**
 * Personas excluded from question routing (Tier 2/3 fallback).
 * They can still answer questions explicitly targeted at them (Tier 1).
 */
const QUESTION_INELIGIBLE_PERSONAS = new Set([
  "support_agent",
  "project_manager",
  "tech_writer",
]);

/**
 * Detect gate errors that no revision can fix (e.g. missing directories
 * referenced in the gate command, configuration errors).
 * Returns { unfixable: true, reason } when the gate output contains
 * patterns that indicate a structural problem rather than a code problem.
 */
function isUnfixableGateError(output: string): { unfixable: boolean; reason: string } {
  // E902: ruff/flake8 "No such file or directory" — gate command references
  // a path that doesn't exist in the repo (e.g. `ruff check src/ tests/`
  // when tests/ hasn't been created yet)
  const e902Match = output.match(/E902\s+No such file or directory.*?-->\s*(\S+)/);
  if (e902Match) {
    return { unfixable: true, reason: `gate command references non-existent path: ${e902Match[1]}` };
  }

  // Generic "No such file or directory" from shell commands trying to enter
  // directories that don't exist
  const noSuchDir = output.match(/(?:cd|ls|cat|pushd):\s*(.+?):\s*No such file or directory/);
  if (noSuchDir) {
    return { unfixable: true, reason: `gate command references non-existent path: ${noSuchDir[1]}` };
  }

  // Command not found — tool isn't installed in the container
  const cmdNotFound = output.match(/(\S+):\s*(?:command not found|not found)/);
  if (cmdNotFound) {
    return { unfixable: true, reason: `required tool not installed: ${cmdNotFound[1]}` };
  }

  return { unfixable: false, reason: "" };
}

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
  private revisionStoriesQueued: ReadyStory[] = [];  // Stories queued for revision re-execution
  private deploymentSucceeded: boolean = false;  // Track if deployment completed successfully
  private reviewSkipped: boolean = false;  // Track if review was skipped due to failure (OAuth, crash, etc.)
  private mergeFailed: boolean = false;  // Track if CI-verified merge failed after all retries

  // CI Fix Agent tracking
  private ciFixRetryCount: number = 0;
  private totalStories: number = 0;  // Total stories in the Epic (for lazy coordination loading)

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
  // Avoid spamming "blocked" log for the same story every poll cycle
  private loggedBlockedStories: Set<number> = new Set();
  // Resilience: Track blocked stories due to dependency failures
  private blockedStoryIndices: Set<number> = new Set();
  // Resilience: Track failed stories (for auto-retry)
  private failedStoryIndices: Set<number> = new Set();
  // Local completion tracking: stories confirmed done by executeStory (defense against postCompletion API failures)
  private locallyCompletedStoryIndices: Set<number> = new Set();
  // Resilience configuration
  private resilience: ResilienceConfig;
  // Active worktrees for graceful shutdown
  private activeWorktrees: Map<number, string> = new Map();
  // Blocker manager for handling escalated errors
  private blockerManager: BlockerManager | null = null;
  // Mutex groups: Track running stories and their mutex groups to prevent conflicts
  private runningStoryMutexGroups: Map<number, string[]> = new Map();
  // File-overlap gating: Track target files of running stories
  private runningStoryTargetFiles: Map<number, string[]> = new Map();
  // Credential rotation for Claude Max rate limit handling
  private credentialRotator: CredentialRotator;
  private rateLimitRetries: Map<number, number> = new Map();
  // Track in-flight quick answers to avoid duplicate spawns across poll cycles
  private inFlightQuickAnswers: Set<string> = new Set();
  // Track story branch names (set by executor, used by PR creation and shutdown)
  private storyBranchNames: Map<number, string> = new Map();
  // Incremental integration tracking
  private integrationBranch: string | undefined;
  private integratedStoryIndices: Set<number> = new Set();
  private gateBypassed: Set<number> = new Set();
  private integrationQueue: number[] = []; // stories completed but not yet integrated
  private integrationInProgress: boolean = false;
  // Epic timing (used by build report)
  private epicStartTime: number = Date.now();
  // Track whether any story has successfully committed and pushed code
  private hasAnyCommittedCode: boolean = false;
  // Track dependency merge conflicts per story (skip per-story review when present)
  private storyDepConflicts: Map<number, string[]> = new Map();
  // Track post-rebase baseline SHAs per story (for scoped review diffs)
  private storyBaselineShas: Map<number, string> = new Map();
  // Proactive conflict detection: scan worktrees every N iterations
  private loopIterationCount: number = 0;
  // Server-side prompt templates (loaded from Decision API)
  private serverPromptTemplates?: import("./decision-client.js").WorkerConfigResponse["promptTemplates"];

  constructor(config: EpicConfig, resilience?: ResilienceConfig, decisionClient?: DecisionClient) {
    this.config = config;
    this.maxRevisions = config.maxReviewRevisions;
    this.maxPerStoryRevisions = config.maxPerStoryRevisions;
    this.coordination = new CoordinationClient(config);

    // Initialize decision client (uses safe fallbacks if API unavailable)
    if (decisionClient) {
      this.decisionClient = decisionClient;
    } else {
      // Lazy import to avoid circular dependency — inline require
      const { DecisionClient: DC } = require("./decision-client.js");
      this.decisionClient = new DC({
        apiBaseUrl: config.apiBaseUrl,
        orgApiKey: config.orgApiKey,
        logger: (msg: string) => console.log(msg),
      });
    }

    // Determine workspace directory based on execution mode
    // REPO_PATH is set by epic-entrypoint.sh after cloning - use parent directory as workDir
    const repoPath = process.env.REPO_PATH;
    let workDir: string;

    if (repoPath) {
      // Repo already cloned by entrypoint - use its parent as workDir
      workDir = path.dirname(repoPath);
      console.log("[Epic] Using pre-cloned repo at:", repoPath);
    } else {
      // Legacy mode: coordinator handles cloning
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
      // Multi-SCM provider support
      scmProvider: (process.env.SCM_PROVIDER as "github" | "gitlab" | "bitbucket") || "github",
      scmBaseUrl: process.env.SCM_BASE_URL,
      bitbucketUsername: process.env.BITBUCKET_USERNAME,
      // If REPO_PATH is set, repo is already cloned - skip cloning
      skipClone: !!repoPath,
    }, (msg) => this.postDashboardLog(msg));
    // Default resilience settings if not provided
    this.resilience = resilience || {
      blockerMaxAutoRetries: 3,
      blockerAutoRetryEnabled: true,

      pushAfterCommit: true,
      gracefulShutdownEnabled: true,
    };
    // Resilience config is used by coordinator for file-overlap gating etc.
    this.executor = new StoryExecutor(config, this.coordination, this.gitOps, this.decisionClient, this.resilience);
    this.executor.onWorktreeCreated = (storyIndex, worktreePath, branchName) => {
      this.activeWorktrees.set(storyIndex, worktreePath);
      this.storyBranchNames.set(storyIndex, branchName);
    };
    this.ticketOps = new TicketOps(config.jiraIssueKey, config.ticketSystem);
    this.expertStates = new Map();

    // Initialize blocker manager for resilience
    this.blockerManager = new BlockerManager(
      this.coordination,
      config.parentTaskId,
      this.resilience,
      this.decisionClient
    );

    // Initialize credential rotator for Claude Max rate limit handling
    this.credentialRotator = new CredentialRotator();
    const accountCount = this.credentialRotator.discover();
    if (accountCount > 1) {
      console.log(`[Epic] Credential pool: ${accountCount} accounts available for rotation`);
    } else if (accountCount === 1) {
      console.log(`[Epic] Credential pool: 1 account (rotation will wait and retry same account)`);
    }

    // Initialize memory client (REQ-19)
    this.memoryClient = createMemoryClient(config.apiBaseUrl, config.orgApiKey);

    // Initialize expert states
    for (const expert of getAvailableExperts()) {
      this.expertStates.set(expert, {
        persona: expert,
        status: "idle",
      });
    }
  }

  /**
   * Initialize the integration branch for incremental story merging.
   * Called lazily when the first story completes in a multi-story epic.
   */
  private async initializeIntegrationBranch(): Promise<void> {
    if (this.integrationBranch) return; // Already initialized
    if (!this.config.jiraIssueKey) return; // No Jira key = no branch naming
    if (this.totalStories <= 1) return; // Single story doesn't need integration branch

    try {
      this.integrationBranch = await this.gitOps.createIntegrationBranch(this.config.jiraIssueKey);
      this.postDashboardLog(`Created integration branch: ${this.integrationBranch}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Epic] Failed to create integration branch: ${msg}`);
      // Fall back to end-of-build consolidation
      this.integrationBranch = undefined;
    }
  }

  /**
   * Integrate a completed story into the integration branch.
   * Merges the story branch and catches merge conflicts early.
   * Quality gates run once on the fully consolidated branch in checkMissionComplete,
   * not after each individual merge — partial merges produce false-positive gate failures
   * (e.g. lint errors in files that later stories fix).
   * Returns true if merge succeeded, false if it needs revision (merge conflict).
   */
  private async integrateCompletedStory(storyIndex: number): Promise<boolean> {
    const branchName = this.storyBranchNames.get(storyIndex);
    if (!branchName || !this.integrationBranch) {
      console.warn(`[Epic] Cannot integrate story ${storyIndex}: no branch name or integration branch`);
      return false;
    }

    this.postDashboardLog(`Integrating story ${storyIndex} into integration branch...`);

    // Merge story into integration branch
    const mergeResult = await this.gitOps.mergeStoryIntoIntegration(
      this.integrationBranch,
      branchName,
      storyIndex
    );

    if (!mergeResult.success) {
      this.postDashboardLog(`Story ${storyIndex} merge failed: ${mergeResult.error}`);

      // Route merge failure back to the story as a revision
      const revisionReason =
        `Merge into integration branch failed.\n\n` +
        `**Error:** ${mergeResult.error}\n\n` +
        `Your code has merge conflicts with previously integrated stories. ` +
        `Fix the conflicts — it is likely overlapping edits to the same files.`;

      const revisionCount = this.storyRevisionCounts.get(storyIndex) || 0;
      if (revisionCount >= this.maxPerStoryRevisions) {
        this.postDashboardLog(`Story ${storyIndex} exceeded max revisions after merge failure — marking as failed`);
        this.failedStoryIndices.add(storyIndex);
        return false;
      }

      this.storyRevisionCounts.set(storyIndex, revisionCount + 1);

      const readyStories = await this.coordination.getReadyStories();
      const story = readyStories.find(s => s.storyIndex === storyIndex);
      if (story) {
        this.locallyCompletedStoryIndices.delete(storyIndex);
        this.completedStoryIndices.delete(storyIndex);

        if (!this.config.revisionReasons) this.config.revisionReasons = {};
        this.config.revisionReasons[storyIndex] = revisionReason;
        this.config.reviewFeedback = `Story ${storyIndex} failed to merge: ${mergeResult.error}`;

        this.revisionStoriesQueued.push(story);
        this.postDashboardLog(`Story ${storyIndex} queued for revision (merge failure)`);
      } else {
        console.warn(`[Epic] Story ${storyIndex} not found in ready stories for revision after merge failure — keeping as completed`);
        this.integratedStoryIndices.add(storyIndex);
      }

      return false;
    }

    // Merge succeeded — mark as integrated immediately.
    // Quality gates run on the fully consolidated branch in checkMissionComplete,
    // where the integration fixer can address any cross-story issues.
    this.integratedStoryIndices.add(storyIndex);
    this.postDashboardLog(`Story ${storyIndex} integrated into integration branch`);
    return true;
  }

  /**
   * Process the next story in the integration queue.
   * Processes one story per coordination loop iteration to avoid blocking.
   */
  private async processIntegrationQueue(): Promise<void> {
    if (this.totalStories <= 1 || this.integrationInProgress) return;
    if (this.integrationQueue.length === 0) return;

    // Lazy init — create integration branch on first use
    await this.initializeIntegrationBranch();
    if (!this.integrationBranch) return; // Fallback to legacy consolidation

    // Process stories in dependency order — find the first one whose
    // dependencies are all already integrated
    const readyStories = await this.coordination.getReadyStories();
    let nextIndex = -1;
    for (let i = 0; i < this.integrationQueue.length; i++) {
      const storyIndex = this.integrationQueue[i];
      const story = readyStories.find(s => s.storyIndex === storyIndex);
      const deps = story?.dependencies || [];

      const allDepsIntegrated = deps.every(d => this.integratedStoryIndices.has(d));
      if (allDepsIntegrated) {
        nextIndex = i;
        break;
      }
    }

    if (nextIndex === -1) return; // No story ready for integration yet

    const storyIndex = this.integrationQueue.splice(nextIndex, 1)[0];
    this.integrationInProgress = true;

    try {
      await this.integrateCompletedStory(storyIndex);
    } finally {
      this.integrationInProgress = false;
    }
  }

  /**
   * Initialize with resume: check for existing completions from previous run.
   * This allows the Epic to resume from where it left off after a restart.
   */
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

      // Archive stale claims: stories that were claimed but never completed (e.g. worker crashed mid-execution).
      // Without this, the coordinator loops forever trying to re-claim already-claimed stories.
      const claims = await this.coordination.getContextsByTypes(["story_claimed"]);
      const staleClaims = claims.filter((c) => {
        const idx = c.metadata?.storyIndex as number;
        return idx !== undefined && !this.completedStoryIndices.has(idx);
      });
      if (staleClaims.length > 0) {
        const staleIndices = staleClaims.map((c) => c.metadata?.storyIndex as number);
        console.log(`[Epic] Found ${staleClaims.length} stale claims (claimed but not completed): ${staleIndices.join(", ")}`);
        console.log("[Epic] Archiving stale claims so stories can be re-claimed...");
        await this.coordination.archiveStoryClaims(staleIndices);
        console.log("[Epic] Stale claims archived");
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.log("[Epic] ⚠️ Failed to check for existing completions: " + errMsg);
      this.postLog(`⚠️ Resume check failed: ${errMsg} — stale claims may cause retry loops`);
      // Non-fatal - continue without resume, but stale claims may block re-claiming
    }
  }

  /**
   * Validate epic completion before creating PR.
   * Checks that all stories completed and plan requirements were addressed.
   */
  private async validateEpicCompletion(
    storyCompletions: Array<{ storyIndex: number; title: string; filesModified?: string[] }>,
    totalStoriesExpected: number
  ): Promise<EpicValidationResult> {
    const missing: string[] = [];
    const unaddressedRequirements: string[] = [];

    console.log(`[Epic] Validating epic completion (${storyCompletions.length}/${totalStoriesExpected} stories)...`);

    // 1. Check all stories completed
    const completedIndices = new Set(storyCompletions.map(s => s.storyIndex));
    for (let i = 0; i < totalStoriesExpected; i++) {
      if (!completedIndices.has(i)) {
        missing.push(`Story ${i} not completed`);
      }
    }

    // 2. Check for stories with validation issues
    const completions = await this.coordination.getCurrentRevisionCompletions();
    for (const completion of completions) {
      const validation = completion.metadata?.validation as { passed?: boolean; issues?: string[] } | undefined;
      if (validation && !validation.passed && validation.issues?.length) {
        for (const issue of validation.issues) {
          unaddressedRequirements.push(`Story ${completion.metadata?.storyIndex}: ${issue}`);
        }
      }
    }

    // 3. Re-parse original task description for key requirements
    // Extract bullet points and "must", "should", "need to" statements
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

    // 4. Check if extracted requirements might be unaddressed
    // (This is heuristic - we check if any story title/files relate to the requirement)
    const allModifiedFiles = storyCompletions.flatMap(s => s.filesModified || []);
    const allStoryTitles = storyCompletions.map(s => s.title.toLowerCase()).join(" ");

    for (const req of extractedRequirements) {
      const reqLower = req.toLowerCase();
      // Extract key terms
      const keyTerms = reqLower
        .split(/\s+/)
        .filter(term => term.length > 3 && !["must", "should", "need", "that", "with", "from", "this", "have", "been", "will"].includes(term));

      // Check if any key term appears in story titles or file names
      const addressed = keyTerms.some(term =>
        allStoryTitles.includes(term) ||
        allModifiedFiles.some(f => f.toLowerCase().includes(term))
      );

      if (!addressed && keyTerms.length > 0) {
        // Only flag if we have specific terms to check
        // Avoid false positives for generic requirements
        const isGeneric = keyTerms.every(t => ["test", "work", "code", "file", "data", "user", "system"].includes(t));
        if (!isGeneric) {
          unaddressedRequirements.push(`Requirement may be unaddressed: "${req}"`);
        }
      }
    }

    const valid = missing.length === 0;

    if (!valid) {
      console.log(`[Epic] Validation FAILED: ${missing.length} stories missing`);
      for (const m of missing) {
        console.log(`  - ${m}`);
      }
    }

    if (unaddressedRequirements.length > 0) {
      console.log(`[Epic] Validation WARNINGS: ${unaddressedRequirements.length} potential issues`);
      for (const r of unaddressedRequirements.slice(0, 5)) {
        console.log(`  - ${r}`);
      }
      if (unaddressedRequirements.length > 5) {
        console.log(`  ... and ${unaddressedRequirements.length - 5} more`);
      }
    }

    if (valid && unaddressedRequirements.length === 0) {
      console.log(`[Epic] Validation PASSED: All ${storyCompletions.length} stories completed`);
    }

    return {
      valid,
      missing,
      storiesCompleted: storyCompletions.length,
      storiesTotal: totalStoriesExpected,
      unaddressedRequirements,
    };
  }

  /**
   * Retrieve memory context for the task (REQ-19).
   * Fetches relevant skills and memories to inject into expert prompts.
   */
  private async retrieveMemoryContext(): Promise<void> {
    console.log("[Epic] Retrieving memory context for task (with Codebase RAG)...");

    try {
      // Build task description from available info
      const taskDescription = this.config.taskSummary || this.config.jiraIssueKey || "";

      // Check if codebase indexing is enabled via env var
      const codebaseEnabled = process.env.CODEBASE_INDEXING_ENABLED === "true";

      if (codebaseEnabled && this.config.targetRepo) {
        // Retrieve memory context and code context in parallel
        const [memContext, codeResult] = await Promise.all([
          this.memoryClient.getMemoryContext(
            this.config.parentTaskId,
            taskDescription,
            {
              repository: this.config.targetRepo,
              limit: 5,
            }
          ),
          this.memoryClient.getCodeContext(
            this.config.targetRepo,
            taskDescription,
            { limit: 10 }
          ),
        ]);

        // Store memory context (skills, semantic, episodic)
        this.memoryContext = memContext;

        // Build enhanced context for tracking
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

        // Store SEPARATE contexts for executor
        // Memory context (skills, experiences) goes to memoryContext
        if (memContext.formattedContext) {
          this.config.memoryContext = memContext.formattedContext;
        }

        // Code context goes to codeContext (separate section in prompt)
        if (codeResult?.formattedText) {
          this.config.codeContext = codeResult.formattedText;
        }
      } else {
        // Fallback to basic memory context (no codebase RAG)
        this.memoryContext = await this.memoryClient.getMemoryContext(
          this.config.parentTaskId,
          taskDescription,
          {
            repository: this.config.targetRepo,
            limit: 5,
          }
        );

        if (this.memoryContext.formattedContext) {
          const skillCount = this.memoryContext.skills.length;
          const semanticCount = this.memoryContext.semanticMemories.length;
          const episodicCount = this.memoryContext.episodicMemories.length;

          console.log(`[Epic] Memory context retrieved: ${skillCount} skills, ${semanticCount} patterns, ${episodicCount} experiences`);

          // Store formatted context in config for executor to use
          this.config.memoryContext = this.memoryContext.formattedContext;
        } else {
          console.log("[Epic] No relevant memory context found");
        }
      }
    } catch (error) {
      // Memory retrieval failure is non-fatal - log and continue
      console.log("[Epic] Memory retrieval failed (non-fatal):", error instanceof Error ? error.message : error);
    }
  }

  /**
   * Get the current memory context (for external access if needed).
   */
  getMemoryContext(): MemoryContext | null {
    return this.memoryContext;
  }

  /**
   * Fetch Jira requirements from the task for tech_lead review.
   * This populates jiraRequirements in the config if the task has summary/description.
   */
  private async fetchJiraRequirements(): Promise<void> {
    try {
      const taskUrl = `${this.config.apiBaseUrl}/api/tasks/${this.config.parentTaskId}`;
      const response = await axios.get(taskUrl, {
        headers: {
          "x-api-key": this.config.orgApiKey,
        },
        timeout: 10000,
      });

      const task = response.data;
      if (task.summary || task.description) {
        const parts: string[] = [];
        if (task.summary) {
          parts.push(`**Summary:** ${task.summary}`);
        }
        if (task.description) {
          parts.push(`**Description:**\n${task.description}`);
        }
        this.config.jiraRequirements = parts.join("\n\n");
        console.log(`[Epic] Loaded Jira requirements (${this.config.jiraRequirements.length} chars)`);
      }
    } catch (error) {
      console.warn("[Epic] Failed to fetch Jira requirements:", error instanceof Error ? error.message : error);
      // Continue without requirements - not fatal
    }
  }

  /**
   * Fetch full ticket content directly from the source system (Linear/GitHub).
   * Provides richer content than the DB copy (comments, labels, etc.).
   */
  private async fetchTicketFromSource(): Promise<void> {
    const ticketKey = this.config.jiraIssueKey;
    const system = this.config.ticketSystem;
    if (!ticketKey) return;

    if (system === "linear") {
      // Linear: identifier format like "TB-7"
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
            headers: {
              Authorization: apiKey,
              "Content-Type": "application/json",
            },
            timeout: 10000,
          },
        );

        const issue = response.data?.data?.issue;
        if (issue) {
          const parts: string[] = [];
          if (issue.title) parts.push(`**Title:** ${issue.title}`);
          if (issue.description)
            parts.push(`**Description:**\n${issue.description}`);
          if (issue.labels?.nodes?.length > 0) {
            parts.push(
              `**Labels:** ${issue.labels.nodes.map((l: any) => l.name).join(", ")}`,
            );
          }
          // Include recent comments (cap at 5)
          if (issue.comments?.nodes?.length > 0) {
            const comments = issue.comments.nodes.slice(-5);
            const commentText = comments
              .map(
                (c: any) =>
                  `  - [${c.user?.name || "Unknown"}]: ${c.body}`,
              )
              .join("\n");
            parts.push(`**Recent Comments:**\n${commentText}`);
          }
          if (issue.url) this.config.ticketUrl = issue.url;

          this.config.jiraRequirements = parts.join("\n\n");
          console.log(
            `[Epic] Fetched ticket directly from Linear (${this.config.jiraRequirements.length} chars)`,
          );
        }
      } catch (error) {
        console.warn(
          "[Epic] Direct Linear fetch failed, falling back to API copy:",
          error instanceof Error ? error.message : error,
        );
        // Fall through — fetchJiraRequirements() will still provide the DB copy
      }
    } else if (system === "github") {
      // GitHub Issues: targetRepo format "owner/repo"
      this.config.ticketUrl = `https://github.com/${this.config.targetRepo}/issues/${ticketKey.replace(/\D/g, "")}`;
    }
    // Jira: would need JIRA_BASE_URL which isn't in env — skip for now, DB copy is sufficient
  }

  /**
   * Start the Epic coordination loop.
   */
  async start(): Promise<void> {
    console.log("[Epic] Starting Epic executor for task " + this.config.parentTaskId);
    this.missionActive = true;

    try {
      // Load dynamic expert registry from API
      await loadExpertRegistry(this.config.apiBaseUrl, this.config.orgApiKey);

      // Re-initialize expert states with (potentially updated) registry
      this.expertStates.clear();
      for (const expert of getAvailableExperts()) {
        this.expertStates.set(expert, {
          persona: expert,
          status: "idle",
        });
      }

      // Clone the repository
      await this.gitOps.cloneIfNeeded();

      // Initialize resume: check for existing completions from previous run
      await this.initializeWithResume();

      // Load worker config from Decision API (icons, defaults)
      const workerConfig = await this.decisionClient.getWorkerConfig();
      this.executor.setIcons(workerConfig.personaIcons, workerConfig.providerIcons);

      // Pass server-side prompt templates to executor
      if (workerConfig.promptTemplates) {
        this.executor.setPromptTemplates(workerConfig.promptTemplates);
        console.log("[Epic] Loaded 8 server-side prompt templates");
      }

      // Store for later use by reviewer/deployer/improver
      this.serverPromptTemplates = workerConfig.promptTemplates;

      // Detect and checkout existing branch for retry scenarios
      if (this.config.jiraIssueKey) {
        const priorWork = await this.gitOps.detectAndCheckoutExistingBranch(this.config.jiraIssueKey);
        if (priorWork) {
          console.log("[Epic] 🔄 RETRY SCENARIO: Found prior work on branch " + priorWork.branchName);
          console.log(`[Epic] Prior commits: ${priorWork.commits.length}`);
          if (priorWork.prUrl) {
            console.log(`[Epic] Existing PR: ${priorWork.prUrl} (${priorWork.prState})`);
            // Track existing PR for inline review phase
            this.currentPrUrl = priorWork.prUrl;
            this.currentPrNumber = priorWork.prNumber;
          }
          if (priorWork.prReviewComments && priorWork.prReviewComments.length > 0) {
            console.log(`[Epic] Review comments to address: ${priorWork.prReviewComments.length}`);
          }
          // Format and store prior work context for injection into prompts
          this.config.priorWorkContext = this.gitOps.formatPriorWorkContext(priorWork);

          // Post retry info to Jira
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

      // Fast path: deployment-only run (merge PR + deploy, skip planning/stories/review)
      const taskNotes = process.env.TASK_NOTES || "";
      if (taskNotes.includes("DEPLOYMENT_RUN")) {
        const prUrl = this.currentPrUrl || process.env.EXISTING_PR_URL;
        const prNumber = this.currentPrNumber || parseInt(process.env.EXISTING_PR_NUMBER || "0", 10);

        if (prUrl && prNumber) {
          console.log(`[Epic] DEPLOYMENT_RUN detected — skipping to deploy. PR: ${prUrl}`);
          await this.runDeploymentOnly(prUrl, prNumber);
          return;
        } else {
          console.warn("[Epic] DEPLOYMENT_RUN detected but no PR found — falling back to full run");
        }
      }

      // Fast path: review-only run (run Tech Lead review on existing PR)
      if (taskNotes.includes("REVIEW_RUN")) {
        const prUrl = this.currentPrUrl || process.env.EXISTING_PR_URL;
        const prNumber =
          this.currentPrNumber || parseInt(process.env.EXISTING_PR_NUMBER || "0", 10);

        if (prUrl && prNumber) {
          console.log(`[Epic] REVIEW_RUN detected — running review on PR: ${prUrl}`);
          const needsRevision = await this.runReviewOnly(prUrl, prNumber);
          if (!needsRevision) {
            return; // Review completed (approved, rejected, or escalated)
          }
          // Revision needed — fall through to full coordination loop
          console.log("[Epic] REVIEW_RUN: Revision needed, entering full coordination loop...");
        } else {
          console.warn("[Epic] REVIEW_RUN detected but no PR found — falling back to full run");
        }
      }

      // Retrieve memory context for the task (REQ-19)
      await this.retrieveMemoryContext();

      // Try direct ticket fetch first (gets richer content from source)
      await this.fetchTicketFromSource();

      // Fall back to DB copy if direct fetch didn't populate requirements
      if (!this.config.jiraRequirements) {
        await this.fetchJiraRequirements();
      }

      // Transition Jira to "In Progress"
      await this.ticketOps.transitionTo("In Progress");

      // Connect SSE for real-time push (falls back to polling if unavailable)
      this.coordination.connectSse();

      // Main coordination loop with transient error resilience
      // A single 5xx/network error should NOT kill a 50-minute epic.
      // Only fail after MAX_CONSECUTIVE_ERRORS consecutive transient failures.
      let consecutiveErrors = 0;
      const MAX_CONSECUTIVE_ERRORS = 5;
      while (this.missionActive) {
        try {
          await this.coordinationLoop();
          consecutiveErrors = 0; // Reset on success
        } catch (loopError) {
          consecutiveErrors++;
          const transient = this.isTransientError(loopError);

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
            await this.sleep(backoffMs);
            continue;
          }

          // Non-transient or too many consecutive failures
          if (transient && this.hasAnyCommittedCode) {
            // Code is already committed and pushed — don't kill the task over transient API errors.
            // Report escalated status so the task doesn't end up as "completed" via spawner fallback.
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
              // Best-effort — if this also fails, spawner fallback will handle it
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
          // Event-driven: wait for SSE push OR 30s safety timeout
          let onNewData: (() => void) | undefined;
          const newDataPromise = new Promise<void>((resolve) => {
            onNewData = resolve;
            this.coordination.once("newData", resolve);
          });
          await Promise.race([newDataPromise, this.sleep(30000)]);
          // Clean up the listener if the sleep won the race
          if (onNewData) this.coordination.removeListener("newData", onNewData);
        } else {
          // Fallback: poll every 5s (backward compatible with old API)
          await this.sleep(this.pollIntervalMs);
        }
      }
    } catch (error) {
      console.error("[Epic] Fatal error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Post failure comment to Jira
      try {
        await this.ticketOps.postComment(
          this.hasAnyCommittedCode
            ? `Epic failed: ${errorMessage} — committed code is on remote branches`
            : `Epic failed: ${errorMessage}`
        );
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
   * Called on SIGTERM to preserve as much progress as possible.
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
      // For each active worktree, commit and push any uncommitted work
      const worktreePaths = Array.from(this.activeWorktrees.entries());
      for (const [storyIndex, worktreePath] of worktreePaths) {
        console.log(`[Epic] Saving work for story ${storyIndex}...`);
        try {
          // Get branch name from active worktree tracking (set during story creation)
          const branchName = this.storyBranchNames.get(storyIndex) || `story/${(this.config.jiraIssueKey || "epic").toLowerCase()}/${storyIndex}`;

          // Commit any uncommitted work
          const commitSha = await this.gitOps.commitUncommittedWork(
            worktreePath,
            `WIP: Interrupted - graceful shutdown`
          );

          if (commitSha) {
            console.log(`[Epic] Committed WIP for story ${storyIndex}: ${commitSha}`);

            // Push to remote
            await this.gitOps.pushBranchFromWorktree(worktreePath, branchName);
            console.log(`[Epic] Pushed story ${storyIndex} to remote`);
          }
        } catch (e) {
          console.warn(`[Epic] Failed to save story ${storyIndex}:`, e);
        }
      }

      // Post interrupted status to coordination feed
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
   * Post a message to the task logs so it appears in the dashboard SSE stream.
   */
  private async postLog(message: string, type: string = "info"): Promise<void> {
    try {
      await axios.post(
        `${this.config.apiBaseUrl}/api/control-center/logs`,
        {
          taskId: this.config.parentTaskId,
          type,
          message: `[coordinator] ${message}`,
          severity: type === "error" ? "error" : "info",
        },
        { headers: { "x-api-key": this.config.orgApiKey }, timeout: 5000 }
      );
    } catch {
      // Fire and forget
    }
  }

  /**
   * Poll for pending commands from the dashboard (pause/resume/message).
   * Commands allow the user to interact with the worker in real-time.
   */
  private async pollForCommands(): Promise<void> {
    try {
      const response = await axios.get(
        `${this.config.apiBaseUrl}/api/coordination/commands/${this.config.parentTaskId}/pending`,
        {
          headers: {
            "x-api-key": this.config.orgApiKey,
          },
          timeout: 10000,
        }
      );

      const commands = response.data?.commands || [];

      for (const cmd of commands) {
        console.log(`[Epic] Received command: ${cmd.type} - ${cmd.content || "(no content)"}`);

        if (cmd.type === "pause") {
          // Acknowledge pause and wait for resume
          await this.acknowledgeCommand(cmd.id);
          await this.postLog("Pause requested by user — pausing after current stories complete");
          console.log("[Epic] Paused - waiting for resume...");
          await this.waitForResume();
        } else if (cmd.type === "message" || cmd.type === "resume") {
          // Store message as user feedback for next expert
          if (cmd.content) {
            this.userFeedback = cmd.content;
            console.log(`[Epic] User feedback received: ${cmd.content}`);

            const truncated =
              cmd.content.length > 200 ? cmd.content.substring(0, 200) + "..." : cmd.content;
            await this.postLog(`Message received from user: ${truncated}`);

            // Deliver message file to all active expert worktrees for mid-execution visibility
            this.writeMessageToActiveWorktrees(cmd.content);

            // Build rich acknowledgment with expert context
            const runningExperts = [...this.expertStates.entries()]
              .filter(([, s]) => s.status === "working" && s.currentStoryIndex !== undefined);

            let ackMessage: string;
            if (runningExperts.length > 0) {
              const expertDetails = runningExperts.map(([persona, s]) => {
                const storyLabel = `Story ${s.currentStoryIndex}`;
                return `${persona} (${storyLabel})`;
              }).join(", ");
              ackMessage = `Message delivered to ${expertDetails}. Feedback will be applied.`;
              await this.postLog(`Message delivered to running expert(s): ${expertDetails}`);
            } else {
              ackMessage = "Message acknowledged — no experts currently running. Will apply to next story execution.";
              await this.postLog("Message acknowledged — will apply to next story execution");
            }

            // Post acknowledgment to coordination feed (non-fatal if it fails)
            try {
              await this.coordination.postContext(
                "worker_ack",
                ackMessage,
                "coordinator",
                undefined,
                {
                  commandId: cmd.id,
                  commandType: cmd.type,
                  feedbackWillBeAppliedTo: runningExperts.length > 0 ? "running_experts_and_next_story" : "next_story",
                }
              );
            } catch (ackError) {
              console.warn("[Epic] Failed to post ack to coordination feed:", ackError instanceof Error ? ackError.message : ackError);
            }
          }
          await this.acknowledgeCommand(cmd.id);
        } else if (cmd.type === "toggle_self_review") {
          const enabled = cmd.content === "enabled";
          this.resilience.selfReviewEnabled = enabled;
          await this.postLog(`Self-review ${enabled ? "enabled" : "disabled"} by user`);
          console.log(`[Epic] Self-review ${enabled ? "enabled" : "disabled"} by dashboard toggle`);
          await this.acknowledgeCommand(cmd.id);
        } else if (cmd.type === "question") {
          // Dashboard asking worker a question - log it, worker can't respond yet
          console.log(`[Epic] Question from user: ${cmd.content}`);
          await this.acknowledgeCommand(cmd.id);
        }
      }
    } catch (error) {
      // Non-fatal - just log and continue
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // Task not found is expected if task was cancelled
        return;
      }
      console.warn("[Epic] Command polling failed:", error instanceof Error ? error.message : error);
    }
  }

  /**
   * Write a user message to .workermill-message.md in all active expert worktrees.
   * This allows running Claude CLI experts to see messages mid-execution by reading the file.
   */
  private writeMessageToActiveWorktrees(message: string): void {
    let delivered = 0;
    for (const [persona, state] of this.expertStates) {
      if (state.status !== "working" || state.currentStoryIndex === undefined) continue;

      const worktreePath = this.activeWorktrees.get(state.currentStoryIndex);
      if (!worktreePath) continue;

      try {
        const filePath = `${worktreePath}/.workermill-message.md`;
        const content = `# Message from User\n\n${message}\n\n---\n*Delivered at ${new Date().toISOString()}. Please read and incorporate this feedback into your current work.*\n`;
        writeFileSync(filePath, content, "utf-8");
        delivered++;
        console.log(`[Epic] Wrote message file to ${persona}'s worktree (story ${state.currentStoryIndex})`);
      } catch (err) {
        console.warn(`[Epic] Failed to write message file to ${persona}'s worktree:`, err instanceof Error ? err.message : err);
      }
    }
    if (delivered > 0) {
      console.log(`[Epic] Message delivered to ${delivered} active expert worktree(s)`);
    }
  }

  /**
   * Write an answer file to the asking expert's worktree so they can read it mid-execution.
   */
  private writeAnswerToWorktree(
    worktreePath: string,
    question: {
      id: string;
      content: string;
      fromPersona: string;
      metadata?: Record<string, unknown>;
    },
    answer: string,
    responder: ExpertPersona
  ): void {
    try {
      const filePath = `${worktreePath}/.workermill-answer.md`;
      const questionId =
        (question.metadata?.questionId as string) || question.id;
      const content = `# Answer to Your Question\n\n**Question (${questionId}):** ${question.content}\n\n**Answer from ${responder}:**\n\n${answer}\n\n---\n*Delivered at ${new Date().toISOString()}. Incorporate this into your current work.*\n`;
      writeFileSync(filePath, content, "utf-8");
      console.log(
        `[Epic] Wrote answer file to ${question.fromPersona}'s worktree (story ${question.metadata?.fromStory})`
      );
    } catch (err) {
      console.warn(
        `[Epic] Failed to write answer to worktree:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  /**
   * Look up the asking expert's worktree via fromStory metadata and deliver the answer file.
   */
  private deliverAnswerToAsker(
    question: {
      id: string;
      content: string;
      fromPersona: string;
      metadata?: Record<string, unknown>;
    },
    answerText: string | null,
    responder: ExpertPersona
  ): void {
    if (!answerText) return;
    const fromStory = question.metadata?.fromStory as number | undefined;
    if (fromStory === undefined) return;
    const worktreePath = this.activeWorktrees.get(fromStory);
    if (!worktreePath) return;
    this.writeAnswerToWorktree(worktreePath, question, answerText, responder);
  }

  /**
   * Look up the asking expert's story context for enriching answer prompts.
   * Returns a formatted string with story title, description, target files, and task summary.
   */
  private async getStoryContext(
    question: { fromPersona: string; metadata?: Record<string, unknown> }
  ): Promise<string> {
    const fromStory = question.metadata?.fromStory as number | undefined;
    if (fromStory === undefined) return "";
    const stories = await this.coordination.getReadyStories();
    const story = stories.find((s) => s.storyIndex === fromStory);
    if (!story) return "";
    let ctx = `The asking expert (${question.fromPersona}) is working on Story ${story.storyIndex}: "${story.title}"`;
    if (story.description) ctx += `\nStory description: ${story.description}`;
    if (story.targetFiles?.length) ctx += `\nTarget files: ${story.targetFiles.join(", ")}`;
    if (this.config.taskSummary) ctx += `\nOverall task: ${this.config.taskSummary}`;
    return ctx;
  }

  /**
   * Write an "answer pending" placeholder to the asker's worktree.
   * Tells the worker that a virtual expert is researching their question.
   */
  private writePendingPlaceholder(
    question: { id: string; content: string; fromPersona: string; metadata?: Record<string, unknown> },
    targetPersona: string
  ): void {
    const fromStory = question.metadata?.fromStory as number | undefined;
    if (fromStory === undefined) return;
    const worktreePath = this.activeWorktrees.get(fromStory);
    if (!worktreePath) return;
    const questionId = (question.metadata?.questionId as string) || question.id;
    const content = `# Answer Pending\n\nA virtual **${targetPersona}** specialist is researching your question (${questionId}).\nA detailed answer will replace this file shortly.\n\n**Continue with work that doesn't depend on this answer.** Check back before finalizing related decisions.\n`;
    try {
      writeFileSync(`${worktreePath}/.workermill-answer.md`, content, "utf-8");
    } catch {
      /* non-fatal */
    }
  }

  /**
   * Remove .workermill-message.md, .workermill-response.md, and .workermill-answer.md
   * from a story's worktree (cleanup after story completion).
   */
  private cleanupMessageFiles(storyIndex: number): void {
    const worktreePath = this.activeWorktrees.get(storyIndex);
    if (!worktreePath) return;

    for (const filename of [
      ".workermill-message.md",
      ".workermill-response.md",
      ".workermill-answer.md",
    ]) {
      try {
        const filePath = `${worktreePath}/${filename}`;
        if (existsSync(filePath)) {
          unlinkSync(filePath);
          console.log(`[Epic] Cleaned up ${filename} from story ${storyIndex} worktree`);
        }
      } catch (err) {
        // Non-fatal — worktree may already be removed
      }
    }
  }

  /**
   * Check active expert worktrees for .workermill-response.md files.
   * When found, read the content, post it to the coordination feed, and delete the file.
   * This enables experts to send messages to the user mid-execution.
   */
  private async checkExpertResponses(): Promise<void> {
    for (const [persona, state] of this.expertStates) {
      if (state.status !== "working" || state.currentStoryIndex === undefined) continue;

      const worktreePath = this.activeWorktrees.get(state.currentStoryIndex);
      if (!worktreePath) continue;

      const filePath = `${worktreePath}/.workermill-response.md`;
      if (!existsSync(filePath)) continue;

      try {
        const content = readFileSync(filePath, "utf-8").trim();
        unlinkSync(filePath);

        if (!content) continue;

        console.log(`[Epic] Expert response from ${persona} (story ${state.currentStoryIndex}): ${content.substring(0, 100)}`);

        // Post to coordination feed so user sees it on the dashboard
        await this.coordination.postContext(
          "expert_response",
          content,
          persona,
          undefined,
          {
            storyIndex: state.currentStoryIndex,
            deliveryMethod: "worktree_file",
          }
        );

        // Also post to dashboard log for immediate visibility
        const truncated = content.length > 300 ? content.substring(0, 300) + "..." : content;
        await this.postLog(`💬 ${persona} says: ${truncated}`);
      } catch (err) {
        console.warn(`[Epic] Failed to read expert response from ${persona}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  /**
   * Acknowledge a command to mark it as received.
   */
  private async acknowledgeCommand(commandId: string): Promise<void> {
    try {
      await axios.post(
        `${this.config.apiBaseUrl}/api/coordination/commands/${commandId}/acknowledge`,
        {},
        {
          headers: {
            "x-api-key": this.config.orgApiKey,
          },
          timeout: 10000,
        }
      );
    } catch (error) {
      console.warn("[Epic] Failed to acknowledge command:", error instanceof Error ? error.message : error);
    }
  }

  /**
   * Wait for a resume command from the dashboard.
   * Polls every 2 seconds until a resume is received.
   */
  private async waitForResume(): Promise<void> {
    while (this.missionActive) {
      await this.sleep(2000);

      try {
        const response = await axios.get(
          `${this.config.apiBaseUrl}/api/coordination/commands/${this.config.parentTaskId}/pending`,
          {
            headers: {
              "x-api-key": this.config.orgApiKey,
            },
            timeout: 10000,
          }
        );

        const commands = response.data?.commands || [];
        const resumeCmd = commands.find((c: { type: string }) => c.type === "resume");

        if (resumeCmd) {
          if (resumeCmd.content) {
            this.userFeedback = resumeCmd.content;
            console.log(`[Epic] Resumed with feedback: ${resumeCmd.content}`);

            // Post acknowledgment to coordination feed
            await this.coordination.postContext(
              "worker_ack",
              `✅ Worker received message: "${resumeCmd.content}"`,
              "coordinator",
              undefined,
              {
                commandId: resumeCmd.id,
                commandType: "resume",
                feedbackWillBeAppliedTo: "next_story",
              }
            );
          } else {
            console.log("[Epic] Resumed without feedback");
          }
          await this.acknowledgeCommand(resumeCmd.id);
          return;
        }

        // Also check for other commands while paused (e.g., additional messages)
        for (const cmd of commands) {
          if (cmd.type === "message" && cmd.content) {
            this.userFeedback = cmd.content;
            console.log(`[Epic] Message while paused: ${cmd.content}`);

            // Post acknowledgment to coordination feed
            await this.coordination.postContext(
              "worker_ack",
              `✅ Worker received message: "${cmd.content}"`,
              "coordinator",
              undefined,
              {
                commandId: cmd.id,
                commandType: "message",
                feedbackWillBeAppliedTo: "next_story",
              }
            );
            await this.acknowledgeCommand(cmd.id);
          }
        }
      } catch (error) {
        console.warn("[Epic] Resume polling failed:", error instanceof Error ? error.message : error);
      }
    }
  }

  /**
   * Get and clear any pending user feedback.
   * Returns the feedback string if set, otherwise null.
   */
  getUserFeedback(): string | null {
    const feedback = this.userFeedback;
    this.userFeedback = null;
    return feedback;
  }

  /**
   * Main coordination loop iteration.
   * Uses request coalescing to minimize API calls within each iteration.
   */
  private async coordinationLoop(): Promise<void> {
    // Proactive conflict detection: scan worktrees every 3rd iteration (~15s at 5s poll)
    this.loopIterationCount++;
    if (this.loopIterationCount % 3 === 0) {
      this.scanRunningWorktrees();
    }

    // 0. Check for dashboard commands (pause/resume/message)
    await this.pollForCommands();

    // 0.1. Check for expert responses (.workermill-response.md files in worktrees)
    await this.checkExpertResponses();

    // Start new iteration - invalidates cache so we get fresh data,
    // but subsequent calls within this iteration will be coalesced
    this.coordination.startIteration();

    // 0.5. Check for blockers - if any exist, pause and wait for resolution
    const blockerHandled = await this.checkAndHandleBlockers();
    if (blockerHandled) {
      // Blocker was handled, restart coordination loop to reassess state
      return;
    }

    // 1. FIRST: Have idle experts answer pending questions for them (Task 2: answer-first)
    await this.processAnswerFirst();

    // 2. Check for ready stories and match to idle experts
    await this.processReadyStories();

    // 3. Check for unanswered questions and route to experts
    await this.processQuestions();

    // 4. Check for completions
    await this.checkCompletions();

    // 4.5. Process incremental integration queue
    await this.processIntegrationQueue();

    // 5. Check if all stories are done (mission complete)
    await this.checkMissionComplete();
  }

  /**
   * Check for unresolved blockers and handle them.
   * Returns true if a blocker was detected and handled.
   */
  private async checkAndHandleBlockers(): Promise<boolean> {
    if (!this.blockerManager) return false;

    const blocker = await this.blockerManager.checkForBlockers();
    if (!blocker) return false;

    console.log(`[Epic] ⚠️ BLOCKER DETECTED for story ${blocker.storyIndex}: ${blocker.errorCategory}`);
    console.log(`[Epic] Error: ${blocker.errorMessage.substring(0, 200)}...`);

    // Mark dependent stories as blocked
    if (blocker.dependentStories.length > 0) {
      for (const depIndex of blocker.dependentStories) {
        this.blockedStoryIndices.add(depIndex);
      }
      console.log(`[Epic] Blocked dependent stories: ${blocker.dependentStories.join(", ")}`);
    }

    // Update task status to escalated so dashboard shows correct state
    await this.updateTaskStatus(
      "escalated",
      `Story ${blocker.storyIndex} — blocked: ${blocker.errorCategory}`,
      blocker.errorMessage
    );

    // Wait for human resolution (timeout configurable, default 20 min)
    const blockerTimeout = this.resilience.blockerWaitTimeoutMs;
    console.log(`[Epic] Waiting for human resolution (timeout: ${Math.round(blockerTimeout / 60_000)}min)...`);
    const response = await this.blockerManager.waitForBlockerResponse(blocker, blockerTimeout);

    if (!response) {
      // Timeout - abort the mission
      console.log(`[Epic] Blocker resolution timed out - aborting mission`);
      this.missionActive = false;
      await this.updateTaskStatus("failed", undefined, "Blocker resolution timed out");
      return true;
    }

    // Handle the resolution
    await this.handleBlockerResponse(response, blocker);
    return true;
  }

  /**
   * Handle a blocker resolution response from the user.
   */
  private async handleBlockerResponse(
    response: { action: "retry" | "skip" | "abort"; guidance?: string },
    blocker: { storyIndex: number; dependentStories: number[] }
  ): Promise<void> {
    console.log(`[Epic] Blocker resolved with action: ${response.action}`);

    switch (response.action) {
      case "retry":
        // Safety net: if retries are exhausted, auto-skip instead of looping
        if (this.blockerManager?.hasExhaustedRetries(blocker.storyIndex)) {
          console.log(`[Epic] Story ${blocker.storyIndex} exhausted retries (${this.blockerManager.getRetryCount(blocker.storyIndex)}) — auto-skipping`);
          this.completedStoryIndices.add(blocker.storyIndex);
          this.failedStoryIndices.delete(blocker.storyIndex);
          for (const depIndex of blocker.dependentStories) {
            this.completedStoryIndices.add(depIndex);
            this.blockedStoryIndices.delete(depIndex);
          }
          await this.updateTaskStatus("running", `Story ${blocker.storyIndex} auto-skipped (retries exhausted)`);
          break;
        }
        // Clear the blocker and retry the story
        this.failedStoryIndices.delete(blocker.storyIndex);
        this.completedStoryIndices.delete(blocker.storyIndex);
        // If guidance was provided, it will be passed to the story on re-execution
        if (response.guidance) {
          this.userFeedback = response.guidance;
          console.log(`[Epic] Retry guidance: ${response.guidance}`);
        }
        // Unblock dependent stories
        for (const depIndex of blocker.dependentStories) {
          this.blockedStoryIndices.delete(depIndex);
        }
        // Re-queue the story for revision execution (bypass claim system)
        // Without this, the story is in limbo — not failed, not completed, not queued
        {
          const allStories = await this.coordination.getReadyStories();
          const storyToRetry = allStories.find((s) => s.storyIndex === blocker.storyIndex);
          if (storyToRetry) {
            this.revisionStoriesQueued.push(storyToRetry);
            console.log(`[Epic] Re-queued story ${blocker.storyIndex} for revision execution`);
          } else {
            console.warn(`[Epic] Could not find story ${blocker.storyIndex} in ready stories — it may not re-execute`);
          }
        }
        // Resume running status
        await this.updateTaskStatus("running", `Retrying story ${blocker.storyIndex}`);
        break;

      case "skip":
        // Mark the story as completed (skipped) and unblock dependents
        // Note: Dependents will also be skipped since their dependency is "skipped"
        this.completedStoryIndices.add(blocker.storyIndex);
        this.failedStoryIndices.delete(blocker.storyIndex);
        console.log(`[Epic] Skipping story ${blocker.storyIndex} and all dependents`);
        // Mark all dependents as blocked (they'll be skipped too)
        for (const depIndex of blocker.dependentStories) {
          this.completedStoryIndices.add(depIndex);
          this.blockedStoryIndices.delete(depIndex);
          console.log(`[Epic] Skipping dependent story ${depIndex}`);
        }
        // Resume running status
        await this.updateTaskStatus("running", `Skipped story ${blocker.storyIndex}, continuing...`);
        break;

      case "abort":
        // Stop the entire mission
        console.log(`[Epic] Aborting mission per user request`);
        this.missionActive = false;
        await this.updateTaskStatus("failed", undefined, "Aborted by user due to blocker");
        break;
    }
  }

  /**
   * Check if a story has a mutex conflict with any currently running story.
   * Stories in the same mutex group cannot run in parallel to prevent file conflicts.
   * @param story The story to check
   * @returns true if there's a conflict, false if safe to run
   */
  private hasMutexConflict(story: ReadyStory): boolean {
    const storyMutexGroups = story.mutexGroups || [];

    // If story has no mutex groups, it can run in parallel with anything
    if (storyMutexGroups.length === 0) {
      return false;
    }

    // Check against all running stories
    for (const [runningIndex, runningGroups] of this.runningStoryMutexGroups) {
      // Skip if comparing with self (shouldn't happen, but be safe)
      if (runningIndex === story.storyIndex) continue;

      // Check for any overlapping mutex groups
      for (const group of storyMutexGroups) {
        if (runningGroups.includes(group)) {
          console.log(
            `[Epic] Story ${story.storyIndex} blocked by mutex conflict with running story ${runningIndex} (group: ${group})`
          );
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if a story has file-overlap conflicts with any currently running story.
   * Stories targeting the same files cannot run in parallel.
   * @param story The story to check
   * @returns true if there's an overlap, false if safe to run
   */
  private hasFileOverlap(story: ReadyStory): boolean {
    if (!(this.resilience.fileOverlapGatingEnabled ?? true)) {
      return false;
    }

    const storyFiles = story.targetFiles || [];
    if (storyFiles.length === 0) {
      return false;
    }

    const storyFilesLower = storyFiles.map((f) => f.toLowerCase());

    for (const [runningIndex, runningFiles] of this.runningStoryTargetFiles) {
      if (runningIndex === story.storyIndex) continue;
      if (runningFiles.length === 0) continue;

      const runningFilesLower = runningFiles.map((f) => f.toLowerCase());
      const overlap = storyFilesLower.filter((f) => runningFilesLower.includes(f));

      if (overlap.length > 0) {
        const msg = `Story ${story.storyIndex} blocked by file overlap with running story ${runningIndex} (${overlap.join(", ")})`;
        console.log(`[Epic] ${msg}`);
        this.postDashboardLog(msg);
        return true;
      }
    }

    return false;
  }

  /**
   * Register a story as running with its mutex groups and target files.
   * Called when a story is claimed and starts execution.
   */
  private registerRunningStory(storyIndex: number, mutexGroups: string[], targetFiles?: string[]): void {
    this.runningStoryMutexGroups.set(storyIndex, mutexGroups);
    this.runningStoryTargetFiles.set(storyIndex, targetFiles || []);
    if (mutexGroups.length > 0) {
      console.log(`[Epic] Registered story ${storyIndex} with mutex groups: ${mutexGroups.join(", ")}`);
    }
    if (targetFiles && targetFiles.length > 0) {
      console.log(`[Epic] Registered story ${storyIndex} with ${targetFiles.length} target file(s)`);
    }
  }

  /**
   * Unregister a story from running stories.
   * Called when a story completes (success or failure).
   */
  private unregisterRunningStory(storyIndex: number): void {
    if (this.runningStoryMutexGroups.has(storyIndex)) {
      console.log(`[Epic] Unregistered story ${storyIndex} from mutex tracking`);
      this.runningStoryMutexGroups.delete(storyIndex);
    }
    this.runningStoryTargetFiles.delete(storyIndex);
  }

  /**
   * Scan running experts' worktrees for actual file modifications.
   * Updates runningStoryTargetFiles with real data so hasFileOverlap() gates
   * new stories based on actual modifications, not just planner predictions.
   */
  private scanRunningWorktrees(): void {
    const mainBranch = this.gitOps.getMainBranch();

    for (const [persona, state] of this.expertStates) {
      if (state.status !== "working" || state.currentStoryIndex === undefined) continue;

      const storyIndex = state.currentStoryIndex;
      const worktreePath = this.activeWorktrees.get(storyIndex);
      if (!worktreePath) continue;

      try {
        // Uncommitted changes (staged + unstaged)
        const uncommitted = execSync("git diff --name-only HEAD", {
          cwd: worktreePath,
          timeout: 5000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        })
          .trim()
          .split("\n")
          .filter(Boolean);

        // Committed changes on this branch vs main
        const committed = execSync(
          `git diff --name-only origin/${mainBranch}..HEAD`,
          {
            cwd: worktreePath,
            timeout: 5000,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          },
        )
          .trim()
          .split("\n")
          .filter(Boolean);

        const actualFiles = [...new Set([...uncommitted, ...committed])];
        if (actualFiles.length === 0) continue;

        const declared = this.runningStoryTargetFiles.get(storyIndex) || [];
        const declaredLower = new Set(declared.map((f) => f.toLowerCase()));
        const newFiles = actualFiles.filter(
          (f) => !declaredLower.has(f.toLowerCase()),
        );

        if (newFiles.length === 0) continue;

        // Merge actual files into the gating map
        const merged = [...declared, ...newFiles];
        this.runningStoryTargetFiles.set(storyIndex, merged);
        console.log(
          `[Epic] Worktree scan: story ${storyIndex} (${persona}) touching ${newFiles.length} undeclared file(s): ${newFiles.slice(0, 5).join(", ")}${newFiles.length > 5 ? "..." : ""}`,
        );

        // Check if newly detected files overlap with another running story
        const newFilesLower = new Set(newFiles.map((f) => f.toLowerCase()));
        for (const [otherIndex, otherFiles] of this.runningStoryTargetFiles) {
          if (otherIndex === storyIndex) continue;
          if (otherFiles.length === 0) continue;

          const overlap = otherFiles.filter((f) =>
            newFilesLower.has(f.toLowerCase()),
          );
          if (overlap.length > 0) {
            const msg = `⚠️ Worktree scan: story ${storyIndex} now overlaps with story ${otherIndex} on: ${overlap.join(", ")}`;
            console.warn(`[Epic] ${msg}`);
            this.postDashboardLog(msg);
          }
        }
      } catch {
        // Non-fatal: worktree may be mid-rebase, not yet created, or just cleaned up
      }
    }
  }

  /**
   * Process answer-first workflow: have idle experts answer pending questions targeting them.
   * This ensures experts answer questions BEFORE taking on new stories.
   * (Task 2: Answer-first workflow)
   */
  private async processAnswerFirst(): Promise<void> {
    // Get all idle experts
    const idleExperts = Array.from(this.expertStates.entries())
      .filter(([_, state]) => state.status === "idle")
      .map(([persona]) => persona);

    if (idleExperts.length === 0) return;

    // Track which questions get answered in this pass to avoid duplicates
    const answeredInPass = new Set<string>();

    // Pass 1: Each idle expert answers questions explicitly targeting them
    for (const expertPersona of idleExperts) {
      const pendingQuestions = await this.coordination.getQuestionsForPersona(expertPersona);

      if (pendingQuestions.length === 0) continue;

      console.log(`[Epic] ${expertPersona} has ${pendingQuestions.length} pending question(s) to answer first`);

      this.expertStates.set(expertPersona, {
        persona: expertPersona,
        status: "working",
      });

      for (const question of pendingQuestions) {
        if (answeredInPass.has(question.id)) continue;
        console.log(`[Epic] ${expertPersona} answering question from ${question.fromPersona}`);

        try {
          const storyCtx = await this.getStoryContext(question);
          const answerText = await this.executor.answerQuestion(
            {
              id: question.id,
              parentTaskId: question.parentTaskId,
              taskId: undefined,
              persona: question.fromPersona,
              messageType: "question",
              content: question.content,
              metadata: question.metadata,
              createdAt: question.createdAt,
            },
            expertPersona,
            storyCtx
          );
          answeredInPass.add(question.id);

          // Deliver answer file to asking expert's worktree
          if (answerText) {
            const fromStory = question.metadata?.fromStory as
              | number
              | undefined;
            if (fromStory !== undefined) {
              const worktreePath = this.activeWorktrees.get(fromStory);
              if (worktreePath) {
                this.writeAnswerToWorktree(
                  worktreePath,
                  question,
                  answerText,
                  expertPersona
                );
              }
            }
          }
        } catch (error) {
          console.error(`[Epic] ${expertPersona} failed to answer question:`, error);
        }
      }

      this.expertStates.set(expertPersona, {
        persona: expertPersona,
        status: "idle",
      });
    }

    // Pass 2: Route orphaned questions (target is busy) to idle experts
    const allUnanswered = await this.coordination.getUnansweredQuestions();
    const orphanedQuestions = allUnanswered.filter((q) => {
      if (answeredInPass.has(q.id)) return false;

      // Determine who the question targets
      const target = (q.metadata?.targetPersona as ExpertPersona) || null;
      if (!target) return true; // No target — always an orphan, route to any idle expert

      // Only orphaned if target is busy (not idle)
      const targetState = this.expertStates.get(target);
      return !targetState || targetState.status !== "idle";
    });

    if (orphanedQuestions.length === 0) return;

    // Re-check which experts are still idle after pass 1 (exclude non-coding personas)
    const stillIdleExperts = Array.from(this.expertStates.entries())
      .filter(([_, state]) => state.status === "idle")
      .filter(([persona]) => !QUESTION_INELIGIBLE_PERSONAS.has(persona))
      .map(([persona]) => persona);

    if (stillIdleExperts.length === 0) return;

    for (const question of orphanedQuestions) {
      if (answeredInPass.has(question.id)) continue;

      // Route via Decision API for specialty matching
      const orphanRouting = await this.decisionClient.routeQuestion({
        question: question.content,
        targetPersona: (question.metadata?.targetPersona as string) || undefined,
        idleExperts: stillIdleExperts,
      });
      let responder: ExpertPersona | null = null;

      if (
        orphanRouting.targetExpert &&
        stillIdleExperts.includes(orphanRouting.targetExpert as ExpertPersona) &&
        orphanRouting.targetExpert !== question.fromPersona
      ) {
        responder = orphanRouting.targetExpert as ExpertPersona;
      } else {
        // Any idle expert (excluding the asker)
        responder =
          stillIdleExperts.find((p) => p !== question.fromPersona) || null;
      }

      if (!responder) continue;

      const originalTarget = (question.metadata?.targetPersona as string) || "unknown";
      console.log(
        `[Epic] Routing orphaned question ${question.id} (target ${originalTarget} busy) to idle ${responder}`
      );
      await this.postLog(
        `Routing orphaned question to ${responder} (target ${originalTarget} busy)`
      );

      this.expertStates.set(responder, {
        persona: responder,
        status: "working",
      });

      try {
        const storyCtx = await this.getStoryContext(question);
        const answerText = await this.executor.answerQuestion(
          {
            id: question.id,
            parentTaskId: question.parentTaskId,
            taskId: undefined,
            persona: question.fromPersona,
            messageType: "question",
            content: question.content,
            metadata: question.metadata,
            createdAt: question.createdAt,
          },
          responder,
          storyCtx
        );
        answeredInPass.add(question.id);

        // Deliver answer file to asking expert's worktree
        if (answerText) {
          const fromStory = question.metadata?.fromStory as
            | number
            | undefined;
          if (fromStory !== undefined) {
            const worktreePath = this.activeWorktrees.get(fromStory);
            if (worktreePath) {
              this.writeAnswerToWorktree(
                worktreePath,
                question,
                answerText,
                responder
              );
            }
          }
        }
      } catch (error) {
        console.error(`[Epic] ${responder} failed to answer orphaned question:`, error);
      }

      this.expertStates.set(responder, {
        persona: responder,
        status: "idle",
      });

      // Remove from stillIdleExperts to avoid double-assignment
      const idx = stillIdleExperts.indexOf(responder);
      if (idx !== -1) stillIdleExperts.splice(idx, 1);
      if (stillIdleExperts.length === 0) break;
    }
  }

  /**
   * Process ready stories and assign to idle experts.
   * For revisions, processes queued stories directly (bypass claim system).
   * Enforces story dependencies - stories only run when dependencies are complete.
   */
  private async processReadyStories(): Promise<void> {
    // First, check if we have revision stories queued (bypass claim system)
    if (this.revisionStoriesQueued.length > 0) {
      await this.processRevisionStories();
      return;
    }

    // Normal flow: get ready stories from coordination feed
    const readyStories = await this.coordination.getReadyStories();

    // Update class-level completed stories set from coordination feed
    // This keeps it in sync with any completions from the current run
    const completions = await this.coordination.getCurrentRevisionCompletions();
    for (const c of completions) {
      const storyIndex = c.metadata?.storyIndex as number;
      if (storyIndex !== undefined && !this.completedStoryIndices.has(storyIndex)) {
        this.completedStoryIndices.add(storyIndex);
        console.log(`[Epic] Story ${storyIndex} completed`);
      }
    }

    // Track total stories for lazy coordination loading
    // This includes all story_ready messages, even claimed ones
    if (this.totalStories === 0 && readyStories.length > 0) {
      // Count total stories by looking at max storyIndex (since we may have already claimed some)
      const maxIndex = Math.max(...readyStories.map(s => s.storyIndex), 0);
      this.totalStories = maxIndex + 1;
      console.log(`[Epic] Total stories in Epic: ${this.totalStories}`);
    }

    console.log(`[Epic] Processing ${readyStories.length} ready stories...`);
    for (const story of readyStories) {
      // Skip already completed stories (from resume or current run)
      if (this.completedStoryIndices.has(story.storyIndex)) {
        // Only log once when first discovered (not every poll cycle)
        continue;
      }

      // Skip blocked stories (due to dependency failure)
      if (this.blockedStoryIndices.has(story.storyIndex)) {
        continue;
      }

      // Skip failed stories (escalated blocker, awaiting human resolution)
      if (this.failedStoryIndices.has(story.storyIndex)) {
        continue;
      }


      console.log(`[Epic] Checking story ${story.storyIndex}: persona=${story.persona}, id=${story.id}`);

      // Check if story's dependencies are all completed
      if (story.dependencies && story.dependencies.length > 0) {
        const unmetDeps = story.dependencies.filter(
          (depIndex) => !this.completedStoryIndices.has(depIndex)
        );
        if (unmetDeps.length > 0) {
          console.log(
            `[Epic] Story ${story.storyIndex} blocked - waiting for dependencies: ${unmetDeps.join(", ")}`
          );
          continue;
        }
      }

      // Check for mutex conflicts with running stories
      if (this.hasMutexConflict(story)) {
        continue;
      }

      // Check for file-overlap conflicts with running stories
      if (this.hasFileOverlap(story)) {
        continue;
      }

      // Find matching expert
      const expertPersona = matchPersonaToExpert(story.persona);
      if (!expertPersona) {
        console.log("[Epic] No expert match for persona: " + story.persona);
        continue;
      }
      console.log(`[Epic] Matched to expert: ${expertPersona}`);

      // Check if expert is available
      const expertState = this.expertStates.get(expertPersona);
      console.log(`[Epic] Expert state: ${JSON.stringify(expertState)}`);
      if (!expertState || expertState.status !== "idle") {
        console.log(`[Epic] Expert ${expertPersona} not available (state: ${expertState?.status || 'undefined'})`);
        continue;
      }

      // Try to claim the story
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
          // Stale claim from a previous retry — archive it and retry on next iteration
          console.log(`[Epic] Story ${story.storyIndex} has stale claim (claimedBy=${claimResult.claimedBy}) — archiving`);
          this.postLog(`Archiving stale claim for story ${story.storyIndex} — will retry`);
          try {
            await this.coordination.archiveStoryClaims([story.storyIndex]);
          } catch (archiveErr) {
            console.log(`[Epic] Failed to archive stale claim: ${archiveErr instanceof Error ? archiveErr.message : String(archiveErr)}`);
          }
        } else {
          console.log(`[Epic] Claim failed for story ${story.storyIndex} (alreadyClaimed=${claimResult.alreadyClaimed}, claimedBy=${claimResult.claimedBy})`);
        }
        continue;
      }

      console.log("[Epic] " + expertPersona + " claimed story " + story.storyIndex);

      // Register story for mutex tracking and file-overlap gating
      this.registerRunningStory(story.storyIndex, story.mutexGroups || [], story.targetFiles);

      // Update expert state
      this.expertStates.set(expertPersona, {
        persona: expertPersona,
        status: "working",
        currentStoryId: story.id,
        currentStoryIndex: story.storyIndex,
        startedAt: new Date(),
      });

      // Get any pending user feedback (from Talk to Worker)
      const feedback = this.getUserFeedback();
      if (feedback) {
        console.log(`[Epic] Passing user feedback to ${expertPersona}: "${feedback.substring(0, 50)}..."`);
        this.postLog(`Applying user feedback to story ${story.storyIndex}: ${story.title || "(untitled)"}`);
      }

      // Fire-and-forget: expert executes story in parallel
      this.executeStoryAsync(story, expertPersona, this.totalStories, feedback || undefined);
    }
  }

  /**
   * Process revision stories directly (bypass claim system).
   * These are stories that need re-execution after a Tech Lead revision request.
   * Enforces story dependencies - stories only run when dependencies are complete.
   */
  private async processRevisionStories(): Promise<void> {
    // Update completed stories from coordination feed
    const completions = await this.coordination.getCurrentRevisionCompletions();
    for (const c of completions) {
      const storyIndex = c.metadata?.storyIndex as number;
      if (storyIndex !== undefined) {
        this.completedStoryIndices.add(storyIndex);
      }
    }

    // Safe dequeue: filter in-place instead of clear-then-re-add.
    // The old pattern (copy → clear → re-add) could silently drop stories
    // if any code path failed to re-add them, causing checkMissionComplete
    // to fire prematurely with missing stories.
    const dispatched: number[] = [];

    for (const story of this.revisionStoriesQueued) {
      // Check if story's dependencies are all completed
      if (story.dependencies && story.dependencies.length > 0) {
        const unmetDeps = story.dependencies.filter(
          (depIndex) => !this.completedStoryIndices.has(depIndex)
        );
        if (unmetDeps.length > 0) {
          if (!this.loggedBlockedStories.has(story.storyIndex)) {
            console.log(
              `[Epic] Revision story ${story.storyIndex} blocked - waiting for dependencies: ${unmetDeps.join(", ")}`
            );
            this.loggedBlockedStories.add(story.storyIndex);
          }
          continue; // stays in queue
        }
      }

      // Check for mutex conflicts with running stories
      if (this.hasMutexConflict(story)) {
        continue; // stays in queue
      }

      // Check for file-overlap conflicts with running stories
      if (this.hasFileOverlap(story)) {
        continue; // stays in queue
      }

      // Find matching expert
      const expertPersona = matchPersonaToExpert(story.persona);
      if (!expertPersona) {
        continue; // stays in queue
      }

      // Check if expert is available
      const expertState = this.expertStates.get(expertPersona);
      if (!expertState || expertState.status !== "idle") {
        continue; // stays in queue
      }

      // All checks passed — dispatch this story
      dispatched.push(story.storyIndex);

      console.log(`[Epic] ${expertPersona} executing revision for story ${story.storyIndex}`);

      // Register story for mutex tracking and file-overlap gating
      this.registerRunningStory(story.storyIndex, story.mutexGroups || [], story.targetFiles);

      // Update expert state
      this.expertStates.set(expertPersona, {
        persona: expertPersona,
        status: "working",
        currentStoryId: story.id,
        currentStoryIndex: story.storyIndex,
        startedAt: new Date(),
      });

      // Get any pending user feedback (from Talk to Worker) for revision stories too
      const revisionFeedback = this.getUserFeedback();
      if (revisionFeedback) {
        console.log(`[Epic] Passing user feedback to ${expertPersona} (revision): "${revisionFeedback.substring(0, 50)}..."`);
        this.postLog(
          `Applying user feedback to revision story ${story.storyIndex}: ${story.title || "(untitled)"}`
        );
      }

      // Fire-and-forget: expert executes revision story in parallel
      this.executeStoryAsync(story, expertPersona, this.totalStories, revisionFeedback || undefined);
    }

    // Remove only dispatched stories from the queue
    if (dispatched.length > 0) {
      this.revisionStoriesQueued = this.revisionStoriesQueued.filter(
        (s) => !dispatched.includes(s.storyIndex)
      );
    }
  }

  /**
   * Execute a story asynchronously.
   * @param totalStories - Total number of stories in the Epic (for lazy coordination loading)
   * @param userFeedback - Optional feedback from user via Talk to Worker
   */
  private async executeStoryAsync(
    story: ReadyStory,
    expert: ExpertPersona,
    totalStories: number = 1,
    userFeedback?: string
  ): Promise<void> {
    try {
      const result = await this.executor.executeStory(story, expert, totalStories, userFeedback);

      // Handle rate limiting — escalate immediately as blocker (usage caps can last hours)
      if (result.rateLimited) {
        console.log(`[Epic] Rate limit detected for story ${story.storyIndex} — escalating as blocker`);
        this.rateLimitRetries.delete(story.storyIndex);
        this.unregisterRunningStory(story.storyIndex);

        // Post a rate_limited progress event for feed visibility
        await this.coordination.postContext(
          "rate_limited",
          "Anthropic usage limit reached — task paused.",
          expert,
          this.config.parentTaskId
        );

        // Escalate as blocker with clear user-facing message
        const readyStories = await this.coordination.getReadyStories();
        const dependentStories = this.blockerManager
          ? this.blockerManager.getDependentStories(story.storyIndex, readyStories)
          : [];

        const summary = "Your Anthropic usage limit was reached. Check your plan at claude.ai/settings — if you have Extra Usage enabled with funds available, click Retry. Otherwise, wait for your limit to reset.";

        await this.coordination.postContext(
          "blocker",
          summary,
          expert,
          undefined,
          {
            storyIndex: story.storyIndex,
            storyTitle: story.title,
            persona: expert,
            errorCategory: "rate_limit",
            summary,
            fullErrorMessage: "Claude CLI returned rate_limit_error. This typically means your weekly/session usage cap has been reached. Usage caps reset on a schedule (check claude.ai/settings for your reset time).",
            affectedFiles: [],
            autoRetryAttempts: 0,
            maxAutoRetries: 0,
            dependentStories,
            isEscalated: true,
            isFixable: false,
          },
          `${expert}-story-${story.storyIndex}`
        );

        // Update expert state and mark dependent stories blocked
        this.expertStates.set(expert, {
          persona: expert,
          status: "blocked",
          currentStoryId: story.id,
          currentStoryIndex: story.storyIndex,
        });
        this.failedStoryIndices.add(story.storyIndex);
        for (const depIndex of dependentStories) {
          this.blockedStoryIndices.add(depIndex);
        }

        // Reset expert to idle after delay
        setTimeout(() => {
          this.expertStates.set(expert, { persona: expert, status: "idle" });
        }, 2000);

        return;
      }

      // Unregister from mutex tracking now that execution is complete
      this.unregisterRunningStory(story.storyIndex);

      // Clean up any message file left in the worktree
      this.cleanupMessageFiles(story.storyIndex);

      if (result.success) {
        // Mark that we have committed code on a remote branch
        this.hasAnyCommittedCode = true;

        // Track locally so checkMissionComplete works even if postCompletion API failed
        this.locallyCompletedStoryIndices.add(story.storyIndex);

        // Update expert state to completed
        this.expertStates.set(expert, {
          persona: expert,
          status: "completed",
          currentStoryId: story.id,
          currentStoryIndex: story.storyIndex,
        });

        // Store baseline SHA for scoped review diff
        if (result.postRebaseBaseSha) {
          this.storyBaselineShas.set(story.storyIndex, result.postRebaseBaseSha);
        }

        // Track dependency merge conflicts for review-skip logic
        if (result.depConflicts?.length) {
          this.storyDepConflicts.set(story.storyIndex, result.depConflicts);
        }

        // Queue for incremental integration (multi-story only)
        // Note: storyBranchNames is already set by the onWorktreeCreated callback
        if (this.totalStories > 1 && this.storyBranchNames.has(story.storyIndex)) {
          this.integrationQueue.push(story.storyIndex);
        }

        // Accumulate learnings from successful stories
        if (result.learnings?.length) {
          for (const learning of result.learnings) {
            this.accumulatedLearnings.push({ learning, persona: expert, storyIndex: story.storyIndex });
          }
          console.log(`[Epic] Captured ${result.learnings.length} learning(s) from ${expert} (story ${story.storyIndex})`);
        }

        // Clear any retry counts on success
        if (this.blockerManager) {
          this.blockerManager.resetRetryCount(story.storyIndex);
        }
      } else {
        // Story failed - handle with blocker system
        await this.handleStoryFailure(story, expert, result.error || "Unknown error");
      }

      // Reset to idle after a delay
      setTimeout(() => {
        const state = this.expertStates.get(expert);
        if (state && state.currentStoryId === story.id) {
          this.expertStates.set(expert, {
            persona: expert,
            status: "idle",
          });
        }
      }, 2000);
    } catch (error) {
      console.error("[Epic] Story execution failed:", error);
      // Unregister from mutex tracking on exception
      this.unregisterRunningStory(story.storyIndex);

      // Clean up orphaned worktree if it was created before the exception
      if (this.activeWorktrees.has(story.storyIndex)) {
        const worktreePath = this.activeWorktrees.get(story.storyIndex)!;
        try {
          await this.gitOps.forceRemoveWorktree(worktreePath);
        } catch {
          // Ignore cleanup errors — worktree may already be removed
        }
        this.activeWorktrees.delete(story.storyIndex);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.handleStoryFailure(story, expert, errorMessage);
    }
  }

  /**
   * Handle a story failure - check for auto-retry or escalate as blocker.
   */
  private async handleStoryFailure(
    story: ReadyStory,
    expert: ExpertPersona,
    errorMessage: string
  ): Promise<void> {
    // Update expert state to blocked
    this.expertStates.set(expert, {
      persona: expert,
      status: "blocked",
      currentStoryId: story.id,
      currentStoryIndex: story.storyIndex,
    });

    // Track as failed
    this.failedStoryIndices.add(story.storyIndex);

    if (!this.blockerManager) {
      console.log(`[Epic] Story ${story.storyIndex} failed (no blocker manager): ${errorMessage}`);
      return;
    }

    // Check if we should auto-retry
    if (await this.blockerManager.shouldAutoRetry(story.storyIndex, errorMessage)) {
      const retryCount = this.blockerManager.getRetryCount(story.storyIndex);
      const maxRetries = this.resilience.blockerMaxAutoRetries;
      console.log(`[Epic] Story ${story.storyIndex} failed - auto-retry ${retryCount + 1}/${maxRetries}`);

      this.blockerManager.incrementRetryCount(story.storyIndex);

      // Reset expert to idle after a short delay (to allow retry)
      setTimeout(() => {
        this.expertStates.set(expert, {
          persona: expert,
          status: "idle",
        });
        // Clear failed flag to allow re-execution
        this.failedStoryIndices.delete(story.storyIndex);
      }, 2000);

      return;
    }

    // Auto-retry exhausted or error not fixable - escalate as blocker
    console.log(`[Epic] Story ${story.storyIndex} failed - escalating to human`);

    // Get all ready stories to find dependents
    const readyStories = await this.coordination.getReadyStories();

    // Escalate the blocker
    await this.blockerManager.escalateBlocker(
      story.storyIndex,
      story.title,
      expert,
      errorMessage,
      readyStories
    );

    // Mark dependent stories as blocked
    const dependentStories = this.blockerManager.getDependentStories(story.storyIndex, readyStories);
    for (const depIndex of dependentStories) {
      this.blockedStoryIndices.add(depIndex);
    }

    // Reset expert to idle after delay
    setTimeout(() => {
      this.expertStates.set(expert, {
        persona: expert,
        status: "idle",
      });
    }, 2000);
  }

  /**
   * Process unanswered questions and route to experts.
   * Routing tiers:
   *   1. Target persona idle → route directly (with story context)
   *   2. Decision API match idle → route (with story context)
   *   3. Target known but busy → write placeholder + spawn virtual expert
   *   4. No target match → any idle coding expert (for generic questions, with context)
   *   5. ALL busy + no target → write placeholder + spawn virtual expert (catch-all)
   */
  private async processQuestions(): Promise<void> {
    const questions = await this.coordination.getUnansweredQuestions();

    // Clean up in-flight quick answers for questions that have been answered
    const unansweredIds = new Set(questions.map((q) => q.id));
    for (const qId of this.inFlightQuickAnswers) {
      if (!unansweredIds.has(qId)) {
        this.inFlightQuickAnswers.delete(qId);
      }
    }

    for (const question of questions) {
      // Compute idle expert names for routing (exclude non-coding personas)
      const idleExpertNames = Array.from(this.expertStates.entries())
        .filter(([_, state]) => state.status === "idle")
        .filter(([persona]) => !QUESTION_INELIGIBLE_PERSONAS.has(persona))
        .map(([persona]) => persona);
      // Route via Decision API — handles metadata targets, content-based routing, and tier selection
      const routing = await this.decisionClient.routeQuestion({
        question: question.content,
        targetPersona: (question.metadata?.targetPersona as string) || undefined,
        idleExperts: idleExpertNames,
      });

      // If metadata has an explicit target, prefer it over the routing result
      const effectiveTarget: ExpertPersona | null = question.metadata?.targetPersona
        ? (question.metadata.targetPersona as ExpertPersona)
        : (routing.targetExpert as ExpertPersona | null);

      // Tier 1: Target expert is idle — route directly
      const expertState = effectiveTarget ? this.expertStates.get(effectiveTarget) : undefined;
      if (expertState && expertState.status === "idle") {
        const storyCtx = await this.getStoryContext(question);
        console.log(`[Epic] Routing question from ${question.fromPersona} to ${effectiveTarget} (tier ${routing.routingTier}: ${routing.reason})`);
        const answerText = await this.executor.answerQuestion(
          {
            id: question.id,
            parentTaskId: question.parentTaskId,
            taskId: undefined,
            persona: question.fromPersona,
            messageType: "question",
            content: question.content,
            metadata: question.metadata,
            createdAt: question.createdAt,
          },
          effectiveTarget!,
          storyCtx
        );
        this.deliverAnswerToAsker(question, answerText, effectiveTarget!);
        continue;
      }

      // Tier 2: Target expert is busy — try routing result's fallback target if different and idle
      if (routing.targetExpert && routing.targetExpert !== effectiveTarget) {
        const routedTarget = routing.targetExpert as ExpertPersona;
        const routedState = this.expertStates.get(routedTarget);
        if (routedState && routedState.status === "idle") {
          const storyCtx = await this.getStoryContext(question);
          console.log(
            `[Epic] Target ${effectiveTarget} busy — routing question from ${question.fromPersona} to ${routedTarget} (tier ${routing.routingTier}: ${routing.reason})`
          );
          await this.postLog(
            `Routing question to ${routedTarget} (target ${effectiveTarget} busy)`
          );
          const answerText2a = await this.executor.answerQuestion(
            {
              id: question.id,
              parentTaskId: question.parentTaskId,
              taskId: undefined,
              persona: question.fromPersona,
              messageType: "question",
              content: question.content,
              metadata: question.metadata,
              createdAt: question.createdAt,
            },
            routedTarget,
            storyCtx
          );
          this.deliverAnswerToAsker(question, answerText2a, routedTarget);
          continue;
        }
      }

      // Tier 3: Target known but busy — spawn virtual expert with right persona
      if (effectiveTarget && !this.inFlightQuickAnswers.has(question.id)) {
        const storyCtx = await this.getStoryContext(question);
        this.inFlightQuickAnswers.add(question.id);
        // Immediately tell the worker an answer is coming
        this.writePendingPlaceholder(question, effectiveTarget);
        await this.postLog(`Spawning virtual ${effectiveTarget} for ${question.fromPersona}'s question`);
        this.executor
          .spawnVirtualExpert(
            {
              id: question.id,
              content: question.content,
              fromPersona: question.fromPersona,
              metadata: question.metadata,
            },
            effectiveTarget,
            storyCtx
          )
          .then((answerText) => this.deliverAnswerToAsker(question, answerText, effectiveTarget!))
          .catch((err) => console.error(`[Epic] Virtual expert failed for ${question.id}:`, err))
          .finally(() => this.inFlightQuickAnswers.delete(question.id));
        continue;
      }

      // Tier 4: No target specialty — fall back to any idle expert (for generic questions)
      if (!effectiveTarget) {
        const anyIdleExpert = Array.from(this.expertStates.entries()).find(
          ([persona, state]) =>
            state.status === "idle" &&
            persona !== question.fromPersona &&
            !QUESTION_INELIGIBLE_PERSONAS.has(persona)
        );
        if (anyIdleExpert) {
          const [fallbackPersona] = anyIdleExpert;
          const storyCtx = await this.getStoryContext(question);
          console.log(
            `[Epic] No target match — routing question from ${question.fromPersona} to idle ${fallbackPersona}`
          );
          await this.postLog(
            `Routing question to ${fallbackPersona} (no target match, no specialty match)`
          );
          const answerText2b = await this.executor.answerQuestion(
            {
              id: question.id,
              parentTaskId: question.parentTaskId,
              taskId: undefined,
              persona: question.fromPersona,
              messageType: "question",
              content: question.content,
              metadata: question.metadata,
              createdAt: question.createdAt,
            },
            fallbackPersona,
            storyCtx
          );
          this.deliverAnswerToAsker(question, answerText2b, fallbackPersona);
          continue;
        }
      }

      // Tier 5: ALL busy + no target — spawn virtual expert (catch-all)
      if (!this.inFlightQuickAnswers.has(question.id)) {
        const storyCtx = await this.getStoryContext(question);
        const bestGuessPersona = effectiveTarget || ("backend_developer" as ExpertPersona);
        console.log(
          `[Epic] All experts busy — spawning virtual ${bestGuessPersona} for ${question.id} from ${question.fromPersona}`
        );
        await this.postLog(
          `Spawning virtual ${bestGuessPersona} for ${question.id} (all experts busy)`
        );
        this.inFlightQuickAnswers.add(question.id);
        this.writePendingPlaceholder(question, bestGuessPersona);

        // Fire-and-forget: don't block the poll loop
        this.executor
          .spawnVirtualExpert(
            {
              id: question.id,
              content: question.content,
              fromPersona: question.fromPersona,
              metadata: question.metadata,
            },
            bestGuessPersona,
            storyCtx
          )
          .then((answerText) => {
            this.deliverAnswerToAsker(question, answerText, bestGuessPersona);
          })
          .catch((err) => {
            console.error(`[Epic] Virtual expert spawn failed for ${question.id}:`, err);
          })
          .finally(() => {
            this.inFlightQuickAnswers.delete(question.id);
          });
      }
    }
  }

  private async checkCompletions(): Promise<void> {
    if (!this.config.reviewEnabled) return;

    // maxPerStoryRevisions: 0 means skip per-story review entirely
    if (this.maxPerStoryRevisions <= 0) return;

    // Find newly completed stories that haven't been reviewed yet
    for (const storyIndex of this.completedStoryIndices) {
      if (this.reviewedStoryIndices.has(storyIndex)) continue;

      // Skip per-story review if dependencies had merge conflicts — the worktree
      // is missing sibling code, so typecheck/test failures are expected false positives.
      // The consolidated review on the fully merged feature branch catches real issues.
      const conflicts = this.storyDepConflicts.get(storyIndex);
      if (conflicts && conflicts.length > 0) {
        console.log(
          `[Epic] Skipping per-story review for story ${storyIndex} — ${conflicts.length} dependency merge conflict(s), deferring to consolidated review`
        );
        this.postDashboardLog(
          `Story ${storyIndex} review skipped (dependency merge conflicts — consolidated review will catch issues)`
        );
        this.reviewedStoryIndices.add(storyIndex);
        continue;
      }

      const branchName = this.storyBranchNames.get(storyIndex);
      const worktreePath = this.activeWorktrees.get(storyIndex);
      if (!branchName || !worktreePath) continue;

      // Get story details from coordination feed
      const readyStories = await this.coordination.getReadyStories();
      const story = readyStories.find((s) => s.storyIndex === storyIndex);
      if (!story) {
        // Story not found — approve by default so we don't block
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

        // Gather expert's coordination feed messages for this story
        const storyContexts = await this.coordination.getContextsByTypes([
          "decision",
          "progress",
          "completion",
          "answer",
          "file_created",
          "file_modified",
        ]);
        const storyMessages = storyContexts
          .filter((ctx) => (ctx.metadata?.storyIndex as number) === storyIndex)
          .map((ctx) => `[${ctx.messageType}] ${ctx.persona}: ${ctx.content}`)
          .join("\n");

        const reviewResult = await reviewer.reviewBranch(
          branchName,
          storyIndex,
          revisionCount,
          revisionCount > 0 ? this.config.reviewFeedback : undefined,
          storyContext,
          baselineSha,
          storyMessages || undefined
        );

        if (!reviewResult.success) {
          // Review failed — approve anyway so we don't block progress
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
            console.log(`[Epic] Story ${storyIndex} max per-story revisions (${this.maxPerStoryRevisions}) reached — approving`);
            this.postDashboardLog(`Story ${storyIndex} max per-story revisions reached — approving`);
            this.reviewedStoryIndices.add(storyIndex);
            continue;
          }

          console.log(`[Epic] Story ${storyIndex} needs revision (${newCount}/${this.maxPerStoryRevisions}): ${reviewResult.feedback}`);
          this.postDashboardLog(`Story ${storyIndex} revision ${newCount}/${this.maxPerStoryRevisions} requested`);

          // Targeted per-story revision — try surgical inline fix first,
          // fall back to destructive delete-and-requeue if fixer fails
          this.config.reviewFeedback = reviewResult.feedback;

          // Attempt inline review fix on the existing worktree
          let inlineFixSucceeded = false;
          const existingWorktree = this.activeWorktrees.get(storyIndex);
          if (existingWorktree && reviewResult.feedback) {
            try {
              console.log(`[Epic] Attempting inline review fix for story ${storyIndex}...`);
              this.postDashboardLog(`Story ${storyIndex} — attempting inline review fix`);

              const reviewFixer = new InlineReviewFixer(
                this.config,
                existingWorktree,
                reviewResult.feedback,
                story.persona,
                story.title,
              );
              const fixResult = await reviewFixer.fix();

              if (fixResult.success) {
                console.log(`[Epic] Inline review fix succeeded for story ${storyIndex}: ${fixResult.summary}`);

                // Verify push landed on remote (review fixer prompt says to push,
                // but verify explicitly in case the agent failed to push)
                const storyBranch = this.storyBranchNames.get(storyIndex);
                if (existingWorktree && storyBranch) {
                  try {
                    await this.gitOps.pushBranchFromWorktree(existingWorktree, storyBranch);
                  } catch {
                    // Push may fail if agent already pushed — that's fine
                  }
                }

                this.postDashboardLog(`Story ${storyIndex} review fix applied — re-entering review cycle`);
                inlineFixSucceeded = true;

                // Mark as completed again so it re-enters the review cycle
                this.completedStoryIndices.add(storyIndex);

                // Post revision request to coordination feed for tracking
                await this.coordination.postRevisionRequest(newCount, reviewResult.feedback);
              } else {
                console.log(`[Epic] Inline review fix failed for story ${storyIndex}: ${fixResult.summary} — falling back to full re-execution`);
                this.postDashboardLog(`Story ${storyIndex} inline fix failed — falling back to full re-execution`);
              }
            } catch (e) {
              console.warn(`[Epic] Inline review fix error for story ${storyIndex}: ${e} — falling back to full re-execution`);
            }
          }

          // Fallback: destructive delete-and-requeue if inline fix failed or wasn't possible
          if (!inlineFixSucceeded) {
            this.completedStoryIndices.delete(storyIndex);

            // Archive claim so the story can be re-claimed
            await this.coordination.archiveStoryClaims([storyIndex]);

            // Clean up worktree and branch for fresh revision
            try {
              const storyBranch = this.storyBranchNames.get(storyIndex);
              if (storyBranch) {
                // 1. Remove the worktree FIRST (must happen before branch delete)
                const fallbackWorktree = this.activeWorktrees.get(storyIndex);
                if (fallbackWorktree) {
                  await this.gitOps.forceRemoveWorktree(fallbackWorktree);
                  this.activeWorktrees.delete(storyIndex);
                }
                // 2. Now safe to delete the branch (no longer checked out)
                const repoPath = this.gitOps.getRepoPath();
                execSync(`git -C "${repoPath}" branch -D "${storyBranch}" 2>/dev/null || true`);
                execSync(`git -C "${repoPath}" push origin --delete "${storyBranch}" 2>/dev/null || true`);
                this.storyBranchNames.delete(storyIndex);
              }
            } catch (e) {
              console.warn(`[Epic] Could not clean up story ${storyIndex} worktree/branch: ${e}`);
            }

            // Post revision request to coordination feed for tracking
            await this.coordination.postRevisionRequest(newCount, reviewResult.feedback);

            // Queue just this story for re-execution
            const allStories = await this.coordination.getReadyStories();
            const storyToRevise = allStories.find((s) => s.storyIndex === storyIndex);
            if (storyToRevise) {
              this.revisionStoriesQueued.push(storyToRevise);
            }
          }
        } else {
          // Rejected — approve anyway for per-story (final review will catch)
          console.warn(`[Epic] Story ${storyIndex} rejected — approving to continue (final review will gate)`);
          this.reviewedStoryIndices.add(storyIndex);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[Epic] Story ${storyIndex} review error: ${msg} — approving by default`);
        this.reviewedStoryIndices.add(storyIndex);
      }
    }
  }

  /**
   * Check if all stories are done. Creates consolidated PR, runs review, and finalizes.
   */
  private async checkMissionComplete(): Promise<void> {
    const contexts = await this.coordination.getContextsByTypes([
      "story_ready",
      "story_claimed",
    ]);

    // Count story_ready vs completion
    // Use revision-aware completions to support the revision loop
    const readyStories = contexts.filter((c) => c.messageType === "story_ready");
    const completions = await this.coordination.getCurrentRevisionCompletions();
    const claimedStories = contexts.filter((c) => c.messageType === "story_claimed");

    // Check if all experts are idle
    const allIdle = Array.from(this.expertStates.values()).every(
      (state) => state.status === "idle" || state.status === "completed"
    );

    // Check if there are no more ready stories to claim
    // Filter out: stories already completed, failed, blocked, OR stories with no matching expert
    const readyToClaim = readyStories.filter((ready) => {
      const storyIndex = (ready.metadata?.storyIndex as number) || 0;
      const storyPersona = (ready.metadata?.persona as string) || "";

      // Skip if already completed (check both coordination feed AND local tracking)
      const isCompleted = completions.some(
        (c) => (c.metadata?.storyIndex as number) === storyIndex
      ) || this.locallyCompletedStoryIndices.has(storyIndex);
      if (isCompleted) return false;

      // Skip if failed (escalated blocker, awaiting human resolution)
      if (this.failedStoryIndices.has(storyIndex)) return false;

      // Skip if blocked (dependency on a failed story)
      if (this.blockedStoryIndices.has(storyIndex)) return false;

      // Skip if dependencies are not met (dependency story not completed)
      const deps = (ready.metadata?.dependencies as number[]) || [];
      if (deps.length > 0) {
        const unmetDeps = deps.filter(
          (depIndex) =>
            !completions.some((c) => (c.metadata?.storyIndex as number) === depIndex) &&
            !this.locallyCompletedStoryIndices.has(depIndex)
        );
        if (unmetDeps.length > 0) return false;
      }

      // Skip if no expert can handle this persona
      const hasMatchingExpert = matchPersonaToExpert(storyPersona) !== null;
      if (!hasMatchingExpert) {
        // Log once per unmatched story
        console.log(`[Epic] Skipping story ${storyIndex} - no expert for persona: ${storyPersona}`);
        return false;
      }

      return true;
    });

    // Deadlock detection: all experts idle, no claimable stories, but failed/blocked stories remain
    // Instead of failing the entire task, proceed with partial completion (create PR with completed stories)
    if (allIdle && readyToClaim.length === 0 && this.revisionStoriesQueued.length === 0 && this.integrationQueue.length === 0 && !this.integrationInProgress && (this.failedStoryIndices.size > 0 || this.blockedStoryIndices.size > 0) && completions.length > 0) {
      const failedList = Array.from(this.failedStoryIndices).sort((a, b) => a - b);
      const blockedList = Array.from(this.blockedStoryIndices).sort((a, b) => a - b);
      console.log(`[Epic] Partial completion — ${completions.length} stories done, ${failedList.length} failed, ${blockedList.length} blocked`);
      this.postLog(
        `${completions.length} of ${readyStories.length} stories completed. ` +
        `Story ${failedList.join(", ")} failed, stories ${blockedList.join(", ")} blocked. ` +
        `Proceeding with partial completion — creating PR with completed work.`
      );
      // Fall through to the completion path below instead of failing
    }

    if (allIdle && readyToClaim.length === 0 && this.revisionStoriesQueued.length === 0 && this.integrationQueue.length === 0 && !this.integrationInProgress && completions.length > 0) {
      // Determine if this is a partial completion (some stories failed/blocked)
      const isPartialCompletion = this.failedStoryIndices.size > 0 || this.blockedStoryIndices.size > 0;
      if (isPartialCompletion) {
        console.log("[Epic] Partial completion — proceeding with completed stories...");
      } else {
        console.log("[Epic] All stories finished. Processing completion...");
      }

      // Extract story completion details for PR description
      const storyCompletions = completions.map((c) => ({
        storyIndex: (c.metadata?.storyIndex as number) || 0,
        title: (c.metadata?.title as string) || c.content,
        filesModified: (c.metadata?.filesModified as string[]) || [],
      }));

      const summaryParts = storyCompletions.map((s) => `S${s.storyIndex}`);
      let storyList = storyCompletions.map((s) => `- **${s.title}**`).join("\n");

      // Append failed/blocked story info to the story list for PR description
      if (isPartialCompletion) {
        const failedList = Array.from(this.failedStoryIndices).sort((a, b) => a - b);
        const blockedList = Array.from(this.blockedStoryIndices).sort((a, b) => a - b);
        storyList += `\n\n⚠️ **Failed stories:** ${failedList.join(", ")}`;
        if (blockedList.length > 0) {
          storyList += `\n⚠️ **Blocked stories:** ${blockedList.join(", ")}`;
        }
        storyList += `\n\n*${completions.length} of ${readyStories.length} stories completed. The above stories failed quality gates or were blocked by dependency failures.*`;
      }

      // Run epic validation (fast — just checks all stories completed)
      this.postDashboardLog("Running epic validation...");
      let capturedQualityMetrics: QualityMetrics | undefined;
      let qualityGateResult: EvaluateQualityResponse | undefined;

      const epicValidationResult = await Promise.allSettled([
        this.validateEpicCompletion(storyCompletions, this.totalStories),
      ]).then((r) => r[0]);

      // Process epic validation result
      if (epicValidationResult.status === "rejected") {
        console.warn(
          "[Epic] Epic validation threw (non-fatal):",
          epicValidationResult.reason,
        );
      } else {
        const validation = epicValidationResult.value;

        if (!validation.valid) {
          console.log("[Epic] Epic validation failed - stories missing");
          this.postDashboardLog("Epic validation failed — stories missing");
          await this.ticketOps.postComment(
            `⚠️ Epic validation failed - not all stories completed.\n\n` +
              `**Missing:**\n${validation.missing.map((m) => `- ${m}`).join("\n")}\n\n` +
              `*${validation.storiesCompleted}/${validation.storiesTotal} stories completed. Check coordination feed for blockers.*`,
          );

          await this.updateTaskStatus(
            "failed",
            `Epic incomplete: ${validation.missing.length} stories missing`,
            `Validation failed: ${validation.missing.join(", ")}`,
          );

          this.missionActive = false;
          return;
        }

        if (validation.unaddressedRequirements.length > 0) {
          console.log(
            `[Epic] Proceeding with ${validation.unaddressedRequirements.length} validation warnings`,
          );
          await this.ticketOps.postComment(
            `⚠️ Epic validation warnings (non-blocking):\n\n` +
              validation.unaddressedRequirements
                .slice(0, 5)
                .map((r) => `- ${r}`)
                .join("\n") +
              (validation.unaddressedRequirements.length > 5
                ? `\n... and ${validation.unaddressedRequirements.length - 5} more`
                : ""),
          );
        }
      }

      // Create consolidated PR with all story branches
      let prUrl: string | undefined;
      let prNumber: number | undefined;
      let noChangesNeeded = false;

      // Check if any stories actually made file changes
      const storiesWithChanges = storyCompletions.filter(
        (s) => s.filesModified && s.filesModified.length > 0
      );

      if (storiesWithChanges.length === 0) {
        // No stories had actual file changes - this is a valid "no changes needed" scenario
        console.log("[Epic] No stories had file changes - feature may already be implemented or requirements already met");
        noChangesNeeded = true;
      } else if (this.config.jiraIssueKey) {
        // Persist story completion data BEFORE PR creation for retry capability
        this.postDashboardLog("Persisting story completion data...");
        try {
          const featureBranch = `feature/${this.config.jiraIssueKey?.toLowerCase()}`;
          const storyBranches = await this.gitOps.getStoryBranches();
          await axios.post(
            `${this.config.apiBaseUrl}/api/control-center/tasks/${this.config.parentTaskId}/story-completions`,
            {
              storyCompletions,
              storyBranches,
              featureBranch,
            },
            {
              headers: {
                "Content-Type": "application/json",
                "x-api-key": this.config.orgApiKey,
              },
              timeout: 10000,
            }
          );
          console.log("[Epic] Persisted story completion data for potential retry");
        } catch (persistError) {
          console.warn("[Epic] Failed to persist story data (non-fatal):", persistError instanceof Error ? persistError.message : persistError);
        }

        console.log("[Epic] Creating consolidated PR...");
        this.postDashboardLog(`Creating consolidated PR from ${storyCompletions.length} story branches...`);
        // Build a sensible PR title that fits within GitHub's 256 char limit
        // Format: "Epic implementation (N stories)" - keep it simple, details in body
        const storyCount = storyCompletions.length;
        const firstStoryTitle = storyCompletions[0]?.title || "Implementation";
        // Truncate first story title to leave room for prefix and suffix
        // Title format: "OCS-789: Epic: [title] (N stories)" = ~25 chars overhead
        const maxTitleLength = 230;
        const truncatedTitle =
          firstStoryTitle.length > maxTitleLength
            ? firstStoryTitle.substring(0, maxTitleLength - 3) + "..."
            : firstStoryTitle;
        const epicTitle =
          storyCount > 1
            ? `Epic: ${truncatedTitle} (+${storyCount - 1} more)`
            : `Epic: ${truncatedTitle}`;

        // If all stories were incrementally integrated, create PR from integration branch
        if (this.integrationBranch && this.integratedStoryIndices.size === completions.length) {
          console.log("[Epic] All stories incrementally integrated — creating PR from integration branch");
          this.postDashboardLog("All stories integrated — creating PR from integration branch...");

          // Rename integration branch to feature branch for PR
          const featureBranch = `feature/${this.config.jiraIssueKey.toLowerCase()}`;
          let prBranchName = this.integrationBranch;
          try {
            await this.gitOps.renameBranch(this.integrationBranch, featureBranch);
            this.integrationBranch = featureBranch;
            prBranchName = featureBranch;
          } catch {
            // If rename fails, just use integration branch as-is
          }

          // Build story description for PR body
          const storyListForPr = storyCompletions.map((s) => `- **${s.title}**`).join("\n");

          // Skip rebase for integration branches — rebase linearizes merge
          // commits and can produce "No commits between main and <branch>"
          process.env.SKIP_REBASE = "true";
          try {
            prUrl = await this.gitOps.createPRFromBranch(
              prBranchName,
              this.config.jiraIssueKey,
              epicTitle,
              storyListForPr,
              storyListForPr,
              undefined  // quality metrics computed later
            );
          } finally {
            delete process.env.SKIP_REBASE;
          }
        } else {
          // Legacy path: consolidate all branches at once
          // Create PR without quality metrics — they haven't been computed yet.
          // Quality verification runs AFTER consolidation so it can detect the
          // project language correctly (e.g. pyproject.toml only exists on the
          // feature branch for greenfield projects, not on main).
          prUrl = await this.gitOps.createConsolidatedPR(
            this.config.jiraIssueKey,
            epicTitle,
            storyCompletions,
            undefined
          );
        }
        if (prUrl) {
          console.log(`[Epic] Consolidated PR created: ${prUrl}`);
          this.postDashboardLog(`PR created: ${prUrl}`);
          prNumber = this.extractPrNumber(prUrl);
          this.currentPrUrl = prUrl;
          this.currentPrNumber = prNumber;
          // Update status so dashboard progress bar advances to "PR Created"
          await this.postProgressUpdate("review_requested", prUrl, prNumber);
        } else {
          console.error("[Epic] Failed to create consolidated PR");
          this.postDashboardLog("Failed to create consolidated PR");
        }

        // Warn about gate-bypassed stories that need attention
        if (this.gateBypassed.size > 0) {
          const bypassedList = [...this.gateBypassed].sort((a, b) => a - b).join(", ");
          this.postDashboardLog(`⚠️ Stories with gate bypass (exceeded max revisions): ${bypassedList} — quality issues may remain`);
          console.warn(`[Epic] Gate-bypassed stories: ${bypassedList}`);
        }
      }

      // Run quality verification on the consolidated feature branch.
      // This MUST happen after PR creation (which includes the consolidation merge)
      // so that language detection works correctly — for greenfield projects,
      // marker files like pyproject.toml only exist on the feature branch, not main.
      if (prUrl && prNumber) {
        await this.gitOps.checkoutForReview(prNumber);
        this.postDashboardLog("Running quality checks on consolidated branch...");

        try {
          console.log("[Epic] Running quality verification...");
          const repoPath = this.gitOps.getRepoPath();
          const metrics = await runQualityVerification(repoPath, this.config.qualityGateCommands);
          capturedQualityMetrics = metrics;
          this.postDashboardLog(
            `Quality: score=${metrics.qualityScore}/100, ${metrics.typeErrors} type errors, ${metrics.lintErrors} lint errors`,
          );

          await postQualityMetrics(
            this.config.apiBaseUrl,
            this.config.orgApiKey,
            this.config.parentTaskId,
            metrics,
          );
          console.log(
            `[Epic] Quality metrics posted: score=${metrics.qualityScore}/100`,
          );

          // Quality gate bypass check
          if (this.config.qualityGateBypass) {
            qualityGateResult = { pass: true, reasons: ["bypass-quality-gate label set"], blockers: [] };
            console.log("[Epic] Quality gate bypassed");
          } else {
            // Send structured metrics to Decision API
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
          const reasons = qualityGateResult.reasons.length > 0 ? `\n  ${qualityGateResult.reasons.join("\n  ")}` : "";
          console.log(`[Epic] Quality Gate: ${statusIcon}${reasons}`);

          if (!qualityGateResult.pass) {
            const thresholds = this.config.qualityThresholds;
            let autoFixSucceeded = false;

            // Attempt auto-fix if enabled in org settings
            if (thresholds?.autoFixEnabled) {
              console.log("[Epic] Quality gate failed — attempting auto-fix...");
              this.postDashboardLog("Quality gate failed — running auto-fix agent");

              // Bridge EvaluateQualityResponse → AutoFixQualityGateResult
              const toAutoFixGateResult = (evalResult: EvaluateQualityResponse): AutoFixQualityGateResult => ({
                passed: evalResult.pass,
                checks: [
                  ...evalResult.reasons.map((r) => ({ name: "quality", passed: false, message: r })),
                  ...evalResult.blockers.map((b) => ({ name: "blocker", passed: false, message: b })),
                ],
                summary: [...evalResult.reasons, ...evalResult.blockers].join("; "),
                failureReasons: [...evalResult.reasons, ...evalResult.blockers],
              });

              // Re-check callback: runs quality verification + decision API evaluation
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

              // Step 1: Shell-command fixes (eslint --fix, prettier)
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
                console.log("[Epic] Shell auto-fix succeeded — committing fixes");
                this.postDashboardLog(`Auto-fix succeeded after ${autoFixResult.totalIterations} iteration(s)`);

                execSync(`git -C "${repoPath}" add -A && git -C "${repoPath}" commit -m "fix: auto-fix quality gate issues" --no-verify || true`);

                const updatedMetrics = await runQualityVerification(repoPath, this.config.qualityGateCommands);
                capturedQualityMetrics = updatedMetrics;
                await postQualityMetrics(this.config.apiBaseUrl, this.config.orgApiKey, this.config.parentTaskId, updatedMetrics);
              }

              // Step 2: If shell fixes didn't resolve it, escalate to Claude agent
              if (!autoFixSucceeded) {
                console.log("[Epic] Shell auto-fix incomplete — escalating to Claude fix agent...");
                this.postDashboardLog("Spawning Claude fix agent for quality issues...");

                const agentFixed = await this.runQualityFixAgent(repoPath, qualityGateResult.blockers);
                if (agentFixed) {
                  autoFixSucceeded = true;

                  execSync(`git -C "${repoPath}" add -A && git -C "${repoPath}" commit -m "fix: auto-fix quality gate issues" --no-verify || true`);

                  const updatedMetrics = await runQualityVerification(repoPath, this.config.qualityGateCommands);
                  capturedQualityMetrics = updatedMetrics;
                  await postQualityMetrics(this.config.apiBaseUrl, this.config.orgApiKey, this.config.parentTaskId, updatedMetrics);
                } else {
                  console.log("[Epic] Claude fix agent could not resolve all quality issues");
                  this.postDashboardLog("Auto-fix incomplete — quality issues remain");
                }
              }
            } else {
              console.log(`[Epic] Auto-fix disabled (autoFixEnabled=${thresholds?.autoFixEnabled}, thresholds=${thresholds ? "set" : "undefined"}) — skipping`);
              this.postDashboardLog("Auto-fix is disabled in org settings — quality gate failure not recoverable");
            }

            // If auto-fix didn't run or didn't succeed, block further progress
            if (!autoFixSucceeded) {
              console.log("[Epic] Quality gate failed — cannot proceed");
              this.postDashboardLog("Quality gate failed — PR blocked");
              const blockerMessages = qualityGateResult.blockers;
              await this.ticketOps.postComment(
                `❌ Quality gate failed.\n\n**Blockers:**\n${blockerMessages.map((r) => `- ${r}`).join("\n")}${qualityGateResult.reasons.length > 0 ? `\n\n**Passing checks:**\n${qualityGateResult.reasons.map((r) => `- ✅ ${r}`).join("\n")}` : ""}\n\n*Fix the issues and re-run, or add the \`bypass-quality-gate\` label to skip.*`,
              );

              await this.updateTaskStatus(
                "quality_gate_failed",
                `Quality gate failed: ${blockerMessages.join(", ")}`,
                `Quality gate blocked: ${blockerMessages[0] || "quality check failed"}`,
              );

              this.missionActive = false;
              return;
            }
          }
        } catch (qualityError) {
          console.warn(
            "[Epic] Quality verification failed (non-fatal):",
            qualityError instanceof Error ? qualityError.message : qualityError,
          );
        }
      }

      // Run integration quality gates on consolidated branch before Tech Lead review.
      // This runs for ALL cards including foundation — by this point all stories are
      // complete and the consolidated branch has the full codebase.
      // Gates always run here on the fully merged branch; per-story integration
      // only checks for merge conflicts, not quality gates.
      if (prUrl && prNumber && (this.config.qualityGateCommands?.length ?? 0) > 0) {
        await this.postProgressUpdate("integration_check", prUrl, prNumber);
        this.postDashboardLog("Running integration quality gates on consolidated branch...");

        // Ensure we're on the PR's head branch (may already be checked out from quality verification)
        await this.gitOps.checkoutForReview(prNumber);

        const integrationFixer = new InlineIntegrationFixer(
          this.config,
          this.gitOps.getRepoPath()
        );

        const gateResult = await integrationFixer.fix(
          prNumber,
          this.config.qualityGateCommands!,
          this.config.maxFixRetries,
          completions
        );

        if (gateResult.decision === "passed") {
          this.postDashboardLog("Integration gates passed — no cross-story issues");
        } else if (gateResult.decision === "fixed") {
          this.postDashboardLog("Integration issues auto-fixed — gates now passing");
          await this.ticketOps.postComment(
            `🔧 Integration Fix Agent resolved cross-story issues:\n\n${gateResult.summary}`
          );
        } else {
          this.postDashboardLog(`Integration gates failed (unfixable): ${gateResult.summary}`);
          await this.ticketOps.postComment(
            `⚠️ Integration issues could not be auto-fixed:\n\n${gateResult.summary}\n\nTech Lead will assess.`
          );
        }
      }

      // Run spec verification — independent QA agent checks acceptance criteria compliance
      if (prUrl && prNumber) {
        this.postDashboardLog("Running spec verification against acceptance criteria...");
        await this.postProgressUpdate("integration_check", prUrl, prNumber);

        // Collect acceptance criteria from completions
        const storyAcceptanceCriteria = completions
          .map(c => {
            const meta = c.metadata || {};
            const description = (meta.description as string) || c.content;
            // Extract acceptance criteria from description
            const criteriaMatch = description.match(/##+ Acceptance Criteria\n([\s\S]*?)(?=\n##|\n---|\n\n\n|$)/i);
            const criteriaText = criteriaMatch?.[1] || "";
            const criteria = criteriaText
              .split("\n")
              .map(line => line.replace(/^[\s]*[-*•]\s*/, "").trim())
              .filter(line => line.length > 0);

            return {
              storyIndex: (meta.storyIndex as number) || 0,
              title: (meta.title as string) || c.content,
              criteria,
            };
          })
          .filter(s => s.criteria.length > 0);

        if (storyAcceptanceCriteria.length > 0) {
          const verifier = new InlineVerifier(this.config, this.gitOps.getRepoPath());
          const verificationResult = await verifier.verify(storyAcceptanceCriteria);

          if (verificationResult.decision === "pass") {
            this.postDashboardLog("Spec verification passed — all acceptance criteria satisfied");
          } else if (verificationResult.decision === "partial_pass") {
            this.postDashboardLog(`Spec verification: partial pass — ${verificationResult.failedCriteria?.length || 0} criteria failed`);
            await this.ticketOps.postComment(
              `⚠️ Spec verification found ${verificationResult.failedCriteria?.length || 0} unmet criteria:\n\n` +
              (verificationResult.failedCriteria || [])
                .map(f => `- **Story ${f.storyIndex}**: "${f.criterion}" — ${f.reason}`)
                .join("\n") +
              `\n\nTech Lead will assess whether these require revision.`
            );
          } else {
            this.postDashboardLog(`Spec verification failed: ${verificationResult.summary}`);
          }
        } else {
          this.postDashboardLog("No acceptance criteria found in completions — skipping spec verification");
        }
      }

      // If PR created and review enabled, run inline Tech Lead review
      if (prUrl && prNumber && this.config.reviewEnabled) {
        // Update status so dashboard progress bar advances to "Tech Lead Review"
        await this.postProgressUpdate("reviewing", prUrl, prNumber);
        this.postDashboardLog("Launching Tech Lead review...");
        const reviewResult = await this.runInlineReview(prUrl, prNumber, storyCompletions, summaryParts, capturedQualityMetrics);
        // If review triggered a revision loop, don't complete yet
        if (reviewResult === "continue") {
          return;
        }
        // If review resulted in escalation or rejection, those handlers set missionActive = false
        if (!this.missionActive) {
          return;
        }
      }

      // Determine the appropriate status based on workflow flags
      // - deploymentSucceeded: PR was merged and deployed by DevOps Engineer
      // - reviewEnabled: PR was approved by inline Tech Lead
      // - Neither: PR created, waiting for human approval
      // - PR creation attempted but failed: task should fail
      // - noChangesNeeded: stories completed but no code changes were required
      let taskStatus: "deployed" | "review_requested" | "pr_approved" | "failed" | "completed" | "escalated";
      let jiraComment: string;
      let errorMessage: string | undefined;

      const completionLabel = isPartialCompletion
        ? `${completions.length} of ${readyStories.length} stories completed`
        : `All ${completions.length} stories completed`;
      const completionEmoji = isPartialCompletion ? "⚠️" : "✅";

      if (this.deploymentSucceeded) {
        // Deployment completed successfully - Jira comment already posted by deployer
        taskStatus = "deployed";
        jiraComment = ""; // Already posted by runInlineDeployment
      } else if (prUrl) {
        if (this.reviewSkipped) {
          // Review was enabled but crashed (OAuth, CLI failure, etc.) — escalate for human review
          taskStatus = "escalated";
          jiraComment = `⚠️ **${completionLabel}**, but Tech Lead review could not complete.\n\n${storyList}\n\n📝 **PR**: ${prUrl}\n\n*Please review the PR manually.*`;
        } else if (this.mergeFailed) {
          // Review approved but CI-verified merge failed after all retries — task must fail
          // so the cascade doesn't continue on a broken foundation
          taskStatus = "failed";
          errorMessage = "CI checks did not pass after all retry attempts — PR could not be merged";
          jiraComment = `❌ **${completionLabel}**, approved by Tech Lead, but **PR merge failed** — CI checks did not pass after all retry attempts.\n\n${storyList}\n\n📝 **PR**: ${prUrl}\n\n*Manual intervention required.*`;
        } else if (this.config.reviewEnabled) {
          // Review was approved by inline Tech Lead
          taskStatus = isPartialCompletion ? "escalated" : "pr_approved";
          jiraComment = this.config.prdChildTask
            ? `${completionEmoji} **${completionLabel}**, approved by Tech Lead, and PR merged.\n\n${storyList}\n\n📝 **PR**: ${prUrl}`
            : `${completionEmoji} **${completionLabel}** and approved by Tech Lead.\n\n${storyList}\n\n📝 **PR**: ${prUrl}\n\n*Ready for merge.*`;
        } else {
          // No review label: PR created, waiting for human approval
          // Use review_requested so GitHub webhook approval triggers deployment
          taskStatus = isPartialCompletion ? "escalated" : "review_requested";
          jiraComment = `${completionEmoji} **${completionLabel}.**\n\n${storyList}\n\n📝 **PR**: ${prUrl}\n\n*Ready for review and merge.*`;
        }
      } else if (noChangesNeeded) {
        // Stories completed but determined no code changes were required
        // This is a valid success case - feature may already be implemented or requirements already met
        taskStatus = "completed";
        jiraComment = `✅ **Analysis completed** — ${completions.length} stories analyzed.\n\n${storyList}\n\n*No code changes were required. The feature may already be implemented or the requirements are already met.*`;
      } else if (this.config.jiraIssueKey) {
        // PR creation was attempted but failed (e.g. empty branch after gate bypasses)
        taskStatus = "failed";
        errorMessage = "PR creation failed — story branches have been pushed but could not be consolidated into a PR";
        jiraComment = `❌ **PR creation failed.**\n\n${storyList}\n\n*Stories completed and branches pushed, but the consolidated PR could not be created. Story branches may need manual consolidation.*`;
      } else {
        // No Jira key, so no PR was attempted — standalone mode or direct task
        taskStatus = "completed";
        jiraComment = `✅ **${completions.length} stories completed.**\n\n${storyList}\n\n*No ticket key was provided, so no PR was created. Story branches have been pushed.*`;
      }

      // Post comment to Jira (skip if already posted by deployer)
      if (jiraComment) {
        await this.ticketOps.postComment(jiraComment);
      }

      // Build result summary based on status
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

      // Report zero usage for local/remote agent mode (users pay via Claude Max subscription)
      if (process.env.EXECUTION_MODE === "local") {
        try {
          await axios.post(
            `${this.config.apiBaseUrl}/api/tasks/${this.config.parentTaskId}/usage/partial`,
            { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCost: 0, mode: "set" },
            { headers: { "Content-Type": "application/json", "x-api-key": this.config.orgApiKey }, timeout: 5000 }
          );
          console.log("[Epic] Reported zero usage for local mode");
        } catch (err) {
          console.warn("[Epic] Failed to report zero usage:", err instanceof Error ? err.message : err);
        }
      }

      await this.updateTaskStatus(
        taskStatus,
        resultSummary,
        errorMessage,  // pass error message for failures
        prUrl          // pass prUrl to be saved on task (may be undefined for failures)
      );

      // Always transition Jira to Done - task is complete regardless of review status
      await this.ticketOps.transitionTo("Done");

      console.log(`[Epic] Mission complete with status: ${taskStatus}`);

      // Emit build report for future learning
      try {
        const buildReport: BuildReport = {
          taskId: this.config.parentTaskId,
          repo: this.config.targetRepo,
          storyCount: this.totalStories,
          completedCount: completions.length,
          failedCount: this.failedStoryIndices.size,
          outcome: this.failedStoryIndices.size === 0 ? "success"
            : completions.length > 0 ? "partial_success" : "failure",
          totalRevisions: this.revisionCount,
          integrationFailures: [], // Populated by incremental integration tracking
          verificationFailures: [], // Populated by spec verification
          timings: {
            totalDurationMs: Date.now() - this.epicStartTime,
            storyDurationsMs: {},
          },
        };

        await axios.post(
          `${this.config.apiBaseUrl}/api/control-center/tasks/${this.config.parentTaskId}/build-report`,
          buildReport,
          {
            headers: {
              "Content-Type": "application/json",
              "x-api-key": this.config.orgApiKey,
            },
            timeout: 10000,
          }
        );
        console.log("[Epic] Build report emitted");
      } catch (reportErr) {
        console.warn("[Epic] Failed to emit build report (non-fatal):", reportErr instanceof Error ? reportErr.message : reportErr);
      }

      // Capture memories and extract skills from completed task
      await this.captureTaskMemories(storyCompletions, taskStatus === "completed" || taskStatus === "deployed");

      // Run inline improvement analysis if enabled
      // This analyzes task logs and may auto-apply fixes to WorkerMill
      if (this.config.improvementEnabled) {
        console.log("[Epic] Running inline improvement analysis...");
        try {
          const improver = new InlineImprover(this.config, this.serverPromptTemplates?.improverPrompt);
          const improveResult = await improver.improve();

          if (improveResult.success && improveResult.improvementsApplied > 0) {
            console.log(`[Epic] Applied ${improveResult.improvementsApplied} improvements to WorkerMill`);
            console.log(`[Epic] Changed files: ${improveResult.changedFiles.join(", ") || "none"}`);
            console.log(`[Epic] Summary: ${improveResult.summary}`);
          } else if (improveResult.success) {
            console.log("[Epic] No improvements needed");
          } else {
            console.log(`[Epic] Improvement analysis failed: ${improveResult.error}`);
            // Don't fail the task for improvement failures - it's supplementary
          }
        } catch (improveError) {
          console.error("[Epic] Improvement error (non-fatal):", improveError);
          // Don't fail the task for improvement failures
        }
      }

      this.missionActive = false;
    }
  }

  /**
   * Run inline Tech Lead review with revision loop.
   * Returns "continue" if a revision was triggered (stories need to re-run).
   * Returns "done" if review completed (approved, rejected, or escalated).
   */
  private async runInlineReview(
    prUrl: string,
    prNumber: number,
    storyCompletions: Array<{ storyIndex: number; title: string; filesModified: string[] }>,
    summaryParts: string[],
    qualityMetrics?: QualityMetrics
  ): Promise<"continue" | "done"> {
    console.log(`[Epic] Running inline Tech Lead review (attempt ${this.revisionCount + 1}/${this.maxRevisions})`);
    this.postDashboardLog("Starting Tech Lead review...");
    await this.coordination.postContext(
      "progress",
      `Starting Tech Lead review (attempt ${this.revisionCount + 1}/${this.maxRevisions})`,
      "tech_lead"
    ).catch(() => {});

    // Ensure repo is on the PR's head branch so the tech lead reads correct files.
    // After single-story PR creation or WORKERMILL.md update, the repo may be on main.
    await this.gitOps.checkoutForReview(prNumber);
    this.postDashboardLog("Checked out PR branch, launching reviewer...");

    // Check manager provider to decide which reviewer to use
    // Agent SDK (InlineReviewer) only works with Anthropic
    // AI SDK executor works with all providers
    const managerProvider = process.env.MANAGER_PROVIDER || "anthropic";
    const managerModel = process.env.MANAGER_MODEL || "";
    console.log(`[Epic] Manager provider: ${managerProvider}, model: ${managerModel}`);

    let reviewResult: InlineReviewResult;

    if (managerProvider === "anthropic") {
      // Use Agent SDK reviewer for Anthropic
      const reviewer = new InlineReviewer(this.config, this.gitOps.getRepoPath(), this.serverPromptTemplates?.techLeadReviewPrompt);
      reviewResult = await reviewer.review(
        prUrl,
        prNumber,
        this.revisionCount,
        this.lastReviewFeedback,
        qualityMetrics,
        storyCompletions  // Pass story completions for selective revision support
      );
    } else {
      // Use AI SDK executor for non-Anthropic providers (Google, OpenAI, Ollama)
      console.log(`[Epic] Using AI SDK reviewer for ${managerProvider}/${managerModel}`);
      reviewResult = await this.runAiSdkReview(
        prUrl,
        prNumber,
        managerProvider,
        managerModel,
        qualityMetrics
      );
    }

    if (!reviewResult.success) {
      console.error("[Epic] Inline review failed:", reviewResult.error);
      // Review crashed (OAuth expiry, CLI crash, etc.) — don't fail the task.
      // The PR is already created with all code changes. Skip review and let
      // the human review the PR instead of wasting all the work done so far.
      this.reviewSkipped = true;
      console.log("[Epic] Skipping review due to failure — PR will need human review");
      await this.postLog("Tech Lead review failed — PR created for human review");
      await this.ticketOps.postComment(
        `⚠️ Tech Lead review could not complete (${reviewResult.error}). PR is ready for human review.`
      );
      return "done";
    }

    console.log(`[Epic] Review decision: ${reviewResult.decision}, score: ${reviewResult.codeQualityScore}`);

    // Ensure the review is posted to the GitHub PR (agent may or may not have done it)
    await this.ensureGitHubReviewPosted(prNumber, reviewResult);

    switch (reviewResult.decision) {
      case "approved":
        console.log("[Epic] PR approved by Tech Lead!");
        await this.ticketOps.postComment(
          `✅ PR approved by Tech Lead (score: ${reviewResult.codeQualityScore}/10)\n\n${reviewResult.feedback}`
        );
        await this.coordination.postContext(
          "decision",
          `✅ PR approved (score: ${reviewResult.codeQualityScore}/10)\n\n${reviewResult.feedback}`,
          "tech_lead"
        ).catch(() => {});

        // If deployment enabled, trigger DevOps Engineer to merge and deploy
        if (this.config.deploymentEnabled) {
          const deployResult = await this.runInlineDeployment(prUrl, prNumber, summaryParts);
          if (!deployResult) {
            // Deployment failed - handleEscalation already set status
            // Stop mission so finishMission doesn't overwrite the status
            this.missionActive = false;
            return "done";
          }
          if (this.config.jiraIssueKey) {
            await this.gitOps.postMergeCleanup(this.config.jiraIssueKey);
          }
        } else {
          // Default: merge the PR after Tech Lead approval (with CI verification)
          const mergeLabel = this.config.prdChildTask ? "PRD auto-run" : "Tech Lead approved";
          console.log(`[Epic] ${mergeLabel} — auto-merging PR #${prNumber} with CI verification`);
          const mergeResult = await this.mergeWithCIVerification(prUrl, prNumber, mergeLabel);
          if (mergeResult.merged) {
            console.log(`[Epic] PR #${prNumber} merged successfully`);
            await this.postLog(`PR #${prNumber} merged successfully`);
            await this.ticketOps.postComment(`🔀 PR #${prNumber} auto-merged (${mergeLabel})`);
            if (this.config.jiraIssueKey) {
              await this.gitOps.postMergeCleanup(this.config.jiraIssueKey);
            }
          } else {
            console.warn(`[Epic] PR #${prNumber} merge failed after CI retries`);
            await this.postLog(`❌ PR #${prNumber} merge failed — CI checks did not pass after all retry attempts`);
            await this.ticketOps.postComment(
              `❌ PR #${prNumber} could not be merged — CI checks failed after all retry attempts.\n\nPR: ${prUrl}\n\n*Manual intervention required.*`
            );
            this.mergeFailed = true;
          }
        }
        return "done";

      case "revision_needed":
        this.revisionCount++;
        this.lastReviewFeedback = reviewResult.feedback;
        // Update revision count on dashboard in real-time
        await this.postProgressUpdate("reviewing", prUrl, prNumber, this.revisionCount);

        if (this.revisionCount >= this.maxRevisions) {
          console.log(`[Epic] Max revisions (${this.maxRevisions}) reached. Escalating.`);
          await this.handleEscalation(
            prUrl,
            summaryParts,
            `Max revisions reached. Final feedback: ${reviewResult.feedback}`
          );
          return "done";
        }

        // Log selective revision info
        const selectiveInfo = reviewResult.affectedStories?.length
          ? ` (selective: stories ${reviewResult.affectedStories.join(", ")})`
          : " (full revision)";
        console.log(`[Epic] Revision needed (${this.revisionCount}/${this.maxRevisions})${selectiveInfo}. Re-running stories...`);

        await this.ticketOps.postComment(
          `🔄 Revision ${this.revisionCount}/${this.maxRevisions} requested by Tech Lead:\n\n${reviewResult.feedback}`
        );

        // Trigger revision with optional selective story targeting
        await this.triggerRevision(
          reviewResult.feedback,
          reviewResult.affectedStories,
          reviewResult.affectedReasons
        );
        return "continue";

      case "rejected":
        console.log("[Epic] PR rejected by Tech Lead.");
        await this.coordination.postContext(
          "decision",
          `❌ PR rejected by Tech Lead\n\n${reviewResult.feedback}`,
          "tech_lead"
        ).catch(() => {});
        await this.handleRejection(prUrl, summaryParts, reviewResult.feedback);
        return "done";

      default:
        console.error(`[Epic] Unknown review decision: ${reviewResult.decision}`);
        await this.handleEscalation(prUrl, summaryParts, `Unknown review decision: ${reviewResult.decision}`);
        return "done";
    }
  }

  /**
   * Ensure the Tech Lead review is posted to the GitHub PR.
   * The reviewer agent may or may not have run `gh pr review` or `gh pr comment`.
   * This checks for existing recent review content and posts if missing.
   */
  private async ensureGitHubReviewPosted(
    prNumber: number,
    reviewResult: InlineReviewResult
  ): Promise<void> {
    const token = this.config.githubReviewerToken || this.config.githubToken;
    if (!token || !this.config.targetRepo) return;

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    };

    try {
      // Check for existing review content on the PR (comments + formal reviews)
      const [commentsRes, reviewsRes] = await Promise.all([
        axios.get(
          `https://api.github.com/repos/${this.config.targetRepo}/issues/${prNumber}/comments`,
          { headers, params: { per_page: 10, sort: "created", direction: "desc" }, timeout: 10000 }
        ).catch(() => ({ data: [] })),
        axios.get(
          `https://api.github.com/repos/${this.config.targetRepo}/pulls/${prNumber}/reviews`,
          { headers, params: { per_page: 10 }, timeout: 10000 }
        ).catch(() => ({ data: [] })),
      ]);

      // Check if agent already posted a review comment in the last 10 minutes
      const cutoff = Date.now() - 10 * 60 * 1000;
      const hasRecentComment = (commentsRes.data as Array<{ created_at: string; body: string }>).some(
        (c) =>
          new Date(c.created_at).getTime() > cutoff &&
          /code review|review complete|approved|revision needed|request.changes/i.test(c.body)
      );
      const hasRecentReview = (reviewsRes.data as Array<{ submitted_at: string }>).some(
        (r) => new Date(r.submitted_at).getTime() > cutoff
      );

      if (hasRecentComment || hasRecentReview) {
        console.log("[Epic] Review already posted to PR by agent — skipping programmatic post");
        return;
      }

      // Build review body
      const emoji = reviewResult.decision === "approved" ? "✅"
        : reviewResult.decision === "revision_needed" ? "🔄" : "❌";
      const body = `## ${emoji} Tech Lead Review — ${reviewResult.decision.replace("_", " ").toUpperCase()}\n\n` +
        `**Code Quality Score:** ${reviewResult.codeQualityScore}/10\n\n` +
        `${reviewResult.feedback || "No detailed feedback."}`;

      // Try formal PR review first (gives the Approved/Changes Requested badge)
      const event = reviewResult.decision === "approved" ? "APPROVE"
        : reviewResult.decision === "revision_needed" ? "REQUEST_CHANGES"
        : "COMMENT";

      try {
        await axios.post(
          `https://api.github.com/repos/${this.config.targetRepo}/pulls/${prNumber}/reviews`,
          { body, event },
          { headers, timeout: 10000 }
        );
        console.log(`[Epic] Posted formal PR review (${event}) to PR #${prNumber}`);
      } catch (reviewErr: unknown) {
        // Formal review may fail due to self-approval restriction — fall back to issue comment
        const msg = reviewErr instanceof Error ? reviewErr.message : String(reviewErr);
        console.log(`[Epic] Formal PR review failed (${msg}) — posting as comment`);
        await axios.post(
          `https://api.github.com/repos/${this.config.targetRepo}/issues/${prNumber}/comments`,
          { body },
          { headers, timeout: 10000 }
        );
        console.log(`[Epic] Posted review as issue comment on PR #${prNumber}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Epic] Failed to ensure GitHub review posted: ${msg}`);
      // Non-fatal — don't crash the epic
    }
  }

  /**
   * Run AI SDK based review for non-Anthropic providers.
   * Spawns the AI SDK executor as a subprocess (same approach as Multi-Expert).
   */
  private async runAiSdkReview(
    prUrl: string,
    prNumber: number,
    provider: string,
    model: string,
    qualityMetrics?: QualityMetrics
  ): Promise<InlineReviewResult> {
    // Build review prompt with quality metrics
    const prompt = this.buildAiSdkReviewPrompt(prUrl, prNumber, qualityMetrics);

    // Write prompt to temp file
    const promptFile = `/tmp/epic-review-prompt-${Date.now()}.txt`;
    writeFileSync(promptFile, prompt);

    let allOutput = "";

    return new Promise((resolve) => {
      // Build environment with API keys
      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        AGENT_WORKING_DIR: this.gitOps.getRepoPath(),
        AGENT_MAX_STEPS: "50",
        AGENT_VERBOSE: "false",
      };

      // Use reviewer token for PR approvals (avoids self-approval restriction)
      if (this.config.githubReviewerToken) {
        env.GH_TOKEN = this.config.githubReviewerToken;
        env.GITHUB_TOKEN = this.config.githubReviewerToken;
        console.log("[Epic] Using separate reviewer token for PR approval");
      }

      // Set provider-specific API key
      if (provider === "google" || provider === "gemini") {
        env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
        env.GOOGLE_API_KEY = env.GOOGLE_GENERATIVE_AI_API_KEY;
      } else if (provider === "openai") {
        env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
      } else if (provider === "ollama") {
        env.OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
      }

      const args = [
        "/app/agents/ai-sdk-executor.js",
        "--provider", provider,
        "--model", model,
        "--persona", "tech_lead",
        "--prompt-file", promptFile,
      ];

      console.log(`[Epic] Spawning AI SDK executor: ${provider}/${model}`);

      const child = spawn("node", args, {
        cwd: "/app",
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      child.stdout.on("data", (data) => {
        const text = data.toString();
        for (const line of text.split("\n")) {
          if (line.trim()) {
            // AI SDK executor already outputs with formatted prefix [👑 tech_lead 🔵]
            // Forward as-is to maintain consistent formatting
            console.log(line);
            allOutput += line + "\n";
            // Forward to dashboard (fire and forget)
            axios.post(`${this.config.apiBaseUrl}/api/control-center/logs`, {
              taskId: this.config.parentTaskId,
              type: "manager",
              message: line,
              severity: "info",
            }, {
              headers: {
                "Content-Type": "application/json",
                "x-api-key": this.config.orgApiKey,
              },
              timeout: 5000,
            }).catch(() => {});
          }
        }
      });

      child.stderr.on("data", (data) => {
        const stderrText = data.toString().trim();
        if (stderrText && (stderrText.includes("Error") || stderrText.includes("error:"))) {
          // Forward errors as-is
          console.error(stderrText);
          // Forward errors to dashboard
          axios.post(`${this.config.apiBaseUrl}/api/control-center/logs`, {
            taskId: this.config.parentTaskId,
            type: "error",
            message: stderrText,
            severity: "error",
          }, {
            headers: {
              "Content-Type": "application/json",
              "x-api-key": this.config.orgApiKey,
            },
            timeout: 5000,
          }).catch(() => {});
        }
      });

      child.on("close", (code) => {
        // Cleanup
        try {
          unlinkSync(promptFile);
        } catch {
          // Ignore cleanup errors
        }

        // Report tokens even on failure (capture partial work for cost tracking)
        const reportTokensFromOutput = () => {
          const inputTokensMatch = allOutput.match(/::input_tokens::(\d+)/);
          const outputTokensMatch = allOutput.match(/::output_tokens::(\d+)/);
          const inputToks = inputTokensMatch ? parseInt(inputTokensMatch[1], 10) : 0;
          const outputToks = outputTokensMatch ? parseInt(outputTokensMatch[1], 10) : 0;

          if (inputToks > 0 || outputToks > 0) {
            const usageUrl = `${this.config.apiBaseUrl}/api/tasks/${this.config.parentTaskId}/usage/partial`;
            axios.post(usageUrl, {
              inputTokens: inputToks,
              outputTokens: outputToks,
              cacheCreationTokens: 0,
              cacheReadTokens: 0,
              mode: "add", // Use additive mode for multi-story token aggregation
              model,
            }, {
              headers: {
                "Content-Type": "application/json",
                "x-api-key": this.config.orgApiKey,
              },
            }).then(() => {
              console.log(`[Epic] Reported manager review tokens: input=${inputToks}, output=${outputToks}`);
            }).catch((err) => {
              console.warn(`[Epic] Failed to report manager review tokens: ${err.message}`);
            });
          }
        };

        if (code !== 0) {
          reportTokensFromOutput(); // Capture any tokens before failure
          resolve({
            success: false,
            decision: "rejected",
            feedback: `AI SDK executor exited with code ${code}`,
            codeQualityScore: 0,
            error: `AI SDK executor exited with code ${code}`,
          });
          return;
        }

        // Delegate review output parsing to Decision API
        // (handles structured markers, text markers, and natural language patterns)
        this.decisionClient.parseReviewOutcome({
          reviewOutput: allOutput,
          reviewerPersona: "tech_lead",
          revisionNumber: this.revisionCount,
        }).then((reviewOutcome) => {
          // Report tokens for cost tracking
          reportTokensFromOutput();

          const decision = reviewOutcome.decision === "rejected"
            ? "rejected" as const
            : reviewOutcome.decision === "revision_needed"
              ? "revision_needed" as const
              : "approved" as const;

          console.log(`[Epic] Decision API parsed review: ${decision} (score: ${reviewOutcome.score ?? "N/A"})`);

          resolve({
            success: true,
            decision,
            feedback: reviewOutcome.feedback || "No feedback provided",
            codeQualityScore: reviewOutcome.score
              ? Math.min(10, Math.max(1, reviewOutcome.score))
              : 5,
          });
        }).catch((parseErr) => {
          console.error("[Epic] Decision API review parsing failed, using fallback:", parseErr);
          // Report tokens even on parse failure
          reportTokensFromOutput();

          // Fallback: approve (same as decision client's safe fallback)
          resolve({
            success: true,
            decision: "approved",
            feedback: "Decision API unavailable — auto-approving",
            codeQualityScore: 5,
          });
        });
      });

      child.on("error", (err) => {
        resolve({
          success: false,
          decision: "rejected",
          feedback: `Failed to spawn AI SDK executor: ${err.message}`,
          codeQualityScore: 0,
          error: `Failed to spawn AI SDK executor: ${err.message}`,
        });
      });
    });
  }

  /**
   * Build review prompt for AI SDK executor.
   */
  private buildAiSdkReviewPrompt(prUrl: string, prNumber: number, qualityMetrics?: QualityMetrics): string {
    const revisionSection = this.lastReviewFeedback
      ? `## Previous Review Feedback (Revision ${this.revisionCount}/${this.maxRevisions})
This is a revision attempt. The previous code was reviewed and these issues were identified:

${this.lastReviewFeedback}

**IMPORTANT: Check if ALL issues above have been addressed, not just some of them.**
- The developer was instructed to fix every item
- If ANY issue remains unaddressed, request another revision
- Be specific about which items are still outstanding

---

`
      : "";

    // Build quality metrics section if available — use org thresholds, not hardcoded values
    let qualitySection = "";
    if (qualityMetrics) {
      const thresholds = this.config.qualityThresholds;
      const blockOnTypeErrors = thresholds?.blockOnTypeErrors ?? false;
      const blockOnTestFailures = thresholds?.blockOnTestFailures ?? true;
      const blockOnLintErrors = thresholds?.blockOnLintErrors ?? false;
      const blockOnE2EFailures = thresholds?.blockOnE2EFailures ?? false;
      const minQualityScore = thresholds?.minQualityScore ?? null;
      const maxSecurityHigh = thresholds?.maxSecurityHighVulns ?? null;

      const hasLintIssues = qualityMetrics.lintErrors > 0;
      const hasTypeErrors = qualityMetrics.typeErrors > 0;
      const hasTestFailures = qualityMetrics.testsFailed > 0;
      const hasSecurityIssues = maxSecurityHigh !== null ? qualityMetrics.securityHigh > maxSecurityHigh : qualityMetrics.securityHigh > 0;
      const qualityBelowThreshold = minQualityScore !== null && qualityMetrics.qualityScore < minQualityScore;

      qualitySection = `## Automated Quality Metrics

| Metric | Result | Status |
|--------|--------|--------|
| **Overall Score** | ${qualityMetrics.qualityScore}% | ${qualityBelowThreshold ? `⚠️ Below ${minQualityScore}% threshold` : '✅'} |
| TypeCheck | ${qualityMetrics.typeErrors} errors | ${hasTypeErrors ? (blockOnTypeErrors ? '❌ Blocking' : '⚠️ Non-blocking') : '✅'} |
| Lint | ${qualityMetrics.lintErrors} errors, ${qualityMetrics.lintWarnings} warnings | ${hasLintIssues ? (blockOnLintErrors ? '❌ Blocking' : '⚠️ Non-blocking') : '✅'} |
| Tests | ${qualityMetrics.testsPassed} passed, ${qualityMetrics.testsFailed} failed | ${hasTestFailures ? (blockOnTestFailures ? '❌ Blocking' : '⚠️ Non-blocking') : '✅'} |
| E2E Tests | ${qualityMetrics.e2ePassed ?? 0} passed, ${qualityMetrics.e2eFailed ?? 0} failed | ${(qualityMetrics.e2eFailed ?? 0) > 0 ? (blockOnE2EFailures ? '❌ Blocking' : '⚠️ Non-blocking') : '✅'} |
| Security | ${qualityMetrics.securityHigh} high, ${qualityMetrics.securityMedium} medium | ${hasSecurityIssues ? '🔴 Blocking' : '✅'} |

### Quality Gate Rules (from Organization Settings)
${qualityBelowThreshold ? `**⚠️ QUALITY SCORE BELOW ${minQualityScore}% - Consider requesting revision.**\n` : ''}${hasTypeErrors && blockOnTypeErrors ? '**❌ TYPE ERRORS DETECTED - Organization requires these to be fixed.**\n' : ''}${hasTypeErrors && !blockOnTypeErrors ? '**ℹ️ Type errors detected but blocking is DISABLED in org settings — do NOT request revision for type errors alone.**\n' : ''}${hasLintIssues && blockOnLintErrors ? '**❌ LINT ERRORS DETECTED - Organization requires these to be fixed.**\n' : ''}${hasLintIssues && !blockOnLintErrors ? '**ℹ️ Lint errors detected but blocking is DISABLED in org settings — do NOT request revision for lint errors alone.**\n' : ''}${(qualityMetrics.e2eFailed ?? 0) > 0 && blockOnE2EFailures ? '**❌ E2E TEST FAILURES DETECTED - Organization requires these to be fixed.**\n' : ''}${(qualityMetrics.e2eFailed ?? 0) > 0 && !blockOnE2EFailures ? '**ℹ️ E2E test failures detected but blocking is DISABLED in org settings — do NOT request revision for E2E failures alone.**\n' : ''}${hasTestFailures && blockOnTestFailures ? '**❌ TEST FAILURES DETECTED - Organization requires these to be fixed.**\n' : ''}${hasTestFailures && !blockOnTestFailures ? '**ℹ️ Test failures detected but blocking is DISABLED in org settings — do NOT request revision for test failures alone.**\n' : ''}${hasSecurityIssues ? '**🔴 HIGH SEVERITY SECURITY ISSUES - These must be fixed.**\n' : ''}${!qualityBelowThreshold && !hasSecurityIssues && !(hasTypeErrors && blockOnTypeErrors) && !(hasTestFailures && blockOnTestFailures) && !(hasLintIssues && blockOnLintErrors) && !((qualityMetrics.e2eFailed ?? 0) > 0 && blockOnE2EFailures) ? '**✅ All quality gates pass per organization settings — bias toward approval.**\n' : ''}
---

`;
    }

    const qualityNote = qualityMetrics ? "- **Do the automated quality metrics pass? (See above)**" : "";
    const qualityGateNote = qualityMetrics
      ? "\n   **NOTE: Review the quality metrics above. Only request REVISION_NEEDED for metrics marked as ❌ Blocking per organization settings. Metrics marked ⚠️ Non-blocking or ℹ️ Informational should be noted in feedback but are NOT grounds for revision.**"
      : "";

    // Build SCM-aware instructions
    const scmProvider = process.env.SCM_PROVIDER || "github";
    const isGitHub = scmProvider === "github";
    const isBitbucket = scmProvider === "bitbucket";
    const targetRepo = process.env.TARGET_REPO || process.env.GITHUB_REPO || "";

    // Build SCM-specific diff instructions
    let diffInstructions: string;
    let reviewSubmitInstructions: string;

    if (isGitHub) {
      // GitHub: Use gh CLI with explicit -R flag (git remote URL has embedded credentials that confuse gh)
      diffInstructions = `1. **First, list the changed files to understand the scope**:
   \`\`\`bash
   gh pr diff ${prNumber} -R ${targetRepo} --name-only
   \`\`\`

   Then review the diff (for small PRs) or read specific files (for large PRs):
   \`\`\`bash
   gh pr diff ${prNumber} -R ${targetRepo}  # Full diff - use for small PRs (<10 files)
   \`\`\`
   For large PRs with many files, read individual files directly instead of loading the full diff.`;

      reviewSubmitInstructions = `4. **Submit your review to GitHub** (REQUIRED):

   **If APPROVE:**
   \`\`\`bash
   gh pr review ${prNumber} -R ${targetRepo} --approve --body "Your approval message"
   \`\`\`

   **If REVISION_NEEDED or REJECT:**
   \`\`\`bash
   gh pr review ${prNumber} -R ${targetRepo} --request-changes --body "Your detailed feedback"
   \`\`\`

5.`;
    } else if (isBitbucket) {
      // Bitbucket: Use REST API via curl or git diff
      diffInstructions = `1. **First, list the changed files to understand the scope**:

   **Option A - Use git diff (if branch is checked out locally):**
   \`\`\`bash
   git diff --name-only origin/main...HEAD
   \`\`\`

   **Option B - Use Bitbucket API (if you have the PR details):**
   \`\`\`bash
   # List files changed in PR
   curl -s -u "\${BITBUCKET_EMAIL}:\${SCM_TOKEN}" \\
     "https://api.bitbucket.org/2.0/repositories/${targetRepo}/pullrequests/${prNumber}/diffstat" | \\
     jq -r '.values[].new.path // .values[].old.path' 2>/dev/null || echo "Use git diff instead"
   \`\`\`

   Then review the diff:
   - **Small PRs (<10 files)**: Get the full diff
     \`\`\`bash
     git diff origin/main...HEAD
     \`\`\`
   - **Large PRs (10+ files)**: Read individual important files directly instead of loading the entire diff.

   **IMPORTANT:** Do NOT use \`gh\` commands - this is a Bitbucket repository, not GitHub.`;

      reviewSubmitInstructions = `4. **(Bitbucket: Review submission is handled automatically based on your decision markers)**

   Your REVIEW_DECISION and FEEDBACK markers will be used to update the PR status.

5.`;
    } else {
      // GitLab or other
      diffInstructions = `1. **First, list the changed files to understand the scope**:
   \`\`\`bash
   git diff --name-only origin/main...HEAD
   \`\`\`

   Then review selectively based on scope:
   - **Small PRs (<10 files)**: \`git diff origin/main...HEAD\`
   - **Large PRs (10+ files)**: Read individual important files directly.`;

      reviewSubmitInstructions = `4. **(GitLab: Review submission is handled automatically)**

5.`;
    }

    // Build SCM-specific notice
    const scmNotice = isBitbucket
      ? `**IMPORTANT:** This is a Bitbucket repository. Do NOT use \`gh\` (GitHub CLI) commands.
Use \`git diff\` commands or Bitbucket API via curl as shown below.`
      : isGitHub
      ? `This is a GitHub repository. Use \`gh\` CLI commands for PR operations.`
      : `This is a ${scmProvider} repository. Use git commands for diff operations.`;

    return `# PR Code Review Task

${revisionSection}${qualitySection}## Task Details
- **Jira Issue**: ${this.config.jiraIssueKey}
- **PR URL**: ${prUrl}
- **PR Number**: ${prNumber}
- **SCM Provider**: ${scmProvider}
- **Repository**: ${targetRepo}

${scmNotice}

## Instructions

${diffInstructions}

2. **Review the code** against these criteria:
   - Does it correctly implement the Jira requirements?
   - Is the code quality acceptable?
   - Are there security vulnerabilities?
   - Are there test coverage gaps?
   - Does it follow project coding standards?
   ${qualityNote}
   ${this.lastReviewFeedback ? "- **Have the previous review issues been addressed?**" : ""}

3. **Make your decision**: APPROVE, REVISION_NEEDED, or REJECT${qualityGateNote}

${reviewSubmitInstructions} **Output your decision** using these exact markers:
   \`\`\`
   REVIEW_DECISION: approved
   CODE_QUALITY_SCORE: 8
   FEEDBACK: Your detailed feedback here
   \`\`\`

Begin your review now. Start by fetching the code changes.`;
  }

  /**
   * Poll CI check-runs on a PR's head commit.
   * Uses the GitHub Check Runs API which covers all CI providers (Actions, third-party).
   */
  private async pollPrCI(prNumber: number): Promise<{ passed: boolean; pending: boolean; log?: string }> {
    const scmProvider = process.env.SCM_PROVIDER || "github";
    if (scmProvider !== "github") {
      // For non-GitHub providers, skip CI polling — Bitbucket/GitLab CI is checked in Gate 2
      await this.postLog(`[CI Gate] SCM provider "${scmProvider}" — skipping PR CI poll`);
      return { passed: true, pending: false };
    }

    const [owner, repo] = this.config.targetRepo.split("/");
    const token = this.config.githubToken;

    try {
      // Get PR head SHA
      const prRes = execSync(
        `gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.head.sha'`,
        { env: { ...process.env, GH_TOKEN: token }, encoding: "utf-8", timeout: 15000 }
      ).trim();
      const headSha = prRes;
      if (!headSha) {
        await this.postLog("[CI Gate] Could not determine PR head SHA — treating as failed");
        return { passed: false, pending: false, log: "Could not determine PR head SHA" };
      }

      // Poll check-runs using org's blockerWaitTimeout setting
      const maxWaitMs = this.resilience.blockerWaitTimeoutMs;
      const pollIntervalMs = 30 * 1000;
      const noChecksGraceMs = 3 * 60 * 1000;
      const startTime = Date.now();

      await this.postLog(`[CI Gate] Polling CI checks on PR #${prNumber} (SHA: ${headSha.substring(0, 7)})...`);

      while (Date.now() - startTime < maxWaitMs) {
        const checksJson = execSync(
          `gh api repos/${owner}/${repo}/commits/${headSha}/check-runs --jq '{total: .total_count, runs: [.check_runs[] | {name: .name, status: .status, conclusion: .conclusion, url: .html_url}]}'`,
          { env: { ...process.env, GH_TOKEN: token }, encoding: "utf-8", timeout: 15000 }
        ).trim();
        const checks = JSON.parse(checksJson);

        if (checks.total === 0) {
          if (Date.now() - startTime > noChecksGraceMs) {
            await this.postLog("[CI Gate] No CI checks found after 3 minutes — treating as failed");
            return { passed: false, pending: false, log: "No CI checks found after 3 minute grace period" };
          }
          // Wait for checks to appear
          await new Promise(r => setTimeout(r, pollIntervalMs));
          continue;
        }

        const pending = checks.runs.some((r: { status: string }) => r.status !== "completed");
        if (pending) {
          const completedCount = checks.runs.filter((r: { status: string }) => r.status === "completed").length;
          await this.postLog(`[CI Gate] ${completedCount}/${checks.total} checks completed — waiting...`);
          await new Promise(r => setTimeout(r, pollIntervalMs));
          continue;
        }

        // All checks completed
        const failed = checks.runs.filter((r: { conclusion: string }) =>
          r.conclusion !== "success" && r.conclusion !== "skipped" && r.conclusion !== "neutral"
        );

        if (failed.length === 0) {
          await this.postLog(`[CI Gate] All ${checks.total} CI checks passed`);
          return { passed: true, pending: false };
        }

        // Collect failure details
        const failureLog = failed.map((r: { name: string; conclusion: string; url: string }) =>
          `${r.name}: ${r.conclusion} (${r.url})`
        ).join("\n");

        // Try to get detailed failure output from the first failed check
        let detailedLog = failureLog;
        try {
          const failedRun = failed[0];
          const runId = failedRun.url?.match(/\/runs\/(\d+)/)?.[1];
          if (runId) {
            const logOutput = execSync(
              `gh api repos/${owner}/${repo}/actions/runs/${runId}/jobs --jq '[.jobs[] | select(.conclusion != "success") | .steps[] | select(.conclusion == "failure") | "Step: " + .name + "\\nConclusion: " + .conclusion] | join("\\n---\\n")'`,
              { env: { ...process.env, GH_TOKEN: token }, encoding: "utf-8", timeout: 15000 }
            ).trim();
            if (logOutput) {
              detailedLog = `${failureLog}\n\nFailed steps:\n${logOutput}`;
            }
          }
        } catch {
          // Detailed log fetch is best-effort
        }

        await this.postLog(`[CI Gate] ${failed.length} CI check(s) failed:\n${failureLog}`);
        return { passed: false, pending: false, log: detailedLog };
      }

      // Timeout with still-pending checks — treat as failure
      const waitMinutes = Math.round(maxWaitMs / 60_000);
      await this.postLog(`[CI Gate] CI checks still pending after ${waitMinutes} minutes — treating as failed`);
      return { passed: false, pending: true, log: `CI checks did not complete within ${waitMinutes} minutes` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.postLog(`[CI Gate] Error polling CI: ${msg} — treating as failed`);
      return { passed: false, pending: false, log: `CI polling error: ${msg}` };
    }
  }

  /**
   * Merge a PR with CI verification and automatic fix attempts.
   * Polls PR CI, launches CI Fix Agent on failures, retries up to config.maxFixRetries.
   * Blocks merge if CI fails and cannot be fixed.
   */
  private async mergeWithCIVerification(
    prUrl: string,
    prNumber: number,
    mergeLabel: string
  ): Promise<{ merged: boolean }> {
    // If CI fix retries disabled, merge directly
    if ((this.config.maxFixRetries) <= 0) {
      await this.postLog(`Merging PR #${prNumber} (${mergeLabel}, CI check disabled)...`);
      const merged = await this.gitOps.mergePR(prUrl, prNumber);
      return { merged };
    }

    // Reset CI fix counter for this merge attempt
    this.ciFixRetryCount = 0;

    // Initial CI check
    let ciResult = await this.pollPrCI(prNumber);

    if (ciResult.passed) {
      await this.postLog(`Merging PR #${prNumber} (${mergeLabel})...`);
      const merged = await this.gitOps.mergePR(prUrl, prNumber);
      return { merged };
    }

    // CI failed — enter fix loop
    const maxRetries = this.config.maxFixRetries;
    while (this.ciFixRetryCount < maxRetries) {
      this.ciFixRetryCount++;
      await this.postLog(
        `[CI Gate] CI failed on PR #${prNumber} — launching CI Fix Agent (attempt ${this.ciFixRetryCount}/${maxRetries})`
      );

      const fixer = new InlineCIFixer(this.config, this.gitOps.getRepoPath());
      const fixResult = await fixer.fix(prNumber, ciResult.log || "No detailed failure log available");

      if (fixResult.decision === "unfixable") {
        await this.postLog(`[CI Gate] CI Fix Agent reports issue is unfixable: ${fixResult.summary}`);
        break;
      }

      if (fixResult.success) {
        await this.postLog(`[CI Gate] CI Fix Agent applied fix: ${fixResult.summary} — waiting for CI re-run...`);

        // Wait a moment for CI to trigger on new push
        await new Promise(r => setTimeout(r, 10000));

        // Re-poll CI
        ciResult = await this.pollPrCI(prNumber);

        if (ciResult.passed) {
          await this.postLog(`[CI Gate] CI now passing after fix — merging PR #${prNumber}`);
          const merged = await this.gitOps.mergePR(prUrl, prNumber);
          return { merged };
        }
        // Still failing — loop continues
      } else {
        await this.postLog(`[CI Gate] CI Fix Agent failed: ${fixResult.summary}`);
        break;
      }
    }

    // All retries exhausted or unfixable — do NOT merge broken code
    await this.postLog(
      `❌ CI still failing after ${this.ciFixRetryCount} fix attempt(s) — blocking merge of PR #${prNumber}`
    );
    return { merged: false };
  }

  /**
   * Run inline DevOps deployment after Tech Lead approval.
   * Merges the PR and triggers GitHub Actions deployment.
   * Returns true if deployment succeeded, false if it failed.
   */
  private async runInlineDeployment(
    prUrl: string,
    prNumber: number,
    summaryParts: string[]
  ): Promise<boolean> {
    console.log("[Epic] Running inline DevOps deployment...");
    // Update status so dashboard progress bar advances to "Deployed" stage
    await this.postProgressUpdate("deploying", prUrl, prNumber);

    const deployer = new InlineDeployer(this.config, this.gitOps.getRepoPath(), this.serverPromptTemplates ? {
      phase1: this.serverPromptTemplates.devopsPhase1Prompt,
      deployAuto: this.serverPromptTemplates.devopsDeployAutoPrompt,
      deployManual: this.serverPromptTemplates.devopsDeployManualPrompt,
      create: this.serverPromptTemplates.devopsCreatePrompt,
    } : undefined);
    const deployResult = await deployer.deploy(prUrl, prNumber);

    if (!deployResult.success) {
      console.error("[Epic] Deployment failed:", deployResult.summary);
      await this.ticketOps.postComment(
        `❌ Deployment failed:\n\n${deployResult.summary}\n\nPR: ${prUrl}\n\n*Requires human intervention.*`
      );
      await this.handleEscalation(prUrl, summaryParts, `Deployment failed: ${deployResult.summary}`);
      return false;
    }

    console.log("[Epic] Deployment succeeded!");
    this.deploymentSucceeded = true;

    // Build deployment success message
    let deployMessage = `🚀 Deployed successfully!\n\n${deployResult.summary}`;
    if (deployResult.workflowRunUrl) {
      deployMessage += `\n\nWorkflow: ${deployResult.workflowRunUrl}`;
    }
    deployMessage += `\n\nPR: ${prUrl}`;

    await this.ticketOps.postComment(deployMessage);

    // Transition Jira to Done
    await this.ticketOps.transitionTo("Done");

    return true;
  }

  /**
   * Deployment-only fast path.
   * Skips planning/stories/review and goes straight to merge + deploy.
   * Used when a task is re-queued with DEPLOYMENT_RUN in taskNotes.
   */
  private async runDeploymentOnly(prUrl: string, prNumber: number): Promise<void> {
    console.log(`[Epic] Starting deployment-only run for PR #${prNumber}: ${prUrl}`);

    await this.ticketOps.postComment(
      `🚀 **Deployment-only run** — merging and deploying PR #${prNumber}.\n\nPR: ${prUrl}`
    );

    await this.updateTaskStatus("running", `Deploying PR #${prNumber}`);

    const deployResult = await this.runInlineDeployment(prUrl, prNumber, ["Deployment-only run"]);

    if (deployResult) {
      // runInlineDeployment already posted Jira comment and transitioned to Done
      await this.updateTaskStatus("deployed", `Deployed: PR #${prNumber} merged and deployed`, undefined, prUrl);
    }
    // On failure, runInlineDeployment already called handleEscalation which sets status

    this.missionActive = false;
  }

  /**
   * Review-only fast path.
   * Runs Tech Lead review on an existing PR without planning/stories.
   * Returns true if revision is needed (caller should fall through to full coordination loop).
   * Returns false if review is terminal (approved, rejected, escalated).
   */
  private async runReviewOnly(prUrl: string, prNumber: number): Promise<boolean> {
    console.log(`[Epic] Starting review-only run for PR #${prNumber}: ${prUrl}`);

    await this.ticketOps.postComment(
      `🔍 **Review-only run** — running Tech Lead review on PR #${prNumber}.\n\nPR: ${prUrl}`
    );
    await this.coordination.postContext(
      "progress",
      `Starting review-only Tech Lead review on PR #${prNumber}`,
      "tech_lead"
    ).catch(() => {});
    await this.updateTaskStatus("running", `Reviewing PR #${prNumber}`);

    // Checkout PR branch for review
    await this.gitOps.checkoutForReview(prNumber);

    const managerProvider = process.env.MANAGER_PROVIDER || "anthropic";
    const managerModel = process.env.MANAGER_MODEL || "";
    let reviewResult: InlineReviewResult;

    if (managerProvider === "anthropic") {
      const reviewer = new InlineReviewer(this.config, this.gitOps.getRepoPath(), this.serverPromptTemplates?.techLeadReviewPrompt);
      reviewResult = await reviewer.review(prUrl, prNumber);
    } else {
      reviewResult = await this.runAiSdkReview(prUrl, prNumber, managerProvider, managerModel);
    }

    if (!reviewResult.success) {
      await this.handleEscalation(prUrl, ["Review-only run"], `Review failed: ${reviewResult.error}`);
      this.missionActive = false;
      return false;
    }

    switch (reviewResult.decision) {
      case "approved":
        await this.ticketOps.postComment(
          `✅ PR approved by Tech Lead (score: ${reviewResult.codeQualityScore}/10)\n\n${reviewResult.feedback}`
        );
        await this.coordination.postContext(
          "decision",
          `✅ PR #${prNumber} approved (score: ${reviewResult.codeQualityScore}/10)\n\n${reviewResult.feedback}`,
          "tech_lead"
        ).catch(() => {});
        // PRD auto-run: merge the PR so dependent stories don't stack up conflicts
        if (this.config.prdChildTask) {
          console.log(`[Epic] PRD child task — auto-merging PR #${prNumber} with CI verification`);
          const mergeResult = await this.mergeWithCIVerification(prUrl, prNumber, "PRD auto-run");
          if (mergeResult.merged) {
            await this.postLog(`PR #${prNumber} merged successfully`);
            await this.ticketOps.postComment(`🔀 PR #${prNumber} auto-merged (PRD workflow)`);
            if (this.config.jiraIssueKey) {
              await this.gitOps.postMergeCleanup(this.config.jiraIssueKey);
            }
          } else {
            await this.postLog(`❌ PR #${prNumber} merge failed — CI checks did not pass after all retry attempts`);
            await this.ticketOps.postComment(
              `❌ PR #${prNumber} could not be merged — CI checks failed after all retry attempts.\n\nPR: ${prUrl}\n\n*Manual intervention required.*`
            );
            await this.updateTaskStatus("failed", `PR #${prNumber} CI failed — merge blocked`, `CI checks did not pass after all retry attempts`, prUrl);
            this.missionActive = false;
            return false;
          }
        }
        await this.updateTaskStatus("pr_approved", `PR #${prNumber} approved by Tech Lead`, undefined, prUrl);
        this.missionActive = false;
        return false;

      case "revision_needed":
        await this.ticketOps.postComment(
          `🔄 Review: Revision needed for PR #${prNumber}\n\n${reviewResult.feedback}`
        );
        await this.coordination.postContext(
          "revision_requested",
          `🔄 Revision needed for PR #${prNumber}\n\n${reviewResult.feedback}`,
          "tech_lead"
        ).catch(() => {});
        // Inject feedback so planning agent uses it in the full coordination loop
        this.config.reviewFeedback = reviewResult.feedback;
        this.lastReviewFeedback = reviewResult.feedback;
        this.revisionCount++;
        return true; // Signal caller to fall through to full coordination loop

      case "rejected":
        await this.coordination.postContext(
          "decision",
          `❌ PR #${prNumber} rejected\n\n${reviewResult.feedback}`,
          "tech_lead"
        ).catch(() => {});
        await this.handleRejection(prUrl, ["Review-only run"], reviewResult.feedback);
        this.missionActive = false;
        return false;

      default:
        await this.handleEscalation(
          prUrl,
          ["Review-only run"],
          `Unknown review decision: ${reviewResult.decision}`
        );
        this.missionActive = false;
        return false;
    }
  }

  /**
   * Compute the transitive closure of affected stories.
   * Given directly affected story indices, computes all stories that need revision
   * including downstream dependents (stories that depend on affected ones).
   *
   * @param directlyAffected - Story indices that directly need revision
   * @param allStories - All stories in the Epic
   * @returns Set of all story indices that need re-execution
   */
  private computeAffectedStoryClosure(
    directlyAffected: number[],
    allStories: ReadyStory[]
  ): Set<number> {
    const toRevise = new Set(directlyAffected);

    // Build reverse dependency map: storyIndex -> [stories that depend on it]
    const dependents = new Map<number, number[]>();
    for (const story of allStories) {
      for (const dep of story.dependencies) {
        if (!dependents.has(dep)) dependents.set(dep, []);
        dependents.get(dep)!.push(story.storyIndex);
      }
    }

    // BFS to find all downstream stories
    const queue = [...directlyAffected];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const downstreamStories = dependents.get(current) || [];
      for (const downstream of downstreamStories) {
        if (!toRevise.has(downstream)) {
          toRevise.add(downstream);
          queue.push(downstream);
        }
      }
    }

    return toRevise;
  }

  /**
   * Trigger a revision by resetting story states and injecting feedback.
   * Stories are queued for direct re-execution (bypassing the claim system).
   *
   * With selective revision, only affected stories and their downstream dependents
   * are re-executed. If no affectedStories provided, all stories are re-executed.
   *
   * @param feedback - Review feedback from Tech Lead
   * @param affectedStories - Story indices that directly need revision (optional)
   * @param affectedReasons - Reasons why each story needs revision (optional)
   */
  private async triggerRevision(
    feedback: string,
    affectedStories?: number[],
    affectedReasons?: Record<number, string>
  ): Promise<void> {
    console.log("[Epic] Triggering revision with feedback injection...");

    // Update config with review feedback for story executors to see
    this.config.reviewFeedback = feedback;
    // Store per-story reasons so each executor only sees its own feedback
    this.config.revisionReasons = affectedReasons
      ? Object.fromEntries(
          Object.entries(affectedReasons).map(([k, v]) => [Number(k), v])
        )
      : undefined;

    // Reset all expert states to idle
    for (const expert of getAvailableExperts()) {
      this.expertStates.set(expert, {
        persona: expert,
        status: "idle",
      });
    }

    // Post revision request to coordination feed for tracking
    await this.coordination.postRevisionRequest(this.revisionCount, feedback);

    // Get all stories
    const allStories = await this.coordination.getReadyStories();

    // Compute which stories need revision
    let storiesToRevise: Set<number>;
    if (affectedStories && affectedStories.length > 0) {
      // Selective revision: only re-run the directly affected stories.
      // The consolidated PR review already saw the full merged code from all
      // stories — if it only flagged specific stories, their dependents are fine.
      // Dependency closure was too aggressive: flagging a foundation story (e.g.
      // layout fix) would cascade to nearly every story, wasting tokens on
      // re-running code the reviewer already approved.
      storiesToRevise = new Set(affectedStories);
      console.log(`[Epic] Selective revision: re-running ${storiesToRevise.size} directly affected stories only (no dependency closure)`);

      // Log affected reasons if provided
      if (affectedReasons) {
        for (const [idx, reason] of Object.entries(affectedReasons)) {
          console.log(`[Epic]   Story ${idx}: ${reason}`);
        }
      }
    } else {
      // Full revision: all stories need re-execution
      storiesToRevise = new Set(allStories.map(s => s.storyIndex));
      console.log(`[Epic] Full revision: all ${storiesToRevise.size} stories will be re-executed`);
    }

    // Capture prior work context from story branches BEFORE deleting them.
    // This gives revision workers knowledge of what was attempted previously —
    // commits, files changed, and diff summary — so they can avoid repeating mistakes.
    const priorWorkMap: Record<number, string> = {};
    try {
      const branchSummaries = await this.gitOps.captureStoryBranchSummaries(
        this.config.jiraIssueKey,
        storiesToRevise
      );
      for (const [idx, summary] of Object.entries(branchSummaries)) {
        priorWorkMap[Number(idx)] = summary;
      }
      if (Object.keys(priorWorkMap).length > 0) {
        console.log(`[Epic] Captured prior work context for ${Object.keys(priorWorkMap).length} stories`);
      }
    } catch (e) {
      console.warn(`[Epic] Could not capture prior work context: ${e}`);
      // Non-fatal — workers will just lack prior context
    }
    this.config.revisionPriorWork = priorWorkMap;

    // Delete story branches ONLY for stories being revised, so revision stories
    // start fresh from main. Branches for approved stories are preserved so that
    // revised stories can still merge them as dependencies.
    // Without this, createStoryBranch() reuses old branches with stale history,
    // and consolidation replays stale commits that undo revision fixes.
    try {
      await this.gitOps.deleteStoryBranches(this.config.jiraIssueKey, storiesToRevise);
    } catch (e) {
      console.warn(`[Epic] Could not delete story branches: ${e}`);
      // Non-fatal — stories will still run, just may reuse old branches
    }

    // Archive old claims and completions for affected stories only
    // This allows the claim system to work correctly on retry
    const storyIndicesToArchive = Array.from(storiesToRevise);
    await this.coordination.archiveStoryClaims(storyIndicesToArchive);

    // Clear completion state for affected stories only
    for (const idx of storiesToRevise) {
      this.completedStoryIndices.delete(idx);
      this.locallyCompletedStoryIndices.delete(idx);
    }

    // Clear blocked-story log suppression so revision progress is visible
    for (const idx of storiesToRevise) {
      this.loggedBlockedStories.delete(idx);
    }

    // Queue only affected stories for re-execution, sorted by index (respects dependencies)
    this.revisionStoriesQueued = allStories
      .filter(s => storiesToRevise.has(s.storyIndex))
      .sort((a, b) => a.storyIndex - b.storyIndex);

    console.log(`[Epic] Revision triggered. ${this.revisionStoriesQueued.length} stories queued for re-execution.`);
  }

  /**
   * Spawn a Claude agent to fix quality gate failures that shell commands couldn't resolve.
   * Uses the same agent SDK as InlineIntegrationFixer / InlineCIFixer.
   */
  private async runQualityFixAgent(repoPath: string, issuesRemaining: string[]): Promise<boolean> {
    // Capture fresh quality gate output so the agent sees ALL errors.
    // Uses board gate commands (if configured) or language profile commands,
    // matching the same tools the quality runner uses for scoring.
    let errorOutput = "";

    const profile = detectLanguage(repoPath);
    const boardGates = this.config.qualityGateCommands;
    const execEnv = { ...process.env, CI: "true", PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` };

    // Resolve commands: board gate commands take priority, then language profile defaults
    const typecheckCmd = (boardGates?.length ? findBoardGateCommand(boardGates, "typecheck") : undefined) || profile.typecheck;
    const lintCmd = (boardGates?.length ? findBoardGateCommand(boardGates, "lint") : undefined) || profile.lint;
    const testCmd = (boardGates?.length ? findBoardGateCommand(boardGates, "test") : undefined) || profile.test;

    // 1. Typecheck errors
    if (typecheckCmd) {
      try {
        execSync(typecheckCmd, { cwd: repoPath, encoding: "utf-8", timeout: 120_000, env: execEnv, shell: "/bin/bash" });
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string };
        errorOutput += "=== TYPECHECK ERRORS ===\n" + (err.stdout || "") + "\n" + (err.stderr || "");
      }
    }

    // 2. Lint errors
    if (lintCmd) {
      try {
        execSync(lintCmd, { cwd: repoPath, encoding: "utf-8", timeout: 120_000, env: execEnv, shell: "/bin/bash" });
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string };
        errorOutput += "\n=== LINT ERRORS ===\n" + (err.stdout || "") + "\n" + (err.stderr || "");
      }
    }

    // 3. Test failures
    if (testCmd) {
      try {
        execSync(testCmd, { cwd: repoPath, encoding: "utf-8", timeout: 300_000, env: execEnv, shell: "/bin/bash" });
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string };
        errorOutput += "\n=== TEST FAILURES ===\n" + (err.stdout || "") + "\n" + (err.stderr || "");
      }
    }

    if (!errorOutput.trim()) {
      errorOutput = issuesRemaining.join("\n");
    }

    const maxLen = 12 * 1024;
    const truncated = errorOutput.length > maxLen
      ? errorOutput.substring(errorOutput.length - maxLen)
      : errorOutput;

    const repoContext = loadRepoContext(repoPath);
    const repoContextSection = repoContext
      ? `\n### Repository Context\n\n${repoContext}\n`
      : "";

    // Build verification instructions using the same commands the quality runner will use
    const verifySteps = [
      typecheckCmd ? `Run \`${typecheckCmd}\` to verify type errors are resolved` : null,
      lintCmd ? `Run \`${lintCmd}\` to verify lint errors are resolved` : null,
      testCmd ? `Run \`${testCmd}\` to verify test failures are resolved` : null,
    ].filter(Boolean);

    const prompt = `## Quality Gate Failures

**Repository:** ${this.config.targetRepo}
**Language:** ${profile.displayName}
${repoContextSection}
### Error Output

\`\`\`
${truncated}
\`\`\`

### Instructions

The code has quality gate failures that need fixing.

1. Read ALL the errors carefully and fix ALL of them — typecheck, lint, AND tests
${verifySteps.map((s, i) => `${i + 2}. ${s}`).join("\n")}
${verifySteps.length + 2}. Do NOT refactor beyond what's needed to pass quality gates
${verifySteps.length + 3}. Do NOT change language versions, framework versions, or dependency versions
${verifySteps.length + 4}. Commit with message "fix: resolve quality gate issues"`;

    const systemPrompt = `You are a Quality Fix Agent. Fix ALL quality gate failures in the codebase. You have full access to read and edit files.

## Rules
- Fix EVERY error, not just the first
- Run verification commands after fixing to confirm
- Do NOT refactor beyond what's needed
- Do NOT change language or dependency versions
- **NEVER change framework or dependency major versions**

## Communication Style
Write in a professional, direct tone. Do NOT open with filler words or pleasantries.`;

    const model = process.env.MANAGER_MODEL || this.config.model || "";

    try {
      const result: AgentResult = await runAgent(this.config, {
        prompt,
        expertConfig: {
          persona: "qa_engineer" as const,
          description: "Quality fix specialist",
          systemPrompt,
          tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
          model,
          specialties: ["testing", "quality"],
          maxTurns: this.config.maxAgentTurns,
        },
        repoPath,
        storyId: `quality-fix-${this.config.parentTaskId}`,
        onMessage: (msg) => {
          if (msg.type === "text" && msg.content && msg.content.length > 20) {
            this.postLog(msg.content);
          } else if (msg.type === "tool_use" && msg.toolName) {
            const input = msg.toolInput;
            let toolMsg = `Tool: ${msg.toolName}`;
            if (input?.command) toolMsg += ` -> ${String(input.command).substring(0, 500)}`;
            else if (input?.file_path) toolMsg += ` -> ${input.file_path}`;
            this.postLog(toolMsg);
          }
        },
      });

      if (!result.success) {
        console.log(`[Epic] Quality fix agent failed: ${result.error}`);
        return false;
      }

      // Verify quality actually passes now
      const metrics = await runQualityVerification(repoPath, this.config.qualityGateCommands);
      const evalResult = await this.decisionClient.evaluateQuality({
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

      if (evalResult.pass) {
        console.log("[Epic] Quality fix agent resolved all issues");
        this.postDashboardLog("Claude fix agent resolved all quality issues");
        return true;
      }

      console.log(`[Epic] Quality fix agent ran but gate still fails: ${evalResult.blockers.join(", ")}`);
      return false;
    } catch (error) {
      console.error("[Epic] Quality fix agent error:", error instanceof Error ? error.message : error);
      return false;
    }
  }

  /**
   * Handle escalation (max revisions reached or review failure).
   */
  private async handleEscalation(
    prUrl: string,
    summaryParts: string[],
    reason: string
  ): Promise<void> {
    const jiraComment = `⚠️ Epic escalated for human review:\n\n${reason}\n\nPR: ${prUrl}\n\n*Requires human intervention.*`;
    await this.ticketOps.postComment(jiraComment);

    await this.updateTaskStatus(
      "failed", // Will be converted to "escalated" by API based on revision context
      `Epic escalated: ${summaryParts.join(", ")} - ${reason}`,
      reason,
      prUrl
    );

    this.missionActive = false;
  }

  /**
   * Handle PR rejection.
   */
  private async handleRejection(
    prUrl: string,
    summaryParts: string[],
    reason: string
  ): Promise<void> {
    const jiraComment = `❌ Epic rejected by Tech Lead:\n\n${reason}\n\nPR: ${prUrl}\n\n*Implementation approach needs fundamental changes.*`;
    await this.ticketOps.postComment(jiraComment);

    await this.updateTaskStatus(
      "failed",
      `Epic rejected: ${summaryParts.join(", ")} - ${reason}`,
      `Rejected by Tech Lead: ${reason}`,
      prUrl
    );

    this.missionActive = false;
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

  trackWorktree(storyIndex: number, worktreePath: string): void {
    this.activeWorktrees.set(storyIndex, worktreePath);
  }

  untrackWorktree(storyIndex: number): void {
    this.activeWorktrees.delete(storyIndex);
  }

  // =============================================================================
  // Memory Capture Methods (Insights/Learning)
  // =============================================================================

  /**
   * Capture memories and extract skills from a completed task.
   * This enables WorkerMill to learn from task executions and improve over time.
   */
  private async captureTaskMemories(
    storyCompletions: Array<{ storyIndex: number; title: string; filesModified: string[] }>,
    wasSuccessful: boolean
  ): Promise<void> {
    console.log("[Epic] Capturing task memories for insights...");

    const outcome = wasSuccessful ? "success" : "failure";
    const allFilesModified = storyCompletions.flatMap((s) => s.filesModified || []);
    const taskDescription = this.config.taskSummary || this.config.jiraIssueKey || "Unknown task";

    try {
      // 1. Create episodic memory for the overall task
      const episodicResult = await this.memoryClient.createEpisodicMemory({
        repository: this.config.targetRepo || "unknown",
        eventType: wasSuccessful ? "task_completed" : "task_failed",
        summary: `${wasSuccessful ? "Completed" : "Failed"}: ${taskDescription} (${storyCompletions.length} stories, ${allFilesModified.length} files)`,
        details: {
          filesAffected: allFilesModified.slice(0, 50), // Limit to 50 files
          retryCount: this.revisionCount,
        },
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

      // 2. Record skill usage outcomes if skills were injected
      if (this.memoryContext && this.memoryContext.skills.length > 0) {
        console.log(`[Epic] Recording outcome for ${this.memoryContext.skills.length} injected skills`);
        await this.memoryClient.recordInjectedSkillsUsage(
          this.memoryContext.skills,
          wasSuccessful ? "success" : "failure",
          this.config.parentTaskId
        );
      }

      // 3. Create skills from worker-reported learnings (replaces template-based extraction)
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
        // Fallback to template extraction if no learnings reported
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
      // Non-fatal - log and continue
      console.warn("[Epic] Memory capture failed (non-fatal):", error instanceof Error ? error.message : error);
    }
  }

  /**
   * Sleep helper.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check if an error is a transient/retryable error (5xx, network timeout, etc.).
   * These should be retried rather than killing the epic.
   */
  private isTransientError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;

    // Axios errors with 5xx status codes
    const axiosErr = error as { response?: { status?: number }; code?: string };
    if (axiosErr.response?.status && axiosErr.response.status >= 500) {
      return true;
    }

    // Network errors (ECONNRESET, ETIMEDOUT, ECONNREFUSED, etc.)
    if (axiosErr.code && ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EPIPE", "ERR_SOCKET_CONNECTION_TIMEOUT"].includes(axiosErr.code)) {
      return true;
    }

    // Check error message for common transient patterns
    const msg = error instanceof Error ? error.message : String(error);
    if (/status code (502|503|504)|socket hang up|ECONNRESET|ETIMEDOUT|network error/i.test(msg)) {
      return true;
    }

    return false;
  }

  /**
   * Extract PR number from a PR URL.
   * Supports multiple SCM providers:
   * - GitHub: https://github.com/owner/repo/pull/123
   * - GitLab: https://gitlab.com/owner/repo/-/merge_requests/123
   * - Bitbucket: https://bitbucket.org/workspace/repo/pull-requests/123
   */
  private extractPrNumber(prUrl: string): number | undefined {
    // GitHub: /pull/123
    const githubMatch = prUrl.match(/\/pull\/(\d+)/);
    if (githubMatch) {
      return parseInt(githubMatch[1], 10);
    }

    // Bitbucket: /pull-requests/123
    const bitbucketMatch = prUrl.match(/\/pull-requests\/(\d+)/);
    if (bitbucketMatch) {
      return parseInt(bitbucketMatch[1], 10);
    }

    // GitLab: /-/merge_requests/123
    const gitlabMatch = prUrl.match(/\/-\/merge_requests\/(\d+)/);
    if (gitlabMatch) {
      return parseInt(gitlabMatch[1], 10);
    }

    return undefined;
  }

  /**
   * Post a log message to the dashboard for real-time visibility.
   * Non-fatal — failures are silently ignored.
   */
  private postDashboardLog(message: string): void {
    axios.post(
      `${this.config.apiBaseUrl}/api/control-center/logs`,
      {
        taskId: this.config.parentTaskId,
        message,
        logType: "system",
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.orgApiKey,
        },
        timeout: 5000,
      }
    ).catch(() => {
      // Non-fatal — dashboard log post failure should not affect execution
    });
  }

  /**
   * Post a non-terminal progress update to the WorkerMill API.
   * Uses /api/tasks/:id/worker-progress for mid-task status transitions
   * (e.g. PR created, review started) without triggering terminal logic.
   */
  private async postProgressUpdate(
    status: "review_requested" | "reviewing" | "consolidating" | "deploying" | "integration_check",
    prUrl?: string,
    prNumber?: number,
    revisionCount?: number
  ): Promise<void> {
    try {
      const apiUrl = `${this.config.apiBaseUrl}/api/tasks/${this.config.parentTaskId}/worker-progress`;
      await axios.post(
        apiUrl,
        { status, prUrl, prNumber, revisionCount },
        {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.config.orgApiKey,
          },
          timeout: 5000,
        }
      );
      console.log(`[Epic] Progress update: ${status}${prUrl ? ` (${prUrl})` : ""}`);
    } catch (err) {
      // Non-fatal — don't crash the container for a progress update
      console.warn("[Epic] Failed to post progress update:", err instanceof Error ? err.message : err);
    }
  }

  /**
   * Update the parent task status in the WorkerMill API.
   * This signals to the orchestrator the Epic execution state.
   * Uses the /api/tasks/:id/worker-complete endpoint that workers normally call.
   *
   * Status flow based on workflow flags:
   * - PR created + reviewEnabled: "pr_approved" → Tech Lead approved, ready for human merge
   * - PR created + no reviewEnabled: "review_requested" → waiting for human approval (triggers deploy on PR approval)
   * - No changes needed: "completed" → stories analyzed but no code changes required
   * - No PR (failed): "failed"
   */
  private async updateTaskStatus(
    status: "pr_approved" | "failed" | "review_requested" | "deployed" | "quality_gate_failed" | "completed" | "escalated" | "running",
    resultSummary?: string,
    errorMessage?: string,
    prUrl?: string
  ): Promise<void> {
    const exitCode = (status === "failed" || status === "quality_gate_failed" || status === "escalated") ? 1 : 0;

    // Classify errors post-hoc before reporting completion
    // This marks all but the last error as "recoverable" for better UX
    try {
      const classifyUrl = `${this.config.apiBaseUrl}/api/control-center/logs/${this.config.parentTaskId}/classify-errors`;
      await axios.post(
        classifyUrl,
        { exitCode },
        {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.config.orgApiKey,
          },
          timeout: 5000,
        }
      );
      console.log(`[Epic] Classified error logs (exitCode: ${exitCode})`);
    } catch (err) {
      // Non-fatal - log but continue
      console.warn("[Epic] Failed to classify errors:", err instanceof Error ? err.message : err);
    }

    try {
      const apiUrl = `${this.config.apiBaseUrl}/api/tasks/${this.config.parentTaskId}/worker-complete`;

      // Extract PR number from URL for orchestrator manager review detection
      const prNumber = prUrl ? this.extractPrNumber(prUrl) : undefined;

      await axios.post(
        apiUrl,
        {
          exitCode,
          result: status,
          errorMessage: errorMessage,
          prUrl: prUrl,
          prNumber: prNumber,
          revisionCount: this.revisionCount,  // Report inline review revision count
        },
        {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.config.orgApiKey,
          },
          timeout: 10000,
        }
      );

      console.log(`[Epic] Task status updated to: ${status}${resultSummary ? ` - ${resultSummary}` : ""}${prNumber ? ` (PR #${prNumber})` : ""}`);

      // CRITICAL: Output ::result:: marker for ECS monitor
      // This prevents race condition where ECS monitor sets "completed" before API call finishes
      // The marker MUST be output AFTER the API call succeeds to ensure consistency
      console.log(`::result::${status}`);

      // Also post ::result:: to worker_task_logs so ECS monitor can find it
      // (console.log only goes to CloudWatch, not the DB logs table)
      await this.postLog(`::result::${status}`, "system");
      if (prUrl) {
        console.log(`::pr_url::${prUrl}`);
      }
    } catch (err) {
      console.error("[Epic] Failed to update task status:", err instanceof Error ? err.message : err);
      // Don't throw - status update failure shouldn't crash the container
    }
  }
}
