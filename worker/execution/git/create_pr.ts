#!/usr/bin/env npx ts-node

/**
 * Push current branch and create a pull request using GitHub CLI
 *
 * Inputs (environment variables):
 * - TICKET_KEY: Required. The ticket key (e.g., "PROJ-123")
 * - TICKET_SUMMARY: Required. The ticket summary/title
 * - DESCRIPTION: Optional. Additional PR description
 * - REPO_PATH: Optional. Path to the repository. Defaults to current directory
 * - BASE_BRANCH: Optional. Base branch for PR. Defaults to "main"
 * - DRAFT: Optional. Create as draft PR if "true"
 * - TICKET_BASE_URL: Optional. Base URL for ticket links (e.g., "https://company.atlassian.net/browse")
 *
 * Outputs (JSON to stdout):
 * - success: boolean
 * - prUrl: string - The PR URL
 * - prNumber: number - The PR number
 * - branch: string - The branch that was pushed
 * - wasRebased: boolean - Whether the branch was rebased
 * - error?: string - Error message if failed
 */

import { execSync, spawnSync } from "child_process";
import * as path from "path";

interface Output {
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  branch?: string;
  wasRebased?: boolean;
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

interface RebaseResult {
  success: boolean;
  hadConflicts: boolean;
  conflictFiles?: string[];
  wasAlreadyUpToDate?: boolean;
}

/**
 * Rebase current branch onto origin/main before pushing
 * This ensures we don't overwrite other workers' changes
 */
function rebaseOnMain(repoPath: string, baseBranch: string): RebaseResult {
  const scriptPath = path.join(__dirname, "rebase_on_main.ts");

  console.error(`[create_pr] Rebasing onto origin/${baseBranch} before push...`);

  const result = spawnSync("npx", ["ts-node", scriptPath], {
    cwd: repoPath,
    encoding: "utf-8",
    env: {
      ...process.env,
      REPO_PATH: repoPath,
      BASE_BRANCH: baseBranch,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  try {
    const output = JSON.parse(result.stdout || "{}");
    return {
      success: output.success || false,
      hadConflicts: output.hadConflicts || false,
      conflictFiles: output.conflictFiles,
      wasAlreadyUpToDate: output.wasAlreadyUpToDate,
    };
  } catch {
    return {
      success: result.status === 0,
      hadConflicts: result.stderr?.includes("rebase_conflict") || false,
    };
  }
}

async function main(): Promise<void> {
  const output: Output = { success: false };

  try {
    const ticketKey = process.env.TICKET_KEY;
    const ticketSummary = process.env.TICKET_SUMMARY;

    if (!ticketKey) {
      throw new Error("TICKET_KEY environment variable is required");
    }
    if (!ticketSummary) {
      throw new Error("TICKET_SUMMARY environment variable is required");
    }

    const repoPath = process.env.REPO_PATH || process.cwd();
    const description = process.env.DESCRIPTION || "";
    const baseBranch = process.env.BASE_BRANCH || "main";
    const isDraft = process.env.DRAFT === "true";
    const ticketBaseUrl = process.env.TICKET_BASE_URL || "";

    // Get current branch
    const currentBranch = exec("git rev-parse --abbrev-ref HEAD", repoPath);
    output.branch = currentBranch;

    if (currentBranch === baseBranch) {
      throw new Error(
        `Cannot create PR from ${baseBranch} branch. Switch to a feature branch first.`
      );
    }

    // Rebase onto latest main before pushing
    const rebaseResult = rebaseOnMain(repoPath, baseBranch);

    if (!rebaseResult.success) {
      if (rebaseResult.hadConflicts) {
        console.error(`::result::rebase_conflict`);
        console.error(`::conflict_files::${rebaseResult.conflictFiles?.join(",") || "unknown"}`);
        throw new Error(
          `Rebase conflict detected in files: ${rebaseResult.conflictFiles?.join(", ") || "unknown"}. ` +
          `Another worker's changes conflict with this branch. Task will be retried.`
        );
      }
      throw new Error("Rebase failed for unknown reason");
    }

    output.wasRebased = !rebaseResult.wasAlreadyUpToDate;
    if (output.wasRebased) {
      console.error(`[create_pr] Branch was rebased onto latest ${baseBranch}`);
    } else {
      console.error(`[create_pr] Branch was already up to date with ${baseBranch}`);
    }

    // Push the branch (force push needed after rebase)
    const pushCmd = output.wasRebased
      ? `git push -u origin ${currentBranch} --force-with-lease`
      : `git push -u origin ${currentBranch}`;
    exec(pushCmd, repoPath);

    // Build PR title and body
    const prTitle = `${ticketKey}: ${ticketSummary}`;

    // Create PR body with optional ticket link
    let prBody = `## Summary\n\n`;
    if (ticketBaseUrl) {
      const ticketLink = `${ticketBaseUrl}/${ticketKey}`;
      prBody += `Implements [${ticketKey}](${ticketLink}): ${ticketSummary}\n\n`;
    } else {
      prBody += `Implements ${ticketKey}: ${ticketSummary}\n\n`;
    }

    if (description) {
      prBody += `## Description\n\n${description}\n\n`;
    }

    prBody += `## Test Plan\n\n- [ ] TypeScript compiles without errors\n- [ ] Tests pass\n- [ ] Manual verification completed\n\n`;
    prBody += `---\n\n[WorkerMill] Generated by AI Worker`;

    // Create the PR using gh cli
    const draftFlag = isDraft ? "--draft" : "";
    const prCommand = `gh pr create --title "${prTitle.replace(/"/g, '\\"')}" --body "${prBody.replace(/"/g, '\\"')}" --base ${baseBranch} ${draftFlag}`;

    const prUrl = exec(prCommand, repoPath);
    output.prUrl = prUrl;

    // Extract PR number from URL
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
    if (prNumberMatch) {
      output.prNumber = parseInt(prNumberMatch[1], 10);
    }

    output.success = true;
  } catch (error: unknown) {
    output.error = error instanceof Error ? error.message : String(error);
  }

  // Output JSON for worker to parse
  console.log(JSON.stringify(output));

  // Output tagged markers for orchestrator
  if (output.success && output.prUrl) {
    console.error(`::pr_url::${output.prUrl}`);
    if (output.prNumber) {
      console.error(`::pr_number::${output.prNumber}`);
    }
    if (output.branch) {
      console.error(`::branch::${output.branch}`);
    }
    console.error(`::result::success_with_pr`);
  }

  process.exit(output.success ? 0 : 1);
}

main();
