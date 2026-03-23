/**
 * AI SDK Client
 *
 * AIClient implementation using Vercel AI SDK directly (no subprocess).
 * Provides multi-provider support (OpenAI, Google, Ollama, and Anthropic via AI SDK)
 * through the unified AIClient interface.
 *
 * Previously this spawned ai-sdk-executor.js as a subprocess and parsed output
 * markers from stdout. Now it calls generateText() directly as a library call.
 */

import { streamText, stepCountIs } from "ai";
import type {
  AIClient,
  AIClientCapabilities,
  AIClientConfig,
  AIClientOptions,
  AIClientResult,
  AIProvider,
  OutputMarkers,
  StreamMessage,
  TokenUsage,
} from "./types.js";
import { createModel, buildCostTrackingMetadata, buildReasoningOptions } from "./model-factory.js";
import { createToolDefinitions } from "./tools/index.js";

// Default models per provider
const PROVIDER_DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5.4",
  google: "gemini-3.1-pro",
  gemini: "gemini-3.1-pro",
  ollama: "qwen3-coder:30b",
};

// Provider capabilities
const PROVIDER_CAPABILITIES: Record<AIProvider, AIClientCapabilities> = {
  anthropic: {
    supportsCaching: false,
    maxContextTokens: 200000,
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportedTools: ["bash", "read_file", "write_file", "edit_file", "glob", "grep", "ls", "fetch", "patch", "sub_agent"],
  },
  openai: {
    supportsCaching: false,
    maxContextTokens: 128000,
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportedTools: ["bash", "read_file", "write_file", "edit_file", "glob", "grep", "ls", "fetch", "patch", "sub_agent"],
  },
  google: {
    supportsCaching: false,
    maxContextTokens: 1000000,
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportedTools: ["bash", "read_file", "write_file", "edit_file", "glob", "grep", "ls", "fetch", "patch", "sub_agent"],
  },
  gemini: {
    supportsCaching: false,
    maxContextTokens: 1000000,
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportedTools: ["bash", "read_file", "write_file", "edit_file", "glob", "grep", "ls", "fetch", "patch", "sub_agent"],
  },
  ollama: {
    supportsCaching: false,
    maxContextTokens: 32000,
    supportsStreaming: true,
    supportsStructuredOutput: false,
    supportedTools: ["bash", "read_file", "write_file", "edit_file", "glob", "grep", "ls", "fetch", "patch", "sub_agent"],
  },
};

/**
 * AI SDK Client using Vercel AI SDK directly.
 *
 * Calls generateText() in-process with tool definitions. No subprocess,
 * no output markers, no temp files, no stdout parsing.
 */
export class AISdkClient implements AIClient {
  readonly provider: AIProvider;
  readonly capabilities: AIClientCapabilities;

  private config: AIClientConfig;

  constructor(config: AIClientConfig) {
    this.config = config;
    this.provider = config.provider;
    this.capabilities = PROVIDER_CAPABILITIES[config.provider] || PROVIDER_CAPABILITIES.anthropic;
  }

  /**
   * Execute a prompt using Vercel AI SDK generateText() directly.
   */
  async execute(options: AIClientOptions): Promise<AIClientResult> {
    const messages: StreamMessage[] = [];
    const tokenUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
    };
    const markers: OutputMarkers = {};
    const modelName = options.model || PROVIDER_DEFAULT_MODELS[this.provider];

    // Set provider-specific API keys in process.env before creating the model.
    // The AI SDK provider packages read from environment variables.
    this.setProviderEnv();

    // Loop detection: AbortController must be declared before try so catch can check it
    const loopAbort = new AbortController();

