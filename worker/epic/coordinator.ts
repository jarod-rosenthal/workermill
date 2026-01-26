/**
 * Epic Coordinator
 *
 * Main coordination loop for multi-agent collaboration.
 * Manages expert state, claims stories, routes questions, and coordinates execution.
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

    // Initialize expert states
    for (const expert of getAvailableExperts()) {
      this.expertStates.set(expert, {
        persona: expert,
        status: "idle",
      });
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
   */
  private async coordinationLoop(): Promise<void> {
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
   */
  private async processReadyStories(): Promise<void> {
    const readyStories = await this.coordination.getReadyStories();

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
      this.executeStoryAsync(story, expertPersona);
    }
  }

  /**
   * Execute a story asynchronously.
   */
  private async executeStoryAsync(
    story: ReadyStory,
    expert: ExpertPersona
  ): Promise<void> {
    try {
      const result = await this.executor.executeStory(story, expert);

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
   */
  private async checkMissionComplete(): Promise<void> {
    const contexts = await this.coordination.getAllContexts();

    // Count story_ready vs completion
    const readyStories = contexts.filter((c) => c.messageType === "story_ready");
    const completions = contexts.filter((c) => c.messageType === "completion");
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
      console.log("[Epic] Mission complete! All stories finished.");

      // Extract story completion details for PR description
      const storyCompletions = completions.map((c) => ({
        storyIndex: (c.metadata?.storyIndex as number) || 0,
        title: (c.metadata?.title as string) || c.content,
        filesModified: (c.metadata?.filesModified as string[]) || [],
      }));

      const summaryParts = storyCompletions.map((s) => `S${s.storyIndex}`);

      // Create consolidated PR with all story branches
      let prUrl: string | undefined;
      let prCreationAttempted = false;
      if (this.config.jiraIssueKey) {
        console.log("[Epic] Creating consolidated PR...");
        prCreationAttempted = true;
        prUrl = await this.gitOps.createConsolidatedPR(
          this.config.jiraIssueKey,
          `Epic: ${storyCompletions.map((s) => s.title).join(", ")}`,
          storyCompletions
        );
        if (prUrl) {
          console.log(`[Epic] Consolidated PR created: ${prUrl}`);
        } else {
          console.error("[Epic] Failed to create consolidated PR");
        }
      }

      // Determine the appropriate status based on workflow flags
      // - reviewEnabled: PR needs manager review before deployment
      // - deploymentEnabled: auto-deploy after merge (handled elsewhere)
      // - Neither: PR created, waiting for human approval
      // - PR creation attempted but failed: task should fail
      let taskStatus: "pr_created" | "review_requested" | "failed";
      let jiraComment: string;
      let errorMessage: string | undefined;

      if (prUrl) {
        if (this.config.reviewEnabled) {
          // Review label: trigger Virtual Manager review
          taskStatus = "review_requested";
          jiraComment = `Epic stories completed: ${completions.length} stories implemented (${summaryParts.join(", ")})\n\nPR: ${prUrl}\n\n*Awaiting manager review...*`;
        } else {
          // No review label: PR created, waiting for human action
          taskStatus = "pr_created";
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

      // Post comment to Jira (but don't transition to Done - that happens after deployment)
      await this.jiraOps.postComment(jiraComment);
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
      this.missionActive = false;
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
   * - PR created + reviewEnabled: "review_requested" → triggers Virtual Manager
   * - PR created + no reviewEnabled: "pr_created" → waiting for human approval
   * - No PR (failed): "failed"
   */
  private async updateTaskStatus(
    status: "completed" | "failed" | "pr_created" | "review_requested",
    resultSummary?: string,
    errorMessage?: string,
    prUrl?: string
  ): Promise<void> {
    try {
      const apiUrl = `${this.config.apiBaseUrl}/api/tasks/${this.config.parentTaskId}/worker-complete`;

      // Extract PR number from URL for orchestrator manager review detection
      const prNumber = prUrl ? this.extractPrNumber(prUrl) : undefined;

      await axios.post(
        apiUrl,
        {
          exitCode: status === "failed" ? 1 : 0,
          result: status,
          errorMessage: errorMessage,
          prUrl: prUrl,
          prNumber: prNumber,
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
