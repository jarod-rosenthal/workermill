import { vi, describe, it, expect, beforeEach } from "vitest";

const mockStreamText = vi.fn();
vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  stepCountIs: vi.fn((n: number) => n),
}));

import {
  name,
  description,
  parameters,
  createSubAgentExecutor,
} from "../../tools/sub-agent.js";

// Helper to build a mock stream object returned by streamText.
// textStream is an async iterable that yields each chunk in the provided array.
// text resolves to the joined string of all chunks.
function makeMockStream(chunks: string[] = ["result text"]) {
  const textStream = {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
  const text = Promise.resolve(chunks.join(""));
  return { textStream, text };
}

const FAKE_MODEL = {} as any;
const FAKE_DIR = "/tmp/fake-working-dir";
const FAKE_TOOLS = { read: vi.fn(), glob: vi.fn() };

describe("sub-agent tool — exports", () => {
  it("name equals 'sub_agent'", () => {
    expect(name).toBe("sub_agent");
  });

  it("description mentions read-only exploration", () => {
    expect(description.toLowerCase()).toContain("read-only");
    expect(description.toLowerCase()).toContain("explor");
  });

  it("parameters has required 'prompt' field", () => {
    expect(parameters.properties.prompt).toBeDefined();
    expect(parameters.properties.prompt.type).toBe("string");
    expect(parameters.required).toContain("prompt");
  });

  it("parameters has optional 'maxTurns' field", () => {
    expect(parameters.properties.maxTurns).toBeDefined();
    expect(parameters.properties.maxTurns.type).toBe("number");
    // maxTurns must NOT be in the required array
    expect(parameters.required).not.toContain("maxTurns");
  });
});

describe("createSubAgentExecutor", () => {
  beforeEach(() => {
    mockStreamText.mockReset();
  });

  it("returns a function", () => {
    const executor = createSubAgentExecutor(FAKE_MODEL, FAKE_DIR, FAKE_TOOLS);
    expect(typeof executor).toBe("function");
  });

  it("calls streamText with a system prompt that mentions 'cannot modify'", async () => {
    mockStreamText.mockReturnValue(makeMockStream());
    const executor = createSubAgentExecutor(FAKE_MODEL, FAKE_DIR, FAKE_TOOLS);
    await executor({ prompt: "explore the codebase" });

    expect(mockStreamText).toHaveBeenCalledOnce();
    const [callArgs] = mockStreamText.mock.calls;
    const opts = callArgs[0] as Record<string, unknown>;
    expect(typeof opts.system).toBe("string");
    expect((opts.system as string).toLowerCase()).toContain("cannot modify");
  });

  it("passes the model, prompt, and tools to streamText", async () => {
    mockStreamText.mockReturnValue(makeMockStream());
    const executor = createSubAgentExecutor(FAKE_MODEL, FAKE_DIR, FAKE_TOOLS);
    await executor({ prompt: "find all exports" });

    const opts = mockStreamText.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.model).toBe(FAKE_MODEL);
    expect(opts.prompt).toBe("find all exports");
    expect(opts.tools).toBe(FAKE_TOOLS);
  });

  it("returns success with the streamed text content", async () => {
    mockStreamText.mockReturnValue(makeMockStream(["hello ", "world"]));
    const executor = createSubAgentExecutor(FAKE_MODEL, FAKE_DIR, FAKE_TOOLS);
    const result = await executor({ prompt: "describe the repo" });

    expect(result.success).toBe(true);
    expect(result.content).toBe("hello world");
    expect(result.error).toBeUndefined();
  });

  it("uses default maxTurns of 20 when not specified", async () => {
    const { stepCountIs } = await import("ai");
    mockStreamText.mockReturnValue(makeMockStream());
    const executor = createSubAgentExecutor(FAKE_MODEL, FAKE_DIR, FAKE_TOOLS);
    await executor({ prompt: "check structure" });

    expect(stepCountIs).toHaveBeenCalledWith(20);
  });

  it("uses custom maxTurns when provided", async () => {
    const { stepCountIs } = await import("ai");
    mockStreamText.mockReturnValue(makeMockStream());
    const executor = createSubAgentExecutor(FAKE_MODEL, FAKE_DIR, FAKE_TOOLS);
    await executor({ prompt: "deep dive", maxTurns: 5 });

    expect(stepCountIs).toHaveBeenCalledWith(5);
  });

  it("returns failure when streamText throws", async () => {
    mockStreamText.mockImplementation(() => {
      throw new Error("connection refused");
    });
    const executor = createSubAgentExecutor(FAKE_MODEL, FAKE_DIR, FAKE_TOOLS);
    const result = await executor({ prompt: "find something" });

    expect(result.success).toBe(false);
    expect(result.content).toBe("");
    expect(result.turnsUsed).toBe(0);
    expect(result.error).toContain("connection refused");
  });

  it("returns failure when the text promise rejects", async () => {
    const textStream = {
      [Symbol.asyncIterator]: async function* () {
        // yields nothing; the text promise rejects below
      },
    };
    mockStreamText.mockReturnValue({
      textStream,
      text: Promise.reject(new Error("stream aborted")),
    });
    const executor = createSubAgentExecutor(FAKE_MODEL, FAKE_DIR, FAKE_TOOLS);
    const result = await executor({ prompt: "find something" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("stream aborted");
  });

  it("tracks turnsUsed via onStepFinish callback", async () => {
    // Capture the onStepFinish callback and call it manually to simulate 3 steps.
    let capturedOnStepFinish: (() => void) | undefined;
    mockStreamText.mockImplementation((opts: Record<string, unknown>) => {
      capturedOnStepFinish = opts.onStepFinish as () => void;
      return makeMockStream(["done"]);
    });

    const executor = createSubAgentExecutor(FAKE_MODEL, FAKE_DIR, FAKE_TOOLS);

    // Run the executor; before awaiting, trigger onStepFinish three times to
    // simulate the AI SDK calling back as each step completes.
    const promise = executor({ prompt: "multi-step task" });

    // By the time the promise is created, streamText has been called and
    // capturedOnStepFinish is set. Simulate 3 step completions.
    capturedOnStepFinish!();
    capturedOnStepFinish!();
    capturedOnStepFinish!();

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.turnsUsed).toBe(3);
  });
});
