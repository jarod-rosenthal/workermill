import { Router, Request, Response } from "express";
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { authenticateUser, authenticateSSE, authenticateRequest, authenticateApiKey } from "../middleware/auth.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask, Organization, WorkerTaskLog, type WorkflowMode } from "../models/index.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";

// CloudWatch Logs client
const cloudwatchLogs = new CloudWatchLogsClient({ region: config.aws.region });

const router = Router();

/**
 * Helper: Get task step progress based on status and workflow mode
 * Different workflows have different steps:
 * - Default: Queue → Execute → Review Requested → Deploy → Complete
 * - Review: Queue → Execute → Manager Review → (Revisions) → Deploy → Complete
 * - Auto-deploy: Queue → Execute → Deploy → PR → Complete
 * - Manager: Same as default but with environment analysis step
 */
function getTaskSteps(
  status: string,
  workflowMode: WorkflowMode,
  revisionCount: number = 0,
): Array<{ name: string; icon: string; status: "done" | "active" | "pending" }> {
  // Define steps based on workflow mode
  let steps: Array<{ name: string; icon: string; statuses: string[] }>;

  switch (workflowMode) {
    case "auto_deploy":
    case "deploy_manager":
      // Auto-deploy: No review step, deploy immediately
      steps = [
        { name: "Queued", icon: "queued", statuses: ["queued", "claimed"] },
        { name: "Executing", icon: "executing", statuses: ["environment_setup", "executing"] },
        { name: "Deploying", icon: "deploying", statuses: ["deploying"] },
        { name: "PR & Merge", icon: "pr_created", statuses: ["pr_created"] },
        { name: "Completed", icon: "complete", statuses: ["deployed", "completed"] },
      ];
      break;

    case "review":
    case "review_manager":
      // Review workflow: Manager reviews PR, revision loop possible
      steps = [
        { name: "Queued", icon: "queued", statuses: ["queued", "claimed"] },
        { name: "Executing", icon: "executing", statuses: ["environment_setup", "executing"] },
        { name: "PR Created", icon: "pr_created", statuses: ["pr_created"] },
        {
          name: revisionCount > 0 ? `Manager Review (${revisionCount}/3)` : "Manager Review",
          icon: "manager_review",
          statuses: ["manager_review", "revision_needed"]
        },
        { name: "Approved", icon: "approved", statuses: ["pr_approved", "review_approved"] },
        { name: "Deploy & Merge", icon: "deploying", statuses: ["deploying", "deployed", "completed"] },
      ];
      break;

    case "manager":
      // Manager workflow: Environment analysis after execution
      steps = [
        { name: "Queued", icon: "queued", statuses: ["queued", "claimed"] },
        { name: "Executing", icon: "executing", statuses: ["environment_setup", "executing"] },
        { name: "PR Created", icon: "pr_created", statuses: ["pr_created", "review_requested"] },
        { name: "Awaiting Review", icon: "waiting", statuses: ["pr_approved"] },
        { name: "Deploy & Merge", icon: "deploying", statuses: ["deploying", "deployed", "completed"] },
      ];
      break;

    default:
      // Default workflow: Human review on GitHub
      steps = [
        { name: "Queued", icon: "queued", statuses: ["queued", "claimed"] },
        { name: "Executing", icon: "executing", statuses: ["environment_setup", "executing"] },
        { name: "PR Created", icon: "pr_created", statuses: ["pr_created"] },
        { name: "Awaiting Review", icon: "waiting", statuses: ["review_requested"] },
        { name: "Approved", icon: "approved", statuses: ["pr_approved"] },
        { name: "Deploy & Merge", icon: "deploying", statuses: ["deploying", "deployed", "completed"] },
      ];
      break;
  }

  // Handle terminal failure/rejection states
  if (status === "failed" || status === "cancelled" || status === "review_rejected") {
    return steps.map((step, index) => ({
      name: step.name,
      icon: step.icon,
      status: index === 0 ? "done" : "pending" as const,
    }));
  }

  // Find current step index
  let currentStepIndex = -1;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].statuses.includes(status)) {
      currentStepIndex = i;
      break;
    }
  }

  return steps.map((step, index) => {
    const isActive = step.statuses.includes(status);
    const isDone = currentStepIndex >= 0 && index < currentStepIndex;

    return {
      name: step.name,
      icon: step.icon,
      status: isActive ? "active" : isDone ? "done" : "pending",
    };
  });
}

