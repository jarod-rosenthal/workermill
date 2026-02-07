/**
 * WorkerMill Analytics Routes
 *
 * API endpoints for usage statistics and analytics.
 */

import { Router, Request, Response } from "express";
import { In } from "typeorm";
import { authenticateUser } from "../middleware/auth.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { WorkerTaskTokenUsage } from "../models/WorkerTaskTokenUsage.js";
import { logger } from "../utils/logger.js";
import { classifyComplexity, getTierDescription, type ComplexityTier } from "../services/complexity-classifier.js";
import { fetchJiraIssue } from "../utils/jira.js";

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
 * GET /api/analytics/token-usage
 * Get token usage trends for AI FinOps analytics
 *
 * Provides:
 * - Daily/weekly token usage trends
 * - Breakdown by phase (planning, execution, review, deployment, improvement)
 * - Breakdown by persona and model
 * - Cost trends alongside token counts
 * - Cache efficiency metrics
 */
router.get("/token-usage", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";

    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const usageRepo = AppDataSource.getRepository(WorkerTaskTokenUsage);
    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Get total aggregates
    const totalsRaw = await usageRepo
      .createQueryBuilder("usage")
      .innerJoin(WorkerTask, "task", "task.id = usage.taskId")
      .select("COUNT(DISTINCT usage.taskId)", "taskCount")
      .addSelect("COALESCE(SUM(usage.inputTokens), 0)", "totalInputTokens")
      .addSelect("COALESCE(SUM(usage.outputTokens), 0)", "totalOutputTokens")
      .addSelect("COALESCE(SUM(usage.cacheCreationTokens), 0)", "totalCacheCreation")
      .addSelect("COALESCE(SUM(usage.cacheReadTokens), 0)", "totalCacheRead")
      .addSelect("COALESCE(SUM(usage.estimatedCostUsd), 0)", "totalCost")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("usage.createdAt >= :startDate", { startDate })
      .getRawOne();

    const totalInputTokens = parseInt(totalsRaw.totalInputTokens) || 0;
    const totalOutputTokens = parseInt(totalsRaw.totalOutputTokens) || 0;
    const totalCacheCreation = parseInt(totalsRaw.totalCacheCreation) || 0;
    const totalCacheRead = parseInt(totalsRaw.totalCacheRead) || 0;
    const totalCost = parseFloat(totalsRaw.totalCost) || 0;
    const taskCount = parseInt(totalsRaw.taskCount) || 0;

    // Calculate cache efficiency (cache reads / total input)
    const totalInput = totalInputTokens + totalCacheRead;
    const cacheEfficiency = totalInput > 0 ? Math.round((totalCacheRead / totalInput) * 100) : 0;

    // Get breakdown by phase
    const byPhaseRaw = await usageRepo
      .createQueryBuilder("usage")
      .innerJoin(WorkerTask, "task", "task.id = usage.taskId")
      .select("usage.phase", "phase")
      .addSelect("COUNT(*)", "records")
      .addSelect("COALESCE(SUM(usage.inputTokens), 0)", "inputTokens")
      .addSelect("COALESCE(SUM(usage.outputTokens), 0)", "outputTokens")
      .addSelect("COALESCE(SUM(usage.cacheReadTokens), 0)", "cacheReadTokens")
      .addSelect("COALESCE(SUM(usage.estimatedCostUsd), 0)", "cost")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("usage.createdAt >= :startDate", { startDate })
      .groupBy("usage.phase")
      .getRawMany();

    // Get breakdown by persona
    const byPersonaRaw = await usageRepo
      .createQueryBuilder("usage")
      .innerJoin(WorkerTask, "task", "task.id = usage.taskId")
      .select("COALESCE(usage.persona, 'unknown')", "persona")
      .addSelect("COUNT(*)", "records")
      .addSelect("COALESCE(SUM(usage.inputTokens + usage.outputTokens), 0)", "totalTokens")
      .addSelect("COALESCE(SUM(usage.estimatedCostUsd), 0)", "cost")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("usage.createdAt >= :startDate", { startDate })
      .groupBy("usage.persona")
      .orderBy("SUM(usage.estimatedCostUsd)", "DESC")
      .getRawMany();

    // Get breakdown by model
    const byModelRaw = await usageRepo
      .createQueryBuilder("usage")
      .innerJoin(WorkerTask, "task", "task.id = usage.taskId")
      .select("COALESCE(usage.model, 'unknown')", "model")
      .addSelect("COUNT(*)", "records")
      .addSelect("COALESCE(SUM(usage.inputTokens + usage.outputTokens), 0)", "totalTokens")
      .addSelect("COALESCE(SUM(usage.estimatedCostUsd), 0)", "cost")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("usage.createdAt >= :startDate", { startDate })
      .groupBy("usage.model")
      .orderBy("SUM(usage.estimatedCostUsd)", "DESC")
      .getRawMany();

    // Get daily/weekly trends
    const useDailyBuckets = days <= 30;
    const dateGrouping = useDailyBuckets
      ? "DATE(usage.createdAt)"
      : "DATE_TRUNC('week', usage.createdAt)";

    const trendsRaw = await usageRepo
      .createQueryBuilder("usage")
      .innerJoin(WorkerTask, "task", "task.id = usage.taskId")
      .select(dateGrouping, "date")
      .addSelect("COUNT(DISTINCT usage.taskId)", "tasks")
      .addSelect("COALESCE(SUM(usage.inputTokens), 0)", "inputTokens")
      .addSelect("COALESCE(SUM(usage.outputTokens), 0)", "outputTokens")
      .addSelect("COALESCE(SUM(usage.cacheReadTokens), 0)", "cacheReadTokens")
      .addSelect("COALESCE(SUM(usage.estimatedCostUsd), 0)", "cost")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("usage.createdAt >= :startDate", { startDate })
      .groupBy(dateGrouping)
      .orderBy("date", "ASC")
      .getRawMany();

    // Get breakdown by operation type
    const byOperationRaw = await usageRepo
      .createQueryBuilder("usage")
      .innerJoin(WorkerTask, "task", "task.id = usage.taskId")
      .select("COALESCE(usage.operationType, 'other')", "operationType")
      .addSelect("COUNT(*)", "records")
      .addSelect("COALESCE(SUM(usage.inputTokens + usage.outputTokens), 0)", "totalTokens")
      .addSelect("COALESCE(SUM(usage.estimatedCostUsd), 0)", "cost")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("usage.createdAt >= :startDate", { startDate })
      .groupBy("usage.operationType")
      .orderBy("SUM(usage.estimatedCostUsd)", "DESC")
      .getRawMany();

    // Format response
    res.json({
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      summary: {
        taskCount,
        totalInputTokens,
        totalOutputTokens,
        totalCacheCreation,
        totalCacheRead,
        totalTokens: totalInputTokens + totalOutputTokens + totalCacheCreation + totalCacheRead,
        totalCost: Math.round(totalCost * 100) / 100,
        cacheEfficiency,
        avgTokensPerTask: taskCount > 0
          ? Math.round((totalInputTokens + totalOutputTokens) / taskCount)
          : 0,
        avgCostPerTask: taskCount > 0
          ? Math.round((totalCost / taskCount) * 100) / 100
          : 0,
      },
      byPhase: byPhaseRaw.map((row) => ({
        phase: row.phase,
        records: parseInt(row.records) || 0,
        inputTokens: parseInt(row.inputTokens) || 0,
        outputTokens: parseInt(row.outputTokens) || 0,
        cacheReadTokens: parseInt(row.cacheReadTokens) || 0,
        cost: Math.round((parseFloat(row.cost) || 0) * 100) / 100,
      })),
      byPersona: byPersonaRaw.map((row) => ({
        persona: row.persona || "unknown",
        records: parseInt(row.records) || 0,
        totalTokens: parseInt(row.totalTokens) || 0,
        cost: Math.round((parseFloat(row.cost) || 0) * 100) / 100,
      })),
      byModel: byModelRaw.map((row) => ({
        model: row.model || "unknown",
        records: parseInt(row.records) || 0,
        totalTokens: parseInt(row.totalTokens) || 0,
        cost: Math.round((parseFloat(row.cost) || 0) * 100) / 100,
      })),
      byOperationType: byOperationRaw.map((row) => ({
        operationType: row.operationType || "other",
        records: parseInt(row.records) || 0,
        totalTokens: parseInt(row.totalTokens) || 0,
        cost: Math.round((parseFloat(row.cost) || 0) * 100) / 100,
      })),
      trends: trendsRaw.map((row) => {
        const dateStr = row.date instanceof Date
          ? row.date.toISOString().split("T")[0]
          : String(row.date).split("T")[0];
        return {
          date: dateStr,
          tasks: parseInt(row.tasks) || 0,
          inputTokens: parseInt(row.inputTokens) || 0,
          outputTokens: parseInt(row.outputTokens) || 0,
          cacheReadTokens: parseInt(row.cacheReadTokens) || 0,
          cost: Math.round((parseFloat(row.cost) || 0) * 100) / 100,
        };
      }),
    });
  } catch (error) {
    logger.error("Error fetching token usage analytics", { error });
    res.status(500).json({ error: "Failed to fetch token usage analytics" });
  }
});

/**
 * GET /api/analytics/complexity-cost
 * Analyze historical task complexity versus actual cost
 *
 * Provides:
 * - Cost statistics by complexity level (low, medium, high)
 * - Token usage by complexity
 * - Cost predictability metrics
 * - Outlier detection for cost anomalies
 */
router.get("/complexity-cost", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "90d";

    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Get all tasks with plan data (PRD/Epic tasks)
    const tasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.planJson IS NOT NULL")
      .andWhere("task.status IN (:...statuses)", { statuses: ["completed", "deployed", "failed"] })
      .getMany();

    // Group by complexity level
    const byComplexity: Record<string, {
      count: number;
      costs: number[];
      tokens: number[];
      durations: number[];
      stories: number[];
      successCount: number;
    }> = {
      low: { count: 0, costs: [], tokens: [], durations: [], stories: [], successCount: 0 },
      medium: { count: 0, costs: [], tokens: [], durations: [], stories: [], successCount: 0 },
      high: { count: 0, costs: [], tokens: [], durations: [], stories: [], successCount: 0 },
      unknown: { count: 0, costs: [], tokens: [], durations: [], stories: [], successCount: 0 },
    };

    // Process each task
    for (const task of tasks) {
      const plan = task.planJson as Record<string, unknown> | null;
      if (!plan) continue;

      // Extract complexity
      const complexity = plan._complexity as { level?: string } | undefined;
      const level = complexity?.level || "unknown";
      const bucket = ["low", "medium", "high"].includes(level) ? level : "unknown";

      byComplexity[bucket].count++;

      // Cost
      const cost = parseFloat(String(task.estimatedCostUsd)) || 0;
      byComplexity[bucket].costs.push(cost);

      // Tokens
      const tokens = (task.inputTokens || 0) + (task.outputTokens || 0);
      byComplexity[bucket].tokens.push(tokens);

      // Duration
      const duration = task.getDurationSeconds();
      if (duration && duration > 0) {
        byComplexity[bucket].durations.push(duration);
      }

      // Stories count
      const stories = plan.stories as Array<unknown> | undefined;
      if (Array.isArray(stories)) {
        byComplexity[bucket].stories.push(stories.length);
      }

      // Success tracking
      if (task.status === "completed" || task.status === "deployed") {
        byComplexity[bucket].successCount++;
      }
    }

    // Calculate statistics for each complexity level
    function calcStats(arr: number[]) {
      if (arr.length === 0) return { min: 0, max: 0, avg: 0, median: 0, stdDev: 0 };

      const sorted = [...arr].sort((a, b) => a - b);
      const sum = arr.reduce((a, b) => a + b, 0);
      const avg = sum / arr.length;
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
      const variance = arr.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / arr.length;
      const stdDev = Math.sqrt(variance);

      return {
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: Math.round(avg * 100) / 100,
        median: Math.round(median * 100) / 100,
        stdDev: Math.round(stdDev * 100) / 100,
      };
    }

    // Find cost outliers (> 2 stdDev from mean)
    const allCosts = tasks.map(t => parseFloat(String(t.estimatedCostUsd)) || 0);
    const costStats = calcStats(allCosts);
    const outlierThreshold = costStats.avg + 2 * costStats.stdDev;

    const outliers = tasks
      .filter(t => {
        const cost = parseFloat(String(t.estimatedCostUsd)) || 0;
        return cost > outlierThreshold && cost > 0;
      })
      .map(t => ({
        id: t.id,
        jiraKey: t.jiraIssueKey,
        summary: t.summary?.substring(0, 80),
        cost: parseFloat(String(t.estimatedCostUsd)) || 0,
        complexity: ((t.planJson as Record<string, unknown>)?._complexity as { level?: string })?.level || "unknown",
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);

    // Format response
    const complexityBreakdown = Object.entries(byComplexity).map(([level, data]) => ({
      complexity: level,
      taskCount: data.count,
      successRate: data.count > 0 ? Math.round((data.successCount / data.count) * 100) : 0,
      costStats: calcStats(data.costs),
      tokenStats: calcStats(data.tokens),
      durationStats: {
        ...calcStats(data.durations),
        // Convert to minutes for readability
        avgMinutes: data.durations.length > 0
          ? Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length / 60)
          : 0,
      },
      avgStories: data.stories.length > 0
        ? Math.round(data.stories.reduce((a, b) => a + b, 0) / data.stories.length * 10) / 10
        : 0,
    }));

    // Calculate cost predictability (coefficient of variation)
    const predictability: Record<string, number> = {};
    for (const [level, data] of Object.entries(byComplexity)) {
      const stats = calcStats(data.costs);
      // Lower CV = more predictable (CV = stdDev / mean)
      predictability[level] = stats.avg > 0
        ? Math.round((1 - Math.min(stats.stdDev / stats.avg, 1)) * 100)
        : 0;
    }

    res.json({
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      summary: {
        totalTasks: tasks.length,
        overallCostStats: costStats,
        outlierThreshold: Math.round(outlierThreshold * 100) / 100,
      },
      byComplexity: complexityBreakdown.filter(c => c.taskCount > 0),
      predictability,
      outliers,
      // Recommendations based on data
      insights: generateComplexityInsights(complexityBreakdown, predictability),
    });
  } catch (error) {
    logger.error("Error fetching complexity-cost analytics", { error });
    res.status(500).json({ error: "Failed to fetch complexity-cost analytics" });
  }
});

function generateComplexityInsights(
  breakdown: Array<{ complexity: string; taskCount: number; costStats: { avg: number; stdDev: number } }>,
  predictability: Record<string, number>
): string[] {
  const insights: string[] = [];

  // Find most predictable complexity level
  const mostPredictable = Object.entries(predictability)
    .filter(([_, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)[0];
  if (mostPredictable && mostPredictable[1] > 70) {
    insights.push(`"${mostPredictable[0]}" complexity tasks have ${mostPredictable[1]}% cost predictability.`);
  }

  // Check for high variance in any level
  for (const level of breakdown) {
    if (level.costStats.stdDev > level.costStats.avg * 0.5 && level.taskCount >= 3) {
      insights.push(`"${level.complexity}" tasks show high cost variance - consider breaking down further.`);
    }
  }

  // Compare low vs high complexity cost ratios
  const lowCost = breakdown.find(b => b.complexity === "low")?.costStats.avg || 0;
  const highCost = breakdown.find(b => b.complexity === "high")?.costStats.avg || 0;
  if (lowCost > 0 && highCost > 0) {
    const ratio = highCost / lowCost;
    insights.push(`High complexity tasks cost ${ratio.toFixed(1)}x more than low complexity on average.`);
  }

  return insights;
}

/**
 * GET /api/analytics/prd-metrics
 * Get PRD workflow metrics for fundraising/reporting
 *
 * Provides:
 * - Cost variance (planned vs actual)
 * - Time to completion by complexity
 * - Plan accuracy (stories planned vs executed)
 * - Success/failure breakdown
 */
router.get("/prd-metrics", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "90d";

    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Get PRD parent tasks (those with planJson)
    const prdTasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.planJson IS NOT NULL")
      .getMany();

    // Calculate metrics
    const totalPrdTasks = prdTasks.length;
    let completedPrd = 0;
    let failedPrd = 0;
    let totalPlannedStories = 0;
    let totalExecutedStories = 0;
    let totalPlannedCost = 0;
    let totalActualCost = 0;
    const costVariances: number[] = [];
    const durationsByComplexity: Record<string, number[]> = {
      low: [],
      medium: [],
      high: [],
      unknown: [],
    };

    for (const task of prdTasks) {
      // Count completed vs failed
      if (task.status === "completed" || task.status === "deployed") {
        completedPrd++;
      } else if (task.status === "failed" || task.status === "cancelled") {
        failedPrd++;
      }

      // Extract plan data
      const plan = task.planJson as Record<string, unknown> | null;
      if (plan) {
        // Cost estimate from planning phase
        const costEstimate = plan._costEstimate as { estimatedCost?: number } | undefined;
        if (costEstimate?.estimatedCost) {
          totalPlannedCost += costEstimate.estimatedCost;

          // Calculate actual cost from child tasks or self
          const actualCost = parseFloat(String(task.estimatedCostUsd)) || 0;
          if (actualCost > 0) {
            totalActualCost += actualCost;
            // Cost variance as percentage
            const variance = ((actualCost - costEstimate.estimatedCost) / costEstimate.estimatedCost) * 100;
            costVariances.push(variance);
          }
        }

        // Count planned stories
        const stories = plan.stories as Array<unknown> | undefined;
        if (Array.isArray(stories)) {
          totalPlannedStories += stories.length;
        }

        // Count executed stories (child tasks)
        if (task.childTaskIds && task.childTaskIds.length > 0) {
          totalExecutedStories += task.childTaskIds.length;
        }

        // Duration by complexity
        const complexity = plan._complexity as { level?: string } | undefined;
        const complexityLevel = complexity?.level || "unknown";
        const duration = task.getDurationSeconds();
        if (duration && duration > 0) {
          const level = ["low", "medium", "high"].includes(complexityLevel) ? complexityLevel : "unknown";
          durationsByComplexity[level].push(duration);
        }
      }
    }

    // Calculate averages
    const avgCostVariance = costVariances.length > 0
      ? costVariances.reduce((a, b) => a + b, 0) / costVariances.length
      : 0;

    const avgDurationByComplexity: Record<string, number> = {};
    for (const [level, durations] of Object.entries(durationsByComplexity)) {
      avgDurationByComplexity[level] = durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;
    }

    // Success rate
    const successRate = totalPrdTasks > 0
      ? Math.round((completedPrd / totalPrdTasks) * 100)
      : 0;

    // Plan accuracy (how close planned stories match executed)
    const planAccuracy = totalPlannedStories > 0
      ? Math.round((totalExecutedStories / totalPlannedStories) * 100)
      : 0;

    res.json({
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      summary: {
        totalPrdWorkflows: totalPrdTasks,
        completed: completedPrd,
        failed: failedPrd,
        inProgress: totalPrdTasks - completedPrd - failedPrd,
        successRate,
      },
      costVariance: {
        totalPlannedCost: Math.round(totalPlannedCost * 100) / 100,
        totalActualCost: Math.round(totalActualCost * 100) / 100,
        avgVariancePercent: Math.round(avgCostVariance * 10) / 10,
        dataPoints: costVariances.length,
      },
      planAccuracy: {
        totalPlannedStories,
        totalExecutedStories,
        accuracyPercent: planAccuracy,
      },
      timeToCompletion: {
        byComplexity: avgDurationByComplexity,
        // Convert to human-readable
        byComplexityReadable: {
          low: formatDuration(avgDurationByComplexity.low),
          medium: formatDuration(avgDurationByComplexity.medium),
          high: formatDuration(avgDurationByComplexity.high),
        },
      },
    });
  } catch (error) {
    logger.error("Error fetching PRD metrics", { error });
    res.status(500).json({ error: "Failed to fetch PRD metrics" });
  }
});

