/**
 * Blocker Manager for Epic Mode
 *
 * Centralized blocker detection, escalation, and resolution handling.
 * Coordinates with the coordination feed to track blockers across stories.
 */

import type { CoordinationClient } from "./coordination-client.js";
import type {
  BlockerInfo,
  BlockerResponse,
  ContextMessage,
  ErrorCategory,
  ExpertPersona,
  ReadyStory,
  ResilienceConfig,
} from "./types.js";
import type { DecisionClient } from "./decision-client.js";

/**
 * Manages blockers for Epic execution.
 * Tracks blocked stories, handles escalation, and waits for resolution.
 */
export class BlockerManager {
  private coordination: CoordinationClient;
  private parentTaskId: string;
  private config: ResilienceConfig;
  private decisionClient: DecisionClient;
  private retryCountByStory: Map<number, number> = new Map();
  private consumedResolutionIds: Set<string> = new Set();

  constructor(
    coordination: CoordinationClient,
    parentTaskId: string,
    config: ResilienceConfig,
    decisionClient: DecisionClient
  ) {
    this.coordination = coordination;
    this.parentTaskId = parentTaskId;
    this.config = config;
    this.decisionClient = decisionClient;
  }

  /**
   * Check for unresolved blockers in the coordination feed.
   * Returns the first unresolved blocker, or null if none exist.
   */
  async checkForBlockers(): Promise<BlockerInfo | null> {
    const contexts = await this.coordination.getAllContexts();

    // Find blocker messages that haven't been resolved
    const blockerMessages = contexts.filter(
      (ctx) => ctx.messageType === "blocker" && ctx.metadata?.isEscalated === true
    );

    // Check if any blocker has been resolved
    // Must check BOTH "answer" (worker-posted) AND "blocker_resolved" (dashboard-posted) types
    const resolvedBlockerIds = new Set<string>();
    for (const ctx of contexts) {
      if (ctx.metadata?.blockerId) {
        const isAnswerResolution = ctx.messageType === "answer" && ctx.metadata?.blockerAction;
        const isDashboardResolution = ctx.messageType === "blocker_resolved" && ctx.metadata?.action;
        if (isAnswerResolution || isDashboardResolution) {
          resolvedBlockerIds.add(ctx.metadata.blockerId as string);
        }
      }
    }

    // Find first unresolved blocker
    const unresolvedBlocker = blockerMessages.find(
      (b) => !resolvedBlockerIds.has(b.id)
    );

    if (!unresolvedBlocker) {
      return null;
    }

    return this.parseBlockerInfo(unresolvedBlocker);
  }

  /**
   * Parse blocker info from a context message.
   */
  private parseBlockerInfo(ctx: ContextMessage): BlockerInfo {
    // Extract summary and full error from metadata (new format) or fall back to content (old format)
    const summary = (ctx.metadata?.summary as string) ?? ctx.content;
    const errorMessage = (ctx.metadata?.fullErrorMessage as string) ?? ctx.content;

    return {
      id: ctx.id,
      parentTaskId: ctx.parentTaskId,
      storyIndex: (ctx.metadata?.storyIndex as number) ?? -1,
      storyTitle: (ctx.metadata?.storyTitle as string) ?? "Unknown",
      persona: (ctx.metadata?.persona as ExpertPersona) ?? "backend_developer",
      errorCategory: (ctx.metadata?.errorCategory as BlockerInfo["errorCategory"]) ?? "unknown",
      summary,
      errorMessage,
      affectedFiles: (ctx.metadata?.affectedFiles as string[]) ?? [],
      autoRetryAttempts: (ctx.metadata?.autoRetryAttempts as number) ?? 0,
      maxAutoRetries: (ctx.metadata?.maxAutoRetries as number) ?? this.config.blockerMaxAutoRetries,
      dependentStories: (ctx.metadata?.dependentStories as number[]) ?? [],
      createdAt: ctx.createdAt,
    };
  }