    try {
      const model = createModel(this.provider, modelName);
      const tools = createToolDefinitions(options.workingDir, model);

      // Loop detection: track recent tool call signatures to detect degenerate repetition
      const recentToolSignatures: string[] = [];
      const LOOP_WINDOW = 6; // Check last 6 tool calls
      const LOOP_THRESHOLD = 4; // Abort if 4+ of last 6 are identical

      const stream = streamText({
        model,
        system: options.systemPrompt,
        prompt: options.prompt,
        tools,
        stopWhen: stepCountIs(options.maxTurns || 100),
        abortSignal: loopAbort.signal,
        timeout: {
          totalMs: options.timeoutMs || 30 * 60 * 1000,
          chunkMs: 120_000, // Abort if no data received for 2 minutes (detects stalled/dropped connections)
        },
        ...buildCostTrackingMetadata(this.provider, options.env?.ORG_ID, options.parentTaskId),
        ...buildReasoningOptions(this.provider, modelName),
        onStepFinish({ text, toolCalls, toolResults }) {
          // Emit messages in real-time as each step completes
          if (text) {
            const msg: StreamMessage = { type: "text", content: text };
            messages.push(msg);
            options.onMessage?.(msg);
          }
          if (toolCalls) {
            for (const toolCall of toolCalls) {
              const msg: StreamMessage = {
                type: "tool_use",
                toolName: toolCall.toolName,
                toolInput: toolCall.args as Record<string, unknown>,
              };
              messages.push(msg);
              options.onMessage?.(msg);

              // Track tool signature for loop detection
              const sig = `${toolCall.toolName}:${JSON.stringify(toolCall.args).substring(0, 200)}`;
              recentToolSignatures.push(sig);
              if (recentToolSignatures.length > LOOP_WINDOW) {
                recentToolSignatures.shift();
              }
              // Check for repetitive loop
              if (recentToolSignatures.length >= LOOP_WINDOW) {
                const mostCommon = recentToolSignatures.reduce((acc, s) => {
                  acc[s] = (acc[s] || 0) + 1;
                  return acc;
                }, {} as Record<string, number>);
                const maxCount = Math.max(...Object.values(mostCommon));
                if (maxCount >= LOOP_THRESHOLD) {
                  console.error(`[AISdkClient] Tool call loop detected (${maxCount}/${LOOP_WINDOW} identical calls) — aborting`);
                  loopAbort.abort();
                }
              }
            }
          }
          if (toolResults) {
            for (const toolResult of toolResults) {
              const msg: StreamMessage = {
                type: "tool_result",
                content: typeof toolResult.result === "string"
                  ? toolResult.result
                  : JSON.stringify(toolResult.result),
              };
              messages.push(msg);
              options.onMessage?.(msg);
            }
          }
        },
      });

      // Consume the stream to drive execution (required for streamText)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of stream.textStream) {
        // Stream is consumed; onStepFinish handles message emission
      }

      const result = {
        text: await stream.text,
        usage: await stream.totalUsage,
        steps: [], // Steps already processed via onStepFinish
      };

      // Final text as result message
      if (result.text) {
        messages.push({ type: "result", content: result.text });
      }

      // Extract markers from the final text output
      this.extractMarkers(result.text, markers);

