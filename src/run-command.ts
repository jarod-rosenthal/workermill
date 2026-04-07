import { streamText, stepCountIs } from "ai";
import { createModel, buildOllamaOptions } from "./engine/model-factory.js";
import { createToolDefinitions } from "./engine/tools/index.js";
import { formatProjectInstructions } from "./instructions.js";
import { loadLearnings } from "./learnings.js";
import { startAllMCPServers, getMCPToolDefinitions, stopAllMCPServers, autoDetectMCPServers } from "./mcp-client.js";
import { getProviderForPersona } from "./config.js";
import { loadSessionById, loadLatestSession, createSession, addMessage, saveSession, Session } from "./session.js";
import { resolveSandboxMode } from "./sandbox-mode.js";
import { shutdown as shutdownLSP } from "./engine/tools/lsp.js";
import { CliConfig } from "./config.js";

export interface RunCommandOptions {
  prompt: string;
  json?: boolean;
  session?: string;
  continue?: boolean;
  model?: string;
  maxSteps?: number;
  config: CliConfig;
  provider: string;
  modelName: string;
  host?: string;
  contextLength?: number;
  apiKey?: string;
  trustAll?: boolean;
  fullDisk?: boolean;
}

export interface RunResult {
  status: "ok" | "error" | "cancelled";
  sessionId: string;
  model: string;
  text: string;
  toolCalls: number;
  tokens: { input: number; output: number };
  costUsd: number;
  durationMs: number;
}

export async function runCommand(options: RunCommandOptions): Promise<RunResult> {
  const workingDir = process.cwd();
  const sandboxResolution = resolveSandboxMode(options.config.sandbox, !!options.fullDisk);

  // Load or create session
  let session: Session;
  if (options.session) {
    const loaded = loadSessionById(options.session);
    if (!loaded) {
      throw new Error(`Session ${options.session} not found`);
    }
    session = loaded;
  } else if (options.continue) {
    const loaded = loadLatestSession();
    if (!loaded) {
      throw new Error("No recent session to continue");
    }
    session = loaded;
  } else {
    session = createSession(options.provider, options.modelName);
  }

  // Add user message
  addMessage(session, "user", options.prompt);

  // Start MCP servers
  const mcpConfig = autoDetectMCPServers(options.config.mcp || {});
  if (Object.keys(mcpConfig).length > 0) {
    await startAllMCPServers(mcpConfig);
  }

  const aiModel = createModel(options.provider as any, options.modelName, options.host, options.contextLength, options.apiKey);

  const baseTools = createToolDefinitions(workingDir, aiModel, sandboxResolution.effective);
  const mcpToolDefs = getMCPToolDefinitions();
  const tools = { ...baseTools, ...mcpToolDefs };

  if (sandboxResolution.warning && !options.json) {
    console.error(`[wm] ${sandboxResolution.warning}`);
  }

  let systemPrompt = `You are WorkerMill, an AI coding agent. Working directory: ${workingDir}\n`;
  const instructions = formatProjectInstructions(workingDir);
  if (instructions) systemPrompt += instructions;
  const learnings = loadLearnings();
  if (learnings.length > 0) {
    systemPrompt += `\n\n## Project Learnings\n${learnings.map(l => `- ${l}`).join("\n")}`;
  }
  const mcpToolKeys = Object.keys(mcpToolDefs);
  if (mcpToolKeys.length > 0) {
    const serverNames = [...new Set(mcpToolKeys.map(k => k.split("__")[1]))];
    systemPrompt += `\n\n## MCP Tools\n\nYou have additional tools from MCP server(s): ${serverNames.join(", ")}. `;
    systemPrompt += `Tools prefixed with \`mcp__<server>__\` are real, working tools. Use them confidently and trust their results.\n`;
  }

  const controller = new AbortController();
  let cancelled = false;
  process.on("SIGINT", () => {
    cancelled = true;
    controller.abort();
  });

  const startTime = Date.now();
  let toolCallCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let finalText = "";
  let error: string | null = null;

  try {
    const stream = streamText({
      model: aiModel,
      system: systemPrompt,
      messages: session.messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      tools: tools as any,
      stopWhen: stepCountIs(options.maxSteps || 50),
      abortSignal: controller.signal,
      ...buildOllamaOptions(options.provider as any, options.contextLength),
      onStepFinish({ toolCalls, usage }) {
        toolCallCount += toolCalls?.length ?? 0;
        inputTokens += usage?.inputTokens ?? 0;
        outputTokens += usage?.outputTokens ?? 0;
      },
    });

    if (!options.json) {
      for await (const chunk of stream.textStream) {
        process.stdout.write(chunk);
      }
    }

    finalText = await stream.text;
    if (!finalText) {
      finalText = "(completed with tool calls only)";
    }
    if (!options.json) {
      console.log(); // newline
    }

    const totalUsage = await stream.totalUsage;
    inputTokens = totalUsage?.inputTokens ?? inputTokens;
    outputTokens = totalUsage?.outputTokens ?? outputTokens;

  } catch (err) {
    if (cancelled) {
      // already handled
    } else {
      error = err instanceof Error ? err.message : String(err);
      if (!options.json) {
        console.error(`Error: ${error}`);
      }
    }
  } finally {
    stopAllMCPServers();
    shutdownLSP();
  }

  const durationMs = Date.now() - startTime;

  // Calculate cost (simplified, based on provider)
  let costUsd = 0;
  // TODO: implement cost calculation based on provider/model/tokens

  if (cancelled) {
    return {
      status: "cancelled",
      sessionId: session.id,
      model: `${options.provider}/${options.modelName}`,
      text: finalText,
      toolCalls: toolCallCount,
      tokens: { input: inputTokens, output: outputTokens },
      costUsd,
      durationMs,
    };
  } else if (error) {
    return {
      status: "error",
      sessionId: session.id,
      model: `${options.provider}/${options.modelName}`,
      text: finalText,
      toolCalls: toolCallCount,
      tokens: { input: inputTokens, output: outputTokens },
      costUsd,
      durationMs,
    };
  } else {
    // Add assistant message and save session
    addMessage(session, "assistant", finalText);
    saveSession(session);

    return {
      status: "ok",
      sessionId: session.id,
      model: `${options.provider}/${options.modelName}`,
      text: finalText,
      toolCalls: toolCallCount,
      tokens: { input: inputTokens, output: outputTokens },
      costUsd,
      durationMs,
    };
  }
}