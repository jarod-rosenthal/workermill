import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock dependencies BEFORE importing ai-client ─────────────────────────

const {
  mockStreamText,
  mockStepCountIs,
  mockCreateModel,
  mockBuildOllamaOptions,
  mockCreateToolDefinitions,
} = vi.hoisted(() => {
  return {
    mockStreamText: vi.fn(),
    mockStepCountIs: vi.fn((n: number) => `stepCountIs(${n})`),
    mockCreateModel: vi.fn(() => ({ modelId: "test-model" })),
    mockBuildOllamaOptions: vi.fn(() => ({})),
    mockCreateToolDefinitions: vi.fn(() => ({ read_file: {}, write_file: {} })),
  };
});

vi.mock("ai", () => ({
  streamText: mockStreamText,
  stepCountIs: mockStepCountIs,
}));

vi.mock("../model-factory.js", () => ({
  createModel: mockCreateModel,
  buildOllamaOptions: mockBuildOllamaOptions,
}));

vi.mock("../tools/index.js", () => ({
  createToolDefinitions: mockCreateToolDefinitions,
}));

import { EngineAIClient } from "../ai-client.js";
import type { AIClientConfig, AIClientOptions } from "../types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<AIClientConfig>): AIClientConfig {
  return {
    provider: "anthropic",
    apiKeys: {},
    ...overrides,
  };
}

function makeOptions(overrides?: Partial<AIClientOptions>): AIClientOptions {
  return {
    systemPrompt: "You are a helpful assistant.",
    prompt: "Write a hello world function.",
    persona: "backend_developer",
    model: "claude-sonnet-4-6",
    workingDir: "/tmp/test-project",
    ...overrides,
  };
}

