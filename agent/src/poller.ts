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
import { spawnWorker, getActiveCount, getActiveTaskIds, stopTask, type SpawnableTask } from "./spawner.js";

// Track tasks currently being planned (to avoid double-dispatching)
const planningInProgress = new Set<string>();

// Cached org config
let orgConfig: Record<string, unknown> | null = null;

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

/**
 * Run a single poll iteration.
 */
async function pollOnce(config: AgentConfig): Promise<void> {
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
      githubRepo: string;
      scmProvider: string;
      executionMode: string;
      criticEnabled: boolean;
      skipManagerReview?: boolean;
      executionPlanV2?: unknown;
      jiraFields?: Record<string, unknown>;
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
  } catch (error: unknown) {
    const err = error as { response?: { status?: number }; message?: string };
    if (err.response?.status === 401) {
      console.error(`${ts()} ${chalk.red("✗")} Authentication failed. Check your API key.`);
    } else {
      console.error(`${ts()} ${chalk.red("✗")} Poll error: ${err.message || String(error)}`);
    }
  }
}

/**
 * Handle a task in "planning" status.
 */
async function handlePlanningTask(
  task: { id: string; summary: string },
  config: AgentConfig,
): Promise<void> {
  // Claim the task
  try {
    const claimResponse = await api.post("/api/agent/claim", {
      taskId: task.id,
      agentId: config.agentId,
    });

    if (!claimResponse.data.claimed) {
      return; // Another agent or cloud orchestrator claimed it
    }
  } catch {
    return;
  }

  const taskLabel = chalk.cyan(task.id.slice(0, 8));
  console.log();
  console.log(`${ts()} ${chalk.magenta("◆ PLANNING")} ${taskLabel} ${task.summary.substring(0, 60)}`);
  planningInProgress.add(task.id);

  // Run planning asynchronously (don't block the poll loop)
  planTask(task, config)
    .then((success) => {
      if (success) {
        console.log(`${ts()} ${chalk.green("✓")} Planning complete for ${taskLabel}`);
      } else {
        console.log(`${ts()} ${chalk.red("✗")} Planning failed for ${taskLabel}`);
      }
    })
    .catch((err) => console.error(`${ts()} ${chalk.red("✗")} Planning error for ${taskLabel}:`, err.message || err))
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
    githubRepo: string;
    scmProvider: string;
    skipManagerReview?: boolean;
    executionPlanV2?: unknown;
    jiraFields?: Record<string, unknown>;
  },
  config: AgentConfig,
): Promise<void> {
  // Check concurrency limit
  const activeCount = getActiveCount();
  if (activeCount >= config.maxWorkers) {
    return; // At capacity
  }

  // Claim the task
  let claimData: { claimed: boolean; task?: SpawnableTask };
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
    console.error(`${ts()} ${chalk.red("✗")} Failed to report started for ${taskLabel}`);
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
    githubRepo: task.githubRepo,
    scmProvider: task.scmProvider,
    skipManagerReview: task.skipManagerReview,
    executionPlanV2: task.executionPlanV2,
    jiraFields: task.jiraFields || {},
  };

  // Spawn asynchronously (don't block the poll loop)
  spawnWorker(spawnableTask, config, oc).catch((err) =>
    console.error(`${ts()} ${chalk.red("✗")} Spawn failed for ${taskLabel}:`, err.message || err),
  );
}

/**
 * Start the poll loop.
 */
export function startPolling(config: AgentConfig): void {
  console.log(`  ${chalk.dim("Polling every")} ${config.pollIntervalMs / 1000}s ${chalk.dim("· waiting for tasks...")}`);

  // Initial poll
  pollOnce(config);

  // Recurring poll
  setInterval(() => pollOnce(config), config.pollIntervalMs);
}

/**
 * Start the heartbeat loop.
 */
export function startHeartbeat(config: AgentConfig): void {
  setInterval(async () => {
    const activeTaskIds = getActiveTaskIds();

    try {
      const response = await api.post("/api/agent/heartbeat", {
        agentId: config.agentId,
        activeTasks: activeTaskIds,
      });

      // Stop containers for tasks cancelled via the cloud dashboard
      const cancelledTasks = response.data?.cancelledTasks as string[] | undefined;
      if (cancelledTasks && cancelledTasks.length > 0) {
        for (const taskId of cancelledTasks) {
          stopTask(taskId);
        }
      }
    } catch {
      // Heartbeat failures are non-critical
    }
  }, config.heartbeatIntervalMs);
}
