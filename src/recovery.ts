/**
 * Recovery mode — detects interrupted /build runs and offers guided recovery.
 *
 * Called on CLI startup to check for stale ship-state that indicates
 * a previous build was interrupted (crash, terminal close, ESC).
 */

import { execFileSync } from "child_process";
import chalk from "chalk";
import { getRetryableRun, clearShipRun, type ShipRun } from "./ship-state.js";
import { listRunManifests } from "./run-manifest.js";
import * as logger from "./logger.js";

export interface RecoveryInfo {
  run: ShipRun;
  completedCount: number;
  totalCount: number;
  remainingCount: number;
  branchExists: boolean;
  lastUpdated: string;
  changedFileCount: number;
}

/**
 * Check if a previous build was interrupted in the current working directory.
 * Returns recovery info if found, null otherwise.
 */
export function detectInterruptedBuild(workingDir: string): RecoveryInfo | null {
  const run = getRetryableRun(workingDir);
  if (!run) return null;

  const completedCount = run.completedStoryIds.length;
  const totalCount = run.stories.length;
  const remainingCount = totalCount - completedCount;

  // Verify branch exists
  let branchExists = false;
  try {
    execFileSync("git", ["-c", "core.fsmonitor=false", "show-ref", "--verify", "--quiet", `refs/heads/${run.featureBranch}`], {
      cwd: workingDir,
      stdio: "pipe",
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    });
    branchExists = true;
  } catch { /* branch gone */ }

  // Count changed files on the branch
  let changedFileCount = 0;
  if (branchExists) {
    try {
      const diff = execFileSync("git", ["-c", "core.fsmonitor=false", "diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", `refs/heads/${run.mainBranch}..refs/heads/${run.featureBranch}`, "--"], {
        cwd: workingDir,
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
      });
      changedFileCount = diff.split("\0").filter(Boolean).length;
    } catch { /* best effort */ }
  }

  return {
    run,
    completedCount,
    totalCount,
    remainingCount,
    branchExists,
    lastUpdated: run.updatedAt,
    changedFileCount,
  };
}

/**
 * Print recovery information and return the user's choice.
 */
export function printRecoveryPrompt(info: RecoveryInfo): void {
  const { run, completedCount, totalCount, remainingCount, branchExists, changedFileCount } = info;

  console.log();
  console.log(chalk.yellow.bold("⚠ Interrupted build detected"));
  console.log();
  console.log(`  Branch:     ${branchExists ? chalk.green(run.featureBranch) : chalk.red(`${run.featureBranch} (deleted)`)}`);
  console.log(`  Stories:    ${completedCount}/${totalCount} completed, ${remainingCount} remaining`);
  if (remainingCount === 0) console.log("  Final gates/review/completion may still be pending; /retry resumes final verification.");
  if (changedFileCount > 0) console.log(`  Changes:    ${changedFileCount} files modified`);
  console.log(`  Last active: ${formatRelativeTime(run.updatedAt)}`);
  console.log();

  // Show remaining stories
  const remaining = run.stories.filter(s => !run.completedStoryIds.includes(s.id));
  if (remaining.length > 0) {
    console.log("  Remaining stories:");
    remaining.forEach((s, i) => {
      console.log(`    ${i + 1}. [${s.persona}] ${s.title}`);
    });
    console.log();
  }

  // Show task preview
  const taskPreview = run.userTask.split("\n")[0].slice(0, 80);
  console.log(chalk.dim(`  Task: ${taskPreview}${run.userTask.length > 80 ? "..." : ""}`));
  console.log();

  console.log("  Options:");
  console.log(`    ${chalk.bold("/retry")}      — resume from where it left off`);
  if (branchExists) {
    console.log(`    ${chalk.bold("/undo")}       — revert changes and start fresh`);
  }
  console.log(`    ${chalk.bold("(continue)")} — ignore and start a normal session`);
  console.log();

  logger.info("Recovery prompt shown", {
    branch: run.featureBranch,
    completed: completedCount,
    total: totalCount,
    remaining: remainingCount,
  });
}

/**
 * Clear the interrupted build state (used when user chooses to start fresh).
 */
export function clearInterruptedBuild(info: RecoveryInfo): void {
  clearShipRun(info.run.featureBranch);
  logger.info("Interrupted build cleared", { branch: info.run.featureBranch });
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
