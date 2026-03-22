import { streamText, stepCountIs } from "ai";
import { createModel } from "./model-factory.js";
import { createToolDefinitions } from "./tools/index.js";
import type { AIClientConfig, AIClientOptions, AIClientResult, StreamMessage, TokenUsage } from "./types.js";

export class EngineAIClient {
  private config: AIClientConfig;

  constructor(config: AIClientConfig) {
    this.config = config;
  }

  async execute(options: AIClientOptions): Promise<AIClientResult> {
    const model = createModel(
      this.config.provider,
      options.model,
      this.config.apiKeys.ollamaHost
    );

    const tools = createToolDefinitions(options.workingDir, model);

    try {
      const stream = streamText({
        model,
        system: options.systemPrompt,
        prompt: options.prompt,
        tools,
        stopWhen: stepCountIs(options.maxTurns || 100),
        abortSignal: AbortSignal.timeout(options.timeoutMs || 30 * 60 * 1000),
        onStepFinish({ text, toolCalls, toolResults }) {
          if (text && options.onMessage) {
            options.onMessage({ type: "text", content: text });
          }
          if (toolCalls) {
            for (const tc of toolCalls) {
              if (tc && "toolName" in tc && "args" in tc) {
                options.onMessage?.({
                  type: "tool_use",
                  toolName: tc.toolName,
                  toolInput: tc.args as Record<string, unknown>,
                });
              }
            }
          }
          if (toolResults) {
            for (const tr of toolResults) {
              if (tr && "result" in tr) {
                options.onMessage?.({
                  type: "tool_result",
                  content: typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result),
                });
              }
            }
          }
        },
      });

      for await (const _chunk of stream.textStream) {
        // Consume stream to drive execution
      }

      const text = await stream.text;
      const usage = await stream.totalUsage;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const usageAny = usage as any;
      const tokenUsage: TokenUsage = {
        inputTokens: usageAny?.promptTokens ?? usageAny?.inputTokens ?? 0,
        outputTokens: usageAny?.completionTokens ?? usageAny?.outputTokens ?? 0,
        totalTokens: 0,
      };
      tokenUsage.totalTokens = tokenUsage.inputTokens + tokenUsage.outputTokens;

      if (options.onTokenUsage) {
        options.onTokenUsage(tokenUsage);
      }

      // Extract markers from text (::key::value patterns)
      const markers: Record<string, string> = {};
      const markerRegex = /::(\w+)::(.*?)(?=::\w+::|$)/gs;
      let match;
      while ((match = markerRegex.exec(text)) !== null) {
        markers[match[1]] = match[2].trim();
      }

      return {
        success: true,
        text,
        tokenUsage,
        markers,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const isTimeout = error.includes("aborted") || error.includes("timeout");

      return {
        success: false,
        text: "",
        error: isTimeout ? `Execution timed out after ${options.timeoutMs || 30 * 60 * 1000}ms` : error,
      };
    }
  }
}
