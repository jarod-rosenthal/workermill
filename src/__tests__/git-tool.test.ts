import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execute } from "../engine/tools/git.js";
import { createScopedCommandRunner } from "../engine/tools/bash.js";
import { createPathScope } from "../engine/path-policy.js";
import { getOSSandboxDependencyStatus } from "../sandbox-mode.js";

describe("git tool process boundary", () => {
  let root: string;
  let workspace: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "wm-git-boundary-"));
    workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace);
    const git = (args: string[]) => execFileSync("git", args, { cwd: workspace, stdio: "pipe" });
    git(["init"]);
    git(["config", "user.email", "fixture@example.test"]);
    git(["config", "user.name", "Fixture"]);
    fs.writeFileSync(path.join(workspace, "file.txt"), "before\n");
    git(["add", "file.txt"]);
    git(["-c", "core.hooksPath=/dev/null", "commit", "-m", "initial"]);
    fs.writeFileSync(path.join(workspace, "file.txt"), "after\n");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("keeps shell syntax inert inside a commit message", async () => {
    await expect(execute({ action: "add", cwd: workspace })).resolves.toMatchObject({ success: true });
    const message = "literal 'quote' $(touch escaped) `touch escaped-too`";
    await expect(execute({ action: "commit", args: message, cwd: workspace })).resolves.toMatchObject({ success: true });
    const actual = execFileSync("git", ["log", "-1", "--format=%s"], { cwd: workspace, encoding: "utf8" }).trim();
    expect(actual).toBe(message);
    expect(fs.existsSync(path.join(workspace, "escaped"))).toBe(false);
    expect(fs.existsSync(path.join(workspace, "escaped-too"))).toBe(false);
  });

  it("passes identity and cancellation to its bound runner and fails on cancellation", async () => {
    const controller = new AbortController();
    const runner = vi.fn(async () => ({ reason: "cancelled" as const, exitCode: null, stdout: "partial", stderr: "", outputTruncated: true }));
    const result = await execute({ action: "status", cwd: workspace, runId: "git-run", signal: controller.signal, runProcess: runner });
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({ runId: "git-run", signal: controller.signal, cwd: workspace }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("cancelled");
    expect(result.output).toContain("output truncated");
  });

  it("contains Git output-file writes in OS mode", async (context) => {
    const status = getOSSandboxDependencyStatus();
    if (!status.supported || status.errors.length) {
      const reason = status.errors.join(", ") || "unsupported platform";
      if (process.env.WM_REQUIRE_OS_SANDBOX === "1") throw new Error(reason);
      context.skip(`OS sandbox unavailable: ${reason}`);
      return;
    }
    const runner = createScopedCommandRunner({ sandbox: "os", scope: createPathScope(workspace) });
    const allowed = await execute({ action: "diff", args: "--output=allowed.diff", cwd: workspace, runProcess: runner });
    if (!allowed.success && /operation not permitted|unshare|unsupported/i.test(allowed.error ?? "")) {
      if (process.env.WM_REQUIRE_OS_SANDBOX === "1") throw new Error(allowed.error);
      context.skip(`OS sandbox kernel unavailable: ${allowed.error}`);
      return;
    }
    expect(allowed.success).toBe(true);
    expect(fs.readFileSync(path.join(workspace, "allowed.diff"), "utf8")).toContain("+after");
    const sentinel = path.join(root, "outside.diff");
    const denied = await execute({ action: "diff", args: `--output=${sentinel}`, cwd: workspace, runProcess: runner });
    expect(denied.success).toBe(false);
    expect(fs.existsSync(sentinel)).toBe(false);
  });
});
