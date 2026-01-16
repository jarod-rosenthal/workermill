import { Router, Request, Response } from "express";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask, WorkerTaskLog } from "../models/index.js";
import { authenticateRequest, authenticateApiKey } from "../middleware/auth.js";
import { getECSTaskRunner } from "../services/ecs-task-runner.js";
import { getCostTracker } from "../services/cost-tracker.js";
import { logger } from "../utils/logger.js";
import { body, param, query, validateRequest } from "../middleware/validation.js";

const router = Router();

// All routes require authentication
router.use(authenticateRequest);

/**
 * @swagger
 * /api/tasks:
 *   post:
 *     summary: Create a new task manually
 *     description: Creates a new worker task for the specified Jira issue. The task will be queued for execution by an AI worker.
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jiraIssueKey
 *             properties:
 *               jiraIssueKey:
 *                 type: string
 *                 description: Jira issue key (e.g., OCS-123)
 *                 example: OCS-123
 *               workerPersona:
 *                 type: string
 *                 description: Worker persona/role to use
 *                 default: backend_developer
 *                 example: frontend_developer
 *               workerModel:
 *                 type: string
 *                 description: AI model to use
 *                 default: claude-haiku-4-5-20251001
 *                 example: claude-sonnet-4-5-20250929
 *               summary:
 *                 type: string
 *                 description: Task summary (auto-generated if not provided)
 *                 example: Implement user authentication
 *               skipManagerReview:
 *                 type: boolean
 *                 description: Whether to skip manager review
 *                 default: true
 *     responses:
 *       201:
 *         description: Task created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 *       400:
 *         description: Task already exists or invalid input
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post(
  "/",
  body("jiraIssueKey").isString().notEmpty().withMessage("jiraIssueKey is required"),
  body("workerPersona").optional().isString(),
  body("workerModel").optional().isString(),
  body("summary").optional().isString(),
  body("skipManagerReview").optional().isBoolean(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { jiraIssueKey, workerPersona, workerModel, summary, skipManagerReview } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Check if task already exists for this issue
    const existingTask = await taskRepo.findOne({
      where: { jiraIssueKey, orgId: org.id },
    });

    if (existingTask && !existingTask.isTerminal()) {
      res.status(400).json({
        error: "Task already exists and is not complete",
        taskId: existingTask.id,
      });
      return;
    }

    // Create new task
    const task = taskRepo.create({
      orgId: org.id,
      jiraIssueKey,
      jiraIssueId: jiraIssueKey, // Use key as ID for manual tasks
      summary: summary || `Manual task for ${jiraIssueKey}`,
      description: null,
      workerPersona: workerPersona || "backend_developer",
      workerModel: workerModel || "claude-haiku-4-5-20251001",
      githubRepo: org.defaultGithubRepo || "",
      status: "queued",
      retryCount: 0,
      maxRetries: 3,
      skipManagerReview: skipManagerReview !== false, // Default to true (no review), set false for review workflow
    });

    await taskRepo.save(task);

    logger.info("Created manual worker task", {
      taskId: task.id,
      jiraIssueKey,
      persona: task.workerPersona,
      model: task.workerModel,
      orgId: org.id,
    });

    res.status(201).json(task);
    } catch (error) {
      logger.error("Error creating task", { error });
      res.status(500).json({ error: "Failed to create task" });
    }
  }
);

/**
 * @swagger
 * /api/tasks:
 *   get:
 *     summary: List tasks
 *     description: Returns a paginated list of tasks for the authenticated organization
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [queued, claimed, environment_setup, executing, pr_created, review_requested, manager_review, pr_approved, review_approved, deploying, deployed, completed, failed, cancelled, escalated, review_rejected]
 *         description: Filter tasks by status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Maximum number of tasks to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of tasks to skip for pagination
 *     responses:
 *       200:
 *         description: List of tasks with pagination metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tasks:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Task'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                       description: Total number of tasks matching filter
 *                     limit:
 *                       type: integer
 *                       description: Number of tasks per page
 *                     offset:
 *                       type: integer
 *                       description: Current offset
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  "/",
  query("status").optional().isString(),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("limit must be between 1 and 100"),
  query("offset").optional().isInt({ min: 0 }).withMessage("offset must be a non-negative integer"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const { status, limit = 50, offset = 0 } = req.query;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const queryBuilder = taskRepo
      .createQueryBuilder("task")
      .where("task.orgId = :orgId", { orgId })
      .orderBy("task.createdAt", "DESC")
      .skip(Number(offset))
      .take(Math.min(Number(limit), 100));

    if (status) {
      queryBuilder.andWhere("task.status = :status", { status });
    }

    const [tasks, total] = await queryBuilder.getManyAndCount();

    res.json({
      tasks,
      pagination: {
        total,
        limit: Number(limit),
        offset: Number(offset),
      },
    });
    } catch (error) {
      logger.error("Error listing tasks", { error });
      res.status(500).json({ error: "Failed to list tasks" });
    }
  }
);

/**
 * @swagger
 * /api/tasks/{id}:
 *   get:
 *     summary: Get a specific task
 *     description: Returns detailed information about a single task by ID
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Task UUID
 *     responses:
 *       200:
 *         description: Task details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 *       404:
 *         description: Task not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  "/:id",
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

    res.json(task);
    } catch (error) {
      logger.error("Error getting task", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to get task" });
    }
  }
);

/**
 * GET /api/tasks/:id/logs
 * Get logs for a task
 */
