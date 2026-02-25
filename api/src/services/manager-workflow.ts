/**
 * Manager Workflow — Virtual Manager review, log analysis, and deployment approval
 *
 * Extracted from orchestrator.ts.
 * Used by: orchestrator.ts (pollLoop)
 *
 * Contains:
 * - findTasksNeedingManagerReview(): Find tasks with PRs needing manager review
 * - findTasksNeedingLogAnalysis(): Find completed tasks needing log analysis
 * - findApprovedTasksNeedingDeployment(): Find approved tasks ready for deployment
 * - requeueForDeployment(): Re-queue an approved task for deployment run
 * - spawnManagerReview(): Spawn Manager ECS task for PR review
 * - spawnManagerLogAnalysis(): Spawn Manager ECS task for log analysis
 * - monitorManagerTasks(): Detect manager ECS task completions
 */

import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/index.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { getECSTaskRunner } from "./ecs-task-runner.js";
import { localEpicSpawner } from "./local-epic-spawner.js";
import {
  getOrgCredentials,
  getManagerGitHubToken,
} from "./org-credentials.js";
import {
  getTaskRepo,
  logTaskEvent,
  ecsClient,
  DescribeTasksCommand,
} from "./orchestrator-utils.js";
import { postTicketComment } from "../utils/ticket-comments.js";

/**
 * Find tasks that need manager review (PR created with review label)
 */
export async function findTasksNeedingManagerReview(): Promise<WorkerTask[]> {
  const taskRepo = getTaskRepo();

  // Find tasks needing manager review (have 'review' label, skipManagerReview=false)
  // Statuses:
  //   - pr_created: Worker created PR, waiting for review
  //   - review_requested: Legacy status, same as pr_created
  //   - pr_approved: GitHub approved but needs manager review before deployment
  // and that don't already have a manager ECS task running
  //
  // IMPORTANT: Exclude Epic (parallel) and Multi-Expert (multi-expert) execution modes
  // because they have their own inline Tech Lead review built-in.
  // Virtual Manager review is only for V1 single-worker tasks.
  const tasks = await taskRepo
    .createQueryBuilder("task")
    .where("task.status IN (:...statuses)", {
      statuses: ["pr_created", "review_requested", "pr_approved"],
    })
    .andWhere("task.skip_manager_review = :skip", { skip: false })
    .andWhere("task.github_pr_number IS NOT NULL")
    .andWhere(
      "(task.manager_ecs_task_arn IS NULL OR task.manager_ecs_task_arn = '')",
    )
    // Exclude Epic and Multi-Expert modes - they have inline Tech Lead review
    .andWhere(
      "(task.execution_mode IS NULL OR task.execution_mode NOT IN (:...excludedModes))",
      { excludedModes: ["parallel", "multi-expert"] },
    )
    .orderBy("task.created_at", "ASC")
    .limit(3)
    .getMany();

  return tasks;
}

/**
 * Find tasks that need manager log analysis (completed/failed with manager label)
 * This is the "training wheels" mode for new environments
 */
export async function findTasksNeedingLogAnalysis(): Promise<WorkerTask[]> {
  const taskRepo = getTaskRepo();

  // Find tasks that:
  // - Have manager_enabled=true (manager label)
  // - Are completed or failed (terminal states where we can analyze what happened)
  // - Haven't had log analysis done yet
  // - Completed within the last hour (don't analyze old tasks)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const tasks = await taskRepo
    .createQueryBuilder("task")
    .where("task.manager_enabled = :enabled", { enabled: true })
    .andWhere("task.status IN (:...statuses)", {
      statuses: ["completed", "failed", "deployed"],
    })
    .andWhere("task.manager_analysis_done = :done", { done: false })
    .andWhere("task.completed_at > :cutoff", { cutoff: oneHourAgo })
    .orderBy("task.completed_at", "ASC")
    .limit(2)
    .getMany();

  return tasks;
}

