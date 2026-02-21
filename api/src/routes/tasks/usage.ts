import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask, WorkerTaskTokenUsage, type TokenUsagePhase, type TokenUsageOperationType } from "../../models/index.js";
import { authenticateRequest, authenticateApiKey } from "../../middleware/auth.js";
import { getCostTracker } from "../../services/cost-tracker.js";
import { logger } from "../../utils/logger.js";
import { body, param, validateRequest } from "../../middleware/validation.js";
import { costEvents } from "../../services/cost-events.js";

const router = Router();

// All routes require authentication (matches original global router.use(authenticateRequest))
router.use(authenticateRequest);

/**
 * POST /api/tasks/:id/usage
 * Report token usage from worker (called by log-parser.cjs during execution)
 * Uses API key authentication (x-api-key header)
 *
 * IMPORTANT: This endpoint matches oncallshift's /api/v1/ai-worker-tasks/:id/usage
 * - Uses idempotency check via usageReportedAt
 * - Sets tokens directly (not additive) - log-parser already uses Math.max()
 * - Calculates cost immediately
 * - Updates org cumulative cost
 */
router.post(
  "/:id/usage",
  authenticateApiKey,
  param("id").isUUID().withMessage("id must be a valid UUID"),
  body("model").optional().isString(),
  body("inputTokens").optional().isInt({ min: 0 }).withMessage("inputTokens must be a non-negative integer"),
  body("outputTokens").optional().isInt({ min: 0 }).withMessage("outputTokens must be a non-negative integer"),
  body("cacheCreationTokens").optional().isInt({ min: 0 }),
  body("cacheReadTokens").optional().isInt({ min: 0 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const taskId = req.params.id as string;
      const org = req.organization!;
      const {
        model,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
      } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    // Support platform tasks: check both orgId and billingOrgId
    const task = await taskRepo.findOne({
      where: [
        { id: taskId, orgId: org.id },
        { id: taskId, billingOrgId: org.id },
      ],
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Idempotency check: reject if usage already reported
    if (task.usageReportedAt) {
      res.status(409).json({
        error: "Usage already reported for this task",
        usageReportedAt: task.usageReportedAt,
        existingCost: task.estimatedCostUsd,
      });
      return;
    }

    logger.info("Token usage reported", {
      taskId,
      model,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
    });

    // Set tokens directly (not additive - log-parser uses Math.max())
    task.inputTokens = Number(inputTokens) || 0;
    task.outputTokens = Number(outputTokens) || 0;
    task.cacheCreationTokens = Number(cacheCreationTokens) || 0;
    task.cacheReadTokens = Number(cacheReadTokens) || 0;

    // Update model if provided
    if (model) {
      task.workerModel = model;
    }

    // Mark usage as reported (idempotency)
    task.usageReportedAt = new Date();

    // Calculate ECS duration if task has started
    if (task.startedAt) {
      task.ecsTaskSeconds = Math.floor((Date.now() - task.startedAt.getTime()) / 1000);
    }

    // Calculate cost using task method
    task.estimatedCostUsd = task.calculateCost();

    await taskRepo.save(task);

    // Update org cumulative cost
    try {
      const costTracker = getCostTracker(AppDataSource);
      await costTracker.recordTaskCost(taskId);
    } catch (costError) {
      logger.error("Failed to record task cost to org", { taskId, error: costError });
    }

    logger.info("Token usage recorded", {
      taskId,
      inputTokens: task.inputTokens,
      outputTokens: task.outputTokens,
      estimatedCostUsd: task.estimatedCostUsd,
    });

    res.json({
      success: true,
      taskId,
      estimatedCostUsd: task.estimatedCostUsd,
    });
  } catch (error) {
    logger.error("Error recording token usage", { error, taskId: req.params.id });
    res.status(500).json({ error: "Failed to record token usage" });
  }
});

/**
 * POST /api/tasks/:id/usage/partial
 * Report incremental token usage during execution (called periodically by log-parser.cjs)
 * Uses API key authentication (x-api-key header)
 *
 * This endpoint is for PARTIAL updates during execution:
 * - Uses GREATEST() to handle cumulative Claude reporting
 * - Does NOT set usageReportedAt (not final)
 * - Sets partialTokensUpdatedAt timestamp
 * - Calculates and updates estimatedCostUsd for real-time dashboard display
 * - Does NOT update org cumulative cost (wait for final /usage call)
 * - Fire-and-forget from worker (errors are logged but don't fail execution)
 */
router.post(
  "/:id/usage/partial",
  authenticateApiKey,
  param("id").isUUID().withMessage("id must be a valid UUID"),
  body("inputTokens").optional().isInt({ min: 0 }).withMessage("inputTokens must be a non-negative integer"),
  body("outputTokens").optional().isInt({ min: 0 }).withMessage("outputTokens must be a non-negative integer"),
  body("cacheCreationTokens").optional().isInt({ min: 0 }),
  body("cacheReadTokens").optional().isInt({ min: 0 }),
  body("mode").optional().isIn(["greatest", "add"]).withMessage("mode must be 'greatest' or 'add'"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const taskId = req.params.id as string;
      const org = req.organization!;
      const {
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        mode,
      } = req.body;

      const taskRepo = AppDataSource.getRepository(WorkerTask);

      // Mode determines how tokens are aggregated:
      // - "greatest" (default): Use GREATEST() for cumulative Claude reporting within a single session
      // - "add": Add to existing tokens (for multi-persona mode where each subtask is a separate session)
      const useAdditive = mode === "add";

      // Support platform tasks: check both orgId and billingOrgId
      if (useAdditive) {
        // Additive mode: Add new tokens to existing (for multi-persona subtasks)
        await taskRepo
          .createQueryBuilder()
          .update(WorkerTask)
          .set({
            inputTokens: () => `COALESCE(input_tokens, 0) + ${Number(inputTokens) || 0}`,
            outputTokens: () => `COALESCE(output_tokens, 0) + ${Number(outputTokens) || 0}`,
            cacheCreationTokens: () => `COALESCE(cache_creation_tokens, 0) + ${Number(cacheCreationTokens) || 0}`,
            cacheReadTokens: () => `COALESCE(cache_read_tokens, 0) + ${Number(cacheReadTokens) || 0}`,
            partialTokensUpdatedAt: new Date(),
          })
          .where("id = :taskId AND (org_id = :orgId OR billing_org_id = :orgId)", { taskId, orgId: org.id })
          .execute();
      } else {
        // Default: Use GREATEST() to handle cumulative token reporting from Claude
        // This ensures we never decrease token counts if packets arrive out of order
        await taskRepo
          .createQueryBuilder()
          .update(WorkerTask)
          .set({
            inputTokens: () => `GREATEST(input_tokens, ${Number(inputTokens) || 0})`,
            outputTokens: () => `GREATEST(output_tokens, ${Number(outputTokens) || 0})`,
            cacheCreationTokens: () => `GREATEST(cache_creation_tokens, ${Number(cacheCreationTokens) || 0})`,
            cacheReadTokens: () => `GREATEST(cache_read_tokens, ${Number(cacheReadTokens) || 0})`,
            partialTokensUpdatedAt: new Date(),
          })
          .where("id = :taskId AND (org_id = :orgId OR billing_org_id = :orgId)", { taskId, orgId: org.id })
          .execute();
      }

      // Fetch updated task to calculate cost for real-time display
      // NOTE: Read-only — we use atomic UPDATE below instead of .save() to avoid
      // clobbering concurrent token additions from parallel stories
      const task = await taskRepo.findOne({
        where: [
          { id: taskId, orgId: org.id },
          { id: taskId, billingOrgId: org.id },
        ],
      });

      if (task) {
        // Calculate cost and update atomically — do NOT use .save() which would
        // write all columns and clobber concurrent token additions from parallel stories
        const estimatedCostUsd = task.calculateCost();
        await taskRepo
          .createQueryBuilder()
          .update(WorkerTask)
          .set({ estimatedCostUsd })
          .where("id = :taskId", { taskId })
          .execute();

        logger.debug("Partial token usage recorded", {
          taskId,
          inputTokens: task.inputTokens,
          outputTokens: task.outputTokens,
          estimatedCostUsd,
        });

        // Emit real-time cost event for SSE clients
        const costCeilingPercent = org.perTaskCostCeilingUsd
          ? (estimatedCostUsd / org.perTaskCostCeilingUsd) * 100
          : undefined;

        costEvents.emitCostUpdate({
          taskId,
          orgId: org.id,
          inputTokens: task.inputTokens || 0,
          outputTokens: task.outputTokens || 0,
          estimatedCostUsd,
          timestamp: new Date().toISOString(),
          perTaskCostCeilingUsd: org.perTaskCostCeilingUsd,
          costCeilingPercent,
        });

        // Check per-task cost ceiling and auto-terminate if exceeded
        if (
          org.perTaskCostCeilingUsd !== null &&
          estimatedCostUsd >= org.perTaskCostCeilingUsd
        ) {
          logger.warn("Task cost ceiling exceeded - terminating task", {
            taskId,
            estimatedCostUsd,
            perTaskCostCeilingUsd: org.perTaskCostCeilingUsd,
            orgId: org.id,
          });

          // Mark task as failed due to cost ceiling — atomic update, not .save()
          await taskRepo
            .createQueryBuilder()
            .update(WorkerTask)
            .set({
              status: "failed",
              errorMessage: `Task terminated: cost ceiling exceeded ($${estimatedCostUsd.toFixed(2)} >= $${org.perTaskCostCeilingUsd.toFixed(2)})`,
            })
            .where("id = :taskId", { taskId })
            .execute();

          res.json({
            success: true,
            terminated: true,
            reason: "cost_ceiling_exceeded",
            estimatedCostUsd,
            perTaskCostCeilingUsd: org.perTaskCostCeilingUsd,
          });
          return;
        }
      }

      res.json({ success: true });
    } catch (error) {
      // Log error but return success - this is fire-and-forget
      logger.error("Error recording partial token usage", { error, taskId: req.params.id });
      res.json({ success: true, warning: "Failed to record partial tokens" });
    }
  }
);

/**
 * POST /api/tasks/:id/usage/phase
 * Record phase-level token usage for FinOps analytics.
 * This is the primary endpoint for tracking tokens by phase (planning, execution, review, deployment).
 * Uses API key authentication (x-api-key header)
 *
 * Body parameters:
 * - phase: 'planning' | 'execution' | 'review' | 'deployment' | 'improvement' (required)
 * - inputTokens: number (required)
 * - outputTokens: number (required)
 * - cacheCreationTokens: number (optional)
 * - cacheReadTokens: number (optional)
 * - model: string (optional, e.g., 'claude-sonnet-4-5-20250929')
 * - provider: string (optional, e.g., 'anthropic', 'openai', 'google', 'ollama')
 * - storyIndex: number (optional, for execution phase)
 * - persona: string (optional, e.g., 'backend_developer')
 * - operationType: string (optional, e.g., 'code_generation', 'analysis', 'testing')
 * - durationSeconds: number (optional)
 */
router.post(
  "/:id/usage/phase",
  authenticateApiKey,
  param("id").isUUID().withMessage("id must be a valid UUID"),
  body("phase")
    .isIn(["planning", "execution", "review", "deployment", "improvement"])
    .withMessage("phase must be one of: planning, execution, review, deployment, improvement"),
  body("inputTokens").isInt({ min: 0 }).withMessage("inputTokens must be a non-negative integer"),
  body("outputTokens").isInt({ min: 0 }).withMessage("outputTokens must be a non-negative integer"),
  body("cacheCreationTokens").optional().isInt({ min: 0 }),
  body("cacheReadTokens").optional().isInt({ min: 0 }),
  body("model").optional().isString(),
  body("provider").optional().isString(),
  body("storyIndex").optional().isInt({ min: 0 }),
  body("persona").optional().isString(),
  body("operationType")
    .optional()
    .isIn(["code_generation", "analysis", "testing", "file_operations", "bash_commands", "git_operations", "api_calls", "other"])
    .withMessage("operationType must be one of: code_generation, analysis, testing, file_operations, bash_commands, git_operations, api_calls, other"),
  body("durationSeconds").optional().isInt({ min: 0 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const taskId = req.params.id as string;
      const org = req.organization!;
      const {
        phase,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        model,
        provider,
        storyIndex,
        persona,
        operationType,
        durationSeconds,
      } = req.body;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      // Support platform tasks: check both orgId and billingOrgId
      const task = await taskRepo.findOne({
        where: [
          { id: taskId, orgId: org.id },
          { id: taskId, billingOrgId: org.id },
        ],
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      // Create phase usage record
      const tokenUsageRepo = AppDataSource.getRepository(WorkerTaskTokenUsage);
      const tokenUsage = tokenUsageRepo.create({
        taskId,
        phase: phase as TokenUsagePhase,
        inputTokens: Number(inputTokens) || 0,
        outputTokens: Number(outputTokens) || 0,
        cacheCreationTokens: Number(cacheCreationTokens) || 0,
        cacheReadTokens: Number(cacheReadTokens) || 0,
        model: model || task.workerModel,
        provider: provider || "anthropic",
        storyIndex: storyIndex !== undefined ? Number(storyIndex) : null,
        persona: persona || null,
        operationType: operationType as TokenUsageOperationType || null,
        durationSeconds: durationSeconds !== undefined ? Number(durationSeconds) : null,
      });

      // Calculate cost for this phase
      tokenUsage.estimatedCostUsd = tokenUsage.calculateCost();

      await tokenUsageRepo.save(tokenUsage);

      logger.info("Phase token usage recorded", {
        taskId,
        phase,
        operationType: tokenUsage.operationType,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        model: tokenUsage.model,
        provider: tokenUsage.provider,
        storyIndex: tokenUsage.storyIndex,
        persona: tokenUsage.persona,
        estimatedCostUsd: tokenUsage.estimatedCostUsd,
      });

      res.json({
        success: true,
        id: tokenUsage.id,
        taskId,
        phase,
        estimatedCostUsd: tokenUsage.estimatedCostUsd,
        totalTokens: tokenUsage.getTotalTokens(),
      });
    } catch (error) {
      logger.error("Error recording phase token usage", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to record phase token usage" });
    }
  }
);

/**
 * GET /api/tasks/:id/usage/by-persona
 * Get token usage breakdown by persona for a task.
 * Returns aggregated token usage per persona with totals.
 */
router.get(
  "/:id/usage/by-persona",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const taskId = req.params.id as string;
      const orgId = req.organization!.id;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id: taskId, orgId },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      const tokenUsageRepo = AppDataSource.getRepository(WorkerTaskTokenUsage);

      // Get all usage records for this task
      const usages = await tokenUsageRepo.find({
        where: { taskId },
        order: { createdAt: "ASC" },
      });

      // Aggregate by persona
      const byPersona: Record<string, {
        inputTokens: number;
        outputTokens: number;
        cacheCreationTokens: number;
        cacheReadTokens: number;
        estimatedCostUsd: number;
        phases: string[];
        storyCount: number;
        records: Array<{
          id: string;
          phase: string;
          model: string | null;
          provider: string | null;
          storyIndex: number | null;
          inputTokens: number;
          outputTokens: number;
          estimatedCostUsd: number;
          createdAt: Date;
        }>;
      }> = {};

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCostUsd = 0;

      for (const usage of usages) {
        const personaKey = usage.persona || "unknown";

        if (!byPersona[personaKey]) {
          byPersona[personaKey] = {
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            estimatedCostUsd: 0,
            phases: [],
            storyCount: 0,
            records: [],
          };
        }

        byPersona[personaKey].inputTokens += usage.inputTokens || 0;
        byPersona[personaKey].outputTokens += usage.outputTokens || 0;
        byPersona[personaKey].cacheCreationTokens += usage.cacheCreationTokens || 0;
        byPersona[personaKey].cacheReadTokens += usage.cacheReadTokens || 0;
        byPersona[personaKey].estimatedCostUsd += Number(usage.estimatedCostUsd) || 0;

        if (!byPersona[personaKey].phases.includes(usage.phase)) {
          byPersona[personaKey].phases.push(usage.phase);
        }

        if (usage.storyIndex !== null) {
          byPersona[personaKey].storyCount += 1;
        }

        byPersona[personaKey].records.push({
          id: usage.id,
          phase: usage.phase,
          model: usage.model,
          provider: usage.provider,
          storyIndex: usage.storyIndex,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          estimatedCostUsd: Number(usage.estimatedCostUsd) || 0,
          createdAt: usage.createdAt,
        });

        totalInputTokens += usage.inputTokens || 0;
        totalOutputTokens += usage.outputTokens || 0;
        totalCostUsd += Number(usage.estimatedCostUsd) || 0;
      }

      res.json({
        taskId,
        jiraIssueKey: task.jiraIssueKey,
        byPersona,
        totals: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          estimatedCostUsd: totalCostUsd,
          personaCount: Object.keys(byPersona).length,
          recordCount: usages.length,
        },
      });
    } catch (error) {
      logger.error("Error getting usage by persona", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to get usage by persona" });
    }
  }
);

/**
 * GET /api/tasks/:id/usage/by-operation-type
 * Get token usage breakdown by operation type for a task.
 * Returns aggregated token usage per operation type with totals.
 */
router.get(
  "/:id/usage/by-operation-type",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const taskId = req.params.id as string;
      const orgId = req.organization!.id;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id: taskId, orgId },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      const tokenUsageRepo = AppDataSource.getRepository(WorkerTaskTokenUsage);

      // Get all usage records for this task
      const usages = await tokenUsageRepo.find({
        where: { taskId },
        order: { createdAt: "ASC" },
      });

      // Aggregate by operation type
      const byOperationType: Record<string, {
        inputTokens: number;
        outputTokens: number;
        cacheCreationTokens: number;
        cacheReadTokens: number;
        estimatedCostUsd: number;
        phases: string[];
        count: number;
        records: Array<{
          id: string;
          phase: string;
          model: string | null;
          provider: string | null;
          persona: string | null;
          inputTokens: number;
          outputTokens: number;
          estimatedCostUsd: number;
          createdAt: Date;
        }>;
      }> = {};

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCostUsd = 0;

      for (const usage of usages) {
        const opTypeKey = usage.operationType || "unspecified";

        if (!byOperationType[opTypeKey]) {
          byOperationType[opTypeKey] = {
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            estimatedCostUsd: 0,
            phases: [],
            count: 0,
            records: [],
          };
        }

        byOperationType[opTypeKey].inputTokens += usage.inputTokens || 0;
        byOperationType[opTypeKey].outputTokens += usage.outputTokens || 0;
        byOperationType[opTypeKey].cacheCreationTokens += usage.cacheCreationTokens || 0;
        byOperationType[opTypeKey].cacheReadTokens += usage.cacheReadTokens || 0;
        byOperationType[opTypeKey].estimatedCostUsd += Number(usage.estimatedCostUsd) || 0;
        byOperationType[opTypeKey].count += 1;

        if (!byOperationType[opTypeKey].phases.includes(usage.phase)) {
          byOperationType[opTypeKey].phases.push(usage.phase);
        }

        byOperationType[opTypeKey].records.push({
          id: usage.id,
          phase: usage.phase,
          model: usage.model,
          provider: usage.provider,
          persona: usage.persona,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          estimatedCostUsd: Number(usage.estimatedCostUsd) || 0,
          createdAt: usage.createdAt,
        });

        totalInputTokens += usage.inputTokens || 0;
        totalOutputTokens += usage.outputTokens || 0;
        totalCostUsd += Number(usage.estimatedCostUsd) || 0;
      }

      res.json({
        taskId,
        jiraIssueKey: task.jiraIssueKey,
        byOperationType,
        totals: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          estimatedCostUsd: totalCostUsd,
          operationTypeCount: Object.keys(byOperationType).length,
          recordCount: usages.length,
        },
      });
    } catch (error) {
      logger.error("Error getting usage by operation type", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to get usage by operation type" });
    }
  }
);

