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

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import * as logger from "./logger.js";

/**
 * Ensure .gitignore contains entries that prevent `git add .` from staging
 * build artifacts, node_modules, and WorkerMill internal files.
 *
 * From worker/epic/git-ops.ts:ensureNodeModulesIgnored()
 * Greenfield projects may not have a .gitignore yet when the first commit runs.
 */
export function ensureGitignoreSafety(workingDir: string): void {
  const gitignorePath = path.join(workingDir, ".gitignore");
  try {
    const content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf-8") : "";
    const lines = content.split("\n").map(l => l.trim());
    const needed = [
      "node_modules/",
      ".workermill/",
      "dist/",
      ".env",
      ".env.local",
      "*.log",
    ];
    const additions: string[] = [];
    for (const entry of needed) {
      if (!lines.some(line => line === entry || line === entry.replace(/\/$/, ""))) {
        additions.push(entry);
      }
    }
    if (additions.length > 0) {
      const newContent = content.trimEnd() + "\n" + additions.join("\n") + "\n";
      fs.writeFileSync(gitignorePath, newContent, "utf-8");
      logger.debug("Updated .gitignore", { added: additions });
    }
  } catch {
    // Non-fatal — worst case some files get staged
  }
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
 * Create a feature branch for the /ship session.
 *
 * Branch format: workermill/{slugified-task-description}
 * Falls back to workermill/ship-{short-hash} if no task provided.
 * From worker/epic/git-ops.ts:createStoryBranch() — simplified for CLI.
 */
export function createFeatureBranch(workingDir: string, taskDescription?: string): string | null {
  if (!isGitRepo(workingDir)) return null;

  try {
    let slug: string;
    if (taskDescription) {
      // Derive branch name from task: strip file extensions, take first 5 words, slugify
      slug = taskDescription
        .replace(/\.md$/i, "")
        .replace(/[^a-zA-Z0-9\s-]/g, "")
        .trim()
        .split(/\s+/)
        .slice(0, 5)
        .join("-")
        .toLowerCase()
        .replace(/-+/g, "-");
    } else {
      slug = `ship-${Date.now().toString(36)}`;
    }
    const branchName = `workermill/${slug}`;

    // Create and checkout the feature branch from current HEAD
    execSync(`git checkout -b "${branchName}"`, { cwd: workingDir, stdio: "pipe" });
    logger.info("Created feature branch", { branch: branchName });
    return branchName;
  } catch (err) {
    logger.debug("Could not create feature branch", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Commit changes after a story completes.
 *
 * From worker/epic/git-ops.ts:commitChangesInWorktree()
 * Commit message format matches the worker exactly.
 *
 * Returns the commit hash, or empty string if nothing to commit.
 */
export function commitStoryChanges(
  workingDir: string,
  storyIndex: number,
  storyTitle: string,
  persona: string,
): string {
  try {
    // Safety: ensure .gitignore blocks build artifacts
    ensureGitignoreSafety(workingDir);

    // Stage all changes (respects .gitignore)
    execSync("git add .", { cwd: workingDir, stdio: "pipe" });

    // Check if there are changes to commit
    const status = execSync("git status --porcelain", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
    if (!status) {
      logger.debug("No changes to commit", { storyIndex, persona });
      return "";
    }

    // Commit message format from worker/epic/git-ops.ts line 969
    const personaDisplay = persona.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    const message = `feat: Story ${storyIndex} - ${storyTitle}\n\nStory: S${storyIndex}\nCo-Authored-By: ${personaDisplay} <workermill@users.noreply.github.com>`;

    execSync(`git commit --no-verify -m "${message.replace(/"/g, '\\"')}"`, { cwd: workingDir, stdio: "pipe" });

    const hash = execSync("git rev-parse --short HEAD", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
    logger.info("Committed story changes", { storyIndex, persona, hash });
    return hash;
  } catch (err) {
    logger.debug("Commit failed", { storyIndex, error: err instanceof Error ? err.message : String(err) });
    return "";
  }
}

/**
 * Commit revision changes after a revision worker completes.
 */
export function commitRevisionChanges(
  workingDir: string,
  storyIndex: number,
  storyTitle: string,
  persona: string,
  revisionRound: number,
): string {
  try {
    ensureGitignoreSafety(workingDir);
    execSync("git add .", { cwd: workingDir, stdio: "pipe" });

    const status = execSync("git status --porcelain", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
    if (!status) return "";

    const personaDisplay = persona.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    const message = `fix: Story ${storyIndex} revision ${revisionRound} - ${storyTitle}\n\nStory: S${storyIndex}\nCo-Authored-By: ${personaDisplay} <workermill@users.noreply.github.com>`;

    execSync(`git commit --no-verify -m "${message.replace(/"/g, '\\"')}"`, { cwd: workingDir, stdio: "pipe" });

    const hash = execSync("git rev-parse --short HEAD", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
    logger.info("Committed revision changes", { storyIndex, persona, revisionRound, hash });
    return hash;
  } catch (err) {
    logger.debug("Revision commit failed", { storyIndex, error: err instanceof Error ? err.message : String(err) });
    return "";
  }
}

/**
 * Capture prior work context for revision — what was done in previous attempts.
 *
 * From worker/epic/git-ops.ts:captureStoryBranchSummaries()
 * Adapted for CLI: instead of capturing from remote branches, captures from
 * the local commit history on the feature branch.
 *
 * Returns a formatted summary matching the worker's format exactly.
 */
export function capturePriorWork(
  workingDir: string,
  mainBranch: string,
): string {
  try {
    // Get commits on this branch since it diverged from main
    const logOutput = execSync(
      `git log ${mainBranch}..HEAD --oneline --no-merges -20 2>/dev/null || true`,
      { cwd: workingDir, encoding: "utf-8", stdio: "pipe" },
    ).trim();

    // Get files changed vs main
    const filesOutput = execSync(
      `git diff --name-only ${mainBranch}...HEAD 2>/dev/null || true`,
      { cwd: workingDir, encoding: "utf-8", stdio: "pipe" },
    ).trim();

    if (!logOutput && !filesOutput) return "";

    const lines: string[] = [];
    lines.push("### Prior Work on This Branch");

    if (logOutput) {
      lines.push("\n**Commits from previous attempts:**");
      for (const line of logOutput.split("\n").filter(Boolean)) {
        lines.push(`- \`${line}\``);
      }
    }

    if (filesOutput) {
      const files = filesOutput.split("\n").filter(Boolean);
      lines.push(`\n**Files changed (${files.length}):** ${files.join(", ")}`);
    }

    return lines.join("\n");
  } catch {
    return "";
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
    const stat = execSync(
      `git diff --stat ${mainBranch}..HEAD 2>/dev/null || true`,
      { cwd: workingDir, encoding: "utf-8", stdio: "pipe" },
    ).trim();
    const diff = execSync(
      `git diff ${mainBranch}..HEAD 2>/dev/null || true`,
      { cwd: workingDir, encoding: "utf-8", stdio: "pipe" },
    ).trim();
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
    return execSync(
      `git diff ${commitHash}..HEAD 2>/dev/null || true`,
      { cwd: workingDir, encoding: "utf-8", stdio: "pipe" },
    ).trim();
  } catch {
    return "";
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
 * Return to the original branch (used when /ship completes or is cancelled).
 */
export function returnToOriginalBranch(workingDir: string, originalBranch: string): void {
  try {
    execSync(`git checkout "${originalBranch}"`, { cwd: workingDir, stdio: "pipe" });
    logger.debug("Returned to original branch", { branch: originalBranch });
  } catch {
    // Non-fatal
  }
}
