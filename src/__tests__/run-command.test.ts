import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommand, RunCommandOptions, RunResult } from "../run-command.js";

// Mock the AI library
vi.mock("ai", () => {
  const mockStreamText = vi.fn();
  mockStreamText.mockReturnValue({
    textStream: {
      [Symbol.asyncIterator]: async function* () {
        yield "response";
      }
    },
    text: Promise.resolve("full response"),
    totalUsage: Promise.resolve({ inputTokens: 10, outputTokens: 20 }),
  });
  return {
    streamText: mockStreamText,
    stepCountIs: vi.fn(() => ({})), // mock function
  };
});

// Mock session module
vi.mock("../session.js", () => ({
  loadSessionById: vi.fn(),
  loadLatestSession: vi.fn(),
  createSession: vi.fn(() => ({
    id: "new-session-id",
    messages: [],
    provider: "ollama",
    model: "test-model",
    startedAt: new Date().toISOString(),
    totalTokens: 0,
  })),
  addMessage: vi.fn(),
  saveSession: vi.fn(),
}));

// Mock model factory
vi.mock("../engine/model-factory.js", () => ({
  createModel: vi.fn(() => ({})),
  buildOllamaOptions: vi.fn(() => ({})),
}));

// Mock tools
vi.mock("../engine/tools/index.js", () => ({
  createToolDefinitions: vi.fn(() => ({})),
}));

// Mock MCP
vi.mock("../mcp-client.js", () => ({
  startAllMCPServers: vi.fn(),
  getMCPToolDefinitions: vi.fn(() => ({})),
  stopAllMCPServers: vi.fn(),
  autoDetectMCPServers: vi.fn(() => ({})),
}));

// Mock instructions and learnings
vi.mock("../instructions.js", () => ({
  formatProjectInstructions: vi.fn(() => ""),
}));

vi.mock("../learnings.js", () => ({
  loadLearnings: vi.fn(() => []),
}));

// Mock sandbox
vi.mock("../sandbox-mode.js", () => ({
  resolveSandboxMode: vi.fn(() => ({ effective: true, warning: null })),
}));

// Mock LSP
vi.mock("../engine/tools/lsp.js", () => ({
  shutdown: vi.fn(),
}));

import { streamText, stepCountIs } from "ai";
import { createModel } from "../engine/model-factory.js";
import { createToolDefinitions } from "../engine/tools/index.js";
import { startAllMCPServers, getMCPToolDefinitions, stopAllMCPServers, autoDetectMCPServers } from "../mcp-client.js";
import { loadSessionById, loadLatestSession, createSession, addMessage, saveSession } from "../session.js";
import { resolveSandboxMode } from "../sandbox-mode.js";
import { shutdown as shutdownLSP } from "../engine/tools/lsp.js";

