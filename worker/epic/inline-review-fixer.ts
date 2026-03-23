/**
 * Inline Review Fix Agent for Epic Mode
 *
 * Surgically applies Tech Lead review feedback to an existing worktree
 * without deleting the worktree and re-executing the story from scratch.
 * Follows the InlineCIFixer pattern.
 */

import type { AxiosInstance } from "axios";
import { createLogsApi } from "../lib/api-client.js";
import { runAgent, type AgentOptions, type AgentResult } from "./agent-sdk.js";
import type { EpicConfig, StreamMessage } from "./types.js";
import {
  createAIClient,
  type AIClient,
  type AIClientOptions,
  type AIProvider,
} from "./ai-client-types.js";

/**
 * Review fix decision from the agent.
 */
export type ReviewFixDecision = "fixed" | "unfixable";

/**
 * Result of an inline review fix attempt.
 */
export interface ReviewFixResult {
  success: boolean;
  decision: ReviewFixDecision;
  summary: string;
  error?: string;
}

/**
 * System prompt for the Review Fix Agent.
 */
const REVIEW_FIX_SYSTEM_PROMPT = `You are a Review Fix Agent. A Tech Lead reviewed a story implementation and requested changes.
Your job is to apply ONLY the requested changes — do not rewrite unrelated code.

## Rules

- Only fix what the Tech Lead asked for. Do NOT refactor or improve other code.
- Read the feedback carefully — apply every requested change.
- If the feedback references specific files or lines, start there.
- Run any relevant build/lint/test commands to verify your changes don't break anything.
- Commit with message "fix: apply review feedback — <brief description>"
- Push to the current branch.

## Organization Guidelines

If the following org-level guidelines were provided, follow them:

{{ORG_GUIDELINES}}

## Output Format

After fixing (or determining it's unfixable), you MUST output these markers:

\`\`\`
REVIEW_FIX_DECISION: fixed
\`\`\`
OR
\`\`\`
REVIEW_FIX_DECISION: unfixable
\`\`\`

Then add:
\`\`\`
REVIEW_FIX_SUMMARY: <what you fixed or why it's unfixable>
\`\`\`

## Communication Style

Write in a professional, direct tone. Do NOT open messages with filler words or pleasantries like "Perfect!", "Great!", "Awesome!", "Sure!", "Absolutely!", or similar. Start with the substance — what you found, your assessment, or what needs to change. Be concise and informative.
`;

/**
 * Inline Review Fix Agent for Epic mode.
 *
 * Applies Tech Lead review feedback surgically to an existing worktree,
 * avoiding the costly delete-and-requeue cycle.
 */
export class InlineReviewFixer {
  private config: EpicConfig;
  private worktreePath: string;
  private reviewFeedback: string;
  private expert: string;
  private storyTitle: string;
  private logsApi: AxiosInstance;
  private allOutput: string = "";
  private aiClient: AIClient | null = null;
  private model: string;

  constructor(
    config: EpicConfig,
    worktreePath: string,
    reviewFeedback: string,
    expert: string,
    storyTitle: string,
  ) {
    this.config = config;
    this.worktreePath = worktreePath;
    this.reviewFeedback = reviewFeedback;
    this.expert = expert;
    this.storyTitle = storyTitle;
    this.model = process.env.MANAGER_MODEL || config.model || "";

    this.logsApi = createLogsApi(config);

    if (config.useUnifiedClient) {
      const provider = (config.workerProvider || "anthropic") as AIProvider;
      const isAnthropic = provider === "anthropic";
      this.aiClient = createAIClient({
        provider,
        apiKeys: {
          anthropic: isAnthropic ? config.anthropicApiKey : undefined,
          ollamaHost: provider === "ollama" ? (process.env.OLLAMA_HOST || "http://localhost:11434") : undefined,
        },
        apiConfig: {
          baseUrl: config.apiBaseUrl,
          orgApiKey: config.orgApiKey,
        },
        useAgentSdk: isAnthropic,
        githubToken: config.githubToken,
        oauthToken: isAnthropic && !config.anthropicApiKey ? "mounted" : undefined,
      });
    }
  }

  /**
   * Execute an agent using either the unified AIClient or legacy runAgent.
   */
  private async executeAgent(
    options: AgentOptions,
    storyId: string,
    onMessage?: (msg: StreamMessage) => void,
  ): Promise<AgentResult> {
    if (
      this.config.useUnifiedClient &&
      this.aiClient &&
      options.expertConfig
    ) {
      const clientOptions: AIClientOptions = {
        prompt: options.prompt,
        systemPrompt: options.expertConfig.systemPrompt,
        persona: options.expertConfig.persona,
        model: options.expertConfig.model,
        workingDir: options.repoPath,
        storyId,
        parentTaskId: this.config.parentTaskId,
        env: options.env,
        tools: options.expertConfig.tools,
        onMessage,
      };
      const result = await this.aiClient.execute(clientOptions);
      return {
        success: result.success,
        messages: result.messages,
        error: result.error,
        structuredOutput: result.structuredOutput,
        rateLimited: result.rateLimited,
      };
    }
    return runAgent(this.config, { ...options, onMessage });
  }

