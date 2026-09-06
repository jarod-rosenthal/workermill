import { describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/sandbox-runtime", () => ({
  SandboxManager: {
    isSupportedPlatform: vi.fn(() => true),
    checkDependencies: vi.fn(() => ({ errors: [], warnings: [] })),
  },
}));

import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { createPathScope } from "../engine/path-policy.js";
import { createScopedProcessRunner } from "../engine/scoped-process.js";
import type { ProcessRequest, ProcessResult } from "../engine/process-runner.js";

const result: ProcessResult = { reason: "exited", exitCode: 0, stdout: "ok", stderr: "", outputTruncated: false };
const request = (signal = new AbortController().signal): ProcessRequest => ({
  runId: "test", command: "printf ok", cwd: process.cwd(), signal,
  timeoutMs: 1000, maxOutputBytes: 1024, terminationGraceMs: 10,
});

function fakeDependencies(run = vi.fn(async () => result), platform: NodeJS.Platform = "darwin") {
  const manager = {
    initialize: vi.fn(async () => undefined),
    wrapWithSandbox: vi.fn(async (command: string) => `wrapped:${command}`),
    cleanupAfterCommand: vi.fn(),
    reset: vi.fn(async () => undefined),
  };
  return { runProcess: run, sandboxManager: manager, platform };
}

describe("scoped process boundary", () => {
  it("delegates non-OS modes without a sandbox lease", async () => {
    const dependencies = fakeDependencies();
    const runner = createScopedProcessRunner(dependencies);
    const processRequest = request();
    await expect(runner(processRequest, { sandbox: true, scope: createPathScope(process.cwd()) })).resolves.toEqual(result);
    expect(dependencies.runProcess).toHaveBeenCalledWith(processRequest);
    expect(dependencies.sandboxManager.initialize).not.toHaveBeenCalled();
  });

  it("executes zero raw commands when OS dependencies are unavailable", async () => {
    vi.mocked(SandboxManager.checkDependencies).mockReturnValueOnce({ errors: ["bubblewrap missing"], warnings: [] });
    const dependencies = fakeDependencies();
    const runner = createScopedProcessRunner(dependencies);
    const outcome = await runner(request(), { sandbox: "os", scope: createPathScope(process.cwd()) });
    expect(outcome.reason).toBe("spawn_failed");
    expect(outcome.stderr).toContain("bubblewrap missing");
    expect(dependencies.runProcess).not.toHaveBeenCalled();
  });

  it.each(["initialize", "wrapWithSandbox"])("does not execute raw commands when %s fails", async (method) => {
    const dependencies = fakeDependencies();
    if (method === "initialize") dependencies.sandboxManager.initialize.mockRejectedValueOnce(new Error("runtime init failed"));
    else dependencies.sandboxManager.wrapWithSandbox.mockRejectedValueOnce(new Error("runtime wrap failed"));
    const runner = createScopedProcessRunner(dependencies);
    const outcome = await runner(request(), { sandbox: "os", scope: createPathScope(process.cwd()) });
    expect(outcome.reason).toBe("spawn_failed");
    expect(outcome.stderr).toContain("command was not executed");
    expect(dependencies.runProcess).not.toHaveBeenCalled();
    expect(dependencies.sandboxManager.reset).toHaveBeenCalledTimes(1);
  });

  it("serializes OS manager lifetime across different roots and resets after each child", async () => {
    let finishFirst!: () => void;
    const firstChild = new Promise<ProcessResult>((resolve) => { finishFirst = () => resolve(result); });
    const run = vi.fn()
      .mockImplementationOnce(async () => firstChild)
      .mockResolvedValueOnce(result);
    const dependencies = fakeDependencies(run);
    const runner = createScopedProcessRunner(dependencies);
    const first = runner(request(), { sandbox: "os", scope: createPathScope(process.cwd()) });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const second = runner(request(), { sandbox: "os", scope: createPathScope("/tmp") });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(dependencies.sandboxManager.initialize).toHaveBeenCalledTimes(1);
    finishFirst();
    await Promise.all([first, second]);
    expect(dependencies.sandboxManager.initialize).toHaveBeenCalledTimes(2);
    expect(dependencies.sandboxManager.reset).toHaveBeenCalledTimes(2);
  });

  it("cancels while queued without running or resetting another command", async () => {
    let finishFirst!: () => void;
    const firstChild = new Promise<ProcessResult>((resolve) => { finishFirst = () => resolve(result); });
    const run = vi.fn().mockImplementationOnce(async () => firstChild);
    const dependencies = fakeDependencies(run);
    const runner = createScopedProcessRunner(dependencies);
    const first = runner(request(), { sandbox: "os", scope: createPathScope(process.cwd()) });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const controller = new AbortController();
    const queued = runner(request(controller.signal), { sandbox: "os", scope: createPathScope("/tmp") });
    controller.abort();
    await expect(queued).resolves.toMatchObject({ reason: "cancelled" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(dependencies.sandboxManager.reset).not.toHaveBeenCalled();
    finishFirst();
    await first;
    expect(dependencies.sandboxManager.reset).toHaveBeenCalledTimes(1);
  });

  it("uses a private temp grant and keeps Docker and blanket temp writes off by default", async () => {
    const dependencies = fakeDependencies();
    const runner = createScopedProcessRunner(dependencies);
    await runner(request(), { sandbox: "os", scope: createPathScope(process.cwd()) });
    const config = dependencies.sandboxManager.initialize.mock.calls[0][0];
    expect(config.filesystem.allowWrite).not.toContain("/tmp");
    expect(config.network.allowUnixSockets).toBeUndefined();
    expect(config.network.allowLocalBinding).toBe(false);
    expect(config.filesystem.allowWrite.some((entry: string) => entry.includes("workermill-sandbox-"))).toBe(true);
  });

  it("rejects Docker path exceptions where the runtime cannot constrain them", async () => {
    const dependencies = fakeDependencies(vi.fn(async () => result), "linux");
    const runner = createScopedProcessRunner(dependencies);
    const outcome = await runner(request(), {
      sandbox: "os", scope: createPathScope(process.cwd()), capabilities: { allowDockerSocket: true },
    });
    expect(outcome.reason).toBe("spawn_failed");
    expect(dependencies.runProcess).not.toHaveBeenCalled();
  });
});