describe("runCommand", () => {
  const defaultOptions: RunCommandOptions = {
    prompt: "test prompt",
    config: {
      providers: {
        ollama: { model: "test-model", host: "http://localhost:11434" },
      },
      default: "ollama",
    },
    provider: "ollama",
    modelName: "test-model",
    host: "http://localhost:11434",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    vi.mocked(stepCountIs).mockReturnValue({} as any);
    vi.mocked(createModel).mockReturnValue({} as any);
    vi.mocked(createToolDefinitions).mockReturnValue({});
    vi.mocked(autoDetectMCPServers).mockReturnValue({});
    vi.mocked(getMCPToolDefinitions).mockReturnValue({});
    vi.mocked(resolveSandboxMode).mockReturnValue({ effective: true, warning: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("success path", () => {
    it("returns ok status with valid JSON structure", async () => {
      const result = await runCommand(defaultOptions);

      expect(result.status).toBe("ok");
      expect(result.sessionId).toBe("new-session-id");
      expect(result.model).toBe("ollama/test-model");
      expect(result.text).toBe("full response");
      expect(result.toolCalls).toBe(0);
      expect(result.tokens).toEqual({ input: 10, output: 20 });
      expect(result.costUsd).toBe(0);
      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("handles tool calls correctly", async () => {
      // Mock onStepFinish to increment tool calls
      vi.mocked(streamText).mockImplementation((options) => {
        if (options.onStepFinish) {
          options.onStepFinish({ toolCalls: [{ id: "1" }, { id: "2" }], usage: { inputTokens: 5, outputTokens: 15 } });
        }
        return {
          textStream: {
            [Symbol.asyncIterator]: async function* () {
              // no chunks
            }
          },
          text: Promise.resolve("(completed with tool calls only)"),
          totalUsage: Promise.resolve({ inputTokens: 5, outputTokens: 15 }),
        } as any;
      });

      const result = await runCommand(defaultOptions);

      expect(result.toolCalls).toBe(2);
      expect(result.text).toBe("(completed with tool calls only)");
    });
  });

  describe("session handling", () => {
    it("continues specific session", async () => {
      const mockSession = {
        id: "existing-session-id",
        messages: [{ role: "user", content: "previous", timestamp: new Date().toISOString() }],
        provider: "ollama",
        model: "test-model",
        startedAt: new Date().toISOString(),
        totalTokens: 0,
      };
      vi.mocked(loadSessionById).mockReturnValue(mockSession as any);

      const result = await runCommand({ ...defaultOptions, session: "existing-session-id" });

      expect(loadSessionById).toHaveBeenCalledWith("existing-session-id");
      expect(result.sessionId).toBe("existing-session-id");
      expect(addMessage).toHaveBeenCalledWith(mockSession, "user", "test prompt");
    });

    it("continues most recent session", async () => {
      const mockSession = {
        id: "latest-session-id",
        messages: [],
        provider: "ollama",
        model: "test-model",
        startedAt: new Date().toISOString(),
        totalTokens: 0,
      };
      vi.mocked(loadLatestSession).mockReturnValue(mockSession as any);

      const result = await runCommand({ ...defaultOptions, continue: true });

      expect(loadLatestSession).toHaveBeenCalled();
      expect(result.sessionId).toBe("latest-session-id");
    });

    it("throws error for non-existent session", async () => {
      vi.mocked(loadSessionById).mockReturnValue(null);

      await expect(runCommand({ ...defaultOptions, session: "nonexistent" })).rejects.toThrow("Session nonexistent not found");
    });

    it("throws error when no recent session to continue", async () => {
      vi.mocked(loadLatestSession).mockReturnValue(null);

      await expect(runCommand({ ...defaultOptions, continue: true })).rejects.toThrow("No recent session to continue");
    });
  });

  describe("cancellation handling", () => {
    it("returns cancelled status when SIGINT received", async () => {
      // Mock streamText to trigger SIGINT and abort
      vi.mocked(streamText).mockImplementation((options) => {
        process.emit("SIGINT"); // trigger cancellation
        return {
          textStream: {
            [Symbol.asyncIterator]: async function* () {
              // no chunks
            }
          },
          text: Promise.reject(new Error("aborted")),
          totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
        } as any;
      });

      const result = await runCommand(defaultOptions);

      expect(result.status).toBe("cancelled");
      expect(result.sessionId).toBe("new-session-id");
    });
  });

  describe("error handling", () => {
    it("returns error status when stream fails", async () => {
      vi.mocked(streamText).mockImplementation(() => {
        throw new Error("AI error");
      });

      const result = await runCommand(defaultOptions);

      expect(result.status).toBe("error");
      expect(result.text).toBe("");
    });
  });

  describe("MCP integration", () => {
    it("starts and stops MCP servers when detected", async () => {
      vi.mocked(autoDetectMCPServers).mockReturnValue({ testServer: {} });
      vi.mocked(getMCPToolDefinitions).mockReturnValue({ "mcp__test__tool": {} });

      await runCommand(defaultOptions);

      expect(startAllMCPServers).toHaveBeenCalledWith({ testServer: {} });
      expect(stopAllMCPServers).toHaveBeenCalled();
    });
  });

  describe("sandbox mode", () => {
    it("resolves sandbox mode correctly", async () => {
      vi.mocked(resolveSandboxMode).mockReturnValue({ effective: false, warning: "warning message" });

      await runCommand(defaultOptions);

      expect(resolveSandboxMode).toHaveBeenCalledWith(defaultOptions.config.sandbox, !!defaultOptions.fullDisk);
    });
  });
});