/**
 * Checkpoint Manager - Git checkpoint commits for phased execution
 *
 * Creates checkpoint commits after each implementation unit,
 * then squashes them into a single commit at the end.
 *
 * SECURITY: Uses execFileSync instead of execSync to prevent command injection.
 * All user-controlled inputs (branch names, file paths, commit messages) are
 * passed as arguments rather than interpolated into shell commands.
 */

import { execFileSync } from "child_process";

/**
 * Validates that a branch name contains only safe characters.
 * Prevents command injection via malicious branch names.
 */
function validateBranchName(branchName: string): void {
  // Allow alphanumeric, dash, underscore, slash, and dot (standard git branch chars)
  const safePattern = /^[a-zA-Z0-9_\-./]+$/;
  if (!safePattern.test(branchName)) {
    throw new Error(`Invalid branch name: contains unsafe characters: ${branchName}`);
  }
  // Prevent shell metacharacters even if they somehow passed the pattern
  const dangerous = [";", "&", "|", "$", "`", "(", ")", "{", "}", "<", ">", "!", "\n", "\r"];
  for (const char of dangerous) {
    if (branchName.includes(char)) {
      throw new Error(`Invalid branch name: contains dangerous character '${char}'`);
    }
  }
}

/**
 * Validates that a commit reference (SHA or ref) is safe.
 */
function validateCommitRef(ref: string): void {
  // Allow alphanumeric, dash, caret (^), tilde (~), and dot
  const safePattern = /^[a-zA-Z0-9_\-.^~]+$/;
  if (!safePattern.test(ref)) {
    throw new Error(`Invalid commit reference: ${ref}`);
  }
}

/**
 * Executes a git command safely using execFileSync (no shell).
 * This prevents command injection from malicious inputs.
 */
function gitExec(repoPath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoPath,
    encoding: "utf-8",
  }).trim();
}

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

  // Stage only the specified files (using execFileSync to prevent injection)
  for (const file of filesModified) {
    try {
      // Pass file path as argument, not interpolated into shell command
      gitExec(repoPath, ["add", "--", file]);
    } catch (error) {
      // File might not exist if it was deleted
      console.warn(`Could not stage ${file}: ${error}`);
    }
  }

  // Also stage any new files that were created
  gitExec(repoPath, ["add", "-A"]);

  // Check if there are staged changes
  const status = gitExec(repoPath, ["diff", "--cached", "--name-only"]);

  if (!status) {
    throw new Error(`No changes to commit for unit ${unitIndex}`);
  }

  const stagedFiles = status.split("\n").filter(Boolean);

  // Create the checkpoint commit (message passed as argument, not shell interpolated)
  gitExec(repoPath, ["commit", "-m", message]);

  // Get the commit SHA
  const sha = gitExec(repoPath, ["rev-parse", "HEAD"]);

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

  // Stage the fixed files (using execFileSync to prevent injection)
  for (const file of filesFixed) {
    try {
      gitExec(repoPath, ["add", "--", file]);
    } catch (error) {
      console.warn(`Could not stage ${file}: ${error}`);
    }
  }

  // Check if there are staged changes
  const status = gitExec(repoPath, ["diff", "--cached", "--name-only"]);

  if (!status) {
    // No integration fixes were needed
    return null;
  }

  const stagedFiles = status.split("\n").filter(Boolean);

  // Create the checkpoint commit
  gitExec(repoPath, ["commit", "-m", message]);

  const sha = gitExec(repoPath, ["rev-parse", "HEAD"]);

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

  // Stage the modified files (using execFileSync to prevent injection)
  for (const file of filesModified) {
    try {
      gitExec(repoPath, ["add", "--", file]);
    } catch (error) {
      console.warn(`Could not stage ${file}: ${error}`);
    }
  }

  // Check if there are staged changes
  const status = gitExec(repoPath, ["diff", "--cached", "--name-only"]);

  if (!status) {
    return null;
  }

  const stagedFiles = status.split("\n").filter(Boolean);

  gitExec(repoPath, ["commit", "-m", message]);

  const sha = gitExec(repoPath, ["rev-parse", "HEAD"]);

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

  // Validate checkpoint commit refs for safety
  const firstCheckpoint = checkpointCommits[0];
  validateCommitRef(firstCheckpoint);

  // Find the parent of the first checkpoint (using safe argument passing)
  const parentSha = gitExec(repoPath, ["rev-parse", `${firstCheckpoint}^`]);

  // Create the final commit message
  // Note: storyTitle and jiraKey are passed as git commit -m arguments,
  // not interpolated into a shell command, preventing injection
  const finalMessage = `feat(${jiraKey}): ${storyTitle}

Squashed ${checkpointCommits.length} checkpoint commits.

Co-Authored-By: Claude <noreply@anthropic.com>`;

  // Soft reset to the parent, keeping all changes staged
  validateCommitRef(parentSha);
  gitExec(repoPath, ["reset", "--soft", parentSha]);

  // Create the squashed commit (message passed as argument, not shell interpolated)
  gitExec(repoPath, ["commit", "-m", finalMessage]);

  const finalSha = gitExec(repoPath, ["rev-parse", "HEAD"]);

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
    return gitExec(repoPath, ["diff", "--stat", "HEAD~1"]);
  } catch {
    // No previous commit to diff against
    return gitExec(repoPath, ["diff", "--stat"]);
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
    // Validate the commit reference if provided
    if (sinceCommit) {
      validateCommitRef(sinceCommit);
    }
    const output = gitExec(repoPath, ["diff", "--name-only", ref]);
    return output ? output.split("\n").filter(Boolean) : [];
  } catch {
    // Fallback: get all tracked files with modifications
    const output = gitExec(repoPath, ["status", "--porcelain"]);
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
  const output = gitExec(repoPath, ["status", "--porcelain"]);

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
  return gitExec(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

/**
 * Creates the story branch if it doesn't exist.
 * SECURITY: Validates branch names to prevent command injection.
 */
export function ensureStoryBranch(
  repoPath: string,
  branchName: string,
  baseBranch: string = "main"
): void {
  // Validate branch names before use
  validateBranchName(branchName);
  validateBranchName(baseBranch);

  // Check if branch exists
  try {
    gitExec(repoPath, ["rev-parse", "--verify", branchName]);
    // Branch exists, switch to it
    gitExec(repoPath, ["checkout", branchName]);
  } catch {
    // Branch doesn't exist, create it from base
    gitExec(repoPath, ["checkout", "-b", branchName, baseBranch]);
  }
}

/**
 * Pushes the current branch to origin.
 * SECURITY: Validates branch name to prevent command injection.
 */
export function pushBranch(repoPath: string, branchName: string): void {
  validateBranchName(branchName);
  gitExec(repoPath, ["push", "-u", "origin", branchName]);
}

/**
 * Force pushes (needed after squash).
 * SECURITY: Validates branch name to prevent command injection.
 */
export function forcePushBranch(repoPath: string, branchName: string): void {
  validateBranchName(branchName);
  gitExec(repoPath, ["push", "-f", "origin", branchName]);
}