/**
 * Format task data for dashboard display
 * Shared between GET and SSE endpoints
 */
function formatTaskData(task: WorkerTask) {
  // Get workflow mode and generate steps accordingly
  const workflowMode = task.getWorkflowMode();
  const steps = getTaskSteps(task.status, workflowMode, task.revisionCount || 0);

  return {
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
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    ecsTaskId: task.ecsTaskId,
    hasPr: !!task.githubPrUrl,
    githubPrUrl: task.githubPrUrl,
    githubPrNumber: task.githubPrNumber,
    githubRepo: task.githubRepo,
    // Workflow info
    workflowMode,
    workflowModeName: task.getWorkflowModeName(),
    deploymentEnabled: task.deploymentEnabled,
    skipManagerReview: task.skipManagerReview,
    managerEnabled: task.managerEnabled || false,
    revisionCount: task.revisionCount || 0,
    reviewFeedback: task.reviewFeedback || null,
    // Manager task info (for showing Virtual Manager in UI)
    managerEcsTaskId: task.managerEcsTaskId || null,
    recentLogs: [],
    steps,
  };
}

/**
 * GET /api/control-center
 * Get control center dashboard data
 */
router.get("/", authenticateUser, async (req: Request, res: Response) => {
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
    // Keep recently completed tasks visible based on org setting (default 10 minutes)
    const displayMinutes = org.completedTaskDisplayMinutes || 10;
    const displayCutoff = new Date(Date.now() - displayMinutes * 60 * 1000);
    // Statuses that always indicate active work
    const alwaysActiveStatuses = ["queued", "claimed", "environment_setup", "executing"];
    // Intermediate statuses that should only show if recent (within 1 hour)
    const intermediateStatuses = [
      "pr_created", "review_requested", "manager_review", "review_pending",
      "pr_approved", "review_approved", "deploying", "deployment_pending",
      "revision_needed", "awaiting_destructive_approval"
    ];
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const activeTasks = allTasks.filter((t) => {
      // Always show tasks in truly active statuses
      if (alwaysActiveStatuses.includes(t.status)) {
        return true;
      }
      // Show intermediate statuses only if created/updated within the last hour
      if (intermediateStatuses.includes(t.status)) {
        const taskTime = t.startedAt || t.createdAt;
        return taskTime && new Date(taskTime) > oneHourAgo;
      }
      // Show completed/terminal tasks within the display period
      if (t.completedAt && new Date(t.completedAt) > displayCutoff) {
        return true;
      }
      return false;
    });
    // Combined for other uses
    const activeStatuses = [...alwaysActiveStatuses, ...intermediateStatuses];
    const completedSinceReset = tasksSinceReset.filter(
      (t) => t.status === "completed" && t.completedAt
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
    const runningStatuses = activeStatuses.filter(s => s !== "queued");
    const runningTasks = allTasks.filter((t) =>
      runningStatuses.includes(t.status) ||
      (["completed", "deployed"].includes(t.status) && t.completedAt && new Date(t.completedAt) > displayCutoff)
    );

    // Format active tasks (actually running, not queued) - uses shared formatTaskData
    const activeTasksData = runningTasks.slice(0, 10).map(formatTaskData);

    // Format queued tasks
    const queuedTasksData = queuedTasks.slice(0, 20).map(formatTaskData);

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
        costUsd: Number(task.estimatedCostUsd) || 0,
        durationMinutes: task.startedAt && task.completedAt
          ? Math.round((new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 60000)
          : null,
        createdAt: task.createdAt?.toISOString() || new Date().toISOString(),
        completedAt: task.completedAt?.toISOString() || null,
        githubPrUrl: task.githubPrUrl,
        // Workflow mode fields
        workflowMode: task.getWorkflowMode(),
        workflowModeName: task.getWorkflowModeName(),
        deploymentEnabled: task.deploymentEnabled,
        managerEnabled: task.managerEnabled,
        ecsTaskId: task.ecsTaskId,
        retryCount: task.retryCount || 0,
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

/**
 * POST /api/control-center/tasks/:id/approve
 * Manually approve a task for deployment (simulates PR approval)
 * Only works for tasks in review_requested status
 */
router.post("/tasks/:id/approve", authenticateRequest, async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const taskId = req.params.id as string;
    const { approvedBy } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (task.status !== "review_requested") {
      res.status(400).json({
        error: "Task cannot be approved",
        reason: `Task is in ${task.status} status, must be in review_requested`,
      });
      return;
    }

    // Set up for deployment run and re-queue
    task.status = "queued";
    task.githubApprovedBy = approvedBy || "manual_approval";
    task.taskNotes = `DEPLOYMENT_RUN: PR #${task.githubPrNumber || "?"} approved by ${task.githubApprovedBy}. Deploy and merge.`;
    task.completedAt = null;
    task.ecsTaskArn = null;
    task.ecsTaskId = null;
    task.startedAt = null;

    await taskRepo.save(task);

    logger.info("Task manually approved for deployment", {
      taskId,
      approvedBy: task.githubApprovedBy,
      jiraIssueKey: task.jiraIssueKey,
    });

    res.json({
      status: "approved",
      taskId,
      newStatus: "queued",
      message: "Task approved and re-queued for deployment run",
    });
  } catch (error) {
    logger.error("Error approving task", { error, taskId: req.params.id });
    res.status(500).json({ error: "Failed to approve task" });
  }
});

/**
 * GET /api/control-center/stream
 * SSE stream for real-time dashboard updates
 */
router.get("/stream", authenticateSSE, async (req: Request, res: Response) => {
  const org = req.organization!;

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
      const countersResetAt = org.countersResetAt || new Date(0);

      const allTasks = await taskRepo.find({
        where: { orgId: org.id },
        order: { createdAt: "DESC" },
      });

      const tasksSinceReset = allTasks.filter(
        (t) => new Date(t.createdAt) >= countersResetAt
      );

      // Keep recently completed tasks visible based on org setting (only successful ones, not cancelled/failed)
      const displayMinutes = org.completedTaskDisplayMinutes || 10;
      const displayCutoff = new Date(Date.now() - displayMinutes * 60 * 1000);
      // Statuses that always indicate active work
      const alwaysActiveStatuses = ["queued", "claimed", "environment_setup", "executing"];
      // Intermediate statuses that should only show if recent (within 1 hour)
      const intermediateStatuses = [
        "pr_created", "review_requested", "manager_review", "review_pending",
        "pr_approved", "review_approved", "deploying", "deployment_pending",
        "revision_needed", "awaiting_destructive_approval"
      ];
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const activeTasks = allTasks.filter((t) => {
        // Always show tasks in truly active statuses
        if (alwaysActiveStatuses.includes(t.status)) {
          return true;
        }
        // Show intermediate statuses only if created/updated within the last hour
        if (intermediateStatuses.includes(t.status)) {
          const taskTime = t.startedAt || t.createdAt;
          return taskTime && new Date(taskTime) > oneHourAgo;
        }
        // Show completed/terminal tasks within the display period
        if (["completed", "deployed"].includes(t.status) &&
            t.completedAt && new Date(t.completedAt) > displayCutoff) {
          return true;
        }
        return false;
      });
      // Combined for other uses
      const activeStatuses = [...alwaysActiveStatuses, ...intermediateStatuses];
      const completedSinceReset = tasksSinceReset.filter(
        (t) => t.status === "completed" && t.completedAt
      );
      const failedSinceReset = tasksSinceReset.filter(
        (t) => t.status === "failed" && t.completedAt
      );

      const periodCost = [...completedSinceReset, ...failedSinceReset].reduce(
        (sum, t) => sum + (Number(t.estimatedCostUsd) || 0),
        0
      );

      const stats = {
        totalWorkers: 7,
        activeWorkers: activeTasks.length > 0 ? activeTasks.filter(t => t.status !== "queued").length : 0,
        queueDepth: allTasks.filter((t) => t.status === "queued").length,
        periodCost,
        periodCompleted: completedSinceReset.length,
        periodFailed: failedSinceReset.length,
      };

      // Include actively running tasks AND recently completed tasks (within display period, success only)
      // Exclude queued tasks - they go in queuedTasks
      const alwaysRunningStatuses = alwaysActiveStatuses.filter(s => s !== "queued");
      const runningTasks = allTasks
        .filter((t) => {
          // Always show executing tasks
          if (alwaysRunningStatuses.includes(t.status)) {
            return true;
          }
          // Show intermediate statuses only if recent (within 1 hour)
          if (intermediateStatuses.includes(t.status)) {
            const taskTime = t.startedAt || t.createdAt;
            return taskTime && new Date(taskTime) > oneHourAgo;
          }
          // Show completed/deployed tasks within the display period
          if (["completed", "deployed"].includes(t.status) &&
              t.completedAt && new Date(t.completedAt) > displayCutoff) {
            return true;
          }
          return false;
        })
        .slice(0, 10)
        .map(formatTaskData);

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
          costUsd: Number(task.estimatedCostUsd) || 0,
          createdAt: task.createdAt?.toISOString(),
          completedAt: task.completedAt?.toISOString() || null,
          githubPrUrl: task.githubPrUrl,
          ecsTaskId: task.ecsTaskId,
          retryCount: task.retryCount || 0,
          // Workflow mode fields
          workflowMode: task.getWorkflowMode(),
          workflowModeName: task.getWorkflowModeName(),
          deploymentEnabled: task.deploymentEnabled,
          managerEnabled: task.managerEnabled,
        }));

      const data = {
        type: "update",
        timestamp: new Date().toISOString(),
        stats,
        activeTasks: runningTasks,
        queuedTasks,
        recentCompleted,
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

  // Clean up on disconnect
  req.on("close", () => {
    clearInterval(interval);
  });
});

