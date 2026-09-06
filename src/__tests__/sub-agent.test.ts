import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ action: "empty" as "empty" | "escape" | "commit" | "dirty_failure", streamText: vi.fn() }));
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), streamText: sdk.streamText }));

import { createToolDefinitions } from "../engine/tools/index.js";
import { createSubAgentExecutor, createWorktree, type ChildTool } from "../engine/tools/sub-agent.js";
import type { ToolExecutionContext } from "../engine/tool-executor.js";
import { getOSSandboxDependencyStatus } from "../sandbox-mode.js";

const dirs: string[] = [];
function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-sub-agent-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: dir });
  return dir;
}
function context(workspace: string, mode = "bypassPermissions"): ToolExecutionContext {
  const signal = new AbortController().signal;
  return {
    runId: "parent-run", workspace, scope: { workspace, extraGrants: [] }, effectiveSandbox: "path", signal,
    getPermissionState: () => ({ mode: mode as "bypassPermissions" | "plan", trustAll: true, sessionAllow: new Set(), rules: {}, readOnlyRole: false, workspace }),
  };
}
function stream(): void {
  sdk.streamText.mockImplementation((options: { tools: Record<string, ChildTool> }) => ({
    textStream: (async function* () {
      const write = options.tools.write_file?.execute;
      if (sdk.action === "escape" && write) await write({ path: "../parent-sentinel", content: "owned" });
      if (sdk.action === "commit") {
        const cwd = (options.tools.write_file as { cwd?: string } | undefined)?.cwd;
        // The custom factory below performs the commit, not the mocked model.
        if (write) await write({ path: "child.txt", content: "child" });
      }
      if (sdk.action === "dirty_failure" && write) {
        await write({ path: "dirty.txt", content: "dirty" });
        throw new Error("model failure");
      }
      yield "done";
    })(),
    text: Promise.resolve("done"), totalUsage: Promise.resolve({ inputTokens: 3, outputTokens: 5 }),
    finishReason: Promise.resolve("stop"),
  }));
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  return { promise: new Promise<T>((yes, no) => { resolve = yes; reject = no; }), resolve, reject };
}

async function waitForFile(file: string): Promise<void> {
  if (fs.existsSync(file)) return;
  const watcher = fs.watch(path.dirname(file));
  try {
    while (!fs.existsSync(file)) await once(watcher, "change");
  } finally {
    watcher.close();
  }
}

