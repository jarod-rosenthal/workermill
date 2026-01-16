/**
 * WorkerMill Analytics Routes
 *
 * API endpoints for usage statistics and analytics.
 */

import { Router, Request, Response } from "express";
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

    // Get aggregated stats in a single query (replaces multiple .filter() calls)
    const statsRaw = await taskRepo
      .createQueryBuilder("task")
      .select("COUNT(*)", "total")
      .addSelect("COUNT(CASE WHEN task.status = 'completed' THEN 1 END)", "completed")
      .addSelect("COUNT(CASE WHEN task.status = 'failed' THEN 1 END)", "failed")
      .addSelect("COUNT(CASE WHEN task.status = 'deployed' THEN 1 END)", "deployed")
      .addSelect("COUNT(CASE WHEN task.status IN ('queued', 'claimed', 'executing', 'environment_setup') THEN 1 END)", "inProgress")
      .addSelect("COALESCE(SUM(task.estimatedCostUsd), 0)", "totalCost")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .getRawOne();

    const stats = {
      total: parseInt(statsRaw.total) || 0,
      completed: parseInt(statsRaw.completed) || 0,
      failed: parseInt(statsRaw.failed) || 0,
      deployed: parseInt(statsRaw.deployed) || 0,
      inProgress: parseInt(statsRaw.inProgress) || 0,
    };
    const totalCost = parseFloat(statsRaw.totalCost) || 0;

    // Get daily aggregation in a single query (replaces JS loop)
    const dailyRaw = await taskRepo
      .createQueryBuilder("task")
      .select("DATE(task.createdAt)", "date")
      .addSelect("COUNT(*)", "tasks")
      .addSelect("COALESCE(SUM(task.estimatedCostUsd), 0)", "cost")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .groupBy("DATE(task.createdAt)")
      .orderBy("date", "ASC")
      .getRawMany();

    // Build daily map with all dates in range (fill gaps with zeros)
    const dailyMap = new Map<string, { tasks: number; cost: number }>();
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split("T")[0];
      dailyMap.set(dateStr, { tasks: 0, cost: 0 });
    }

    // Merge in actual data from SQL
    for (const row of dailyRaw) {
      // PostgreSQL DATE() returns a Date object or string depending on driver
      const dateStr = row.date instanceof Date
        ? row.date.toISOString().split("T")[0]
        : String(row.date).split("T")[0];
      if (dailyMap.has(dateStr)) {
        dailyMap.set(dateStr, {
          tasks: parseInt(row.tasks) || 0,
          cost: parseFloat(row.cost) || 0,
        });
      }
    }

    const daily = Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        tasks: data.tasks,
        cost: data.cost,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

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

    // Get totals in a single query
    const totalsRaw = await taskRepo
      .createQueryBuilder("task")
      .select("COUNT(*)", "taskCount")
      .addSelect("COALESCE(SUM(task.estimatedCostUsd), 0)", "totalCost")
      .addSelect("COALESCE(SUM(task.inputTokens), 0) + COALESCE(SUM(task.outputTokens), 0)", "totalTokens")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .getRawOne();

    const totalCost = parseFloat(totalsRaw.totalCost) || 0;
    const totalTasks = parseInt(totalsRaw.taskCount) || 0;
    const totalTokens = parseInt(totalsRaw.totalTokens) || 0;

    // Get cost breakdown by model in a single query
    const byModelRaw = await taskRepo
      .createQueryBuilder("task")
      .select("COALESCE(task.workerModel, 'unknown')", "model")
      .addSelect("COUNT(*)", "tasks")
      .addSelect("COALESCE(SUM(task.estimatedCostUsd), 0)", "cost")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .groupBy("task.workerModel")
      .getRawMany();

    // Get cost breakdown by persona in a single query
    const byPersonaRaw = await taskRepo
      .createQueryBuilder("task")
      .select("COALESCE(task.workerPersona, 'unknown')", "persona")
      .addSelect("COUNT(*)", "tasks")
      .addSelect("COALESCE(SUM(task.estimatedCostUsd), 0)", "cost")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .groupBy("task.workerPersona")
      .getRawMany();

    // Convert to response format
    const byModel: Record<string, { cost: number; tasks: number }> = {};
    for (const row of byModelRaw) {
      const model = row.model || "unknown";
      byModel[model] = {
        cost: Math.round((parseFloat(row.cost) || 0) * 100) / 100,
        tasks: parseInt(row.tasks) || 0,
      };
    }

    const byPersona: Record<string, { cost: number; tasks: number }> = {};
    for (const row of byPersonaRaw) {
      const persona = row.persona || "unknown";
      byPersona[persona] = {
        cost: Math.round((parseFloat(row.cost) || 0) * 100) / 100,
        tasks: parseInt(row.tasks) || 0,
      };
    }

    res.json({
      total: {
        cost: Math.round(totalCost * 100) / 100,
        tasks: totalTasks,
        tokens: totalTokens,
      },
      byModel,
      byPersona,
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

    // Get worker stats via SQL aggregation (single query instead of JS loops)
    const workerStatsRaw = await taskRepo
      .createQueryBuilder("task")
      .select("COALESCE(task.workerPersona, 'unknown')", "persona")
      .addSelect("COUNT(*)", "total")
      .addSelect("COUNT(CASE WHEN task.status IN ('completed', 'deployed') THEN 1 END)", "success")
      .addSelect("AVG(task.ecsTaskSeconds)", "avgDuration")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.status IN (:...statuses)", { statuses: ["completed", "failed", "deployed"] })
      .groupBy("task.workerPersona")
      .getRawMany();

    // Convert to response format
    const workerStats = workerStatsRaw.map((row) => {
      const total = parseInt(row.total) || 0;
      const success = parseInt(row.success) || 0;
      const avgDuration = parseFloat(row.avgDuration) || 0;

      return {
        persona: row.persona || "unknown",
        total,
        success,
        successRate: total > 0 ? Math.round((success / total) * 100) : 0,
        avgDuration: Math.round(avgDuration),
      };
    });

    res.json({ workers: workerStats });
  } catch (error) {
    logger.error("Error fetching worker analytics", { error });
    res.status(500).json({ error: "Failed to fetch worker analytics" });
  }
});

export default router;