/**
 * Find tasks in approved status that need deployment
 * These are tasks where:
 * - PR was approved (via GitHub webhook → pr_approved)
 * - OR Manager approved (via review workflow → review_approved)
 * - Task has deploy label (deploymentEnabled=true) OR went through manager review
 * - But wasn't re-queued for deployment
 */
export async function findApprovedTasksNeedingDeployment(): Promise<
  WorkerTask[]
> {
  const taskRepo = getTaskRepo();

  // SAFETY: Only process recently approved tasks (within last hour)
  // This prevents bulk re-queueing of old stuck tasks after bug fixes
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Find tasks that are approved but haven't been re-queued for deployment
  // - review_approved: Manager approved → ready for deployment
  // - pr_approved + skipManagerReview=true: GitHub approved, no manager needed → ready for deployment
  // IMPORTANT: pr_approved + skipManagerReview=false should go to manager review first!
  const tasks = await taskRepo
    .createQueryBuilder("task")
    .where(
      "(task.status = :reviewApproved OR (task.status = :prApproved AND task.skip_manager_review = :skip))",
      {
        reviewApproved: "review_approved",
        prApproved: "pr_approved",
        skip: true,
      },
    )
    .andWhere("task.github_pr_number IS NOT NULL")
    .andWhere("task.updated_at > :cutoff", { cutoff: oneHourAgo })
    .orderBy("task.updated_at", "ASC")
    .limit(5)
    .getMany();

  return tasks;
}

/**
 * Re-queue an approved task for deployment run
 */
export async function requeueForDeployment(task: WorkerTask): Promise<void> {
  const taskRepo = getTaskRepo();

  logger.info("Re-queuing approved task for deployment", {
    taskId: task.id,
    jiraIssueKey: task.jiraIssueKey,
    prNumber: task.githubPrNumber,
  });

  await logTaskEvent(
    task.id,
    "status_change",
    "Re-queuing for deployment (deploy label detected)",
    {
      severity: "info",
      metadata: { prNumber: task.githubPrNumber },
    },
  );

  // Atomic update — avoids clobbering concurrent changes from orchestrator
  await taskRepo
    .createQueryBuilder()
    .update(WorkerTask)
    .set({
      status: "queued" as WorkerTask["status"],
      taskNotes: `DEPLOYMENT_RUN: PR #${task.githubPrNumber} approved. Deploy and merge.`,
      completedAt: null,
      startedAt: null,
      ecsTaskArn: null,
      ecsTaskId: null,
    } as Record<string, unknown>)
    .where("id = :id", { id: task.id })
    .execute();

  logger.info("Task re-queued for deployment", {
    taskId: task.id,
    jiraIssueKey: task.jiraIssueKey,
  });
}

/**
 * Monitor all manager ECS tasks and detect completion via ECS status
 * When manager task stops, reads decision markers from logs and updates task status
 */
