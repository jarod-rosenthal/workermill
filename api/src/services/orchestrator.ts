/**
 * WorkerMill Orchestrator Service
 *
 * Background service that polls for queued tasks and spawns ECS workers.
 * Runs in the API process and can be started/stopped via API endpoints.
 */

import { In } from "typeorm";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask, Organization, WorkerTaskLog } from "../models/index.js";
import { getECSTaskRunner } from "./ecs-task-runner.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

// Repositories
const getOrgRepo = () => AppDataSource.getRepository(Organization);
const getTaskRepo = () => AppDataSource.getRepository(WorkerTask);
const getLogRepo = () => AppDataSource.getRepository(WorkerTaskLog);

/**
 * Log a task event to the database for real-time streaming
 */
async function logTaskEvent(
  taskId: string,
  type: "status_change" | "system" | "error" | "info",
  message: string,
  options?: { severity?: "debug" | "info" | "warning" | "error"; metadata?: Record<string, unknown> }
): Promise<void> {
  try {
    const logRepo = getLogRepo();
    const logData = WorkerTaskLog.create(taskId, type, message, {
      severity: options?.severity || "info",
      metadata: options?.metadata,
    });
    const log = logRepo.create(logData);
    await logRepo.save(log);
  } catch (error) {
    logger.error("Failed to save task log", { taskId, message, error });
  }
}

interface OrchestratorState {
  running: boolean;
  lastPollAt: Date | null;
  tasksProcessed: number;
  errors: number;
}

interface OrgCredentials {
  anthropicApiKey: string;
  githubToken: string;
  orgApiKey?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
}

// Singleton state
const state: OrchestratorState = {
  running: false,
  lastPollAt: null,
  tasksProcessed: 0,
  errors: 0,
};

// Secrets Manager client
const secretsClient = new SecretsManagerClient({ region: config.aws.region });

// Cache for org credentials (5 minute TTL)
const credentialsCache = new Map<
  string,
  { credentials: OrgCredentials; expiresAt: number }
>();

/**
 * Get credentials for an organization from Secrets Manager
 */
async function getOrgCredentials(orgId: string): Promise<OrgCredentials> {
  const now = Date.now();
  const cached = credentialsCache.get(orgId);

  if (cached && cached.expiresAt > now) {
    return cached.credentials;
  }

  try {
    // Get org for API key
    const orgRepo = AppDataSource.getRepository(Organization);
    const org = await orgRepo.findOne({ where: { id: orgId } });
    if (!org) {
      throw new Error(`Organization not found: ${orgId}`);
    }

    // Fetch secrets from Secrets Manager
    const [anthropicSecret, githubSecret, jiraSecret] = await Promise.all([
      secretsClient.send(
        new GetSecretValueCommand({
          SecretId: `workermill/${config.environment}/anthropic-api-key`,
        })
      ),
      secretsClient.send(
        new GetSecretValueCommand({
          SecretId: `workermill/${config.environment}/github-token`,
        })
      ),
      secretsClient.send(
        new GetSecretValueCommand({
          SecretId: `workermill/${config.environment}/jira-credentials`,
        })
      ),
    ]);

    // Parse Jira credentials JSON
    let jiraCredentials: { domain?: string; base_url?: string; email?: string; api_token?: string } = {};
    try {
      jiraCredentials = JSON.parse(jiraSecret.SecretString || "{}");
    } catch {
      logger.warn("Failed to parse Jira credentials JSON");
    }

    // Handle both 'base_url' (full URL) and 'domain' (just domain) formats
    let jiraBaseUrl: string | undefined;
    if (jiraCredentials.base_url) {
      jiraBaseUrl = jiraCredentials.base_url;
    } else if (jiraCredentials.domain) {
      jiraBaseUrl = `https://${jiraCredentials.domain}`;
    }

    const credentials: OrgCredentials = {
      anthropicApiKey: anthropicSecret.SecretString || "",
      githubToken: githubSecret.SecretString || "",
      orgApiKey: org.apiKey || undefined, // Include org API key for worker callback
      jiraBaseUrl,
      jiraEmail: jiraCredentials.email,
      jiraApiToken: jiraCredentials.api_token,
    };

    // Cache for 5 minutes
    credentialsCache.set(orgId, {
      credentials,
      expiresAt: now + 5 * 60 * 1000,
    });

    return credentials;
  } catch (error) {
    logger.error("Failed to fetch credentials from Secrets Manager", {
      error,
      orgId,
    });
    throw error;
  }
}

