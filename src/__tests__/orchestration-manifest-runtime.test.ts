import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// These adapters isolate orchestration decisions. The manifest store itself is
// deliberately real: each assertion reads the JSON that a user can later see.
const state = vi.hoisted(() => ({
  plan: "ok" as "ok" | "rejected" | "throw", active: undefined as unknown,
  gateFail: false, completion: "ok" as "ok" | "invalid", cleanupFails: false, workerStatus: "completed" as "completed" | "failed",
}));

vi.mock("../logger.js", () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock("../memory.js", () => ({ loadMemories: vi.fn(() => []) }));
vi.mock("../hooks.js", () => ({ runLifecycleHooks: vi.fn() }));
vi.mock("../mcp-client.js", () => ({
  autoDetectMCPServersForRun: vi.fn(async (value: unknown) => value),
  createMCPRunResources: () => ({ register: vi.fn(), ensureStarted: vi.fn(), getToolDefinitions: () => ({}), close: vi.fn() }),
}));
vi.mock("../engine/run-resources.js", () => ({
  ResourceCleanupError: class ResourceCleanupError extends Error {},
  createAttemptResources: () => ({ close: vi.fn(async () => { if (state.cleanupFails) throw new Error("cleanup failed"); }) }),
}));
vi.mock("../orchestrator/planning.js", async (original) => ({
  ...await original<typeof import("../orchestrator/planning.js")>(),
  planStories: vi.fn(async (...args: unknown[]) => {
    const { loadRunManifest } = await import("../run-manifest.js");
    state.active = loadRunManifest((await import("../run-manifest.js")).listRunManifests()[0]?.id ?? "", process.cwd());
    await (args[7] as ((observation: { callId: string; persona: string; provider: string; model: string; usage: { inputTokens: number; outputTokens: number } }) => Promise<void>) | undefined)?.({ callId: "planner-usage", persona: "Planner", provider: "test", model: "test", usage: { inputTokens: 2, outputTokens: 3 } });
    if (state.plan === "throw") throw new Error("planner provider unavailable");
    if (state.plan === "rejected") return { rejected: true, failureReason: "planning_rejected", rejectionReason: "needs a decision", stories: [], provider: "test", model: "test", inputTokens: 0, outputTokens: 0 };
    return { rejected: false, stories: [story], provider: "test", model: "test", inputTokens: 2, outputTokens: 3 };
  }),
}));
vi.mock("../orchestrator/execution.js", () => ({
  executeStories: vi.fn(async (args: { completedStoryIds: string[]; costTracker: { recordCall: (call: object) => boolean }; onStoryAttempt?: (event: object) => void }) => {
    if (!args.completedStoryIds.includes("one")) {
      args.onStoryAttempt?.({ attemptId: "worker-1", storyId: "one", role: "worker", provider: "worker-provider", model: "worker-model", status: "started", at: "2026-01-01T00:00:00.000Z" });
      args.onStoryAttempt?.({ attemptId: "worker-1", storyId: "one", role: "worker", provider: "worker-provider", model: "worker-model", status: state.workerStatus, at: "2026-01-01T00:00:01.000Z" });
      args.costTracker.recordCall({ callId: "worker-1", persona: "Worker", provider: "test", model: "test", usage: { inputTokens: 11, outputTokens: 13 } });
      if (state.workerStatus === "completed") args.completedStoryIds.push("one");
    }
    return { failedStories: state.workerStatus === "failed" ? new Set(["one"]) : new Set(), skippedStories: new Set(), retryable: true, context: {}, earlyExit: false };
  }),
}));
vi.mock("../orchestrator/candidate.js", () => ({ prepareCandidate: vi.fn(async () => ({ prepared: true })) }));
const fingerprint = { verified: true as const, algorithm: "sha256" as const, head: "a".repeat(40), digest: "b".repeat(64) };
vi.mock("../repository-fingerprint.js", () => ({ captureRepositoryFingerprint: vi.fn(async () => fingerprint) }));
vi.mock("../orchestrator/gates.js", () => ({
  runQualityGates: vi.fn(async () => ({ gateResultsSection: "gates", earlyExit: state.gateFail, cancelled: false, gateResults: [{ id: "required", name: "required check", source: "required_command", required: true, status: state.gateFail ? "failed" : "passed", passed: !state.gateFail }] })),
}));
vi.mock("../orchestrator/review.js", () => ({
  runReviewLoop: vi.fn(async (args: { costTracker: { recordCall: (call: object) => boolean }; onReviewRound?: (event: object) => void }) => {
    // Model adapters record every started call, including a failed retry.
    args.costTracker.recordCall({ callId: "review-1", persona: "Reviewer", provider: "test", model: "test", usage: { inputTokens: 17, outputTokens: 19 }, usageComplete: false });
    args.costTracker.recordCall({ callId: "review-2", persona: "Reviewer", provider: "test", model: "test", usage: { inputTokens: 23, outputTokens: 29 } });
    args.onReviewRound?.({ attemptId: "review-2", round: 1, attempt: 2, role: "tech_lead", provider: "review-provider", model: "review-model", status: "completed", at: "2026-01-01T00:00:02.000Z", inputTokens: 23, outputTokens: 29, outcome: { kind: "approved", approved: true, decision: "approved", score: 10 } });
    return { aborted: false, finalReviewText: "approved", outcome: { kind: "approved", approved: true, decision: "approved", score: 10 }, fingerprint };
  }),
}));
vi.mock("../orchestrator/completion.js", () => ({
  runCompletion: vi.fn(async (args: { completedStoryIds: string[]; featureBranch: string | null; userTask: string; mainBranch: string }) => ({ stories: [story], completedStoryIds: args.completedStoryIds, featureBranch: args.featureBranch, userTask: args.userTask, mainBranch: args.mainBranch, completionInvalidated: state.completion === "invalid" })),
  shouldTransitionTicketOnPrOpen: vi.fn(() => false),
}));

import type { CliConfig } from "../config.js";
import { runOrchestration, type OrchestrationOutput } from "../orchestrator.js";
import { listRunManifests, loadRunManifest } from "../run-manifest.js";
import { runCompletion } from "../orchestrator/completion.js";
import { executeStories } from "../orchestrator/execution.js";
import { runReviewLoop } from "../orchestrator/review.js";

const story = { id: "one", title: "Implement one", persona: "backend_developer", description: "fixture" };
function git(dir: string, args: string[]) { return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim(); }
function output(): OrchestrationOutput { return { log: vi.fn(), coordinatorLog: vi.fn(), error: vi.fn(), status: vi.fn(), statusDone: vi.fn(), confirm: vi.fn(async () => true), toolCall: vi.fn(), updateBranch: vi.fn(), updateCost: vi.fn(), updateUsageSummary: vi.fn(), updateUsageLedger: vi.fn() }; }
const config: CliConfig = { providers: { ollama: { model: "test", host: "http://127.0.0.1:1" } }, default: "ollama", review: { enabled: true }, sandbox: false };

describe("orchestration manifest runtime", () => {
  let dir: string; let previousCwd: string; let stateRoot: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-manifest-runtime-")); stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wm-manifest-state-"));
    git(dir, ["init"]); git(dir, ["config", "user.email", "test@example.com"]); git(dir, ["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(dir, "README.md"), "fixture\n"); git(dir, ["add", "README.md"]); git(dir, ["commit", "-m", "initial"]);
    previousCwd = process.cwd(); process.chdir(dir); process.env.WM_STATE_ROOT = stateRoot;
    Object.assign(state, { plan: "ok", active: undefined, gateFail: false, completion: "ok", cleanupFails: false, workerStatus: "completed" }); vi.clearAllMocks();
  });
  afterEach(() => { if (previousCwd) process.chdir(previousCwd); delete process.env.WM_STATE_ROOT; if (dir) fs.rmSync(dir, { recursive: true, force: true }); if (stateRoot) fs.rmSync(stateRoot, { recursive: true, force: true }); });

  it("persists active evidence before planning and terminal evidence for planner exits", async () => {
    state.plan = "rejected";
    const result = await runOrchestration(config, "fixture", true, false, output());
    const manifest = loadRunManifest(result.runId!, dir)!;
    expect(state.active).toMatchObject({ phase: "active", outcome: "in_progress" });
    expect(manifest).toMatchObject({ phase: "terminal", terminalReason: "planning_rejected", outcome: "failed" });
    expect(listRunManifests(dir)).toHaveLength(1);
  });

  it("records planner provider failures as terminal manifests", async () => {
    state.plan = "throw";
    await expect(runOrchestration(config, "fixture", true, false, output())).rejects.toThrow("planner provider unavailable");
    expect(listRunManifests(dir)[0]).toMatchObject({ phase: "terminal", terminalReason: "planner_failed", outcome: "failed" });
  });

  it("marks cancelled startup and cleanup failures terminal without success", async () => {
    const controller = new AbortController(); controller.abort(new Error("cancelled"));
    await runOrchestration(config, "fixture", true, false, output(), controller.signal);
    expect(listRunManifests(dir)[0]).toMatchObject({ phase: "terminal", terminalReason: "cancelled", outcome: "cancelled" });

    state.cleanupFails = true;
    await expect(runOrchestration(config, "fixture", true, false, output())).rejects.toThrow("cleanup failed");
    expect(listRunManifests(dir)[0]).toMatchObject({ phase: "terminal", terminalReason: "cleanup_failed" });
  });

  it("persists required gate evidence and prevents completion", async () => {
    state.gateFail = true;
    const result = await runOrchestration(config, "fixture", true, false, output());
    const manifest = loadRunManifest(result.runId!, dir)!;
    expect(manifest).toMatchObject({ phase: "terminal", terminalReason: "required_gate_failed" });
    expect(manifest.gates).toMatchObject([{ name: "required check", required: true, status: "failed" }]);
  });

  it("only succeeds after completion settles and retains real attempt and review evidence", async () => {
    const rendered = output();
    const result = await runOrchestration(config, "fixture", true, false, rendered);
    const manifest = loadRunManifest(result.runId!, dir)!;
    expect(manifest).toMatchObject({ phase: "terminal", terminalReason: "success", outcome: "success" });
    expect(manifest.attempts).toMatchObject([{ storyId: "one", provider: "worker-provider", status: "completed" }]);
    expect(manifest.reviews).toMatchObject([{ provider: "review-provider", inputTokens: 23, outcome: { decision: "approved" } }]);
    expect(result.usageLedger).toEqual(manifest.usageLedger);
    expect(rendered.updateUsageLedger).toHaveBeenLastCalledWith(manifest.usageLedger);
    expect(manifest.usageLedger).toMatchObject({ calls: [
      { callId: "planner-usage", usage: { inputTokens: 2, outputTokens: 3 } },
      { callId: "worker-1", usage: { inputTokens: 11, outputTokens: 13 } },
      { callId: "review-1", usageState: "partial", usage: { inputTokens: 17, outputTokens: 19 } },
      { callId: "review-2", usage: { inputTokens: 23, outputTokens: 29 } },
    ], totals: { callCount: 4, reportedUsageCalls: 3, partialUsageCalls: 1, inputTokens: 53, outputTokens: 64, estimatedApiCost: 0 } });
    expect(manifest).toMatchObject({ totalCost: 0, totalInputTokens: 53, totalOutputTokens: 64 });
  });

  it("does not call an invalidated completion a success", async () => {
    state.completion = "invalid";
    const result = await runOrchestration(config, "fixture", true, false, output());
    expect(loadRunManifest(result.runId!, dir)).toMatchObject({ phase: "terminal", terminalReason: "completion_blocked", outcome: "failed" });
    expect(result).toMatchObject({ outcome: "failed", terminalReason: "completion_blocked" });
  });

  it("returns and persists partial progress without inventing resumed attempts", async () => {
    state.workerStatus = "failed";
    const branch = git(dir, ["branch", "--show-current"]);
    const result = await runOrchestration(config, "fixture", true, false, output(), undefined, {
      priorRunId: "run-earlier", stories: [{ ...story, id: "done" }, story], completedStoryIds: ["done"], featureBranch: branch, mainBranch: branch,
    });
    expect(result).toMatchObject({ outcome: "partial", terminalReason: "partial" });
    expect(loadRunManifest(result.runId!, dir)).toMatchObject({ outcome: "partial", terminalReason: "partial", attempts: [{ storyId: "one", status: "failed" }] });
  });

  it("keeps the persisted run active while completion is pending", async () => {
    let entered = false;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(runCompletion).mockImplementationOnce(async (args) => {
      entered = true;
      await pending;
      return { stories: args.sorted, completedStoryIds: args.completedStoryIds, featureBranch: args.featureBranch, userTask: args.userTask, mainBranch: args.mainBranch };
    });
    const run = runOrchestration(config, "fixture", true, false, output());
    try {
      await vi.waitFor(() => expect(entered).toBe(true));
      expect(listRunManifests(dir)[0]).toMatchObject({ phase: "active", outcome: "in_progress" });
      expect(listRunManifests(dir)[0].completedAt).toBeUndefined();
    } finally { release(); }
    const result = await run;
    expect(loadRunManifest(result.runId!, dir)).toMatchObject({ phase: "terminal", outcome: "success" });
  });

  it("persists a valid terminal record when the wall clock moves backwards", async () => {
    vi.mocked(runCompletion).mockImplementationOnce(async (args) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
      return { stories: args.sorted, completedStoryIds: args.completedStoryIds, featureBranch: args.featureBranch, userTask: args.userTask };
    });
    try {
      const result = await runOrchestration(config, "fixture", true, false, output());
      const manifest = loadRunManifest(result.runId!, dir)!;
      expect(manifest).toMatchObject({ phase: "terminal", outcome: "success" });
      expect(Date.parse(manifest.completedAt!)).toBeGreaterThanOrEqual(Date.parse(manifest.startedAt));
    } finally { vi.useRealTimers(); }
  });

  it("records required reviewer identity blocking before any worker starts", async () => {
    const result = await runOrchestration({ ...config, review: { enabled: true, requireDifferentModel: true } }, "fixture", true, false, output());
    expect(executeStories).not.toHaveBeenCalled();
    expect(runCompletion).not.toHaveBeenCalled();
    expect(loadRunManifest(result.runId!, dir)).toMatchObject({ phase: "terminal", outcome: "failed", terminalReason: "permission_blocked", attempts: [] });
  });

  it("persists strict review rejection and never enters completion", async () => {
    vi.mocked(runReviewLoop).mockResolvedValueOnce({ aborted: false, finalReviewText: "rejected", outcome: { kind: "rejected", approved: false, decision: "rejected" } });
    const result = await runOrchestration({ ...config, review: { enabled: true, strict: true } }, "fixture", true, false, output());
    expect(runCompletion).not.toHaveBeenCalled();
    expect(loadRunManifest(result.runId!, dir)).toMatchObject({ phase: "terminal", outcome: "failed", terminalReason: "review_rejected", reviews: [{ outcome: { kind: "rejected" } }] });
  });

  it("preserves failed worker callback evidence", async () => {
    state.workerStatus = "failed";
    const result = await runOrchestration(config, "fixture", true, false, output());
    expect(loadRunManifest(result.runId!, dir)?.attempts).toMatchObject([{ storyId: "one", status: "failed", completedAt: "2026-01-01T00:00:01.000Z" }]);
  });

  it("retains retry lineage without inventing attempts for completed stories", async () => {
    const result = await runOrchestration(config, "fixture", true, false, output(), undefined, { priorRunId: "run-prior-abc", stories: [story], completedStoryIds: ["one"], featureBranch: git(dir, ["branch", "--show-current"]), mainBranch: git(dir, ["branch", "--show-current"]) });
    const manifest = loadRunManifest(result.runId!, dir)!;
    expect(manifest.priorRunId).toBe("run-prior-abc");
    expect(manifest.attempts).toEqual([]);
  });
});
