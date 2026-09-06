import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";

const { streamText, shutdownLSPRun } = vi.hoisted(() => ({
  streamText: vi.fn(),
  shutdownLSPRun: vi.fn(async () => undefined),
}));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  streamText,
  stepCountIs: vi.fn(() => () => false),
}));
vi.mock("../engine/model-factory.js", () => ({
  createModel: vi.fn(() => ({ modelId: "lifecycle-test" })),
  buildOllamaOptions: vi.fn(() => ({})),
}));
vi.mock("../personas.js", () => ({
  loadPersona: vi.fn((name: string) => ({ name, systemPrompt: "test", tools: name === "planner" ? ["read_file"] : ["bash"] })),
}));
vi.mock("../logger.js", () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("../engine/tools/lsp.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../engine/tools/lsp.js")>()),
  shutdownLSPRun,
}));

import { executeStories } from "../orchestrator/execution.js";
import { planStories } from "../orchestrator/planning.js";
import type { OrchestrationOutput } from "../orchestrator/types.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), resolve };
}

async function waitForFile(file: string): Promise<void> {
  if (fs.existsSync(file)) return;
  const watcher = fs.watch(path.dirname(file));
  try {
    while (!fs.existsSync(file)) await once(watcher, "change");
  } finally {
    watcher.close();
  }
}

const output: OrchestrationOutput = {
  log: vi.fn(), coordinatorLog: vi.fn(), error: vi.fn(), status: vi.fn(), statusDone: vi.fn(),
  confirm: vi.fn(async () => true), toolCall: vi.fn(),
};

describe("orchestration lifecycle runtime", () => {
  let workspace: string;
  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "wm-lifecycle-"));
    vi.clearAllMocks();
  });
  afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }));

  it("drains a started worker bash before a provider failure can become story success", async () => {
    const started = path.join(workspace, "started");
    const release = path.join(workspace, "release");
    const sentinel = path.join(workspace, "late");
    streamText.mockImplementation((options: { tools: Record<string, { execute(input: Record<string, unknown>): Promise<unknown> }> }) => ({
      textStream: (async function* () {
        void options.tools.bash.execute({ command: `sh -c 'touch started; while [ ! -f release ]; do sleep 1; done; touch late'` });
        await waitForFile(started);
        throw new Error("provider transport failed after tool dispatch");
      })(),
      text: Promise.resolve("false success"), totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    }));

    const result = await executeStories({
      sorted: [{ id: "worker", title: "worker", persona: "worker", description: "run" }], completedStoryIds: [],
      config: { providers: { test: { model: "lifecycle-test" } }, default: "test", permissions: { allow: ["bash(*)"] } } as never,
      output, trustAll: true, sandboxed: true, userTask: "run", context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] },
      sessionAllow: new Set(), workingDir: workspace, costTracker: { addUsage: vi.fn(), getTotalCost: () => 0, getUsageSummary: () => ({}) } as never,
      featureBranch: null, mainBranch: "main", abortSignal: new AbortController().signal, runId: "lifecycle", ticketOps: null,
      waitWhilePaused: async () => false, pauseForBalanceIssue: async () => false, logRetryHint: vi.fn(),
    });
    fs.writeFileSync(release, "release");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(result.completedStoryIds).toEqual([]);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it("does not start a planner model after an already-aborted run", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const result = await planStories({ providers: { test: { model: "lifecycle-test" } }, default: "test" } as never, "plan", workspace, true, output, controller.signal);
    expect(result.rejected).toBe(true);
    expect(streamText).not.toHaveBeenCalled();
  });

  it("records a failing worker LSP teardown as a non-success attempt", async () => {
    shutdownLSPRun.mockRejectedValueOnce(new Error("LSP close failed"));
    const gate = deferred();
    streamText.mockImplementation(() => ({
      textStream: (async function* () { await gate.promise; yield "done"; })(),
      text: Promise.resolve("done"), totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    }));
    gate.resolve();
    const completedStoryIds: string[] = [];
    await expect(executeStories({
      sorted: [{ id: "cleanup", title: "cleanup", persona: "worker", description: "run" }], completedStoryIds,
      config: { providers: { test: { model: "lifecycle-test" } }, default: "test" } as never,
      output, trustAll: true, sandboxed: true, userTask: "run", context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] },
      sessionAllow: new Set(), workingDir: workspace, costTracker: { addUsage: vi.fn(), getTotalCost: () => 0, getUsageSummary: () => ({}) } as never,
      featureBranch: null, mainBranch: "main", abortSignal: new AbortController().signal, runId: "lifecycle", ticketOps: null,
      waitWhilePaused: async () => false, pauseForBalanceIssue: async () => false, logRetryHint: vi.fn(),
    })).rejects.toThrow("LSP close failed");
    expect(shutdownLSPRun).toHaveBeenCalled();
    expect(completedStoryIds).toEqual([]);
  });
});
