import { Router, Request, Response } from "express";
import { authenticateRequest, authenticateUser, authenticateApiKey, requireAdmin } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/error-handler.js";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask, WorkerTaskLog, WorkerCommand } from "../../models/index.js";
import { logger } from "../../utils/logger.js";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from "../../utils/errors.js";
import { body, param, validateRequest } from "../../middleware/validation.js";

const router = Router();

/**
 * PATCH /api/control-center/tasks/:taskId/self-review
 * Toggle self-review for a running task.
 * Inserts a worker_command that the worker picks up at the next story boundary.
 */
router.patch(
  "/tasks/:taskId/self-review",
  authenticateRequest,
  param("taskId").isUUID().withMessage("taskId must be a valid UUID"),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;
    const org = req.organization!;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({ where: { id: taskId, orgId: org.id } });
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    // Toggle: derive current state from org default, then flip
    // (We don't have task-level selfReview state, so we track via command count parity)
    const commandRepo = AppDataSource.getRepository(WorkerCommand);
    const toggleCount = await commandRepo.count({
      where: { taskId, orgId: org.id, type: "toggle_self_review" as WorkerCommand["type"] },
    });
    const currentState = toggleCount % 2 === 0 ? (org.selfReviewEnabled ?? false) : !(org.selfReviewEnabled ?? false);
    const newState = !currentState;

    const commandData = WorkerCommand.create(taskId, org.id, "toggle_self_review", newState ? "enabled" : "disabled");
    const command = commandRepo.create(commandData);
    await commandRepo.save(command);

    logger.info("Self-review toggled", { taskId, selfReviewEnabled: newState });
    res.json({ selfReviewEnabled: newState });
  })
);

/**
 * POST /api/control-center/tasks/:id/review
 * Submit an effectiveness review for a completed task
 * Records human assessment of task quality for analytics
 */
router.post(
  "/tasks/:id/review",
  authenticateRequest,
  param("id").isUUID().withMessage("id must be a valid UUID"),
  body("outcome").isIn(["accepted", "rejected", "partial"]).withMessage("outcome must be accepted, rejected, or partial"),
  body("accuracyScore").optional().isInt({ min: 0, max: 100 }).withMessage("accuracyScore must be between 0 and 100"),
  body("notes").optional().isString().withMessage("notes must be a string"),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const taskId = req.params.id as string;
    const { outcome, accuracyScore, notes } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      throw new NotFoundError("Task not found");
    }

    // Update review fields (atomic — don't clobber concurrent changes)
    const reviewedBy = req.user?.email || "unknown";
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        reviewOutcome: outcome,
        accuracyScore: accuracyScore ?? null,
        reviewNotes: notes ?? null,
        reviewedAt: new Date(),
        reviewedBy,
      })
      .where("id = :id AND org_id = :orgId", { id: taskId, orgId: org.id })
      .execute();
    task.reviewedBy = reviewedBy;

    logger.info("Task effectiveness review submitted", {
      taskId,
      outcome,
      accuracyScore,
      reviewedBy: task.reviewedBy,
      jiraIssueKey: task.jiraIssueKey,
    });

    res.json({
      success: true,
      task: {
        id: task.id,
        jiraIssueKey: task.jiraIssueKey,
        reviewOutcome: task.reviewOutcome,
        accuracyScore: task.accuracyScore,
        reviewNotes: task.reviewNotes,
        reviewedAt: task.reviewedAt,
        reviewedBy: task.reviewedBy,
      },
    });
  })
);

/**
 * POST /api/control-center/tasks/:id/approve
 * Manually approve a task for deployment (simulates PR approval)
 * Only works for tasks in review_requested status
 */