/** Creates a mock stream result that mimics the streamText return value. */
function createMockStream(opts?: {
  text?: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}) {
  const text = opts?.text ?? "Done.";
  const usage = opts?.usage ?? { promptTokens: 100, completionTokens: 50 };

  return {
    textStream: (async function* () {
      yield text;
    })(),
    text: Promise.resolve(text),
    totalUsage: Promise.resolve(usage),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("EngineAIClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Constructor ───────────────────────────────────────────────────────

  describe("constructor", () => {
    it("stores the config", () => {
      const config = makeConfig({ provider: "openai" });
      const client = new EngineAIClient(config);
      // Verify it doesn't throw and the instance is created
      expect(client).toBeInstanceOf(EngineAIClient);
    });
  });

  // ── execute() — streamText parameters ─────────────────────────────────

  describe("execute() parameters", () => {
    it("calls createModel with provider, model, and ollamaHost", async () => {
      mockStreamText.mockReturnValue(createMockStream());

      const client = new EngineAIClient(
        makeConfig({ provider: "ollama", apiKeys: { ollamaHost: "http://myhost:11434" } }),
      );
      await client.execute(makeOptions({ model: "qwen3-coder:30b" }));

      expect(mockCreateModel).toHaveBeenCalledWith("ollama", "qwen3-coder:30b", "http://myhost:11434");
    });

    it("calls createToolDefinitions with workingDir and model", async () => {
      const fakeModel = { modelId: "test-model" };
      mockCreateModel.mockReturnValue(fakeModel);
      mockStreamText.mockReturnValue(createMockStream());

      const client = new EngineAIClient(makeConfig());
      await client.execute(makeOptions({ workingDir: "/my/project" }));

      expect(mockCreateToolDefinitions).toHaveBeenCalledWith("/my/project", fakeModel);
    });

    it("passes system prompt, prompt, model, and tools to streamText", async () => {
      const fakeModel = { modelId: "test-model" };
      const fakeTools = { bash: {}, read_file: {} };
      mockCreateModel.mockReturnValue(fakeModel);
      mockCreateToolDefinitions.mockReturnValue(fakeTools);
      mockStreamText.mockReturnValue(createMockStream());

      const client = new EngineAIClient(makeConfig());
      await client.execute(
        makeOptions({
          systemPrompt: "Be helpful.",
          prompt: "Fix the bug.",
        }),
      );

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          model: fakeModel,
          system: "Be helpful.",
          prompt: "Fix the bug.",
          tools: fakeTools,
        }),
      );
    });

    it("uses stepCountIs with maxTurns option", async () => {
      mockStreamText.mockReturnValue(createMockStream());

      const client = new EngineAIClient(makeConfig());
      await client.execute(makeOptions({ maxTurns: 25 }));

      expect(mockStepCountIs).toHaveBeenCalledWith(25);
      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          stopWhen: "stepCountIs(25)",
        }),
      );
    });

    it("defaults maxTurns to 100 when not specified", async () => {
      mockStreamText.mockReturnValue(createMockStream());

      const client = new EngineAIClient(makeConfig());
      await client.execute(makeOptions({ maxTurns: undefined }));

      expect(mockStepCountIs).toHaveBeenCalledWith(100);
    });

    it("sets AbortSignal.timeout from timeoutMs option", async () => {
      mockStreamText.mockReturnValue(createMockStream());

      const client = new EngineAIClient(makeConfig());
      await client.execute(makeOptions({ timeoutMs: 60_000 }));

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          abortSignal: expect.any(AbortSignal),
        }),
      );
    });

    it("spreads buildOllamaOptions into streamText call", async () => {
      const ollamaOpts = {
        providerOptions: { ollama: { options: { num_ctx: 32768 } } },
      };
      mockBuildOllamaOptions.mockReturnValue(ollamaOpts);
      mockStreamText.mockReturnValue(createMockStream());

      const client = new EngineAIClient(makeConfig({ provider: "ollama" }));
      await client.execute(makeOptions({ contextLength: 32768 }));

      expect(mockBuildOllamaOptions).toHaveBeenCalledWith("ollama", 32768);
      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOptions: { ollama: { options: { num_ctx: 32768 } } },
        }),
      );
    });

    it("calls buildOllamaOptions with empty object for non-ollama provider", async () => {
      mockBuildOllamaOptions.mockReturnValue({});
      mockStreamText.mockReturnValue(createMockStream());

      const client = new EngineAIClient(makeConfig({ provider: "anthropic" }));
      await client.execute(makeOptions());

      expect(mockBuildOllamaOptions).toHaveBeenCalledWith("anthropic", undefined);
    });
  });

    it("filters tools passed to streamText when allowedTools is set", async () => {
      const fakeTools = { bash: {}, read_file: {}, write_file: {} };
      mockCreateToolDefinitions.mockReturnValue(fakeTools);
      mockStreamText.mockReturnValue(createMockStream());

      const client = new EngineAIClient(makeConfig());
      await client.execute(makeOptions({ allowedTools: ["read_file"] }));

      expect(mockStreamText).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: { read_file: {} },
        }),
      );
    });

  // ── execute() — streaming and callbacks ───────────────────────────────

  describe("execute() streaming and callbacks", () => {
    it("calls onMessage with text from onStepFinish", async () => {
      const messages: Array<{ type: string; content?: string }> = [];

      mockStreamText.mockImplementation((opts: Record<string, unknown>) => {
        // Simulate onStepFinish being called during streaming
        const onStepFinish = opts.onStepFinish as (args: Record<string, unknown>) => void;
        onStepFinish({ text: "Some agent thought", toolCalls: null, toolResults: null });
        return createMockStream();
      });

      const client = new EngineAIClient(makeConfig());
      await client.execute(
        makeOptions({
          onMessage: (msg) => messages.push(msg),
        }),
      );

      expect(messages).toContainEqual({ type: "text", content: "Some agent thought" });
    });

    it("calls onMessage with tool_use from onStepFinish", async () => {
      const messages: Array<Record<string, unknown>> = [];

      mockStreamText.mockImplementation((opts: Record<string, unknown>) => {
        const onStepFinish = opts.onStepFinish as (args: Record<string, unknown>) => void;
        onStepFinish({
          text: "",
          toolCalls: [{ toolName: "read_file", input: { file_path: "/src/main.ts" } }],
          toolResults: null,
        });
        return createMockStream();
      });

      const client = new EngineAIClient(makeConfig());
      await client.execute(
        makeOptions({
          onMessage: (msg) => messages.push(msg),
        }),
      );

      expect(messages).toContainEqual({
        type: "tool_use",
        toolName: "read_file",
        toolInput: { file_path: "/src/main.ts" },
      });
    });

    it("calls onMessage with tool_result from onStepFinish", async () => {
      const messages: Array<Record<string, unknown>> = [];

      mockStreamText.mockImplementation((opts: Record<string, unknown>) => {
        const onStepFinish = opts.onStepFinish as (args: Record<string, unknown>) => void;
        onStepFinish({
          text: "",
          toolCalls: null,
          toolResults: [{ result: "file contents here" }],
        });
        return createMockStream();
      });

      const client = new EngineAIClient(makeConfig());
      await client.execute(
        makeOptions({
          onMessage: (msg) => messages.push(msg),
        }),
      );

      expect(messages).toContainEqual({
        type: "tool_result",
        content: "file contents here",
      });
    });

    it("JSON-stringifies non-string tool results", async () => {
      const messages: Array<Record<string, unknown>> = [];

      mockStreamText.mockImplementation((opts: Record<string, unknown>) => {
        const onStepFinish = opts.onStepFinish as (args: Record<string, unknown>) => void;
        onStepFinish({
          text: "",
          toolCalls: null,
          toolResults: [{ result: { files: ["a.ts", "b.ts"] } }],
        });
        return createMockStream();
      });

      const client = new EngineAIClient(makeConfig());
      await client.execute(
        makeOptions({
          onMessage: (msg) => messages.push(msg),
        }),
      );

      expect(messages).toContainEqual({
        type: "tool_result",
        content: JSON.stringify({ files: ["a.ts", "b.ts"] }),
      });
    });

    it("does not call onMessage when callbacks are not provided", async () => {
      mockStreamText.mockImplementation((opts: Record<string, unknown>) => {
        const onStepFinish = opts.onStepFinish as (args: Record<string, unknown>) => void;
        // This should not throw even with no onMessage
        onStepFinish({
          text: "Some text",
          toolCalls: [{ toolName: "bash", input: { command: "ls" } }],
          toolResults: [{ result: "output" }],
        });
        return createMockStream();
      });

      const client = new EngineAIClient(makeConfig());
      // No onMessage — should not throw
      const result = await client.execute(makeOptions({ onMessage: undefined }));
      expect(result.success).toBe(true);
    });
  });

  // ── execute() — token usage tracking ──────────────────────────────────

  describe("execute() token usage", () => {
    it("extracts promptTokens/completionTokens usage", async () => {
      mockStreamText.mockReturnValue(
        createMockStream({ usage: { promptTokens: 200, completionTokens: 80 } }),
      );

      const client = new EngineAIClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.tokenUsage).toEqual({
        inputTokens: 200,
        outputTokens: 80,
        totalTokens: 280,
      });
    });

    it("falls back to inputTokens/outputTokens naming", async () => {
      mockStreamText.mockReturnValue(
        createMockStream({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          usage: { inputTokens: 150, outputTokens: 60 } as any,
        }),
      );

      const client = new EngineAIClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.tokenUsage).toEqual({
        inputTokens: 150,
        outputTokens: 60,
        totalTokens: 210,
      });
    });

    it("defaults to 0 when usage fields are missing", async () => {
      mockStreamText.mockReturnValue(
        createMockStream({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          usage: {} as any,
        }),
      );

      const client = new EngineAIClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.tokenUsage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
    });

    it("calls onTokenUsage callback with usage data", async () => {
      mockStreamText.mockReturnValue(
        createMockStream({ usage: { promptTokens: 300, completionTokens: 100 } }),
      );

      const onTokenUsage = vi.fn();
      const client = new EngineAIClient(makeConfig());
      await client.execute(makeOptions({ onTokenUsage }));

      expect(onTokenUsage).toHaveBeenCalledWith({
        inputTokens: 300,
        outputTokens: 100,
        totalTokens: 400,
      });
    });

    it("does not call onTokenUsage when not provided", async () => {
      mockStreamText.mockReturnValue(createMockStream());

      const client = new EngineAIClient(makeConfig());
      // Should not throw
      const result = await client.execute(makeOptions({ onTokenUsage: undefined }));
      expect(result.success).toBe(true);
    });
  });

  // ── execute() — result and markers ────────────────────────────────────

  describe("execute() result", () => {
    it("returns success with text and markers", async () => {
      mockStreamText.mockReturnValue(
        createMockStream({ text: "All done. ::status::complete ::reviewer::approved" }),
      );

      const client = new EngineAIClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.success).toBe(true);
      expect(result.text).toBe("All done. ::status::complete ::reviewer::approved");
      expect(result.markers).toEqual({
        status: "complete",
        reviewer: "approved",
      });
    });

    it("returns empty markers when no markers in text", async () => {
      mockStreamText.mockReturnValue(createMockStream({ text: "Plain text result." }));

      const client = new EngineAIClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.markers).toEqual({});
    });

    it("extracts single marker", async () => {
      mockStreamText.mockReturnValue(createMockStream({ text: "::verdict::pass" }));

      const client = new EngineAIClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.markers).toEqual({ verdict: "pass" });
    });
  });

  // ── execute() — error handling ────────────────────────────────────────

  describe("execute() error handling", () => {
    it("returns failure with error message on non-timeout error", async () => {
      mockStreamText.mockImplementation(() => {
        throw new Error("API rate limit exceeded");
      });

      const client = new EngineAIClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.success).toBe(false);
      expect(result.text).toBe("");
      expect(result.error).toBe("API rate limit exceeded");
    });

    it("returns timeout error when error message contains 'aborted'", async () => {
      mockStreamText.mockImplementation(() => {
        throw new Error("The operation was aborted");
      });

      const client = new EngineAIClient(makeConfig());
      const result = await client.execute(makeOptions({ timeoutMs: 60_000 }));

      expect(result.success).toBe(false);
      expect(result.error).toBe("Execution timed out after 60000ms");
    });

    it("returns timeout error when error message contains 'timeout'", async () => {
      mockStreamText.mockImplementation(() => {
        throw new Error("Request timeout");
      });

      const client = new EngineAIClient(makeConfig());
      const result = await client.execute(makeOptions({ timeoutMs: 120_000 }));

      expect(result.success).toBe(false);
      expect(result.error).toBe("Execution timed out after 120000ms");
    });

    it("uses default timeout in error message when timeoutMs not set", async () => {
      mockStreamText.mockImplementation(() => {
        throw new Error("aborted");
      });

      const client = new EngineAIClient(makeConfig());
      const result = await client.execute(makeOptions({ timeoutMs: undefined }));

      expect(result.success).toBe(false);
      expect(result.error).toBe("Execution timed out after 1800000ms");
    });

    it("handles non-Error throws by converting to string", async () => {
      mockStreamText.mockImplementation(() => {
        throw "raw string error";
      });

      const client = new EngineAIClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.success).toBe(false);
      expect(result.error).toBe("raw string error");
    });
  });
});
