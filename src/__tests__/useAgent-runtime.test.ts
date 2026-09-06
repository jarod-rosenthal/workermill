import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, type Instance } from "ink";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ensureRunMcp = vi.fn(async () => {});
const closeRunMcp = vi.fn(async () => {});
let runMcpTools: TestTools = {};
const storedSession = vi.hoisted(() => ({ loadLatestSession: vi.fn(), saveSession: vi.fn() }));

vi.mock("../engine/model-factory.js", () => ({
  createModel: vi.fn(() => ({})), buildOllamaOptions: () => ({}),
  ensureOllamaContext: vi.fn(), ensureLmStudioContext: vi.fn(),
}));
vi.mock("../mcp-client.js", () => ({
  autoDetectMCPServersForRun: async () => ({}),
  createMCPRunResources: (options: { signal: AbortSignal }) => ({
    register: vi.fn(), ensureStarted: () => ensureRunMcp(options.signal),
    getToolDefinitions: () => runMcpTools, getTools: () => [], close: () => closeRunMcp(),
  }),
}));
vi.mock("../ui/system-prompt.js", () => ({ buildSystemPrompt: () => "Test coding agent" }));
vi.mock("../config.js", async (original) => ({
  ...await original<typeof import("../config.js")>(),
  resolveConfig: vi.fn(), saveLocalSettings: vi.fn(), loadLocalSettings: vi.fn(() => ({})),
}));
vi.mock("../session.js", async (original) => ({
  ...await original<typeof import("../session.js")>(),
  loadLatestSession: storedSession.loadLatestSession,
  saveSession: storedSession.saveSession,
}));
vi.mock("ai", async (original) => ({ ...await original<typeof import("ai")>(), streamText: vi.fn(), generateText: vi.fn() }));
vi.mock("../hooks.js", async (original) => ({
  ...await original<typeof import("../hooks.js")>(),
  runPreHooksWithBlocking: vi.fn(() => ({ blocked: false })), runHooks: vi.fn(), runLifecycleHooks: vi.fn(),
}));
vi.mock("../engine/process-runner.js", async (original) => {
  const actual = await original<typeof import("../engine/process-runner.js")>();
  return { ...actual, cancelAndWaitForRunProcesses: vi.fn(actual.cancelAndWaitForRunProcesses) };
});
vi.mock("../engine/tools/bash-background.js", async (original) => {
  const actual = await original<typeof import("../engine/tools/bash-background.js")>();
  return { ...actual, cleanupScopedBackgroundProcesses: vi.fn(actual.cleanupScopedBackgroundProcesses) };
});

import { streamText, generateText } from "ai";
import { resolveConfig, saveLocalSettings, type CliConfig } from "../config.js";
import { runHooks, runPreHooksWithBlocking } from "../hooks.js";
import { clearCheckpoints, getChangedFiles } from "../checkpoints.js";
import { useAgent, type UseAgentReturn } from "../ui/useAgent.js";
import { cancelAndWaitForRunProcesses } from "../engine/process-runner.js";
import { cleanupScopedBackgroundProcesses } from "../engine/tools/bash-background.js";

type TestTools = Record<string, { execute: (input: Record<string, unknown>) => Promise<unknown> }>;