/**
 * GET /api/control-center/logs/:taskId
 * REST endpoint for polling task logs (fallback when SSE disconnects)
 */
router.get("/logs/:taskId", authenticateRequest, async (req: Request, res: Response) => {
  try {
    const taskId = req.params.taskId as string;
    const org = req.organization!;
    const since = req.query.since ? String(req.query.since) : null;
    const limit = parseInt(req.query.limit as string) || 100;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);

    // Verify task belongs to org
    const task = await taskRepo.findOne({ where: { id: taskId, orgId: org.id } });
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Parse cursor if provided
    let whereClause: any = { taskId };
    if (since) {
      const cursor = parseCursor(since);
      if (cursor) {
        // Get logs after cursor position
        const logs = await logRepo
          .createQueryBuilder("log")
          .where("log.taskId = :taskId", { taskId })
          .andWhere(
            "(log.createdAt > :lastCreatedAt OR (log.createdAt = :lastCreatedAt AND log.id > :lastId))",
            { lastCreatedAt: cursor.lastCreatedAt, lastId: cursor.lastId }
          )
          .orderBy("log.createdAt", "ASC")
          .addOrderBy("log.id", "ASC")
          .take(limit)
          .getMany();

        res.json({
          taskId,
          taskStatus: task.status,
          logs: logs.map(formatLogForResponse),
        });
        return;
      }
    }

    // No cursor - get recent logs
    const logs = await logRepo.find({
      where: whereClause,
      order: { createdAt: "DESC" },
      take: limit,
    });

    res.json({
      taskId,
      taskStatus: task.status,
      logs: logs.reverse().map(formatLogForResponse),
    });
  } catch (error) {
    logger.error("Error fetching task logs", { error });
    res.status(500).json({ error: "Failed to fetch task logs" });
  }
});