/**
 * GET /api/tasks/:id/usage/breakdown
 * Get token usage breakdown by phase for a task.
 * Returns aggregated token usage per phase with totals.
 */
router.get(
  "/:id/usage/breakdown",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const taskId = req.params.id as string;
      const orgId = req.organization!.id;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id: taskId, orgId },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      const tokenUsageRepo = AppDataSource.getRepository(WorkerTaskTokenUsage);

      // Get all phase usage records for this task
      const phaseUsages = await tokenUsageRepo.find({
        where: { taskId },
        order: { createdAt: "ASC" },
      });

      // Aggregate by phase
      const byPhase: Record<string, {
        inputTokens: number;
        outputTokens: number;
        cacheCreationTokens: number;
        cacheReadTokens: number;
        estimatedCostUsd: number;
        count: number;
        records: Array<{
          id: string;
          model: string | null;
          provider: string | null;
          storyIndex: number | null;
          persona: string | null;
          inputTokens: number;
          outputTokens: number;
          estimatedCostUsd: number;
          durationSeconds: number | null;
          createdAt: Date;
        }>;
      }> = {};

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCacheCreationTokens = 0;
      let totalCacheReadTokens = 0;
      let totalCostUsd = 0;

      for (const usage of phaseUsages) {
        if (!byPhase[usage.phase]) {
          byPhase[usage.phase] = {
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            estimatedCostUsd: 0,
            count: 0,
            records: [],
          };
        }

        byPhase[usage.phase].inputTokens += usage.inputTokens || 0;
        byPhase[usage.phase].outputTokens += usage.outputTokens || 0;
        byPhase[usage.phase].cacheCreationTokens += usage.cacheCreationTokens || 0;
        byPhase[usage.phase].cacheReadTokens += usage.cacheReadTokens || 0;
        byPhase[usage.phase].estimatedCostUsd += Number(usage.estimatedCostUsd) || 0;
        byPhase[usage.phase].count += 1;
        byPhase[usage.phase].records.push({
          id: usage.id,
          model: usage.model,
          provider: usage.provider,
          storyIndex: usage.storyIndex,
          persona: usage.persona,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          estimatedCostUsd: Number(usage.estimatedCostUsd) || 0,
          durationSeconds: usage.durationSeconds,
          createdAt: usage.createdAt,
        });

        totalInputTokens += usage.inputTokens || 0;
        totalOutputTokens += usage.outputTokens || 0;
        totalCacheCreationTokens += usage.cacheCreationTokens || 0;
        totalCacheReadTokens += usage.cacheReadTokens || 0;
        totalCostUsd += Number(usage.estimatedCostUsd) || 0;
      }

      res.json({
        taskId,
        jiraIssueKey: task.jiraIssueKey,
        byPhase,
        totals: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cacheCreationTokens: totalCacheCreationTokens,
          cacheReadTokens: totalCacheReadTokens,
          estimatedCostUsd: totalCostUsd,
          recordCount: phaseUsages.length,
        },
        // Also include the task-level aggregated tokens for comparison
        taskLevel: {
          inputTokens: task.inputTokens || 0,
          outputTokens: task.outputTokens || 0,
          cacheCreationTokens: task.cacheCreationTokens || 0,
          cacheReadTokens: task.cacheReadTokens || 0,
          estimatedCostUsd: task.estimatedCostUsd || 0,
          planningInputTokens: task.planningInputTokens || 0,
          planningOutputTokens: task.planningOutputTokens || 0,
        },
      });
    } catch (error) {
      logger.error("Error getting usage breakdown", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to get usage breakdown" });
    }
  }
);

export default router;