  /**
   * Escalate a blocker to the coordination feed.
   * This triggers notifications and pauses dependent stories.
   */
  async escalateBlocker(
    storyIndex: number,
    storyTitle: string,
    persona: ExpertPersona,
    errorMessage: string,
    allStories: ReadyStory[]
  ): Promise<BlockerInfo> {
    const result = await this.decisionClient.classifyError({ errorOutput: errorMessage });
    const dependentStories = this.getDependentStories(storyIndex, allStories);
    const autoRetryAttempts = this.retryCountByStory.get(storyIndex) ?? 0;

    // Use summary from Decision API response
    const summary = result.summary || `${storyTitle} failed: ${result.category} error`;

    // Post escalation to coordination feed
    // The content is the summary (shown prominently), full error is in metadata
    const ctx = await this.coordination.postContext(
      "blocker",
      summary,
      persona,
      undefined,
      {
        storyIndex,
        storyTitle,
        persona,
        errorCategory: result.category,
        summary,
        fullErrorMessage: errorMessage,  // Full error preserved in metadata
        affectedFiles: result.affectedFiles,
        autoRetryAttempts,
        maxAutoRetries: this.config.blockerMaxAutoRetries,
        dependentStories,
        isEscalated: true,
        isFixable: result.fixable,
        fixStrategy: result.fixStrategy,
      },
      `${persona}-story-${storyIndex}`
    );

    console.log(
      `[BlockerManager] Escalated blocker for story ${storyIndex}: ${result.category} error`
    );
    console.log(
      `[BlockerManager] Summary: ${summary.substring(0, 200)}...`
    );
    console.log(
      `[BlockerManager] Blocked dependent stories: ${dependentStories.join(", ") || "none"}`
    );

    return {
      id: ctx.id,
      parentTaskId: this.parentTaskId,
      storyIndex,
      storyTitle,
      persona,
      errorCategory: (result.category as ErrorCategory) || "unknown",
      summary,
      errorMessage,
      affectedFiles: result.affectedFiles,
      autoRetryAttempts,
      maxAutoRetries: this.config.blockerMaxAutoRetries,
      dependentStories,
      createdAt: ctx.createdAt,
    };
  }

  /**
   * Get all story indices that depend on a given story.
   * Used to block downstream stories when a dependency fails.
   */
  getDependentStories(storyIndex: number, allStories: ReadyStory[]): number[] {
    const dependents: number[] = [];

    for (const story of allStories) {
      if (story.dependencies.includes(storyIndex)) {
        dependents.push(story.storyIndex);
        // Recursively find stories that depend on this dependent
        const transitiveDeps = this.getDependentStories(story.storyIndex, allStories);
        dependents.push(...transitiveDeps);
      }
    }

    return [...new Set(dependents)];
  }

