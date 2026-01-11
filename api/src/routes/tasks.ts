import { Router, Request, Response } from "express";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask, WorkerTaskLog } from "../models/index.js";
import { authenticateRequest, authenticateApiKey } from "../middleware/auth.js";
import { getECSTaskRunner } from "../services/ecs-task-runner.js";
import { getCostTracker } from "../services/cost-tracker.js";
import { logger } from "../utils/logger.js";

const router = Router();

// All routes require authentication
router.use(authenticateRequest);

/**
 * POST /api/tasks
 * Create a new task manually
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const { jiraIssueKey, workerPersona, workerModel, summary, skipManagerReview } = req.body;

    if (!jiraIssueKey) {
      res.status(400).json({ error: "jiraIssueKey is required" });
      return;
    }

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
      workerModel: workerModel || "claude-sonnet-4-20250514",
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
});

/**
 * GET /api/tasks
 * List tasks for the authenticated organization
 */
router.get("/", async (req: Request, res: Response) => {
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
});

/**
 * GET /api/tasks/:id
 * Get a specific task
 */
router.get("/:id", async (req: Request, res: Response) => {
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
});

/**
 * GET /api/tasks/:id/logs
 * Get logs for a task
 */
router.get("/:id/logs", async (req: Request, res: Response) => {
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
});

/**
 * POST /api/tasks/:id/cancel
 * Cancel a running task
 */
router.post("/:id/cancel", async (req: Request, res: Response) => {
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
});

/**
 * POST /api/tasks/:id/retry
 * Retry a failed task
 */
router.post("/:id/retry", async (req: Request, res: Response) => {
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

    if (!task.canRetry()) {
      res.status(400).json({
        error: "Task cannot be retried",
        reason: task.retryCount >= task.maxRetries ? "Max retries exceeded" : "Task not in failed state",
      });
      return;
    }

    // Reset task for retry
    task.status = "queued";
    task.retryCount += 1;
    task.errorMessage = null;
    task.ecsTaskArn = null;
    task.ecsTaskId = null;
    await taskRepo.save(task);

    logger.info("Task queued for retry", { taskId: id, orgId, retryCount: task.retryCount });
    res.json(task);
  } catch (error) {
    logger.error("Error retrying task", { error, taskId: req.params.id });
    res.status(500).json({ error: "Failed to retry task" });
  }
});

/**
 * DELETE /api/tasks/:id
 * Delete a task from history
 */
router.delete("/:id", async (req: Request, res: Response) => {
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

    // Only allow deleting terminal tasks
    if (!task.isTerminal() && task.status !== "queued") {
      res.status(400).json({
        error: "Cannot delete active task",
        reason: "Only completed, failed, cancelled, or queued tasks can be deleted"
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

    // Update token counts
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

    // Calculate ECS task duration
    if (task.startedAt) {
      task.ecsTaskSeconds = Math.floor((new Date().getTime() - task.startedAt.getTime()) / 1000);
    }

    // Calculate cost
    task.estimatedCostUsd = task.calculateCost();

    await taskRepo.save(task);

    // Record cost to org cumulative
    try {
      const costTracker = getCostTracker(AppDataSource);
      await costTracker.recordTaskCost(taskId);
    } catch (costError) {
      logger.error("Failed to record task cost", { taskId, error: costError });
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