function formatDuration(seconds: number): string {
  if (!seconds) return "N/A";
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/**
 * Categorize an error message into a failure mode
 */
function categorizeFailure(errorMessage: string | null, status: string): string {
  if (!errorMessage) {
    if (status === "escalated") return "escalated";
    if (status === "cancelled") return "cancelled";
    if (status === "review_rejected") return "review_rejected";
    return "unknown";
  }

  const msg = errorMessage.toLowerCase();

  // Infrastructure failures
  if (msg.includes("spot") || msg.includes("interrupted") || msg.includes("exit 137")) {
    return "spot_interruption";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "timeout";
  }
  if (msg.includes("ecs") || msg.includes("container") || msg.includes("fargate")) {
    return "infrastructure";
  }
  if (msg.includes("memory") || msg.includes("oom") || msg.includes("out of memory")) {
    return "out_of_memory";
  }

  // Git/GitHub failures
  if (msg.includes("merge conflict") || msg.includes("conflict")) {
    return "merge_conflict";
  }
  if (msg.includes("git") || msg.includes("push") || msg.includes("pull")) {
    return "git_error";
  }
  if (msg.includes("github") || msg.includes("pr ") || msg.includes("pull request")) {
    return "github_error";
  }

  // Code/Build failures
  if (msg.includes("type") && (msg.includes("error") || msg.includes("check"))) {
    return "type_error";
  }
  if (msg.includes("build") || msg.includes("compile") || msg.includes("syntax")) {
    return "build_error";
  }
  if (msg.includes("test") && (msg.includes("fail") || msg.includes("error"))) {
    return "test_failure";
  }
  if (msg.includes("lint") || msg.includes("eslint") || msg.includes("prettier")) {
    return "lint_error";
  }

  // AI/Agent failures
  if (msg.includes("token") || msg.includes("context") || msg.includes("truncat")) {
    return "context_limit";
  }
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many")) {
    return "rate_limit";
  }
  if (msg.includes("api") && (msg.includes("error") || msg.includes("fail"))) {
    return "api_error";
  }

  // Task/Workflow failures
  if (msg.includes("dependency") || msg.includes("blocked")) {
    return "dependency_blocked";
  }
  if (msg.includes("permission") || msg.includes("auth") || msg.includes("denied")) {
    return "permission_error";
  }

  return "other";
}

/**
 * GET /api/analytics/failures
 * Get failure mode analysis for fundraising/debugging
 *
 * Provides:
 * - Failure categorization (infrastructure, code, AI, etc.)
 * - Failure trends over time
 * - Failure breakdown by persona/model
 * - Common error messages
 */
