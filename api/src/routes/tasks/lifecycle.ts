import { Router, Request, Response } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask, WorkerTaskLog, WorkerContext, InternalTask, BoardColumn } from "../../models/index.js";
import { authenticateRequest } from "../../middleware/auth.js";
import { logger } from "../../utils/logger.js";
import { param, validateRequest } from "../../middleware/validation.js";
import { cascadeCancellationToChildren } from "../../services/task-monitor.js";
import { localEpicSpawner } from "../../services/local-epic-spawner.js";
import { getECSTaskRunner } from "../../services/ecs-task-runner.js";
import { normalizeRepoWithOwner } from "./helpers.js";

const router = Router();

// All routes require authentication
router.use(authenticateRequest);

/**
 * POST /api/tasks/:id/cancel
 * Cancel a running task
 */
router.post(
  "/:id/cancel",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = req.params.id as string;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id, orgId },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (task.isTerminal()) {
      res.status(400).json({ error: "Task is already complete" });
      return;
    }

    // Stop ECS task if running
    if (task.ecsTaskArn) {
      const runner = getECSTaskRunner();
      await runner.stopTask(task.ecsTaskArn, "Cancelled by user");
    }

    // LOCAL MODE: Stop Docker container if running locally
    if (localEpicSpawner.isLocalMode()) {
      try {
        await localEpicSpawner.stopTask(task.id);
        logger.info("Stopped local worker container", { taskId: task.id });
      } catch (stopError) {
        logger.warn("Failed to stop local container (may have already exited)", {
          taskId: task.id,
          error: stopError,
        });
      }
    }

    // If this is a parent task (dispatching), also cancel all child tasks
    if (task.status === "dispatching" && task.childTaskIds && task.childTaskIds.length > 0) {
      const childTasks = await taskRepo.find({
        where: { parentTaskId: task.id },
      });

      const runner = getECSTaskRunner();
      for (const child of childTasks) {
        if (!child.isTerminal()) {
          // Stop ECS task if running
          if (child.ecsTaskArn) {
            try {
              await runner.stopTask(child.ecsTaskArn, "Parent cancelled by user");
            } catch (err) {
              logger.warn("Failed to stop child ECS task", { childId: child.id, err });
            }
          }
          child.status = "cancelled";
          child.completedAt = new Date();
          await taskRepo.save(child);
        }
      }

      logger.info("Cancelled child tasks", {
        parentId: id,
        childCount: childTasks.length,
      });
    }

    // Atomic cancellation — guard against concurrent state changes
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({ status: "cancelled", completedAt: new Date() } as Record<string, unknown>)
      .where("id = :id", { id })
      .execute();

    // Cascade cancellation to any blocked child tasks
    // This handles the case where children exist but are still blocked waiting on dependencies
    // The existing code above handles running/non-terminal children, this handles blocked ones
    if (task.childTaskIds && task.childTaskIds.length > 0) {
      try {
        const cascadeResult = await cascadeCancellationToChildren(task, "Parent task was cancelled");
        if (cascadeResult.cancelledCount > 0) {
          logger.info("Cascaded cancellation to blocked children", {
            parentId: id,
            cancelledCount: cascadeResult.cancelledCount,
          });
        }
      } catch (cascadeErr) {
        logger.warn("Failed to cascade cancellation to blocked children", { parentId: id, err: cascadeErr });
      }
    }

    logger.info("Task cancelled", { taskId: id, orgId });

    // DRY-RUN CLEANUP: Automatically delete simulated tasks when cancelled
    // This prevents orphaned dry-run child tasks from cluttering the task list
    const labels = (task.jiraFields as Record<string, unknown>)?.labels;
    const isDryRun = Array.isArray(labels) && labels.includes("dry-run");
    if (isDryRun && task.childTaskIds && task.childTaskIds.length > 0) {
      try {
        const logRepo = AppDataSource.getRepository(WorkerTaskLog);

        // Get child task IDs before deletion
        const childTasks = await taskRepo.find({
          where: { parentTaskId: task.id },
          select: ["id"],
        });
        const childIds = childTasks.map((c) => c.id);

        // Delete child tasks
        const deleteChildResult = await taskRepo.delete({
          parentTaskId: task.id,
        });

        // Delete logs for children and parent
        if (childIds.length > 0) {
          await logRepo.delete({ taskId: In(childIds) });
        }
        await logRepo.delete({ taskId: task.id });

        // Delete parent task
        await taskRepo.delete({ id: task.id });

        logger.info("[DRY RUN] Auto-cleanup on cancel completed", {
          parentTaskId: task.id,
          jiraIssueKey: task.jiraIssueKey,
          deletedChildren: deleteChildResult.affected,
        });

        // Return success (task was deleted)
        res.json({ message: "Dry-run task cancelled and cleaned up", deletedChildren: childIds.length });
        return;
      } catch (cleanupError) {
        logger.warn("[DRY RUN] Auto-cleanup on cancel failed", {
          parentTaskId: task.id,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
        // Continue to return the cancelled task even if cleanup failed
      }
    }

    res.json(task);
    } catch (error) {
      logger.error("Error cancelling task", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to cancel task" });
    }
  }
);