/**
 * Find queued tasks that can be executed
 * Respects:
 * - Persona concurrency: only 1 active task per persona per org
 * - Task cooldown: skip tasks whose Jira ticket had a recent attempt (within org.taskCooldownSeconds)
 * - Max concurrent workers: limit active tasks per org to org.maxConcurrentWorkers
 */
async function findQueuedTasks(): Promise<WorkerTask[]> {
  const taskRepo = getTaskRepo();
  const orgRepo = getOrgRepo();

  // Get all queued tasks
  const queuedTasks = await taskRepo.find({
    where: { status: "queued" },
    order: { createdAt: "ASC" },
    take: 10,
  });

  if (queuedTasks.length === 0) {
    return [];
  }

  // Get active tasks to check persona concurrency and org limits
  const activeTasks = await taskRepo.find({
    where: {
      status: In(["claimed", "environment_setup", "executing", "deploying", "dispatching"]),
    },
  });

  // Build a set of occupied persona slots per org
  const occupiedSlots = new Set<string>();
  // Count active tasks per org
  const activeCountByOrg = new Map<string, number>();

  for (const task of activeTasks) {
    occupiedSlots.add(`${task.orgId}:${task.workerPersona}`);
    activeCountByOrg.set(task.orgId, (activeCountByOrg.get(task.orgId) || 0) + 1);
  }

  // Get unique org IDs from queued tasks
  const orgIds = [...new Set(queuedTasks.map((t) => t.orgId))];

  // Fetch org settings for cooldown and maxConcurrentWorkers
  const orgs = await orgRepo.find({
    where: { id: In(orgIds) },
  });
  const orgSettings = new Map(orgs.map((o) => [o.id, o]));

  // Get recent failed/completed tasks to check cooldown (by Jira issue key)
  const jiraIssueKeys = [...new Set(queuedTasks.map((t) => t.jiraIssueKey))];
  const recentTasks = await taskRepo
    .createQueryBuilder("task")
    .select(["task.jiraIssueKey", "task.orgId", "task.updatedAt"])
    .where("task.jiraIssueKey IN (:...keys)", { keys: jiraIssueKeys })
    .andWhere("task.status IN (:...statuses)", {
      statuses: ["failed", "completed", "deployed", "cancelled"],
    })
    .orderBy("task.updatedAt", "DESC")
    .getMany();

  // Build map of most recent attempt time per Jira issue key per org
  const lastAttemptByIssue = new Map<string, Date>();
  for (const task of recentTasks) {
    const key = `${task.orgId}:${task.jiraIssueKey}`;
    if (!lastAttemptByIssue.has(key)) {
      lastAttemptByIssue.set(key, task.updatedAt);
    }
  }

  const now = Date.now();

  // Filter to tasks that can be executed
  const eligibleTasks = queuedTasks.filter((task) => {
    const org = orgSettings.get(task.orgId);
    if (!org) {
      logger.warn("Organization not found for task", { taskId: task.id, orgId: task.orgId });
      return false;
    }

    // Check persona concurrency
    const slotKey = `${task.orgId}:${task.workerPersona}`;
    if (occupiedSlots.has(slotKey)) {
      return false;
    }

    // Check maxConcurrentWorkers per org
    const activeCount = activeCountByOrg.get(task.orgId) || 0;
    if (activeCount >= org.maxConcurrentWorkers) {
      return false;
    }

    // Check cooldown: skip if last attempt was within cooldown period
    const issueKey = `${task.orgId}:${task.jiraIssueKey}`;
    const lastAttempt = lastAttemptByIssue.get(issueKey);
    if (lastAttempt) {
      const cooldownMs = org.taskCooldownSeconds * 1000;
      const timeSinceLastAttempt = now - lastAttempt.getTime();
      if (timeSinceLastAttempt < cooldownMs) {
        logger.debug("Task in cooldown", {
          taskId: task.id,
          jiraIssueKey: task.jiraIssueKey,
          cooldownSeconds: org.taskCooldownSeconds,
          secondsRemaining: Math.ceil((cooldownMs - timeSinceLastAttempt) / 1000),
        });
        return false;
      }
    }

    return true;
  });

  return eligibleTasks.slice(0, 5); // Process up to 5 at a time
}

