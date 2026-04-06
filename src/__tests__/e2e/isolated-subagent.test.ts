import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { cleanupStaleWorktrees } from "../../engine/tools/sub-agent.js";

describe("isolated sub-agent worktree", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      // Clean up worktrees before removing dir
      try {
        execSync("git worktree prune", { cwd: tempDir, stdio: "pipe" });
      } catch { /* ignore */ }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createTempGitRepo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-worktree-"));
    execSync("git init", { cwd: dir, stdio: "pipe" });
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
    execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
    fs.writeFileSync(path.join(dir, "index.ts"), "export const hello = 'world';\n");
    execSync("git add -A && git commit -m 'initial'", { cwd: dir, stdio: "pipe" });
    return dir;
  }

  it("creates a worktree in .workermill/worktrees/", () => {
    tempDir = createTempGitRepo();

    // Manually create a worktree to test the pattern
    const worktreeBase = path.join(tempDir, ".workermill", "worktrees");
    fs.mkdirSync(worktreeBase, { recursive: true });
    const worktreePath = path.join(worktreeBase, "test-task");

    execSync(`git worktree add -b "worktree-test-task" "${worktreePath}" HEAD`, {
      cwd: tempDir,
      stdio: "pipe",
    });

    // Verify worktree exists and has the file
    expect(fs.existsSync(path.join(worktreePath, "index.ts"))).toBe(true);
    const content = fs.readFileSync(path.join(worktreePath, "index.ts"), "utf-8");
    expect(content).toContain("hello");

    // Verify it's on a separate branch
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: worktreePath,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    expect(branch).toBe("worktree-test-task");
  });

  it("worktree changes don't affect parent", () => {
    tempDir = createTempGitRepo();

    const worktreeBase = path.join(tempDir, ".workermill", "worktrees");
    fs.mkdirSync(worktreeBase, { recursive: true });
    const worktreePath = path.join(worktreeBase, "isolated-edit");

    execSync(`git worktree add -b "worktree-isolated-edit" "${worktreePath}" HEAD`, {
      cwd: tempDir,
      stdio: "pipe",
    });

    // Edit a file in the worktree
    fs.writeFileSync(path.join(worktreePath, "index.ts"), "export const hello = 'changed';\n");

    // Parent should be untouched
    const parentContent = fs.readFileSync(path.join(tempDir, "index.ts"), "utf-8");
    expect(parentContent).toContain("'world'");

    // Worktree should have the change
    const wtContent = fs.readFileSync(path.join(worktreePath, "index.ts"), "utf-8");
    expect(wtContent).toContain("'changed'");
  });

  it("worktree remove cleans up the directory", () => {
    tempDir = createTempGitRepo();

    const worktreeBase = path.join(tempDir, ".workermill", "worktrees");
    fs.mkdirSync(worktreeBase, { recursive: true });
    const worktreePath = path.join(worktreeBase, "cleanup-test");

    execSync(`git worktree add -b "worktree-cleanup-test" "${worktreePath}" HEAD`, {
      cwd: tempDir,
      stdio: "pipe",
    });

    expect(fs.existsSync(worktreePath)).toBe(true);

    execSync(`git worktree remove "${worktreePath}"`, { cwd: tempDir, stdio: "pipe" });

    expect(fs.existsSync(worktreePath)).toBe(false);
  });

  it("cleanupStaleWorktrees prunes without error", () => {
    tempDir = createTempGitRepo();

    // Should not throw even with no worktrees
    expect(() => cleanupStaleWorktrees(tempDir)).not.toThrow();
  });

  it("cleanupStaleWorktrees works on non-git directory", () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-no-git-"));
    expect(() => cleanupStaleWorktrees(nonGitDir)).not.toThrow();
    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });
});
