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
} from "./types.js";
import { getAvailableExperts, findExpertForQuestion, matchPersonaToExpert } from "./experts.js";
import { CoordinationClient } from "./coordination-client.js";
import { StoryExecutor } from "./executor.js";
import { GitOps } from "./git-ops.js";
import { JiraOps } from "./jira-ops.js";
import { InlineReviewer, type InlineReviewResult } from "./inline-reviewer.js";
import { InlineDeployer } from "./inline-deployer.js";
import { InlineImprover } from "./inline-improver.js";
import { createMemoryClient, type MemoryClient, type MemoryContext } from "./memory-client.js";
import { spawn, execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { runQualityVerification, postQualityMetrics, type QualityMetrics } from "./quality-runner.js";
import {
  evaluateQualityGate,
  formatQualityGateResult,
  type QualityGateResult,
  type QualityThresholds,
  DEFAULT_THRESHOLDS,
} from "./quality-gate.js";

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
  private maxRevisions: number = 3;
  private currentPrUrl: string | undefined;
  private currentPrNumber: number | undefined;
  private lastReviewFeedback: string | undefined;
  private revisionStoriesQueued: ReadyStory[] = [];  // Stories queued for revision re-execution
  private deploymentSucceeded: boolean = false;  // Track if deployment completed successfully
  private totalStories: number = 0;  // Total stories in the Epic (for lazy coordination loading)

  // Memory system (REQ-19)
  private memoryClient: MemoryClient;
  private memoryContext: MemoryContext | null = null;

  constructor(config: EpicConfig) {
    this.config = config;
    this.coordination = new CoordinationClient(config);
    this.gitOps = new GitOps({
      targetRepo: config.targetRepo,
      githubToken: config.githubToken,
      workDir: "/app/workspace",
    });
    this.executor = new StoryExecutor(config, this.coordination, this.gitOps);
    this.jiraOps = new JiraOps(config.jiraIssueKey);
    this.expertStates = new Map();

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
   * Retrieve memory context for the task (REQ-19).
   * Fetches relevant skills and memories to inject into expert prompts.
   */
  private async retrieveMemoryContext(): Promise<void> {
    console.log("[Epic] Retrieving memory context for task...");

    try {
      // Build task description from available info
      const taskDescription = this.config.taskSummary || this.config.jiraIssueKey || "";

      // Get memory context from API
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
   * Start the Epic coordination loop.
   */
  async start(): Promise<void> {
    console.log("[Epic] Starting Epic executor for task " + this.config.parentTaskId);
    this.missionActive = true;

    try {
      // Clone the repository
      await this.gitOps.cloneIfNeeded();

      // Retrieve memory context for the task (REQ-19)
      await this.retrieveMemoryContext();

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
   * Main coordination loop iteration.
   * Uses request coalescing to minimize API calls within each iteration.
   */
  private async coordinationLoop(): Promise<void> {
    // Start new iteration - invalidates cache so we get fresh data,
    // but subsequent calls within this iteration will be coalesced
    this.coordination.startIteration();

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
   */
  private async processReadyStories(): Promise<void> {
    // First, check if we have revision stories queued (bypass claim system)
    if (this.revisionStoriesQueued.length > 0) {
      await this.processRevisionStories();
      return;
    }

    // Normal flow: get ready stories from coordination feed
    const readyStories = await this.coordination.getReadyStories();

    // Track total stories for lazy coordination loading
    // This includes all story_ready messages, even claimed ones
    if (this.totalStories === 0 && readyStories.length > 0) {
      // Count total stories by looking at max storyIndex (since we may have already claimed some)
      const maxIndex = Math.max(...readyStories.map(s => s.storyIndex), 0);
      this.totalStories = maxIndex + 1;
      console.log(`[Epic] Total stories in Epic: ${this.totalStories}`);
    }

    for (const story of readyStories) {
      // Find matching expert
      const expertPersona = matchPersonaToExpert(story.persona);
      if (!expertPersona) {
        console.log("[Epic] No expert match for persona: " + story.persona);
        continue;
      }

      // Check if expert is available
      const expertState = this.expertStates.get(expertPersona);
      if (!expertState || expertState.status !== "idle") {
        continue;
      }

      // Try to claim the story
      const claimResult = await this.coordination.claimStory(story.id, expertPersona);
      if (!claimResult.success) {
        // Don't log "already claimed" every poll cycle - too noisy
        continue;
      }

      console.log("[Epic] " + expertPersona + " claimed story " + story.storyIndex);

      // Update expert state
      this.expertStates.set(expertPersona, {
        persona: expertPersona,
        status: "working",
        currentStoryId: story.id,
        currentStoryIndex: story.storyIndex,
        startedAt: new Date(),
      });

      // Execute story (async, don't await)
      this.executeStoryAsync(story, expertPersona, this.totalStories);
    }
  }

  /**
   * Process revision stories directly (bypass claim system).
   * These are stories that need re-execution after a Tech Lead revision request.
   */
  private async processRevisionStories(): Promise<void> {
    console.log(`[Epic] Processing ${this.revisionStoriesQueued.length} revision stories...`);

    const storiesToProcess = [...this.revisionStoriesQueued];
    this.revisionStoriesQueued = [];  // Clear queue

    for (const story of storiesToProcess) {
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

      // Update expert state
      this.expertStates.set(expertPersona, {
        persona: expertPersona,
        status: "working",
        currentStoryId: story.id,
        currentStoryIndex: story.storyIndex,
        startedAt: new Date(),
      });

      // Execute story (async, don't await)
      this.executeStoryAsync(story, expertPersona, this.totalStories);
    }
  }

  /**
   * Execute a story asynchronously.
   * @param totalStories - Total number of stories in the Epic (for lazy coordination loading)
   */
  private async executeStoryAsync(
    story: ReadyStory,
    expert: ExpertPersona,
    totalStories: number = 1
  ): Promise<void> {
    try {
      const result = await this.executor.executeStory(story, expert, totalStories);

      // Update expert state
      this.expertStates.set(expert, {
        persona: expert,
        status: result.success ? "completed" : "blocked",
        currentStoryId: story.id,
        currentStoryIndex: story.storyIndex,
      });

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
      this.expertStates.set(expert, {
        persona: expert,
        status: "blocked",
        currentStoryId: story.id,
        currentStoryIndex: story.storyIndex,
      });
    }
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

      // Create consolidated PR with all story branches
      let prUrl: string | undefined;
      let prNumber: number | undefined;
      let prCreationAttempted = false;

      if (this.config.jiraIssueKey) {
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
      let taskStatus: "deployed" | "review_requested" | "pr_approved" | "failed";
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
      // Note: Don't transition Jira to "Done" here - that should happen after PR is merged/deployed

      // Build result summary based on status
      let resultSummary: string;
      if (prUrl) {
        resultSummary = `Epic ${taskStatus}: ${summaryParts.join(", ")} (${completions.length} stories) - PR: ${prUrl}`;
      } else if (taskStatus === "failed") {
        resultSummary = `Epic failed: ${summaryParts.join(", ")} (${completions.length} stories) - PR creation failed`;
      } else {
        resultSummary = `Epic: ${summaryParts.join(", ")} (${completions.length} stories)`;
      }

      await this.updateTaskStatus(
        taskStatus,
        resultSummary,
        errorMessage,  // pass error message for failures
        prUrl          // pass prUrl to be saved on task (may be undefined for failures)
      );

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
        qualityMetrics
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

        console.log(`[Epic] Revision needed (${this.revisionCount}/${this.maxRevisions}). Re-running stories...`);
        await this.jiraOps.postComment(
          `🔄 Revision ${this.revisionCount}/${this.maxRevisions} requested by Tech Lead:\n\n${reviewResult.feedback}`
        );

        // Trigger revision: reset stories and re-execute
        await this.triggerRevision(reviewResult.feedback);
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

        // Parse decision from output
        const decisionMatch = allOutput.match(/REVIEW_DECISION:\s*(approved|revision_needed|rejected)/i);
        const decision = decisionMatch
          ? (decisionMatch[1].toLowerCase() as "approved" | "revision_needed" | "rejected")
          : "revision_needed";

        const feedbackMatch = allOutput.match(/FEEDBACK:\s*([\s\S]*?)(?=\n\s*(?:REVIEW_DECISION:|CODE_QUALITY_SCORE:)|$)/i);
        const feedback = feedbackMatch?.[1]?.trim() || "No feedback provided";

        const scoreMatch = allOutput.match(/CODE_QUALITY_SCORE:\s*(\d+)/i);
        const codeQualityScore = scoreMatch ? Math.min(10, Math.max(1, parseInt(scoreMatch[1], 10))) : 5;

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
      ? `***REMOVED******REMOVED*** Previous Review Feedback (Revision ${this.revisionCount}/3)
This is a revision attempt. The previous code was reviewed and these issues were identified:

${this.lastReviewFeedback}

**Check if these issues have been addressed in the latest changes.**

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

      qualitySection = `***REMOVED******REMOVED*** Automated Quality Metrics

| Metric | Result | Status |
|--------|--------|--------|
| **Overall Score** | ${qualityMetrics.qualityScore}% | ${qualityMetrics.qualityScore >= 70 ? '✅' : '⚠️ Below 70% threshold'} |
| TypeCheck | ${qualityMetrics.typeErrors} errors | ${hasTypeErrors ? '❌ MUST FIX' : '✅'} |
| Lint | ${qualityMetrics.lintErrors} errors, ${qualityMetrics.lintWarnings} warnings | ${hasLintIssues ? '⚠️' : '✅'} |
| Tests | ${qualityMetrics.testsPassed} passed, ${qualityMetrics.testsFailed} failed | ${hasTestFailures ? '❌ MUST FIX' : '✅'} |
| Security | ${qualityMetrics.securityHigh} high, ${qualityMetrics.securityMedium} medium | ${hasSecurityIssues ? '🔴 CRITICAL' : '✅'} |

***REMOVED******REMOVED******REMOVED*** Quality Gate Rules
${qualityBelowThreshold ? '**⚠️ QUALITY SCORE BELOW 70% - Revision required unless there is a very good reason.**\n' : ''}${hasTypeErrors ? '**❌ TYPE ERRORS DETECTED - These MUST be fixed. Request revision.**\n' : ''}${hasTestFailures ? '**❌ TEST FAILURES DETECTED - These MUST be fixed. Request revision.**\n' : ''}${hasSecurityIssues ? '**🔴 HIGH SEVERITY SECURITY ISSUES - These MUST be fixed. Request revision.**\n' : ''}
---

`;
    }

    const qualityNote = qualityMetrics ? "- **Do the automated quality metrics pass? (See above)**" : "";
    const qualityGateNote = qualityMetrics && (qualityMetrics.typeErrors > 0 || qualityMetrics.testsFailed > 0 || qualityMetrics.securityHigh > 0)
      ? "\n   **NOTE: Due to quality gate failures above, you should request REVISION_NEEDED unless already addressed.**"
      : "";

    return `***REMOVED*** PR Code Review Task

${revisionSection}${qualitySection}***REMOVED******REMOVED*** Task Details
- **Jira Issue**: ${this.config.jiraIssueKey}
- **PR URL**: ${prUrl}
- **PR Number**: ${prNumber}

***REMOVED******REMOVED*** Instructions

1. **Fetch the PR diff**:
   \`\`\`bash
   gh pr diff ${prNumber}
   \`\`\`

2. **Review the code** against these criteria:
   - Does it correctly implement the Jira requirements?
   - Is the code quality acceptable?
   - Are there security vulnerabilities?
   - Are there test coverage gaps?
   - Does it follow project coding standards?
   ${qualityNote}
   ${this.lastReviewFeedback ? "- **Have the previous review issues been addressed?**" : ""}

3. **Make your decision**: APPROVE, REVISION_NEEDED, or REJECT${qualityGateNote}

4. **Submit your review to GitHub** (REQUIRED):

   **If APPROVE:**
   \`\`\`bash
   gh pr review ${prNumber} --approve --body "Your approval message"
   \`\`\`

   **If REVISION_NEEDED or REJECT:**
   \`\`\`bash
   gh pr review ${prNumber} --request-changes --body "Your detailed feedback"
   \`\`\`

5. **Output your decision** using these exact markers:
   \`\`\`
   REVIEW_DECISION: approved
   CODE_QUALITY_SCORE: 8
   FEEDBACK: Your detailed feedback here
   \`\`\`

Begin your review now. Start by fetching the PR diff.`;
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
   * Trigger a revision by resetting story states and injecting feedback.
   * Stories are queued for direct re-execution (bypassing the claim system).
   */
  private async triggerRevision(feedback: string): Promise<void> {
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

    // Get all stories and queue them for revision re-execution
    // This bypasses the normal claim system since stories were already claimed
    const stories = await this.coordination.getReadyStories();
    this.revisionStoriesQueued = stories;

    console.log(`[Epic] Revision triggered. ${stories.length} stories queued for re-execution.`);
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

  /**
   * Sleep helper.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Extract PR number from a GitHub PR URL.
   * Format: https://github.com/owner/repo/pull/123
   */
  private extractPrNumber(prUrl: string): number | undefined {
    const match = prUrl.match(/\/pull\/(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
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
   * - No PR (failed): "failed"
   */
  private async updateTaskStatus(
    status: "pr_approved" | "failed" | "review_requested" | "deployed" | "quality_gate_failed",
    resultSummary?: string,
    errorMessage?: string,
    prUrl?: string
  ): Promise<void> {
    const exitCode = (status === "failed" || status === "quality_gate_failed") ? 1 : 0;

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

      console.log(`[Epic] Task status updated to: ${status}${resultSummary ? ` - ${resultSummary}` : ""}${prNumber ? ` (PR ***REMOVED***${prNumber})` : ""}`);
    } catch (err) {
      console.error("[Epic] Failed to update task status:", err instanceof Error ? err.message : err);
      // Don't throw - status update failure shouldn't crash the container
    }
  }
}
