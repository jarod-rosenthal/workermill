import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runModelsCommand } from "../models-command.js";
import { fetchLiveModels } from "../provider-registry.js";

// Mock console.log
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

// Mock loadConfig
vi.mock("../config.js", async () => {
  return {
    loadConfig: vi.fn(() => ({
      providers: {
        ollama: { host: "http://localhost:11434" },
        lmstudio: { host: "http://localhost:1234" },
      },
    })),
  };
});

// Mock listProviders
vi.mock("../provider-registry.js", async () => {
  const actual = await vi.importActual("../provider-registry.js");
  return {
    ...actual,
    listProviders: vi.fn(() => [
      {
        id: "anthropic",
        pricingEngine: {
          getModels: () => [
            { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
            { id: "claude-opus-4-6", displayName: "Claude Opus 4.6" },
          ],
        },
      },
      {
        id: "openai",
        pricingEngine: {
          getModels: () => [
            { id: "gpt-5.4", displayName: "GPT-5.4" },
          ],
        },
      },
    ]),
    fetchLiveModels: vi.fn(),
  };
});

describe("models-command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchLiveModels).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("fetchLiveModels", () => {
    it("returns unreachable for providers when fetch fails", async () => {
      const { fetchLiveModels } = await vi.importActual("../provider-registry.js");
      const config = { providers: { ollama: { host: "http://localhost:11434" } } };
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));
      const result = await fetchLiveModels(config);
      expect(result).toEqual([{
        provider: "ollama",
        id: "(not reachable)",
        displayName: "(not reachable)",
        host: "http://localhost:11434",
        source: "live"
      }]);
    });

    it("fetches from Ollama when configured", async () => {
      const { fetchLiveModels } = await vi.importActual("../provider-registry.js");
      const config = { providers: { ollama: { host: "http://localhost:11434" } } };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [{ name: "qwen3-coder:latest" }] }),
      });
      const result = await fetchLiveModels(config);
      expect(result).toEqual([{
        provider: "ollama",
        id: "qwen3-coder:latest",
        displayName: "qwen3-coder:latest",
        host: "http://localhost:11434",
        source: "live"
      }]);
      expect(globalThis.fetch).toHaveBeenCalledWith("http://localhost:11434/api/tags", expect.any(Object));
    });

    it("fetches from LM Studio when configured", async () => {
      const { fetchLiveModels } = await vi.importActual("../provider-registry.js");
      const config = { providers: { lmstudio: { host: "http://localhost:1234" } } };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: "deepseek-r1" }] }),
      });
      const result = await fetchLiveModels(config);
      expect(result).toEqual([{
        provider: "lmstudio",
        id: "deepseek-r1",
        displayName: "deepseek-r1",
        host: "http://localhost:1234",
        source: "live"
      }]);
      expect(globalThis.fetch).toHaveBeenCalledWith("http://localhost:1234/v1/models", expect.any(Object));
    });

    it("handles timeout gracefully with unreachable", async () => {
      const { fetchLiveModels } = await vi.importActual("../provider-registry.js");
      const config = { providers: { ollama: { host: "http://localhost:11434" } } };
      globalThis.fetch = vi.fn().mockImplementation((url, options) => {
        return new Promise((resolve, reject) => {
          if (options?.signal) {
            options.signal.addEventListener('abort', () => reject(new Error('Aborted')));
          }
        });
      });
      const result = await fetchLiveModels(config);
      expect(result).toEqual([{
        provider: "ollama",
        id: "(not reachable)",
        displayName: "(not reachable)",
        host: "http://localhost:11434",
        source: "live"
      }]);
    });
  });

  describe("runModelsCommand", () => {
    it("prints models grouped by provider", async () => {
      vi.mocked(fetchLiveModels).mockResolvedValue([
        { provider: "ollama", id: "qwen3-coder:latest", displayName: "qwen3-coder:latest", host: "http://localhost:11434", source: "live" },
      ]);
      await runModelsCommand();
      expect(mockConsoleLog).toHaveBeenCalledWith("anthropic");
      expect(mockConsoleLog).toHaveBeenCalledWith("    claude-sonnet-4-6          Claude Sonnet 4.6");
      expect(mockConsoleLog).toHaveBeenCalledWith("ollama  (http://localhost:11434)");
      expect(mockConsoleLog).toHaveBeenCalledWith("    qwen3-coder:latest        local");
    });

    it("filters by substring", async () => {
      await runModelsCommand("sonnet");
      expect(mockConsoleLog).toHaveBeenCalledWith("    claude-sonnet-4-6          Claude Sonnet 4.6");
      expect(mockConsoleLog).not.toHaveBeenCalledWith("    claude-opus-4-6          Claude Opus 4.6");
    });

    it("filters by provider", async () => {
      await runModelsCommand(undefined, { provider: "openai" });
      expect(mockConsoleLog).toHaveBeenCalledWith("openai");
      expect(mockConsoleLog).toHaveBeenCalledWith("    gpt-5.4                    GPT-5.4");
      expect(mockConsoleLog).not.toHaveBeenCalledWith("anthropic");
    });

    it("outputs JSON when --json is true", async () => {
      await runModelsCommand(undefined, { json: true });
      const call = mockConsoleLog.mock.calls.find(c => c[0].includes('"provider": "anthropic"'));
      expect(call).toBeDefined();
      const parsed = JSON.parse(call![0]);
      expect(parsed).toContainEqual({
        provider: "anthropic",
        id: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        source: "static"
      });
    });

    it("handles refresh argument", async () => {
      vi.mocked(fetchLiveModels).mockResolvedValue([
        { provider: "ollama", id: "refreshed-model", displayName: "refreshed-model", host: "http://localhost:11434", source: "live" },
      ]);
      await runModelsCommand("refresh");
      expect(mockConsoleLog).toHaveBeenCalledWith("    refreshed-model           local");
      expect(vi.mocked(fetchLiveModels)).toHaveBeenCalled();
    });

    it("shows host for live providers", async () => {
      vi.mocked(fetchLiveModels).mockResolvedValue([
        { provider: "ollama", id: "model", displayName: "model", host: "http://custom:11434", source: "live" },
      ]);
      await runModelsCommand();
      expect(mockConsoleLog).toHaveBeenCalledWith("ollama  (http://custom:11434)");
    });

    it("shows (not reachable) for unreachable providers", async () => {
      vi.mocked(fetchLiveModels).mockResolvedValue([
        { provider: "ollama", id: "(not reachable)", displayName: "(not reachable)", host: "http://localhost:11434", source: "live" },
      ]);
      await runModelsCommand();
      expect(mockConsoleLog).toHaveBeenCalledWith("ollama  (http://localhost:11434)");
      expect(mockConsoleLog).toHaveBeenCalledWith("    (not reachable)");
    });
  });
});