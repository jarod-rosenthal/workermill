import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask, WorkerTaskLog, WorkerContext } from "../../models/index.js";
import { authenticateRequest, authenticateApiKey } from "../../middleware/auth.js";
import { getECSTaskRunner } from "../../services/ecs-task-runner.js";
import { getCostTracker } from "../../services/cost-tracker.js";
import { logger } from "../../utils/logger.js";
import { body, param, query, validateRequest } from "../../middleware/validation.js";
import { checkAndUnblockDependentTasks } from "../../services/task-monitor.js";
import { notifyTaskCompleted, notifyTaskFailed } from "../../services/notifications.js";

const router = Router();

// All routes require authentication (matches original global router.use(authenticateRequest))
router.use(authenticateRequest);

/**
 * GET /api/tasks/:id/logs
 * Get logs for a task
 */
router.get(
  "/:id/logs",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  query("nextToken").optional().isString(),
  query("limit").optional().isInt({ min: 1, max: 500 }).withMessage("limit must be between 1 and 500"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = req.params.id as string;
      const { nextToken, limit = 100 } = req.query;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id, orgId },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (!task.ecsTaskId) {
      res.json({ events: [], message: "Task has not started yet" });
      return;
    }

    const runner = getECSTaskRunner();
    const logs = await runner.getTaskLogs(task.ecsTaskId, {
      nextToken: nextToken as string | undefined,
      limit: Number(limit),
    });

    res.json(logs);
    } catch (error) {
      logger.error("Error getting task logs", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to get task logs" });
    }
  }
);

/**
 * POST /api/tasks/:id/worker-complete
 * Called by the worker container when task completes
 * Uses API key authentication (x-api-key header)
 */
