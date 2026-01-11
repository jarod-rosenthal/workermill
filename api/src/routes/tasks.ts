import { Router, Request, Response } from "express";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/index.js";
import { authenticateRequest } from "../middleware/auth.js";
import { getECSTaskRunner } from "../services/ecs-task-runner.js";
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
    const { jiraIssueKey, workerPersona, workerModel, summary } = req.body;

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

export default router;