router.get("/failures", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "90d";

    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Get all failed/escalated/cancelled tasks with details
    const failedTasks = await taskRepo
      .createQueryBuilder("task")
      .select([
        "task.id",
        "task.status",
        "task.errorMessage",
        "task.workerPersona",
        "task.workerModel",
        "task.createdAt",
        "task.retryCount",
        "task.maxRetries",
      ])
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.status IN (:...statuses)", {
        statuses: ["failed", "escalated", "cancelled", "review_rejected"],
      })
      .getMany();

    // Get total task count for rate calculation
    const totalTasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .getCount();

    // Categorize failures
    const byCategory: Record<string, { count: number; examples: string[] }> = {};
    const byPersona: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    const byWeek: Record<string, number> = {};
    let retriedCount = 0;
    let maxRetriesExhausted = 0;

    for (const task of failedTasks) {
      // Categorize
      const category = categorizeFailure(task.errorMessage, task.status);
      if (!byCategory[category]) {
        byCategory[category] = { count: 0, examples: [] };
      }
      byCategory[category].count++;
      // Keep up to 3 example error messages per category
      if (task.errorMessage && byCategory[category].examples.length < 3) {
        const truncated = task.errorMessage.slice(0, 200);
        if (!byCategory[category].examples.includes(truncated)) {
          byCategory[category].examples.push(truncated);
        }
      }

      // By persona
      const persona = task.workerPersona || "unknown";
      byPersona[persona] = (byPersona[persona] || 0) + 1;

      // By model
      const model = task.workerModel || "unknown";
      byModel[model] = (byModel[model] || 0) + 1;

      // By week
      const weekStart = new Date(task.createdAt);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekKey = weekStart.toISOString().split("T")[0];
      byWeek[weekKey] = (byWeek[weekKey] || 0) + 1;

      // Retry tracking
      if (task.retryCount > 0) {
        retriedCount++;
      }
      if (task.retryCount >= task.maxRetries) {
        maxRetriesExhausted++;
      }
    }

    // Convert byCategory to sorted array
    const categoryBreakdown = Object.entries(byCategory)
      .map(([category, data]) => ({
        category,
        count: data.count,
        percentage: failedTasks.length > 0
          ? Math.round((data.count / failedTasks.length) * 100)
          : 0,
        examples: data.examples,
      }))
      .sort((a, b) => b.count - a.count);

    // Convert byWeek to sorted array
    const weeklyTrend = Object.entries(byWeek)
      .map(([week, count]) => ({ week, count }))
      .sort((a, b) => a.week.localeCompare(b.week));

    // Calculate failure rate
    const failureRate = totalTasks > 0
      ? Math.round((failedTasks.length / totalTasks) * 100)
      : 0;

    // Human-readable category names
    const categoryLabels: Record<string, string> = {
      spot_interruption: "Spot Instance Interruption",
      timeout: "Execution Timeout",
      infrastructure: "Infrastructure Error",
      out_of_memory: "Out of Memory",
      merge_conflict: "Merge Conflict",
      git_error: "Git Error",
      github_error: "GitHub API Error",
      type_error: "Type Check Error",
      build_error: "Build/Compile Error",
      test_failure: "Test Failure",
      lint_error: "Lint Error",
      context_limit: "Context Limit Exceeded",
      rate_limit: "API Rate Limit",
      api_error: "External API Error",
      dependency_blocked: "Dependency Blocked",
      permission_error: "Permission Denied",
      escalated: "Escalated (Needs Clarification)",
      cancelled: "Manually Cancelled",
      review_rejected: "Review Rejected (Max Revisions)",
      unknown: "Unknown",
      other: "Other",
    };

    res.json({
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      summary: {
        totalFailures: failedTasks.length,
        totalTasks,
        failureRate,
        retriedTasks: retriedCount,
        maxRetriesExhausted,
      },
      byCategory: categoryBreakdown.map((c) => ({
        ...c,
        label: categoryLabels[c.category] || c.category,
      })),
      byPersona: Object.entries(byPersona)
        .map(([persona, count]) => ({ persona, count }))
        .sort((a, b) => b.count - a.count),
      byModel: Object.entries(byModel)
        .map(([model, count]) => ({ model, count }))
        .sort((a, b) => b.count - a.count),
      weeklyTrend,
    });
  } catch (error) {
    logger.error("Error fetching failure analytics", { error });
    res.status(500).json({ error: "Failed to fetch failure analytics" });
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

/**
 * GET /api/analytics/effectiveness
 * Get worker effectiveness metrics derived automatically from task state transitions
 *
 * All metrics are calculated from existing task data - no manual input required.
 * This provides an audit trail of actual outcomes.
 *
 * Metrics:
 * - Success Rate: completed/deployed vs failed/cancelled/escalated
 * - PR Acceptance Rate: review_requested → deployed (via GitHub webhook approval)
 * - First-Attempt Success: completed with retryCount = 0
 * - Deployment Rate: tasks that reach deployed status
 * - Escalation Rate: tasks requiring human intervention
 */
router.get("/effectiveness", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";

    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Get all terminal-state tasks in time range (excludes in-progress tasks)
    const terminalStatuses = ["completed", "deployed", "failed", "cancelled", "escalated", "review_rejected"];
    const tasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.status IN (:...statuses)", { statuses: terminalStatuses })
      .getMany();

    const total = tasks.length;

    // Success = completed or deployed
    const successful = tasks.filter((t) => t.status === "completed" || t.status === "deployed");
    const successCount = successful.length;

    // Deployed = actually shipped to production
    const deployedCount = tasks.filter((t) => t.status === "deployed").length;

    // Failed states
    const failedCount = tasks.filter((t) => t.status === "failed").length;
    const cancelledCount = tasks.filter((t) => t.status === "cancelled").length;
    const escalatedCount = tasks.filter((t) => t.status === "escalated").length;
    const reviewRejectedCount = tasks.filter((t) => t.status === "review_rejected").length;

    // First-attempt success (no retries needed)
    const firstAttemptSuccess = successful.filter((t) => t.retryCount === 0).length;

    // PR acceptance rate: tasks that went through review and got deployed
    // (review_requested is an intermediate state, so we look at deployed tasks that had PRs)
    const tasksWithPRs = tasks.filter((t) => t.githubPrUrl);
    const prAccepted = tasksWithPRs.filter((t) => t.status === "deployed").length;
    const prRejected = tasksWithPRs.filter((t) => t.status === "review_rejected").length;
    const prTotal = prAccepted + prRejected;

    // Calculate rates
    const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;
    const deploymentRate = successCount > 0 ? Math.round((deployedCount / successCount) * 100) : 0;
    const firstAttemptRate = successCount > 0 ? Math.round((firstAttemptSuccess / successCount) * 100) : 0;
    const prAcceptanceRate = prTotal > 0 ? Math.round((prAccepted / prTotal) * 100) : 0;
    const escalationRate = total > 0 ? Math.round((escalatedCount / total) * 100) : 0;

    // Group by model
    const byModelMap = new Map<string, { total: number; success: number; deployed: number; firstAttempt: number }>();
    for (const task of tasks) {
      const model = task.workerModel || "unknown";
      const existing = byModelMap.get(model) || { total: 0, success: 0, deployed: 0, firstAttempt: 0 };
      existing.total++;
      if (task.status === "completed" || task.status === "deployed") {
        existing.success++;
        if (task.retryCount === 0) existing.firstAttempt++;
      }
      if (task.status === "deployed") existing.deployed++;
      byModelMap.set(model, existing);
    }

    const byModel = Array.from(byModelMap.entries())
      .map(([model, data]) => ({
        model,
        total: data.total,
        successRate: data.total > 0 ? Math.round((data.success / data.total) * 100) : 0,
        deploymentRate: data.success > 0 ? Math.round((data.deployed / data.success) * 100) : 0,
        firstAttemptRate: data.success > 0 ? Math.round((data.firstAttempt / data.success) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    // Group by persona
    const byPersonaMap = new Map<string, { total: number; success: number; deployed: number; firstAttempt: number }>();
    for (const task of tasks) {
      const persona = task.workerPersona || "unknown";
      const existing = byPersonaMap.get(persona) || { total: 0, success: 0, deployed: 0, firstAttempt: 0 };
      existing.total++;
      if (task.status === "completed" || task.status === "deployed") {
        existing.success++;
        if (task.retryCount === 0) existing.firstAttempt++;
      }
      if (task.status === "deployed") existing.deployed++;
      byPersonaMap.set(persona, existing);
    }

    const byPersona = Array.from(byPersonaMap.entries())
      .map(([persona, data]) => ({
        persona,
        total: data.total,
        successRate: data.total > 0 ? Math.round((data.success / data.total) * 100) : 0,
        deploymentRate: data.success > 0 ? Math.round((data.deployed / data.success) * 100) : 0,
        firstAttemptRate: data.success > 0 ? Math.round((data.firstAttempt / data.success) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    // Daily/weekly trend
    const trendMap = new Map<string, { success: number; failed: number; deployed: number; total: number }>();
    const useDailyBuckets = days <= 30;

    for (const task of tasks) {
      const taskDate = task.completedAt || task.createdAt;
      let bucketKey: string;

      if (useDailyBuckets) {
        bucketKey = taskDate.toISOString().split("T")[0];
      } else {
        const weekStart = new Date(taskDate);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        bucketKey = weekStart.toISOString().split("T")[0];
      }

      const existing = trendMap.get(bucketKey) || { success: 0, failed: 0, deployed: 0, total: 0 };
      existing.total++;
      if (task.status === "completed" || task.status === "deployed") existing.success++;
      if (task.status === "deployed") existing.deployed++;
      if (task.status === "failed" || task.status === "cancelled" || task.status === "escalated") existing.failed++;
      trendMap.set(bucketKey, existing);
    }

    const trend = Array.from(trendMap.entries())
      .map(([date, data]) => ({
        date,
        ...data,
        successRate: data.total > 0 ? Math.round((data.success / data.total) * 100) : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      summary: {
        total,
        successful: successCount,
        deployed: deployedCount,
        failed: failedCount,
        cancelled: cancelledCount,
        escalated: escalatedCount,
        reviewRejected: reviewRejectedCount,
        successRate,
        deploymentRate,
        firstAttemptRate,
        prAcceptanceRate,
        escalationRate,
      },
      prStats: {
        total: prTotal,
        accepted: prAccepted,
        rejected: prRejected,
        acceptanceRate: prAcceptanceRate,
      },
      byModel,
      byPersona,
      trend,
    });
  } catch (error) {
    logger.error("Error fetching effectiveness analytics", { error });
    res.status(500).json({ error: "Failed to fetch effectiveness analytics" });
  }
});

/**
 * GET /api/analytics/review-metrics
 * Get Virtual Manager Review analytics
 *
 * Provides:
 * - Review adoption rate (tasks using manager review)
 * - First-pass approval rate (approved without revisions)
 * - Revision distribution (0, 1, 2, 3+ revisions)
 * - Review decision breakdown (approved, revision_needed, rejected)
 * - Quality impact (accuracy comparison: reviewed vs non-reviewed)
 * - Efficiency analysis (time/cost: reviewed vs non-reviewed)
 * - Trends over time
 * - Breakdown by persona
 */
router.get("/review-metrics", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";

    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Get all terminal tasks for adoption calculation
    const terminalStatuses = ["completed", "deployed", "failed", "cancelled", "escalated", "review_rejected", "review_approved"];

    // Aggregate stats for adoption
    const adoptionRaw = await taskRepo
      .createQueryBuilder("task")
      .select("COUNT(*)", "total")
      .addSelect("COUNT(CASE WHEN task.skipManagerReview = false THEN 1 END)", "reviewedCount")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.status IN (:...statuses)", { statuses: terminalStatuses })
      .getRawOne();

    const totalTasks = parseInt(adoptionRaw.total) || 0;
    const reviewedTasks = parseInt(adoptionRaw.reviewedCount) || 0;
    const adoptionRate = totalTasks > 0 ? Math.round((reviewedTasks / totalTasks) * 100) : 0;

    // Get reviewed tasks with details for deeper analysis
    const reviewedTasksData = await taskRepo
      .createQueryBuilder("task")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.skipManagerReview = false")
      .andWhere("task.status IN (:...statuses)", { statuses: terminalStatuses })
      .getMany();

    // First-pass approval rate (revisionCount = 0 and approved/completed/deployed)
    const approvedStatuses = ["completed", "deployed", "review_approved"];
    const firstPassApproved = reviewedTasksData.filter(
      (t) => t.revisionCount === 0 && approvedStatuses.includes(t.status)
    ).length;
    const reviewedTerminal = reviewedTasksData.filter(
      (t) => approvedStatuses.includes(t.status) || t.status === "review_rejected"
    ).length;
    const firstPassApprovalRate = reviewedTerminal > 0
      ? Math.round((firstPassApproved / reviewedTerminal) * 100)
      : 0;

    // Revision distribution
    const revisionDistribution = {
      zero: reviewedTasksData.filter((t) => t.revisionCount === 0).length,
      one: reviewedTasksData.filter((t) => t.revisionCount === 1).length,
      two: reviewedTasksData.filter((t) => t.revisionCount === 2).length,
      threeOrMore: reviewedTasksData.filter((t) => t.revisionCount >= 3).length,
    };

    // Average revisions per task
    const totalRevisions = reviewedTasksData.reduce((sum, t) => sum + t.revisionCount, 0);
    const avgRevisionsPerTask = reviewedTasksData.length > 0
      ? Math.round((totalRevisions / reviewedTasksData.length) * 100) / 100
      : 0;

    // Decision breakdown
    const decisions = {
      approved: reviewedTasksData.filter(
        (t) => approvedStatuses.includes(t.status)
      ).length,
      revisionNeeded: reviewedTasksData.filter(
        (t) => t.status === "revision_needed" || t.revisionCount > 0
      ).length,
      rejected: reviewedTasksData.filter((t) => t.status === "review_rejected").length,
      escalated: reviewedTasksData.filter((t) => t.status === "escalated").length,
    };

    // Quality impact: compare accuracy scores for reviewed vs non-reviewed
    const qualityRaw = await taskRepo
      .createQueryBuilder("task")
      .select("task.skipManagerReview", "withReview")
      .addSelect("AVG(task.accuracyScore)", "avgAccuracy")
      .addSelect("COUNT(CASE WHEN task.reviewOutcome = 'accepted' THEN 1 END)", "accepted")
      .addSelect("COUNT(CASE WHEN task.reviewOutcome = 'rejected' THEN 1 END)", "rejected")
      .addSelect("COUNT(CASE WHEN task.reviewOutcome = 'partial' THEN 1 END)", "partial")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.accuracyScore IS NOT NULL")
      .groupBy("task.skipManagerReview")
      .getRawMany();

    // Parse quality data
    const reviewedQuality = qualityRaw.find((r) => r.withReview === false);
    const nonReviewedQuality = qualityRaw.find((r) => r.withReview === true);

    const qualityImpact = {
      reviewedAvgAccuracy: reviewedQuality ? Math.round(parseFloat(reviewedQuality.avgAccuracy) || 0) : null,
      nonReviewedAvgAccuracy: nonReviewedQuality ? Math.round(parseFloat(nonReviewedQuality.avgAccuracy) || 0) : null,
      reviewedOutcomes: {
        accepted: parseInt(reviewedQuality?.accepted) || 0,
        rejected: parseInt(reviewedQuality?.rejected) || 0,
        partial: parseInt(reviewedQuality?.partial) || 0,
      },
      nonReviewedOutcomes: {
        accepted: parseInt(nonReviewedQuality?.accepted) || 0,
        rejected: parseInt(nonReviewedQuality?.rejected) || 0,
        partial: parseInt(nonReviewedQuality?.partial) || 0,
      },
    };

    // Efficiency analysis: time and cost comparison
    const efficiencyRaw = await taskRepo
      .createQueryBuilder("task")
      .select("task.skipManagerReview", "withReview")
      .addSelect("AVG(EXTRACT(EPOCH FROM (task.completedAt - task.startedAt)) / 60)", "avgDurationMinutes")
      .addSelect("AVG(task.estimatedCostUsd)", "avgCost")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.status IN (:...statuses)", { statuses: ["completed", "deployed"] })
      .andWhere("task.startedAt IS NOT NULL")
      .andWhere("task.completedAt IS NOT NULL")
      .groupBy("task.skipManagerReview")
      .getRawMany();

    const reviewedEfficiency = efficiencyRaw.find((r) => r.withReview === false);
    const nonReviewedEfficiency = efficiencyRaw.find((r) => r.withReview === true);

    const efficiency = {
      reviewedAvgDurationMinutes: reviewedEfficiency
        ? Math.round(parseFloat(reviewedEfficiency.avgDurationMinutes) || 0)
        : null,
      nonReviewedAvgDurationMinutes: nonReviewedEfficiency
        ? Math.round(parseFloat(nonReviewedEfficiency.avgDurationMinutes) || 0)
        : null,
      reviewedAvgCost: reviewedEfficiency
        ? Math.round((parseFloat(reviewedEfficiency.avgCost) || 0) * 100) / 100
        : null,
      nonReviewedAvgCost: nonReviewedEfficiency
        ? Math.round((parseFloat(nonReviewedEfficiency.avgCost) || 0) * 100) / 100
        : null,
    };

    // Daily trend for reviewed tasks
    const trendRaw = await taskRepo
      .createQueryBuilder("task")
      .select("DATE(task.createdAt)", "date")
      .addSelect("COUNT(*)", "reviewedCount")
      .addSelect("COUNT(CASE WHEN task.revisionCount = 0 AND task.status IN (:...approvedStatuses) THEN 1 END)", "approvedFirstPass")
      .addSelect("COALESCE(SUM(task.revisionCount), 0)", "totalRevisions")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.skipManagerReview = false")
      .andWhere("task.status IN (:...statuses)", { statuses: terminalStatuses })
      .setParameter("approvedStatuses", approvedStatuses)
      .groupBy("DATE(task.createdAt)")
      .orderBy("date", "ASC")
      .getRawMany();

    const trend = trendRaw.map((row) => {
      const dateStr = row.date instanceof Date
        ? row.date.toISOString().split("T")[0]
        : String(row.date).split("T")[0];
      return {
        date: dateStr,
        reviewedCount: parseInt(row.reviewedCount) || 0,
        approvedFirstPass: parseInt(row.approvedFirstPass) || 0,
        totalRevisions: parseInt(row.totalRevisions) || 0,
      };
    });

    // Breakdown by persona
    const byPersonaRaw = await taskRepo
      .createQueryBuilder("task")
      .select("COALESCE(task.workerPersona, 'unknown')", "persona")
      .addSelect("COUNT(*)", "reviewedCount")
      .addSelect("COUNT(CASE WHEN task.revisionCount = 0 AND task.status IN (:...approvedStatuses) THEN 1 END)", "approvedFirstPass")
      .addSelect("AVG(task.revisionCount)", "avgRevisions")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.skipManagerReview = false")
      .andWhere("task.status IN (:...statuses)", { statuses: terminalStatuses })
      .setParameter("approvedStatuses", approvedStatuses)
      .groupBy("task.workerPersona")
      .orderBy("COUNT(*)", "DESC")
      .getRawMany();

    const byPersona = byPersonaRaw.map((row) => {
      const reviewedCount = parseInt(row.reviewedCount) || 0;
      const approvedFirstPass = parseInt(row.approvedFirstPass) || 0;
      return {
        persona: row.persona || "unknown",
        reviewedCount,
        approvalRate: reviewedCount > 0 ? Math.round((approvedFirstPass / reviewedCount) * 100) : 0,
        avgRevisions: Math.round((parseFloat(row.avgRevisions) || 0) * 100) / 100,
      };
    });

    // Breakdown by model
    const byModelRaw = await taskRepo
      .createQueryBuilder("task")
      .select("COALESCE(task.workerModel, 'unknown')", "model")
      .addSelect("COUNT(*)", "reviewedCount")
      .addSelect("COUNT(CASE WHEN task.revisionCount = 0 AND task.status IN (:...approvedStatuses) THEN 1 END)", "approvedFirstPass")
      .addSelect("AVG(task.revisionCount)", "avgRevisions")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.skipManagerReview = false")
      .andWhere("task.status IN (:...statuses)", { statuses: terminalStatuses })
      .setParameter("approvedStatuses", approvedStatuses)
      .groupBy("task.workerModel")
      .orderBy("COUNT(*)", "DESC")
      .getRawMany();

    const byModel = byModelRaw.map((row) => {
      const reviewedCount = parseInt(row.reviewedCount) || 0;
      const approvedFirstPass = parseInt(row.approvedFirstPass) || 0;
      return {
        model: row.model || "unknown",
        reviewedCount,
        approvalRate: reviewedCount > 0 ? Math.round((approvedFirstPass / reviewedCount) * 100) : 0,
        avgRevisions: Math.round((parseFloat(row.avgRevisions) || 0) * 100) / 100,
      };
    });

    res.json({
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      summary: {
        totalTasks,
        reviewedTasks,
        adoptionRate,
        firstPassApprovalRate,
        avgRevisionsPerTask,
      },
      revisionDistribution,
      decisions,
      qualityImpact,
      efficiency,
      trend,
      byPersona,
      byModel,
    });
  } catch (error) {
    logger.error("Error fetching review metrics", { error });
    res.status(500).json({ error: "Failed to fetch review metrics" });
  }
});

/**
 * GET /api/analytics/code-quality
 * Get code quality metrics across completed tasks
 *
 * Provides:
 * - Average quality scores (composite, lint, typecheck, tests, coverage, security)
 * - Score distribution (excellent, good, fair, poor)
 * - Quality trends over time
 * - Quality breakdown by persona and model
 * - Recent low-quality tasks for investigation
 */
router.get("/code-quality", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";

    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Get aggregate quality metrics
    const aggregateRaw = await taskRepo
      .createQueryBuilder("task")
      .select("COUNT(*)", "total")
      .addSelect("COUNT(CASE WHEN task.qualityScore IS NOT NULL THEN 1 END)", "tasksWithMetrics")
      .addSelect("AVG(task.qualityScore)", "avgQualityScore")
      .addSelect("AVG(task.lintScore)", "avgLintScore")
      .addSelect("AVG(task.typecheckScore)", "avgTypecheckScore")
      .addSelect("AVG(task.testScore)", "avgTestScore")
      .addSelect("AVG(task.coverageScore)", "avgCoverageScore")
      .addSelect("AVG(task.securityScore)", "avgSecurityScore")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.status IN (:...statuses)", { statuses: ["completed", "deployed"] })
      .getRawOne();

    // Get score distribution (excellent: 90-100, good: 70-89, fair: 50-69, poor: <50)
    const distributionRaw = await taskRepo
      .createQueryBuilder("task")
      .select("COUNT(CASE WHEN task.qualityScore >= 90 THEN 1 END)", "excellent")
      .addSelect("COUNT(CASE WHEN task.qualityScore >= 70 AND task.qualityScore < 90 THEN 1 END)", "good")
      .addSelect("COUNT(CASE WHEN task.qualityScore >= 50 AND task.qualityScore < 70 THEN 1 END)", "fair")
      .addSelect("COUNT(CASE WHEN task.qualityScore < 50 THEN 1 END)", "poor")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.qualityScore IS NOT NULL")
      .getRawOne();

    // Get quality by persona
    const byPersonaRaw = await taskRepo
      .createQueryBuilder("task")
      .select("COALESCE(task.workerPersona, 'unknown')", "persona")
      .addSelect("COUNT(*)", "taskCount")
      .addSelect("AVG(task.qualityScore)", "avgScore")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.qualityScore IS NOT NULL")
      .groupBy("task.workerPersona")
      .orderBy("AVG(task.qualityScore)", "DESC")
      .getRawMany();

    // Get quality by model
    const byModelRaw = await taskRepo
      .createQueryBuilder("task")
      .select("COALESCE(task.workerModel, 'unknown')", "model")
      .addSelect("COUNT(*)", "taskCount")
      .addSelect("AVG(task.qualityScore)", "avgScore")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.qualityScore IS NOT NULL")
      .groupBy("task.workerModel")
      .orderBy("AVG(task.qualityScore)", "DESC")
      .getRawMany();

    // Get daily trend
    const trendRaw = await taskRepo
      .createQueryBuilder("task")
      .select("DATE(task.completedAt)", "date")
      .addSelect("COUNT(*)", "taskCount")
      .addSelect("AVG(task.qualityScore)", "avgScore")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.completedAt >= :startDate", { startDate })
      .andWhere("task.qualityScore IS NOT NULL")
      .groupBy("DATE(task.completedAt)")
      .orderBy("date", "ASC")
      .getRawMany();

    // Get recent low-quality tasks for investigation (score < 70)
    const lowQualityTasks = await taskRepo
      .createQueryBuilder("task")
      .select([
        "task.id",
        "task.jiraIssueKey",
        "task.summary",
        "task.qualityScore",
        "task.lintScore",
        "task.typecheckScore",
        "task.testScore",
        "task.coverageScore",
        "task.securityScore",
        "task.workerPersona",
        "task.workerModel",
        "task.completedAt",
      ])
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.qualityScore IS NOT NULL")
      .andWhere("task.qualityScore < 70")
      .orderBy("task.qualityScore", "ASC")
      .limit(10)
      .getMany();

    // Format response
    const totalTasks = parseInt(aggregateRaw.total) || 0;
    const tasksWithMetrics = parseInt(aggregateRaw.tasksWithMetrics) || 0;

    res.json({
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      summary: {
        totalTasks,
        tasksWithMetrics,
        metricsRate: totalTasks > 0 ? Math.round((tasksWithMetrics / totalTasks) * 100) : 0,
        averageQualityScore: Math.round(parseFloat(aggregateRaw.avgQualityScore) || 0),
        averageLintScore: Math.round(parseFloat(aggregateRaw.avgLintScore) || 0),
        averageTypecheckScore: Math.round(parseFloat(aggregateRaw.avgTypecheckScore) || 0),
        averageTestScore: Math.round(parseFloat(aggregateRaw.avgTestScore) || 0),
        averageCoverageScore: Math.round(parseFloat(aggregateRaw.avgCoverageScore) || 0),
        averageSecurityScore: Math.round(parseFloat(aggregateRaw.avgSecurityScore) || 0),
      },
      scoreDistribution: {
        excellent: parseInt(distributionRaw?.excellent) || 0,
        good: parseInt(distributionRaw?.good) || 0,
        fair: parseInt(distributionRaw?.fair) || 0,
        poor: parseInt(distributionRaw?.poor) || 0,
      },
      byPersona: byPersonaRaw.map((row) => ({
        persona: row.persona || "unknown",
        taskCount: parseInt(row.taskCount) || 0,
        avgScore: Math.round(parseFloat(row.avgScore) || 0),
      })),
      byModel: byModelRaw.map((row) => ({
        model: row.model || "unknown",
        taskCount: parseInt(row.taskCount) || 0,
        avgScore: Math.round(parseFloat(row.avgScore) || 0),
      })),
      trend: trendRaw.map((row) => {
        const dateStr = row.date instanceof Date
          ? row.date.toISOString().split("T")[0]
          : String(row.date).split("T")[0];
        return {
          date: dateStr,
          taskCount: parseInt(row.taskCount) || 0,
          avgScore: Math.round(parseFloat(row.avgScore) || 0),
        };
      }),
      lowQualityTasks: lowQualityTasks.map((task) => ({
        id: task.id,
        jiraKey: task.jiraIssueKey,
        summary: task.summary?.substring(0, 100),
        qualityScore: task.qualityScore,
        lintScore: task.lintScore,
        typecheckScore: task.typecheckScore,
        testScore: task.testScore,
        coverageScore: task.coverageScore,
        securityScore: task.securityScore,
        persona: task.workerPersona,
        model: task.workerModel,
        completedAt: task.completedAt,
      })),
    });
  } catch (error) {
    logger.error("Error fetching code quality analytics", { error });
    res.status(500).json({ error: "Failed to fetch code quality analytics" });
  }
});

/**
 * GET /api/analytics/support-agent
 * Get AI support agent performance metrics
 *
 * Provides:
 * - Total tickets processed by AI
 * - Auto-response rate (vs escalation)
 * - Average confidence score
 * - Response time metrics
 * - Category breakdown
 */
router.get("/support-agent", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";

    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get support agent stats from support_tickets table
    const result = await AppDataSource.query(`
      SELECT
        COUNT(*) FILTER (WHERE auto_response_attempted = true) as total_attempted,
        COUNT(*) FILTER (WHERE ai_responded_at IS NOT NULL AND ai_escalation_reason IS NULL) as auto_responded,
        COUNT(*) FILTER (WHERE ai_escalation_reason IS NOT NULL) as escalated,
        AVG(ai_confidence_score) FILTER (WHERE ai_confidence_score IS NOT NULL) as avg_confidence,
        AVG(EXTRACT(EPOCH FROM (ai_responded_at - created_at))) FILTER (WHERE ai_responded_at IS NOT NULL) as avg_response_time_seconds
      FROM support_tickets
      WHERE org_id = $1
        AND created_at >= $2
    `, [org.id, startDate]);

    const stats = result[0] || {};

    // Get category breakdown
    const categoryBreakdown = await AppDataSource.query(`
      SELECT
        category,
        COUNT(*) FILTER (WHERE auto_response_attempted = true) as total,
        COUNT(*) FILTER (WHERE ai_responded_at IS NOT NULL AND ai_escalation_reason IS NULL) as auto_responded,
        COUNT(*) FILTER (WHERE ai_escalation_reason IS NOT NULL) as escalated
      FROM support_tickets
      WHERE org_id = $1
        AND created_at >= $2
        AND auto_response_attempted = true
      GROUP BY category
      ORDER BY total DESC
    `, [org.id, startDate]);

    // Get daily trend
    const dailyTrend = await AppDataSource.query(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) FILTER (WHERE auto_response_attempted = true) as total,
        COUNT(*) FILTER (WHERE ai_responded_at IS NOT NULL AND ai_escalation_reason IS NULL) as auto_responded,
        COUNT(*) FILTER (WHERE ai_escalation_reason IS NOT NULL) as escalated
      FROM support_tickets
      WHERE org_id = $1
        AND created_at >= $2
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [org.id, startDate]);

    // Calculate rates
    const totalAttempted = parseInt(stats.total_attempted) || 0;
    const autoResponded = parseInt(stats.auto_responded) || 0;
    const escalated = parseInt(stats.escalated) || 0;
    const avgConfidence = parseFloat(stats.avg_confidence) || 0;
    const avgResponseTimeSeconds = parseFloat(stats.avg_response_time_seconds) || 0;

    const autoResponseRate = totalAttempted > 0
      ? Math.round((autoResponded / totalAttempted) * 100)
      : 0;

    const escalationRate = totalAttempted > 0
      ? Math.round((escalated / totalAttempted) * 100)
      : 0;

    res.json({
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      summary: {
        totalAttempted,
        autoResponded,
        escalated,
        autoResponseRate,
        escalationRate,
        avgConfidenceScore: Math.round(avgConfidence * 10) / 10,
      },
      responseTime: {
        avgSeconds: Math.round(avgResponseTimeSeconds),
        avgFormatted: formatDuration(avgResponseTimeSeconds),
      },
      byCategory: categoryBreakdown.map((row: Record<string, unknown>) => ({
        category: row.category,
        total: parseInt(row.total as string) || 0,
        autoResponded: parseInt(row.auto_responded as string) || 0,
        escalated: parseInt(row.escalated as string) || 0,
        autoResponseRate: parseInt(row.total as string) > 0
          ? Math.round((parseInt(row.auto_responded as string) / parseInt(row.total as string)) * 100)
          : 0,
      })),
      trend: dailyTrend.map((row: Record<string, unknown>) => {
        const dateStr = row.date instanceof Date
          ? row.date.toISOString().split("T")[0]
          : String(row.date).split("T")[0];
        return {
          date: dateStr,
          total: parseInt(row.total as string) || 0,
          autoResponded: parseInt(row.auto_responded as string) || 0,
          escalated: parseInt(row.escalated as string) || 0,
        };
      }),
    });
  } catch (error) {
    logger.error("Error fetching support agent analytics", { error });
    res.status(500).json({ error: "Failed to fetch support agent analytics" });
  }
});

/**
 * POST /api/analytics/classify-complexity
 * Classify the complexity of a task based on its description
 *
 * Request body:
 * - summary: string (required) - Task summary/title
 * - description: string (optional) - Full task description
 *
 * Returns:
 * - tier: simple | medium | complex | expert
 * - score: 0-100
 * - confidence: low | medium | high
 * - factors: string[] - factors that contributed to the classification
 * - estimatedCostRange: { min, max } in USD
 * - estimatedTokenRange: { min, max }
 * - tierDescription: human-readable description
 */
router.post("/classify-complexity", async (req: Request, res: Response) => {
  try {
    const { summary, description } = req.body;

    if (!summary || typeof summary !== "string") {
      return res.status(400).json({ error: "summary is required" });
    }

    const assessment = classifyComplexity(summary, description);

    res.json({
      ...assessment,
      tierDescription: getTierDescription(assessment.tier),
    });
  } catch (error) {
    logger.error("Error classifying task complexity", { error });
    res.status(500).json({ error: "Failed to classify task complexity" });
  }
});

/**
 * GET /api/analytics/complexity-tiers
 * Get all complexity tier definitions and their characteristics
 */
router.get("/complexity-tiers", async (_req: Request, res: Response) => {
  const tiers: ComplexityTier[] = ["simple", "medium", "complex", "expert"];

  res.json({
    tiers: tiers.map((tier) => ({
      tier,
      description: getTierDescription(tier),
      estimatedCostRange: {
        simple: { min: 0.05, max: 0.50 },
        medium: { min: 0.30, max: 2.00 },
        complex: { min: 1.50, max: 8.00 },
        expert: { min: 5.00, max: 25.00 },
      }[tier],
      estimatedTokenRange: {
        simple: { min: 5000, max: 50000 },
        medium: { min: 30000, max: 150000 },
        complex: { min: 100000, max: 500000 },
        expert: { min: 300000, max: 1500000 },
      }[tier],
    })),
  });
});

/**
 * GET /api/analytics/estimate-cost/:jiraKey
 * Fetch a Jira issue and estimate its cost before execution
 *
 * Uses actual historical task data to provide calibrated estimates:
 * - Queries completed tasks from this org
 * - Uses p25/p75 percentiles of actual costs for the range
 * - Falls back to conservative defaults if no historical data
 *
 * Returns:
 * - issue: { summary, description }
 * - assessment: complexity assessment with tier, score, cost/token ranges
 * - historicalBasis: how many historical tasks were used for calibration
 */
router.get("/estimate-cost/:jiraKey", async (req: Request, res: Response) => {
  try {
    const jiraKey = req.params.jiraKey as string;

    if (!jiraKey) {
      return res.status(400).json({ error: "jiraKey is required" });
    }

    // Fetch the Jira issue
    const org = req.organization!;
    const issue = await fetchJiraIssue(org.id, jiraKey);
    if (!issue) {
      return res.status(404).json({ error: "Failed to fetch Jira issue" });
    }

    // Classify the complexity (for tier and factors)
    const assessment = classifyComplexity(issue.summary, issue.description);

    // Fetch historical task costs for this org to calibrate estimates
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const historicalTasks = await taskRepo
      .createQueryBuilder("task")
      .select(["task.estimatedCostUsd"])
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.status = :status", { status: "completed" })
      .andWhere("task.estimatedCostUsd IS NOT NULL")
      .andWhere("task.estimatedCostUsd > 0")
      .orderBy("task.completedAt", "DESC")
      .limit(50) // Use last 50 completed tasks
      .getMany();

    // Extract costs and calculate percentiles
    const costs = historicalTasks
      .map(t => Number(t.estimatedCostUsd))
      .filter((c): c is number => !isNaN(c) && c > 0)
      .sort((a, b) => a - b);

    let calibratedCostRange: { min: number; max: number };
    let calibratedTokenRange: { min: number; max: number };
    const historicalBasis = costs.length;
    let confidence = assessment.confidence;

    if (costs.length >= 5) {
      // Use actual historical data - p25 to p75 range
      const p25Index = Math.floor(costs.length * 0.25);
      const p75Index = Math.floor(costs.length * 0.75);
      const median = costs[Math.floor(costs.length * 0.5)];

      // Calculate range based on complexity tier adjustment
      // Simple tasks: use lower percentiles, Expert: use higher
      const tierMultiplier = {
        simple: 0.5,
        medium: 0.8,
        complex: 1.2,
        expert: 1.5,
      }[assessment.tier];

      const baseMin = costs[p25Index] * tierMultiplier;
      const baseMax = costs[p75Index] * tierMultiplier;

      calibratedCostRange = {
        min: Math.max(0.10, parseFloat((baseMin * 0.8).toFixed(2))),
        max: parseFloat((baseMax * 1.2).toFixed(2)),
      };

      // Estimate tokens from cost (rough: $0.01 per 1K tokens average)
      calibratedTokenRange = {
        min: Math.round(calibratedCostRange.min * 100000),
        max: Math.round(calibratedCostRange.max * 100000),
      };

      // Higher confidence with more historical data
      confidence = costs.length >= 20 ? "high" : "medium";
    } else {
      // Fallback to conservative defaults (lower than before)
      const fallbackCostRanges: Record<string, { min: number; max: number }> = {
        simple: { min: 0.10, max: 1.00 },
        medium: { min: 0.50, max: 3.00 },
        complex: { min: 1.00, max: 5.00 },
        expert: { min: 2.00, max: 8.00 },
      };
      const fallbackTokenRanges: Record<string, { min: number; max: number }> = {
        simple: { min: 10000, max: 100000 },
        medium: { min: 50000, max: 300000 },
        complex: { min: 100000, max: 500000 },
        expert: { min: 200000, max: 800000 },
      };
      calibratedCostRange = fallbackCostRanges[assessment.tier];
      calibratedTokenRange = fallbackTokenRanges[assessment.tier];
      confidence = "low";
    }

    res.json({
      issue: {
        key: jiraKey,
        summary: issue.summary,
        descriptionPreview: issue.description.substring(0, 200) + (issue.description.length > 200 ? "..." : ""),
        labels: issue.labels,
      },
      assessment: {
        tier: assessment.tier,
        score: assessment.score,
        confidence,
        factors: assessment.factors,
        estimatedCostRange: calibratedCostRange,
        estimatedTokenRange: calibratedTokenRange,
        tierDescription: getTierDescription(assessment.tier),
      },
      historicalBasis,
    });
  } catch (error) {
    logger.error("Error estimating task cost", { error });
    res.status(500).json({ error: "Failed to estimate task cost" });
  }
});

/**
 * GET /api/analytics/budget-status
 * Get current budget status including spending vs limits
 */
router.get("/budget-status", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;

    // Import budget enforcement service
    const { getBudgetStatusWithProjections, isBudgetOverrideActive } = await import("../services/budget-enforcement.js");

    const { status, projections } = await getBudgetStatusWithProjections(org);
    const overrideActive = isBudgetOverrideActive(org);

    res.json({
      withinBudget: status.withinBudget || overrideActive,
      violations: status.violations,
      spending: {
        daily: parseFloat(status.spending.daily.toFixed(4)),
        weekly: parseFloat(status.spending.weekly.toFixed(4)),
        monthly: parseFloat(status.spending.monthly.toFixed(4)),
      },
      limits: status.limits,
      projections: {
        dailyRemaining: projections.dailyRemaining !== null ? parseFloat(projections.dailyRemaining.toFixed(4)) : null,
        weeklyRemaining: projections.weeklyRemaining !== null ? parseFloat(projections.weeklyRemaining.toFixed(4)) : null,
        monthlyRemaining: projections.monthlyRemaining !== null ? parseFloat(projections.monthlyRemaining.toFixed(4)) : null,
        dailyPctUsed: projections.dailyPctUsed !== null ? parseFloat(projections.dailyPctUsed.toFixed(1)) : null,
        weeklyPctUsed: projections.weeklyPctUsed !== null ? parseFloat(projections.weeklyPctUsed.toFixed(1)) : null,
        monthlyPctUsed: projections.monthlyPctUsed !== null ? parseFloat(projections.monthlyPctUsed.toFixed(1)) : null,
      },
      override: {
        isActive: overrideActive,
        budgetOverrideUntil: org.budgetOverrideUntil,
        budgetOverrideReason: org.budgetOverrideReason,
        remainingMinutes: overrideActive && org.budgetOverrideUntil
          ? Math.max(0, Math.ceil((new Date(org.budgetOverrideUntil).getTime() - Date.now()) / 60000))
          : 0,
      },
    });
  } catch (error) {
    logger.error("Error getting budget status", { error });
    res.status(500).json({ error: "Failed to get budget status" });
  }
});