  /**
   * Post a log message to the WorkerMill dashboard.
   */
  private async postLog(
    message: string,
    type: "system" | "manager" | "tool" | "output" | "error" = "output",
  ): Promise<void> {
    const prefix = "[📝review_fixer🤖]";
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
   * Attempt to fix review feedback on an existing worktree.
   */
  async fix(): Promise<ReviewFixResult> {
    this.allOutput = "";

    await this.postLog("Starting Review Fix Agent", "system");
    await this.postLog(
      `Story: ${this.storyTitle} | Expert: ${this.expert}`,
      "system",
    );

    try {
      const prompt = this.buildPrompt();

      const systemPrompt = REVIEW_FIX_SYSTEM_PROMPT.replace(
        "{{ORG_GUIDELINES}}",
        this.config.orgGuidelines
          ? this.config.orgGuidelines
          : "(none set — skip this section)",
      );

      const reviewFixConfig = {
        persona: "tech_lead" as const,
        description:
          "Tech Lead review feedback applicator — surgical code changes",
        systemPrompt,
        tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
        model: this.model,
        specialties: ["code-review", "refactoring", "quality"],
        maxTurns: this.config.maxAgentTurns,
      };

      const result = await this.executeAgent(
        {
          prompt,
          expertConfig: reviewFixConfig,
          repoPath: this.worktreePath,
          storyId: `review-fix-${this.expert}`,
        },
        `review-fix-${this.expert}`,
        (msg) => this.handleMessage(msg),
      );

      if (!result.success) {
        await this.postLog(
          `Review Fix Agent failed: ${result.error}`,
          "error",
        );
        return {
          success: false,
          decision: "unfixable",
          summary: `Agent execution failed: ${result.error}`,
          error: result.error,
        };
      }

      const decision = this.parseDecision();
      const summary = this.parseSummary();

      await this.postLog(`Decision: ${decision}`, "system");
      await this.postLog(`Summary: ${summary}`, "system");

      return {
        success: decision === "fixed",
        decision,
        summary,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.postLog(`Review fix failed: ${errorMessage}`, "error");

      return {
        success: false,
        decision: "unfixable",
        summary: `Review fix error: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Build the user prompt with review feedback context.
   */
  private buildPrompt(): string {
    return `## Tech Lead Review Feedback

**Repository:** ${this.config.targetRepo}
**Story:** ${this.storyTitle}
**Expert:** ${this.expert}

### Review Feedback

${this.reviewFeedback}

### Instructions

The Tech Lead reviewed this story and requested changes. Apply ONLY the feedback above. Do not rewrite unrelated code.

1. Read the feedback carefully and understand what changes are requested
2. Make the requested changes in the existing code
3. Run any relevant build/lint/test commands to verify nothing is broken
4. Commit with message "fix: apply review feedback — <brief description>"
5. Push to the current branch`;
  }

  /**
   * Parse REVIEW_FIX_DECISION from agent output.
   */
  private parseDecision(): ReviewFixDecision {
    const match = this.allOutput.match(
      /REVIEW_FIX_DECISION:\s*(fixed|unfixable)/i,
    );
    if (match) {
      return match[1].toLowerCase() as ReviewFixDecision;
    }
    // Default to unfixable if no marker found
    return "unfixable";
  }

  /**
   * Parse REVIEW_FIX_SUMMARY from agent output.
   */
  private parseSummary(): string {
    const match = this.allOutput.match(/REVIEW_FIX_SUMMARY:\s*(.+)/i);
    if (match) {
      return match[1].trim();
    }
    return "No summary provided";
  }

  /**
   * Handle streaming messages from the agent.
   */
  private handleMessage(msg: StreamMessage): void {
    if (msg.type === "thinking" && msg.content) {
      // postLog handles both console.log and API POST — don't double-log
      this.postLog(`[THINKING] ${msg.content}`, "output");
    } else if (msg.type === "tool_use" && msg.toolName) {
      let toolMsg = `Tool: ${msg.toolName}`;
      if (msg.toolInput) {
        const input = msg.toolInput;
        if (input.command)
          toolMsg += ` -> ${String(input.command).substring(0, 500)}`;
        else if (input.file_path) toolMsg += ` -> ${input.file_path}`;
      }
      this.postLog(toolMsg, "tool");
    } else if (msg.type === "text" && msg.content) {
      // Accumulate all text output for decision parsing
      this.allOutput += msg.content + "\n";

      // Log meaningful output
      if (msg.content.length > 20) {
        this.postLog(msg.content, "output");
      }
    } else if (msg.type === "result" && msg.content) {
      this.allOutput += msg.content + "\n";
      this.postLog(msg.content, "output");
    }
  }
}