      // Token usage from the AI SDK result
      if (result.usage) {
        tokenUsage.inputTokens = result.usage.promptTokens || 0;
        tokenUsage.outputTokens = result.usage.completionTokens || 0;
        // Cache token tracking (Anthropic-specific, exposed by AI SDK)
        const details = (result.usage as { inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number } }).inputTokenDetails;
        if (details) {
          tokenUsage.cacheReadTokens = details.cacheReadTokens || 0;
          tokenUsage.cacheCreationTokens = details.cacheWriteTokens || 0;
        }
      }
      options.onTokenUsage?.(tokenUsage);

      return {
        success: true,
        messages,
        tokenUsage,
        modelUsed: modelName,
        markers,
        structuredOutput: markers.reviewDecision ? {
          decision: markers.reviewDecision,
          codeQualityScore: markers.codeQualityScore,
          feedback: markers.feedback,
        } : undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check for loop detection abort
      if (loopAbort.signal.aborted) {
        return {
          success: false,
          messages,
          error: "Agent stuck in repetitive tool call loop — aborted",
          tokenUsage,
          modelUsed: modelName,
          markers: { result: "failed" },
        };
      }

      // Check for timeout (total timeout, chunk stall timeout, or abort)
      if (errorMessage.includes("aborted") || errorMessage.includes("timeout") || errorMessage.includes("Timeout")) {
        const isChunkTimeout = errorMessage.toLowerCase().includes("chunk");
        const detail = isChunkTimeout
          ? "No response data received for 2 minutes — provider connection likely dropped"
          : `Execution timed out after ${(options.timeoutMs || 30 * 60 * 1000) / 60000} minutes`;
        return {
          success: false,
          messages,
          error: detail,
          tokenUsage,
          modelUsed: modelName,
          markers: { result: "failed" },
        };
      }

      // Check for rate limit (429 or provider-specific rate limit messages)
      const isRateLimit = errorMessage.includes("429") ||
        errorMessage.toLowerCase().includes("rate limit") ||
        errorMessage.toLowerCase().includes("rate_limit") ||
        errorMessage.toLowerCase().includes("too many requests") ||
        errorMessage.toLowerCase().includes("quota exceeded");
      if (isRateLimit) {
        return {
          success: false,
          messages,
          error: errorMessage,
          tokenUsage,
          modelUsed: modelName,
          markers: { result: "failed" },
          rateLimited: true,
        };
      }

      return {
        success: false,
        messages,
        error: errorMessage,
        tokenUsage,
        modelUsed: modelName,
        markers: { result: "failed" },
      };
    }
  }

  /**
   * Set provider-specific API keys in process.env.
   * The AI SDK provider packages read credentials from environment variables.
   */
  private setProviderEnv(): void {
    switch (this.provider) {
      case "anthropic":
        if (this.config.apiKeys.anthropic) {
          process.env.ANTHROPIC_API_KEY = this.config.apiKeys.anthropic;
        }
        break;
      case "openai":
        if (this.config.apiKeys.openai) {
          process.env.OPENAI_API_KEY = this.config.apiKeys.openai;
        }
        break;
      case "google":
      case "gemini":
        if (this.config.apiKeys.google) {
          process.env.GOOGLE_API_KEY = this.config.apiKeys.google;
          process.env.GOOGLE_GENERATIVE_AI_API_KEY = this.config.apiKeys.google;
        }
        break;
      case "ollama":
        if (this.config.apiKeys.ollamaHost) {
          process.env.OLLAMA_HOST = this.config.apiKeys.ollamaHost;
        }
        break;
    }
  }

  /**
   * Extract output markers from the agent's final text output.
   * Agents are instructed to emit markers like ::result::completed, ::pr_url::..., etc.
   */
  private extractMarkers(text: string, markers: OutputMarkers): void {
    if (!text) return;

    const resultMatch = text.match(/::result::(\w+)/);
    if (resultMatch) markers.result = resultMatch[1];

    const prUrlMatch = text.match(/::pr_url::(https?:\/\/[^\s\n]+)/);
    if (prUrlMatch) markers.prUrl = prUrlMatch[1];

    const prNumberMatch = text.match(/::pr_number::(\d+)/);
    if (prNumberMatch) markers.prNumber = prNumberMatch[1];

    const branchMatch = text.match(/::branch::([^\s\n]+)/);
    if (branchMatch) markers.branch = branchMatch[1];

    const reviewMatch = text.match(/::review_decision::(approved|revision_needed|rejected)/);
    if (reviewMatch) markers.reviewDecision = reviewMatch[1] as "approved" | "revision_needed" | "rejected";

    const qualityMatch = text.match(/::code_quality_score::(\d+)/);
    if (qualityMatch) markers.codeQualityScore = parseInt(qualityMatch[1], 10);

    const feedbackMatch = text.match(/::feedback::(.+)/);
    if (feedbackMatch) markers.feedback = feedbackMatch[1].trim();

    const learningPattern = /::learning::(.+)/g;
    let learningMatch;
    const learnings: string[] = [];
    while ((learningMatch = learningPattern.exec(text)) !== null) {
      learnings.push(learningMatch[1].trim());
    }
    if (learnings.length > 0) markers.learnings = learnings;
  }
}

/**
 * Create an AI SDK Client.
 */
export function createAISdkClient(config: AIClientConfig): AIClient {
  return new AISdkClient(config);
}
