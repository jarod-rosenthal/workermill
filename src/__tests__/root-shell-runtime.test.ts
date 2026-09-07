import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, type Instance } from "ink";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

let appProps: Record<string, unknown> | undefined;
const addSystemMessage = vi.fn();

vi.mock("../ui/useAgent.js", () => ({
  useAgent: () => ({
    addSystemMessage, addUserMessage: vi.fn(), submit: vi.fn(), session: undefined,
    cost: 0, tokens: 0, permissionMode: "default", isBypassMode: false,
    setPlanMode: vi.fn(), setTrustAll: vi.fn(), allowTool: vi.fn(), denyTool: vi.fn(),
    cancel: vi.fn(), rollback: vi.fn(), cyclePermissionMode: vi.fn(), status: "idle", statusDetail: "",
    messages: [], streamingToolCalls: [], toolCounts: {}, sessionStart: Date.now(), tokPerSec: {},
    setCost: vi.fn(), incrementToolCount: vi.fn(), setLiveViewEnabled: vi.fn(),
    getLiveViewUrl: vi.fn(), forceCompact: vi.fn(),
  }),
}));
vi.mock("../ui/useOrchestrator.js", () => ({
  useOrchestrator: () => ({ running: false, paused: false, cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), start: vi.fn(), startProgram: vi.fn(), retry: vi.fn(), review: vi.fn(), statusMessage: "", previewLine: "", confirmRequest: null, promptRequest: null }),
}));
vi.mock("../ui/App.js", () => ({ App: (props: Record<string, unknown>) => { appProps = props; return null; } }));
vi.mock("../ui/slash-commands.js", () => ({ handleSlashCommand: () => false, getGitBranch: () => "main" }));
vi.mock("../config.js", () => ({ resolveConfig: () => undefined, getProviderForPersona: () => ({ provider: "test", model: "test" }) }));
vi.mock("../provider-registry.js", () => ({ findModelInfo: () => undefined }));

import { Root } from "../ui/Root.js";

describe("mounted direct shell lifecycle", () => {
  let workspace: string;
  let app: Instance | undefined;
  const streams: PassThrough[] = [];

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), "wm-root-shell-"));
    addSystemMessage.mockClear();
    appProps = undefined;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    stdout.resume(); stderr.resume();
    streams.push(stdout, stderr, stdin);
    app = render(createElement(Root, {
      provider: "test", model: "test", workingDir: workspace, trustAll: false,
      planMode: false, sandboxed: true, resume: false, fork: false,
    }), { stdout: stdout as NodeJS.WriteStream, stderr: stderr as NodeJS.WriteStream, stdin: stdin as NodeJS.ReadStream, exitOnCtrlC: false, patchConsole: false });
    await vi.waitFor(() => expect(appProps).toBeDefined());
  });

  afterEach(async () => {
    app?.unmount();
    for (const stream of streams.splice(0)) stream.destroy();
    await rm(workspace, { recursive: true, force: true });
  });

  it("runs, cancels, rejects a second shell, and kills on unmount", async () => {
    const started = path.join(workspace, "started");
    const escaped = path.join(workspace, "escaped");
    const program = "require('fs').writeFileSync('started', 'ready'); setTimeout(() => require('fs').writeFileSync('escaped', 'bad'), 5000)";
    const submit = appProps!.onSubmit as (input: string) => void;
    submit(`!${JSON.stringify(process.execPath)} -e ${JSON.stringify(program)}`);
    await vi.waitFor(() => expect(stat(started).then(() => true, () => false)).resolves.toBe(true));
    submit("!echo should-not-run");
    expect(addSystemMessage).toHaveBeenCalledWith(expect.stringContaining("already running"));
    (appProps!.onCancel as () => void)();
    await vi.waitFor(() => expect(appProps!.status).toBe("idle"));
    expect(await stat(escaped).then(() => true, () => false)).toBe(false);

    const unmountEscape = path.join(workspace, "unmount-escaped");
    const terminated = path.join(workspace, "terminated");
    const unmountStarted = path.join(workspace, "unmount-started");
    const unmountProgram = "process.on('SIGTERM', () => require('fs').writeFileSync('terminated', 'yes')); require('fs').writeFileSync('unmount-started', String(process.pid)); setInterval(() => require('fs').writeFileSync('unmount-escaped', 'bad'), 5000)";
    submit(`!${JSON.stringify(process.execPath)} -e ${JSON.stringify(unmountProgram)}`);
    await vi.waitFor(() => expect(appProps!.status).toBe("tool_running"));
    await vi.waitFor(() => expect(stat(unmountStarted).then(() => true, () => false)).resolves.toBe(true));
    const pid = (await readFile(unmountStarted, "utf8")).trim();
    app?.unmount();
    app = undefined;
    await vi.waitFor(() => expect(stat(terminated).then(() => true, () => false)).resolves.toBe(true));
    await vi.waitFor(() => {
      let state = "";
      try { state = execFileSync("ps", ["-o", "stat=", "-p", pid], { encoding: "utf8", stdio: "pipe" }).trim(); } catch { /* exited */ }
      expect(state === "" || state.startsWith("Z")).toBe(true);
    }, { timeout: 2_000 });
    expect(await stat(unmountEscape).then(() => true, () => false)).toBe(false);
  });
});
