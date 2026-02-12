/**
 * WorkerMill Analytics - Efficiency Routes
 *
 * Efficiency-scores, wasteful-patterns, business-outcomes, time-saved
 */

import { Router, Request, Response } from "express";
import { In } from "typeorm";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask } from "../../models/WorkerTask.js";
import { logger } from "../../utils/logger.js";

const router = Router();

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

    const { WorkerTask } = await import("../../models/WorkerTask.js");
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

      // Cost efficiency (+/-30 points)
      if (task.estimatedCostUsd && avgCost > 0) {
        const costRatio = task.estimatedCostUsd / avgCost;
        if (costRatio <= 0.5) score += 30; // Much cheaper than average
        else if (costRatio <= 0.75) score += 20;
        else if (costRatio <= 1.0) score += 10;
        else if (costRatio <= 1.25) score -= 5;
        else if (costRatio <= 1.5) score -= 15;
        else score -= 30; // Much more expensive
      }

      // Success/failure (+/-20 points)
      if (task.status === "completed" || task.status === "deployed") {
        score += 20;
      } else if (task.status === "failed") {
        score -= 20;
      }

      // PR created (+10 points)
      if (task.githubPrUrl) {
        score += 10;
      }

      // Execution time efficiency (+/-5 points)
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

    const { WorkerTask } = await import("../../models/WorkerTask.js");
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
        calculation: "For each task, we use the higher of: (1) complexity-based estimate, or (2) lines-changed \u00F7 75 lines/hour. This provides a conservative estimate that accounts for both task scope and actual code volume.",
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

export default router;
