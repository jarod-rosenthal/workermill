/**
 * Coordination Client for Multi-Expert Mode
 *
 * API client for communicating with the WorkerMill coordination feed.
 * Handles context posting, decision sharing, and progress updates.
 * Based on worker/epic/coordination-client.ts.
 */

import axios, { AxiosInstance } from "axios";

/**
 * Context message types supported by the coordination API.
 */
export type ContextMessageType =
  | "decision"
  | "progress"
  | "blocker"
  | "completion"
  | "question"
  | "answer"
  | "file_created"
  | "file_modified"
  | "story_ready"
  | "story_claimed"
  | "constraints"
  | "consultation";

/**
 * Context message from the coordination API.
 */
export interface ContextMessage {
  id: string;
  parentTaskId: string;
  taskId?: string;
  persona: string;
  messageType: ContextMessageType;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/**
 * Configuration for the coordination client.
 */
export interface CoordinationConfig {
  parentTaskId: string;
  apiBaseUrl: string;
  orgApiKey: string;
}

/**
 * Client for the WorkerMill coordination API.
 * Enables real-time communication between multi-expert agents.
 */
export class CoordinationClient {
  private api: AxiosInstance;
  private parentTaskId: string;

  constructor(config: CoordinationConfig) {
    this.parentTaskId = config.parentTaskId;

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
   * Post a context message to the coordination feed.
   */
  async postContext(
    messageType: ContextMessageType,
    content: string,
    persona: string,
    metadata?: Record<string, unknown>
  ): Promise<ContextMessage | null> {
    try {
      const response = await this.api.post<ContextMessage>(
        "/api/coordination/context",
        {
          parentTaskId: this.parentTaskId,
          taskId: this.parentTaskId, // Use parent task ID for multi-expert
          persona,
          messageType,
          content,
          metadata,
        }
      );
      return response.data;
    } catch (error) {
      console.warn("[CoordinationClient] Failed to post context:", error);
      return null;
    }
  }

  /**
   * Post a decision to the coordination feed.
   * Decisions are visible to sibling experts for coordination.
   */
  async postDecision(
    decisionId: string,
    content: string,
    persona: string,
    options?: {
      rationale?: string;
      impacts?: string[];
      storyIndex?: number;
    }
  ): Promise<ContextMessage | null> {
    return this.postContext(
      "decision",
      `${decisionId}: ${content}`,
      persona,
      {
        decisionId,
        rationale: options?.rationale,
        impacts: options?.impacts,
        storyIndex: options?.storyIndex,
      }
    );
  }

  /**
   * Post a progress update to the coordination feed.
   * Shows real-time activity in the dashboard communication feed.
   */
  async postProgress(
    content: string,
    persona: string,
    storyIndex?: number
  ): Promise<ContextMessage | null> {
    return this.postContext("progress", content, persona, {
      storyIndex,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Post a blocker to the coordination feed.
   * Indicates a story is blocked and cannot proceed.
   */
  async postBlocker(
    content: string,
    persona: string,
    dependsOnStory?: number
  ): Promise<ContextMessage | null> {
    return this.postContext("blocker", content, persona, {
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
    options?: {
      prUrl?: string;
      filesModified?: string[];
      filesCreated?: string[];
    }
  ): Promise<ContextMessage | null> {
    return this.postContext(
      "completion",
      `Story ${storyIndex} complete: ${summary}`,
      persona,
      {
        storyIndex,
        success: true,
        prUrl: options?.prUrl,
        filesModified: options?.filesModified,
        filesCreated: options?.filesCreated,
        completedAt: new Date().toISOString(),
      }
    );
  }

  /**
   * Post a question to the coordination feed.
   * Questions can be answered by sibling experts.
   */
  async postQuestion(
    questionId: string,
    content: string,
    persona: string,
    storyIndex?: number
  ): Promise<ContextMessage | null> {
    return this.postContext("question", `${questionId}: ${content}`, persona, {
      questionId,
      fromStory: storyIndex,
    });
  }

  /**
   * Get all context messages for the parent task.
   */
  async getAllContexts(): Promise<ContextMessage[]> {
    try {
      const response = await this.api.get<{ contexts: ContextMessage[] }>(
        `/api/coordination/context/${this.parentTaskId}`
      );
      return response.data.contexts;
    } catch (error) {
      console.warn("[CoordinationClient] Failed to get contexts:", error);
      return [];
    }
  }

  /**
   * Get completed story indices from completion messages.
   * Used for dependency checking.
   */
  async getCompletedStoryIndices(): Promise<Set<number>> {
    const contexts = await this.getAllContexts();
    const completedIndices = new Set<number>();

    for (const ctx of contexts) {
      if (ctx.messageType === "completion" && ctx.metadata?.success === true) {
        const storyIndex = ctx.metadata?.storyIndex as number | undefined;
        if (storyIndex !== undefined) {
          completedIndices.add(storyIndex);
        }
      }
    }

    return completedIndices;
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
   * Get constraints posted for this parent task.
   */
  async getConstraints(): Promise<ContextMessage[]> {
    try {
      const response = await this.api.get<{ contexts: ContextMessage[] }>(
        `/api/coordination/context/${this.parentTaskId}`,
        {
          params: {
            messageType: "constraints",
          },
        }
      );
      return response.data.contexts;
    } catch (error) {
      console.warn("[CoordinationClient] Failed to get constraints:", error);
      return [];
    }
  }

  // =============================================================================
  // Expert Consultation Methods (Phase 2: Expert-to-Expert Collaboration)
  // =============================================================================

  /**
   * Post a targeted consultation to a specific expert persona.
   * Used when one expert needs input from a specific other expert.
   *
   * @param targetPersona - The persona being consulted (e.g., "security_engineer")
   * @param content - The consultation question
   * @param fromPersona - The persona asking the question
   * @param storyIndex - Optional story index for context
   * @param blocking - If true, caller expects to wait for answer
   * @returns The posted consultation message, or null on failure
   */
  async postConsultation(
    targetPersona: string,
    content: string,
    fromPersona: string,
    storyIndex?: number,
    blocking: boolean = false
  ): Promise<ContextMessage | null> {
    return this.postContext(
      "consultation",
      content,
      fromPersona,
      {
        targetPersona,
        fromPersona,
        storyIndex,
        blocking,
        askedAt: new Date().toISOString(),
      }
    );
  }

  /**
   * Poll for answers to questions with timeout.
   * Used for blocking consultations that need a response before proceeding.
   *
   * @param questionIds - Array of question/consultation context IDs to poll for
   * @param timeoutMs - Maximum time to wait for answers (default: 60 seconds)
   * @param pollIntervalMs - How often to check for answers (default: 5 seconds)
   * @returns Map of questionId -> answer ContextMessage
   */
  async pollForAnswers(
    questionIds: string[],
    timeoutMs: number = 60000,
    pollIntervalMs: number = 5000
  ): Promise<Map<string, ContextMessage>> {
    const answers = new Map<string, ContextMessage>();
    const startTime = Date.now();
    const pendingIds = new Set(questionIds);

    while (pendingIds.size > 0 && Date.now() - startTime < timeoutMs) {
      try {
        const contexts = await this.getAllContexts();

        // Look for answers that reference any of our question IDs
        for (const ctx of contexts) {
          if (ctx.messageType === "answer") {
            const questionId = ctx.metadata?.questionId as string;
            if (questionId && pendingIds.has(questionId)) {
              answers.set(questionId, ctx);
              pendingIds.delete(questionId);
            }
          }
        }

        // All questions answered
        if (pendingIds.size === 0) {
          break;
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      } catch (error) {
        console.warn("[CoordinationClient] Error polling for answers:", error);
        // Continue polling despite errors
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }

    return answers;
  }

  /**
   * Get recent Q&A for inclusion in prompts.
   * Returns questions and their answers for context building.
   *
   * @param limit - Maximum number of Q&A pairs to return
   * @returns Array of question and answer messages, sorted by creation time
   */
  async getRecentQandA(limit: number = 20): Promise<ContextMessage[]> {
    try {
      const contexts = await this.getAllContexts();

      // Filter to questions, answers, and consultations
      const qAndA = contexts.filter(
        (ctx) =>
          ctx.messageType === "question" ||
          ctx.messageType === "answer" ||
          ctx.messageType === "consultation"
      );

      // Sort by creation time and limit
      return qAndA
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .slice(-limit);
    } catch (error) {
      console.warn("[CoordinationClient] Failed to get Q&A:", error);
      return [];
    }
  }

  /**
   * Get unanswered consultations targeting a specific persona.
   * Used to show pending consultations in an expert's prompt.
   *
   * @param persona - The persona to get consultations for
   * @returns Array of unanswered consultation messages targeting this persona
   */
  async getConsultationsForPersona(persona: string): Promise<ContextMessage[]> {
    try {
      const contexts = await this.getAllContexts();

      // Get all consultations targeting this persona
      const consultations = contexts.filter(
        (ctx) =>
          ctx.messageType === "consultation" &&
          ctx.metadata?.targetPersona === persona
      );

      // Get all answers
      const answeredIds = new Set(
        contexts
          .filter((ctx) => ctx.messageType === "answer")
          .map((ctx) => ctx.metadata?.questionId as string)
          .filter(Boolean)
      );

      // Return consultations that don't have answers yet
      return consultations.filter((c) => !answeredIds.has(c.id));
    } catch (error) {
      console.warn("[CoordinationClient] Failed to get consultations:", error);
      return [];
    }
  }

  /**
   * Answer a question or consultation from another worker.
   * Posts an answer message linked to the original question.
   *
   * @param questionId - The ID of the question/consultation context message
   * @param answer - The answer text
   * @param fromPersona - The persona providing the answer
   * @param taskId - Optional task ID for the answering worker
   * @returns The posted answer message, or null on failure
   */
  async answerQuestion(
    questionId: string,
    answer: string,
    fromPersona: string,
    taskId?: string
  ): Promise<ContextMessage | null> {
    try {
      const response = await this.api.post<{ success: boolean; context: ContextMessage }>(
        "/api/coordination/answer",
        {
          messageId: questionId,
          answer,
          persona: fromPersona,
          taskId, // Workers can provide their task ID
        }
      );

      if (response.data.success) {
        return response.data.context;
      }
      return null;
    } catch (error) {
      console.warn("[CoordinationClient] Failed to answer question:", error);
      return null;
    }
  }

  /**
   * Get all unanswered questions (questions without corresponding answers).
   * Useful for finding questions that need responses.
   */
  async getUnansweredQuestions(): Promise<ContextMessage[]> {
    try {
      const contexts = await this.getAllContexts();

      // Get all questions and consultations
      const questions = contexts.filter(
        (ctx) => ctx.messageType === "question" || ctx.messageType === "consultation"
      );

      // Get IDs of questions that have been answered
      const answeredIds = new Set(
        contexts
          .filter((ctx) => ctx.messageType === "answer")
          .map((ctx) => ctx.metadata?.questionId as string)
          .filter(Boolean)
      );

      // Return questions without answers
      return questions.filter((q) => !answeredIds.has(q.id));
    } catch (error) {
      console.warn("[CoordinationClient] Failed to get unanswered questions:", error);
      return [];
    }
  }
}