/**
 * GET /api/analytics/roi
 * Calculate ROI metrics for AI worker tasks
 *
 * Phase 5 Roadmap: ROI Calculator
 * - Configurable developer hourly rate via query parameter
 * - Compares AI worker costs against estimated developer time saved
 * - Returns personalized ROI based on organization's labor costs
 *
 * Query Parameters:
 * - range: Time range ("7d", "30d", "90d") - default "30d"
 * - hourlyRate: Developer hourly rate in USD (10-500) - default 75
 */
router.get("/roi", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";

    // Parse and validate configurable hourly rate
    const hourlyRateParam = req.query.hourlyRate as string | undefined;
    let developerHourlyRate = 75; // USD default
    if (hourlyRateParam) {
      const parsed = parseFloat(hourlyRateParam);
      if (!isNaN(parsed) && parsed >= 10 && parsed <= 500) {
        developerHourlyRate = parsed;
      }
    }

    // Calculate date range
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Get task statistics
    const stats = await taskRepo
      .createQueryBuilder("task")
      .select("COUNT(*)", "totalTasks")
      .addSelect("COUNT(CASE WHEN task.status IN ('completed', 'deployed') THEN 1 END)", "successfulTasks")
      .addSelect("COUNT(CASE WHEN task.status = 'failed' THEN 1 END)", "failedTasks")
      .addSelect("COUNT(CASE WHEN task.githubPrUrl IS NOT NULL THEN 1 END)", "prsCreated")
      .addSelect("COALESCE(SUM(task.estimatedCostUsd), 0)", "totalCost")
      .addSelect("COALESCE(AVG(task.estimatedCostUsd), 0)", "avgCostPerTask")
      .addSelect("COALESCE(SUM(task.inputTokens), 0)", "totalInputTokens")
      .addSelect("COALESCE(SUM(task.outputTokens), 0)", "totalOutputTokens")
      .addSelect("COALESCE(AVG(task.ecsTaskSeconds), 0)", "avgExecutionSeconds")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .getRawOne();

    const totalTasks = parseInt(stats.totalTasks) || 0;
    const successfulTasks = parseInt(stats.successfulTasks) || 0;
    const failedTasks = parseInt(stats.failedTasks) || 0;
    const prsCreated = parseInt(stats.prsCreated) || 0;
    const totalCost = parseFloat(stats.totalCost) || 0;
    const avgCostPerTask = parseFloat(stats.avgCostPerTask) || 0;
    const avgExecutionSeconds = parseFloat(stats.avgExecutionSeconds) || 0;

    // Calculate success rate
    const successRate = totalTasks > 0 ? (successfulTasks / totalTasks) * 100 : 0;

    // Calculate cost per PR
    const costPerPr = prsCreated > 0 ? totalCost / prsCreated : 0;

    // Estimate developer hours saved
    // Assumption: Average task takes 2-4 hours for a developer, use 3 hours as baseline
    const estimatedHoursPerTask = 3;
    const estimatedDevHoursSaved = successfulTasks * estimatedHoursPerTask;
    const estimatedDevCostSaved = estimatedDevHoursSaved * developerHourlyRate;

    // Calculate ROI: (Value Gained - Cost) / Cost * 100
    const roi = totalCost > 0 ? ((estimatedDevCostSaved - totalCost) / totalCost) * 100 : 0;

    // Calculate net savings (positive = money saved, negative = money lost)
    const netSavings = estimatedDevCostSaved - totalCost;

    // Calculate break-even rate (hourly rate needed to break even)
    const breakEvenRate = estimatedDevHoursSaved > 0 ? totalCost / estimatedDevHoursSaved : 0;

    // Calculate cost efficiency (cost per successful task)
    const costPerSuccess = successfulTasks > 0 ? totalCost / successfulTasks : 0;

    // Calculate execution efficiency (average minutes per task)
    const avgExecutionMinutes = avgExecutionSeconds / 60;

    // Calculate cost per developer hour equivalent
    const costPerDevHourEquivalent = estimatedDevHoursSaved > 0 ? totalCost / estimatedDevHoursSaved : 0;

    res.json({
      range,
      startDate,
      metrics: {
        // Task metrics
        totalTasks,
        successfulTasks,
        failedTasks,
        prsCreated,
        successRate: parseFloat(successRate.toFixed(1)),

        // Cost metrics
        totalCost: parseFloat(totalCost.toFixed(2)),
        avgCostPerTask: parseFloat(avgCostPerTask.toFixed(4)),
        costPerPr: parseFloat(costPerPr.toFixed(4)),
        costPerSuccess: parseFloat(costPerSuccess.toFixed(4)),

        // Efficiency metrics
        avgExecutionMinutes: parseFloat(avgExecutionMinutes.toFixed(1)),

        // ROI estimates (personalized based on hourly rate)
        estimatedDevHoursSaved: parseFloat(estimatedDevHoursSaved.toFixed(1)),
        estimatedDevCostSaved: parseFloat(estimatedDevCostSaved.toFixed(2)),
        roi: parseFloat(roi.toFixed(1)),
        netSavings: parseFloat(netSavings.toFixed(2)),
        breakEvenRate: parseFloat(breakEvenRate.toFixed(2)),
        costPerDevHourEquivalent: parseFloat(costPerDevHourEquivalent.toFixed(2)),

        // ROI interpretation
        roiPositive: roi > 0,
        roiCategory: roi > 200 ? "excellent" : roi > 100 ? "good" : roi > 0 ? "positive" : "negative",

        // Assumptions used (includes user-provided rate)
        assumptions: {
          developerHourlyRate,
          estimatedHoursPerTask,
          isCustomRate: hourlyRateParam !== undefined,
        },
      },
    });
  } catch (error) {
    logger.error("Error calculating ROI metrics", { error });
    res.status(500).json({ error: "Failed to calculate ROI metrics" });
  }
});

/**
 * GET /api/analytics/efficiency-scores
 * Calculate cost efficiency score for each task (0-100 scale)
 * Factors: cost vs average, success rate, PR creation, execution time
 */