describe("mounted chat execution adapter", () => {
  let workspace: string;
  let app: Instance | undefined;
  let agent: UseAgentReturn;
  let turns = 0;
  let configured: CliConfig;
  const streams: PassThrough[] = [];

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), "wm-chat-runtime-"));
    vi.spyOn(process, "cwd").mockReturnValue(workspace);
    configured = { providers: { test: { model: "test-model" } }, default: "test", liveView: false };
    vi.mocked(resolveConfig).mockImplementation(() => configured);
    vi.mocked(runHooks).mockClear();
    vi.mocked(runPreHooksWithBlocking).mockClear();
    vi.mocked(saveLocalSettings).mockClear();
    ensureRunMcp.mockReset();
    ensureRunMcp.mockResolvedValue();
    closeRunMcp.mockReset();
    closeRunMcp.mockResolvedValue();
    runMcpTools = {};
    vi.mocked(cancelAndWaitForRunProcesses).mockClear();
    vi.mocked(cleanupScopedBackgroundProcesses).mockClear();
    storedSession.loadLatestSession.mockReset();
    storedSession.saveSession.mockReset();
    turns = 0;
    clearCheckpoints();
  });

  afterEach(async () => {
    agent?.cancel();
    app?.unmount();
    app = undefined;
    for (const stream of streams.splice(0)) stream.destroy();
    vi.restoreAllMocks();
    vi.mocked(streamText).mockReset();
    vi.mocked(generateText).mockReset();
    clearCheckpoints();
    await rm(workspace, { recursive: true, force: true });
  });

  async function mount(overrides: Partial<Parameters<typeof useAgent>[0]> = {}) {
    let rendered = false;
    function Harness() {
      agent = useAgent({ provider: "test", model: "test-model", trustAll: false, planMode: false, sandboxed: true, resume: false, fork: false, liveView: false, ...overrides });
      rendered = true;
      return null;
    }
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    stdout.resume(); stderr.resume();
    streams.push(stdout, stderr, stdin);
    app = render(createElement(Harness), {
      stdout: stdout as NodeJS.WriteStream, stderr: stderr as NodeJS.WriteStream,
      stdin: stdin as NodeJS.ReadStream, exitOnCtrlC: false, patchConsole: false,
    });
    await vi.waitFor(() => expect(rendered).toBe(true));
  }

  function script(invoke: (tools: TestTools) => Promise<void>) {
    vi.mocked(streamText).mockImplementation((options) => {
      // SDK gap: deterministic transport drives the dynamically typed production tool map.
      const tools = options.tools as unknown as TestTools;
      return {
        textStream: (async function* () { await invoke(tools); turns++; yield "done"; })(),
        text: Promise.resolve("done"), totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      } as never;
    });
  }

  it("denies actual writes without checkpointing or running hooks", async () => {
    configured.permissions = { deny: ["write_file"] };
    script(async (tools) => { await tools.write_file.execute({ path: "denied.txt", content: "bad" }); });
    await mount();
    agent.submit("write sentinel");
    await vi.waitFor(() => expect(turns).toBe(1));
    expect(await stat(path.join(workspace, "denied.txt")).then(() => true, () => false)).toBe(false);
    expect(getChangedFiles()).toEqual([]);
    expect(runHooks).not.toHaveBeenCalled();
    expect(runPreHooksWithBlocking).not.toHaveBeenCalled();
  });

  it("sends the persisted session conversation in the first resumed turn", async () => {
    const restored = {
      id: "restored-session",
      provider: "previous-provider",
      model: "previous-model",
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      totalTokens: 7,
      totalCostUsd: 0.125,
      messages: [
        { role: "user" as const, content: "keep this request", timestamp: "2026-01-01T00:00:00.000Z" },
        { role: "assistant" as const, content: "keep this answer", timestamp: "2026-01-01T00:00:01.000Z" },
      ],
    };
    storedSession.loadLatestSession.mockReturnValue(restored);

    await mount({ resume: true });

    await vi.waitFor(() => expect(agent.messages.map(message => message.content)).toEqual([
      "keep this request", "keep this answer",
    ]));
    expect(agent.session).toBe(restored);
    await vi.waitFor(() => expect(agent.cost).toBe(0.125));
    script(async () => {});
    agent.submit("continue from the saved answer");
    await vi.waitFor(() => expect(turns).toBe(1));
    const call = vi.mocked(streamText).mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> };
    expect(call.messages).toEqual(expect.arrayContaining([
      { role: "user", content: "keep this request" },
      { role: "assistant", content: "keep this answer" },
      { role: "user", content: "continue from the saved answer" },
    ]));
    expect(agent.session.totalTokens).toBe(9);
    expect(agent.session.totalCostUsd).toBe(0.125);
  });

  it("changes visible messages and rolls back the production session exchange", async () => {
    await mount();
    agent.addSystemMessage("system context");
    agent.addUserMessage("discard this request");
    agent.session.messages.push(
      { role: "user", content: "discard this request", timestamp: new Date().toISOString() },
      { role: "assistant", content: "discard this answer", timestamp: new Date().toISOString() },
    );
    await vi.waitFor(() => expect(agent.messages.map(message => message.content)).toEqual([
      "system context", "discard this request",
    ]));

    expect(agent.rollback()).toEqual({ rolledBack: true, restoredInput: "discard this request" });
    await vi.waitFor(() => expect(agent.messages.map(message => message.content)).toEqual(["system context"]));
    expect(agent.session.messages).toEqual([]);
  });

  it("cycles the mounted hook through each permission mode", async () => {
    await mount();
    expect(agent.permissionMode).toBe("default");
    agent.cyclePermissionMode();
    await vi.waitFor(() => expect(agent.permissionMode).toBe("acceptEdits"));
    agent.cyclePermissionMode();
    await vi.waitFor(() => expect(agent.permissionMode).toBe("plan"));
    agent.cyclePermissionMode();
    await vi.waitFor(() => expect(agent.permissionMode).toBe("bypassPermissions"));
    expect(agent.isBypassMode()).toBe(true);
  });

  it("persists a cumulative external ledger once when orchestration replays it", async () => {
    await mount();
    const ledger = { calls: [{ callId: "review-1", persona: "critic", provider: "test", model: "test-model", usage: { inputTokens: 3, outputTokens: 2 }, usageState: "reported" as const, pricingState: "unknown" as const }], totals: { callCount: 1, reportedUsageCalls: 1, partialUsageCalls: 0, missingUsageCalls: 0, knownPricingCalls: 0, unknownPricingCalls: 1, localApiCalls: 0, inputTokens: 3, outputTokens: 2, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedApiCost: 0 } };
    agent.applyExternalUsageLedger(ledger);
    agent.applyExternalUsageLedger(ledger);
    expect(agent.session).toMatchObject({ totalTokens: 5, totalCostUsd: 0, usageLedger: { totals: { callCount: 1 } } });
    expect(agent.session.costByRole?.reviewer).toMatchObject({ inputTokens: 3, outputTokens: 2 });
    expect(storedSession.saveSession).toHaveBeenCalledTimes(1);
  });

  it("owns manual compaction until cancellation settles and preserves history", async () => {
    await mount();
    const original = Array.from({ length: 6 }, (_, index) => ({ role: "user" as const, content: `message ${index}`, timestamp: new Date().toISOString() }));
    agent.session.messages = original;
    let release!: () => void;
    vi.mocked(generateText).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { text: "late summary" } as Awaited<ReturnType<typeof generateText>>;
    });
    const compacting = agent.forceCompact();
    const rejected = expect(compacting).rejects.toThrow();
    await vi.waitFor(() => expect(generateText).toHaveBeenCalledOnce());
    agent.cancel();
    agent.submit("must not overlap compaction");
    expect(streamText).not.toHaveBeenCalled();
    release();
    await rejected;
    await vi.waitFor(() => expect(agent.status).toBe("idle"));
    expect(agent.session.messages).toBe(original);
  });

  it("persists manual compaction usage without replacing its history early", async () => {
    await mount();
    agent.session.messages = Array.from({ length: 6 }, (_, index) => ({
      role: "user" as const, content: `message ${index}`, timestamp: new Date().toISOString(),
    }));
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "summary", usage: { inputTokens: 7, outputTokens: 3 },
    } as Awaited<ReturnType<typeof generateText>>);
    await agent.forceCompact();
    expect(agent.session.usageLedger).toMatchObject({
      totals: { callCount: 1, reportedUsageCalls: 1, inputTokens: 7, outputTokens: 3 },
      calls: [expect.objectContaining({ persona: "compaction", provider: "test", model: "test-model" })],
    });
    expect(storedSession.saveSession).toHaveBeenCalledWith(agent.session);
  });

  it("wraps each turn once and writes through its current context", async () => {
    configured.permissions = { allow: ["write_file"] };
    script(async (tools) => { await tools.write_file.execute({ path: "allowed.txt", content: String(turns) }); });
    await mount();
    agent.submit("first write");
    await vi.waitFor(() => expect(agent.status).toBe("idle"));
    await vi.waitFor(() => expect(turns).toBe(1));
    agent.submit("second write");
    await vi.waitFor(() => expect(turns).toBe(2));
    expect(await readFile(path.join(workspace, "allowed.txt"), "utf8")).toBe("1");
    expect(runPreHooksWithBlocking).toHaveBeenCalledTimes(2);
    expect(runHooks).toHaveBeenCalledTimes(2);
  });

  it("cancels the visible prompt and ignores stale always approval", async () => {
    script(async (tools) => { await tools.write_file.execute({ path: "cancelled.txt", content: "bad" }); });
    await mount();
    agent.submit("ask to write");
    await vi.waitFor(() => expect(agent.permissionRequest).not.toBeNull());
    const prompt = agent.permissionRequest!;
    agent.cancel();
    prompt.resolve(true, "always");
    await vi.waitFor(() => expect(agent.permissionRequest).toBeNull());
    expect(saveLocalSettings).not.toHaveBeenCalled();
    expect(getChangedFiles()).toEqual([]);
    expect(await stat(path.join(workspace, "cancelled.txt")).then(() => true, () => false)).toBe(false);
  });

  it("claims busy state before MCP startup and cancels it before model construction", async () => {
    ensureRunMcp.mockImplementationOnce((signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    }));
    await mount();
    agent.submit("cancel startup");
    await vi.waitFor(() => expect(agent.status).toBe("thinking"));
    await vi.waitFor(() => expect(ensureRunMcp).toHaveBeenCalledOnce());
    agent.cancel();
    await vi.waitFor(() => expect(agent.status).toBe("idle"));
    expect(streamText).not.toHaveBeenCalled();
    expect(closeRunMcp).toHaveBeenCalledOnce();
  });

  it("cancels a started chat bash process and clears live tool state after it drains", async () => {
    configured.permissions = { allow: ["bash"] };
    const started = path.join(workspace, "started.txt");
    const escaped = path.join(workspace, "escaped.txt");
    const program = `require('fs').writeFileSync(${JSON.stringify(started)}, 'ready'); setTimeout(() => require('fs').writeFileSync(${JSON.stringify(escaped)}, 'escaped'), 5000)`;
    script(async (tools) => { await tools.bash.execute({ command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(program)}` }); });
    await mount();
    agent.submit("run cancellable command");
    await vi.waitFor(() => expect(stat(started).then(() => true, () => false)).resolves.toBe(true));
    agent.cancel();
    await vi.waitFor(() => expect(agent.status).toBe("idle"));
    expect(agent.streamingToolCalls).toEqual([]);
    expect(await stat(escaped).then(() => true, () => false)).toBe(false);
  });

  it.each(["provider failed after dispatch", "429 retry after 30"])("drains a dispatched tool without overlapping a retry: %s", async (failure) => {
    configured.permissions = { allow: ["slow_tool"] };
    let started!: () => void;
    let release!: () => void;
    const startedTool = new Promise<void>((resolve) => { started = resolve; });
    const pendingTool = new Promise<string>((resolve) => { release = () => resolve("done"); });
    runMcpTools = { slow_tool: { execute: async () => { started(); return pendingTool; } } };
    vi.mocked(streamText).mockImplementation((options) => {
      const tools = options.tools as unknown as TestTools;
      return {
        textStream: (async function* () {
          void tools.slow_tool.execute({}).catch(() => {});
          await startedTool;
          throw new Error(failure);
        })(),
        text: Promise.resolve(""), totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      } as never;
    });
    await mount();
    agent.submit("provider failure");
    await startedTool;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(agent.status).not.toBe("idle");
    release();
    await vi.waitFor(() => expect(agent.status).toBe("idle"));
    expect(agent.messages.at(-1)?.content).toContain(failure);
    expect(streamText).toHaveBeenCalledOnce();
  });

  it("does not save a late successful result when an aborted stream ends normally", async () => {
    let started!: () => void;
    const streamStarted = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(streamText).mockImplementation((options) => ({
      textStream: (async function* () {
        started();
        await new Promise<void>((resolve) => options.abortSignal!.addEventListener("abort", () => resolve(), { once: true }));
        yield "late successful result";
      })(),
      text: Promise.resolve("late successful result"), totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    }) as never);
    await mount();
    agent.submit("abort buffered stream");
    await streamStarted;
    agent.cancel();
    await vi.waitFor(() => expect(agent.status).toBe("idle"));
    expect(agent.messages.some((message) => message.content.includes("late successful result"))).toBe(false);
    expect(agent.session.messages.some((message) => message.content.includes("late successful result"))).toBe(false);
  });

  it("unmount aborts its active stream and removes its session exit listener", async () => {
    const listenerCount = process.listenerCount("exit");
    let started!: () => void;
    const streamStarted = new Promise<void>((resolve) => { started = resolve; });
    vi.mocked(streamText).mockImplementation((options) => ({
      textStream: (async function* () {
        started();
        await new Promise<void>((resolve) => options.abortSignal!.addEventListener("abort", () => resolve(), { once: true }));
        yield "";
      })(),
      text: Promise.resolve("late result"), totalUsage: Promise.resolve({}),
    }) as never);
    await mount();
    agent.submit("unmount active turn");
    await streamStarted;
    app!.unmount();
    app = undefined;
    await vi.waitFor(() => expect(closeRunMcp).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(process.listenerCount("exit")).toBe(listenerCount));
  });

  it("cancels a retry delay without starting another model call", async () => {
    vi.mocked(streamText).mockImplementation(() => ({
      textStream: (async function* () { throw new Error("429 retry after 30"); })(),
      text: Promise.resolve(""), totalUsage: Promise.resolve({}),
    }) as never);
    await mount();
    agent.submit("retry then cancel");
    await vi.waitFor(() => expect(agent.statusDetail).toContain("Rate limited"));
    agent.cancel();
    await vi.waitFor(() => expect(agent.status).toBe("idle"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(streamText).toHaveBeenCalledOnce();
  });

  it("attempts other owned cleanup when MCP close fails", async () => {
    closeRunMcp.mockRejectedValueOnce(new Error("MCP close failed"));
    script(async () => {});
    await mount();
    agent.submit("cleanup failure");
    await vi.waitFor(() => expect(streamText).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(agent.status).toBe("idle"));
    expect(closeRunMcp).toHaveBeenCalledOnce();
    expect(cancelAndWaitForRunProcesses).toHaveBeenCalledOnce();
    expect(cleanupScopedBackgroundProcesses).toHaveBeenCalledOnce();
    expect(agent.messages.at(-1)?.content).toContain("cleanup failed");
  });

  it("persists one reported call with the active turn model", async () => {
    script(async () => {});
    await mount();
    agent.submit("record usage", undefined, { modelOverride: { provider: "test", model: "turn-model" } });
    await vi.waitFor(() => expect(streamText).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(agent.status).toBe("idle"));
    expect(agent.session.usageLedger).toMatchObject({
      totals: { callCount: 1, reportedUsageCalls: 1, inputTokens: 1, outputTokens: 1 },
      calls: [expect.objectContaining({ provider: "test", model: "turn-model", usageState: "reported" })],
    });
    expect(agent.session.totalTokens).toBe(2);
  });

  it("retains completed-step usage as partial when a stream fails", async () => {
    vi.mocked(streamText).mockImplementation((options) => {
      const callback = (options as unknown as { onStepFinish?: (event: { usage: unknown }) => void }).onStepFinish;
      callback?.({ usage: { inputTokens: 11, outputTokens: 4 } });
      return {
        textStream: (async function* () { throw new Error("transport failed"); })(),
        text: Promise.resolve(""), totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
      } as never;
    });
    await mount();
    agent.submit("fail after step");
    await vi.waitFor(() => expect(streamText).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(agent.status).toBe("idle"));
    expect(agent.session.usageLedger).toMatchObject({
      totals: { callCount: 1, partialUsageCalls: 1, inputTokens: 11, outputTokens: 4 },
    });
  });

  it("adds child usage once alongside its parent turn", async () => {
    configured.permissions = { allow: ["sub_agent"] };
    vi.mocked(streamText)
      .mockImplementationOnce((options) => {
        const tools = (options as unknown as { tools: TestTools }).tools;
        return {
          textStream: (async function* () { await tools.sub_agent.execute({ prompt: "inspect", maxTurns: 1, isolated: false }); yield "done"; })(),
          text: Promise.resolve("done"), totalUsage: Promise.resolve({ inputTokens: 5, outputTokens: 2 }),
        } as never;
      })
      .mockImplementationOnce(() => ({
        textStream: (async function* () { yield "child"; })(), text: Promise.resolve("child"),
        totalUsage: Promise.resolve({ inputTokens: 3, outputTokens: 1 }), finishReason: Promise.resolve("stop"),
      }) as never);
    await mount();
    agent.submit("delegate");
    await vi.waitFor(() => expect(streamText).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(agent.status).toBe("idle"));
    expect(agent.session.usageLedger).toMatchObject({
      totals: { callCount: 2, inputTokens: 8, outputTokens: 3 },
    });
    expect(agent.session.usageLedger?.calls.map((call) => call.persona)).toEqual(expect.arrayContaining(["agent", "child"]));
  });

  it("queues simultaneous prompts instead of losing an unresolved request", async () => {
    script(async (tools) => {
      await Promise.all([
        tools.write_file.execute({ path: "first.txt", content: "first" }),
        tools.write_file.execute({ path: "second.txt", content: "second" }),
      ]);
    });
    await mount();
    agent.submit("write both files");
    await vi.waitFor(() => expect(agent.permissionRequest?.toolInput.path).toBe("first.txt"));
    agent.permissionRequest!.resolve(true);
    await vi.waitFor(() => expect(agent.permissionRequest?.toolInput.path).toBe("second.txt"));
    agent.permissionRequest!.resolve(true);
    await vi.waitFor(() => expect(turns).toBe(1));
    expect(await readFile(path.join(workspace, "first.txt"), "utf8")).toBe("first");
    expect(await readFile(path.join(workspace, "second.txt"), "utf8")).toBe("second");
    expect(runHooks).toHaveBeenCalledTimes(2);
  });
});
