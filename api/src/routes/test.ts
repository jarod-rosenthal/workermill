import { Router, Request, Response } from "express";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { WorkerTaskLog } from "../models/WorkerTaskLog.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

/**
 * Test routes for E2E testing.
 *
 * IMPORTANT: These routes are ONLY available in development/sandbox environments.
 * They provide direct database manipulation for test setup/teardown.
 *
 * These routes are NOT protected by normal authentication to allow
 * test automation to set up and tear down test data.
 */

const router = Router();

// Environment check middleware - only allow in non-production environments
router.use((_req: Request, res: Response, next) => {
  if (config.nodeEnv === "production") {
    logger.warn("Test routes accessed in production - blocking");
    res.status(403).json({ error: "Test routes disabled in production" });
    return;
  }
  next();
});

/**
 * Claim a task (simulates orchestrator claiming).
 * POST /api/test/tasks/:taskId/claim
 */
router.post("/tasks/:taskId/claim", async (req: Request<{ taskId: string }>, res: Response) => {
  const taskId = req.params.taskId;

  try {
    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Atomic claim with UPDATE...WHERE
    const result = await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        status: "executing",
        startedAt: new Date(),
      })
      .where("id = :id AND status = :status", {
        id: taskId,
        status: "queued",
      })
      .execute();

    if (result.affected === 0) {
      res.status(409).json({
        error: "Task not available for claiming",
        message: "Task may already be running or completed",
      });
      return;
    }

    const task = await taskRepo.findOne({ where: { id: taskId } });

    logger.info("Test: Task claimed", { taskId });
    res.json({ success: true, task });
  } catch (error) {
    logger.error("Test: Failed to claim task", { taskId, error });
    res.status(500).json({ error: "Failed to claim task" });
  }
});

/**
 * Complete a task (simulates worker completing).
 * POST /api/test/tasks/:taskId/complete
 */
router.post("/tasks/:taskId/complete", async (req: Request<{ taskId: string }>, res: Response) => {
  const taskId = req.params.taskId;
  const { prUrl } = req.body;

  try {
    const taskRepo = AppDataSource.getRepository(WorkerTask);

    await taskRepo.update(taskId, {
      status: "completed",
      completedAt: new Date(),
      githubPrUrl: prUrl || null,
    });

    const task = await taskRepo.findOne({ where: { id: taskId } });

    logger.info("Test: Task completed", { taskId });
    res.json({ success: true, task });
  } catch (error) {
    logger.error("Test: Failed to complete task", { taskId, error });
    res.status(500).json({ error: "Failed to complete task" });
  }
});

/**
 * Fail a task (simulates worker failing).
 * POST /api/test/tasks/:taskId/fail
 */
router.post("/tasks/:taskId/fail", async (req: Request<{ taskId: string }>, res: Response) => {
  const taskId = req.params.taskId;
  const { error: errorMessage } = req.body;

  try {
    const taskRepo = AppDataSource.getRepository(WorkerTask);

    await taskRepo.update(taskId, {
      status: "failed",
      completedAt: new Date(),
      errorMessage: errorMessage || "Test failure",
    });

    const task = await taskRepo.findOne({ where: { id: taskId } });

    logger.info("Test: Task failed", { taskId, errorMessage });
    res.json({ success: true, task });
  } catch (error) {
    logger.error("Test: Failed to fail task", { taskId, error });
    res.status(500).json({ error: "Failed to fail task" });
  }
});

/**
 * Delete a test task and its logs.
 * DELETE /api/test/tasks/:taskId
 */
router.delete("/tasks/:taskId", async (req: Request<{ taskId: string }>, res: Response) => {
  const taskId = req.params.taskId;

  try {
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);

    // Get the task to verify it's a test task
    const task = await taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Only allow deletion of E2E test tasks
    if (!task.jiraIssueKey?.startsWith("E2E-")) {
      res.status(403).json({
        error: "Only E2E test tasks can be deleted",
        message: "Task jiraIssueKey must start with E2E-",
      });
      return;
    }

    // Delete logs first (foreign key constraint)
    await logRepo.delete({ taskId });

    // Delete the task
    await taskRepo.delete(taskId);

    logger.info("Test: Task deleted", { taskId, jiraIssueKey: task.jiraIssueKey });
    res.json({ success: true, deleted: taskId });
  } catch (error) {
    logger.error("Test: Failed to delete task", { taskId, error });
    res.status(500).json({ error: "Failed to delete task" });
  }
});

/**
 * Cleanup all E2E test tasks.
 * DELETE /api/test/cleanup
 *
 * Query params:
 * - prefix: jiraIssueKey prefix to match (default: E2E-TEST-)
 * - maxAge: max age in hours (default: 24)
 */
router.delete("/cleanup", async (req: Request, res: Response) => {
  const prefix = (req.query.prefix as string) || "E2E-TEST-";
  const maxAge = parseInt(req.query.maxAge as string) || 24;

  try {
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);

    // Find test tasks matching prefix and age
    const cutoffDate = new Date(Date.now() - maxAge * 60 * 60 * 1000);

    const testTasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.jira_issue_key LIKE :pattern", { pattern: `${prefix}%` })
      .andWhere("task.created_at < :cutoff", { cutoff: cutoffDate })
      .getMany();

    const taskIds = testTasks.map((t) => t.id);

    if (taskIds.length === 0) {
      res.json({ success: true, deleted: 0 });
      return;
    }

    // Delete logs for these tasks
    await logRepo.createQueryBuilder().delete().where("task_id IN (:...taskIds)", { taskIds }).execute();

    // Delete the tasks
    await taskRepo.createQueryBuilder().delete().where("id IN (:...taskIds)", { taskIds }).execute();

    logger.info("Test: Cleanup completed", { prefix, deleted: taskIds.length });
    res.json({ success: true, deleted: taskIds.length, taskIds });
  } catch (error) {
    logger.error("Test: Failed to cleanup tasks", { prefix, error });
    res.status(500).json({ error: "Failed to cleanup tasks" });
  }
});

/**
 * Health check for test routes.
 * GET /api/test/health
 */
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    environment: config.nodeEnv,
    testRoutesEnabled: true,
    timestamp: new Date().toISOString(),
  });
});

export const testRouter = router;
