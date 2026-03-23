import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn().mockReturnValue({ modelId: "claude-test" }),
}));
vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn().mockReturnValue({ modelId: "gpt-test" }),
}));
vi.mock("@ai-sdk/google", () => ({
  google: vi.fn().mockReturnValue({ modelId: "gemini-test" }),
}));
vi.mock("ollama-ai-provider-v2", () => ({
  createOllama: vi.fn().mockReturnValue(vi.fn().mockReturnValue({ modelId: "ollama-test" })),
}));

import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { createOllama } from "ollama-ai-provider-v2";
import { createModel, buildCostTrackingMetadata, buildReasoningOptions } from "../model-factory.js";

describe("model-factory", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "OLLAMA_HOST"]) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  describe("createModel", () => {
    it("creates model for anthropic provider", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      const model = createModel("anthropic", "claude-sonnet-4-20250514");

      expect(anthropic).toHaveBeenCalledWith("claude-sonnet-4-20250514");
      expect(model).toEqual({ modelId: "claude-test" });
    });

    it("creates model for openai provider", () => {
      process.env.OPENAI_API_KEY = "sk-openai-test";
      const model = createModel("openai", "gpt-4o");

      expect(openai).toHaveBeenCalledWith("gpt-4o");
      expect(model).toEqual({ modelId: "gpt-test" });
    });

    it("creates model for google provider", () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = "google-key";
      const model = createModel("google", "gemini-2.0-flash");

      expect(google).toHaveBeenCalledWith("gemini-2.0-flash");
      expect(model).toEqual({ modelId: "gemini-test" });
    });

    it("creates model for gemini provider (alias)", () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = "google-key";
      const model = createModel("gemini", "gemini-2.0-flash");

      expect(google).toHaveBeenCalledWith("gemini-2.0-flash");
      expect(model).toEqual({ modelId: "gemini-test" });
    });

    it("creates model for ollama provider", () => {
      const model = createModel("ollama", "qwen2.5-coder:32b");

      expect(createOllama).toHaveBeenCalledWith({
        baseURL: "http://localhost:11434/api",
        keepAlive: "-1",
      });
      expect(model).toEqual({ modelId: "ollama-test" });
    });

    it("uses OLLAMA_HOST env var for ollama", () => {
      process.env.OLLAMA_HOST = "http://remote-ollama:11434";
      createModel("ollama", "test-model");

      expect(createOllama).toHaveBeenCalledWith({
        baseURL: "http://remote-ollama:11434/api",
        keepAlive: "-1",
      });
    });

    it("falls back to localhost for ollama when OLLAMA_HOST not set", () => {
      delete process.env.OLLAMA_HOST;
      createModel("ollama", "test-model");

      expect(createOllama).toHaveBeenCalledWith({
        baseURL: "http://localhost:11434/api",
        keepAlive: "-1",
      });
    });

    it("throws on missing ANTHROPIC_API_KEY", () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(() => createModel("anthropic", "claude-test")).toThrow(
        "ANTHROPIC_API_KEY environment variable is required"
      );
    });

    it("throws on missing OPENAI_API_KEY", () => {
      delete process.env.OPENAI_API_KEY;
      expect(() => createModel("openai", "gpt-4o")).toThrow(
        "OPENAI_API_KEY environment variable is required"
      );
    });

    it("throws on missing Google API key", () => {
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      expect(() => createModel("google", "gemini-2.0-flash")).toThrow(
        "GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_API_KEY environment variable is required"
      );
    });

    it("accepts GOOGLE_API_KEY as fallback and sets GOOGLE_GENERATIVE_AI_API_KEY", () => {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      process.env.GOOGLE_API_KEY = "google-fallback-key";
      createModel("google", "gemini-2.0-flash");

      expect(process.env.GOOGLE_GENERATIVE_AI_API_KEY).toBe("google-fallback-key");
      expect(google).toHaveBeenCalledWith("gemini-2.0-flash");
    });

    it("throws on unknown provider", () => {
      expect(() => createModel("unknown" as any, "model")).toThrow(
        "Unknown provider: unknown"
      );
    });
  });

  describe("buildCostTrackingMetadata", () => {
    it("returns anthropic metadata with user_id", () => {
      const result = buildCostTrackingMetadata("anthropic", "org-1", "task-1");
      expect(result).toEqual({
        providerOptions: {
          anthropic: {
            metadata: { user_id: "workermill:org-1:task-1" },
          },
        },
      });
    });

    it("returns openai metadata with user field", () => {
      const result = buildCostTrackingMetadata("openai", "org-1", "task-1");
      expect(result).toEqual({
        providerOptions: {
          openai: { user: "workermill:org-1:task-1" },
        },
      });
    });

    it("returns google metadata with user_id", () => {
      const result = buildCostTrackingMetadata("google", "org-1", "task-1");
      expect(result).toEqual({
        providerOptions: {
          google: {
            metadata: { user_id: "workermill:org-1:task-1" },
          },
        },
      });
    });

    it("returns google metadata for gemini alias", () => {
      const result = buildCostTrackingMetadata("gemini", "org-1", "task-1");
      expect(result).toEqual({
        providerOptions: {
          google: {
            metadata: { user_id: "workermill:org-1:task-1" },
          },
        },
      });
    });

    it("returns empty object for ollama", () => {
      const result = buildCostTrackingMetadata("ollama", "org-1", "task-1");
      expect(result).toEqual({});
    });

    it("returns empty object when no org/task context", () => {
      const result = buildCostTrackingMetadata("anthropic", undefined, undefined);
      expect(result).toEqual({});
    });

    it("returns metadata with partial context (orgId only)", () => {
      const result = buildCostTrackingMetadata("anthropic", "org-1", undefined);
      expect(result).toEqual({
        providerOptions: {
          anthropic: {
            metadata: { user_id: "workermill:org-1:" },
          },
        },
      });
    });

    it("returns metadata with partial context (taskId only)", () => {
      const result = buildCostTrackingMetadata("openai", undefined, "task-1");
      expect(result).toEqual({
        providerOptions: {
          openai: { user: "workermill::task-1" },
        },
      });
    });
  });

  describe("buildReasoningOptions", () => {
    it("returns empty object for anthropic", () => {
      const result = buildReasoningOptions("anthropic", "claude-sonnet-4-20250514");
      expect(result).toEqual({});
    });

    it("returns empty object for ollama", () => {
      const result = buildReasoningOptions("ollama", "qwen2.5-coder:32b");
      expect(result).toEqual({});
    });

    it("returns reasoningSummary for openai", () => {
      const result = buildReasoningOptions("openai", "gpt-4o");
      expect(result).toEqual({
        providerOptions: {
          openai: { reasoningSummary: "detailed" },
        },
      });
    });

    it("returns thinkingConfig with thinkingBudget for non-gemini-3 google models", () => {
      const result = buildReasoningOptions("google", "gemini-2.0-flash");
      expect(result).toEqual({
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingBudget: 8192,
              includeThoughts: true,
            },
          },
        },
      });
    });

    it("returns thinkingConfig with thinkingLevel for gemini-3 models", () => {
      const result = buildReasoningOptions("google", "gemini-3-pro");
      expect(result).toEqual({
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingLevel: "high",
              includeThoughts: true,
            },
          },
        },
      });
    });

    it("returns thinkingConfig for gemini alias provider", () => {
      const result = buildReasoningOptions("gemini", "gemini-2.0-flash");
      expect(result).toEqual({
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingBudget: 8192,
              includeThoughts: true,
            },
          },
        },
      });
    });
  });
});
