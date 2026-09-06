import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTempWorkerMillHome, type TempHome } from "./helpers/temp-workermill-home.js";

// Mock logger to avoid file writes
vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

describe("session", () => {
  let tmp: TempHome;

  beforeEach(() => {
    tmp = createTempWorkerMillHome();
    vi.resetModules();
  });

  afterEach(() => {
    tmp.restore();
    tmp.cleanup();
  });

  async function importSession() {
    return await import("../session.js");
  }

  describe("createSession()", () => {
    it("returns session with ID, provider, model", async () => {
      const { createSession } = await importSession();
      const session = createSession("ollama", "test-model");

      expect(session.id).toBeTruthy();
      expect(session.id.length).toBeGreaterThan(10); // UUID
      expect(session.provider).toBe("ollama");
      expect(session.model).toBe("test-model");
      expect(session.messages).toEqual([]);
      expect(session.totalTokens).toBe(0);
      expect(session.startedAt).toBeTruthy();
    });
  });

  describe("applySessionUsageLedger()", () => {
    it("adds each call once and preserves historical totals without inventing a split", async () => {
      const { createSession, applySessionUsageLedger } = await importSession();
      const session = createSession("test", "old-model");
      session.totalTokens = 100;
      session.totalCostUsd = 1;
      const call = { callId: "planner-1", persona: "Planner", provider: "test", model: "new-model", usage: { inputTokens: 2, outputTokens: 3 }, usageState: "reported" as const, pricingState: "known" as const, estimatedApiCost: 0.2 };
      const ledger = { calls: [call, call], totals: { callCount: 2, reportedUsageCalls: 2, partialUsageCalls: 0, missingUsageCalls: 0, knownPricingCalls: 2, unknownPricingCalls: 0, localApiCalls: 0, inputTokens: 4, outputTokens: 6, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedApiCost: 0.4 } };

      expect(applySessionUsageLedger(session, ledger)).toBe(true);
      expect(applySessionUsageLedger(session, ledger)).toBe(false);
      expect(session).toMatchObject({ totalTokens: 105, totalCostUsd: 1.2, usageLedgerHistoryIncomplete: true });
      expect(session.usageLedger?.totals.callCount).toBe(1);
      expect(session.costByModel).toMatchObject([{ model: "new-model", inputTokens: 2, outputTokens: 3, roles: ["planner"] }]);
      expect(session.costByRole?.planner).toMatchObject({ inputTokens: 2, outputTokens: 3, costUsd: 0.2 });
    });

    it("classifies tech leads and critics as reviewers", async () => {
      const { createSession, applySessionUsageLedger } = await importSession();
      const session = createSession("test", "model");
      const calls = ["tech_lead", "critic"].map((persona, index) => ({ callId: persona, persona, provider: "test", model: "model", usage: { inputTokens: 1, outputTokens: 1 }, usageState: "reported" as const, pricingState: "known" as const, estimatedApiCost: 0 }));
      applySessionUsageLedger(session, { calls, totals: { callCount: 2, reportedUsageCalls: 2, partialUsageCalls: 0, missingUsageCalls: 0, knownPricingCalls: 2, unknownPricingCalls: 0, localApiCalls: 0, inputTokens: 2, outputTokens: 2, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedApiCost: 0 } });
      expect(session.costByRole?.reviewer).toMatchObject({ inputTokens: 2, outputTokens: 2 });
    });
  });

  describe("save + load", () => {
    it("saves and loads session by ID", async () => {
      const { createSession, saveSession, loadSessionById, addMessage } = await importSession();
      const session = createSession("anthropic", "claude-sonnet-4-6");
      addMessage(session, "user", "Hello");
      addMessage(session, "assistant", "Hi there!");
      session.totalTokens = 150;

      saveSession(session);

      const loaded = loadSessionById(session.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(session.id);
      expect(loaded!.provider).toBe("anthropic");
      expect(loaded!.model).toBe("claude-sonnet-4-6");
      expect(loaded!.messages).toHaveLength(2);
      expect(loaded!.messages[0].role).toBe("user");
      expect(loaded!.messages[0].content).toBe("Hello");
      expect(loaded!.totalTokens).toBe(150);
    });
  });

  describe("loadLatestSession()", () => {
    it("returns null when no sessions", async () => {
      const { loadLatestSession } = await importSession();
      expect(loadLatestSession()).toBeNull();
    });

    it("returns the most recently saved session", async () => {
      const { createSession, saveSession, loadLatestSession, addMessage } = await importSession();

      const s1 = createSession("ollama", "model-a");
      saveSession(s1);

      // Small delay so mtime differs
      await new Promise((r) => setTimeout(r, 50));

      const s2 = createSession("ollama", "model-b");
      addMessage(s2, "user", "Second session");
      saveSession(s2);

      const latest = loadLatestSession();
      expect(latest).not.toBeNull();
      expect(latest!.id).toBe(s2.id);
    });
  });

  describe("listSessions()", () => {
    it("returns empty array when no sessions", async () => {
      const { listSessions } = await importSession();
      expect(listSessions()).toEqual([]);
    });

    it("returns session summaries", async () => {
      const { createSession, saveSession, listSessions, addMessage } = await importSession();

      const s1 = createSession("ollama", "test-model");
      addMessage(s1, "user", "First question here");
      s1.totalTokens = 100;
      saveSession(s1);

      const s2 = createSession("anthropic", "claude-sonnet-4-6");
      addMessage(s2, "user", "Second question here");
      saveSession(s2);

      const list = listSessions();
      expect(list).toHaveLength(2);

      for (const summary of list) {
        expect(summary.id).toBeTruthy();
        expect(summary.startedAt).toBeTruthy();
        expect(typeof summary.messageCount).toBe("number");
        expect(typeof summary.totalTokens).toBe("number");
        expect(typeof summary.preview).toBe("string");
      }
    });

    it("includes preview from first user message", async () => {
      const { createSession, saveSession, listSessions, addMessage } = await importSession();

      const session = createSession("ollama", "test");
      addMessage(session, "user", "Fix the login bug on the dashboard");
      saveSession(session);

      const list = listSessions();
      expect(list[0].preview).toContain("Fix the login bug");
    });

    it("keeps the default recent-session cap while allowing explicit list-all", async () => {
      const { createSession, saveSession, listSessions } = await importSession();

      for (let i = 0; i < 25; i++) {
        const session = createSession("ollama", `test-${i}`);
        session.name = `Session ${i}`;
        saveSession(session);
      }

      expect(listSessions()).toHaveLength(20);
      expect(listSessions(-1)).toHaveLength(25);
    });
  });

  describe("deleteSession()", () => {
    it("deletes a session and returns true", async () => {
      const { createSession, saveSession, deleteSession, loadSessionById } = await importSession();
      const session = createSession("ollama", "test");
      saveSession(session);

      expect(deleteSession(session.id)).toBe(true);
      expect(loadSessionById(session.id)).toBeNull();
    });

    it("returns false for nonexistent session", async () => {
      const { deleteSession } = await importSession();
      expect(deleteSession("nonexistent-id")).toBe(false);
    });
  });

  describe("loadSessionById()", () => {
    it("returns null for missing session", async () => {
      const { loadSessionById } = await importSession();
      expect(loadSessionById("does-not-exist")).toBeNull();
    });
  });

  describe("addMessage()", () => {
    it("appends messages with timestamps", async () => {
      const { createSession, addMessage } = await importSession();
      const session = createSession("ollama", "test");
      addMessage(session, "user", "hello");
      addMessage(session, "assistant", "world");

      expect(session.messages).toHaveLength(2);
      expect(session.messages[0].role).toBe("user");
      expect(session.messages[0].content).toBe("hello");
      expect(session.messages[0].timestamp).toBeTruthy();
      expect(session.messages[1].role).toBe("assistant");
    });
  });

  describe("forkSession()", () => {
    it("creates a new session with a different ID", async () => {
      const { createSession, addMessage, forkSession } = await importSession();
      const original = createSession("ollama", "test-model");
      addMessage(original, "user", "hello");
      addMessage(original, "assistant", "hi");
      original.name = "my session";
      original.totalTokens = 500;

      const forked = forkSession(original);

      expect(forked.id).not.toBe(original.id);
      expect(forked.id.length).toBeGreaterThan(10);
    });

    it("copies messages without sharing references", async () => {
      const { createSession, addMessage, forkSession } = await importSession();
      const original = createSession("ollama", "test-model");
      addMessage(original, "user", "hello");
      addMessage(original, "assistant", "hi");

      const forked = forkSession(original);

      expect(forked.messages).toHaveLength(2);
      expect(forked.messages[0].content).toBe("hello");

      // Mutating fork should not affect original
      forked.messages.push({ role: "user", content: "new", timestamp: new Date().toISOString() });
      expect(original.messages).toHaveLength(2);
      expect(forked.messages).toHaveLength(3);
    });

    it("appends (fork) to the name", async () => {
      const { createSession, forkSession } = await importSession();
      const original = createSession("ollama", "test-model");
      original.name = "debug session";

      const forked = forkSession(original);
      expect(forked.name).toBe("debug session (fork)");
    });

    it("preserves provider and model", async () => {
      const { createSession, forkSession } = await importSession();
      const original = createSession("anthropic", "claude-sonnet-4-6");

      const forked = forkSession(original);
      expect(forked.provider).toBe("anthropic");
      expect(forked.model).toBe("claude-sonnet-4-6");
    });

    it("gets a fresh startedAt timestamp", async () => {
      const { createSession, forkSession } = await importSession();
      const original = createSession("ollama", "test-model");
      original.startedAt = "2026-01-01T00:00:00.000Z";

      const forked = forkSession(original);
      expect(forked.startedAt).not.toBe(original.startedAt);
    });
  });
});
