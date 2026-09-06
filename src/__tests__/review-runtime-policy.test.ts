import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

vi.mock("../logger.js", () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../engine/model-factory.js", () => ({
  createModel: vi.fn(() => ({ modelId: "review-policy-model" })),
  buildOllamaOptions: vi.fn(() => ({})),
}));
vi.mock("../engine/tools/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../engine/tools/index.js")>();
  return { ...actual, createToolDefinitions: vi.fn(actual.createToolDefinitions) };
});
vi.mock("../personas.js", () => ({ loadPersona: vi.fn() }));
vi.mock("../instructions.js", () => ({ formatProjectInstructions: vi.fn(() => "") }));
vi.mock("../project-context.js", () => ({ formatPromptProjectContext: vi.fn(() => "") }));
vi.mock("../hooks.js", () => ({ runHooks: vi.fn(), runLifecycleHooks: vi.fn(), runPreHooksWithBlocking: vi.fn(() => ({ blocked: false })) }));
vi.mock("../checkpoints.js", () => ({ checkpoint: vi.fn() }));
vi.mock("../sandbox-mode.js", () => ({ resolveSandboxMode: vi.fn(() => ({ requested: "os", effective: "os" })) }));
vi.mock("../orchestrator/git-context.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../orchestrator/git-context.js")>(),
  createReviewGit: vi.fn(() => ({
    branchDiff: vi.fn(async () => ({ stat: " file | 1 +", diff: "diff --git a/file b/file" })),
    uncommitted: vi.fn(async () => ({ stat: " file | 1 +", diff: "diff --git a/file b/file" })),
    delta: vi.fn(async () => "diff --git a/file b/file"),
    head: vi.fn(async () => "head"), priorWork: vi.fn(async () => ""),
    defaultBranch: vi.fn(async () => "main"), prDiff: vi.fn(async () => "diff --git a/file b/file"),
  })),
}));
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: vi.fn() };
});

import { streamText } from "ai";
import { createModel } from "../engine/model-factory.js";
import { createToolDefinitions } from "../engine/tools/index.js";
import { loadPersona } from "../personas.js";
import { runHooks, runPreHooksWithBlocking } from "../hooks.js";
import { checkpoint } from "../checkpoints.js";
import { resolveSandboxMode } from "../sandbox-mode.js";
import { runReviewLoop, runStandaloneReview } from "../orchestrator/review.js";
import type { CliConfig } from "../config.js";
import type { OrchestrationOutput, SharedContext } from "../orchestrator/types.js";

type Tool = { execute?: (input: Record<string, unknown>) => Promise<unknown> | unknown };
type StreamOptions = { tools?: Record<string, Tool>; abortSignal?: AbortSignal };
type StreamResult = { textStream: AsyncIterable<string>; text: Promise<string>; totalUsage: Promise<{ inputTokens: number; outputTokens: number }> };

const APPROVED = "REVIEW_DECISION: approved\nCODE_QUALITY_SCORE: 9\nFEEDBACK: Good.";
const REVISION_NEEDED = "Needs a fix.\nREVIEW_DECISION: revision_needed\nCODE_QUALITY_SCORE: 7\nFEEDBACK: Fix it.\nBLOCKING_EVIDENCE: test\nACTIONABLE_FIX: fix it.";
const REJECTED_HIGH_SCORE = "REVIEW_DECISION: rejected\nCODE_QUALITY_SCORE: 10\nFEEDBACK: The approach is unsafe.";

function config(): CliConfig {
  return {
    providers: { test: { model: "review-policy-model" } },
    default: "test",
    permissions: { allow: ["write_file(*)", "bash(*)", "sub_agent(*)"] },
    review: { enabled: true, maxRevisions: 2, autoRevise: true, approvalThreshold: 9 },
  } as CliConfig;
}

function output(calls: Array<{ name: string; input: Record<string, unknown> }>): OrchestrationOutput {
  return {
    log: () => {}, coordinatorLog: () => {}, error: () => {}, status: () => {}, statusDone: () => {},
    confirm: async () => true,
    toolCall: (_role, name, input) => calls.push({ name, input }),
  };
}