router.get("/efficiency-scores", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    // Calculate date range
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const { WorkerTask } = await import("../models/WorkerTask.js");
    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Get completed/deployed tasks for scoring
    const tasks = await taskRepo.find({
      where: {
        orgId: org.id,
        status: In(["completed", "deployed", "failed"]),
      },
      order: { createdAt: "DESC" },
      take: 200, // Get more for averaging
    });

    if (tasks.length === 0) {
      res.json({
        success: true,
        data: {
          tasks: [],
          summary: {
            avgScore: 0,
            excellent: 0,
            good: 0,
            average: 0,
            belowAverage: 0,
            poor: 0,
          },
        },
      });
      return;
    }

    // Calculate average cost and execution time for baseline
    const successfulTasks = tasks.filter((t) => t.status === "completed" || t.status === "deployed");
    const avgCost =
      successfulTasks.length > 0
        ? successfulTasks.reduce((sum, t) => sum + (t.estimatedCostUsd || 0), 0) / successfulTasks.length
        : 0;
    const avgDuration =
      successfulTasks.length > 0
        ? successfulTasks
            .filter((t) => t.completedAt && t.startedAt)
            .reduce((sum, t) => {
              const start = new Date(t.startedAt!).getTime();
              const end = new Date(t.completedAt!).getTime();
              return sum + (end - start);
            }, 0) /
          successfulTasks.filter((t) => t.completedAt && t.startedAt).length
        : 0;

    // Score each task
    const scoredTasks = tasks.slice(0, limit).map((task) => {
      let score = 50; // Base score

      // Cost efficiency (±30 points)
      if (task.estimatedCostUsd && avgCost > 0) {
        const costRatio = task.estimatedCostUsd / avgCost;
        if (costRatio <= 0.5) score += 30; // Much cheaper than average
        else if (costRatio <= 0.75) score += 20;
        else if (costRatio <= 1.0) score += 10;
        else if (costRatio <= 1.25) score -= 5;
        else if (costRatio <= 1.5) score -= 15;
        else score -= 30; // Much more expensive
      }

      // Success/failure (±20 points)
      if (task.status === "completed" || task.status === "deployed") {
        score += 20;
      } else if (task.status === "failed") {
        score -= 20;
      }

      // PR created (+10 points)
      if (task.githubPrUrl) {
        score += 10;
      }

      // Execution time efficiency (±5 points)
      if (task.completedAt && task.startedAt && avgDuration > 0) {
        const start = new Date(task.startedAt).getTime();
        const end = new Date(task.completedAt).getTime();
        const duration = end - start;
        const timeRatio = duration / avgDuration;
        if (timeRatio <= 0.5) score += 5;
        else if (timeRatio > 2.0) score -= 5;
      }

      // Clamp score to 0-100
      score = Math.max(0, Math.min(100, score));

      // Determine rating
      let rating: string;
      if (score >= 85) rating = "excellent";
      else if (score >= 70) rating = "good";
      else if (score >= 50) rating = "average";
      else if (score >= 30) rating = "below_average";
      else rating = "poor";

      return {
        taskId: task.id,
        jiraKey: task.jiraIssueKey,
        status: task.status,
        estimatedCostUsd: task.estimatedCostUsd ? parseFloat(task.estimatedCostUsd.toFixed(4)) : null,
        costVsAvg: avgCost > 0 && task.estimatedCostUsd ? parseFloat((task.estimatedCostUsd / avgCost).toFixed(2)) : null,
        hasPr: !!task.githubPrUrl,
        efficiencyScore: score,
        rating,
        createdAt: task.createdAt,
      };
    });

    // Calculate summary stats
    const excellent = scoredTasks.filter((t) => t.rating === "excellent").length;
    const good = scoredTasks.filter((t) => t.rating === "good").length;
    const average = scoredTasks.filter((t) => t.rating === "average").length;
    const belowAverage = scoredTasks.filter((t) => t.rating === "below_average").length;
    const poor = scoredTasks.filter((t) => t.rating === "poor").length;
    const avgScore =
      scoredTasks.length > 0
        ? scoredTasks.reduce((sum, t) => sum + t.efficiencyScore, 0) / scoredTasks.length
        : 0;

    res.json({
      success: true,
      data: {
        tasks: scoredTasks,
        summary: {
          avgScore: parseFloat(avgScore.toFixed(1)),
          excellent,
          good,
          average,
          belowAverage,
          poor,
          avgCostBaseline: parseFloat(avgCost.toFixed(4)),
          avgDurationMinutes: avgDuration > 0 ? parseFloat((avgDuration / 1000 / 60).toFixed(1)) : null,
        },
      },
    });
  } catch (error) {
    logger.error("Error calculating efficiency scores", { error });
    res.status(500).json({ error: "Failed to calculate efficiency scores" });
  }
});

/**
 * GET /api/analytics/wasteful-patterns
 * Identify wasteful cost patterns and inefficiencies
 */
router.get("/wasteful-patterns", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";

    // Calculate date range
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const { WorkerTask } = await import("../models/WorkerTask.js");
    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Get all tasks in the time range
    const tasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .getMany();

    if (tasks.length === 0) {
      res.json({
        success: true,
        data: {
          patterns: [],
          summary: { totalWaste: 0, patternCount: 0 },
        },
      });
      return;
    }

    const patterns: Array<{
      type: string;
      severity: "high" | "medium" | "low";
      description: string;
      estimatedWaste: number;
      affectedTasks: number;
      examples: Array<{ taskId: string; jiraKey: string | null; cost: number }>;
      recommendation: string;
    }> = [];

    // Pattern 1: Repeated failures on same Jira ticket
    const jiraGroups = new Map<string, typeof tasks>();
    for (const task of tasks) {
      if (task.jiraIssueKey) {
        if (!jiraGroups.has(task.jiraIssueKey)) {
          jiraGroups.set(task.jiraIssueKey, []);
        }
        jiraGroups.get(task.jiraIssueKey)!.push(task);
      }
    }

    for (const [jiraKey, taskGroup] of jiraGroups) {
      const failedTasks = taskGroup.filter((t) => t.status === "failed");
      if (failedTasks.length >= 2) {
        const wastedCost = failedTasks.reduce((sum, t) => sum + (t.estimatedCostUsd || 0), 0);
        patterns.push({
          type: "repeated_failures",
          severity: failedTasks.length >= 3 ? "high" : "medium",
          description: `${jiraKey} has ${failedTasks.length} failed attempts`,
          estimatedWaste: wastedCost,
          affectedTasks: failedTasks.length,
          examples: failedTasks.slice(0, 3).map((t) => ({
            taskId: t.id,
            jiraKey: t.jiraIssueKey,
            cost: t.estimatedCostUsd || 0,
          })),
          recommendation: "Review ticket requirements for clarity or break into smaller tasks",
        });
      }
    }

    // Pattern 2: Tasks with high retry counts
    const highRetryTasks = tasks.filter((t) => (t.retryCount || 0) >= 2);
    if (highRetryTasks.length > 0) {
      const wastedCost = highRetryTasks.reduce(
        (sum, t) => sum + (t.estimatedCostUsd || 0) * (t.retryCount || 0) * 0.3, // Estimate 30% waste per retry
        0
      );
      patterns.push({
        type: "high_retry_count",
        severity: highRetryTasks.some((t) => (t.retryCount || 0) >= 3) ? "high" : "medium",
        description: `${highRetryTasks.length} tasks required multiple retries`,
        estimatedWaste: wastedCost,
        affectedTasks: highRetryTasks.length,
        examples: highRetryTasks.slice(0, 3).map((t) => ({
          taskId: t.id,
          jiraKey: t.jiraIssueKey,
          cost: t.estimatedCostUsd || 0,
        })),
        recommendation: "Investigate common failure causes; consider improving worker directives",
      });
    }

    // Pattern 3: Tasks that cost significantly more than average
    const successfulTasks = tasks.filter((t) => t.status === "completed" || t.status === "deployed");
    const avgCost =
      successfulTasks.length > 0
        ? successfulTasks.reduce((sum, t) => sum + (t.estimatedCostUsd || 0), 0) / successfulTasks.length
        : 0;

    const expensiveTasks = tasks.filter(
      (t) => t.estimatedCostUsd && avgCost > 0 && t.estimatedCostUsd > avgCost * 2
    );
    if (expensiveTasks.length > 0) {
      const excessCost = expensiveTasks.reduce(
        (sum, t) => sum + ((t.estimatedCostUsd || 0) - avgCost),
        0
      );
      patterns.push({
        type: "cost_outliers",
        severity: expensiveTasks.some((t) => t.estimatedCostUsd! > avgCost * 3) ? "high" : "medium",
        description: `${expensiveTasks.length} tasks cost 2x+ the average ($${avgCost.toFixed(2)})`,
        estimatedWaste: excessCost,
        affectedTasks: expensiveTasks.length,
        examples: expensiveTasks
          .sort((a, b) => (b.estimatedCostUsd || 0) - (a.estimatedCostUsd || 0))
          .slice(0, 3)
          .map((t) => ({
            taskId: t.id,
            jiraKey: t.jiraIssueKey,
            cost: t.estimatedCostUsd || 0,
          })),
        recommendation: "Review these tasks for complexity; consider per-task cost ceiling",
      });
    }

    // Pattern 4: Failed tasks with no PR (complete waste)
    const failedNoPr = tasks.filter((t) => t.status === "failed" && !t.githubPrUrl);
    if (failedNoPr.length > 0) {
      const wastedCost = failedNoPr.reduce((sum, t) => sum + (t.estimatedCostUsd || 0), 0);
      patterns.push({
        type: "failed_no_output",
        severity: wastedCost > 1.0 ? "high" : failedNoPr.length >= 3 ? "medium" : "low",
        description: `${failedNoPr.length} tasks failed without producing a PR`,
        estimatedWaste: wastedCost,
        affectedTasks: failedNoPr.length,
        examples: failedNoPr.slice(0, 3).map((t) => ({
          taskId: t.id,
          jiraKey: t.jiraIssueKey,
          cost: t.estimatedCostUsd || 0,
        })),
        recommendation: "Review error logs; ensure tickets have clear requirements",
      });
    }

    // Pattern 5: Long-running tasks (potential stalls)
    const longRunningTasks = tasks.filter((t) => {
      if (!t.startedAt || !t.completedAt) return false;
      const duration = new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime();
      return duration > 60 * 60 * 1000; // Over 1 hour
    });
    if (longRunningTasks.length > 0) {
      const potentialWaste = longRunningTasks.reduce(
        (sum, t) => sum + (t.estimatedCostUsd || 0) * 0.2, // Estimate 20% inefficiency
        0
      );
      patterns.push({
        type: "long_running",
        severity: longRunningTasks.some((t) => {
          const duration =
            new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime();
          return duration > 2 * 60 * 60 * 1000;
        })
          ? "medium"
          : "low",
        description: `${longRunningTasks.length} tasks ran for over 1 hour`,
        estimatedWaste: potentialWaste,
        affectedTasks: longRunningTasks.length,
        examples: longRunningTasks.slice(0, 3).map((t) => ({
          taskId: t.id,
          jiraKey: t.jiraIssueKey,
          cost: t.estimatedCostUsd || 0,
        })),
        recommendation: "Consider breaking into smaller tasks or setting execution time limits",
      });
    }

    // Sort patterns by estimated waste
    patterns.sort((a, b) => b.estimatedWaste - a.estimatedWaste);

    const totalWaste = patterns.reduce((sum, p) => sum + p.estimatedWaste, 0);

    res.json({
      success: true,
      data: {
        patterns: patterns.map((p) => ({
          ...p,
          estimatedWaste: parseFloat(p.estimatedWaste.toFixed(4)),
        })),
        summary: {
          totalWaste: parseFloat(totalWaste.toFixed(4)),
          patternCount: patterns.length,
          highSeverity: patterns.filter((p) => p.severity === "high").length,
          mediumSeverity: patterns.filter((p) => p.severity === "medium").length,
          lowSeverity: patterns.filter((p) => p.severity === "low").length,
          tasksAnalyzed: tasks.length,
          avgCostBaseline: parseFloat(avgCost.toFixed(4)),
        },
      },
    });
  } catch (error) {
    logger.error("Error analyzing wasteful patterns", { error });
    res.status(500).json({ error: "Failed to analyze wasteful patterns" });
  }
});

/**
 * GET /api/analytics/action-costs
 * Get aggregated costs by action type (operation type) across all tasks
 */
router.get("/action-costs", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";

    // Calculate date range
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const { WorkerTaskTokenUsage } = await import("../models/WorkerTaskTokenUsage.js");
    const tokenUsageRepo = AppDataSource.getRepository(WorkerTaskTokenUsage);

    // Get aggregated costs by operation type
    const results = await tokenUsageRepo
      .createQueryBuilder("usage")
      .innerJoin("usage.task", "task")
      .select("COALESCE(usage.operationType, 'other')", "operationType")
      .addSelect("SUM(usage.inputTokens)", "inputTokens")
      .addSelect("SUM(usage.outputTokens)", "outputTokens")
      .addSelect("SUM(usage.cacheCreationTokens)", "cacheCreationTokens")
      .addSelect("SUM(usage.cacheReadTokens)", "cacheReadTokens")
      .addSelect("SUM(usage.estimatedCostUsd)", "totalCost")
      .addSelect("COUNT(*)", "recordCount")
      .addSelect("COUNT(DISTINCT task.id)", "taskCount")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("usage.createdAt >= :startDate", { startDate })
      .groupBy("COALESCE(usage.operationType, 'other')")
      .orderBy("SUM(usage.estimatedCostUsd)", "DESC")
      .getRawMany();

    // Calculate totals
    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalRecords = 0;

    const byOperationType = results.map((row) => {
      const cost = parseFloat(row.totalCost) || 0;
      const inputTokens = parseInt(row.inputTokens) || 0;
      const outputTokens = parseInt(row.outputTokens) || 0;
      const cacheCreationTokens = parseInt(row.cacheCreationTokens) || 0;
      const cacheReadTokens = parseInt(row.cacheReadTokens) || 0;
      const records = parseInt(row.recordCount) || 0;
      const tasks = parseInt(row.taskCount) || 0;

      totalCost += cost;
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      totalRecords += records;

      return {
        operationType: row.operationType,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        estimatedCostUsd: parseFloat(cost.toFixed(4)),
        recordCount: records,
        taskCount: tasks,
        avgCostPerTask: tasks > 0 ? parseFloat((cost / tasks).toFixed(4)) : 0,
      };
    });

    res.json({
      range,
      startDate,
      byOperationType,
      totals: {
        estimatedCostUsd: parseFloat(totalCost.toFixed(4)),
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        recordCount: totalRecords,
        operationTypeCount: results.length,
      },
    });
  } catch (error) {
    logger.error("Error getting action costs", { error });
    res.status(500).json({ error: "Failed to get action costs" });
  }
});

/**
 * GET /api/analytics/business-outcomes
 * Get business outcome metrics for executive reporting
 *
 * Phase 5 Roadmap: Business Outcome Metrics
 * - PRs merged (deployed tasks with PR URLs)
 * - Issues addressed (tasks with Jira keys that reached terminal success states)
 * - Lines of code changed
 * - Files modified
 * - Value delivered trends over time
 */
router.get("/business-outcomes", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";

    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Get value delivered metrics
    const valueMetrics = await taskRepo
      .createQueryBuilder("task")
      .select("COUNT(*)", "totalTasks")
      .addSelect("COUNT(CASE WHEN task.status IN ('completed', 'deployed') THEN 1 END)", "successfulTasks")
      .addSelect("COUNT(CASE WHEN task.status = 'deployed' AND task.githubPrUrl IS NOT NULL THEN 1 END)", "prsMerged")
      .addSelect("COUNT(CASE WHEN task.jiraIssueKey IS NOT NULL AND task.status IN ('completed', 'deployed') THEN 1 END)", "issuesClosed")
      .addSelect("COALESCE(SUM(task.linesChanged), 0)", "totalLinesChanged")
      .addSelect("COALESCE(SUM(task.filesModified), 0)", "totalFilesModified")
      .addSelect("COALESCE(SUM(task.estimatedCostUsd), 0)", "totalCost")
      .addSelect("COALESCE(SUM(task.ecsTaskSeconds), 0)", "totalExecutionSeconds")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .getRawOne();

    const totalTasks = parseInt(valueMetrics.totalTasks) || 0;
    const successfulTasks = parseInt(valueMetrics.successfulTasks) || 0;
    const prsMerged = parseInt(valueMetrics.prsMerged) || 0;
    const issuesClosed = parseInt(valueMetrics.issuesClosed) || 0;
    const totalLinesChanged = parseInt(valueMetrics.totalLinesChanged) || 0;
    const totalFilesModified = parseInt(valueMetrics.totalFilesModified) || 0;
    const totalCost = parseFloat(valueMetrics.totalCost) || 0;
    const totalExecutionSeconds = parseInt(valueMetrics.totalExecutionSeconds) || 0;

    // Get breakdown by complexity (for tasks with plan data)
    const complexityBreakdown = await taskRepo
      .createQueryBuilder("task")
      .select("task.planJson->>'_complexity'->>'level'", "complexity")
      .addSelect("COUNT(*)", "count")
      .addSelect("COALESCE(SUM(task.linesChanged), 0)", "linesChanged")
      .addSelect("COALESCE(SUM(task.estimatedCostUsd), 0)", "cost")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.status IN (:...statuses)", { statuses: ["completed", "deployed"] })
      .andWhere("task.planJson IS NOT NULL")
      .groupBy("task.planJson->>'_complexity'->>'level'")
      .getRawMany();

    // Get daily/weekly trend of value delivered
    const useDailyBuckets = days <= 30;
    const dateGrouping = useDailyBuckets
      ? "DATE(task.completedAt)"
      : "DATE_TRUNC('week', task.completedAt)";

    const valueTrend = await taskRepo
      .createQueryBuilder("task")
      .select(dateGrouping, "date")
      .addSelect("COUNT(CASE WHEN task.status IN ('completed', 'deployed') THEN 1 END)", "tasksCompleted")
      .addSelect("COUNT(CASE WHEN task.status = 'deployed' AND task.githubPrUrl IS NOT NULL THEN 1 END)", "prsMerged")
      .addSelect("COALESCE(SUM(task.linesChanged), 0)", "linesChanged")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.completedAt >= :startDate", { startDate })
      .andWhere("task.completedAt IS NOT NULL")
      .groupBy(dateGrouping)
      .orderBy("date", "ASC")
      .getRawMany();

    // Get top repositories by value delivered
    const topRepos = await taskRepo
      .createQueryBuilder("task")
      .select("task.githubRepo", "repo")
      .addSelect("COUNT(*)", "tasksCompleted")
      .addSelect("COUNT(CASE WHEN task.status = 'deployed' THEN 1 END)", "prsMerged")
      .addSelect("COALESCE(SUM(task.linesChanged), 0)", "linesChanged")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.status IN (:...statuses)", { statuses: ["completed", "deployed"] })
      .groupBy("task.githubRepo")
      .orderBy("COUNT(*)", "DESC")
      .limit(5)
      .getRawMany();

    // Calculate derived metrics
    const successRate = totalTasks > 0 ? Math.round((successfulTasks / totalTasks) * 100) : 0;
    const avgLinesPerTask = successfulTasks > 0 ? Math.round(totalLinesChanged / successfulTasks) : 0;
    const avgFilesPerTask = successfulTasks > 0 ? Math.round((totalFilesModified / successfulTasks) * 10) / 10 : 0;
    const costPerLineChanged = totalLinesChanged > 0 ? totalCost / totalLinesChanged : 0;
    const executionHours = totalExecutionSeconds / 3600;

    res.json({
      period: {
        days,
        range,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      summary: {
        // Value delivered headline metrics
        prsMerged,
        issuesClosed,
        totalLinesChanged,
        totalFilesModified,
        successfulTasks,
        totalTasks,
        successRate,

        // Efficiency metrics
        avgLinesPerTask,
        avgFilesPerTask,
        costPerLineChanged: parseFloat(costPerLineChanged.toFixed(6)),
        totalCost: parseFloat(totalCost.toFixed(2)),
        executionHours: parseFloat(executionHours.toFixed(1)),
      },
      byComplexity: complexityBreakdown
        .filter((c) => c.complexity)
        .map((c) => ({
          complexity: c.complexity,
          count: parseInt(c.count) || 0,
          linesChanged: parseInt(c.linesChanged) || 0,
          cost: parseFloat(parseFloat(c.cost).toFixed(2)) || 0,
        })),
      trend: valueTrend.map((row) => {
        const dateStr = row.date instanceof Date
          ? row.date.toISOString().split("T")[0]
          : String(row.date).split("T")[0];
        return {
          date: dateStr,
          tasksCompleted: parseInt(row.tasksCompleted) || 0,
          prsMerged: parseInt(row.prsMerged) || 0,
          linesChanged: parseInt(row.linesChanged) || 0,
        };
      }),
      topRepositories: topRepos.map((r) => ({
        repo: r.repo,
        tasksCompleted: parseInt(r.tasksCompleted) || 0,
        prsMerged: parseInt(r.prsMerged) || 0,
        linesChanged: parseInt(r.linesChanged) || 0,
      })),
    });
  } catch (error) {
    logger.error("Error fetching business outcomes", { error });
    res.status(500).json({ error: "Failed to fetch business outcomes" });
  }
});

