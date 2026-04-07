import { streamText, stepCountIs } from "ai";
import { createModel, buildOllamaOptions } from "./engine/model-factory.js";
import { createToolDefinitions } from "./engine/tools/index.js";
import { formatProjectInstructions } from "./instructions.js";
import { loadLearnings } from "./learnings.js";
import { startAllMCPServers, getMCPToolDefinitions, stopAllMCPServers, autoDetectMCPServers } from "./mcp-client.js";
import type { SandboxSetting } from "./sandbox-mode.js";
import { getProviderForPersona } from "./config.js";
import { createSession, loadLatestSession, loadSessionById, addMessage, saveSession, type Session } from "./session.js";
import { CostTracker } from "./cost-tracker.js";
import type { CliConfig } from "./config.js";

type ChatMessage = { role: "user" | "assistant"; content: string };

export interface RunOptions {
  prompt: string;
  json?: boolean;
  session?: string;
  continue?: boolean;
  model?: string;
  maxSteps?: number;
  singlePrompt?: boolean;
  sandboxed?: SandboxSetting;
}

export function resolveRunModelSelection(
  config: CliConfig,
  overrideModel?: string,
): { provider: string; model: string } {
  const baseProviderInfo = getProviderForPersona(config);
  let providerToUse = baseProviderInfo.provider;
  let modelToUse = baseProviderInfo.model;

  if (!overrideModel) {
    return { provider: providerToUse, model: modelToUse };
  }

  if (overrideModel.includes("/")) {
    const [overrideProvider, overrideProviderModel] = overrideModel.split("/", 2);
    if (!config.providers[overrideProvider]) {
      throw new Error(
        `Provider ${overrideProvider} not configured. Configure it first with /setup or /settings key ${overrideProvider} <api-key>.`,
      );
    }
    providerToUse = overrideProvider;
    modelToUse = overrideProviderModel;
    return { provider: providerToUse, model: modelToUse };
  }

  return { provider: providerToUse, model: overrideModel };
}

export async function runCommand(options: RunOptions, config: CliConfig, workingDir: string): Promise<void> {
  const startTime = Date.now();

  // Validate options
  if (options.session && options.continue) {
    console.error("Error: --session and --continue are mutually exclusive");
    process.exit(2);
  }

  // Resolve provider/model selection explicitly for headless runs.
  let providerToUse: string;
  let modelToUse: string;
  try {
    const selection = resolveRunModelSelection(config, options.model);
    providerToUse = selection.provider;
    modelToUse = selection.model;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  let session: Session;
  let messages: ChatMessage[];

  if (options.singlePrompt) {
    // For single prompt, create temporary session
    session = createSession(providerToUse, modelToUse);
    session.id = "single"; // Override id
    messages = [{ role: "user", content: options.prompt }];
  } else {
    // Load or create session
    if (options.session) {
      const s = loadSessionById(options.session);
      if (!s) {
        console.error(`Session ${options.session} not found`);
        process.exit(2);
      }
      session = s;
    } else if (options.continue) {
      const s = loadLatestSession();
      if (!s) {
        console.error("No recent session to continue");
        process.exit(2);
      }
      session = s;
    } else {
      // New session
      session = createSession(providerToUse, modelToUse);
    }

    // Override provider and model if specified
    session.provider = providerToUse;
    session.model = modelToUse;

    // Add user message to session
    addMessage(session, "user", options.prompt);

    messages = session.messages.map(m => ({ role: m.role, content: m.content }));
  }

  // Get provider config
  const providerConfig = config.providers[providerToUse];
  if (!providerConfig) {
    console.error(`Provider ${providerToUse} not configured`);
    process.exit(2);
  }
  const provider = providerToUse;
  const apiKey = providerConfig.apiKey;
  const host = providerConfig.host;
  const contextLength = providerConfig.contextLength;

  // Start MCP servers
  const mcpConfig = autoDetectMCPServers(config.mcp || {});
  if (Object.keys(mcpConfig).length > 0) {
    await startAllMCPServers(mcpConfig);
  }

  const aiModel = createModel(provider as any, modelToUse, host, contextLength, apiKey);
  const baseTools = createToolDefinitions(workingDir, aiModel, options.sandboxed || false);
  const mcpToolDefs = getMCPToolDefinitions();
  const tools = { ...baseTools, ...mcpToolDefs };

  // Build system prompt
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

  // Cost tracker
  const costTracker = new CostTracker();

  let toolCallCount = 0;
  let finalText = "";
  let cancelled = false;

  // Handle cancellation
  const abortController = new AbortController();
  process.on("SIGINT", () => {
    cancelled = true;
    abortController.abort();
  });

  try {
    const stream = streamText({
      model: aiModel,
      system: systemPrompt,
      messages: messages as any,
      tools: tools as any,
      stopWhen: stepCountIs(options.maxSteps || 50),
      abortSignal: abortController.signal,
      ...buildOllamaOptions(provider as any, contextLength),
      onStepFinish({ text, toolCalls }) {
        if (text) {
          if (!options.json) {
            process.stdout.write(text);
          }
          finalText += text;
        }
        if (toolCalls) {
          toolCallCount += toolCalls.length;
        }
      },
    });

    // Consume stream
    for await (const _ of stream.textStream) {
      // Drive the stream
    }

    finalText = await stream.text;
    const usage = await stream.totalUsage;

    // Track cost
    const inputTokens = (usage as any)?.promptTokens ?? (usage as any)?.inputTokens ?? 0;
    const outputTokens = (usage as any)?.completionTokens ?? (usage as any)?.outputTokens ?? 0;
    costTracker.addUsage("run", providerToUse, modelToUse, inputTokens, outputTokens);

    // Add assistant message to session if not single prompt
    if (!options.singlePrompt) {
      addMessage(session, "assistant", finalText);
      saveSession(session);
    }

    const durationMs = Date.now() - startTime;

    if (options.json) {
      const result = {
        status: cancelled ? "cancelled" : "ok",
        sessionId: options.singlePrompt ? null : session.id,
        model: `${providerToUse}/${modelToUse}`,
        text: finalText,
        toolCalls: toolCallCount,
        tokens: {
          input: inputTokens,
          output: outputTokens,
        },
        costUsd: costTracker.getTotalCost(),
        durationMs,
      };
      console.log(JSON.stringify(result));
    } else {
      if (!finalText) {
        console.log("(completed with tool calls only)");
      }
      console.log(); // newline
    }

    stopAllMCPServers();
    const { shutdown: shutdownLSP } = await import("./engine/tools/lsp.js");
    shutdownLSP();

    process.exit(cancelled ? 130 : 0);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (options.json) {
      const result = {
        status: "error",
        sessionId: options.singlePrompt ? null : session.id,
        model: `${providerToUse}/${modelToUse}`,
        text: "",
        toolCalls: toolCallCount,
        tokens: { input: 0, output: 0 },
        costUsd: costTracker.getTotalCost(),
        durationMs: Date.now() - startTime,
      };
      console.log(JSON.stringify(result));
    } else {
      console.error(`Error: ${errorMsg}`);
    }

    stopAllMCPServers();
    const { shutdown: shutdownLSP } = await import("./engine/tools/lsp.js");
    shutdownLSP();

    process.exit(1);
  }
}
