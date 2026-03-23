/**
 * Collaboration Detector for Epic Mode
 *
 * Detects and routes collaboration markers (questions, answers, decisions,
 * acknowledgments) from agent output to the coordination feed.
 *
 * Extracted from StoryExecutor to isolate collaboration detection logic.
 */

import type {
  ExpertPersona,
  ReadyStory,
  EpicConfig,
  StreamMessage,
} from "./types.js";
import type { CoordinationClient } from "./coordination-client.js";

/**
 * Tracking info for blocking questions.
 */
interface BlockingQuestion {
  id: string;
  questionId: string;
  content: string;
  targetPersona?: string;
}

/**
 * Detects collaboration markers in agent output and posts them to the coordination feed.
 */
export class CollaborationDetector {
  private config: EpicConfig;
  private coordination: CoordinationClient;
  private postLog: (
    message: string,
    expert: ExpertPersona,
    type?: "system" | "tool" | "output" | "error"
  ) => Promise<void>;
  private postCodeEvent: (
    toolName: "Write" | "Edit",
    filePath: string,
    expert: string,
    data: { content?: string; oldStr?: string; newStr?: string }
  ) => void;
  // Track blocking questions that need answers before story completes
  private pendingBlockingQuestions: Map<string, BlockingQuestion> = new Map();

  constructor(
    config: EpicConfig,
    coordination: CoordinationClient,
    postLog: (
      message: string,
      expert: ExpertPersona,
      type?: "system" | "tool" | "output" | "error"
    ) => Promise<void>,
    postCodeEvent: (
      toolName: "Write" | "Edit",
      filePath: string,
      expert: string,
      data: { content?: string; oldStr?: string; newStr?: string }
    ) => void
  ) {
    this.config = config;
    this.coordination = coordination;
    this.postLog = postLog;
    this.postCodeEvent = postCodeEvent;
  }

  /**
   * Handle a stream message from agent output.
   * Routes to dashboard logging and detects collaboration markers.
   */
  handleMessage(
    msg: StreamMessage,
    expert: ExpertPersona,
    story: ReadyStory,
    prefix: string
  ): void {
    if (msg.type === "thinking" && msg.content) {
      // Post thinking to dashboard + console (postLog handles both)
      this.postLog(`[THINKING] ${msg.content}`, expert, "output");
    } else if (msg.type === "tool_use" && msg.toolName) {
      // Format tool usage with input for visibility
      let toolMsg = `Tool: ${msg.toolName}`;
      if (msg.toolInput) {
        // Show key tool parameters (file paths, commands, etc.)
        const input = msg.toolInput;
        if (input.file_path) toolMsg += ` → ${input.file_path}`;
        else if (input.command) toolMsg += ` → ${String(input.command).substring(0, 500)}`;
        else if (input.path) toolMsg += ` → ${input.path}`;
        else if (input.pattern) toolMsg += ` → pattern: ${input.pattern}`;
        else {
          // Show first few keys for other tools
          const keys = Object.keys(input).slice(0, 3);
          if (keys.length > 0) {
            toolMsg += ` → ${keys.map(k => `${k}: ${String(input[k]).substring(0, 200)}`).join(", ")}`;
          }
        }
      }
      // Post tool usage to dashboard + console (postLog handles both)
      this.postLog(toolMsg, expert, "tool");

      // Post code events for Write/Edit tools (Live Code Viewer)
      if (msg.toolName === "Write" && msg.toolInput) {
        const input = msg.toolInput as Record<string, string>;
        this.postCodeEvent("Write", input.file_path, expert, {
          content: input.content,
        });
      } else if (msg.toolName === "Edit" && msg.toolInput) {
        const input = msg.toolInput as Record<string, string>;
        this.postCodeEvent("Edit", input.file_path, expert, {
          oldStr: input.old_string,
          newStr: input.new_string,
        });
      }
    } else if (msg.type === "text" && msg.content) {
      // Post full content to dashboard + console (postLog handles both)
      this.postLog(msg.content, expert, "output");

      // Detect and post collaboration markers to coordination feed
      // Wrapped in Promise.allSettled so individual failures don't become unhandled rejections
      Promise.allSettled([
        this.detectAndPostDecisions(msg.content, expert, story),
        this.detectAndPostQuestions(msg.content, expert, story),
        this.detectAndPostAnswers(msg.content, expert, story),
        this.detectAndPostAcknowledgments(msg.content, expert, story),
      ]).catch(() => {}); // allSettled never rejects, but safety net
    } else if (msg.type === "tool_result") {
      console.log(`${prefix} Tool result received`);
    } else if (msg.type === "result" && msg.content) {
      // Post final result to dashboard + console (postLog handles both)
      this.postLog(`Result: ${msg.content}`, expert, "output");
    }
  }

