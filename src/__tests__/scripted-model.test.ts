import { generateText, stepCountIs, streamText, tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createScriptedModel } from "./helpers/scripted-model.js";

describe("createScriptedModel", () => {
  it("dispatches a real tool and gives the next call its result", async () => {
    const scripted = createScriptedModel([
      { toolCalls: [{ toolName: "read_file", input: { path: "note.txt" } }], usage: { inputTokens: 3, outputTokens: 2 } },
      { text: "The note says hello.", usage: { inputTokens: 7, outputTokens: 5 } },
    ]);
    const readFile = tool({ inputSchema: z.object({ path: z.string() }), execute: async ({ path }) => `contents of ${path}` });

    const result = streamText({ model: scripted.model, tools: { read_file: readFile }, prompt: "Read note.txt", stopWhen: stepCountIs(2) });

    await expect(result.text).resolves.toBe("The note says hello.");
    expect(scripted.calls.map(call => call.id)).toEqual(["scripted-call-1", "scripted-call-2"]);
    expect(scripted.calls[1]?.options.prompt).toContainEqual({
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "scripted-call-1-tool-1", toolName: "read_file", output: { type: "text", value: "contents of note.txt" } }],
    });
    expect(await result.totalUsage).toMatchObject({ inputTokens: 10, outputTokens: 7 });
    expect(await result.finishReason).toBe("stop");
    scripted.assertComplete();
  });

  it("fails explicitly if streamText makes an unplanned call", async () => {
    const scripted = createScriptedModel([{ text: "first" }]);
    await streamText({ model: scripted.model, prompt: "one" }).text;
    await expect(scripted.model.doStream({ prompt: [], abortSignal: undefined })).rejects.toThrow(
      "Unexpected scripted model call scripted-call-2",
    );
    expect(() => scripted.assertComplete()).toThrow("Unexpected scripted model call scripted-call-2");
  });

  it("also supports deterministic generateText calls", async () => {
    const scripted = createScriptedModel([{ text: "summary", usage: { inputTokens: 2, outputTokens: 1 } }]);
    const result = await generateText({ model: scripted.model, prompt: "summarize" });
    expect(result.text).toBe("summary");
    expect(scripted.calls[0]).toMatchObject({ id: "scripted-call-1", method: "generate" });
    scripted.assertComplete();
  });

  it("records an abort after a stream has started", async () => {
    const controller = new AbortController();
    const scripted = createScriptedModel([{ waitForAbort: true }]);
    const result = streamText({ model: scripted.model, prompt: "wait", abortSignal: controller.signal });
    const started = result.fullStream[Symbol.asyncIterator]();
    await started.next();
    controller.abort();
    await started.next();
    expect(scripted.abortedCallIds).toEqual(["scripted-call-1"]);
    scripted.assertComplete();
  });
});
