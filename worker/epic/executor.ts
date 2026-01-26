/**
 * Story Executor for Epic Mode
 *
 * Executes individual stories using the Claude Agent SDK.
 * Epic mode uses Anthropic/Claude CLI exclusively.
 * Agents can Read, Write, Edit files and run Bash commands autonomously.
 */

import type {
  ExpertPersona,
  ReadyStory,
  StoryResult,
  ContextMessage,
  EpicConfig,
  StreamMessage,
} from "./types.js";
import { getExpertConfig } from "./experts.js";
import { CoordinationClient } from "./coordination-client.js";
import { GitOps } from "./git-ops.js";
import { JiraOps } from "./jira-ops.js";
import { runAgent } from "./agent-sdk.js";
import axios from "axios";

// Persona configs for log visibility (consistent with frontend)
const PERSONA_CONFIGS: Record<string, { emoji: string }> = {
  frontend_developer: { emoji: "🎨" },
  backend_developer: { emoji: "⚙️" },
  devops_engineer: { emoji: "🔧" },
  security_engineer: { emoji: "🔒" },
  qa_engineer: { emoji: "🧪" },
  tech_writer: { emoji: "📝" },
  project_manager: { emoji: "📋" },
  api_developer: { emoji: "🔌" },
  database_administrator: { emoji: "🗄️" },
  ml_engineer: { emoji: "🧠" },
  data_engineer: { emoji: "📊" },
  mobile_developer_ios: { emoji: "📱" },
  mobile_developer_android: { emoji: "🤖" },
  tech_lead: { emoji: "👨‍💼" },
};

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
 * Story executor using Claude Agent SDK.
 */
export class StoryExecutor {
  private coordination: CoordinationClient;
  private gitOps: GitOps;
  private jiraOps: JiraOps;
  private config: EpicConfig;
  private logsApi: ReturnType<typeof axios.create>;
  // Track blocking questions that need answers before story completes
  private pendingBlockingQuestions: Map<string, BlockingQuestion> = new Map();

