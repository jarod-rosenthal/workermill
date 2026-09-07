import { describe, expect, it, vi } from "vitest";
import { createPathScope } from "../engine/path-policy.js";
import { executeToolCall, type ToolExecutionContext } from "../engine/tool-executor.js";
import { decideToolPermission, type PermissionState } from "../engine/tool-policy.js";
import { durablePermissionRules } from "../ui/agent/utils.js";

function state(overrides: Partial<PermissionState> = {}): PermissionState {
  return {
    mode: "default",
    trustAll: false,
    sessionAllow: new Set(),
    rules: {},
    readOnlyRole: false,
    workspace: process.cwd(),
    ...overrides,
  };
}

function context(permission: PermissionState, overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  const scope = createPathScope(process.cwd());
  return {
    runId: "interactive-test",
    workspace: scope.workspace,
    scope,
    effectiveSandbox: "path",
    signal: new AbortController().signal,
    getPermissionState: () => permission,
    ...overrides,
  };
}

describe("interactive permission adapter", () => {
  it("uses the production decision table for deny, ask, and allow", () => {
    expect(decideToolPermission("write_file", { path: "x.ts" }, state({ rules: { deny: ["write_file"] }, trustAll: true }))).toMatchObject({ kind: "deny" });
    expect(decideToolPermission("write_file", { path: "x.ts" }, state())).toMatchObject({ kind: "ask" });
    expect(decideToolPermission("write_file", { path: "x.ts" }, state({ rules: { allow: ["write_file"] } }))).toMatchObject({ kind: "allow" });
  });

  it("cannot promote writes or sub-agents in plan mode", () => {
    const plan = state({ mode: "plan", trustAll: true, sessionAllow: new Set(["*"]) });
    expect(decideToolPermission("write_file", { path: "x.ts" }, plan)).toMatchObject({ kind: "deny" });
    expect(decideToolPermission("sub_agent", {}, plan)).toMatchObject({ kind: "deny" });
  });

  it("settles an interactive prompt on cancellation without checkpointing", async () => {
    const controller = new AbortController();
    const checkpoint = vi.fn();
    const execute = vi.fn();
    let settlePrompt!: (allowed: boolean) => void;
    const call = executeToolCall("write_file", { path: "x.ts" }, execute, context(state(), {
      signal: controller.signal,
      checkpoint,
      prompt: () => new Promise<boolean>((resolve) => { settlePrompt = resolve; }),
    }));
    await Promise.resolve();
    controller.abort();
    await expect(call).rejects.toMatchObject({ code: "cancelled" });
    settlePrompt(true);
    expect(checkpoint).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps a command-family always choice narrow", () => {
    const narrow = state({ rules: { allow: durablePermissionRules("bash", { command: "npm run build" }) } });
    expect(decideToolPermission("bash", { command: "npm run test" }, narrow)).toMatchObject({ kind: "allow" });
    expect(decideToolPermission("bash", { command: "git status" }, narrow)).toMatchObject({ kind: "ask" });
  });

  it.each(["verify", "bash_background"])("keeps %s approval scoped to its command family", (toolName) => {
    const narrow = state({ rules: { allow: durablePermissionRules(toolName, { command: "npm run build && npm test" }) } });
    expect(decideToolPermission(toolName, { command: "npm run test" }, narrow)).toMatchObject({ kind: "allow" });
    expect(decideToolPermission(toolName, { command: "git status" }, narrow)).toMatchObject({ kind: "ask" });
    expect(decideToolPermission("bash", { command: "npm run build" }, narrow)).toMatchObject({ kind: "ask" });
  });

  it("executes hooks and the raw tool once through the shared adapter", async () => {
    const calls: string[] = [];
    const result = await executeToolCall("write_file", { path: "x.ts" }, () => {
      calls.push("tool");
      return "ok";
    }, context(state({ rules: { allow: ["write_file"] } }), {
      preHook: () => { calls.push("pre"); },
      checkpoint: () => { calls.push("checkpoint"); },
      postHook: () => { calls.push("post"); },
    }));
    expect(result).toBe("ok");
    expect(calls).toEqual(["pre", "checkpoint", "tool", "post"]);
  });
});