  /**
   * Wait for a blocker to be resolved by human intervention.
   * Returns the response action (retry, skip, abort) or null on timeout.
   */
  async waitForBlockerResponse(
    blocker: BlockerInfo,
    timeoutMs: number = 3600000 // 1 hour default
  ): Promise<BlockerResponse | null> {
    const startTime = Date.now();
    const pollInterval = 5000; // Poll every 5 seconds

    console.log(
      `[BlockerManager] Waiting for human response to blocker ${blocker.id}...`
    );

    while (Date.now() - startTime < timeoutMs) {
      const contexts = await this.coordination.getAllContexts();

      // Look for a resolution answer to this blocker
      // Accept both "answer" type (from worker) and "blocker_resolved" type (from API)
      const resolution = contexts.find(
        (ctx) =>
          ctx.metadata?.blockerId === blocker.id &&
          !this.consumedResolutionIds.has(ctx.id) &&
          (
            // Worker-posted resolution
            (ctx.messageType === "answer" && ctx.metadata?.blockerAction) ||
            // API-posted resolution (from dashboard)
            (ctx.messageType === "blocker_resolved" && ctx.metadata?.action)
          )
      );

      if (resolution) {
        this.consumedResolutionIds.add(resolution.id);
        // Normalize the metadata - API uses "action", worker uses "blockerAction"
        const normalizedMetadata = {
          ...resolution.metadata,
          blockerAction: resolution.metadata?.blockerAction || resolution.metadata?.action,
        };
        return this.parseBlockerCommand(resolution.content, normalizedMetadata);
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    console.log(`[BlockerManager] Timeout waiting for blocker response`);
    return null;
  }

  /**
   * Parse a blocker command from user response content and metadata.
   */
  parseBlockerCommand(
    content: string,
    metadata?: Record<string, unknown>
  ): BlockerResponse | null {
    const action = metadata?.blockerAction as string | undefined;

    if (!action) {
      // Try to parse action from content
      const lowerContent = content.toLowerCase();
      if (lowerContent.includes("retry") || lowerContent.includes("try again")) {
        return {
          action: "retry",
          guidance: content,
          respondedAt: new Date().toISOString(),
        };
      } else if (lowerContent.includes("skip") || lowerContent.includes("ignore")) {
        return {
          action: "skip",
          guidance: content,
          respondedAt: new Date().toISOString(),
        };
      } else if (lowerContent.includes("abort") || lowerContent.includes("stop") || lowerContent.includes("cancel")) {
        return {
          action: "abort",
          guidance: content,
          respondedAt: new Date().toISOString(),
        };
      }
      return null;
    }

    return {
      action: action as BlockerResponse["action"],
      guidance: metadata?.guidance as string | undefined,
      respondedBy: metadata?.respondedBy as string | undefined,
      respondedAt: (metadata?.respondedAt as string) ?? new Date().toISOString(),
    };
  }

  /**
   * Post a blocker resolution to the coordination feed.
   */
  async resolveBlocker(
    blockerId: string,
    action: BlockerResponse["action"],
    guidance?: string,
    respondedBy?: string
  ): Promise<void> {
    await this.coordination.postAnswer(
      blockerId,
      `Blocker resolved: ${action}${guidance ? `\n\nGuidance: ${guidance}` : ""}`,
      respondedBy ?? "system"
    );

    // Also post with structured metadata for machine parsing
    await this.coordination.postContext(
      "answer",
      `Blocker ${blockerId} resolved with action: ${action}`,
      respondedBy ?? "system",
      undefined,
      {
        blockerId,
        blockerAction: action,
        guidance,
        respondedBy,
        respondedAt: new Date().toISOString(),
      }
    );
  }

  /**
   * Get the retry count for a story.
   */
  getRetryCount(storyIndex: number): number {
    return this.retryCountByStory.get(storyIndex) ?? 0;
  }

  /**
   * Increment the retry count for a story.
   */
  incrementRetryCount(storyIndex: number): void {
    const current = this.retryCountByStory.get(storyIndex) ?? 0;
    this.retryCountByStory.set(storyIndex, current + 1);
  }

  /**
   * Reset the retry count for a story (after successful completion).
   */
  resetRetryCount(storyIndex: number): void {
    this.retryCountByStory.delete(storyIndex);
  }

  /**
   * Check if a story has exhausted its auto-retry attempts.
   */
  hasExhaustedRetries(storyIndex: number): boolean {
    if (!this.config.blockerAutoRetryEnabled) {
      return true; // Auto-retry disabled, always escalate
    }
    return this.getRetryCount(storyIndex) >= this.config.blockerMaxAutoRetries;
  }

  /**
   * Check if an error should trigger auto-retry or immediate escalation.
   * Returns true if should auto-retry, false if should escalate.
   */
  async shouldAutoRetry(storyIndex: number, errorMessage: string): Promise<boolean> {
    if (!this.config.blockerAutoRetryEnabled) {
      return false;
    }

    if (this.hasExhaustedRetries(storyIndex)) {
      return false;
    }

    const result = await this.decisionClient.classifyError({ errorOutput: errorMessage });
    return result.fixable;
  }
}
