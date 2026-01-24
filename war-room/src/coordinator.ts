/**
 * War Room Coordinator
 *
 * Main coordination loop for multi-agent collaboration.
 * Manages expert state, claims stories, routes questions, and coordinates execution.
 */

import type {
  ExpertPersona,
  ExpertState,
  ReadyStory,
  WarRoomConfig,
  ContextMessage,
} from "./types.js";
import { getAvailableExperts, findExpertForQuestion, matchPersonaToExpert } from "./experts.js";
import { CoordinationClient } from "./coordination-client.js";
import { StoryExecutor } from "./executor.js";
import { GitOps } from "./git-ops.js";

/**
 * War Room coordinator managing multi-agent collaboration.
 */
export class WarRoomCoordinator {
  private config: WarRoomConfig;
  private coordination: CoordinationClient;
  private executor: StoryExecutor;
  private gitOps: GitOps;
  private expertStates: Map<ExpertPersona, ExpertState>;
  private missionActive: boolean = false;
  private pollIntervalMs: number = 5000;

  constructor(config: WarRoomConfig) {
    this.config = config;
    this.coordination = new CoordinationClient(config);
    this.gitOps = new GitOps({
      targetRepo: config.targetRepo,
      githubToken: config.githubToken,
      workDir: "/app/workspace",
    });
    this.executor = new StoryExecutor(config, this.coordination, this.gitOps);
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
   * Start the War Room coordination loop.
   */
  async start(): Promise<void> {
    console.log("[WarRoom] Starting War Room for task " + this.config.parentTaskId);
    this.missionActive = true;

    try {
      // Clone the repository
      await this.gitOps.cloneIfNeeded();

      // Main coordination loop
      while (this.missionActive) {
        await this.coordinationLoop();
        await this.sleep(this.pollIntervalMs);
      }
    } catch (error) {
      console.error("[WarRoom] Fatal error:", error);
      throw error;
    }
  }

  /**
   * Stop the War Room.
   */
  stop(): void {
    console.log("[WarRoom] Stopping War Room");
    this.missionActive = false;
  }

  /**
   * Main coordination loop iteration.
   */
  private async coordinationLoop(): Promise<void> {
    // 1. Check for ready stories and match to idle experts
    await this.processReadyStories();

    // 2. Check for unanswered questions and route to experts
    await this.processQuestions();

    // 3. Check for completed stories and update states
    await this.checkCompletions();

    // 4. Check if mission is complete
    await this.checkMissionComplete();
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
        console.log("[WarRoom] No expert match for persona: " + story.persona);
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
        console.log("[WarRoom] Story " + story.storyIndex + " already claimed by " + claimResult.claimedBy);
        continue;
      }

      console.log("[WarRoom] " + expertPersona + " claimed story " + story.storyIndex);

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
      console.error("[WarRoom] Story execution failed:", error);
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
   */
  private async processQuestions(): Promise<void> {
    const questions = await this.coordination.getUnansweredQuestions();

    for (const question of questions) {
      // Find the right expert to answer
      const targetPersona = findExpertForQuestion(
        question.content,
        question.fromPersona
      );

      if (!targetPersona) {
        continue;
      }

      // Check if expert is idle
      const expertState = this.expertStates.get(targetPersona);
      if (!expertState || expertState.status !== "idle") {
        continue;
      }

      console.log("[WarRoom] Routing question from " + question.fromPersona + " to " + targetPersona);

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
   */
  private async checkCompletions(): Promise<void> {
    const contexts = await this.coordination.getAllContexts();
    const completions = contexts.filter((c) => c.messageType === "completion");

    // Log completion count
    if (completions.length > 0) {
      console.log("[WarRoom] " + completions.length + " stories completed");
    }
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
    const readyToClaim = readyStories.filter((ready) => {
      const storyIndex = (ready.metadata?.storyIndex as number) || 0;
      return !completions.some(
        (c) => (c.metadata?.storyIndex as number) === storyIndex
      );
    });

    if (allIdle && readyToClaim.length === 0 && completions.length > 0) {
      console.log("[WarRoom] Mission complete! All stories finished.");
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
}
