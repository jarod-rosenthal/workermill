/**
 * Warm Container Pool Service
 *
 * Manages a pool of pre-warmed ECS containers to eliminate cold-start latency.
 * Containers start with minimal env vars, poll for task assignment, then execute.
 */

import { AppDataSource } from "../db/connection.js";
import { WarmContainer, Organization, WorkerTask } from "../models/index.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { getECSTaskRunner } from "./ecs-task-runner.js";

// Repositories
const getWarmContainerRepo = () => AppDataSource.getRepository(WarmContainer);
const getOrgRepo = () => AppDataSource.getRepository(Organization);

// Stale container threshold (no heartbeat for 90 seconds = unhealthy)
const STALE_HEARTBEAT_THRESHOLD_MS = 90 * 1000;

// Long-poll timeout for containers waiting for assignment
export const POLL_TIMEOUT_MS = 30 * 1000;

/**
 * Check if current time is within org's warm pool working hours
 */
export function isWithinWorkingHours(org: Organization): boolean {
  if (org.warmPoolSize <= 0) return false;

  try {
    // Get current time in org's timezone
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: org.warmPoolTimezone || "America/New_York",
      hour: "numeric",
      hour12: false,
    });
    const hourStr = formatter.format(now);
    const hour = parseInt(hourStr, 10);

    // Check if within working hours
    // Handle case where start > end (e.g., night shift: 22-6)
    if (org.warmPoolHoursStart <= org.warmPoolHoursEnd) {
      return hour >= org.warmPoolHoursStart && hour < org.warmPoolHoursEnd;
    } else {
      // Overnight range (e.g., 22:00 to 06:00)
      return hour >= org.warmPoolHoursStart || hour < org.warmPoolHoursEnd;
    }
  } catch (error) {
    logger.warn("Failed to check working hours, defaulting to inactive", {
      orgId: org.id,
      timezone: org.warmPoolTimezone,
      error,
    });
    return false;
  }
}

/**
 * Register a warm container as ready
 * Called by the warm-wait.sh script when container is ready to receive tasks
 */
export async function registerContainerReady(
  ecsTaskId: string,
  ecsTaskArn: string,
): Promise<WarmContainer | null> {
  const repo = getWarmContainerRepo();

  // Find the warming container and update to ready
  const result = await repo
    .createQueryBuilder()
    .update(WarmContainer)
    .set({
      status: "ready",
      readyAt: new Date(),
      heartbeatAt: new Date(),
    })
    .where("ecs_task_id = :ecsTaskId", { ecsTaskId })
    .andWhere("status = :status", { status: "warming" })
    .returning("id")
    .execute();

  if (result.raw.length === 0) {
    logger.warn("No warming container found to mark ready", { ecsTaskId });
    return null;
  }

  // Fetch the full entity by ID to get proper camelCase mapping
  const containerId = result.raw[0].id;
  const container = await repo.findOne({ where: { id: containerId } });

  if (!container) {
    logger.error("Container disappeared after marking ready", { containerId, ecsTaskId });
    return null;
  }

  logger.info("Warm container registered as ready", {
    containerId: container.id,
    ecsTaskId: container.ecsTaskId,
    orgId: container.orgId,
  });

  return container;
}

/**
 * Update container heartbeat
 * Called during each poll to indicate the container is still healthy
 */
export async function updateHeartbeat(ecsTaskId: string): Promise<void> {
  const repo = getWarmContainerRepo();
  await repo.update(
    { ecsTaskId, status: "ready" },
    { heartbeatAt: new Date() },
  );
}

/**
 * Atomically claim a ready warm container for a task
 * Returns the container if one was claimed, null otherwise
 */
