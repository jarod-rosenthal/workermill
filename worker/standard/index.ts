/**
 * Standard Executor Entry Point
 *
 * SDK-based executor for standard WorkerMill tasks.
 * This is triggered for Anthropic tasks without the 'epic' label.
 *
 * Environment Variables:
 * - TASK_ID: WorkerTask ID
 * - API_BASE_URL: WorkerMill API endpoint
 * - ORG_API_KEY: Organization API key
 * - ANTHROPIC_API_KEY: Claude API key
 * - GITHUB_TOKEN: GitHub access token
 * - TARGET_REPO: Repository to work on (owner/repo)
 * - WORKER_PERSONA: Persona to use
 * - WORKER_MODEL: Model to use (haiku, sonnet, opus)
 * - JIRA_ISSUE_KEY: Jira ticket key
 * - REVIEW_ENABLED: If true, run inline review
 * - DEPLOYMENT_ENABLED: If true, run inline deploy
 * - IMPROVEMENT_ENABLED: If true, run inline improve
 */

import "dotenv/config";
import { StandardExecutor } from "./executor.js";
import type { StandardConfig } from "./types.js";

/**
 * Load configuration from environment variables.
 */
function loadConfig(): StandardConfig {
  const required = [
    "TASK_ID",
    "API_BASE_URL",
    "ORG_API_KEY",
    "ANTHROPIC_API_KEY",
    "GITHUB_TOKEN",
    "TARGET_REPO",
    "WORKER_PERSONA",
    "MAX_REVIEW_REVISIONS",
    "MAX_PER_STORY_REVISIONS",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error("Missing required environment variables: " + missing.join(", "));
  }

  // Parse target/reference files from JSON if provided
  let targetFiles: string[] | undefined;
  let referenceFiles: string[] | undefined;

  try {
    if (process.env.TARGET_FILES) {
      targetFiles = JSON.parse(process.env.TARGET_FILES);
    }
  } catch {
    console.log("[Standard] Could not parse TARGET_FILES, ignoring");
  }

  try {
    if (process.env.REFERENCE_FILES) {
      referenceFiles = JSON.parse(process.env.REFERENCE_FILES);
    }
  } catch {
    console.log("[Standard] Could not parse REFERENCE_FILES, ignoring");
  }

  return {
    taskId: process.env.TASK_ID!,
    apiBaseUrl: process.env.API_BASE_URL!,
    orgApiKey: process.env.ORG_API_KEY!,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
    githubToken: process.env.SCM_TOKEN || process.env.GITHUB_TOKEN!,
    githubReviewerToken: process.env.GITHUB_REVIEWER_TOKEN,
    targetRepo: process.env.TARGET_REPO!,
    jiraIssueKey: process.env.JIRA_ISSUE_KEY || process.env.TICKET_KEY,
    ticketSummary: process.env.JIRA_SUMMARY || process.env.TICKET_SUMMARY,
    ticketDescription: process.env.JIRA_DESCRIPTION || process.env.TICKET_DESCRIPTION,
    persona: process.env.WORKER_PERSONA!,
    model: process.env.WORKER_MODEL || process.env.MODEL,
    branchName: process.env.BRANCH_NAME,
    baseBranch: process.env.BASE_BRANCH || process.env.TARGET_BRANCH,
    reviewEnabled: process.env.REVIEW_ENABLED === "true",
    deploymentEnabled: process.env.DEPLOYMENT_ENABLED === "true",
    improvementEnabled: process.env.IMPROVEMENT_ENABLED === "true",
    maxReviewRevisions: parseInt(process.env.MAX_REVIEW_REVISIONS!, 10),
    maxPerStoryRevisions: parseInt(process.env.MAX_PER_STORY_REVISIONS!, 10),
    reviewFeedback: process.env.REVIEW_FEEDBACK || process.env.REVISION_FEEDBACK,
    targetFiles,
    referenceFiles,
  };
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("STANDARD EXECUTOR - SDK-Based Task Execution");
  console.log("=".repeat(60));

  try {
    const config = loadConfig();

    console.log("Task ID: " + config.taskId);
    console.log("Persona: " + config.persona);
    console.log("Target Repo: " + config.targetRepo);
    console.log("Jira Issue: " + (config.jiraIssueKey || "N/A"));
    console.log("Model: " + (config.model || "sonnet (default)"));
    console.log("Review Enabled: " + config.reviewEnabled);
    console.log("Deploy Enabled: " + config.deploymentEnabled);
    console.log("Improve Enabled: " + config.improvementEnabled);

    const executor = new StandardExecutor(config);

    // Handle graceful shutdown
    const shutdown = () => {
      console.log("\n[Standard] Received shutdown signal");
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Execute the task
    const result = await executor.execute();

    if (result.success) {
      console.log("\n[Standard] Task completed successfully");
      if (result.prUrl) {
        console.log(`[Standard] PR URL: ${result.prUrl}`);
        // Output marker for orchestrator
        console.log(`::pr_url::${result.prUrl}`);
      }
      if (result.reviewResult) {
        console.log(`[Standard] Review: ${result.reviewResult}`);
      }
      if (result.deployResult) {
        console.log(`[Standard] Deploy: ${result.deployResult}`);
        if (result.deployResult === "deployed") {
          console.log("::result::deployed");
        }
      }
      if (result.improveResult) {
        console.log(`[Standard] Improve: ${result.improveResult.improvementsApplied} changes`);
      }

      // Output final result marker
      if (!result.deployResult || result.deployResult !== "deployed") {
        console.log("::result::review_requested");
      }

      process.exit(0);
    } else {
      console.error("\n[Standard] Task failed:", result.error);
      console.log("::result::failed");
      process.exit(1);
    }
  } catch (error) {
    console.error("[Standard] Fatal error:", error);
    console.log("::result::failed");
    process.exit(1);
  }
}

// Run
main();
