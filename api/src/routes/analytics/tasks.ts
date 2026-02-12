/**
 * WorkerMill Analytics - Task Routes
 *
 * Task stats, workers, effectiveness, failures, review-metrics, support-agent, prd-metrics
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask } from "../../models/WorkerTask.js";
import { logger } from "../../utils/logger.js";

const router = Router();

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
 * - PR Acceptance Rate: review_requested -> deployed (via GitHub webhook approval)
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

    const byPersonaResult = byPersonaRaw.map((row) => {
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

    const byModelResult = byModelRaw.map((row) => {
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
      byPersona: byPersonaResult,
      byModel: byModelResult,
    });
  } catch (error) {
    logger.error("Error fetching review metrics", { error });
    res.status(500).json({ error: "Failed to fetch review metrics" });
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

export default router;
