import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ action: "empty" as "empty" | "escape" | "commit" | "dirty_failure", streamText: vi.fn() }));
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), streamText: sdk.streamText }));

import { createToolDefinitions } from "../engine/tools/index.js";
import { createSubAgentExecutor, createWorktree, type ChildTool } from "../engine/tools/sub-agent.js";
import type { ToolExecutionContext } from "../engine/tool-executor.js";

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
  }));
}

afterEach(() => {
  sdk.streamText.mockReset();
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("isolated sub-agents", () => {
  it("uses UUID worktree and branch identities for concurrent children", () => {
    const workingDir = repo();
    const [one, two] = [createWorktree(workingDir, "same task"), createWorktree(workingDir, "same task")];
    expect(one.worktreePath).not.toBe(two.worktreePath);
    expect(one.branchName).not.toBe(two.branchName);
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
});
