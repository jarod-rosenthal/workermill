/**
 * Epic Coordinator
 *
 * Main coordination loop for multi-agent collaboration.
 * Manages expert state, claims stories, routes questions, and coordinates execution.
 * Includes inline Tech Lead review with revision loop and DevOps deployment.
 */

import axios from "axios";
import type {
  ExpertPersona,
  ExpertState,
  ReadyStory,
  EpicConfig,
  ContextMessage,
  ResilienceConfig,
  EpicValidationResult,
} from "./types.js";
import { getAvailableExperts, findExpertForQuestion, matchPersonaToExpert } from "./experts.js";
import { CoordinationClient } from "./coordination-client.js";
import { StoryExecutor } from "./executor.js";
import { GitOps } from "./git-ops.js";
import { BlockerManager } from "./blocker-manager.js";
import { JiraOps } from "./jira-ops.js";
import { InlineReviewer, type InlineReviewResult } from "./inline-reviewer.js";
import { InlineDeployer } from "./inline-deployer.js";
import { InlineImprover } from "./inline-improver.js";
import { createMemoryClient, type MemoryClient, type MemoryContext, type EnhancedContext } from "./memory-client.js";
import { spawn, execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync, readdirSync, readFileSync } from "fs";
import { runAgent } from "./agent-sdk.js";
import { runQualityVerification, postQualityMetrics, type QualityMetrics } from "./quality-runner.js";
import {
  evaluateQualityGate,
  formatQualityGateResult,
  type QualityGateResult,
  type QualityThresholds,
  DEFAULT_THRESHOLDS,
} from "./quality-gate.js";

// =============================================================================
// WORKERMILL.md Management Utilities
// =============================================================================

/**
 * Check if WORKERMILL.md exists in the repository.
 */
function hasWorkermillMd(repoPath: string): boolean {
  return existsSync(`${repoPath}/WORKERMILL.md`);
}

/**
 * Read existing WORKERMILL.md content.
 */