/**
 * GET /api/analytics/time-saved
 * Calculate developer time saved estimates based on task complexity and code changes
 *
 * Phase 5 Roadmap: Developer Time Saved Estimates
 * - Estimates based on task complexity (simple, medium, complex, expert)
 * - Factors in lines of code changed
 * - Uses historical benchmarks for similar work
 * - Includes methodology explanation
 */
router.get("/time-saved", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";

    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Time estimates by complexity tier (hours)
    // Based on industry research and engineering benchmarks:
    // - Simple: bug fixes, small tweaks (1-2 hours)
    // - Medium: feature additions, refactoring (3-6 hours)
    // - Complex: multi-file features, API work (8-16 hours)
    // - Expert: architectural changes, cross-system work (16-40 hours)
    const complexityTimeEstimates: Record<string, { minHours: number; maxHours: number; avgHours: number }> = {
      simple: { minHours: 1, maxHours: 2, avgHours: 1.5 },
      low: { minHours: 1, maxHours: 2, avgHours: 1.5 }, // Alias for simple
      medium: { minHours: 3, maxHours: 6, avgHours: 4.5 },
      complex: { minHours: 8, maxHours: 16, avgHours: 12 },
      high: { minHours: 8, maxHours: 16, avgHours: 12 }, // Alias for complex
      expert: { minHours: 16, maxHours: 40, avgHours: 28 },
      unknown: { minHours: 2, maxHours: 4, avgHours: 3 }, // Default fallback
    };

    // Lines of code multiplier (additional time based on code volume)
    // Benchmark: ~50-100 lines/hour for experienced developers
    const linesPerHourBenchmark = 75;

    // Get successful tasks with complexity data
    const tasks = await taskRepo
      .createQueryBuilder("task")
      .select([
        "task.id",
        "task.planJson",
        "task.linesChanged",
        "task.filesModified",
        "task.ecsTaskSeconds",
        "task.estimatedCostUsd",
        "task.workerPersona",
      ])
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.status IN (:...statuses)", { statuses: ["completed", "deployed"] })
      .getMany();

    // Calculate time saved for each task
    let totalTimeSavedHours = 0;
    let totalTimeSavedMinHours = 0;
    let totalTimeSavedMaxHours = 0;
    let tasksWithComplexity = 0;
    let tasksWithoutComplexity = 0;
    let totalLinesChanged = 0;
    let totalCost = 0;

    const byComplexity: Record<string, { count: number; hoursSaved: number; linesChanged: number }> = {
      simple: { count: 0, hoursSaved: 0, linesChanged: 0 },
      medium: { count: 0, hoursSaved: 0, linesChanged: 0 },
      complex: { count: 0, hoursSaved: 0, linesChanged: 0 },
      expert: { count: 0, hoursSaved: 0, linesChanged: 0 },
      unknown: { count: 0, hoursSaved: 0, linesChanged: 0 },
    };

    const byPersona: Record<string, { count: number; hoursSaved: number }> = {};

    for (const task of tasks) {
      // Extract complexity level from plan
      const plan = task.planJson as Record<string, unknown> | null;
      const complexityData = plan?._complexity as { level?: string } | undefined;
      let complexityLevel = complexityData?.level?.toLowerCase() || "unknown";

      // Normalize complexity levels
      if (complexityLevel === "low") complexityLevel = "simple";
      if (complexityLevel === "high") complexityLevel = "complex";
      if (!["simple", "medium", "complex", "expert", "unknown"].includes(complexityLevel)) {
        complexityLevel = "unknown";
      }

      const estimates = complexityTimeEstimates[complexityLevel] || complexityTimeEstimates.unknown;

      // Base time from complexity
      let taskTimeSaved = estimates.avgHours;

      // Adjust for lines of code (if significant code was written)
      const lines = task.linesChanged || 0;
      if (lines > 0) {
        const linesBasedTime = lines / linesPerHourBenchmark;
        // Use the higher of complexity-based or lines-based estimate
        taskTimeSaved = Math.max(taskTimeSaved, linesBasedTime);
      }

      // Track statistics
      if (complexityLevel !== "unknown") {
        tasksWithComplexity++;
      } else {
        tasksWithoutComplexity++;
      }

      totalTimeSavedHours += taskTimeSaved;
      totalTimeSavedMinHours += estimates.minHours;
      totalTimeSavedMaxHours += Math.max(estimates.maxHours, lines / linesPerHourBenchmark);
      totalLinesChanged += lines;
      totalCost += parseFloat(String(task.estimatedCostUsd)) || 0;

      // Aggregate by complexity
      if (!byComplexity[complexityLevel]) {
        byComplexity[complexityLevel] = { count: 0, hoursSaved: 0, linesChanged: 0 };
      }
      byComplexity[complexityLevel].count++;
      byComplexity[complexityLevel].hoursSaved += taskTimeSaved;
      byComplexity[complexityLevel].linesChanged += lines;

      // Aggregate by persona
      const persona = task.workerPersona || "unknown";
      if (!byPersona[persona]) {
        byPersona[persona] = { count: 0, hoursSaved: 0 };
      }
      byPersona[persona].count++;
      byPersona[persona].hoursSaved += taskTimeSaved;
    }

    // Calculate averages
    const totalTasks = tasks.length;
    const avgTimeSavedPerTask = totalTasks > 0 ? totalTimeSavedHours / totalTasks : 0;

    res.json({
      period: {
        days,
        range,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      summary: {
        totalTasksAnalyzed: totalTasks,
        tasksWithComplexityData: tasksWithComplexity,
        tasksWithoutComplexityData: tasksWithoutComplexity,

        // Time saved estimates
        estimatedHoursSaved: parseFloat(totalTimeSavedHours.toFixed(1)),
        estimatedHoursSavedMin: parseFloat(totalTimeSavedMinHours.toFixed(1)),
        estimatedHoursSavedMax: parseFloat(totalTimeSavedMaxHours.toFixed(1)),
        avgHoursSavedPerTask: parseFloat(avgTimeSavedPerTask.toFixed(1)),

        // Context metrics
        totalLinesChanged,
        totalCost: parseFloat(totalCost.toFixed(2)),
        costPerHourSaved: totalTimeSavedHours > 0
          ? parseFloat((totalCost / totalTimeSavedHours).toFixed(2))
          : 0,
      },
      byComplexity: Object.entries(byComplexity)
        .filter(([_, data]) => data.count > 0)
        .map(([level, data]) => ({
          complexity: level,
          taskCount: data.count,
          hoursSaved: parseFloat(data.hoursSaved.toFixed(1)),
          linesChanged: data.linesChanged,
          avgHoursPerTask: parseFloat((data.hoursSaved / data.count).toFixed(1)),
        }))
        .sort((a, b) => b.hoursSaved - a.hoursSaved),
      byPersona: Object.entries(byPersona)
        .map(([persona, data]) => ({
          persona,
          taskCount: data.count,
          hoursSaved: parseFloat(data.hoursSaved.toFixed(1)),
        }))
        .sort((a, b) => b.hoursSaved - a.hoursSaved),
      methodology: {
        description: "Time saved estimates are calculated using a combination of task complexity classification and lines of code changed.",
        complexityBenchmarks: {
          simple: "Bug fixes, small tweaks: 1-2 developer hours",
          medium: "Feature additions, refactoring: 3-6 developer hours",
          complex: "Multi-file features, API work: 8-16 developer hours",
          expert: "Architectural changes, cross-system work: 16-40 developer hours",
        },
        codeVolumeBenchmark: `${linesPerHourBenchmark} lines of code per developer hour (industry average for experienced developers)`,
        calculation: "For each task, we use the higher of: (1) complexity-based estimate, or (2) lines-changed ÷ 75 lines/hour. This provides a conservative estimate that accounts for both task scope and actual code volume.",
        limitations: [
          "Estimates assume average developer productivity",
          "Does not account for domain-specific complexity",
          "Code review and testing time not separately tracked",
          "Tasks without complexity data use 3-hour default estimate",
        ],
      },
    });
  } catch (error) {
    logger.error("Error calculating time saved", { error });
    res.status(500).json({ error: "Failed to calculate time saved estimates" });
  }
});

/**
 * GET /api/analytics/cost-comparison
 * Get cost breakdowns for comparison charts: by model, by persona, daily trend
 */