router.get(
  "/:id/logs",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  query("nextToken").optional().isString(),
  query("limit").optional().isInt({ min: 1, max: 500 }).withMessage("limit must be between 1 and 500"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = req.params.id as string;
      const { nextToken, limit = 100 } = req.query;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id, orgId },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (!task.ecsTaskId) {
      res.json({ events: [], message: "Task has not started yet" });
      return;
    }

    const runner = getECSTaskRunner();
    const logs = await runner.getTaskLogs(task.ecsTaskId, {
      nextToken: nextToken as string | undefined,
      limit: Number(limit),
    });

    res.json(logs);
    } catch (error) {
      logger.error("Error getting task logs", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to get task logs" });
    }
  }
);

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

    // Update task status
    task.status = "cancelled";
    task.completedAt = new Date();
    await taskRepo.save(task);

    logger.info("Task cancelled", { taskId: id, orgId });
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
    ];

    if (!RETRYABLE_STATUSES.includes(task.status)) {
      res.status(400).json({
        error: "Task cannot be retried",
        reason: "Task is currently active",
      });
      return;
    }

    // Reset ALL relevant fields for clean retry
    task.status = "queued";
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
    await taskRepo.save(task);

    logger.info("Task queued for retry", { taskId: id, orgId, retryCount: task.retryCount });
    res.json(task);
    } catch (error) {
      logger.error("Error retrying task", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to retry task" });
    }
  }
);

/**
 * DELETE /api/tasks/:id
 * Delete a task from history
 */
router.delete(
  "/:id",
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

    // Only allow deleting terminal tasks, queued tasks, or waiting tasks (like escalated)
    if (!task.isTerminal() && !task.isWaiting() && task.status !== "queued") {
      res.status(400).json({
        error: "Cannot delete active task",
        reason: "Only completed, failed, cancelled, queued, or escalated tasks can be deleted"
      });
      return;
    }

    await taskRepo.remove(task);

    logger.info("Task deleted", { taskId: id, orgId, status: task.status });
    res.json({ success: true, message: "Task deleted successfully" });
    } catch (error) {
      logger.error("Error deleting task", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to delete task" });
    }
  }
);

/**
 * POST /api/tasks/:id/usage
 * Report token usage from worker (called by log-parser.cjs during execution)
 * Uses API key authentication (x-api-key header)
 *
 * IMPORTANT: This endpoint matches oncallshift's /api/v1/ai-worker-tasks/:id/usage
 * - Uses idempotency check via usageReportedAt
 * - Sets tokens directly (not additive) - log-parser already uses Math.max()
 * - Calculates cost immediately
 * - Updates org cumulative cost
 */