  /**
   * Check if a message contains collaboration markers worth posting to dashboard.
   * Filters out "thinking out loud" messages that clutter the feed.
   */
  isCollaborationMessage(content: string): boolean {
    // Patterns that indicate meaningful collaboration
    const collaborationPatterns = [
      /DEC-\d+:/i,              // Decision
      /Q-[A-Z0-9_-]+:/i,       // Question
      /ANSWER-[A-Z0-9_-]+:/i,  // Answer
      /CONSULT-[A-Z]+:/i,      // Consultation
      /## Summary/i,            // Summary section
      /completed.*story/i,      // Completion message
      /blocked.*waiting/i,      // Blocker message
    ];

    return collaborationPatterns.some((pattern) => pattern.test(content));
  }

  /**
   * Detect answer markers in agent output and post to coordination feed.
   * Patterns:
   * - ANSWER-FRONTEND: response (answering frontend_developer's question)
   * - ANSWER-Q-001: response (answering specific question ID)
   */
  async detectAndPostAnswers(
    content: string,
    expert: ExpertPersona,
    story: ReadyStory
  ): Promise<void> {
    // Pattern: ANSWER-{PERSONA or Q-ID}: response
    const answerPattern = /ANSWER-([A-Z0-9_-]+):\s*(.+?)(?=\n|$)/gi;
    const matches = content.matchAll(answerPattern);

    for (const match of matches) {
      const targetRef = match[1].toUpperCase();
      const answerContent = match[2].trim();

      if (answerContent.length < 10) {
        continue;
      }

      // Find the question this is answering
      const unansweredQuestions = await this.coordination.getUnansweredQuestions();
      let targetQuestion = unansweredQuestions.find((q) => {
        // Match by question ID (ANSWER-Q-001)
        if (targetRef.startsWith("Q-") && q.content.includes(targetRef)) {
          return true;
        }
        // Match by persona (ANSWER-FRONTEND)
        const targetPersona = resolveTargetPersona(targetRef);
        if (targetPersona && q.fromPersona === targetPersona) {
          return true;
        }
        // Match if question was explicitly targeting this expert
        if (q.metadata?.targetPersona === expert) {
          return true;
        }
        return false;
      });

      if (targetQuestion) {
        console.log(`[${expert}] Posting answer to ${targetQuestion.fromPersona}'s question`);
        await this.coordination.postAnswer(targetQuestion.id, answerContent, expert);
        this.postLog(`💬 Answered ${targetQuestion.fromPersona}: "${answerContent}"`, expert, "system");
      }
    }
  }

  /**
   * Detect ACK-ANSWER markers in agent output and post acknowledgment to coordination feed.
   * Pattern: ACK-ANSWER: message
   */
  detectAndPostAcknowledgments(
    content: string,
    expert: ExpertPersona,
    story: ReadyStory
  ): void {
    const ackPattern = /ACK-ANSWER:\s*(.+?)(?=\n|$)/gi;
    const matches = content.matchAll(ackPattern);

    for (const match of matches) {
      const ackContent = match[1].trim();

      if (ackContent.length > 5) {
        console.log(`[${expert}] Detected answer acknowledgment`);
        this.coordination
          .postContext(
            "answer",
            `Received answer — ${ackContent}`,
            expert,
            this.config.parentTaskId,
            { storyIndex: story.storyIndex }
          )
          .catch((err) => {
            console.error(`[${expert}] Failed to post acknowledgment:`, err);
          });
      }
    }
  }

  /**
   * Detect decision markers in agent output and post to coordination feed.
   * Pattern: DEC-xxx: description
   */
  detectAndPostDecisions(
    content: string,
    expert: ExpertPersona,
    story: ReadyStory
  ): void {
    // Match patterns like "DEC-001: I will use React Query for data fetching"
    const decisionPattern = /DEC-(\d+|[A-Z]+):\s*(.+?)(?=\n|$)/gi;
    const matches = content.matchAll(decisionPattern);

    for (const match of matches) {
      const decisionId = `DEC-${match[1]}`;
      const decisionContent = match[2].trim();

      if (decisionContent.length > 10) { // Filter out too-short matches
        console.log(`[${expert}] Detected decision: ${decisionId}`);
        // Post asynchronously, don't block
        this.coordination.postDecision(
          decisionId,
          decisionContent,
          expert,
          this.config.parentTaskId,
          { rationale: `Story ${story.storyIndex}`, storyIndex: story.storyIndex }
        ).catch((err) => {
          console.error(`[${expert}] Failed to post decision:`, err);
        });
      }
    }
  }

