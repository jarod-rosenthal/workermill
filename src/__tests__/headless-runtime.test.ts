import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mcpWrite = vi.fn(async () => "mcp write");
const ensureMcpRun = vi.fn(async () => {});
const closedMcpRuns: string[] = [];
const closeMcpRun = vi.fn(async (runId: string) => { closedMcpRuns.push(runId); });

vi.mock("../engine/model-factory.js", () => ({
  createModel: vi.fn(() => ({})),
  buildOllamaOptions: vi.fn(() => ({})),
}));

vi.mock("../mcp-client.js", () => ({
  autoDetectMCPServersForRun: async (config: Record<string, unknown>) => config,
  stopAllMCPServers: vi.fn(),
  createMCPRunResources: (options: { runId: string }) => ({
    register: vi.fn(),
    ensureStarted: () => ensureMcpRun(),
    getToolDefinitions: () => ({ mcp__test__write: { execute: mcpWrite } }),
    getTools: () => [],
    close: () => closeMcpRun(options.runId),
  }),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: vi.fn() };
});

vi.mock("../engine/tools/bash-background.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../engine/tools/bash-background.js")>();
  return { ...actual, cleanupScopedBackgroundProcesses: vi.fn(actual.cleanupScopedBackgroundProcesses) };
});

import { streamText } from "ai";
import { createModel } from "../engine/model-factory.js";
import { clearCheckpoints, getChangedFiles } from "../checkpoints.js";
import { runCommand } from "../run-command.js";
import { cleanupScopedBackgroundProcesses } from "../engine/tools/bash-background.js";
import type { CliConfig } from "../config.js";

const config = (permissions: CliConfig["permissions"]): CliConfig => ({
  providers: { test: { model: "test-model" } },
  default: "test",
  permissions,
});

function successfulStream(
  invoke: (tools: Record<string, { execute: (input: Record<string, unknown>) => Promise<unknown> }>) => Promise<void>,
  finishReason: "stop" | "tool-calls" = "stop",
) {
  return (options: unknown) => {
    // SDK gap: test drives the dynamically composed runtime tool map.
    const toolOptions = options as { tools: Record<string, { execute: (input: Record<string, unknown>) => Promise<unknown> }> };
    return {
      textStream: (async function* () {
        await invoke(toolOptions.tools);
        yield "";
      })(),
      text: Promise.resolve("done"),
      totalUsage: Promise.resolve({ inputTokens: 3, outputTokens: 2 }),
      finishReason: Promise.resolve(finishReason),
      steps: Promise.resolve([]),
    };
  };
}

