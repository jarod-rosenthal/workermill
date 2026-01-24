/**
 * Agent SDK Wrapper for Epic Executor
 *
 * Spawns the Claude CLI (@anthropic-ai/claude-code) as a subprocess
 * with streaming JSON output for real tool execution.
 */

import { spawn, ChildProcess } from "child_process";
import { createInterface } from "readline";
import type { ExpertConfig, EpicConfig, StreamMessage, AgentResult } from "./types.js";

export interface AgentOptions {
  prompt: string;
  expertConfig: ExpertConfig;
  repoPath: string;
  storyId: string;
  env?: Record<string, string>;
  onMessage?: (msg: StreamMessage) => void;
}

/**
 * Run an agent with real tool execution via Claude CLI.
 * The agent can Read, Write, Edit files and run Bash commands.
 */
export async function runAgent(
  config: EpicConfig,
  options: AgentOptions
): Promise<AgentResult> {
  const messages: StreamMessage[] = [];

  // Build allowed tools list (only built-in tools)
  const allowedTools = filterBuiltinTools(options.expertConfig.tools);

  // Build environment variables for coordination
  const agentEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...options.env,
    API_BASE_URL: config.apiBaseUrl,
    ORG_API_KEY: config.orgApiKey,
    PARENT_TASK_ID: config.parentTaskId,
    TASK_ID: options.storyId,
    PERSONA: options.expertConfig.persona,
    // Required for Claude CLI
    ANTHROPIC_API_KEY: config.anthropicApiKey,
  };

  // Claude CLI is installed globally in the container
  const claudeCli = "claude";

  // Build CLI arguments - don't use --system-prompt (causes escaping issues with special chars)
  // Instead, prepend role context to the main prompt
  const args: string[] = [
    "--print", // Non-interactive mode
    "--verbose", // Required for stream-json with --print
    "--output-format", "stream-json", // Streaming JSON output
    "--model", mapModel(options.expertConfig.model),
    "--permission-mode", "bypassPermissions", // Allow all tool execution
  ];

  // Add allowed tools
  if (allowedTools.length > 0) {
    args.push("--allowedTools", allowedTools.join(","));
  }

  // Combine full system prompt with main prompt
  // The systemPrompt includes coordination instructions with curl examples for inter-agent communication
  // Since we pass via stdin (not CLI args), escaping is handled correctly
  const fullPrompt = options.expertConfig.systemPrompt + "\n\n---\n\n" + options.prompt;

  // NOTE: Prompt will be passed via stdin, not as command line argument
  // This avoids issues with special characters and very long prompts

  console.log(`[AgentSDK] Spawning Claude CLI for ${options.expertConfig.persona}`);
  console.log(`[AgentSDK] Working directory: ${options.repoPath}`);
  console.log(`[AgentSDK] Model: ${mapModel(options.expertConfig.model)}`);
  console.log(`[AgentSDK] Tools: ${allowedTools.join(", ")}`);

  // Debug: Log the full command for troubleshooting
  const promptPreview = options.prompt.substring(0, 200).replace(/\n/g, "\\n");
  console.log(`[AgentSDK] Prompt preview: ${promptPreview}...`);
  console.log(`[AgentSDK] Prompt length: ${options.prompt.length} chars`);

  return new Promise((resolve) => {
    let agentProcess: ChildProcess;

    try {
      console.log(`[AgentSDK] Spawn command: ${claudeCli}`);
      console.log(`[AgentSDK] Spawn args count: ${args.length}`);

      agentProcess = spawn(claudeCli, args, {
        cwd: options.repoPath,
        env: agentEnv,
        stdio: ["pipe", "pipe", "pipe"],
        // Removed shell: true - can cause stdout buffering and escaping issues
      });

      console.log(`[AgentSDK] Process spawned, PID: ${agentProcess.pid}`);

      // Write prompt to stdin and close - Claude CLI reads from stdin in --print mode
      agentProcess.stdin!.write(fullPrompt);
      agentProcess.stdin!.end();
      console.log(`[AgentSDK] Wrote prompt to stdin (${fullPrompt.length} chars) and closed`);
    } catch (spawnError) {
      const errorMsg = spawnError instanceof Error ? spawnError.message : String(spawnError);
      console.error("[AgentSDK] Failed to spawn Claude CLI:", errorMsg);
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

    // Debug: Log raw stdout for troubleshooting
    agentProcess.stdout!.on("data", (data: Buffer) => {
      console.log(`[AgentSDK] stdout raw (${data.length} bytes): ${data.toString().substring(0, 200)}`);
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
        const streamMsg = parseStreamEvent(event);

        if (streamMsg) {
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
        console.log(`[AgentSDK] Raw output: ${line}`);
      }
    });

    // Capture stderr for errors - log immediately for debugging
    let stderrBuffer = "";
    agentProcess.stderr!.on("data", (data: Buffer) => {
      const text = data.toString();
      stderrBuffer += text;
      // Log stderr in real-time for debugging
      console.error(`[AgentSDK] stderr: ${text.trim()}`);
    });

    agentProcess.on("error", (err) => {
      hasError = true;
      errorMessage = err.message;
      console.error("[AgentSDK] Process error:", err.message);
    });

    agentProcess.on("close", (code) => {
      console.log(`[AgentSDK] Process exited with code ${code}`);
      if (stderrBuffer) {
        console.log(`[AgentSDK] stderr buffer: ${stderrBuffer.substring(0, 500)}`);
      }
      if (code !== 0 && !hasError) {
        hasError = true;
        errorMessage = stderrBuffer || `Process exited with code ${code}`;
      }

      if (hasError) {
        console.error(`[AgentSDK] Agent failed: ${errorMessage}`);
        resolve({
          success: false,
          messages,
          error: errorMessage,
        });
      } else {
        console.log(`[AgentSDK] Agent completed successfully`);

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
 * Filter to only built-in tools that the Claude CLI supports.
 */
function filterBuiltinTools(tools: string[]): string[] {
  const builtins = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];
  return tools.filter((t) => builtins.includes(t));
}

/**
 * Map model names to Claude CLI format.
 */
function mapModel(model: string): string {
  // CLI accepts shorthand model names
  if (model.includes("opus")) return "opus";
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("haiku")) return "haiku";
  return model;
}

/**
 * Parse a streaming JSON event into a StreamMessage.
 */
function parseStreamEvent(event: Record<string, unknown>): StreamMessage | null {
  // Handle different event types from stream-json output
  const eventType = event.type as string;

  // Assistant message with content
  if (eventType === "assistant" && event.message) {
    const message = event.message as { content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }> };
    if (message.content && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "text" && block.text) {
          return { type: "text", content: block.text };
        }
        if (block.type === "tool_use" && block.name) {
          return {
            type: "tool_use",
            toolName: block.name,
            toolInput: block.input,
          };
        }
      }
    }
  }

  // Content block delta (streaming text)
  if (eventType === "content_block_delta" && event.delta) {
    const delta = event.delta as { type: string; text?: string };
    if (delta.type === "text_delta" && delta.text) {
      return { type: "text", content: delta.text };
    }
  }

  // Tool use event
  if (eventType === "tool_use") {
    return {
      type: "tool_use",
      toolName: event.name as string,
      toolInput: event.input as Record<string, unknown>,
    };
  }

  // Tool result event
  if (eventType === "tool_result") {
    return { type: "tool_result" };
  }

  // Final result
  if (eventType === "result") {
    return { type: "result", content: event.result as string || event.output as string };
  }

  // Text event
  if (eventType === "text") {
    return { type: "text", content: event.content as string || event.text as string };
  }

  return null;
}
