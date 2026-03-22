/**
 * LLM Backend — Strategy Pattern for LLM Calls
 *
 * Provides a unified interface for calling LLMs, abstracting over:
 * - ClaudeCliBackend: Uses Claude CLI subprocess with OAuth (local dev with Claude Max)
 * - AiSdkBackend: Uses Vercel AI SDK with API keys (cloud production)
 *
 * The factory auto-detects which backend to use based on provider + execution mode.
 *
 * All local planning enhancements (SSE progress, phase detection, streaming JSON parsing,
 * OAuth token refresh) are preserved in ClaudeCliBackend.
 */

import { spawn } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { generateText, streamText, LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { getProviderCredentials } from "../config/index.js";
import type { ProviderId } from "../providers/types.js";
import { logger } from "../utils/logger.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Planning phase for real-time progress tracking (SSE, never persisted).
 * Carried forward from planning-agent-local.ts.
 */
export type PlanningPhase =
  | "initializing"
  | "reading_repo"
  | "analyzing"
  | "generating_plan"
  | "validating"
  | "complete";

/**
 * Token usage from an LLM call.
 */
export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalCostUsd?: number;
}

/**
 * Options for generating text from an LLM.
 */
export interface LLMGenerateOptions {
  prompt: string;
  model: string;
  maxOutputTokens?: number;
  systemPrompt?: string;
  temperature?: number;
}

/**
 * Result from a non-streaming LLM call.
 */
export interface LLMGenerateResult {
  text: string;
  usage: LLMUsage;
}

/**
 * Stream event — carries forward ALL local progress enhancement types.
 */
export interface LLMStreamEvent {
  type: "text_delta" | "tool_use" | "phase_change" | "progress" | "result";
  text?: string;
  phase?: PlanningPhase;
  detail?: string;
  usage?: LLMUsage;
  charsGenerated?: number;
  toolCallCount?: number;
}

/**
 * The LLM Backend interface — implemented by ClaudeCliBackend and AiSdkBackend.
 */
export interface LLMBackend {
  /** Non-streaming generation. */
  generate(options: LLMGenerateOptions): Promise<LLMGenerateResult>;
  /** Streaming generation with progress events. */
  stream(options: LLMGenerateOptions): AsyncGenerator<LLMStreamEvent>;
}

// ============================================================================
// CLAUDE CLI BACKEND (from planning-agent-local.ts)
// ============================================================================

/**
 * Refresh Claude OAuth token if expired or expiring soon.
 * Returns true if token is valid (either already valid or successfully refreshed).
 * Ported from planning-agent-local.ts:41-139.
 */
export async function ensureValidOAuthToken(): Promise<boolean> {
  const credsPath = join(homedir(), ".claude", ".credentials.json");

  logger.info("Checking OAuth token validity", {
    credsPath,
    homedir: homedir(),
    currentEnvToken: process.env.CLAUDE_CODE_OAUTH_TOKEN?.slice(0, 20) + "...",
  });

  if (!existsSync(credsPath)) {
    logger.warn("Claude credentials file not found - run 'claude auth login'");
    return false;
  }

  try {
    const creds = JSON.parse(readFileSync(credsPath, "utf-8"));
    const oauth = creds.claudeAiOauth;

    if (!oauth?.accessToken || !oauth?.expiresAt) {
      logger.warn("Invalid Claude credentials format");
      return false;
    }

    const currentTime = Date.now();
    const twoHours = 2 * 60 * 60 * 1000;

    // Token still valid for more than 2 hours — no refresh needed.
    // Using a 2-hour margin (instead of 30 min) so that containers spawned after
    // this refresh have at least 6+ hours of access token life. Since tasks run < 1 hour,
    // the access token never expires mid-run and Claude CLI never needs to use the
    // refresh token — eliminating the single-use refresh token race condition.
    if (currentTime < oauth.expiresAt - twoHours) {
      const hoursLeft = Math.floor((oauth.expiresAt - currentTime) / 3600000);
      logger.info("OAuth token valid", {
        hoursLeft,
        expiresAt: new Date(oauth.expiresAt).toISOString(),
        tokenPreview: oauth.accessToken?.slice(0, 20) + "...",
      });
      return true;
    }

    // Need to refresh
    logger.info("OAuth token expired or expiring soon, refreshing...");

    if (!oauth.refreshToken) {
      logger.error("No refresh token available - run 'claude auth login'");
      return false;
    }

    // Call Anthropic OAuth refresh endpoint
    const response = await fetch("https://console.anthropic.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: oauth.refreshToken,
        client_id: "claude-code",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error("Failed to refresh OAuth token", { status: response.status, error });
      return false;
    }

    const data = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!data.access_token) {
      logger.error("No access token in refresh response");
      return false;
    }

    // Update credentials file
    const expiresIn = data.expires_in || 28800; // Default 8 hours
    const newExpiresAt = Date.now() + (expiresIn * 1000);
    creds.claudeAiOauth = {
      ...oauth,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || oauth.refreshToken,
      expiresAt: newExpiresAt,
    };

    writeFileSync(credsPath, JSON.stringify(creds), "utf-8");

    // Update the in-memory environment variable so Docker containers get the fresh token
    process.env.CLAUDE_CODE_OAUTH_TOKEN = data.access_token;

    logger.info("OAuth token refreshed successfully", {
      expiresInHours: Math.floor(expiresIn / 3600),
    });

    return true;
  } catch (err) {
    logger.error("Error checking/refreshing OAuth token", { error: err });
    return false;
  }
}

