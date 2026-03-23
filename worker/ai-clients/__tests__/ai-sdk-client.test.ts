import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("ai", () => ({
  streamText: vi.fn(),
  stepCountIs: vi.fn().mockReturnValue(() => false),
}));
vi.mock("../model-factory.js", () => ({
  createModel: vi.fn().mockReturnValue({}),
  buildCostTrackingMetadata: vi.fn().mockReturnValue({}),
  buildReasoningOptions: vi.fn().mockReturnValue({}),
}));
vi.mock("../tools/index.js", () => ({
  createToolDefinitions: vi.fn().mockReturnValue({}),
}));

import { streamText } from "ai";
import { AISdkClient } from "../ai-sdk-client.js";
import type { AIClientConfig, AIClientOptions } from "../types.js";

function makeConfig(overrides: Partial<AIClientConfig> = {}): AIClientConfig {
  return {
    provider: "ollama",
    apiKeys: { ollamaHost: "http://localhost:11434" },
    apiConfig: { baseUrl: "http://localhost:3001", orgApiKey: "test" },
    ...overrides,
  };
}

function makeOptions(overrides: Partial<AIClientOptions> = {}): AIClientOptions {
  return {
    prompt: "test prompt",
    systemPrompt: "test system",
    persona: "backend_developer",
    model: "test-model",
    workingDir: "/tmp/test",
    storyId: "story-1",
    parentTaskId: "task-1",
    ...overrides,
  };
}

