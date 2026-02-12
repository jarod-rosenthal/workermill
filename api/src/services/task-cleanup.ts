/**
 * Task Cleanup — Periodic maintenance for stale, orphaned, and hung tasks
 *
 * Extracted from orchestrator.ts. Runs via cleanupLoop() started by startOrchestrator().
 * All functions are independent and can run in parallel.
 */

import { AppDataSource } from "../db/connection.js";
import {
  WorkerTask,
  WorkerTaskLog,
  WorkerCheckIn,
  type WorkerTaskStatus,
} from "../models/index.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { notifyTaskFailed } from "./notifications.js";
import { localEpicSpawner } from "./local-epic-spawner.js";
import { expireOldReferrals } from "./referral.js";
import {
  getOrgRepo,
  getTaskRepo,
  getLogRepo,
  logTaskEvent,
  state,
  ecsClient,
  s3Client,
  DescribeTasksCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "./orchestrator-utils.js";

/**
 * Clean up old task checkpoints from S3
 * Removes checkpoint files older than 7 days to prevent unbounded storage growth
 */
async function cleanupOldCheckpoints(): Promise<void> {
  try {
    const bucket = config.s3.checkpointBucket;
    const cutoffDays = 7;
    const cutoffTime = Date.now() - cutoffDays * 24 * 60 * 60 * 1000;

    let continuationToken: string | undefined;
    let totalDeleted = 0;
    let objectsScanned = 0;

    // List all checkpoint files in S3
    while (true) {
      const listCommand = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "", // List all objects
        ContinuationToken: continuationToken,
      });

      const listResponse = await s3Client.send(listCommand);
      const contents = listResponse.Contents || [];
      objectsScanned += contents.length;

      // Check each checkpoint file for age
      for (const obj of contents) {
        if (!obj.Key || !obj.LastModified) continue;

        // Skip non-checkpoint files (checkpoint files are in taskId/checkpoint.json format)
        if (!obj.Key.endsWith("/checkpoint.json")) continue;

        // Check if file is older than cutoff
        const lastModifiedTime = obj.LastModified.getTime();
        if (lastModifiedTime < cutoffTime) {
          // Delete the checkpoint file
          try {
            await s3Client.send(
              new DeleteObjectCommand({
                Bucket: bucket,
                Key: obj.Key,
              }),
            );
            totalDeleted++;
            logger.debug("Deleted old checkpoint file", {
              key: obj.Key,
              lastModified: obj.LastModified.toISOString(),
              ageHours: Math.floor(
                (Date.now() - lastModifiedTime) / (60 * 60 * 1000),
              ),
            });
          } catch (deleteError) {
            logger.warn("Failed to delete checkpoint file", {
              key: obj.Key,
              error:
                deleteError instanceof Error
                  ? deleteError.message
                  : String(deleteError),
            });
          }
        }
      }

      // Check for more results
      if (listResponse.IsTruncated && listResponse.NextContinuationToken) {
        continuationToken = listResponse.NextContinuationToken;
      } else {
        break;
      }
    }

    if (totalDeleted > 0) {
      logger.info("Cleaned up old checkpoints from S3", {
        deletedCount: totalDeleted,
        objectsScanned,
        cutoffDays,
        bucket,
      });
    }
  } catch (error) {
    logger.error("Failed to clean up old checkpoints", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Clean up old task logs based on per-organization retention settings
 * Runs hourly to prevent unbounded database growth
 */
async function cleanupOldLogs(): Promise<void> {
  try {
    const logRepo = getLogRepo();
    const orgRepo = getOrgRepo();
    const taskRepo = getTaskRepo();

    // Get all organizations
    const orgs = await orgRepo.find();

    let totalDeleted = 0;

    for (const org of orgs) {
      const retentionDays = org.logRetentionDays || 30;
      const cutoffDate = new Date(
        Date.now() - retentionDays * 24 * 60 * 60 * 1000,
      );

      // Delete logs for tasks belonging to this organization using raw SQL subquery
      const result = await logRepo
        .createQueryBuilder()
        .delete()
        .from(WorkerTaskLog)
        .where(
          "task_id IN (SELECT id FROM worker_tasks WHERE org_id = :orgId)",
          { orgId: org.id },
        )
        .andWhere("created_at < :cutoff", { cutoff: cutoffDate })
        .execute();

      if (result.affected && result.affected > 0) {
        logger.info("Cleaned up old task logs for organization", {
          orgId: org.id,
          orgName: org.name,
          deletedCount: result.affected,
          retentionDays,
          cutoffDate: cutoffDate.toISOString(),
        });
        totalDeleted += result.affected;
      }
    }

    if (totalDeleted > 0) {
      logger.info("Total task logs cleaned up", { totalDeleted });
    }
  } catch (error) {
    logger.error("Failed to clean up old logs", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Fail orphaned tasks that are stuck in non-terminal states
 *
 * Orphaned tasks are ones that:
 * 1. Are in claimed/environment_setup/executing status
 * 2. Either have no ECS ARN (and spawn time exceeded), or their ECS task no longer exists
 *
 * This prevents webhooks from being blocked by stuck tasks
 */
export async function failOrphanedTasks(): Promise<void> {
  // Skip orphan detection in local mode - ECS ARN checks don't apply
  if (localEpicSpawner.isLocalMode()) {
    return;
  }

  const taskRepo = getTaskRepo();
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000); // Buffer for spawn time
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000); // Timeout for dispatching tasks

  try {
    // Find all tasks in active states (including dispatching for PRD orchestration)
    const activeTasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.status IN (:...statuses)", {
        statuses: ["claimed", "environment_setup", "executing", "dispatching"],
      })
      .andWhere("task.claimed_by_agent IS NULL")
      .limit(20)
      .getMany();

    if (activeTasks.length === 0) return;

    // Handle dispatching tasks separately - they're orphaned if stuck for 10+ min with no children
    const orphanedDispatchingTasks = activeTasks.filter(
      (t) =>
        t.status === "dispatching" &&
        t.updatedAt < tenMinutesAgo &&
        (!t.childTaskIds || t.childTaskIds.length === 0),
    );

    // Fail orphaned dispatching tasks (parent task that failed to create children)
    for (const task of orphanedDispatchingTasks) {
      logger.warn(
        "Failing orphaned dispatching task (no child tasks created)",
        {
          taskId: task.id,
          jiraIssueKey: task.jiraIssueKey,
          status: task.status,
          updatedAt: task.updatedAt,
          childTaskIds: task.childTaskIds,
        },
      );

      const errorMsg = `Task orphaned: stuck in 'dispatching' status for ${Math.round((Date.now() - task.updatedAt.getTime()) / 60000)} minutes without creating child tasks`;
      await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "failed" as WorkerTaskStatus,
          completedAt: new Date(),
          errorMessage: errorMsg,
        })
        .where("id = :id AND status NOT IN (:...terminal)", {
          id: task.id,
          terminal: ["completed", "failed", "cancelled"],
        })
        .execute();
      task.status = "failed";
      task.errorMessage = errorMsg;
      await notifyTaskFailed(task);
      await logTaskEvent(task.id, "error", task.errorMessage, {
        severity: "error",
      });
    }

    // Filter out dispatching tasks from normal orphan processing (they don't have ECS ARNs)
    const nonDispatchingTasks = activeTasks.filter(
      (t) => t.status !== "dispatching",
    );

    // Split into tasks with and without ECS ARN
    // - Tasks WITH ARN: check immediately if ECS task exists (no delay needed)
    // - Tasks WITHOUT ARN: only check if they've been stuck for 2+ min (allow spawn time)
    const tasksWithArn = nonDispatchingTasks.filter((t) => t.ecsTaskArn);
    const tasksWithoutArn = nonDispatchingTasks.filter(
      (t) => !t.ecsTaskArn && t.updatedAt < twoMinutesAgo,
    );

    // Batch describe ECS tasks
    const existingEcsArns = new Set<string>();
    if (tasksWithArn.length > 0) {
      try {
        const describeResult = await ecsClient.send(
          new DescribeTasksCommand({
            cluster: config.aws.ecsCluster,
            tasks: tasksWithArn.map((t) => t.ecsTaskArn!),
          }),
        );
        // ECS tasks that exist (even if stopped) are in the response
        for (const ecsTask of describeResult.tasks || []) {
          if (ecsTask.taskArn) {
            existingEcsArns.add(ecsTask.taskArn);
          }
        }
      } catch (error) {
        logger.warn("Error describing ECS tasks for orphan check", {
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with tasks without ARN only
      }
    }

    // Count dispatching tasks that were already failed above
    let failedCount = orphanedDispatchingTasks.length;

    // Fail tasks without ECS ARN (never spawned properly)
    for (const task of tasksWithoutArn) {
      logger.warn("Failing orphaned task (no ECS ARN)", {
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        status: task.status,
        updatedAt: task.updatedAt,
      });

      const errorMsg = `Task orphaned: stuck in '${task.status}' status without ECS task for ${Math.round((Date.now() - task.updatedAt.getTime()) / 60000)} minutes`;
      await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "failed" as WorkerTaskStatus,
          completedAt: new Date(),
          errorMessage: errorMsg,
        })
        .where("id = :id AND status NOT IN (:...terminal)", {
          id: task.id,
          terminal: ["completed", "failed", "cancelled"],
        })
        .execute();
      task.status = "failed";
      task.errorMessage = errorMsg;
      await notifyTaskFailed(task);
      await logTaskEvent(task.id, "error", task.errorMessage, {
        severity: "error",
      });
      failedCount++;
    }

    // Fail tasks whose ECS task no longer exists
    for (const task of tasksWithArn) {
      if (!existingEcsArns.has(task.ecsTaskArn!)) {
        logger.warn("Failing orphaned task (ECS task not found)", {
          taskId: task.id,
          jiraIssueKey: task.jiraIssueKey,
          status: task.status,
          ecsTaskArn: task.ecsTaskArn,
          updatedAt: task.updatedAt,
        });

        const errorMsg = `Task orphaned: ECS task ${task.ecsTaskId || task.ecsTaskArn} no longer exists`;
        await taskRepo
          .createQueryBuilder()
          .update(WorkerTask)
          .set({
            status: "failed" as WorkerTaskStatus,
            completedAt: new Date(),
            errorMessage: errorMsg,
          })
          .where("id = :id AND status NOT IN (:...terminal)", {
            id: task.id,
            terminal: ["completed", "failed", "cancelled"],
          })
          .execute();
        task.status = "failed";
        task.errorMessage = errorMsg;
        await notifyTaskFailed(task);
        await logTaskEvent(task.id, "error", task.errorMessage, {
          severity: "error",
        });
        failedCount++;
      }
    }

    if (failedCount > 0) {
      logger.info("Failed orphaned tasks", { count: failedCount });
    }
  } catch (error) {
    logger.error("Error in failOrphanedTasks", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Fail hung tasks with stale or missing heartbeats
 *
 * This catches tasks where:
 * 1. The ECS container is still running (not caught by failOrphanedTasks)
 * 2. But the worker inside hasn't sent a heartbeat in 10+ minutes
 * 3. OR the worker never sent a check-in at all (executing for 10+ min with no heartbeat)
 *
 * This indicates the worker is hung (infinite loop, deadlock, API unavailable, etc.)
 * The task is failed WITHOUT auto-retry - user can manually re-queue if desired.
 */
export async function failHungTasks(): Promise<void> {
  const taskRepo = getTaskRepo();
  const checkInRepo = AppDataSource.getRepository(WorkerCheckIn);

  // 10 minute threshold - tasks without heartbeat for 10+ min are considered hung
  const HUNG_THRESHOLD_MS = 10 * 60 * 1000;
  const hungThreshold = new Date(Date.now() - HUNG_THRESHOLD_MS);

  try {
    // Find tasks in executing status using LEFT JOIN to catch:
    // 1. Tasks with stale heartbeats (heartbeat_at < threshold)
    // 2. Tasks with NO check-in at all (ci.task_id IS NULL) that have been executing 10+ min
    const hungTasks = await taskRepo
      .createQueryBuilder("task")
      .leftJoin(
        WorkerCheckIn,
        "ci",
        "ci.task_id = task.id"
      )
      .where("task.status = :status", { status: "executing" })
      .andWhere("task.claimed_by_agent IS NULL")
      .andWhere(
        "(ci.heartbeat_at < :threshold OR (ci.task_id IS NULL AND task.updated_at < :threshold))",
        { threshold: hungThreshold }
      )
      .select([
        "task.id",
        "task.jiraIssueKey",
        "task.status",
        "task.ecsTaskArn",
        "task.updatedAt",
        "ci.heartbeatAt",
        "ci.taskId",
      ])
      .limit(10)
      .getRawMany();

    if (hungTasks.length === 0) return;

    let failedCount = 0;

    for (const row of hungTasks) {
      const taskId = row.task_id;
      const jiraIssueKey = row.task_jiraIssueKey || row.task_jira_issue_key;
      const heartbeatAt = row.ci_heartbeatAt || row.ci_heartbeat_at;
      const updatedAt = row.task_updatedAt || row.task_updated_at;
      const ecsTaskArn = row.task_ecsTaskArn || row.task_ecs_task_arn;
      const hasCheckIn = row.ci_taskId || row.ci_task_id;

      // Calculate minutes since last activity
      const referenceTime = heartbeatAt ? new Date(heartbeatAt) : new Date(updatedAt);
      const minutesSinceActivity = Math.round(
        (Date.now() - referenceTime.getTime()) / 60000
      );

      const reason = hasCheckIn
        ? `stale heartbeat (last: ${minutesSinceActivity} min ago)`
        : `no heartbeat ever received (executing for ${minutesSinceActivity} min)`;

      logger.warn("Failing hung task", {
        taskId,
        jiraIssueKey,
        ecsTaskArn,
        heartbeatAt: heartbeatAt || null,
        hasCheckIn: !!hasCheckIn,
        minutesSinceActivity,
        reason,
      });

      // Fetch the full task to update
      const task = await taskRepo.findOne({ where: { id: taskId } });
      if (!task) continue;

      // Don't fail if status changed while we were processing
      if (task.status !== "executing") {
        logger.info("Task status changed, skipping hung check", {
          taskId,
          currentStatus: task.status,
        });
        continue;
      }

      const errorMsg = hasCheckIn
        ? `Worker hung: no heartbeat for ${minutesSinceActivity} minutes. The worker may have crashed, hit an infinite loop, or lost API connectivity. Re-queue the task to retry.`
        : `Worker hung: no heartbeat received after ${minutesSinceActivity} minutes. The worker may have failed to start, crashed early, or lost API connectivity. Re-queue the task to retry.`;
      await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "failed" as WorkerTaskStatus,
          completedAt: new Date(),
          errorMessage: errorMsg,
        })
        .where("id = :id AND status = :expected", {
          id: taskId,
          expected: "executing",
        })
        .execute();
      task.status = "failed";
      task.errorMessage = errorMsg;
      await notifyTaskFailed(task);

      await logTaskEvent(task.id, "error", task.errorMessage, {
        severity: "error",
      });

      // Clean up any stale check-in (if exists)
      if (hasCheckIn) {
        await checkInRepo.delete({ taskId });
      }

      failedCount++;
    }

    if (failedCount > 0) {
      logger.info("Failed hung tasks", { count: failedCount });
    }
  } catch (error) {
    logger.error("Error in failHungTasks", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Cleanup stuck planning tasks
 *
 * This handles two scenarios:
 * 1. Tasks in `pending_plan_approval` status that have been waiting for human approval
 *    for more than 7 days - fail them with a timeout message
 * 2. Tasks in `planning` status with `planStatus = "pending_approval"` that have been
 *    stuck for more than 30 minutes (indicating the planning agent crashed) - reset them
 *    so they can be re-planned
 */
async function cleanupStuckPlanningTasks(): Promise<void> {
  const taskRepo = getTaskRepo();

  // Thresholds
  const PLAN_APPROVAL_TIMEOUT_DAYS = 7;
  const PLANNING_STUCK_TIMEOUT_MINUTES = 30;

  const sevenDaysAgo = new Date(
    Date.now() - PLAN_APPROVAL_TIMEOUT_DAYS * 24 * 60 * 60 * 1000,
  );
  const thirtyMinutesAgo = new Date(
    Date.now() - PLANNING_STUCK_TIMEOUT_MINUTES * 60 * 1000,
  );

  try {
    // Issue 11: Fail tasks stuck in `pending_plan_approval` for more than 7 days
    const timedOutApprovalTasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.status = :status", { status: "pending_plan_approval" })
      .andWhere("task.updatedAt < :cutoff", { cutoff: sevenDaysAgo })
      .andWhere("task.claimed_by_agent IS NULL")
      .limit(20)
      .getMany();

    for (const task of timedOutApprovalTasks) {
      const daysSinceUpdate = Math.round(
        (Date.now() - task.updatedAt.getTime()) / (24 * 60 * 60 * 1000),
      );

      logger.warn("Failing task due to plan approval timeout", {
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        status: task.status,
        updatedAt: task.updatedAt,
        daysSinceUpdate,
      });

      const errorMsg2 = `Plan approval timed out after ${daysSinceUpdate} days. The plan was never approved or rejected.`;
      await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "failed" as WorkerTaskStatus,
          completedAt: new Date(),
          errorMessage: errorMsg2,
        })
        .where("id = :id AND status = :expected", {
          id: task.id,
          expected: "pending_plan_approval",
        })
        .execute();
      task.status = "failed";
      task.errorMessage = errorMsg2;
      await notifyTaskFailed(task);
      await logTaskEvent(task.id, "error", task.errorMessage, {
        severity: "error",
      });
    }

    // Issue 12: Reset tasks stuck in `planning` with `planStatus = "pending_approval"` for more than 30 minutes
    // This indicates the planning agent crashed after creating a plan but before transitioning to pending_plan_approval
    const stuckPlanningTasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.status = :status", { status: "planning" })
      .andWhere("task.planStatus = :planStatus", {
        planStatus: "pending_approval",
      })
      .andWhere("task.updatedAt < :cutoff", { cutoff: thirtyMinutesAgo })
      .andWhere("task.claimed_by_agent IS NULL")
      .limit(20)
      .getMany();

    for (const task of stuckPlanningTasks) {
      const minutesSinceUpdate = Math.round(
        (Date.now() - task.updatedAt.getTime()) / (60 * 1000),
      );

      logger.warn("Resetting stuck planning task for re-planning", {
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        status: task.status,
        planStatus: task.planStatus,
        updatedAt: task.updatedAt,
        minutesSinceUpdate,
      });

      // Reset planStatus to null so it can be re-claimed by the planning loop — atomic update
      await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          planStatus: null,
          planJson: null,
          planningNotes: null,
        } as Record<string, unknown>)
        .where("id = :id AND status = :expected AND plan_status = :planStatus", {
          id: task.id,
          expected: "planning",
          planStatus: "pending_approval",
        })
        .execute();
      await logTaskEvent(
        task.id,
        "system",
        `Task reset for re-planning after being stuck for ${minutesSinceUpdate} minutes. The planning agent may have crashed.`,
        { severity: "warning" },
      );
    }

    const totalProcessed =
      timedOutApprovalTasks.length + stuckPlanningTasks.length;
    if (totalProcessed > 0) {
      logger.info("Cleaned up stuck planning tasks", {
        timedOutApprovals: timedOutApprovalTasks.length,
        resetForReplanning: stuckPlanningTasks.length,
      });
    }
  } catch (error) {
    logger.error("Error in cleanupStuckPlanningTasks", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Release tasks claimed by dead remote agents.
 * If a remote agent crashes without releasing its tasks, the heartbeat will go stale.
 * After 10 minutes with no heartbeat, release the task back to the queue.
 */
async function releaseStaleAgentTasks(): Promise<void> {
  const taskRepo = getTaskRepo();
  const STALE_HEARTBEAT_MINUTES = 10;
  const cutoff = new Date(Date.now() - STALE_HEARTBEAT_MINUTES * 60 * 1000);

  try {
    // Find tasks claimed by a remote agent with stale heartbeat
    // Includes "executing" — if the agent dies mid-execution, failOrphanedTasks and
    // failHungTasks skip agent-claimed tasks, so this is the only cleanup path.
    const staleTasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.claimed_by_agent IS NOT NULL")
      .andWhere("task.status IN (:...statuses)", {
        statuses: ["planning", "queued", "claimed", "executing"],
      })
      .andWhere("task.agent_heartbeat_at < :cutoff", { cutoff })
      .limit(10)
      .getMany();

    for (const task of staleTasks) {
      const minutesSinceHeartbeat = Math.round(
        (Date.now() - (task.agentHeartbeatAt?.getTime() || 0)) / (60 * 1000),
      );

      logger.warn("Releasing task from dead remote agent", {
        taskId: task.id,
        claimedByAgent: task.claimedByAgent,
        status: task.status,
        minutesSinceHeartbeat,
      });

      if (task.status === "executing") {
        // Fail executing tasks — can't safely resume mid-execution
        const errorMessage = `Remote agent lost (no heartbeat for ${minutesSinceHeartbeat} minutes). Task was mid-execution and cannot be safely resumed.`;
        await taskRepo
          .createQueryBuilder()
          .update(WorkerTask)
          .set({
            claimedByAgent: null as unknown as string,
            agentHeartbeatAt: null as unknown as Date,
            status: "failed" as WorkerTask["status"],
            errorMessage,
            completedAt: new Date(),
          })
          .where("id = :id AND claimed_by_agent = :agent", {
            id: task.id,
            agent: task.claimedByAgent,
          })
          .execute();

        await notifyTaskFailed(task);
        await logTaskEvent(task.id, "error", errorMessage, { severity: "error" });
      } else {
        // Release pre-execution tasks back to their appropriate state
        const resetStatus = task.executionPlanV2 ? "queued" : "planning";
        await taskRepo
          .createQueryBuilder()
          .update(WorkerTask)
          .set({
            claimedByAgent: null as unknown as string,
            agentHeartbeatAt: null as unknown as Date,
            status: resetStatus as WorkerTask["status"],
          })
          .where("id = :id AND claimed_by_agent = :agent", {
            id: task.id,
            agent: task.claimedByAgent,
          })
          .execute();

        await logTaskEvent(
          task.id,
          "system",
          `Task released from remote agent (no heartbeat for ${minutesSinceHeartbeat} minutes). Re-queued for processing.`,
          { severity: "warning" },
        );
      }
    }

    if (staleTasks.length > 0) {
      logger.info("Released stale remote agent tasks", { count: staleTasks.length });
    }
  } catch (error) {
    logger.error("Error in releaseStaleAgentTasks", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Cleanup loop - runs hourly
 * Cleans up old logs and checkpoints to prevent unbounded growth
 */
export async function cleanupLoop(): Promise<void> {
  while (state.running) {
    // Run cleanup tasks in parallel
    await Promise.all([
      cleanupOldLogs(),
      cleanupOldCheckpoints(),
      failOrphanedTasks(),
      cleanupStuckPlanningTasks(),
      releaseStaleAgentTasks(),
      expireOldReferrals().catch((error) => {
        logger.error("Error expiring old referrals", {
          error: error instanceof Error ? error.message : String(error),
        });
      }),
    ]).catch((error) => {
      logger.error("Error during cleanup operations", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    // Run every hour
    await new Promise((resolve) => setTimeout(resolve, 60 * 60 * 1000));
  }
}
