import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "ai";
import { MockLanguageModelV3 } from "ai/test";

export interface ScriptedUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface ScriptedToolCall {
  toolName: string;
  input: Record<string, unknown>;
  toolCallId?: string;
}

export interface ScriptedResponse {
  text?: string;
  toolCalls?: readonly ScriptedToolCall[];
  usage?: ScriptedUsage;
  finishReason?: LanguageModelV3FinishReason["unified"];
  /** Keep the stream open until its SDK abort signal fires. */
  waitForAbort?: boolean;
}

export interface ScriptedCall {
  id: string;
  method: "stream" | "generate";
  options: LanguageModelV3CallOptions;
  response: ScriptedResponse;
}

export interface ScriptedModel {
  model: MockLanguageModelV3;
  calls: readonly ScriptedCall[];
  unexpectedCallErrors: readonly Error[];
  abortedCallIds: readonly string[];
  assertComplete(): void;
}

/**
 * A deterministic `streamText` model that uses the installed AI SDK mock.
 *
 * ```ts
 * const scripted = createScriptedModel([
 *   { toolCalls: [{ toolName: "read_file", input: { path: "a.txt" } }] },
 *   { text: "The file is ready.", usage: { inputTokens: 8, outputTokens: 4 } },
 * ]);
 * const result = streamText({ model: scripted.model, tools, prompt: "Read it", stopWhen: stepCountIs(2) });
 * await result.text;
 * expect(scripted.calls[1].options.prompt).toContainEqual(expect.objectContaining({ role: "tool" }));
 * scripted.assertComplete();
 * ```
 */
export function createScriptedModel(
  responses: readonly ScriptedResponse[],
  { provider = "scripted", modelId = "scripted-model" } = {},
): ScriptedModel {
  const calls: ScriptedCall[] = [];
  const unexpectedCallErrors: Error[] = [];
  const abortedCallIds: string[] = [];

  const model = new MockLanguageModelV3({
    provider,
    modelId,
    doStream: async options => {
      const { id, response } = takeResponse("stream", options, responses, calls, unexpectedCallErrors);
      return {
        stream: response.waitForAbort
          ? abortableStream(options.abortSignal, id, abortedCallIds)
          : streamForResponse(response, id),
      };
    },
    doGenerate: async options => {
      const { response } = takeResponse("generate", options, responses, calls, unexpectedCallErrors);
      if (response.waitForAbort || response.toolCalls?.length) {
        throw new Error("Scripted generate response must contain text only.");
      }
      const finishReason = response.finishReason ?? "stop";
      return {
        content: [{ type: "text", text: response.text ?? "" }],
        finishReason: { unified: finishReason, raw: finishReason },
        usage: usageFor(response.usage),
        warnings: [],
      };
    },
  });

  return {
    model,
    calls,
    unexpectedCallErrors,
    abortedCallIds,
    assertComplete() {
      if (unexpectedCallErrors.length > 0) {
        throw unexpectedCallErrors[0];
      }
      if (calls.length !== responses.length) {
        throw new Error(`Scripted model consumed ${calls.length} of ${responses.length} responses.`);
      }
    },
  };
}

function takeResponse(
  method: ScriptedCall["method"],
  options: LanguageModelV3CallOptions,
  responses: readonly ScriptedResponse[],
  calls: ScriptedCall[],
  unexpectedCallErrors: Error[],
): { id: string; response: ScriptedResponse } {
  const id = `scripted-call-${calls.length + 1}`;
  const response = responses[calls.length];
  if (!response) {
    const error = new Error(`Unexpected scripted model call ${id}: no response remains.`);
    unexpectedCallErrors.push(error);
    throw error;
  }
  calls.push({ id, method, options, response });
  return { id, response };
}

function streamForResponse(response: ScriptedResponse, id: string): ReadableStream<LanguageModelV3StreamPart> {
  const finishReason = response.finishReason ?? (response.toolCalls?.length ? "tool-calls" : "stop");
  const parts: LanguageModelV3StreamPart[] = [{ type: "stream-start", warnings: [] }];

  if (response.text) {
    parts.push({ type: "text-start", id });
    parts.push({ type: "text-delta", id, delta: response.text });
    parts.push({ type: "text-end", id });
  }
  for (const [index, toolCall] of (response.toolCalls ?? []).entries()) {
    parts.push({
      type: "tool-call",
      toolCallId: toolCall.toolCallId ?? `${id}-tool-${index + 1}`,
      toolName: toolCall.toolName,
      input: JSON.stringify(toolCall.input),
    });
  }
  parts.push({ type: "finish", usage: usageFor(response.usage), finishReason: { unified: finishReason, raw: finishReason } });
  return new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(part); controller.close(); } });
}

function abortableStream(signal: AbortSignal | undefined, id: string, abortedCallIds: string[]): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      const abort = () => {
        abortedCallIds.push(id);
        controller.close();
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    },
  });
}

function usageFor(usage: ScriptedUsage | undefined): LanguageModelV3Usage {
  return {
    inputTokens: { total: usage?.inputTokens ?? 0, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: usage?.outputTokens ?? 0, text: usage?.outputTokens ?? 0, reasoning: undefined },
  };
}