router.get("/cost-comparison", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";

    // Calculate date range
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const { WorkerTask } = await import("../models/WorkerTask.js");
    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Get all completed tasks in range
    const tasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.status IN (:...statuses)", { statuses: ["completed", "deployed", "failed"] })
      .getMany();

    // Cost by model
    const byModel = new Map<string, { cost: number; tasks: number; success: number }>();
    for (const task of tasks) {
      const model = task.workerModel || "unknown";
      if (!byModel.has(model)) {
        byModel.set(model, { cost: 0, tasks: 0, success: 0 });
      }
      const entry = byModel.get(model)!;
      entry.cost += task.estimatedCostUsd || 0;
      entry.tasks += 1;
      if (task.status === "completed" || task.status === "deployed") {
        entry.success += 1;
      }
    }

    const costByModel = Array.from(byModel.entries())
      .map(([model, data]) => ({
        model,
        totalCost: parseFloat(data.cost.toFixed(4)),
        taskCount: data.tasks,
        avgCost: data.tasks > 0 ? parseFloat((data.cost / data.tasks).toFixed(4)) : 0,
        successRate: data.tasks > 0 ? parseFloat(((data.success / data.tasks) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.totalCost - a.totalCost);

    // Cost by persona
    const byPersona = new Map<string, { cost: number; tasks: number; success: number }>();
    for (const task of tasks) {
      const persona = task.workerPersona || "unknown";
      if (!byPersona.has(persona)) {
        byPersona.set(persona, { cost: 0, tasks: 0, success: 0 });
      }
      const entry = byPersona.get(persona)!;
      entry.cost += task.estimatedCostUsd || 0;
      entry.tasks += 1;
      if (task.status === "completed" || task.status === "deployed") {
        entry.success += 1;
      }
    }

    const costByPersona = Array.from(byPersona.entries())
      .map(([persona, data]) => ({
        persona,
        totalCost: parseFloat(data.cost.toFixed(4)),
        taskCount: data.tasks,
        avgCost: data.tasks > 0 ? parseFloat((data.cost / data.tasks).toFixed(4)) : 0,
        successRate: data.tasks > 0 ? parseFloat(((data.success / data.tasks) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.totalCost - a.totalCost);

    // Daily cost trend
    const byDay = new Map<string, { cost: number; tasks: number }>();
    for (const task of tasks) {
      const date = new Date(task.createdAt).toISOString().split("T")[0];
      if (!byDay.has(date)) {
        byDay.set(date, { cost: 0, tasks: 0 });
      }
      const entry = byDay.get(date)!;
      entry.cost += task.estimatedCostUsd || 0;
      entry.tasks += 1;
    }

    // Fill in missing days with zeros
    const dailyTrend: Array<{ date: string; cost: number; tasks: number }> = [];
    const currentDate = new Date(startDate);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    while (currentDate <= today) {
      const dateStr = currentDate.toISOString().split("T")[0];
      const dayData = byDay.get(dateStr) || { cost: 0, tasks: 0 };
      dailyTrend.push({
        date: dateStr,
        cost: parseFloat(dayData.cost.toFixed(4)),
        tasks: dayData.tasks,
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Calculate totals
    const totalCost = tasks.reduce((sum, t) => sum + (t.estimatedCostUsd || 0), 0);
    const totalTasks = tasks.length;
    const avgCostPerDay = dailyTrend.length > 0 ? totalCost / dailyTrend.length : 0;

    res.json({
      success: true,
      data: {
        byModel: costByModel,
        byPersona: costByPersona,
        dailyTrend,
        summary: {
          totalCost: parseFloat(totalCost.toFixed(4)),
          totalTasks,
          avgCostPerDay: parseFloat(avgCostPerDay.toFixed(4)),
          dateRange: {
            start: startDate.toISOString().split("T")[0],
            end: today.toISOString().split("T")[0],
            days,
          },
        },
      },
    });
  } catch (error) {
    logger.error("Error getting cost comparison data", { error });
    res.status(500).json({ error: "Failed to get cost comparison data" });
  }
});

/**
 * POST /api/analytics/cost-simulation
 * Simulate task cost based on model, complexity, and duration
 */
router.post("/cost-simulation", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const { model, complexity, durationMinutes, taskCount = 1 } = req.body;

    // Model pricing (per 1M tokens) - January 2026
    // Source: https://platform.claude.com/docs/en/about-claude/pricing
    const modelPricing: Record<string, { input: number; output: number }> = {
      // Claude Haiku 4.5 - $1.00/$5.00 per MTok
      "claude-haiku-4-5": { input: 1.0, output: 5.0 },
      "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
      // Claude Sonnet 4.5 - $3.00/$15.00 per MTok
      "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
      "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0 },
      // Claude Opus 4.6 - $5.00/$25.00 per MTok
      "claude-opus-4-6": { input: 5.0, output: 25.0 },
      // Claude Opus 4.5 (legacy) - $5.00/$25.00 per MTok
      "claude-opus-4-5": { input: 5.0, output: 25.0 },
      "claude-opus-4-5-20251101": { input: 5.0, output: 25.0 },
      // OpenAI models
      "gpt-4o": { input: 2.5, output: 10.0 },
      "gpt-4o-mini": { input: 0.15, output: 0.6 },
      // Google models
      "gemini-2.0-flash": { input: 0.15, output: 0.6 },
      "gemini-3-pro-preview": { input: 3.5, output: 10.5 },
    };

    // Complexity multipliers for token usage estimation
    const complexityMultipliers: Record<string, number> = {
      trivial: 0.3,
      simple: 0.6,
      moderate: 1.0,
      complex: 1.5,
      epic: 2.5,
    };

    // Base token estimates per task (these are averages from historical data)
    const baseInputTokens = 50000; // 50K input tokens base
    const baseOutputTokens = 10000; // 10K output tokens base

    // Calculate tokens based on complexity and duration
    const complexityMultiplier = complexityMultipliers[complexity] || 1.0;
    const durationMultiplier = Math.max(0.5, (durationMinutes || 30) / 30); // 30 min baseline

    const estimatedInputTokens = Math.round(baseInputTokens * complexityMultiplier * durationMultiplier);
    const estimatedOutputTokens = Math.round(baseOutputTokens * complexityMultiplier * durationMultiplier);

    // Get pricing for selected model
    const pricing = modelPricing[model] || modelPricing["claude-haiku-4-5"];

    // Calculate cost per task
    const inputCost = (estimatedInputTokens / 1_000_000) * pricing.input;
    const outputCost = (estimatedOutputTokens / 1_000_000) * pricing.output;
    const costPerTask = inputCost + outputCost;

    // Calculate total cost for batch
    const totalCost = costPerTask * taskCount;

    // Compare with other models
    const modelComparison = Object.entries(modelPricing).map(([modelName, price]) => {
      const modelInputCost = (estimatedInputTokens / 1_000_000) * price.input;
      const modelOutputCost = (estimatedOutputTokens / 1_000_000) * price.output;
      const modelCost = modelInputCost + modelOutputCost;
      return {
        model: modelName,
        costPerTask: parseFloat(modelCost.toFixed(4)),
        totalCost: parseFloat((modelCost * taskCount).toFixed(4)),
        savings: parseFloat((costPerTask - modelCost).toFixed(4)),
        savingsPercent: costPerTask > 0 ? parseFloat((((costPerTask - modelCost) / costPerTask) * 100).toFixed(1)) : 0,
      };
    }).sort((a, b) => a.costPerTask - b.costPerTask);

    // Get historical average for comparison
    const { WorkerTask } = await import("../models/WorkerTask.js");
    const taskRepo = AppDataSource.getRepository(WorkerTask);

    const historicalAvg = await taskRepo
      .createQueryBuilder("task")
      .select("AVG(task.estimated_cost_usd)", "avgCost")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.status IN (:...statuses)", { statuses: ["completed", "deployed"] })
      .andWhere("task.estimated_cost_usd > 0")
      .getRawOne();

    const historicalAvgCost = parseFloat(historicalAvg?.avgCost || "0");

    res.json({
      success: true,
      data: {
        simulation: {
          model,
          complexity,
          durationMinutes: durationMinutes || 30,
          taskCount,
          estimatedInputTokens,
          estimatedOutputTokens,
          costPerTask: parseFloat(costPerTask.toFixed(4)),
          totalCost: parseFloat(totalCost.toFixed(4)),
        },
        modelComparison,
        historicalComparison: {
          avgCost: parseFloat(historicalAvgCost.toFixed(4)),
          vsHistorical: historicalAvgCost > 0
            ? parseFloat((((costPerTask - historicalAvgCost) / historicalAvgCost) * 100).toFixed(1))
            : null,
        },
        budgetImpact: {
          dailyLimit: org.dailyBudgetLimitUsd,
          weeklyLimit: org.weeklyBudgetLimitUsd,
          monthlyLimit: org.monthlyBudgetLimitUsd,
          wouldExceedDaily: org.dailyBudgetLimitUsd ? totalCost > org.dailyBudgetLimitUsd : false,
          wouldExceedWeekly: org.weeklyBudgetLimitUsd ? totalCost > org.weeklyBudgetLimitUsd : false,
          wouldExceedMonthly: org.monthlyBudgetLimitUsd ? totalCost > org.monthlyBudgetLimitUsd : false,
        },
      },
    });
  } catch (error) {
    logger.error("Error running cost simulation", { error });
    res.status(500).json({ error: "Failed to run cost simulation" });
  }
});

/**
 * GET /api/analytics/cost-anomalies
 * Detect cost anomalies and unusual spending patterns
 */
router.get("/cost-anomalies", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;

    const { WorkerTask } = await import("../models/WorkerTask.js");
    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Get tasks from last 30 days for analysis
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    startDate.setHours(0, 0, 0, 0);

    const tasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.status IN (:...statuses)", { statuses: ["completed", "deployed", "failed"] })
      .orderBy("task.createdAt", "DESC")
      .getMany();

    const anomalies: Array<{
      type: string;
      severity: "critical" | "warning" | "info";
      title: string;
      description: string;
      value: number;
      threshold: number;
      timestamp: string;
      taskId?: string;
      jiraKey?: string;
    }> = [];

    if (tasks.length === 0) {
      res.json({
        success: true,
        data: {
          anomalies: [],
          summary: { total: 0, critical: 0, warning: 0, info: 0 },
        },
      });
      return;
    }

    // Calculate baseline metrics
    const costs = tasks.map((t) => t.estimatedCostUsd || 0).filter((c) => c > 0);
    if (costs.length === 0) {
      res.json({
        success: true,
        data: {
          anomalies: [],
          summary: { total: 0, critical: 0, warning: 0, info: 0 },
        },
      });
      return;
    }

    const avgCost = costs.reduce((a, b) => a + b, 0) / costs.length;
    const sortedCosts = [...costs].sort((a, b) => a - b);
    const medianCost = sortedCosts[Math.floor(sortedCosts.length / 2)];

    // Calculate standard deviation
    const variance = costs.reduce((sum, c) => sum + Math.pow(c - avgCost, 2), 0) / costs.length;
    const stdDev = Math.sqrt(variance);

    // Anomaly 1: Individual task cost outliers (>3 std dev or >5x average)
    for (const task of tasks.slice(0, 100)) {
      const cost = task.estimatedCostUsd || 0;
      if (cost <= 0) continue;

      const zScore = stdDev > 0 ? (cost - avgCost) / stdDev : 0;
      const multiplier = cost / avgCost;

      if (zScore > 3 || multiplier > 5) {
        anomalies.push({
          type: "task_cost_outlier",
          severity: zScore > 4 || multiplier > 10 ? "critical" : "warning",
          title: "High-cost task detected",
          description: `Task ${task.jiraIssueKey || task.id.slice(0, 8)} cost ${formatUsd(cost)} (${multiplier.toFixed(1)}x average)`,
          value: cost,
          threshold: avgCost * 5,
          timestamp: task.createdAt.toISOString(),
          taskId: task.id,
          jiraKey: task.jiraIssueKey || undefined,
        });
      }
    }

    // Anomaly 2: Daily cost spikes
    const byDay = new Map<string, number>();
    for (const task of tasks) {
      const date = new Date(task.createdAt).toISOString().split("T")[0];
      byDay.set(date, (byDay.get(date) || 0) + (task.estimatedCostUsd || 0));
    }

    const dailyCosts = Array.from(byDay.entries()).map(([date, cost]) => ({ date, cost }));
    dailyCosts.sort((a, b) => a.date.localeCompare(b.date));

    // Calculate 7-day rolling average for comparison
    for (let i = 7; i < dailyCosts.length; i++) {
      const current = dailyCosts[i];
      const previousWeek = dailyCosts.slice(i - 7, i);
      const weekAvg = previousWeek.reduce((sum, d) => sum + d.cost, 0) / 7;

      if (weekAvg > 0 && current.cost > weekAvg * 3) {
        anomalies.push({
          type: "daily_cost_spike",
          severity: current.cost > weekAvg * 5 ? "critical" : "warning",
          title: "Daily cost spike",
          description: `Cost on ${current.date} was ${formatUsd(current.cost)} (${(current.cost / weekAvg).toFixed(1)}x weekly average)`,
          value: current.cost,
          threshold: weekAvg * 3,
          timestamp: new Date(current.date).toISOString(),
        });
      }
    }

    // Anomaly 3: Rapid spending acceleration (today vs yesterday)
    if (dailyCosts.length >= 2) {
      const today = dailyCosts[dailyCosts.length - 1];
      const yesterday = dailyCosts[dailyCosts.length - 2];

      if (yesterday.cost > 0 && today.cost > yesterday.cost * 2 && today.cost > avgCost) {
        anomalies.push({
          type: "spending_acceleration",
          severity: today.cost > yesterday.cost * 3 ? "warning" : "info",
          title: "Spending acceleration",
          description: `Today's cost (${formatUsd(today.cost)}) is ${(today.cost / yesterday.cost).toFixed(1)}x yesterday's (${formatUsd(yesterday.cost)})`,
          value: today.cost,
          threshold: yesterday.cost * 2,
          timestamp: new Date(today.date).toISOString(),
        });
      }
    }

    // Anomaly 4: High failure rate with significant cost
    const recentTasks = tasks.slice(0, 20);
    const recentFailures = recentTasks.filter((t) => t.status === "failed");
    const failureRate = recentTasks.length > 0 ? (recentFailures.length / recentTasks.length) * 100 : 0;
    const failedCost = recentFailures.reduce((sum, t) => sum + (t.estimatedCostUsd || 0), 0);

    if (failureRate > 50 && failedCost > avgCost * 3) {
      anomalies.push({
        type: "high_failure_cost",
        severity: failureRate > 75 ? "critical" : "warning",
        title: "High failure rate with significant cost",
        description: `${failureRate.toFixed(0)}% failure rate in recent tasks, wasting ${formatUsd(failedCost)}`,
        value: failedCost,
        threshold: avgCost * 3,
        timestamp: new Date().toISOString(),
      });
    }

    // Anomaly 5: Budget threshold approaching
    if (org.dailyBudgetLimitUsd || org.weeklyBudgetLimitUsd || org.monthlyBudgetLimitUsd) {
      // Get today's spending
      const todayStr = new Date().toISOString().split("T")[0];
      const todaySpending = byDay.get(todayStr) || 0;

      if (org.dailyBudgetLimitUsd && todaySpending >= org.dailyBudgetLimitUsd * 0.8) {
        anomalies.push({
          type: "budget_threshold",
          severity: todaySpending >= org.dailyBudgetLimitUsd ? "critical" : "warning",
          title: "Daily budget threshold",
          description: `Daily spending (${formatUsd(todaySpending)}) has reached ${((todaySpending / org.dailyBudgetLimitUsd) * 100).toFixed(0)}% of limit (${formatUsd(org.dailyBudgetLimitUsd)})`,
          value: todaySpending,
          threshold: org.dailyBudgetLimitUsd * 0.8,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Sort anomalies by severity and timestamp
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    anomalies.sort((a, b) => {
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    // Limit to 20 most important anomalies
    const limitedAnomalies = anomalies.slice(0, 20);

    res.json({
      success: true,
      data: {
        anomalies: limitedAnomalies,
        summary: {
          total: limitedAnomalies.length,
          critical: limitedAnomalies.filter((a) => a.severity === "critical").length,
          warning: limitedAnomalies.filter((a) => a.severity === "warning").length,
          info: limitedAnomalies.filter((a) => a.severity === "info").length,
        },
        baseline: {
          avgCost: parseFloat(avgCost.toFixed(4)),
          medianCost: parseFloat(medianCost.toFixed(4)),
          stdDev: parseFloat(stdDev.toFixed(4)),
          taskCount: tasks.length,
        },
      },
    });
  } catch (error) {
    logger.error("Error detecting cost anomalies", { error });
    res.status(500).json({ error: "Failed to detect cost anomalies" });
  }
});

// Helper function for formatting USD
function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * GET /api/analytics/cost-report
 * Export cost report for finance teams in CSV or JSON format
 */
router.get("/cost-report", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const format = (req.query.format as string) || "csv";
    const range = (req.query.range as string) || "30d";

    // Calculate date range
    const days = range === "7d" ? 7 : range === "90d" ? 90 : range === "all" ? 365 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const { WorkerTask } = await import("../models/WorkerTask.js");
    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Get all tasks in range
    const tasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.status IN (:...statuses)", { statuses: ["completed", "deployed", "failed"] })
      .orderBy("task.createdAt", "DESC")
      .getMany();

    // Prepare report data
    const reportData = tasks.map((task) => ({
      taskId: task.id,
      jiraKey: task.jiraIssueKey || "",
      summary: task.summary || "",
      status: task.status,
      model: task.workerModel || "",
      persona: task.workerPersona || "",
      estimatedCostUsd: task.estimatedCostUsd || 0,
      inputTokens: task.inputTokens || 0,
      outputTokens: task.outputTokens || 0,
      cacheReadTokens: task.cacheReadTokens || 0,
      cacheCreationTokens: task.cacheCreationTokens || 0,
      executionTimeMinutes: task.startedAt && task.completedAt
        ? Math.round((new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 60000)
        : null,
      prUrl: task.githubPrUrl || "",
      createdAt: task.createdAt.toISOString(),
      completedAt: task.completedAt ? task.completedAt.toISOString() : "",
    }));

    // Calculate summary
    const totalCost = reportData.reduce((sum, t) => sum + t.estimatedCostUsd, 0);
    const totalTasks = reportData.length;
    const successfulTasks = reportData.filter((t) => t.status === "completed" || t.status === "deployed").length;
    const failedTasks = reportData.filter((t) => t.status === "failed").length;
    const totalInputTokens = reportData.reduce((sum, t) => sum + t.inputTokens, 0);
    const totalOutputTokens = reportData.reduce((sum, t) => sum + t.outputTokens, 0);

    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="cost-report-${org.name}-${range}.json"`);
      res.json({
        reportMetadata: {
          organization: org.name,
          generatedAt: new Date().toISOString(),
          dateRange: {
            start: startDate.toISOString().split("T")[0],
            end: new Date().toISOString().split("T")[0],
            days,
          },
        },
        summary: {
          totalCost: parseFloat(totalCost.toFixed(2)),
          totalTasks,
          successfulTasks,
          failedTasks,
          totalInputTokens,
          totalOutputTokens,
          avgCostPerTask: totalTasks > 0 ? parseFloat((totalCost / totalTasks).toFixed(4)) : 0,
        },
        tasks: reportData,
      });
    } else {
      // CSV format
      const headers = [
        "Task ID",
        "Jira Key",
        "Summary",
        "Status",
        "Model",
        "Persona",
        "Cost (USD)",
        "Input Tokens",
        "Output Tokens",
        "Cache Read Tokens",
        "Cache Creation Tokens",
        "Execution Time (min)",
        "PR URL",
        "Created At",
        "Completed At",
      ];

      const csvRows = [
        headers.join(","),
        ...reportData.map((row) =>
          [
            `"${row.taskId}"`,
            `"${row.jiraKey}"`,
            `"${(row.summary || "").replace(/"/g, '""')}"`,
            row.status,
            row.model,
            row.persona,
            row.estimatedCostUsd.toFixed(4),
            row.inputTokens,
            row.outputTokens,
            row.cacheReadTokens,
            row.cacheCreationTokens,
            row.executionTimeMinutes !== null ? row.executionTimeMinutes : "",
            `"${row.prUrl}"`,
            row.createdAt,
            row.completedAt,
          ].join(",")
        ),
        "", // Empty row before summary
        "SUMMARY",
        `Total Cost (USD),${totalCost.toFixed(2)}`,
        `Total Tasks,${totalTasks}`,
        `Successful Tasks,${successfulTasks}`,
        `Failed Tasks,${failedTasks}`,
        `Total Input Tokens,${totalInputTokens}`,
        `Total Output Tokens,${totalOutputTokens}`,
        `Avg Cost Per Task,${totalTasks > 0 ? (totalCost / totalTasks).toFixed(4) : 0}`,
        `Report Generated,${new Date().toISOString()}`,
        `Organization,${org.name}`,
        `Date Range,${startDate.toISOString().split("T")[0]} to ${new Date().toISOString().split("T")[0]}`,
      ];

      const csvContent = csvRows.join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="cost-report-${org.name}-${range}.csv"`);
      res.send(csvContent);
    }
  } catch (error) {
    logger.error("Error generating cost report", { error });
    res.status(500).json({ error: "Failed to generate cost report" });
  }
});

/**
 * GET /api/analytics/quality-export
 * Export quality metrics data in CSV or JSON format
 */
router.get("/quality-export", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const format = (req.query.format as string) || "json";
    const range = (req.query.range as string) || "30d";

    // Validate format
    if (!["json", "csv"].includes(format)) {
      res.status(400).json({ error: "Format must be 'json' or 'csv'" });
      return;
    }

    // Calculate date range
    const days = range === "7d" ? 7 : range === "90d" ? 90 : range === "365d" ? 365 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Fetch all tasks with quality metrics
    const tasks = await taskRepo
      .createQueryBuilder("task")
      .select([
        "task.id",
        "task.jiraIssueKey",
        "task.workerPersona",
        "task.status",
        "task.qualityScore",
        "task.coverageLines",
        "task.coverageBranches",
        "task.lintErrors",
        "task.typeErrors",
        "task.testsPassed",
        "task.testsFailed",
        "task.testsSkipped",
        "task.securityHigh",
        "task.securityMedium",
        "task.securityLow",
        "task.createdAt",
        "task.completedAt",
      ])
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.qualityScore IS NOT NULL")
      .orderBy("task.createdAt", "DESC")
      .getMany();

    // Format data for export
    const exportData = tasks.map((task) => ({
      id: task.id,
      issueKey: task.jiraIssueKey || "",
      persona: task.workerPersona || "",
      status: task.status,
      qualityScore: task.qualityScore,
      qualityGrade: task.getQualityGrade() || "",
      coverageLines: task.coverageLines || 0,
      coverageBranches: task.coverageBranches || 0,
      lintErrors: task.lintErrors || 0,
      typeErrors: task.typeErrors || 0,
      testsPassed: task.testsPassed || 0,
      testsFailed: task.testsFailed || 0,
      testsSkipped: task.testsSkipped || 0,
      securityHigh: task.securityHigh || 0,
      securityMedium: task.securityMedium || 0,
      securityLow: task.securityLow || 0,
      totalVulnerabilities: (task.securityHigh || 0) + (task.securityMedium || 0) + (task.securityLow || 0),
      createdAt: task.createdAt.toISOString(),
      completedAt: task.completedAt ? task.completedAt.toISOString() : "",
    }));

    if (format === "csv") {
      // Generate CSV
      const headers = [
        "id",
        "issueKey",
        "persona",
        "status",
        "qualityScore",
        "qualityGrade",
        "coverageLines",
        "coverageBranches",
        "lintErrors",
        "typeErrors",
        "testsPassed",
        "testsFailed",
        "testsSkipped",
        "securityHigh",
        "securityMedium",
        "securityLow",
        "totalVulnerabilities",
        "createdAt",
        "completedAt",
      ];

      const csvRows = [headers.join(",")];

      for (const row of exportData) {
        const values = headers.map((header) => {
          const value = row[header as keyof typeof row];
          // Escape quotes and wrap in quotes if contains comma
          if (typeof value === "string" && (value.includes(",") || value.includes('"'))) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        });
        csvRows.push(values.join(","));
      }

      const csv = csvRows.join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="quality-metrics-${org.slug || org.id}-${range}.csv"`);
      res.send(csv);
    } else {
      // JSON format
      res.json({
        success: true,
        organization: org.slug || org.id,
        range,
        exportedAt: new Date().toISOString(),
        taskCount: exportData.length,
        data: exportData,
      });
    }
  } catch (error) {
    logger.error("Error exporting quality metrics", { error });
    res.status(500).json({ error: "Failed to export quality metrics" });
  }
});

/**
 * GET /api/analytics/quality-leaderboard
 * Get quality leaderboard across tasks and personas
 */
router.get("/quality-leaderboard", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    // Calculate date range
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Top quality tasks
    const topTasksRaw = await taskRepo
      .createQueryBuilder("task")
      .select([
        "task.id",
        "task.jiraIssueKey",
        "task.linearIssueId",
        "task.persona",
        "task.qualityScore",
        "task.coverageLines",
        "task.securityHigh",
        "task.typeErrors",
        "task.testsFailed",
        "task.createdAt",
      ])
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.qualityScore IS NOT NULL")
      .orderBy("task.qualityScore", "DESC")
      .addOrderBy("task.coverageLines", "DESC", "NULLS LAST")
      .limit(limit)
      .getMany();

    const topTasks = topTasksRaw.map((task) => ({
      id: task.id,
      issueKey: task.jiraIssueKey || task.id,
      persona: task.workerPersona,
      qualityScore: task.qualityScore,
      coverage: task.coverageLines,
      securityIssues: (task.securityHigh || 0),
      typeErrors: task.typeErrors || 0,
      testFailures: task.testsFailed || 0,
      createdAt: task.createdAt,
      grade: task.getQualityGrade(),
    }));

    // Best personas by average quality
    const personaLeaderboardRaw = await taskRepo
      .createQueryBuilder("task")
      .select("task.persona", "persona")
      .addSelect("COUNT(*)", "taskCount")
      .addSelect("AVG(task.qualityScore)", "avgQualityScore")
      .addSelect("AVG(task.coverageLines)", "avgCoverage")
      .addSelect("COUNT(CASE WHEN task.qualityScore >= 90 THEN 1 END)", "excellentTasks")
      .addSelect("COUNT(CASE WHEN task.qualityScore >= 80 AND task.qualityScore < 90 THEN 1 END)", "goodTasks")
      .addSelect("AVG(task.typeErrors)", "avgTypeErrors")
      .addSelect("AVG(task.testsFailed)", "avgTestFailures")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.qualityScore IS NOT NULL")
      .andWhere("task.persona IS NOT NULL")
      .groupBy("task.persona")
      .having("COUNT(*) >= 3") // Need at least 3 tasks for meaningful stats
      .orderBy("AVG(task.qualityScore)", "DESC")
      .limit(limit)
      .getRawMany();

    const personaLeaderboard = personaLeaderboardRaw.map((row) => ({
      persona: row.persona,
      taskCount: parseInt(row.taskCount) || 0,
      avgQualityScore: row.avgQualityScore !== null ? Math.round(parseFloat(row.avgQualityScore)) : null,
      avgCoverage: row.avgCoverage !== null ? Math.round(parseFloat(row.avgCoverage) * 10) / 10 : null,
      excellentTasks: parseInt(row.excellentTasks) || 0,
      goodTasks: parseInt(row.goodTasks) || 0,
      avgTypeErrors: row.avgTypeErrors !== null ? Math.round(parseFloat(row.avgTypeErrors) * 10) / 10 : 0,
      avgTestFailures: row.avgTestFailures !== null ? Math.round(parseFloat(row.avgTestFailures) * 10) / 10 : 0,
      excellenceRate: parseInt(row.taskCount) > 0
        ? Math.round((parseInt(row.excellentTasks) / parseInt(row.taskCount)) * 100)
        : 0,
    }));

    // Perfect score tasks (100 quality score)
    const perfectScoreCount = await taskRepo
      .createQueryBuilder("task")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.qualityScore = 100")
      .getCount();

    // Zero-defect tasks (no type errors, no test failures, no security high)
    const zeroDefectCount = await taskRepo
      .createQueryBuilder("task")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.qualityScore IS NOT NULL")
      .andWhere("COALESCE(task.typeErrors, 0) = 0")
      .andWhere("COALESCE(task.testsFailed, 0) = 0")
      .andWhere("COALESCE(task.securityHigh, 0) = 0")
      .getCount();

    // Most improved (tasks with retry that improved quality)
    // This would require comparing task versions - simplified for now
    const totalTasksWithQuality = await taskRepo
      .createQueryBuilder("task")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.qualityScore IS NOT NULL")
      .getCount();

    res.json({
      success: true,
      range,
      leaderboard: {
        topTasks,
        personaLeaderboard,
      },
      achievements: {
        perfectScoreCount,
        zeroDefectCount,
        totalTasksWithQuality,
        perfectScoreRate: totalTasksWithQuality > 0
          ? Math.round((perfectScoreCount / totalTasksWithQuality) * 100)
          : 0,
        zeroDefectRate: totalTasksWithQuality > 0
          ? Math.round((zeroDefectCount / totalTasksWithQuality) * 100)
          : 0,
      },
    });
  } catch (error) {
    logger.error("Error fetching quality leaderboard", { error });
    res.status(500).json({ error: "Failed to fetch quality leaderboard" });
  }
});

/**
 * GET /api/analytics/quality-by-persona
 * Get quality issues breakdown by persona
 */
router.get("/quality-by-persona", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";

    // Calculate date range
    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Aggregate quality metrics by persona
    const personaStatsRaw = await taskRepo
      .createQueryBuilder("task")
      .select("task.persona", "persona")
      .addSelect("COUNT(*)", "taskCount")
      .addSelect("AVG(task.qualityScore)", "avgQualityScore")
      .addSelect("AVG(task.coverageLines)", "avgCoverage")
      .addSelect("SUM(COALESCE(task.lintErrors, 0))", "totalLintErrors")
      .addSelect("SUM(COALESCE(task.typeErrors, 0))", "totalTypeErrors")
      .addSelect("SUM(COALESCE(task.testsFailed, 0))", "totalTestFailures")
      .addSelect("SUM(COALESCE(task.securityHigh, 0))", "totalSecurityHigh")
      .addSelect("SUM(COALESCE(task.securityMedium, 0))", "totalSecurityMedium")
      .addSelect("AVG(task.lintErrors)", "avgLintErrors")
      .addSelect("AVG(task.typeErrors)", "avgTypeErrors")
      .addSelect("AVG(task.testsFailed)", "avgTestFailures")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.qualityScore IS NOT NULL")
      .andWhere("task.persona IS NOT NULL")
      .groupBy("task.persona")
      .orderBy("COUNT(*)", "DESC")
      .getRawMany();

    // Format persona stats
    const personaStats = personaStatsRaw.map((row) => {
      const totalIssues = parseInt(row.totalLintErrors) + parseInt(row.totalTypeErrors) +
        parseInt(row.totalTestFailures) + parseInt(row.totalSecurityHigh) + parseInt(row.totalSecurityMedium);

      // Calculate issue distribution for this persona
      const issueBreakdown = {
        lintErrors: {
          total: parseInt(row.totalLintErrors) || 0,
          average: row.avgLintErrors !== null ? Math.round(parseFloat(row.avgLintErrors) * 10) / 10 : 0,
          percentage: totalIssues > 0 ? Math.round((parseInt(row.totalLintErrors) / totalIssues) * 100) : 0,
        },
        typeErrors: {
          total: parseInt(row.totalTypeErrors) || 0,
          average: row.avgTypeErrors !== null ? Math.round(parseFloat(row.avgTypeErrors) * 10) / 10 : 0,
          percentage: totalIssues > 0 ? Math.round((parseInt(row.totalTypeErrors) / totalIssues) * 100) : 0,
        },
        testFailures: {
          total: parseInt(row.totalTestFailures) || 0,
          average: row.avgTestFailures !== null ? Math.round(parseFloat(row.avgTestFailures) * 10) / 10 : 0,
          percentage: totalIssues > 0 ? Math.round((parseInt(row.totalTestFailures) / totalIssues) * 100) : 0,
        },
        securityIssues: {
          total: parseInt(row.totalSecurityHigh) + parseInt(row.totalSecurityMedium) || 0,
          high: parseInt(row.totalSecurityHigh) || 0,
          medium: parseInt(row.totalSecurityMedium) || 0,
          percentage: totalIssues > 0 ? Math.round(((parseInt(row.totalSecurityHigh) + parseInt(row.totalSecurityMedium)) / totalIssues) * 100) : 0,
        },
      };

      // Identify primary issue type for this persona
      const issueTypes = [
        { type: "lintErrors", total: issueBreakdown.lintErrors.total },
        { type: "typeErrors", total: issueBreakdown.typeErrors.total },
        { type: "testFailures", total: issueBreakdown.testFailures.total },
        { type: "securityIssues", total: issueBreakdown.securityIssues.total },
      ].sort((a, b) => b.total - a.total);

      return {
        persona: row.persona,
        taskCount: parseInt(row.taskCount) || 0,
        avgQualityScore: row.avgQualityScore !== null ? Math.round(parseFloat(row.avgQualityScore)) : null,
        avgCoverage: row.avgCoverage !== null ? Math.round(parseFloat(row.avgCoverage) * 10) / 10 : null,
        totalIssues,
        primaryIssueType: issueTypes[0]?.type || null,
        issueBreakdown,
      };
    });

    // Calculate overall issue patterns
    const allIssues = {
      lintErrors: personaStats.reduce((sum, p) => sum + p.issueBreakdown.lintErrors.total, 0),
      typeErrors: personaStats.reduce((sum, p) => sum + p.issueBreakdown.typeErrors.total, 0),
      testFailures: personaStats.reduce((sum, p) => sum + p.issueBreakdown.testFailures.total, 0),
      securityIssues: personaStats.reduce((sum, p) => sum + p.issueBreakdown.securityIssues.total, 0),
    };

    // Find personas with specific issue tendencies
    const insights: string[] = [];
    for (const stats of personaStats) {
      if (stats.issueBreakdown.lintErrors.percentage > 50) {
        insights.push(`${stats.persona} has high lint error rate (${stats.issueBreakdown.lintErrors.percentage}%)`);
      }
      if (stats.issueBreakdown.typeErrors.percentage > 50) {
        insights.push(`${stats.persona} has high type error rate (${stats.issueBreakdown.typeErrors.percentage}%)`);
      }
      if (stats.issueBreakdown.securityIssues.percentage > 30) {
        insights.push(`${stats.persona} has elevated security issues (${stats.issueBreakdown.securityIssues.percentage}%)`);
      }
    }

    res.json({
      success: true,
      range,
      personaStats,
      overallIssueDistribution: allIssues,
      insights,
    });
  } catch (error) {
    logger.error("Error fetching quality by persona", { error });
    res.status(500).json({ error: "Failed to fetch quality by persona" });
  }
});