/**
 * Parse cursor string (ISO timestamp|UUID format)
 */
function parseCursor(raw: string): { lastCreatedAt: Date; lastId: string } | null {
  if (!raw) return null;
  const parts = raw.split("|");
  if (parts.length !== 2) return null;
  const createdAt = new Date(parts[0]);
  if (Number.isNaN(createdAt.getTime())) return null;
  const id = parts[1];
  if (!id) return null;
  return { lastCreatedAt: createdAt, lastId: id };
}

/**
 * Format log for API response
 */
function formatLogForResponse(log: WorkerTaskLog) {
  const eventId = `${log.createdAt.toISOString()}|${log.id}`;
  return {
    id: log.id,
    timestamp: log.createdAt.toISOString(),
    type: log.type,
    message: log.message,
    severity: log.severity,
    command: log.command,
    exitCode: log.exitCode,
    filePath: log.filePath,
    durationMs: log.durationMs,
    cursor: eventId,
  };
}

/**
 * GET /api/control-center/logs/:taskId/all
 * Fetch all logs for a task (used by Manager for log analysis)
 * Uses API key authentication
 */
router.get("/logs/:taskId/all", authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const taskId = req.params.taskId as string;
    const org = req.organization!;
    const limit = req.query.limit ? parseInt(String(req.query.limit)) : 500;

    // Verify task belongs to org
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({ where: { id: taskId, orgId: org.id } });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Fetch all logs ordered by creation time
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);
    const logs = await logRepo.find({
      where: { taskId },
      order: { createdAt: "ASC" },
      take: limit,
    });

    res.json(logs.map((log) => ({
      id: log.id,
      type: log.type,
      message: log.message,
      severity: log.severity,
      createdAt: log.createdAt,
      command: log.command,
      exitCode: log.exitCode,
      stdout: log.stdout,
      stderr: log.stderr,
      filePath: log.filePath,
      durationMs: log.durationMs,
    })));
  } catch (error) {
    logger.error("Error fetching all logs", { error, taskId: req.params.taskId });
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

/**
 * GET /api/control-center/logs/:taskId/stream
 * SSE stream for real-time task logs from database
 * Supports cursor-based resume via Last-Event-ID header or 'since' query param
 */
router.get("/logs/:taskId/stream", authenticateSSE, async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const org = req.organization!;
  const since = req.query.since ? String(req.query.since) : null;

  // Verify task belongs to org
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  const task = await taskRepo.findOne({ where: { id: taskId, orgId: org.id } });

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Hint client how long to wait before reconnect attempts
  res.write("retry: 2000\n\n");

  let isConnected = true;
  let lastStatus = task.status;

  // Parse cursor from Last-Event-ID header (auto-managed by EventSource) or query param
  const lastEventIdHeader = req.headers["last-event-id"];
  const headerCursor = typeof lastEventIdHeader === "string" ? lastEventIdHeader : null;

  // Default to "now minus 5 minutes" to avoid sending huge history on fresh connect
  let cursor = (headerCursor ? parseCursor(headerCursor) : null)
    || (since ? parseCursor(since) : null)
    || {
      lastCreatedAt: new Date(Date.now() - 5 * 60 * 1000),
      lastId: "00000000-0000-0000-0000-000000000000",
    };

  req.on("close", () => {
    isConnected = false;
    logger.debug("Log stream client disconnected", { taskId });
  });

  // Send initial connection message with current cursor
  res.write(`data: ${JSON.stringify({
    type: "connected",
    taskId,
    status: task.status,
    cursor: `${cursor.lastCreatedAt.toISOString()}|${cursor.lastId}`,
  })}\n\n`);

  const logRepo = AppDataSource.getRepository(WorkerTaskLog);

  const sendLogs = async () => {
    if (!isConnected) return;

    try {
      // Check for status changes
      const currentTask = await taskRepo.findOne({ where: { id: taskId } });
      if (!currentTask) {
        res.write(`data: ${JSON.stringify({ type: "error", message: "Task not found" })}\n\n`);
        res.end();
        return;
      }

      if (currentTask.status !== lastStatus) {
        res.write(`data: ${JSON.stringify({ type: "status", status: currentTask.status })}\n\n`);
        lastStatus = currentTask.status;
      }

      // Query for new logs after cursor position (handles timestamp ties with ID comparison)
      const newLogs = await logRepo
        .createQueryBuilder("log")
        .where("log.taskId = :taskId", { taskId })
        .andWhere(
          "(log.createdAt > :lastCreatedAt OR (log.createdAt = :lastCreatedAt AND log.id > :lastId))",
          { lastCreatedAt: cursor.lastCreatedAt, lastId: cursor.lastId }
        )
        .orderBy("log.createdAt", "ASC")
        .addOrderBy("log.id", "ASC")
        .take(100)
        .getMany();

      // Send each log as a separate SSE event with event ID for resume
      for (const log of newLogs) {
        const eventId = `${log.createdAt.toISOString()}|${log.id}`;
        res.write(`id: ${eventId}\n`);
        res.write("event: log\n");
        res.write(`data: ${JSON.stringify({
          type: "log",
          id: log.id,
          timestamp: log.createdAt.toISOString(),
          logType: log.type,
          message: log.message,
          severity: log.severity,
          command: log.command,
          exitCode: log.exitCode,
          filePath: log.filePath,
          durationMs: log.durationMs,
          cursor: eventId,
        })}\n\n`);

        // Update cursor
        cursor = { lastCreatedAt: log.createdAt, lastId: log.id };
      }

      // Check if task is complete
      if (currentTask.isTerminal()) {
        res.write(`data: ${JSON.stringify({
          type: "complete",
          status: currentTask.status,
          timestamp: new Date().toISOString(),
        })}\n\n`);
        res.end();
      }
    } catch (error) {
      logger.error("Error in SSE log stream", { error, taskId });
    }
  };

  const sendPing = () => {
    if (!isConnected) return;
    res.write("event: ping\n");
    res.write("data: {}\n\n");
  };

  // Initial fetch
  await sendLogs();

  // Poll every 1 second for new logs (matches OnCallShift)
  let inFlight = false;
  const logInterval = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await sendLogs();
    } finally {
      inFlight = false;
    }
  }, 1000);

  // Ping every 20 seconds to keep connection alive
  const pingInterval = setInterval(sendPing, 20000);

  req.on("close", () => {
    clearInterval(logInterval);
    clearInterval(pingInterval);
  });
});

