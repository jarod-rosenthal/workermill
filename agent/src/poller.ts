/**
 * Remote Agent Poller
 *
 * Main poll loop: every N seconds, query the cloud API for tasks,
 * dispatch to planner or spawner based on task status.
 */

import chalk from "chalk";
import type { AgentConfig } from "./config.js";
import { api } from "./api.js";
import { planTask } from "./planner.js";
import {
  spawnWorker,
  spawnManagerWorker,
  getActiveCount,
  getActiveTaskIds,
  stopTask,
  type SpawnableTask,
  type ClaimCredentials,
  type ManagerTask,
  type ManagerCredentials,
} from "./spawner.js";
import { AGENT_VERSION } from "./version.js";
import { selfUpdate, restartAgent } from "./updater.js";
import { agentEvents } from "./local-api.js";
import { getGpuInfo } from "./gpu-detector.js";
import { getOllamaStatus } from "./ollama-manager.js";

// Track tasks currently being planned (to avoid double-dispatching)
const planningInProgress = new Set<string>();

// ─── Diagnostic Buffer ─────────────────────────────────────────────────────
// Accumulates errors/warnings between heartbeats, sent and cleared each cycle.
const diagnosticBuffer: Array<{
  ts: string;
  level: string;
  component: string;
  message: string;
}> = [];

/**
 * Report a diagnostic event to be sent with the next heartbeat.
 * Capped at 50 entries to prevent memory growth.
 */
export function reportDiagnostic(
  level: "error" | "warn" | "info",
  component: string,
  message: string,
): void {
  diagnosticBuffer.push({
    ts: new Date().toISOString(),
    level,
    component,
    message,
  });
  if (diagnosticBuffer.length > 50) diagnosticBuffer.shift();
}

// Track manager tasks in progress (to avoid double-dispatching)
const managerInProgress = new Set<string>();

// Cached org config
let orgConfig: Record<string, unknown> | null = null;

// Flags to avoid spamming update notices every heartbeat
let updateNoticePrinted = false;
let updateInProgress = false;

/** Timestamp prefix for log lines */
function ts(): string {
  return chalk.dim(new Date().toLocaleTimeString());
}

/**
 * Fetch org config from the cloud API (cached).
 */
async function getOrgConfig(): Promise<Record<string, unknown>> {
  if (orgConfig) return orgConfig;
  try {
    const response = await api.get("/api/agent/config");
    orgConfig = response.data;
    return orgConfig!;
  } catch (error) {
    console.error(`${ts()} ${chalk.red("✗")} Failed to fetch org config`);
    return {};
  }
}

// Saved config for triggerPoll()
let savedConfig: AgentConfig | null = null;

/**
 * Trigger an immediate poll (e.g., after creating a task via the local API).
 * Non-blocking — fires and forgets.
 */
export function triggerPoll(): void {
  if (savedConfig) pollOnce(savedConfig).catch(() => {});
}

/**
 * Run a single poll iteration.
 */
async function pollOnce(config: AgentConfig): Promise<void> {
  // Skip polling when a required update is in progress
  if (updateInProgress) return;

  try {
    const response = await api.get("/api/agent/poll", {
      params: { agentId: config.agentId },
    });

    const tasks = response.data.tasks as Array<{
      id: string;
      status: string;
      summary: string;
      description: string | null;
      jiraIssueKey: string | null;
      workerModel: string;
      workerProvider?: string;
      githubRepo: string;
      scmProvider: string;
      executionMode: string;
      criticEnabled: boolean;
      skipManagerReview?: boolean;
      deploymentEnabled?: boolean;
      improvementEnabled?: boolean;
      qualityGateBypass?: boolean;
      standardSdkMode?: boolean;
      parentTaskId?: string;
      taskNotes?: string;
      githubPrUrl?: string;
      githubPrNumber?: number;
      executionPlanV2?: unknown;
      jiraFields?: Record<string, unknown>;
      boardExecutionId?: string;
    }>;

    if (tasks.length === 0) return;

    for (const task of tasks) {
      if (task.status === "planning" && !planningInProgress.has(task.id)) {
        // Claim and plan
        await handlePlanningTask(task, config);
      } else if (task.status === "queued") {
        // Claim and spawn
        await handleQueuedTask(task, config);
      }
    }

    // Handle manager tasks (log analysis, PR review)
    const managerTasks = response.data.managerTasks as Array<{
      id: string;
      summary: string;
      description: string | null;
      jiraIssueKey: string | null;
      githubRepo: string;
      scmProvider: string;
      githubPrUrl?: string;
      githubPrNumber?: number;
      managerAction: "analyze_logs" | "review_pr";
    }> | undefined;

    if (managerTasks && managerTasks.length > 0) {
      for (const mt of managerTasks) {
        if (!managerInProgress.has(mt.id)) {
          await handleManagerTask(mt, config);
        }
      }
    }
  } catch (error: unknown) {
    const err = error as { response?: { status?: number }; message?: string };
    const busy =
      planningInProgress.size > 0 || getActiveCount() > 0 || managerInProgress.size > 0;

    if (err.response?.status === 401) {
      if (!busy) {
        console.error(`${ts()} ${chalk.red("✗")} Authentication failed. Check your API key.`);
      }
      reportDiagnostic("error", "poller", `Poll failed: ${err.response?.status} auth`);
    } else if (!busy) {
      console.warn(`${ts()} ${chalk.yellow("⚠")} Poll error: ${err.message || String(error)}`);
      reportDiagnostic("warn", "poller", `Poll error: ${err.message || String(error)}`);
    }
  }
}