  constructor(
    config: EpicConfig,
    coordination: CoordinationClient,
    gitOps: GitOps
  ) {
    this.config = config;
    this.coordination = coordination;
    this.gitOps = gitOps;
    this.jiraOps = new JiraOps(config.jiraIssueKey);

    // Create axios instance for posting logs to the dashboard
    this.logsApi = axios.create({
      baseURL: config.apiBaseUrl,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.orgApiKey,
      },
      timeout: 5000,
    });
  }

  /**
   * Get formatted log prefix with persona emoji.
   * Format: [🧪 qa_engineer] for persona visibility
   */
  private getLogPrefix(expert: ExpertPersona): string {
    const personaConfig = PERSONA_CONFIGS[expert] || { emoji: "🤖" };
    return `[${personaConfig.emoji} ${expert}]`;
  }

  /**
   * Post a log message to the WorkerMill dashboard.
   * This makes agent output visible in the task logs panel.
   */
  private async postLog(
    message: string,
    expert: ExpertPersona,
    type: "system" | "tool" | "output" | "error" = "output"
  ): Promise<void> {
    const prefix = this.getLogPrefix(expert);

    // Also log to CloudWatch
    console.log(`${prefix} ${message}`);

    try {
      await this.logsApi.post("/api/control-center/logs", {
        taskId: this.config.parentTaskId,
        type,
        message: `${prefix} ${message}`,
        severity: type === "error" ? "error" : "info",
      });
    } catch {
      // Fire and forget - don't block on log failures
    }
  }

  /**
   * Execute a story with an expert.
   * The expert agent can read, write, and edit files autonomously.
   * Uses Claude CLI (Anthropic only for Epic mode).
   */
  async executeStory(
    story: ReadyStory,
    expert: ExpertPersona
  ): Promise<StoryResult> {
    const prefix = this.getLogPrefix(expert);
    console.log(`${prefix} Starting story ${story.storyIndex}`);
    await this.postLog(`Starting Story ${story.storyIndex}: ${story.title}`, expert, "system");

    // Get expert config (Epic mode uses Anthropic with config model)
    const expertConfig = getExpertConfig(expert);
    const model = this.config.model || expertConfig.model;
    expertConfig.model = model;

    const storyResult: StoryResult = {
      storyId: story.id,
      storyIndex: story.storyIndex,
      success: false,
      filesModified: [],
      filesCreated: [],
      decisions: [],
    };

    try {
      // 1. Create story branch (use config's jiraIssueKey for consistent branch naming)
      const branchName = await this.gitOps.createStoryBranch(
        story.storyIndex,
        story.title,
        this.config.jiraIssueKey
      );
      await this.postLog(`Created branch: ${branchName}`, expert, "system");

      // 2. Build prompt with context
      const prompt = await this.buildPrompt(story, expert);

      // 3. Post progress update to coordination feed
      // Note: Use parentTaskId (valid WorkerTask ID) not story.id (WorkerContext ID)
      // Use sessionId for threading: "{persona}-story-{storyIndex}"
      const sessionId = `${expert}-story-${story.storyIndex}`;
      await this.coordination.postContext(
        "progress",
        "Starting work on Story " + story.storyIndex + ": " + story.title,
        expert,
        this.config.parentTaskId,
        { storyIndex: story.storyIndex },
        sessionId
      );
      await this.postLog(`Posted progress to communication feed`, expert, "system");

      // 4. Execute with Claude CLI (Epic mode uses Anthropic exclusively)
      await this.postLog(`Executing story with Claude CLI (model: ${model})...`, expert, "system");
      const result = await runAgent(this.config, {
        prompt,
        expertConfig,
        repoPath: this.gitOps.getRepoPath(),
        storyId: story.id,
        onMessage: (msg) => this.handleMessage(msg, expert, story),
      });

      if (!result.success) {
        throw new Error(result.error || "Agent execution failed");
      }

      // 4b. Poll for blocking question answers (Task 3)
      if (this.pendingBlockingQuestions.size > 0) {
        await this.waitForBlockingAnswers(expert);
      }

      // 5. Commit any uncommitted changes (if agent left changes unstaged/uncommitted)
      const uncommittedFiles = await this.gitOps.getModifiedFiles();
      if (uncommittedFiles.length > 0) {
        await this.postLog(`Uncommitted files found: ${uncommittedFiles.join(", ")}`, expert, "system");
        const commitMessage = "feat: Story " + story.storyIndex + " - " + story.title;
        await this.gitOps.commitChanges(commitMessage, expert, story.storyIndex);
        await this.postLog(`Committed changes`, expert, "system");
      }

      // 6. Check for any commits on the branch (including agent-committed changes)
      // The agent may have already committed changes using git directly
      const hasCommits = await this.gitOps.hasCommitsAheadOfMain();
      const changedFiles = await this.gitOps.getFilesChangedVsMain();

      if (hasCommits && changedFiles.length > 0) {
        await this.postLog(`Files changed vs main: ${changedFiles.join(", ")}`, expert, "system");

        // Post a decision message showing what files were modified
        // This gives visibility into the agent's approach
        await this.coordination.postDecision(
          `DEC-S${story.storyIndex}`,
          `Implemented by modifying: ${changedFiles.slice(0, 5).join(", ")}${changedFiles.length > 5 ? ` (+${changedFiles.length - 5} more)` : ""}`,
          expert,
          this.config.parentTaskId,
          {
            rationale: `Story ${story.storyIndex}: ${story.title}`,
            impacts: changedFiles,
            storyIndex: story.storyIndex,
          }
        );

        // Push branch (PR will be created at Epic completion with all stories consolidated)
        await this.gitOps.pushBranch(branchName);
        await this.postLog(`Pushed branch to remote (PR will be created at Epic completion)`, expert, "system");

        // Post story completion to Jira (PR link will be added at Epic completion)
        await this.jiraOps.postComment(
          `[${expert}] Story ${story.storyIndex} completed: ${story.title}\n` +
          `Branch: ${branchName}\n` +
          `Files: ${changedFiles.slice(0, 5).join(", ")}${changedFiles.length > 5 ? ` (+${changedFiles.length - 5} more)` : ""}`
        );

        storyResult.filesModified = changedFiles;
      } else if (hasCommits) {
        // Has commits but no file changes (unusual - maybe only deleted files?)
        await this.postLog(`Branch has commits ahead of main but no file changes detected`, expert, "system");
        await this.gitOps.pushBranch(branchName);
        await this.postLog(`Pushed branch to remote anyway`, expert, "system");
      } else {
        await this.postLog(`No changes to push (branch is up-to-date with main)`, expert, "system");
      }

      // 7. Post completion to coordination feed
      // Note: Use parentTaskId (valid WorkerTask ID) not story.id (WorkerContext ID)
      // Include revision number for revision-aware completion tracking
      const currentRevision = await this.coordination.getCurrentRevision();
      await this.coordination.postCompletion(
        story.storyIndex,
        story.title,
        expert,
        this.config.parentTaskId,
        {
          filesModified: changedFiles,
          revisionNumber: currentRevision,
        }
      );

      storyResult.success = true;
      console.log("[Executor] Story " + story.storyIndex + " completed successfully");
      await this.postLog(`Story ${story.storyIndex} completed successfully!`, expert, "system");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[Executor] Story " + story.storyIndex + " failed:", errorMessage);
      await this.postLog(`Story ${story.storyIndex} FAILED: ${errorMessage}`, expert, "error");

      // Post blocker to coordination feed
      // Note: Use parentTaskId (valid WorkerTask ID) not story.id (WorkerContext ID)
      await this.coordination.postBlocker(
        "Story " + story.storyIndex + " failed: " + errorMessage,
        expert,
        this.config.parentTaskId,
        undefined,  // dependsOnStory
        story.storyIndex  // storyIndex for sessionId threading
      );

      storyResult.error = errorMessage;
    }

    return storyResult;
  }

  /**
   * Build the prompt for story execution.
   * Includes pending questions, Q&A history, and sibling context.
   */
  private async buildPrompt(
    story: ReadyStory,
    expert: ExpertPersona
  ): Promise<string> {
    // Get constraints
    const constraints = await this.coordination.getConstraints();
    const constraintsText = constraints
      .map((c) => "- " + c.content)
      .join("\n");

    // Get sibling decisions
    const decisions = await this.coordination.getSiblingDecisions();
    const decisionsText = decisions
      .map((d) => "- [" + d.persona + "] " + d.content)
      .join("\n");

    // Get file changes from siblings
    const fileChanges = await this.coordination.getSiblingFileChanges();
    const fileChangesText = fileChanges
      .map((f) => {
        const filePath = (f.metadata?.filePath as string) || "";
        return "- [" + f.persona + "] " + f.messageType + ": " + filePath;
      })
      .join("\n");

    // Get pending questions for this expert (Task 1)
    const pendingQuestions = await this.coordination.getQuestionsForPersona(expert);
    const pendingQuestionsText = pendingQuestions
      .map((q) => {
        const emoji = PERSONA_CONFIGS[q.fromPersona]?.emoji || "🤖";
        return `- ⚠️ [${emoji} ${q.fromPersona}] is waiting for your answer: "${q.content}"`;
      })
      .join("\n");

    // Get recent Q&A history (Task 4)
    const recentQandA = await this.coordination.getRecentQandA(15);
    const qandAText = recentQandA
      .map((msg) => {
        const emoji = PERSONA_CONFIGS[msg.persona]?.emoji || "🤖";
        if (msg.messageType === "question") {
          return `- [${emoji} ${msg.persona}] Q: ${msg.content}`;
        } else {
          return `- [${emoji} ${msg.persona}] A: ${msg.content}`;
        }
      })
      .join("\n");

    // Build pending questions section
    const pendingSection = pendingQuestions.length > 0
      ? `***REMOVED******REMOVED*** ⚠️ PENDING QUESTIONS FOR YOU
${pendingQuestionsText}

**IMPORTANT: Please answer these questions FIRST before starting your implementation.**
To answer, output: ANSWER-{PERSONA}: Your answer here
Example: ANSWER-FRONTEND: Use httpOnly cookies for token storage, not localStorage.

`
      : "";

    // Build Q&A history section
    const qandASection = recentQandA.length > 0
      ? `***REMOVED******REMOVED*** Recent Team Q&A
${qandAText}

`
      : "";

    // Build revision feedback section (from Tech Lead review)
    const revisionSection = this.config.reviewFeedback
      ? `***REMOVED******REMOVED*** ⚠️ REVISION REQUIRED - Tech Lead Feedback
The previous implementation was reviewed and requires changes. Please address the following feedback:

${this.config.reviewFeedback}

**You MUST address this feedback in your implementation.**

`
      : "";

    return `***REMOVED*** Story ${story.storyIndex}: ${story.title}

${revisionSection}***REMOVED******REMOVED*** Description
${story.description}

${pendingSection}***REMOVED******REMOVED*** Constraints
${constraintsText || "None specified"}

***REMOVED******REMOVED*** Sibling Decisions
${decisionsText || "No decisions yet"}

***REMOVED******REMOVED*** Files Modified by Siblings
${fileChangesText || "No file changes yet"}

${qandASection}***REMOVED******REMOVED*** Your Task
Implement this story following the constraints and coordinating with sibling decisions.

***REMOVED******REMOVED******REMOVED*** Implementation Requirements
1. ${pendingQuestions.length > 0 ? "**FIRST: Answer any pending questions above**" : "Read relevant files to understand the codebase"}
2. Make the necessary code changes using Write or Edit tools
3. Post a decision message for any architectural choices: DEC-001: Your decision
4. If you need input from another expert, post a targeted question:
   - Q-SECURITY-001: Is this auth approach secure? (targets security_engineer)
   - Q-BACKEND-001: What's the API endpoint format? (targets backend_developer)
   - Q-BLOCKING-001: Critical question? (blocks until answered)
5. To answer a sibling's question: ANSWER-{PERSONA}: Your answer
6. When done, your changes will be committed automatically

***REMOVED******REMOVED******REMOVED*** Repository
The repository is cloned at: ${this.gitOps.getRepoPath()}

Begin your implementation now.`;
  }

  /**
   * Handle messages from agent execution for logging.
   * Posts to both CloudWatch (console) and WorkerMill dashboard API.
   * Also detects decision/question/answer markers and posts them to coordination feed.
   */
  private handleMessage(
    msg: StreamMessage,
    expert: ExpertPersona,
    story: ReadyStory
  ): void {
    const prefix = this.getLogPrefix(expert);

    if (msg.type === "thinking" && msg.content) {
      // Log Claude's thinking/reasoning process
      console.log(`${prefix} [THINKING] ${msg.content}`);
      // Post thinking to dashboard for visibility
      this.postLog(`[THINKING] ${msg.content}`, expert, "output");
    } else if (msg.type === "tool_use" && msg.toolName) {
      // Format tool usage with input for visibility
      let toolMsg = `Tool: ${msg.toolName}`;
      if (msg.toolInput) {
        // Show key tool parameters (file paths, commands, etc.)
        const input = msg.toolInput;
        if (input.file_path) toolMsg += ` → ${input.file_path}`;
        else if (input.command) toolMsg += ` → ${String(input.command).substring(0, 200)}`;
        else if (input.path) toolMsg += ` → ${input.path}`;
        else if (input.pattern) toolMsg += ` → pattern: ${input.pattern}`;
        else {
          // Show first few keys for other tools
          const keys = Object.keys(input).slice(0, 3);
          if (keys.length > 0) {
            toolMsg += ` → ${keys.map(k => `${k}: ${String(input[k]).substring(0, 50)}`).join(", ")}`;
          }
        }
      }
      console.log(`${prefix} ${toolMsg}`);
      // Post tool usage to dashboard for visibility
      this.postLog(toolMsg, expert, "tool");
    } else if (msg.type === "text" && msg.content) {
      // Log full text output to CloudWatch (no truncation)
      console.log(`${prefix} ${msg.content}`);
      // Post full content to dashboard for visibility
      this.postLog(msg.content, expert, "output");

      // Detect and post collaboration markers to coordination feed
      this.detectAndPostDecisions(msg.content, expert, story);
      this.detectAndPostQuestions(msg.content, expert, story);
      this.detectAndPostAnswers(msg.content, expert, story);
    } else if (msg.type === "tool_result") {
      console.log(`${prefix} Tool result received`);
    } else if (msg.type === "result" && msg.content) {
      console.log(`${prefix} Final result`);
      // Post final result to dashboard
      this.postLog(`Result: ${msg.content}`, expert, "output");
    }
  }

  /**
   * Check if a message contains collaboration markers worth posting to dashboard.
   * Filters out "thinking out loud" messages that clutter the feed.
   */
  private isCollaborationMessage(content: string): boolean {
    // Patterns that indicate meaningful collaboration
    const collaborationPatterns = [
      /DEC-\d+:/i,              // Decision
      /Q-[A-Z0-9_-]+:/i,       // Question
      /ANSWER-[A-Z0-9_-]+:/i,  // Answer
      /CONSULT-[A-Z]+:/i,      // Consultation
      /***REMOVED******REMOVED*** Summary/i,            // Summary section
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
  private async detectAndPostAnswers(
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
        const targetPersona = this.resolveTargetPersona(targetRef);
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
        this.postLog(`💬 Answered ${targetQuestion.fromPersona}: "${answerContent.substring(0, 60)}..."`, expert, "system");
      }
    }
  }

  /**
   * Detect decision markers in agent output and post to coordination feed.
   * Pattern: DEC-xxx: description
   */
  private detectAndPostDecisions(
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
  private detectAndPostQuestions(
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

      if (questionContent.length > 10 && questionContent.includes("?")) {
        // Resolve target persona from hint
        const targetPersona = targetHint ? this.resolveTargetPersona(targetHint) : undefined;

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
   * Resolve a target hint (e.g., "SECURITY") to a full persona (e.g., "security_engineer").
   */
  private resolveTargetPersona(hint: string): ExpertPersona | undefined {
    const mappings: Record<string, ExpertPersona> = {
      SECURITY: "security_engineer",
      BACKEND: "backend_developer",
      FRONTEND: "frontend_developer",
      DEVOPS: "devops_engineer",
      QA: "qa_engineer",
      WRITER: "tech_writer",
      API: "api_developer",
      DATABASE: "database_administrator",
      DBA: "database_administrator",
      ML: "ml_engineer",
      DATA: "data_engineer",
      IOS: "mobile_developer_ios",
      ANDROID: "mobile_developer_android",
      TECH_LEAD: "tech_lead",
      TECHLEAD: "tech_lead",
      LEAD: "tech_lead",
      ARCHITECT: "tech_lead",
    };
    return mappings[hint.toUpperCase()];
  }

  /**
   * Wait for answers to blocking questions with timeout.
   * Polls the coordination feed for answers to pending blocking questions.
   * Times out after 2 minutes to prevent indefinite blocking.
   */
  private async waitForBlockingAnswers(expert: ExpertPersona): Promise<void> {
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
            `✅ Got answer to ${q.questionId}: "${answer.substring(0, 80)}${answer.length > 80 ? "..." : ""}"`,
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

  /**
   * Answer a question from another expert.
   */
  async answerQuestion(
    question: ContextMessage,
    expert: ExpertPersona
  ): Promise<string | null> {
    const expertConfig = getExpertConfig(expert);
    // Use model from config (org settings) instead of hardcoded value
    if (this.config.model) {
      expertConfig.model = this.config.model;
    }

    const prompt = `A sibling expert (${question.persona}) asked:

${question.content}

Provide a concise, helpful answer based on your expertise as a ${expert}.

Format your answer as:
A-***REMOVED******REMOVED******REMOVED*** (re: Q-***REMOVED******REMOVED******REMOVED***): Your answer here

Where ***REMOVED******REMOVED******REMOVED*** matches the question ID if present.`;

    try {
      const result = await runAgent(this.config, {
        prompt,
        expertConfig,
        repoPath: this.gitOps.getRepoPath(),
        storyId: question.taskId || "",
      });

      if (!result.success) {
        console.error("[Executor] Failed to answer question:", result.error);
        return null;
      }

      // Extract text from messages
      const answerText = result.messages
        .filter((m) => m.type === "text" && m.content)
        .map((m) => m.content)
        .join("\n");

      if (answerText) {
        // Post the answer
        await this.coordination.postAnswer(question.id, answerText, expert);
        return answerText;
      }

      return null;
    } catch (error) {
      console.error("[Executor] Failed to answer question:", error);
      return null;
    }
  }
}
