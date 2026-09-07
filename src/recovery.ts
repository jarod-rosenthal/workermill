/**
 * Recovery mode — detects interrupted /build runs and offers guided recovery.
 *
 * Called on CLI startup to check for stale ship-state that indicates
 * a previous build was interrupted (crash, terminal close, ESC).
 */

import { execFileSync } from "child_process";
import chalk from "chalk";
import { getRetryableRun, clearShipRun, type ShipRun } from "./ship-state.js";
import * as logger from "./logger.js";

export type BranchProbeResult = true | false | "unknown";

export interface RecoveryInfo {
  run: ShipRun;
  completedCount: number;
  totalCount: number;
  remainingCount: number;
  /** `unknown` means Git could not prove the branch was absent. */
  branchExists: BranchProbeResult;
  lastUpdated: string;
  changedFileCount: number;
}

/**
 * Check if a previous build was interrupted in the current working directory.
 * Returns recovery info if found, null otherwise.
 */
/** A failed or timed-out Git probe is not evidence that a branch was deleted. */
export function probeBranchExists(workingDir: string, branch: string): BranchProbeResult {
  try {
    execFileSync("git", ["-c", "core.fsmonitor=false", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
      cwd: workingDir, stdio: "pipe", timeout: 5_000, maxBuffer: 64 * 1024,
    });
    return true;
  } catch (error) {
    // Git reserves exit 1 for a missing ref. Everything else (including a
    // timeout, missing executable, permissions, or corrupt repository) is unknown.
    return (error as { status?: unknown }).status === 1 ? false : "unknown";
  }
}

export function detectInterruptedBuild(workingDir: string): RecoveryInfo | null {
  const run = getRetryableRun(workingDir);
  if (!run) return null;

  const completedCount = run.completedStoryIds.length;
  const totalCount = run.stories.length;
  const remainingCount = totalCount - completedCount;

  const branchExists = probeBranchExists(workingDir, run.featureBranch);

  // Count changed files on the branch
  let changedFileCount = 0;
  if (branchExists === true) {
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
  const branchLabel = branchExists === true
    ? chalk.green(run.featureBranch)
    : branchExists === false
      ? chalk.red(`${run.featureBranch} (deleted)`)
      : chalk.yellow(`${run.featureBranch} (could not verify)`);
  console.log(`  Branch:     ${branchLabel}`);
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
  if (branchExists === true) {
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
