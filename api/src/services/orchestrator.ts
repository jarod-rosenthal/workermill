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
import { ECSClient, DescribeTasksCommand } from "@aws-sdk/client-ecs";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { AppDataSource } from "../db/connection.js";
import {
  WorkerTask,
  Organization,
  WorkerTaskLog,
  WorkerContext,
  type WorkerPersona,
} from "../models/index.js";
import { getECSTaskRunner } from "./ecs-task-runner.js";
import {
  config,
  getProviderCredentials,
  getTaskCheckpoint,
} from "../config/index.js";
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
import { runPlanningAgent, replanWithFeedback } from "./planning-agent.js";
import {
  postJiraComment,
  createJiraSubtask,
  createJiraStory,
  convertToEpic,
  transitionJiraIssue,
} from "../utils/jira.js";
import {
  getPullRequestStatus,
  updatePullRequestBranch,
  getPullRequestConflicts,
} from "../utils/github.js";
import { validateQualityGates } from "./quality-gates.js";

// Repositories
const getOrgRepo = () => AppDataSource.getRepository(Organization);
const getTaskRepo = () => AppDataSource.getRepository(WorkerTask);
const getLogRepo = () => AppDataSource.getRepository(WorkerTaskLog);

/**
 * Check if a task is in dry-run mode
 * Dry-run mode simulates the workflow without making real changes to Jira, Git, or spawning workers
 */
function isDryRunTask(task: WorkerTask): boolean {
  const labels = (task.jiraFields as Record<string, unknown>)?.labels;
  return Array.isArray(labels) && labels.includes("dry-run");
}

/**
 * Log a task event to the database for real-time streaming
 */
async function logTaskEvent(
  taskId: string,
  type: "status_change" | "system" | "error" | "info",
  message: string,
  options?: {
    severity?: "debug" | "info" | "warning" | "error";
    metadata?: Record<string, unknown>;
  },
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
  ollamaBaseUrl?: string; // Self-hosted Ollama endpoint URL
  ollamaContextWindow?: number; // Context window size for Ollama models
  vllmBaseUrl?: string; // vLLM/OpenAI-compatible endpoint URL (GPU inference)
  // Ralph execution settings
  useRalph?: boolean;
  ralphMaxStories?: number;
  // Manager settings
  managerProvider?: string;
  managerModelId?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
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
      }),
    );

    const token = secret.SecretString || "";

    // Cache for 5 minutes
    managerGitHubTokenCache = {
      token,
      expiresAt: now + 5 * 60 * 1000,
    };

    return token;
  } catch (error) {
    logger.warn(
      "Failed to fetch manager GitHub token, falling back to worker token",
      { error },
    );
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
        }),
      ),
      secretsClient.send(
        new GetSecretValueCommand({
          SecretId: `workermill/${config.environment}/github-token`,
        }),
      ),
      secretsClient.send(
        new GetSecretValueCommand({
          SecretId: `workermill/${config.environment}/jira-credentials`,
        }),
      ),
    ]);

    // Parse Jira credentials JSON
    let jiraCredentials: {
      domain?: string;
      base_url?: string;
      email?: string;
      api_token?: string;
    } = {};
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

    // Try to fetch OpenAI API key (for manager tasks using GPT models)
    let openaiApiKey: string | undefined;
    try {
      const openaiSecret = await secretsClient.send(
        new GetSecretValueCommand({
          SecretId: `workermill/${config.environment}/openai-api-key`,
        }),
      );
      openaiApiKey = openaiSecret.SecretString || undefined;
    } catch {
      // OpenAI key is optional - only needed if org uses OpenAI for manager
      logger.debug("OpenAI API key not configured in Secrets Manager");
    }

    // Try to fetch Google API key (for manager tasks using Gemini models)
    let googleApiKey: string | undefined;
    try {
      const googleSecret = await secretsClient.send(
        new GetSecretValueCommand({
          SecretId: `workermill/${config.environment}/google-api-key`,
        }),
      );
      googleApiKey = googleSecret.SecretString || undefined;
    } catch {
      // Google key is optional - only needed if org uses Google for manager
      logger.debug("Google API key not configured in Secrets Manager");
    }

    const credentials: OrgCredentials = {
      anthropicApiKey: anthropicSecret.SecretString || "",
      githubToken: githubSecret.SecretString || "",
      orgApiKey: org.apiKey || undefined, // Include org API key for worker callback
      jiraBaseUrl,
      jiraEmail: jiraCredentials.email,
      jiraApiToken: jiraCredentials.api_token,
      // Self-hosted Ollama endpoint
      ollamaBaseUrl: org.ollamaBaseUrl || undefined,
      ollamaContextWindow: org.ollamaContextWindow || 65536,
      // vLLM/GPU inference endpoint
      vllmBaseUrl: org.vllmBaseUrl || undefined,
      // Ralph execution settings from org
      useRalph: org.useRalphExecution ?? false,
      ralphMaxStories: org.ralphMaxStories ?? 10,
      // Manager settings from org
      managerProvider: org.managerProvider || "openai",
      managerModelId: org.managerModelId || "gpt-5.1-codex",
      openaiApiKey,
      googleApiKey,
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
      status: In([
        "claimed",
        "environment_setup",
        "executing",
        "deploying",
        "dispatching",
      ]),
    },
  });

  // Build a set of occupied persona slots per org
  const occupiedSlots = new Set<string>();
  // Count active tasks per org
  const activeCountByOrg = new Map<string, number>();

  for (const task of activeTasks) {
    occupiedSlots.add(`${task.orgId}:${task.workerPersona}`);
    activeCountByOrg.set(
      task.orgId,
      (activeCountByOrg.get(task.orgId) || 0) + 1,
    );
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
      logger.warn("Organization not found for task", {
        taskId: task.id,
        orgId: task.orgId,
      });
      return false;
    }

    // Check quota
    if (quotaBlockedOrgs.has(task.orgId)) {
      return false;
    }

    // Check persona concurrency
    // EXCEPTION: Skip persona check for child tasks in PRD workflows
    // PRD siblings should run in parallel even with the same persona
    const slotKey = `${task.orgId}:${task.workerPersona}`;
    if (occupiedSlots.has(slotKey) && !task.parentTaskId) {
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
          secondsRemaining: Math.ceil(
            (cooldownMs - timeSinceLastAttempt) / 1000,
          ),
        });
        return false;
      }
    }

    return true;
  });

  return eligibleTasks.slice(0, 5); // Process up to 5 at a time
}

/**
 * Find tasks that need planning (PRD analysis)
 *
 * These are tasks with `status: "planning"` that haven't been analyzed yet.
 * The Planning Agent will analyze them and create an execution plan.
 */
async function findPlanningTasks(): Promise<WorkerTask[]> {
  const taskRepo = getTaskRepo();

  // Find tasks in planning status that need planning:
  // - planStatus IS NULL: new tasks that haven't been planned yet
  // - planStatus = 'changes_requested': user requested plan changes and task is back in planning
  const planningTasks = await taskRepo
    .createQueryBuilder("task")
    .where("task.status = :status", { status: "planning" })
    .andWhere(
      "(task.planStatus IS NULL OR task.planStatus = :changesRequested)",
      {
        changesRequested: "changes_requested",
      },
    )
    .orderBy("task.createdAt", "ASC")
    .take(5) // Process up to 5 at a time
    .getMany();

  return planningTasks;
}

/**
 * Atomically claim a planning task
 * Prevents multiple API instances from processing the same task
 */
async function claimPlanningTask(taskId: string): Promise<boolean> {
  const taskRepo = getTaskRepo();

  // Use a temporary status marker to claim the task
  // We set planStatus to 'pending_approval' to indicate "being processed"
  // This works for both new tasks (planStatus IS NULL) and re-plans (planStatus = 'changes_requested')
  const result = await taskRepo
    .createQueryBuilder()
    .update(WorkerTask)
    .set({ planStatus: "pending_approval" })
    .where(
      "id = :id AND status = :status AND (plan_status IS NULL OR plan_status = :changesRequested)",
      {
        id: taskId,
        status: "planning",
        changesRequested: "changes_requested",
      },
    )
    .execute();

  return (result.affected || 0) > 0;
}

/**
 * Process a task that needs planning
 *
 * Calls the Planning Agent to analyze the PRD and create an execution plan.
 * The task status will be updated to "pending_plan_approval" after analysis.
 */
async function processPlanningTask(task: WorkerTask): Promise<void> {
  // Atomically claim the task to prevent race conditions
  if (!(await claimPlanningTask(task.id))) {
    logger.debug("Planning task already claimed by another instance", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
    });
    return;
  }

  logger.info("Processing planning task", {
    taskId: task.id,
    jiraIssueKey: task.jiraIssueKey,
  });

  try {
    // Check if this is a re-planning request (user provided feedback)
    const isReplanning =
      task.planFeedback && task.planFeedback.trim().length > 0;

    if (isReplanning) {
      // Log the start of re-planning with feedback
      await logTaskEvent(
        task.id,
        "status_change",
        "Re-running Planning Agent with user feedback",
      );

      logger.info("Re-planning task with user feedback", {
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        feedbackLength: task.planFeedback!.length,
      });
    } else {
      // Log the start of initial planning
      await logTaskEvent(
        task.id,
        "status_change",
        "Starting PRD analysis with Planning Agent",
      );
    }

    // Run the Planning Agent (with or without feedback)
    const plan = isReplanning
      ? await replanWithFeedback(task, task.planFeedback!)
      : await runPlanningAgent(task);

    // Log the planning result
    await logTaskEvent(
      task.id,
      "status_change",
      `Planning complete: ${plan.strategy} strategy with ${plan.stories?.length || 1} ${plan.strategy === "multi" ? "stories" : "persona"}`,
    );
    await logTaskEvent(
      task.id,
      "info",
      `Planning reasoning: ${plan.reasoning}`,
    );

    logger.info("Planning task analysis complete", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      strategy: plan.strategy,
      primaryPersona: plan.primaryPersona,
      storyCount: plan.stories?.length || 0,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error("Failed to analyze planning task", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      error: errorMessage,
    });

    // Log the error
    await logTaskEvent(task.id, "error", `Planning failed: ${errorMessage}`);

    // Mark task as failed
    const taskRepo = getTaskRepo();
    task.status = "failed";
    task.errorMessage = `Planning Agent failed: ${errorMessage}`;
    await taskRepo.save(task);
  }
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
 * Validate and fix file-based dependencies in a multi-story plan
 *
 * Detects when multiple stories target the same file and enforces sequential dependencies.
 * This prevents merge conflicts by ensuring stories that modify the same file don't run in parallel.
 *
 * @param plan - The execution plan with stories
 * @returns Modified plan with corrected dependencies
 */