export async function monitorManagerTasks(): Promise<void> {
  // Skip ECS monitoring in local mode
  if (localEpicSpawner.isLocalMode()) {
    return;
  }

  const taskRepo = getTaskRepo();

  // Find tasks in manager_review status with a manager ECS task
  const managerTasks = await taskRepo
    .createQueryBuilder("task")
    .where("task.status = :status", { status: "manager_review" })
    .andWhere("task.manager_ecs_task_arn IS NOT NULL")
    .limit(10)
    .getMany();

  if (managerTasks.length === 0) return;

  // Batch describe ECS tasks for efficiency
  const taskArns = managerTasks
    .map((t) => t.managerEcsTaskArn!)
    .filter(Boolean);
  if (taskArns.length === 0) return;

  const ecsTasksMap: Map<
    string,
    { lastStatus: string; exitCode: number; stoppedAt?: Date }
  > = new Map();

  try {
    const describeResult = await ecsClient.send(
      new DescribeTasksCommand({
        cluster: config.aws.ecsCluster,
        tasks: taskArns,
      }),
    );

    for (const ecsTask of describeResult.tasks || []) {
      const container = ecsTask.containers?.find(
        (c) => c.name === "worker",
      );
      ecsTasksMap.set(ecsTask.taskArn!, {
        lastStatus: ecsTask.lastStatus || "UNKNOWN",
        exitCode: container?.exitCode ?? -1,
        stoppedAt: ecsTask.stoppedAt,
      });
    }
  } catch (error) {
    logger.error("Error describing manager ECS tasks", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  for (const task of managerTasks) {
    try {
      const ecsInfo = ecsTasksMap.get(task.managerEcsTaskArn!);

      if (!ecsInfo) {
        // ECS task not found - might have been cleaned up, check logs for decision
        logger.warn(
          "Manager ECS task not found, checking logs for decision",
          {
            taskId: task.id,
          },
        );
      } else if (ecsInfo.lastStatus !== "STOPPED") {
        // Manager still running
        continue;
      }

      logger.info("Detected Manager ECS task completion", {
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        exitCode: ecsInfo?.exitCode,
      });

      // Read decision markers from task logs
      const logs = await AppDataSource.query(
        `SELECT message FROM worker_task_logs
         WHERE task_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [task.id],
      );

      let detectedDecision: string | null = null;
      let detectedScore: number | null = null;
      let detectedFeedback: string | null = null;

      for (const log of logs) {
        const msg = log.message || "";

        // Look for manager decision marker
        const decisionMatch = msg.match(
          /::manager_decision::(approved|revision_needed|rejected|failed)/,
        );
        if (decisionMatch && !detectedDecision) {
          detectedDecision = decisionMatch[1];
        }

        // Look for score marker
        const scoreMatch = msg.match(/::manager_score::(\d+)/);
        if (scoreMatch && !detectedScore) {
          detectedScore = parseInt(scoreMatch[1], 10);
        }

        // Look for feedback marker
        const feedbackMatch = msg.match(/::manager_feedback::(.+)/);
        if (feedbackMatch && !detectedFeedback) {
          detectedFeedback = feedbackMatch[1];
        }
      }

      if (!detectedDecision) {
        // No decision marker found - if ECS task stopped, assume approved (no issues found)
        if (ecsInfo && ecsInfo.exitCode === 0) {
          detectedDecision = "approved";
          logger.info(
            "No manager decision marker found, defaulting to approved",
            { taskId: task.id },
          );
        } else if (ecsInfo) {
          detectedDecision = "failed";
          logger.warn("Manager task failed without decision marker", {
            taskId: task.id,
            exitCode: ecsInfo.exitCode,
          });
        } else {
          // No ECS info and no decision - skip for now
          continue;
        }
      }

      // Process the decision (must match manager-complete endpoint logic exactly)
      let newStatus: typeof task.status;
      switch (detectedDecision) {
        case "approved":
          // Manager approved - re-queue for deployment run (same as manager-complete endpoint)
          newStatus = "queued";
          task.taskNotes = `DEPLOYMENT_RUN: Manager approved PR. Deploy and merge.`;
          task.completedAt = null;
          task.ecsTaskArn = null;
          task.ecsTaskId = null;
          task.startedAt = null;
          logger.info(
            "Manager approved PR via log detection, re-queueing for deployment",
            { taskId: task.id },
          );
          break;

        case "revision_needed": {
          task.revisionCount = (task.revisionCount || 0) + 1;
          // Get org's maxReviewRevisions setting (use credentialsOrgId for platform tasks)
          const revisionCredentials = await getOrgCredentials(
            task.getCredentialsOrgId(),
          );
          const maxRevisions =
            revisionCredentials?.maxReviewRevisions ?? 0;
          if (task.canRevise(maxRevisions)) {
            newStatus = "queued";
            task.taskNotes = `REVISION_RUN: Manager requested changes (attempt ${task.revisionCount}/${maxRevisions}). Feedback: ${detectedFeedback || "See logs"}`;
            task.completedAt = null;
            task.ecsTaskArn = null;
            task.ecsTaskId = null;
            task.startedAt = null;
            logger.info(
              "Manager requested revision via log detection, re-queueing",
              {
                taskId: task.id,
                revisionCount: task.revisionCount,
                maxRevisions,
              },
            );
          } else {
            newStatus = "escalated";
            task.errorMessage = `Max revisions (${maxRevisions}) reached. Requires human intervention. Final feedback: ${detectedFeedback || "See logs"}`;
            logger.info(
              "Max revisions reached via log detection, escalating",
              {
                taskId: task.id,
                maxRevisions,
              },
            );
          }
          break;
        }

        case "rejected":
          newStatus = "review_rejected";
          task.errorMessage = `Rejected by Virtual Manager: ${detectedFeedback || "See logs"}`;
          logger.info("Manager rejected PR via log detection", {
            taskId: task.id,
          });
          break;

        case "failed":
        default:
          newStatus = "failed";
          task.errorMessage = "Manager review failed";
          break;
      }

      // Atomic update — avoids clobbering concurrent changes from orchestrator
      const updateFields: Record<string, unknown> = {
        status: newStatus,
        managerEcsTaskArn: null,
        managerEcsTaskId: null,
      };
      if (detectedFeedback) {
        updateFields.reviewFeedback = detectedFeedback;
      }
      // Carry forward fields mutated above (revisionCount, errorMessage, taskNotes, etc.)
      if (task.revisionCount !== undefined) updateFields.revisionCount = task.revisionCount;
      if (task.errorMessage !== undefined) updateFields.errorMessage = task.errorMessage;
      if (task.taskNotes !== undefined) updateFields.taskNotes = task.taskNotes;
      if (task.completedAt === null) updateFields.completedAt = null;
      if (task.startedAt === null) updateFields.startedAt = null;
      if (task.ecsTaskArn === null) updateFields.ecsTaskArn = null;
      if (task.ecsTaskId === null) updateFields.ecsTaskId = null;

      await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set(updateFields)
        .where("id = :id", { id: task.id })
        .execute();

      await logTaskEvent(
        task.id,
        "status_change",
        `Manager review completed via log detection: decision=${detectedDecision}, status=${newStatus}`,
        {
          severity:
            newStatus === "failed" || newStatus === "review_rejected"
              ? "error"
              : "info",
        },
      );

      // Post review decision as ticket comment
      if (task.jiraIssueKey) {
        let ticketComment: string;
        switch (detectedDecision) {
          case "approved":
            ticketComment = `✅ PR approved by Tech Lead (score: ${detectedScore || "N/A"}/10)${detectedFeedback ? `\n\n${detectedFeedback}` : ""}`;
            break;
          case "revision_needed":
            ticketComment = `🔄 Revision ${task.revisionCount || 1} requested by Tech Lead:\n\n${detectedFeedback || "See review for details"}`;
            break;
          case "rejected":
            ticketComment = `❌ PR rejected by Tech Lead:\n\n${detectedFeedback || "See review for details"}`;
            break;
          default:
            ticketComment = `Tech Lead review: ${detectedDecision}`;
        }
        postTicketComment(task.orgId, task.jiraIssueKey, ticketComment).catch((err) => {
          logger.warn("Failed to post manager review comment to ticket", {
            taskId: task.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      logger.info("Manager review completion detected and processed", {
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        newStatus,
        detectedDecision,
        detectedScore,
      });
    } catch (error) {
      logger.error("Error processing manager completion", {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Spawn a Manager ECS task for PR review
 */
export async function spawnManagerReview(task: WorkerTask): Promise<void> {
  // Skip in local mode - Epic Mode has inline Tech Lead review
  if (localEpicSpawner.isLocalMode()) {
    logger.info(
      "Skipping Manager spawn in local mode (inline review used)",
      {
        taskId: task.id,
      },
    );
    return;
  }

  const taskRepo = getTaskRepo();

  try {
    logger.info("Spawning Manager for PR review", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      prNumber: task.githubPrNumber,
    });

    await logTaskEvent(
      task.id,
      "status_change",
      "Virtual Manager starting PR review...",
    );

    // Get credentials for the org (needed to store manager provider/model)
    // Use credentialsOrgId for platform tasks
    const managerCredentials = await getOrgCredentials(
      task.getCredentialsOrgId(),
    );

    // Atomic update — avoids clobbering concurrent changes from orchestrator
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        status: "manager_review" as WorkerTask["status"],
        managerProvider: managerCredentials.managerProvider || "",
        managerModel: managerCredentials.managerModelId || "",
      } as Record<string, unknown>)
      .where("id = :id", { id: task.id })
      .execute();

    // Get separate manager GitHub token for PR approvals (avoids self-approval block)
    const managerToken = await getManagerGitHubToken();
    if (managerToken) {
      managerCredentials.githubToken = managerToken;
    }

    // Spawn Manager ECS task
    const runner = getECSTaskRunner();
    const result = await runner.runManagerTask(
      task,
      managerCredentials,
      "review_pr",
    );

    // Store manager ECS info — atomic update
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        managerEcsTaskArn: result.taskArn,
        managerEcsTaskId: result.taskId,
      } as Record<string, unknown>)
      .where("id = :id", { id: task.id })
      .execute();

    await logTaskEvent(
      task.id,
      "status_change",
      `Manager ECS task started: ${result.taskId}`,
    );

    logger.info("Manager task spawned successfully", {
      taskId: task.id,
      managerEcsTaskId: result.taskId,
    });
  } catch (error) {
    logger.error("Failed to spawn Manager task", {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });

    // Revert status — atomic update
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({ status: "pr_created" as WorkerTask["status"] })
      .where("id = :id", { id: task.id })
      .execute();

    await logTaskEvent(
      task.id,
      "error",
      `Failed to start Manager: ${error instanceof Error ? error.message : String(error)}`,
      { severity: "error" },
    );
  }
}

/**
 * Spawn a Manager ECS task for log analysis ("training wheels" mode)
 * Analyzes completed/failed tasks for environment issues
 */
export async function spawnManagerLogAnalysis(
  task: WorkerTask,
): Promise<void> {
  // Skip in local mode - log analysis not needed for local development
  if (localEpicSpawner.isLocalMode()) {
    logger.info("Skipping Manager log analysis in local mode", {
      taskId: task.id,
    });
    return;
  }

  const taskRepo = getTaskRepo();

  try {
    logger.info("Spawning Manager for log analysis", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      status: task.status,
    });

    await logTaskEvent(
      task.id,
      "info",
      "Virtual Manager analyzing execution logs...",
    );

    // Mark analysis as started (prevents duplicate spawns) — atomic update
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({ managerAnalysisDone: true })
      .where("id = :id", { id: task.id })
      .execute();

    // Get credentials for the org (use credentialsOrgId for platform tasks)
    const analysisCredentials = await getOrgCredentials(
      task.getCredentialsOrgId(),
    );

    // Get separate manager GitHub token (for consistency with PR review)
    const managerToken = await getManagerGitHubToken();
    if (managerToken) {
      analysisCredentials.githubToken = managerToken;
    }

    // Spawn Manager ECS task for log analysis
    const runner = getECSTaskRunner();
    const result = await runner.runManagerTask(
      task,
      analysisCredentials,
      "analyze_logs",
    );

    // Store manager ECS info (same as PR review) — atomic update
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        managerEcsTaskArn: result.taskArn,
        managerEcsTaskId: result.taskId,
      } as Record<string, unknown>)
      .where("id = :id", { id: task.id })
      .execute();

    await logTaskEvent(
      task.id,
      "info",
      `Manager log analysis started: ${result.taskId}`,
    );

    logger.info("Manager log analysis task spawned", {
      taskId: task.id,
      managerEcsTaskId: result.taskId,
    });
  } catch (error) {
    logger.error("Failed to spawn Manager log analysis", {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });

    // Reset flag so it can be retried — atomic update
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({ managerAnalysisDone: false })
      .where("id = :id", { id: task.id })
      .execute();

    await logTaskEvent(
      task.id,
      "error",
      `Failed to start Manager log analysis: ${error instanceof Error ? error.message : String(error)}`,
      { severity: "error" },
    );
  }
}
