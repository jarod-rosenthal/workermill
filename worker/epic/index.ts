/**
 * Epic Executor Entry Point
 *
 * Multi-agent collaboration service for WorkerMill.
 * Spawns multiple expert subagents that collaborate on an epic task.
 *
 * This is triggered when a task has the 'epic' label and EPIC_MODE=true.
 */

import "dotenv/config";
import { EpicCoordinator } from "./coordinator.js";
import type { EpicConfig, ResilienceConfig } from "./types.js";

/**
 * Load configuration from environment variables.
 */
function loadConfig(): EpicConfig {
  // Local mode: Claude CLI uses its own OAuth from ~/.claude/
  // No API key needed - just check EXECUTION_MODE
  const isLocalMode = process.env.EXECUTION_MODE === "local";

  const required = [
    "PARENT_TASK_ID",
    "API_BASE_URL",
    "ORG_API_KEY",
    "TARGET_REPO",
  ];

  // Only require ANTHROPIC_API_KEY and GITHUB_TOKEN for cloud mode
  // Local mode uses Claude CLI OAuth and env GITHUB_TOKEN
  if (!isLocalMode) {
    required.push("ANTHROPIC_API_KEY");
    // GITHUB_TOKEN may come from env in local mode
    if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
      required.push("GITHUB_TOKEN");
    }
  }

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error("Missing required environment variables: " + missing.join(", "));
  }

  // Log execution mode
  if (isLocalMode) {
    console.log("[Epic] Running in LOCAL MODE (Claude CLI OAuth)");
    console.log("[Epic] GitHub Token: " + (process.env.GITHUB_TOKEN ? "✓ set" : "✗ missing"));
  } else {
    console.log("[Epic] Running in CLOUD MODE (Anthropic API)");
  }

  return {
    parentTaskId: process.env.PARENT_TASK_ID!,
    apiBaseUrl: process.env.API_BASE_URL!,
    orgApiKey: process.env.ORG_API_KEY!,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
    githubToken: process.env.SCM_TOKEN || process.env.GITHUB_TOKEN!,
    // Separate token for PR reviews (avoids GitHub self-approval restriction)
    githubReviewerToken: process.env.GITHUB_REVIEWER_TOKEN || undefined,
    targetRepo: process.env.TARGET_REPO!,
    model: process.env.WORKER_MODEL || process.env.MODEL,  // Worker model for story execution (inline-reviewer uses MANAGER_MODEL separately)
    jiraIssueKey: process.env.JIRA_ISSUE_KEY || process.env.TICKET_KEY || "",
    ticketSystem:
      (process.env.TICKET_SYSTEM as "jira" | "linear" | "github") || "jira",
    // Workflow control flags from Jira labels
    reviewEnabled: process.env.REVIEW_ENABLED === "true",
    deploymentEnabled: process.env.DEPLOYMENT_ENABLED === "true",
    improvementEnabled: process.env.IMPROVEMENT_ENABLED === "true",
    // Feedback from manager review (for revision runs)
    reviewFeedback: process.env.REVIEW_FEEDBACK || undefined,
    // Quality gate bypass (from bypass-quality-gate label)
    qualityGateBypass: process.env.QUALITY_GATE_BYPASS === "true",
    // Max parallel experts cap
    maxParallelExperts: parseInt(process.env.MAX_PARALLEL_EXPERTS || "4", 10),
    // Quality gate thresholds from organization settings
    qualityThresholds: process.env.QUALITY_THRESHOLDS
      ? JSON.parse(process.env.QUALITY_THRESHOLDS)
      : undefined,
  };
}

/**
 * Load resilience configuration from environment variables.
 */
function loadResilienceConfig(): ResilienceConfig {
  return {
    blockerMaxAutoRetries: parseInt(process.env.BLOCKER_MAX_AUTO_RETRIES || "3", 10),
    blockerAutoRetryEnabled: process.env.BLOCKER_AUTO_RETRY_ENABLED !== "false",
    pushAfterCommit: process.env.PUSH_AFTER_COMMIT !== "false",
    gracefulShutdownEnabled: process.env.GRACEFUL_SHUTDOWN_ENABLED !== "false",
    selfReviewEnabled: process.env.SELF_REVIEW_ENABLED === "true",
  };
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("EPIC EXECUTOR - Multi-Agent Collaboration Service");
  console.log("=".repeat(60));

  try {
    const config = loadConfig();
    const resilience = loadResilienceConfig();

    console.log("Parent Task ID: " + config.parentTaskId);
    console.log("Target Repo: " + config.targetRepo);
    console.log("API Base URL: " + config.apiBaseUrl);
    console.log("Model: " + (config.model || "not set - will use expert defaults"));
    console.log("Resilience Settings:");
    console.log("  - Auto-retry enabled: " + resilience.blockerAutoRetryEnabled);
    console.log("  - Max auto-retries: " + resilience.blockerMaxAutoRetries);
    console.log("  - Push after commit: " + resilience.pushAfterCommit);
    console.log("  - Graceful shutdown: " + resilience.gracefulShutdownEnabled);
    console.log("  - Self-review enabled: " + resilience.selfReviewEnabled);

    const coordinator = new EpicCoordinator(config, resilience);

    // Handle graceful shutdown
    let shutdownInProgress = false;
    const shutdown = async () => {
      if (shutdownInProgress) return;
      shutdownInProgress = true;

      console.log("\n[Epic] Received shutdown signal");
      await coordinator.gracefulShutdown();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Start the Epic executor
    await coordinator.start();

    console.log("[Epic] Epic session ended");
    process.exit(0);
  } catch (error) {
    console.error("[Epic] Fatal error:", error);
    process.exit(1);
  }
}

// Run
main();
