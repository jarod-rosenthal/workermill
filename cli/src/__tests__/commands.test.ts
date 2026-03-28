import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

// Mock session module
vi.mock("../session.js", () => ({
  saveSession: vi.fn(),
  listSessions: vi.fn(() => []),
  loadSessionById: vi.fn(() => null),
  deleteSession: vi.fn(() => false),
}));

import { handleCommand, type CommandContext } from "../commands.js";
import { CostTracker } from "../cost-tracker.js";
import { execSync } from "child_process";
import { compactMessages } from "../compaction.js";
import { listSessions, loadSessionById, deleteSession } from "../session.js";

// Mock the pricing engine for CostTracker
vi.mock("../../../api/src/providers/index.js", () => ({
  getPricingEngine: vi.fn(() => ({
    calculateTokenCost: vi.fn(() => 0),
  })),
  hasProvider: vi.fn(() => true),
}));

// Mock compaction module
vi.mock("../compaction.js", () => ({
  compactMessages: vi.fn(async () => [
    { role: "user", content: "[Summarize the conversation so far]" },
    { role: "assistant", content: "[Conversation summary]\nSummary text." },
  ]),
}));

// Mock model factory
vi.mock("../../../packages/engine/src/model-factory.js", () => ({
  createModel: vi.fn(() => ({})),
}));

// Mock child_process for /git command
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

function createTestContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    config: {
      providers: {
        ollama: { model: "test-model", host: "http://localhost:11434" },
      },
      default: "ollama",
    },
    session: {
      id: "test-session-id",
      messages: [],
      provider: "ollama",
      model: "test-model",
      startedAt: new Date().toISOString(),
      totalTokens: 0,
    },
    costTracker: new CostTracker(),
    workingDir: "/tmp/test-dir",
    planMode: false,
    setPlanMode: vi.fn(),
    processInput: vi.fn(),
    ...overrides,
  };
}