router.post("/:id/worker-complete", authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const org = req.organization!;
    const {
      exitCode,
      result,        // 'deployed' | 'review_requested' | 'no_changes' | 'completed' | 'failed'
      prUrl,
      prNumber,
      branch,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      errorMessage,
      revisionCount,  // For Epic/Multi-Expert mode inline reviews
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

    // Skip if task already completed or in a waiting state (e.g. review_requested, pr_approved).
    // Terminal states: completed, deployed, failed, cancelled
    // Waiting states: review_requested, pr_approved, escalated, pr_created
    // These are all states where the worker already reported its actual result — a late
    // fallback from the spawner (which only knows exit code) must not overwrite them.
    if (task.isTerminal() || task.isWaiting()) {
      logger.info("Task already transitioned, ignoring worker-complete", { taskId, currentStatus: task.status });
      res.json({ status: "ignored", reason: `Task already in ${task.status}` });
      return;
    }

    logger.info("Worker completion reported", {
      taskId,
      exitCode,
      result,
      prUrl,
      inputTokens,
      outputTokens,
    });

    // Map result to status
    let newStatus: typeof task.status;
    switch (result) {
      case "deployed":
        newStatus = "deployed";
        break;
      case "pr_created":
        newStatus = "pr_created";
        break;
      case "review_requested":
        newStatus = "review_requested";
        break;
      case "pr_approved":
        // Epic + Review: Tech Lead approved, PR ready for human merge
        newStatus = "pr_approved";
        break;
      case "escalated":
        newStatus = "escalated";
        break;
      case "no_changes":
      case "completed":
        newStatus = "completed";
        break;
      case "failed":
      default:
        newStatus = exitCode === 0 ? "completed" : "failed";
        break;
    }

    // Update task
    task.status = newStatus;
    task.completedAt = new Date();

    if (prUrl) {
      task.githubPrUrl = prUrl;
    }
    if (prNumber) {
      task.githubPrNumber = Number(prNumber);
    }
    if (branch) {
      task.githubBranch = branch;
    }
    if (errorMessage) {
      task.errorMessage = errorMessage;
    }
    if (typeof revisionCount === "number" && revisionCount >= 0) {
      task.revisionCount = revisionCount;
    }

    // Calculate ECS task duration
    if (task.startedAt) {
      task.ecsTaskSeconds = Math.floor((new Date().getTime() - task.startedAt.getTime()) / 1000);
    }

    // Token usage and cost are handled by the /usage endpoint (called by log-parser.cjs)
    // Only calculate cost here if usage wasn't already reported
    if (!task.usageReportedAt) {
      // Fallback: update tokens if provided in payload (backward compatibility)
      if (inputTokens !== undefined) {
        task.inputTokens = (task.inputTokens || 0) + Number(inputTokens);
      }
      if (outputTokens !== undefined) {
        task.outputTokens = (task.outputTokens || 0) + Number(outputTokens);
      }
      if (cacheCreationTokens !== undefined) {
        task.cacheCreationTokens = (task.cacheCreationTokens || 0) + Number(cacheCreationTokens);
      }
      if (cacheReadTokens !== undefined) {
        task.cacheReadTokens = (task.cacheReadTokens || 0) + Number(cacheReadTokens);
      }

      // Calculate cost
      task.estimatedCostUsd = task.calculateCost();
    }

    await taskRepo.save(task);

    // Record cost to org cumulative (only if not already done by /usage endpoint)
    if (!task.usageReportedAt) {
      try {
        const costTracker = getCostTracker(AppDataSource);
        await costTracker.recordTaskCost(taskId);
      } catch (costError) {
        logger.error("Failed to record task cost", { taskId, error: costError });
      }
    }

    logger.info("Task completion processed", {
      taskId,
      newStatus,
      cost: task.estimatedCostUsd,
      inputTokens: task.inputTokens,
      outputTokens: task.outputTokens,
    });

    // If this is a child task that completed successfully, check if any blocked siblings can now run
    // Include review_requested to match the internal logic in checkAndUnblockDependentTasks
    if (["completed", "deployed", "review_requested"].includes(newStatus) && task.parentTaskId) {
      try {
        await checkAndUnblockDependentTasks(task);
      } catch (unblockError) {
        logger.warn("Failed to check/unblock dependent tasks", { taskId, error: unblockError });
      }
    }

    // Send email/Slack notifications only for parent tasks (not child stories)
    // This provides a single summary notification when the workflow completes
    // Child task completions are handled by the parent when it finalizes
    if (!task.parentTaskId) {
      try {
        // Notify on all terminal and waiting states where the worker has finished
        // - completed/deployed: Task fully done
        // - pr_approved: Tech Lead approved, ready for merge/deploy
        // - review_requested: PR created, waiting for human review
        // - escalated: Task needs human intervention
        if (newStatus === "completed" || newStatus === "deployed" ||
            newStatus === "pr_approved" || newStatus === "review_requested" ||
            newStatus === "escalated") {
          await notifyTaskCompleted(task);
          logger.info("Sent task completed notification", { taskId, newStatus });
        } else if (newStatus === "failed") {
          await notifyTaskFailed(task);
          logger.info("Sent task failed notification", { taskId, newStatus });
        }
        // Skip separate PR created notification - it's included in completion summary
      } catch (notifyError) {
        logger.warn("Failed to send notification", {
          taskId,
          newStatus,
          error: notifyError instanceof Error ? notifyError.message : String(notifyError),
        });
      }
    } else {
      logger.debug("Skipping notification for child task", { taskId, parentTaskId: task.parentTaskId });
    }

    res.json({
      status: "processed",
      taskId,
      newStatus,
      cost: task.estimatedCostUsd,
    });
  } catch (error) {
    logger.error("Error processing worker-complete", { error, taskId: req.params.id });
    res.status(500).json({ error: "Failed to process worker completion" });
  }
});

/**
 * POST /api/tasks/:id/worker-progress
 * Called by the worker container to update task status without completing it.
 * Used for intermediate progress states (e.g., PR created, consolidating).
 * Does NOT set completedAt — this is a non-terminal status update.
 * Uses API key authentication (x-api-key header)
 */