function result(text: string, beforeYield?: () => Promise<void>): StreamResult {
  return {
    textStream: (async function* () { await beforeYield?.(); yield text; })(),
    text: Promise.resolve(text),
    totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
  };
}

describe("review runtime policy", () => {
  const originalCwd = process.cwd();
  const originalTimeout = process.env.WM_REVIEW_TIMEOUT_MS;
  let workspace: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "workermill-review-policy-"));
    process.chdir(workspace);
    vi.clearAllMocks();
    vi.mocked(loadPersona).mockImplementation((slug: string) => ({
      name: slug,
      slug,
      systemPrompt: "Use every listed tool.",
      // A hostile reviewer declaration must not bypass readOnlyRole.
      tools: slug === "tech_lead" ? ["write_file", "bash", "sub_agent", "read_file"] : ["write_file"],
    }));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalTimeout === undefined) delete process.env.WM_REVIEW_TIMEOUT_MS;
    else process.env.WM_REVIEW_TIMEOUT_MS = originalTimeout;
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("denies malicious standalone reviewer mutations before hooks or the real write tool", async () => {
    const sentinel = path.join(workspace, "standalone-sentinel.txt");
    fs.writeFileSync(sentinel, "unchanged");
    const attempts: string[] = [];
    const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
    vi.mocked(streamText).mockImplementation(((options: StreamOptions) => result(APPROVED, async () => {
      for (const [name, input] of [["write_file", { path: sentinel, content: "mutated" }], ["bash", { command: `printf mutated > ${sentinel}` }], ["sub_agent", { prompt: "mutate it" }]] as const) {
        try { await options.tools?.[name]?.execute?.(input); } catch (error) { attempts.push(error instanceof Error && "code" in error ? String(error.code) : "unknown"); }
      }
    })) as typeof streamText);

    await expect(runStandaloneReview(config(), output(calls), "branch")).resolves.toMatchObject({ decision: "approved" });

    expect(attempts).toEqual(["denied", "denied", "denied"]);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("unchanged");
    expect(calls).toEqual([]);
    expect(runPreHooksWithBlocking).not.toHaveBeenCalled();
    expect(runHooks).not.toHaveBeenCalled();
    expect(checkpoint).not.toHaveBeenCalled();
    const contexts = vi.mocked(createToolDefinitions).mock.calls.map(([, , , options]) => options?.executionContext);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.signal).toBe((vi.mocked(streamText).mock.calls[0][0] as StreamOptions).abortSignal);
    expect(contexts[0]?.runId).toMatch(/^[0-9a-f-]+-standalone-1$/);
  });

  it("applies the same read-only executor to inline review tools", async () => {
    const sentinel = path.join(workspace, "inline-sentinel.txt");
    fs.writeFileSync(sentinel, "unchanged");
    const attempts: string[] = [];
    const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
    vi.mocked(streamText).mockImplementation(((options: StreamOptions) => result(APPROVED, async () => {
      try { await options.tools?.write_file?.execute?.({ path: sentinel, content: "mutated" }); } catch (error) { attempts.push(error instanceof Error && "code" in error ? String(error.code) : "unknown"); }
    })) as typeof streamText);

    const events: Array<{ status: string; outcome?: { kind: string }; inputTokens?: number }> = [];
    const review = await runReviewLoop({
      config: { ...config(), review: { enabled: true, maxRevisions: 1, autoRevise: true, approvalThreshold: 9 } },
      output: output(calls), sorted: [], context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] },
      userTask: "review", featureBranch: null, mainBranch: "main", workingDir: workspace,
      costTracker: { addUsage: vi.fn(), getTotalCost: () => 0, getUsageSummary: () => ({}) } as never,
      abortSignal: undefined, trustAll: true, sandboxed: true, sessionAllow: new Set(), ticketOps: null,
      gateResultsSection: "", waitWhilePaused: async () => false, pauseForBalanceIssue: async () => false, logRetryHint: vi.fn(),
      onReviewRound: (event) => { events.push(event); },
    });

    expect(review.aborted).toBe(false);
    expect(attempts).toEqual(["denied"]);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("unchanged");
    expect(calls).toEqual([]);
    const contexts = vi.mocked(createToolDefinitions).mock.calls.map(([, , , options]) => options?.executionContext);
    expect(contexts[0]?.signal).toBe((vi.mocked(streamText).mock.calls[0][0] as StreamOptions).abortSignal);
    expect(contexts[0]?.runId).toMatch(/^[0-9a-f-]+-inline-1-1$/);
    expect(events.map((event) => event.status)).toEqual(["started", "completed"]);
    expect(events[1]).toMatchObject({ outcome: { kind: "approved" }, inputTokens: 1 });
  });

  it.each([false, true])("binds revision tools to their timeout and rejects late writes (stream throws=%s)", async (streamThrows) => {
    process.env.WM_REVIEW_TIMEOUT_MS = "10";
    const sentinel = path.join(workspace, "revision-sentinel.txt");
    fs.writeFileSync(sentinel, "unchanged");
    const attempts: string[] = [];
    const revisionEvents: string[] = [];
    let invocation = 0;
    vi.mocked(streamText).mockImplementation(((options: StreamOptions) => {
      invocation++;
      if (invocation === 1) return result(REVISION_NEEDED);
      return result("revision complete", async () => {
        await new Promise<void>((resolve) => options.abortSignal?.addEventListener("abort", () => resolve(), { once: true }));
        try { await options.tools?.write_file?.execute?.({ path: sentinel, content: "mutated" }); } catch (error) { attempts.push(error instanceof Error && "code" in error ? String(error.code) : "unknown"); }
        if (streamThrows) throw new Error("operation cancelled");
      });
    }) as typeof streamText);

    const review = await runReviewLoop({
      config: { ...config(), permissions: { deny: ["write_file"] } }, output: output([]),
      sorted: [{ id: "revision", title: "Revision", persona: "worker", description: "Fix it" }],
      context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] } as SharedContext,
      userTask: "review", featureBranch: null, mainBranch: "main", workingDir: workspace,
      costTracker: { addUsage: vi.fn(), getTotalCost: () => 0, getUsageSummary: () => ({}) } as never,
      abortSignal: undefined, trustAll: true, sandboxed: true, sessionAllow: new Set(), ticketOps: null,
      gateResultsSection: "", waitWhilePaused: async () => false, pauseForBalanceIssue: async () => false, logRetryHint: vi.fn(),
      onRevisionAttempt: (event) => { revisionEvents.push(event.status); },
    });

    expect(review.aborted).toBe(true);
    expect(review.outcome).toMatchObject({ kind: "timed_out", approved: false });
    expect(invocation).toBe(2);
    expect(review.outcome).toMatchObject({ kind: "timed_out", approved: false });
    expect(attempts).toEqual(["cancelled"]);
    expect(revisionEvents).toEqual(["started", "failed"]);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("unchanged");
    expect(runPreHooksWithBlocking).not.toHaveBeenCalled();
    const contexts = vi.mocked(createToolDefinitions).mock.calls.map(([, , , options]) => options?.executionContext);
    expect(contexts).toHaveLength(2);
    expect(contexts[1]?.signal).toBe((vi.mocked(streamText).mock.calls[1][0] as StreamOptions).abortSignal);
    expect(contexts.map((context) => context?.runId)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^[0-9a-f-]+-inline-1-1$/),
      expect.stringMatching(/^[0-9a-f-]+-revision-1-revision-[0-9a-f-]+$/),
    ]));
  });

  it("does not initialize a model for pre-aborted or unavailable explicit OS reviews", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runStandaloneReview(config(), output([]), "branch", controller.signal)).resolves.toBeNull();
    expect(createModel).not.toHaveBeenCalled();

    vi.mocked(resolveSandboxMode).mockImplementation(() => { throw new Error("OS sandbox unavailable"); });
    await expect(runStandaloneReview({ ...config(), sandbox: "os" }, output([]), "branch")).rejects.toThrow("OS sandbox unavailable");
    expect(createModel).not.toHaveBeenCalled();
  });

  it("does not adopt a late standalone approval after parent cancellation", async () => {
    const controller = new AbortController();
    vi.mocked(streamText).mockImplementation((() => result(APPROVED, async () => {
      controller.abort();
    })) as typeof streamText);
    await expect(runStandaloneReview(config(), output([]), "branch", controller.signal)).resolves.toBeNull();
    expect(streamText).toHaveBeenCalledTimes(1);
  });

  it("returns typed disabled and unavailable reviewer outcomes without invoking a model", async () => {
    const base = {
      output: output([]), sorted: [], context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] },
      userTask: "review", featureBranch: null, mainBranch: "main", workingDir: workspace,
      costTracker: { addUsage: vi.fn(), getTotalCost: () => 0, getUsageSummary: () => ({}) } as never,
      abortSignal: undefined, trustAll: true, sandboxed: true, sessionAllow: new Set(), ticketOps: null,
      gateResultsSection: "", waitWhilePaused: async () => false, pauseForBalanceIssue: async () => false, logRetryHint: vi.fn(),
    };
    await expect(runReviewLoop({ ...base, config: { ...config(), review: { ...config().review!, enabled: false } } })).resolves.toMatchObject({
      aborted: false, outcome: { kind: "disabled", approved: false },
    });
    vi.mocked(loadPersona).mockReturnValue(null);
    await expect(runReviewLoop({ ...base, config: config() })).resolves.toMatchObject({
      aborted: false, outcome: { kind: "unavailable", approved: false },
    });
    expect(streamText).not.toHaveBeenCalled();
  });

  it("does not promote a rejected high score and reports malformed reviewer output", async () => {
    vi.mocked(streamText).mockImplementation((() => result(REJECTED_HIGH_SCORE)) as typeof streamText);
    const rejected = await runReviewLoop({
      config: { ...config(), review: { ...config().review!, maxRevisions: 1 } }, output: output([]), sorted: [], context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] },
      userTask: "review", featureBranch: null, mainBranch: "main", workingDir: workspace,
      costTracker: { addUsage: vi.fn(), getTotalCost: () => 0, getUsageSummary: () => ({}) } as never,
      abortSignal: undefined, trustAll: true, sandboxed: true, sessionAllow: new Set(), ticketOps: null,
      gateResultsSection: "", waitWhilePaused: async () => false, pauseForBalanceIssue: async () => false, logRetryHint: vi.fn(),
    });
    expect(rejected.outcome).toMatchObject({ kind: "revision_exhausted", approved: false, decision: "rejected", score: 10 });

    vi.mocked(streamText).mockImplementation((() => result("REVIEW_DECISION: approved\nCODE_QUALITY_SCORE: 9\nREVIEW_DECISION: rejected\nFEEDBACK: invalid")) as typeof streamText);
    const malformed = await runReviewLoop({
      config: config(), output: output([]), sorted: [], context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] },
      userTask: "review", featureBranch: null, mainBranch: "main", workingDir: workspace,
      costTracker: { addUsage: vi.fn(), getTotalCost: () => 0, getUsageSummary: () => ({}) } as never,
      abortSignal: undefined, trustAll: true, sandboxed: true, sessionAllow: new Set(), ticketOps: null,
      gateResultsSection: "", waitWhilePaused: async () => false, pauseForBalanceIssue: async () => false, logRetryHint: vi.fn(),
    });
    expect(malformed.outcome).toMatchObject({ kind: "parse_failed", approved: false });
  });

  it("does not retain a failed retry classification after a later malformed response", async () => {
    let attempt = 0;
    vi.mocked(streamText).mockImplementation((() => {
      attempt += 1;
      if (attempt === 1) throw new Error("ECONNRESET");
      return result("REVIEW_DECISION: approved\nCODE_QUALITY_SCORE: invalid\nFEEDBACK: malformed after retry");
    }) as typeof streamText);

    const review = await runReviewLoop({
      config: config(), output: output([]), sorted: [], context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] },
      userTask: "review", featureBranch: null, mainBranch: "main", workingDir: workspace,
      costTracker: { addUsage: vi.fn(), getTotalCost: () => 0, getUsageSummary: () => ({}) } as never,
      abortSignal: undefined, trustAll: true, sandboxed: true, sessionAllow: new Set(), ticketOps: null,
      gateResultsSection: "", waitWhilePaused: async () => false, pauseForBalanceIssue: async () => false, logRetryHint: vi.fn(),
    });
    expect(attempt).toBe(2);
    expect(review.outcome).toMatchObject({ kind: "parse_failed", approved: false });
  });

  it("returns approved, revision-exhausted, and cancelled outcomes from real review parsing", async () => {
    // An approved publication outcome needs real repository-state evidence.
    execFileSync("git", ["init"], { cwd: workspace, stdio: "pipe" });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial"], { cwd: workspace, stdio: "pipe" });
    const base = {
      output: output([]), sorted: [], context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] },
      userTask: "review", featureBranch: null, mainBranch: "main", workingDir: workspace,
      costTracker: { addUsage: vi.fn(), getTotalCost: () => 0, getUsageSummary: () => ({}) } as never,
      trustAll: true, sandboxed: true, sessionAllow: new Set(), ticketOps: null,
      gateResultsSection: "", waitWhilePaused: async () => false, pauseForBalanceIssue: async () => false, logRetryHint: vi.fn(),
    };
    vi.mocked(streamText).mockImplementation((() => result(APPROVED)) as typeof streamText);
    await expect(runReviewLoop({ ...base, config: config(), abortSignal: undefined })).resolves.toMatchObject({
      outcome: { kind: "approved", approved: true, decision: "approved", score: 9 },
    });

    vi.mocked(streamText).mockImplementation((() => result(REVISION_NEEDED)) as typeof streamText);
    await expect(runReviewLoop({ ...base, config: { ...config(), review: { ...config().review!, maxRevisions: 1 } }, abortSignal: undefined })).resolves.toMatchObject({
      outcome: { kind: "revision_exhausted", approved: false, decision: "revision_needed" },
    });

    const controller = new AbortController();
    controller.abort();
    await expect(runReviewLoop({ ...base, config: config(), abortSignal: controller.signal })).resolves.toMatchObject({
      aborted: true, outcome: { kind: "cancelled", approved: false },
    });
  });

  it.each([false, true])("revision writes obey current deny rules (denied=%s)", async (denied) => {
    const sentinel = path.join(workspace, "live-revision.txt");
    fs.writeFileSync(sentinel, "unchanged");
    const attempts: string[] = [];
    let invocation = 0;
    vi.mocked(streamText).mockImplementation(((options: StreamOptions) => {
      invocation++;
      if (invocation === 1) return result(REVISION_NEEDED);
      if (invocation === 2) return result("revision complete", async () => {
        try {
          await options.tools!.write_file!.execute!({ path: sentinel, content: "revised" });
          attempts.push("executed");
        } catch (error) {
          attempts.push(error instanceof Error && "code" in error ? String(error.code) : "unknown");
        }
      });
      return result(APPROVED);
    }) as typeof streamText);

    await runReviewLoop({
      config: { ...config(), permissions: denied ? { deny: ["write_file"] } : { allow: ["write_file"] } },
      output: output([]), sorted: [{ id: "revision", title: "Revision", persona: "worker", description: "Fix it" }],
      context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] },
      userTask: "review", featureBranch: null, mainBranch: "main", workingDir: workspace,
      costTracker: { addUsage: vi.fn(), getTotalCost: () => 0, getUsageSummary: () => ({}) } as never,
      trustAll: true, sandboxed: true, sessionAllow: new Set(), ticketOps: null,
      gateResultsSection: "", waitWhilePaused: async () => false, pauseForBalanceIssue: async () => false, logRetryHint: vi.fn(),
    });

    expect(attempts).toEqual([denied ? "denied" : "executed"]);
    expect(fs.readFileSync(sentinel, "utf8")).toBe(denied ? "unchanged" : "revised");
    expect(runPreHooksWithBlocking).toHaveBeenCalledTimes(denied ? 0 : 1);
    expect(checkpoint).toHaveBeenCalledTimes(denied ? 0 : 1);
    expect(runHooks).toHaveBeenCalledTimes(denied ? 0 : 1);
  });
});
