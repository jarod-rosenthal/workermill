/**
 * AI SDK Client
 *
 * AIClient implementation that wraps the AI SDK executor (ai-sdk-executor.js).
 * This provides multi-provider support (OpenAI, Google, Ollama, and Anthropic via AI SDK)
 * through the unified AIClient interface.
 */

import { spawn, type ChildProcess } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
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

/**
 * Get the path to the AI SDK executor script.
 * The executor is at worker/agents/ai-sdk-executor.js relative to the worker root.
 * In containers, this is /app/agents/ai-sdk-executor.js.
 * Locally, we use the WORKER_ROOT environment variable or default to process.cwd().
 */
function getExecutorPath(): string {
  // In ECS containers, the worker is at /app
  const workerRoot = process.env.WORKER_ROOT || "/app";
  return join(workerRoot, "agents", "ai-sdk-executor.js");
}

// Default models per provider (must match ai-sdk-executor.js)
const PROVIDER_DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
  gemini: "gemini-2.0-flash",
  ollama: "qwen2.5-coder:32b",
};

// Provider capabilities
const PROVIDER_CAPABILITIES: Record<AIProvider, AIClientCapabilities> = {
  anthropic: {
    supportsCaching: false, // AI SDK doesn't expose caching
    maxContextTokens: 200000,
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportedTools: ["bash", "read_file", "write_file", "edit_file", "glob", "grep"],
  },
  openai: {
    supportsCaching: false,
    maxContextTokens: 128000, // GPT-4o context
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportedTools: ["bash", "read_file", "write_file", "edit_file", "glob", "grep"],
  },
  google: {
    supportsCaching: false,
    maxContextTokens: 1000000, // Gemini 2.0 Pro
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportedTools: ["bash", "read_file", "write_file", "edit_file", "glob", "grep"],
  },
  gemini: {
    supportsCaching: false,
    maxContextTokens: 1000000,
    supportsStreaming: true,
    supportsStructuredOutput: true,
    supportedTools: ["bash", "read_file", "write_file", "edit_file", "glob", "grep"],
  },
  ollama: {
    supportsCaching: false,
    maxContextTokens: 32000, // Depends on model
    supportsStreaming: true,
    supportsStructuredOutput: false, // Most Ollama models don't support JSON mode well
    supportedTools: ["bash", "read_file", "write_file", "edit_file", "glob", "grep"],
  },
};