router.post("/:id/worker-progress", authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const org = req.organization!;
    const { status, prUrl, prNumber, revisionCount } = req.body;

    // Only allow known non-terminal progress statuses
    const allowedStatuses = ["pr_created", "review_requested", "reviewing", "consolidating", "deploying"];
    if (!allowedStatuses.includes(status)) {
      res.status(400).json({ error: `Invalid progress status: ${status}. Allowed: ${allowedStatuses.join(", ")}` });
      return;
    }

    const taskRepo = AppDataSource.getRepository(WorkerTask);
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

    // Skip if task is already terminal
    if (task.isTerminal()) {
      logger.info("Task already terminal, ignoring worker-progress", { taskId, currentStatus: task.status });
      res.json({ status: "ignored", reason: "Task already completed" });
      return;
    }

    logger.info("Worker progress update", { taskId, fromStatus: task.status, toStatus: status, prUrl });

    // Atomic update — only set the fields that changed (avoids clobbering concurrent writes)
    const updateFields: Record<string, unknown> = { status };
    if (prUrl) {
      updateFields.githubPrUrl = prUrl;
    }
    if (prNumber) {
      updateFields.githubPrNumber = Number(prNumber);
    }
    if (revisionCount !== undefined) {
      updateFields.revisionCount = Number(revisionCount);
    }

    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set(updateFields)
      .where("id = :id", { id: taskId })
      .execute();

    res.json({ status: "updated", taskId, newStatus: status });
  } catch (error) {
    logger.error("Error processing worker-progress", { error, taskId: req.params.id });
    res.status(500).json({ error: "Failed to process worker progress" });
  }
});

/**
 * POST /api/tasks/:id/quality-metrics
 * Post code quality metrics from worker container
 * Uses API key authentication (x-api-key header)
 *
 * Called by the quality analysis script after verify phase.
 * Stores composite quality score and detailed breakdown.
 */
