/**
 * Story Executor for Epic Mode
 *
 * Executes individual stories using the Claude Agent SDK.
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

/**
 * Story executor using Claude Agent SDK.
 */
export class StoryExecutor {
  private coordination: CoordinationClient;
  private gitOps: GitOps;
  private jiraOps: JiraOps;
  private config: EpicConfig;
  private logsApi: ReturnType<typeof axios.create>;

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
   * Post a log message to the WorkerMill dashboard.
   * This makes agent output visible in the task logs panel.
   */
  private async postLog(
    message: string,
    expert: ExpertPersona,
    type: "system" | "tool" | "output" | "error" = "output"
  ): Promise<void> {
    // Also log to CloudWatch
    console.log(`[${expert}] ${message}`);

    try {
      await this.logsApi.post("/api/control-center/logs", {
        taskId: this.config.parentTaskId,
        type,
        message: `[${expert}] ${message}`,
        severity: type === "error" ? "error" : "info",
      });
    } catch {
      // Fire and forget - don't block on log failures
    }
  }

  /**
   * Execute a story with an expert.
   * The expert agent can read, write, and edit files autonomously.
   */
  async executeStory(
    story: ReadyStory,
    expert: ExpertPersona
  ): Promise<StoryResult> {
    console.log("[Executor] Starting story " + story.storyIndex + " with " + expert);
    await this.postLog(`Starting Story ${story.storyIndex}: ${story.title}`, expert, "system");

    const expertConfig = getExpertConfig(expert);
    // Use model from config (org settings) instead of hardcoded value
    if (this.config.model) {
      expertConfig.model = this.config.model;
    }
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
      await this.coordination.postContext(
        "progress",
        "Starting work on Story " + story.storyIndex + ": " + story.title,
        expert,
        this.config.parentTaskId,
        { storyIndex: story.storyIndex }
      );
      await this.postLog(`Posted progress to communication feed`, expert, "system");

      // 4. Execute with Agent SDK (real tool execution)
      await this.postLog(`Executing story with Claude CLI (model: ${expertConfig.model})...`, expert, "system");
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

      // 5. Commit changes (agent made actual file modifications)
      const modifiedFiles = await this.gitOps.getModifiedFiles();
      if (modifiedFiles.length > 0) {
        await this.postLog(`Files modified: ${modifiedFiles.join(", ")}`, expert, "system");

        // Post a decision message showing what files were modified
        // This gives visibility into the agent's approach
        await this.coordination.postDecision(
          `DEC-S${story.storyIndex}`,
          `Implemented by modifying: ${modifiedFiles.slice(0, 5).join(", ")}${modifiedFiles.length > 5 ? ` (+${modifiedFiles.length - 5} more)` : ""}`,
          expert,
          this.config.parentTaskId,
          {
            rationale: `Story ${story.storyIndex}: ${story.title}`,
            impacts: modifiedFiles,
          }
        );

        const commitMessage = "feat: Story " + story.storyIndex + " - " + story.title;
        await this.gitOps.commitChanges(commitMessage, expert, story.storyIndex);
        await this.postLog(`Committed changes`, expert, "system");

        // Push branch (PR will be created at Epic completion with all stories consolidated)
        await this.gitOps.pushBranch(branchName);
        await this.postLog(`Pushed branch to remote (PR will be created at Epic completion)`, expert, "system");

        // Post story completion to Jira (PR link will be added at Epic completion)
        await this.jiraOps.postComment(
          `[${expert}] Story ${story.storyIndex} completed: ${story.title}\n` +
          `Branch: ${branchName}\n` +
          `Files: ${modifiedFiles.slice(0, 5).join(", ")}${modifiedFiles.length > 5 ? ` (+${modifiedFiles.length - 5} more)` : ""}`
        );

        storyResult.filesModified = modifiedFiles;
      } else {
        await this.postLog(`No file changes to commit`, expert, "system");
      }

      // 6. Post completion to coordination feed
      // Note: Use parentTaskId (valid WorkerTask ID) not story.id (WorkerContext ID)
      await this.coordination.postCompletion(
        story.storyIndex,
        story.title,
        expert,
        this.config.parentTaskId,
        {
          filesModified: modifiedFiles,
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
        story.storyIndex
      );

      storyResult.error = errorMessage;
    }

    return storyResult;
  }