/**
 * Atomically claim a task
 * Returns true if successfully claimed, false if already claimed by another process
 */
async function claimTask(taskId: string): Promise<boolean> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);

  const result = await taskRepo
    .createQueryBuilder()
    .update(WorkerTask)
    .set({ status: "claimed" })
    .where("id = :id AND status = :status", { id: taskId, status: "queued" })
    .execute();

  return (result.affected || 0) > 0;
}

/**
 * Spawn an ECS worker for a task
 */
async function spawnWorker(task: WorkerTask): Promise<void> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);

  try {
    logger.info("Spawning worker for task", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      persona: task.workerPersona,
    });

    // Log setting up environment
    await logTaskEvent(task.id, "status_change", "Setting up execution environment");

    // Get credentials for the org
    const credentials = await getOrgCredentials(task.orgId);

    // Update status to environment_setup
    task.status = "environment_setup";
    await taskRepo.save(task);

    // Spawn ECS task
    const runner = getECSTaskRunner();
    const result = await runner.runWorkerTask(task, credentials);

    // Log ECS task started
    await logTaskEvent(task.id, "status_change", `ECS task started: ${result.taskId}`);

    // Update task with ECS info
    task.ecsTaskArn = result.taskArn;
    task.ecsTaskId = result.taskId;
    task.status = "executing";
    task.startedAt = new Date();
    await taskRepo.save(task);

    logger.info("Worker spawned successfully", {
      taskId: task.id,
      ecsTaskId: result.taskId,
    });

    state.tasksProcessed++;
  } catch (error) {
    logger.error("Failed to spawn worker", {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });

    // Mark task as failed
    task.status = "failed";
    task.errorMessage =
      error instanceof Error ? error.message : "Failed to spawn worker";
    task.completedAt = new Date();
    await taskRepo.save(task);

    state.errors++;
    throw error;
  }
}

/**
 * Find tasks that need manager review (PR created with review label)
 */
async function findTasksNeedingManagerReview(): Promise<WorkerTask[]> {
  const taskRepo = getTaskRepo();

  // Find tasks in pr_created status with review label (skipManagerReview=false)
  // and that don't already have a manager ECS task running
  const tasks = await taskRepo
    .createQueryBuilder("task")
    .where("task.status IN (:...statuses)", { statuses: ["pr_created", "review_requested"] })
    .andWhere("task.skip_manager_review = :skip", { skip: false })
    .andWhere("task.github_pr_number IS NOT NULL")
    .andWhere("(task.manager_ecs_task_arn IS NULL OR task.manager_ecs_task_arn = '')")
    .orderBy("task.created_at", "ASC")
    .limit(3)
    .getMany();

  return tasks;
}

/**
 * Find tasks that need manager log analysis (completed/failed with manager label)
 * This is the "training wheels" mode for new environments
 */