router.post(
  "/:id/quality-metrics",
  authenticateApiKey,
  param("id").isUUID().withMessage("id must be a valid UUID"),
  body("qualityMetrics").isObject().withMessage("qualityMetrics object is required"),
  body("qualityMetrics.qualityScore").optional().isInt({ min: 0, max: 100 }),
  body("qualityMetrics.lintScore").optional().isInt({ min: 0, max: 100 }),
  body("qualityMetrics.typecheckScore").optional().isInt({ min: 0, max: 100 }),
  body("qualityMetrics.testScore").optional().isInt({ min: 0, max: 100 }),
  body("qualityMetrics.coverageScore").optional().isInt({ min: 0, max: 100 }),
  body("qualityMetrics.securityScore").optional().isInt({ min: 0, max: 100 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const taskId = req.params.id as string;
      const org = req.organization!;
      const { qualityMetrics } = req.body;

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

      // Atomic update — only set quality fields that were provided (avoids clobbering concurrent writes)
      const updateFields: Record<string, unknown> = {};
      const qm = qualityMetrics;
      if (qm.qualityScore !== undefined) updateFields.qualityScore = qm.qualityScore;
      if (qm.lintScore !== undefined) updateFields.lintScore = qm.lintScore;
      if (qm.lintErrors !== undefined) updateFields.lintErrors = qm.lintErrors;
      if (qm.lintWarnings !== undefined) updateFields.lintWarnings = qm.lintWarnings;
      if (qm.typecheckScore !== undefined) updateFields.typecheckScore = qm.typecheckScore;
      if (qm.typeErrors !== undefined) updateFields.typeErrors = qm.typeErrors;
      if (qm.testScore !== undefined) updateFields.testScore = qm.testScore;
      if (qm.testsPassed !== undefined) updateFields.testsPassed = qm.testsPassed;
      if (qm.testsFailed !== undefined) updateFields.testsFailed = qm.testsFailed;
      if (qm.testsSkipped !== undefined) updateFields.testsSkipped = qm.testsSkipped;
      if (qm.coverageScore !== undefined) updateFields.coverageScore = qm.coverageScore;
      if (qm.coverageLines !== undefined) updateFields.coverageLines = qm.coverageLines;
      if (qm.coverageBranches !== undefined) updateFields.coverageBranches = qm.coverageBranches;
      if (qm.securityScore !== undefined) updateFields.securityScore = qm.securityScore;
      if (qm.securityHigh !== undefined) updateFields.securityHigh = qm.securityHigh;
      if (qm.securityMedium !== undefined) updateFields.securityMedium = qm.securityMedium;
      if (qm.securityLow !== undefined) updateFields.securityLow = qm.securityLow;
      if (qm.analysisJson !== undefined) updateFields.qualityAnalysisJson = qm.analysisJson;

      if (Object.keys(updateFields).length > 0) {
        await taskRepo
          .createQueryBuilder()
          .update(WorkerTask)
          .set(updateFields)
          .where("id = :id", { id: taskId })
          .execute();
      }

      logger.info("Quality metrics recorded", {
        taskId,
        qualityScore: qm.qualityScore,
        lintScore: qm.lintScore,
        typecheckScore: qm.typecheckScore,
        testScore: qm.testScore,
        coverageScore: qm.coverageScore,
        securityScore: qm.securityScore,
      });

      res.json({
        success: true,
        taskId,
        qualityScore: qm.qualityScore,
      });
    } catch (error) {
      logger.error("Error recording quality metrics", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to record quality metrics" });
    }
  }
);

/**
 * POST /api/tasks/:id/manager-complete
 * Called by the Manager ECS task when it completes PR review
 * Uses API key authentication (x-api-key header)
 */
router.post("/:id/manager-complete", authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const org = req.organization!;
    const {
      decision,       // 'approved' | 'revision_needed' | 'rejected'
      feedback,
      codeQualityScore,
      managerModel,
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

    logger.info("Manager completion reported", {
      taskId,
      decision,
      codeQualityScore,
      managerModel,
    });

    // Store review feedback
    task.reviewFeedback = feedback || null;

    // Handle decision
    let newStatus: typeof task.status;
    switch (decision) {
      case "approved":
        // Manager approved - proceed to deploy
        newStatus = "review_approved";
        logger.info("Manager approved PR, proceeding to deployment", { taskId });
        break;

      case "revision_needed": {
        // Check if we can still revise (use org's maxReviewRevisions setting)
        task.revisionCount = (task.revisionCount || 0) + 1;
        const maxRevisions = org.maxReviewRevisions ?? 3;
        if (task.canRevise(maxRevisions)) {
          // Re-queue for worker to address feedback
          newStatus = "queued";
          task.taskNotes = `REVISION_RUN: Manager requested changes (attempt ${task.revisionCount}/${maxRevisions}). Feedback: ${feedback}`;
          task.completedAt = null;
          task.ecsTaskArn = null;
          task.ecsTaskId = null;
          task.startedAt = null;
          logger.info("Manager requested revision, re-queueing task", {
            taskId,
            revisionCount: task.revisionCount,
            maxRevisions
          });
        } else {
          // Max revisions reached - escalate for human intervention
          newStatus = "escalated";
          task.errorMessage = `Max revisions (${maxRevisions}) reached. Requires human intervention. Final feedback: ${feedback}`;
          logger.info("Max revisions reached, escalating task", { taskId, maxRevisions });
        }
        break;
      }

      case "rejected":
        // Manager rejected - task cannot be completed
        newStatus = "review_rejected";
        task.errorMessage = `Rejected by Virtual Manager: ${feedback}`;
        logger.info("Manager rejected PR", { taskId, feedback });
        break;

      default:
        // Unknown decision - log but don't change status
        logger.warn("Unknown manager decision", { taskId, decision });
        res.status(400).json({ error: "Invalid decision value" });
        return;
    }

    task.status = newStatus;

    // If approved, always trigger deployment (manager approval implies deploy intent)
    // Tasks that went through manager review should auto-deploy after approval
    if (newStatus === "review_approved") {
      // Re-queue for deployment run
      task.status = "queued";
      task.taskNotes = `DEPLOYMENT_RUN: Manager approved PR. Deploy and merge.`;
      task.completedAt = null;
      task.ecsTaskArn = null;
      task.ecsTaskId = null;
      task.startedAt = null;
      logger.info("Manager approved, re-queueing for deployment", { taskId });
    }

    await taskRepo.save(task);

    // Post review decision to comms channel so workers can see it
    try {
      const contextRepo = AppDataSource.getRepository(WorkerContext);
      const parentTaskId = task.parentTaskId || task.id; // Use self as parent if no parent

      // Build concise status message
      let statusMessage: string;
      const shortFeedback = feedback || "";

      switch (decision) {
        case "approved":
          statusMessage = `✅ PR APPROVED - Proceeding to deployment`;
          break;
        case "revision_needed":
          statusMessage = `🔄 REVISION NEEDED (attempt ${task.revisionCount}/3): ${shortFeedback}`;
          break;
        case "rejected":
          statusMessage = `❌ REJECTED: ${shortFeedback}`;
          break;
        default:
          statusMessage = `Review decision: ${decision}`;
      }

      const contextData = WorkerContext.create(
        parentTaskId,
        task.id,
        org.id,
        "tech_lead",
        "decision",
        statusMessage,
        {
          decision,
          revisionCount: task.revisionCount,
          codeQualityScore,
          fullFeedback: feedback,
          prUrl: task.githubPrUrl,
          jiraKey: task.jiraIssueKey,
        }
      );

      const context = contextRepo.create(contextData);
      await contextRepo.save(context);

      logger.info("Posted review decision to comms channel", {
        taskId,
        parentTaskId,
        decision,
        contextId: context.id,
      });
    } catch (contextErr) {
      // Don't fail the main request if context posting fails
      logger.warn("Failed to post review decision to comms channel", {
        taskId,
        error: contextErr instanceof Error ? contextErr.message : String(contextErr),
      });
    }

    logger.info("Manager completion processed", {
      taskId,
      newStatus: task.status,
      revisionCount: task.revisionCount,
    });

    res.json({
      status: "processed",
      taskId,
      newStatus: task.status,
      decision,
    });
  } catch (error) {
    logger.error("Error processing manager-complete", { error, taskId: req.params.id });
    res.status(500).json({ error: "Failed to process manager completion" });
  }
});

