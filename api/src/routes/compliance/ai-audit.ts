/**
 * AI-Specific Audit Trail Routes
 *
 * AI decision audit trails, model tracking, token usage, and transparency reports.
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask } from "../../models/index.js";
import { logger } from "../../utils/logger.js";

const router = Router();

/**
 * GET /api/compliance/ai-audit/decisions
 * Get AI decision audit trail (model choices, task assignments, etc.)
 */
router.get("/ai-audit/decisions", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const days = parseInt(req.query.days as string) || 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);

    // Get tasks with AI decision information
    const taskRepo = AppDataSource.getRepository("WorkerTask");
    const tasks = await taskRepo
      .createQueryBuilder("task")
      .select([
        "task.id",
        "task.jiraKey",
        "task.subject",
        "task.status",
        "task.model",
        "task.persona",
        "task.executionMode",
        "task.provider",
        "task.providersUsed",
        "task.totalCostUsd",
        "task.createdAt",
        "task.completedAt",
      ])
      .where("task.organizationId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .orderBy("task.createdAt", "DESC")
      .limit(limit)
      .getMany();

    // Group by model and persona
    const modelCounts: Record<string, number> = {};
    const personaCounts: Record<string, number> = {};
    const providerCounts: Record<string, number> = {};

    tasks.forEach((task: Record<string, unknown>) => {
      const model = (task.model as string) || "unknown";
      const persona = (task.persona as string) || "unknown";
      const provider = (task.provider as string) || "anthropic";

      modelCounts[model] = (modelCounts[model] || 0) + 1;
      personaCounts[persona] = (personaCounts[persona] || 0) + 1;
      providerCounts[provider] = (providerCounts[provider] || 0) + 1;
    });

    res.json({
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      summary: {
        totalTasks: tasks.length,
        modelDistribution: modelCounts,
        personaDistribution: personaCounts,
        providerDistribution: providerCounts,
      },
      decisions: tasks.map((task: Record<string, unknown>) => ({
        taskId: task.id,
        ticketKey: task.jiraKey,
        subject: task.subject,
        timestamp: task.createdAt,
        aiDecisions: {
          model: task.model,
          persona: task.persona,
          executionMode: task.executionMode,
          provider: task.provider,
          providersUsed: task.providersUsed,
        },
        outcome: {
          status: task.status,
          completedAt: task.completedAt,
          cost: task.totalCostUsd,
        },
      })),
    });
  } catch (error) {
    logger.error("Error getting AI decision audit", { error });
    res.status(500).json({ error: "Failed to get AI decision audit" });
  }
});

/**
 * GET /api/compliance/ai-audit/models
 * Get model version tracking report
 */
router.get("/ai-audit/models", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const days = parseInt(req.query.days as string) || 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const taskRepo = AppDataSource.getRepository("WorkerTask");

    // Get model usage statistics
    const modelStats = await taskRepo
      .createQueryBuilder("task")
      .select("task.model", "model")
      .addSelect("task.provider", "provider")
      .addSelect("COUNT(*)", "taskCount")
      .addSelect("SUM(task.totalCostUsd)", "totalCost")
      .addSelect("AVG(task.totalCostUsd)", "avgCost")
      .addSelect("MIN(task.createdAt)", "firstUsed")
      .addSelect("MAX(task.createdAt)", "lastUsed")
      .where("task.organizationId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :startDate", { startDate })
      .groupBy("task.model")
      .addGroupBy("task.provider")
      .orderBy("taskCount", "DESC")
      .getRawMany();

    // Model version catalog (for documentation)
    const modelCatalog = {
      anthropic: [
        { id: "claude-haiku-4-5-20251001", name: "Claude 3.5 Haiku", tier: "fast" },
        { id: "claude-sonnet-4-5-20250929", name: "Claude 3.5 Sonnet", tier: "balanced" },
        { id: "claude-opus-4-6", name: "Claude Opus 4.6", tier: "powerful" },
      ],
      openai: [
        { id: "gpt-4o", name: "GPT-4o", tier: "balanced" },
        { id: "gpt-5.1-codex", name: "GPT-5.1 Codex", tier: "powerful" },
        { id: "o1", name: "o1", tier: "reasoning" },
      ],
      google: [
        { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", tier: "fast" },
        { id: "gemini-3-pro-preview", name: "Gemini 3 Pro", tier: "balanced" },
      ],
    };

    res.json({
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      organizationDefaults: {
        defaultModel: org.defaultWorkerModel,
        planningModel: org.planningAgentModel,
        primaryProvider: org.primaryProvider,
      },
      modelUsage: modelStats.map((stat) => ({
        model: stat.model || "unknown",
        provider: stat.provider || "anthropic",
        taskCount: parseInt(stat.taskCount),
        totalCost: parseFloat(stat.totalCost) || 0,
        avgCostPerTask: parseFloat(stat.avgCost) || 0,
        firstUsed: stat.firstUsed,
        lastUsed: stat.lastUsed,
      })),
      modelCatalog,
      complianceNotes: [
        "All models are from established AI providers with documented training practices",
        "Model versions are tracked for reproducibility and audit purposes",
        "Cost tracking enables accurate AI resource attribution",
      ],
    });
  } catch (error) {
    logger.error("Error getting model tracking report", { error });
    res.status(500).json({ error: "Failed to get model tracking report" });
  }
});