/**
 * POST /api/tasks/:id/retry
 * Retry a task - resets it to queued status for re-execution
 */
router.post(
  "/:id/retry",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = req.params.id as string;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id, orgId },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Allow retry for terminal and waiting states (not active states)
    const RETRYABLE_STATUSES = [
      "failed",
      "completed",
      "no_changes",
      "review_requested",
      "escalated",
      "cancelled",
      "deployed",
      "pr_approved",
      "pr_created",
      "planning",           // PRD planning phase
      "pending_plan_approval", // Waiting for plan approval
    ];

    if (!RETRYABLE_STATUSES.includes(task.status)) {
      res.status(400).json({
        error: "Task cannot be retried",
        reason: "Task is currently active",
      });
      return;
    }

    // Check if this task needs planning (PRD, V2 pipeline, epic, multi-provider)
    const labels = (task.jiraFields?.labels as string[] | undefined) || [];
    const isPrdTask = labels.includes("prd");
    const isEpicTask = labels.includes("epic");
    const isMultiProvider = labels.includes("multi-provider");
    const isV2Pipeline = task.pipelineVersion === "v2";
    const needsPlanning = isPrdTask || isEpicTask || isMultiProvider || isV2Pipeline;

    // Re-check for repo override label during retry (fixes label changes between runs)
    // Also supports direct repo name labels (e.g., "oncallshift-mobile")
    const org = req.organization!;
    let repoOverride: string | null = null;
    const repoLabel = labels.find((l: string) => l.toLowerCase().startsWith("repo:"));
    if (repoLabel) {
      repoOverride = repoLabel.substring(5); // Remove "repo:" prefix
    } else {
      // Check for direct repo name labels
      const defaultRepo = org.getDefaultRepo();
      const owner = defaultRepo?.split("/")[0];
      if (owner) {
        const knownRepoNames = ["oncallshift-mobile", "oncallshift-api", "oncallshift-web"];
        const repoNameLabel = labels.find((l) => knownRepoNames.includes(l.toLowerCase()));
        if (repoNameLabel) {
          repoOverride = `${owner}/${repoNameLabel.toLowerCase()}`;
        }
      }
    }
    if (repoOverride) {
      const newRepo = normalizeRepoWithOwner(repoOverride, org.getDefaultRepo());
      if (newRepo !== task.githubRepo) {
        logger.info("Updated githubRepo from label on retry", {
          taskId: id,
          repoLabel: repoLabel || repoOverride,
          oldRepo: task.githubRepo,
          newRepo,
        });
        task.githubRepo = newRepo;
      }
    }

    // Check if this task has an existing plan with stories (resume candidate)
    const planStories = (task.planJson as { stories?: unknown[] } | null)?.stories?.length;
    const planSteps = (task.planJson as { steps?: unknown[] } | null)?.steps?.length;
    const existingPlanStories = task.planJson && (planStories || planSteps);
    logger.info("Retry plan check", {
      taskId: id,
      hasPlanJson: !!task.planJson,
      planJsonType: typeof task.planJson,
      planStories,
      planSteps,
      existingPlanStories: !!existingPlanStories,
      planJsonKeys: task.planJson ? Object.keys(task.planJson as object) : [],
    });

    // Archive old coordination context from previous run(s)
    // Preserve story_ready and completion messages so the coordinator can resume
    const contextRepo = AppDataSource.getRepository(WorkerContext);
    try {
      if (existingPlanStories) {
        // RESUME MODE: Only archive blockers, decisions, and warnings — keep stories and completions
        const keepTypes = ["story_ready", "story_claimed", "completion", "progress"];
        const staleMessages = await contextRepo.find({
          where: { parentTaskId: task.id, archived: false },
        });
        const toArchive = staleMessages.filter((m) => !keepTypes.includes(m.messageType));
        if (toArchive.length > 0) {
          const now = new Date();
          for (const msg of toArchive) {
            msg.archived = true;
            msg.archivedAt = now;
          }
          await contextRepo.save(toArchive);
          logger.info("Archived stale context before resume (preserved stories + completions)", {
            taskId: id,
            archivedCount: toArchive.length,
            preservedCount: staleMessages.length - toArchive.length,
          });
        }
      } else {
        // FULL RETRY: Archive everything
        const archiveResult = await contextRepo.update(
          { parentTaskId: task.id, archived: false },
          { archived: true, archivedAt: new Date() },
        );
        if (archiveResult.affected && archiveResult.affected > 0) {
          logger.info("Archived old context before retry", {
            taskId: id,
            archivedCount: archiveResult.affected,
          });
        }
      }
    } catch (archiveError) {
      // Log but don't fail the retry - stale context is annoying but not fatal
      logger.warn("Failed to archive old context before retry", {
        taskId: id,
        error: archiveError instanceof Error ? archiveError.message : String(archiveError),
      });
    }

    // Reset ALL relevant fields for clean retry
    task.retryCount += 1;
    task.errorMessage = null;
    task.completedAt = null;
    task.startedAt = null;
    task.ecsTaskArn = null;
    task.ecsTaskId = null;
    task.githubPrUrl = null;
    task.githubPrNumber = null;
    task.githubBranch = null;
    task.taskNotes = null;

    if (needsPlanning) {
      if (existingPlanStories) {
        // RESUME: Preserve plan, skip re-planning — orchestrator will use existing plan
        task.status = "planning";
        task.planStatus = null;
        task.planFeedback = null;
        // planJson and executionPlanV2 are intentionally NOT cleared
        logger.info("Task queued for resume with existing plan", {
          taskId: id,
          orgId,
          retryCount: task.retryCount,
          storyCount: existingPlanStories,
        });
      } else {
        // No existing plan — full re-planning
        task.status = "planning";
        task.planJson = null;
        task.planStatus = null;
        task.planFeedback = null;
        task.executionPlanV2 = null;
        logger.info("Task queued for re-planning", {
          taskId: id,
          orgId,
          retryCount: task.retryCount,
          reason: isPrdTask ? "prd" : isEpicTask ? "epic" : isMultiProvider ? "multi-provider" : "v2-pipeline"
        });
      }
    } else {
      // Regular tasks go straight to queued
      task.status = "queued";
      logger.info("Task queued for retry", { taskId: id, orgId, retryCount: task.retryCount });
    }

    await taskRepo.save(task);

    // Sync InternalTask back to "executing" status and move card to In Progress column
    if (task.internalTaskId) {
      try {
        const internalTaskRepo = AppDataSource.getRepository(InternalTask);
        const columnRepo = AppDataSource.getRepository(BoardColumn);
        const internalTask = await internalTaskRepo.findOne({ where: { id: task.internalTaskId } });
        if (internalTask) {
          internalTask.status = "executing";
          const inProgressColumn = await columnRepo.findOne({
            where: { projectId: internalTask.projectId, columnType: "in_progress" },
          });
          if (inProgressColumn) {
            const maxPosResult = await internalTaskRepo
              .createQueryBuilder("task")
              .where("task.columnId = :columnId", { columnId: inProgressColumn.id })
              .select("MAX(task.columnPosition)", "maxPos")
              .getRawOne();
            internalTask.columnId = inProgressColumn.id;
            internalTask.columnPosition = (maxPosResult?.maxPos ?? -1) + 1;
          }
          await internalTaskRepo.save(internalTask);
          logger.info("Synced InternalTask to executing on retry", {
            internalTaskId: internalTask.id,
            taskKey: internalTask.taskKey,
            workerTaskId: task.id,
          });
        }
      } catch (syncError) {
        logger.warn("Failed to sync internal task on retry", {
          taskId: task.id,
          internalTaskId: task.internalTaskId,
          error: syncError instanceof Error ? syncError.message : String(syncError),
        });
      }
    }

    res.json(task);
    } catch (error) {
      logger.error("Error retrying task", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to retry task" });
    }
  }
);