describe("AISdkClient", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    // Save env vars we might mutate
    for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "OLLAMA_HOST"]) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    // Restore env vars
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  describe("constructor", () => {
    it("sets provider and capabilities from config", () => {
      const client = new AISdkClient(makeConfig({ provider: "openai" }));
      expect(client.provider).toBe("openai");
      expect(client.capabilities.supportsStreaming).toBe(true);
    });

    it("falls back to anthropic capabilities for unknown provider", () => {
      const client = new AISdkClient(makeConfig({ provider: "unknown" as any }));
      expect(client.capabilities.maxContextTokens).toBe(200000);
    });
  });

  describe("execute — error handling", () => {
    it("detects total timeout errors (message contains 'timeout')", async () => {
      vi.mocked(streamText).mockImplementation(() => {
        throw new Error("Request timeout after 30 minutes");
      });

      const client = new AISdkClient(makeConfig());
      const result = await client.execute(makeOptions({ timeoutMs: 1800000 }));

      expect(result.success).toBe(false);
      expect(result.error).toContain("Execution timed out after 30 minutes");
      expect(result.markers).toEqual({ result: "failed" });
    });

    it("detects chunk stall timeout errors (message contains 'chunk')", async () => {
      vi.mocked(streamText).mockImplementation(() => {
        throw new Error("chunk timeout: no data received");
      });

      const client = new AISdkClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.success).toBe(false);
      expect(result.error).toContain("No response data received for 2 minutes");
      expect(result.error).toContain("provider connection likely dropped");
    });

    it("detects aborted errors", async () => {
      vi.mocked(streamText).mockImplementation(() => {
        throw new Error("Request aborted by client");
      });

      const client = new AISdkClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.success).toBe(false);
      // "aborted" triggers the timeout branch but not the chunk branch
      expect(result.error).toContain("Execution timed out after");
    });

    it("returns generic error for non-timeout failures", async () => {
      vi.mocked(streamText).mockImplementation(() => {
        throw new Error("Rate limit exceeded");
      });

      const client = new AISdkClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.success).toBe(false);
      expect(result.error).toBe("Rate limit exceeded");
      expect(result.markers).toEqual({ result: "failed" });
    });

    it("handles non-Error thrown values", async () => {
      vi.mocked(streamText).mockImplementation(() => {
        throw "string error";
      });

      const client = new AISdkClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.success).toBe(false);
      expect(result.error).toBe("string error");
    });

    it("uses default timeout in error message when timeoutMs not specified", async () => {
      vi.mocked(streamText).mockImplementation(() => {
        throw new Error("Timeout reached");
      });

      const client = new AISdkClient(makeConfig());
      const result = await client.execute(makeOptions({ timeoutMs: undefined }));

      expect(result.success).toBe(false);
      // Default is 30 * 60 * 1000 = 1800000ms = 30 minutes
      expect(result.error).toContain("30 minutes");
    });
  });

  describe("extractMarkers (via execute)", () => {
    function mockStreamSuccess(finalText: string) {
      const mockStream = {
        textStream: {
          [Symbol.asyncIterator]: () => ({
            next: vi.fn().mockResolvedValueOnce({ done: true }),
          }),
        },
        text: Promise.resolve(finalText),
        totalUsage: Promise.resolve({ promptTokens: 10, completionTokens: 20 }),
        steps: [],
      };
      vi.mocked(streamText).mockReturnValue(mockStream as any);
    }

    it("extracts ::result::completed marker", async () => {
      mockStreamSuccess("Task done.\n::result::completed\n");
      const client = new AISdkClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.success).toBe(true);
      expect(result.markers?.result).toBe("completed");
    });

    it("extracts ::pr_url:: marker", async () => {
      mockStreamSuccess("::pr_url::https://github.com/org/repo/pull/42");
      const client = new AISdkClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.markers?.prUrl).toBe("https://github.com/org/repo/pull/42");
    });

    it("extracts ::review_decision::approved marker", async () => {
      mockStreamSuccess("::review_decision::approved\n::code_quality_score::85");
      const client = new AISdkClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.markers?.reviewDecision).toBe("approved");
      expect(result.structuredOutput).toEqual({
        decision: "approved",
        codeQualityScore: 85,
        feedback: undefined,
      });
    });

    it("extracts ::code_quality_score:: marker as number", async () => {
      mockStreamSuccess("::code_quality_score::85");
      const client = new AISdkClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.markers?.codeQualityScore).toBe(85);
    });

    it("extracts multiple ::learning:: markers into array", async () => {
      mockStreamSuccess(
        "::learning::Use async/await consistently\n::learning::Add error boundaries\n::learning::Log structured data"
      );
      const client = new AISdkClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.markers?.learnings).toEqual([
        "Use async/await consistently",
        "Add error boundaries",
        "Log structured data",
      ]);
    });

    it("handles empty text gracefully", async () => {
      mockStreamSuccess("");
      const client = new AISdkClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.success).toBe(true);
      expect(result.markers?.result).toBeUndefined();
    });

    it("extracts ::pr_number:: and ::branch:: markers", async () => {
      mockStreamSuccess("::pr_number::42\n::branch::ai/OCS-123");
      const client = new AISdkClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.markers?.prNumber).toBe("42");
      expect(result.markers?.branch).toBe("ai/OCS-123");
    });

    it("extracts ::feedback:: marker", async () => {
      mockStreamSuccess("::review_decision::revision_needed\n::feedback::Missing error handling in API route");
      const client = new AISdkClient(makeConfig());
      const result = await client.execute(makeOptions());

      expect(result.markers?.feedback).toBe("Missing error handling in API route");
    });
  });

  describe("setProviderEnv (via execute)", () => {
    // setProviderEnv is called at the start of execute(), so we can observe env changes

    it("sets OLLAMA_HOST for ollama provider", async () => {
      vi.mocked(streamText).mockImplementation(() => {
        // Capture env at call time
        expect(process.env.OLLAMA_HOST).toBe("http://my-ollama:11434");
        throw new Error("stop");
      });

      const client = new AISdkClient(
        makeConfig({ provider: "ollama", apiKeys: { ollamaHost: "http://my-ollama:11434" } })
      );
      await client.execute(makeOptions());
    });

    it("sets ANTHROPIC_API_KEY for anthropic provider", async () => {
      vi.mocked(streamText).mockImplementation(() => {
        expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
        throw new Error("stop");
      });

      const client = new AISdkClient(
        makeConfig({ provider: "anthropic", apiKeys: { anthropic: "sk-ant-test" } })
      );
      await client.execute(makeOptions());
    });

    it("sets OPENAI_API_KEY for openai provider", async () => {
      vi.mocked(streamText).mockImplementation(() => {
        expect(process.env.OPENAI_API_KEY).toBe("sk-openai-test");
        throw new Error("stop");
      });

      const client = new AISdkClient(
        makeConfig({ provider: "openai", apiKeys: { openai: "sk-openai-test" } })
      );
      await client.execute(makeOptions());
    });

    it("sets GOOGLE_API_KEY and GOOGLE_GENERATIVE_AI_API_KEY for google provider", async () => {
      vi.mocked(streamText).mockImplementation(() => {
        expect(process.env.GOOGLE_API_KEY).toBe("google-test-key");
        expect(process.env.GOOGLE_GENERATIVE_AI_API_KEY).toBe("google-test-key");
        throw new Error("stop");
      });

      const client = new AISdkClient(
        makeConfig({ provider: "google", apiKeys: { google: "google-test-key" } })
      );
      await client.execute(makeOptions());
    });

    it("does not set env var when api key is not provided", async () => {
      delete process.env.ANTHROPIC_API_KEY;
      vi.mocked(streamText).mockImplementation(() => {
        expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
        throw new Error("stop");
      });

      const client = new AISdkClient(
        makeConfig({ provider: "anthropic", apiKeys: {} })
      );
      await client.execute(makeOptions());
    });
  });

  describe("execute — success path", () => {
    it("returns success with token usage and model", async () => {
      const mockStream = {
        textStream: {
          [Symbol.asyncIterator]: () => ({
            next: vi.fn().mockResolvedValueOnce({ done: true }),
          }),
        },
        text: Promise.resolve("::result::completed"),
        totalUsage: Promise.resolve({ promptTokens: 100, completionTokens: 50 }),
        steps: [],
      };
      vi.mocked(streamText).mockReturnValue(mockStream as any);

      const client = new AISdkClient(makeConfig());
      const result = await client.execute(makeOptions({ model: "my-model" }));

      expect(result.success).toBe(true);
      expect(result.modelUsed).toBe("my-model");
      expect(result.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 50 });
    });

    it("calls onTokenUsage callback", async () => {
      const mockStream = {
        textStream: {
          [Symbol.asyncIterator]: () => ({
            next: vi.fn().mockResolvedValueOnce({ done: true }),
          }),
        },
        text: Promise.resolve("done"),
        totalUsage: Promise.resolve({ promptTokens: 10, completionTokens: 5 }),
        steps: [],
      };
      vi.mocked(streamText).mockReturnValue(mockStream as any);

      const onTokenUsage = vi.fn();
      const client = new AISdkClient(makeConfig());
      await client.execute(makeOptions({ onTokenUsage }));

      expect(onTokenUsage).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 5 });
    });
  });
});
