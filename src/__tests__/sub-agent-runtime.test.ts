import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ streamText: vi.fn() }));
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), streamText: sdk.streamText }));

import { createPathScope } from "../engine/path-policy.js";
import { createToolDefinitions } from "../engine/tools/index.js";
import { createSubAgentExecutor, type ChildTool } from "../engine/tools/sub-agent.js";
import type { ToolExecutionContext } from "../engine/tool-executor.js";
import { getOSSandboxDependencyStatus } from "../sandbox-mode.js";

const owned: string[] = [];
type Call = { name: string; input: Record<string, unknown> };
type StreamOptions = { tools: Record<string, ChildTool>; onStepFinish?: (step: { toolCalls: unknown[]; usage: { inputTokens: number; outputTokens: number }; text: string }) => void; abortSignal: AbortSignal };

function makeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wm-sub-agent-runtime-"));
  owned.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "runtime@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Runtime Test"], { cwd: root });
  fs.writeFileSync(path.join(root, "base.txt"), "base\n");
  execFileSync("git", ["add", "base.txt"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
  return root;
}

function parentContext(workspace: string, controller = new AbortController(), overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  const scope = createPathScope(workspace);
  return {
    runId: `parent-${Math.random()}`,
    workspace: scope.workspace,
    scope,
    effectiveSandbox: "path",
    signal: controller.signal,
    getPermissionState: () => ({ mode: "bypassPermissions", trustAll: true, sessionAllow: new Set(), rules: {}, readOnlyRole: false, workspace: scope.workspace }),
    ...overrides,
  };
}

/** Mock the SDK transport only; calls go through actual registered SDK tool definitions. */
function installStream(calls: readonly Call[], text = "done", before?: (options: StreamOptions) => void): void {
  sdk.streamText.mockImplementation((options: StreamOptions) => ({
    textStream: (async function* () {
      before?.(options);
      for (const call of calls) {
        options.onStepFinish?.({ toolCalls: [{ toolName: call.name }], usage: { inputTokens: 1, outputTokens: 1 }, text: "" });
        await options.tools[call.name]?.execute?.(call.input);
      }
      yield text;
    })(),
    text: Promise.resolve(text),
    totalUsage: Promise.resolve({ inputTokens: 2, outputTokens: 3 }),
    finishReason: Promise.resolve("stop"),
  }));
}

function executor(workspace: string, context: ToolExecutionContext) {
  return createSubAgentExecutor({} as never, workspace, {}, {
    executionContext: context,
    createTools: (childWorkspace, scope, childContext) => {
      const definitions = createToolDefinitions(childWorkspace, undefined, childContext.effectiveSandbox === "os" ? "os" : true, {
        scope,
        executionContext: childContext,
      }) as Record<string, ChildTool>;
      return Object.fromEntries(["bash", "write_file", "git", "read_file"].map((name) => [name, definitions[name]!])) as Record<string, ChildTool>;
    },
  });
}

function worktreeFrom(result: { content: string; error?: string }): string {
  const value = `${result.content}\n${result.error ?? ""}`.match(/worktree `([^`]+)`/)?.[1];
  if (!value) throw new Error("child worktree identity was not reported");
  return value;
}

afterEach(() => {
  sdk.streamText.mockReset();
  while (owned.length) fs.rmSync(owned.pop()!, { recursive: true, force: true });
});

describe("sub-agent runtime boundaries", () => {
  it("uses registered OS tools to commit child-only work and denies parent output paths", async (test) => {
    const status = getOSSandboxDependencyStatus();
    if (!status.supported || status.errors.length) {
      const reason = status.errors.join(", ") || "unsupported platform";
      if (process.env.WM_REQUIRE_OS_SANDBOX === "1") throw new Error(`OS sandbox is required but unavailable: ${reason}`);
      test.skip(`OS sandbox unavailable: ${reason}`);
      return;
    }
    const workspace = makeRepo();
    const parent = parentContext(workspace, new AbortController(), { effectiveSandbox: "os" });
    const run = executor(workspace, parent);
    // A successful probe establishes that this host/kernel can execute the real OS boundary.
    installStream([{ name: "bash", input: { command: "printf os-probe" } }]);
    const probe = await run({ prompt: "probe", isolated: true });
    if (!probe.success) {
      const reason = probe.error ?? "unknown OS sandbox failure";
      if (/operation not permitted|unshare|sandbox unavailable|unsupported/i.test(reason) && process.env.WM_REQUIRE_OS_SANDBOX !== "1") {
        test.skip(`OS sandbox kernel unavailable: ${reason}`);
        return;
      }
      throw new Error(reason);
    }

    const sentinel = path.join(workspace, "parent-output.diff");
    installStream([
      { name: "write_file", input: { path: "child.txt", content: "child\n" } },
      { name: "git", input: { action: "add", args: "child.txt" } },
      { name: "git", input: { action: "commit", args: "child commit" } },
      { name: "bash", input: { command: `printf blocked > ${sentinel}` } },
      { name: "git", input: { action: "diff", args: `--output=${sentinel}` } },
    ]);
    const result = await run({ prompt: "commit through registered tools", isolated: true });
    expect(result.success).toBe(true);
    const child = worktreeFrom(result);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: child, encoding: "utf8" })).toBe("");
    expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: child, encoding: "utf8" }).trim()).toBe("child commit");
    expect(fs.readFileSync(path.join(child, "child.txt"), "utf8")).toBe("child\n");
    expect(fs.existsSync(sentinel)).toBe(false);
  }, 20_000);

  it("denies absolute-parent and symlink escapes through child registered tools", async () => {
    const workspace = makeRepo();
    const sentinel = path.join(workspace, "parent-sentinel");
    const link = path.join(workspace, "escape-link");
    fs.writeFileSync(sentinel, "safe\n");
    fs.symlinkSync(sentinel, link);
    installStream([
      { name: "write_file", input: { path: sentinel, content: "absolute escape" } },
      { name: "write_file", input: { path: "escape-link", content: "symlink escape" } },
    ]);
    const result = await executor(workspace, parentContext(workspace))({ prompt: "attempt escape", isolated: true });
    expect(result.success).toBe(false);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("safe\n");
  });

  it("cancels a real child process quickly without cancelling an independent child", async () => {
    const workspace = makeRepo();
    const firstController = new AbortController();
    let began!: () => void;
    const beganProcess = new Promise<void>((resolve) => { began = resolve; });
    installStream([{ name: "bash", input: { command: "sleep 30", timeout: 30_000 } }], "", () => began());
    const first = executor(workspace, parentContext(workspace, firstController))({ prompt: "long process", isolated: true });
    await beganProcess;
    const started = Date.now();
    firstController.abort();
    const cancelled = await first;
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(cancelled.success).toBe(false);

    installStream([], "independent complete");
    const second = await executor(workspace, parentContext(workspace))({ prompt: "independent", isolated: true });
    expect(second.success).toBe(true);
    expect(second.content).toContain("independent complete");
  }, 8_000);

  it("passes the actual child scope to inherited hooks, checkpoints, and events", async () => {
    const workspace = makeRepo();
    const seen: ToolExecutionContext[] = [];
    const parent = parentContext(workspace, new AbortController(), {
      preHook: (_name, _input, child) => { seen.push(child); },
      checkpoint: (_name, _input, child) => { seen.push(child); },
      event: (_event, child) => { seen.push(child); },
    });
    installStream([{ name: "write_file", input: { path: "hooked.txt", content: "ok" } }]);
    const result = await executor(workspace, parent)({ prompt: "hooks", isolated: true });
    expect(result.success).toBe(true);
    const child = worktreeFrom(result);
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.every((item) => item.workspace === child && item.scope.workspace === child)).toBe(true);
    expect(seen.every((item) => item.workspace !== workspace)).toBe(true);
  });

  it("does not turn swallowed denied calls or exhausted active loops into success", async () => {
    const workspace = makeRepo();
    const denied = parentContext(workspace, new AbortController(), {
      getPermissionState: () => ({ mode: "bypassPermissions", trustAll: true, sessionAllow: new Set(), rules: { deny: ["write_file"] }, readOnlyRole: false, workspace }),
    });
    installStream([{ name: "write_file", input: { path: "denied.txt", content: "no" } }], "model swallowed a denial");
    await expect(executor(workspace, denied)({ prompt: "deny", isolated: true })).resolves.toMatchObject({ success: false });

    installStream([{ name: "read_file", input: { path: "base.txt" } }], "");
    await expect(executor(workspace, parentContext(workspace))({ prompt: "active loop", isolated: true, maxTurns: 1 })).resolves.toMatchObject({ success: false });

    installStream([], "ordinary final answer");
    await expect(executor(workspace, parentContext(workspace))({ prompt: "ordinary", isolated: true })).resolves.toMatchObject({ success: true, content: expect.stringContaining("ordinary final answer") });
  });

  it("registry-created sub_agent cancels its child command before returning a model failure", async () => {
    const workspace = makeRepo();
    const sentinel = path.join(workspace, "late-parent-sentinel");
    const parent = parentContext(workspace);
    sdk.streamText.mockImplementation((options: StreamOptions) => ({
      textStream: (async function* () {
        // Deliberately do not await: cleanup must find the real registered bash
        // process by its child run identity before the model failure is returned.
        void Promise.resolve(options.tools.bash?.execute?.({ command: `sleep 1; printf late > ${sentinel}`, timeout: 5_000 })).catch(() => {});
        throw new Error("model transport failed");
      })(),
      // The consumed textStream is the transport failure; keep the SDK's
      // secondary text promise observed so the fixture creates no leak.
      text: Promise.resolve(""),
      totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      finishReason: Promise.resolve("error"),
    }));
    const definitions = createToolDefinitions(workspace, {} as never, true, { executionContext: parent }) as Record<string, ChildTool>;
    const started = Date.now();
    const output = await definitions.sub_agent!.execute!({ prompt: "launch then fail", isolated: true, maxTurns: 2 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(String(output)).toContain("Error: Sub-agent failed");
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(fs.existsSync(sentinel)).toBe(false);
  }, 5_000);
});