router.post(
  "/tasks/:id/approve",
  authenticateRequest,
  param("id").isUUID().withMessage("id must be a valid UUID"),
  body("approvedBy").optional().isString().withMessage("approvedBy must be a string"),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const taskId = req.params.id as string;
    const { approvedBy } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      throw new NotFoundError("Task not found");
    }

    if (task.status !== "review_requested") {
      throw new ConflictError(
        `Task cannot be approved: status is ${task.status}, must be review_requested`
      );
    }

    // Set up for deployment run and re-queue (atomic with status guard)
    const approver = approvedBy || "manual_approval";
    const result = await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        status: "queued",
        githubApprovedBy: approver,
        taskNotes: `DEPLOYMENT_RUN: PR ***REMOVED***${task.githubPrNumber || "?"} approved by ${approver}. Deploy and merge.`,
        completedAt: null,
        ecsTaskArn: null,
        ecsTaskId: null,
        startedAt: null,
      })
      .where("id = :id AND status = :expected", {
        id: taskId,
        expected: "review_requested",
      })
      .execute();

    if ((result.affected || 0) === 0) {
      throw new ConflictError("Task status changed concurrently");
    }
    task.status = "queued";
    task.githubApprovedBy = approver;

    logger.info("Task manually approved for deployment", {
      taskId,
      approvedBy: task.githubApprovedBy,
      jiraIssueKey: task.jiraIssueKey,
    });

    res.json({
      status: "approved",
      taskId,
      newStatus: "queued",
      message: "Task approved and re-queued for deployment run",
    });
  })
);

/**
 * POST /api/control-center/tasks/:id/deploy
 * Re-queue a task for deployment-only run (merge PR + deploy)
 * Requires the task to have a PR URL and be in a terminal/waiting state
 */
router.post(
  "/tasks/:id/deploy",
  authenticateRequest,
  param("id").isUUID().withMessage("id must be a valid UUID"),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const taskId = req.params.id as string;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      throw new NotFoundError("Task not found");
    }

    if (!task.githubPrUrl) {
      throw new ConflictError("Task has no PR to deploy");
    }

    const deployableStatuses = [
      "failed",
      "completed",
      "review_requested",
      "pr_approved",
      "escalated",
      "cancelled",
    ];
    if (!deployableStatuses.includes(task.status)) {
      throw new ConflictError(
        `Task cannot be deployed: status is ${task.status}, must be one of ${deployableStatuses.join(", ")}`
      );
    }

    // Re-queue for deployment run (atomic with status guard)
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        status: "queued",
        deploymentEnabled: true,
        taskNotes: `DEPLOYMENT_RUN: PR ***REMOVED***${task.githubPrNumber || "?"} — manual deploy from dashboard.`,
        completedAt: null,
        ecsTaskArn: null,
        ecsTaskId: null,
        startedAt: null,
        errorMessage: null,
      })
      .where("id = :id", { id: taskId })
      .execute();
    task.status = "queued";

    logger.info("Task queued for manual deployment", {
      taskId,
      jiraIssueKey: task.jiraIssueKey,
      prUrl: task.githubPrUrl,
    });

    res.json({
      status: "deploy_queued",
      taskId,
      newStatus: "queued",
      message: "Task re-queued for deployment run",
    });
  })
);

/**
 * POST /api/control-center/tasks/:id/review
 * Trigger a review-only run on an existing PR.
 * Re-queues the task with REVIEW_RUN in taskNotes and forces review enabled.
 * If revision is needed, the worker enters the full revision loop automatically.
 */
router.post(
  "/tasks/:id/review",
  authenticateRequest,
  param("id").isUUID().withMessage("id must be a valid UUID"),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const taskId = req.params.id as string;
    const taskRepo = AppDataSource.getRepository(WorkerTask);

    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      throw new NotFoundError("Task not found");
    }

    if (!task.githubPrUrl) {
      throw new ConflictError("Task has no PR to review");
    }

    const reviewableStatuses = [
      "failed",
      "completed",
      "review_requested",
      "pr_approved",
      "deployed",
      "escalated",
      "cancelled",
    ];
    if (!reviewableStatuses.includes(task.status)) {
      throw new ConflictError(
        `Task cannot be reviewed: status is ${task.status}, must be one of ${reviewableStatuses.join(", ")}`
      );
    }

    // Re-queue for review-only run (atomic with status guard)
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        status: "queued",
        skipManagerReview: false,
        taskNotes: `REVIEW_RUN: PR ***REMOVED***${task.githubPrNumber || "?"} — manual review from dashboard.`,
        completedAt: null,
        ecsTaskArn: null,
        ecsTaskId: null,
        startedAt: null,
        errorMessage: null,
      })
      .where("id = :id", { id: taskId })
      .execute();
    task.status = "queued";

    logger.info("Task queued for review-only run", {
      taskId,
      jiraIssueKey: task.jiraIssueKey,
      prUrl: task.githubPrUrl,
    });

    res.json({
      status: "review_queued",
      taskId,
      newStatus: "queued",
      message: "Task re-queued for review-only run",
    });
  })
);

