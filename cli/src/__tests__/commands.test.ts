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

// Mock the pricing engine for CostTracker
vi.mock("../../../api/src/providers/index.js", () => ({
  getPricingEngine: vi.fn(() => ({
    calculateTokenCost: vi.fn(() => 0),
  })),
  hasProvider: vi.fn(() => true),
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
  });
});
