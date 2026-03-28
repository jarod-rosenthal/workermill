import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// Mock logger to avoid file writes
vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

import {
  isGitRepo,
  getCurrentBranch,
  createFeatureBranch,
  commitStoryChanges,
  getDiffForReview,
  returnToOriginalBranch,
  getHeadHash,
} from "../git-ops.js";

function createTempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-git-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  // Create initial commit so HEAD exists
  fs.writeFileSync(path.join(dir, "README.md"), "# Test\n");
  execSync("git add README.md", { cwd: dir, stdio: "pipe" });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: "pipe" });
  return dir;
}

describe("git-ops", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  describe("isGitRepo()", () => {
    it("returns true for a git repo", () => {
      expect(isGitRepo(repoDir)).toBe(true);
    });

    it("returns false for a non-repo directory", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-no-git-"));
      try {
        expect(isGitRepo(tmpDir)).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("getCurrentBranch()", () => {
    it("returns the current branch name", () => {
      const branch = getCurrentBranch(repoDir);
      // Could be main or master depending on git config
      expect(branch === "main" || branch === "master").toBe(true);
    });
  });

  describe("createFeatureBranch()", () => {
    it("creates a workermill/ prefixed branch", () => {
      const branch = createFeatureBranch(repoDir, "Add login form");
      expect(branch).toBe("workermill/add-login-form");

      const current = getCurrentBranch(repoDir);
      expect(current).toBe("workermill/add-login-form");
    });

    it("uses custom prefix", () => {
      const branch = createFeatureBranch(repoDir, "fix tests", "feature");
      expect(branch).toBe("feature/fix-tests");
    });

    it("returns fallback branch when no description", () => {
      const branch = createFeatureBranch(repoDir);
      expect(branch).toMatch(/^workermill\/ship-/);
    });

    it("returns null for non-git directory", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-no-git-"));
      try {
        expect(createFeatureBranch(tmpDir, "test")).toBeNull();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("slugifies task description (max 5 words, lowercase)", () => {
      const branch = createFeatureBranch(
        repoDir,
        "Add the new login form with validation",
      );
      expect(branch).toBe("workermill/add-the-new-login-form");
    });
  });

  describe("commitStoryChanges()", () => {
    it("commits with Story: S{N} trailer", () => {
      fs.writeFileSync(path.join(repoDir, "app.ts"), "console.log('hello');\n");

      const hash = commitStoryChanges(repoDir, 1, "Add app entry", "frontend_developer");
      expect(hash).toBeTruthy();
      expect(hash.length).toBeGreaterThan(0);

      // Verify commit message
      const msg = execSync("git log -1 --format=%B", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();
      expect(msg).toContain("Story: S1");
      expect(msg).toContain("feat: Story 1 - Add app entry");
      expect(msg).toContain("Frontend Developer");
    });

    it("returns empty string when nothing to commit", () => {
      // Ensure .gitignore already exists so ensureGitignoreSafety doesn't create changes
      const gitignorePath = path.join(repoDir, ".gitignore");
      fs.writeFileSync(
        gitignorePath,
        "node_modules/\n.workermill/\ndist/\n.env\n.env.local\n*.log\n",
      );
      execSync("git add .gitignore", { cwd: repoDir, stdio: "pipe" });
      execSync('git commit -m "add gitignore"', { cwd: repoDir, stdio: "pipe" });

      const hash = commitStoryChanges(repoDir, 1, "Nothing", "planner");
      expect(hash).toBe("");
    });
  });

  describe("getDiffForReview()", () => {
    it("returns stat and diff", () => {
      const mainBranch = getCurrentBranch(repoDir)!;
      createFeatureBranch(repoDir, "feature work");

      fs.writeFileSync(path.join(repoDir, "new-file.ts"), "export const x = 1;\n");
      execSync("git add new-file.ts", { cwd: repoDir, stdio: "pipe" });
      execSync('git commit --no-verify -m "add new file"', { cwd: repoDir, stdio: "pipe" });

      const { stat, diff } = getDiffForReview(repoDir, mainBranch);
      expect(stat).toContain("new-file.ts");
      expect(diff).toContain("export const x = 1");
    });

    it("returns empty for no changes", () => {
      const mainBranch = getCurrentBranch(repoDir)!;
      const { stat, diff } = getDiffForReview(repoDir, mainBranch);
      expect(stat).toBe("");
      expect(diff).toBe("");
    });
  });

  describe("returnToOriginalBranch()", () => {
    it("switches back to the original branch", () => {
      const original = getCurrentBranch(repoDir)!;
      createFeatureBranch(repoDir, "temp branch");
      expect(getCurrentBranch(repoDir)).toBe("workermill/temp-branch");

      returnToOriginalBranch(repoDir, original);
      expect(getCurrentBranch(repoDir)).toBe(original);
    });
  });

  describe("getHeadHash()", () => {
    it("returns a hex string", () => {
      const hash = getHeadHash(repoDir);
      expect(hash).toMatch(/^[0-9a-f]{40}$/);
    });
  });
});
