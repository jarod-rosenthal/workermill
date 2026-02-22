/**
 * Coordination Client for Epic Executor
 *
 * API client for communicating with the WorkerMill coordination feed.
 * Handles story claiming, context posting, and question/answer flows.
 *
 * Uses the Singleflight Pattern (request coalescing) to prevent API flooding:
 * - Concurrent identical requests share a single network call
 * - Results cached within each coordination loop iteration
 * - Cache invalidated after mutations (POST/claim operations)
 *
 * This prevents the thundering herd problem when multiple workers
 * or multiple methods within the same worker request the same data.
 */

import axios, { AxiosInstance } from "axios";
import { withRetry } from "../lib/dist/api-retry.js";
import { RequestCoalescer, createCoordinationCoalescer } from "./request-coalescer.js";
import type {
  ContextMessage,
  ContextMessageType,
  ReadyStory,
  PendingQuestion,
  ClaimResult,
  EpicConfig,
  ExpertPersona,
  BlockerInfo,
  BlockerResponse,
} from "./types.js";

/**
 * Client for the WorkerMill coordination API.
 * Implements request coalescing to minimize API calls.
 */
export class CoordinationClient {
  private api: AxiosInstance;
  private parentTaskId: string;
  private orgApiKey: string;
  private coalescer: RequestCoalescer;

