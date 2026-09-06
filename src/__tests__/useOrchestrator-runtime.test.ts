import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, type Instance } from "ink";
import { PassThrough } from "node:stream";

const { runOrchestration, resolveConfig } = vi.hoisted(() => ({
  runOrchestration: vi.fn(),
  resolveConfig: vi.fn(),
}));

vi.mock("../orchestrator.js", () => ({ runOrchestration }));
vi.mock("../config.js", async (original) => ({
  ...(await original<typeof import("../config.js")>()), resolveConfig,
}));
vi.mock("../notify.js", () => ({ notifyIfEnabled: vi.fn() }));

import { useOrchestrator, type UseOrchestratorReturn } from "../ui/useOrchestrator.js";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((done) => { resolve = done; }), resolve };
}
async function flush(): Promise<void> { await new Promise<void>((resolve) => setImmediate(resolve)); }

describe("mounted orchestration lifecycle", () => {
  let app: Instance | undefined;
  let hook: UseOrchestratorReturn;
  const pending: Array<ReturnType<typeof deferred<{ stories: []; completedStoryIds: []; featureBranch: null; userTask: string }>>> = [];

  function Harness(): null {
    hook = useOrchestrator(() => {});
    return null;
  }

  beforeEach(() => {
    resolveConfig.mockReturnValue({ providers: { test: { model: "test" } }, default: "test" });
    runOrchestration.mockImplementation((_config: unknown, task: string) => {
      const next = deferred<{ stories: []; completedStoryIds: []; featureBranch: null; userTask: string }>();
      pending.push(next);
      return next.promise.then(() => ({ stories: [], completedStoryIds: [], featureBranch: null, userTask: task }));
    });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    stdout.resume(); stderr.resume();
    app = render(createElement(Harness), {
      stdout: stdout as NodeJS.WriteStream, stderr: stderr as NodeJS.WriteStream, stdin: stdin as NodeJS.ReadStream,
      exitOnCtrlC: false, patchConsole: false,
    });
  });
  afterEach(() => { app?.unmount(); app = undefined; pending.splice(0); vi.clearAllMocks(); });

  it("claims synchronously so same-tick starts dispatch one orchestration", async () => {
    hook.start("first", true, true);
    hook.start("second", true, true);
    await flush();
    expect(runOrchestration).toHaveBeenCalledTimes(1);
    pending[0].resolve({ stories: [], completedStoryIds: [], featureBranch: null, userTask: "first" });
    await flush();
    hook.start("later", true, true);
    await flush();
    expect(runOrchestration).toHaveBeenCalledTimes(2);
  });

  it("stays busy after cancel until the owned orchestration finalizer resolves", async () => {
    hook.start("cancel", true, true);
    await flush();
    hook.cancel();
    await flush();
    expect(hook.running).toBe(true);
    expect(hook.statusMessage).toMatch(/Cancelling/);
    pending[0].resolve({ stories: [], completedStoryIds: [], featureBranch: null, userTask: "cancel" });
    await flush();
    expect(hook.running).toBe(false);
  });

  it("aborts the owned operation on unmount", async () => {
    hook.start("unmount", true, true);
    await flush();
    const signal = (runOrchestration.mock.calls[0][5] as AbortController).signal;
    app?.unmount();
    expect(signal.aborted).toBe(true);
    pending[0].resolve({ stories: [], completedStoryIds: [], featureBranch: null, userTask: "unmount" });
  });
});