describe("commands", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    // Suppress console.log for cleaner test output
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  describe("handleCommand('plan')", () => {
    it("toggles plan mode on", async () => {
      const setPlanMode = vi.fn();
      const ctx = createTestContext({ planMode: false, setPlanMode });

      await handleCommand("/plan", ctx);
      expect(setPlanMode).toHaveBeenCalledWith(true);
    });

    it("toggles plan mode off when already on", async () => {
      const setPlanMode = vi.fn();
      const ctx = createTestContext({ planMode: true, setPlanMode });

      await handleCommand("/plan", ctx);
      expect(setPlanMode).toHaveBeenCalledWith(false);
    });

    it("/plan off turns off explicitly", async () => {
      const setPlanMode = vi.fn();
      const ctx = createTestContext({ planMode: true, setPlanMode });

      await handleCommand("/plan off", ctx);
      expect(setPlanMode).toHaveBeenCalledWith(false);
    });
  });

  describe("handleCommand('cost')", () => {
    it("does not throw", async () => {
      const ctx = createTestContext();
      await expect(handleCommand("/cost", ctx)).resolves.toBeUndefined();
    });
  });

  describe("handleCommand('status')", () => {
    it("does not throw", async () => {
      const ctx = createTestContext();
      await expect(handleCommand("/status", ctx)).resolves.toBeUndefined();
    });
  });

  describe("handleCommand('help')", () => {
    it("does not throw", async () => {
      const ctx = createTestContext();
      await expect(handleCommand("/help", ctx)).resolves.toBeUndefined();
    });
  });

  describe("handleCommand('clear')", () => {
    it("clears session messages", async () => {
      const ctx = createTestContext();
      ctx.session.messages = [
        { role: "user", content: "hello", timestamp: new Date().toISOString() },
      ];

      await handleCommand("/clear", ctx);
      expect(ctx.session.messages).toEqual([]);
    });
  });

  describe("unknown command", () => {
    it("does not throw", async () => {
      const ctx = createTestContext();
      await expect(handleCommand("/nonexistent", ctx)).resolves.toBeUndefined();
    });
  });

  describe("handleCommand('model')", () => {
    it("does not throw", async () => {
      const ctx = createTestContext();
      await expect(handleCommand("/model", ctx)).resolves.toBeUndefined();
    });
  });

  describe("handleCommand('sessions')", () => {
    it("does not throw when listing", async () => {
      const ctx = createTestContext();
      await expect(handleCommand("/sessions", ctx)).resolves.toBeUndefined();
    });

    it("lists sessions with entries", async () => {
      vi.mocked(listSessions).mockReturnValue([
        { id: "abc12345-1234", name: "test session", preview: "hello", messageCount: 5, startedAt: new Date().toISOString() },
        { id: "def67890-5678", name: "", preview: "another", messageCount: 3, startedAt: new Date().toISOString() },
      ]);
      const ctx = createTestContext();
      await handleCommand("/sessions", ctx);
      const logCalls = (console.log as any).mock.calls.flat().join(" ");
      expect(logCalls).toContain("Recent Sessions");
    });

    it("switches session by id", async () => {
      vi.mocked(loadSessionById).mockReturnValue({
        id: "new-session-id",
        messages: [{ role: "user", content: "hi", timestamp: new Date().toISOString() }],
        provider: "ollama",
        model: "test",
        startedAt: new Date().toISOString(),
        totalTokens: 0,
      } as any);
      const ctx = createTestContext();
      await handleCommand("/sessions new-session-id", ctx);
      expect(ctx.session.id).toBe("new-session-id");
    });

    it("switches session by index", async () => {
      vi.mocked(loadSessionById)
        .mockReturnValueOnce(null) // first call: direct ID lookup fails
        .mockReturnValueOnce({
          id: "idx-session",
          messages: [],
          provider: "ollama",
          model: "test",
          startedAt: new Date().toISOString(),
          totalTokens: 0,
        } as any);
      vi.mocked(listSessions).mockReturnValue([
        { id: "idx-session", name: "first", preview: "", messageCount: 0, startedAt: new Date().toISOString() },
      ]);
      const ctx = createTestContext();
      await handleCommand("/sessions 1", ctx);
      expect(ctx.session.id).toBe("idx-session");
    });

    it("shows error for session not found", async () => {
      vi.mocked(loadSessionById).mockReturnValue(null);
      vi.mocked(listSessions).mockReturnValue([]);
      const ctx = createTestContext();
      await handleCommand("/sessions nonexistent", ctx);
      const logCalls = (console.log as any).mock.calls.flat().join(" ");
      expect(logCalls).toContain("Session not found");
    });

    it("deletes a session", async () => {
      vi.mocked(deleteSession).mockReturnValue(true);
      const ctx = createTestContext();
      await handleCommand("/sessions delete abc123", ctx);
      expect(deleteSession).toHaveBeenCalledWith("abc123");
      const logCalls = (console.log as any).mock.calls.flat().join(" ");
      expect(logCalls).toContain("deleted");
    });

    it("shows error when deleting non-existent session", async () => {
      vi.mocked(deleteSession).mockReturnValue(false);
      const ctx = createTestContext();
      await handleCommand("/sessions delete nope", ctx);
      const logCalls = (console.log as any).mock.calls.flat().join(" ");
      expect(logCalls).toContain("Session not found");
    });
  });

  describe("handleCommand('compact')", () => {
    it("compacts messages when there are more than 4", async () => {
      const ctx = createTestContext();
      ctx.session.messages = [
        { role: "user", content: "a", timestamp: new Date().toISOString() },
        { role: "assistant", content: "b", timestamp: new Date().toISOString() },
        { role: "user", content: "c", timestamp: new Date().toISOString() },
        { role: "assistant", content: "d", timestamp: new Date().toISOString() },
        { role: "user", content: "e", timestamp: new Date().toISOString() },
        { role: "assistant", content: "f", timestamp: new Date().toISOString() },
      ];

      await handleCommand("/compact", ctx);
      expect(compactMessages).toHaveBeenCalled();
      // Session should be updated with compacted messages
      expect(ctx.session.messages.length).toBe(2);
    });

    it("does not compact when 4 or fewer messages", async () => {
      const ctx = createTestContext();
      ctx.session.messages = [
        { role: "user", content: "a", timestamp: new Date().toISOString() },
        { role: "assistant", content: "b", timestamp: new Date().toISOString() },
      ];

      await handleCommand("/compact", ctx);
      const logCalls = (console.log as any).mock.calls.flat().join(" ");
      expect(logCalls).toContain("Not enough messages");
      expect(compactMessages).not.toHaveBeenCalled();
    });
  });

  describe("handleCommand('git')", () => {
    it("shows branch and status", async () => {
      vi.mocked(execSync)
        .mockReturnValueOnce("M file1.ts\nA file2.ts\n") // git status --short
        .mockReturnValueOnce("main\n"); // git branch --show-current

      const ctx = createTestContext();
      await handleCommand("/git", ctx);

      const logCalls = (console.log as any).mock.calls.flat().join(" ");
      expect(logCalls).toContain("Branch:");
      expect(logCalls).toContain("main");
      expect(logCalls).toContain("Changes:");
    });

    it("shows clean working tree", async () => {
      vi.mocked(execSync)
        .mockReturnValueOnce("") // git status --short (empty = clean)
        .mockReturnValueOnce("feature-branch\n");

      const ctx = createTestContext();
      await handleCommand("/git", ctx);

      const logCalls = (console.log as any).mock.calls.flat().join(" ");
      expect(logCalls).toContain("Working tree clean");
    });

    it("shows error when not a git repo", async () => {
      vi.mocked(execSync).mockImplementation(() => { throw new Error("not a git repo"); });

      const ctx = createTestContext();
      await handleCommand("/git", ctx);

      const logCalls = (console.log as any).mock.calls.flat().join(" ");
      expect(logCalls).toContain("Not a git repository");
    });
  });

  describe("handleCommand('quit')", () => {
    it("calls process.exit(0)", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      const ctx = createTestContext();
      await handleCommand("/quit", ctx);
      expect(exitSpy).toHaveBeenCalledWith(0);
      exitSpy.mockRestore();
    });
  });

  describe("handleCommand('exit')", () => {
    it("calls process.exit(0)", async () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      const ctx = createTestContext();
      await handleCommand("/exit", ctx);
      expect(exitSpy).toHaveBeenCalledWith(0);
      exitSpy.mockRestore();
    });
  });
});
