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
import { runLifecycleHooks, runPreHooksWithBlocking } from "../hooks.js";

const output: OrchestrationOutput = {
  log: vi.fn(), coordinatorLog: vi.fn(), error: vi.fn(), status: vi.fn(), statusDone: vi.fn(),
  confirm: vi.fn(async () => true), toolCall: vi.fn(),
};

describe("worker execution policy runtime", () => {
  it("records provider failure as failed even though teardown aborts the attempt", async () => {
    vi.clearAllMocks();
    createToolDefinitions.mockReturnValue({});
    streamText.mockImplementation(() => { throw new Error("Invalid API key"); });
    const attempts: string[] = [];
    const controller = new AbortController();
    const result = await executeStories({
      sorted: [{ id: "failed", title: "Failed", persona: "worker", description: "provider failure" }],
      completedStoryIds: [], config: { providers: {}, default: "ollama" },
      output, trustAll: true, sandboxed: false, userTask: "task",
      context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] },
      sessionAllow: new Set(), workingDir: process.cwd(),
      costTracker: { addUsage: vi.fn(), getTotalCost: () => 0, getUsageSummary: () => ({}) } as never,
      featureBranch: null, mainBranch: "main", abortSignal: controller.signal, ticketOps: null,
      waitWhilePaused: async () => false, pauseForBalanceIssue: async () => false, logRetryHint: vi.fn(),
      onStoryAttempt: (event) => { attempts.push(event.status); },
    });
    expect(result.failedStories.has("failed")).toBe(true);
    expect(controller.signal.aborted).toBe(false);
    expect(attempts).toEqual(["started", "failed"]);
  });

  it("threads the run context into tools and does not complete a cancelled story", async () => {
    const context: SharedContext = { filesCreated: [], filesModified: [], decisions: [], learnings: [] };
    let factoryContext: {
      runId?: string;
      signal?: AbortSignal;
      allowedNetworkDomains?: readonly string[];
      allowLocalBinding?: boolean;
      allowDockerSocket?: boolean;
      scope?: { extraGrants: readonly { root: string }[] };
    } | undefined;
    createToolDefinitions.mockImplementation((_cwd: string, _model: unknown, _sandbox: unknown, options: { executionContext?: { runId: string; signal: AbortSignal } }) => {
      factoryContext = options.executionContext;
      return {
        bash: { execute: async () => { abortController.abort(); return "late success"; } },
      };
    });
    const attempts: Array<{ status: string; attemptId: string }> = [];
    streamText.mockImplementation((options: { tools: Record<string, { execute: (input: Record<string, unknown>) => Promise<unknown> }> }) => ({
      textStream: (async function* () { await options.tools.bash.execute({ command: "required-command" }); yield "done"; })(),
      text: Promise.resolve("done"),
      totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    }));

    const result = await executeStories({
      sorted: [{ id: "story", title: "Story", persona: "worker", description: "make a change" }],
      completedStoryIds: [],
      config: {
        providers: {}, default: "ollama", permissions: { allow: [] },
        sandboxCapabilities: {
          extraPathGrants: [{ root: process.cwd(), access: "read_write" }],
          allowedNetworkDomains: ["example.test"], allowLocalBinding: true, allowDockerSocket: true,
        },
      },
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
      onStoryAttempt: (event) => { attempts.push(event); },
    });

    expect(factoryContext).toMatchObject({ signal: abortController.signal });
    expect(factoryContext?.runId).toMatch(/^run-r08-worker-story-0-/);
    expect(factoryContext?.allowedNetworkDomains).toEqual(["example.test"]);
    expect(factoryContext?.allowLocalBinding).toBe(true);
    expect(factoryContext?.allowDockerSocket).toBe(true);
    expect(factoryContext?.scope?.extraGrants).toHaveLength(1);
    expect(result.completedStoryIds).toEqual([]);
    expect(result.earlyExit).toBe(true);
    expect(attempts.map((event) => event.status)).toEqual(["started", "cancelled"]);
    expect(attempts[0].attemptId).toBe(attempts[1].attemptId);
  });

  it("denies before worker hooks or tool mutation and emits one denial event", async () => {
    vi.clearAllMocks();
    const controller = new AbortController();
    const execute = vi.fn(async () => "must not run");
    createToolDefinitions.mockReturnValue({ bash: { execute } });
    streamText.mockImplementation((options: { tools: Record<string, { execute: (input: Record<string, unknown>) => Promise<unknown> }> }) => ({
      textStream: (async function* () { await options.tools.bash.execute({ command: "npm test" }); controller.abort(); yield "done"; })(),
      text: Promise.resolve("done"), totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    }));

    const result = await executeStories({
      sorted: [{ id: "denied", title: "Denied", persona: "worker", description: "do not run" }],
      completedStoryIds: [],
      config: { providers: {}, default: "ollama", permissions: { deny: ["bash"] } },
      output, trustAll: true, sandboxed: true, userTask: "task",
      context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] },
      sessionAllow: new Set(), workingDir: process.cwd(),
      costTracker: { addUsage: vi.fn(), getTotalCost: () => 0, getUsageSummary: () => ({}) } as never,
      featureBranch: null, mainBranch: "main", abortSignal: controller.signal, ticketOps: null,
      waitWhilePaused: async () => false, pauseForBalanceIssue: async () => false, logRetryHint: vi.fn(),
    });

    expect(execute).not.toHaveBeenCalled();
    expect(runPreHooksWithBlocking).not.toHaveBeenCalled();
    expect(runLifecycleHooks).toHaveBeenCalledTimes(1);
    expect(result.completedStoryIds).toEqual([]);
    expect(result.earlyExit).toBe(true);
  });
});