export async function claimWarmContainer(
  orgId: string,
): Promise<WarmContainer | null> {
  const repo = getWarmContainerRepo();
  const orgRepo = getOrgRepo();

  // Check if warm pool is enabled for this org
  const org = await orgRepo.findOne({ where: { id: orgId } });
  if (!org || org.warmPoolSize <= 0) {
    // Warm pool disabled - don't claim any containers
    return null;
  }

  // Atomic claim: UPDATE ... WHERE status = 'ready' AND org_id = :orgId LIMIT 1
  const result = await repo
    .createQueryBuilder()
    .update(WarmContainer)
    .set({
      status: "assigned",
      assignedAt: new Date(),
    })
    .where("org_id = :orgId", { orgId })
    .andWhere("status = :status", { status: "ready" })
    .andWhere("heartbeat_at > :threshold", {
      threshold: new Date(Date.now() - STALE_HEARTBEAT_THRESHOLD_MS),
    })
    .returning("id")
    .execute();

  if (result.raw.length === 0) {
    return null;
  }

  // Fetch the full entity by ID to get proper camelCase mapping
  const containerId = result.raw[0].id;
  const container = await repo.findOne({ where: { id: containerId } });

  if (!container) {
    logger.error("Container disappeared after claim", { containerId, orgId });
    return null;
  }

  logger.info("Claimed warm container for task", {
    containerId: container.id,
    ecsTaskId: container.ecsTaskId,
    ecsTaskArn: container.ecsTaskArn,
    orgId,
  });

  return container;
}

/**
 * Assign a task to a claimed warm container
 * Stores the environment variables that the container will fetch
 */
export async function assignTaskToContainer(
  containerId: string,
  taskId: string,
  environment: Record<string, string>,
): Promise<void> {
  const repo = getWarmContainerRepo();

  await repo.update(containerId, {
    assignedTaskId: taskId,
    taskEnvironment: environment,
  });

  logger.info("Assigned task to warm container", {
    containerId,
    taskId,
    envVarCount: Object.keys(environment).length,
  });
}

/**
 * Get task assignment for a polling container
 * Returns environment variables if assigned, null if still waiting
 */
export async function getContainerAssignment(
  ecsTaskId: string,
): Promise<{ status: "assigned" | "waiting" | "terminate"; environment?: Record<string, string> }> {
  const repo = getWarmContainerRepo();

  const container = await repo.findOne({
    where: { ecsTaskId },
  });

  if (!container) {
    return { status: "terminate" };
  }

  // Update heartbeat
  await repo.update(container.id, { heartbeatAt: new Date() });

  if (container.status === "assigned" && container.taskEnvironment) {
    return {
      status: "assigned",
      environment: container.taskEnvironment,
    };
  }

  if (container.status === "terminated") {
    return { status: "terminate" };
  }

  return { status: "waiting" };
}

/**
 * Mark container as terminated
 */
export async function terminateContainer(ecsTaskId: string): Promise<void> {
  const repo = getWarmContainerRepo();
  await repo.update({ ecsTaskId }, { status: "terminated" });
}

/**
 * Get count of containers by status for an org
 */
export async function getPoolStatus(orgId: string): Promise<{
  warming: number;
  ready: number;
  assigned: number;
  total: number;
}> {
  const repo = getWarmContainerRepo();

  const results = await repo
    .createQueryBuilder("wc")
    .select("wc.status", "status")
    .addSelect("COUNT(*)", "count")
    .where("wc.org_id = :orgId", { orgId })
    .andWhere("wc.status != :terminated", { terminated: "terminated" })
    .groupBy("wc.status")
    .getRawMany();

  const counts = {
    warming: 0,
    ready: 0,
    assigned: 0,
    total: 0,
  };

  for (const row of results) {
    const status = row.status as keyof typeof counts;
    const count = parseInt(row.count, 10);
    if (status in counts) {
      counts[status] = count;
    }
    counts.total += count;
  }

  return counts;
}

/**
 * Mark stale containers as terminated
 * Called periodically to clean up containers that stopped sending heartbeats
 */
export async function markUnhealthyContainers(): Promise<number> {
  const repo = getWarmContainerRepo();
  const threshold = new Date(Date.now() - STALE_HEARTBEAT_THRESHOLD_MS);

  const result = await repo
    .createQueryBuilder()
    .update(WarmContainer)
    .set({ status: "terminated" })
    .where("status IN (:...statuses)", { statuses: ["warming", "ready"] })
    .andWhere("(heartbeat_at < :threshold OR heartbeat_at IS NULL)", { threshold })
    .andWhere("created_at < :createdThreshold", {
      createdThreshold: new Date(Date.now() - 2 * 60 * 1000), // Give 2 mins to start
    })
    .execute();

  if (result.affected && result.affected > 0) {
    logger.info("Marked unhealthy warm containers as terminated", {
      count: result.affected,
    });
  }

  return result.affected || 0;
}

