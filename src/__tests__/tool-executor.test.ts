import { describe, expect, it, vi } from "vitest";
import { createPathScope } from "../engine/path-policy.js";
import { executeToolCall, ToolExecutionError, type ToolExecutionContext } from "../engine/tool-executor.js";
import type { PermissionState } from "../engine/tool-policy.js";

const makeContext = (overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext => {
  const state: PermissionState = { mode: "bypassPermissions", trustAll: true, sessionAllow: new Set(), rules: {}, readOnlyRole: false };
  return {
    runId: Math.random().toString(36),
    workspace: process.cwd(),
    scope: createPathScope(process.cwd()),
    effectiveSandbox: "path",
    signal: new AbortController().signal,
    getPermissionState: () => state,
    ...overrides,
  };
};

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try { await promise; return "none"; } catch (error) {
    return error instanceof ToolExecutionError ? error.code : "unknown";
  }
}

describe("executeToolCall", () => {
  it("does not invoke callbacks or the tool when denied", async () => {
    const calls: string[] = [];
    const context = makeContext({ getPermissionState: () => ({ mode: "default", trustAll: false, sessionAllow: new Set(), rules: { deny: ["write_file"] }, readOnlyRole: false }) });
    expect(await errorCode(executeToolCall("write_file", {}, () => calls.push("tool"), {
      ...context,
      preHook: () => { calls.push("pre"); },
      checkpoint: () => { calls.push("checkpoint"); },
      postHook: () => { calls.push("post"); },
      event: () => { calls.push("event"); },
    }))).toBe("denied");
    expect(calls).toEqual([]);
  });

  it("blocks at the pre-hook before checkpoint or tool", async () => {
    const calls: string[] = [];
    const context = makeContext({
      preHook: () => false,
      checkpoint: () => { calls.push("checkpoint"); },
    });
    expect(await errorCode(executeToolCall("write_file", {}, () => calls.push("tool"), context))).toBe("hook_blocked");
    expect(calls).toEqual([]);
  });

  it("returns permission_required in headless ask mode", async () => {
    const context = makeContext({ getPermissionState: () => ({ mode: "default", trustAll: false, sessionAllow: new Set(), rules: {}, readOnlyRole: false }) });
    expect(await errorCode(executeToolCall("write_file", {}, () => "bad", context))).toBe("permission_required");
  });

  it("keeps contexts' prompts and cancellation isolated", async () => {
    const first = makeContext({ getPermissionState: () => ({ mode: "default", trustAll: false, sessionAllow: new Set(), rules: {}, readOnlyRole: false }), prompt: async () => false });
    const second = makeContext({ getPermissionState: () => ({ mode: "default", trustAll: false, sessionAllow: new Set(), rules: {}, readOnlyRole: false }), prompt: async () => true });
    const [a, b] = await Promise.all([
      errorCode(executeToolCall("write_file", {}, () => "first", first)),
      executeToolCall("write_file", {}, () => "second", second),
    ]);
    expect(a).toBe("denied");
    expect(b).toBe("second");
  });

  it("cancels a queued mutation and releases the queue after errors", async () => {
    const firstDone = vi.fn();
    let unblock!: () => void;
    const first = makeContext();
    const firstPromise = executeToolCall("write_file", {}, () => new Promise<string>((resolve) => { unblock = () => { firstDone(); resolve("first"); }; }), first);
    const controller = new AbortController();
    const queued = executeToolCall("write_file", {}, () => "queued", makeContext({ signal: controller.signal }));
    controller.abort();
    expect(await errorCode(queued)).toBe("cancelled");
    unblock();
    await firstPromise;
    expect(firstDone).toHaveBeenCalledOnce();
    await expect(executeToolCall("write_file", {}, () => "after", makeContext())).resolves.toBe("after");
  });

  it("cancels a pending prompt without invoking tool lifecycle callbacks", async () => {
    const controller = new AbortController();
    let resolvePrompt!: (value: boolean) => void;
    const prompt = vi.fn(() => new Promise<boolean>((resolve) => { resolvePrompt = resolve; }));
    const promise = executeToolCall("write_file", {}, () => "ok", makeContext({
      signal: controller.signal,
      prompt,
      getPermissionState: () => ({ mode: "default", trustAll: false, sessionAllow: new Set(), rules: {}, readOnlyRole: false }),
    }));
    await Promise.resolve();
    controller.abort();
    expect(await errorCode(promise)).toBe("cancelled");
    resolvePrompt(true);
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("runs post hook and event exactly once, including when post hook fails", async () => {
    const postHook = vi.fn(() => { throw new Error("post"); });
    const event = vi.fn();
    await expect(executeToolCall("write_file", {}, () => "ok", makeContext({ postHook, event }))).rejects.toThrow("post");
    expect(postHook).toHaveBeenCalledOnce();
    expect(event).toHaveBeenCalledOnce();
  });

  it("releases the mutation mutex when post hooks fail", async () => {
    await expect(executeToolCall("write_file", {}, () => "ok", makeContext({ postHook: () => { throw new Error("post"); } }))).rejects.toThrow("post");
    await expect(executeToolCall("write_file", {}, () => "next", makeContext())).resolves.toBe("next");
  });
});
