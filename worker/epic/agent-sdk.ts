/**
 * Agent SDK Wrapper for Epic Executor and Manager
 *
 * Spawns the Claude CLI (@anthropic-ai/claude-code) as a subprocess
 * with streaming JSON output for real tool execution.
 *
 * This module is the single implementation used by both:
 * - Epic executor (story execution with expert configs)
 * - Virtual Manager (PR review and log analysis)
 */

import { spawn, ChildProcess } from "child_process";
import { createInterface } from "readline";
import axios from "axios";
import type { ExpertConfig, EpicConfig, StreamMessage, AgentResult } from "./types.js";

// Re-export types for external consumers
export type { StreamMessage, AgentResult } from "./types.js";

/**
 * Token usage tracking for cost reporting.
 */
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/**
 * Generic agent configuration that works for both Epic and Manager use cases.
 * Use the helper functions below to create configs from specific types.
 *
 * Authentication: Either anthropicApiKey OR oauthToken must be provided.
 * - anthropicApiKey: For production (pay-per-token via ANTHROPIC_API_KEY)
 * - oauthToken: For local development (Claude Max subscription via CLAUDE_CODE_OAUTH_TOKEN)
 */
export interface GenericAgentConfig {
  taskId: string;
  apiBaseUrl: string;
  orgApiKey: string;
  /** Anthropic API key for production use */
  anthropicApiKey?: string;
  /** OAuth token for local development (Claude Max subscription) */
  oauthToken?: string;
  /** Optional GitHub token for gh CLI and Git operations */
  githubToken?: string;
  /** Target repository (used for context, not directly in agent) */
  targetRepo?: string;
  /** Log prefix for console output (default: "[AgentSDK]") */
  logPrefix?: string;
  /** Token reporting mode: "add" for multi-session, "greatest" for single session */
  tokenReportMode?: "add" | "greatest";
}

/**
 * Agent options for running a Claude CLI agent.
 * Supports both expert-based (Epic) and direct (Manager) configurations.
 */
export interface AgentOptions {
  prompt: string;
  /** Expert configuration (Epic mode) - mutually exclusive with direct options */
  expertConfig?: ExpertConfig;
  /** Working directory path */
  repoPath?: string;
  workingDir?: string;
  /** Story ID for Epic mode */
  storyId?: string;
  /** System prompt (Manager mode - Epic uses expertConfig.systemPrompt) */
  systemPrompt?: string;
  /** Model override (Manager mode - Epic uses expertConfig.model) */
  model?: string;
  /** Maximum turns for the agent (optional) */
  maxTurns?: number;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Callback for streaming messages */
  onMessage?: (msg: StreamMessage) => void;
}

/**
 * Convert EpicConfig to GenericAgentConfig for internal use.
 * Supports both API key (production) and OAuth token (local development).
 */
export function epicConfigToGeneric(config: EpicConfig): GenericAgentConfig {
  return {
    taskId: config.parentTaskId,
    apiBaseUrl: config.apiBaseUrl,
    orgApiKey: config.orgApiKey,
    anthropicApiKey: config.anthropicApiKey,
    // Check for OAuth token in environment (local development with Claude Max)
    oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
    githubToken: config.githubToken,
    targetRepo: config.targetRepo,
    logPrefix: "[AgentSDK]",
    tokenReportMode: "add", // Epic runs multiple stories, each is separate Claude session
  };
}

/**
 * Build useful error context from agent messages when stderr is empty/useless.
 * Extracts the most relevant information from the agent's conversation to explain what went wrong.
 */
function buildErrorContextFromMessages(messages: StreamMessage[], lastOutput: string): string {
  const contextParts: string[] = [];

  // Look for error messages in the conversation
  for (const msg of messages) {
    if (!msg.content) continue;

    // Look for tool errors
    if (msg.type === "tool_result" && msg.content.toLowerCase().includes("error")) {
      contextParts.push(`Tool error: ${msg.content.substring(0, 500)}`);
    }

    // Look for explicit error/failure mentions in text
    if (msg.type === "text") {
      const content = msg.content.toLowerCase();
      if (
        content.includes("error") ||
        content.includes("failed") ||
        content.includes("cannot") ||
        content.includes("unable to")
      ) {
        // Extract the sentence/paragraph containing the error
        const errorContext = msg.content.substring(0, 800);
        if (!contextParts.some(p => p.includes(errorContext.substring(0, 100)))) {
          contextParts.push(errorContext);
        }
      }
    }
  }

  // If we found specific errors, use those
  if (contextParts.length > 0) {
    return contextParts.slice(0, 3).join("\n\n"); // Limit to 3 most relevant
  }

  // Fallback: use the last meaningful output from the agent
  if (lastOutput && lastOutput.length > 20) {
    return `Agent's last output:\n${lastOutput.substring(0, 1000)}`;
  }

  return "";
}

