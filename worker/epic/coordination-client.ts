/**
 * Coordination Client for Epic Executor
 *
 * API client for communicating with the WorkerMill coordination feed.
 * Handles story claiming, context posting, and question/answer flows.
 */

import axios, { AxiosInstance } from "axios";
import type {
  ContextMessage,
  ContextMessageType,
  ReadyStory,
  PendingQuestion,
  ClaimResult,
  EpicConfig,
  ExpertPersona,
} from "./types.js";

/**
 * Client for the WorkerMill coordination API.
 */
export class CoordinationClient {
  private api: AxiosInstance;
  private parentTaskId: string;
  private orgApiKey: string;

  constructor(config: EpicConfig) {
    this.parentTaskId = config.parentTaskId;
    this.orgApiKey = config.orgApiKey;

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
   * Get all constraints posted for this parent task.
   * Constraints are frozen decisions set at the start of the Epic session.
   */
  async getConstraints(): Promise<ContextMessage[]> {
    const response = await this.api.get<{ contexts: ContextMessage[] }>(
      `/api/coordination/context/${this.parentTaskId}`,
      {
        params: {
          messageType: "constraints",
        },
      }
    );
    return response.data.contexts;
  }

  /**
   * Get all ready stories waiting to be claimed.
   */
  async getReadyStories(): Promise<ReadyStory[]> {
    const response = await this.api.get<{ contexts: ContextMessage[] }>(
      `/api/coordination/context/${this.parentTaskId}`,
      {
        params: {
          messageType: "story_ready",
        },
      }
    );

    return response.data.contexts.map((ctx) => ({
      id: ctx.id,
      parentTaskId: ctx.parentTaskId,
      storyIndex: (ctx.metadata?.storyIndex as number) ?? 0,
      persona: (ctx.metadata?.persona as ExpertPersona) ?? "backend_developer",
      title: ctx.content,
      description: ctx.content,
      dependencies: (ctx.metadata?.dependencies as number[]) ?? [],
      jiraIssueKey: ctx.metadata?.jiraIssueKey as string | undefined,
    }));
  }

  /**
   * Attempt to atomically claim a story for a persona.
   * Returns success if claimed, alreadyClaimed if another expert got there first.
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
          persona,
        }
      );
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
   */
  async getUnansweredQuestions(): Promise<PendingQuestion[]> {
    const response = await this.api.get<{ contexts: ContextMessage[] }>(
      `/api/coordination/context/${this.parentTaskId}`,
      {
        params: {
          messageType: "question",
        },
      }
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

  /**
   * Get all context messages for this parent task.
   */
  async getAllContexts(): Promise<ContextMessage[]> {
    const response = await this.api.get<{ contexts: ContextMessage[] }>(
      `/api/coordination/context/${this.parentTaskId}`
    );
    return response.data.contexts;
  }

  /**
   * Post a context message to the coordination feed.
   */
  async postContext(
    messageType: ContextMessageType,
    content: string,
    persona: string,
    taskId?: string,
    metadata?: Record<string, unknown>
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
      }
    );
    return response.data;
  }

  /**
   * Post an answer to a question.
   */
  async postAnswer(
    questionId: string,
    content: string,
    persona: string
  ): Promise<ContextMessage> {
    const response = await this.api.post<ContextMessage>(
      "/api/coordination/answer",
      {
        parentTaskId: this.parentTaskId,
        questionId,
        content,
        persona,
      }
    );
    return response.data;
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
    }
  ): Promise<ContextMessage> {
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
      }
    );
  }

  /**
   * Post a blocker to the coordination feed.
   */
  async postBlocker(
    content: string,
    persona: string,
    taskId?: string,
    dependsOnStory?: number
  ): Promise<ContextMessage> {
    return this.postContext("blocker", content, persona, taskId, {
      dependsOnStory,
    });
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
      prUrl?: string;
      filesModified?: string[];
      filesCreated?: string[];
    }
  ): Promise<ContextMessage> {
    return this.postContext(
      "completion",
      `Story ${storyIndex} complete: ${summary}`,
      persona,
      taskId,
      {
        storyIndex,
        prUrl: options?.prUrl,
        filesModified: options?.filesModified,
        filesCreated: options?.filesCreated,
      }
    );
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
}
