import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { stopAllMCPServers } from "../mcp-client.js";
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
  const workspace = process.cwd();

  beforeEach(() => {
    mcpWrite.mockClear();
    vi.mocked(stopAllMCPServers).mockClear();
  });

  afterEach(() => {
    vi.mocked(streamText).mockReset();
  });

  it("denies a built-in write before its sentinel can be changed", async () => {
    const sentinel = "headless-denied-sentinel";
    vi.mocked(streamText).mockImplementation(successfulStream(async (tools) => {
      try { await tools.write_file.execute({ path: sentinel, content: "changed" }); } catch { /* stream transports may swallow tool failures */ }
    }) as never);

    const result = await runCommand({ prompt: "write", singlePrompt: true }, config({ deny: ["write_file"] }), workspace);

    expect(result.reason).toBe("denied");
    expect(await import("node:fs/promises").then((fs) => fs.stat(sentinel).then(() => true, () => false))).toBe(false);
  });

  it("returns permission_required for ask rules without waiting for stdin", async () => {
    vi.mocked(streamText).mockImplementation(successfulStream(async (tools) => {
      try { await tools.write_file.execute({ path: "headless-ask-sentinel", content: "changed" }); } catch { /* expected */ }
    }) as never);

    const result = await runCommand({ prompt: "write", singlePrompt: true }, config({ ask: ["write_file"] }), workspace);

    expect(result.reason).toBe("permission_required");
    expect(result.exitCode).toBe(3);
  });

  it("allows configured writes but does not let full disk grant permission", async () => {
    const allowed = "headless-allowed-sentinel";
    vi.mocked(streamText).mockImplementation(successfulStream(async (tools) => {
      await tools.write_file.execute({ path: allowed, content: "allowed" });
    }) as never);
    const allowedResult = await runCommand({ prompt: "write", singlePrompt: true, sandboxed: false }, config({ allow: ["write_file"] }), workspace);
    expect(allowedResult.status).toBe("ok");
    expect(await import("node:fs/promises").then((fs) => fs.readFile(allowed, "utf8"))).toBe("allowed");
    await import("node:fs/promises").then((fs) => fs.rm(allowed));

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
});