/**
 * Clean up old terminated container records
 * Called periodically to prevent table bloat
 */
export async function cleanupTerminatedContainers(): Promise<number> {
  const repo = getWarmContainerRepo();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours

  const result = await repo
    .createQueryBuilder()
    .delete()
    .where("status = :status", { status: "terminated" })
    .andWhere("created_at < :cutoff", { cutoff })
    .execute();

  if (result.affected && result.affected > 0) {
    logger.info("Cleaned up old terminated containers", {
      count: result.affected,
    });
  }

  return result.affected || 0;
}

/**
 * Spawn a new warm container for an organization
 */
export async function spawnWarmContainer(org: Organization): Promise<WarmContainer | null> {
  const repo = getWarmContainerRepo();
  const ecsRunner = getECSTaskRunner();

  try {
    // Spawn ECS task with minimal environment (warm pool mode)
    const result = await ecsRunner.runWarmContainer(org.id);

    // Create database record
    const container = repo.create({
      orgId: org.id,
      ecsTaskArn: result.taskArn,
      ecsTaskId: result.taskId,
      status: "warming",
      heartbeatAt: new Date(), // Initial heartbeat
    });

    await repo.save(container);

    logger.info("Spawned warm container", {
      containerId: container.id,
      ecsTaskId: result.taskId,
      orgId: org.id,
    });

    return container;
  } catch (error) {
    logger.error("Failed to spawn warm container", {
      orgId: org.id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return null;
  }
}

/**
 * Maintain the warm pool size for an organization
 * Spawns new containers if needed, terminates extras if pool is oversized
 */
export async function maintainPoolSize(org: Organization): Promise<void> {
  // Check if warm pool should be active
  const shouldBeActive = isWithinWorkingHours(org);
  const targetSize = shouldBeActive ? org.warmPoolSize : 0;

  const status = await getPoolStatus(org.id);
  const activeCount = status.warming + status.ready;

  if (activeCount < targetSize) {
    // Need to spawn more containers
    const toSpawn = targetSize - activeCount;
    logger.info("Spawning warm containers to reach target", {
      orgId: org.id,
      activeCount,
      targetSize,
      toSpawn,
    });

    for (let i = 0; i < toSpawn; i++) {
      await spawnWarmContainer(org);
    }
  } else if (activeCount > targetSize && targetSize === 0) {
    // Outside working hours, terminate all warm containers
    const repo = getWarmContainerRepo();
    const ecsRunner = getECSTaskRunner();

    const containers = await repo.find({
      where: {
        orgId: org.id,
        status: "ready" as const,
      },
    });

    for (const container of containers) {
      try {
        await ecsRunner.stopTask(container.ecsTaskArn, "Outside warm pool working hours");
        await repo.update(container.id, { status: "terminated" });
        logger.info("Terminated warm container outside working hours", {
          containerId: container.id,
          ecsTaskId: container.ecsTaskId,
        });
      } catch (error) {
        logger.error("Failed to terminate warm container", {
          containerId: container.id,
          error,
        });
      }
    }
  }
}

/**
 * Maintain warm pools for all organizations with warm pool enabled
 * Called periodically by the orchestrator
 */
export async function maintainAllWarmPools(): Promise<void> {
  const orgRepo = getOrgRepo();

  // Find all orgs with warm pool enabled (warmPoolSize > 0)
  const orgsWithPool = await orgRepo
    .createQueryBuilder("org")
    .where("org.warm_pool_size > 0")
    .getMany();

  for (const org of orgsWithPool) {
    try {
      await maintainPoolSize(org);
    } catch (error) {
      logger.error("Failed to maintain warm pool for org", {
        orgId: org.id,
        error,
      });
    }
  }

  // Also clean up stale containers and old records
  await markUnhealthyContainers();
  await cleanupTerminatedContainers();
}

/**
 * Build environment variables for a task (matching ECS task runner format)
 * This is called when assigning a task to a warm container
 */
export function buildTaskEnvironment(
  task: WorkerTask,
  credentials: {
    anthropicApiKey: string;
    githubToken?: string; // Optional - only required for GitHub SCM provider
    githubReviewerToken?: string;
    orgApiKey?: string;
    jiraBaseUrl?: string;
    jiraEmail?: string;
    jiraApiToken?: string;
    providerApiKey?: string;
    providerId?: string;
    ollamaBaseUrl?: string;
    ollamaContextWindow?: number;
    vllmBaseUrl?: string;
    managerProvider?: string;
    managerModelId?: string;
    maxReviewRevisions?: number;
    openaiApiKey?: string;
    googleApiKey?: string;
    scmProvider?: string;
    scmBaseUrl?: string;
    scmToken?: string;
    bitbucketUsername?: string;
    bitbucketEmail?: string;
    customerAwsRoleArn?: string;
    customerAwsExternalId?: string;
    customerAwsRegion?: string;
    // Ralph execution settings
    useRalph?: boolean;
    ralphMaxStories?: number;
    // Issue tracker support
    linearApiKey?: string;
    issueTrackerProvider?: string;
  },
): Record<string, string> {
  const env: Record<string, string> = {
    TASK_ID: task.id,
    ORG_ID: task.orgId,
    JIRA_ISSUE_KEY: task.jiraIssueKey || "",
    JIRA_SUMMARY: task.summary,
    JIRA_DESCRIPTION: task.description || "",
    GITHUB_REPO: task.githubRepo,
    WORKER_PERSONA: task.workerPersona,
    WORKER_MODEL: task.workerModel,
    GITHUB_TOKEN: credentials.githubToken || "",
    GITHUB_REVIEWER_TOKEN: credentials.githubReviewerToken || "",
    SCM_PROVIDER: credentials.scmProvider || "github",
    SCM_BASE_URL: credentials.scmBaseUrl || "",
    SCM_TOKEN: credentials.scmToken || credentials.githubToken || "",
    BITBUCKET_USERNAME: credentials.bitbucketUsername || "",
    BITBUCKET_EMAIL: credentials.bitbucketEmail || "",
    API_BASE_URL: config.apiBaseUrl,
    RETRY_NUMBER: String(task.retryCount),
    JIRA_BASE_URL: credentials.jiraBaseUrl || "",
    JIRA_EMAIL: credentials.jiraEmail || "",
    JIRA_API_TOKEN: credentials.jiraApiToken || "",
    TICKET_KEY: task.jiraIssueKey || "",
    TICKET_SYSTEM: credentials.issueTrackerProvider || "jira",
    LINEAR_API_KEY: credentials.linearApiKey || "",
    DEPLOYMENT_ENABLED: task.deploymentEnabled || task.parentTaskId ? "true" : "false",
    PRD_CHILD_TASK: task.parentTaskId ? "true" : "false",
    REVIEW_ENABLED: task.skipManagerReview === false ? "true" : "false",
    IMPROVEMENT_ENABLED: task.improvementEnabled ? "true" : "false",
    STANDARD_SDK_MODE: task.standardSdkMode ? "true" : "false",
    TASK_NOTES: task.taskNotes || "",
    AWS_REGION: config.aws.region,
    ECS_CLUSTER: config.aws.ecsCluster,
    WORKER_PROVIDER: task.workerProvider || "anthropic",
    MANAGER_PROVIDER: credentials.managerProvider || "anthropic",
    MANAGER_MODEL: credentials.managerModelId || "",
    MAX_REVIEW_REVISIONS: String(credentials.maxReviewRevisions ?? 3),
    PARENT_TASK_ID: task.parentTaskId || "",
  };

  // Determine Claude model name
  const providerId = task.workerProvider || "anthropic";
  if (providerId === "anthropic") {
    if (task.workerModel.includes("opus")) {
      env.CLAUDE_MODEL = "opus";
    } else if (task.workerModel.includes("haiku")) {
      env.CLAUDE_MODEL = "haiku";
    } else {
      env.CLAUDE_MODEL = "sonnet";
    }
  } else {
    env.CLAUDE_MODEL = task.workerModel;
  }

  // Handle jiraFields
  const jiraFields = task.jiraFields as Record<string, unknown> | null;
  if (jiraFields) {
    if (jiraFields.parentJiraKey && task.jiraIssueKey && /-S\d+$/.test(task.jiraIssueKey)) {
      env.PARENT_JIRA_KEY = jiraFields.parentJiraKey as string;
    }
    if (jiraFields.targetBranch) {
      env.TARGET_BRANCH = jiraFields.targetBranch as string;
    }
    if (jiraFields.storyBranch) {
      env.STORY_BRANCH = jiraFields.storyBranch as string;
    }
    if (jiraFields.executionMode) {
      env.EXECUTION_MODE = jiraFields.executionMode as string;
    } else {
      env.EXECUTION_MODE = "autonomous";
    }
    if (jiraFields.targetFiles) {
      env.TARGET_FILES = JSON.stringify(jiraFields.targetFiles);
    }
    if (jiraFields.referenceFiles) {
      env.REFERENCE_FILES = JSON.stringify(jiraFields.referenceFiles);
    }
    if (jiraFields.pipelineVersion) {
      env.PIPELINE_VERSION = jiraFields.pipelineVersion as string;
    }
    if (jiraFields.v2StepInput) {
      env.V2_STEP_INPUT = JSON.stringify(jiraFields.v2StepInput);
    }
    // Support ticket fields
    if (jiraFields.ticketId) {
      env.SUPPORT_TICKET_ID = jiraFields.ticketId as string;
    }
    if (jiraFields.ticketKey) {
      env.SUPPORT_TICKET_KEY = jiraFields.ticketKey as string;
    }
    if (jiraFields.sourceType === "support_ticket") {
      env.IS_SUPPORT_TICKET = "true";
    }
  }

  if (task.pipelineVersion) {
    env.PIPELINE_VERSION = task.pipelineVersion;
  }

  // API keys
  if (credentials.anthropicApiKey) {
    env.ANTHROPIC_API_KEY = credentials.anthropicApiKey;
  }
  if (credentials.orgApiKey) {
    env.ORG_API_KEY = credentials.orgApiKey;
  }
  if (credentials.providerApiKey && credentials.providerId) {
    // Map provider to env var name
    const providerEnvVars: Record<string, string> = {
      openai: "OPENAI_API_KEY",
      google: "GOOGLE_API_KEY",
      ollama: "OLLAMA_HOST", // Ollama uses URL, not API key
    };
    const envVar = providerEnvVars[credentials.providerId] || `${credentials.providerId.toUpperCase()}_API_KEY`;
    env[envVar] = credentials.providerApiKey;
  }
  if (credentials.ollamaBaseUrl) {
    env.OLLAMA_HOST = credentials.ollamaBaseUrl;
  }
  if (credentials.ollamaContextWindow) {
    env.OLLAMA_CONTEXT_WINDOW = String(credentials.ollamaContextWindow);
  }
  if (credentials.vllmBaseUrl) {
    env.VLLM_BASE_URL = credentials.vllmBaseUrl;
  }
  if (credentials.openaiApiKey) {
    env.OPENAI_API_KEY = credentials.openaiApiKey;
  }
  if (credentials.googleApiKey) {
    env.GOOGLE_API_KEY = credentials.googleApiKey;
    env.GOOGLE_GENERATIVE_AI_API_KEY = credentials.googleApiKey;
  }

  // Customer AWS credentials
  if (credentials.customerAwsRoleArn) {
    env.CUSTOMER_AWS_ROLE_ARN = credentials.customerAwsRoleArn;
    if (credentials.customerAwsExternalId) {
      env.CUSTOMER_AWS_EXTERNAL_ID = credentials.customerAwsExternalId;
    }
    if (credentials.customerAwsRegion) {
      env.CUSTOMER_AWS_REGION = credentials.customerAwsRegion;
    }
  }

  // Ralph execution settings
  if (credentials.useRalph !== undefined) {
    env.USE_RALPH = credentials.useRalph ? "true" : "false";
  }
  if (credentials.ralphMaxStories !== undefined) {
    env.RALPH_MAX_STORIES = String(credentials.ralphMaxStories);
  }

  // Filter out empty values
  return Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== ""),
  );
}
