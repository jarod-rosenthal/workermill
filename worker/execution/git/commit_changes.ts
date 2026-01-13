***REMOVED***!/usr/bin/env npx ts-node

/**
 * Stage and commit changes to the repository
 *
 * Inputs (environment variables):
 * - REPO_PATH: Optional. Path to the repository. Defaults to current directory
 * - COMMIT_MESSAGE or MESSAGE: Required. Commit message (COMMIT_MESSAGE takes precedence)
 * - FILES: Optional. Comma-separated list of files to stage. If not specified, stages all changes
 * - AUTHOR_NAME: Optional. Git author name. Defaults to "AI Worker"
 * - AUTHOR_EMAIL: Optional. Git author email. Defaults to "ai-worker@workermill.com"
 * - ALLOW_EMPTY: Optional. Allow empty commits if "true". Defaults to "false"
 *
 * Outputs (JSON to stdout):
 * - success: boolean
 * - commitHash: string - The full commit hash
 * - commitHashShort: string - The short commit hash (7 chars)
 * - filesChanged: number - Number of files changed
 * - insertions: number - Lines added
 * - deletions: number - Lines deleted
 * - branch: string - Current branch name
 * - error?: string - Error message if failed
 */

import { execSync } from "child_process";

interface Output {
  success: boolean;
  commitHash?: string;
  commitHashShort?: string;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
  branch?: string;
  error?: string;
}

function exec(cmd: string, cwd?: string, env?: NodeJS.ProcessEnv): string {
  return execSync(cmd, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  }).trim();
}

function execSafe(cmd: string, cwd?: string, env?: NodeJS.ProcessEnv): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
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

async function main(): Promise<void> {
  const output: Output = { success: false };

  try {
    const repoPath = process.env.REPO_PATH || process.cwd();
    // Accept both COMMIT_MESSAGE (documented) and MESSAGE (legacy) for backwards compatibility
    const message = process.env.COMMIT_MESSAGE || process.env.MESSAGE;
    const files = process.env.FILES;
    const authorName = process.env.AUTHOR_NAME || "AI Worker";
    const authorEmail = process.env.AUTHOR_EMAIL || "ai-worker@workermill.com";
    const allowEmpty = process.env.ALLOW_EMPTY === "true";

    if (!message) {
      throw new Error("COMMIT_MESSAGE (or MESSAGE) environment variable is required");
    }

    // Get current branch
    const branch = exec("git rev-parse --abbrev-ref HEAD", repoPath);
    output.branch = branch;

    console.error(`[commit_changes] Committing to branch: ${branch}`);

    // Configure git author for this commit
    const gitEnv = {
      GIT_AUTHOR_NAME: authorName,
      GIT_AUTHOR_EMAIL: authorEmail,
      GIT_COMMITTER_NAME: authorName,
      GIT_COMMITTER_EMAIL: authorEmail,
    };

    // Stage files
    if (files) {
      // Stage specific files
      const fileList = files.split(",").map((f) => f.trim()).filter((f) => f);
      console.error(`[commit_changes] Staging ${fileList.length} specific files`);
      for (const file of fileList) {
        const addResult = execSafe(`git add "${file}"`, repoPath);
        if (addResult.exitCode !== 0) {
          console.error(`[commit_changes] Warning: Could not stage ${file}: ${addResult.stderr}`);
        }
      }
    } else {
      // Stage all changes
      console.error(`[commit_changes] Staging all changes`);
      exec("git add -A", repoPath);
    }

    // Check if there are staged changes
    const statusResult = execSafe("git diff --cached --stat", repoPath);
    const hasStagedChanges = statusResult.stdout.length > 0;

    if (!hasStagedChanges && !allowEmpty) {
      throw new Error("No changes to commit. Use ALLOW_EMPTY=true to create an empty commit.");
    }

    // Parse stats from staged diff
    if (hasStagedChanges) {
      const statLines = statusResult.stdout.split("\n");
      const summaryLine = statLines[statLines.length - 1];

      // Parse "X files changed, Y insertions(+), Z deletions(-)"
      const filesMatch = summaryLine.match(/(\d+)\s+files?\s+changed/);
      const insertionsMatch = summaryLine.match(/(\d+)\s+insertions?\(\+\)/);
      const deletionsMatch = summaryLine.match(/(\d+)\s+deletions?\(-\)/);

      output.filesChanged = filesMatch ? parseInt(filesMatch[1]) : 0;
      output.insertions = insertionsMatch ? parseInt(insertionsMatch[1]) : 0;
      output.deletions = deletionsMatch ? parseInt(deletionsMatch[1]) : 0;

      console.error(
        `[commit_changes] Changes: ${output.filesChanged} files, +${output.insertions}/-${output.deletions} lines`
      );
    }

    // Create the commit
    // Use -m flag with proper escaping
    const escapedMessage = message.replace(/"/g, '\\"');
    const commitCmd = allowEmpty
      ? `git commit --allow-empty -m "${escapedMessage}"`
      : `git commit -m "${escapedMessage}"`;

    const commitResult = execSafe(commitCmd, repoPath, gitEnv);

    if (commitResult.exitCode !== 0) {
      // Check for common issues
      if (commitResult.stderr.includes("nothing to commit")) {
        throw new Error("No changes to commit");
      }
      if (commitResult.stderr.includes("Please tell me who you are")) {
        throw new Error("Git author not configured. Set AUTHOR_NAME and AUTHOR_EMAIL.");
      }
      throw new Error(`Commit failed: ${commitResult.stderr || commitResult.stdout}`);
    }

    // Get the commit hash
    const commitHash = exec("git rev-parse HEAD", repoPath);
    const commitHashShort = exec("git rev-parse --short HEAD", repoPath);

    output.commitHash = commitHash;
    output.commitHashShort = commitHashShort;
    output.success = true;

    console.error(`[commit_changes] Created commit ${commitHashShort}`);
  } catch (error: unknown) {
    output.error = error instanceof Error ? error.message : String(error);
    console.error(`[commit_changes] Error: ${output.error}`);
  }

  console.log(JSON.stringify(output));

  // Output markers for orchestrator
  if (output.success) {
    console.error(`::commit_hash::${output.commitHash}`);
    console.error(`::commit_hash_short::${output.commitHashShort}`);
    if (output.filesChanged) {
      console.error(`::files_changed::${output.filesChanged}`);
    }
  }

  process.exit(output.success ? 0 : 1);
}

main();