/**
 * POST /api/control-center/logs
 * Receive logs from the worker container
 * Used by the worker entrypoint to stream logs in real-time
 */
router.post("/logs", async (req: Request, res: Response) => {
  try {
    const { taskId, type, message, severity, command, exitCode, stdout, stderr, filePath, durationMs } = req.body;

    if (!taskId || !type || !message) {
      res.status(400).json({ error: "Missing required fields: taskId, type, message" });
      return;
    }

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);

    // Verify task exists
    const task = await taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Create and save log entry
    const logData = WorkerTaskLog.create(taskId, type, message, {
      severity: severity || "info",
      command,
      exitCode,
      stdout,
      stderr,
      filePath,
      durationMs,
    });

    const log = logRepo.create(logData);
    await logRepo.save(log);

    // Update task heartbeat
    task.lastHeartbeatAt = new Date();
    await taskRepo.save(task);

    res.status(201).json({
      id: log.id,
      taskId: log.taskId,
      timestamp: log.createdAt,
    });
  } catch (error) {
    logger.error("Error saving task log", { error });
    res.status(500).json({ error: "Failed to save log" });
  }
});

/**
 * GET /api/control-center/logs/:taskId/cloudwatch
 * SSE stream for real-time CloudWatch logs (actual container output)
 */