export function enforceFileDependencies(plan: any): any {
  if (!plan.stories || plan.stories.length <= 1) {
    return plan;
  }

  // Build a map of file -> list of story indices that target it
  const fileToStories = new Map<string, number[]>();

  for (const story of plan.stories) {
    const targetFiles = story.targetFiles || [];
    for (const file of targetFiles) {
      if (!fileToStories.has(file)) {
        fileToStories.set(file, []);
      }
      fileToStories.get(file)!.push(story.index);
    }
  }

  // For each file targeted by multiple stories, ensure sequential dependency
  for (const [file, storyIndices] of fileToStories.entries()) {
    if (storyIndices.length > 1) {
      // Sort indices to process in order
      const sorted = storyIndices.sort((a, b) => a - b);

      logger.info("Detected shared file across multiple stories", {
        file,
        storyIndices: sorted,
        storyCount: sorted.length,
      });

      // For each story after the first, ensure it depends on the previous story targeting this file
      for (let i = 1; i < sorted.length; i++) {
        const currentIndex = sorted[i];
        const previousIndex = sorted[i - 1];
        const currentStory = plan.stories.find(
          (s: any) => s.index === currentIndex,
        );

        if (currentStory) {
          const currentDeps = currentStory.dependencies || [];

          // Check if this story already depends on the previous story
          const alreadyDepends =
            currentDeps.includes(previousIndex) ||
            currentDeps.includes(String(previousIndex));

          if (!alreadyDepends) {
            // Add synthetic dependency to prevent merge conflicts
            if (!Array.isArray(currentStory.dependencies)) {
              currentStory.dependencies = [];
            }
            currentStory.dependencies = [...currentDeps, previousIndex];

            logger.info("Added synthetic file-based dependency", {
              currentStoryIndex: currentIndex,
              dependsOnStoryIndex: previousIndex,
              file,
              reason: "Both stories target the same file",
            });
          }
        }
      }
    }
  }

  return plan;
}

/**
 * Check if a task has a multi-story plan and dispatch child tasks
 * Returns true if child tasks were created, false otherwise
 */
async function dispatchMultiStoryPlan(task: WorkerTask): Promise<boolean> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);

  // Check if this task has an approved multi-story plan
  // Type matches PlannedStory from planning-agent.ts
  const planJson = task.planJson as {
    strategy?: string;
    executionMode?: string;
    featureBranch?: string; // Feature branch for multi-story workflow
    stories?: Array<{
      id?: string;
      index: number;
      title: string;
      persona: string;
      scope?: string;
      description?: string;
      acceptanceCriteria?: string[];
      dependencies?: (string | number)[];
      estimatedComplexity?: "small" | "medium" | "large";
      storyPoints?: number;
      targetFiles?: string[];
      referenceFiles?: string[];
    }>;
  } | null;

  if (!planJson || planJson.strategy !== "multi" || !planJson.stories?.length) {
    // Not a multi-story plan, but may still need to update persona for single-story
    // PRD tasks start with project_manager persona for planning, but execution
    // should use the primaryPersona from the plan
    const singlePlan = task.planJson as {
      strategy?: string;
      primaryPersona?: string;
    } | null;
    if (singlePlan?.strategy === "single" && singlePlan.primaryPersona) {
      const oldPersona = task.workerPersona;
      task.workerPersona = singlePlan.primaryPersona as WorkerPersona;
      await taskRepo.save(task);

      logger.info("Updated single-story task persona from plan", {
        taskId: task.id,
        oldPersona,
        newPersona: task.workerPersona,
      });
    }
    return false;
  }

  // VALIDATION: Enforce file-based dependencies
  // Detects stories targeting the same file and adds synthetic dependencies
  // NOTE: We DON'T update parent task.planJson - keep original for UI display
  // The validated dependencies are only used internally for child task creation
  //
  // IMPORTANT: Deep clone the plan before validation because enforceFileDependencies
  // mutates the stories array in place. Without cloning, planJson would be modified.
  const planClone = JSON.parse(JSON.stringify(planJson));
  const validatedPlan = enforceFileDependencies(planClone);

  // Check if dependencies were added by comparing story dependencies
  const originalDeps = planJson.stories?.map(s => s.dependencies?.length || 0) || [];
  const validatedDeps = validatedPlan.stories?.map((s: any) => s.dependencies?.length || 0) || [];
  const hasNewDependencies = JSON.stringify(originalDeps) !== JSON.stringify(validatedDeps);

  if (hasNewDependencies) {
    logger.info("Applied file-based dependencies for child task creation (not saved to parent)", {
      taskId: task.id,
      jiraKey: task.jiraIssueKey,
      originalDeps,
      validatedDeps,
    });

    await logTaskEvent(
      task.id,
      "info",
      "📋 Applied file-based dependency validation for execution order",
    );
  }

  // Use validated plan (with file-based deps) for child task creation
  // Parent planJson remains unchanged so UI shows original parallel structure
  const executionPlan = { ...validatedPlan } as typeof planJson;

  // Use feature branch from approval if it exists, otherwise create one
  // This prevents creating duplicate branches (approval creates feature/OCS-123, we shouldn't create prd/ocs-123)
  let featureBranch = planJson.featureBranch as string | undefined;

  if (!featureBranch && task.githubBranch) {
    // Branch was created during approval and stored on task
    featureBranch = task.githubBranch;
  }

  logger.info("Dispatching multi-story PRD plan", {
    taskId: task.id,
    jiraIssueKey: task.jiraIssueKey,
    storyCount: planJson.stories.length,
    featureBranch: featureBranch || "(will create)",
  });

  // Log dispatch start
  await logTaskEvent(
    task.id,
    "status_change",
    `Dispatching ${planJson.stories.length} stories for parallel execution`,
  );

  // DRY-RUN: Simulate dispatch without creating real Jira stories, Git branches, etc.
  const isDryRun = isDryRunTask(task);
  if (isDryRun) {
    logger.info("[DRY RUN] Simulating multi-story dispatch", {
      taskId: task.id,
      jiraKey: task.jiraIssueKey,
      storyCount: planJson.stories.length,
    });

    await logTaskEvent(task.id, "info", `[DRY RUN] Would create feature branch: feature/${task.jiraIssueKey}`);
    await logTaskEvent(task.id, "info", `[DRY RUN] Would convert ${task.jiraIssueKey} to Epic`);

    // Create simulated child tasks (in DB only, no Jira stories)
    // Use executionPlan.stories (validated with file-based dependencies) instead of planJson.stories
    const childTaskIds: string[] = [];
    for (let i = 0; i < executionPlan.stories!.length; i++) {
      const story = executionPlan.stories![i];
      const childTask = new WorkerTask();
      childTask.orgId = task.orgId;
      childTask.jiraIssueKey = `${task.jiraIssueKey}-DRY-S${i + 1}`;
      childTask.jiraIssueId = task.jiraIssueId;
      childTask.summary = `[DRY RUN] S${i + 1}: ${story.title}`;
      childTask.workerPersona = story.persona as WorkerPersona;
      childTask.workerModel = task.workerModel;
      childTask.workerProvider = task.workerProvider;

      // Stories with dependencies start as BLOCKED; stories without dependencies start as QUEUED
      const hasDependencies = story.dependencies && story.dependencies.length > 0;
      childTask.status = hasDependencies ? "blocked" : "queued";

      childTask.parentTaskId = task.id;
      childTask.githubRepo = task.githubRepo;
      childTask.jiraFields = {
        ...(task.jiraFields || {}),
        labels: [...((task.jiraFields as Record<string, unknown>)?.labels as string[] || [])],
        storyIndex: i + 1, // 1-based to match regular path
        storyDependencies: story.dependencies
          ?.map((depId: string | number) => {
            // Dependencies come as 0-based indices from the planning agent
            // Convert to 1-based storyIndex (storyIndex starts at 1)
            if (typeof depId === "number") {
              return depId + 1; // 0 -> 1, 1 -> 2, etc.
            }
            // Fallback: try to find by ID if it's a string
            const depIndex = executionPlan.stories!.findIndex((s: { id?: string }) => s.id === depId);
            return depIndex >= 0 ? depIndex + 1 : null;
          })
          .filter((x: number | null): x is number => x !== null && x !== undefined) || [],
        targetFiles: story.targetFiles || [],
      };

      const savedChild = await taskRepo.save(childTask);
      childTaskIds.push(savedChild.id);

      const statusNote = hasDependencies ? "(blocked - has dependencies)" : "(queued)";
      await logTaskEvent(task.id, "info", `[DRY RUN] Created simulated story ${i + 1}: ${story.title} ${statusNote}`);
      logger.info("[DRY RUN] Created simulated child task", {
        parentTaskId: task.id,
        childTaskId: savedChild.id,
        storyIndex: i + 1,
        status: childTask.status,
        dependencies: childTask.jiraFields?.storyDependencies,
      });
    }

    // Update parent with child IDs
    task.childTaskIds = childTaskIds;
    task.status = "dispatching";
    await taskRepo.save(task);

    await logTaskEvent(task.id, "info", `[DRY RUN] Dispatch complete - ${childTaskIds.length} simulated stories queued`);
    logger.info("[DRY RUN] Multi-story dispatch simulated", {
      taskId: task.id,
      childCount: childTaskIds.length,
    });

    return true;
  }

  // Only create feature branch if not already created during approval
  if (task.githubRepo && !featureBranch) {
    // Generate feature branch name: feature/<jira-key>
    featureBranch = `feature/${task.jiraIssueKey || task.id.slice(0, 8)}`;

    const { createBranch } = await import("../utils/github.js");
    const branchCreated = await createBranch(
      task.githubRepo,
      featureBranch,
      "main",
    );
    if (branchCreated) {
      await logTaskEvent(
        task.id,
        "info",
        `📌 Created feature branch: ${featureBranch}`,
      );
      logger.info("Created feature branch for multi-story workflow", {
        taskId: task.id,
        repo: task.githubRepo,
        featureBranch,
      });
    } else {
      await logTaskEvent(
        task.id,
        "info",
        `⚠️ Could not create feature branch ${featureBranch} - child PRs will target main`,
      );
      logger.warn("Failed to create feature branch", {
        taskId: task.id,
        repo: task.githubRepo,
        featureBranch,
      });
      featureBranch = undefined;
    }

    // Store the feature branch in planJson for later use (final PR creation)
    planJson.featureBranch = featureBranch;
    task.planJson = planJson as unknown as Record<string, unknown>;
    task.githubBranch = featureBranch || null;
  } else if (featureBranch) {
    await logTaskEvent(
      task.id,
      "info",
      `📌 Using feature branch from approval: ${featureBranch}`,
    );
  }

  // Convert parent ticket to Epic before creating child Stories
  let useEpicWorkflow = false;
  if (task.jiraIssueKey) {
    const converted = await convertToEpic(task.jiraIssueKey);
    if (converted) {
      useEpicWorkflow = true;
      await logTaskEvent(
        task.id,
        "info",
        `📌 Converted ${task.jiraIssueKey} to Epic for story tracking`,
      );
      logger.info("Converted PRD to Epic", {
        taskId: task.id,
        jiraKey: task.jiraIssueKey,
      });
    } else {
      logger.warn("Could not convert to Epic, will use sub-tasks", {
        taskId: task.id,
        jiraKey: task.jiraIssueKey,
      });
    }
  }

  // Idempotency check: if child tasks already exist, don't create duplicates
  // This handles the case where dispatch partially succeeded then failed
  const existingChildren = await taskRepo.find({
    where: { parentTaskId: task.id },
  });

  if (existingChildren.length > 0) {
    logger.warn(
      "Child tasks already exist for parent - skipping dispatch to prevent duplicates",
      {
        taskId: task.id,
        existingChildCount: existingChildren.length,
        expectedStoryCount: planJson.stories.length,
      },
    );

    // Update parent to dispatching state if not already
    if (task.status !== "dispatching") {
      task.status = "dispatching";
      task.childTaskIds = existingChildren.map((c) => c.id);
      await taskRepo.save(task);
    }

    return true; // Already dispatched
  }

  // Create child tasks for each story
  // Use executionPlan.stories which has validated file-based dependencies
  const childTasks: WorkerTask[] = [];
  const childTaskIds: string[] = [];

  for (let i = 0; i < executionPlan.stories!.length; i++) {
    const story = executionPlan.stories![i];

    // Build a comprehensive description from story details
    // The planning agent provides: title, scope, acceptanceCriteria, dependencies
    const descriptionParts: string[] = [];

    // Include scope (what this story covers)
    if (story.scope) {
      descriptionParts.push(`## Scope\n${story.scope}`);
    }

    // Include acceptance criteria
    if (story.acceptanceCriteria && story.acceptanceCriteria.length > 0) {
      descriptionParts.push(
        `## Acceptance Criteria\n${story.acceptanceCriteria.map((ac: string) => `- ${ac}`).join("\n")}`,
      );
    }

    // Include estimated complexity
    if (story.estimatedComplexity) {
      descriptionParts.push(`## Complexity: ${story.estimatedComplexity}`);
    }

    // Include dependency context if any
    if (story.dependencies && story.dependencies.length > 0) {
      const depTitles = story.dependencies
        .map((depId: string | number) => {
          const depStory = executionPlan.stories!.find(
            (s: { id?: string; index?: number }) => s.id === depId || s.index === depId,
          );
          return depStory
            ? `Story ${depStory.index + 1}: ${depStory.title}`
            : null;
        })
        .filter(Boolean);
      if (depTitles.length > 0) {
        descriptionParts.push(
          `## Dependencies (completed before this story)\n${depTitles.map((t: string | null) => `- ${t}`).join("\n")}`,
        );
      }
    }

    // Reference to parent PRD for full context
    descriptionParts.push(
      `## Parent PRD\nSee ${task.jiraIssueKey} for full PRD context.`,
    );

    const fullDescription =
      descriptionParts.length > 0 ? descriptionParts.join("\n\n") : story.title;

    // Create real Jira Story (linked to Epic) or Sub-task for this story
    let jiraStoryKey = `${task.jiraIssueKey}-S${i + 1}`; // Fallback synthetic key
    let jiraStoryId: string | null = null;

    if (task.jiraIssueKey) {
      // Try creating a Story linked to Epic first, fallback to sub-task
      if (useEpicWorkflow) {
        const story_result = await createJiraStory(
          task.jiraIssueKey,
          `S${i + 1}: ${story.title}`,
          fullDescription,
        );
        if (story_result) {
          jiraStoryKey = story_result.key;
          jiraStoryId = story_result.id;
          logger.info("Created Jira Story linked to Epic", {
            parentTaskId: task.id,
            storyIndex: i + 1,
            storyKey: story_result.key,
            epicKey: task.jiraIssueKey,
          });
        }
      }

      // Fallback to sub-task if Story creation failed or Epic workflow not available
      if (!jiraStoryId) {
        const subtask = await createJiraSubtask(
          task.jiraIssueKey,
          `S${i + 1}: ${story.title}`,
          fullDescription,
        );
        if (subtask) {
          jiraStoryKey = subtask.key;
          jiraStoryId = subtask.id;
          logger.info("Created Jira sub-task for story", {
            parentTaskId: task.id,
            storyIndex: i + 1,
            subtaskKey: subtask.key,
          });
        } else {
          logger.warn("Failed to create Jira issue, using synthetic key", {
            parentTaskId: task.id,
            storyIndex: i + 1,
            syntheticKey: jiraStoryKey,
          });
        }
      }
    }

    // Create child task
    const childTask = new WorkerTask();
    childTask.orgId = task.orgId;
    childTask.jiraIssueKey = jiraStoryKey;
    childTask.summary = story.title;
    childTask.description = fullDescription;
    childTask.workerPersona = story.persona as WorkerPersona;
    childTask.workerModel = task.workerModel;
    childTask.workerProvider = task.workerProvider;

    // Stories with dependencies start as BLOCKED and are unblocked when dependencies complete
    // Stories without dependencies start as QUEUED and can run immediately
    const hasDependencies = story.dependencies && story.dependencies.length > 0;
    childTask.status = hasDependencies ? "blocked" : "queued";

    childTask.parentTaskId = task.id;
    childTask.githubRepo = task.githubRepo; // Inherit repo from parent
    childTask.jiraIssueId = jiraStoryId || task.jiraIssueId; // Use story ID if created
    childTask.jiraFields = {
      ...(task.jiraFields || {}),
      storyIndex: i + 1,
      storyDependencies: story.dependencies
        ?.map((depId: string | number) => {
          // Dependencies come as 0-based indices from the planning agent
          // Convert to 1-based storyIndex (storyIndex starts at 1)
          if (typeof depId === "number") {
            return depId + 1; // 0 -> 1, 1 -> 2, etc.
          }
          // Fallback: try to find by ID if it's a string
          const depIndex = executionPlan.stories!.findIndex((s: { id?: string }) => s.id === depId);
          return depIndex >= 0 ? depIndex + 1 : null;
        })
        .filter((x: number | null): x is number => x !== null && x !== undefined),
      parentJiraKey: task.jiraIssueKey,
      // Feature branch workflow: child tasks PR to the feature branch, not main
      targetBranch: planJson.featureBranch || null,
      // Story-specific branch: each worker gets its own branch within feature workflow
      // Use dash (not slash) to avoid Git ref conflict: feature/OCS-495 + feature/OCS-495/story-1 is invalid
      // Git refs don't allow both a branch and a "subdirectory" branch with the same prefix
      storyBranch: `${planJson.featureBranch}-story-${i + 1}`,
      executionMode: planJson.executionMode || "autonomous",
      // Story decomposition details (passed to child task for reference)
      storyPoints: story.storyPoints,
      acceptanceCriteria: story.acceptanceCriteria,
      // File targeting from planning agent (Cost-first: max 3 files for Haiku)
      targetFiles: story.targetFiles || [],
      referenceFiles: story.referenceFiles || [],
    };

    // Save child task
    const savedChild = await taskRepo.save(childTask);
    childTasks.push(savedChild);
    childTaskIds.push(savedChild.id);

    const statusNote = hasDependencies
      ? `(blocked - depends on S${story.dependencies?.map((d: string | number) => typeof d === "number" ? d + 1 : d).join(", S")})`
      : "(queued)";
    await logTaskEvent(
      task.id,
      "info",
      `Created story ${i + 1}: ${story.title} (${story.persona}) ${statusNote}`,
    );

    logger.info("Created child task for story", {
      parentTaskId: task.id,
      childTaskId: savedChild.id,
      storyIndex: i + 1,
      persona: story.persona,
      summary: story.title,
      status: savedChild.status,
      dependencies: story.dependencies,
    });
  }

  // Update parent task with child task references
  task.status = "dispatching";
  task.childTaskIds = childTaskIds;
  await taskRepo.save(task);

  await logTaskEvent(
    task.id,
    "status_change",
    `All ${childTaskIds.length} stories queued for execution`,
  );

  logger.info("Multi-story plan dispatched", {
    taskId: task.id,
    jiraIssueKey: task.jiraIssueKey,
    childCount: childTaskIds.length,
    childTaskIds,
  });

  return true;
}