describe("headless runtime governance", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), "workermill-headless-runtime-"));
    mcpWrite.mockClear();
    closedMcpRuns.length = 0;
    closeMcpRun.mockReset();
    closeMcpRun.mockImplementation(async (runId: string) => { closedMcpRuns.push(runId); });
    ensureMcpRun.mockReset();
    ensureMcpRun.mockResolvedValue();
    vi.mocked(createModel).mockClear();
    clearCheckpoints();
  });

  afterEach(async () => {
    vi.mocked(streamText).mockReset();
    clearCheckpoints();
    await rm(workspace, { recursive: true, force: true });
  });

  it("denies a built-in write before its sentinel can be changed", async () => {
    const sentinel = "headless-denied-sentinel";
    vi.mocked(streamText).mockImplementation(successfulStream(async (tools) => {
      try { await tools.write_file.execute({ path: sentinel, content: "changed" }); } catch { /* stream transports may swallow tool failures */ }
    }) as never);

    const result = await runCommand({ prompt: "write", singlePrompt: true }, config({ deny: ["write_file"] }), workspace);

    expect(result.reason).toBe("denied");
    expect(getChangedFiles()).toEqual([]);
    expect(await stat(path.join(workspace, sentinel)).then(() => true, () => false)).toBe(false);
  });

  it("returns permission_required for ask rules without waiting for stdin", async () => {
    vi.mocked(streamText).mockImplementation(successfulStream(async (tools) => {
      try { await tools.write_file.execute({ path: "headless-ask-sentinel", content: "changed" }); } catch { /* expected */ }
    }) as never);

    const result = await runCommand({ prompt: "write", singlePrompt: true }, config({ ask: ["write_file"] }), workspace);

    expect(result.reason).toBe("permission_required");
    expect(result.exitCode).toBe(3);
  });

  it("does not checkpoint or write when the authorized pre-hook blocks", async () => {
    vi.mocked(streamText).mockImplementation(successfulStream(async (tools) => {
      try { await tools.write_file.execute({ path: "headless-pre-hook-sentinel", content: "blocked" }); } catch { /* expected */ }
    }) as never);

    const result = await runCommand(
      { prompt: "write", singlePrompt: true },
      { ...config({ allow: ["write_file"] }), hooks: { pre: [{ command: "false", tools: ["write_file"] }] } },
      workspace,
    );

    expect(result.reason).toBe("hook_blocked");
    expect(getChangedFiles()).toEqual([]);
    expect(await stat(path.join(workspace, "headless-pre-hook-sentinel")).then(() => true, () => false)).toBe(false);
  });

  it("allows configured writes but does not let full disk grant permission", async () => {
    const allowed = "headless-allowed-sentinel";
    vi.mocked(streamText).mockImplementation(successfulStream(async (tools) => {
      await tools.write_file.execute({ path: allowed, content: "allowed" });
    }) as never);
    const allowedResult = await runCommand(
      { prompt: "write", singlePrompt: true, sandboxed: false },
      {
        ...config({ allow: ["write_file"] }),
        hooks: {
          pre: [{ command: "printf pre > .headless-hook-order", tools: ["write_file"] }],
          post: [{ command: "printf post >> .headless-hook-order", tools: ["write_file"] }],
        },
      },
      workspace,
    );
    expect(allowedResult.status).toBe("ok");
    expect(await readFile(path.join(workspace, allowed), "utf8")).toBe("allowed");
    expect(await readFile(path.join(workspace, ".headless-hook-order"), "utf8")).toBe("prepost");
    expect(getChangedFiles()).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: path.join(workspace, allowed), tool: "write_file" }),
    ]));

    vi.mocked(streamText).mockImplementation(successfulStream(async (tools) => {
      try { await tools.write_file.execute({ path: "headless-full-disk-sentinel", content: "blocked" }); } catch { /* expected */ }
    }) as never);
    const fullDiskResult = await runCommand({ prompt: "write", singlePrompt: true, sandboxed: false }, config(undefined), workspace);
    expect(fullDiskResult.reason).toBe("permission_required");
  });

  it("checkpoints authorized full-disk writes outside the workspace", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "wm-headless-full-disk-"));
    const sentinel = path.join(outside, "allowed.txt");
    try {
      vi.mocked(streamText).mockImplementation(successfulStream(async (tools) => {
        await tools.write_file.execute({ path: sentinel, content: "explicitly allowed" });
      }) as never);
      const result = await runCommand(
        { prompt: "write", singlePrompt: true, sandboxed: false },
        config({ allow: ["write_file"] }), workspace,
      );
      expect(result.status).toBe("ok");
      expect(await readFile(sentinel, "utf8")).toBe("explicitly allowed");
      expect(getChangedFiles()).toEqual(expect.arrayContaining([expect.objectContaining({ path: sentinel })]));
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("governs unknown MCP tools and reports an exhausted tool-step cap", async () => {
    let mcpCalls = 0;
    mcpWrite.mockImplementation(async () => { mcpCalls++; return "changed"; });
    vi.mocked(streamText).mockImplementation(successfulStream(async (tools) => {
      try { await tools.mcp__test__write.execute({}); } catch { /* expected */ }
    }, "tool-calls") as never);

    const deniedMcp = await runCommand({ prompt: "mcp", singlePrompt: true }, config({ deny: ["mcp__test__write"] }), workspace);
    expect(deniedMcp.reason).toBe("denied");
    expect(mcpCalls).toBe(0);

    vi.mocked(streamText).mockImplementation(successfulStream(async () => {}, "tool-calls") as never);
    const stepLimit = await runCommand({ prompt: "loop", singlePrompt: true }, config({}), workspace);
    expect(stepLimit.reason).toBe("step_limit");
    expect(stepLimit.exitCode).toBe(5);
  });

  it("does not mistake a one-step final answer for an exhausted cap", async () => {
    vi.mocked(streamText).mockImplementation((options) => {
      // SDK gap: exercise the production callback on the dynamic tool stream.
      const onStepFinish = (options as unknown as {
        onStepFinish?: (event: { toolCalls?: unknown[]; usage: unknown }) => void;
      }).onStepFinish;
      onStepFinish?.({ toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } });
      return {
        textStream: (async function* () { yield "done"; })(),
        text: Promise.resolve("done"),
        totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
        finishReason: Promise.resolve("stop"),
        steps: Promise.resolve([]),
      } as never;
    });

    const result = await runCommand({ prompt: "answer", singlePrompt: true, maxSteps: 1 }, config({}), workspace);

    expect(result.status).toBe("ok");
  });

  it("cleans up a started MCP runtime when model setup fails before streaming", async () => {
    vi.mocked(streamText).mockImplementation(() => {
      throw new Error("provider setup failed");
    });

    const result = await runCommand(
      { prompt: "fail", singlePrompt: true },
      { ...config({}), mcp: { test: { command: "unused" } } },
      workspace,
    );

    expect(result.reason).toBe("provider_error");
    expect(closedMcpRuns).toHaveLength(1);
  });

  it("reports cleanup failures as a typed non-success result", async () => {
    vi.mocked(streamText).mockImplementation(successfulStream(async () => {}) as never);
    closeMcpRun.mockRejectedValueOnce(new Error("MCP stop failed"));

    const result = await runCommand(
      { prompt: "cleanup", singlePrompt: true },
      { ...config({}), mcp: { test: { command: "unused" } } },
      workspace,
    );

    expect(result.reason).toBe("cleanup_error");
    expect(result.status).toBe("failed");
    expect(result.error).toContain("MCP stop failed");
  });

  it("still cleans up MCP after background cleanup fails", async () => {
    vi.mocked(streamText).mockImplementation(successfulStream(async () => {}) as never);
    vi.mocked(cleanupScopedBackgroundProcesses).mockRejectedValueOnce(new Error("background stop failed"));
    closeMcpRun.mockRejectedValueOnce(new Error("MCP stop failed too"));

    const result = await runCommand(
      { prompt: "cleanup", singlePrompt: true },
      { ...config({}), mcp: { test: { command: "unused" } } },
      workspace,
    );

    expect(closeMcpRun).toHaveBeenCalledOnce();
    expect(result.reason).toBe("cleanup_error");
    expect(result.error).toContain("background stop failed");
    expect(result.error).toContain("MCP stop failed too");
    expect(result.tokens).toEqual({ input: 3, output: 2 });
  });

  it("preserves known step usage when a provider stream fails", async () => {
    vi.mocked(streamText).mockImplementation((options) => {
      // SDK gap: this test invokes the runtime callback through the dynamic stream options.
      const callback = (options as unknown as {
        onStepFinish?: (event: { text?: string; toolCalls?: unknown[]; usage: unknown }) => void;
      }).onStepFinish;
      callback?.({ toolCalls: [], usage: { inputTokens: 11, outputTokens: 4 } });
      return {
        textStream: (async function* () { throw new Error("stream failed"); })(),
        text: Promise.resolve(""),
        totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
        finishReason: Promise.resolve("error"),
        steps: Promise.resolve([]),
      } as never;
    });

    const result = await runCommand({ prompt: "fail", singlePrompt: true }, config({}), workspace);

    expect(result.reason).toBe("provider_error");
    expect(result.tokens).toEqual({ input: 11, output: 4 });
  });

  it("drains an already-dispatched tool before returning a provider failure", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let finishTool!: () => void;
    const toolPending = new Promise<void>((resolve) => { finishTool = resolve; });
    mcpWrite.mockImplementationOnce(async () => {
      markStarted();
      await toolPending;
      return "finished";
    });
    vi.mocked(streamText).mockImplementation((options) => {
      const tools = (options as unknown as { tools: Record<string, { execute: (input: Record<string, unknown>) => Promise<unknown> }> }).tools;
      return {
        textStream: (async function* () {
          void tools.mcp__test__write.execute({}).catch(() => {});
          await started;
          throw new Error("provider failed after tool dispatch");
        })(),
        text: Promise.resolve(""), totalUsage: Promise.resolve({}), finishReason: Promise.resolve("error"), steps: Promise.resolve([]),
      } as never;
    });

    const running = runCommand({ prompt: "drain", singlePrompt: true }, config({ allow: ["mcp__test__write"] }), workspace);
    let settled = false;
    void running.then(() => { settled = true; });
    await started;
    expect(settled).toBe(false);
    finishTool();
    await expect(running).resolves.toMatchObject({ status: "failed", reason: "provider_error" });
  });

  it("lets a dispatched tool settle before successful stream finalization aborts resources", async () => {
    let markStarted!: () => void;
    let release!: () => void;
    let signal: AbortSignal | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const pending = new Promise<void>((resolve) => { release = resolve; });
    mcpWrite.mockImplementationOnce(async () => { markStarted(); await pending; return "finished"; });
    vi.mocked(streamText).mockImplementation((options) => {
      signal = options.abortSignal;
      const tools = options.tools as unknown as Record<string, { execute: (input: Record<string, unknown>) => Promise<unknown> }>;
      return {
        textStream: (async function* () { void tools.mcp__test__write.execute({}).catch(() => {}); await started; yield "done"; })(),
        text: Promise.resolve("done"), totalUsage: Promise.resolve({}), finishReason: Promise.resolve("stop"), steps: Promise.resolve([]),
      } as never;
    });
    const running = runCommand({ prompt: "finish tool", singlePrompt: true }, config({ allow: ["mcp__test__write"] }), workspace);
    await started;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(signal?.aborted).toBe(false);
    release();
    await expect(running).resolves.toMatchObject({ status: "ok", text: "done" });
  });

  it("returns cancellation when SIGINT interrupts a live model stream", async () => {
    vi.mocked(streamText).mockImplementation(() => ({
      textStream: (async function* () {
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        yield "";
      })(),
      text: Promise.resolve("late"),
      totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      finishReason: Promise.resolve("stop"),
      steps: Promise.resolve([]),
    }) as never);

    const running = runCommand({ prompt: "cancel", singlePrompt: true }, config({}), workspace);
    process.emit("SIGINT", "SIGINT");
    const result = await running;

    expect(result.reason).toBe("cancelled");
    expect(result.exitCode).toBe(130);
  });

  it("closes only the cancelled run's MCP resource while an independent run succeeds", async () => {
    const firstAbort = new AbortController();
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    vi.mocked(streamText).mockImplementation((options) => {
      const request = options as unknown as { messages: Array<{ content: string }>; abortSignal: AbortSignal };
      const first = request.messages.at(-1)?.content === "first";
      return {
        textStream: (async function* () {
          if (!first) { yield ""; return; }
          firstStarted();
          await new Promise<void>((_resolve, reject) => request.abortSignal.addEventListener("abort", () => reject(request.abortSignal.reason), { once: true }));
          yield "";
        })(),
        text: Promise.resolve(first ? "cancelled" : "second"), totalUsage: Promise.resolve({}), finishReason: Promise.resolve("stop"), steps: Promise.resolve([]),
      } as never;
    });
    const first = runCommand({ prompt: "first", singlePrompt: true, signal: firstAbort.signal }, config({}), workspace);
    await started;
    const second = runCommand({ prompt: "second", singlePrompt: true }, config({}), workspace);
    firstAbort.abort(new Error("cancel first only"));
    await expect(second).resolves.toMatchObject({ status: "ok", text: "second" });
    await expect(first).resolves.toMatchObject({ status: "cancelled" });
    expect(new Set(closedMcpRuns).size).toBe(2);
  });

  it("does not start MCP or create a model for an already-aborted run", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runCommand(
      { prompt: "cancel", singlePrompt: true, signal: controller.signal },
      { ...config({}), mcp: { test: { command: "unused" } } },
      workspace,
    );

    expect(result.reason).toBe("cancelled");
    expect(ensureMcpRun).not.toHaveBeenCalled();
    expect(createModel).not.toHaveBeenCalled();
  });

  it("cleans up a partially started MCP runtime and removes SIGINT listeners on setup failure", async () => {
    ensureMcpRun.mockRejectedValueOnce(new Error("partial MCP startup"));
    const listenersBefore = process.listenerCount("SIGINT");
    const partialStart = await runCommand(
      { prompt: "mcp", singlePrompt: true },
      { ...config({}), mcp: { test: { command: "unused" } } },
      workspace,
    );
    expect(partialStart.reason).toBe("provider_error");
    expect(closedMcpRuns).toHaveLength(1);
    expect(process.listenerCount("SIGINT")).toBe(listenersBefore);

    const invalidScope = await runCommand({ prompt: "scope", singlePrompt: true }, config({}), "\0");
    expect(invalidScope.reason).toBe("provider_error");
    expect(process.listenerCount("SIGINT")).toBe(listenersBefore);
  });
});