router.get("/logs/:taskId/cloudwatch", authenticateSSE, async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const org = req.organization!;

  // Verify task belongs to org and has ECS task ID
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  const task = await taskRepo.findOne({ where: { id: taskId, orgId: org.id } });

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (!task.ecsTaskId) {
    res.status(400).json({ error: "Task has no ECS task ID - worker not yet started" });
    return;
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write("retry: 2000\n\n");

  let isConnected = true;
  let nextToken: string | undefined;

  const logGroupName = `/ecs/workermill-${config.environment}/worker`;
  const logStreamName = `worker/worker/${task.ecsTaskId}`;

  req.on("close", () => {
    isConnected = false;
    logger.debug("CloudWatch log stream client disconnected", { taskId });
  });

  // Send initial connection message
  res.write(`data: ${JSON.stringify({
    type: "connected",
    taskId,
    ecsTaskId: task.ecsTaskId,
    logGroup: logGroupName,
    logStream: logStreamName,
  })}\n\n`);

  const fetchAndSendLogs = async () => {
    if (!isConnected) return;

    try {
      const command = new GetLogEventsCommand({
        logGroupName,
        logStreamName,
        startFromHead: nextToken ? false : true,
        nextToken,
        limit: 100,
      });

      const response = await cloudwatchLogs.send(command);

      if (response.events && response.events.length > 0) {
        for (const event of response.events) {
          if (!isConnected) break;
          res.write(`event: log\n`);
          res.write(`data: ${JSON.stringify({
            type: "log",
            timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString(),
            message: event.message || "",
            ingestionTime: event.ingestionTime,
          })}\n\n`);
        }
      }

      // Update token for next fetch
      if (response.nextForwardToken && response.nextForwardToken !== nextToken) {
        nextToken = response.nextForwardToken;
      }

      // Check if task is terminal
      const currentTask = await taskRepo.findOne({ where: { id: taskId } });
      if (currentTask?.isTerminal()) {
        res.write(`data: ${JSON.stringify({
          type: "complete",
          status: currentTask.status,
        })}\n\n`);
        res.end();
        return;
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Log stream might not exist yet - that's OK, keep polling
      if (!errorMessage.includes("ResourceNotFoundException")) {
        logger.error("Error fetching CloudWatch logs", { error: errorMessage, taskId, logStreamName });
      }
    }
  };

  // Initial fetch
  await fetchAndSendLogs();

  // Poll every 1 second for new logs
  const logInterval = setInterval(async () => {
    if (!isConnected) {
      clearInterval(logInterval);
      return;
    }
    await fetchAndSendLogs();
  }, 1000);

  // Ping every 20 seconds
  const pingInterval = setInterval(() => {
    if (!isConnected) return;
    res.write("event: ping\ndata: {}\n\n");
  }, 20000);

  req.on("close", () => {
    clearInterval(logInterval);
    clearInterval(pingInterval);
  });
});

export default router;