afterEach(() => {
  sdk.streamText.mockReset();
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("isolated sub-agents", () => {
  it("uses UUID worktree and branch identities for concurrent children", async () => {
    const workingDir = repo();
    const [one, two] = await Promise.all([createWorktree(workingDir, "same task"), createWorktree(workingDir, "same task")]);
    expect(one.worktreePath).not.toBe(two.worktreePath);
    expect(one.branchName).not.toBe(two.branchName);
  });

  it("cancels a started worktree-add administration command without creating the child", async () => {
    const workingDir = repo();
    const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-git-wrapper-"));
    dirs.push(wrapperDir);
    const ready = path.join(wrapperDir, "started");
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const wrapper = path.join(wrapperDir, "git");
    fs.writeFileSync(wrapper, [
      "#!/bin/sh",
      "for arg in \"$@\"; do",
      `  if [ \"$arg\" = worktree ]; then touch \"${ready}\"; while :; do sleep 1; done; fi`,
      "done",
      `exec \"${realGit}\" \"$@\"`,
      "",
    ].join("\n"));
    fs.chmodSync(wrapper, 0o755);
    const oldPath = process.env.PATH;
    process.env.PATH = `${wrapperDir}:${oldPath ?? ""}`;
    const controller = new AbortController();
    try {
      const creating = createWorktree(workingDir, "cancel admin", controller.signal, "child-admin-cancel");
      await waitForFile(ready);
      controller.abort(new Error("cancel child admin"));
      await expect(creating).rejects.toThrow(/cancel|worktree add/i);
      expect(fs.readdirSync(path.join(workingDir, ".workermill", "worktrees"), { recursive: true })).toEqual([]);
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("preserves worktree and reports failure when parent cancels a started inspection", async () => {
    const workingDir = repo();
    const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-git-inspection-"));
    dirs.push(wrapperDir);
    const ready = path.join(wrapperDir, "inspection-started");
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    fs.writeFileSync(path.join(wrapperDir, "git"), [
      "#!/bin/sh", "for arg in \"$@\"; do",
      `  if [ \"$arg\" = status ]; then touch \"${ready}\"; while :; do sleep 1; done; fi`,
      "done", `exec \"${realGit}\" \"$@\"`, "",
    ].join("\n"));
    fs.chmodSync(path.join(wrapperDir, "git"), 0o755);
    const oldPath = process.env.PATH;
    process.env.PATH = `${wrapperDir}:${oldPath ?? ""}`;
    const parentAbort = new AbortController();
    try {
      sdk.action = "empty";
      stream();
      const executor = createSubAgentExecutor({} as never, workingDir, {}, {
        executionContext: { ...context(workingDir), signal: parentAbort.signal }, createTools: () => ({}),
      });
      const running = executor({ prompt: "cancel inspection", isolated: true });
      await waitForFile(ready);
      parentAbort.abort(new Error("cancel inspection"));
      const result = await running;
      expect(result.success).toBe(false);
      expect(result.error).toContain("inspection");
      const child = result.error?.match(/worktree `([^`]+)`/)?.[1];
      expect(child && fs.existsSync(child)).toBe(true);
    } finally { process.env.PATH = oldPath; }
  });

  it("drains a late captured model-tool rejection after normal stream completion", async () => {
    const workingDir = repo();
    const rawStarted = deferred<void>();
    const streamFinished = deferred<void>();
    const toolFailure = deferred<string>();
    sdk.streamText.mockImplementation((options: { tools: Record<string, ChildTool> }) => ({
      textStream: (async function* () { void options.tools.read_file.execute?.({ path: "base.txt" })?.catch(() => {}); yield "done"; streamFinished.resolve(); })(),
      text: Promise.resolve("done"), totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }), finishReason: Promise.resolve("stop"),
    }));
    const rawRead = () => { rawStarted.resolve(); return toolFailure.promise; };
    const executor = createSubAgentExecutor({} as never, workingDir, { read_file: { execute: rawRead } }, {
      executionContext: context(workingDir), createTools: () => ({ read_file: { execute: rawRead } }),
    });
    const running = executor({ prompt: "read", isolated: false });
    await rawStarted.promise;
    await streamFinished.promise;
    toolFailure.reject(new Error("late tool failure"));
    const result = await running;
    expect(result.success).toBe(false);
    expect(result.error).toContain("late tool failure");
  });

  it("keeps a successful in-flight read tool alive until it settles, then closes its model signal", async () => {
    const workingDir = repo();
    const rawStarted = deferred<void>();
    const streamFinished = deferred<void>();
    const release = deferred<string>();
    let childSignal: AbortSignal | undefined;
    let capturedTool: ((input: Record<string, unknown>) => Promise<unknown>) | undefined;
    let rawCalls = 0;
    sdk.streamText.mockImplementation((options: { tools: Record<string, ChildTool> }) => ({
      textStream: (async function* () {
        capturedTool = options.tools.read_file.execute;
        void capturedTool?.({ path: "base.txt" }).catch(() => {});
        yield "done";
        streamFinished.resolve();
      })(),
      text: Promise.resolve("done"), totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }), finishReason: Promise.resolve("stop"),
    }));
    const rawRead = () => { rawCalls++; rawStarted.resolve(); return release.promise; };
    const executor = createSubAgentExecutor({} as never, workingDir, { read_file: { execute: rawRead } }, {
      executionContext: context(workingDir),
      createTools: (_dir, _scope, childContext) => {
        childSignal = childContext.signal;
        return { read_file: { execute: rawRead } };
      },
    });
    const running = executor({ prompt: "read", isolated: false });
    let settled = false;
    void running.finally(() => { settled = true; });
    await rawStarted.promise;
    await streamFinished.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(childSignal?.aborted).toBe(false);
    release.resolve("contents");
    const result = await running;
    expect(result.success).toBe(true);
    expect(childSignal?.aborted).toBe(true);
    await expect(capturedTool?.({ path: "base.txt" })).rejects.toThrow(/cancel/i);
    expect(rawCalls).toBe(1);
  });

  it("rejects a child explicit-file escape and preserves the failed worktree", async () => {
    const workingDir = repo();
    const sentinel = path.join(workingDir, "parent-sentinel");
    fs.writeFileSync(sentinel, "safe");
    sdk.action = "escape";
    stream();
    const parent = context(workingDir);
    const executor = createSubAgentExecutor({} as never, workingDir, {}, {
      executionContext: parent,
      createTools: (dir, scope, childContext) => {
        const all = createToolDefinitions(dir, undefined, true, { scope, executionContext: childContext }) as Record<string, ChildTool>;
        return { write_file: all.write_file! };
      },
    });
    const result = await executor({ prompt: "escape", isolated: true });
    expect(result.success).toBe(false);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("safe");
    expect(result.error).toContain("Branch `workermill/");
  });

  it("preserves committed-only work and reports its identity", async () => {
    const workingDir = repo();
    sdk.action = "commit";
    stream();
    const parent = context(workingDir);
    const executor = createSubAgentExecutor({} as never, workingDir, {}, {
      executionContext: parent,
      createTools: (dir) => ({
        write_file: { execute: ({ path: file, content }) => {
          fs.writeFileSync(path.join(dir, String(file)), String(content));
          execFileSync("git", ["add", "child.txt"], { cwd: dir });
          execFileSync("git", ["commit", "-qm", "child"], { cwd: dir });
          return "written";
        } },
      }),
    });
    const result = await executor({ prompt: "commit", isolated: true });
    expect(result.success).toBe(true);
    expect(result.content).toContain("child.txt | 1 +");
    const worktree = result.content.match(/worktree `([^`]+)`/)?.[1];
    expect(worktree && fs.existsSync(worktree)).toBe(true);
    expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: worktree!, encoding: "utf8" }).trim()).toBe("child");
  });

  it("cleans only a confirmed empty successful worktree", async () => {
    const workingDir = repo();
    sdk.action = "empty";
    stream();
    const executor = createSubAgentExecutor({} as never, workingDir, {}, { executionContext: context(workingDir), createTools: () => ({}) });
    const result = await executor({ prompt: "empty", isolated: true });
    expect(result.success).toBe(true);
    expect(result.content).toContain("Confirmed empty and removed.");
  });

  it("preserves a dirty worktree when the child fails", async () => {
    const workingDir = repo();
    sdk.action = "dirty_failure";
    stream();
    const executor = createSubAgentExecutor({} as never, workingDir, {}, {
      executionContext: context(workingDir),
      createTools: (dir) => ({ write_file: { execute: ({ path: file, content }) => fs.writeFileSync(path.join(dir, String(file)), String(content)) } }),
    });
    const result = await executor({ prompt: "dirty", isolated: true });
    expect(result.success).toBe(false);
    const worktree = result.error?.match(/worktree `([^`]+)`/)?.[1];
    expect(worktree && fs.readFileSync(path.join(worktree, "dirty.txt"), "utf8")).toBe("dirty");
  });

  it("rejects plan-mode isolated work before a worktree is created", async () => {
    const workingDir = repo();
    const executor = createSubAgentExecutor({} as never, workingDir, {}, { executionContext: context(workingDir, "plan"), createTools: () => ({}) });
    const result = await executor({ prompt: "blocked", isolated: true });
    expect(result.error).toContain("read-only");
    expect(fs.existsSync(path.join(workingDir, ".workermill", "worktrees"))).toBe(false);
  });

  it("contains Git clean filters invoked while inspecting an OS child", async (test) => {
    const status = getOSSandboxDependencyStatus();
    if (!status.supported || status.errors.length) {
      const reason = status.errors.join(", ") || "unsupported platform";
      if (process.env.WM_REQUIRE_OS_SANDBOX === "1") throw new Error(reason);
      test.skip(reason);
      return;
    }
    const workingDir = repo();
    const parent = { ...context(workingDir), effectiveSandbox: "os" as const };
    const definitions = createToolDefinitions(workingDir, {} as never, "os", { executionContext: parent }) as Record<string, ChildTool>;
    sdk.action = "empty";
    stream();
    const probe = String(await definitions.sub_agent.execute!({ prompt: "OS probe", isolated: true }));
    if (/operation not permitted|unshare|sandbox unavailable/i.test(probe) && process.env.WM_REQUIRE_OS_SANDBOX !== "1") {
      test.skip(probe);
      return;
    }
    expect(probe).toContain("Confirmed empty and removed");

    const sentinel = path.join(workingDir, "filter-parent-sentinel");
    execFileSync("git", ["config", "filter.inspect.clean", `printf ran > filter-ran; printf escaped > ${JSON.stringify(sentinel)}; cat`], { cwd: workingDir });
    sdk.streamText.mockImplementation((options: { tools: Record<string, ChildTool> }) => ({
      textStream: (async function* () {
        await options.tools.write_file.execute!({ path: ".gitattributes", content: "base.txt filter=inspect\n" });
        await options.tools.write_file.execute!({ path: "base.txt", content: "changed\n" });
        yield "done";
      })(),
      text: Promise.resolve("done"), totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }), finishReason: Promise.resolve("stop"),
    }));
    const result = String(await definitions.sub_agent.execute!({ prompt: "change filtered file", isolated: true }));
    const child = result.match(/worktree `([^`]+)`/)?.[1];
    expect(child).toBeDefined();
    // Positive evidence that the filter actually ran, not merely that an
    // unavailable sandbox or earlier tool failure prevented its execution.
    expect(fs.readFileSync(path.join(child!, "filter-ran"), "utf8")).toBe("ran");
    expect(fs.existsSync(sentinel)).toBe(false);
  }, 15_000);
});
