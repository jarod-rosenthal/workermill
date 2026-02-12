/**
 * WorkerMill Analytics - Complexity Routes
 *
 * Complexity-cost, classify-complexity, complexity-tiers, estimate-cost
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask } from "../../models/WorkerTask.js";
import { logger } from "../../utils/logger.js";
import { classifyComplexity, getTierDescription, type ComplexityTier } from "../../services/complexity-classifier.js";
import { fetchJiraIssue } from "../../utils/jira.js";

const router = Router();

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

export default router;
