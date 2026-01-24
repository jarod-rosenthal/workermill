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
import type { EpicConfig } from "./types.js";

/**
 * Load configuration from environment variables.
 */
function loadConfig(): EpicConfig {
  const required = [
    "PARENT_TASK_ID",
    "API_BASE_URL",
    "ORG_API_KEY",
    "ANTHROPIC_API_KEY",
    "GITHUB_TOKEN",
    "TARGET_REPO",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error("Missing required environment variables: " + missing.join(", "));
  }

  return {
    parentTaskId: process.env.PARENT_TASK_ID!,
    apiBaseUrl: process.env.API_BASE_URL!,
    orgApiKey: process.env.ORG_API_KEY!,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
    githubToken: process.env.GITHUB_TOKEN!,
    targetRepo: process.env.TARGET_REPO!,
    model: process.env.MODEL || "claude-sonnet-4-20250514",
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
    console.log("Parent Task ID: " + config.parentTaskId);
    console.log("Target Repo: " + config.targetRepo);
    console.log("API Base URL: " + config.apiBaseUrl);

    const coordinator = new EpicCoordinator(config);

    // Handle graceful shutdown
    const shutdown = () => {
      console.log("\n[Epic] Received shutdown signal");
      coordinator.stop();
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
