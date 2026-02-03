/**
 * Anthropic Agent Client
 *
 * AIClient implementation that wraps the existing Agent SDK (Claude CLI).
 * This provides the same real tool execution as worker/epic/agent-sdk.ts
 * but through the unified AIClient interface.
 */

import type {
  AIClient,
  AIClientCapabilities,
  AIClientConfig,
  AIClientOptions,
  AIClientResult,
  OutputMarkers,
  StreamMessage,
  TokenUsage,
} from "./types.js";
import { runAgent, type AgentOptions } from "../epic/agent-sdk.js";
import type { EpicConfig, ExpertConfig } from "../epic/types.js";

/**
 * Anthropic Agent Client using Claude CLI (Agent SDK).
 *
 * This client spawns the Claude CLI as a subprocess with real tool execution
 * (Read, Write, Edit, Bash, Glob, Grep) rather than simulating tool calls.
 */
export class AnthropicAgentClient implements AIClient {
  readonly provider = "anthropic" as const;

  readonly capabilities: AIClientCapabilities = {
    supportsCaching: true,
    maxContextTokens: 200000, // Claude's context window
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
  };

  private config: AIClientConfig;

  constructor(config: AIClientConfig) {
    this.config = config;
    if (!config.apiKeys.anthropic) {
      throw new Error("AnthropicAgentClient requires an Anthropic API key");
    }
  }

  /**
   * Execute a prompt using Claude CLI with real tool execution.
   */
  async execute(options: AIClientOptions): Promise<AIClientResult> {
    // Track token usage
    const tokenUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
    let modelUsed = options.model || "sonnet";

    // Build EpicConfig from AIClientConfig
    const epicConfig: EpicConfig = {
      parentTaskId: options.parentTaskId,
      apiBaseUrl: this.config.apiConfig.baseUrl,
      orgApiKey: this.config.apiConfig.orgApiKey,
      anthropicApiKey: this.config.apiKeys.anthropic!,
      githubToken: this.config.githubToken || "",
      targetRepo: "", // Not used for direct execution
    };

    // Build ExpertConfig from AIClientOptions
    const expertConfig: ExpertConfig = {
      persona: options.persona,
      description: `${options.persona} executing task`,
      systemPrompt: options.systemPrompt,
      tools: options.tools || this.capabilities.supportedTools,
      model: options.model,
      specialties: [],
    };

    // Build AgentOptions
    const agentOptions: AgentOptions = {
      prompt: options.prompt,
      expertConfig,
      repoPath: options.workingDir,
      storyId: options.storyId,
      env: options.env,
      onMessage: (msg: StreamMessage) => {
        // Track token usage from messages if available
        options.onMessage?.(msg);
      },
    };

    // Run the agent
    const result = await runAgent(epicConfig, agentOptions);

    // Extract markers from messages
    const markers = this.extractMarkers(result.messages);

    // Extract final token usage from last message with usage data
    // Note: The runAgent function reports tokens to the API directly
    // We capture what we can from the messages for the return value
    const lastUsage = this.extractLastTokenUsage(result.messages);
    if (lastUsage) {
      tokenUsage.inputTokens = lastUsage.inputTokens;
      tokenUsage.outputTokens = lastUsage.outputTokens;
      tokenUsage.cacheCreationTokens = lastUsage.cacheCreationTokens;
      tokenUsage.cacheReadTokens = lastUsage.cacheReadTokens;
    }

    // Extract model from result if available
    const lastResultMsg = result.messages.find((m) => m.type === "result");
    if (lastResultMsg?.structuredOutput?.model) {
      modelUsed = lastResultMsg.structuredOutput.model as string;
    }

    return {
      success: result.success,
      messages: result.messages,
      error: result.error,
      tokenUsage,
      modelUsed,
      structuredOutput: result.structuredOutput,
      markers,
    };
  }

  /**
   * Extract output markers from agent messages.
   * Markers are in the format ::marker_name::value
   */
  private extractMarkers(messages: StreamMessage[]): OutputMarkers {
    const markers: OutputMarkers = {};

    // Combine all text content
    const fullText = messages
      .filter((m) => m.type === "text" || m.type === "result")
      .map((m) => m.content || "")
      .join("\n");

    // Extract ::result:: marker
    const resultMatch = fullText.match(/::result::(\w+)/);
    if (resultMatch) {
      markers.result = resultMatch[1];
    }

    // Extract ::pr_url:: marker
    const prUrlMatch = fullText.match(/::pr_url::(https?:\/\/[^\s\n]+)/);
    if (prUrlMatch) {
      markers.prUrl = prUrlMatch[1];
    }

    // Extract ::pr_number:: marker
    const prNumberMatch = fullText.match(/::pr_number::(\d+)/);
    if (prNumberMatch) {
      markers.prNumber = prNumberMatch[1];
    }

    // Extract ::branch:: marker
    const branchMatch = fullText.match(/::branch::([^\s\n]+)/);
    if (branchMatch) {
      markers.branch = branchMatch[1];
    }

    // Extract ::review_decision:: marker
    const reviewMatch = fullText.match(/::review_decision::(approved|revision_needed|rejected)/);
    if (reviewMatch) {
      markers.reviewDecision = reviewMatch[1] as "approved" | "revision_needed" | "rejected";
    }

    // Extract ::code_quality_score:: marker
    const qualityMatch = fullText.match(/::code_quality_score::(\d+)/);
    if (qualityMatch) {
      markers.codeQualityScore = parseInt(qualityMatch[1], 10);
    }

    // Extract ::feedback:: marker (multiline support via capturing until next marker or end)
    const feedbackMatch = fullText.match(/::feedback::([^:]+(?:::(?!result|pr_url|pr_number|branch|review_decision|code_quality_score)[^:]*)*)/);
    if (feedbackMatch) {
      markers.feedback = feedbackMatch[1].trim();
    }

    return markers;
  }

  /**
   * Extract token usage from messages.
   * Note: The Agent SDK reports tokens directly to the API, so this is
   * a fallback for any usage data that might appear in messages.
   */
  private extractLastTokenUsage(messages: StreamMessage[]): TokenUsage | null {
    // Check structured output for usage data
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.structuredOutput?.usage) {
        const usage = msg.structuredOutput.usage as Record<string, number>;
        return {
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          cacheCreationTokens: usage.cache_creation_input_tokens || 0,
          cacheReadTokens: usage.cache_read_input_tokens || 0,
        };
      }
    }
    return null;
  }
}

/**
 * Create an Anthropic Agent Client.
 */
export function createAnthropicAgentClient(config: AIClientConfig): AIClient {
  return new AnthropicAgentClient(config);
}