async function findTasksNeedingLogAnalysis(): Promise<WorkerTask[]> {
  const taskRepo = getTaskRepo();

  // Find tasks that:
  // - Have manager_enabled=true (manager label)
  // - Are completed or failed (terminal states where we can analyze what happened)
  // - Haven't had log analysis done yet
  // - Completed within the last hour (don't analyze old tasks)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const tasks = await taskRepo
    .createQueryBuilder("task")
    .where("task.manager_enabled = :enabled", { enabled: true })
    .andWhere("task.status IN (:...statuses)", { statuses: ["completed", "failed", "deployed"] })
    .andWhere("task.manager_analysis_done = :done", { done: false })
    .andWhere("task.completed_at > :cutoff", { cutoff: oneHourAgo })
    .orderBy("task.completed_at", "ASC")
    .limit(2)
    .getMany();

  return tasks;
}

/**
 * Spawn a Manager ECS task for PR review
 */
async function spawnManagerReview(task: WorkerTask): Promise<void> {
  const taskRepo = getTaskRepo();

  try {
    logger.info("Spawning Manager for PR review", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      prNumber: task.githubPrNumber,
    });

    await logTaskEvent(task.id, "status_change", "Virtual Manager starting PR review...");

    // Update status to manager_review
    task.status = "manager_review";
    await taskRepo.save(task);

    // Get credentials for the org
    const credentials = await getOrgCredentials(task.orgId);

    // Spawn Manager ECS task
    const runner = getECSTaskRunner();
    const result = await runner.runManagerTask(task, credentials, "review_pr");

    // Store manager ECS info
    task.managerEcsTaskArn = result.taskArn;
    task.managerEcsTaskId = result.taskId;
    await taskRepo.save(task);

    await logTaskEvent(task.id, "status_change", `Manager ECS task started: ${result.taskId}`);

    logger.info("Manager task spawned successfully", {
      taskId: task.id,
      managerEcsTaskId: result.taskId,
    });
  } catch (error) {
    logger.error("Failed to spawn Manager task", {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });

    // Revert status
    task.status = "pr_created";
    await taskRepo.save(task);

    await logTaskEvent(task.id, "error", `Failed to start Manager: ${error instanceof Error ? error.message : String(error)}`, { severity: "error" });
  }
}

/**
 * Spawn a Manager ECS task for log analysis ("training wheels" mode)
 * Analyzes completed/failed tasks for environment issues
 */
async function spawnManagerLogAnalysis(task: WorkerTask): Promise<void> {
  const taskRepo = getTaskRepo();

  try {
    logger.info("Spawning Manager for log analysis", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      status: task.status,
    });

    await logTaskEvent(task.id, "info", "Virtual Manager analyzing execution logs...");

    // Mark analysis as started (prevents duplicate spawns)
    task.managerAnalysisDone = true;
    await taskRepo.save(task);

    // Get credentials for the org
    const credentials = await getOrgCredentials(task.orgId);

    // Spawn Manager ECS task for log analysis
    const runner = getECSTaskRunner();
    const result = await runner.runManagerTask(task, credentials, "analyze_logs");

    await logTaskEvent(task.id, "info", `Manager log analysis started: ${result.taskId}`);

    logger.info("Manager log analysis task spawned", {
      taskId: task.id,
      managerEcsTaskId: result.taskId,
    });
  } catch (error) {
    logger.error("Failed to spawn Manager log analysis", {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });

    // Reset flag so it can be retried
    task.managerAnalysisDone = false;
    await taskRepo.save(task);

    await logTaskEvent(task.id, "error", `Failed to start Manager log analysis: ${error instanceof Error ? error.message : String(error)}`, { severity: "error" });
  }
}

/**
 * Main polling loop
 */
