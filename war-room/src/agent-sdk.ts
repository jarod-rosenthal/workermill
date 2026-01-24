/**
 * Agent SDK Wrapper for War Room
 *
 * Provides a clean interface to the Claude Agent SDK (@anthropic-ai/claude-code).
 * Handles streaming, tool execution, and message parsing.
 */

import { query } from "@anthropic-ai/claude-code";
import type { ExpertConfig, WarRoomConfig, StreamMessage, AgentResult } from "./types.js";

export interface AgentOptions {
  prompt: string;
  expertConfig: ExpertConfig;
  repoPath: string;
  storyId: string;
  env?: Record<string, string>;
  onMessage?: (msg: StreamMessage) => void;
}

/**
 * Run an agent with real tool execution.
 * The agent can Read, Write, Edit files and run Bash commands.
 */
export async function runAgent(
  config: WarRoomConfig,
  options: AgentOptions
): Promise<AgentResult> {
  const messages: StreamMessage[] = [];

  // Build allowed tools list (only built-in tools)
  const allowedTools = filterBuiltinTools(options.expertConfig.tools);

  // Build environment variables for coordination
  const agentEnv: Record<string, string> = {
    ...options.env,
    API_BASE_URL: config.apiBaseUrl,
    ORG_API_KEY: config.orgApiKey,
    PARENT_TASK_ID: config.parentTaskId,
    TASK_ID: options.storyId,
    PERSONA: options.expertConfig.persona,
  };

  // Set environment variables for the Bash tool to use
  // These are used by curl commands in expert system prompts
  const originalEnv = { ...process.env };
  Object.assign(process.env, agentEnv);

  try {
    // Run the agent with tool execution
    const result = await query({
      prompt: options.prompt,
      systemPrompt: options.expertConfig.systemPrompt,
      allowedTools,
      model: mapModel(options.expertConfig.model),
      cwd: options.repoPath,
    });

    // Process the result
    if (result.error) {
      return {
        success: false,
        messages,
        error: result.error,
      };
    }

    // Parse messages from the result
    if (result.messages) {
      for (const message of result.messages) {
        if (message.role === "assistant" && message.content) {
          for (const block of message.content) {
            const streamMsg = parseContentBlock(block);
            if (streamMsg) {
              messages.push(streamMsg);
              options.onMessage?.(streamMsg);
            }
          }
        }
      }
    }

    // Add final output if available
    if (result.output) {
      const resultMsg: StreamMessage = { type: "result", content: result.output };
      messages.push(resultMsg);
      options.onMessage?.(resultMsg);
    }

    return { success: true, messages };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[AgentSDK] Agent execution failed:", errorMessage);

    return {
      success: false,
      messages,
      error: errorMessage,
    };
  } finally {
    // Restore original environment
    process.env = originalEnv;
  }
}

/**
 * Filter to only built-in tools that the Agent SDK supports.
 */
function filterBuiltinTools(tools: string[]): string[] {
  const builtins = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];
  return tools.filter((t) => builtins.includes(t));
}

/**
 * Map model names to Agent SDK shorthand.
 */
function mapModel(model: string): string {
  // Agent SDK uses shorthand model names
  if (model.includes("opus")) return "opus";
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("haiku")) return "haiku";
  return model;
}

/**
 * Parse a content block into a StreamMessage.
 */
function parseContentBlock(block: {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}): StreamMessage | null {
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

  if (block.type === "tool_result") {
    return { type: "tool_result" };
  }

  return null;
}
