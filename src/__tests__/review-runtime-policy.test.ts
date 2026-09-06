import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
vi.mock("../git-ops.js", () => ({
  getDiffForReview: vi.fn(() => ({ stat: " file | 1 +", diff: "diff --git a/file b/file" })),
  getDiffSinceCommit: vi.fn(() => "diff --git a/file b/file"),
  getHeadHash: vi.fn(() => "head"),
  captureStoryPriorWork: vi.fn(() => ""),
  commitRevisionChanges: vi.fn(() => ""),
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

    const review = await runReviewLoop({
      config: { ...config(), review: { enabled: true, maxRevisions: 1, autoRevise: true, approvalThreshold: 9 } },
      output: output(calls), sorted: [], context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] },
      userTask: "review", featureBranch: null, mainBranch: "main", workingDir: workspace,
      costTracker: { addUsage: vi.fn(), getTotalCost: () => 0, getUsageSummary: () => ({}) } as never,
      abortSignal: undefined, trustAll: true, sandboxed: true, sessionAllow: new Set(), ticketOps: null,
      gateResultsSection: "", waitWhilePaused: async () => false, pauseForBalanceIssue: async () => false, logRetryHint: vi.fn(),
    });

    expect(review.aborted).toBe(false);
    expect(attempts).toEqual(["denied"]);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("unchanged");
    expect(calls).toEqual([]);
    const contexts = vi.mocked(createToolDefinitions).mock.calls.map(([, , , options]) => options?.executionContext);
    expect(contexts[0]?.signal).toBe((vi.mocked(streamText).mock.calls[0][0] as StreamOptions).abortSignal);
    expect(contexts[0]?.runId).toMatch(/^[0-9a-f-]+-inline-1-1$/);
  });

  it("binds revision tools to their own timeout signal and leaves denied writes untouched", async () => {
    process.env.WM_REVIEW_TIMEOUT_MS = "10";
    const sentinel = path.join(workspace, "revision-sentinel.txt");
    fs.writeFileSync(sentinel, "unchanged");
    const attempts: string[] = [];
    let invocation = 0;
    vi.mocked(streamText).mockImplementation(((options: StreamOptions) => {
      invocation++;
      if (invocation === 1) return result(REVISION_NEEDED);
      return result("revision complete", async () => {
        await new Promise<void>((resolve) => options.abortSignal?.addEventListener("abort", () => resolve(), { once: true }));
        try { await options.tools?.write_file?.execute?.({ path: sentinel, content: "mutated" }); } catch (error) { attempts.push(error instanceof Error && "code" in error ? String(error.code) : "unknown"); }
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
    });

    expect(review.aborted).toBe(true);
    expect(attempts).toEqual(["cancelled"]);
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
});
