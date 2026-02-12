/**
 * WorkerMill Analytics - Quality Routes
 *
 * Code-quality, quality-export, quality-leaderboard, quality-by-persona,
 * quality-trends, auto-fix-stats, planner-critic
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask } from "../../models/WorkerTask.js";
import { logger } from "../../utils/logger.js";

const router = Router();

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

/**
 * GET /api/analytics/planner-critic
 * Planner-Critic validation metrics -- tracks plan quality across iterations.
 */
router.get("/planner-critic", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const range = (req.query.range as string) || "30d";

    const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Fetch tasks with execution_plan_v2 that have a criticScore
    const tasks = await taskRepo
      .createQueryBuilder("task")
      .select([
        "task.id",
        "task.summary",
        "task.createdAt",
        "task.status",
        "task.executionPlanV2",
      ])
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .andWhere("task.executionPlanV2 IS NOT NULL")
      .orderBy("task.createdAt", "DESC")
      .getMany();

    // Extract critic data from each task's executionPlanV2
    interface CriticData {
      taskId: string;
      summary: string | null;
      createdAt: Date;
      criticScore: number;
      criticRisks: string[];
      iterationCount: number;
      storyCount: number;
      fileCapTruncations: number;
      criticHistory: Array<{
        iteration: number;
        score: number;
        approved: boolean;
        risks: string[];
        suggestions?: string[];
        filesCapApplied?: number;
      }>;
      planningDurationMs: number | null;
    }

    const criticDataList: CriticData[] = [];

    for (const task of tasks) {
      const plan = task.executionPlanV2 as Record<string, unknown> | null;
      if (!plan || typeof plan.criticScore !== "number") continue;

      const metadata = (plan.metadata || {}) as Record<string, unknown>;
      const steps = Array.isArray(plan.steps) ? plan.steps : [];
      const criticHistory = Array.isArray(metadata.criticHistory) ? metadata.criticHistory as CriticData["criticHistory"] : [];

      criticDataList.push({
        taskId: task.id,
        summary: task.summary,
        createdAt: task.createdAt,
        criticScore: plan.criticScore as number,
        criticRisks: Array.isArray(plan.criticRisks) ? plan.criticRisks as string[] : [],
        iterationCount: typeof metadata.iterationCount === "number" ? metadata.iterationCount : (criticHistory.length || 1),
        storyCount: steps.length,
        fileCapTruncations: typeof metadata.fileCapTruncations === "number" ? metadata.fileCapTruncations as number : 0,
        criticHistory,
        planningDurationMs: typeof metadata.planningDurationMs === "number" ? metadata.planningDurationMs as number : null,
      });
    }

    const totalPlans = criticDataList.length;
    if (totalPlans === 0) {
      res.json({
        summary: {
          totalPlans: 0,
          avgCriticScore: 0,
          avgIterations: 0,
          firstAttemptApprovalRate: 0,
          fileCapHitRate: 0,
        },
        scoreDistribution: [],
        iterationBreakdown: [],
        recentPlans: [],
        commonRisks: [],
        trend: [],
      });
      return;
    }

    // Summary
    const totalScore = criticDataList.reduce((sum, d) => sum + d.criticScore, 0);
    const totalIterations = criticDataList.reduce((sum, d) => sum + d.iterationCount, 0);
    const firstAttemptApprovals = criticDataList.filter((d) => d.iterationCount === 1 && d.criticScore >= 85).length;
    const fileCapHits = criticDataList.filter((d) => d.fileCapTruncations > 0).length;

    const summary = {
      totalPlans,
      avgCriticScore: Math.round((totalScore / totalPlans) * 10) / 10,
      avgIterations: Math.round((totalIterations / totalPlans) * 10) / 10,
      firstAttemptApprovalRate: Math.round((firstAttemptApprovals / totalPlans) * 100),
      fileCapHitRate: Math.round((fileCapHits / totalPlans) * 100),
    };

    // Score distribution buckets
    const buckets = [
      { label: "0-49", min: 0, max: 49, count: 0 },
      { label: "50-74", min: 50, max: 74, count: 0 },
      { label: "75-84", min: 75, max: 84, count: 0 },
      { label: "85-89", min: 85, max: 89, count: 0 },
      { label: "90-100", min: 90, max: 100, count: 0 },
    ];
    for (const d of criticDataList) {
      const bucket = buckets.find((b) => d.criticScore >= b.min && d.criticScore <= b.max);
      if (bucket) bucket.count++;
    }
    const scoreDistribution = buckets.map((b) => ({
      range: b.label,
      count: b.count,
      percentage: Math.round((b.count / totalPlans) * 100),
    }));

    // Iteration breakdown
    const iterationCounts: Record<number, number> = {};
    for (const d of criticDataList) {
      iterationCounts[d.iterationCount] = (iterationCounts[d.iterationCount] || 0) + 1;
    }
    const iterationBreakdown = Object.entries(iterationCounts)
      .map(([iterations, count]) => ({
        iterations: parseInt(iterations),
        count,
        percentage: Math.round((count / totalPlans) * 100),
      }))
      .sort((a, b) => a.iterations - b.iterations);

    // Recent plans (last 10)
    const recentPlans = criticDataList.slice(0, 10).map((d) => ({
      taskId: d.taskId,
      summary: d.summary?.substring(0, 80) || "Untitled",
      criticScore: d.criticScore,
      iterations: d.iterationCount,
      storyCount: d.storyCount,
      fileCapTruncations: d.fileCapTruncations,
      planningDurationMs: d.planningDurationMs,
      createdAt: d.createdAt,
    }));

    // Common risks (top 10)
    const riskCounts: Record<string, number> = {};
    for (const d of criticDataList) {
      for (const risk of d.criticRisks) {
        riskCounts[risk] = (riskCounts[risk] || 0) + 1;
      }
      for (const entry of d.criticHistory) {
        for (const risk of entry.risks) {
          riskCounts[risk] = (riskCounts[risk] || 0) + 1;
        }
      }
    }
    const commonRisks = Object.entries(riskCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([risk, count]) => ({ risk, count }));

    // Weekly trend
    const weeklyBuckets: Record<string, { scores: number[]; iterations: number[] }> = {};
    for (const d of criticDataList) {
      const date = new Date(d.createdAt);
      // Round to start of week (Monday)
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(date);
      weekStart.setDate(diff);
      const weekKey = weekStart.toISOString().split("T")[0];

      if (!weeklyBuckets[weekKey]) {
        weeklyBuckets[weekKey] = { scores: [], iterations: [] };
      }
      weeklyBuckets[weekKey].scores.push(d.criticScore);
      weeklyBuckets[weekKey].iterations.push(d.iterationCount);
    }
    const trend = Object.entries(weeklyBuckets)
      .map(([week, data]) => ({
        week,
        planCount: data.scores.length,
        avgScore: Math.round((data.scores.reduce((a, b) => a + b, 0) / data.scores.length) * 10) / 10,
        avgIterations: Math.round((data.iterations.reduce((a, b) => a + b, 0) / data.iterations.length) * 10) / 10,
      }))
      .sort((a, b) => a.week.localeCompare(b.week));

    res.json({
      summary,
      scoreDistribution,
      iterationBreakdown,
      recentPlans,
      commonRisks,
      trend,
    });
  } catch (error) {
    logger.error("Error fetching planner-critic analytics", { error });
    res.status(500).json({ error: "Failed to fetch planner-critic analytics" });
  }
});

export default router;