  constructor(config: EpicConfig) {
    this.parentTaskId = config.parentTaskId;
    this.orgApiKey = config.orgApiKey;
    this.coalescer = createCoordinationCoalescer();

    this.api = axios.create({
      baseURL: config.apiBaseUrl,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.orgApiKey,
      },
      timeout: 30000,
    });
  }

  /**
   * Start a new coordination loop iteration.
   * Call this at the beginning of each poll cycle to ensure fresh data.
   * This invalidates the cache so subsequent calls get fresh data,
   * but within this iteration, calls are still coalesced.
   */
  startIteration(): void {
    this.coalescer.invalidateAll();
  }

  /**
   * Get coalescer stats for debugging.
   */
  getCoalescerStats(): { cacheSize: number; inFlightCount: number } {
    return this.coalescer.getStats();
  }

  /**
   * Get all constraints posted for this parent task.
   * Constraints are frozen decisions set at the start of the Epic session.
   * Uses request coalescing - concurrent calls share a single API request.
   */
  async getConstraints(): Promise<ContextMessage[]> {
    return this.coalescer.execute(
      `getConstraints:${this.parentTaskId}`,
      async () => {
        const response = await withRetry(
          () => this.api.get<{ contexts: ContextMessage[] }>(
            `/api/coordination/context/${this.parentTaskId}`,
            {
              params: {
                messageType: "constraints",
              },
            }
          ),
          { logger: (msg) => console.log(msg) }
        );
        return response.data.contexts;
      }
    );
  }

  /**
   * Get all ready stories waiting to be claimed.
   * Uses request coalescing - concurrent calls share a single API request.
   */
  async getReadyStories(): Promise<ReadyStory[]> {
    return this.coalescer.execute(
      `getReadyStories:${this.parentTaskId}`,
      async () => {
        const response = await withRetry(
          () => this.api.get<{ contexts: ContextMessage[] }>(
            `/api/coordination/context/${this.parentTaskId}`,
            {
              params: {
                messageType: "story_ready",
              },
            }
          ),
          { logger: (msg) => console.log(msg) }
        );

        return response.data.contexts.map((ctx) => ({
          id: ctx.id,
          parentTaskId: ctx.parentTaskId,
          storyIndex: (ctx.metadata?.storyIndex as number) ?? 0,
          persona: (ctx.metadata?.persona as ExpertPersona) ?? "backend_developer",
          title: ctx.content,
          description: (ctx.metadata?.description as string) || ctx.content,
          dependencies: (ctx.metadata?.dependencies as number[]) ?? [],
          jiraIssueKey: ctx.metadata?.jiraIssueKey as string | undefined,
          targetFiles: (ctx.metadata?.targetFiles as string[]) ?? [],
          mutexGroups: (ctx.metadata?.mutexGroups as string[]) ?? [],
        }));
      }
    );
  }

  /**
   * Attempt to atomically claim a story for a persona.
   * Returns success if claimed, alreadyClaimed if another expert got there first.
   * Invalidates caches after successful claim.
   */
  async claimStory(
    storyId: string,
    persona: ExpertPersona
  ): Promise<ClaimResult> {
    try {
      const response = await this.api.post<{ success: boolean; claimedBy?: string }>(
        "/api/coordination/claim",
        {
          parentTaskId: this.parentTaskId,
          storyId,
          claimedBy: persona,
        }
      );

      // Invalidate caches since claim status changed
      if (response.data.success) {
        this.coalescer.invalidatePrefix(`getAllContexts:${this.parentTaskId}`);
        this.coalescer.invalidatePrefix(`getReadyStories:${this.parentTaskId}`);
      }

      return {
        success: response.data.success,
        alreadyClaimed: false,
        claimedBy: persona,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        return {
          success: false,
          alreadyClaimed: true,
          claimedBy: error.response.data?.claimedBy,
        };
      }
      throw error;
    }
  }

  /**
   * Get all unanswered questions for this parent task.
   * Uses request coalescing - concurrent calls share a single API request.
   */
  async getUnansweredQuestions(): Promise<PendingQuestion[]> {
    return this.coalescer.execute(
      `getUnansweredQuestions:${this.parentTaskId}`,
      async () => {
        const response = await withRetry(
          () => this.api.get<{ contexts: ContextMessage[] }>(
            `/api/coordination/context/${this.parentTaskId}`,
            {
              params: {
                messageType: "question",
              },
            }
          ),
          { logger: (msg) => console.log(msg) }
        );

        // Filter to only questions without answers
        const answeredIds = new Set<string>();
        const allContexts = await this.getAllContexts();
        for (const ctx of allContexts) {
          if (ctx.messageType === "answer" && ctx.metadata?.questionId) {
            answeredIds.add(ctx.metadata.questionId as string);
          }
        }

        return response.data.contexts
          .filter((q) => !answeredIds.has(q.id))
          .map((q) => ({
            id: q.id,
            parentTaskId: q.parentTaskId,
            fromPersona: q.persona,
            content: q.content,
            createdAt: q.createdAt,
            metadata: q.metadata as PendingQuestion["metadata"],
          }));
      }
    );
  }

  /**
   * Get all context messages for this parent task.
   * Uses request coalescing - concurrent calls share a single API request.
   */
  async getAllContexts(): Promise<ContextMessage[]> {
    return this.coalescer.execute(
      `getAllContexts:${this.parentTaskId}`,
      async () => {
        const response = await withRetry(
          () => this.api.get<{ contexts: ContextMessage[] }>(
            `/api/coordination/context/${this.parentTaskId}`
          ),
          { logger: (msg) => console.log(msg) }
        );
        return response.data.contexts;
      }
    );
  }

  /**
   * Get only blocker-related context messages for this parent task.
   * Much lighter than getAllContexts() — typically returns 0-5 rows.
   * Uses request coalescing - concurrent calls share a single API request.
   */
  async getBlockerContexts(): Promise<ContextMessage[]> {
    return this.coalescer.execute(
      `getBlockerContexts:${this.parentTaskId}`,
      async () => {
        const response = await withRetry(
          () =>
            this.api.get<{ contexts: ContextMessage[] }>(
              `/api/coordination/blockers/${this.parentTaskId}`
            ),
          { logger: (msg) => console.log(msg) }
        );
        return response.data.contexts;
      }
    );
  }

  /**
   * Post a context message to the coordination feed.
   * Invalidates relevant caches after posting.
   */
  async postContext(
    messageType: ContextMessageType,
    content: string,
    persona: string,
    taskId?: string,
    metadata?: Record<string, unknown>,
    sessionId?: string
  ): Promise<ContextMessage> {
    const response = await this.api.post<ContextMessage>(
      "/api/coordination/context",
      {
        parentTaskId: this.parentTaskId,
        taskId,
        persona,
        messageType,
        content,
        metadata,
        sessionId,
      }
    );

    // Invalidate caches since context has changed
    this.coalescer.invalidatePrefix(`getAllContexts:${this.parentTaskId}`);
    this.coalescer.invalidatePrefix(`getReadyStories:${this.parentTaskId}`);
    this.coalescer.invalidatePrefix(`getConstraints:${this.parentTaskId}`);
    this.coalescer.invalidatePrefix(`getUnansweredQuestions:${this.parentTaskId}`);

    return response.data;
  }

  /**
   * Post an answer to a question.
   * API expects: messageId (the question's ID), answer (the response text), persona (optional)
   * Invalidates caches after posting.
   */
  async postAnswer(
    questionId: string,
    content: string,
    persona: string
  ): Promise<ContextMessage> {
    const response = await this.api.post<{ success: boolean; context: ContextMessage }>(
      "/api/coordination/answer",
      {
        messageId: questionId,
        answer: content,
        persona,
      }
    );

    // Invalidate caches since answers affect question status
    this.coalescer.invalidatePrefix(`getAllContexts:${this.parentTaskId}`);
    this.coalescer.invalidatePrefix(`getUnansweredQuestions:${this.parentTaskId}`);

    return response.data.context;
  }

  /**
   * Wait for an answer to a question with timeout.
   * Returns the answer content if found, undefined if timeout.
   */
  async waitForAnswer(
    questionId: string,
    timeoutMs: number = 30000
  ): Promise<string | undefined> {
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < timeoutMs) {
      const contexts = await this.getAllContexts();
      const answer = contexts.find(
        (ctx) =>
          ctx.messageType === "answer" &&
          ctx.metadata?.questionId === questionId
      );

      if (answer) {
        return answer.content;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    return undefined;
  }

  /**
   * Post a decision to the coordination feed.
   */
  async postDecision(
    decisionId: string,
    content: string,
    persona: string,
    taskId?: string,
    options?: {
      rationale?: string;
      impacts?: string[];
      isTentative?: boolean;
      storyIndex?: number;
    }
  ): Promise<ContextMessage> {
    // Generate sessionId for threading: "{persona}-story-{storyIndex}"
    const sessionId = options?.storyIndex !== undefined
      ? `${persona}-story-${options.storyIndex}`
      : undefined;
    return this.postContext(
      "decision",
      `${decisionId}: ${content}`,
      persona,
      taskId,
      {
        decisionId,
        rationale: options?.rationale,
        impacts: options?.impacts,
        isTentative: options?.isTentative ?? false,
        storyIndex: options?.storyIndex,
      },
      sessionId
    );
  }

  /**
   * Post a blocker to the coordination feed.
   */
  async postBlocker(
    content: string,
    persona: string,
    taskId?: string,
    dependsOnStory?: number,
    storyIndex?: number,
    extraMetadata?: Record<string, unknown>
  ): Promise<ContextMessage> {
    const sessionId = storyIndex !== undefined
      ? `${persona}-story-${storyIndex}`
      : undefined;
    return this.postContext("blocker", content, persona, taskId, {
      dependsOnStory,
      storyIndex,
      ...extraMetadata,
    }, sessionId);
  }

  /**
   * Post story completion to the coordination feed.
   */
  async postCompletion(
    storyIndex: number,
    summary: string,
    persona: string,
    taskId: string,
    options?: {
      branchName?: string;
      prUrl?: string;
      filesModified?: string[];
      filesCreated?: string[];
      revisionNumber?: number;
      // Phased execution metadata
      phasedExecution?: boolean;
      totalTokens?: number;
      phasesCompleted?: number;
      // Validation results
      validation?: {
        passed: boolean;
        issues: string[];
        criteriaMetRatio: string;
      };
    }
  ): Promise<ContextMessage> {
    // Generate sessionId for threading
    const sessionId = `${persona}-story-${storyIndex}`;
    return this.postContext(
      "completion",
      `${summary} complete`,
      persona,
      taskId,
      {
        storyIndex,
        branchName: options?.branchName,
        prUrl: options?.prUrl,
        filesModified: options?.filesModified,
        filesCreated: options?.filesCreated,
        revisionNumber: options?.revisionNumber ?? 0,
      },
      sessionId
    );
  }

  /**
   * Get branch names for completed dependency stories.
   * Reads completion messages from the coordination feed and extracts branchName metadata.
   * Returns a map of storyIndex → branchName for the requested dependencies.
   */
  async getDependencyBranchNames(dependencyIndices: number[]): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    if (dependencyIndices.length === 0) return result;

    const contexts = await this.getAllContexts();

    // Find completion messages with branchName metadata
    for (const ctx of contexts) {
      if (ctx.messageType !== "completion") continue;

      const storyIndex = ctx.metadata?.storyIndex as number | undefined;
      if (storyIndex === undefined) continue;

      if (!dependencyIndices.includes(storyIndex)) continue;

      const branchName = ctx.metadata?.branchName as string | undefined;
      if (branchName) {
        result.set(storyIndex, branchName);
      } else {
        console.log(`[CoordinationClient] Dependency story ${storyIndex} completion has no branchName in metadata (legacy completion)`);
      }
    }

    return result;
  }

  /**
   * Get branch names for ALL completed stories (not just declared dependencies).
   * Used by incremental rebase to merge all available sibling work before execution.
   * Returns a map of storyIndex → branchName.
   */
  async getAllCompletedBranchNames(): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    const completions = await this.getCurrentRevisionCompletions();

    for (const ctx of completions) {
      const storyIndex = ctx.metadata?.storyIndex as number | undefined;
      if (storyIndex === undefined) continue;

      const branchName = ctx.metadata?.branchName as string | undefined;
      if (branchName) {
        result.set(storyIndex, branchName);
      }
    }

    return result;
  }

  /**
   * Get sibling decisions for context building.
   */
  async getSiblingDecisions(): Promise<ContextMessage[]> {
    const contexts = await this.getAllContexts();
    return contexts.filter((ctx) => ctx.messageType === "decision");
  }

  /**
   * Get all file changes from siblings for conflict awareness.
   */
  async getSiblingFileChanges(): Promise<ContextMessage[]> {
    const contexts = await this.getAllContexts();
    return contexts.filter(
      (ctx) =>
        ctx.messageType === "file_created" ||
        ctx.messageType === "file_modified"
    );
  }

  /**
   * Get unanswered questions that target a specific persona.
   * Used to show pending questions in prompts so experts answer them.
   */
  async getQuestionsForPersona(targetPersona: string): Promise<PendingQuestion[]> {
    const allQuestions = await this.getUnansweredQuestions();

    // Filter to questions explicitly targeting this persona (Q-SECURITY-xxx pattern)
    // or questions that would be routed to this persona based on content
    return allQuestions.filter((q) => {
      // Check explicit target in metadata
      if (q.metadata?.targetPersona === targetPersona) {
        return true;
      }

      // Check if question ID contains persona hint (Q-SECURITY-001)
      const questionIdMatch = q.content.match(/Q-([A-Z_]+)-\d+/i);
      if (questionIdMatch) {
        const targetHint = questionIdMatch[1].toLowerCase();
        const personaLower = targetPersona.toLowerCase();
        // Match "security" to "security_engineer", etc.
        if (personaLower.includes(targetHint) || targetHint.includes(personaLower.split("_")[0])) {
          return true;
        }
      }

      return false;
    });
  }

  /**
   * Get recent Q&A history for context building.
   * Returns questions and their answers sorted by time.
   */
  async getRecentQandA(limit: number = 20): Promise<ContextMessage[]> {
    const contexts = await this.getAllContexts();

    // Filter to questions and answers
    const qAndA = contexts.filter(
      (ctx) => ctx.messageType === "question" || ctx.messageType === "answer"
    );

    // Sort by creation time and limit
    return qAndA
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(-limit);
  }

  /**
   * Post a revision request to the coordination feed.
   * This signals that stories need to be re-executed with feedback.
   */
  async postRevisionRequest(
    revisionNumber: number,
    feedback: string
  ): Promise<ContextMessage> {
    return this.postContext(
      "revision_requested" as ContextMessageType,
      `Revision ${revisionNumber} requested:\n\n${feedback}`,
      "tech_lead",
      undefined,
      {
        revisionNumber,
        feedback,
        requestedAt: new Date().toISOString(),
      }
    );
  }

  /**
   * Get the current revision number from the coordination feed.
   * Returns 0 if no revisions have been requested.
   */
  async getCurrentRevision(): Promise<number> {
    const contexts = await this.getAllContexts();
    const revisions = contexts.filter((c) => c.messageType === "revision_requested");

    if (revisions.length === 0) return 0;

    // Get highest revision number
    return Math.max(
      ...revisions.map((r) => (r.metadata?.revisionNumber as number) || 0)
    );
  }

  /**
   * Get the latest completion for each story, revision-aware.
   * For stories that were revised, only the latest revision's completion counts.
   * For stories that were NOT revised, the original completion carries forward.
   */
  async getCurrentRevisionCompletions(): Promise<ContextMessage[]> {
    const contexts = await this.getAllContexts();
    const currentRevision = await this.getCurrentRevision();

    // If no revisions, all completions count
    if (currentRevision === 0) {
      return contexts.filter((c) => c.messageType === "completion");
    }

    // Build a map of storyIndex → latest completion
    // For each story, keep the completion with the highest revisionNumber
    const latestByStory = new Map<number, ContextMessage>();
    for (const c of contexts) {
      if (c.messageType !== "completion") continue;
      const storyIndex = (c.metadata?.storyIndex as number) ?? -1;
      const revNum = (c.metadata?.revisionNumber as number) || 0;
      const existing = latestByStory.get(storyIndex);
      if (!existing || revNum > ((existing.metadata?.revisionNumber as number) || 0)) {
        latestByStory.set(storyIndex, c);
      }
    }

    return Array.from(latestByStory.values());
  }

  // ============================================================================
  // Blocker Handling Extensions
  // ============================================================================

  /**
   * Get all unresolved blockers from the coordination feed.
   * A blocker is unresolved if it has isEscalated=true and no corresponding resolution.
   */
  async getBlockers(): Promise<ContextMessage[]> {
    const contexts = await this.getAllContexts();

    // Find all escalated blockers
    const blockers = contexts.filter(
      (c) => c.messageType === "blocker" && c.metadata?.isEscalated === true
    );

    // Find resolved blocker IDs
    const resolvedIds = new Set<string>();
    for (const ctx of contexts) {
      if (ctx.metadata?.blockerId && ctx.metadata?.blockerAction) {
        resolvedIds.add(ctx.metadata.blockerId as string);
      }
    }

    // Return only unresolved blockers
    return blockers.filter((b) => !resolvedIds.has(b.id));
  }

  /**
   * Post an escalated blocker to the coordination feed.
   * This triggers notifications and blocks dependent stories.
   */
  async postEscalation(
    storyIndex: number,
    storyTitle: string,
    error: {
      category: string;
      message: string;
      affectedFiles: string[];
      isFixable: boolean;
      fixStrategy?: string;
    },
    persona: ExpertPersona,
    dependentStories: number[],
    autoRetryAttempts: number,
    maxAutoRetries: number
  ): Promise<ContextMessage> {
    const sessionId = `${persona}-story-${storyIndex}`;

    return this.postContext(
      "blocker",
      error.message,
      persona,
      this.parentTaskId,
      {
        storyIndex,
        storyTitle,
        persona,
        errorCategory: error.category,
        affectedFiles: error.affectedFiles,
        autoRetryAttempts,
        maxAutoRetries,
        dependentStories,
        isEscalated: true,
        isFixable: error.isFixable,
        fixStrategy: error.fixStrategy,
        escalatedAt: new Date().toISOString(),
      },
      sessionId
    );
  }

  /**
   * Post a blocker resolution to the coordination feed.
   */
  async resolveBlocker(
    blockerId: string,
    action: "retry" | "skip" | "abort",
    guidance?: string,
    respondedBy?: string
  ): Promise<ContextMessage> {
    return this.postContext(
      "answer",
      `Blocker ${blockerId} resolved: ${action}${guidance ? ` - ${guidance}` : ""}`,
      respondedBy || "system",
      this.parentTaskId,
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
   * Archive story claims and completions for selective revision.
   * When only certain stories need re-execution, archive their claims/completions
   * so the coordinator can re-claim and re-execute them.
   *
   * @param storyIndices - Array of story indices to archive claims for
   */
  async archiveStoryClaims(storyIndices: number[]): Promise<void> {
    if (storyIndices.length === 0) return;

    await this.api.post("/api/coordination/archive-claims", {
      parentTaskId: this.parentTaskId,
      storyIndices,
    });

    // Invalidate caches since story claims changed
    this.coalescer.invalidateAll();

    console.log(`[CoordinationClient] Archived claims for stories: ${storyIndices.join(", ")}`);
  }
}
