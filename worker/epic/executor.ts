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
import { runAgent } from "./agent-sdk.js";

/**
 * Story executor using Claude Agent SDK.
 */
export class StoryExecutor {
  private coordination: CoordinationClient;
  private gitOps: GitOps;
  private config: EpicConfig;

  constructor(
    config: EpicConfig,
    coordination: CoordinationClient,
    gitOps: GitOps
  ) {
    this.config = config;
    this.coordination = coordination;
    this.gitOps = gitOps;
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

    const expertConfig = getExpertConfig(expert);
    const storyResult: StoryResult = {
      storyId: story.id,
      storyIndex: story.storyIndex,
      success: false,
      filesModified: [],
      filesCreated: [],
      decisions: [],
    };

    try {
      // 1. Create story branch
      const branchName = await this.gitOps.createStoryBranch(
        story.storyIndex,
        story.title,
        story.jiraIssueKey
      );

      // 2. Build prompt with context
      const prompt = await this.buildPrompt(story, expert);

      // 3. Post progress update
      await this.coordination.postContext(
        "progress",
        "Starting work on Story " + story.storyIndex + ": " + story.title,
        expert,
        story.id
      );

      // 4. Execute with Agent SDK (real tool execution)
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
        const commitMessage = "feat: Story " + story.storyIndex + " - " + story.title;
        await this.gitOps.commitChanges(commitMessage, expert, story.storyIndex);

        // Push branch
        await this.gitOps.pushBranch(branchName);

        storyResult.filesModified = modifiedFiles;
      }

      // 6. Post completion
      await this.coordination.postCompletion(
        story.storyIndex,
        story.title,
        expert,
        story.id,
        {
          filesModified: modifiedFiles,
        }
      );

      storyResult.success = true;
      console.log("[Executor] Story " + story.storyIndex + " completed successfully");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[Executor] Story " + story.storyIndex + " failed:", errorMessage);

      // Post blocker
      await this.coordination.postBlocker(
        "Story " + story.storyIndex + " failed: " + errorMessage,
        expert,
        story.id
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

    return `***REMOVED*** Story ${story.storyIndex}: ${story.title}

***REMOVED******REMOVED*** Description
${story.description}

***REMOVED******REMOVED*** Constraints
${constraintsText || "None specified"}

***REMOVED******REMOVED*** Sibling Decisions
${decisionsText || "No decisions yet"}

***REMOVED******REMOVED*** Files Modified by Siblings
${fileChangesText || "No file changes yet"}

***REMOVED******REMOVED*** Your Task
Implement this story following the constraints and coordinating with sibling decisions.

***REMOVED******REMOVED******REMOVED*** Implementation Requirements
1. Read relevant files to understand the codebase
2. Make the necessary code changes using Write or Edit tools
3. Post a decision message for any architectural choices (use curl via Bash)
4. If you need input from another expert, post a question
5. Post progress updates as you work
6. When done, your changes will be committed automatically

***REMOVED******REMOVED******REMOVED*** Repository
The repository is cloned at: ${this.gitOps.getRepoPath()}

Begin your implementation now.`;
  }

  /**
   * Handle messages from agent execution for logging.
   */
  private handleMessage(
    msg: StreamMessage,
    expert: ExpertPersona,
    story: ReadyStory
  ): void {
    if (msg.type === "tool_use" && msg.toolName) {
      console.log(`[${expert}] Tool: ${msg.toolName}`);
    } else if (msg.type === "text" && msg.content) {
      // Log first 100 chars of text output
      const preview = msg.content.substring(0, 100).replace(/\n/g, " ");
      console.log(`[${expert}] ${preview}...`);
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
