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
 * Capture per-story prior work — what a specific story's commits changed.
 * Uses the commit message format "Story: S{index}" to identify story commits.
 *
 * From worker/epic/git-ops.ts:captureStoryBranchSummaries() per-story logic
 */
export function captureStoryPriorWork(
  workingDir: string,
  mainBranch: string,
  storyIndex: number,
): string {
  try {
    // Find commits for this specific story using the "Story: S{index}" trailer
    const logOutput = execSync(
      `git log ${mainBranch}..HEAD --oneline --no-merges --grep="Story: S${storyIndex}" -10 2>/dev/null || true`,
      { cwd: workingDir, encoding: "utf-8", stdio: "pipe" },
    ).trim();

    if (!logOutput) return "";

    // Get the diff introduced by this story's commits
    const commits = logOutput.split("\n").filter(Boolean);
    const hashes = commits.map(c => c.split(" ")[0]);

    let filesChanged: string[] = [];
    for (const hash of hashes) {
      try {
        const files = execSync(
          `git diff-tree --no-commit-id --name-only -r ${hash} 2>/dev/null || true`,
          { cwd: workingDir, encoding: "utf-8", stdio: "pipe" },
        ).trim();
        if (files) filesChanged.push(...files.split("\n").filter(Boolean));
      } catch { /* skip */ }
    }
    filesChanged = [...new Set(filesChanged)]; // dedupe

    const lines: string[] = [];
    lines.push(`### What You Did Last Time (Story ${storyIndex})`);
    lines.push("Your previous attempt created the following work. Use this context to understand what was already tried and avoid repeating the same mistakes.\n");
    lines.push("**Commits from previous attempt:**");
    for (const c of commits) {
      lines.push(`- \`${c}\``);
    }
    if (filesChanged.length > 0) {
      lines.push(`\n**Files changed (${filesChanged.length}):** ${filesChanged.join(", ")}`);
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

/**
 * Get a clean diff for the reviewer — changes on the feature branch vs main.
 *
 * From worker/epic/git-ops.ts — the consolidated PR uses git diff against main.
 */
export function getDiffForReview(workingDir: string, mainBranch: string): { stat: string; diff: string } {
  try {
    const stat = readReviewDiff(workingDir, ["--stat", `${mainBranch}..HEAD`]);
    const diff = readReviewDiff(workingDir, [`${mainBranch}..HEAD`]);
    return { stat, diff };
  } catch {
    return { stat: "", diff: "" };
  }
}

/**
 * Get diff since a specific commit — used to show the reviewer what changed
 * between revision rounds.
 */
export function getDiffSinceCommit(workingDir: string, commitHash: string): string {
  try {
    return readReviewDiff(workingDir, [`${commitHash}..HEAD`]);
  } catch {
    return "";
  }
}

/** Review reads must not invoke repository-configured external diff/textconv. */
function readReviewDiff(workingDir: string, args: string[]): string {
  return execFileSync("git", ["-c", "core.fsmonitor=false", "diff", "--no-ext-diff", "--no-textconv", ...args, "--"], {
    cwd: workingDir, encoding: "utf-8", stdio: "pipe", timeout: 10_000, maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

export function getUncommittedDiffForReview(workingDir: string): { stat: string; diff: string } {
  try { return { stat: readReviewDiff(workingDir, ["--stat", "HEAD"]), diff: readReviewDiff(workingDir, ["HEAD"]) }; }
  catch {
    try { return { stat: readReviewDiff(workingDir, ["--stat"]), diff: readReviewDiff(workingDir, []) }; }
    catch { return { stat: "", diff: "" }; }
  }
}

/**
 * Get the current HEAD hash — used as a checkpoint before revision.
 */
export function getHeadHash(workingDir: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
  } catch {
    return "";
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
