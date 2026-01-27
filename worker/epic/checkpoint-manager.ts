/**
 * Checkpoint Manager - Git checkpoint commits for phased execution
 *
 * Creates checkpoint commits after each implementation unit,
 * then squashes them into a single commit at the end.
 */

import { execSync } from "child_process";

export interface CheckpointResult {
  sha: string;
  message: string;
  filesCommitted: string[];
}

export interface SquashResult {
  finalSha: string;
  squashedCommits: number;
  finalMessage: string;
}

/**
 * Creates a checkpoint commit after completing an implementation unit.
 */
export async function createCheckpoint(
  repoPath: string,
  unitIndex: number,
  unitName: string,
  filesModified: string[]
): Promise<CheckpointResult> {
  const message = `[checkpoint] Unit ${unitIndex}: ${unitName}`;

  // Stage only the specified files
  for (const file of filesModified) {
    try {
      execSync(`git add "${file}"`, { cwd: repoPath, encoding: "utf-8" });
    } catch (error) {
      // File might not exist if it was deleted
      console.warn(`Could not stage ${file}: ${error}`);
    }
  }

  // Also stage any new files that were created
  execSync("git add -A", { cwd: repoPath, encoding: "utf-8" });

  // Check if there are staged changes
  const status = execSync("git diff --cached --name-only", {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();

  if (!status) {
    throw new Error(`No changes to commit for unit ${unitIndex}`);
  }

  const stagedFiles = status.split("\n").filter(Boolean);

  // Create the checkpoint commit
  execSync(`git commit -m "${message}"`, { cwd: repoPath, encoding: "utf-8" });

  // Get the commit SHA
  const sha = execSync("git rev-parse HEAD", {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();

  return {
    sha,
    message,
    filesCommitted: stagedFiles,
  };
}

/**
 * Creates a checkpoint after the integrate phase.
 */
export async function createIntegrateCheckpoint(
  repoPath: string,
  filesFixed: string[]
): Promise<CheckpointResult | null> {
  const message = "[checkpoint] Integration fixes";

  // Stage the fixed files
  for (const file of filesFixed) {
    try {
      execSync(`git add "${file}"`, { cwd: repoPath, encoding: "utf-8" });
    } catch (error) {
      console.warn(`Could not stage ${file}: ${error}`);
    }
  }

  // Check if there are staged changes
  const status = execSync("git diff --cached --name-only", {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();

  if (!status) {
    // No integration fixes were needed
    return null;
  }

  const stagedFiles = status.split("\n").filter(Boolean);

  // Create the checkpoint commit
  execSync(`git commit -m "${message}"`, { cwd: repoPath, encoding: "utf-8" });

  const sha = execSync("git rev-parse HEAD", {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();

  return {
    sha,
    message,
    filesCommitted: stagedFiles,
  };
}

/**
 * Creates a checkpoint after fix phase iterations.
 */
export async function createFixCheckpoint(
  repoPath: string,
  iterationNumber: number,
  filesModified: string[]
): Promise<CheckpointResult | null> {
  const message = `[checkpoint] Fix iteration ${iterationNumber}`;

  // Stage the modified files
  for (const file of filesModified) {
    try {
      execSync(`git add "${file}"`, { cwd: repoPath, encoding: "utf-8" });
    } catch (error) {
      console.warn(`Could not stage ${file}: ${error}`);
    }
  }

  // Check if there are staged changes
  const status = execSync("git diff --cached --name-only", {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();

  if (!status) {
    return null;
  }

  const stagedFiles = status.split("\n").filter(Boolean);

  execSync(`git commit -m "${message}"`, { cwd: repoPath, encoding: "utf-8" });

  const sha = execSync("git rev-parse HEAD", {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();

  return {
    sha,
    message,
    filesCommitted: stagedFiles,
  };
}

/**
 * Squashes all checkpoint commits into a single final commit.
 *
 * @param repoPath - Path to the repository
 * @param checkpointCommits - Array of checkpoint commit SHAs
 * @param storyTitle - Title for the final commit message
 * @param jiraKey - Jira ticket key (e.g., OCS-123)
 * @returns SquashResult with final commit info
 */
export async function squashCheckpoints(
  repoPath: string,
  checkpointCommits: string[],
  storyTitle: string,
  jiraKey: string
): Promise<SquashResult> {
  if (checkpointCommits.length === 0) {
    throw new Error("No checkpoint commits to squash");
  }

  // Find the parent of the first checkpoint
  const firstCheckpoint = checkpointCommits[0];
  const parentSha = execSync(`git rev-parse ${firstCheckpoint}^`, {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();

  // Create the final commit message
  const finalMessage = `feat(${jiraKey}): ${storyTitle}

Squashed ${checkpointCommits.length} checkpoint commits.

Co-Authored-By: Claude <noreply@anthropic.com>`;

  // Soft reset to the parent, keeping all changes staged
  execSync(`git reset --soft ${parentSha}`, {
    cwd: repoPath,
    encoding: "utf-8",
  });

  // Create the squashed commit
  execSync(`git commit -m "${finalMessage.replace(/"/g, '\\"')}"`, {
    cwd: repoPath,
    encoding: "utf-8",
  });

  const finalSha = execSync("git rev-parse HEAD", {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();

  return {
    finalSha,
    squashedCommits: checkpointCommits.length,
    finalMessage,
  };
}

/**
 * Gets the current git diff stat for the repo state.
 */
export function getGitDiffStat(repoPath: string): string {
  try {
    return execSync("git diff --stat HEAD~1", {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
  } catch {
    // No previous commit to diff against
    return execSync("git diff --stat", {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
  }
}

/**
 * Gets list of files changed since a reference commit.
 */
export function getChangedFiles(
  repoPath: string,
  sinceCommit?: string
): string[] {
  try {
    const ref = sinceCommit || "HEAD~1";
    const output = execSync(`git diff --name-only ${ref}`, {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
    return output ? output.split("\n").filter(Boolean) : [];
  } catch {
    // Fallback: get all tracked files with modifications
    const output = execSync("git status --porcelain", {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
    return output
      ? output
          .split("\n")
          .map((line) => line.slice(3))
          .filter(Boolean)
      : [];
  }
}

/**
 * Gets list of new files created (untracked or newly added).
 */
export function getNewFilesCreated(repoPath: string): string[] {
  const output = execSync("git status --porcelain", {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();

  if (!output) return [];

  return output
    .split("\n")
    .filter((line) => line.startsWith("A ") || line.startsWith("??"))
    .map((line) => line.slice(3))
    .filter(Boolean);
}

/**
 * Gets the current branch name.
 */
export function getCurrentBranch(repoPath: string): string {
  return execSync("git rev-parse --abbrev-ref HEAD", {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();
}

/**
 * Creates the story branch if it doesn't exist.
 */
export function ensureStoryBranch(
  repoPath: string,
  branchName: string,
  baseBranch: string = "main"
): void {
  // Check if branch exists
  try {
    execSync(`git rev-parse --verify ${branchName}`, {
      cwd: repoPath,
      encoding: "utf-8",
    });
    // Branch exists, switch to it
    execSync(`git checkout ${branchName}`, { cwd: repoPath, encoding: "utf-8" });
  } catch {
    // Branch doesn't exist, create it from base
    execSync(`git checkout -b ${branchName} ${baseBranch}`, {
      cwd: repoPath,
      encoding: "utf-8",
    });
  }
}

/**
 * Pushes the current branch to origin.
 */
export function pushBranch(repoPath: string, branchName: string): void {
  execSync(`git push -u origin ${branchName}`, {
    cwd: repoPath,
    encoding: "utf-8",
  });
}

/**
 * Force pushes (needed after squash).
 */
export function forcePushBranch(repoPath: string, branchName: string): void {
  execSync(`git push -f origin ${branchName}`, {
    cwd: repoPath,
    encoding: "utf-8",
  });
}
