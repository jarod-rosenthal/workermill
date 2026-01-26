import { Router, Request, Response, NextFunction } from "express";
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { authenticateUser, authenticateSSE, authenticateRequest, authenticateApiKey } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask, Organization, WorkerTaskLog, type WorkflowMode } from "../models/index.js";
import { logger } from "../utils/logger.js";
import { config, getTaskCheckpoint } from "../config/index.js";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from "../utils/errors.js";
import {
  parseRalphProgress,
  parseRalphProgressMarker,
  detectRalphTask,
  type RalphProgress,
} from "../services/log-parser.js";
import { body, param, query, validateRequest } from "../middleware/validation.js";

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
 * - Epic (parallel): Planning → Approved → Experts Working → Consolidating → PR → Review → Deploy
 */
function getTaskSteps(
  status: string,
  workflowMode: WorkflowMode,
  revisionCount: number = 0,
  executionMode?: "single" | "sequential" | "parallel" | "multi-expert",
): Array<{ name: string; icon: string; status: "done" | "active" | "pending"; isParallelStage?: boolean }> {
  // Define steps based on workflow mode
  let steps: Array<{ name: string; icon: string; statuses: string[]; isParallelStage?: boolean }>;

  // Epic workflow (parallel or multi-expert execution mode)
  const isEpicWorkflow = executionMode === "parallel" || executionMode === "multi-expert";

  // Handle Epic workflow with different stages
  if (isEpicWorkflow) {
    steps = [
      { name: "Planning", icon: "planning", statuses: ["planning"] },
      { name: "Approved", icon: "approved", statuses: ["pending_plan_approval", "queued", "claimed"] },
      { name: "Experts", icon: "experts", statuses: ["environment_setup", "executing", "dispatching"], isParallelStage: true },
      { name: "Consolidating", icon: "consolidating", statuses: ["consolidating"] },
      { name: "PR Created", icon: "pr_created", statuses: ["pr_created", "review_requested"] },
      { name: "Reviewed", icon: "review", statuses: ["pr_approved", "completed"] },
      { name: "Deployed", icon: "deployed", statuses: ["deploying", "deployed"] },
    ];

    // For Epic, "Approved" should be done once we're past planning/pending_plan_approval
    // Handle terminal failure/rejection states
    if (status === "failed" || status === "cancelled" || status === "review_rejected") {
      return steps.map((step, index) => ({
        name: step.name,
        icon: step.icon,
        status: index === 0 ? "done" : "pending" as const,
        isParallelStage: step.isParallelStage,
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
        isParallelStage: step.isParallelStage,
      };
    });
  }

  // Handle planning workflow (PRD tickets go through planning first) - non-Epic
  if (status === "planning" || status === "pending_plan_approval") {
    steps = [
      { name: "Planning", icon: "planning", statuses: ["planning"] },
      { name: "Plan Review", icon: "review", statuses: ["pending_plan_approval"] },
      { name: "Queued", icon: "queued", statuses: ["queued", "claimed"] },
      { name: "Executing", icon: "executing", statuses: ["environment_setup", "executing"] },
      { name: "Complete", icon: "complete", statuses: ["completed", "deployed"] },
    ];

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
 * @param ralphData Optional Ralph progress data if already fetched
 * @param checkpointData Optional checkpoint data if already fetched
 * @param epicProgressData Optional Epic workflow progress (stories completed/total)
 */
function formatTaskData(
  task: WorkerTask,
  ralphData?: { isRalphTask: boolean; ralphProgress: RalphProgress | null },
  checkpointData?: {
    hasCheckpoint: boolean;
    checkpointStage: string | null;
    resumeCount: number;
    checkpointSavedAt: string | null;
  },
  epicProgressData?: {
    storiesCompleted: number;
    storiesTotal: number;
    storiesFailed: number;
  }
) {
  // Get workflow mode and generate steps accordingly
  const workflowMode = task.getWorkflowMode();
  const steps = getTaskSteps(task.status, workflowMode, task.revisionCount || 0, task.executionMode);

  // Calculate Epic progress percentage
  const isEpicWorkflow = task.executionMode === "parallel" || task.executionMode === "multi-expert";
  const epicProgress = epicProgressData && epicProgressData.storiesTotal > 0
    ? Math.round((epicProgressData.storiesCompleted / epicProgressData.storiesTotal) * 100)
    : 0;

  return {
    id: task.id,
    jiraIssueKey: task.jiraIssueKey,
    summary: task.summary,
    status: task.status,
    workerName: task.workerPersona || "Unknown",
    workerPersona: task.workerPersona || "backend_developer",
    workerModel: task.workerModel,
    workerProvider: task.workerProvider || "anthropic",
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
    // Ralph execution info
    isRalphTask: ralphData?.isRalphTask ?? false,
    ralphProgress: ralphData?.ralphProgress ?? null,
    // Checkpoint info (Phase 5)
    hasCheckpoint: checkpointData?.hasCheckpoint ?? false,
    checkpointStage: checkpointData?.checkpointStage ?? null,
    resumeCount: checkpointData?.resumeCount ?? 0,
    checkpointSavedAt: checkpointData?.checkpointSavedAt ?? null,
    // Planning info (PRD orchestration)
    planJson: task.planJson || null,
    planStatus: task.planStatus || null,
    planFeedback: task.planFeedback || null,
    // Epic workflow info
    executionMode: task.executionMode || "single",
    isEpicWorkflow,
    epicProgress,
    storiesCompleted: epicProgressData?.storiesCompleted ?? 0,
    storiesTotal: epicProgressData?.storiesTotal ?? 0,
    storiesFailed: epicProgressData?.storiesFailed ?? 0,
    // Heartbeat tracking
    lastHeartbeatAt: task.lastHeartbeatAt?.toISOString() ?? null,
    // Error details for failed tasks
    errorMessage: task.errorMessage || null,
  };
}

/**
 * Sort tasks to group PRD workflows together.
 * PRD parent tasks stay in their creation order position,
 * and their child tasks appear immediately below them.
 * Non-PRD tasks maintain their creation order position.
 */
function sortTasksWithPrdGrouping<T extends { id: string; parentTaskId?: string | null; childTaskIds?: string[] | null; createdAt: Date }>(tasks: T[]): T[] {
  // Build a map of parent -> children
  const parentToChildren = new Map<string, T[]>();
  const parentTasks: T[] = [];
  const standaloneTasks: T[] = [];

  for (const task of tasks) {
    if (task.parentTaskId) {
      // This is a child task - group with parent
      const siblings = parentToChildren.get(task.parentTaskId) || [];
      siblings.push(task);
      parentToChildren.set(task.parentTaskId, siblings);
    } else if (task.childTaskIds && task.childTaskIds.length > 0) {
      // This is a parent task with children
      parentTasks.push(task);
    } else {
      // Standalone task (no parent, no children)
      standaloneTasks.push(task);
    }
  }

  // Sort parent tasks by createdAt DESC (newest first)
  parentTasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Sort standalone tasks by createdAt DESC (newest first)
  standaloneTasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Build final list: parent tasks with their children grouped below
  const result: T[] = [];

  // First, add all parent tasks with their children
  for (const parent of parentTasks) {
    result.push(parent);
    const children = parentToChildren.get(parent.id) || [];
    // Sort children by their story index (from jiraFields) or createdAt
    children.sort((a, b) => {
      // Try to get storyIndex from jiraFields
      const aFields = (a as any).jiraFields as { storyIndex?: number } | null;
      const bFields = (b as any).jiraFields as { storyIndex?: number } | null;
      const aIndex = aFields?.storyIndex ?? 999;
      const bIndex = bFields?.storyIndex ?? 999;
      if (aIndex !== bIndex) return aIndex - bIndex;
      // Fallback to createdAt
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    result.push(...children);
  }

  // Then add standalone tasks
  result.push(...standaloneTasks);

  return result;
}

/**
 * Fetch Ralph progress data for a task by reading its logs
 * Returns null if not a Ralph task or no progress found
 */
async function fetchRalphProgressForTask(
  taskId: string
): Promise<{ isRalphTask: boolean; ralphProgress: RalphProgress | null }> {
  try {
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);

    // Fetch recent logs (last 100) to check for Ralph markers
    const logs = await logRepo.find({
      where: { taskId },
      order: { createdAt: "DESC" },
      take: 100,
    });

    if (logs.length === 0) {
      return { isRalphTask: false, ralphProgress: null };
    }

    // Extract messages (in chronological order for parsing)
    const messages = logs.reverse().map((log) => log.message);

    // Check if this is a Ralph task
    const isRalphTask = detectRalphTask(messages);

    if (!isRalphTask) {
      return { isRalphTask: false, ralphProgress: null };
    }

    // Parse Ralph progress from logs
    const ralphProgress = parseRalphProgress(messages);

    return { isRalphTask, ralphProgress };
  } catch (error) {
    logger.error("Error fetching Ralph progress for task", { error, taskId });
    return { isRalphTask: false, ralphProgress: null };
  }
}

/**
 * Fetch checkpoint data for a task from S3
 * Returns null if checkpoint doesn't exist
 */
async function fetchCheckpointForTask(
  taskId: string
): Promise<{
  hasCheckpoint: boolean;
  checkpointStage: string | null;
  resumeCount: number;
  checkpointSavedAt: string | null;
}> {
  try {
    const checkpoint = await getTaskCheckpoint(taskId);

    if (!checkpoint) {
      return {
        hasCheckpoint: false,
        checkpointStage: null,
        resumeCount: 0,
        checkpointSavedAt: null,
      };
    }

    return {
      hasCheckpoint: true,
      checkpointStage: checkpoint.stage,
      resumeCount: checkpoint.resumeCount,
      checkpointSavedAt: checkpoint.updatedAt,
    };
  } catch (error) {
    logger.debug("Error fetching checkpoint for task", { error, taskId });
    return {
      hasCheckpoint: false,
      checkpointStage: null,
      resumeCount: 0,
      checkpointSavedAt: null,
    };
  }
}

/**
 * Fetch Epic workflow progress for a task
 * Calculates stories completed/total/failed based on planJson and child task statuses
 */
async function fetchEpicProgressForTask(
  task: WorkerTask
): Promise<{
  storiesCompleted: number;
  storiesTotal: number;
  storiesFailed: number;
} | null> {
  // Only calculate for Epic workflows
  if (task.executionMode !== "parallel" && task.executionMode !== "multi-expert") {
    return null;
  }

  try {
    // Get total stories from planJson
    let storiesTotal = 0;
    if (task.planJson) {
      const plan = typeof task.planJson === "string" ? JSON.parse(task.planJson) : task.planJson;
      storiesTotal = plan.stories?.length || plan.steps?.length || 0;
    }

    // If no plan yet, return zeros
    if (storiesTotal === 0) {
      return { storiesCompleted: 0, storiesTotal: 0, storiesFailed: 0 };
    }

    // Get child task statuses if there are child tasks
    let storiesCompleted = 0;
    let storiesFailed = 0;

    if (task.childTaskIds && task.childTaskIds.length > 0) {
      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const childTasks = await taskRepo.find({
        where: { parentTaskId: task.id },
        select: ["id", "status"],
      });

      for (const child of childTasks) {
        if (child.status === "completed" || child.status === "deployed") {
          storiesCompleted++;
        } else if (child.status === "failed" || child.status === "cancelled") {
          storiesFailed++;
        }
      }
    } else {
      // No child tasks yet - try to get progress from WorkerContext (coordination feed)
      // This handles Epic mode where stories are tracked in context, not as separate tasks
      try {
        const { WorkerContext } = await import("../models/index.js");
        const contextRepo = AppDataSource.getRepository(WorkerContext);

        // Count story_complete messages
        const completedContexts = await contextRepo.count({
          where: {
            parentTaskId: task.id,
            messageType: "completion" as any,
          },
        });
        storiesCompleted = completedContexts;
      } catch {
        // Context table might not exist or query failed, use fallback
      }
    }

    return {
      storiesCompleted,
      storiesTotal,
      storiesFailed,
    };
  } catch (error) {
    logger.debug("Error fetching Epic progress for task", { error, taskId: task.id });
    return null;
  }
}

/**
 * Calculate checkpoint metrics for all tasks
 * (Phase 6: Monitoring)
 */
function calculateCheckpointMetrics(
  tasks: WorkerTask[]
): {
  checkpointsActive: number;
  checkpointsCompleted: number;
  totalResumeCount: number;
  avgResumeCount: number;
} {
  const activeCheckpoints = tasks.filter(
    (t) => t.status !== "completed" && t.status !== "deployed" && t.status !== "failed" && t.status !== "cancelled"
  );

  let totalResumeCount = 0;
  let resumeCountSum = 0;

  for (const task of tasks) {
    // Note: resumeCount would need to be tracked in database or checkpoint
    // For now, we use a placeholder based on retryCount as a proxy
    const estimatedResumeCount = Math.max(0, (task.retryCount || 0) - 1);
    resumeCountSum += estimatedResumeCount;
  }

  return {
    checkpointsActive: activeCheckpoints.length,
    checkpointsCompleted: tasks.filter((t) => t.status === "completed" || t.status === "deployed").length,
    totalResumeCount: resumeCountSum,
    avgResumeCount: tasks.length > 0 ? Math.round((resumeCountSum / tasks.length) * 100) / 100 : 0,
  };
}

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
    // Keep recently completed tasks visible based on org setting (default 10 minutes)
    const displayMinutes = org.completedTaskDisplayMinutes || 10;
    const displayCutoff = new Date(Date.now() - displayMinutes * 60 * 1000);
    // Keep intermediate tasks visible based on org setting (default 60 minutes)
    const intermediateDisplayMinutes = org.intermediateTaskDisplayMinutes || 15;
    const intermediateCutoff = new Date(Date.now() - intermediateDisplayMinutes * 60 * 1000);
    // Statuses that always indicate active work
    const alwaysActiveStatuses = ["queued", "claimed", "environment_setup", "executing", "planning", "pending_plan_approval", "dispatching"];
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
      if (intermediateStatuses.includes(t.status)) {
        const taskTime = t.startedAt || t.createdAt;
        return taskTime && new Date(taskTime) > intermediateCutoff;
      }
      // Show completed/deployed/failed tasks within the display period
      // Failed tasks are important to see so users know what went wrong
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
    const completedSinceReset = tasksSinceReset.filter(
      (t) => (t.status === "completed" || t.status === "deployed") && t.completedAt
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
    const stats = {
      totalWorkers: 7,
      activeWorkers: activeTasks.length > 0 ? 1 : 0,
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
      .addSelect("COUNT(CASE WHEN task.status IN ('running', 'queued', 'claimed', 'executing', 'environment_setup', 'pending_review') THEN 1 END)", "active")
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
      if (intermediateStatuses.includes(t.status)) {
        const taskTime = t.startedAt || t.createdAt;
        return taskTime && new Date(taskTime) > intermediateCutoff;
      }
      // Show completed/failed/deployed tasks within the display period
      if (
        ["completed", "deployed", "failed"].includes(t.status) &&
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

    // Format active tasks - uses shared formatTaskData
    // Fetch Ralph progress, checkpoint data, and Epic progress for active tasks in parallel
    const activeTasksWithRalph = await Promise.all(
      runningTasks.slice(0, 10).map(async (task) => {
        const [ralphData, checkpointData, epicProgressData] = await Promise.all([
          fetchRalphProgressForTask(task.id),
          fetchCheckpointForTask(task.id),
          fetchEpicProgressForTask(task),
        ]);
        return formatTaskData(task, ralphData, checkpointData, epicProgressData || undefined);
      })
    );
    const activeTasksData = activeTasksWithRalph;

    // Format queued tasks (also fetch Epic progress for queued Epic workflows)
    const queuedTasksData = await Promise.all(
      queuedTasks.slice(0, 20).map(async (task) => {
        const epicProgressData = await fetchEpicProgressForTask(task);
        return formatTaskData(task, undefined, undefined, epicProgressData || undefined);
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
        // Checkpoint info
        hasCheckpoint: false,
        checkpointStage: null,
        resumeCount: 0,
        checkpointSavedAt: null,
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

/**
 * POST /api/control-center/tasks/:id/approve
 * Manually approve a task for deployment (simulates PR approval)
 * Only works for tasks in review_requested status
 */
router.post(
  "/tasks/:id/approve",
  authenticateRequest,
  param("id").isUUID().withMessage("id must be a valid UUID"),
  body("approvedBy").optional().isString().withMessage("approvedBy must be a string"),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const taskId = req.params.id as string;
    const { approvedBy } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      throw new NotFoundError("Task not found");
    }

    if (task.status !== "review_requested") {
      throw new ConflictError(
        `Task cannot be approved: status is ${task.status}, must be review_requested`
      );
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
  })
);

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
      const alwaysActiveStatuses = ["queued", "claimed", "environment_setup", "executing", "planning", "pending_plan_approval", "dispatching"];
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
        if (intermediateStatuses.includes(t.status)) {
          const taskTime = t.startedAt || t.createdAt;
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
      const completedSinceReset = tasksSinceReset.filter(
        (t) => (t.status === "completed" || t.status === "deployed") && t.completedAt
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

      // Include actively running tasks AND recently completed tasks (within display period)
      // Include queued tasks so they stay visible when PRD plan is approved
      const filteredTasks = allTasks.filter((t) => {
        // Always show tasks in active statuses (including queued)
        if (alwaysActiveStatuses.includes(t.status)) {
          return true;
        }
        // Show intermediate statuses only if recent (based on org setting)
        if (intermediateStatuses.includes(t.status)) {
          const taskTime = t.startedAt || t.createdAt;
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

      // Fetch Ralph progress, checkpoint data, and Epic progress for running tasks in parallel
      const runningTasks = await Promise.all(
        filteredRunningTasks.map(async (task) => {
          const [ralphData, checkpointData, epicProgressData] = await Promise.all([
            fetchRalphProgressForTask(task.id),
            fetchCheckpointForTask(task.id),
            fetchEpicProgressForTask(task),
          ]);
          return formatTaskData(task, ralphData, checkpointData, epicProgressData || undefined);
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
          // Checkpoint info
          hasCheckpoint: false,
          checkpointStage: null,
          resumeCount: 0,
          checkpointSavedAt: null,
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

  // Clean up on disconnect
  req.on("close", () => {
    clearInterval(interval);
  });
});

/**
 * GET /api/control-center/logs/:taskId
 * REST endpoint for polling task logs (fallback when SSE disconnects)
 */
router.get(
  "/logs/:taskId",
  authenticateRequest,
  param("taskId").isUUID().withMessage("taskId must be a valid UUID"),
  query("since").optional().isString(),
  query("limit").optional().isInt({ min: 1, max: 1000 }).withMessage("limit must be between 1 and 1000"),
  validateRequest,
  async (req: Request, res: Response) => {
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
  }
);

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
 * @swagger
 * /api/control-center/logs/{taskId}/stream:
 *   get:
 *     summary: Stream task logs in real-time (SSE)
 *     description: |
 *       Server-Sent Events (SSE) endpoint for streaming task logs in real-time from the database.
 *       Supports automatic resume via Last-Event-ID header or manual resume via 'since' query parameter.
 *       Polls database every 1 second for new logs. Automatically ends when task reaches terminal status.
 *     tags: [Logs]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Task UUID to stream logs for
 *       - in: query
 *         name: since
 *         schema:
 *           type: string
 *         description: |
 *           Resume cursor in format "ISO8601|UUID" (e.g., "2025-01-15T10:30:00.000Z|abc-123").
 *           If not provided, starts from 5 minutes ago.
 *     responses:
 *       200:
 *         description: SSE stream of task logs
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                   enum: [connected, log, status, complete, error]
 *                   description: Event type
 *                 taskId:
 *                   type: string
 *                   format: uuid
 *                   description: Task UUID (in 'connected' event)
 *                 status:
 *                   type: string
 *                   description: Current task status (in 'status' and 'complete' events)
 *                 cursor:
 *                   type: string
 *                   description: Resume cursor for this event
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   description: Log timestamp
 *                 logType:
 *                   type: string
 *                   description: Type of log entry
 *                 message:
 *                   type: string
 *                   description: Log message content
 *                 severity:
 *                   type: string
 *                   enum: [debug, info, warn, error]
 *                   description: Log severity level
 *       404:
 *         description: Task not found
 *       401:
 *         description: Unauthorized
 */
router.get("/logs/:taskId/stream", authenticateSSE, async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const org = req.organization!;
  const since = req.query.since ? String(req.query.since) : null;

  // Validate taskId is a valid UUID to prevent database errors
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(taskId)) {
    res.status(400).json({ error: "Invalid task ID format" });
    return;
  }

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

        // Check for Ralph progress markers and emit separate event
        const ralphProgress = parseRalphProgressMarker(log.message);
        if (ralphProgress) {
          res.write("event: ralph_progress\n");
          res.write(`data: ${JSON.stringify({
            type: "ralph_progress",
            currentStory: ralphProgress.currentStory,
            totalStories: ralphProgress.totalStories,
            currentStoryDescription: ralphProgress.currentStoryDescription,
            timestamp: log.createdAt.toISOString(),
          })}\n\n`);
        }

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
 * Uses API key authentication (x-api-key header) for org verification
 */
router.post(
  "/logs",
  authenticateApiKey,
  body("taskId").isUUID().withMessage("taskId must be a valid UUID"),
  body("type").isString().notEmpty().withMessage("type is required"),
  body("message").isString().notEmpty().withMessage("message is required"),
  body("severity").optional().isIn(["debug", "info", "warn", "error"]).withMessage("severity must be debug, info, warn, or error"),
  body("command").optional().isString(),
  body("exitCode").optional().isInt(),
  body("stdout").optional().isString(),
  body("stderr").optional().isString(),
  body("filePath").optional().isString(),
  body("durationMs").optional().isInt(),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const { taskId, type, message, severity, command, exitCode, stdout, stderr, filePath, durationMs } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);

    // Verify task exists AND belongs to the authenticated org (prevents cross-org data leakage)
    const task = await taskRepo.findOne({ where: { id: taskId, orgId: org.id } });
    if (!task) {
      throw new NotFoundError("Task not found");
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
  })
);

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

/**
 * GET /api/control-center/search
 * Full-text search across all task logs
 */
router.get(
  "/search",
  authenticateRequest,
  query("q").isString().notEmpty().withMessage("Search query is required"),
  query("limit").optional().isInt({ min: 1, max: 500 }).withMessage("limit must be between 1 and 500"),
  query("offset").optional().isInt({ min: 0 }).withMessage("offset must be non-negative"),
  query("taskId").optional().isUUID().withMessage("taskId must be a valid UUID"),
  query("type").optional().isString(),
  query("severity").optional().isIn(["debug", "info", "warning", "error"]),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const searchQuery = req.query.q as string;
      const limit = parseInt((req.query.limit as string) || "50");
      const offset = parseInt((req.query.offset as string) || "0");
      const taskId = req.query.taskId as string | undefined;
      const logType = req.query.type as string | undefined;
      const severity = req.query.severity as string | undefined;

      const logRepo = AppDataSource.getRepository(WorkerTaskLog);
      const taskRepo = AppDataSource.getRepository(WorkerTask);

      // Build the query
      let queryBuilder = logRepo
        .createQueryBuilder("log")
        .leftJoinAndSelect("log.task", "task")
        .where("task.orgId = :orgId", { orgId: org.id })
        .andWhere("log.search_vector @@ plainto_tsquery('english', :query)", { query: searchQuery });

      // Apply filters
      if (taskId) {
        queryBuilder = queryBuilder.andWhere("log.taskId = :taskId", { taskId });
      }
      if (logType) {
        queryBuilder = queryBuilder.andWhere("log.type = :logType", { logType });
      }
      if (severity) {
        queryBuilder = queryBuilder.andWhere("log.severity = :severity", { severity });
      }

      // Order by relevance (rank) first, then by creation time
      // Add ts_headline for search result highlighting
      queryBuilder = queryBuilder
        .addSelect(
          "ts_rank(log.search_vector, plainto_tsquery('english', :query))",
          "rank"
        )
        .addSelect(
          "ts_headline('english', log.message, plainto_tsquery('english', :query), 'MaxWords=50, MinWords=30, StartSel=<mark>, StopSel=</mark>')",
          "headline"
        )
        .orderBy("rank", "DESC")
        .addOrderBy("log.createdAt", "DESC")
        .skip(offset)
        .take(limit);

      // Get raw results to access headline, plus count
      const { entities: logs, raw: rawResults } = await queryBuilder.getRawAndEntities();
      const total = await queryBuilder.getCount();

      // Format results with task context
      const results = logs.map((log, index) => ({
        id: log.id,
        taskId: log.taskId,
        jiraIssueKey: log.task?.jiraIssueKey,
        taskSummary: log.task?.summary,
        timestamp: log.createdAt,
        type: log.type,
        message: log.message,
        severity: log.severity,
        command: log.command,
        filePath: log.filePath,
        // Fallback snippet for non-highlighted display
        snippet: log.message.substring(0, 200) + (log.message.length > 200 ? "..." : ""),
        // Highlighted snippet from ts_headline
        headline: rawResults[index]?.headline || log.message.substring(0, 200),
      }));

      // Task search - search by jiraIssueKey (exact) or summary (ILIKE)
      const taskResults = await taskRepo
        .createQueryBuilder("task")
        .where("task.orgId = :orgId", { orgId: org.id })
        .andWhere(
          "(task.jiraIssueKey ILIKE :query OR task.summary ILIKE :queryWild)",
          { query: searchQuery, queryWild: `%${searchQuery}%` }
        )
        .select([
          "task.id",
          "task.jiraIssueKey",
          "task.summary",
          "task.status",
          "task.createdAt",
        ])
        .orderBy("task.createdAt", "DESC")
        .take(10)
        .getMany();

      res.json({
        query: searchQuery,
        tasks: taskResults,
        results,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      });
    } catch (error) {
      logger.error("Error searching logs", { error });
      res.status(500).json({ error: "Failed to search logs" });
    }
  }
);

export default router;