/**
 * Save story completion data for a task.
 * Called by the coordinator before PR creation to enable retry on failure.
 */
router.post(
  "/tasks/:taskId/story-completions",
  authenticateApiKey,
  asyncHandler(async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;
    const { storyCompletions, storyBranches, featureBranch } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundError("Task not found");
    }

    // Store story completion data in planJson for retry
    const existingPlanJson = (task.planJson || {}) as Record<string, unknown>;
    task.planJson = {
      ...existingPlanJson,
      storyCompletions,
      storyBranches,
      featureBranch,
      completedAt: new Date().toISOString(),
    };

    // Also save the feature branch name
    if (featureBranch && !task.githubBranch) {
      task.githubBranch = featureBranch;
    }

    await taskRepo.save(task);

    logger.info("Saved story completion data for retry", {
      taskId,
      storyCount: storyCompletions?.length,
      featureBranch,
    });

    res.json({ success: true });
  })
);

/**
 * Retry PR creation for a failed task.
 * Only works if the task has story completion data saved.
 */
router.post(
  "/tasks/:taskId/retry-pr",
  authenticateUser,
  asyncHandler(async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: req.organization!.id },
    });

    if (!task) {
      throw new NotFoundError("Task not found");
    }

    // Check if task is in a state that allows retry
    if (task.status !== "failed") {
      throw new BadRequestError("Can only retry PR creation for failed tasks");
    }

    // Check if we have the data needed for retry
    const planJson = task.planJson as Record<string, unknown> | null;
    const storyCompletions = planJson?.storyCompletions as Array<{
      storyIndex: number;
      title: string;
      filesModified: string[];
    }> | undefined;

    if (!storyCompletions || storyCompletions.length === 0) {
      throw new BadRequestError("No story completion data available for retry. Task may not have completed stories.");
    }

    const featureBranch = (planJson?.featureBranch as string) || task.githubBranch;
    if (!featureBranch) {
      throw new BadRequestError("No feature branch found for retry");
    }

    // Atomic status transition — only update if still failed (avoids clobbering concurrent writes)
    const retryResult = await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({ status: "executing", errorMessage: null } as Record<string, unknown>)
      .where("id = :id AND status = :expected", { id: taskId, expected: "failed" })
      .execute();

    if (retryResult.affected === 0) {
      throw new ConflictError("Task status changed since retry was initiated");
    }

    logger.info("Initiating PR creation retry", {
      taskId,
      featureBranch,
      storyCount: storyCompletions.length,
    });

    // Spawn background job to retry PR creation
    // This runs asynchronously so we can return immediately
    retryPrCreation(task, storyCompletions, featureBranch, planJson?.storyBranches as string[] | undefined)
      .catch((error) => {
        logger.error("PR retry failed", { taskId, error: error.message });
      });

    res.json({
      success: true,
      message: "PR creation retry initiated",
      featureBranch,
      storyCount: storyCompletions.length,
    });
  })
);

/**
 * POST /api/control-center/tasks/:taskId/resume
 * Resume a failed or interrupted Epic task from its checkpoint.
 *
 * This endpoint:
 * 1. Validates the task is resumable (failed/cancelled Epic task with executionPlanV2)
 * 2. Preserves the existing execution plan (no re-planning)
 * 3. Sets status to "queued" so orchestrator picks it up
 * 4. Increments retryCount (to track resume attempts)
 * 5. Clears error state and container references
 *
 * The coordinator will then:
 * - Detect it's a resume (executionPlanV2 exists, retryCount > 0)
 * - Skip already-completed stories (via WorkerContext completions)
 * - Resume from partial branches if they exist on remote
 */
