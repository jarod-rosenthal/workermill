/**
 * Agent SDK Wrapper for Virtual Manager
 *
 * Spawns the Claude CLI (@anthropic-ai/claude-code) as a subprocess
 * with streaming JSON output for real tool execution.
 */

import { spawn, ChildProcess } from "child_process";
import { createInterface } from "readline";
import axios from "axios";
import type { ManagerConfig, StreamMessage, AgentResult } from "./types.js";

/**
 * Token usage tracking for cost reporting.
 */
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface AgentOptions {
  prompt: string;
  systemPrompt: string;
  workingDir: string;
  model: string;
  maxTurns?: number;
  env?: Record<string, string>;
  onMessage?: (msg: StreamMessage) => void;
}

/**
 * Run an agent with real tool execution via Claude CLI.
 * The agent can Read, Write, Edit files and run Bash commands.
 */
export async function runAgent(
  config: ManagerConfig,
  options: AgentOptions
): Promise<AgentResult> {
  const messages: StreamMessage[] = [];

  // Track token usage for cost reporting
  const tokenUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
  let modelUsed = options.model || "opus";
  let lastPartialReportTime = 0;
  const PARTIAL_REPORT_INTERVAL = 30000; // 30 seconds

  // Build environment variables
  const agentEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...options.env,
    API_BASE_URL: config.apiBaseUrl,
    ORG_API_KEY: config.orgApiKey,
    TASK_ID: config.taskId,
    ANTHROPIC_API_KEY: config.anthropicApiKey,
    GITHUB_TOKEN: config.githubToken,
    GH_TOKEN: config.githubToken, // For gh CLI
  };

  // Claude CLI is installed globally in the container
  const claudeCli = "claude";

  // Build CLI arguments
  const args: string[] = [
    "--print", // Non-interactive mode
    "--verbose", // Required for stream-json with --print
    "--output-format", "stream-json", // Streaming JSON output
    "--model", mapModel(options.model),
    "--permission-mode", "bypassPermissions", // Allow all tool execution
  ];

  // Set max turns if specified
  if (options.maxTurns) {
    args.push("--max-turns", String(options.maxTurns));
  }

  // Allowed tools for manager
  const allowedTools = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];
  args.push("--allowedTools", allowedTools.join(","));

  // Combine system prompt with main prompt
  const fullPrompt = options.systemPrompt + "\n\n---\n\n" + options.prompt;

  console.log(`[Manager] Spawning Claude CLI`);
  console.log(`[Manager] Working directory: ${options.workingDir}`);
  console.log(`[Manager] Model: ${mapModel(options.model)}`);
  console.log(`[Manager] Max turns: ${options.maxTurns || "default"}`);

  return new Promise((resolve) => {
    let agentProcess: ChildProcess;

    try {
      agentProcess = spawn(claudeCli, args, {
        cwd: options.workingDir,
        env: agentEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });

      console.log(`[Manager] Process spawned, PID: ${agentProcess.pid}`);

      // Write prompt to stdin and close
      agentProcess.stdin!.write(fullPrompt);
      agentProcess.stdin!.end();
      console.log(`[Manager] Wrote prompt to stdin (${fullPrompt.length} chars)`);
    } catch (spawnError) {
      const errorMsg = spawnError instanceof Error ? spawnError.message : String(spawnError);
      console.error("[Manager] Failed to spawn Claude CLI:", errorMsg);
      resolve({
        success: false,
        messages,
        error: `Failed to spawn Claude CLI: ${errorMsg}`,
      });
      return;
    }

    let lastOutput = "";
    let hasError = false;
    let errorMessage = "";

    // Log raw stdout for debugging
    agentProcess.stdout!.on("data", (data: Buffer) => {
      console.log(`[Manager] stdout: ${data.toString()}`);
    });

    // Process stdout line by line (stream-json outputs one JSON per line)
    const rl = createInterface({
      input: agentProcess.stdout!,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      if (!line.trim()) return;

      try {
        const event = JSON.parse(line);
        const parsedMessages = parseStreamEvent(event);

        // Extract token usage from event
        const hadUsage = extractUsageFromEvent(event, tokenUsage);

        // Track model if specified
        if (event.model) {
          modelUsed = event.model;
        }

        // Report partial tokens periodically
        const now = Date.now();
        if (hadUsage && now - lastPartialReportTime >= PARTIAL_REPORT_INTERVAL) {
          lastPartialReportTime = now;
          reportPartialTokenUsage(config, tokenUsage, modelUsed).catch((err) => {
            console.error("[Manager] Failed to report partial tokens:", err);
          });
        }

        // Process ALL messages from this event
        for (const streamMsg of parsedMessages) {
          messages.push(streamMsg);
          options.onMessage?.(streamMsg);

          // Track the last text output
          if (streamMsg.type === "text" && streamMsg.content) {
            lastOutput = streamMsg.content;
          } else if (streamMsg.type === "result" && streamMsg.content) {
            lastOutput = streamMsg.content;
          }
        }
      } catch {
        // Not JSON, might be raw output
        console.log(`[Manager] Raw output: ${line}`);
      }
    });

    // Capture stderr for errors
    let stderrBuffer = "";
    agentProcess.stderr!.on("data", (data: Buffer) => {
      const text = data.toString();
      stderrBuffer += text;
      console.error(`[Manager] stderr: ${text.trim()}`);
    });

    agentProcess.on("error", (err) => {
      hasError = true;
      errorMessage = err.message;
      console.error("[Manager] Process error:", err.message);
    });

    agentProcess.on("close", async (code) => {
      console.log(`[Manager] Process exited with code ${code}`);
      if (stderrBuffer) {
        console.log(`[Manager] stderr buffer: ${stderrBuffer.substring(0, 500)}`);
      }
      if (code !== 0 && !hasError) {
        hasError = true;
        errorMessage = stderrBuffer || `Process exited with code ${code}`;
      }

      // Report final token usage
      console.log(`[Manager] Final token usage: input=${tokenUsage.inputTokens}, output=${tokenUsage.outputTokens}`);
      try {
        await reportPartialTokenUsage(config, tokenUsage, modelUsed);
        console.log(`[Manager] Token usage reported successfully`);
      } catch (err) {
        console.error(`[Manager] Failed to report final token usage:`, err);
      }

      if (hasError) {
        console.error(`[Manager] Agent failed: ${errorMessage}`);
        resolve({
          success: false,
          messages,
          error: errorMessage,
        });
      } else {
        console.log(`[Manager] Agent completed successfully`);

        // Add final result message if we have output
        if (lastOutput && !messages.some((m) => m.type === "result")) {
          const resultMsg: StreamMessage = { type: "result", content: lastOutput };
          messages.push(resultMsg);
          options.onMessage?.(resultMsg);
        }

        resolve({ success: true, messages });
      }
    });
  });
}