/**
 * POST /api/tasks/:id/logs
 * Post logs from worker container
 * Uses API key authentication (x-api-key header)
 */
router.post("/:id/logs", authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const org = req.organization!;
    const logs = req.body.logs as Array<{
      type: string;
      message: string;
      severity?: string;
      metadata?: Record<string, unknown>;
      command?: string;
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      filePath?: string;
      durationMs?: number;
    }>;

    if (!Array.isArray(logs) || logs.length === 0) {
      res.status(400).json({ error: "logs array is required" });
      return;
    }

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

    const logRepo = AppDataSource.getRepository(WorkerTaskLog);
    const logEntities = logs.map((log) =>
      logRepo.create({
        taskId,
        type: log.type as any,
        message: log.message,
        severity: (log.severity as any) || "info",
        metadata: log.metadata || null,
        command: log.command || null,
        exitCode: log.exitCode ?? null,
        stdout: log.stdout || null,
        stderr: log.stderr || null,
        filePath: log.filePath || null,
        durationMs: log.durationMs ?? null,
      })
    );

    await logRepo.save(logEntities);

    res.json({ success: true, count: logEntities.length });
  } catch (error) {
    logger.error("Error posting task logs", { error, taskId: req.params.id });
    res.status(500).json({ error: "Failed to post logs" });
  }
});

export default router;