/**
 * AI SDK Client using Vercel AI SDK via subprocess.
 *
 * This client spawns ai-sdk-executor.js as a child process and parses
 * output markers to extract results, PR URLs, token counts, etc.
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
   * Execute a prompt using AI SDK executor subprocess.
   */
  async execute(options: AIClientOptions): Promise<AIClientResult> {
    const messages: StreamMessage[] = [];
    const tokenUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
    };
    const markers: OutputMarkers = {};
    let modelUsed = options.model || PROVIDER_DEFAULT_MODELS[this.provider];
    let tempPromptFile: string | null = null;

    try {
      // Write prompt to temp file
      tempPromptFile = await this.writeTempPromptFile(options.prompt);

      // Build environment variables for the executor
      const env = this.buildEnvironment(options);

      // Build CLI arguments
      const args = this.buildArgs(options, tempPromptFile);

      // Spawn the executor process
      const result = await this.spawnExecutor(args, env, options, messages, tokenUsage, markers);

      // Extract model from markers if available
      if (markers.result === undefined && result.exitCode !== 0) {
        markers.result = "failed";
      }

      // Use extracted model if available
      if (result.model) {
        modelUsed = result.model;
      }

      return {
        success: result.exitCode === 0 && markers.result !== "failed",
        messages,
        error: result.exitCode !== 0 ? result.stderr || `Process exited with code ${result.exitCode}` : undefined,
        tokenUsage,
        modelUsed,
        structuredOutput: result.structuredOutput,
        markers,
      };
    } finally {
      // Clean up temp file
      if (tempPromptFile) {
        try {
          await unlink(tempPromptFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Write the prompt to a temporary file.
   */
  private async writeTempPromptFile(prompt: string): Promise<string> {
    const tempDir = tmpdir();
    const fileName = `workermill-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
    const filePath = join(tempDir, fileName);
    await writeFile(filePath, prompt, "utf-8");
    return filePath;
  }

  /**
   * Build environment variables for the executor.
   */
  private buildEnvironment(options: AIClientOptions): Record<string, string> {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      // Pass through any additional env vars
      ...(options.env || {}),
      // Working directory
      AGENT_WORKING_DIR: options.workingDir,
      // System prompt via env var
      AGENT_SYSTEM_PROMPT: options.systemPrompt,
      // Max steps
      AGENT_MAX_STEPS: String(options.maxTurns || 100),
      // Task context for cost tracking
      ORG_ID: options.env?.ORG_ID || "",
      TASK_ID: options.parentTaskId || "",
      // Enable streaming for real-time token tracking
      AGENT_STREAMING: "true",
    };

    // Set provider-specific API keys
    switch (this.provider) {
      case "anthropic":
        if (this.config.apiKeys.anthropic) {
          env.ANTHROPIC_API_KEY = this.config.apiKeys.anthropic;
        }
        break;
      case "openai":
        if (this.config.apiKeys.openai) {
          env.OPENAI_API_KEY = this.config.apiKeys.openai;
        }
        break;
      case "google":
      case "gemini":
        if (this.config.apiKeys.google) {
          env.GOOGLE_API_KEY = this.config.apiKeys.google;
          env.GOOGLE_GENERATIVE_AI_API_KEY = this.config.apiKeys.google;
        }
        break;
      case "ollama":
        if (this.config.apiKeys.ollamaHost) {
          env.OLLAMA_HOST = this.config.apiKeys.ollamaHost;
        }
        break;
    }

    return env;
  }

  /**
   * Build CLI arguments for ai-sdk-executor.js.
   */
  private buildArgs(options: AIClientOptions, promptFile: string): string[] {
    const args: string[] = [
      getExecutorPath(),
      "--provider",
      this.provider,
      "--persona",
      options.persona,
      "--prompt-file",
      promptFile,
    ];

    // Add model if specified (otherwise executor uses default)
    const model = options.model || PROVIDER_DEFAULT_MODELS[this.provider];
    if (model) {
      args.push("--model", model);
    }

    return args;
  }

  /**
   * Spawn the executor process and parse output.
   */
  private async spawnExecutor(
    args: string[],
    env: Record<string, string>,
    options: AIClientOptions,
    messages: StreamMessage[],
    tokenUsage: TokenUsage,
    markers: OutputMarkers
  ): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    model?: string;
    structuredOutput?: Record<string, unknown>;
  }> {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let extractedModel: string | undefined;
      let structuredOutput: Record<string, unknown> | undefined;

      // Set timeout
      const timeoutMs = options.timeoutMs || 30 * 60 * 1000; // 30 minutes default
      let timeoutId: NodeJS.Timeout | null = null;

      const process: ChildProcess = spawn("node", args, {
        env,
        cwd: options.workingDir,
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Set timeout
      timeoutId = setTimeout(() => {
        process.kill("SIGTERM");
        reject(new Error(`Executor timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      // Parse stdout line by line
      let stdoutBuffer = "";
      process.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        stdoutBuffer += chunk;

        // Process complete lines
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          this.parseLine(line, messages, tokenUsage, markers, options);

          // Extract model from ::model:: marker
          const modelMatch = line.match(/::model::(.+)/);
          if (modelMatch) {
            extractedModel = modelMatch[1].trim();
          }
        }
      });

      // Capture stderr
      process.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      process.on("error", (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        reject(error);
      });

      process.on("close", (exitCode) => {
        if (timeoutId) clearTimeout(timeoutId);

        // Process any remaining buffered output
        if (stdoutBuffer) {
          this.parseLine(stdoutBuffer, messages, tokenUsage, markers, options);
        }

        // Build structured output from review markers if present
        if (markers.reviewDecision) {
          structuredOutput = {
            decision: markers.reviewDecision,
            codeQualityScore: markers.codeQualityScore,
            feedback: markers.feedback,
          };
        }

        resolve({
          exitCode: exitCode ?? 1,
          stdout,
          stderr,
          model: extractedModel,
          structuredOutput,
        });
      });
    });
  }

  /**
   * Parse a single line of output for markers and messages.
   */
  private parseLine(
    line: string,
    messages: StreamMessage[],
    tokenUsage: TokenUsage,
    markers: OutputMarkers,
    options: AIClientOptions
  ): void {
    const trimmedLine = line.trim();
    if (!trimmedLine) return;

    // Check for output markers
    // ::result::VALUE
    const resultMatch = trimmedLine.match(/^::result::(\w+)$/);
    if (resultMatch) {
      markers.result = resultMatch[1];
      messages.push({ type: "result", content: resultMatch[1] });
      return;
    }

    // ::pr_url::URL
    const prUrlMatch = trimmedLine.match(/^::pr_url::(https?:\/\/[^\s]+)$/);
    if (prUrlMatch) {
      markers.prUrl = prUrlMatch[1];
      return;
    }

    // ::pr_number::NUMBER
    const prNumberMatch = trimmedLine.match(/^::pr_number::(\d+)$/);
    if (prNumberMatch) {
      markers.prNumber = prNumberMatch[1];
      return;
    }

    // ::branch::NAME
    const branchMatch = trimmedLine.match(/^::branch::([^\s]+)$/);
    if (branchMatch) {
      markers.branch = branchMatch[1];
      return;
    }

    // ::input_tokens::NUMBER
    const inputTokensMatch = trimmedLine.match(/^::input_tokens::(\d+)$/);
    if (inputTokensMatch) {
      tokenUsage.inputTokens = parseInt(inputTokensMatch[1], 10);
      // Notify callback of token usage update
      options.onTokenUsage?.(tokenUsage);
      return;
    }

    // ::output_tokens::NUMBER
    const outputTokensMatch = trimmedLine.match(/^::output_tokens::(\d+)$/);
    if (outputTokensMatch) {
      tokenUsage.outputTokens = parseInt(outputTokensMatch[1], 10);
      // Notify callback of token usage update
      options.onTokenUsage?.(tokenUsage);
      return;
    }

    // ::model::NAME (handled in spawnExecutor for return value)
    if (trimmedLine.startsWith("::model::")) {
      return;
    }

    // ::review_decision::VALUE
    const reviewDecisionMatch = trimmedLine.match(/^::review_decision::(approved|revision_needed|rejected)$/);
    if (reviewDecisionMatch) {
      markers.reviewDecision = reviewDecisionMatch[1] as "approved" | "revision_needed" | "rejected";
      return;
    }

    // ::code_quality_score::NUMBER
    const qualityScoreMatch = trimmedLine.match(/^::code_quality_score::(\d+)$/);
    if (qualityScoreMatch) {
      markers.codeQualityScore = parseInt(qualityScoreMatch[1], 10);
      return;
    }

    // ::feedback::TEXT
    const feedbackMatch = trimmedLine.match(/^::feedback::(.+)$/);
    if (feedbackMatch) {
      markers.feedback = feedbackMatch[1];
      return;
    }

    // ::error::TEXT
    const errorMatch = trimmedLine.match(/^::error::(.+)$/);
    if (errorMatch) {
      messages.push({ type: "error", content: errorMatch[1] });
      return;
    }

    // Check for tool usage patterns (Epic style: [persona] Tool: name - summary)
    const toolMatch = trimmedLine.match(/^\[.+\] Tool: (\w+)(?: - (.*))?$/);
    if (toolMatch) {
      messages.push({
        type: "tool_use",
        toolName: toolMatch[1],
        content: toolMatch[2] || "",
      });
      return;
    }

    // All other output is text
    // Filter out log prefix lines that are just status messages
    if (
      !trimmedLine.startsWith("[") ||
      trimmedLine.includes("Starting agent") ||
      trimmedLine.includes("Agent execution completed")
    ) {
      // Skip status messages but keep substantive text
      if (
        !trimmedLine.includes("Provider:") &&
        !trimmedLine.includes("Using streaming") &&
        !trimmedLine.includes("Using blocking") &&
        !trimmedLine.includes("Token tracking") &&
        !trimmedLine.includes("Partial token update") &&
        !trimmedLine.includes("Cost tracking")
      ) {
        // Only add as text message if it has substantive content
        if (trimmedLine.length > 0) {
          messages.push({ type: "text", content: trimmedLine });
          options.onMessage?.({ type: "text", content: trimmedLine });
        }
      }
    }
  }
}

/**
 * Create an AI SDK Client.
 */
export function createAISdkClient(config: AIClientConfig): AIClient {
  return new AISdkClient(config);
}
