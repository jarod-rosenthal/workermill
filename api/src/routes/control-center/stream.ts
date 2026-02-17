import { Router, Request, Response } from "express";
import { authenticateSSE } from "../../middleware/auth.js";
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

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let isConnected = true;

  // Handle client disconnect
  req.on("close", () => {
    isConnected = false;
    logger.debug("SSE client disconnected", { orgId: org.id });
  });

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`);

  const sendUpdate = async () => {
    if (!isConnected) return;

    try {
      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const orgRepo = AppDataSource.getRepository(Organization);

      // Re-fetch org to get latest systemEnabled state for real-time updates
      const freshOrg = await orgRepo.findOne({ where: { id: org.id } });
      if (!freshOrg) return;

      const countersResetAt = freshOrg.countersResetAt || new Date(0);

      const allTasks = await taskRepo.find({
        where: { orgId: org.id },
        order: { createdAt: "DESC" },
      });

      const tasksSinceReset = allTasks.filter(
        (t) => new Date(t.createdAt) >= countersResetAt
      );

      // Keep recently completed tasks visible based on org setting (only successful ones, not cancelled/failed)
      const displayMinutes = freshOrg.completedTaskDisplayMinutes || 10;
      const displayCutoff = new Date(Date.now() - displayMinutes * 60 * 1000);
      // Keep intermediate tasks visible based on org setting (default 60 minutes)
      const intermediateDisplayMinutes = freshOrg.intermediateTaskDisplayMinutes || 15;
      const intermediateCutoff = new Date(Date.now() - intermediateDisplayMinutes * 60 * 1000);
      // Statuses that always indicate active work
      const alwaysActiveStatuses = ["queued", "claimed", "environment_setup", "executing", "planning", "pending_plan_approval", "dispatching", "reviewing", "consolidating"];
      // Intermediate statuses that should only show if recent (configurable, default 60 min)
      const intermediateStatuses = [
        "pr_created", "review_requested", "manager_review", "review_pending",
        "pr_approved", "review_approved", "deploying", "deployment_pending",
        "revision_needed", "awaiting_destructive_approval", "escalated",
        "pending_plan_approval"
      ];
      const activeTasks = allTasks.filter((t) => {
        // Always show tasks in truly active statuses
        if (alwaysActiveStatuses.includes(t.status)) {
          return true;
        }
        // Show intermediate statuses only if recent (based on org setting)
        // Use updatedAt (when status changed) — NOT startedAt
        if (intermediateStatuses.includes(t.status)) {
          const taskTime = t.updatedAt || t.createdAt;
          return taskTime && new Date(taskTime) > intermediateCutoff;
        }
        // Show completed/failed/terminal tasks within the display period
        if (["completed", "deployed", "failed"].includes(t.status) &&
            t.completedAt && new Date(t.completedAt) > displayCutoff) {
          return true;
        }
        return false;
      });

      // Sort tasks: group PRD parent tasks with their children (children below parent)
      const sortedActiveTasks = sortTasksWithPrdGrouping(activeTasks);
      activeTasks.length = 0;
      activeTasks.push(...sortedActiveTasks);

      // Combined for other uses
      const activeStatuses = [...alwaysActiveStatuses, ...intermediateStatuses];
      // "Done" = terminal success + approved (work finished, PR approved)
      const doneStatuses = ["completed", "deployed", "pr_approved", "review_approved"];
      const completedSinceReset = tasksSinceReset.filter(
        (t) => doneStatuses.includes(t.status)
      );
      const failedSinceReset = tasksSinceReset.filter(
        (t) => t.status === "failed" && t.completedAt
      );

      const periodCost = [...completedSinceReset, ...failedSinceReset].reduce(
        (sum, t) => sum + (Number(t.estimatedCostUsd) || 0),
        0
      );

      // "Active" = tasks where a worker is actually executing (not queued, not waiting)
      const executingStatuses = ["claimed", "environment_setup", "executing", "planning", "dispatching", "pending_plan_approval", "reviewing", "consolidating"];
      const stats = {
        totalWorkers: 7,
        activeWorkers: allTasks.filter(t => executingStatuses.includes(t.status)).length,
        queueDepth: allTasks.filter((t) => t.status === "queued").length,
        periodCost,
        periodCompleted: completedSinceReset.length,
        periodFailed: failedSinceReset.length,
      };

      // Include actively running tasks AND recently completed tasks (within display period)
      // Include queued tasks so they stay visible when PRD plan is approved
      const filteredTasks = allTasks.filter((t) => {
        // Always show tasks in active statuses (including queued)
        if (alwaysActiveStatuses.includes(t.status)) {
          return true;
        }
        // Show intermediate statuses only if recent (based on org setting)
        // Use updatedAt (when status changed) — NOT startedAt
        if (intermediateStatuses.includes(t.status)) {
          const taskTime = t.updatedAt || t.createdAt;
          return taskTime && new Date(taskTime) > intermediateCutoff;
        }
        // Show completed/failed/deployed tasks within the display period
        if (["completed", "deployed", "failed"].includes(t.status) &&
            t.completedAt && new Date(t.completedAt) > displayCutoff) {
          return true;
        }
        return false;
      });

      // Sort with PRD grouping, then limit to 10
      const filteredRunningTasks = sortTasksWithPrdGrouping(filteredTasks).slice(0, 10);

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

      // Fetch Ralph progress, checkpoint data, and Epic progress for running tasks in parallel
      const runningTasks = await Promise.all(
        filteredRunningTasks.map(async (task) => {
          const [ralphData, checkpointData, epicProgressData] = await Promise.all([
            fetchRalphProgressForTask(task.id),
            fetchCheckpointForTask(task.id),
            fetchEpicProgressForTask(task),
          ]);
          return formatTaskData(task, ralphData, checkpointData, epicProgressData || undefined, freshOrg.maxReviewRevisions, cardContextMap.get(task.id) ?? null);
        })
      );

      const queuedTasks = allTasks
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
          maxReviewRevisions: freshOrg.maxReviewRevisions ?? 3,
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

      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      logger.error("Error sending SSE update", { error, orgId: org.id });
    }
  };

  // Send initial update
  await sendUpdate();

  // Send updates every 5 seconds
  const interval = setInterval(sendUpdate, 5000);

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
    } catch (error) {
      logger.error("Error sending cost SSE event", { error, taskId: event.taskId });
    }
  });

  // Clean up on disconnect
  req.on("close", () => {
    clearInterval(interval);
    unsubscribeCost();
  });
});

export default router;