/**
 * Handle a task in "planning" status.
 */
async function handlePlanningTask(
  task: {
    id: string;
    summary: string;
    description: string | null;
    githubRepo?: string;
    scmProvider?: string;
  },
  config: AgentConfig,
): Promise<void> {
  // Guard against concurrent pollOnce() calls dispatching the same task twice.
  // Add to planningInProgress BEFORE the async claim call so overlapping polls
  // see it immediately. Remove if the claim fails or is rejected.
  planningInProgress.add(task.id);

  // Claim the task (also returns org credentials for provider API keys)
  let credentials: ClaimCredentials | undefined;
  let claimedTask: { retryCount?: number; executionPlanV2?: unknown } | undefined;
  try {
    const claimResponse = await api.post("/api/agent/claim", {
      taskId: task.id,
      agentId: config.agentId,
    });

    if (!claimResponse.data.claimed) {
      planningInProgress.delete(task.id);
      return; // Another agent or cloud orchestrator claimed it
    }
    credentials = claimResponse.data.credentials;
    claimedTask = claimResponse.data.task;

    // Send an immediate heartbeat so the cloud orchestrator's findPlanningTasks()
    // sees this org has an active agent and skips it. Without this, there's a race
    // window between claim and the first periodic heartbeat where cloud can also
    // start planning for the same task.
    api.post("/api/agent/heartbeat", {
      agentId: config.agentId,
      activeTasks: [task.id],
      agentVersion: AGENT_VERSION,
    }).catch(() => {}); // fire-and-forget, non-critical
  } catch {
    planningInProgress.delete(task.id);
    return;
  }

  const taskLabel = chalk.cyan(task.id.slice(0, 8));

  // Check if this is a retry with an existing plan (resume scenario).
  // The API preserves planJson/executionPlanV2 on retry when stories exist,
  // so we can skip planning entirely and transition straight to queued.
  const isRetryWithPlan = claimedTask &&
    (claimedTask.retryCount ?? 0) > 0 &&
    claimedTask.executionPlanV2 != null;

  if (isRetryWithPlan) {
    console.log();
    console.log(`${ts()} ${chalk.magenta("◆ RESUME")} ${taskLabel} ${task.summary.substring(0, 60)}`);
    console.log(`${ts()} ${taskLabel} Retry ***REMOVED***${claimedTask!.retryCount} with existing plan — skipping planning`);

    // Notify VS Code so the task is brought into focus immediately
    agentEvents.emit("task:planning", { id: task.id, summary: task.summary, description: task.description });

    // Tell the API to resume with the existing plan (planning → queued)
    try {
      await api.post("/api/agent/resume-plan", {
        taskId: task.id,
        agentId: config.agentId,
      });
      console.log(`${ts()} ${taskLabel} ${chalk.green("✓")} Resumed with existing plan → ${chalk.green("queued")}`);
    } catch (err) {
      const error = err as { response?: { data?: { error?: string } }; message?: string };
      const detail = error.response?.data?.error || error.message || String(err);
      console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Resume failed: ${detail}`);
    }
    planningInProgress.delete(task.id);
    return;
  }

  console.log();
  console.log(`${ts()} ${chalk.magenta("◆ PLANNING")} ${taskLabel} ${task.summary.substring(0, 60)}`);
  agentEvents.emit("task:planning", { id: task.id, summary: task.summary, description: task.description });

  // Run planning asynchronously (don't block the poll loop)
  planTask(task, config, credentials)
    .then((success) => {
      if (success) {
        console.log(`${ts()} ${chalk.green("✓")} Planning complete for ${taskLabel}`);
      } else {
        console.log(`${ts()} ${chalk.red("✗")} Planning failed for ${taskLabel}`);
      }
      agentEvents.emit("task:plan_done", { id: task.id, success });
    })
    .catch((err) => {
      console.error(`${ts()} ${chalk.red("✗")} Planning error for ${taskLabel}:`, err.message || err);
      agentEvents.emit("task:plan_done", { id: task.id, success: false });
    })
    .finally(() => planningInProgress.delete(task.id));
}

/**
 * Handle a task in "queued" status.
 */
async function handleQueuedTask(
  task: {
    id: string;
    summary: string;
    description: string | null;
    jiraIssueKey: string | null;
    workerModel: string;
    workerProvider?: string;
    githubRepo: string;
    scmProvider: string;
    skipManagerReview?: boolean;
    deploymentEnabled?: boolean;
    improvementEnabled?: boolean;
    qualityGateBypass?: boolean;
    standardSdkMode?: boolean;
    parentTaskId?: string;
    taskNotes?: string;
    githubPrUrl?: string;
    githubPrNumber?: number;
    executionPlanV2?: unknown;
    jiraFields?: Record<string, unknown>;
    boardExecutionId?: string;
  },
  config: AgentConfig,
): Promise<void> {
  // Check concurrency limit
  const activeCount = getActiveCount();
  if (activeCount >= config.maxWorkers) {
    return; // At capacity
  }

  // Claim the task
  let claimData: { claimed: boolean; task?: SpawnableTask; credentials?: ClaimCredentials };
  try {
    const claimResponse = await api.post("/api/agent/claim", {
      taskId: task.id,
      agentId: config.agentId,
    });
    claimData = claimResponse.data;

    if (!claimData.claimed) {
      return;
    }
  } catch {
    return;
  }

  // Report started
  try {
    await api.post("/api/agent/started", {
      taskId: task.id,
      agentId: config.agentId,
    });
  } catch (err) {
    const taskLabel = chalk.cyan(task.id.slice(0, 8));
    console.warn(`${ts()} ${chalk.yellow("⚠")} Failed to report started for ${taskLabel}`);
  }

  const taskLabel = chalk.cyan(task.id.slice(0, 8));
  console.log();
  console.log(`${ts()} ${chalk.blue("▶ EXECUTING")} ${taskLabel} ${task.summary.substring(0, 60)}`);

  const oc = await getOrgConfig();
  const spawnableTask: SpawnableTask = claimData.task || {
    id: task.id,
    summary: task.summary,
    description: task.description,
    jiraIssueKey: task.jiraIssueKey,
    workerModel: task.workerModel,
    workerProvider: task.workerProvider,
    githubRepo: task.githubRepo,
    scmProvider: task.scmProvider,
    skipManagerReview: task.skipManagerReview,
    deploymentEnabled: task.deploymentEnabled,
    improvementEnabled: task.improvementEnabled,
    qualityGateBypass: task.qualityGateBypass,
    standardSdkMode: task.standardSdkMode,
    parentTaskId: task.parentTaskId,
    taskNotes: task.taskNotes,
    githubPrUrl: task.githubPrUrl,
    githubPrNumber: task.githubPrNumber,
    executionPlanV2: task.executionPlanV2,
    jiraFields: task.jiraFields || {},
    boardExecutionId: task.boardExecutionId,
  };

  // Pass org credentials from the claim response to the container
  const credentials = claimData.credentials;

  // Spawn asynchronously (don't block the poll loop)
  spawnWorker(spawnableTask, config, oc, credentials).catch((err) =>
    console.error(`${ts()} ${chalk.red("✗")} Spawn failed for ${taskLabel}:`, err.message || err),
  );
}

/**
 * Handle a manager task (log analysis or PR review).
 */
async function handleManagerTask(
  task: {
    id: string;
    summary: string;
    description: string | null;
    jiraIssueKey: string | null;
    githubRepo: string;
    scmProvider: string;
    githubPrUrl?: string;
    githubPrNumber?: number;
    managerAction: "analyze_logs" | "review_pr";
  },
  config: AgentConfig,
): Promise<void> {
  const taskLabel = chalk.cyan(task.id.slice(0, 8));
  managerInProgress.add(task.id);

  // Claim the manager task
  try {
    const claimResponse = await api.post("/api/agent/claim-manager", {
      taskId: task.id,
      agentId: config.agentId,
      action: task.managerAction,
    });

    if (!claimResponse.data.claimed) {
      managerInProgress.delete(task.id);
      return; // Another agent or cloud ECS claimed it
    }

    const claimedTask = claimResponse.data.task;
    const credentials: ManagerCredentials = claimResponse.data.credentials || {};

    const actionLabel = task.managerAction === "analyze_logs"
      ? chalk.yellow("LOG ANALYSIS")
      : chalk.yellow("PR REVIEW");
    console.log();
    console.log(`${ts()} ${chalk.magenta("◆ MANAGER")} ${actionLabel} ${taskLabel} ${task.summary.substring(0, 60)}`);

    const managerTask: ManagerTask = {
      id: task.id,
      summary: claimedTask?.summary || task.summary,
      description: claimedTask?.description || task.description,
      jiraIssueKey: claimedTask?.jiraIssueKey || task.jiraIssueKey,
      githubRepo: claimedTask?.githubRepo || task.githubRepo,
      scmProvider: claimedTask?.scmProvider || task.scmProvider,
      githubPrUrl: claimedTask?.githubPrUrl || task.githubPrUrl,
      githubPrNumber: claimedTask?.githubPrNumber || task.githubPrNumber,
      managerAction: task.managerAction,
    };

    // Spawn asynchronously (don't block the poll loop)
    spawnManagerWorker(managerTask, config, credentials)
      .then(() => {
        console.log(`${ts()} ${taskLabel} ${chalk.magenta("MGR")} ${chalk.green("✓")} Manager ${task.managerAction} dispatched`);
      })
      .catch((err) => {
        console.error(`${ts()} ${taskLabel} ${chalk.magenta("MGR")} ${chalk.red("✗")} Manager spawn failed:`, err.message || err);
      })
      .finally(() => managerInProgress.delete(task.id));
  } catch (err) {
    managerInProgress.delete(task.id);
    const error = err as { message?: string };
    console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Failed to claim manager task:`, error.message || String(err));
  }
}

