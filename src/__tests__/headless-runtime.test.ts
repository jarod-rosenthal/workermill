import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mcpWrite = vi.fn(async () => "mcp write");

vi.mock("../engine/model-factory.js", () => ({
  createModel: vi.fn(() => ({})),
  buildOllamaOptions: vi.fn(() => ({})),
}));

vi.mock("../mcp-client.js", () => ({
  autoDetectMCPServers: (config: Record<string, unknown>) => config,
  startAllMCPServers: vi.fn(async () => {}),
  stopAllMCPServers: vi.fn(),
  getMCPToolDefinitions: () => ({
    mcp__test__write: { execute: mcpWrite },
  }),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: vi.fn() };
});

import { streamText } from "ai";
import { startAllMCPServers, stopAllMCPServers } from "../mcp-client.js";
import { createModel } from "../engine/model-factory.js";
import { clearCheckpoints, getChangedFiles } from "../checkpoints.js";
import { runCommand } from "../run-command.js";
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
    vi.mocked(stopAllMCPServers).mockClear();
    vi.mocked(startAllMCPServers).mockReset();
    vi.mocked(startAllMCPServers).mockResolvedValue();
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

    expect(result.reason).toBe("provider_error");
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
    expect(stopAllMCPServers).toHaveBeenCalledOnce();
  });

  it("reports cleanup failures as a typed non-success result", async () => {
    vi.mocked(streamText).mockImplementation(successfulStream(async () => {}) as never);
    vi.mocked(stopAllMCPServers).mockImplementationOnce(() => {
      throw new Error("MCP stop failed");
    });

    const result = await runCommand(
      { prompt: "cleanup", singlePrompt: true },
      { ...config({}), mcp: { test: { command: "unused" } } },
      workspace,
    );

    expect(result.reason).toBe("cleanup_error");
    expect(result.status).toBe("failed");
    expect(result.error).toContain("MCP stop failed");
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

  it("does not start MCP or create a model for an already-aborted run", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runCommand(
      { prompt: "cancel", singlePrompt: true, signal: controller.signal },
      { ...config({}), mcp: { test: { command: "unused" } } },
      workspace,
    );

    expect(result.reason).toBe("cancelled");
    expect(startAllMCPServers).not.toHaveBeenCalled();
    expect(createModel).not.toHaveBeenCalled();
  });

  it("cleans up a partially started MCP runtime and removes SIGINT listeners on setup failure", async () => {
    vi.mocked(startAllMCPServers).mockRejectedValueOnce(new Error("partial MCP startup"));
    const listenersBefore = process.listenerCount("SIGINT");
    const partialStart = await runCommand(
      { prompt: "mcp", singlePrompt: true },
      { ...config({}), mcp: { test: { command: "unused" } } },
      workspace,
    );
    expect(partialStart.reason).toBe("provider_error");
    expect(stopAllMCPServers).toHaveBeenCalledOnce();
    expect(process.listenerCount("SIGINT")).toBe(listenersBefore);

    const invalidScope = await runCommand({ prompt: "scope", singlePrompt: true }, config({}), "\0");
    expect(invalidScope.reason).toBe("provider_error");
    expect(process.listenerCount("SIGINT")).toBe(listenersBefore);
  });
});
