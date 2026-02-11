/**
 * Virtual Manager Entry Point
 *
 * Agent SDK-based Virtual Manager for WorkerMill.
 * Handles PR code review and log analysis using Claude Agent SDK.
 *
 * This replaces the shell-based manager-entrypoint.sh with a
 * pure TypeScript implementation that runs everything in one process.
 */

import "dotenv/config";
import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { PRReviewer } from "./reviewer.js";
import type { ManagerConfig, ManagerAction } from "./types.js";

/**
 * Load configuration from environment variables.
 */
function loadConfig(): ManagerConfig {
  const required = [
    "TASK_ID",
    "MANAGER_ACTION",
    "ANTHROPIC_API_KEY",
    "GITHUB_TOKEN",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error("Missing required environment variables: " + missing.join(", "));
  }

  const action = process.env.MANAGER_ACTION as ManagerAction;
  if (action !== "review_pr" && action !== "analyze_logs") {
    throw new Error(`Invalid MANAGER_ACTION: ${action}. Must be 'review_pr' or 'analyze_logs'`);
  }

  // Determine model - use configured or default based on action
  let model = process.env.CLAUDE_MODEL || process.env.MANAGER_MODEL;
  if (!model) {
    model = action === "review_pr" ? "opus" : "haiku";
  }

  return {
    taskId: process.env.TASK_ID!,
    action,
    apiBaseUrl: process.env.API_BASE_URL || "https://workermill.com",
    orgApiKey: process.env.ORG_API_KEY || "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
    githubToken: process.env.SCM_TOKEN || process.env.GITHUB_TOKEN!,
    githubRepo: process.env.GITHUB_REPO || "",
    model,
    prNumber: process.env.PR_NUMBER,
    prUrl: process.env.PR_URL,
    jiraIssueKey: process.env.JIRA_ISSUE_KEY,
    jiraSummary: process.env.JIRA_SUMMARY,
    jiraDescription: process.env.JIRA_DESCRIPTION,
    reviewFeedback: process.env.REVIEW_FEEDBACK,
  };
}

/**
 * Build SCM-aware credential URL.
 */
function buildCredentialUrl(token: string): string {
  const scmProvider = process.env.SCM_PROVIDER || "github";
  const bitbucketUsername = process.env.BITBUCKET_USERNAME || "";

  if (scmProvider === "bitbucket" && bitbucketUsername) {
    // URL-encode both username and password (may contain special chars like @ and =)
    const encodedUsername = encodeURIComponent(bitbucketUsername);
    const encodedPassword = encodeURIComponent(token);
    return `https://${encodedUsername}:${encodedPassword}@bitbucket.org`;
  } else if (scmProvider === "gitlab") {
    return `https://oauth2:${token}@gitlab.com`;
  }
  return `https://x-access-token:${token}@github.com`;
}

/**
 * Configure git credentials.
 */
function configureGit(token: string): void {
  console.log("[Manager] Configuring git...");

  // Set up git credential store
  execSync("git config --global credential.helper store", { stdio: "inherit" });

  // Write credentials file based on SCM provider
  const credentialsPath = `${process.env.HOME}/.git-credentials`;
  writeFileSync(credentialsPath, `${buildCredentialUrl(token)}\n`);

  // Set git identity
  execSync('git config --global user.name "Virtual Manager"', { stdio: "inherit" });
  execSync(`git config --global user.email "${process.env.AUTHOR_EMAIL || "ai-manager@workermill.com"}"`, { stdio: "inherit" });

  // Configure gh CLI (only for GitHub)
  if ((process.env.SCM_PROVIDER || "github") === "github") {
    process.env.GH_TOKEN = token;
    try {
      execSync(`echo "${token}" | gh auth login --with-token`, { stdio: "pipe" });
      console.log("[Manager] GitHub CLI authenticated");
    } catch {
      console.log("[Manager] GitHub CLI auth skipped (may already be configured)");
    }
  }
}

/**
 * Clone repository for PR review.
 */
function cloneRepository(repo: string, token: string): string {
  const repoDir = "/workspace/repo";

  if (existsSync(repoDir)) {
    console.log(`[Manager] Repository already exists at ${repoDir}`);
    return repoDir;
  }

  console.log(`[Manager] Cloning ${repo}...`);
  mkdirSync("/workspace", { recursive: true });

  const cloneUrl = `${buildCredentialUrl(token)}/${repo}.git`;
  execSync(`git clone "${cloneUrl}" "${repoDir}"`, { stdio: "inherit" });

  console.log("[Manager] Clone successful");
  return repoDir;
}

/**
 * Post log to API.
 */
async function postLog(
  config: ManagerConfig,
  message: string,
  type: string = "system"
): Promise<void> {
  console.log(`[Manager] ${message}`);

  if (!config.apiBaseUrl || !config.orgApiKey) return;

  try {
    const response = await fetch(`${config.apiBaseUrl}/api/control-center/logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.orgApiKey,
      },
      body: JSON.stringify({
        taskId: config.taskId,
        type,
        message: `[Manager] ${message}`,
        severity: "info",
      }),
    });
    if (!response.ok) {
      console.log(`[Manager] Log post failed: ${response.status}`);
    }
  } catch {
    // Ignore log failures
  }
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("VIRTUAL MANAGER - Agent SDK Mode");
  console.log("=".repeat(60));

  try {
    const config = loadConfig();

    console.log(`Task ID: ${config.taskId}`);
    console.log(`Action: ${config.action}`);
    console.log(`Repository: ${config.githubRepo}`);
    console.log(`Model: ${config.model}`);

    await postLog(config, "Starting Virtual Manager (Agent SDK)");
    await postLog(config, `Action: ${config.action}`);

    // Configure git
    configureGit(config.githubToken);

    if (config.action === "review_pr") {
      // Validate PR-specific requirements
      if (!config.prNumber) {
        throw new Error("PR_NUMBER is required for review_pr action");
      }
      if (!config.githubRepo) {
        throw new Error("GITHUB_REPO is required for review_pr action");
      }

      // Clone repository
      const repoPath = cloneRepository(config.githubRepo, config.githubToken);

      // Run PR review
      const reviewer = new PRReviewer(config, repoPath);
      const result = await reviewer.review();

      if (result.success) {
        console.log("[Manager] PR review completed successfully");
        console.log(`[Manager] Decision: ${result.decision}`);
        await postLog(config, `Review complete: ${result.decision}`);
      } else {
        console.error("[Manager] PR review failed:", result.error);
        await postLog(config, `Review failed: ${result.error}`, "error");
        process.exit(1);
      }
    } else if (config.action === "analyze_logs") {
      // Log analysis - TODO: implement with Agent SDK
      console.log("[Manager] Log analysis not yet implemented in Agent SDK mode");
      await postLog(config, "Log analysis not yet implemented in Agent SDK mode");

      // For now, fall back to shell script or skip
      console.log("[Manager] Skipping log analysis");
      process.exit(0);
    }

    console.log("[Manager] Virtual Manager session ended");
    process.exit(0);
  } catch (error) {
    console.error("[Manager] Fatal error:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[Manager] Received SIGINT, shutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[Manager] Received SIGTERM, shutting down...");
  process.exit(0);
});

// Run
main();
