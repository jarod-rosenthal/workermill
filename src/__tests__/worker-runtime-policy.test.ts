import { describe, expect, it, vi } from "vitest";

const { streamText, createToolDefinitions, abortController } = vi.hoisted(() => ({
  streamText: vi.fn(),
  createToolDefinitions: vi.fn(),
  abortController: new AbortController(),
}));

vi.mock("ai", () => ({
  streamText,
  stepCountIs: vi.fn(() => () => false),
}));

vi.mock("../engine/model-factory.js", () => ({
  createModel: vi.fn(() => ({ modelId: "test-model", provider: "test" })),
  buildOllamaOptions: vi.fn(() => ({})),
}));

vi.mock("../engine/tools/index.js", () => ({ createToolDefinitions }));
vi.mock("../personas.js", () => ({
  loadPersona: vi.fn(() => ({ name: "worker", systemPrompt: "worker", tools: ["bash"] })),
}));
vi.mock("../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config.js")>()),
  getProviderForPersona: vi.fn(() => ({ provider: "ollama", model: "test-model", contextLength: 4096 })),
}));
vi.mock("../mcp-client.js", () => ({ getMCPToolDefinitions: vi.fn(() => ({})) }));
vi.mock("../hooks.js", () => ({ runHooks: vi.fn(), runPreHooksWithBlocking: vi.fn(() => ({ blocked: false })), runLifecycleHooks: vi.fn() }));
vi.mock("../logger.js", () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() }));

import { executeStories } from "../orchestrator/execution.js";
import type { OrchestrationOutput, SharedContext } from "../orchestrator/types.js";

const output: OrchestrationOutput = {
  log: vi.fn(), coordinatorLog: vi.fn(), error: vi.fn(), status: vi.fn(), statusDone: vi.fn(),
  confirm: vi.fn(async () => true), toolCall: vi.fn(),
};

describe("worker execution policy runtime", () => {
  it("threads the run context into tools and does not complete a cancelled story", async () => {
    const context: SharedContext = { filesCreated: [], filesModified: [], decisions: [], learnings: [] };
    let factoryContext: { runId?: string; signal?: AbortSignal } | undefined;
    createToolDefinitions.mockImplementation((_cwd: string, _model: unknown, _sandbox: unknown, options: { executionContext?: { runId: string; signal: AbortSignal } }) => {
      factoryContext = options.executionContext;
      return {
        bash: { execute: async () => { abortController.abort(); return "late success"; } },
      };
    });
    streamText.mockImplementation((options: { tools: Record<string, { execute: (input: Record<string, unknown>) => Promise<unknown> }> }) => ({
      textStream: (async function* () { await options.tools.bash.execute({ command: "required-command" }); yield "done"; })(),
      text: Promise.resolve("done"),
      totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    }));

    const result = await executeStories({
      sorted: [{ id: "story", title: "Story", persona: "worker", description: "make a change" }],
      completedStoryIds: [],
      config: { providers: {}, default: "ollama", permissions: { allow: [] } },
      output,
      trustAll: true,
      sandboxed: true,
      userTask: "task",
      context,
      sessionAllow: new Set(),
      workingDir: process.cwd(),
      costTracker: { addUsage: vi.fn(), getTotalCost: () => 0, getUsageSummary: () => ({}) } as never,
      featureBranch: null,
      mainBranch: "main",
      abortSignal: abortController.signal,
      runId: "run-r08",
      ticketOps: null,
      waitWhilePaused: async () => false,
      pauseForBalanceIssue: async () => false,
      logRetryHint: vi.fn(),
    });

    expect(factoryContext).toMatchObject({ runId: "run-r08", signal: abortController.signal });
    expect(result.completedStoryIds).toEqual([]);
    expect(result.earlyExit).toBe(true);
  });
});
