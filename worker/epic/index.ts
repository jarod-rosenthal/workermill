/**
 * Epic Executor Entry Point
 *
 * Multi-agent collaboration service for WorkerMill.
 * Spawns multiple expert subagents that collaborate on an epic task.
 *
 * This is triggered when a task has the 'epic' label and EPIC_MODE=true.
 */

import "dotenv/config";
import { existsSync } from "fs";
import { join } from "path";
import { EpicCoordinator } from "./coordinator.js";
import { DecisionClient } from "./decision-client.js";
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
    "MAX_REVIEW_REVISIONS",
    "MAX_PER_STORY_REVISIONS",
  ];

  // Require ANTHROPIC_API_KEY unless we have OAuth credentials (local mode or Docker sandbox)
  // Docker sandbox mounts ~/.claude/.credentials.json — Claude CLI reads it directly
  const hasOAuth = !!process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    existsSync(join(process.env.HOME || process.env.USERPROFILE || "~", ".claude", ".credentials.json"));
  if (!isLocalMode && !hasOAuth) {
    required.push("ANTHROPIC_API_KEY");
  }
  // GITHUB_TOKEN may come from env in local mode
  if (!isLocalMode && !process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
    required.push("GITHUB_TOKEN");
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
    workerProvider: process.env.WORKER_PROVIDER || "anthropic",
    jiraIssueKey: process.env.JIRA_ISSUE_KEY || process.env.TICKET_KEY || "",
    ticketSystem:
      (process.env.TICKET_SYSTEM as "jira" | "linear" | "github" | "internal") || "jira",
    // Workflow control flags from Jira labels
    reviewEnabled: process.env.REVIEW_ENABLED === "true",
    deploymentEnabled: process.env.DEPLOYMENT_ENABLED === "true",
    improvementEnabled: process.env.IMPROVEMENT_ENABLED === "true",
    // Feedback from manager review (for revision runs)
    reviewFeedback: process.env.REVIEW_FEEDBACK || undefined,
    // Quality gate bypass (from bypass-quality-gate label)
    qualityGateBypass: process.env.QUALITY_GATE_BYPASS === "true",
    // Foundation card — skip integration fixer but pass gates to reviewer
    isFoundationCard: process.env.IS_FOUNDATION_CARD === "true",
    // Pre-commit quality gate commands (from board metadata, extracted from PRD)
    qualityGateCommands: process.env.QUALITY_GATE_COMMANDS
      ? JSON.parse(process.env.QUALITY_GATE_COMMANDS)
      : undefined,
    // CI workflow path for post-push gate (from board metadata)
    ciWorkflowPath: process.env.CI_WORKFLOW_PATH || undefined,
    // Max parallel experts cap
    maxParallelExperts: parseInt(process.env.MAX_PARALLEL_EXPERTS || "10", 10),
    maxFixRetries: process.env.MAX_FIX_RETRIES ? parseInt(process.env.MAX_FIX_RETRIES, 10) : undefined,
    maxAgentTurns: process.env.MAX_AGENT_TURNS ? parseInt(process.env.MAX_AGENT_TURNS, 10) : undefined,
    maxReviewRevisions: parseInt(process.env.MAX_REVIEW_REVISIONS || "0", 10),
    maxPerStoryRevisions: parseInt(process.env.MAX_PER_STORY_REVISIONS || "0", 10),
    // Intent Engineering — org guidelines from settings
    orgGuidelines: process.env.ORG_GUIDELINES || undefined,
    // Unified AIClient — routes through AIClient interface for multi-provider support
    // Anthropic: AnthropicAgentClient → runAgent() → Claude CLI (same as before)
    // Non-Anthropic: AISdkClient → ai-sdk-executor (enables Epic mode with any provider)
    useUnifiedClient: true,
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
    fileOverlapGatingEnabled: process.env.FILE_OVERLAP_GATING_ENABLED !== "false",
    incrementalRebaseEnabled: process.env.INCREMENTAL_REBASE_ENABLED !== "false",
    mergeAgentEnabled: process.env.MERGE_AGENT_ENABLED !== "false",
    blockerWaitTimeoutMs: parseInt(process.env.BLOCKER_WAIT_TIMEOUT_MINUTES || "20", 10) * 60_000,
  };
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("EPIC EXECUTOR - Multi-Agent Collaboration Service");
  console.log("Worker Image Build: 2026-02-27-qg");  // Quality gate enforcement build marker
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
    console.log("  - File overlap gating: " + (resilience.fileOverlapGatingEnabled ?? true));
    console.log("  - Incremental rebase: " + (resilience.incrementalRebaseEnabled ?? true));
    console.log("  - Merge agent: " + (resilience.mergeAgentEnabled ?? false));
    console.log("Quality Gate Config:");
    console.log("  - Pre-commit gates: " + (config.qualityGateCommands ? config.qualityGateCommands.length + " configured" : "NONE"));
    console.log("  - CI workflow path: " + (config.ciWorkflowPath || "NONE"));
    console.log("  - Quality gate bypass: " + (config.qualityGateBypass ? "YES" : "NO"));
    console.log("  - Foundation card: " + (config.isFoundationCard ? "YES (skip integration fixer)" : "NO"));
    console.log("Unified Client: ENABLED (multi-provider AIClient routing)");

    const decisionClient = new DecisionClient({
      apiBaseUrl: config.apiBaseUrl,
      orgApiKey: config.orgApiKey,
      logger: (msg, type) => console.log(msg),
    });

    const coordinator = new EpicCoordinator(config, resilience, decisionClient);

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
