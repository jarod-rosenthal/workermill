import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runModelsCommand } from "../models-command.js";

// ---- Mocks (must be declared before imports) ----

vi.mock("../provider-registry.js", () => ({
  listProviders: vi.fn(),
  fetchLiveModels: vi.fn(),
}));

vi.mock("../config.js", () => ({
  resolveConfig: vi.fn(),
}));

import * as providerRegistry from "../provider-registry.js";
import { resolveConfig } from "../config.js";

const mockListProviders = vi.mocked(providerRegistry.listProviders);
const mockFetchLiveModels = vi.mocked(providerRegistry.fetchLiveModels);
const mockResolveConfig = vi.mocked(resolveConfig);

let mockConsoleLog: any;

describe("models-command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConsoleLog = vi.spyOn(console, 'log');

    // Mock config resolution
    mockResolveConfig.mockReturnValue({
      providers: {},
      default: "anthropic",
    });

    // Mock static providers
    mockListProviders.mockReturnValue([
      {
        id: "anthropic",
        name: "Anthropic (Claude)",
        pricingEngine: {
          getModels: () => [
            { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
            { id: "claude-opus-4-6", displayName: "Claude Opus 4.6" },
          ],
        },
      } as any,
      {
        id: "openai",
        name: "OpenAI",
        pricingEngine: {
          getModels: () => [
            { id: "gpt-5.4", displayName: "GPT-5.4" },
          ],
        },
      } as any,
    ]);

    // Mock live models
    mockFetchLiveModels.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockConsoleLog.mockRestore();
  });

  describe("runModelsCommand", () => {
    it("lists all models with no filter", async () => {
      await runModelsCommand();
      expect(mockConsoleLog).toHaveBeenCalledWith("anthropic:");
      expect(mockConsoleLog).toHaveBeenCalledWith("  claude-sonnet-4-6");
      expect(mockConsoleLog).toHaveBeenCalledWith("  claude-opus-4-6");
      expect(mockConsoleLog).toHaveBeenCalledWith("openai:");
      expect(mockConsoleLog).toHaveBeenCalledWith("  gpt-5.4");
      expect(mockConsoleLog).toHaveBeenCalledWith();
    });

    it("filters by substring", async () => {
      await runModelsCommand("sonnet");
      expect(mockConsoleLog).toHaveBeenCalledWith("anthropic:");
      expect(mockConsoleLog).toHaveBeenCalledWith("  claude-sonnet-4-6");
      expect(mockConsoleLog).not.toHaveBeenCalledWith("claude-opus-4-6");
      expect(mockConsoleLog).not.toHaveBeenCalledWith("gpt-5.4");
    });

    it("filters by provider", async () => {
      await runModelsCommand(undefined, { provider: "anthropic" });
      expect(mockConsoleLog).toHaveBeenCalledWith("anthropic:");
      expect(mockConsoleLog).toHaveBeenCalledWith("  claude-sonnet-4-6");
      expect(mockConsoleLog).toHaveBeenCalledWith("  claude-opus-4-6");
      expect(mockConsoleLog).not.toHaveBeenCalledWith("openai:");
    });

    it("shows live models", async () => {
      mockFetchLiveModels.mockResolvedValue([
        { provider: "ollama", id: "llama3.1:8b", host: "http://localhost:11434", reachable: true },
      ]);
      await runModelsCommand();
      expect(mockConsoleLog).toHaveBeenCalledWith("ollama (http://localhost:11434):");
      expect(mockConsoleLog).toHaveBeenCalledWith("  llama3.1:8b (local)");
    });

    it("shows unreachable live providers", async () => {
      mockFetchLiveModels.mockResolvedValue([
        { provider: "ollama", id: "", host: "http://localhost:11434", reachable: false },
      ]);
      await runModelsCommand();
      expect(mockConsoleLog).toHaveBeenCalledWith("ollama (http://localhost:11434):");
      expect(mockConsoleLog).toHaveBeenCalledWith("  (not reachable)");
    });

    it("outputs JSON", async () => {
      await runModelsCommand(undefined, { json: true });
      const jsonCall = mockConsoleLog.mock.calls.find(call => call[0].startsWith("["));
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(jsonCall![0]);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toContainEqual({
        provider: "anthropic",
        id: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        source: "cloud",
      });
    });

    it("filters to available models only", async () => {
      mockFetchLiveModels.mockResolvedValue([
        { provider: "ollama", id: "llama3.1:8b", host: "http://localhost:11434", reachable: true },
        { provider: "lmstudio", id: "", host: "http://localhost:1234", reachable: false },
      ]);
      await runModelsCommand(undefined, { available: true });
      expect(mockConsoleLog).toHaveBeenCalledWith("ollama (http://localhost:11434):");
      expect(mockConsoleLog).toHaveBeenCalledWith("  llama3.1:8b (local)");
      expect(mockConsoleLog).not.toHaveBeenCalledWith("lmstudio (http://localhost:1234):");
    });

    it("handles refresh filter", async () => {
      await runModelsCommand("refresh");
      // Should behave the same as no filter
      expect(mockConsoleLog).toHaveBeenCalledWith("anthropic:");
    });

    it("shows no models message when filtered to nothing", async () => {
      await runModelsCommand("nonexistent");
      expect(mockConsoleLog).toHaveBeenCalledWith("No models found matching the criteria.");
    });
  });
});