/**
 * GET /api/analytics/quality-trends
 * Get quality metrics trends over time for the organization
 */
router.get("/quality-trends", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";
    const granularity = (req.query.granularity as string) || "day"; // day or week

    // Calculate date range
    const days = range === "7d" ? 7 : range === "90d" ? 90 : range === "365d" ? 365 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Build aggregation query based on granularity
    const dateExpr = granularity === "week"
      ? "DATE_TRUNC('week', task.createdAt)"
      : "DATE(task.createdAt)";

    const trendsRaw = await taskRepo
      .createQueryBuilder("task")
      .select(dateExpr, "period")
      .addSelect("COUNT(*)", "taskCount")
      .addSelect("AVG(task.qualityScore)", "avgQualityScore")
      .addSelect("AVG(task.coverageLines)", "avgCoverage")
      .addSelect("SUM(COALESCE(task.securityHigh, 0))", "totalSecurityHigh")
      .addSelect("SUM(COALESCE(task.securityMedium, 0))", "totalSecurityMedium")
      .addSelect("SUM(COALESCE(task.securityLow, 0))", "totalSecurityLow")
      .addSelect("AVG(task.typeErrors)", "avgTypeErrors")
      .addSelect("AVG(task.testsFailed)", "avgTestFailures")
      .addSelect("COUNT(CASE WHEN task.qualityScore >= 80 THEN 1 END)", "highQualityTasks")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.qualityScore IS NOT NULL")
      .groupBy(dateExpr)
      .orderBy("period", "ASC")
      .getRawMany();

    // Format trends data
    const trends = trendsRaw.map((row) => {
      const periodDate = row.period instanceof Date
        ? row.period.toISOString().split("T")[0]
        : String(row.period).split("T")[0];

      return {
        period: periodDate,
        taskCount: parseInt(row.taskCount) || 0,
        avgQualityScore: row.avgQualityScore !== null ? Math.round(parseFloat(row.avgQualityScore)) : null,
        avgCoverage: row.avgCoverage !== null ? Math.round(parseFloat(row.avgCoverage) * 10) / 10 : null,
        totalSecurityHigh: parseInt(row.totalSecurityHigh) || 0,
        totalSecurityMedium: parseInt(row.totalSecurityMedium) || 0,
        totalSecurityLow: parseInt(row.totalSecurityLow) || 0,
        avgTypeErrors: row.avgTypeErrors !== null ? Math.round(parseFloat(row.avgTypeErrors) * 10) / 10 : null,
        avgTestFailures: row.avgTestFailures !== null ? Math.round(parseFloat(row.avgTestFailures) * 10) / 10 : null,
        highQualityTasks: parseInt(row.highQualityTasks) || 0,
      };
    });

    // Calculate overall summary
    const summary = {
      totalTasks: trends.reduce((sum, t) => sum + t.taskCount, 0),
      avgQualityScore: trends.length > 0
        ? Math.round(trends.reduce((sum, t) => sum + (t.avgQualityScore || 0), 0) / trends.filter((t) => t.avgQualityScore !== null).length)
        : null,
      avgCoverage: trends.length > 0
        ? Math.round(trends.reduce((sum, t) => sum + (t.avgCoverage || 0), 0) / trends.filter((t) => t.avgCoverage !== null).length * 10) / 10
        : null,
      totalVulnerabilities: {
        high: trends.reduce((sum, t) => sum + t.totalSecurityHigh, 0),
        medium: trends.reduce((sum, t) => sum + t.totalSecurityMedium, 0),
        low: trends.reduce((sum, t) => sum + t.totalSecurityLow, 0),
      },
      highQualityRate: trends.length > 0
        ? Math.round((trends.reduce((sum, t) => sum + t.highQualityTasks, 0) / trends.reduce((sum, t) => sum + t.taskCount, 0)) * 100)
        : 0,
    };

    // Calculate trend direction (comparing first half vs second half of period)
    const midpoint = Math.floor(trends.length / 2);
    const firstHalf = trends.slice(0, midpoint);
    const secondHalf = trends.slice(midpoint);

    const getAvg = (arr: typeof trends, key: keyof typeof trends[0]) => {
      const validItems = arr.filter((t) => t[key] !== null);
      if (validItems.length === 0) return null;
      return validItems.reduce((sum, t) => sum + (Number(t[key]) || 0), 0) / validItems.length;
    };

    const trendDirection = {
      qualityScore: (() => {
        const first = getAvg(firstHalf, "avgQualityScore");
        const second = getAvg(secondHalf, "avgQualityScore");
        if (first === null || second === null) return "stable";
        return second > first ? "improving" : second < first ? "declining" : "stable";
      })(),
      coverage: (() => {
        const first = getAvg(firstHalf, "avgCoverage");
        const second = getAvg(secondHalf, "avgCoverage");
        if (first === null || second === null) return "stable";
        return second > first ? "improving" : second < first ? "declining" : "stable";
      })(),
      vulnerabilities: (() => {
        const firstVulns = firstHalf.reduce((sum, t) => sum + t.totalSecurityHigh + t.totalSecurityMedium, 0);
        const secondVulns = secondHalf.reduce((sum, t) => sum + t.totalSecurityHigh + t.totalSecurityMedium, 0);
        // Lower is better for vulnerabilities
        return secondVulns < firstVulns ? "improving" : secondVulns > firstVulns ? "declining" : "stable";
      })(),
    };

    res.json({
      success: true,
      range,
      granularity,
      trends,
      summary,
      trendDirection,
    });
  } catch (error) {
    logger.error("Error fetching quality trends", { error });
    res.status(500).json({ error: "Failed to fetch quality trends" });
  }
});

/**
 * GET /api/analytics/auto-fix-stats
 * Get auto-fix success rate statistics for the organization
 */
router.get("/auto-fix-stats", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;

    const rawStats = org.autoFixStats || {};
    const stats = {
      totalAttempts: rawStats.totalAttempts ?? 0,
      successfulFixes: rawStats.successfulFixes ?? 0,
      failedFixes: rawStats.failedFixes ?? 0,
      fixesByType: rawStats.fixesByType ?? {},
      lastUpdated: rawStats.lastUpdated ?? null,
    };

    // Calculate success rate
    const successRate = stats.totalAttempts > 0
      ? Math.round((stats.successfulFixes / stats.totalAttempts) * 100)
      : 0;

    // Calculate per-type success rates
    const typeStats: Record<string, { attempts: number; successes: number; successRate: number }> = {};
    if (stats.fixesByType) {
      for (const [type, data] of Object.entries(stats.fixesByType)) {
        typeStats[type] = {
          attempts: data.attempts,
          successes: data.successes,
          successRate: data.attempts > 0 ? Math.round((data.successes / data.attempts) * 100) : 0,
        };
      }
    }

    res.json({
      success: true,
      stats: {
        totalAttempts: stats.totalAttempts || 0,
        successfulFixes: stats.successfulFixes || 0,
        failedFixes: stats.failedFixes || 0,
        successRate,
        fixesByType: typeStats,
        lastUpdated: stats.lastUpdated || null,
      },
    });
  } catch (error) {
    logger.error("Error fetching auto-fix stats", { error });
    res.status(500).json({ error: "Failed to fetch auto-fix stats" });
  }
});

/**
 * POST /api/analytics/auto-fix-stats
 * Update auto-fix statistics after a fix run (called by worker)
 */
router.post("/auto-fix-stats", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const { totalAttempts, successfulFixes, failedFixes, fixesByType } = req.body;

    // Validate input
    if (typeof totalAttempts !== "number" || typeof successfulFixes !== "number" || typeof failedFixes !== "number") {
      res.status(400).json({ error: "Invalid stats format" });
      return;
    }

    // Merge with existing stats
    const existingStats = org.autoFixStats || {
      totalAttempts: 0,
      successfulFixes: 0,
      failedFixes: 0,
      fixesByType: {},
    };

    const updatedStats = {
      totalAttempts: (existingStats.totalAttempts || 0) + totalAttempts,
      successfulFixes: (existingStats.successfulFixes || 0) + successfulFixes,
      failedFixes: (existingStats.failedFixes || 0) + failedFixes,
      fixesByType: { ...existingStats.fixesByType },
      lastUpdated: new Date().toISOString(),
    };

    // Merge fixesByType
    if (fixesByType && typeof fixesByType === "object") {
      for (const [type, data] of Object.entries(fixesByType)) {
        const typeData = data as { attempts: number; successes: number };
        if (!updatedStats.fixesByType[type]) {
          updatedStats.fixesByType[type] = { attempts: 0, successes: 0 };
        }
        updatedStats.fixesByType[type].attempts += typeData.attempts || 0;
        updatedStats.fixesByType[type].successes += typeData.successes || 0;
      }
    }

    // Save updated stats
    const orgRepo = AppDataSource.getRepository("Organization");
    await orgRepo.update(org.id, { autoFixStats: updatedStats });

    res.json({
      success: true,
      stats: updatedStats,
    });
  } catch (error) {
    logger.error("Error updating auto-fix stats", { error });
    res.status(500).json({ error: "Failed to update auto-fix stats" });
  }
});

export default router;