/**
 * PHASE 3: Orchestrator-managed PR merging
 *
 * Merge all story PRs in dependency order (by storyIndex) into the feature branch.
 * Called when all child tasks have completed (status = completed/deployed/review_requested).
 *
 * This separates concerns:
 * - Workers: Create PRs to feature branch
 * - Orchestrator: Merge PRs in order (Phase 3)
 * - Orchestrator: Create final PR to main (after all merges)
 */
async function mergeStoryPRsInOrder(parentTask: WorkerTask): Promise<void> {
  const taskRepo = getTaskRepo();

  // Get all child tasks with PRs
  const children = await taskRepo.find({
    where: { parentTaskId: parentTask.id },
    order: { createdAt: "ASC" },
  });

  // Sort by story index (dependency order)
  const sortedChildren = children
    .filter((c) => c.githubPrNumber && c.githubRepo)
    .sort((a, b) => {
      const aIndex = (a.jiraFields as any)?.storyIndex || 0;
      const bIndex = (b.jiraFields as any)?.storyIndex || 0;
      return aIndex - bIndex;
    });

  if (sortedChildren.length === 0) {
    logger.debug("No child PRs to merge", { parentTaskId: parentTask.id });
    return;
  }

  await logTaskEvent(
    parentTask.id,
    "info",
    `🔄 Phase 3: Merging ${sortedChildren.length} story PRs in dependency order...`
  );

  const { mergePullRequest } = await import("../utils/github.js");

  let successCount = 0;
  let conflictCount = 0;

  for (const child of sortedChildren) {
    try {
      const storyIndex = (child.jiraFields as any)?.storyIndex || "?";
      await logTaskEvent(
        parentTask.id,
        "info",
        `Merging Story ${storyIndex}: PR #${child.githubPrNumber}`
      );

      // First attempt to merge
      let merged = await mergePullRequest(
        child.githubRepo!,
        child.githubPrNumber!,
        {
          mergeMethod: "squash",
          commitTitle: `${child.jiraIssueKey}: ${child.summary}`,
        }
      );

      // If merge failed, try to auto-resolve by updating the PR branch
      if (!merged) {
        await logTaskEvent(
          parentTask.id,
          "info",
          `🔄 PR #${child.githubPrNumber} may need update - attempting to sync with base branch...`
        );

        // Check PR status and try to update branch
        const prStatus = await getPullRequestStatus(child.githubRepo!, child.githubPrNumber!);

        if (prStatus?.merged) {
          // PR was already merged (maybe by a previous run)
          await logTaskEvent(
            parentTask.id,
            "info",
            `✅ PR #${child.githubPrNumber} was already merged`
          );
          successCount++;
          continue;
        }

        if (prStatus?.mergeable === false) {
          // Try to update the branch with base
          const updateResult = await updatePullRequestBranch(
            child.githubRepo!,
            child.githubPrNumber!
          );

          if (updateResult.success) {
            await logTaskEvent(
              parentTask.id,
              "info",
              `✅ Updated PR #${child.githubPrNumber} branch - retrying merge...`
            );

            // Wait for GitHub to process the update
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // Retry the merge
            merged = await mergePullRequest(
              child.githubRepo!,
              child.githubPrNumber!,
              {
                mergeMethod: "squash",
                commitTitle: `${child.jiraIssueKey}: ${child.summary}`,
              }
            );
          } else {
            // Check what files are conflicting
            const conflicts = await getPullRequestConflicts(
              child.githubRepo!,
              child.githubPrNumber!
            );

            if (conflicts.hasConflicts) {
              await logTaskEvent(
                parentTask.id,
                "info",
                `⚠️ PR #${child.githubPrNumber} has unresolvable conflicts in ${conflicts.conflictingFiles.length} file(s): ${conflicts.conflictingFiles.slice(0, 3).join(", ")}${conflicts.conflictingFiles.length > 3 ? "..." : ""}`,
                { severity: "warning" }
              );
              conflictCount++;
            }
          }
        }
      }

      if (merged) {
        await logTaskEvent(
          parentTask.id,
          "info",
          `✅ Merged PR #${child.githubPrNumber} (Story ${storyIndex})`
        );
        logger.info("Merged child story PR", {
          parentTaskId: parentTask.id,
          childTaskId: child.id,
          prNumber: child.githubPrNumber,
          storyIndex,
        });
        successCount++;
      } else {
        await logTaskEvent(
          parentTask.id,
          "info",
          `⚠️ PR #${child.githubPrNumber} could not be auto-merged - manual resolution may be required`,
          { severity: "warning" }
        );
        logger.warn("PR merge failed after auto-resolution attempt", {
          parentTaskId: parentTask.id,
          childTaskId: child.id,
          prNumber: child.githubPrNumber,
        });
        conflictCount++;
      }

      // Small delay between merges to let GitHub process
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      logger.error("Failed to merge child PR", {
        parentTaskId: parentTask.id,
        childTaskId: child.id,
        prNumber: child.githubPrNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      await logTaskEvent(
        parentTask.id,
        "error",
        `❌ Failed to merge PR #${child.githubPrNumber}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      conflictCount++;
    }
  }

  const summaryMessage = conflictCount > 0
    ? `✅ Phase 3 complete: ${successCount}/${sortedChildren.length} PRs merged (${conflictCount} need manual resolution)`
    : `✅ Phase 3 complete: All ${sortedChildren.length} story PRs merged successfully`;

  await logTaskEvent(parentTask.id, "info", summaryMessage);

  logger.info("Completed Phase 3 PR merging", {
    parentTaskId: parentTask.id,
    jiraIssueKey: parentTask.jiraIssueKey,
    totalPRs: sortedChildren.length,
    merged: successCount,
    conflicts: conflictCount,
  });
}

/**
 * Check for parent tasks with all children complete and post summary to Jira
 * This is the "Project Manager Summary" phase of PRD orchestration
 */
async function checkParentTaskCompletion(): Promise<void> {
  const taskRepo = getTaskRepo();

  // Find parent tasks in "dispatching" status (actively running children)
  const parentTasks = await taskRepo.find({
    where: { status: "dispatching" },
  });

  for (const parentTask of parentTasks) {
    if (!parentTask.childTaskIds || parentTask.childTaskIds.length === 0) {
      continue;
    }

    // Get all child tasks
    const childTasks = await taskRepo.find({
      where: { parentTaskId: parentTask.id },
    });

    if (childTasks.length === 0) {
      continue;
    }

    // CRITICAL: Ensure all expected children have been created before checking completion
    // This prevents a race condition where the first child completes via dry-run
    // before the other children are even created, causing premature parent completion
    const expectedChildCount = parentTask.childTaskIds.length;
    if (childTasks.length < expectedChildCount) {
      logger.debug("Waiting for all child tasks to be created", {
        parentTaskId: parentTask.id,
        expectedChildren: expectedChildCount,
        actualChildren: childTasks.length,
      });
      continue;
    }

    // Check if all children are in terminal states
    // For PRD workflows, review_requested counts as terminal since PRs go to feature branch
    // and will be consolidated in the final PR
    const isPrdWorkflow = parentTask.githubBranch != null;
    const terminalStatuses = isPrdWorkflow
      ? ["completed", "failed", "cancelled", "deployed", "review_requested"]
      : ["completed", "failed", "cancelled", "deployed"];
    const allComplete = childTasks.every((child) =>
      terminalStatuses.includes(child.status),
    );

    if (!allComplete) {
      // Some children still running
      continue;
    }

    // All children are done - generate and post summary
    logger.info("All child tasks complete, generating summary", {
      parentTaskId: parentTask.id,
      jiraIssueKey: parentTask.jiraIssueKey,
      childCount: childTasks.length,
      parentStatus: parentTask.status,
      childStatuses: childTasks.map((c) => ({ id: c.id, status: c.status })),
    });

    // Calculate stats
    // For PRD workflows, review_requested counts as "completed" since PRs are consolidated
    const successStatuses = isPrdWorkflow
      ? ["completed", "deployed", "review_requested"]
      : ["completed", "deployed"];
    const completed = childTasks.filter((c) =>
      successStatuses.includes(c.status),
    ).length;
    const failed = childTasks.filter((c) => c.status === "failed").length;
    const cancelled = childTasks.filter((c) => c.status === "cancelled").length;
    const totalCost = childTasks.reduce(
      (sum, c) => sum + (Number(c.estimatedCostUsd) || 0),
      0,
    );

    // Check if this is a dry-run workflow
    const parentIsDryRun = isDryRunTask(parentTask);

    // PHASE 3: Merge all story PRs in dependency order into feature branch
    // This runs BEFORE creating the final PR to main, ensuring all PRs are consolidated
    if (isPrdWorkflow && completed > 0 && !parentIsDryRun) {
      try {
        await mergeStoryPRsInOrder(parentTask);
      } catch (error) {
        logger.error("Error in Phase 3 PR merging", {
          parentTaskId: parentTask.id,
          error: error instanceof Error ? error.message : String(error),
        });
        await logTaskEvent(
          parentTask.id,
          "info",
          "Phase 3 PR merging encountered errors - continuing with final PR creation",
          { severity: "warning" }
        );
      }
    } else if (isPrdWorkflow && completed > 0 && parentIsDryRun) {
      await logTaskEvent(parentTask.id, "info", `[DRY RUN] Would merge ${completed} story PRs into feature branch`);
      logger.info("[DRY RUN] Skipped Phase 3 PR merging", { parentTaskId: parentTask.id });
    }

    // Feature branch workflow: Create final PR from feature branch to main
    const planJson = parentTask.planJson as { featureBranch?: string } | null;
    const featureBranch = planJson?.featureBranch || parentTask.githubBranch;
    let finalPrUrl: string | null = null;
    let finalPrNumber: number | null = null;

    if (featureBranch && completed > 0 && failed === 0 && !parentIsDryRun) {
      // All stories succeeded - create final PR to main
      try {
        const { createPullRequest } = await import("../utils/github.js");

        // Build PR body with story summaries
        const storyList = childTasks
          .filter((c) => successStatuses.includes(c.status))
          .map(
            (c) =>
              `- ${c.summary}${c.githubPrUrl ? ` ([PR](${c.githubPrUrl}))` : ""}`,
          )
          .join("\n");

        const prResult = await createPullRequest(parentTask.githubRepo, {
          title: `${parentTask.jiraIssueKey}: ${parentTask.summary}`,
          body: `## Summary

This PR contains all completed stories for ${parentTask.jiraIssueKey}.

## Stories Included

${storyList}

## Total Cost

$${totalCost.toFixed(2)}

---
🤖 Generated by WorkerMill PRD Orchestration`,
          head: featureBranch,
          base: "main",
        });

        if (prResult.success && prResult.prUrl) {
          finalPrUrl = prResult.prUrl;
          finalPrNumber = prResult.prNumber || null;
          parentTask.githubPrUrl = finalPrUrl;
          parentTask.githubPrNumber = finalPrNumber;

          await logTaskEvent(
            parentTask.id,
            "info",
            `📝 Created final PR: ${finalPrUrl}`,
          );
          logger.info("Created final PR for feature branch", {
            parentTaskId: parentTask.id,
            jiraIssueKey: parentTask.jiraIssueKey,
            featureBranch,
            prUrl: finalPrUrl,
          });
        } else {
          await logTaskEvent(
            parentTask.id,
            "info",
            "⚠️ Could not create final PR to main",
          );
        }
      } catch (error) {
        logger.warn("Failed to create final PR", {
          error,
          parentTaskId: parentTask.id,
          featureBranch,
        });
        await logTaskEvent(
          parentTask.id,
          "info",
          "⚠️ Error creating final PR to main",
        );
      }
    } else if (featureBranch && completed > 0 && failed === 0 && parentIsDryRun) {
      await logTaskEvent(parentTask.id, "info", `[DRY RUN] Would create final PR: feature/${parentTask.jiraIssueKey} → main`);
      logger.info("[DRY RUN] Skipped final PR creation", { parentTaskId: parentTask.id });
    } else if (featureBranch && failed > 0) {
      await logTaskEvent(
        parentTask.id,
        "info",
        `⚠️ Skipping final PR - ${failed} story/stories failed. Feature branch: ${featureBranch}`,
      );
    }

    // Build summary comment
    const summaryLines: string[] = [
      "[Project Manager - Workflow Summary]",
      "",
      "## Execution Complete",
      "",
      `Total Stories: ${childTasks.length}`,
      `✅ Completed: ${completed}`,
      failed > 0 ? `❌ Failed: ${failed}` : null,
      cancelled > 0 ? `⚠️ Cancelled: ${cancelled}` : null,
      `💰 Total Cost: $${totalCost.toFixed(2)}`,
      "",
      "## Story Results",
      "",
    ].filter(Boolean) as string[];

    for (const child of childTasks) {
      const statusEmoji =
        child.status === "completed" || child.status === "deployed"
          ? "✅"
          : child.status === "failed"
            ? "❌"
            : "⚠️";
      const prLink = child.githubPrUrl ? ` - [PR](${child.githubPrUrl})` : "";
      summaryLines.push(`${statusEmoji} ${child.summary}${prLink}`);
    }

    // Add critical feedback section if there were failures
    if (failed > 0 || cancelled > 0) {
      summaryLines.push("");
      summaryLines.push("## Critical Feedback");
      summaryLines.push("");

      const failedTasks = childTasks.filter(
        (c) => c.status === "failed" || c.status === "cancelled",
      );
      for (const failedTask of failedTasks) {
        summaryLines.push(`- ${failedTask.summary}: ${failedTask.status}`);
        if (failedTask.errorMessage) {
          summaryLines.push(`  Error: ${failedTask.errorMessage}`);
        }
      }

      summaryLines.push("");
      summaryLines.push(
        "Please review the failed stories and consider creating follow-up tickets.",
      );
    } else {
      summaryLines.push("");
      summaryLines.push("## Next Steps");
      summaryLines.push("");
      if (finalPrUrl) {
        summaryLines.push(`✅ All stories completed successfully.`);
        summaryLines.push("");
        summaryLines.push(
          `📝 **Final PR**: [${parentTask.jiraIssueKey}](${finalPrUrl})`,
        );
        summaryLines.push("");
        summaryLines.push("Please review and merge the final PR when ready.");
      } else {
        summaryLines.push(
          "All stories completed successfully. Please review the PRs and merge when ready.",
        );
      }
    }

    // Post summary to Jira (only if this is a Jira-sourced task, skip in dry-run)
    if (parentTask.jiraIssueKey && !parentIsDryRun) {
      try {
        const success = await postJiraComment(
          parentTask.jiraIssueKey,
          summaryLines.join("\n"),
        );
        if (success) {
          await logTaskEvent(
            parentTask.id,
            "info",
            "📝 Posted workflow summary to Jira",
          );
        } else {
          await logTaskEvent(
            parentTask.id,
            "info",
            "⚠️ Could not post summary to Jira (non-critical)",
          );
        }
      } catch (error) {
        logger.warn("Failed to post summary to Jira", {
          error,
          jiraKey: parentTask.jiraIssueKey,
        });
      }
    } else if (parentTask.jiraIssueKey && parentIsDryRun) {
      await logTaskEvent(parentTask.id, "info", `[DRY RUN] Would post workflow summary to Jira`);
      logger.info("[DRY RUN] Skipped posting summary to Jira", { parentTaskId: parentTask.id });
    }

    // Update parent task to completed
    const newStatus = failed > 0 ? "failed" : "completed";
    logger.info("Updating parent task status", {
      parentTaskId: parentTask.id,
      jiraIssueKey: parentTask.jiraIssueKey,
      oldStatus: parentTask.status,
      newStatus,
      isDryRun: parentIsDryRun,
    });
    parentTask.status = newStatus;
    parentTask.completedAt = new Date();
    parentTask.estimatedCostUsd = totalCost;
    await taskRepo.save(parentTask);
    logger.info("Parent task status saved successfully", {
      parentTaskId: parentTask.id,
      status: parentTask.status,
    });

    await logTaskEvent(
      parentTask.id,
      "status_change",
      `Workflow ${parentTask.status}: ${completed}/${childTasks.length} stories successful`,
    );

    // Transition parent Epic to Done in Jira (if all successful, skip in dry-run)
    if (parentTask.jiraIssueKey && parentTask.status === "completed" && !parentIsDryRun) {
      const transitioned = await transitionJiraIssue(
        parentTask.jiraIssueKey,
        "Done",
      );
      if (transitioned) {
        await logTaskEvent(
          parentTask.id,
          "info",
          `📌 Transitioned ${parentTask.jiraIssueKey} to Done`,
        );
      }
    } else if (parentTask.jiraIssueKey && parentTask.status === "completed" && parentIsDryRun) {
      await logTaskEvent(parentTask.id, "info", `[DRY RUN] Would transition ${parentTask.jiraIssueKey} to Done`);
      logger.info("[DRY RUN] Skipped transitioning Epic to Done", { parentTaskId: parentTask.id, jiraKey: parentTask.jiraIssueKey });
    }

    logger.info("Parent task marked complete", {
      parentTaskId: parentTask.id,
      jiraIssueKey: parentTask.jiraIssueKey,
      status: parentTask.status,
      completed,
      failed,
      cancelled,
      totalCost,
    });

    // Send notification
    if (parentTask.status === "completed") {
      await notifyTaskCompleted(parentTask);
    } else {
      await notifyTaskFailed(parentTask);
    }

    // Archive sibling context messages when parent completes
    // Archived messages are preserved for history/debugging but filtered out of active workflows
    try {
      const contextRepo = AppDataSource.getRepository(WorkerContext);
      const archiveResult = await contextRepo.update(
        { parentTaskId: parentTask.id, archived: false },
        { archived: true, archivedAt: new Date() },
      );
      if (archiveResult.affected && archiveResult.affected > 0) {
        logger.info("Archived sibling context messages", {
          parentTaskId: parentTask.id,
          jiraIssueKey: parentTask.jiraIssueKey,
          archivedCount: archiveResult.affected,
        });
      }
    } catch (archiveError) {
      logger.warn("Failed to archive sibling context messages", {
        parentTaskId: parentTask.id,
        error:
          archiveError instanceof Error
            ? archiveError.message
            : String(archiveError),
      });
    }

    // DRY-RUN CLEANUP: Automatically delete simulated tasks after dry-run completes
    // This prevents clutter in the task list from test runs
    // Delay cleanup by 30 seconds so user has time to review the completed workflow
    if (parentIsDryRun) {
      const DRY_RUN_VISIBILITY_SECONDS = 30;
      logger.info("[DRY RUN] Workflow complete - will auto-cleanup after visibility window", {
        parentTaskId: parentTask.id,
        jiraIssueKey: parentTask.jiraIssueKey,
        childCount: childTasks.length,
        cleanupInSeconds: DRY_RUN_VISIBILITY_SECONDS,
      });

      // Schedule cleanup after delay (non-blocking)
      const parentId = parentTask.id;
      const parentJiraKey = parentTask.jiraIssueKey;
      const childIdsCopy = childTasks.map((c) => c.id);

      setTimeout(async () => {
        logger.info("[DRY RUN] Starting auto-cleanup after visibility window", {
          parentTaskId: parentId,
          jiraIssueKey: parentJiraKey,
        });
        try {
          const cleanupTaskRepo = AppDataSource.getRepository(WorkerTask);
          const cleanupLogRepo = AppDataSource.getRepository(WorkerTaskLog);

          // Delete child tasks first (foreign key constraint)
          const deleteChildResult = await cleanupTaskRepo.delete({
            parentTaskId: parentId,
          });

          // Delete logs for children and parent
          if (childIdsCopy.length > 0) {
            await cleanupLogRepo.delete({ taskId: In(childIdsCopy) });
          }
          await cleanupLogRepo.delete({ taskId: parentId });

          // Delete parent task
          await cleanupTaskRepo.delete({ id: parentId });

          logger.info("[DRY RUN] Auto-cleanup completed", {
            parentTaskId: parentId,
            jiraIssueKey: parentJiraKey,
            deletedChildren: deleteChildResult.affected,
          });
        } catch (cleanupError) {
          logger.warn("[DRY RUN] Auto-cleanup failed", {
            parentTaskId: parentId,
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
          });
        }
      }, DRY_RUN_VISIBILITY_SECONDS * 1000);
    }
  }
}

/**
 * DEPRECATED - Phase 2 Simplification: Blocking removed
 *
 * Check and unblock dependent tasks when a child task completes
 * This function is NO LONGER CALLED as of Phase 2 of the simplified architecture
 * All workers now start immediately in parallel regardless of dependencies
 * Dependencies only affect MERGE ORDER, not execution order
 *
 * Preserved for reference and potential rollback, but this logic is superseded by:
 * - Children always created with status = "queued" (not "blocked")
 * - No unblocking logic needed since nothing blocks execution
 * - Merge order is determined by orchestrator merge logic, not task execution
 *
 * Legacy PRD Workflow Dependency Rules (no longer used):
 * - For "deployed" status: PR is merged, dependents would proceed immediately
 * - For "review_requested" status: PR created but not merged, would verify PR merge status
 * - For "completed" status: Task done but no PR, dependents would proceed
 */
export async function checkAndUnblockDependentTasks(
  completedTask: WorkerTask,
): Promise<void> {
  // Only process child tasks (tasks with a parent)
  if (!completedTask.parentTaskId) {
    return;
  }

  const taskRepo = getTaskRepo();
  const contextRepo = AppDataSource.getRepository(WorkerContext);

  // Get the completed task's story index from jiraFields
  const completedFields = completedTask.jiraFields as {
    storyIndex?: number;
  } | null;
  const completedStoryIndex = completedFields?.storyIndex;

  if (!completedStoryIndex) {
    return;
  }

  // Post completion notification for siblings to see
  try {
    await contextRepo.save({
      parentTaskId: completedTask.parentTaskId,
      taskId: completedTask.id,
      orgId: completedTask.orgId,
      persona: completedTask.workerPersona || "worker",
      messageType: "completion" as const,
      content: `Completed: ${completedTask.summary || completedTask.jiraIssueKey}. PR: ${completedTask.githubPrUrl || "N/A"}`,
      metadata: {
        status: completedTask.status,
        prUrl: completedTask.githubPrUrl,
        prNumber: completedTask.githubPrNumber,
        storyIndex: completedStoryIndex,
        filesModified:
          (completedTask.jiraFields as { filesModified?: string[] } | null)
            ?.filesModified || [],
      },
    });
    logger.debug("Posted completion context notification", {
      taskId: completedTask.id,
      parentTaskId: completedTask.parentTaskId,
      storyIndex: completedStoryIndex,
    });
  } catch (contextError) {
    logger.warn("Failed to post completion context", {
      taskId: completedTask.id,
      error:
        contextError instanceof Error
          ? contextError.message
          : String(contextError),
    });
  }

  // Find all blocked sibling tasks
  const blockedSiblings = await taskRepo.find({
    where: {
      parentTaskId: completedTask.parentTaskId,
      status: "blocked",
    },
  });

  if (blockedSiblings.length === 0) {
    return;
  }

  // Get all sibling tasks to check completion status
  const allSiblings = await taskRepo.find({
    where: { parentTaskId: completedTask.parentTaskId },
  });

  // Check if this is a PRD workflow (parent has feature branch = multi-story plan)
  // For PRD workflows, we DON'T wait for PR merge - all child PRs go to feature branch
  // and will be consolidated in a final PR to main
  const parentTask = await taskRepo.findOne({
    where: { id: completedTask.parentTaskId! },
  });
  const isPrdWorkflow = parentTask?.githubBranch != null;

  // Build a map of storyIndex -> { isComplete, isFailed, prMerged, task }
  // For true dependency completion, we need PR to be merged (or no PR exists)
  // EXCEPTION: PRD workflows skip PR merge check - they use feature branch consolidation
  const completionMap = new Map<
    number,
    {
      isComplete: boolean;
      isFailed: boolean;
      prMerged: boolean;
      task: WorkerTask;
    }
  >();

  for (const sibling of allSiblings) {
    const siblingFields = sibling.jiraFields as { storyIndex?: number } | null;
    const siblingIndex = siblingFields?.storyIndex;
    if (siblingIndex) {
      // Check if task reached a "complete enough" status
      const statusComplete = [
        "completed",
        "deployed",
        "review_requested",
      ].includes(sibling.status);
      // Check if task failed (dependency chain is broken)
      const statusFailed = ["failed", "cancelled"].includes(sibling.status);

      // For deployed tasks, PR is merged by definition
      // For review_requested, we need to verify PR merge status
      // For completed (no PR), it's ready
      // EXCEPTION: PRD workflows treat review_requested as complete (no merge wait)
      let prMerged = true; // Default to true (no PR needed)

      if (
        sibling.status === "review_requested" &&
        sibling.githubPrNumber &&
        sibling.githubRepo &&
        !isPrdWorkflow
      ) {
        // Task has a PR in review - check if it's actually merged
        // Skip this check for PRD workflows - they consolidate PRs at the end
        try {
          const prStatus = await getPullRequestStatus(
            sibling.githubRepo,
            sibling.githubPrNumber,
          );
          prMerged = prStatus?.merged === true;

          if (!prMerged) {
            logger.debug("Dependency PR not yet merged", {
              dependencyTaskId: sibling.id,
              storyIndex: siblingIndex,
              prNumber: sibling.githubPrNumber,
              prState: prStatus?.state,
            });
          }
        } catch (prError) {
          // On error, be conservative - assume not merged
          prMerged = false;
          logger.warn("Failed to check PR merge status", {
            taskId: sibling.id,
            prNumber: sibling.githubPrNumber,
            error: prError instanceof Error ? prError.message : String(prError),
          });
        }
      } else if (sibling.status === "deployed") {
        // Deployed means PR was merged
        prMerged = true;
      }

      completionMap.set(siblingIndex, {
        isComplete: statusComplete,
        isFailed: statusFailed,
        prMerged,
        task: sibling,
      });
    }
  }

  // Check each blocked sibling to see if its dependencies are now met (or failed)
  for (const blockedTask of blockedSiblings) {
    const blockedFields = blockedTask.jiraFields as {
      storyDependencies?: number[];
    } | null;
    const dependencies = blockedFields?.storyDependencies || [];

    if (dependencies.length === 0) {
      // No dependencies, shouldn't be blocked - queue it
      blockedTask.status = "queued";
      await taskRepo.save(blockedTask);
      await logTaskEvent(
        blockedTask.id,
        "status_change",
        "Unblocked: no dependencies",
      );
      continue;
    }

    // Check if any dependency has failed - if so, cancel this blocked task
    const failedDeps: number[] = [];
    for (const depIndex of dependencies) {
      const depStatus = completionMap.get(depIndex);
      if (depStatus?.isFailed) {
        failedDeps.push(depIndex);
      }
    }

    if (failedDeps.length > 0) {
      // Dependency failed - cancel this blocked task
      blockedTask.status = "cancelled";
      await taskRepo.save(blockedTask);

      const failedList = failedDeps.map((d) => `S${d}`).join(", ");
      await logTaskEvent(
        blockedTask.id,
        "status_change",
        `Cancelled: dependency failed (${failedList})`,
      );

      logger.info("Cancelled blocked task due to failed dependency", {
        taskId: blockedTask.id,
        jiraIssueKey: blockedTask.jiraIssueKey,
        failedDependencies: failedDeps,
      });
      continue;
    }

    // Check if all dependencies are complete AND their PRs are merged
    // This prevents race conditions where dependent starts before dependency PR is merged
    const pendingDeps: number[] = [];
    const pendingPrMerge: number[] = [];

    for (const depIndex of dependencies) {
      const depStatus = completionMap.get(depIndex);
      if (!depStatus?.isComplete) {
        pendingDeps.push(depIndex);
      } else if (!depStatus.prMerged) {
        pendingPrMerge.push(depIndex);
      }
    }

    const allDepsComplete =
      pendingDeps.length === 0 && pendingPrMerge.length === 0;

    if (allDepsComplete) {
      blockedTask.status = "queued";
      await taskRepo.save(blockedTask);

      const depList = dependencies.map((d) => `S${d}`).join(", ");
      await logTaskEvent(
        blockedTask.id,
        "status_change",
        `Unblocked: dependencies complete (${depList})`,
      );

      logger.info("Unblocked dependent task", {
        taskId: blockedTask.id,
        jiraIssueKey: blockedTask.jiraIssueKey,
        dependencies,
        completedStoryIndex,
      });
    } else if (pendingPrMerge.length > 0 && pendingDeps.length === 0) {
      // All tasks are done but PRs not merged - log for visibility
      logger.debug("Dependency tasks complete but PRs not yet merged", {
        blockedTaskId: blockedTask.id,
        pendingPrMerge: pendingPrMerge.map((d) => `S${d}`),
      });
    }
  }
}

/**
 * Cascade cancellation from a parent task to all its blocked children.
 * When a parent task (one with childTaskIds) is cancelled or failed,
 * its blocked children should also be cancelled since they can never proceed.
 *
 * This is called from the task cancel endpoint when a parent task is cancelled.
 *
 * @param parentTask - The parent task that was cancelled/failed
 * @param reason - The reason for cancellation (for logging)
 */
export async function cascadeCancellationToChildren(
  parentTask: WorkerTask,
  reason: string = "Parent task was cancelled",
): Promise<{ cancelledCount: number; cancelledTaskIds: string[] }> {
  const taskRepo = getTaskRepo();

  // Only process if this task is a parent (has children)
  if (!parentTask.childTaskIds || parentTask.childTaskIds.length === 0) {
    return { cancelledCount: 0, cancelledTaskIds: [] };
  }

  // Find all blocked child tasks
  const blockedChildren = await taskRepo.find({
    where: {
      parentTaskId: parentTask.id,
      status: "blocked" as const,
    },
  });

  if (blockedChildren.length === 0) {
    return { cancelledCount: 0, cancelledTaskIds: [] };
  }

  const cancelledTaskIds: string[] = [];

  for (const child of blockedChildren) {
    child.status = "cancelled";
    child.completedAt = new Date();
    child.errorMessage = reason;
    await taskRepo.save(child);

    // Log the cancellation
    await logTaskEvent(child.id, "status_change", `Cancelled: ${reason}`);

    cancelledTaskIds.push(child.id);

    logger.info("Cancelled blocked child task due to parent cancellation", {
      childTaskId: child.id,
      childJiraKey: child.jiraIssueKey,
      parentTaskId: parentTask.id,
      parentJiraKey: parentTask.jiraIssueKey,
      reason,
    });
  }

  logger.info("Cascaded cancellation to blocked children", {
    parentTaskId: parentTask.id,
    parentJiraKey: parentTask.jiraIssueKey,
    cancelledCount: cancelledTaskIds.length,
    cancelledTaskIds,
  });

  return { cancelledCount: cancelledTaskIds.length, cancelledTaskIds };
}

/**
 * Standardized branch naming for PRD workflows
 */
function getFeatureBranch(jiraKey: string): string {
  return `feature/${jiraKey.toLowerCase()}`;
}

/**
 * Get branch name for a specific story in a multi-story workflow
 */
function getStoryBranch(jiraKey: string, storyIndex: number): string {
  return `feature/${jiraKey.toLowerCase()}/story-${storyIndex}`;
}

/**
 * Spawn an ECS worker for a task
 */
async function spawnWorker(task: WorkerTask): Promise<void> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);

  try {
    // Check for dry-run mode (simulates workflow without spawning ECS)
    // Check both the task's labels AND parent task's labels (for child tasks)
    let labels = (task.jiraFields as Record<string, unknown>)?.labels || [];

    // If this is a child task, also check parent's labels
    if (task.parentTaskId) {
      const parentTask = await taskRepo.findOne({ where: { id: task.parentTaskId } });
      if (parentTask) {
        const parentLabels = (parentTask.jiraFields as Record<string, unknown>)?.labels || [];
        if (Array.isArray(parentLabels)) {
          labels = [...(Array.isArray(labels) ? labels : []), ...parentLabels];
        }
      }
    }

    const isDryRun = Array.isArray(labels) && labels.includes("dry-run");

    if (isDryRun) {
      logger.info("[DRY RUN] Simulating worker spawn", {
        taskId: task.id,
        jiraKey: task.jiraIssueKey,
        persona: task.workerPersona,
      });

      await logTaskEvent(
        task.id,
        "status_change",
        `[DRY RUN] Would spawn ${task.workerPersona} worker`,
      );

      const targetFiles =
        (task.jiraFields as Record<string, unknown>)?.targetFiles || [];
      const fileList = Array.isArray(targetFiles) ? targetFiles.join(", ") : "";

      await logTaskEvent(
        task.id,
        "info",
        `[DRY RUN] Target files: ${fileList || "not specified"}`,
      );

      // Simulate completion after short delay
      task.status = "completed";
      task.completedAt = new Date();
      task.planningNotes = "DRY RUN: Simulated worker execution";
      await taskRepo.save(task);

      logger.info("[DRY RUN] Task marked as completed", {
        taskId: task.id,
        jiraKey: task.jiraIssueKey,
      });

      return; // Don't actually spawn ECS
    }

    // Determine provider from task or default to anthropic
    const providerId: ProviderId =
      task.workerProvider && isValidProviderId(task.workerProvider)
        ? (task.workerProvider as ProviderId)
        : "anthropic";

    logger.info("Spawning worker for task", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      persona: task.workerPersona,
      provider: providerId,
    });

    // Log setting up environment
    await logTaskEvent(
      task.id,
      "status_change",
      `Setting up execution environment (provider: ${providerId})`,
    );

    // Get credentials for the org
    const credentials = await getOrgCredentials(task.orgId);

    // Fetch provider-specific API key if not using anthropic
    if (providerId !== "anthropic") {
      try {
        credentials.providerApiKey = await getProviderCredentials(
          task.orgId,
          providerId,
        );
        credentials.providerId = providerId;
        logger.info("Fetched provider credentials", {
          taskId: task.id,
          provider: providerId,
        });
      } catch (error) {
        logger.error("Failed to fetch provider credentials", {
          taskId: task.id,
          provider: providerId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error(
          `Provider credentials not configured for '${providerId}'. Please configure API key in Settings.`,
        );
      }
    }

    // Update status to environment_setup
    task.status = "environment_setup";
    await taskRepo.save(task);

    // Spawn ECS task
    const runner = getECSTaskRunner();
    const result = await runner.runWorkerTask(task, credentials);

    // Log ECS task started
    await logTaskEvent(
      task.id,
      "status_change",
      `ECS task started: ${result.taskId}`,
    );

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
        error:
          usageError instanceof Error ? usageError.message : String(usageError),
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
    .where("task.status IN (:...statuses)", {
      statuses: ["pr_created", "review_requested", "pr_approved"],
    })
    .andWhere("task.skip_manager_review = :skip", { skip: false })
    .andWhere("task.github_pr_number IS NOT NULL")
    .andWhere(
      "(task.manager_ecs_task_arn IS NULL OR task.manager_ecs_task_arn = '')",
    )
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
    .andWhere("task.status IN (:...statuses)", {
      statuses: ["completed", "failed", "deployed"],
    })
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
  // - review_approved: Manager approved → ready for deployment
  // - pr_approved + skipManagerReview=true: GitHub approved, no manager needed → ready for deployment
  // IMPORTANT: pr_approved + skipManagerReview=false should go to manager review first!
  const tasks = await taskRepo
    .createQueryBuilder("task")
    .where(
      "(task.status = :reviewApproved OR (task.status = :prApproved AND task.skip_manager_review = :skip))",
      {
        reviewApproved: "review_approved",
        prApproved: "pr_approved",
        skip: true,
      },
    )
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

  await logTaskEvent(
    task.id,
    "status_change",
    "Re-queuing for deployment (deploy label detected)",
    {
      severity: "info",
      metadata: { prNumber: task.githubPrNumber },
    },
  );

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
    .where("task.status IN (:...statuses)", {
      statuses: ["executing", "environment_setup"],
    })
    .andWhere("task.ecs_task_arn IS NOT NULL")
    .limit(10)
    .getMany();

  if (executingTasks.length === 0) return;

  // Batch describe ECS tasks for efficiency
  const taskArns = executingTasks.map((t) => t.ecsTaskArn!).filter(Boolean);
  if (taskArns.length === 0) return;

  let ecsTasksMap: Map<
    string,
    {
      lastStatus: string;
      stopCode?: string;
      stoppedReason?: string;
      stoppedAt?: Date;
      exitCode: number;
      capacityProviderName?: string;
    }
  > = new Map();

  try {
    const describeResult = await ecsClient.send(
      new DescribeTasksCommand({
        cluster: config.aws.ecsCluster,
        tasks: taskArns,
      }),
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
    logger.error("Error describing ECS tasks", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  for (const task of executingTasks) {
    try {
      const ecsInfo = ecsTasksMap.get(task.ecsTaskArn!);

      if (!ecsInfo) {
        // ECS task not found - mark as failed
        logger.warn("ECS task not found", {
          taskId: task.id,
          ecsTaskArn: task.ecsTaskArn,
        });
        task.status = "failed";
        task.completedAt = new Date();
        task.errorMessage = "ECS task not found";
        await taskRepo.save(task);
        await logTaskEvent(
          task.id,
          "error",
          "Task failed: ECS task not found",
          { severity: "error" },
        );
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
        (ecsInfo.exitCode === 137 &&
          ecsInfo.stoppedReason?.toLowerCase().includes("spot")) ||
        (ecsInfo.exitCode === 137 &&
          ecsInfo.capacityProviderName === "FARGATE_SPOT");

      // Check checkpoint for "interrupted" stage as a fallback detection method
      // This catches cases where the worker gracefully handled SIGTERM
      if (
        !isSpotInterruption &&
        (ecsInfo.exitCode === 0 || ecsInfo.exitCode === 137)
      ) {
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
            error:
              checkpointError instanceof Error
                ? checkpointError.message
                : String(checkpointError),
          });
        }
      }

      if (isSpotInterruption) {
        // Check if task can be retried
        if (task.retryCount < task.maxRetries) {
          logger.info(
            "Spot interruption detected, re-queueing task for retry",
            {
              taskId: task.id,
              jiraIssueKey: task.jiraIssueKey,
              retryCount: task.retryCount,
              maxRetries: task.maxRetries,
            },
          );

          // Re-queue the task for retry
          task.status = "queued";
          task.retryCount += 1;
          task.ecsTaskArn = null;
          task.ecsTaskId = null;
          task.startedAt = null;
          task.completedAt = null;
          task.taskNotes = `SPOT_RETRY: Retry ${task.retryCount}/${task.maxRetries} after Spot capacity interruption`;
          await taskRepo.save(task);

          await logTaskEvent(
            task.id,
            "status_change",
            `Spot capacity reclaimed - re-queuing for retry (${task.retryCount}/${task.maxRetries})`,
            {
              severity: "warning",
              metadata: {
                stopCode: ecsInfo.stopCode,
                exitCode: ecsInfo.exitCode,
              },
            },
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

          await logTaskEvent(
            task.id,
            "error",
            `Task failed: Spot capacity reclaimed ${task.maxRetries} times (max retries exceeded)`,
            { severity: "error" },
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
        [task.id],
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
        const prUrlMatch = msg.match(
          /::pr_url::(https:\/\/github\.com\/[^\s]+)/,
        );
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

      // Update task - use partial update to avoid overwriting token/cost data
      const completedAt = ecsInfo.stoppedAt || new Date();
      const updateFields: {
        status: typeof newStatus;
        completedAt: Date;
        githubPrUrl?: string;
        githubPrNumber?: number;
        ecsTaskSeconds?: number;
      } = {
        status: newStatus,
        completedAt,
      };

      if (detectedPrUrl && !task.githubPrUrl) {
        updateFields.githubPrUrl = detectedPrUrl;
      }
      if (detectedPrNumber && !task.githubPrNumber) {
        updateFields.githubPrNumber = detectedPrNumber;
      }

      // Calculate duration if not set
      if (task.startedAt && !task.ecsTaskSeconds) {
        updateFields.ecsTaskSeconds = Math.floor(
          (completedAt.getTime() - task.startedAt.getTime()) / 1000,
        );
      }

      await taskRepo.update(task.id, updateFields);

      // Update local task object for subsequent logic
      task.status = newStatus;
      task.completedAt = completedAt;
      if (updateFields.githubPrUrl) task.githubPrUrl = updateFields.githubPrUrl;
      if (updateFields.githubPrNumber) task.githubPrNumber = updateFields.githubPrNumber;
      if (updateFields.ecsTaskSeconds) task.ecsTaskSeconds = updateFields.ecsTaskSeconds;

      // Validate quality gates for completed/deployed tasks
      // This ensures quality gates are actually enforced, not just decorative
      if (["completed", "deployed", "review_requested"].includes(newStatus)) {
        try {
          const gateValidation = await validateQualityGates(task);

          // Log validation results
          if (gateValidation.failures.length > 0) {
            const failureMsg = gateValidation.failures.join("\n");
            await logTaskEvent(
              task.id,
              "error",
              `Quality gates validation: ${gateValidation.failures.length} gate(s) failed:\n${failureMsg}`,
              { severity: "warning", metadata: { gateValidation } },
            );
          }

          if (gateValidation.warnings.length > 0) {
            const warningMsg = gateValidation.warnings.join("\n");
            await logTaskEvent(
              task.id,
              "info",
              `Quality gates validation: ${gateValidation.warnings.length} gate(s) have warnings:\n${warningMsg}`,
              { severity: "info", metadata: { gateValidation } },
            );
          }

          if (gateValidation.passed) {
            await logTaskEvent(task.id, "info", "✅ All quality gates passed");
          } else {
            await logTaskEvent(
              task.id,
              "error",
              "⚠️ Quality gates validation: Not all gates passed",
            );
          }

          // Store validation result with task for audit/debugging
          // (doesn't affect task status - gates are monitored but not blocking)
          const qualityGatesSummary = `\n\nQuality Gates Summary:\nPassed: ${gateValidation.passed}\nFailures: ${gateValidation.failures.length}\nWarnings: ${gateValidation.warnings.length}`;
          const updatedTaskNotes = (task.taskNotes || "") + qualityGatesSummary;
          await taskRepo.update(task.id, { taskNotes: updatedTaskNotes });
          task.taskNotes = updatedTaskNotes;
        } catch (gateError) {
          logger.warn("Error validating quality gates", {
            taskId: task.id,
            error:
              gateError instanceof Error
                ? gateError.message
                : String(gateError),
          });
          await logTaskEvent(
            task.id,
            "error",
            `Could not validate quality gates: ${gateError instanceof Error ? gateError.message : "Unknown error"}`,
            { severity: "warning" },
          );
        }
      }

      // Unblock dependent sibling tasks when a child task completes
      // Tasks with dependencies start as "blocked" and need to be transitioned to "queued"
      // when their dependencies reach a terminal state (completed, deployed, review_requested)
      if (task.parentTaskId && ["completed", "deployed", "review_requested"].includes(newStatus)) {
        try {
          await checkAndUnblockDependentTasks(task);
        } catch (unblockError) {
          logger.warn("Failed to unblock dependent tasks from monitor", {
            taskId: task.id,
            error: unblockError instanceof Error ? unblockError.message : String(unblockError),
          });
        }
      }

      // PRD Workflow: Auto-merge child PRs to feature branch
      // This consolidates all child work onto the feature branch for the final PR
      if (
        newStatus === "review_requested" &&
        task.githubPrNumber &&
        task.githubRepo
      ) {
        try {
          const parentTask = task.parentTaskId
            ? await taskRepo.findOne({ where: { id: task.parentTaskId } })
            : null;
          const isPrdWorkflow = parentTask?.githubBranch != null;

          if (isPrdWorkflow) {
            const { mergePullRequest } = await import("../utils/github.js");
            const merged = await mergePullRequest(
              task.githubRepo,
              task.githubPrNumber,
              {
                mergeMethod: "squash",
                commitTitle: `${task.jiraIssueKey}: ${task.summary}`,
              },
            );

            if (merged) {
              // Use partial update to avoid overwriting token/cost data
              await taskRepo.update(task.id, { status: "deployed" });
              task.status = "deployed"; // Update local object for consistency
              await logTaskEvent(
                task.id,
                "status_change",
                `✅ Auto-merged PR #${task.githubPrNumber} to feature branch`,
              );
              logger.info("Auto-merged child PR to feature branch", {
                taskId: task.id,
                prNumber: task.githubPrNumber,
                parentTaskId: task.parentTaskId,
              });
            } else {
              await logTaskEvent(
                task.id,
                "info",
                `⚠️ Could not auto-merge PR #${task.githubPrNumber} - manual merge may be needed`,
              );
              logger.warn("Failed to auto-merge child PR", {
                taskId: task.id,
                prNumber: task.githubPrNumber,
              });
            }
          }
        } catch (mergeError) {
          logger.warn("Error in auto-merge flow", {
            taskId: task.id,
            error:
              mergeError instanceof Error
                ? mergeError.message
                : String(mergeError),
          });
        }
      }

      // Clean up coordination data for completed task (Phase 8)
      // This releases file locks, resource reservations, and removes check-in
      await checkOut(task.id).catch((checkOutError) => {
        logger.warn("Failed to check out completed task from coordination", {
          taskId: task.id,
          error:
            checkOutError instanceof Error
              ? checkOutError.message
              : String(checkOutError),
        });
      });

      // Send Slack notifications for terminal statuses
      // Wrap in try/catch so notification failures don't break orchestration
      try {
        if (newStatus === "completed" || newStatus === "deployed") {
          await notifyTaskCompleted(task);
          logger.debug("Sent task completed Slack notification", {
            taskId: task.id,
          });
        } else if (newStatus === "failed") {
          await notifyTaskFailed(task);
          logger.debug("Sent task failed Slack notification", {
            taskId: task.id,
          });
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
            [
              task.orgId,
              org.billingCycleStart || new Date(new Date().setDate(1)),
            ],
          );
          const totalCost = parseFloat(costResult[0]?.total_cost || "0");
          if (totalCost >= org.costAlertThresholdUsd) {
            await notifyCostAlert(
              task.orgId,
              totalCost,
              org.costAlertThresholdUsd,
            );
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
          error:
            notifyError instanceof Error
              ? notifyError.message
              : String(notifyError),
        });
      }

      const logMessage = detectedResult
        ? `Task completed via ECS monitoring: result=${detectedResult}, status=${newStatus}`
        : `Task completed via ECS monitoring: exit_code=${ecsInfo.exitCode}, status=${newStatus}`;

      await logTaskEvent(task.id, "status_change", logMessage, {
        severity: newStatus === "failed" ? "error" : "info",
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
  const taskArns = managerTasks
    .map((t) => t.managerEcsTaskArn!)
    .filter(Boolean);
  if (taskArns.length === 0) return;

  let ecsTasksMap: Map<
    string,
    { lastStatus: string; exitCode: number; stoppedAt?: Date }
  > = new Map();

  try {
    const describeResult = await ecsClient.send(
      new DescribeTasksCommand({
        cluster: config.aws.ecsCluster,
        tasks: taskArns,
      }),
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
    logger.error("Error describing manager ECS tasks", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  for (const task of managerTasks) {
    try {
      const ecsInfo = ecsTasksMap.get(task.managerEcsTaskArn!);

      if (!ecsInfo) {
        // ECS task not found - might have been cleaned up, check logs for decision
        logger.warn("Manager ECS task not found, checking logs for decision", {
          taskId: task.id,
        });
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
        [task.id],
      );

      let detectedDecision: string | null = null;
      let detectedScore: number | null = null;
      let detectedFeedback: string | null = null;

      for (const log of logs) {
        const msg = log.message || "";

        // Look for manager decision marker
        const decisionMatch = msg.match(
          /::manager_decision::(approved|revision_needed|rejected|failed)/,
        );
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
          logger.info(
            "No manager decision marker found, defaulting to approved",
            { taskId: task.id },
          );
        } else if (ecsInfo) {
          detectedDecision = "failed";
          logger.warn("Manager task failed without decision marker", {
            taskId: task.id,
            exitCode: ecsInfo.exitCode,
          });
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
          logger.info(
            "Manager approved PR via log detection, re-queueing for deployment",
            { taskId: task.id },
          );
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
            logger.info(
              "Manager requested revision via log detection, re-queueing",
              { taskId: task.id, revisionCount: task.revisionCount },
            );
          } else {
            newStatus = "failed";
            task.errorMessage = `Max revisions (3) reached. Final feedback: ${detectedFeedback || "See logs"}`;
            logger.info("Max revisions reached via log detection", {
              taskId: task.id,
            });
          }
          break;

        case "rejected":
          newStatus = "review_rejected";
          task.errorMessage = `Rejected by Virtual Manager: ${detectedFeedback || "See logs"}`;
          logger.info("Manager rejected PR via log detection", {
            taskId: task.id,
          });
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

      await logTaskEvent(
        task.id,
        "status_change",
        `Manager review completed via log detection: decision=${detectedDecision}, status=${newStatus}`,
        {
          severity:
            newStatus === "failed" || newStatus === "review_rejected"
              ? "error"
              : "info",
        },
      );

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

    await logTaskEvent(
      task.id,
      "status_change",
      "Virtual Manager starting PR review...",
    );

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

    await logTaskEvent(
      task.id,
      "status_change",
      `Manager ECS task started: ${result.taskId}`,
    );

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

    await logTaskEvent(
      task.id,
      "error",
      `Failed to start Manager: ${error instanceof Error ? error.message : String(error)}`,
      { severity: "error" },
    );
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

    await logTaskEvent(
      task.id,
      "info",
      "Virtual Manager analyzing execution logs...",
    );

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
    const result = await runner.runManagerTask(
      task,
      credentials,
      "analyze_logs",
    );

    // Store manager ECS info (same as PR review)
    task.managerEcsTaskArn = result.taskArn;
    task.managerEcsTaskId = result.taskId;
    await taskRepo.save(task);

    await logTaskEvent(
      task.id,
      "info",
      `Manager log analysis started: ${result.taskId}`,
    );

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

    await logTaskEvent(
      task.id,
      "error",
      `Failed to start Manager log analysis: ${error instanceof Error ? error.message : String(error)}`,
      { severity: "error" },
    );
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
          await logTaskEvent(
            task.id,
            "status_change",
            "Task claimed by orchestrator",
          );

          // Check if this is a multi-story PRD plan that needs to be dispatched
          const wasDispatched = await dispatchMultiStoryPlan(task);

          if (wasDispatched) {
            // Multi-story plan was dispatched - child tasks are now queued
            // They will be picked up in subsequent poll loops
            logger.info("Multi-story plan dispatched, child tasks queued", {
              taskId: task.id,
              jiraIssueKey: task.jiraIssueKey,
            });
          } else {
            // Single-story or regular task - spawn worker directly
            await logTaskEvent(
              task.id,
              "status_change",
              `Assigned to worker ${task.id.substring(0, 8)}`,
            );

            // Spawn worker directly (no staggering needed with separate story branches)
            spawnWorker(task).catch((error) => {
              logger.error("Error in spawnWorker", {
                taskId: task.id,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          }
        }
      }

      // Process PRD tasks needing planning analysis (prd label workflow)
      const planningTasks = await findPlanningTasks();
      for (const task of planningTasks) {
        if (!state.running) break;

        // Process planning task (don't await - let it run in parallel)
        processPlanningTask(task).catch((error) => {
          logger.error("Error in processPlanningTask", {
            taskId: task.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
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

      // Check for parent tasks with all children complete (PRD orchestration summary)
      await checkParentTaskCompletion().catch((error) => {
        logger.error("Error in checkParentTaskCompletion", {
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
 * Export branch naming helpers for consistent naming across the codebase
 */
export { getFeatureBranch, getStoryBranch };

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
              }),
            );
            totalDeleted++;
            logger.debug("Deleted old checkpoint file", {
              key: obj.Key,
              lastModified: obj.LastModified.toISOString(),
              ageHours: Math.floor(
                (Date.now() - lastModifiedTime) / (60 * 60 * 1000),
              ),
            });
          } catch (deleteError) {
            logger.warn("Failed to delete checkpoint file", {
              key: obj.Key,
              error:
                deleteError instanceof Error
                  ? deleteError.message
                  : String(deleteError),
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
      const cutoffDate = new Date(
        Date.now() - retentionDays * 24 * 60 * 60 * 1000,
      );

      // Delete logs for tasks belonging to this organization using raw SQL subquery
      const result = await logRepo
        .createQueryBuilder()
        .delete()
        .from(WorkerTaskLog)
        .where(
          "task_id IN (SELECT id FROM worker_tasks WHERE org_id = :orgId)",
          { orgId: org.id },
        )
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
 * Fail orphaned tasks that are stuck in non-terminal states
 *
 * Orphaned tasks are ones that:
 * 1. Are in claimed/environment_setup/executing status
 * 2. Either have no ECS ARN (and spawn time exceeded), or their ECS task no longer exists
 *
 * This prevents webhooks from being blocked by stuck tasks
 */
async function failOrphanedTasks(): Promise<void> {
  const taskRepo = getTaskRepo();
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000); // Buffer for spawn time
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000); // Timeout for dispatching tasks

  try {
    // Find all tasks in active states (including dispatching for PRD orchestration)
    const activeTasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.status IN (:...statuses)", {
        statuses: ["claimed", "environment_setup", "executing", "dispatching"],
      })
      .limit(20)
      .getMany();

    if (activeTasks.length === 0) return;

    // Handle dispatching tasks separately - they're orphaned if stuck for 10+ min with no children
    const orphanedDispatchingTasks = activeTasks.filter(
      (t) =>
        t.status === "dispatching" &&
        t.updatedAt < tenMinutesAgo &&
        (!t.childTaskIds || t.childTaskIds.length === 0),
    );

    // Fail orphaned dispatching tasks (parent task that failed to create children)
    for (const task of orphanedDispatchingTasks) {
      logger.warn(
        "Failing orphaned dispatching task (no child tasks created)",
        {
          taskId: task.id,
          jiraIssueKey: task.jiraIssueKey,
          status: task.status,
          updatedAt: task.updatedAt,
          childTaskIds: task.childTaskIds,
        },
      );

      task.status = "failed";
      task.completedAt = new Date();
      task.errorMessage = `Task orphaned: stuck in 'dispatching' status for ${Math.round((Date.now() - task.updatedAt.getTime()) / 60000)} minutes without creating child tasks`;
      await taskRepo.save(task);
      await logTaskEvent(task.id, "error", task.errorMessage, {
        severity: "error",
      });
    }

    // Filter out dispatching tasks from normal orphan processing (they don't have ECS ARNs)
    const nonDispatchingTasks = activeTasks.filter(
      (t) => t.status !== "dispatching",
    );

    // Split into tasks with and without ECS ARN
    // - Tasks WITH ARN: check immediately if ECS task exists (no delay needed)
    // - Tasks WITHOUT ARN: only check if they've been stuck for 2+ min (allow spawn time)
    const tasksWithArn = nonDispatchingTasks.filter((t) => t.ecsTaskArn);
    const tasksWithoutArn = nonDispatchingTasks.filter(
      (t) => !t.ecsTaskArn && t.updatedAt < twoMinutesAgo,
    );

    // Batch describe ECS tasks
    let existingEcsArns = new Set<string>();
    if (tasksWithArn.length > 0) {
      try {
        const describeResult = await ecsClient.send(
          new DescribeTasksCommand({
            cluster: config.aws.ecsCluster,
            tasks: tasksWithArn.map((t) => t.ecsTaskArn!),
          }),
        );
        // ECS tasks that exist (even if stopped) are in the response
        for (const ecsTask of describeResult.tasks || []) {
          if (ecsTask.taskArn) {
            existingEcsArns.add(ecsTask.taskArn);
          }
        }
      } catch (error) {
        logger.warn("Error describing ECS tasks for orphan check", {
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with tasks without ARN only
      }
    }

    // Count dispatching tasks that were already failed above
    let failedCount = orphanedDispatchingTasks.length;

    // Fail tasks without ECS ARN (never spawned properly)
    for (const task of tasksWithoutArn) {
      logger.warn("Failing orphaned task (no ECS ARN)", {
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        status: task.status,
        updatedAt: task.updatedAt,
      });

      task.status = "failed";
      task.completedAt = new Date();
      task.errorMessage = `Task orphaned: stuck in '${task.status}' status without ECS task for ${Math.round((Date.now() - task.updatedAt.getTime()) / 60000)} minutes`;
      await taskRepo.save(task);
      await logTaskEvent(task.id, "error", task.errorMessage, {
        severity: "error",
      });
      failedCount++;
    }

    // Fail tasks whose ECS task no longer exists
    for (const task of tasksWithArn) {
      if (!existingEcsArns.has(task.ecsTaskArn!)) {
        logger.warn("Failing orphaned task (ECS task not found)", {
          taskId: task.id,
          jiraIssueKey: task.jiraIssueKey,
          status: task.status,
          ecsTaskArn: task.ecsTaskArn,
          updatedAt: task.updatedAt,
        });

        task.status = "failed";
        task.completedAt = new Date();
        task.errorMessage = `Task orphaned: ECS task ${task.ecsTaskId || task.ecsTaskArn} no longer exists`;
        await taskRepo.save(task);
        await logTaskEvent(task.id, "error", task.errorMessage, {
          severity: "error",
        });
        failedCount++;
      }
    }

    if (failedCount > 0) {
      logger.info("Failed orphaned tasks", { count: failedCount });
    }
  } catch (error) {
    logger.error("Error in failOrphanedTasks", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Cleanup stuck planning tasks
 *
 * This handles two scenarios:
 * 1. Tasks in `pending_plan_approval` status that have been waiting for human approval
 *    for more than 7 days - fail them with a timeout message
 * 2. Tasks in `planning` status with `planStatus = "pending_approval"` that have been
 *    stuck for more than 30 minutes (indicating the planning agent crashed) - reset them
 *    so they can be re-planned
 */
async function cleanupStuckPlanningTasks(): Promise<void> {
  const taskRepo = getTaskRepo();

  // Thresholds
  const PLAN_APPROVAL_TIMEOUT_DAYS = 7;
  const PLANNING_STUCK_TIMEOUT_MINUTES = 30;

  const sevenDaysAgo = new Date(
    Date.now() - PLAN_APPROVAL_TIMEOUT_DAYS * 24 * 60 * 60 * 1000,
  );
  const thirtyMinutesAgo = new Date(
    Date.now() - PLANNING_STUCK_TIMEOUT_MINUTES * 60 * 1000,
  );

  try {
    // Issue 11: Fail tasks stuck in `pending_plan_approval` for more than 7 days
    const timedOutApprovalTasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.status = :status", { status: "pending_plan_approval" })
      .andWhere("task.updatedAt < :cutoff", { cutoff: sevenDaysAgo })
      .limit(20)
      .getMany();

    for (const task of timedOutApprovalTasks) {
      const daysSinceUpdate = Math.round(
        (Date.now() - task.updatedAt.getTime()) / (24 * 60 * 60 * 1000),
      );

      logger.warn("Failing task due to plan approval timeout", {
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        status: task.status,
        updatedAt: task.updatedAt,
        daysSinceUpdate,
      });

      task.status = "failed";
      task.completedAt = new Date();
      task.errorMessage = `Plan approval timed out after ${daysSinceUpdate} days. The plan was never approved or rejected.`;
      await taskRepo.save(task);
      await logTaskEvent(task.id, "error", task.errorMessage, {
        severity: "error",
      });
    }

    // Issue 12: Reset tasks stuck in `planning` with `planStatus = "pending_approval"` for more than 30 minutes
    // This indicates the planning agent crashed after creating a plan but before transitioning to pending_plan_approval
    const stuckPlanningTasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.status = :status", { status: "planning" })
      .andWhere("task.planStatus = :planStatus", {
        planStatus: "pending_approval",
      })
      .andWhere("task.updatedAt < :cutoff", { cutoff: thirtyMinutesAgo })
      .limit(20)
      .getMany();

    for (const task of stuckPlanningTasks) {
      const minutesSinceUpdate = Math.round(
        (Date.now() - task.updatedAt.getTime()) / (60 * 1000),
      );

      logger.warn("Resetting stuck planning task for re-planning", {
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        status: task.status,
        planStatus: task.planStatus,
        updatedAt: task.updatedAt,
        minutesSinceUpdate,
      });

      // Reset planStatus to null so it can be re-claimed by the planning loop
      task.planStatus = null;
      task.planJson = null;
      task.planningNotes = null;
      await taskRepo.save(task);
      await logTaskEvent(
        task.id,
        "system",
        `Task reset for re-planning after being stuck for ${minutesSinceUpdate} minutes. The planning agent may have crashed.`,
        { severity: "warning" },
      );
    }

    const totalProcessed =
      timedOutApprovalTasks.length + stuckPlanningTasks.length;
    if (totalProcessed > 0) {
      logger.info("Cleaned up stuck planning tasks", {
        timedOutApprovals: timedOutApprovalTasks.length,
        resetForReplanning: stuckPlanningTasks.length,
      });
    }
  } catch (error) {
    logger.error("Error in cleanupStuckPlanningTasks", {
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
      failOrphanedTasks(),
      cleanupStuckPlanningTasks(),
    ]).catch((error) => {
      logger.error("Error during cleanup operations", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    // Run every hour
    await new Promise((resolve) => setTimeout(resolve, 60 * 60 * 1000));
  }
}
