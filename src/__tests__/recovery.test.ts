import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync, execSync } from "child_process";
import { createTempWorkerMillHome, type TempHome } from "./helpers/temp-workermill-home.js";

vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

function createTempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-recovery-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git branch -M main", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  fs.writeFileSync(path.join(dir, "README.md"), "# Test\n");
  execSync("git add README.md", { cwd: dir, stdio: "pipe" });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: "pipe" });
  return dir;
}

describe("recovery mode", () => {
  let tmp: TempHome;

  beforeEach(() => {
    tmp = createTempWorkerMillHome();
    vi.resetModules();
  });

  afterEach(() => {
    tmp.restore();
    tmp.cleanup();
    vi.restoreAllMocks();
  });

  it("detects an interrupted build with real branch and changed files", async () => {
    const repo = createTempGitRepo();
    execSync("git checkout -b feat/recovery-test", { cwd: repo, stdio: "pipe" });
    fs.writeFileSync(path.join(repo, "src.txt"), "changed\n");
    execSync("git add src.txt", { cwd: repo, stdio: "pipe" });
    execSync('git commit -m "work in progress"', { cwd: repo, stdio: "pipe" });

    const { saveShipRun } = await import("../ship-state.js");
    const { detectInterruptedBuild } = await import("../recovery.js");

    saveShipRun({
      workingDir: repo,
      featureBranch: "feat/recovery-test",
      mainBranch: "main",
      userTask: "Implement recovery flow",
      stories: [
        { id: "s1", title: "First story", persona: "backend_developer", description: "Do thing" } as any,
        { id: "s2", title: "Second story", persona: "qa_engineer", description: "Verify thing" } as any,
      ],
      completedStoryIds: ["s1"],
      updatedAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const recovery = detectInterruptedBuild(repo);
    expect(recovery).not.toBeNull();
    expect(recovery!.branchExists).toBe(true);
    expect(recovery!.completedCount).toBe(1);
    expect(recovery!.remainingCount).toBe(1);
    expect(recovery!.changedFileCount).toBeGreaterThan(0);

    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("keeps completed-story runs retryable until final completion clears them", async () => {
    const repo = createTempGitRepo();
    try {
      execFileSync("git", ["checkout", "-b", "feat/final-verification"], { cwd: repo, stdio: "pipe" });
      const { saveShipRun, getRetryableRun, clearShipRun } = await import("../ship-state.js");
      const { detectInterruptedBuild } = await import("../recovery.js");
      saveShipRun({
        workingDir: repo, featureBranch: "feat/final-verification", mainBranch: "main",
        userTask: "Finish final verification", updatedAt: new Date().toISOString(),
        stories: [{ id: "s1", title: "Implemented", persona: "backend_developer", description: "Done", dependencies: [] }],
        completedStoryIds: ["s1"],
      });
      expect(getRetryableRun(repo)?.completedStoryIds).toEqual(["s1"]);
      expect(detectInterruptedBuild(repo)?.remainingCount).toBe(0);
      clearShipRun("feat/final-verification");
      expect(getRetryableRun(repo)).toBeNull();
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("treats shell syntax in valid saved branch names as literal Git arguments", async () => {
    const repo = createTempGitRepo();
    try {
      const branch = "feat/$(touch${IFS}recovery-pwned)";
      execFileSync("git", ["checkout", "-b", branch], { cwd: repo, stdio: "pipe" });
      fs.writeFileSync(path.join(repo, "changed.txt"), "implemented\n");
      execFileSync("git", ["add", "changed.txt"], { cwd: repo, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", "work"], { cwd: repo, stdio: "pipe" });
      const { saveShipRun } = await import("../ship-state.js");
      const { detectInterruptedBuild } = await import("../recovery.js");
      saveShipRun({
        workingDir: repo, featureBranch: branch, mainBranch: "main",
        userTask: "Recover literal branch", updatedAt: new Date().toISOString(),
        stories: [{ id: "s1", title: "Pending", persona: "backend_developer", description: "Pending", dependencies: [] }],
        completedStoryIds: [],
      });
      expect(detectInterruptedBuild(repo)).toMatchObject({ branchExists: true, changedFileCount: 1 });
      expect(fs.existsSync(path.join(repo, "recovery-pwned"))).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("treats a real bounded Git probe failure as unknown, not as a deleted branch", async () => {
    const nonRepository = fs.mkdtempSync(path.join(os.tmpdir(), "wm-recovery-probe-failure-"));
    try {
      const { probeBranchExists } = await import("../recovery.js");
      expect(probeBranchExists(nonRepository, "feature/not-proven-missing")).toBe("unknown");
    } finally {
      fs.rmSync(nonRepository, { recursive: true, force: true });
    }
  });

  it("prints a recovery prompt with remaining stories and options", async () => {
    const { printRecoveryPrompt } = await import("../recovery.js");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    printRecoveryPrompt({
      run: {
        workingDir: "/tmp/project",
        featureBranch: "feat/test",
        mainBranch: "main",
        userTask: "Build feature and verify it",
        stories: [
          { id: "s1", title: "Done story", persona: "backend_developer", description: "done" } as any,
          { id: "s2", title: "Remaining story", persona: "qa_engineer", description: "left" } as any,
        ],
        completedStoryIds: ["s1"],
        updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
      completedCount: 1,
      totalCount: 2,
      remainingCount: 1,
      branchExists: true,
      lastUpdated: new Date(Date.now() - 5 * 60_000).toISOString(),
      changedFileCount: 3,
    });

    const output = spy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("Interrupted build detected");
    expect(output).toContain("/retry");
    expect(output).toContain("/undo");
    expect(output).toContain("Remaining story");
  });

  it("clears interrupted build state", async () => {
    const repo = createTempGitRepo();
    execSync("git checkout -b feat/recovery-clear", { cwd: repo, stdio: "pipe" });

    const { saveShipRun } = await import("../ship-state.js");
    const { detectInterruptedBuild, clearInterruptedBuild } = await import("../recovery.js");

    saveShipRun({
      workingDir: repo,
      featureBranch: "feat/recovery-clear",
      mainBranch: "main",
      userTask: "Implement recovery flow",
      stories: [
        { id: "s1", title: "First story", persona: "backend_developer", description: "Do thing" } as any,
      ],
      completedStoryIds: [],
      updatedAt: new Date().toISOString(),
    });

    const recovery = detectInterruptedBuild(repo);
    expect(recovery).not.toBeNull();
    clearInterruptedBuild(recovery!);
    expect(detectInterruptedBuild(repo)).toBeNull();

    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("ignores stale state when the feature branch was deleted", async () => {
    const repo = createTempGitRepo();
    execSync("git checkout -b feat/recovery-deleted", { cwd: repo, stdio: "pipe" });
    execSync("git checkout main", { cwd: repo, stdio: "pipe" });
    execSync("git branch -D feat/recovery-deleted", { cwd: repo, stdio: "pipe" });

    const { saveShipRun, getRetryableRun } = await import("../ship-state.js");
    const { detectInterruptedBuild } = await import("../recovery.js");

    saveShipRun({
      workingDir: repo,
      featureBranch: "feat/recovery-deleted",
      mainBranch: "main",
      userTask: "Implement recovery flow",
      stories: [
        { id: "s1", title: "First story", persona: "backend_developer", description: "Do thing" } as any,
      ],
      completedStoryIds: [],
      updatedAt: new Date().toISOString(),
    });

    expect(detectInterruptedBuild(repo)).toBeNull();
    expect(getRetryableRun(repo)).toBeNull();

    fs.rmSync(repo, { recursive: true, force: true });
  });
});