// Store interval IDs so they can be cleared on shutdown
let pollIntervalId: ReturnType<typeof setInterval> | null = null;
let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Stop all polling and heartbeat loops.
 * Called during graceful shutdown to prevent the event loop from staying alive.
 */
export function stopPolling(): void {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
}

/**
 * Start the poll loop.
 */
export function startPolling(config: AgentConfig): void {
  savedConfig = config;
  console.log(`  ${chalk.dim("Polling every")} ${config.pollIntervalMs / 1000}s ${chalk.dim("· waiting for tasks...")}`);

  // Initial poll
  pollOnce(config);

  // Recurring poll
  pollIntervalId = setInterval(() => pollOnce(config), config.pollIntervalMs);
}

/**
 * Start the heartbeat loop.
 */
export function startHeartbeat(config: AgentConfig): void {
  heartbeatIntervalId = setInterval(async () => {
    // Include BOTH running containers AND tasks being planned/managed
    const containerTaskIds = getActiveTaskIds();
    const planningTaskIds = Array.from(planningInProgress);
    const managerTaskIds = Array.from(managerInProgress);
    const activeTaskIds = [...containerTaskIds, ...planningTaskIds, ...managerTaskIds];

    try {
      const gpuInfo = getGpuInfo();
      const ollamaStatus = await getOllamaStatus(config.ollamaPort);

      // Flush diagnostic buffer into heartbeat payload
      const diagnostics = diagnosticBuffer.splice(0);

      const response = await api.post("/api/agent/heartbeat", {
        agentId: config.agentId,
        activeTasks: activeTaskIds,
        agentVersion: AGENT_VERSION,
        gpuAvailable: gpuInfo.available,
        gpuVendor: gpuInfo.vendor,
        localRagEnabled: config.localRag,
        ollamaRunning: ollamaStatus.running,
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      });

      // Stop containers for tasks cancelled via the cloud dashboard
      const cancelledTasks = response.data?.cancelledTasks as string[] | undefined;
      if (cancelledTasks && cancelledTasks.length > 0) {
        for (const taskId of cancelledTasks) {
          stopTask(taskId);
        }
      }

      // Handle update signals from server
      const { updateAvailable, updateRequired, latestVersion } = response.data ?? {};

      if (updateRequired && !updateInProgress) {
        updateInProgress = true;
        console.log(`${ts()} ${chalk.red("⚠ Agent update required")} (current: ${AGENT_VERSION}, required: ${latestVersion})`);
        console.log(`${ts()} ${chalk.yellow("Refusing new tasks until updated.")}`);
        const success = await selfUpdate();
        if (success) {
          restartAgent();
        } else {
          console.log(`${ts()} ${chalk.red("Auto-update failed.")} Run: npm install -g @workermill/agent@latest`);
          updateInProgress = false;
        }
      } else if (updateAvailable && !updateNoticePrinted && !updateRequired) {
        updateNoticePrinted = true;
        console.log(`${ts()} ${chalk.yellow(`Update available: ${latestVersion}`)} (current: ${AGENT_VERSION}). Run: workermill-agent update`);
      }
    } catch {
      // Heartbeat failures are non-critical
    }
  }, config.heartbeatIntervalMs);
}