/**
 * Claude CLI Backend — uses Claude CLI subprocess with OAuth authentication.
 * Preserves streaming JSON parsing, phase detection, and progress events
 * from planning-agent-local.ts:327-629.
 */
class ClaudeCliBackend implements LLMBackend {
  private claudePath: string;

  constructor() {
    this.claudePath = process.env.CLAUDE_CLI_PATH || "claude";
  }

  async generate(options: LLMGenerateOptions): Promise<LLMGenerateResult> {
    // Ensure OAuth token is valid before calling Claude CLI
    const tokenValid = await ensureValidOAuthToken();
    if (!tokenValid) {
      throw new Error("OAuth token invalid or expired. Run 'claude auth login' to re-authenticate.");
    }

    return new Promise((resolve, reject) => {
      // Let Claude CLI manage its own auth via ~/.claude/.credentials.json
      const cleanEnv = { ...process.env };
      delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;
      delete cleanEnv.CLAUDECODE;
      delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;

      // Use stream-json to get usage data from the result event
      const args = [
        "--print",
        "--verbose",
        "--output-format", "stream-json",
        "--model", options.model,
        "--permission-mode", "bypassPermissions",
        "--strict-mcp-config",
      ];
      // Note: Claude CLI does not support --max-tokens or --max-output-tokens.
      // Output limits are managed by the CLI itself. The maxOutputTokens option
      // is only used by AiSdkBackend.

      const claude = spawn(
        this.claudePath,
        args,
        {
          env: cleanEnv,
          stdio: ["pipe", "pipe", "pipe"],
        }
      );

      // Send prompt via stdin (same pattern as stream())
      claude.stdin.write(options.prompt);
      claude.stdin.end();

      let lineBuffer = "";
      let resultText = "";
      let fullText = "";
      let stderr = "";
      let usage: LLMUsage = { inputTokens: 0, outputTokens: 0 };

      claude.stdout.on("data", (data: Buffer) => {
        lineBuffer += data.toString();
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed);

            if (event.type === "assistant" && event.message?.content) {
              const content = event.message.content;
              if (typeof content === "string") {
                fullText += content;
              } else if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === "text" && block.text) fullText += block.text;
                }
              }
            } else if (event.type === "content_block_delta" && event.delta?.text) {
              fullText += event.delta.text;
            } else if (event.type === "result" && event.result) {
              resultText = typeof event.result === "string" ? event.result : "";
              if (event.usage || event.total_cost_usd !== undefined) {
                usage = {
                  inputTokens: event.usage?.input_tokens || 0,
                  outputTokens: event.usage?.output_tokens || 0,
                  cacheCreationTokens: event.usage?.cache_creation_input_tokens || 0,
                  cacheReadTokens: event.usage?.cache_read_input_tokens || 0,
                  totalCostUsd: event.total_cost_usd || 0,
                };
              }
            }
          } catch {
            fullText += trimmed + "\n";
          }
        }
      });

      claude.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      claude.on("close", (code) => {
        // Process any remaining buffered line
        if (lineBuffer.trim()) {
          try {
            const event = JSON.parse(lineBuffer.trim());
            if (event.type === "result" && event.result) {
              resultText = typeof event.result === "string" ? event.result : "";
              if (event.usage || event.total_cost_usd !== undefined) {
                usage = {
                  inputTokens: event.usage?.input_tokens || 0,
                  outputTokens: event.usage?.output_tokens || 0,
                  cacheCreationTokens: event.usage?.cache_creation_input_tokens || 0,
                  cacheReadTokens: event.usage?.cache_read_input_tokens || 0,
                  totalCostUsd: event.total_cost_usd || 0,
                };
              }
            }
          } catch {
            fullText += lineBuffer;
          }
        }

        if (code !== 0) {
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr || fullText}`.substring(0, 300)));
          return;
        }
        resolve({
          text: resultText || fullText,
          usage,
        });
      });

      claude.on("error", (err) => {
        reject(err);
      });
    });
  }

  async *stream(options: LLMGenerateOptions): AsyncGenerator<LLMStreamEvent> {
    // Ensure OAuth token is valid before calling Claude CLI
    const tokenValid = await ensureValidOAuthToken();
    if (!tokenValid) {
      throw new Error("OAuth token invalid or expired. Run 'claude auth login' to re-authenticate.");
    }

    // We use a Promise-based approach to bridge the event-driven spawn with the async generator
    const events: LLMStreamEvent[] = [];
    let resolveNext: (() => void) | null = null;
    let done = false;
    let error: Error | null = null;

    // Let Claude CLI manage its own auth
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;

    const streamArgs = [
      "--print",
      "--verbose",
      "--output-format", "stream-json",
      "--model", options.model,
      "--permission-mode", "bypassPermissions",
    ];
    // Note: Claude CLI does not support --max-tokens. See generate() comment.
    streamArgs.push(options.prompt);

    const claude = spawn(
      this.claudePath,
      streamArgs,
      {
        env: cleanEnv,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let lineBuffer = "";
    let fullText = "";
    let charsReceived = 0;
    let toolCallCount = 0;
    let currentPhase: PlanningPhase = "initializing";
    let firstTextSeen = false;
    const startTime = Date.now();
    let resultText = "";
    let usage: LLMUsage | undefined;

    const pushEvent = (event: LLMStreamEvent) => {
      events.push(event);
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    };

    // Emit initial progress
    pushEvent({
      type: "phase_change",
      phase: "initializing",
      detail: "Starting planning agent...",
      charsGenerated: 0,
      toolCallCount: 0,
    });
    // Terminal visibility: log stream start
    logger.info(`[💡 planning_agent 🤖] Claude CLI stream started`, { model: options.model });

    // Time-based phase progression
    function getTimeBasedPhase(elapsed: number): PlanningPhase {
      if (currentPhase === "validating" || currentPhase === "complete") return currentPhase;
      if (elapsed < 5) return "initializing";
      if (elapsed < 15) return "reading_repo";
      if (elapsed < 30) return "analyzing";
      return "generating_plan";
    }

    function phaseStatusLine(phase: PlanningPhase, elapsed: number): string {
      switch (phase) {
        case "initializing": return "Starting planning agent...";
        case "reading_repo": return "Reading repository structure...";
        case "analyzing": return "Analyzing requirements...";
        case "generating_plan": return `Generating execution plan... (${elapsed}s)`;
        case "validating": return "Validating plan...";
        case "complete": return "Planning complete";
      }
    }

    // Progress emission timer — sends updates every 2 seconds
    // Terminal visibility: log phase transitions and periodic progress
    let lastTerminalLogTime = 0;
    const progressInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const phase = getTimeBasedPhase(elapsed);
      if (phase !== currentPhase) {
        currentPhase = phase;
        pushEvent({
          type: "phase_change",
          phase,
          detail: phaseStatusLine(phase, elapsed),
          charsGenerated: charsReceived,
          toolCallCount,
        });
        // Terminal visibility: log phase change
        logger.info(`[💡 planning_agent 🤖] ${phaseStatusLine(phase, elapsed)}`, { charsReceived, toolCallCount });
      }
      pushEvent({
        type: "progress",
        phase: currentPhase,
        detail: phaseStatusLine(currentPhase, elapsed),
        charsGenerated: charsReceived,
        toolCallCount,
      });
      // Terminal visibility: periodic progress every 15s
      if (elapsed - lastTerminalLogTime >= 15) {
        lastTerminalLogTime = elapsed;
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        logger.info(`[💡 planning_agent 🤖] ${timeStr} elapsed`, { charsReceived, toolCallCount });
      }
    }, 2_000);

    // Parse streaming JSON lines from Claude CLI
    claude.stdout.on("data", (data: Buffer) => {
      lineBuffer += data.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed);

          if (event.type === "content_block_delta" && event.delta?.text) {
            fullText += event.delta.text;
            charsReceived += event.delta.text.length;

            pushEvent({ type: "text_delta", text: event.delta.text });

            // Phase detection: first text after tool calls → analyzing
            if (!firstTextSeen) {
              firstTextSeen = true;
              if (toolCallCount > 0 && currentPhase !== "analyzing") {
                currentPhase = "analyzing";
                pushEvent({
                  type: "phase_change",
                  phase: "analyzing",
                  detail: "Analyzing requirements...",
                  charsGenerated: charsReceived,
                  toolCallCount,
                });
              }
            }

            // Phase detection: substantial text → generating_plan
            if (charsReceived > 500 && currentPhase !== "generating_plan") {
              currentPhase = "generating_plan";
              pushEvent({
                type: "phase_change",
                phase: "generating_plan",
                detail: "Generating execution plan...",
                charsGenerated: charsReceived,
                toolCallCount,
              });
            }
          } else if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
            toolCallCount++;
            if (currentPhase === "initializing" || currentPhase === "reading_repo") {
              currentPhase = "reading_repo";
              pushEvent({
                type: "tool_use",
                phase: "reading_repo",
                detail: "Reading repository...",
                charsGenerated: charsReceived,
                toolCallCount,
              });
            }
          } else if (event.type === "assistant" && event.message?.content) {
            // Content can be a string OR an array of content blocks [{type:"text",text:"..."}]
            let text = "";
            if (typeof event.message.content === "string") {
              text = event.message.content;
            } else if (Array.isArray(event.message.content)) {
              text = event.message.content
                .filter((block: { type: string; text?: string }) => block.type === "text" && block.text)
                .map((block: { text: string }) => block.text)
                .join("");
            }
            if (text) {
              fullText += text;
              charsReceived += text.length;
              pushEvent({ type: "text_delta", text });
            }
          } else if (event.type === "result" && event.result) {
            resultText = typeof event.result === "string" ? event.result : "";
            if (event.usage || event.total_cost_usd !== undefined) {
              usage = {
                inputTokens: event.usage?.input_tokens || 0,
                outputTokens: event.usage?.output_tokens || 0,
                cacheCreationTokens: event.usage?.cache_creation_input_tokens || 0,
                cacheReadTokens: event.usage?.cache_read_input_tokens || 0,
                totalCostUsd: event.total_cost_usd || 0,
              };
            }
          }
        } catch {
          fullText += trimmed + "\n";
          charsReceived += trimmed.length;
        }
      }
    });

    let stderrOutput = "";
    claude.stderr.on("data", (data: Buffer) => {
      stderrOutput += data.toString();
    });

    claude.on("close", (code) => {
      clearInterval(progressInterval);

      // Process any remaining buffered line
      if (lineBuffer.trim()) {
        try {
          const event = JSON.parse(lineBuffer.trim());
          if (event.type === "result" && event.result) {
            resultText = typeof event.result === "string" ? event.result : "";
            if (event.usage || event.total_cost_usd !== undefined) {
              usage = {
                inputTokens: event.usage?.input_tokens || 0,
                outputTokens: event.usage?.output_tokens || 0,
                cacheCreationTokens: event.usage?.cache_creation_input_tokens || 0,
                cacheReadTokens: event.usage?.cache_read_input_tokens || 0,
                totalCostUsd: event.total_cost_usd || 0,
              };
            }
          }
        } catch {
          fullText += lineBuffer;
        }
      }

      if (code !== 0) {
        error = new Error(`Claude CLI exited with code ${code}: ${stderrOutput || fullText}`.substring(0, 300));
        // Terminal visibility: log error
        logger.error(`[💡 planning_agent 🤖] Claude CLI exited with code ${code}`);
      } else {
        // Emit final result event
        const outputText = resultText || fullText;
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        pushEvent({
          type: "result",
          text: outputText,
          usage: usage || { inputTokens: 0, outputTokens: 0 },
          phase: "complete",
          detail: `Planning complete (${elapsed}s)`,
          charsGenerated: charsReceived,
          toolCallCount,
        });
        // Terminal visibility: log completion
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        logger.info(`[💡 planning_agent 🤖] Planning complete (${timeStr})`, { charsReceived, toolCallCount, cost: usage?.totalCostUsd });
      }

      done = true;
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    });

    claude.on("error", (err) => {
      clearInterval(progressInterval);
      error = err;
      done = true;
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    });

    // Yield events as they come in
    while (true) {
      while (events.length > 0) {
        yield events.shift()!;
      }

      if (error) throw error;
      if (done && events.length === 0) return;

      // Wait for the next event
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
    }
  }
}

// ============================================================================
// AI SDK BACKEND (consolidated from planning-agent.ts + critic-agent.ts)
// ============================================================================

/**
 * Create an AI SDK model instance for the given provider.
 * Consolidated from planning-agent.ts:127-154 and critic-agent.ts:127-155.
 */
export function createAiSdkModel(
  provider: string,
  modelName: string,
  apiKey: string,
  ollamaBaseUrl?: string
): LanguageModel {
  switch (provider) {
    case "anthropic": {
      const client = createAnthropic({ apiKey });
      return client(modelName) as unknown as LanguageModel;
    }
    case "openai": {
      const client = createOpenAI({ apiKey });
      return client(modelName) as unknown as LanguageModel;
    }
    case "google":
    case "gemini": {
      const client = createGoogleGenerativeAI({ apiKey });
      return client(modelName) as unknown as LanguageModel;
    }
    case "ollama": {
      const baseUrl = ollamaBaseUrl || process.env.OLLAMA_HOST || "http://localhost:11434";
      const provider = createOpenAICompatible({ name: "ollama", baseURL: `${baseUrl}/v1`, apiKey: "ollama" });
      return provider.chatModel(modelName) as unknown as LanguageModel;
    }
    default:
      throw new Error(`Unknown provider: ${provider}. Supported: anthropic, openai, google, ollama`);
  }
}

/**
 * AI SDK Backend — uses Vercel AI SDK for multi-provider support.
 */
class AiSdkBackend implements LLMBackend {
  private provider: ProviderId;
  private orgId: string;
  private ollamaBaseUrl?: string;

  constructor(provider: ProviderId, orgId: string, ollamaBaseUrl?: string) {
    this.provider = provider;
    this.orgId = orgId;
    this.ollamaBaseUrl = ollamaBaseUrl;
  }

  private async getModel(modelName: string): Promise<LanguageModel> {
    // Get org-specific API credentials (skip for ollama which doesn't need keys)
    const apiKey = this.provider === "ollama"
      ? ""
      : await getProviderCredentials(this.orgId, this.provider);

    return createAiSdkModel(this.provider, modelName, apiKey, this.ollamaBaseUrl);
  }

  async generate(options: LLMGenerateOptions): Promise<LLMGenerateResult> {
    const model = await this.getModel(options.model);

    const result = await generateText({
      model,
      prompt: options.prompt,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature ?? 0,
    });

    return {
      text: result.text,
      usage: {
        inputTokens: result.usage?.inputTokens || 0,
        outputTokens: result.usage?.outputTokens || 0,
      },
    };
  }

  async *stream(options: LLMGenerateOptions): AsyncGenerator<LLMStreamEvent> {
    const model = await this.getModel(options.model);

    const result = streamText({
      model,
      prompt: options.prompt,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature ?? 0,
    });

    let fullText = "";
    let charsGenerated = 0;

    for await (const chunk of result.textStream) {
      fullText += chunk;
      charsGenerated += chunk.length;

      yield {
        type: "text_delta",
        text: chunk,
        charsGenerated,
      };
    }

    yield {
      type: "result",
      text: fullText,
      usage: { inputTokens: 0, outputTokens: 0 },
      charsGenerated,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Configuration for creating an LLM backend.
 */
export interface LLMBackendConfig {
  provider: string;
  orgId?: string;
  ollamaBaseUrl?: string;
}

/**
 * Create the appropriate LLM backend based on configuration.
 *
 * Auto-detects which backend to use:
 * - provider "anthropic" + EXECUTION_MODE=local → ClaudeCliBackend
 * - provider "anthropic" + LOCAL_OAUTH_MODE sentinel → ClaudeCliBackend
 * - Everything else → AiSdkBackend
 */
export function createLLMBackend(config: LLMBackendConfig): LLMBackend {
  const isLocalMode = process.env.EXECUTION_MODE === "local";

  // For Anthropic in local mode, use Claude CLI with OAuth
  if (config.provider === "anthropic" && isLocalMode) {
    logger.info("Using ClaudeCliBackend for local Anthropic", {
      provider: config.provider,
    });
    return new ClaudeCliBackend();
  }

  // For everything else (cloud Anthropic with API key, OpenAI, Google, Ollama), use AI SDK
  logger.info("Using AiSdkBackend", {
    provider: config.provider,
    orgId: config.orgId,
  });
  return new AiSdkBackend(config.provider as ProviderId, config.orgId || "", config.ollamaBaseUrl);
}

/**
 * Check if we're using the Claude CLI backend (local mode).
 * Useful for code that needs to know whether progress streaming is available.
 */
export function isLocalDevMode(): boolean {
  return process.env.EXECUTION_MODE === "local";
}