  /**
   * Build the prompt for story execution.
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

    return `# Story ${story.storyIndex}: ${story.title}

## Description
${story.description}

## Constraints
${constraintsText || "None specified"}

## Sibling Decisions
${decisionsText || "No decisions yet"}

## Files Modified by Siblings
${fileChangesText || "No file changes yet"}

## Your Task
Implement this story following the constraints and coordinating with sibling decisions.

### Implementation Requirements
1. Read relevant files to understand the codebase
2. Make the necessary code changes using Write or Edit tools
3. Post a decision message for any architectural choices (use curl via Bash)
4. If you need input from another expert, post a question
5. Post progress updates as you work
6. When done, your changes will be committed automatically

### Repository
The repository is cloned at: ${this.gitOps.getRepoPath()}

Begin your implementation now.`;
  }

  /**
   * Handle messages from agent execution for logging.
   * Posts to both CloudWatch (console) and WorkerMill dashboard API.
   * Also detects decision/question markers and posts them to coordination feed.
   */
  private handleMessage(
    msg: StreamMessage,
    expert: ExpertPersona,
    story: ReadyStory
  ): void {
    if (msg.type === "tool_use" && msg.toolName) {
      const toolMsg = `Tool: ${msg.toolName}`;
      console.log(`[${expert}] ${toolMsg}`);
      // Post tool usage to dashboard
      this.postLog(toolMsg, expert, "tool");
    } else if (msg.type === "text" && msg.content) {
      // Log text output (full content to dashboard, preview to console)
      const preview = msg.content.substring(0, 100).replace(/\n/g, " ");
      console.log(`[${expert}] ${preview}...`);
      // Post full content to dashboard
      this.postLog(msg.content, expert, "output");

      // Detect decision markers (DEC-xxx: ...) and post to coordination
      this.detectAndPostDecisions(msg.content, expert, story);

      // Detect question markers (Q-xxx: ...) and post to coordination
      this.detectAndPostQuestions(msg.content, expert, story);
    } else if (msg.type === "tool_result") {
      console.log(`[${expert}] Tool result received`);
    } else if (msg.type === "result" && msg.content) {
      console.log(`[${expert}] Final result`);
      this.postLog(`Result: ${msg.content}`, expert, "output");
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
          { rationale: `Story ${story.storyIndex}` }
        ).catch((err) => {
          console.error(`[${expert}] Failed to post decision:`, err);
        });
      }
    }
  }

  /**
   * Detect question markers in agent output and post to coordination feed.
   * Pattern: Q-xxx: question text
   */
  private detectAndPostQuestions(
    content: string,
    expert: ExpertPersona,
    story: ReadyStory
  ): void {
    // Match patterns like "Q-001: Should I use REST or GraphQL?"
    const questionPattern = /Q-(\d+|[A-Z]+):\s*(.+?)(?=\n|$)/gi;
    const matches = content.matchAll(questionPattern);

    for (const match of matches) {
      const questionId = `Q-${match[1]}`;
      const questionContent = match[2].trim();

      if (questionContent.length > 10 && questionContent.includes("?")) { // Questions should have a ?
        console.log(`[${expert}] Detected question: ${questionId}`);
        // Post asynchronously, don't block
        this.coordination.postContext(
          "question",
          `${questionId}: ${questionContent}`,
          expert,
          this.config.parentTaskId,
          { questionId, fromStory: story.storyIndex }
        ).catch((err) => {
          console.error(`[${expert}] Failed to post question:`, err);
        });
      }
    }
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
A-### (re: Q-###): Your answer here

Where ### matches the question ID if present.`;

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
