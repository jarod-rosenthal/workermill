import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock provider SDKs BEFORE importing model-factory ──────────────────────

const {
  mockAnthropicModel,
  mockAnthropicFn,
  mockOpenaiChatModel,
  mockOpenaiResponsesModel,
  mockOpenaiChat,
  mockOpenaiResponses,
  mockCustomOpenaiChat,
  mockCreateOpenAI,
  mockGoogleModel,
  mockGoogleFn,
  mockOllamaModel,
  mockOllamaProvider,
  mockCreateOllama,
} = vi.hoisted(() => {
  const mockAnthropicModel = { modelId: "anthropic-mock" };
  const mockAnthropicFn = vi.fn(() => mockAnthropicModel);

  const mockOpenaiChatModel = { modelId: "openai-chat-mock" };
  const mockOpenaiResponsesModel = { modelId: "openai-responses-mock" };
  const mockOpenaiChat = vi.fn(() => mockOpenaiChatModel);
  const mockOpenaiResponses = vi.fn(() => mockOpenaiResponsesModel);
  const mockCustomOpenaiChat = vi.fn(() => ({ modelId: "custom-openai-mock" }));
  const mockCreateOpenAI = vi.fn(() => ({
    chat: mockCustomOpenaiChat,
  }));

  const mockGoogleModel = { modelId: "google-mock" };
  const mockGoogleFn = vi.fn(() => mockGoogleModel);

  const mockOllamaModel = { modelId: "ollama-mock" };
  const mockOllamaProvider = vi.fn(() => mockOllamaModel);
  const mockCreateOllama = vi.fn(() => mockOllamaProvider);

  return {
    mockAnthropicModel,
    mockAnthropicFn,
    mockOpenaiChatModel,
    mockOpenaiResponsesModel,
    mockOpenaiChat,
    mockOpenaiResponses,
    mockCustomOpenaiChat,
    mockCreateOpenAI,
    mockGoogleModel,
    mockGoogleFn,
    mockOllamaModel,
    mockOllamaProvider,
    mockCreateOllama,
  };
});

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: mockAnthropicFn,
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: Object.assign(mockOpenaiChat, {
    chat: mockOpenaiChat,
    responses: mockOpenaiResponses,
  }),
  createOpenAI: mockCreateOpenAI,
}));

vi.mock("@ai-sdk/google", () => ({
  google: mockGoogleFn,
}));

vi.mock("ollama-ai-provider-v2", () => ({
  createOllama: mockCreateOllama,
}));

import { createModel, buildOllamaOptions, ensureOllamaContext } from "../model-factory.js";

// ─── createModel ────────────────────────────────────────────────────────────

