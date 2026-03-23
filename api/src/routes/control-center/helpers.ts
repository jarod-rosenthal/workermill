import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask, WorkerTaskLog, type WorkflowMode, type ErrorType, type ErrorCategory } from "../../models/index.js";
import { logger } from "../../utils/logger.js";
import { config, getTaskCheckpoint } from "../../config/index.js";
import {
  parseRalphProgress,
  detectRalphTask,
  type RalphProgress,
} from "../../services/log-parser.js";

// CloudWatch Logs client
export const cloudwatchLogs = new CloudWatchLogsClient({ region: config.aws.region });

/**
 * Helper: Parse a log message for errors/warnings.
 * Returns null if the message is not an error/warning.
 * Mirrors the frontend parseLogForError logic to ensure consistency.
 */
export function parseLogForError(
  message: string,
  severity?: string,
  logType?: string
): { type: ErrorType; category: ErrorCategory; message: string; file?: string; line?: number } | null {
  const msg = message.trim();

  // Detect ANSI red color codes - indicates error even without severity field
  // Common red codes: \x1b[31m (red), \x1b[91m (bright red), \x1b[1;31m (bold red)
  // eslint-disable-next-line no-control-regex
  const hasRedAnsi = /\x1b\[(?:1;)?(?:31|91)m/.test(msg) || /\u001b\[(?:1;)?(?:31|91)m/.test(msg);

  // Filter out false positives - messages that look like success/info even if marked as error
  const successIndicators = [
    /^Perfect!/i,
    /^Great!/i,
    /^Excellent!/i,
    /^Done!/i,
    /^Success/i,
    /^Completed/i,
    /^\[.*?\]\s*(Perfect|Great|Excellent|Done|Success|Completed)/i,
    /Result:\s*(Perfect|Great|Excellent|Done|Success)/i,
    /successfully\s+(created|completed|implemented|added|updated|fixed)/i,
    /\u2713/,
    /\u2705/,
  ];

  const isFalsePositive = successIndicators.some(pattern => pattern.test(msg));
  if (isFalsePositive) {
    return null;
  }

  // Skip classification for manager/review output — contains error keywords in analysis text
  if (logType === "manager") {
    return null;
  }

  // Check structured severity field OR red ANSI codes (indicates error visually)
  // If explicitly marked as error or displayed in red, capture it
  if (severity === "error" || logType === "error" || hasRedAnsi) {
    // Categorize based on message content
    if (msg.includes("TS") && msg.match(/TS\d+/)) {
      return { type: "error", category: "TypeScript", message: msg };
    }
    if (msg.includes("npm") || msg.includes("NPM") || /npm ERR/i.test(msg)) {
      return { type: "error", category: "npm", message: msg };
    }
    if (/\bgit\s+(push|pull|merge|checkout|clone|fetch|rebase|reset)\b/i.test(msg) || msg.includes("CONFLICT") || msg.includes("fatal:")) {
      return { type: "error", category: "Git", message: msg };
    }
    if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT") || msg.includes("fetch failed")) {
      return { type: "error", category: "Network", message: msg };
    }
    if (msg.includes("Permission denied") || msg.includes("EACCES")) {
      return { type: "error", category: "Permission", message: msg };
    }
    if (msg.includes("FAIL") || msg.includes("fail")) {
      return { type: "error", category: "Test", message: msg };
    }
    // Trust the severity field - capture as generic error
    return { type: "error", category: "Error", message: msg };
  }

  if (severity === "warning" || logType === "warning") {
    return { type: "warning", category: "Warning", message: msg };
  }

  // TypeScript errors: "error TS2307: Cannot find module" or "src/file.ts(42,5): error TS..."
  const tsMatch = msg.match(/(?:(.+?)\((\d+),\d+\):\s*)?error\s+TS(\d+):\s*(.+)/i);
  if (tsMatch) {
    return {
      type: "error",
      category: "TypeScript",
      message: tsMatch[4],
      file: tsMatch[1],
      line: tsMatch[2] ? parseInt(tsMatch[2]) : undefined,
    };
  }

  // ESLint errors
  const eslintMatch = msg.match(/(.+?):(\d+):\d+\s*-?\s*error[:\s]+(.+)/i);
  if (eslintMatch && !msg.includes("TS")) {
    return {
      type: "error",
      category: "ESLint",
      message: eslintMatch[3],
      file: eslintMatch[1],
      line: parseInt(eslintMatch[2]),
    };
  }

  // npm errors
  if (/npm\s+ERR!/i.test(msg)) {
    return { type: "error", category: "npm", message: msg };
  }

  // Git errors
  if (/fatal:|CONFLICT/i.test(msg)) {
    return { type: "error", category: "Git", message: msg };
  }

  // Test failures
  if (/FAIL\s+\S+\.test\.|Test.*failed|\u2717.*test/i.test(msg)) {
    return { type: "error", category: "Test", message: msg };
  }

  return null;
}

/**
 * Helper: Get task step progress based on status and workflow mode
 * Different workflows have different steps:
 * - Default: Queue -> Execute -> Review Requested -> Deploy -> Complete
 * - Review: Queue -> Execute -> Manager Review -> (Revisions) -> Deploy -> Complete
 * - Auto-deploy: Queue -> Execute -> Deploy -> PR -> Complete
 * - Manager: Same as default but with environment analysis step
 * - Epic (parallel): Planning -> Approved -> Experts Working -> PR -> Review -> Deploy
 */
export function getTaskSteps(
  status: string,
  workflowMode: WorkflowMode,
  revisionCount: number = 0,
  executionMode?: "single" | "sequential" | "parallel" | "multi-expert",
): Array<{ name: string; icon: string; status: "done" | "active" | "pending"; isParallelStage?: boolean; isReviewStage?: boolean }> {
  // Define steps based on workflow mode
  let steps: Array<{ name: string; icon: string; statuses: string[]; isParallelStage?: boolean; isReviewStage?: boolean }>;

  // Epic workflow (parallel or multi-expert execution mode)
  const isEpicWorkflow = executionMode === "parallel" || executionMode === "multi-expert";

  // Handle Epic workflow with different stages
  if (isEpicWorkflow) {
    steps = [
      { name: "Planning", icon: "planning", statuses: ["planning"] },
      { name: "Steps", icon: "steps", statuses: ["pending_plan_approval", "queued", "claimed", "environment_setup", "executing", "dispatching", "consolidating"], isParallelStage: true },
      { name: "PR Created", icon: "pr_created", statuses: ["pr_created", "review_requested"] },
      { name: "Integration Check", icon: "integration_check", statuses: ["integration_check"] },
      { name: "Tech Lead Review", icon: "tech_lead_review", statuses: ["reviewing", "pr_approved"], isReviewStage: true },
      { name: "Deployed", icon: "deployed", statuses: ["deploying", "deployed", "completed"] },
    ];

    // Handle terminal failure/rejection states
    if (status === "failed" || status === "cancelled" || status === "review_rejected") {
      return steps.map((step, index) => ({
        name: step.name,
        icon: step.icon,
        status: index === 0 ? "done" : "pending" as const,
        isParallelStage: step.isParallelStage,
        isReviewStage: step.isReviewStage,
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
        isReviewStage: step.isReviewStage,
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
export function formatTaskData(
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
  },
  orgMaxReviewRevisions?: number,
  cardContext?: { boardId: string; cardId: string } | null,
) {
  // Get workflow mode and generate steps accordingly
  const workflowMode = task.getWorkflowMode();
  const steps = getTaskSteps(task.status, workflowMode, task.revisionCount || 0, task.executionMode);

  // Calculate Epic progress percentage
  // Cap at 95% while the task is still running — only show 100% when truly complete
  const isEpicWorkflow = task.executionMode === "parallel" || task.executionMode === "multi-expert";
  const isTerminal = ["completed", "deployed", "failed", "cancelled"].includes(task.status);
  const maxProgress = isTerminal ? 100 : 95;
  const epicProgress = epicProgressData && epicProgressData.storiesTotal > 0
    ? Math.min(maxProgress, Math.round((epicProgressData.storiesCompleted / epicProgressData.storiesTotal) * 100))
    : 0;

  return {
    id: task.id,
    jiraIssueKey: task.jiraIssueKey,
    summary: task.summary,
    description: task.description || null,
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
    updatedAt: task.updatedAt,
    ecsTaskId: task.ecsTaskId,
    hasPr: !!task.githubPrUrl,
    githubPrUrl: task.githubPrUrl,
    githubPrNumber: task.githubPrNumber,
    githubRepo: task.githubRepo,
    githubBranch: task.githubBranch,
    // Workflow info
    workflowMode,
    workflowModeName: task.getWorkflowModeName(),
    deploymentEnabled: task.deploymentEnabled,
    skipManagerReview: task.skipManagerReview,
    managerEnabled: task.managerEnabled || false,
    revisionCount: task.revisionCount || 0,
    maxReviewRevisions: orgMaxReviewRevisions ?? 3,
    reviewFeedback: task.reviewFeedback || null,
    // Manager task info (for showing Virtual Manager in UI)
    managerEcsTaskId: task.managerEcsTaskId || null,
    // Manager provider tracking (for provider badge display)
    managerProvider: task.managerProvider || null,
    managerModel: task.managerModel || null,
    // All providers used (for multi-provider display) - includes planning, workers, review
    providersUsed: task.providersUsed || null,
    // Planning metadata for provider derivation (planJson.metadata.plannerModel)
    planningMetadata: task.planJson?.metadata || null,
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
    // Parent/child task info (PRD/Epic grouping)
    parentTaskId: task.parentTaskId || null,
    childTaskIds: task.childTaskIds || [],
    // Epic workflow info
    executionMode: task.executionMode || "single",
    isEpicWorkflow,
    epicProgress,
    storiesCompleted: Math.min(epicProgressData?.storiesCompleted ?? 0, epicProgressData?.storiesTotal ?? 0),
    storiesTotal: epicProgressData?.storiesTotal ?? 0,
    storiesFailed: epicProgressData?.storiesFailed ?? 0,
    // Remote agent info
    claimedByAgent: task.claimedByAgent || null,
    // Heartbeat tracking
    lastHeartbeatAt: task.lastHeartbeatAt?.toISOString() ?? null,
    // Error details for failed tasks
    errorMessage: task.errorMessage || null,
    // Internal board card context (for direct link to card)
    cardBoardId: cardContext?.boardId ?? null,
    cardId: cardContext?.cardId ?? null,
  };
}

/**
 * Sort tasks to group PRD workflows together.
 * PRD parent tasks stay in their creation order position,
 * and their child tasks appear immediately below them.
 * Non-PRD tasks maintain their creation order position.
 */
export function sortTasksWithPrdGrouping<T extends { id: string; parentTaskId?: string | null; childTaskIds?: string[] | null; createdAt: Date }>(tasks: T[]): T[] {
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
      const aFields = (a as T & { jiraFields?: Record<string, unknown> | null }).jiraFields as { storyIndex?: number } | null;
      const bFields = (b as T & { jiraFields?: Record<string, unknown> | null }).jiraFields as { storyIndex?: number } | null;
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
export async function fetchRalphProgressForTask(
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
export async function fetchCheckpointForTask(
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
export async function fetchEpicProgressForTask(
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
        select: ["id", "status", "storyIndex"],
      });

      // Track unique story indices to avoid counting retries as extra completions
      const completedStoryIndices = new Set<number>();
      const failedStoryIndices = new Set<number>();

      for (const child of childTasks) {
        const idx = child.storyIndex ?? -1;
        if (["completed", "deployed", "pr_approved", "review_approved"].includes(child.status)) {
          completedStoryIndices.add(idx);
        } else if (child.status === "failed" || child.status === "cancelled") {
          failedStoryIndices.add(idx);
        }
      }

      storiesCompleted = completedStoryIndices.size;
      // Only count failed stories that don't also have a successful completion
      for (const idx of completedStoryIndices) {
        failedStoryIndices.delete(idx);
      }
      storiesFailed = failedStoryIndices.size;
    } else {
      // No child tasks yet - try to get progress from WorkerContext (coordination feed)
      // This handles Epic mode where stories are tracked in context, not as separate tasks
      try {
        const { WorkerContext } = await import("../../models/index.js");
        const contextRepo = AppDataSource.getRepository(WorkerContext);

        // Count story_complete messages
        const completedContexts = await contextRepo.count({
          where: {
            parentTaskId: task.id,
            messageType: "completion",
          },
        });
        storiesCompleted = completedContexts;
      } catch (err) {
        console.error("[control-center] story completion count query failed:", err instanceof Error ? err.message : err);
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
export function calculateCheckpointMetrics(
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

  const totalResumeCount = 0;
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
 * Parse cursor string (ISO timestamp|UUID format)
 */
export function parseCursor(raw: string): { lastCreatedAt: Date; lastId: string } | null {
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
// Cap log messages sent to the browser to prevent OOM crashes.
// Full data stays in the DB for search/debugging.
const MAX_LOG_MESSAGE_BYTES = 10_000;
export function capMessage(msg: string): string {
  if (msg.length <= MAX_LOG_MESSAGE_BYTES) return msg;
  return msg.slice(0, MAX_LOG_MESSAGE_BYTES) + `\n... [truncated ${msg.length - MAX_LOG_MESSAGE_BYTES} chars for display]`;
}

export function formatLogForResponse(log: WorkerTaskLog) {
  const eventId = `${log.createdAt.toISOString()}|${log.id}`;
  return {
    id: log.id,
    timestamp: log.createdAt.toISOString(),
    type: log.type,
    message: capMessage(log.message),
    severity: log.severity,
    command: log.command,
    exitCode: log.exitCode,
    stdout: log.stdout ? capMessage(log.stdout) : null,
    stderr: log.stderr ? capMessage(log.stderr) : null,
    filePath: log.filePath,
    durationMs: log.durationMs,
    metadata: log.metadata,
    cursor: eventId,
  };
}
