import { Router, Request, Response } from "express";
// typeorm imports (Brackets etc.) removed — using JS filter for correctness match with REST
import { authenticateSSE } from "../../middleware/auth.js";
import { acquireSSESlot, releaseSSESlot } from "../../middleware/sse-limiter.js";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask, Organization, KbCard } from "../../models/index.js";
import { logger } from "../../utils/logger.js";
import { costEvents, type CostUpdateEvent } from "../../services/cost-events.js";
import {
  formatTaskData,
  sortTasksWithPrdGrouping,
  fetchRalphProgressForTask,
  fetchCheckpointForTask,
  fetchEpicProgressForTask,
} from "./helpers.js";

/**
 * Simple concurrency limiter for DB queries.
 * Limits how many tasks are fetched in parallel to prevent pool exhaustion.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

const router = Router();

/**
 * GET /api/control-center/stream
 * SSE stream for real-time dashboard updates
 */
router.get("/stream", authenticateSSE, async (req: Request, res: Response) => {
  const org = req.organization;

  // Handle users without an organization (onboarding state)
  if (!org) {
    res.status(403).json({ error: "No organization. Complete onboarding first." });
    return;
  }

  if (!acquireSSESlot(org.id, 5)) {
    res.status(429).json({ error: "Too many dashboard connections" });
    return;
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let isConnected = true;

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`);

  let inFlight = false;
  const sendUpdate = async () => {
    if (!isConnected) return;
    if (inFlight) return;
    inFlight = true;

    try {
      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const orgRepo = AppDataSource.getRepository(Organization);

      // Re-fetch org to get latest systemEnabled state for real-time updates
      const freshOrg = await orgRepo.findOne({ where: { id: org.id } });
      if (!freshOrg) return;

      const countersResetAt = freshOrg.countersResetAt || new Date(0);

      // Keep recently completed/waiting tasks visible based on org setting
      const displayMinutes = freshOrg.completedTaskDisplayMinutes || 10;
      const displayCutoff = new Date(Date.now() - displayMinutes * 60 * 1000);
      // Use same cutoff for intermediate (waiting) tasks — unified setting
      const intermediateCutoff = displayCutoff;
      // Statuses that always indicate active work
      const alwaysActiveStatuses = ["queued", "claimed", "environment_setup", "executing", "planning", "pending_plan_approval", "dispatching", "reviewing", "consolidating", "integration_check"];
      // Intermediate statuses that should only show if recent (configurable, default 60 min)
      const intermediateStatuses = [
        "pr_created", "review_requested", "manager_review", "review_pending",
        "pr_approved", "review_approved", "deploying", "deployment_pending",
        "revision_needed", "awaiting_destructive_approval", "escalated",
        "pending_plan_approval"
      ];
      const terminalStatuses = ["completed", "deployed", "failed", "cancelled"];
      const doneStatuses = ["completed", "deployed", "pr_approved", "review_approved"];

      // ── Fetch displayable tasks using same JS filter as REST endpoint ──
      // Previous SQL-based query had subtle mismatches with the REST endpoint's
      // JS filter, causing "flash then disappear" on page load.
      // Use the same approach as the REST endpoint for correctness.
      const allTasks = await taskRepo.find({
        where: { orgId: org.id },
        order: { createdAt: "DESC" },
        take: 500,
      });

      const displayableTasks = allTasks.filter((t) => {
        if (alwaysActiveStatuses.includes(t.status)) return true;
        if (intermediateStatuses.includes(t.status)) {
          const taskTime = t.updatedAt || t.createdAt;
          return taskTime && new Date(taskTime) > intermediateCutoff;
        }
        if (terminalStatuses.includes(t.status) && t.completedAt && new Date(t.completedAt) > displayCutoff) {
          return true;
        }
        return false;
      });

      // Lightweight aggregate for period stats
      const tasksSinceReset = allTasks.filter((t) => new Date(t.createdAt) >= countersResetAt);
      const periodCompleted = tasksSinceReset.filter((t) => doneStatuses.includes(t.status)).length;
      const periodFailed = tasksSinceReset.filter((t) => t.status === "failed" && t.completedAt).length;
      const periodCost = tasksSinceReset
        .filter((t) => doneStatuses.includes(t.status) || t.status === "failed")
        .reduce((sum, t) => sum + (Number(t.estimatedCostUsd) || 0), 0);

      // "Active" = tasks where a worker is actually executing (not queued, not waiting)
      const executingStatuses = ["claimed", "environment_setup", "executing", "planning", "dispatching", "pending_plan_approval", "reviewing", "consolidating", "integration_check"];
      const stats = {
        totalWorkers: 7,
        activeWorkers: displayableTasks.filter(t => executingStatuses.includes(t.status)).length,
        queueDepth: displayableTasks.filter((t) => t.status === "queued").length,
        periodCost,
        periodCompleted,
        periodFailed,
      };

      // Sort with PRD grouping, then limit to 10
      const filteredRunningTasks = sortTasksWithPrdGrouping(displayableTasks).slice(0, 10);

      // Batch-fetch card context for internal board cards (for direct links)
      const streamTaskIds = filteredRunningTasks.map((t) => t.id);
      const cardContextMap = new Map<string, { boardId: string; cardId: string }>();
      if (streamTaskIds.length > 0) {
        const cardRows = await AppDataSource.getRepository(KbCard)
          .createQueryBuilder("card")
          .select(["card.workerTaskId", "card.boardId", "card.id"])
          .where("card.workerTaskId IN (:...taskIds)", { taskIds: streamTaskIds })
          .getMany();
        for (const row of cardRows) {
          if (row.workerTaskId) {
            cardContextMap.set(row.workerTaskId, {
              boardId: row.boardId,
              cardId: row.id,
            });
          }
        }
      }

      // Fetch Ralph progress, checkpoint data, and Epic progress
      // Limit concurrency to 3 tasks at a time to prevent pool exhaustion
      const runningTasks = await mapWithConcurrency(
        filteredRunningTasks,
        3,
        async (task) => {
          const [ralphData, checkpointData, epicProgressData] = await Promise.all([
            fetchRalphProgressForTask(task.id),
            fetchCheckpointForTask(task.id),
            fetchEpicProgressForTask(task),
          ]);
          return formatTaskData(
            task,
            ralphData,
            checkpointData,
            epicProgressData || undefined,
            freshOrg.maxReviewRevisions,
            cardContextMap.get(task.id) ?? null,
          );
        },
      );

      const queuedTasks = displayableTasks
        .filter((t) => t.status === "queued")
        .slice(0, 20)
        .map((task) => ({
          id: task.id,
          jiraIssueKey: task.jiraIssueKey,
          summary: task.summary,
          status: task.status,
          workerPersona: task.workerPersona,
          priority: task.priority,
          createdAt: task.createdAt,
        }));

      const recentCompleted = allTasks
        .slice(0, 50)
        .map((task) => ({
          id: task.id,
          jiraIssueKey: task.jiraIssueKey,
          summary: task.summary,
          status: task.status,
          workerModel: task.workerModel,
          workerPersona: task.workerPersona,
          workerProvider: task.workerProvider || "anthropic",
          costUsd: Number(task.estimatedCostUsd) || 0,
          durationMinutes:
            task.startedAt && task.completedAt
              ? Math.round(
                  (new Date(task.completedAt).getTime() -
                    new Date(task.startedAt).getTime()) /
                    60000
                )
              : null,
          startedAt: task.startedAt?.toISOString() || null,
          createdAt: task.createdAt?.toISOString(),
          completedAt: task.completedAt?.toISOString() || null,
          githubPrUrl: task.githubPrUrl,
          ecsTaskId: task.ecsTaskId,
          retryCount: task.retryCount || 0,
          revisionCount: task.revisionCount || 0,
          maxReviewRevisions: freshOrg.maxReviewRevisions,
          errorMessage: task.errorMessage || null,
          lastHeartbeatAt: task.lastHeartbeatAt?.toISOString() || null,
          // Remote agent info
          claimedByAgent: task.claimedByAgent || null,
          // Workflow mode fields
          workflowMode: task.getWorkflowMode(),
          workflowModeName: task.getWorkflowModeName(),
          deploymentEnabled: task.deploymentEnabled,
          skipManagerReview: task.skipManagerReview,
          managerEnabled: task.managerEnabled,
          // Checkpoint info
          hasCheckpoint: false,
          checkpointStage: null,
          resumeCount: 0,
          checkpointSavedAt: null,
          // Quality metrics
          qualityScore: task.qualityScore ?? null,
          qualityGrade: task.getQualityGrade() ?? null,
        }));

      // System status for real-time maintenance mode updates
      const systemStatus = {
        systemEnabled: freshOrg.systemEnabled,
        orchestrator: { running: freshOrg.orchestratorRunning, desiredCount: 1 },
        executors: { running: 0 },
      };

      const data = {
        type: "update",
        timestamp: new Date().toISOString(),
        stats,
        activeTasks: runningTasks,
        queuedTasks,
        recentCompleted,
        systemStatus,
      };

      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        isConnected = false;
      }
    } catch (error) {
      logger.error("Error sending SSE update", { error, orgId: org.id });
    } finally {
      inFlight = false;
    }
  };

  // Send initial update
  await sendUpdate();

  // Send updates every 5 seconds
  const interval = setInterval(sendUpdate, 8000);

  // Subscribe to real-time cost events for immediate updates
  const unsubscribeCost = costEvents.subscribeToCostUpdates(org.id, (event: CostUpdateEvent) => {
    if (!isConnected) return;
    try {
      res.write(`data: ${JSON.stringify({
        type: "cost",
        timestamp: event.timestamp,
        taskId: event.taskId,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        estimatedCostUsd: event.estimatedCostUsd,
        perTaskCostCeilingUsd: event.perTaskCostCeilingUsd,
        costCeilingPercent: event.costCeilingPercent,
      })}\n\n`);
    } catch {
      isConnected = false;
    }
  });

  // Clean up on disconnect
  req.on("close", () => {
    isConnected = false;
    clearInterval(interval);
    unsubscribeCost();
    releaseSSESlot(org.id);
    logger.debug("SSE client disconnected", { orgId: org.id });
  });
});

export default router;
