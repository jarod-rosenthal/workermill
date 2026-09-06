import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the pricing engine before importing CostTracker
vi.mock("../providers/index.js", () => ({
  getPricingEngine: vi.fn(() => ({
    getModelInfo: vi.fn((model: string) => model === "unknown-model" ? undefined : ({
      inputRate: 0.001,
      outputRate: 0.002,
      cacheWriteRate: 0.003,
      cacheReadRate: 0.0005,
    })),
    calculateTokenCost: vi.fn(
      (usage: { inputTokens: number; outputTokens: number }) =>
        // Simple pricing: $0.001 per 1K input, $0.002 per 1K output
        (usage.inputTokens / 1000) * 0.001 + (usage.outputTokens / 1000) * 0.002,
    ),
  })),
  hasProvider: vi.fn((id: string) => ["ollama", "anthropic", "openai", "google"].includes(id)),
}));

// Mock logger to avoid file writes
vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

import { CostTracker } from "../cost-tracker.js";

describe("CostTracker", () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  it("starts with zero cost and tokens", () => {
    expect(tracker.getTotalCost()).toBe(0);
    expect(tracker.getTotalTokens()).toBe(0);
    expect(tracker.getBreakdown()).toEqual([]);
  });

  it("accumulates usage from addUsage()", () => {
    tracker.addUsage("frontend_developer", "anthropic", "claude-sonnet-4-6", 1000, 500);
    tracker.addUsage("backend_developer", "anthropic", "claude-sonnet-4-6", 2000, 1000);

    expect(tracker.getTotalTokens()).toBe(1000 + 500 + 2000 + 1000);
    expect(tracker.getBreakdown()).toHaveLength(2);
  });

  it("getBreakdown() returns entry details", () => {
    tracker.addUsage("planner", "google", "gemini-3.1-pro", 5000, 2000);

    const entries = tracker.getBreakdown();
    expect(entries).toHaveLength(1);
    expect(entries[0].persona).toBe("planner");
    expect(entries[0].provider).toBe("google");
    expect(entries[0].model).toBe("gemini-3.1-pro");
    expect(entries[0].inputTokens).toBe(5000);
    expect(entries[0].outputTokens).toBe(2000);
    expect(typeof entries[0].cost).toBe("number");
  });

  it("getBreakdown() returns a copy", () => {
    tracker.addUsage("planner", "ollama", "test", 100, 100);
    const b1 = tracker.getBreakdown();
    const b2 = tracker.getBreakdown();
    expect(b1).not.toBe(b2);
    expect(b1).toEqual(b2);
  });

  it("getSummary() returns formatted string with $", () => {
    tracker.addUsage("frontend_developer", "anthropic", "claude-sonnet-4-6", 1000, 500);
    const summary = tracker.getSummary();

    expect(summary).toContain("$");
    expect(summary).toContain("Session cost");
    expect(summary).toContain("frontend_developer");
    expect(summary).toContain("anthropic");
  });

  it("getSummary() includes all entries", () => {
    tracker.addUsage("planner", "google", "gemini-3.1-pro", 1000, 500);
    tracker.addUsage("tech_lead", "anthropic", "claude-sonnet-4-6", 2000, 1000);

    const summary = tracker.getSummary();
    expect(summary).toContain("planner");
    expect(summary).toContain("tech_lead");
  });

  it("getUsageSummary() aggregates totals by role and model", () => {
    tracker.addUsage("planner", "google", "gemini-3.1-pro", 1000, 400);
    tracker.addUsage("Reviewer (round 1)", "openai", "gpt-5.4", 2000, 1000);
    tracker.addUsage("frontend_developer", "openai", "gpt-5.4", 3000, 600);

    const summary = tracker.getUsageSummary();
    expect(summary.total.inputTokens).toBe(6000);
    expect(summary.total.outputTokens).toBe(2000);

    expect(summary.byRole.planner.inputTokens).toBe(1000);
    expect(summary.byRole.reviewer.inputTokens).toBe(2000);
    expect(summary.byRole.worker.inputTokens).toBe(3000);

    expect(summary.byModel).toHaveLength(2);
    const openAiModel = summary.byModel.find((m) => m.key === "openai/gpt-5.4");
    expect(openAiModel?.inputTokens).toBe(5000);
    expect(openAiModel?.outputTokens).toBe(1600);
    expect(openAiModel?.roles.sort()).toEqual(["reviewer", "worker"]);
  });

  it("records each stable call identity only once", () => {
    const call = {
      callId: "sdk-invocation-1",
      persona: "planner",
      provider: "openai",
      model: "gpt-5.4",
      usage: { inputTokens: 100, outputTokens: 20 },
    };

    expect(tracker.recordCall(call)).toBe(true);
    expect(tracker.recordCall({ ...call, usage: { inputTokens: 900, outputTokens: 900 } })).toBe(false);
    expect(tracker.getLedgerSnapshot().totals).toMatchObject({
      callCount: 1,
      reportedUsageCalls: 1,
      inputTokens: 100,
      outputTokens: 20,
    });
  });

  it("keeps missing usage and unknown selected-provider pricing explicit", () => {
    tracker.recordCall({
      callId: "missing",
      persona: "worker",
      provider: "openai",
      model: "gpt-5.4",
    });
    tracker.recordCall({
      callId: "unknown-rate",
      persona: "worker",
      provider: "openai",
      model: "unknown-model",
      usage: { inputTokens: 1000, outputTokens: 500 },
    });
    tracker.recordCall({
      callId: "unknown-provider",
      persona: "worker",
      provider: "unconfigured_provider",
      model: "gpt-5.4",
      usage: { inputTokens: 1000, outputTokens: 500 },
    });
    tracker.recordCall({
      callId: "partial",
      persona: "worker",
      provider: "openai",
      model: "gpt-5.4",
      usage: { inputTokens: 1000, outputTokens: 100 },
      usageComplete: false,
    });

    const ledger = tracker.getLedgerSnapshot();
    expect(ledger.calls.map((call) => [call.usageState, call.pricingState, call.estimatedApiCost]))
      .toEqual([
        ["missing", "known", undefined],
        ["reported", "unknown", undefined],
        ["reported", "unknown", undefined],
        ["partial", "known", undefined],
      ]);
    expect(ledger.totals).toMatchObject({
      missingUsageCalls: 1, partialUsageCalls: 1, unknownPricingCalls: 2, estimatedApiCost: 0,
    });
    expect(ledger.calls[3].usageComplete).toBe(false);
    expect(tracker.getTotalTokens()).toBe(4100);
    expect(tracker.getUsageSummary().byRole.worker.inputTokens).toBe(3000);
    expect(tracker.getTotalCost()).toBe(0);
    expect(tracker.getSummary()).toContain("subtotal excludes 2 call(s) with unknown pricing");
  });

  it("records local API zero separately from unestimated hardware and includes cache usage", () => {
    tracker.recordCall({
      callId: "local",
      persona: "worker",
      provider: "ollama",
      model: "local-model",
      usage: { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 200, cacheReadTokens: 300 },
    });

    const ledger = tracker.getLedgerSnapshot();
    expect(ledger.calls[0]).toMatchObject({ pricingState: "local", estimatedApiCost: 0 });
    expect(ledger.totals).toMatchObject({
      localApiCalls: 1, cacheCreationTokens: 200, cacheReadTokens: 300, estimatedApiCost: 0,
    });
  });

  it("uses registered cache rates when complete usage is known", () => {
    tracker.recordCall({
      callId: "cached-api-call",
      persona: "worker",
      provider: "openai",
      model: "gpt-5.4",
      usage: { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 200, cacheReadTokens: 300 },
    });
    expect(tracker.getLedgerSnapshot().calls[0].estimatedApiCost).toBeCloseTo(0.00275);
  });

  it("treats LM Studio as local even when it has no pricing registry entry", () => {
    tracker.recordCall({
      callId: "lmstudio",
      persona: "worker",
      provider: "lmstudio",
      model: "loaded-local-model",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    expect(tracker.getLedgerSnapshot().calls[0]).toMatchObject({
      pricingState: "local", estimatedApiCost: 0,
    });
  });

  it("rejects invalid reported token counts", () => {
    expect(() => tracker.recordCall({
      callId: "bad-usage",
      persona: "worker",
      provider: "openai",
      model: "gpt-5.4",
      usage: { inputTokens: -1, outputTokens: 0 },
    })).toThrow("finite non-negative");
  });
});
