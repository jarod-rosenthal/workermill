/**
 * Orchestrator Utilities — Shared constants, helpers, and state
 *
 * Extracted from orchestrator.ts to eliminate the monolith.
 * Used by: orchestrator.ts, task-claimer.ts, planning-workflow.ts,
 * task-dispatch.ts, worker-spawner.ts, task-monitor.ts,
 * manager-workflow.ts, task-cleanup.ts
 */

import { ECSClient, DescribeTasksCommand } from "@aws-sdk/client-ecs";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { AppDataSource } from "../db/connection.js";
import {
  WorkerTask,
  Organization,
  WorkerTaskLog,
} from "../models/index.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import type { WorkerTaskStatus } from "../models/WorkerTask.js";

// =============================================================================
// Task State Machine
// =============================================================================

/**
 * Valid state transitions for worker tasks.
 * Key: current status, Value: array of valid next statuses
 *
 * This is used for logging invalid transitions, not blocking them (yet).
 * Once we're confident the state machine is correct, we can make it blocking.
 */
export const VALID_TRANSITIONS: Record<WorkerTaskStatus, WorkerTaskStatus[]> = {
  // Planning states
  planning: ["pending_plan_approval", "queued", "failed", "cancelled"],
  pending_plan_approval: ["queued", "planning", "failed", "cancelled"], // Can re-plan

  // Execution states
  queued: ["dispatching", "claimed", "blocked", "failed", "cancelled"],
  dispatching: ["environment_setup", "executing", "failed", "cancelled"],
  claimed: ["environment_setup", "executing", "failed", "cancelled"],
  environment_setup: ["executing", "failed", "cancelled"],
  executing: [
    "pr_created", "review_requested", "deploying", "completed",
    "escalated", "failed", "cancelled", "manager_review"
  ],
  consolidating: ["pr_created", "review_requested", "completed", "failed", "cancelled"],
  deploying: ["deployed", "completed", "failed", "cancelled"],

  // Waiting states
  blocked: ["queued", "executing", "failed", "cancelled"],
  pr_created: ["review_requested", "pr_approved", "manager_review", "queued", "failed", "cancelled"],
  review_requested: ["pr_approved", "queued", "failed", "cancelled"],
  manager_review: ["review_approved", "revision_needed", "review_rejected", "failed", "cancelled"],
  revision_needed: ["queued", "executing", "failed", "cancelled"],
  pr_approved: ["queued", "deploying", "deployed", "completed", "failed", "cancelled"],
  review_approved: ["queued", "deploying", "deployed", "completed", "failed", "cancelled"],
  escalated: ["queued", "failed", "cancelled", "completed"],

  // Terminal states (no valid transitions out)
  completed: [],
  deployed: [],
  failed: ["queued"], // Allow retry
  cancelled: [],
  review_rejected: [],
};

/**
 * Validate a task status transition against the state machine.
 * Returns false and logs a warning for invalid transitions.
 *
 * @param task - The task being updated
 * @param newStatus - The proposed new status
 * @returns true if the transition is valid, false otherwise
 */
export function validateStatusTransition(
  task: WorkerTask,
  newStatus: WorkerTaskStatus
): boolean {
  const currentStatus = task.status as WorkerTaskStatus;
  const validNextStatuses = VALID_TRANSITIONS[currentStatus] || [];

  if (!validNextStatuses.includes(newStatus) && currentStatus !== newStatus) {
    logger.warn("Invalid status transition blocked", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      currentStatus,
      newStatus,
      validTransitions: validNextStatuses,
    });
    return false;
  }

  return true;
}

// =============================================================================
// Planning Agent Visibility
// =============================================================================

/**
 * Provider icons for log visibility (consistent with worker/epic/executor.ts)
 */
export const PROVIDER_ICONS: Record<string, string> = {
  anthropic: "🤖",
  openai: "🔷",
  google: "🔵",
  gemini: "🔵",
  ollama: "🏠",
};

/**
 * Get formatted log prefix for planning agent output.
 * Format: [💡 planning_agent 🔷] for planning + provider visibility
 */
export function getPlanningAgentPrefix(provider: string): string {
  const providerIcon = PROVIDER_ICONS[provider] || "🤖";
  return `[💡 planning_agent ${providerIcon}]`;
}

// =============================================================================
// Repository Getters
// =============================================================================

export const getOrgRepo = () => AppDataSource.getRepository(Organization);
export const getTaskRepo = () => AppDataSource.getRepository(WorkerTask);
export const getLogRepo = () => AppDataSource.getRepository(WorkerTaskLog);

// =============================================================================
// Task Helpers
// =============================================================================

/**
 * Check if a task is in dry-run mode
 * Dry-run mode simulates the workflow without making real changes to Jira, Git, or spawning workers
 */