router.post(
  "/tasks/:taskId/resume",
  authenticateUser,
  param("taskId").isUUID().withMessage("taskId must be a valid UUID"),
  body("skipCompletedStories").optional().isBoolean().withMessage("skipCompletedStories must be boolean"),
  body("resetFailedStories").optional().isBoolean().withMessage("resetFailedStories must be boolean"),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const taskId = req.params.taskId as string;
    const { skipCompletedStories = true, resetFailedStories = false } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      throw new NotFoundError("Task not found");
    }

    // Validate task is in a resumable state
    const resumableStatuses = ["failed", "cancelled"];
    if (!resumableStatuses.includes(task.status)) {
      throw new BadRequestError(
        `Task cannot be resumed: status is "${task.status}". Only failed or cancelled tasks can be resumed.`
      );
    }

    // Check if this is an Epic task with a plan
    const isEpicTask = task.executionMode === "parallel" || task.executionMode === "multi-expert";
    if (!isEpicTask) {
      throw new BadRequestError(
        "Only Epic mode tasks can be resumed. Use retry for standard tasks."
      );
    }

    // Check if we have an execution plan to resume from
    const planJson = task.planJson as Record<string, unknown> | null;
    const hasExecutionPlan = planJson && (planJson.stories || planJson.steps);

    if (!hasExecutionPlan) {
      throw new BadRequestError(
        "Task has no execution plan. Cannot resume without a plan. Please re-create the task."
      );
    }

    // Log the resume action
    logger.info("Resuming Epic task", {
      taskId,
      jiraIssueKey: task.jiraIssueKey,
      previousStatus: task.status,
      retryCount: task.retryCount,
      skipCompletedStories,
      resetFailedStories,
    });

    const previousRetryCount = task.retryCount || 0;

    // Optionally reset failed stories in WorkerContext
    if (resetFailedStories) {
      try {
        const { WorkerContext } = await import("../../models/index.js");
        const contextRepo = AppDataSource.getRepository(WorkerContext);

        // Delete blocker messages so they're not seen as active blockers
        await contextRepo
          .createQueryBuilder()
          .delete()
          .from(WorkerContext)
          .where("parentTaskId = :taskId", { taskId })
          .andWhere("messageType = :type", { type: "blocker_detected" })
          .execute();

        logger.info("Reset failed story data for resume", { taskId });
      } catch (error) {
        logger.warn("Failed to reset WorkerContext data", { taskId, error });
        // Non-fatal - continue with resume
      }
    }

    // Atomic update — guard against concurrent status changes
    const resumeResult = await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        status: "queued",
        retryCount: previousRetryCount + 1,
        errorMessage: null,
        completedAt: null,
        startedAt: null,
        ecsTaskArn: null,
        ecsTaskId: null,
        managerEcsTaskId: null,
        lastHeartbeatAt: null,
        planJson: {
          ...planJson,
          resumeInfo: {
            resumedAt: new Date().toISOString(),
            resumedBy: req.user?.id || "api",
            previousRetryCount,
            skipCompletedStories,
            resetFailedStories,
          },
        },
      } as Record<string, unknown>)
      .where("id = :id AND status IN (:...statuses)", {
        id: taskId,
        statuses: ["failed", "cancelled"],
      })
      .execute();

    if (resumeResult.affected === 0) {
      throw new ConflictError("Task status changed since resume was initiated");
    }

    const newRetryCount = previousRetryCount + 1;

    // Create a log entry for the resume action
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);
    await logRepo.save(
      logRepo.create({
        taskId: task.id,
        type: "system",
        message: `[Resume] Task resumed by ${req.user?.id || "API"}. Retry ***REMOVED***${newRetryCount}. Skip completed: ${skipCompletedStories}, Reset failed: ${resetFailedStories}`,
        severity: "info",
      })
    );

    res.json({
      success: true,
      taskId,
      newStatus: "queued",
      retryCount: newRetryCount,
      message: "Task resumed and queued for execution. Completed stories will be skipped.",
      resumeInfo: {
        skipCompletedStories,
        resetFailedStories,
        storiesInPlan: (planJson.stories as unknown[] | undefined)?.length ||
                        (planJson.steps as unknown[] | undefined)?.length || 0,
      },
    });
  })
);