router.post(
  "/:id/usage",
  authenticateApiKey,
  param("id").isUUID().withMessage("id must be a valid UUID"),
  body("model").optional().isString(),
  body("inputTokens").optional().isInt({ min: 0 }).withMessage("inputTokens must be a non-negative integer"),
  body("outputTokens").optional().isInt({ min: 0 }).withMessage("outputTokens must be a non-negative integer"),
  body("cacheCreationTokens").optional().isInt({ min: 0 }),
  body("cacheReadTokens").optional().isInt({ min: 0 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const taskId = req.params.id as string;
      const org = req.organization!;
      const {
        model,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
      } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Idempotency check: reject if usage already reported
    if (task.usageReportedAt) {
      res.status(409).json({
        error: "Usage already reported for this task",
        usageReportedAt: task.usageReportedAt,
        existingCost: task.estimatedCostUsd,
      });
      return;
    }

    logger.info("Token usage reported", {
      taskId,
      model,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
    });

    // Set tokens directly (not additive - log-parser uses Math.max())
    task.inputTokens = Number(inputTokens) || 0;
    task.outputTokens = Number(outputTokens) || 0;
    task.cacheCreationTokens = Number(cacheCreationTokens) || 0;
    task.cacheReadTokens = Number(cacheReadTokens) || 0;

    // Update model if provided
    if (model) {
      task.workerModel = model;
    }

    // Mark usage as reported (idempotency)
    task.usageReportedAt = new Date();

    // Calculate ECS duration if task has started
    if (task.startedAt) {
      task.ecsTaskSeconds = Math.floor((Date.now() - task.startedAt.getTime()) / 1000);
    }

    // Calculate cost using task method
    task.estimatedCostUsd = task.calculateCost();

    await taskRepo.save(task);

    // Update org cumulative cost
    try {
      const costTracker = getCostTracker(AppDataSource);
      await costTracker.recordTaskCost(taskId);
    } catch (costError) {
      logger.error("Failed to record task cost to org", { taskId, error: costError });
    }

    logger.info("Token usage recorded", {
      taskId,
      inputTokens: task.inputTokens,
      outputTokens: task.outputTokens,
      estimatedCostUsd: task.estimatedCostUsd,
    });

    res.json({
      success: true,
      taskId,
      estimatedCostUsd: task.estimatedCostUsd,
    });
  } catch (error) {
    logger.error("Error recording token usage", { error, taskId: req.params.id });
    res.status(500).json({ error: "Failed to record token usage" });
  }
});

/**
 * POST /api/tasks/:id/worker-complete
 * Called by the worker container when task completes
 * Uses API key authentication (x-api-key header)
 */
