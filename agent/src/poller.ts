/**
 * Remote Agent Poller
 *
 * Main poll loop: every N seconds, query the cloud API for tasks,
 * dispatch to planner or spawner based on task status.
 */

import type { AgentConfig } from "./config.js";
import { api } from "./api.js";
import { planTask } from "./planner.js";
import { spawnWorker, getActiveCount, getActiveTaskIds, type SpawnableTask } from "./spawner.js";

// Track tasks currently being planned (to avoid double-dispatching)
const planningInProgress = new Set<string>();

// Cached org config
let orgConfig: Record<string, unknown> | null = null;

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
    console.error("[poller] Failed to fetch org config:", error);
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
      console.error("[poller] Authentication failed. Check your WORKERMILL_API_KEY.");
    } else {
      console.error("[poller] Poll error:", err.message || String(error));
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

  console.log(`[poller] Planning task: ${task.summary.substring(0, 60)}`);
  planningInProgress.add(task.id);

  // Run planning asynchronously (don't block the poll loop)
  planTask(task, config)
    .catch((err) => console.error(`[poller] Planning failed for ${task.id}:`, err))
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
    console.error(`[poller] Failed to report started for ${task.id}:`, err);
  }

  console.log(`[poller] Spawning worker for: ${task.summary.substring(0, 60)}`);

  const oc = await getOrgConfig();
  const spawnableTask: SpawnableTask = claimData.task || {
    id: task.id,
    summary: task.summary,
    description: task.description,
    jiraIssueKey: task.jiraIssueKey,
    workerModel: task.workerModel,
    githubRepo: task.githubRepo,
    scmProvider: task.scmProvider,
    executionPlanV2: task.executionPlanV2,
    jiraFields: task.jiraFields || {},
  };

  // Spawn asynchronously (don't block the poll loop)
  spawnWorker(spawnableTask, config, oc).catch((err) =>
    console.error(`[poller] Spawn failed for ${task.id}:`, err),
  );
}

/**
 * Start the poll loop.
 */
export function startPolling(config: AgentConfig): void {
  console.log(
    `[poller] Polling ${config.apiUrl} every ${config.pollIntervalMs / 1000}s ` +
    `(agent: ${config.agentId}, max workers: ${config.maxWorkers})`,
  );

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
      await api.post("/api/agent/heartbeat", {
        agentId: config.agentId,
        activeTasks: activeTaskIds,
      });
    } catch {
      // Heartbeat failures are non-critical
    }
  }, config.heartbeatIntervalMs);
}