/**
 * Reset a cancelled task for re-execution.
 * Archives old context, clears execution state, and sets status to queued/planning.
 */
export async function resetCancelledTask(task: WorkerTask): Promise<void> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  const contextRepo = AppDataSource.getRepository(WorkerContext);

  // Archive old coordination context
  try {
    const archiveResult = await contextRepo.update(
      { parentTaskId: task.id, archived: false },
      { archived: true, archivedAt: new Date() },
    );
    if (archiveResult.affected && archiveResult.affected > 0) {
      logger.info("Archived old context for cancelled task reset", {
        taskId: task.id,
        archivedCount: archiveResult.affected,
      });
    }
  } catch (archiveError) {
    logger.warn("Failed to archive old context for cancelled task reset", {
      taskId: task.id,
      error: archiveError instanceof Error ? archiveError.message : String(archiveError),
    });
  }

  // Reset execution state
  task.retryCount += 1;
  task.errorMessage = null;
  task.completedAt = null;
  task.startedAt = null;
  task.ecsTaskArn = null;
  task.ecsTaskId = null;
  task.githubPrUrl = null;
  task.githubPrNumber = null;
  task.githubBranch = null;
  task.taskNotes = null;

  // Determine status based on pipeline
  const labels = (task.jiraFields?.labels as string[] | undefined) || [];
  const needsPlanning = labels.includes("prd") || labels.includes("epic") ||
    labels.includes("multi-provider") || task.pipelineVersion === "v2";

  if (needsPlanning) {
    task.status = "planning";
    task.planJson = null;
    task.planStatus = null;
    task.planFeedback = null;
    task.executionPlanV2 = null;
  } else {
    task.status = "queued";
  }

  await taskRepo.save(task);

  logger.info("Reset cancelled task for re-run", {
    taskId: task.id,
    newStatus: task.status,
    retryCount: task.retryCount,
  });
}

export default router;