router.post("/:id/worker-complete", authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const org = req.organization!;
    const {
      exitCode,
      result,        // 'deployed' | 'review_requested' | 'no_changes' | 'completed' | 'failed'
      prUrl,
      prNumber,
      branch,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      errorMessage,
    } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Skip if task already completed
    if (task.isTerminal()) {
      logger.info("Task already completed, ignoring worker-complete", { taskId, currentStatus: task.status });
      res.json({ status: "ignored", reason: "Task already completed" });
      return;
    }

    logger.info("Worker completion reported", {
      taskId,
      exitCode,
      result,
      prUrl,
      inputTokens,
      outputTokens,
    });

    // Map result to status
    let newStatus: typeof task.status;
    switch (result) {
      case "deployed":
        newStatus = "deployed";
        break;
      case "review_requested":
        newStatus = "review_requested";
        break;
      case "escalated":
        newStatus = "escalated";
        break;
      case "no_changes":
      case "completed":
        newStatus = "completed";
        break;
      case "failed":
      default:
        newStatus = exitCode === 0 ? "completed" : "failed";
        break;
    }

    // Update task
    task.status = newStatus;
    task.completedAt = new Date();

    if (prUrl) {
      task.githubPrUrl = prUrl;
    }
    if (prNumber) {
      task.githubPrNumber = Number(prNumber);
    }
    if (branch) {
      task.githubBranch = branch;
    }
    if (errorMessage) {
      task.errorMessage = errorMessage;
    }

    // Calculate ECS task duration
    if (task.startedAt) {
      task.ecsTaskSeconds = Math.floor((new Date().getTime() - task.startedAt.getTime()) / 1000);
    }

    // Token usage and cost are handled by the /usage endpoint (called by log-parser.cjs)
    // Only calculate cost here if usage wasn't already reported
    if (!task.usageReportedAt) {
      // Fallback: update tokens if provided in payload (backward compatibility)
      if (inputTokens !== undefined) {
        task.inputTokens = (task.inputTokens || 0) + Number(inputTokens);
      }
      if (outputTokens !== undefined) {
        task.outputTokens = (task.outputTokens || 0) + Number(outputTokens);
      }
      if (cacheCreationTokens !== undefined) {
        task.cacheCreationTokens = (task.cacheCreationTokens || 0) + Number(cacheCreationTokens);
      }
      if (cacheReadTokens !== undefined) {
        task.cacheReadTokens = (task.cacheReadTokens || 0) + Number(cacheReadTokens);
      }

      // Calculate cost
      task.estimatedCostUsd = task.calculateCost();
    }

    await taskRepo.save(task);

    // Record cost to org cumulative (only if not already done by /usage endpoint)
    if (!task.usageReportedAt) {
      try {
        const costTracker = getCostTracker(AppDataSource);
        await costTracker.recordTaskCost(taskId);
      } catch (costError) {
        logger.error("Failed to record task cost", { taskId, error: costError });
      }
    }

    logger.info("Task completion processed", {
      taskId,
      newStatus,
      cost: task.estimatedCostUsd,
      inputTokens: task.inputTokens,
      outputTokens: task.outputTokens,
    });

    res.json({
      status: "processed",
      taskId,
      newStatus,
      cost: task.estimatedCostUsd,
    });
  } catch (error) {
    logger.error("Error processing worker-complete", { error, taskId: req.params.id });
    res.status(500).json({ error: "Failed to process worker completion" });
  }
});

/**
 * POST /api/tasks/:id/manager-complete
 * Called by the Manager ECS task when it completes PR review
 * Uses API key authentication (x-api-key header)
 */