  /**
   * Detect question markers in agent output and post to coordination feed.
   * Patterns:
   * - Q-001: question (general question)
   * - Q-SECURITY-001: question (targets security_engineer)
   * - Q-BLOCKING-001: question (blocks until answered)
   * - Q-SECURITY-BLOCKING-001: question (targeted + blocking)
   */
  detectAndPostQuestions(
    content: string,
    expert: ExpertPersona,
    story: ReadyStory
  ): void {
    // Enhanced pattern to capture:
    // Q-{optional-target}-{optional-BLOCKING}-{id}: question
    // Examples: Q-001, Q-SECURITY-001, Q-BLOCKING-001, Q-SECURITY-BLOCKING-001
    const questionPattern = /Q-(?:([A-Z]+)-)?(?:(BLOCKING)-)?(\d+|[A-Z]+):\s*(.+?)(?=\n|$)/gi;
    const matches = content.matchAll(questionPattern);

    for (const match of matches) {
      const targetHint = match[1]?.toUpperCase(); // e.g., "SECURITY", "BACKEND"
      const isBlocking = match[2]?.toUpperCase() === "BLOCKING";
      const questionNum = match[3];
      const questionContent = match[4].trim();

      // Build question ID
      let questionId = "Q-";
      if (targetHint && targetHint !== "BLOCKING") {
        questionId += targetHint + "-";
      }
      if (isBlocking) {
        questionId += "BLOCKING-";
      }
      questionId += questionNum;

      if (questionContent.length > 10) {
        // Resolve target persona from hint
        const targetPersona = targetHint ? resolveTargetPersona(targetHint) : undefined;

        console.log(`[${expert}] Detected question: ${questionId}${targetPersona ? ` (targeting ${targetPersona})` : ""}${isBlocking ? " [BLOCKING]" : ""}`);

        // Post the question with sessionId for threading
        const sessionId = `${expert}-story-${story.storyIndex}`;
        this.coordination.postContext(
          "question",
          `${questionId}: ${questionContent}`,
          expert,
          this.config.parentTaskId,
          {
            questionId,
            fromStory: story.storyIndex,
            targetPersona,
            isBlocking,
          },
          sessionId
        ).then((ctx) => {
          // If blocking, track it for polling after execution
          if (isBlocking && ctx) {
            this.pendingBlockingQuestions.set(ctx.id, {
              id: ctx.id,
              questionId,
              content: questionContent,
              targetPersona,
            });
            this.postLog(`⏳ Posted blocking question ${questionId} - will wait for answer`, expert, "system");
          }
        }).catch((err) => {
          console.error(`[${expert}] Failed to post question:`, err);
        });
      }
    }
  }

  /**
   * Wait for answers to blocking questions with timeout.
   * Polls the coordination feed for answers to pending blocking questions.
   * Times out after 2 minutes to prevent indefinite blocking.
   */
  async waitForBlockingAnswers(expert: ExpertPersona): Promise<void> {
    const questions = Array.from(this.pendingBlockingQuestions.values());
    if (questions.length === 0) return;

    await this.postLog(
      `⏳ Waiting for ${questions.length} blocking question answer(s)...`,
      expert,
      "system"
    );

    const TIMEOUT_MS = 120000; // 2 minutes
    const POLL_INTERVAL_MS = 5000; // 5 seconds
    const startTime = Date.now();
    const answeredIds = new Set<string>();

    while (
      answeredIds.size < questions.length &&
      Date.now() - startTime < TIMEOUT_MS
    ) {
      // Check for answers to each pending question
      for (const q of questions) {
        if (answeredIds.has(q.id)) continue;

        const answer = await this.coordination.waitForAnswer(q.id, 0); // Non-blocking check
        if (answer) {
          answeredIds.add(q.id);
          await this.postLog(
            `✅ Got answer to ${q.questionId}: "${answer}"`,
            expert,
            "system"
          );
        }
      }

      // If all answered, break early
      if (answeredIds.size >= questions.length) break;

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      // Log progress every 30 seconds
      const elapsed = Date.now() - startTime;
      if (elapsed > 0 && elapsed % 30000 < POLL_INTERVAL_MS) {
        const remaining = questions.length - answeredIds.size;
        await this.postLog(
          `⏳ Still waiting for ${remaining} answer(s)... (${Math.round(elapsed / 1000)}s elapsed)`,
          expert,
          "system"
        );
      }
    }

    // Report final status
    const unanswered = questions.filter((q) => !answeredIds.has(q.id));
    if (unanswered.length > 0) {
      await this.postLog(
        `⚠️ Timed out waiting for ${unanswered.length} answer(s): ${unanswered.map((q) => q.questionId).join(", ")}`,
        expert,
        "system"
      );
    } else {
      await this.postLog(
        `✅ All blocking questions answered!`,
        expert,
        "system"
      );
    }

    // Clear tracking
    this.pendingBlockingQuestions.clear();
  }
}

/**
 * Resolve a target hint (e.g., "SECURITY") to a full persona (e.g., "security_engineer").
 */
export function resolveTargetPersona(hint: string): ExpertPersona | undefined {
  const mappings: Record<string, ExpertPersona> = {
    SECURITY: "security_engineer",
    BACKEND: "backend_developer",
    FRONTEND: "frontend_developer",
    DEVOPS: "devops_engineer",
    QA: "qa_engineer",
    WRITER: "tech_writer",
    API: "backend_developer",
    DATABASE: "backend_developer",
    DBA: "backend_developer",
    ML: "data_ml_engineer",
    DATA: "data_ml_engineer",
    IOS: "mobile_developer",
    ANDROID: "mobile_developer",
    MOBILE: "mobile_developer",
    ARCHITECT: "architect",
    TECH_LEAD: "tech_lead",
    TECHLEAD: "tech_lead",
    LEAD: "tech_lead",
  };
  return mappings[hint.toUpperCase()];
}
