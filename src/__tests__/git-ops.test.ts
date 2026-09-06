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
  returnToOriginalBranch,
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
    it("uses directory name as prefix when no remote", () => {
      const branch = createFeatureBranch(repoDir, "Add login form");
      const dirName = path.basename(repoDir);
      expect(branch).toBe(`${dirName}/add-login-form`);

      const current = getCurrentBranch(repoDir);
      expect(current).toBe(`${dirName}/add-login-form`);
    });

    it("uses custom prefix when provided", () => {
      const branch = createFeatureBranch(repoDir, "fix tests", "feature");
      expect(branch).toBe("feature/fix-tests");
    });

    it("returns fallback branch when no description", () => {
      const branch = createFeatureBranch(repoDir);
      const dirName = path.basename(repoDir);
      expect(branch).toMatch(new RegExp(`^${dirName}/ship-`));
    });

    it("returns null for non-git directory", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-no-git-"));
      try {
        expect(createFeatureBranch(tmpDir, "test")).toBeNull();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("slugifies task description (max 3 words, lowercase)", () => {
      const branch = createFeatureBranch(
        repoDir,
        "Add the new login form with validation",
      );
      const dirName = path.basename(repoDir);
      expect(branch).toBe(`${dirName}/add-the-new`);
    });

    it("uses ticket key as prefix when provided", () => {
      const branch = createFeatureBranch(repoDir, "implement auth", "GH-42");
      expect(branch).toBe("GH-42/implement-auth");
    });

    it("uses Jira key as prefix when provided", () => {
      const branch = createFeatureBranch(repoDir, "add login", "ACME-123");
      expect(branch).toBe("ACME-123/add-login");
    });
  });

  describe("returnToOriginalBranch()", () => {
    it("switches back to the original branch", () => {
      const original = getCurrentBranch(repoDir)!;
      createFeatureBranch(repoDir, "temp branch");
      const dirName = path.basename(repoDir);
      expect(getCurrentBranch(repoDir)).toBe(`${dirName}/temp-branch`);

      returnToOriginalBranch(repoDir, original);
      expect(getCurrentBranch(repoDir)).toBe(original);
    });
  });

});