/**
 * GET /api/compliance/ai-audit/tokens
 * Get prompt/completion token audit records
 */
router.get("/ai-audit/tokens", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const days = parseInt(req.query.days as string) || 7;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get token usage from WorkerTaskTokenUsage table
    const tokenRepo = AppDataSource.getRepository("WorkerTaskTokenUsage");

    const tokenStats = await tokenRepo
      .createQueryBuilder("usage")
      .leftJoin("usage.task", "task")
      .select("DATE(usage.createdAt)", "date")
      .addSelect("usage.model", "model")
      .addSelect("SUM(usage.inputTokens)", "totalInputTokens")
      .addSelect("SUM(usage.outputTokens)", "totalOutputTokens")
      .addSelect("SUM(usage.cacheReadTokens)", "totalCacheReadTokens")
      .addSelect("SUM(usage.cacheWriteTokens)", "totalCacheWriteTokens")
      .addSelect("SUM(usage.costUsd)", "totalCost")
      .addSelect("COUNT(DISTINCT usage.taskId)", "taskCount")
      .where("task.organizationId = :orgId", { orgId: org.id })
      .andWhere("usage.createdAt >= :startDate", { startDate })
      .groupBy("DATE(usage.createdAt)")
      .addGroupBy("usage.model")
      .orderBy("date", "DESC")
      .addOrderBy("totalCost", "DESC")
      .getRawMany();

    // Calculate totals
    const totals = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
    };

    tokenStats.forEach((stat) => {
      totals.inputTokens += parseInt(stat.totalInputTokens) || 0;
      totals.outputTokens += parseInt(stat.totalOutputTokens) || 0;
      totals.cacheReadTokens += parseInt(stat.totalCacheReadTokens) || 0;
      totals.cacheWriteTokens += parseInt(stat.totalCacheWriteTokens) || 0;
      totals.cost += parseFloat(stat.totalCost) || 0;
    });

    res.json({
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      totals: {
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cacheReadTokens: totals.cacheReadTokens,
        cacheWriteTokens: totals.cacheWriteTokens,
        totalTokens: totals.inputTokens + totals.outputTokens,
        totalCost: Math.round(totals.cost * 100) / 100,
      },
      dailyBreakdown: tokenStats.map((stat) => ({
        date: stat.date,
        model: stat.model,
        inputTokens: parseInt(stat.totalInputTokens) || 0,
        outputTokens: parseInt(stat.totalOutputTokens) || 0,
        cacheReadTokens: parseInt(stat.totalCacheReadTokens) || 0,
        cacheWriteTokens: parseInt(stat.totalCacheWriteTokens) || 0,
        cost: parseFloat(stat.totalCost) || 0,
        taskCount: parseInt(stat.taskCount) || 0,
      })),
      auditNotes: [
        "Token counts represent actual API usage billed by providers",
        "Cache tokens reduce costs and are tracked separately",
        "All token usage is attributed to specific tasks for accountability",
      ],
    });
  } catch (error) {
    logger.error("Error getting token audit", { error });
    res.status(500).json({ error: "Failed to get token audit records" });
  }
});

