import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, type Instance } from "ink";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("../engine/model-factory.js", () => ({
  createModel: vi.fn(() => ({})), buildOllamaOptions: () => ({}),
  ensureOllamaContext: vi.fn(), ensureLmStudioContext: vi.fn(),
}));
vi.mock("../mcp-client.js", () => ({
  getMCPToolDefinitions: () => ({}), stopAllMCPServers: vi.fn(),
  autoDetectMCPServers: () => ({}), registerMCPServers: vi.fn(),
  hasMCPRegistered: () => false, ensureMCPStarted: vi.fn(async () => {}),
}));
vi.mock("../ui/system-prompt.js", () => ({ buildSystemPrompt: () => "Test coding agent" }));
vi.mock("../config.js", async (original) => ({
  ...await original<typeof import("../config.js")>(),
  resolveConfig: vi.fn(), saveLocalSettings: vi.fn(), loadLocalSettings: vi.fn(() => ({})),
}));
vi.mock("ai", async (original) => ({ ...await original<typeof import("ai")>(), streamText: vi.fn() }));
vi.mock("../hooks.js", async (original) => ({
  ...await original<typeof import("../hooks.js")>(),
  runPreHooksWithBlocking: vi.fn(() => ({ blocked: false })), runHooks: vi.fn(), runLifecycleHooks: vi.fn(),
}));

import { streamText } from "ai";
import { resolveConfig, saveLocalSettings, type CliConfig } from "../config.js";
import { runHooks, runPreHooksWithBlocking } from "../hooks.js";
import { clearCheckpoints, getChangedFiles } from "../checkpoints.js";
import { useAgent, type UseAgentReturn } from "../ui/useAgent.js";

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
    clearCheckpoints();
    await rm(workspace, { recursive: true, force: true });
  });

  async function mount() {
    let rendered = false;
    function Harness() {
      agent = useAgent({ provider: "test", model: "test-model", trustAll: false, planMode: false, sandboxed: true, resume: false, fork: false, liveView: false });
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