/**
 * Run an agent with real tool execution via Claude CLI.
 * The agent can Read, Write, Edit files and run Bash commands.
 *
 * Supports two modes:
 * - Epic mode: Pass expertConfig in options (uses expertConfig.systemPrompt, model, tools)
 * - Direct mode: Pass systemPrompt and model directly in options
 */
export async function runAgent(
  config: EpicConfig | GenericAgentConfig,
  options: AgentOptions
): Promise<AgentResult> {
  // Normalize config to GenericAgentConfig
  const genericConfig: GenericAgentConfig = "parentTaskId" in config
    ? epicConfigToGeneric(config)
    : config;

  const messages: StreamMessage[] = [];
  const logPrefix = genericConfig.logPrefix || "[AgentSDK]";
  const tokenReportMode = genericConfig.tokenReportMode || "add";

  // Track token usage for cost reporting (use Math.max since Claude reports cumulative)
  const tokenUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };

  // Determine model and system prompt based on mode
  const isExpertMode = !!options.expertConfig;
  const model = isExpertMode ? options.expertConfig!.model : (options.model || "sonnet");
  const systemPrompt = isExpertMode ? options.expertConfig!.systemPrompt : (options.systemPrompt || "");
  const workingDir = options.repoPath || options.workingDir || process.cwd();

  let modelUsed = model;
  let lastPartialReportTime = 0;
  const PARTIAL_REPORT_INTERVAL = 30000; // 30 seconds

  // Build allowed tools list (only built-in tools)
  const builtinTools = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];
  const allowedTools = isExpertMode
    ? filterBuiltinTools(options.expertConfig!.tools)
    : builtinTools;

  // Build environment variables for coordination
  // Note: TASK_ID uses taskId (the WorkerTask ID) for API compatibility
  const agentEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...options.env,
    API_BASE_URL: genericConfig.apiBaseUrl,
    ORG_API_KEY: genericConfig.orgApiKey,
    TASK_ID: genericConfig.taskId,
  };

  // Authentication: Claude CLI manages its own auth via ~/.claude credentials file.
  // In local mode, the credentials file is mounted into the container, so Claude CLI
  // can auto-refresh expired OAuth tokens mid-run. We don't pass CLAUDE_CODE_OAUTH_TOKEN
  // as an env var because that bypasses the CLI's refresh logic.
  // In production, ANTHROPIC_API_KEY is set in the ECS task definition.
  if (genericConfig.anthropicApiKey) {
    agentEnv.ANTHROPIC_API_KEY = genericConfig.anthropicApiKey;
    console.log(`${logPrefix} Using API key authentication`);
  } else {
    // Local mode: Claude CLI will use ~/.claude/.credentials.json
    console.log(`${logPrefix} Using Claude credentials file authentication (local mode)`);
  }

  // Epic mode adds parent task ID and story context
  if (isExpertMode) {
    agentEnv.PARENT_TASK_ID = genericConfig.taskId;
    if (options.storyId) {
      agentEnv.STORY_ID = options.storyId;
    }
    agentEnv.PERSONA = options.expertConfig!.persona;
  }

  // Add GitHub token if provided (for gh CLI and git operations)
  // IMPORTANT: Don't clobber GH_TOKEN if the caller already set it in process.env
  // (e.g., inline-reviewer sets it to the reviewer token for PR approvals)
  if (genericConfig.githubToken) {
    agentEnv.GITHUB_TOKEN = genericConfig.githubToken;
    if (!process.env.GH_TOKEN) {
      agentEnv.GH_TOKEN = genericConfig.githubToken;
    }
    // else: caller (e.g. inline-reviewer) explicitly set GH_TOKEN — keep it
  }

  // Claude CLI is installed globally in the container
  const claudeCli = "claude";

  // Build CLI arguments - don't use --system-prompt (causes escaping issues with special chars)
  // Instead, prepend role context to the main prompt
  const args: string[] = [
    "--print", // Non-interactive mode
    "--verbose", // Required for stream-json with --print
    "--output-format", "stream-json", // Streaming JSON output
    "--model", mapModel(model),
    "--permission-mode", "bypassPermissions", // Allow all tool execution
  ];

  // Set max turns if specified
  if (options.maxTurns) {
    args.push("--max-turns", String(options.maxTurns));
  }

  // Add allowed tools
  if (allowedTools.length > 0) {
    args.push("--allowedTools", allowedTools.join(","));
  }

  // Combine full system prompt with main prompt
  // The systemPrompt includes coordination instructions with curl examples for inter-agent communication
  // Since we pass via stdin (not CLI args), escaping is handled correctly
  const fullPrompt = systemPrompt ? systemPrompt + "\n\n---\n\n" + options.prompt : options.prompt;

  // NOTE: Prompt will be passed via stdin, not as command line argument
  // This avoids issues with special characters and very long prompts

  if (isExpertMode) {
    console.log(`${logPrefix} Spawning Claude CLI for ${options.expertConfig!.persona}`);
  } else {
    console.log(`${logPrefix} Spawning Claude CLI`);
  }
  console.log(`${logPrefix} Working directory: ${workingDir}`);
  console.log(`${logPrefix} Model: ${mapModel(model)}`);
  if (options.maxTurns) {
    console.log(`${logPrefix} Max turns: ${options.maxTurns}`);
  }
  console.log(`${logPrefix} Tools: ${allowedTools.join(", ")}`);

  // Debug: Log the full command for troubleshooting
  const promptPreview = options.prompt.substring(0, 200).replace(/\n/g, "\\n");
  console.log(`${logPrefix} Prompt preview: ${promptPreview}...`);
  console.log(`${logPrefix} Prompt length: ${options.prompt.length} chars`);

  return new Promise((resolve) => {
    let agentProcess: ChildProcess;

    try {
      console.log(`${logPrefix} Spawn command: ${claudeCli}`);
      console.log(`${logPrefix} Spawn args count: ${args.length}`);

      agentProcess = spawn(claudeCli, args, {
        cwd: workingDir,
        env: agentEnv,
        stdio: ["pipe", "pipe", "pipe"],
        // Removed shell: true - can cause stdout buffering and escaping issues
      });

      console.log(`${logPrefix} Process spawned, PID: ${agentProcess.pid}`);

      // Write prompt to stdin and close - Claude CLI reads from stdin in --print mode
      agentProcess.stdin!.write(fullPrompt);
      agentProcess.stdin!.end();
      console.log(`${logPrefix} Wrote prompt to stdin (${fullPrompt.length} chars) and closed`);
    } catch (spawnError) {
      const errorMsg = spawnError instanceof Error ? spawnError.message : String(spawnError);
      console.error(`${logPrefix} Failed to spawn Claude CLI:`, errorMsg);
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

    // Process stdout line by line (stream-json outputs one JSON per line)
    // Note: removed raw stdout debug logger — it duplicated every line since
    // readline parses the same stream and postLog() already logs to console
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

        // Report partial tokens periodically (every 30 seconds)
        const now = Date.now();
        if (hadUsage && now - lastPartialReportTime >= PARTIAL_REPORT_INTERVAL) {
          lastPartialReportTime = now;
          reportPartialTokenUsage(genericConfig, tokenUsage, modelUsed, tokenReportMode, logPrefix).catch((err) => {
            console.error(`${logPrefix} Failed to report partial tokens:`, err);
          });
        }

        // Process ALL messages from this event (thinking, text, tool_use, etc.)
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
        console.log(`${logPrefix} Raw output: ${line}`);
      }
    });

    // Capture stderr for errors - log immediately for debugging
    let stderrBuffer = "";
    let isRateLimited = false;
    agentProcess.stderr!.on("data", (data: Buffer) => {
      const text = data.toString();
      stderrBuffer += text;
      // Log stderr in real-time for debugging
      console.error(`${logPrefix} stderr: ${text.trim()}`);

      // Detect rate limiting from Claude CLI
      if (/rate.limit|429|too many requests|over_quota|overloaded|capacity/i.test(text)) {
        isRateLimited = true;
        console.error(`${logPrefix} Rate limit detected in stderr`);
      }
    });

    agentProcess.on("error", (err) => {
      hasError = true;
      errorMessage = err.message;
      console.error(`${logPrefix} Process error:`, err.message);
    });

    // IMPORTANT: Do NOT use async callback with EventEmitter.on()
    // Async callbacks are fire-and-forget - Node won't wait for them
    // This was causing premature exit before resolve() was called
    agentProcess.on("close", (code) => {
      console.log(`${logPrefix} Process exited with code ${code}`);
      if (stderrBuffer) {
        console.log(`${logPrefix} stderr buffer: ${stderrBuffer.substring(0, 500)}`);
      }
      if (code !== 0 && !hasError) {
        hasError = true;
        // Build a more useful error message by combining stderr with agent output context
        const contextFromOutput = buildErrorContextFromMessages(messages, lastOutput);
        if (stderrBuffer && stderrBuffer.trim().length > 10) {
          // Prefer stderr if it has meaningful content
          errorMessage = stderrBuffer;
          if (contextFromOutput) {
            errorMessage += `\n\nAgent context:\n${contextFromOutput}`;
          }
        } else if (contextFromOutput) {
          // Use agent output context if stderr is empty/useless
          errorMessage = contextFromOutput;
        } else {
          // Fallback to generic message
          errorMessage = `Process exited with code ${code}`;
        }
      }

      // Chain async work properly to ensure resolve() is always called
      console.log(`${logPrefix} Final token usage: input=${tokenUsage.inputTokens}, output=${tokenUsage.outputTokens}, cache_create=${tokenUsage.cacheCreationTokens}, cache_read=${tokenUsage.cacheReadTokens}`);

      reportPartialTokenUsage(genericConfig, tokenUsage, modelUsed, tokenReportMode, logPrefix)
        .then(() => {
          console.log(`${logPrefix} Token usage reported successfully`);
        })
        .catch((err) => {
          console.error(`${logPrefix} Failed to report final token usage:`, err);
        })
        .finally(() => {
          // ALWAYS resolve the Promise, regardless of token reporting success
          if (hasError) {
            console.error(`${logPrefix} Agent failed: ${errorMessage}`);
            resolve({
              success: false,
              messages,
              error: errorMessage,
              rateLimited: isRateLimited,
            });
          } else {
            console.log(`${logPrefix} Agent completed successfully`);

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
  });
}

/**
 * Extract token usage from a stream event.
 * Claude reports cumulative tokens, so we use Math.max to track the highest values.
 * Returns true if usage data was found.
 */
function extractUsageFromEvent(event: Record<string, unknown>, tokenUsage: TokenUsage): boolean {
  // Check multiple paths where usage might appear
  const usagePaths = [
    event.usage,
    (event.message as Record<string, unknown>)?.usage,
    (event.result as Record<string, unknown>)?.usage,
    (event.delta as Record<string, unknown>)?.usage,
    (event.content_block as Record<string, unknown>)?.usage,
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
 * Uses the /usage/partial endpoint which uses GREATEST() or additive mode.
 *
 * @param config - Generic agent configuration
 * @param tokenUsage - Token usage to report
 * @param model - Model used (for pricing calculation)
 * @param mode - "add" for multi-session (Epic), "greatest" for single session (Manager)
 * @param logPrefix - Prefix for log messages
 */
async function reportPartialTokenUsage(
  config: GenericAgentConfig,
  tokenUsage: TokenUsage,
  model: string,
  mode: "add" | "greatest",
  logPrefix: string
): Promise<void> {
  // Skip if no tokens yet
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
        mode,
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
    // Log but don't throw - token reporting is best-effort
    console.error(`${logPrefix} Partial token report failed:`, err instanceof Error ? err.message : String(err));
  }
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
 * Parse a streaming JSON event into StreamMessages.
 * Returns an array because a single event can contain multiple content blocks
 * (e.g., thinking + text + tool_use).
 */
function parseStreamEvent(event: Record<string, unknown>): StreamMessage[] {
  const messages: StreamMessage[] = [];
  const eventType = event.type as string;

  // Assistant message with content - process ALL content blocks
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
        // Handle thinking blocks (Claude's extended thinking)
        if (block.type === "thinking" && block.thinking) {
          messages.push({ type: "thinking", content: block.thinking });
        }
        // Handle text blocks
        if (block.type === "text" && block.text) {
          messages.push({ type: "text", content: block.text });
        }
        // Handle tool use blocks
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
