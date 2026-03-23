import { Router, Request, Response } from "express";
import { authenticateRequest, authenticateUser } from "../../middleware/auth.js";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask, Organization, KbCard } from "../../models/index.js";
import { logger } from "../../utils/logger.js";
import {
  formatTaskData,
  sortTasksWithPrdGrouping,
  fetchRalphProgressForTask,
  fetchCheckpointForTask,
  fetchEpicProgressForTask,
  calculateCheckpointMetrics,
} from "./helpers.js";

const router = Router();

/**
 * GET /api/control-center
 * Get control center dashboard data
 * Supports both JWT (Bearer token) and API key (x-api-key header) authentication
 */
router.get("/", authenticateRequest, async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Debug: count ALL tasks in database to diagnose org mismatch
    const totalTasksInDb = await taskRepo.count();
    const tasksForUserOrg = await taskRepo.count({ where: { orgId: org.id } });

    logger.info("Control center request - org diagnosis", {
      userOrgId: org.id,
      userOrgName: org.name,
      userId: req.user?.id,
      totalTasksInDb,
      tasksForUserOrg,
      mismatch: totalTasksInDb > 0 && tasksForUserOrg === 0 ? "LIKELY ORG MISMATCH" : "ok"
    });

    // Use counters reset date for filtering (all counters persist until manually reset)
    const countersResetAt = org.countersResetAt || new Date(0);

    // Get all tasks for this org
    const allTasks = await taskRepo.find({
      where: { orgId: org.id },
      order: { createdAt: "DESC" },
    });

    // Filter tasks to only those since last reset
    const tasksSinceReset = allTasks.filter(
      (t) => new Date(t.createdAt) >= countersResetAt
    );

    // Calculate stats
    // Keep recently completed/waiting tasks visible based on org setting (default 10 minutes)
    const displayMinutes = org.completedTaskDisplayMinutes || 10;
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
    const activeTasks = allTasks.filter((t) => {
      // Always show tasks in truly active statuses
      if (alwaysActiveStatuses.includes(t.status)) {
        return true;
      }
      // Show intermediate statuses only if recent (based on org setting)
      // Use updatedAt (when status changed) — NOT startedAt, which would hide
      // tasks that took longer than the timeout to execute.
      if (intermediateStatuses.includes(t.status)) {
        const taskTime = t.updatedAt || t.createdAt;
        return taskTime && new Date(taskTime) > intermediateCutoff;
      }
      // Show completed/deployed/failed tasks within the display period
      // Failed tasks are important to see so users know what went wrong
      if (["completed", "deployed", "failed", "cancelled"].includes(t.status) &&
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
    const cumulativeCost = tasksSinceReset.reduce(
      (sum, t) => sum + (Number(t.estimatedCostUsd) || 0),
      0
    );

    // Calculate checkpoint metrics
    const checkpointMetrics = calculateCheckpointMetrics(allTasks);

    // Build response
    // "Active" = tasks where a worker is actually executing (not queued, not waiting)
    const executingStatuses = ["claimed", "environment_setup", "executing", "planning", "dispatching", "pending_plan_approval", "reviewing", "consolidating", "integration_check"];
    const stats = {
      totalWorkers: 7,
      activeWorkers: allTasks.filter(t => executingStatuses.includes(t.status)).length,
      queueDepth: allTasks.filter((t) => t.status === "queued").length,
      periodCost,
      periodCompleted: completedSinceReset.length,
      periodFailed: failedSinceReset.length,
      cumulativeCost,
      countersResetAt: org.countersResetAt?.toISOString() || null,
      // Checkpoint metrics (Phase 6)
      checkpoints: checkpointMetrics,
    };

    // Get worker stats via SQL aggregation (single query instead of N+1)
    const workerStatsRaw = await taskRepo
      .createQueryBuilder("task")
      .select("task.workerPersona", "persona")
      .addSelect("COUNT(CASE WHEN task.status = 'completed' OR task.status = 'deployed' THEN 1 END)", "completed")
      .addSelect("COUNT(CASE WHEN task.status = 'failed' THEN 1 END)", "failed")
      .addSelect("COUNT(CASE WHEN task.status IN ('queued', 'claimed', 'executing', 'environment_setup', 'planning', 'dispatching', 'pending_plan_approval') THEN 1 END)", "active")
      .addSelect("COALESCE(SUM(task.estimatedCostUsd), 0)", "totalCost")
      .where("task.orgId = :orgId", { orgId: org.id })
      .groupBy("task.workerPersona")
      .getRawMany();

    // Convert raw stats to a lookup map
    const workerStatsMap = new Map<string, { completed: number; failed: number; active: number; totalCost: number }>();
    for (const row of workerStatsRaw) {
      workerStatsMap.set(row.persona, {
        completed: parseInt(row.completed) || 0,
        failed: parseInt(row.failed) || 0,
        active: parseInt(row.active) || 0,
        totalCost: parseFloat(row.totalCost) || 0,
      });
    }

    // Build workers array with stats from aggregated query
    const personaList = [
      { id: "frontend_developer", displayName: "Frontend Developer" },
      { id: "backend_developer", displayName: "Backend Developer" },
      { id: "devops_engineer", displayName: "DevOps Engineer" },
    ];

    const workers = personaList.map((p) => {
      const stats = workerStatsMap.get(p.id) || { completed: 0, failed: 0, active: 0, totalCost: 0 };
      return {
        id: p.id,
        displayName: p.displayName,
        persona: p.id,
        status: stats.active > 0 ? "active" : "idle",
        tasksCompleted: stats.completed,
        tasksFailed: stats.failed,
        totalCostUsd: stats.totalCost,
        currentTask: null,
      };
    });

    // Keep queued tasks for separate display in queue section
    const queuedTasks = allTasks.filter((t) => t.status === "queued");
    // IMPORTANT: This filter MUST match the SSE endpoint's runningTasks filter exactly
    // to prevent "flash then disappear" bugs on page refresh
    // Include queued tasks so they stay visible when PRD plan is approved
    const runningTasks = allTasks.filter((t) => {
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
      // Show completed/failed/deployed/cancelled tasks within the display period
      if (
        ["completed", "deployed", "failed", "cancelled"].includes(t.status) &&
        t.completedAt &&
        new Date(t.completedAt) > displayCutoff
      ) {
        return true;
      }
      return false;
    });

    // Sort tasks: group PRD parent tasks with their children (children below parent)
    const sortedRunningTasks = sortTasksWithPrdGrouping(runningTasks);
    runningTasks.length = 0;
    runningTasks.push(...sortedRunningTasks);

    // Batch-fetch card context for internal board cards (for direct links)
    const allTaskIds = [...runningTasks, ...queuedTasks, ...allTasks].map((t) => t.id);
    const cardContextMap = new Map<string, { boardId: string; cardId: string }>();
    if (allTaskIds.length > 0) {
      const cardRows = await AppDataSource.getRepository(KbCard)
        .createQueryBuilder("card")
        .select(["card.workerTaskId", "card.boardId", "card.id"])
        .where("card.workerTaskId IN (:...taskIds)", { taskIds: allTaskIds })
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

    // Format active tasks - uses shared formatTaskData
    // Fetch Ralph progress, checkpoint data, and Epic progress for active tasks in parallel
    const activeTasksWithRalph = await Promise.all(
      runningTasks.slice(0, 10).map(async (task) => {
        const [ralphData, checkpointData, epicProgressData] = await Promise.all([
          fetchRalphProgressForTask(task.id),
          fetchCheckpointForTask(task.id),
          fetchEpicProgressForTask(task),
        ]);
        return formatTaskData(task, ralphData, checkpointData, epicProgressData || undefined, org.maxReviewRevisions, cardContextMap.get(task.id) ?? null);
      })
    );
    const activeTasksData = activeTasksWithRalph;

    // Format queued tasks (also fetch Epic progress for queued Epic workflows)
    const queuedTasksData = await Promise.all(
      queuedTasks.slice(0, 20).map(async (task) => {
        const epicProgressData = await fetchEpicProgressForTask(task);
        return formatTaskData(task, undefined, undefined, epicProgressData || undefined, org.maxReviewRevisions, cardContextMap.get(task.id) ?? null);
      })
    );

    // Format all tasks (includes running, queued, and completed)
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
        durationMinutes: task.startedAt && task.completedAt
          ? Math.round((new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 60000)
          : null,
        startedAt: task.startedAt?.toISOString() || null,
        createdAt: task.createdAt?.toISOString() || new Date().toISOString(),
        completedAt: task.completedAt?.toISOString() || null,
        githubPrUrl: task.githubPrUrl,
        claimedByAgent: task.claimedByAgent || null,
        // Workflow mode fields
        workflowMode: task.getWorkflowMode(),
        workflowModeName: task.getWorkflowModeName(),
        deploymentEnabled: task.deploymentEnabled,
        skipManagerReview: task.skipManagerReview,
        managerEnabled: task.managerEnabled,
        ecsTaskId: task.ecsTaskId,
        retryCount: task.retryCount || 0,
        revisionCount: task.revisionCount || 0,
        maxReviewRevisions: org.maxReviewRevisions,
        errorMessage: task.errorMessage || null,
        lastHeartbeatAt: task.lastHeartbeatAt?.toISOString() || null,
        // Checkpoint info
        hasCheckpoint: false,
        checkpointStage: null,
        resumeCount: 0,
        checkpointSavedAt: null,
        // Quality metrics
        qualityScore: task.qualityScore ?? null,
        qualityGrade: task.getQualityGrade() ?? null,
        // Internal board card context (for direct link to card)
        cardBoardId: cardContextMap.get(task.id)?.boardId ?? null,
        cardId: cardContextMap.get(task.id)?.cardId ?? null,
      }));

    // System settings from org
    const systemStatus = {
      systemEnabled: org.systemEnabled,
      orchestrator: { running: org.orchestratorRunning, desiredCount: 1 },
      executors: { running: 0 },
    };

    const watcherStatus = {
      enabled: org.watcherEnabled,
      lastRunAt: null,
      stuckTasks: 0,
      pendingRetries: 0,
    };

    // Calculate manager stats from tasks since reset
    const reviewedTasks = tasksSinceReset.filter((t) =>
      ["completed", "deployed", "failed", "cancelled"].includes(t.status)
    );
    const approvedTasks = tasksSinceReset.filter((t) => t.status === "completed" || t.status === "deployed");
    const rejectedTasks = tasksSinceReset.filter((t) => t.status === "failed");

    // Calculate average duration for completed tasks since reset
    const completedWithDuration = completedSinceReset.filter(
      (t) => t.startedAt && t.completedAt
    );
    const avgDurationSeconds = completedWithDuration.length > 0
      ? completedWithDuration.reduce((sum, t) => {
          const duration = (new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()) / 1000;
          return sum + duration;
        }, 0) / completedWithDuration.length
      : 0;

    // Calculate manager cost (subset of total - for now use 10% as estimate)
    const managerCost = tasksSinceReset.reduce(
      (sum, t) => sum + (t.estimatedCostUsd || 0) * 0.1,
      0
    );

    const managerStatus = {
      enabled: org.managerEnabled,
      modelId: org.managerModelId,
      reviewCount: reviewedTasks.length,
      approvalRate: reviewedTasks.length > 0
        ? Math.round((approvedTasks.length / reviewedTasks.length) * 100)
        : 100,
      queue: {
        awaitingReview: 0,
        underReview: 0,
        revisionNeeded: 0,
      },
      stats: {
        totalReviews: reviewedTasks.length,
        approved: approvedTasks.length,
        rejected: rejectedTasks.length,
        revisionsRequested: 0,
        avgDurationSeconds: Math.round(avgDurationSeconds),
        totalCost: managerCost,
      },
    };

    // Prevent browser caching - always return fresh data
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });

    // Debug: Log what we're returning to help trace stale data issues
    logger.info("GET /api/control-center response", {
      orgId: org.id,
      activeTaskCount: activeTasksData.length,
      queuedTaskCount: queuedTasksData.length,
      activeTaskIds: activeTasksData.map((t: { id: string; jiraIssueKey: string | null; status: string }) => ({ id: t.id, key: t.jiraIssueKey, status: t.status })),
      queuedTaskIds: queuedTasksData.map((t: { id: string; jiraIssueKey: string | null }) => ({ id: t.id, key: t.jiraIssueKey })),
    });

    res.json({
      stats,
      workers,
      activeTasks: activeTasksData,
      queuedTasks: queuedTasksData,
      recentCompleted,
      systemStatus,
      watcherStatus,
      managerStatus,
    });
  } catch (error) {
    logger.error("Error fetching control center data", { error });
    res.status(500).json({ error: "Failed to fetch control center data" });
  }
});

/**
 * POST /api/control-center/reset-counters
 * Reset all cumulative counters
 */
router.post("/reset-counters", authenticateUser, async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const orgRepo = AppDataSource.getRepository(Organization);

    org.countersResetAt = new Date();
    await orgRepo.save(org);

    logger.info("Counters reset", { orgId: org.id, resetAt: org.countersResetAt });
    res.json({
      success: true,
      message: "All counters have been reset",
      countersResetAt: org.countersResetAt.toISOString(),
    });
  } catch (error) {
    logger.error("Failed to reset counters", { error });
    res.status(500).json({ error: "Failed to reset counters" });
  }
});

export default router;