export function isDryRunTask(task: WorkerTask): boolean {
  const labels = (task.jiraFields as Record<string, unknown>)?.labels;
  return Array.isArray(labels) && labels.includes("dry-run");
}

/**
 * Log a task event to the database for real-time streaming
 */
export async function logTaskEvent(
  taskId: string,
  type: "status_change" | "system" | "error" | "info",
  message: string,
  options?: {
    severity?: "debug" | "info" | "warning" | "error";
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const logRepo = getLogRepo();
    const logData = WorkerTaskLog.create(taskId, type, message, {
      severity: options?.severity || "info",
      metadata: options?.metadata,
    });
    const log = logRepo.create(logData);
    await logRepo.save(log);
  } catch (error) {
    logger.error("Failed to save task log", { taskId, message, error });
  }
}

// =============================================================================
// Orchestrator State
// =============================================================================

export interface OrchestratorState {
  running: boolean;
  lastPollAt: Date | null;
  tasksProcessed: number;
  errors: number;
}

export const state: OrchestratorState = {
  running: false,
  lastPollAt: null,
  tasksProcessed: 0,
  errors: 0,
};

// =============================================================================
// Concurrency Tracking
// =============================================================================

/** Active fire-and-forget operations for graceful shutdown + concurrency cap */
export const activeOps = new Set<Promise<unknown>>();
const MAX_ACTIVE_OPS = 10;

/**
 * Track a fire-and-forget operation.
 * Returns false if too many operations are in flight (caller should skip).
 */
export function trackOperation(op: Promise<unknown>): boolean {
  if (activeOps.size >= MAX_ACTIVE_OPS) {
    logger.warn("Orchestrator concurrency cap reached, skipping spawn", {
      activeOps: activeOps.size,
      max: MAX_ACTIVE_OPS,
    });
    return false;
  }
  activeOps.add(op);
  op.finally(() => activeOps.delete(op));
  return true;
}

// =============================================================================
// AWS Clients (shared across orchestrator modules)
// =============================================================================

export const ecsClient = new ECSClient({ region: config.aws.region });
export const s3Client = new S3Client({ region: config.aws.region });

// Re-export AWS commands used by multiple modules
export { DescribeTasksCommand, ListObjectsV2Command, DeleteObjectCommand };

// =============================================================================
// Branch Naming Helpers
// =============================================================================

/**
 * Standardized branch naming for PRD workflows
 */
export function getFeatureBranch(jiraKey: string): string {
  return `feature/${jiraKey.toLowerCase()}`;
}

/**
 * Get branch name for a specific story in a multi-story workflow
 */
export function getStoryBranch(jiraKey: string, storyIndex: number): string {
  return `feature/${jiraKey.toLowerCase()}/story-${storyIndex}`;
}

// =============================================================================
// File Dependency Enforcement
// =============================================================================

/**
 * Validate file-based dependencies between stories.
 * If two stories target the same file, add a synthetic dependency
 * to enforce sequential execution and prevent merge conflicts.
 */
export function enforceFileDependencies(plan: any): any {
  if (!plan.stories || plan.stories.length <= 1) {
    return plan;
  }

  // Build a map of file -> list of story indices that target it
  const fileToStories = new Map<string, number[]>();

  for (const story of plan.stories) {
    const targetFiles = story.targetFiles || [];
    for (const file of targetFiles) {
      if (!fileToStories.has(file)) {
        fileToStories.set(file, []);
      }
      fileToStories.get(file)!.push(story.index);
    }
  }

  // For each file targeted by multiple stories, ensure sequential dependency
  for (const [file, storyIndices] of fileToStories.entries()) {
    if (storyIndices.length > 1) {
      // Sort indices to process in order
      const sorted = storyIndices.sort((a, b) => a - b);

      logger.info("Detected shared file across multiple stories", {
        file,
        storyIndices: sorted,
        storyCount: sorted.length,
      });

      // For each story after the first, ensure it depends on the previous story targeting this file
      for (let i = 1; i < sorted.length; i++) {
        const currentIndex = sorted[i];
        const previousIndex = sorted[i - 1];
        const currentStory = plan.stories.find(
          (s: any) => s.index === currentIndex,
        );

        if (currentStory) {
          const currentDeps = currentStory.dependencies || [];

          // Check if this story already depends on the previous story
          const alreadyDepends =
            currentDeps.includes(previousIndex) ||
            currentDeps.includes(String(previousIndex));

          if (!alreadyDepends) {
            // Add synthetic dependency to prevent merge conflicts
            if (!Array.isArray(currentStory.dependencies)) {
              currentStory.dependencies = [];
            }
            currentStory.dependencies = [...currentDeps, previousIndex];

            logger.info("Added synthetic file-based dependency", {
              currentStoryIndex: currentIndex,
              dependsOnStoryIndex: previousIndex,
              file,
              reason: "Both stories target the same file",
            });
          }
        }
      }
    }
  }

  return plan;
}
