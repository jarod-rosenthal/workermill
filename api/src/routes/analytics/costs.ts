/**
 * WorkerMill Analytics - Cost Routes
 *
 * Costs, token-usage, budget-status, roi, action-costs, cost-comparison,
 * cost-simulation, cost-anomalies, cost-report
 */

import { Router, Request, Response } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask } from "../../models/WorkerTask.js";
import { WorkerTaskTokenUsage } from "../../models/WorkerTaskTokenUsage.js";
import { logger } from "../../utils/logger.js";

const router = Router();

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
 * GET /api/analytics/budget-status
 * Get current budget status including spending vs limits
 */
router.get("/budget-status", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;

    // Import budget enforcement service
    const { getBudgetStatusWithProjections, isBudgetOverrideActive } = await import("../../services/budget-enforcement.js");

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

    const { WorkerTaskTokenUsage } = await import("../../models/WorkerTaskTokenUsage.js");
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

    const { WorkerTask } = await import("../../models/WorkerTask.js");
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
      // Claude Sonnet 4.6 - $3.00/$15.00 per MTok
      "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
      // Claude Sonnet 4.5 (legacy) - $3.00/$15.00 per MTok
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
    const { WorkerTask } = await import("../../models/WorkerTask.js");
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

    const { WorkerTask } = await import("../../models/WorkerTask.js");
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

    const { WorkerTask } = await import("../../models/WorkerTask.js");
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

export default router;