router.post("/:id/manager-complete", authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const org = req.organization!;
    const {
      decision,       // 'approved' | 'revision_needed' | 'rejected'
      feedback,
      codeQualityScore,
      managerModel,
    } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    logger.info("Manager completion reported", {
      taskId,
      decision,
      codeQualityScore,
      managerModel,
    });

    // Store review feedback
    task.reviewFeedback = feedback || null;

    // Handle decision
    let newStatus: typeof task.status;
    switch (decision) {
      case "approved":
        // Manager approved - proceed to deploy
        newStatus = "review_approved";
        logger.info("Manager approved PR, proceeding to deployment", { taskId });
        break;

      case "revision_needed":
        // Check if we can still revise
        task.revisionCount = (task.revisionCount || 0) + 1;
        if (task.canRevise()) {
          // Re-queue for worker to address feedback
          newStatus = "queued";
          task.taskNotes = `REVISION_RUN: Manager requested changes (attempt ${task.revisionCount}/3). Feedback: ${feedback}`;
          task.completedAt = null;
          task.ecsTaskArn = null;
          task.ecsTaskId = null;
          task.startedAt = null;
          logger.info("Manager requested revision, re-queueing task", {
            taskId,
            revisionCount: task.revisionCount
          });
        } else {
          // Max revisions reached - mark as failed
          newStatus = "failed";
          task.errorMessage = `Max revisions (3) reached. Final feedback: ${feedback}`;
          logger.info("Max revisions reached, marking task as failed", { taskId });
        }
        break;

      case "rejected":
        // Manager rejected - task cannot be completed
        newStatus = "review_rejected";
        task.errorMessage = `Rejected by Virtual Manager: ${feedback}`;
        logger.info("Manager rejected PR", { taskId, feedback });
        break;

      default:
        // Unknown decision - log but don't change status
        logger.warn("Unknown manager decision", { taskId, decision });
        res.status(400).json({ error: "Invalid decision value" });
        return;
    }

    task.status = newStatus;

    // If approved, always trigger deployment (manager approval implies deploy intent)
    // Tasks that went through manager review should auto-deploy after approval
    if (newStatus === "review_approved") {
      // Re-queue for deployment run
      task.status = "queued";
      task.taskNotes = `DEPLOYMENT_RUN: Manager approved PR. Deploy and merge.`;
      task.completedAt = null;
      task.ecsTaskArn = null;
      task.ecsTaskId = null;
      task.startedAt = null;
      logger.info("Manager approved, re-queueing for deployment", { taskId });
    }

    await taskRepo.save(task);

    logger.info("Manager completion processed", {
      taskId,
      newStatus: task.status,
      revisionCount: task.revisionCount,
    });

    res.json({
      status: "processed",
      taskId,
      newStatus: task.status,
      decision,
    });
  } catch (error) {
    logger.error("Error processing manager-complete", { error, taskId: req.params.id });
    res.status(500).json({ error: "Failed to process manager completion" });
  }
});

/**
 * POST /api/tasks/:id/logs
 * Post logs from worker container
 * Uses API key authentication (x-api-key header)
 */
router.post("/:id/logs", authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const org = req.organization!;
    const logs = req.body.logs as Array<{
      type: string;
      message: string;
      severity?: string;
      metadata?: Record<string, unknown>;
      command?: string;
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      filePath?: string;
      durationMs?: number;
    }>;

    if (!Array.isArray(logs) || logs.length === 0) {
      res.status(400).json({ error: "logs array is required" });
      return;
    }

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const logRepo = AppDataSource.getRepository(WorkerTaskLog);
    const logEntities = logs.map((log) =>
      logRepo.create({
        taskId,
        type: log.type as any,
        message: log.message,
        severity: (log.severity as any) || "info",
        metadata: log.metadata || null,
        command: log.command || null,
        exitCode: log.exitCode ?? null,
        stdout: log.stdout || null,
        stderr: log.stderr || null,
        filePath: log.filePath || null,
        durationMs: log.durationMs ?? null,
      })
    );

    await logRepo.save(logEntities);

    res.json({ success: true, count: logEntities.length });
  } catch (error) {
    logger.error("Error posting task logs", { error, taskId: req.params.id });
    res.status(500).json({ error: "Failed to post logs" });
  }
});

/**
 * POST /api/tasks/:id/usage
 * Update token usage for a task (called during execution)
 * Uses API key authentication (x-api-key header)
 */
router.post("/:id/usage", authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const org = req.organization!;
    const {
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
    } = req.body;

    const costTracker = getCostTracker(AppDataSource);
    const task = await costTracker.updateTaskUsage(taskId, {
      inputTokens: inputTokens ? Number(inputTokens) : undefined,
      outputTokens: outputTokens ? Number(outputTokens) : undefined,
      cacheCreationTokens: cacheCreationTokens ? Number(cacheCreationTokens) : undefined,
      cacheReadTokens: cacheReadTokens ? Number(cacheReadTokens) : undefined,
    });

    res.json({
      status: "updated",
      taskId,
      inputTokens: task.inputTokens,
      outputTokens: task.outputTokens,
      estimatedCost: task.estimatedCostUsd,
    });
  } catch (error) {
    logger.error("Error updating task usage", { error, taskId: req.params.id });
    res.status(500).json({ error: "Failed to update task usage" });
  }
});

export default router;
