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
import {
  ECSClient,
  DescribeTasksCommand,
} from "@aws-sdk/client-ecs";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask, Organization, WorkerTaskLog } from "../models/index.js";
import { getECSTaskRunner } from "./ecs-task-runner.js";
import { config, getProviderCredentials, getTaskCheckpoint } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { isValidProviderId, type ProviderId } from "../providers/types.js";
import {
  cleanupStaleCoordination,
  getActiveWorkerCountsByRepo,
  checkOut,
} from "./coordination.js";
import { canCreateTask, incrementTaskUsage } from "./billing.js";
import {
  notifyTaskCompleted,
  notifyTaskFailed,
  notifyCostAlert,
} from "./notifications.js";

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
  // Multi-provider support
  providerApiKey?: string;
  providerId?: ProviderId;
  // Ralph execution settings
  useRalph?: boolean;
  ralphMaxStories?: number;
}

// Singleton state
const state: OrchestratorState = {
  running: false,
  lastPollAt: null,
  tasksProcessed: 0,
  errors: 0,
};

// AWS clients
const secretsClient = new SecretsManagerClient({ region: config.aws.region });
const ecsClient = new ECSClient({ region: config.aws.region });
const s3Client = new S3Client({ region: config.aws.region });

// Cache for org credentials (5 minute TTL)
const credentialsCache = new Map<
  string,
  { credentials: OrgCredentials; expiresAt: number }
>();

// Cache for manager GitHub token (separate from worker token for PR approvals)
let managerGitHubTokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Get the Manager's GitHub token (separate account for PR approvals)
 * This allows the Virtual Manager to approve PRs created by workers
 */
