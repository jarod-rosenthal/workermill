/**
 * WorkerMill Analytics Routes
 *
 * API endpoints for usage statistics and analytics.
 */

import { Router, Request, Response } from "express";
import { Between, In } from "typeorm";
import { authenticateUser } from "../middleware/auth.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { logger } from "../utils/logger.js";

const router = Router();

// All routes require authentication
router.use(authenticateUser);

/**
 * GET /api/analytics/tasks
 * Get task statistics for the organization
 */
router.get("/tasks", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";

    // Calculate date range
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Get all tasks in range
    const tasks = await taskRepo.find({
      where: {
        orgId: org.id,
        createdAt: Between(startDate, new Date()),
      },
      select: ["id", "status", "createdAt", "estimatedCostUsd"],
    });

    // Calculate stats
    const stats = {
      total: tasks.length,
      completed: tasks.filter((t) => t.status === "completed").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      deployed: tasks.filter((t) => t.status === "deployed").length,
      inProgress: tasks.filter((t) =>
        ["queued", "claimed", "executing", "environment_setup"].includes(t.status)
      ).length,
    };

    // Calculate daily usage
    const dailyMap = new Map<string, { tasks: number; cost: number }>();

    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split("T")[0];
      dailyMap.set(dateStr, { tasks: 0, cost: 0 });
    }

    for (const task of tasks) {
      const dateStr = task.createdAt.toISOString().split("T")[0];
      const existing = dailyMap.get(dateStr);
      if (existing) {
        existing.tasks += 1;
        existing.cost += task.estimatedCostUsd || 0;
      }
    }

    const daily = Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        tasks: data.tasks,
        cost: data.cost,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Calculate totals
    const totalCost = tasks.reduce((sum, t) => sum + (t.estimatedCostUsd || 0), 0);

    res.json({
      stats,
      daily,
      summary: {
        totalTasks: stats.total,
        totalCost: Math.round(totalCost * 100) / 100,
        successRate:
          stats.total > 0
            ? Math.round(
                ((stats.completed + stats.deployed) / stats.total) * 100
              )
            : 0,
      },
    });
  } catch (error) {
    logger.error("Error fetching task analytics", { error });
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

/**
 * GET /api/analytics/costs
 * Get cost breakdown for the organization
 */
router.get("/costs", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";

    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    const tasks = await taskRepo.find({
      where: {
        orgId: org.id,
        createdAt: Between(startDate, new Date()),
      },
      select: ["workerModel", "workerPersona", "estimatedCostUsd", "inputTokens", "outputTokens"],
    });

    // Group by model
    const byModel = new Map<string, { cost: number; tasks: number }>();
    for (const task of tasks) {
      const model = task.workerModel || "unknown";
      const existing = byModel.get(model) || { cost: 0, tasks: 0 };
      existing.cost += task.estimatedCostUsd || 0;
      existing.tasks += 1;
      byModel.set(model, existing);
    }

    // Group by persona
    const byPersona = new Map<string, { cost: number; tasks: number }>();
    for (const task of tasks) {
      const persona = task.workerPersona || "unknown";
      const existing = byPersona.get(persona) || { cost: 0, tasks: 0 };
      existing.cost += task.estimatedCostUsd || 0;
      existing.tasks += 1;
      byPersona.set(persona, existing);
    }

    const totalCost = tasks.reduce((sum, t) => sum + (t.estimatedCostUsd || 0), 0);
    const totalTokens = tasks.reduce(
      (sum, t) => sum + (t.inputTokens || 0) + (t.outputTokens || 0),
      0
    );

    res.json({
      total: {
        cost: Math.round(totalCost * 100) / 100,
        tasks: tasks.length,
        tokens: totalTokens,
      },
      byModel: Object.fromEntries(
        Array.from(byModel.entries()).map(([model, data]) => [
          model,
          {
            cost: Math.round(data.cost * 100) / 100,
            tasks: data.tasks,
          },
        ])
      ),
      byPersona: Object.fromEntries(
        Array.from(byPersona.entries()).map(([persona, data]) => [
          persona,
          {
            cost: Math.round(data.cost * 100) / 100,
            tasks: data.tasks,
          },
        ])
      ),
    });
  } catch (error) {
    logger.error("Error fetching cost analytics", { error });
    res.status(500).json({ error: "Failed to fetch cost analytics" });
  }
});

/**
 * GET /api/analytics/workers
 * Get worker performance statistics
 */
router.get("/workers", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";

    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    const tasks = await taskRepo.find({
      where: {
        orgId: org.id,
        createdAt: Between(startDate, new Date()),
        status: In(["completed", "failed", "deployed"]),
      },
      select: ["workerPersona", "workerModel", "status", "ecsTaskSeconds"],
    });

    // Group by persona
    const byPersona = new Map<
      string,
      { total: number; success: number; avgDuration: number; durations: number[] }
    >();

    for (const task of tasks) {
      const persona = task.workerPersona || "unknown";
      const existing = byPersona.get(persona) || {
        total: 0,
        success: 0,
        avgDuration: 0,
        durations: [],
      };

      existing.total += 1;
      if (task.status === "completed" || task.status === "deployed") {
        existing.success += 1;
      }
      if (task.ecsTaskSeconds) {
        existing.durations.push(task.ecsTaskSeconds);
      }

      byPersona.set(persona, existing);
    }

    // Calculate averages
    const workerStats = Array.from(byPersona.entries()).map(([persona, data]) => ({
      persona,
      total: data.total,
      success: data.success,
      successRate: Math.round((data.success / data.total) * 100),
      avgDuration:
        data.durations.length > 0
          ? Math.round(
              data.durations.reduce((a, b) => a + b, 0) / data.durations.length
            )
          : 0,
    }));

    res.json({ workers: workerStats });
  } catch (error) {
    logger.error("Error fetching worker analytics", { error });
    res.status(500).json({ error: "Failed to fetch worker analytics" });
  }
});

export default router;