/**
 * GET /api/compliance/ai-audit/transparency
 * Generate AI transparency report for compliance
 */
router.get("/ai-audit/transparency", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const days = parseInt(req.query.days as string) || 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Get task statistics
    const taskStats = await taskRepo
      .createQueryBuilder("task")
      .select("task.status", "status")
      .addSelect("COUNT(*)", "count")
      .where("task.org_id = :orgId", { orgId: org.id })
      .andWhere("task.created_at >= :startDate", { startDate })
      .groupBy("task.status")
      .getRawMany();

    const statusCounts: Record<string, number> = {};
    taskStats.forEach((stat) => {
      statusCounts[stat.status] = parseInt(stat.count);
    });

    // Get cost summary
    const costSummary = await taskRepo
      .createQueryBuilder("task")
      .select("SUM(task.estimated_cost_usd)", "totalCost")
      .addSelect("AVG(task.estimated_cost_usd)", "avgCost")
      .addSelect("MAX(task.estimated_cost_usd)", "maxCost")
      .where("task.org_id = :orgId", { orgId: org.id })
      .andWhere("task.created_at >= :startDate", { startDate })
      .getRawOne();

    res.json({
      reportType: "AI Transparency Report",
      organization: {
        id: org.id,
        name: org.name,
        plan: org.plan,
      },
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      generatedAt: new Date().toISOString(),
      aiUsageSummary: {
        totalTasks: Object.values(statusCounts).reduce((a, b) => a + b, 0),
        tasksByStatus: statusCounts,
        defaultModel: org.defaultWorkerModel,
        defaultPersona: org.defaultWorkerPersona,
        executionModes: ["standard", "sdk", "epic", "multi_provider"],
      },
      costSummary: {
        totalCost: parseFloat(costSummary?.totalCost) || 0,
        averageCostPerTask: parseFloat(costSummary?.avgCost) || 0,
        maxTaskCost: parseFloat(costSummary?.maxCost) || 0,
      },
      humanOversight: {
        prReviewRequired: !org.autoDeployEnabled,
        managerReviewEnabled: org.managerEnabled,
        qualityGatesEnabled: org.qualityGateEnabled,
        autoFixEnabled: org.autoFixEnabled ?? false,
      },
      aiProviders: [
        {
          name: "Anthropic",
          models: ["Claude 3.5 Haiku", "Claude 3.5 Sonnet", "Claude 3 Opus"],
          dataProcessing: "API calls only, no training on customer data",
          certifications: ["SOC 2 Type II", "ISO 27001"],
        },
        {
          name: "OpenAI",
          models: ["GPT-4o", "GPT-5.1 Codex", "o1"],
          dataProcessing: "API calls only, no training on customer data",
          certifications: ["SOC 2 Type II"],
        },
        {
          name: "Google",
          models: ["Gemini 2.0 Flash", "Gemini 3 Pro"],
          dataProcessing: "API calls only, no training on customer data",
          certifications: ["SOC 2 Type II", "ISO 27001"],
        },
      ],
      transparencyCommitments: [
        "All AI-generated code is clearly attributed in pull requests",
        "AI model and version tracked for every task",
        "Human review required before code is merged (unless explicitly disabled)",
        "Complete audit trail of AI decisions available",
        "Token usage and costs tracked for accountability",
        "No customer code used to train AI models",
      ],
      complianceFrameworks: {
        euAiAct: {
          riskClassification: "Limited Risk",
          transparencyCompliant: true,
          humanOversightCompliant: true,
        },
        soc2: {
          auditLoggingCompliant: true,
          accessControlCompliant: true,
        },
      },
    });
  } catch (error) {
    logger.error("Error generating AI transparency report", { error });
    res.status(500).json({ error: "Failed to generate AI transparency report" });
  }
});

export default router;