function readWorkermillMd(repoPath: string): string | null {
  const path = `${repoPath}/WORKERMILL.md`;
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

/**
 * Detect if repository is greenfield (new/empty) or existing codebase.
 * Greenfield repos have minimal structure - no source directories or package manifests.
 */
function isGreenfield(repoPath: string): boolean {
  // Check for common source directories
  const sourceDirs = ["src", "lib", "app", "pkg", "cmd", "internal"];
  for (const dir of sourceDirs) {
    if (existsSync(`${repoPath}/${dir}`)) {
      return false;
    }
  }

  // Check for package manifests (indicates existing project)
  const manifests = [
    "package.json",
    "go.mod",
    "pyproject.toml",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "requirements.txt",
    "Gemfile",
    "composer.json",
  ];
  for (const manifest of manifests) {
    if (existsSync(`${repoPath}/${manifest}`)) {
      return false;
    }
  }

  // Count source files in root (shallow check)
  try {
    const files = readdirSync(repoPath);
    const sourceExtensions = [".ts", ".js", ".py", ".go", ".java", ".rs", ".rb", ".php"];
    const sourceFiles = files.filter((f) =>
      sourceExtensions.some((ext) => f.endsWith(ext))
    );
    // If more than 3 source files in root, not greenfield
    if (sourceFiles.length > 3) {
      return false;
    }
  } catch {
    // If we can't read directory, assume not greenfield
    return false;
  }

  return true;
}

/**
 * Build prompt for creating WORKERMILL.md (for existing codebases).
 */
function buildCreateWorkermillMdPrompt(repoPath: string): string {
  return `# Task: Create WORKERMILL.md

You are analyzing this repository to create a WORKERMILL.md file that will help WorkerMill AI agents understand and work with this codebase effectively.

## Instructions

1. **Explore the codebase** - Look at the project structure, key files, and patterns
2. **Create WORKERMILL.md** in the repository root with:
   - Project overview (what it does, tech stack)
   - Quick reference table for common commands (install, test, build, run)
   - Architecture overview (main components, how they interact)
   - Key directories and their purposes
   - Important patterns, conventions, or gotchas
   - Environment setup requirements

## Template

\`\`\`markdown
# Project Name

Brief description of what this project does.

## Tech Stack
- Language: X
- Framework: Y
- Database: Z

## Quick Reference

| Task | Command |
|------|---------|
| Install | \`npm install\` |
| Dev | \`npm run dev\` |
| Test | \`npm test\` |
| Build | \`npm run build\` |

## Architecture

Describe the main components and how they interact.

## Key Directories

- \`src/\` - Main source code
- \`tests/\` - Test files
- etc.

## Important Patterns

Note any conventions, patterns, or gotchas.

## Environment Setup

Required environment variables and setup steps.
\`\`\`

## Repository Path
${repoPath}

**Create the WORKERMILL.md file now. Commit it with message: "chore: Add WORKERMILL.md for AI agent context"**`;
}

/**
 * Build prompt for updating WORKERMILL.md after task completion.
 */
function buildUpdateWorkermillMdPrompt(
  repoPath: string,
  existingContent: string | null,
  storyCompletions: Array<{ storyIndex: number; title: string; filesModified: string[] }>
): string {
  const changesSection = storyCompletions
    .map((s) => `- Story ${s.storyIndex}: ${s.title}\n  Files: ${s.filesModified.join(", ") || "(none)"}`)
    .join("\n");

  if (existingContent) {
    return `# Task: Update WORKERMILL.md

The following changes were made to the codebase in this task. Update WORKERMILL.md to reflect any new patterns, files, or important information.

## Changes Made
${changesSection}

## Current WORKERMILL.md Content
\`\`\`markdown
${existingContent}
\`\`\`

## Instructions
1. Review the changes made
2. Update WORKERMILL.md if the changes introduce:
   - New directories or key files
   - New patterns or conventions
   - New commands or workflows
   - Changes to architecture
3. Keep the document concise and useful
4. If no updates are needed (minor changes), just respond "No updates needed"
5. If updates needed, edit the file and commit with message: "chore: Update WORKERMILL.md"

## Repository Path
${repoPath}`;
  } else {
    // Greenfield - create new WORKERMILL.md documenting what was built
    return `# Task: Create WORKERMILL.md

You just built a new project. Create WORKERMILL.md to document what was implemented.

## What Was Built
${changesSection}

## Instructions
1. Create WORKERMILL.md documenting:
   - Project overview (what it does)
   - Tech stack used
   - How to run/test/build
   - Key files and their purposes
   - Any patterns or conventions established
2. Commit with message: "chore: Add WORKERMILL.md for AI agent context"

## Repository Path
${repoPath}`;
  }
}

/**
 * Epic coordinator managing multi-agent collaboration.
 */
export class EpicCoordinator {
  private config: EpicConfig;
  private coordination: CoordinationClient;
  private executor: StoryExecutor;
  private gitOps: GitOps;
  private jiraOps: JiraOps;
  private expertStates: Map<ExpertPersona, ExpertState>;
  private missionActive: boolean = false;
  private pollIntervalMs: number = 5000;

  // Inline review and deployment tracking
  private revisionCount: number = 0;
  private maxRevisions: number = parseInt(process.env.MAX_REVIEW_REVISIONS || "3", 10);
  private currentPrUrl: string | undefined;
  private currentPrNumber: number | undefined;
  private lastReviewFeedback: string | undefined;
  private revisionStoriesQueued: ReadyStory[] = [];  // Stories queued for revision re-execution
  private deploymentSucceeded: boolean = false;  // Track if deployment completed successfully
  private totalStories: number = 0;  // Total stories in the Epic (for lazy coordination loading)

  // Memory system (REQ-19) with Codebase RAG
  private memoryClient: MemoryClient;
  private memoryContext: MemoryContext | null = null;
  private enhancedContext: EnhancedContext | null = null;

  // User feedback from Talk to Worker (command polling)
  private userFeedback: string | null = null;

  // Resilience: Track completed stories for resume after restart
  private completedStoryIndices: Set<number> = new Set();
  // Resilience: Track blocked stories due to dependency failures
  private blockedStoryIndices: Set<number> = new Set();
  // Resilience: Track failed stories (for auto-retry)
  private failedStoryIndices: Set<number> = new Set();
  // Resilience configuration
  private resilience: ResilienceConfig;
  // Active worktrees for graceful shutdown
  private activeWorktrees: Map<number, string> = new Map();
  // Blocker manager for handling escalated errors
  private blockerManager: BlockerManager | null = null;
  // Mutex groups: Track running stories and their mutex groups to prevent conflicts
  private runningStoryMutexGroups: Map<number, string[]> = new Map();

  constructor(config: EpicConfig, resilience?: ResilienceConfig) {
    this.config = config;
    this.coordination = new CoordinationClient(config);

    // Determine workspace directory based on execution mode
    // REPO_PATH is set by epic-entrypoint.sh after cloning - use parent directory as workDir
    const repoPath = process.env.REPO_PATH;
    let workDir: string;

    if (repoPath) {
      // Repo already cloned by entrypoint - use its parent as workDir
      workDir = repoPath.replace(/\/repo$/, "") || "/workspace";
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
    });
    // Default resilience settings if not provided
    this.resilience = resilience || {
      blockerMaxAutoRetries: 3,
      blockerAutoRetryEnabled: true,
      pushAfterCommit: true,
      gracefulShutdownEnabled: true,
    };
    this.executor = new StoryExecutor(config, this.coordination, this.gitOps, this.resilience);
    this.jiraOps = new JiraOps(config.jiraIssueKey);
    this.expertStates = new Map();

    // Initialize blocker manager for resilience
    this.blockerManager = new BlockerManager(
      this.coordination,
      config.parentTaskId,
      this.resilience
    );

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
    } catch (error) {
      console.warn("[Epic] Failed to check for existing completions:", error instanceof Error ? error.message : error);
      // Non-fatal - continue without resume
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
   * Start the Epic coordination loop.
   */
  async start(): Promise<void> {
    console.log("[Epic] Starting Epic executor for task " + this.config.parentTaskId);
    this.missionActive = true;

    try {
      // Clone the repository
      await this.gitOps.cloneIfNeeded();

      // Initialize resume: check for existing completions from previous run
      await this.initializeWithResume();

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
          await this.jiraOps.postComment(
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

      // Retrieve memory context for the task (REQ-19)
      await this.retrieveMemoryContext();

      // Fetch Jira requirements for tech_lead review
      await this.fetchJiraRequirements();

      // Create WORKERMILL.md for existing codebases (pre-story phase)
      await this.ensureWorkermillMd();

      // Transition Jira to "In Progress"
      await this.jiraOps.transitionTo("In Progress");

      // Main coordination loop
      while (this.missionActive) {
        await this.coordinationLoop();
        await this.sleep(this.pollIntervalMs);
      }
    } catch (error) {
      console.error("[Epic] Fatal error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Post failure comment to Jira
      await this.jiraOps.postComment(`Epic failed: ${errorMessage}`);

      await this.updateTaskStatus("failed", undefined, `Epic failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Stop the Epic executor.
   */
  stop(): void {
    console.log("[Epic] Stopping Epic executor");
    this.missionActive = false;
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
          // Get branch name for this story
          const branchName = `story/${(this.config.jiraIssueKey || "epic").toLowerCase()}-s${storyIndex}`;

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
   * Track an active worktree for graceful shutdown.
   */
  trackWorktree(storyIndex: number, worktreePath: string): void {
    this.activeWorktrees.set(storyIndex, worktreePath);
  }

  /**
   * Untrack a worktree after story completion.
   */
  untrackWorktree(storyIndex: number): void {
    this.activeWorktrees.delete(storyIndex);
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
          console.log("[Epic] Paused - waiting for resume...");
          await this.waitForResume();
        } else if (cmd.type === "message" || cmd.type === "resume") {
          // Store message as user feedback for next expert
          if (cmd.content) {
            this.userFeedback = cmd.content;
            console.log(`[Epic] User feedback received: ${cmd.content}`);

            // Post acknowledgment to coordination feed so user knows we received it
            await this.coordination.postContext(
              "worker_ack",
              `✅ Worker received message: "${cmd.content.substring(0, 100)}${cmd.content.length > 100 ? "..." : ""}"`,
              "coordinator",
              undefined,
              {
                commandId: cmd.id,
                commandType: cmd.type,
                feedbackWillBeAppliedTo: "next_story",
              }
            );
          }
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
              `✅ Worker received message: "${resumeCmd.content.substring(0, 100)}${resumeCmd.content.length > 100 ? "..." : ""}"`,
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
              `✅ Worker received message: "${cmd.content.substring(0, 100)}${cmd.content.length > 100 ? "..." : ""}"`,
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
    // 0. Check for dashboard commands (pause/resume/message)
    await this.pollForCommands();

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

    // 4. Check for completed stories and update states
    await this.checkCompletions();

    // 5. Check if mission is complete
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
      `Story ${blocker.storyIndex} blocked: ${blocker.errorCategory}`,
      blocker.errorMessage
    );

    // Wait for human resolution (timeout after 1 hour)
    console.log(`[Epic] Waiting for human resolution (retry/skip/abort)...`);
    const response = await this.blockerManager.waitForBlockerResponse(blocker, 3600000);

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
        // Clear the blocker and retry the story
        this.failedStoryIndices.delete(blocker.storyIndex);
        // If guidance was provided, it will be passed to the story on re-execution
        if (response.guidance) {
          this.userFeedback = response.guidance;
          console.log(`[Epic] Retry guidance: ${response.guidance}`);
        }
        // Unblock dependent stories
        for (const depIndex of blocker.dependentStories) {
          this.blockedStoryIndices.delete(depIndex);
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
   * Register a story as running with its mutex groups.
   * Called when a story is claimed and starts execution.
   */
  private registerRunningStory(storyIndex: number, mutexGroups: string[]): void {
    this.runningStoryMutexGroups.set(storyIndex, mutexGroups);
    if (mutexGroups.length > 0) {
      console.log(`[Epic] Registered story ${storyIndex} with mutex groups: ${mutexGroups.join(", ")}`);
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

    for (const expertPersona of idleExperts) {
      // Check for pending questions targeting this expert
      const pendingQuestions = await this.coordination.getQuestionsForPersona(expertPersona);

      if (pendingQuestions.length === 0) continue;

      console.log(`[Epic] ${expertPersona} has ${pendingQuestions.length} pending question(s) to answer first`);

      // Mark expert as working (answering questions)
      this.expertStates.set(expertPersona, {
        persona: expertPersona,
        status: "working",
      });

      // Answer each question before taking a story
      for (const question of pendingQuestions) {
        console.log(`[Epic] ${expertPersona} answering question from ${question.fromPersona}`);

        try {
          await this.executor.answerQuestion(
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
            expertPersona
          );
        } catch (error) {
          console.error(`[Epic] ${expertPersona} failed to answer question:`, error);
        }
      }

      // Mark expert as idle again after answering
      this.expertStates.set(expertPersona, {
        persona: expertPersona,
        status: "idle",
      });
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
      const claimResult = await this.coordination.claimStory(story.id, expertPersona);
      if (!claimResult.success) {
        // Don't log "already claimed" every poll cycle - too noisy
        continue;
      }

      console.log("[Epic] " + expertPersona + " claimed story " + story.storyIndex);

      // Register story for mutex tracking
      this.registerRunningStory(story.storyIndex, story.mutexGroups || []);

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
      }

      // Execute story (async, don't await)
      this.executeStoryAsync(story, expertPersona, this.totalStories, feedback || undefined);
    }
  }

  /**
   * Process revision stories directly (bypass claim system).
   * These are stories that need re-execution after a Tech Lead revision request.
   * Enforces story dependencies - stories only run when dependencies are complete.
   */
  private async processRevisionStories(): Promise<void> {
    console.log(`[Epic] Processing ${this.revisionStoriesQueued.length} revision stories...`);

    // Update completed stories from coordination feed
    const completions = await this.coordination.getCurrentRevisionCompletions();
    for (const c of completions) {
      const storyIndex = c.metadata?.storyIndex as number;
      if (storyIndex !== undefined) {
        this.completedStoryIndices.add(storyIndex);
      }
    }

    const storiesToProcess = [...this.revisionStoriesQueued];
    this.revisionStoriesQueued = [];  // Clear queue

    for (const story of storiesToProcess) {
      // Check if story's dependencies are all completed
      if (story.dependencies && story.dependencies.length > 0) {
        const unmetDeps = story.dependencies.filter(
          (depIndex) => !this.completedStoryIndices.has(depIndex)
        );
        if (unmetDeps.length > 0) {
          console.log(
            `[Epic] Revision story ${story.storyIndex} blocked - waiting for dependencies: ${unmetDeps.join(", ")}`
          );
          // Re-queue if dependencies not met
          this.revisionStoriesQueued.push(story);
          continue;
        }
      }

      // Check for mutex conflicts with running stories
      if (this.hasMutexConflict(story)) {
        // Re-queue if mutex conflict
        this.revisionStoriesQueued.push(story);
        continue;
      }

      // Find matching expert
      const expertPersona = matchPersonaToExpert(story.persona);
      if (!expertPersona) {
        console.log("[Epic] No expert match for revision story persona: " + story.persona);
        continue;
      }

      // Check if expert is available
      const expertState = this.expertStates.get(expertPersona);
      if (!expertState || expertState.status !== "idle") {
        // Re-queue if expert is busy
        this.revisionStoriesQueued.push(story);
        continue;
      }

      console.log(`[Epic] ${expertPersona} executing revision for story ${story.storyIndex}`);

      // Register story for mutex tracking
      this.registerRunningStory(story.storyIndex, story.mutexGroups || []);

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
      }

      // Execute story (async, don't await)
      this.executeStoryAsync(story, expertPersona, this.totalStories, revisionFeedback || undefined);
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

      // Unregister from mutex tracking now that execution is complete
      this.unregisterRunningStory(story.storyIndex);

      if (result.success) {
        // Update expert state to completed
        this.expertStates.set(expert, {
          persona: expert,
          status: "completed",
          currentStoryId: story.id,
          currentStoryIndex: story.storyIndex,
        });

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
    if (this.blockerManager.shouldAutoRetry(story.storyIndex, errorMessage)) {
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
   * Prioritizes explicit targetPersona from question metadata (Task 5: targeted routing).
   */
  private async processQuestions(): Promise<void> {
    const questions = await this.coordination.getUnansweredQuestions();

    for (const question of questions) {
      // First, check for explicit target in metadata (from Q-SECURITY-001 patterns)
      let targetPersona: ExpertPersona | null = null;

      if (question.metadata?.targetPersona) {
        // Use explicit target from question metadata
        targetPersona = question.metadata.targetPersona as ExpertPersona;
      } else {
        // Fall back to content-based routing
        targetPersona = findExpertForQuestion(
          question.content,
          question.fromPersona
        );
      }

      if (!targetPersona) {
        continue;
      }

      // Check if expert is idle
      const expertState = this.expertStates.get(targetPersona);
      if (!expertState || expertState.status !== "idle") {
        continue;
      }

      console.log("[Epic] Routing question from " + question.fromPersona + " to " + targetPersona);

      // Have the expert answer
      await this.executor.answerQuestion(
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
        targetPersona
      );
    }
  }

  /**
   * Check for story completions and update mission status.
   * Note: Completion count is logged only when mission completes to reduce noise.
   */
  private async checkCompletions(): Promise<void> {
    // Completions are tracked in checkMissionComplete - no need to log here every cycle
  }

  /**
   * Check if the mission is complete (all stories done).
   * If reviewEnabled, runs inline Tech Lead review with revision loop.
   */
  private async checkMissionComplete(): Promise<void> {
    const contexts = await this.coordination.getAllContexts();

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
    // Filter out: stories already completed OR stories with no matching expert
    const readyToClaim = readyStories.filter((ready) => {
      const storyIndex = (ready.metadata?.storyIndex as number) || 0;
      const storyPersona = (ready.metadata?.persona as string) || "";

      // Skip if already completed
      const isCompleted = completions.some(
        (c) => (c.metadata?.storyIndex as number) === storyIndex
      );
      if (isCompleted) return false;

      // Skip if no expert can handle this persona
      const hasMatchingExpert = matchPersonaToExpert(storyPersona) !== null;
      if (!hasMatchingExpert) {
        // Log once per unmatched story
        console.log(`[Epic] Skipping story ${storyIndex} - no expert for persona: ${storyPersona}`);
        return false;
      }

      return true;
    });

    if (allIdle && readyToClaim.length === 0 && completions.length > 0) {
      console.log("[Epic] All stories finished. Processing completion...");

      // Extract story completion details for PR description
      const storyCompletions = completions.map((c) => ({
        storyIndex: (c.metadata?.storyIndex as number) || 0,
        title: (c.metadata?.title as string) || c.content,
        filesModified: (c.metadata?.filesModified as string[]) || [],
      }));

      const summaryParts = storyCompletions.map((s) => `S${s.storyIndex}`);

      // Run quality verification before creating PR
      console.log("[Epic] Running quality verification...");
      let capturedQualityMetrics: QualityMetrics | undefined;
      let qualityGateResult: QualityGateResult | undefined;
      try {
        const repoPath = this.gitOps.getRepoPath();
        capturedQualityMetrics = await runQualityVerification(repoPath);

        // Post metrics to API
        await postQualityMetrics(
          this.config.apiBaseUrl,
          this.config.orgApiKey,
          this.config.parentTaskId,
          capturedQualityMetrics
        );
        console.log(`[Epic] Quality metrics posted: score=${capturedQualityMetrics.qualityScore}/100`);

        // Evaluate quality gate
        const thresholds: QualityThresholds = this.config.qualityThresholds || DEFAULT_THRESHOLDS;
        const bypassReason = this.config.qualityGateBypass ? "bypass-quality-gate label set" : undefined;
        qualityGateResult = evaluateQualityGate(
          capturedQualityMetrics,
          thresholds,
          this.config.qualityGateBypass || false,
          bypassReason
        );

        // Log quality gate result
        console.log(formatQualityGateResult(qualityGateResult));

        // If quality gate failed and not bypassed, block PR creation
        if (!qualityGateResult.passed && !qualityGateResult.bypassed) {
          console.log("[Epic] Quality gate failed - blocking PR creation");
          await this.jiraOps.postComment(
            `❌ Quality gate failed - PR not created.\n\n**Issues:**\n${qualityGateResult.failureReasons.map(r => `- ${r}`).join("\n")}\n\n*Fix the issues and re-run, or add the \`bypass-quality-gate\` label to skip.*`
          );

          await this.updateTaskStatus(
            "quality_gate_failed",
            `Quality gate failed: ${qualityGateResult.failureReasons.join(", ")}`,
            `Quality gate blocked PR creation: ${qualityGateResult.summary}`
          );

          this.missionActive = false;
          return;
        }
      } catch (qualityError) {
        console.warn("[Epic] Quality verification failed (non-fatal):", qualityError);
        // Don't block PR creation on quality verification errors
      }

      // EPIC VALIDATION: Verify all plan items addressed before PR
      const epicValidation = await this.validateEpicCompletion(
        storyCompletions,
        this.totalStories
      );

      if (!epicValidation.valid) {
        // Missing stories is a blocker - don't create PR
        console.log("[Epic] Epic validation failed - stories missing");
        await this.jiraOps.postComment(
          `⚠️ Epic validation failed - not all stories completed.\n\n` +
          `**Missing:**\n${epicValidation.missing.map(m => `- ${m}`).join("\n")}\n\n` +
          `*${epicValidation.storiesCompleted}/${epicValidation.storiesTotal} stories completed. Check coordination feed for blockers.*`
        );

        await this.updateTaskStatus(
          "failed",
          `Epic incomplete: ${epicValidation.missing.length} stories missing`,
          `Validation failed: ${epicValidation.missing.join(", ")}`
        );

        this.missionActive = false;
        return;
      }

      // Log warnings but don't block
      if (epicValidation.unaddressedRequirements.length > 0) {
        console.log(`[Epic] Proceeding with ${epicValidation.unaddressedRequirements.length} validation warnings`);
        await this.jiraOps.postComment(
          `⚠️ Epic validation warnings (non-blocking):\n\n` +
          epicValidation.unaddressedRequirements.slice(0, 5).map(r => `- ${r}`).join("\n") +
          (epicValidation.unaddressedRequirements.length > 5 ? `\n... and ${epicValidation.unaddressedRequirements.length - 5} more` : "")
        );
      }

      // Update or create WORKERMILL.md documenting changes (post-story phase)
      await this.updateWorkermillMd(storyCompletions);

      // Create consolidated PR with all story branches
      let prUrl: string | undefined;
      let prNumber: number | undefined;
      let prCreationAttempted = false;
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
        prCreationAttempted = true;
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
        // Prepare quality metrics for PR body
        const prQualityMetrics = capturedQualityMetrics ? {
          qualityScore: capturedQualityMetrics.qualityScore,
          qualityGrade: capturedQualityMetrics.qualityScore >= 90 ? 'A' :
                        capturedQualityMetrics.qualityScore >= 80 ? 'B' :
                        capturedQualityMetrics.qualityScore >= 70 ? 'C' :
                        capturedQualityMetrics.qualityScore >= 60 ? 'D' : 'F',
          lintErrors: capturedQualityMetrics.lintErrors,
          lintWarnings: capturedQualityMetrics.lintWarnings,
          typeErrors: capturedQualityMetrics.typeErrors,
          testsPassed: capturedQualityMetrics.testsPassed,
          testsFailed: capturedQualityMetrics.testsFailed,
          securityHigh: capturedQualityMetrics.securityHigh,
          securityMedium: capturedQualityMetrics.securityMedium,
          securityLow: capturedQualityMetrics.securityLow,
        } : undefined;

        prUrl = await this.gitOps.createConsolidatedPR(
          this.config.jiraIssueKey,
          epicTitle,
          storyCompletions,
          prQualityMetrics
        );
        if (prUrl) {
          console.log(`[Epic] Consolidated PR created: ${prUrl}`);
          prNumber = this.extractPrNumber(prUrl);
          this.currentPrUrl = prUrl;
          this.currentPrNumber = prNumber;
        } else {
          console.error("[Epic] Failed to create consolidated PR");
        }
      }

      // If PR created and review enabled, run inline Tech Lead review
      if (prUrl && prNumber && this.config.reviewEnabled) {
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
      let taskStatus: "deployed" | "review_requested" | "pr_approved" | "failed" | "completed";
      let jiraComment: string;
      let errorMessage: string | undefined;

      if (this.deploymentSucceeded) {
        // Deployment completed successfully - Jira comment already posted by deployer
        taskStatus = "deployed";
        jiraComment = ""; // Already posted by runInlineDeployment
      } else if (prUrl) {
        if (this.config.reviewEnabled) {
          // Review was approved by inline Tech Lead - PR ready for human merge (NOT deployed)
          taskStatus = "pr_approved";
          jiraComment = `Epic stories completed and approved by Tech Lead: ${completions.length} stories implemented (${summaryParts.join(", ")})\n\nPR: ${prUrl}\n\n*Ready for merge.*`;
        } else {
          // No review label: PR created, waiting for human approval
          // Use review_requested so GitHub webhook approval triggers deployment
          taskStatus = "review_requested";
          jiraComment = `Epic stories completed: ${completions.length} stories implemented (${summaryParts.join(", ")})\n\nPR: ${prUrl}\n\n*Ready for review and merge.*`;
        }
      } else if (noChangesNeeded) {
        // Stories completed but determined no code changes were required
        // This is a valid success case - feature may already be implemented or requirements already met
        taskStatus = "completed";
        jiraComment = `Epic analysis completed: ${completions.length} stories analyzed (${summaryParts.join(", ")})\n\n*No code changes were required - the feature may already be implemented or the requirements are already met in the current codebase.*`;
      } else if (prCreationAttempted) {
        // PR creation was attempted but failed - this is a failure, not success
        taskStatus = "failed";
        errorMessage = "PR creation failed after stories completed";
        jiraComment = `Epic stories completed but PR creation failed: ${completions.length} stories implemented (${summaryParts.join(", ")})\n\n*PR could not be created. Please check the worker logs and retry.*`;
      } else {
        // No Jira key, so no PR was attempted - unusual case
        taskStatus = "failed";
        errorMessage = "No Jira key provided, cannot create PR";
        jiraComment = `Epic completed without PR: ${completions.length} stories implemented (${summaryParts.join(", ")})\n\n*No Jira key was provided, so no PR was created.*`;
      }

      // Post comment to Jira (skip if already posted by deployer)
      if (jiraComment) {
        await this.jiraOps.postComment(jiraComment);
      }

      // Build result summary based on status
      let resultSummary: string;
      if (prUrl) {
        resultSummary = `Epic ${taskStatus}: ${summaryParts.join(", ")} (${completions.length} stories) - PR: ${prUrl}`;
      } else if (taskStatus === "failed") {
        resultSummary = `Epic failed: ${summaryParts.join(", ")} (${completions.length} stories) - PR creation failed`;
      } else if (noChangesNeeded) {
        resultSummary = `Epic completed: ${summaryParts.join(", ")} (${completions.length} stories) - No code changes required`;
      } else {
        resultSummary = `Epic: ${summaryParts.join(", ")} (${completions.length} stories)`;
      }

      await this.updateTaskStatus(
        taskStatus,
        resultSummary,
        errorMessage,  // pass error message for failures
        prUrl          // pass prUrl to be saved on task (may be undefined for failures)
      );

      // Always transition Jira to Done - task is complete regardless of review status
      await this.jiraOps.transitionTo("Done");

      console.log(`[Epic] Mission complete with status: ${taskStatus}`);

      // Run inline improvement analysis if enabled
      // This analyzes task logs and may auto-apply fixes to WorkerMill
      if (this.config.improvementEnabled) {
        console.log("[Epic] Running inline improvement analysis...");
        try {
          const improver = new InlineImprover(this.config);
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

    // Check manager provider to decide which reviewer to use
    // Agent SDK (InlineReviewer) only works with Anthropic
    // AI SDK executor works with all providers
    const managerProvider = process.env.MANAGER_PROVIDER || "anthropic";
    const managerModel = process.env.MANAGER_MODEL || "";
    console.log(`[Epic] Manager provider: ${managerProvider}, model: ${managerModel}`);

    let reviewResult: InlineReviewResult;

    if (managerProvider === "anthropic") {
      // Use Agent SDK reviewer for Anthropic
      const reviewer = new InlineReviewer(this.config, this.gitOps.getRepoPath());
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
      // Treat review failure as needing human intervention
      await this.handleEscalation(prUrl, summaryParts, `Review failed: ${reviewResult.error}`);
      return "done";
    }

    console.log(`[Epic] Review decision: ${reviewResult.decision}, score: ${reviewResult.codeQualityScore}`);

    switch (reviewResult.decision) {
      case "approved":
        console.log("[Epic] PR approved by Tech Lead!");
        await this.jiraOps.postComment(
          `✅ PR approved by Tech Lead (score: ${reviewResult.codeQualityScore}/10)\n\n${reviewResult.feedback}`
        );

        // If deployment enabled, trigger DevOps Engineer to merge and deploy
        if (this.config.deploymentEnabled) {
          const deployResult = await this.runInlineDeployment(prUrl, prNumber, summaryParts);
          if (!deployResult) {
            // Deployment failed - escalate for human intervention
            return "done";
          }
        }
        return "done";

      case "revision_needed":
        this.revisionCount++;
        this.lastReviewFeedback = reviewResult.feedback;

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

        await this.jiraOps.postComment(
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
        await this.handleRejection(prUrl, summaryParts, reviewResult.feedback);
        return "done";

      default:
        console.error(`[Epic] Unknown review decision: ${reviewResult.decision}`);
        await this.handleEscalation(prUrl, summaryParts, `Unknown review decision: ${reviewResult.decision}`);
        return "done";
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
            // AI SDK executor already outputs with formatted prefix [👨‍💼 tech_lead 🔵]
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

        // Parse decision from output - check for structured output marker first (AI SDK 6.0+ Output.object)
        // This is the most reliable format - guaranteed by the schema
        const structuredDecisionMatch = allOutput.match(/::review_decision::(approved|revision_needed|rejected)/i);
        const textDecisionMatch = allOutput.match(/REVIEW_DECISION:\s*(approved|revision_needed|rejected)/i);
        let decision: "approved" | "revision_needed" | "rejected";

        if (structuredDecisionMatch) {
          console.log("[Epic] Found structured output marker from AI SDK");
          decision = structuredDecisionMatch[1].toLowerCase() as "approved" | "revision_needed" | "rejected";
        } else if (textDecisionMatch) {
          decision = textDecisionMatch[1].toLowerCase() as "approved" | "revision_needed" | "rejected";
        } else {
          // Fallback: detect natural language approval patterns (LLMs don't always follow format)
          const lowerOutput = allOutput.toLowerCase();
          const approvalPatterns = [
            /\bapproving\b/,
            /\bapproved\b/,
            /\blgtm\b/,
            /\bship it\b/,
            /\bmerge this\b/,
            /\bready to merge\b/,
            /gh pr review.*--approve/,
          ];
          const rejectionPatterns = [
            /\brejecting\b/,
            /\brejected\b/,
            /\bcannot approve\b/,
            /\bdo not merge\b/,
          ];

          if (approvalPatterns.some(p => p.test(lowerOutput))) {
            console.log("[Epic] Detected natural language approval (missing REVIEW_DECISION marker)");
            decision = "approved";
          } else if (rejectionPatterns.some(p => p.test(lowerOutput))) {
            console.log("[Epic] Detected natural language rejection (missing REVIEW_DECISION marker)");
            decision = "rejected";
          } else {
            console.log("[Epic] No decision marker found, defaulting to revision_needed");
            decision = "revision_needed";
          }
        }

        // Parse feedback - check structured marker first
        const structuredFeedbackMatch = allOutput.match(/::feedback::(.+?)(?=\n|$)/i);
        const textFeedbackMatch = allOutput.match(/FEEDBACK:\s*([\s\S]*?)(?=\n\s*(?:REVIEW_DECISION:|CODE_QUALITY_SCORE:)|$)/i);
        const feedback = structuredFeedbackMatch?.[1]?.trim() || textFeedbackMatch?.[1]?.trim() || "No feedback provided";

        // Parse score - check structured marker first
        const structuredScoreMatch = allOutput.match(/::code_quality_score::(\d+)/i);
        const textScoreMatch = allOutput.match(/CODE_QUALITY_SCORE:\s*(\d+)/i);
        const codeQualityScore = structuredScoreMatch
          ? Math.min(10, Math.max(1, parseInt(structuredScoreMatch[1], 10)))
          : textScoreMatch
            ? Math.min(10, Math.max(1, parseInt(textScoreMatch[1], 10)))
            : 5;

        // Report tokens for cost tracking
        reportTokensFromOutput();

        resolve({
          success: true,
          decision,
          feedback,
          codeQualityScore,
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

    // Build quality metrics section if available
    let qualitySection = "";
    if (qualityMetrics) {
      const hasLintIssues = qualityMetrics.lintErrors > 0;
      const hasTypeErrors = qualityMetrics.typeErrors > 0;
      const hasTestFailures = qualityMetrics.testsFailed > 0;
      const hasSecurityIssues = qualityMetrics.securityHigh > 0;
      const qualityBelowThreshold = qualityMetrics.qualityScore < 70;

      qualitySection = `## Automated Quality Metrics

| Metric | Result | Status |
|--------|--------|--------|
| **Overall Score** | ${qualityMetrics.qualityScore}% | ${qualityMetrics.qualityScore >= 70 ? '✅' : '⚠️ Below 70% threshold'} |
| TypeCheck | ${qualityMetrics.typeErrors} errors | ${hasTypeErrors ? '❌ MUST FIX' : '✅'} |
| Lint | ${qualityMetrics.lintErrors} errors, ${qualityMetrics.lintWarnings} warnings | ${hasLintIssues ? '⚠️' : '✅'} |
| Tests | ${qualityMetrics.testsPassed} passed, ${qualityMetrics.testsFailed} failed | ${hasTestFailures ? '❌ MUST FIX' : '✅'} |
| Security | ${qualityMetrics.securityHigh} high, ${qualityMetrics.securityMedium} medium | ${hasSecurityIssues ? '🔴 CRITICAL' : '✅'} |

### Quality Gate Rules
${qualityBelowThreshold ? '**⚠️ QUALITY SCORE BELOW 70% - Revision required unless there is a very good reason.**\n' : ''}${hasTypeErrors ? '**❌ TYPE ERRORS DETECTED - These MUST be fixed. Request revision.**\n' : ''}${hasTestFailures ? '**❌ TEST FAILURES DETECTED - These MUST be fixed. Request revision.**\n' : ''}${hasSecurityIssues ? '**🔴 HIGH SEVERITY SECURITY ISSUES - These MUST be fixed. Request revision.**\n' : ''}
---

`;
    }

    const qualityNote = qualityMetrics ? "- **Do the automated quality metrics pass? (See above)**" : "";
    const qualityGateNote = qualityMetrics && (qualityMetrics.typeErrors > 0 || qualityMetrics.testsFailed > 0 || qualityMetrics.securityHigh > 0)
      ? "\n   **NOTE: Due to quality gate failures above, you should request REVISION_NEEDED unless already addressed.**"
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
      // GitHub: Use gh CLI
      diffInstructions = `1. **First, list the changed files to understand the scope**:
   \`\`\`bash
   gh pr diff ${prNumber} --name-only
   \`\`\`

   Then review the diff (for small PRs) or read specific files (for large PRs):
   \`\`\`bash
   gh pr diff ${prNumber}  # Full diff - use for small PRs (<10 files)
   \`\`\`
   For large PRs with many files, read individual files directly instead of loading the full diff.`;

      reviewSubmitInstructions = `4. **Submit your review to GitHub** (REQUIRED):

   **If APPROVE:**
   \`\`\`bash
   gh pr review ${prNumber} --approve --body "Your approval message"
   \`\`\`

   **If REVISION_NEEDED or REJECT:**
   \`\`\`bash
   gh pr review ${prNumber} --request-changes --body "Your detailed feedback"
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

    const deployer = new InlineDeployer(this.config, this.gitOps.getRepoPath());
    const deployResult = await deployer.deploy(prUrl, prNumber);

    if (!deployResult.success) {
      console.error("[Epic] Deployment failed:", deployResult.summary);
      await this.jiraOps.postComment(
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

    await this.jiraOps.postComment(deployMessage);

    // Transition Jira to Done
    await this.jiraOps.transitionTo("Done");

    return true;
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
      // Selective revision: compute closure of affected stories + dependents
      storiesToRevise = this.computeAffectedStoryClosure(affectedStories, allStories);
      console.log(`[Epic] Selective revision: ${affectedStories.length} directly affected, ${storiesToRevise.size} total with dependents`);

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

    // Archive old claims and completions for affected stories only
    // This allows the claim system to work correctly on retry
    const storyIndicesToArchive = Array.from(storiesToRevise);
    await this.coordination.archiveStoryClaims(storyIndicesToArchive);

    // Clear completion state for affected stories only
    for (const idx of storiesToRevise) {
      this.completedStoryIndices.delete(idx);
    }

    // Queue only affected stories for re-execution, sorted by index (respects dependencies)
    this.revisionStoriesQueued = allStories
      .filter(s => storiesToRevise.has(s.storyIndex))
      .sort((a, b) => a.storyIndex - b.storyIndex);

    console.log(`[Epic] Revision triggered. ${this.revisionStoriesQueued.length} stories queued for re-execution.`);
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
    await this.jiraOps.postComment(jiraComment);

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
    await this.jiraOps.postComment(jiraComment);

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

  // =============================================================================
  // WORKERMILL.md Management Methods
  // =============================================================================

  /**
   * Ensure WORKERMILL.md exists for existing codebases (pre-story phase).
   * For greenfield projects, this is skipped - WORKERMILL.md will be created after completion.
   * For existing codebases, we create it early so agents can reference it.
   */
  private async ensureWorkermillMd(): Promise<void> {
    const repoPath = this.gitOps.getRepoPath();

    // Skip if already exists
    if (hasWorkermillMd(repoPath)) {
      console.log("[Epic] WORKERMILL.md already exists - skipping creation");
      return;
    }

    // Skip for greenfield projects - will create after stories complete
    if (isGreenfield(repoPath)) {
      console.log("[Epic] Greenfield project detected - WORKERMILL.md will be created after completion");
      return;
    }

    // Existing codebase without WORKERMILL.md - create it now
    console.log("[Epic] Creating WORKERMILL.md for existing codebase...");

    try {
      const prompt = buildCreateWorkermillMdPrompt(repoPath);

      // Run agent to analyze codebase and create WORKERMILL.md
      await runAgent({
        systemPrompt: "You are a codebase analyst creating documentation for AI agents.",
        prompt,
        workingDirectory: repoPath,
        model: this.config.executorModel || "claude-sonnet-4-20250514",
        apiKey: this.config.apiKey,
        oauthToken: this.config.oauthToken,
        maxTurns: 10,
      });

      // Verify creation
      if (hasWorkermillMd(repoPath)) {
        console.log("[Epic] WORKERMILL.md created successfully");
      } else {
        console.warn("[Epic] WORKERMILL.md creation may have failed - file not found");
      }
    } catch (error) {
      // Non-fatal - log and continue
      console.warn("[Epic] Failed to create WORKERMILL.md (non-fatal):", error instanceof Error ? error.message : error);
    }
  }

  /**
   * Update or create WORKERMILL.md after all stories complete (post-story phase).
   * For greenfield projects, creates the file documenting what was built.
   * For existing codebases, updates with any new patterns or changes.
   */
  private async updateWorkermillMd(
    storyCompletions: Array<{ storyIndex: number; title: string; filesModified: string[] }>
  ): Promise<void> {
    const repoPath = this.gitOps.getRepoPath();
    const existingContent = readWorkermillMd(repoPath);

    // Skip if no significant changes
    const totalFilesModified = storyCompletions.reduce((acc, s) => acc + (s.filesModified?.length || 0), 0);
    if (totalFilesModified === 0) {
      console.log("[Epic] No files modified - skipping WORKERMILL.md update");
      return;
    }

    console.log(`[Epic] ${existingContent ? "Updating" : "Creating"} WORKERMILL.md after task completion...`);

    try {
      const prompt = buildUpdateWorkermillMdPrompt(repoPath, existingContent, storyCompletions);

      // Run agent to update/create WORKERMILL.md
      await runAgent({
        systemPrompt: "You are a codebase analyst updating documentation for AI agents.",
        prompt,
        workingDirectory: repoPath,
        model: this.config.executorModel || "claude-sonnet-4-20250514",
        apiKey: this.config.apiKey,
        oauthToken: this.config.oauthToken,
        maxTurns: 10,
      });

      console.log("[Epic] WORKERMILL.md update completed");
    } catch (error) {
      // Non-fatal - log and continue
      console.warn("[Epic] Failed to update WORKERMILL.md (non-fatal):", error instanceof Error ? error.message : error);
    }
  }

  /**
   * Sleep helper.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
      if (prUrl) {
        console.log(`::pr_url::${prUrl}`);
      }
    } catch (err) {
      console.error("[Epic] Failed to update task status:", err instanceof Error ? err.message : err);
      // Don't throw - status update failure shouldn't crash the container
    }
  }
}
