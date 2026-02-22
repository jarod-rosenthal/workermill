import { Router, Request, Response } from "express";
import { MoreThan } from "typeorm";
import { authenticateRequest } from "../middleware/auth.js";
import { AppDataSource } from "../db/connection.js";
import { Organization, WorkerTask } from "../models/index.js";
import { logger } from "../utils/logger.js";
import { startOrchestrator, stopOrchestrator } from "../services/orchestrator.js";

const router = Router();
router.use(authenticateRequest);

router.get("/status", async (req: Request, res: Response) => {
  const org = req.organization!;
  res.json({
    systemEnabled: org.systemEnabled,
    orchestrator: { running: org.orchestratorRunning, desiredCount: 1 },
    executors: { running: 0 },
  });
});

router.post("/enable", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const orgRepo = AppDataSource.getRepository(Organization);
    org.systemEnabled = true;
    await orgRepo.save(org);

    // Also start the orchestrator to resume task execution
    const autoStart = req.body?.autoStartOrchestrator !== false; // default true
    if (autoStart) {
      startOrchestrator();
    }

    logger.info("System enabled (maintenance mode exited)", {
      orgId: org.id,
      orchestratorStarted: autoStart,
    });
    res.json({
      success: true,
      message: "System enabled - maintenance mode exited",
      systemEnabled: true,
      orchestratorStarted: autoStart,
    });
  } catch (error) {
    logger.error("Failed to enable system", { error });
    res.status(500).json({ error: "Failed to enable system" });
  }
});

router.post("/disable", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const orgRepo = AppDataSource.getRepository(Organization);
    org.systemEnabled = false;
    await orgRepo.save(org);

    // Also stop the orchestrator to ensure immediate effect
    // This prevents any pending poll cycles from claiming tasks
    stopOrchestrator();

    logger.info("System disabled (maintenance mode entered)", {
      orgId: org.id,
      reason: req.body?.reason || "Maintenance mode enabled",
    });
    res.json({
      success: true,
      message: "System disabled - maintenance mode active",
      systemEnabled: false,
      orchestratorStopped: true,
    });
  } catch (error) {
    logger.error("Failed to disable system", { error });
    res.status(500).json({ error: "Failed to disable system" });
  }
});

/**
 * POST /api/system/fix-task
 * Admin endpoint to manually fix stuck tasks
 */
router.post("/fix-task", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const { taskId, status, prUrl, prNumber } = req.body;

    if (!taskId || !status) {
      res.status(400).json({ error: "taskId and status are required" });
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

    const oldStatus = task.status;
    const updates: Record<string, unknown> = { status };
    if (prUrl) updates.githubPrUrl = prUrl;
    if (prNumber) updates.githubPrNumber = Number(prNumber);
    if (!task.completedAt && ["completed", "deployed", "failed", "review_requested"].includes(status)) {
      updates.completedAt = new Date();
    }

    await taskRepo.update({ id: taskId, orgId: org.id }, updates);

    logger.info("Task manually fixed", {
      taskId,
      oldStatus,
      newStatus: status,
      orgId: org.id,
    });

    res.json({
      success: true,
      taskId,
      oldStatus,
      newStatus: status,
    });
  } catch (error) {
    logger.error("Failed to fix task", { error });
    res.status(500).json({ error: "Failed to fix task" });
  }
});

/**
 * POST /api/system/recalculate-costs
 * Recalculate costs for all tasks that have token data
 * This fixes historical tasks that may have incorrect cost calculations
 */
router.post("/recalculate-costs", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const orgRepo = AppDataSource.getRepository(Organization);

    // Find all tasks with any token data
    const tasks = await taskRepo.find({
      where: [
        { orgId: org.id, inputTokens: MoreThan(0) },
        { orgId: org.id, outputTokens: MoreThan(0) },
      ],
    });

    logger.info("Recalculating costs for tasks", {
      orgId: org.id,
      taskCount: tasks.length,
    });

    let totalCost = 0;
    const updates: Array<{ taskId: string; jiraKey: string; oldCost: number; newCost: number }> = [];

    for (const task of tasks) {
      const oldCost = task.estimatedCostUsd || 0;

      // Calculate ECS duration if not set
      if (!task.ecsTaskSeconds && task.startedAt && task.completedAt) {
        task.ecsTaskSeconds = Math.floor(
          (task.completedAt.getTime() - task.startedAt.getTime()) / 1000
        );
      }

      // Recalculate cost
      const newCost = task.calculateCost();
      task.estimatedCostUsd = newCost;
      totalCost += newCost;

      if (oldCost !== newCost) {
        updates.push({
          taskId: task.id,
          jiraKey: task.jiraIssueKey || "unknown",
          oldCost,
          newCost,
        });
      }

      await taskRepo.save(task);
    }

    // Update org cumulative cost
    org.cumulativeCostUsd = totalCost;
    await orgRepo.save(org);

    logger.info("Costs recalculated", {
      orgId: org.id,
      taskCount: tasks.length,
      updatedCount: updates.length,
      totalCost,
    });

    res.json({
      success: true,
      taskCount: tasks.length,
      updatedCount: updates.length,
      totalCost: Number(totalCost.toFixed(4)),
      updates,
    });
  } catch (error) {
    logger.error("Failed to recalculate costs", { error });
    res.status(500).json({ error: "Failed to recalculate costs" });
  }
});

export default router;