async function pollLoop(): Promise<void> {
  while (state.running) {
    try {
      state.lastPollAt = new Date();

      // Process queued tasks (spawn workers)
      const tasks = await findQueuedTasks();

      for (const task of tasks) {
        if (!state.running) break;

        // Try to claim the task
        if (await claimTask(task.id)) {
          logger.info("Task claimed", {
            taskId: task.id,
            jiraIssueKey: task.jiraIssueKey,
          });

          // Log task claimed event for real-time streaming
          await logTaskEvent(task.id, "status_change", "Task claimed by orchestrator");
          await logTaskEvent(task.id, "status_change", `Assigned to worker ${task.id.substring(0, 8)}`);

          // Spawn worker (don't await - let it run in parallel)
          spawnWorker(task).catch((error) => {
            logger.error("Error in spawnWorker", {
              taskId: task.id,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }

      // Process tasks needing manager review (review workflow)
      const reviewTasks = await findTasksNeedingManagerReview();
      for (const task of reviewTasks) {
        if (!state.running) break;

        // Spawn manager (don't await - let it run in parallel)
        spawnManagerReview(task).catch((error) => {
          logger.error("Error in spawnManagerReview", {
            taskId: task.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }

      // Process tasks needing log analysis (manager "training wheels" workflow)
      const analysisTasks = await findTasksNeedingLogAnalysis();
      for (const task of analysisTasks) {
        if (!state.running) break;

        // Spawn manager log analysis (don't await - let it run in parallel)
        spawnManagerLogAnalysis(task).catch((error) => {
          logger.error("Error in spawnManagerLogAnalysis", {
            taskId: task.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }

      // Sleep between polls
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (error) {
      logger.error("Error in orchestrator poll loop", {
        error: error instanceof Error ? error.message : String(error),
      });
      state.errors++;

      // Back off on errors
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
}

/**
 * Start the orchestrator
 */
export function startOrchestrator(): void {
  if (state.running) {
    logger.warn("Orchestrator already running");
    return;
  }

  logger.info("Starting orchestrator");
  state.running = true;
  state.tasksProcessed = 0;
  state.errors = 0;

  // Start polling loop (don't await)
  pollLoop().catch((error) => {
    logger.error("Orchestrator poll loop crashed", {
      error: error instanceof Error ? error.message : String(error),
    });
    state.running = false;
  });

  // Start cleanup loop (runs hourly, don't await)
  cleanupLoop().catch((error) => {
    logger.error("Cleanup loop crashed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * Stop the orchestrator
 */
export function stopOrchestrator(): void {
  if (!state.running) {
    logger.warn("Orchestrator not running");
    return;
  }

  logger.info("Stopping orchestrator");
  state.running = false;
}

/**
 * Get orchestrator status
 */
export function getOrchestratorStatus(): OrchestratorState {
  return { ...state };
}

/**
 * Check if orchestrator is running
 */
export function isOrchestratorRunning(): boolean {
  return state.running;
}

/**
 * Clean up old task logs based on per-organization retention settings
 * Runs hourly to prevent unbounded database growth
 */
async function cleanupOldLogs(): Promise<void> {
  try {
    const logRepo = getLogRepo();
    const orgRepo = getOrgRepo();
    const taskRepo = getTaskRepo();

    // Get all organizations
    const orgs = await orgRepo.find();

    let totalDeleted = 0;

    for (const org of orgs) {
      const retentionDays = org.logRetentionDays || 30;
      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

      // Delete logs for tasks belonging to this organization using raw SQL subquery
      const result = await logRepo
        .createQueryBuilder()
        .delete()
        .from(WorkerTaskLog)
        .where("task_id IN (SELECT id FROM worker_tasks WHERE org_id = :orgId)", { orgId: org.id })
        .andWhere("created_at < :cutoff", { cutoff: cutoffDate })
        .execute();

      if (result.affected && result.affected > 0) {
        logger.info("Cleaned up old task logs for organization", {
          orgId: org.id,
          orgName: org.name,
          deletedCount: result.affected,
          retentionDays,
          cutoffDate: cutoffDate.toISOString(),
        });
        totalDeleted += result.affected;
      }
    }

    if (totalDeleted > 0) {
      logger.info("Total task logs cleaned up", { totalDeleted });
    }
  } catch (error) {
    logger.error("Failed to clean up old logs", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Cleanup loop - runs hourly
 */
async function cleanupLoop(): Promise<void> {
  while (state.running) {
    await cleanupOldLogs();
    // Run every hour
    await new Promise((resolve) => setTimeout(resolve, 60 * 60 * 1000));
  }
}