describe("createModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an anthropic model", () => {
    const model = createModel("anthropic", "claude-sonnet-4-6");
    expect(mockAnthropicFn).toHaveBeenCalledWith("claude-sonnet-4-6");
    expect(model).toBe(mockAnthropicModel);
  });

  it("creates an openai chat model", () => {
    const model = createModel("openai", "gpt-5.4");
    expect(mockOpenaiChat).toHaveBeenCalledWith("gpt-5.4");
    expect(model).toBe(mockOpenaiChatModel);
  });

  it("creates an openai responses model for codex", () => {
    const model = createModel("openai", "gpt-5-codex");
    expect(mockOpenaiResponses).toHaveBeenCalledWith("gpt-5-codex");
    expect(model).toBe(mockOpenaiResponsesModel);
  });

  it("creates a custom openai model with host", () => {
    createModel("openai", "deepseek-r1", "https://api.deepseek.com");
    expect(mockCreateOpenAI).toHaveBeenCalledWith({
      baseURL: "https://api.deepseek.com",
    });
    expect(mockCustomOpenaiChat).toHaveBeenCalledWith("deepseek-r1");
  });

  it("creates a google model", () => {
    const model = createModel("google", "gemini-3.1-pro");
    // gemini-3.1-pro auto-resolves to gemini-3.1-pro-preview
    expect(mockGoogleFn).toHaveBeenCalledWith("gemini-3.1-pro-preview");
    expect(model).toBe(mockGoogleModel);
  });

  it("creates a gemini model (alias for google)", () => {
    const model = createModel("gemini", "gemini-3.1-flash-lite");
    // gemini-3.1-flash-lite auto-resolves to gemini-3.1-flash-lite-preview
    expect(mockGoogleFn).toHaveBeenCalledWith("gemini-3.1-flash-lite-preview");
    expect(model).toBe(mockGoogleModel);
  });

  it("creates an ollama model with default host", () => {
    const model = createModel("ollama", "qwen3-coder:30b");
    expect(mockCreateOllama).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "http://localhost:11434/api",
        keepAlive: "-1",
      }),
    );
    expect(mockOllamaProvider).toHaveBeenCalledWith("qwen3-coder:30b");
    expect(model).toBe(mockOllamaModel);
  });

  it("creates an ollama model with custom host", () => {
    createModel("ollama", "llama3:8b", "http://192.168.1.100:11434");
    expect(mockCreateOllama).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "http://192.168.1.100:11434/api",
      }),
    );
  });

  it("creates an OpenAI-compatible model for xai", () => {
    // xAI is now an OpenAI-compatible provider with known base URL
    const model = createModel("xai" as any, "grok-3");
    expect(mockCreateOpenAI).toHaveBeenCalledWith({ baseURL: "https://api.x.ai/v1" });
  });

  it("throws for truly unsupported provider", () => {
    expect(() =>
      createModel("nonexistent" as any, "model"),
    ).toThrow("Unsupported provider: nonexistent");
  });
});

// ─── buildOllamaOptions ─────────────────────────────────────────────────────

describe("buildOllamaOptions", () => {
  it("returns num_ctx options for ollama provider", () => {
    const opts = buildOllamaOptions("ollama", 32768);
    expect(opts).toEqual({
      providerOptions: {
        ollama: {
          options: {
            num_ctx: 32768,
          },
        },
      },
    });
  });

  it("returns empty object for non-ollama provider", () => {
    expect(buildOllamaOptions("anthropic", 32768)).toEqual({});
    expect(buildOllamaOptions("openai", 32768)).toEqual({});
    expect(buildOllamaOptions("google")).toEqual({});
  });

  it("returns empty object for ollama without contextLength", () => {
    expect(buildOllamaOptions("ollama")).toEqual({});
    expect(buildOllamaOptions("ollama", 0)).toEqual({});
  });
});

// ─── ensureOllamaContext ────────────────────────────────────────────────────

describe("ensureOllamaContext", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when model is not loaded", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    } as Response);

    await ensureOllamaContext("http://localhost:11434", "qwen3-coder:30b", 32768);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/ps",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does nothing when loaded context matches exactly", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [{ name: "qwen3-coder:30b", context_length: 32768 }],
      }),
    } as Response);

    await ensureOllamaContext("http://localhost:11434", "qwen3-coder:30b", 32768);

    // Only the /api/ps call, no unload — context already matches
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("unloads model when loaded context is too large", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: "qwen3-coder:30b", context_length: 262144 }],
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    await ensureOllamaContext("http://localhost:11434", "qwen3-coder:30b", 65536);

    // /api/ps + /api/generate (unload) — context was too large
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("unloads model when loaded context is too small", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: "qwen3-coder:30b", context_length: 4096 }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
      } as Response);

    await ensureOllamaContext("http://localhost:11434", "qwen3-coder:30b", 32768);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://localhost:11434/api/generate", {
      method: "POST",
      body: JSON.stringify({ model: "qwen3-coder:30b", keep_alive: 0 }),
    });
  });

  it("handles fetch failure gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Connection refused"));

    // Should not throw
    await expect(
      ensureOllamaContext("http://localhost:11434", "qwen3-coder:30b", 32768),
    ).resolves.toBeUndefined();
  });

  it("handles non-ok response gracefully", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
    } as Response);

    await ensureOllamaContext("http://localhost:11434", "qwen3-coder:30b", 32768);

    // Should return early after the non-ok /api/ps response, no further calls
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
