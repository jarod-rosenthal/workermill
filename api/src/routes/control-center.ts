import { Router, Request, Response } from "express";
import { authenticateUser } from "../middleware/auth.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask, Organization } from "../models/index.js";
import { logger } from "../utils/logger.js";

const router = Router();

/**
 * GET /api/control-center
 * Get control center dashboard data
 */
router.get("/", authenticateUser, async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const taskRepo = AppDataSource.getRepository(WorkerTask);

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
    const activeTasks = allTasks.filter((t) =>
      ["queued", "claimed", "executing", "environment_setup"].includes(t.status)
    );
    const completedSinceReset = tasksSinceReset.filter(
      (t) => t.status === "completed" && t.completedAt
    );
    const failedSinceReset = tasksSinceReset.filter(
      (t) => t.status === "failed" && t.completedAt
    );

    const periodCost = [...completedSinceReset, ...failedSinceReset].reduce(
      (sum, t) => sum + (t.estimatedCostUsd || 0),
      0
    );
    const cumulativeCost = tasksSinceReset.reduce(
      (sum, t) => sum + (t.estimatedCostUsd || 0),
      0
    );

    // Build response
    const stats = {
      totalWorkers: 7,
      activeWorkers: activeTasks.length > 0 ? 1 : 0,
      queueDepth: allTasks.filter((t) => t.status === "queued").length,
      periodCost,
      periodCompleted: completedSinceReset.length,
      periodFailed: failedSinceReset.length,
      cumulativeCost,
      countersResetAt: org.countersResetAt?.toISOString() || null,
    };

    // Mock workers (personas available)
    const workers = [
      {
        id: "frontend_developer",
        displayName: "Frontend Developer",
        persona: "frontend_developer",
        status: "idle",
        tasksCompleted: allTasks.filter(
          (t) => t.workerPersona === "frontend_developer" && t.status === "completed"
        ).length,
        tasksFailed: allTasks.filter(
          (t) => t.workerPersona === "frontend_developer" && t.status === "failed"
        ).length,
        totalCostUsd: allTasks
          .filter((t) => t.workerPersona === "frontend_developer")
          .reduce((sum, t) => sum + (t.estimatedCostUsd || 0), 0),
        currentTask: null,
      },
      {
        id: "backend_developer",
        displayName: "Backend Developer",
        persona: "backend_developer",
        status: "idle",
        tasksCompleted: allTasks.filter(
          (t) => t.workerPersona === "backend_developer" && t.status === "completed"
        ).length,
        tasksFailed: allTasks.filter(
          (t) => t.workerPersona === "backend_developer" && t.status === "failed"
        ).length,
        totalCostUsd: allTasks
          .filter((t) => t.workerPersona === "backend_developer")
          .reduce((sum, t) => sum + (t.estimatedCostUsd || 0), 0),
        currentTask: null,
      },
      {
        id: "devops_engineer",
        displayName: "DevOps Engineer",
        persona: "devops_engineer",
        status: "idle",
        tasksCompleted: allTasks.filter(
          (t) => t.workerPersona === "devops_engineer" && t.status === "completed"
        ).length,
        tasksFailed: allTasks.filter(
          (t) => t.workerPersona === "devops_engineer" && t.status === "failed"
        ).length,
        totalCostUsd: allTasks
          .filter((t) => t.workerPersona === "devops_engineer")
          .reduce((sum, t) => sum + (t.estimatedCostUsd || 0), 0),
        currentTask: null,
      },
    ];

    // Separate queued tasks from actually running tasks
    const queuedTasks = allTasks.filter((t) => t.status === "queued");
    const runningTasks = allTasks.filter((t) =>
      ["claimed", "executing", "environment_setup"].includes(t.status)
    );

    // Format task data helper
    const formatTaskData = (task: WorkerTask) => ({
      id: task.id,
      jiraIssueKey: task.jiraIssueKey,
      summary: task.summary,
      status: task.status,
      workerName: task.workerPersona || "Unknown",
      workerPersona: task.workerPersona || "backend_developer",
      workerModel: task.workerModel,
      retryCount: task.retryCount || 0,
      maxRetries: task.maxRetries || 3,
      estimatedCostUsd: task.estimatedCostUsd || 0,
      startedAt: task.startedAt,
      createdAt: task.createdAt,
      hasPr: !!task.githubPrUrl,
      githubPrUrl: task.githubPrUrl,
      githubRepo: task.githubRepo,
      recentLogs: [],
      steps: [
        { name: "Setup", status: task.status === "environment_setup" ? "active" : task.status === "queued" ? "pending" : "done" },
        { name: "Execute", status: task.status === "executing" ? "active" : ["environment_setup", "queued"].includes(task.status) ? "pending" : "done" },
        { name: "Review", status: "pending" },
        { name: "Complete", status: "pending" },
      ],
    });

    // Format active tasks (actually running, not queued)
    const activeTasksData = runningTasks.slice(0, 10).map(formatTaskData);

    // Format queued tasks
    const queuedTasksData = queuedTasks.slice(0, 20).map(formatTaskData);

    // Format recent completed
    const recentCompleted = allTasks
      .filter((t) => ["completed", "failed", "cancelled"].includes(t.status))
      .slice(0, 10)
      .map((task) => ({
        id: task.id,
        jiraIssueKey: task.jiraIssueKey,
        summary: task.summary,
        status: task.status,
        workerModel: task.workerModel,
        costUsd: task.estimatedCostUsd || 0,
        durationMinutes: task.startedAt && task.completedAt
          ? Math.round((new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 60000)
          : null,
        completedAt: task.completedAt?.toISOString() || new Date().toISOString(),
        githubPrUrl: task.githubPrUrl,
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
      ["completed", "failed", "cancelled"].includes(t.status)
    );
    const approvedTasks = tasksSinceReset.filter((t) => t.status === "completed");
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
