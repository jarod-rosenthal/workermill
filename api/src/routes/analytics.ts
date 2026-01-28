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
    let totalPrdTasks = prdTasks.length;
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
 * Get worker effectiveness and accuracy metrics based on human reviews
 *
 * Provides:
 * - Overall acceptance rate and average accuracy
 * - Breakdown by model/persona
 * - Trend over time
 * - List of tasks pending review
 */
router.get("/effectiveness", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";

    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Get reviewed tasks in time range
    const reviewedTasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.reviewedAt IS NOT NULL")
      .andWhere("task.reviewedAt >= :startDate", { startDate })
      .getMany();

    // Calculate summary metrics
    const reviewed = reviewedTasks.length;
    const accepted = reviewedTasks.filter((t) => t.reviewOutcome === "accepted").length;
    const partial = reviewedTasks.filter((t) => t.reviewOutcome === "partial").length;
    const rejected = reviewedTasks.filter((t) => t.reviewOutcome === "rejected").length;

    // Calculate average accuracy (only for tasks with scores)
    const tasksWithScores = reviewedTasks.filter((t) => t.accuracyScore !== null);
    const avgAccuracy = tasksWithScores.length > 0
      ? tasksWithScores.reduce((sum, t) => sum + (t.accuracyScore || 0), 0) / tasksWithScores.length
      : 0;

    // Group by model
    const byModelMap = new Map<string, { count: number; accepted: number; scores: number[] }>();
    for (const task of reviewedTasks) {
      const model = task.workerModel || "unknown";
      const existing = byModelMap.get(model) || { count: 0, accepted: 0, scores: [] };
      existing.count++;
      if (task.reviewOutcome === "accepted") existing.accepted++;
      if (task.accuracyScore !== null) existing.scores.push(task.accuracyScore);
      byModelMap.set(model, existing);
    }

    const byModel = Array.from(byModelMap.entries())
      .map(([model, data]) => ({
        model,
        count: data.count,
        acceptRate: data.count > 0 ? Math.round((data.accepted / data.count) * 100) / 100 : 0,
        avgAccuracy: data.scores.length > 0
          ? Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length)
          : null,
      }))
      .sort((a, b) => b.count - a.count);

    // Group by persona
    const byPersonaMap = new Map<string, { count: number; accepted: number; scores: number[] }>();
    for (const task of reviewedTasks) {
      const persona = task.workerPersona || "unknown";
      const existing = byPersonaMap.get(persona) || { count: 0, accepted: 0, scores: [] };
      existing.count++;
      if (task.reviewOutcome === "accepted") existing.accepted++;
      if (task.accuracyScore !== null) existing.scores.push(task.accuracyScore);
      byPersonaMap.set(persona, existing);
    }

    const byPersona = Array.from(byPersonaMap.entries())
      .map(([persona, data]) => ({
        persona,
        count: data.count,
        acceptRate: data.count > 0 ? Math.round((data.accepted / data.count) * 100) / 100 : 0,
        avgAccuracy: data.scores.length > 0
          ? Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length)
          : null,
      }))
      .sort((a, b) => b.count - a.count);

    // Calculate daily/weekly trend
    const trendMap = new Map<string, { accepted: number; partial: number; rejected: number; total: number }>();

    // Determine bucket size based on range
    const useDailyBuckets = days <= 30;

    for (const task of reviewedTasks) {
      const reviewDate = task.reviewedAt!;
      let bucketKey: string;

      if (useDailyBuckets) {
        bucketKey = reviewDate.toISOString().split("T")[0];
      } else {
        // Weekly buckets
        const weekStart = new Date(reviewDate);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        bucketKey = weekStart.toISOString().split("T")[0];
      }

      const existing = trendMap.get(bucketKey) || { accepted: 0, partial: 0, rejected: 0, total: 0 };
      existing.total++;
      if (task.reviewOutcome === "accepted") existing.accepted++;
      else if (task.reviewOutcome === "partial") existing.partial++;
      else if (task.reviewOutcome === "rejected") existing.rejected++;
      trendMap.set(bucketKey, existing);
    }

    const trend = Array.from(trendMap.entries())
      .map(([date, data]) => ({
        date,
        ...data,
        acceptRate: data.total > 0 ? Math.round((data.accepted / data.total) * 100) : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Get tasks pending review (completed/deployed but not yet reviewed)
    const pendingReviewTasks = await taskRepo
      .createQueryBuilder("task")
      .select([
        "task.id",
        "task.jiraIssueKey",
        "task.summary",
        "task.status",
        "task.workerModel",
        "task.workerPersona",
        "task.completedAt",
        "task.githubPrUrl",
      ])
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.status IN (:...statuses)", { statuses: ["completed", "deployed"] })
      .andWhere("task.reviewOutcome IS NULL")
      .andWhere("task.completedAt >= :startDate", { startDate })
      .orderBy("task.completedAt", "DESC")
      .take(20)
      .getMany();

    const unreviewedTasks = pendingReviewTasks.map((t) => ({
      id: t.id,
      jiraIssueKey: t.jiraIssueKey,
      summary: t.summary,
      status: t.status,
      workerModel: t.workerModel,
      workerPersona: t.workerPersona,
      completedAt: t.completedAt,
      githubPrUrl: t.githubPrUrl,
    }));

    res.json({
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      summary: {
        reviewed,
        accepted,
        partial,
        rejected,
        acceptRate: reviewed > 0 ? Math.round((accepted / reviewed) * 100) / 100 : 0,
        avgAccuracy: Math.round(avgAccuracy),
      },
      byModel,
      byPersona,
      trend,
      pendingReview: unreviewedTasks.length,
      unreviewedTasks,
    });
  } catch (error) {
    logger.error("Error fetching effectiveness analytics", { error });
    res.status(500).json({ error: "Failed to fetch effectiveness analytics" });
  }
});

export default router;