/**
 * Extract token usage from a stream event.
 */
function extractUsageFromEvent(event: Record<string, unknown>, tokenUsage: TokenUsage): boolean {
  const usagePaths = [
    event.usage,
    (event.message as Record<string, unknown>)?.usage,
    (event.result as Record<string, unknown>)?.usage,
    (event.delta as Record<string, unknown>)?.usage,
  ];

  for (const usage of usagePaths) {
    if (usage && typeof usage === "object") {
      const u = usage as Record<string, unknown>;
      if (typeof u.input_tokens === "number") {
        tokenUsage.inputTokens = Math.max(tokenUsage.inputTokens, u.input_tokens);
      }
      if (typeof u.output_tokens === "number") {
        tokenUsage.outputTokens = Math.max(tokenUsage.outputTokens, u.output_tokens);
      }
      if (typeof u.cache_creation_input_tokens === "number") {
        tokenUsage.cacheCreationTokens = Math.max(
          tokenUsage.cacheCreationTokens,
          u.cache_creation_input_tokens
        );
      }
      if (typeof u.cache_read_input_tokens === "number") {
        tokenUsage.cacheReadTokens = Math.max(
          tokenUsage.cacheReadTokens,
          u.cache_read_input_tokens
        );
      }
      return true;
    }
  }
  return false;
}

/**
 * Report partial token usage to the WorkerMill API.
 */
async function reportPartialTokenUsage(
  config: ManagerConfig,
  tokenUsage: TokenUsage,
  model: string
): Promise<void> {
  if (tokenUsage.inputTokens === 0 && tokenUsage.outputTokens === 0) {
    return;
  }

  const url = `${config.apiBaseUrl}/api/tasks/${config.taskId}/usage/partial`;

  try {
    await axios.post(
      url,
      {
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        cacheCreationTokens: tokenUsage.cacheCreationTokens,
        cacheReadTokens: tokenUsage.cacheReadTokens,
        mode: "greatest", // Manager is single session, use greatest
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.orgApiKey,
        },
        timeout: 5000,
      }
    );
  } catch (err) {
    console.error("[Manager] Partial token report failed:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Map model names to Claude CLI format.
 */
function mapModel(model: string): string {
  if (model.includes("opus")) return "opus";
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("haiku")) return "haiku";
  return model;
}

/**
 * Parse a streaming JSON event into StreamMessages.
 */
function parseStreamEvent(event: Record<string, unknown>): StreamMessage[] {
  const messages: StreamMessage[] = [];
  const eventType = event.type as string;

  // Assistant message with content
  if (eventType === "assistant" && event.message) {
    const message = event.message as {
      content?: Array<{
        type: string;
        text?: string;
        thinking?: string;
        name?: string;
        id?: string;
        input?: Record<string, unknown>;
      }>;
    };
    if (message.content && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "thinking" && block.thinking) {
          messages.push({ type: "thinking", content: block.thinking });
        }
        if (block.type === "text" && block.text) {
          messages.push({ type: "text", content: block.text });
        }
        if (block.type === "tool_use" && block.name) {
          messages.push({
            type: "tool_use",
            toolName: block.name,
            toolInput: block.input,
          });
        }
      }
    }
  }

  // Content block delta (streaming text)
  if (eventType === "content_block_delta" && event.delta) {
    const delta = event.delta as { type: string; text?: string; thinking?: string };
    if (delta.type === "text_delta" && delta.text) {
      messages.push({ type: "text", content: delta.text });
    }
    if (delta.type === "thinking_delta" && delta.thinking) {
      messages.push({ type: "thinking", content: delta.thinking });
    }
  }

  // Tool use event
  if (eventType === "tool_use") {
    messages.push({
      type: "tool_use",
      toolName: event.name as string,
      toolInput: event.input as Record<string, unknown>,
    });
  }

  // Tool result event
  if (eventType === "tool_result") {
    messages.push({ type: "tool_result" });
  }

  // Final result
  if (eventType === "result") {
    messages.push({ type: "result", content: event.result as string || event.output as string });
  }

  // Text event
  if (eventType === "text") {
    messages.push({ type: "text", content: event.content as string || event.text as string });
  }

  return messages;
}
