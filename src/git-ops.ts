/**
 * Git operations for CLI orchestration.
 *
 * Ported from worker/epic/git-ops.ts — these are the battle-tested patterns
 * for branch management, commits, and revision context capture.
 *
 * Key difference from the worker: the CLI runs sequentially in one directory
 * (no worktrees), so branches are simpler but the commit/capture patterns
 * are identical.
 */

import { execFileSync, execSync } from "child_process";
import path from "path";
import * as logger from "./logger.js";

export function execGh(args: string[], options?: {
  cwd?: string;
  input?: string;
  timeout?: number;
}): string {
  return execFileSync("gh", args, {
    cwd: options?.cwd,
    input: options?.input,
    timeout: options?.timeout,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/**
 * Check if we're in a git repo.
 */
export function isGitRepo(workingDir: string): boolean {
  try {
    execSync("git rev-parse --git-dir", { cwd: workingDir, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current branch name.
 */
export function getCurrentBranch(workingDir: string): string | null {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
  } catch {
    return null;
  }
}

/**
 * Derive the feature branch name that /build would use, without creating it.
 * Useful for checking existence before prompting the user.
 */
export function deriveFeatureBranchName(workingDir: string, taskDescription?: string, branchPrefix?: string): string | null {
  if (!isGitRepo(workingDir)) return null;

  try {
    let slug: string;
    if (taskDescription) {
      slug = taskDescription
        .replace(/\.md$/i, "")
        .replace(/[^a-zA-Z0-9\s-]/g, "")
        .trim()
        .split(/\s+/)
        .slice(0, 3)
        .join("-")
        .toLowerCase()
        .replace(/-+/g, "-");
    } else {
      return null; // timestamp-based names are always unique
    }

    let prefix = branchPrefix;
    if (!prefix) {
      try {
        const remote = execSync("git remote get-url origin 2>/dev/null", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
        const match = remote.match(/[/:]([^/]+?)(?:\.git)?$/);
        if (match) prefix = match[1];
      } catch { /* no remote */ }
      if (!prefix) prefix = path.basename(workingDir);
    }

    return `${prefix}/${slug}`;
  } catch {
    return null;
  }
}

/**
 * Check if a local branch exists.
 */
export function localBranchExists(workingDir: string, branchName: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", branchName], { cwd: workingDir, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a local branch (must not be the current branch).
 */
export function deleteLocalBranch(workingDir: string, branchName: string): void {
  execFileSync("git", ["branch", "-D", branchName], { cwd: workingDir, stdio: "pipe" });
}

/**
 * Create a feature branch for the /build session.
 *
 * Branch format: workermill/{slugified-task-description}
 * Falls back to workermill/ship-{short-hash} if no task provided.
 * From worker/epic/git-ops.ts:createStoryBranch() — simplified for CLI.
 *
 * Callers should use deriveFeatureBranchName + localBranchExists to check
 * for existing branches and prompt the user before calling this.
 */
export function createFeatureBranch(workingDir: string, taskDescription?: string, branchPrefix?: string): string | null {
  if (!isGitRepo(workingDir)) return null;

  try {
    let slug: string;
    if (taskDescription) {
      slug = taskDescription
        .replace(/\.md$/i, "")
        .replace(/[^a-zA-Z0-9\s-]/g, "")
        .trim()
        .split(/\s+/)
        .slice(0, 3)
        .join("-")
        .toLowerCase()
        .replace(/-+/g, "-");
    } else {
      slug = `ship-${Date.now().toString(36)}`;
    }
    // Default prefix: repo name from git remote, fall back to directory name
    let prefix = branchPrefix;
    if (!prefix) {
      try {
        const remote = execSync("git remote get-url origin 2>/dev/null", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
        const match = remote.match(/[/:]([^/]+?)(?:\.git)?$/);
        if (match) prefix = match[1];
      } catch { /* no remote */ }
      if (!prefix) prefix = path.basename(workingDir);
    }
    const branchName = `${prefix}/${slug}`;

    try {
      execFileSync("git", ["checkout", "-b", branchName], { cwd: workingDir, stdio: "pipe" });
      logger.info("Created feature branch", { branch: branchName });
    } catch {
      // Branch already exists (user chose "Continue") — just check it out
      execFileSync("git", ["checkout", branchName], { cwd: workingDir, stdio: "pipe" });
      logger.info("Checked out existing feature branch", { branch: branchName });
    }
    return branchName;
  } catch (err) {
    logger.debug("Could not create or checkout feature branch", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Return to the original branch (used when /build completes or is cancelled).
 */
export function returnToOriginalBranch(workingDir: string, originalBranch: string): void {
  try {
    execSync(`git checkout "${originalBranch}"`, { cwd: workingDir, stdio: "pipe" });
    logger.debug("Returned to original branch", { branch: originalBranch });
  } catch {
    // Non-fatal
  }
}
