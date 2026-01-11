#!/usr/bin/env npx ts-node

/**
 * Rebase current branch onto origin/main (or specified base branch)
 *
 * This script ensures the current branch is up to date with the latest
 * changes from the base branch before pushing, preventing conflicts with
 * other workers' changes.
 *
 * Inputs (environment variables):
 * - REPO_PATH: Optional. Path to the repository. Defaults to current directory
 * - BASE_BRANCH: Optional. Base branch to rebase onto. Defaults to "main"
 *
 * Outputs (JSON to stdout):
 * - success: boolean
 * - hadConflicts: boolean
 * - conflictFiles?: string[] - Files with conflicts (if any)
 * - wasAlreadyUpToDate: boolean - True if no rebase was needed
 * - commitsBehind: number - How many commits behind base we were
 * - error?: string - Error message if failed
 */

import { execSync } from "child_process";

interface Output {
  success: boolean;
  hadConflicts: boolean;
  conflictFiles?: string[];
  wasAlreadyUpToDate?: boolean;
  commitsBehind?: number;
  error?: string;
}

function exec(cmd: string, cwd?: string): string {
  return execSync(cmd, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function execSafe(cmd: string, cwd?: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout?.trim() || "",
      stderr: error.stderr?.trim() || "",
      exitCode: error.status || 1,
    };
  }
}

function getConflictFiles(cwd: string): string[] {
  const result = execSafe("git diff --name-only --diff-filter=U", cwd);
  if (result.exitCode === 0 && result.stdout) {
    return result.stdout.split("\n").filter((f) => f.trim());
  }
  return [];
}

async function main(): Promise<void> {
  const output: Output = {
    success: false,
    hadConflicts: false,
  };

  try {
    const repoPath = process.env.REPO_PATH || process.cwd();
    const baseBranch = process.env.BASE_BRANCH || "main";

    console.error(`[rebase_on_main] Starting rebase onto origin/${baseBranch}`);

    // Get current branch name
    const currentBranch = exec("git rev-parse --abbrev-ref HEAD", repoPath);
    console.error(`[rebase_on_main] Current branch: ${currentBranch}`);

    if (currentBranch === baseBranch) {
      throw new Error(`Cannot rebase ${baseBranch} onto itself`);
    }

    // Fetch latest from origin
    console.error(`[rebase_on_main] Fetching latest from origin...`);
    exec(`git fetch origin ${baseBranch}`, repoPath);

    // Check how many commits behind we are
    const behindResult = execSafe(
      `git rev-list --count HEAD..origin/${baseBranch}`,
      repoPath
    );
    const commitsBehind = parseInt(behindResult.stdout) || 0;
    output.commitsBehind = commitsBehind;

    console.error(`[rebase_on_main] Commits behind origin/${baseBranch}: ${commitsBehind}`);

    if (commitsBehind === 0) {
      console.error(`[rebase_on_main] Already up to date with origin/${baseBranch}`);
      output.success = true;
      output.wasAlreadyUpToDate = true;
      console.log(JSON.stringify(output));
      process.exit(0);
      return;
    }

    output.wasAlreadyUpToDate = false;

    // Attempt the rebase
    console.error(`[rebase_on_main] Rebasing onto origin/${baseBranch}...`);
    const rebaseResult = execSafe(`git rebase origin/${baseBranch}`, repoPath);

    if (rebaseResult.exitCode !== 0) {
      // Check if it's a conflict
      const conflictFiles = getConflictFiles(repoPath);

      if (conflictFiles.length > 0) {
        console.error(`[rebase_on_main] Rebase conflicts detected in: ${conflictFiles.join(", ")}`);
        output.hadConflicts = true;
        output.conflictFiles = conflictFiles;

        // Abort the rebase to leave repo in clean state
        execSafe("git rebase --abort", repoPath);

        output.error = `Rebase conflict in files: ${conflictFiles.join(", ")}`;
        console.log(JSON.stringify(output));
        process.exit(1);
        return;
      }

      // Some other rebase error
      throw new Error(`Rebase failed: ${rebaseResult.stderr || rebaseResult.stdout}`);
    }

    console.error(`[rebase_on_main] Rebase completed successfully`);
    output.success = true;
  } catch (error: unknown) {
    output.error = error instanceof Error ? error.message : String(error);
    console.error(`[rebase_on_main] Error: ${output.error}`);
  }

  console.log(JSON.stringify(output));

  // Output markers for orchestrator
  if (output.hadConflicts) {
    console.error(`::rebase_conflict::true`);
    if (output.conflictFiles) {
      console.error(`::conflict_files::${output.conflictFiles.join(",")}`);
    }
  }
  if (output.wasAlreadyUpToDate) {
    console.error(`::rebase_status::already_up_to_date`);
  } else if (output.success) {
    console.error(`::rebase_status::rebased`);
    console.error(`::commits_rebased::${output.commitsBehind}`);
  }

  process.exit(output.success ? 0 : 1);
}

main();