async function getManagerGitHubToken(): Promise<string> {
  const now = Date.now();

  if (managerGitHubTokenCache && managerGitHubTokenCache.expiresAt > now) {
    return managerGitHubTokenCache.token;
  }

  try {
    const secret = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: `workermill/${config.environment}/manager-github-token`,
      })
    );

    const token = secret.SecretString || "";

    // Cache for 5 minutes
    managerGitHubTokenCache = {
      token,
      expiresAt: now + 5 * 60 * 1000,
    };

    return token;
  } catch (error) {
    logger.warn("Failed to fetch manager GitHub token, falling back to worker token", { error });
    return ""; // Will fall back to worker token
  }
}

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
      // Ralph execution settings from org
      useRalph: org.useRalphExecution ?? false,
      ralphMaxStories: org.ralphMaxStories ?? 10,
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
 * - Per-repo concurrency: limit active workers per repo via coordination service check-ins
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

  // Get active worker counts per repo from coordination service (Phase 7)
  // This tracks actual running workers via check-ins, more accurate than task status
  const activeWorkersByRepoByOrg = new Map<string, Map<string, number>>();
  for (const orgId of orgIds) {
    try {
      const repoWorkerCounts = await getActiveWorkerCountsByRepo(orgId);
      activeWorkersByRepoByOrg.set(orgId, repoWorkerCounts);
    } catch (error) {
      logger.warn("Failed to get active worker counts for org", {
        orgId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue without repo-level limits on error
      activeWorkersByRepoByOrg.set(orgId, new Map());
    }
  }

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

  // Check quota eligibility for each org
  const quotaEligibleOrgs = new Set<string>();
  const quotaBlockedOrgs = new Set<string>();

  for (const orgId of orgIds) {
    const org = orgSettings.get(orgId);
    if (!org) continue;

    const quotaCheck = await canCreateTask(org);
    if (quotaCheck.allowed) {
      quotaEligibleOrgs.add(orgId);
    } else {
      quotaBlockedOrgs.add(orgId);
      logger.warn("Organization blocked by quota - tasks will remain queued", {
        orgId,
        orgName: org.name,
        reason: quotaCheck.reason,
        usage: quotaCheck.usage,
      });
    }
  }

  // Filter to tasks that can be executed
  const eligibleTasks = queuedTasks.filter((task) => {
    const org = orgSettings.get(task.orgId);
    if (!org) {
      logger.warn("Organization not found for task", { taskId: task.id, orgId: task.orgId });
      return false;
    }

    // Check quota
    if (quotaBlockedOrgs.has(task.orgId)) {
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

    // Check per-repo concurrency (Phase 7)
    // Use coordination service check-ins to count active workers per repo
    const repoWorkerCounts = activeWorkersByRepoByOrg.get(task.orgId);
    if (repoWorkerCounts && task.githubRepo) {
      const activeRepoWorkers = repoWorkerCounts.get(task.githubRepo) || 0;
      // Limit to maxConcurrentWorkers per repo (same limit as org-wide)
      if (activeRepoWorkers >= org.maxConcurrentWorkers) {
        logger.debug("Repo at max concurrent workers", {
          taskId: task.id,
          repo: task.githubRepo,
          activeRepoWorkers,
          maxConcurrentWorkers: org.maxConcurrentWorkers,
        });
        return false;
      }
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
    // Determine provider from task or default to anthropic
    const providerId: ProviderId = (task.workerProvider && isValidProviderId(task.workerProvider))
      ? task.workerProvider as ProviderId
      : "anthropic";

    logger.info("Spawning worker for task", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      persona: task.workerPersona,
      provider: providerId,
    });

    // Log setting up environment
    await logTaskEvent(task.id, "status_change", `Setting up execution environment (provider: ${providerId})`);

    // Get credentials for the org
    const credentials = await getOrgCredentials(task.orgId);

    // Fetch provider-specific API key if not using anthropic
    if (providerId !== "anthropic") {
      try {
        credentials.providerApiKey = await getProviderCredentials(task.orgId, providerId);
        credentials.providerId = providerId;
        logger.info("Fetched provider credentials", { taskId: task.id, provider: providerId });
      } catch (error) {
        logger.error("Failed to fetch provider credentials", {
          taskId: task.id,
          provider: providerId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error(`Provider credentials not configured for '${providerId}'. Please configure API key in Settings.`);
      }
    }

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

    // Increment task usage for billing quota tracking
    await incrementTaskUsage(task.orgId).catch((usageError) => {
      logger.warn("Failed to increment task usage", {
        taskId: task.id,
        orgId: task.orgId,
        error: usageError instanceof Error ? usageError.message : String(usageError),
      });
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

  // Find tasks needing manager review (have 'review' label, skipManagerReview=false)
  // Statuses:
  //   - pr_created: Worker created PR, waiting for review
  //   - review_requested: Legacy status, same as pr_created
  //   - pr_approved: GitHub approved but needs manager review before deployment
  // and that don't already have a manager ECS task running
  const tasks = await taskRepo
    .createQueryBuilder("task")
    .where("task.status IN (:...statuses)", { statuses: ["pr_created", "review_requested", "pr_approved"] })
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
 * Find tasks in approved status that need deployment
 * These are tasks where:
 * - PR was approved (via GitHub webhook → pr_approved)
 * - OR Manager approved (via review workflow → review_approved)
 * - Task has deploy label (deploymentEnabled=true) OR went through manager review
 * - But wasn't re-queued for deployment
 */
async function findApprovedTasksNeedingDeployment(): Promise<WorkerTask[]> {
  const taskRepo = getTaskRepo();

  // SAFETY: Only process recently approved tasks (within last hour)
  // This prevents bulk re-queueing of old stuck tasks after bug fixes
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Find tasks that are approved but haven't been re-queued for deployment
  // Include both pr_approved (GitHub webhook) and review_approved (manager review)
  const tasks = await taskRepo
    .createQueryBuilder("task")
    .where("task.status IN (:...statuses)", { statuses: ["pr_approved", "review_approved"] })
    .andWhere("task.github_pr_number IS NOT NULL")
    .andWhere("task.updated_at > :cutoff", { cutoff: oneHourAgo })
    .orderBy("task.updated_at", "ASC")
    .limit(5)
    .getMany();

  return tasks;
}

/**
 * Re-queue an approved task for deployment run
 */
async function requeueForDeployment(task: WorkerTask): Promise<void> {
  const taskRepo = getTaskRepo();

  logger.info("Re-queuing approved task for deployment", {
    taskId: task.id,
    jiraIssueKey: task.jiraIssueKey,
    prNumber: task.githubPrNumber,
  });

  await logTaskEvent(task.id, "status_change", "Re-queuing for deployment (deploy label detected)", {
    severity: "info",
    metadata: { prNumber: task.githubPrNumber },
  });

  // Set up for deployment run
  task.status = "queued";
  task.taskNotes = `DEPLOYMENT_RUN: PR #${task.githubPrNumber} approved. Deploy and merge.`;
  task.completedAt = null;
  task.startedAt = null;
  task.ecsTaskArn = null;
  task.ecsTaskId = null;

  await taskRepo.save(task);

  logger.info("Task re-queued for deployment", {
    taskId: task.id,
    jiraIssueKey: task.jiraIssueKey,
  });
}

/**
 * Monitor all executing tasks and detect completion via ECS status
 * This is the PRIMARY completion detection mechanism - worker callbacks are a backup
 *
 * When ECS task stops, we:
 * 1. Read the result markers from task logs (::result::, ::pr_url::, etc.)
 * 2. Update task status based on the actual result, not just exit code
 * 3. Capture PR details if present
 */
async function monitorExecutingTasks(): Promise<void> {
  const taskRepo = getTaskRepo();

  // Find ALL executing tasks (not just stale ones)
  const executingTasks = await taskRepo
    .createQueryBuilder("task")
    .where("task.status IN (:...statuses)", { statuses: ["executing", "environment_setup"] })
    .andWhere("task.ecs_task_arn IS NOT NULL")
    .limit(10)
    .getMany();

  if (executingTasks.length === 0) return;

  // Batch describe ECS tasks for efficiency
  const taskArns = executingTasks.map(t => t.ecsTaskArn!).filter(Boolean);
  if (taskArns.length === 0) return;

  let ecsTasksMap: Map<string, { lastStatus: string; stopCode?: string; stoppedReason?: string; stoppedAt?: Date; exitCode: number; capacityProviderName?: string }> = new Map();

  try {
    const describeResult = await ecsClient.send(
      new DescribeTasksCommand({
        cluster: config.aws.ecsCluster,
        tasks: taskArns,
      })
    );

    for (const ecsTask of describeResult.tasks || []) {
      const container = ecsTask.containers?.find((c) => c.name === "worker");
      ecsTasksMap.set(ecsTask.taskArn!, {
        lastStatus: ecsTask.lastStatus || "UNKNOWN",
        stopCode: ecsTask.stopCode,
        stoppedReason: ecsTask.stoppedReason,
        stoppedAt: ecsTask.stoppedAt,
        exitCode: container?.exitCode ?? -1,
        capacityProviderName: ecsTask.capacityProviderName,
      });
    }
  } catch (error) {
    logger.error("Error describing ECS tasks", { error: error instanceof Error ? error.message : String(error) });
    return;
  }

  for (const task of executingTasks) {
    try {
      const ecsInfo = ecsTasksMap.get(task.ecsTaskArn!);

      if (!ecsInfo) {
        // ECS task not found - mark as failed
        logger.warn("ECS task not found", { taskId: task.id, ecsTaskArn: task.ecsTaskArn });
        task.status = "failed";
        task.completedAt = new Date();
        task.errorMessage = "ECS task not found";
        await taskRepo.save(task);
        await logTaskEvent(task.id, "error", "Task failed: ECS task not found", { severity: "error" });
        continue;
      }

      // Only process stopped tasks
      if (ecsInfo.lastStatus !== "STOPPED") continue;

      logger.info("Detected ECS task completion", {
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        exitCode: ecsInfo.exitCode,
        stopCode: ecsInfo.stopCode,
        stoppedReason: ecsInfo.stoppedReason,
        capacityProvider: ecsInfo.capacityProviderName,
      });

      // Detect Spot interruptions via multiple indicators:
      // 1. stopCode="SpotInterruption" (ECS native indicator)
      // 2. Exit code 137 with Spot-related reason (SIGKILL after SIGTERM timeout)
      // 3. Exit code 137 on FARGATE_SPOT capacity provider
      // 4. Checkpoint stage="interrupted" (worker saved state before termination)
      let isSpotInterruption =
        ecsInfo.stopCode === "SpotInterruption" ||
        (ecsInfo.exitCode === 137 && ecsInfo.stoppedReason?.toLowerCase().includes("spot")) ||
        (ecsInfo.exitCode === 137 && ecsInfo.capacityProviderName === "FARGATE_SPOT");

      // Check checkpoint for "interrupted" stage as a fallback detection method
      // This catches cases where the worker gracefully handled SIGTERM
      if (!isSpotInterruption && (ecsInfo.exitCode === 0 || ecsInfo.exitCode === 137)) {
        try {
          const checkpoint = await getTaskCheckpoint(task.id);
          if (checkpoint && checkpoint.stage === "interrupted") {
            isSpotInterruption = true;
            logger.info("Spot interruption detected via checkpoint stage", {
              taskId: task.id,
              jiraIssueKey: task.jiraIssueKey,
              checkpointStage: checkpoint.stage,
              lastAction: checkpoint.lastAction,
            });
          }
        } catch (checkpointError) {
          // Checkpoint retrieval failed - continue with ECS-based detection only
          logger.warn("Failed to retrieve checkpoint for Spot detection", {
            taskId: task.id,
            error: checkpointError instanceof Error ? checkpointError.message : String(checkpointError),
          });
        }
      }

      if (isSpotInterruption) {
        // Check if task can be retried
        if (task.retryCount < task.maxRetries) {
          logger.info("Spot interruption detected, re-queueing task for retry", {
            taskId: task.id,
            jiraIssueKey: task.jiraIssueKey,
            retryCount: task.retryCount,
            maxRetries: task.maxRetries,
          });

          // Re-queue the task for retry
          task.status = "queued";
          task.retryCount += 1;
          task.ecsTaskArn = null;
          task.ecsTaskId = null;
          task.startedAt = null;
          task.completedAt = null;
          task.taskNotes = `SPOT_RETRY: Retry ${task.retryCount}/${task.maxRetries} after Spot capacity interruption`;
          await taskRepo.save(task);

          await logTaskEvent(task.id, "status_change",
            `Spot capacity reclaimed - re-queuing for retry (${task.retryCount}/${task.maxRetries})`,
            { severity: "warning", metadata: { stopCode: ecsInfo.stopCode, exitCode: ecsInfo.exitCode } }
          );
          continue;
        } else {
          // Max retries exceeded, fail the task
          logger.warn("Spot interruption: max retries exceeded", {
            taskId: task.id,
            jiraIssueKey: task.jiraIssueKey,
            retryCount: task.retryCount,
            maxRetries: task.maxRetries,
          });

          task.status = "failed";
          task.completedAt = ecsInfo.stoppedAt || new Date();
          task.errorMessage = `Spot capacity reclaimed ${task.maxRetries} times - max retries exceeded`;
          await taskRepo.save(task);

          await logTaskEvent(task.id, "error",
            `Task failed: Spot capacity reclaimed ${task.maxRetries} times (max retries exceeded)`,
            { severity: "error" }
          );
          continue;
        }
      }

      // Read result markers from task logs
      const logs = await AppDataSource.query(
        `SELECT message FROM worker_task_logs
         WHERE task_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [task.id]
      );

      let detectedResult: string | null = null;
      let detectedPrUrl: string | null = null;
      let detectedPrNumber: number | null = null;

      for (const log of logs) {
        const msg = log.message || "";

        // Look for result marker
        const resultMatch = msg.match(/::result::(\w+)/);
        if (resultMatch && !detectedResult) {
          detectedResult = resultMatch[1];
        }

        // Look for PR URL marker
        const prUrlMatch = msg.match(/::pr_url::(https:\/\/github\.com\/[^\s]+)/);
        if (prUrlMatch && !detectedPrUrl) {
          detectedPrUrl = prUrlMatch[1];
        }

        // Look for PR number marker
        const prNumMatch = msg.match(/::pr_number::(\d+)/);
        if (prNumMatch && !detectedPrNumber) {
          detectedPrNumber = parseInt(prNumMatch[1], 10);
        }
      }

      // Determine final status based on detected result or exit code
      let newStatus: typeof task.status;
      if (detectedResult) {
        switch (detectedResult) {
          case "deployed":
            newStatus = "deployed";
            break;
          case "review_requested":
            newStatus = "review_requested";
            break;
          case "escalated":
            newStatus = "escalated";
            break;
          case "no_changes":
          case "completed":
            newStatus = "completed";
            break;
          case "failed":
            newStatus = "failed";
            break;
          default:
            newStatus = ecsInfo.exitCode === 0 ? "completed" : "failed";
        }
      } else {
        // No result marker found - fall back to exit code
        newStatus = ecsInfo.exitCode === 0 ? "completed" : "failed";
      }

      // Update task
      task.status = newStatus;
      task.completedAt = ecsInfo.stoppedAt || new Date();

      if (detectedPrUrl && !task.githubPrUrl) {
        task.githubPrUrl = detectedPrUrl;
      }
      if (detectedPrNumber && !task.githubPrNumber) {
        task.githubPrNumber = detectedPrNumber;
      }

      // Calculate duration if not set
      if (task.startedAt && !task.ecsTaskSeconds) {
        task.ecsTaskSeconds = Math.floor((task.completedAt.getTime() - task.startedAt.getTime()) / 1000);
      }

      await taskRepo.save(task);

      // Clean up coordination data for completed task (Phase 8)
      // This releases file locks, resource reservations, and removes check-in
      await checkOut(task.id).catch((checkOutError) => {
        logger.warn("Failed to check out completed task from coordination", {
          taskId: task.id,
          error: checkOutError instanceof Error ? checkOutError.message : String(checkOutError),
        });
      });

      // Send Slack notifications for terminal statuses
      // Wrap in try/catch so notification failures don't break orchestration
      try {
        if (newStatus === "completed" || newStatus === "deployed") {
          await notifyTaskCompleted(task);
          logger.debug("Sent task completed Slack notification", { taskId: task.id });
        } else if (newStatus === "failed") {
          await notifyTaskFailed(task);
          logger.debug("Sent task failed Slack notification", { taskId: task.id });
        }

        // Check if cost alert threshold exceeded after task completion
        const org = await getOrgRepo().findOne({ where: { id: task.orgId } });
        if (org && org.costAlertThresholdUsd && task.estimatedCostUsd) {
          // Get total cost this month from all tasks
          const costResult = await AppDataSource.query(
            `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total_cost
             FROM worker_tasks
             WHERE org_id = $1
               AND created_at >= $2`,
            [task.orgId, org.billingCycleStart || new Date(new Date().setDate(1))]
          );
          const totalCost = parseFloat(costResult[0]?.total_cost || "0");
          if (totalCost >= org.costAlertThresholdUsd) {
            await notifyCostAlert(task.orgId, totalCost, org.costAlertThresholdUsd);
            logger.info("Sent cost alert notification", {
              orgId: task.orgId,
              totalCost,
              threshold: org.costAlertThresholdUsd,
            });
          }
        }
      } catch (notifyError) {
        logger.warn("Failed to send Slack notification", {
          taskId: task.id,
          error: notifyError instanceof Error ? notifyError.message : String(notifyError),
        });
      }

      const logMessage = detectedResult
        ? `Task completed via ECS monitoring: result=${detectedResult}, status=${newStatus}`
        : `Task completed via ECS monitoring: exit_code=${ecsInfo.exitCode}, status=${newStatus}`;

      await logTaskEvent(task.id, "status_change", logMessage, {
        severity: newStatus === "failed" ? "error" : "info"
      });

      logger.info("Task completion detected and processed", {
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        newStatus,
        detectedResult,
        exitCode: ecsInfo.exitCode,
        prUrl: detectedPrUrl,
      });

    } catch (error) {
      logger.error("Error processing task completion", {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Monitor manager_review tasks for completion
 * Detects when Manager ECS tasks finish and processes their review decision
 * This is the backup mechanism - manager callback is primary
 */
async function monitorManagerTasks(): Promise<void> {
  const taskRepo = getTaskRepo();

  // Find tasks in manager_review status with a manager ECS task
  const managerTasks = await taskRepo
    .createQueryBuilder("task")
    .where("task.status = :status", { status: "manager_review" })
    .andWhere("task.manager_ecs_task_arn IS NOT NULL")
    .limit(10)
    .getMany();

  if (managerTasks.length === 0) return;

  // Batch describe ECS tasks for efficiency
  const taskArns = managerTasks.map(t => t.managerEcsTaskArn!).filter(Boolean);
  if (taskArns.length === 0) return;

  let ecsTasksMap: Map<string, { lastStatus: string; exitCode: number; stoppedAt?: Date }> = new Map();

  try {
    const describeResult = await ecsClient.send(
      new DescribeTasksCommand({
        cluster: config.aws.ecsCluster,
        tasks: taskArns,
      })
    );

    for (const ecsTask of describeResult.tasks || []) {
      const container = ecsTask.containers?.find((c) => c.name === "worker");
      ecsTasksMap.set(ecsTask.taskArn!, {
        lastStatus: ecsTask.lastStatus || "UNKNOWN",
        exitCode: container?.exitCode ?? -1,
        stoppedAt: ecsTask.stoppedAt,
      });
    }
  } catch (error) {
    logger.error("Error describing manager ECS tasks", { error: error instanceof Error ? error.message : String(error) });
    return;
  }

  for (const task of managerTasks) {
    try {
      const ecsInfo = ecsTasksMap.get(task.managerEcsTaskArn!);

      if (!ecsInfo) {
        // ECS task not found - might have been cleaned up, check logs for decision
        logger.warn("Manager ECS task not found, checking logs for decision", { taskId: task.id });
      } else if (ecsInfo.lastStatus !== "STOPPED") {
        // Manager still running
        continue;
      }

      logger.info("Detected Manager ECS task completion", {
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        exitCode: ecsInfo?.exitCode,
      });

      // Read decision markers from task logs
      const logs = await AppDataSource.query(
        `SELECT message FROM worker_task_logs
         WHERE task_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [task.id]
      );

      let detectedDecision: string | null = null;
      let detectedScore: number | null = null;
      let detectedFeedback: string | null = null;

      for (const log of logs) {
        const msg = log.message || "";

        // Look for manager decision marker
        const decisionMatch = msg.match(/::manager_decision::(approved|revision_needed|rejected|failed)/);
        if (decisionMatch && !detectedDecision) {
          detectedDecision = decisionMatch[1];
        }

        // Look for score marker
        const scoreMatch = msg.match(/::manager_score::(\d+)/);
        if (scoreMatch && !detectedScore) {
          detectedScore = parseInt(scoreMatch[1], 10);
        }

        // Look for feedback marker
        const feedbackMatch = msg.match(/::manager_feedback::(.+)/);
        if (feedbackMatch && !detectedFeedback) {
          detectedFeedback = feedbackMatch[1];
        }
      }

      if (!detectedDecision) {
        // No decision marker found - if ECS task stopped, assume approved (no issues found)
        if (ecsInfo && ecsInfo.exitCode === 0) {
          detectedDecision = "approved";
          logger.info("No manager decision marker found, defaulting to approved", { taskId: task.id });
        } else if (ecsInfo) {
          detectedDecision = "failed";
          logger.warn("Manager task failed without decision marker", { taskId: task.id, exitCode: ecsInfo.exitCode });
        } else {
          // No ECS info and no decision - skip for now
          continue;
        }
      }

      // Process the decision (must match manager-complete endpoint logic exactly)
      let newStatus: typeof task.status;
      switch (detectedDecision) {
        case "approved":
          // Manager approved - re-queue for deployment run (same as manager-complete endpoint)
          newStatus = "queued";
          task.taskNotes = `DEPLOYMENT_RUN: Manager approved PR. Deploy and merge.`;
          task.completedAt = null;
          task.ecsTaskArn = null;
          task.ecsTaskId = null;
          task.startedAt = null;
          logger.info("Manager approved PR via log detection, re-queueing for deployment", { taskId: task.id });
          break;

        case "revision_needed":
          task.revisionCount = (task.revisionCount || 0) + 1;
          if (task.canRevise()) {
            newStatus = "queued";
            task.taskNotes = `REVISION_RUN: Manager requested changes (attempt ${task.revisionCount}/3). Feedback: ${detectedFeedback || "See logs"}`;
            task.completedAt = null;
            task.ecsTaskArn = null;
            task.ecsTaskId = null;
            task.startedAt = null;
            logger.info("Manager requested revision via log detection, re-queueing", { taskId: task.id, revisionCount: task.revisionCount });
          } else {
            newStatus = "failed";
            task.errorMessage = `Max revisions (3) reached. Final feedback: ${detectedFeedback || "See logs"}`;
            logger.info("Max revisions reached via log detection", { taskId: task.id });
          }
          break;

        case "rejected":
          newStatus = "review_rejected";
          task.errorMessage = `Rejected by Virtual Manager: ${detectedFeedback || "See logs"}`;
          logger.info("Manager rejected PR via log detection", { taskId: task.id });
          break;

        case "failed":
        default:
          newStatus = "failed";
          task.errorMessage = "Manager review failed";
          break;
      }

      // Update task
      task.status = newStatus;
      if (detectedFeedback) {
        task.reviewFeedback = detectedFeedback;
      }
      // Clear manager ECS info after processing
      task.managerEcsTaskArn = null;
      task.managerEcsTaskId = null;

      await taskRepo.save(task);

      await logTaskEvent(task.id, "status_change", `Manager review completed via log detection: decision=${detectedDecision}, status=${newStatus}`, {
        severity: newStatus === "failed" || newStatus === "review_rejected" ? "error" : "info"
      });

      logger.info("Manager review completion detected and processed", {
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        newStatus,
        detectedDecision,
        detectedScore,
      });

    } catch (error) {
      logger.error("Error processing manager completion", {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
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

    // Get separate manager GitHub token for PR approvals (avoids self-approval block)
    const managerToken = await getManagerGitHubToken();
    if (managerToken) {
      credentials.githubToken = managerToken;
    }

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

    // Get separate manager GitHub token (for consistency with PR review)
    const managerToken = await getManagerGitHubToken();
    if (managerToken) {
      credentials.githubToken = managerToken;
    }

    // Spawn Manager ECS task for log analysis
    const runner = getECSTaskRunner();
    const result = await runner.runManagerTask(task, credentials, "analyze_logs");

    // Store manager ECS info (same as PR review)
    task.managerEcsTaskArn = result.taskArn;
    task.managerEcsTaskId = result.taskId;
    await taskRepo.save(task);

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

        // Note: Quota is already checked in findQueuedTasks() which filters out
        // orgs that exceed their quota. Tasks from blocked orgs won't reach here.
        // The task stays queued until quota resets at billing cycle.

        // Try to claim the task
        if (await claimTask(task.id)) {
          logger.info("Task claimed", {
            taskId: task.id,
            jiraIssueKey: task.jiraIssueKey,
          });

          // Note: Task usage is incremented in spawnWorker() after successful ECS spawn
          // to avoid counting failed spawn attempts against quota

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

      // Check for approved tasks that need deployment (deploy label added after approval)
      const deploymentTasks = await findApprovedTasksNeedingDeployment();
      for (const task of deploymentTasks) {
        if (!state.running) break;

        // Re-queue for deployment
        requeueForDeployment(task).catch((error) => {
          logger.error("Error in requeueForDeployment", {
            taskId: task.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }

      // Monitor executing tasks - detect completion via ECS status
      // This is the PRIMARY completion mechanism (worker callbacks are backup)
      await monitorExecutingTasks().catch((error) => {
        logger.error("Error in monitorExecutingTasks", {
            error: error instanceof Error ? error.message : String(error),
          });
        });

      // Monitor manager tasks - detect manager completion via ECS status and log markers
      await monitorManagerTasks().catch((error) => {
        logger.error("Error in monitorManagerTasks", {
            error: error instanceof Error ? error.message : String(error),
          });
        });

      // Clean up stale coordination data (Phase 8: Watcher/Cleanup)
      // Run every ~1 minute (12 polls * 5 seconds = 60 seconds)
      // This releases file locks and removes check-ins for workers that haven't heartbeated in 5+ minutes
      if (state.tasksProcessed % 12 === 0 || state.tasksProcessed === 0) {
        await cleanupStaleCoordination().catch((error) => {
          logger.error("Error in cleanupStaleCoordination", {
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
 * Clean up old task checkpoints from S3
 * Removes checkpoint files older than 7 days to prevent unbounded storage growth
 * (Phase 6: Checkpoint Cleanup)
 */
async function cleanupOldCheckpoints(): Promise<void> {
  try {
    const bucket = config.s3.checkpointBucket;
    const cutoffDays = 7;
    const cutoffTime = Date.now() - cutoffDays * 24 * 60 * 60 * 1000;

    let continuationToken: string | undefined;
    let totalDeleted = 0;
    let objectsScanned = 0;

    // List all checkpoint files in S3
    while (true) {
      const listCommand = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "", // List all objects
        ContinuationToken: continuationToken,
      });

      const listResponse = await s3Client.send(listCommand);
      const contents = listResponse.Contents || [];
      objectsScanned += contents.length;

      // Check each checkpoint file for age
      for (const obj of contents) {
        if (!obj.Key || !obj.LastModified) continue;

        // Skip non-checkpoint files (checkpoint files are in taskId/checkpoint.json format)
        if (!obj.Key.endsWith("/checkpoint.json")) continue;

        // Check if file is older than cutoff
        const lastModifiedTime = obj.LastModified.getTime();
        if (lastModifiedTime < cutoffTime) {
          // Delete the checkpoint file
          try {
            await s3Client.send(
              new DeleteObjectCommand({
                Bucket: bucket,
                Key: obj.Key,
              })
            );
            totalDeleted++;
            logger.debug("Deleted old checkpoint file", {
              key: obj.Key,
              lastModified: obj.LastModified.toISOString(),
              ageHours: Math.floor((Date.now() - lastModifiedTime) / (60 * 60 * 1000)),
            });
          } catch (deleteError) {
            logger.warn("Failed to delete checkpoint file", {
              key: obj.Key,
              error: deleteError instanceof Error ? deleteError.message : String(deleteError),
            });
          }
        }
      }

      // Check for more results
      if (listResponse.IsTruncated && listResponse.NextContinuationToken) {
        continuationToken = listResponse.NextContinuationToken;
      } else {
        break;
      }
    }

    if (totalDeleted > 0) {
      logger.info("Cleaned up old checkpoints from S3", {
        deletedCount: totalDeleted,
        objectsScanned,
        cutoffDays,
        bucket,
      });
    }
  } catch (error) {
    logger.error("Failed to clean up old checkpoints", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
 * Cleans up old logs and checkpoints to prevent unbounded growth
 */
async function cleanupLoop(): Promise<void> {
  while (state.running) {
    // Run cleanup tasks in parallel
    await Promise.all([
      cleanupOldLogs(),
      cleanupOldCheckpoints(),
    ]).catch((error) => {
      logger.error("Error during cleanup operations", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    // Run every hour
    await new Promise((resolve) => setTimeout(resolve, 60 * 60 * 1000));
  }
}