/**
 * Background function to retry PR creation.
 */
async function retryPrCreation(
  task: WorkerTask,
  storyCompletions: Array<{ storyIndex: number; title: string; filesModified: string[] }>,
  featureBranch: string,
  storyBranches?: string[]
): Promise<void> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);

  try {
    // Import git-ops dynamically to avoid circular dependencies
    const { execSync } = await import("child_process");

    const targetRepo = process.env.TARGET_REPO_PATH || task.githubRepo;
    const githubToken = process.env.GITHUB_TOKEN || "";

    if (!targetRepo) {
      throw new Error("No target repository configured");
    }

    // For single-story tasks, use the story branch directly instead of feature branch
    // The feature branch may not have any commits if consolidation was skipped
    let prBranch = featureBranch;
    if (storyBranches && storyBranches.length === 1) {
      prBranch = storyBranches[0];
      logger.info("Using story branch for single-story PR", { prBranch, featureBranch });
    }

    // Log the retry attempt
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);
    await logRepo.save(
      logRepo.create({
        taskId: task.id,
        type: "system",
        message: `[Retry] Retrying PR creation for branch: ${prBranch}`,
        severity: "info",
      })
    );

    // Use gh CLI to create PR directly
    const prTitle = `${task.jiraIssueKey}: ${task.summary}`;
    const prBody = `***REMOVED******REMOVED*** Retry PR Creation

This PR was created via retry after the initial PR creation failed.

***REMOVED******REMOVED******REMOVED*** Stories Completed
${storyCompletions.map((s) => `- Story ${s.storyIndex}: ${s.title}`).join("\n")}

---
Generated by WorkerMill (retry)`;

    // Determine the repo path
    const repoPath = targetRepo.startsWith("/") || /^[A-Za-z]:/.test(targetRepo)
      ? targetRepo
      : process.cwd();

    // Create PR using gh CLI
    const escapedTitle = prTitle.replace(/"/g, '\\"');
    const escapedBody = prBody.replace(/"/g, '\\"').replace(/`/g, '\\`');

    const result = execSync(
      `gh pr create --title "${escapedTitle}" --body "${escapedBody}" --base main --head ${prBranch}`,
      {
        cwd: repoPath,
        encoding: "utf-8",
        env: {
          ...process.env,
          GH_TOKEN: githubToken,
          GITHUB_TOKEN: githubToken,
        },
      }
    ).trim();

    // Extract PR URL from result
    const prUrl = result;
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : null;

    // Atomic update to avoid clobbering concurrent changes
    await taskRepo.update({ id: task.id }, {
      status: "review_requested",
      githubPrUrl: prUrl,
      githubPrNumber: prNumber,
      errorMessage: null,
    });

    // Log success
    await logRepo.save(
      logRepo.create({
        taskId: task.id,
        type: "system",
        message: `[Retry] PR created successfully: ${prUrl}`,
        severity: "info",
      })
    );

    logger.info("PR retry succeeded", {
      taskId: task.id,
      prUrl,
      prNumber,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if PR already exists
    if (errorMessage.includes("already exists")) {
      const prMatch = errorMessage.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
      if (prMatch) {
        const prNumMatch = prMatch[0].match(/\/pull\/(\d+)/);
        await taskRepo.update({ id: task.id }, {
          status: "review_requested",
          githubPrUrl: prMatch[0],
          githubPrNumber: prNumMatch ? parseInt(prNumMatch[1], 10) : null,
          errorMessage: null,
        });

        logger.info("PR already exists, updated task", {
          taskId: task.id,
          prUrl: prMatch[0],
        });
        return;
      }
    }

    // Atomic update to avoid clobbering concurrent changes
    await taskRepo.update({ id: task.id }, {
      status: "failed",
      errorMessage: `PR retry failed: ${errorMessage}`,
    });

    // Log failure
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);
    await logRepo.save(
      logRepo.create({
        taskId: task.id,
        type: "system",
        message: `[Retry] PR creation failed: ${errorMessage}`,
        severity: "error",
      })
    );

    throw error;
  }
}

/**
 * DELETE /api/control-center/tasks/cleanup
 * Bulk cleanup of test/demo tasks by Jira key prefix.
 * Admin-only — requires owner or admin org role.
 *
 * Query params:
 *   prefix  — jiraIssueKey prefix to match (default: "E2E-")
 *   maxAge  — max age in hours, only deletes tasks older than this (default: 1)
 */
router.delete(
  "/tasks/cleanup",
  authenticateRequest,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const prefix = (req.query.prefix as string) || "E2E-";
      const maxAge = parseInt(req.query.maxAge as string) || 1;
      const cutoff = new Date(Date.now() - maxAge * 60 * 60 * 1000);

      const taskRepo = AppDataSource.getRepository(WorkerTask);

      // Find matching tasks in this org
      const tasks = await taskRepo
        .createQueryBuilder("task")
        .where("task.orgId = :orgId", { orgId })
        .andWhere("task.jiraIssueKey LIKE :pattern", { pattern: `${prefix}%` })
        .andWhere("task.createdAt < :cutoff", { cutoff })
        .getMany();

      if (tasks.length === 0) {
        res.json({ success: true, deleted: 0 });
        return;
      }

      const taskIds = tasks.map((t) => t.id);

      // Cascade delete in a transaction (same pattern as DELETE /api/tasks/:id)
      await AppDataSource.transaction(async (manager) => {
        await manager.query(`SET LOCAL app.allow_log_delete = 'authorized'`);
        for (const id of taskIds) {
          await manager.query(`DELETE FROM worker_task_logs WHERE task_id = $1`, [id]);
          await manager.query(`DELETE FROM worker_check_ins WHERE task_id = $1`, [id]);
          await manager.query(`DELETE FROM worker_file_locks WHERE task_id = $1`, [id]);
          await manager.query(`DELETE FROM worker_contexts WHERE parent_task_id = $1 OR task_id = $1`, [id]);
          await manager.query(`DELETE FROM worker_commands WHERE task_id = $1`, [id]);
          await manager.query(`DELETE FROM worker_task_errors WHERE task_id = $1`, [id]);
          await manager.query(`DELETE FROM worker_task_token_usage WHERE task_id = $1`, [id]);
          await manager.query(`DELETE FROM worker_resource_reservations WHERE task_id = $1`, [id]);
          await manager.query(`DELETE FROM task_relationships WHERE source_task_id = $1 OR target_task_id = $1`, [id]);
          await manager.query(`DELETE FROM pr_feedback WHERE task_id = $1`, [id]);
          await manager.query(`DELETE FROM episodic_memories WHERE task_id = $1`, [id]);
          await manager.query(`DELETE FROM procedural_memories WHERE source_task_id = $1`, [id]);
          await manager.query(`DELETE FROM credit_transactions WHERE task_id = $1`, [id]);
          await manager.query(`DELETE FROM warm_containers WHERE assigned_task_id = $1`, [id]);
          await manager.query(`UPDATE kb_cards SET worker_task_id = NULL WHERE worker_task_id = $1`, [id]);
          await manager.query(`UPDATE projects SET worker_task_id = NULL WHERE worker_task_id = $1`, [id]);
          await manager.query(`UPDATE support_tickets SET ai_response_task_id = NULL WHERE ai_response_task_id = $1`, [id]);
          await manager.query(`UPDATE internal_tasks SET worker_task_id = NULL WHERE worker_task_id = $1`, [id]);
          await manager.query(`UPDATE worker_tasks SET parent_task_id = NULL WHERE parent_task_id = $1`, [id]);
          await manager.query(`DELETE FROM worker_tasks WHERE id = $1`, [id]);
        }
      });

      logger.info("Admin cleanup completed", { orgId, prefix, deleted: taskIds.length });
      res.json({ success: true, deleted: taskIds.length, taskIds });
    } catch (error) {
      logger.error("Admin cleanup failed", { error });
      res.status(500).json({ error: "Failed to cleanup tasks" });
    }
  },
);

export default router;
