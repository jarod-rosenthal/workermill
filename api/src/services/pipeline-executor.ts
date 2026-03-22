/**
 * WorkerMill Pipeline Executor — Epic Workflow Runner
 *
 * Handles Epic workflow execution: container spawning, sequential pipeline steps,
 * multi-persona execution, and consolidated PR creation.
 *
 * - Multi-persona execution: Single container, persona hot-swap per step
 * - Git commit history IS the state machine
 * - Built-in TDD with verification types per step
 * - Plan Repair and Smart Rewind on failure
 *
 * EPIC MODE IS NOW THE DEFAULT WORKFLOW.
 * All tasks go through Epic mode unless they have:
 * - `sdk` label → Standard SDK mode (single-task Claude Agent SDK)
 * - `multi-provider` label → Multi-Provider mode (sequential with provider routing)
 *
 * Called from orchestrator.ts pollLoop(). Kept separate for focused responsibility.
 */

import { ECSClient, DescribeTasksCommand } from "@aws-sdk/client-ecs";
import { AppDataSource } from "../db/connection.js";
import {
  WorkerTask,
  Organization,
  WorkerTaskLog,
  WorkerContext,
  type WorkerPersona,
  type SubtaskDefinition,
} from "../models/index.js";
import { getECSTaskRunner } from "./ecs-task-runner.js";
import { config, getProviderCredentials } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { isValidProviderId, type ProviderId } from "../providers/types.js";
import { getScmProvider } from "../scm-providers/index.js";
import {
  getOrgCredentials,
  getReviewerGitHubToken,
  type OrgCredentials,
} from "./org-credentials.js";
import {
  claimWarmContainer,
  assignTaskToContainer,
  buildTaskEnvironment,
  maintainPoolSize,
} from "./warm-pool.js";
import { localEpicSpawner } from "./local-epic-spawner.js";
import { codebaseIndexer } from "./codebase-indexer.js";
import { CodebaseIndexStatus } from "../models/CodebaseIndexStatus.js";
import {
  type ExecutionPlanV2,
  type PlannedStepV2,
  type WorkerStepInput,
  type WorkerStepResult,
  type StepCommit,
  type RecoveryDecision,
  REWIND_THRESHOLDS,
  wouldExceedRewindThreshold,
  getStepTimeout,
  DEFAULT_STEP_TIMEOUT_MINUTES,
  REWIND_GIT_COMMAND,
  FRESH_START_GIT_COMMAND,
} from "./pipeline-v2-types.js";

// Repositories
const getTaskRepo = () => AppDataSource.getRepository(WorkerTask);
const getLogRepo = () => AppDataSource.getRepository(WorkerTaskLog);
const getOrgRepo = () => AppDataSource.getRepository(Organization);
const getContextRepo = () => AppDataSource.getRepository(WorkerContext);

/**
 * Infer AI provider from model ID.
 * E.g., "claude-sonnet-4-5" → "anthropic", "gpt-4o" → "openai"
 */
function inferProviderFromModel(modelId: string): string | null {
  if (modelId.startsWith("claude-") || modelId.includes("claude") ||
      modelId.includes("haiku") || modelId.includes("sonnet") || modelId.includes("opus")) {
    return "anthropic";
  }
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1") || modelId.startsWith("o3") || modelId.includes("codex")) {
    return "openai";
  }
  if (modelId.startsWith("gemini-")) {
    return "google";
  }
  if (modelId.includes(":")) {
    return "ollama";
  }
  return null;
}

// AWS clients
const ecsClient = new ECSClient({ region: config.aws.region });

/**
 * Log a task event to the database for real-time streaming
 */
async function logTaskEvent(
  taskId: string,
  type: "status_change" | "system" | "error" | "info" | "warning" | "retry",
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

/**
 * Check if a task should use Epic workflow.
 * Epic mode is now the DEFAULT workflow for all tasks.
 *
 * Only returns false when:
 * - Task has 'sdk' label (Standard SDK mode)
 * - Task has 'multi-provider' label (Multi-Provider mode)
 *
 * All other tasks use Epic workflow, including:
 * - Tasks with only 'workermill' label
 * - Tasks with explicit 'epic' label
 * - Tasks with pipelineVersion = 'v2'
 */
export function shouldUseEpicWorkflow(task: WorkerTask): boolean {
  const labels = (task.jiraFields as Record<string, unknown>)?.labels;

  if (Array.isArray(labels)) {
    // Standard SDK mode takes precedence (single-task Claude Agent SDK execution)
    if (labels.includes("sdk")) {
      return false;
    }

    // Multi-Provider mode takes precedence (sequential with provider routing)
    if (labels.includes("multi-provider")) {
      return false;
    }
  }

  // Epic mode is the default for all other cases
  return true;
}

/**
 * @deprecated Use shouldUseEpicWorkflow instead
 */
export function shouldUseV2Pipeline(task: WorkerTask): boolean {
  return shouldUseEpicWorkflow(task);
}

/**
 * Check if a task should use multi-persona single container execution.
 * This allows executing multiple subtasks with different personas in a single ECS container,
 * reducing startup overhead from N containers (~30s each) to 1 container (~30s total).
 *
 * Triggered by:
 * - 'epic' Jira label (Epic workflows are multi-persona by default)
 * - org.multiPersonaEnabled setting (org-wide opt-in)
 * - Task already has subtasksJson set
 */
export async function shouldUseMultiPersona(task: WorkerTask): Promise<boolean> {
  // Check if task already has subtasks defined
  if (task.isMultiPersonaTask()) {
    return true;
  }

  // Epic workflows are multi-persona by default
  if (shouldUseEpicWorkflow(task)) {
    return true;
  }

  // Check org setting
  const orgRepo = getOrgRepo();
  const org = await orgRepo.findOne({ where: { id: task.orgId } });
  if (org?.multiPersonaEnabled) {
    return true;
  }

  return false;
}

/**
 * Convert V2 execution plan steps to subtask definitions for multi-persona execution.
 * This bridges V2 planning with multi-persona single container execution.
 */
export function convertPlanToSubtasks(plan: ExecutionPlanV2): SubtaskDefinition[] {
  return plan.steps.map((step, index) => ({
    index,
    title: step.title,
    description: step.description || step.title,
    persona: step.persona,
    targetFiles: step.targetFiles,
    referenceFiles: step.referenceFiles,
    timeoutMinutes: step.timeoutMinutes,
  }));
}

/**
 * Publish story_ready messages after planning completes for Epic mode parallel execution.
 * Creates WorkerContext records for each story that experts can claim.
 * Initially only publishes stories with no dependencies (dependency-free stories).
 */
export async function publishStoriesReady(task: WorkerTask): Promise<void> {
  const contextRepo = getContextRepo();

  // Check if story_ready messages already exist for this task
  // This prevents duplicate messages when task restarts
  const existingCount = await contextRepo.count({
    where: {
      parentTaskId: task.id,
      messageType: "story_ready",
    },
  });

  if (existingCount > 0) {
    logger.info("Story_ready messages already published, skipping duplicates", {
      taskId: task.id,
      existingCount,
    });
    return;
  }

  // Parse the execution plan to extract stories
  const plan = task.executionPlanV2;
  if (!plan || !plan.steps || plan.steps.length === 0) {
    logger.warn("No execution plan found for publishStoriesReady", { taskId: task.id });
    return;
  }

  logger.info("Publishing story_ready messages for Epic mode", {
    taskId: task.id,
    jiraIssueKey: task.jiraIssueKey,
    storyCount: plan.steps.length,
  });

  // Pre-compute file-level overlap mutex groups across all stories.
  // If two stories share a targetFile, they get a shared `file:<path>` mutex group
  // so the coordinator forces them sequential via hasMutexConflict().
  const fileOverlapMutexByStep = new Map<number, string[]>();
  for (let i = 0; i < plan.steps.length; i++) {
    const stepA = plan.steps[i];
    if (!stepA.targetFiles || stepA.targetFiles.length === 0) continue;
    for (let j = i + 1; j < plan.steps.length; j++) {
      const stepB = plan.steps[j];
      if (!stepB.targetFiles || stepB.targetFiles.length === 0) continue;
      const shared = stepA.targetFiles.filter((f) =>
        stepB.targetFiles!.includes(f),
      );
      if (shared.length > 0) {
        const fileMutexes = shared.map((f) => `file:${f}`);
        fileOverlapMutexByStep.set(stepA.index, [
          ...(fileOverlapMutexByStep.get(stepA.index) || []),
          ...fileMutexes,
        ]);
        fileOverlapMutexByStep.set(stepB.index, [
          ...(fileOverlapMutexByStep.get(stepB.index) || []),
          ...fileMutexes,
        ]);
        logger.warn(
          "Stories share targetFiles — adding file-level mutex groups for sequential execution",
          {
            taskId: task.id,
            storyA: stepA.index,
            storyB: stepB.index,
            sharedFiles: shared,
          },
        );
      }
    }
  }

  let publishedCount = 0;

  for (const step of plan.steps) {
    // Check if story has dependencies (stories that must complete first)
    // Note: Cloud mode uses dependsOn, local mode uses dependencies - check both
    const stepWithDeps = step as PlannedStepV2 & { dependsOn?: number[]; dependencies?: number[] };
    const dependencies = stepWithDeps.dependsOn || stepWithDeps.dependencies || [];

    // Publish ALL stories upfront with their dependencies in metadata.
    // The Epic Coordinator checks dependencies against completed stories and
    // only starts a story when all its dependencies are complete.
    // This allows the coordinator to see the full picture and make smart decisions.

    // Get mutex groups from step or derive from targetFiles
    // Stories in the same mutex group cannot run in parallel to prevent conflicts
    const stepWithMutex = step as PlannedStepV2 & { mutexGroups?: string[] };
    let mutexGroups = stepWithMutex.mutexGroups || [];

    // If no explicit mutex groups, derive from targetFiles directories
    if (mutexGroups.length === 0 && step.targetFiles && step.targetFiles.length > 0) {
      const dirs = new Set<string>();
      for (const file of step.targetFiles) {
        // Extract directory from file path
        const lastSlash = file.lastIndexOf("/");
        const dir = lastSlash > 0 ? file.substring(0, lastSlash) : "root";
        dirs.add(`dir:${dir}`);
      }
      mutexGroups = Array.from(dirs);
    } else if (mutexGroups.length === 0) {
      // No targetFiles and no explicit mutex groups — story has unknown scope.
      // Force sequential execution with all other unscoped stories to prevent
      // the TB-2 failure mode where parallel experts rewrite the same files.
      mutexGroups = ["__unscoped__"];
      logger.warn(
        "Story has no targetFiles — assigned __unscoped__ mutex group (sequential execution)",
        {
          taskId: task.id,
          storyIndex: step.index,
          title: step.title,
        },
      );
    }

    // Merge in file-level overlap mutex groups (computed above)
    const overlapMutexes = fileOverlapMutexByStep.get(step.index) || [];
    if (overlapMutexes.length > 0) {
      mutexGroups = [...new Set([...mutexGroups, ...overlapMutexes])];
    }

    // Create story_ready context message
    const contextData = {
      parentTaskId: task.id,
      taskId: null, // No worker assigned yet
      orgId: task.orgId,
      persona: step.persona,
      messageType: "story_ready" as const,
      content: step.title,
      metadata: {
        storyIndex: step.index,
        persona: step.persona,
        title: step.title,
        description: step.description,
        targetFiles: step.targetFiles,
        referenceFiles: step.referenceFiles,
        verificationType: step.verificationType,
        dependencies: dependencies,
        mutexGroups: mutexGroups,
      },
    };

    const context = contextRepo.create(contextData);
    await contextRepo.save(context);
    publishedCount++;

    logger.info("Published story_ready message", {
      taskId: task.id,
      storyIndex: step.index,
      persona: step.persona,
      contextId: context.id,
    });
  }

  // Internal logging only - don't show "Published story_ready" in task logs
  logger.info("Published story_ready messages", {
    taskId: task.id,
    totalStories: plan.steps.length,
    publishedStories: publishedCount,
    deferredStories: plan.steps.length - publishedCount,
  });
}

/**
 * Spawn an Epic container for parallel multi-agent execution.
 * The container runs the Epic Coordinator which:
 * - Polls for story_ready messages
 * - Claims stories atomically
 * - Executes stories in parallel with expert subagents
 * - Routes questions between experts
 * - Posts completions
 *
 * Epic mode uses Anthropic/Claude CLI exclusively.
 *
 * If a warm container is available, it will be used instead of cold-starting.
 */
export async function spawnEpicContainer(task: WorkerTask): Promise<void> {
  const taskRepo = getTaskRepo();
  const orgRepo = getOrgRepo();

  // DEBUG: Log local mode check
  const isLocal = localEpicSpawner.isLocalMode();
  const executionModeEnv = process.env.EXECUTION_MODE;
  logger.info("LOCAL MODE CHECK", {
    taskId: task.id,
    isLocalMode: isLocal,
    executionModeEnv,
    envKeys: Object.keys(process.env).filter(k => k.includes("EXECUTION")),
  });

  // Auto-index codebase for RAG if enabled
  try {
    const org = await orgRepo.findOne({ where: { id: task.orgId } });
    if (
      org?.codebaseIndexingEnabled &&
      org.codebaseAutoIndexOnTask &&
      task.githubRepo
    ) {
      const statusRepo = AppDataSource.getRepository(CodebaseIndexStatus);
      const existingIndex = await statusRepo.findOne({
        where: { orgId: task.orgId, repository: task.githubRepo, status: "ready" as const },
      });
      if (!existingIndex) {
        logger.info("Auto-indexing codebase for RAG before task execution", {
          taskId: task.id,
          repository: task.githubRepo,
        });
        // Fire and forget — don't block task execution on indexing
        codebaseIndexer.indexRepository(task.orgId, task.githubRepo).catch((err) => {
          logger.warn("Background codebase auto-indexing failed", {
            taskId: task.id,
            repository: task.githubRepo,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      } else {
        logger.debug("Codebase already indexed for RAG", {
          taskId: task.id,
          repository: task.githubRepo,
          indexId: existingIndex.id,
        });
      }
    }
  } catch (error) {
    logger.warn("Failed to check/trigger codebase auto-indexing", {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // LOCAL MODE: Spawn local process instead of ECS container
  if (isLocal) {
    logger.info("Running in local execution mode - spawning local Epic Coordinator", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
    });

    try {
      // Update task status
      await taskRepo.update({ id: task.id }, {
        status: "executing",
        startedAt: new Date(),
      });
      task.status = "executing";
      task.startedAt = new Date();

      // Fetch credentials from Secrets Manager (same as ECS path)
      // Provides GitHub token, reviewer token, and SCM credentials
      // so local workers don't need hardcoded tokens in .env.local
      let localCredentials: OrgCredentials | undefined;
      const localCredentialsOrgId = task.getCredentialsOrgId();
      try {
        localCredentials = await getOrgCredentials(localCredentialsOrgId);
        logger.info("Fetched Secrets Manager credentials for local mode", {
          taskId: task.id,
          hasGithubToken: !!localCredentials.githubToken,
          hasScmToken: !!localCredentials.scmToken,
        });

        // Fetch reviewer token for PR approvals (avoids self-approval restriction)
        if (!task.skipManagerReview) {
          try {
            const reviewerToken = await getReviewerGitHubToken(localCredentialsOrgId);
            if (reviewerToken) {
              localCredentials.githubReviewerToken = reviewerToken;
              logger.info("Added reviewer token for PR approvals", {
                taskId: task.id,
                hasReviewerToken: true,
              });
            }
          } catch (error) {
            logger.warn("Failed to fetch reviewer token (review may fail)", {
              taskId: task.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } catch (error) {
        logger.warn("Could not fetch Secrets Manager credentials, falling back to .env.local", {
          taskId: task.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Spawn local Epic Coordinator with Secrets Manager credentials
      await localEpicSpawner.spawnEpicCoordinator(task, localCredentials ? {
        githubToken: localCredentials.githubToken,
        githubReviewerToken: localCredentials.githubReviewerToken,
        scmToken: localCredentials.scmToken,
        bitbucketUsername: localCredentials.bitbucketUsername,
        bitbucketEmail: localCredentials.bitbucketEmail,
        jiraBaseUrl: localCredentials.jiraBaseUrl,
        jiraEmail: localCredentials.jiraEmail,
        jiraApiToken: localCredentials.jiraApiToken,
        managerProvider: localCredentials.managerProvider,
        managerModelId: localCredentials.managerModelId,
        linearApiKey: localCredentials.linearApiKey,
        customerAwsAccessKeyId: localCredentials.customerAwsAccessKeyId,
        customerAwsSecretAccessKey: localCredentials.customerAwsSecretAccessKey,
        customerAwsRegion: localCredentials.customerAwsRegion,
        anthropicApiKey: localCredentials.anthropicApiKey,
        openaiApiKey: localCredentials.openaiApiKey,
        googleApiKey: localCredentials.googleApiKey,
        ollamaBaseUrl: localCredentials.ollamaBaseUrl,
      } : undefined);

      logger.info("Local Epic Coordinator started successfully", {
        taskId: task.id,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to spawn local Epic Coordinator", {
        taskId: task.id,
        error: errorMessage,
      });
      await taskRepo.update({ id: task.id }, {
        status: "failed",
        errorMessage: `Local Epic spawn failed: ${errorMessage}`,
      });
    }
    return;
  }

  logger.info("Spawning Epic container for parallel execution", {
    taskId: task.id,
    jiraIssueKey: task.jiraIssueKey,
    repo: task.githubRepo,
    scmProvider: task.scmProvider,
  });

  // Get credentials for the Epic container (use credentialsOrgId for platform tasks)
  const credentialsOrgId = task.getCredentialsOrgId();
  const credentials = await getOrgCredentials(credentialsOrgId);

  // Add reviewer token for PR approvals (avoids self-approval restriction)
  if (!task.skipManagerReview) {
    try {
      const reviewerToken = await getReviewerGitHubToken(credentialsOrgId);
      if (reviewerToken) {
        credentials.githubReviewerToken = reviewerToken;
        logger.info("Added reviewer token for Epic PR approvals", {
          taskId: task.id,
          hasReviewerToken: true,
        });
      }
    } catch (error) {
      logger.warn("Failed to fetch reviewer token for Epic (review may fail)", {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Build additional environment variables for Epic
  const additionalEnv: Record<string, string> = {
    EPIC_MODE: "true",
    PARENT_TASK_ID: task.id,
  };

  // Track all providers used for dashboard visibility
  // Epic mode always uses Anthropic for workers, but planning and review may use different providers
  const org = await orgRepo.findOne({ where: { id: task.orgId } });

  // Pass org-level config to worker containers (resilience, features, limits)
  if (org?.codebaseIndexingEnabled) {
    additionalEnv.CODEBASE_INDEXING_ENABLED = "true";
  }
  if (org) {
    additionalEnv.MAX_REVIEW_REVISIONS = String(org.maxReviewRevisions);
    additionalEnv.MAX_PER_STORY_REVISIONS = String(org.maxPerStoryRevisions);
    additionalEnv.MAX_PARALLEL_EXPERTS = String(org.maxParallelExperts);
    additionalEnv.BLOCKER_MAX_AUTO_RETRIES = String(org.blockerMaxAutoRetries);
    additionalEnv.BLOCKER_AUTO_RETRY_ENABLED = org.blockerAutoRetryEnabled !== false ? "true" : "false";
    additionalEnv.MAX_FIX_RETRIES = String(org.maxFixRetries);
    if (org.maxAgentTurns != null) additionalEnv.MAX_AGENT_TURNS = String(org.maxAgentTurns);
    additionalEnv.BLOCKER_WAIT_TIMEOUT_MINUTES = String(org.blockerWaitTimeoutMinutes);
    additionalEnv.PUSH_AFTER_COMMIT = org.pushAfterCommit !== false ? "true" : "false";
    additionalEnv.GRACEFUL_SHUTDOWN_ENABLED = org.gracefulShutdownEnabled !== false ? "true" : "false";
    additionalEnv.SELF_REVIEW_ENABLED = org.selfReviewEnabled === true ? "true" : "false";

    // Quality gate commands from task-level jiraFields (set by board card run)
    const taskQualityGates = task.jiraFields?.qualityGates;
    if (taskQualityGates) {
      additionalEnv.QUALITY_GATE_COMMANDS = JSON.stringify(taskQualityGates);
    }
    if (task.jiraFields?.isFoundationCard) {
      additionalEnv.IS_FOUNDATION_CARD = "true";
    }
    const ciPath = task.jiraFields?.ciWorkflowPath as string;
    if (ciPath) {
      additionalEnv.CI_WORKFLOW_PATH = ciPath;
    }
  }

  const allProviders = new Set<string>();

  // Planning agent provider
  const planningModel = org?.planningAgentModel || "";
  const planningProvider = inferProviderFromModel(planningModel);
  if (planningProvider) allProviders.add(planningProvider);

  // Epic workers always use Anthropic (Claude Agent SDK)
  allProviders.add("anthropic");

  // Manager/reviewer provider
  const managerProvider = org?.managerProvider || "";
  if (managerProvider) allProviders.add(managerProvider);

  task.providersUsed = Array.from(allProviders);

  logger.info("Epic task provider tracking", {
    taskId: task.id,
    planningProvider,
    workerProvider: "anthropic",
    managerProvider,
    allProviders: task.providersUsed,
  });

  // Update task status
  await taskRepo.update({ id: task.id }, {
    status: "environment_setup",
    providersUsed: task.providersUsed,
  });
  task.status = "environment_setup";

  await logTaskEvent(
    task.id,
    "status_change",
    `Spawning container for repo: ${task.githubRepo}`,
  );

  // Try to claim a warm container first
  const warmContainer = await claimWarmContainer(task.orgId);

  if (warmContainer) {
    logger.info("Claimed warm container for Epic task", {
      taskId: task.id,
      containerId: warmContainer.id,
      ecsTaskId: warmContainer.ecsTaskId,
    });

    await logTaskEvent(
      task.id,
      "status_change",
      `Using warm container: ${warmContainer.ecsTaskId}`,
      {
        metadata: {
          warmContainer: true,
          ecsTaskId: warmContainer.ecsTaskId,
        },
      },
    );

    // Build environment variables for the task
    const baseEnv = buildTaskEnvironment(task, credentials);
    const fullEnv = { ...baseEnv, ...additionalEnv };

    // Assign task to warm container
    await assignTaskToContainer(warmContainer.id, task.id, fullEnv);

    // Update task with warm container's ECS info
    await taskRepo.update({ id: task.id }, {
      ecsTaskArn: warmContainer.ecsTaskArn,
      ecsTaskId: warmContainer.ecsTaskId,
      status: "executing",
      startedAt: new Date(),
    });
    task.ecsTaskArn = warmContainer.ecsTaskArn;
    task.ecsTaskId = warmContainer.ecsTaskId;
    task.status = "executing";
    task.startedAt = new Date();

    await logTaskEvent(
      task.id,
      "status_change",
      `Task assigned to warm container: ${warmContainer.ecsTaskId}`,
      {
        metadata: {
          ecsTaskId: warmContainer.ecsTaskId,
          epicMode: true,
          warmContainer: true,
        },
      },
    );

    logger.info("Epic task assigned to warm container successfully", {
      taskId: task.id,
      ecsTaskId: warmContainer.ecsTaskId,
      ecsTaskArn: warmContainer.ecsTaskArn,
    });

    // Spawn replacement warm container in background
    const org = await orgRepo.findOne({ where: { id: task.orgId } });
    if (org) {
      maintainPoolSize(org).catch((error) => {
        logger.error("Failed to spawn replacement warm container", {
          orgId: task.orgId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return;
  }

  // No warm container available - fall back to cold start
  logger.info("No warm container available, using cold start for Epic", {
    taskId: task.id,
  });

  // Spawn ECS task with Epic-specific environment
  // The worker's entrypoint.sh will detect EPIC_MODE and run epic-entrypoint.sh instead
  const runner = getECSTaskRunner();

  try {
    const result = await runner.runWorkerTask(task, credentials, {
      additionalEnv,
    });

    // Update task with ECS info
    await taskRepo.update({ id: task.id }, {
      ecsTaskArn: result.taskArn,
      ecsTaskId: result.taskId,
      status: "executing",
      startedAt: new Date(),
    });
    task.ecsTaskArn = result.taskArn;
    task.ecsTaskId = result.taskId;
    task.status = "executing";
    task.startedAt = new Date();

    await logTaskEvent(
      task.id,
      "status_change",
      `Epic container spawned (cold start): ${result.taskId}`,
      {
        metadata: {
          ecsTaskId: result.taskId,
          epicMode: true,
          warmContainer: false,
        },
      },
    );

    logger.info("Epic container spawned successfully (cold start)", {
      taskId: task.id,
      ecsTaskId: result.taskId,
      ecsTaskArn: result.taskArn,
    });
  } catch (error) {
    logger.error("Failed to spawn Epic container", {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });

    await taskRepo.update({ id: task.id }, {
      status: "failed",
      errorMessage: `Failed to spawn Epic container: ${error instanceof Error ? error.message : String(error)}`,
    });

    throw error;
  }
}

/**
 * Spawn a multi-expert container for parallel multi-provider execution.
 *
 * Multi-expert mode is similar to Epic but uses the Vercel AI SDK for execution.
 * This allows different expert personas to use different AI providers (Anthropic, Google, OpenAI, Ollama).
 *
 * The container runs the Multi-Expert Coordinator which:
 * - Polls for story_ready messages
 * - Claims stories atomically
 * - Executes stories with AI SDK using per-persona provider routing
 * - Routes questions between experts
 * - Posts completions
 *
 * If a warm container is available, it will be used instead of cold-starting.
 */
export async function spawnMultiExpertContainer(task: WorkerTask): Promise<void> {
  const taskRepo = getTaskRepo();
  const orgRepo = getOrgRepo();

  logger.info("Spawning multi-expert container for parallel execution", {
    taskId: task.id,
    jiraIssueKey: task.jiraIssueKey,
    repo: task.githubRepo,
    scmProvider: task.scmProvider,
  });

  // LOCAL MODE: Spawn local Docker container instead of ECS
  if (localEpicSpawner.isLocalMode()) {
    logger.info("Running in local execution mode - spawning local multi-expert coordinator", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
    });

    await taskRepo.update({ id: task.id }, {
      status: "executing",
      startedAt: new Date(),
    });
    task.status = "executing";
    task.startedAt = new Date();

    // Publish story_ready messages BEFORE spawning container
    if (task.executionPlanV2?.steps?.length) {
      await publishStoriesReady(task);
    }

    // Fetch credentials (same as spawnEpicContainer local path)
    let localCredentials: OrgCredentials | undefined;
    const localCredentialsOrgId = task.getCredentialsOrgId();
    try {
      localCredentials = await getOrgCredentials(localCredentialsOrgId);
      if (!task.skipManagerReview) {
        try {
          const reviewerToken = await getReviewerGitHubToken(localCredentialsOrgId);
          if (reviewerToken) localCredentials.githubReviewerToken = reviewerToken;
        } catch { /* reviewer token is optional */ }
      }
    } catch (error) {
      logger.warn("Could not fetch credentials, falling back to .env.local", {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Spawn local Epic Coordinator — entrypoint detects multi-expert mode from env
    await localEpicSpawner.spawnEpicCoordinator(task, localCredentials ? {
      githubToken: localCredentials.githubToken,
      githubReviewerToken: localCredentials.githubReviewerToken,
      scmToken: localCredentials.scmToken,
      bitbucketUsername: localCredentials.bitbucketUsername,
      bitbucketEmail: localCredentials.bitbucketEmail,
      jiraBaseUrl: localCredentials.jiraBaseUrl,
      jiraEmail: localCredentials.jiraEmail,
      jiraApiToken: localCredentials.jiraApiToken,
      managerProvider: localCredentials.managerProvider,
      managerModelId: localCredentials.managerModelId,
      ollamaBaseUrl: localCredentials.ollamaBaseUrl,
    } : undefined);

    logger.info("Local multi-expert coordinator started", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
    });

    return;
  }

  // Get credentials for the container (use credentialsOrgId for platform tasks)
  const multiExpertCredentialsOrgId = task.getCredentialsOrgId();
  const credentials = await getOrgCredentials(multiExpertCredentialsOrgId);

  // Add reviewer token for PR approvals (avoids self-approval restriction)
  if (!task.skipManagerReview) {
    try {
      const reviewerToken = await getReviewerGitHubToken(multiExpertCredentialsOrgId);
      if (reviewerToken) {
        credentials.githubReviewerToken = reviewerToken;
        logger.info("Added reviewer token for Multi-Expert PR approvals", {
          taskId: task.id,
          hasReviewerToken: true,
        });
      }
    } catch (error) {
      logger.warn("Failed to fetch reviewer token for Multi-Expert (review may fail)", {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Get org settings for provider routing
  const org = await orgRepo.findOneBy({ id: task.orgId });
  const providerRouting = org?.providerRouting;

  // Build additional environment variables for multi-expert
  const additionalEnv: Record<string, string> = {
    MULTI_EXPERT_MODE: "true",
    PARENT_TASK_ID: task.id,
  };

  // Add provider routing if configured
  if (providerRouting && Object.keys(providerRouting).length > 0) {
    additionalEnv.PROVIDER_ROUTING = JSON.stringify(providerRouting);

    // Fetch additional API keys for non-Anthropic providers
    const usedProviders = new Set(
      Object.values(providerRouting).map((r: { provider: string }) => r.provider),
    );

    if (usedProviders.has("google") || usedProviders.has("gemini")) {
      try {
        const googleKey = await getProviderCredentials(task.orgId, "google");
        // AI SDK expects GOOGLE_GENERATIVE_AI_API_KEY
        additionalEnv.GOOGLE_GENERATIVE_AI_API_KEY = googleKey;
      } catch (err) {
        logger.warn("Failed to get Google API key for multi-expert", {
          taskId: task.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (usedProviders.has("openai")) {
      try {
        const openaiKey = await getProviderCredentials(task.orgId, "openai");
        additionalEnv.OPENAI_API_KEY = openaiKey;
      } catch (err) {
        logger.warn("Failed to get OpenAI API key for multi-expert", {
          taskId: task.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (usedProviders.has("ollama")) {
      additionalEnv.OLLAMA_HOST = org?.ollamaBaseUrl || "http://localhost:11434";
    }

    logger.info("Multi-provider routing enabled", {
      taskId: task.id,
      providers: Array.from(usedProviders),
      personas: Object.keys(providerRouting),
    });

    // Build complete provider list: planning + workers + manager
    const allProviders = new Set(usedProviders);

    // Add planning agent provider (derive from model name)
    const planningModel = org?.planningAgentModel || "";
    const planningProvider = inferProviderFromModel(planningModel);
    if (planningProvider) allProviders.add(planningProvider);

    // Add manager/reviewer provider
    const managerProvider = org?.managerProvider || "";
    if (managerProvider) allProviders.add(managerProvider);

    // Store all providers used for dashboard visibility
    task.providersUsed = Array.from(allProviders);
  } else {
    // Even without explicit provider routing, track all agents' providers
    const allProviders = new Set<string>();

    // Planning agent provider
    const planningModel = org?.planningAgentModel || "";
    const planningProvider = inferProviderFromModel(planningModel);
    if (planningProvider) allProviders.add(planningProvider);

    // Default worker provider (from org settings)
    const defaultWorkerProvider = org?.primaryProvider || "anthropic";
    allProviders.add(defaultWorkerProvider);

    // Manager/reviewer provider
    const managerProvider2 = org?.managerProvider || "";
    if (managerProvider2) allProviders.add(managerProvider2);

    task.providersUsed = Array.from(allProviders);
  }

  // Update task status
  await taskRepo.update({ id: task.id }, {
    status: "environment_setup",
    providersUsed: task.providersUsed,
  });
  task.status = "environment_setup";

  await logTaskEvent(
    task.id,
    "status_change",
    `Spawning container for repo: ${task.githubRepo}`,
  );

  // Try to claim a warm container first
  const warmContainer = await claimWarmContainer(task.orgId);

  if (warmContainer) {
    logger.info("Claimed warm container for Multi-Expert task", {
      taskId: task.id,
      containerId: warmContainer.id,
      ecsTaskId: warmContainer.ecsTaskId,
    });

    await logTaskEvent(
      task.id,
      "status_change",
      `Using warm container: ${warmContainer.ecsTaskId}`,
      {
        metadata: {
          warmContainer: true,
          ecsTaskId: warmContainer.ecsTaskId,
        },
      },
    );

    // Build environment variables for the task
    const baseEnv = buildTaskEnvironment(task, credentials);
    const fullEnv = { ...baseEnv, ...additionalEnv };

    // Assign task to warm container
    await assignTaskToContainer(warmContainer.id, task.id, fullEnv);

    // Update task with warm container's ECS info
    await taskRepo.update({ id: task.id }, {
      ecsTaskArn: warmContainer.ecsTaskArn,
      ecsTaskId: warmContainer.ecsTaskId,
      status: "executing",
      startedAt: new Date(),
    });
    task.ecsTaskArn = warmContainer.ecsTaskArn;
    task.ecsTaskId = warmContainer.ecsTaskId;
    task.status = "executing";
    task.startedAt = new Date();

    await logTaskEvent(
      task.id,
      "status_change",
      `Task assigned to warm container: ${warmContainer.ecsTaskId}`,
      {
        metadata: {
          ecsTaskId: warmContainer.ecsTaskId,
          multiExpertMode: true,
          providerRouting: !!providerRouting,
          warmContainer: true,
        },
      },
    );

    logger.info("Multi-expert task assigned to warm container successfully", {
      taskId: task.id,
      ecsTaskId: warmContainer.ecsTaskId,
      ecsTaskArn: warmContainer.ecsTaskArn,
    });

    // Spawn replacement warm container in background
    if (org) {
      maintainPoolSize(org).catch((error) => {
        logger.error("Failed to spawn replacement warm container", {
          orgId: task.orgId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return;
  }

  // No warm container available - fall back to cold start
  logger.info("No warm container available, using cold start for Multi-Expert", {
    taskId: task.id,
  });

  // Spawn ECS task with multi-expert environment
  // The worker's entrypoint.sh will detect MULTI_EXPERT_MODE and run the multi-expert coordinator
  const runner = getECSTaskRunner();

  try {
    const result = await runner.runWorkerTask(task, credentials, {
      additionalEnv,
    });

    // Update task with ECS info
    await taskRepo.update({ id: task.id }, {
      ecsTaskArn: result.taskArn,
      ecsTaskId: result.taskId,
      status: "executing",
      startedAt: new Date(),
    });
    task.ecsTaskArn = result.taskArn;
    task.ecsTaskId = result.taskId;
    task.status = "executing";
    task.startedAt = new Date();

    await logTaskEvent(
      task.id,
      "status_change",
      `Multi-expert container spawned (cold start): ${result.taskId}`,
      {
        metadata: {
          ecsTaskId: result.taskId,
          multiExpertMode: true,
          providerRouting: !!providerRouting,
          warmContainer: false,
        },
      },
    );

    logger.info("Multi-expert container spawned successfully (cold start)", {
      taskId: task.id,
      ecsTaskId: result.taskId,
      ecsTaskArn: result.taskArn,
    });
  } catch (error) {
    logger.error("Failed to spawn multi-expert container", {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });

    await taskRepo.update({ id: task.id }, {
      status: "failed",
      errorMessage: `Failed to spawn multi-expert container: ${error instanceof Error ? error.message : String(error)}`,
    });

    throw error;
  }
}

/**
 * Spawn a single container that executes multiple subtasks with different personas.
 * This is the main entry point for multi-persona single container execution.
 *
 * The container receives SUBTASKS_JSON env var containing all subtask definitions.
 * The entrypoint.sh loops through subtasks, executing each with the appropriate persona.
 *
 * Benefits:
 * - Reduces startup overhead from N containers (~30s each) to 1 container (~30s total)
 * - Maintains git state between subtasks without re-cloning
 * - Context handoff via WorkerContext API for sibling awareness
 */
export async function spawnMultiPersonaContainer(task: WorkerTask): Promise<void> {
  const taskRepo = getTaskRepo();

  // Validate subtasks are set
  if (!task.subtasksJson || task.subtasksJson.length === 0) {
    throw new Error(`Task ${task.id} has no subtasks defined for multi-persona execution`);
  }

  // Validate SUBTASKS_JSON size (max 32KB for env var safety)
  const subtasksJsonString = JSON.stringify(task.subtasksJson);
  if (subtasksJsonString.length > 32 * 1024) {
    throw new Error(`SUBTASKS_JSON exceeds 32KB limit (${subtasksJsonString.length} bytes). Reduce subtask count or descriptions.`);
  }

  logger.info("Starting multi-persona single container execution", {
    taskId: task.id,
    jiraIssueKey: task.jiraIssueKey,
    subtaskCount: task.subtasksJson.length,
    personas: task.subtasksJson.map(s => s.persona),
  });

  await logTaskEvent(
    task.id,
    "status_change",
    `Multi-Persona Mode: ${task.subtasksJson.length} subtasks in single container`,
    {
      metadata: {
        subtaskCount: task.subtasksJson.length,
        personas: task.subtasksJson.map(s => s.persona),
      },
    },
  );

  // Determine provider from task
  const providerId: ProviderId =
    task.workerProvider && isValidProviderId(task.workerProvider)
      ? (task.workerProvider as ProviderId)
      : "anthropic";

  // Get credentials (use credentialsOrgId for platform tasks)
  const multiPersonaCredentialsOrgId = task.getCredentialsOrgId();
  const credentials = await getOrgCredentials(multiPersonaCredentialsOrgId);

  // Fetch provider-specific API key if not using anthropic
  if (providerId !== "anthropic") {
    try {
      credentials.providerApiKey = await getProviderCredentials(
        multiPersonaCredentialsOrgId,
        providerId,
      );
      credentials.providerId = providerId;
    } catch (error) {
      logger.error("Failed to fetch provider credentials", {
        taskId: task.id,
        provider: providerId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`Provider credentials not configured for '${providerId}'`);
    }
  }

  // Update task status
  await taskRepo.update({ id: task.id }, {
    status: "environment_setup",
    currentSubtaskIndex: 0,
    subtaskResults: [],
  });
  task.status = "environment_setup";
  task.currentSubtaskIndex = 0;
  task.subtaskResults = [];

  // Spawn ECS task with multi-persona environment
  const runner = getECSTaskRunner();

  // Add multi-persona specific data to jiraFields for ECS runner
  const originalJiraFields = task.jiraFields;
  task.jiraFields = {
    ...(originalJiraFields || {}),
    multiPersonaMode: true,
    subtasksJson: task.subtasksJson,
  };

  try {
    // Runner will detect multiPersonaMode and add SUBTASKS_JSON env var
    const result = await runner.runWorkerTask(task, credentials, {
      additionalEnv: {
        MULTI_PERSONA_MODE: "true",
        SUBTASKS_JSON: subtasksJsonString,
      },
    });

    // Update task with ECS info
    await taskRepo.update({ id: task.id }, {
      ecsTaskArn: result.taskArn,
      ecsTaskId: result.taskId,
      status: "executing",
      startedAt: new Date(),
    });
    task.ecsTaskArn = result.taskArn;
    task.ecsTaskId = result.taskId;
    task.status = "executing";
    task.startedAt = new Date();

    await logTaskEvent(
      task.id,
      "status_change",
      `Multi-persona ECS task started: ${result.taskId}`,
    );

    logger.info("Multi-persona container spawned", {
      taskId: task.id,
      ecsTaskId: result.taskId,
      subtaskCount: task.subtasksJson.length,
    });
  } catch (error) {
    logger.error("Failed to spawn multi-persona container", {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });

    await taskRepo.update({ id: task.id }, {
      status: "failed",
      errorMessage: `Failed to spawn multi-persona container: ${error instanceof Error ? error.message : String(error)}`,
    });

    throw error;
  }
}

/**
 * Main entry point for V2 pipeline execution.
 * Loops through steps sequentially, spawning workers for each step.
 *
 * If multi-persona mode is enabled (via label or org setting), this will spawn
 * a single container that executes all steps internally, rather than spawning
 * separate containers per step.
 */
export async function runSequentialPipeline(taskId: string): Promise<void> {
  const taskRepo = getTaskRepo();
  const task = await taskRepo.findOne({
    where: { id: taskId },
    relations: ["organization"],  // Load organization for API key access in local mode
  });

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  // Verify this is a V2 pipeline task
  if (!task.isV2Pipeline()) {
    throw new Error(`Task ${taskId} is not a V2 pipeline task`);
  }

  // Verify we have an execution plan
  if (!task.executionPlanV2 || !task.executionPlanV2.steps?.length) {
    throw new Error(`Task ${taskId} has no V2 execution plan`);
  }

  // Create feature branch for Epic/Multi-Expert workflows if not already created
  // This allows all story PRs to target the feature branch, then a final PR merges to main
  // Skip in local mode - git-ops.ts handles branch creation locally via direct git commands
  const isLocalMode = process.env.EXECUTION_MODE === "local";
  if ((task.executionMode === "parallel" || task.executionMode === "multi-expert") &&
      task.githubRepo && !task.githubBranch && !isLocalMode) {
    const featureBranch = `feature/${(task.jiraIssueKey || task.id.slice(0, 8)).toLowerCase()}`;

    try {
      // Get the organization to determine the correct SCM provider
      const orgRepo = AppDataSource.getRepository(Organization);
      const org = await orgRepo.findOne({ where: { id: task.orgId } });

      if (org) {
        // Use SCM provider abstraction for multi-provider support (GitHub, GitLab, BitBucket)
        const scmProvider = getScmProvider(org);

        // Task repo takes precedence (may be set from repo: label), fall back to org default
        // Note: task.githubRepo is guaranteed non-null by the outer condition check
        const repoToUse = task.githubRepo!;
        const scmProviderToUse = org.scmProvider || "github";
        const needsUpdate = scmProviderToUse !== task.scmProvider;

        if (needsUpdate) {
          logger.info("Updating task SCM provider from org", {
            taskId: task.id,
            repo: repoToUse,
            oldScmProvider: task.scmProvider,
            newScmProvider: scmProviderToUse,
          });
          await taskRepo.update({ id: task.id }, { scmProvider: scmProviderToUse });
          task.scmProvider = scmProviderToUse;
        }

        const repoId = scmProvider.parseRepoIdentifier(repoToUse);
        const branchCreated = await scmProvider.createBranch(repoId, featureBranch, "main");

        if (branchCreated) {
          await taskRepo.update({ id: task.id }, { githubBranch: featureBranch });
          task.githubBranch = featureBranch;

          await logTaskEvent(task.id, "info", `📌 Created feature branch: ${featureBranch}`);
          logger.info("Created feature branch for V2 workflow", {
            taskId: task.id,
            jiraIssueKey: task.jiraIssueKey,
            featureBranch,
            executionMode: task.executionMode,
            scmProvider: org.scmProvider || "github",
          });
        } else {
          await logTaskEvent(task.id, "info", `⚠️ Could not create feature branch ${featureBranch} - PRs will target main`);
          logger.warn("Failed to create feature branch for V2 workflow", {
            taskId: task.id,
            jiraIssueKey: task.jiraIssueKey,
            featureBranch,
            scmProvider: org.scmProvider || "github",
          });
        }
      } else {
        logger.warn("Could not find org for task, skipping branch creation", { taskId: task.id });
        await logTaskEvent(task.id, "info", `⚠️ Could not create feature branch - org not found`);
      }
    } catch (error) {
      logger.warn("Error creating feature branch", {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      await logTaskEvent(task.id, "info", `⚠️ Error creating feature branch - PRs will target main`);
    }
  }

  // Check for Epic parallel execution mode
  // When executionMode is 'parallel', use the Epic Coordinator for parallel multi-agent execution
  //
  // SDK selection is based ONLY on the task's workerProvider (execution provider):
  // - Anthropic → Agent SDK (Claude Code CLI) - proven working, full tool access
  // - Non-Anthropic → AI SDK (Vercel AI SDK) - multi-provider support
  //
  // The Planning Agent provider is independent - it already ran before execution starts.
  // This allows using Gemini/GPT for planning while using Claude Agent SDK for execution.
  if (task.executionMode === "parallel") {
    const orgRepo = getOrgRepo();
    const org = await orgRepo.findOne({ where: { id: task.orgId } });
    const planningProvider = org?.planningAgentProvider || "anthropic";
    const taskProvider = task.workerProvider || "anthropic";

    // Agent SDK (Claude Code CLI) ONLY works with Anthropic for EXECUTION
    // Planning provider doesn't affect this - planning already completed
    const useAgentSdk = taskProvider === "anthropic";

    logger.info("Using Epic parallel execution mode", {
      taskId,
      jiraIssueKey: task.jiraIssueKey,
      executionMode: task.executionMode,
      totalSteps: task.executionPlanV2.steps.length,
      planningAgentProvider: planningProvider,
      taskWorkerProvider: taskProvider,
      executor: useAgentSdk ? "agent-sdk" : "ai-sdk",
    });

    // Publish story_ready messages for experts to claim
    await publishStoriesReady(task);

    if (useAgentSdk) {
      // Execution provider is Anthropic = Agent SDK (Claude Code CLI)
      await spawnEpicContainer(task);
    } else {
      // Execution provider is non-Anthropic = AI SDK (Vercel AI SDK)
      await spawnMultiExpertContainer(task);
    }

    // Container handles parallel execution and reports completion via markers
    return;
  }

  // Check for multi-expert execution mode
  // When executionMode is 'multi-expert', use the Multi-Expert Coordinator with AI SDK
  if (task.executionMode === "multi-expert") {
    logger.info("Using multi-expert execution mode with AI SDK", {
      taskId,
      jiraIssueKey: task.jiraIssueKey,
      executionMode: task.executionMode,
      workerProvider: task.workerProvider,
      totalSteps: task.executionPlanV2.steps.length,
    });

    // Publish story_ready messages for experts to claim
    await publishStoriesReady(task);

    // Spawn multi-expert container that coordinates multi-provider execution
    await spawnMultiExpertContainer(task);

    // Multi-expert container handles execution and reports completion via markers
    return;
  }

  const plan = task.executionPlanV2;
  const totalSteps = plan.steps.length;

  // Check if multi-persona single container mode should be used
  const useMultiPersona = await shouldUseMultiPersona(task);

  if (useMultiPersona) {
    logger.info("Using multi-persona single container mode", {
      taskId,
      jiraIssueKey: task.jiraIssueKey,
      totalSteps,
    });

    // Convert V2 plan steps to subtask definitions
    task.subtasksJson = convertPlanToSubtasks(plan);
    await taskRepo.update({ id: task.id }, { subtasksJson: task.subtasksJson });

    // Spawn single container with all subtasks
    await spawnMultiPersonaContainer(task);

    // Container handles all steps internally and reports completion via markers
    // The orchestrator doesn't need to poll - task completion handled by standard completion flow
    return;
  }

  // Standard V2 mode: spawn container per step
  logger.info("Starting V2 sequential pipeline (standard mode)", {
    taskId,
    jiraIssueKey: task.jiraIssueKey,
    totalSteps,
    currentStepIndex: task.currentStepIndex,
    architecturalSummary: plan.architecturalSummary,
  });

  await logTaskEvent(
    taskId,
    "status_change",
    `Starting V2 sequential pipeline: ${totalSteps} steps`,
    {
      metadata: {
        totalSteps,
        architecturalSummary: plan.architecturalSummary,
        techStack: plan.techStack,
      },
    },
  );

  // Update task status to executing
  await taskRepo.update({ id: task.id }, { status: "executing" });
  task.status = "executing";

  // Loop through steps starting from currentStepIndex
  while (task.currentStepIndex < totalSteps) {
    const stepIndex = task.currentStepIndex;
    const step = plan.steps[stepIndex];

    logger.info("Executing step", {
      taskId,
      stepIndex,
      stepTitle: step.title,
      persona: step.persona,
      targetFiles: step.targetFiles,
    });

    await logTaskEvent(
      taskId,
      "status_change",
      `Step ${stepIndex + 1}/${totalSteps}: ${step.title}`,
      {
        metadata: {
          stepIndex,
          persona: step.persona,
          targetFiles: step.targetFiles,
          verificationType: step.verificationType,
        },
      },
    );

    // Reset retry count for this new step
    await taskRepo.update({ id: task.id }, { currentStepRetryCount: 0 });
    task.currentStepRetryCount = 0;

    // Execute the step
    const result = await executeStep(task, step);

    // Handle the result
    if (result.status === "STEP_COMPLETE") {
      // Record the successful commit
      if (result.commitHash) {
        await recordStepCompletion(
          taskId,
          stepIndex,
          result.commitHash,
          step.persona,
        );
      }

      // Move to next step
      await taskRepo.update({ id: task.id }, { currentStepIndex: stepIndex + 1 });
      task.currentStepIndex = stepIndex + 1;

      logger.info("Step completed successfully", {
        taskId,
        stepIndex,
        commitHash: result.commitHash,
      });

      await logTaskEvent(
        taskId,
        "info",
        `Step ${stepIndex + 1} completed: ${result.commitHash || "no commit"}`,
      );
    } else if (result.status === "STEP_FAILED" || result.status === "NEEDS_REWIND") {
      // Handle step failure
      const shouldContinue = await handleStepFailure(task, step, result);
      if (!shouldContinue) {
        // Pipeline failed or escalated, exit loop
        return;
      }
      // Otherwise, task state has been updated for retry/rewind, continue loop
      // Reload task to get updated state
      const reloadedTask = await taskRepo.findOne({ where: { id: taskId } });
      if (!reloadedTask) {
        throw new Error(`Task disappeared during recovery: ${taskId}`);
      }
      Object.assign(task, reloadedTask);
    }
  }

  // All steps completed - create consolidated PR
  logger.info("All steps completed, creating consolidated PR", {
    taskId,
    totalSteps,
    commitCount: task.commitHistory?.length || 0,
  });

  await logTaskEvent(
    taskId,
    "status_change",
    `All ${totalSteps} steps completed. Creating consolidated PR...`,
  );

  await createConsolidatedPR(task);
}

/**
 * Execute a single step by spawning an ECS worker.
 */
export async function executeStep(
  task: WorkerTask,
  step: PlannedStepV2,
): Promise<WorkerStepResult> {
  const taskRepo = getTaskRepo();

  // Determine provider from task
  const providerId: ProviderId =
    task.workerProvider && isValidProviderId(task.workerProvider)
      ? (task.workerProvider as ProviderId)
      : "anthropic";

  // Get credentials (use credentialsOrgId for platform tasks)
  const stepCredentialsOrgId = task.getCredentialsOrgId();
  const credentials = await getOrgCredentials(stepCredentialsOrgId);

  // Fetch provider-specific API key if not using anthropic
  if (providerId !== "anthropic") {
    try {
      credentials.providerApiKey = await getProviderCredentials(
        stepCredentialsOrgId,
        providerId,
      );
      credentials.providerId = providerId;
    } catch (error) {
      logger.error("Failed to fetch provider credentials", {
        taskId: task.id,
        provider: providerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        status: "STEP_FAILED",
        logs: `Provider credentials not configured for '${providerId}'`,
        errorMessage: `Provider credentials not configured for '${providerId}'. Please configure API key in Settings.`,
      };
    }
  }

  // Determine repo state and git setup command
  const isFreshStart = task.currentStepIndex === 0 && (!task.commitHistory || task.commitHistory.length === 0);
  const isRetry = task.currentStepRetryCount > 0;
  const lastCommit = task.commitHistory?.[task.commitHistory.length - 1];

  let repoState: "fresh" | "continue" | "rewind";
  let gitSetupCommand: string | undefined;
  let previousCommitHash: string | undefined;

  if (isFreshStart) {
    repoState = "fresh";
    gitSetupCommand = FRESH_START_GIT_COMMAND; // Remove any stale files
  } else if (isRetry && lastCommit) {
    // Retrying after failure - rewind to last good commit
    repoState = "rewind";
    previousCommitHash = lastCommit.commitHash;
    gitSetupCommand = REWIND_GIT_COMMAND(lastCommit.commitHash);
  } else {
    repoState = "continue";
    previousCommitHash = lastCommit?.commitHash;
    // No cleanup needed for normal continuation
  }

  // Prepare WorkerStepInput that will be passed via environment
  const stepInput: WorkerStepInput = {
    step,
    contextSidecar: task.contextSidecar || [],
    repoState,
    gitSetupCommand,
    previousCommitHash,
    fullPlan: task.executionPlanV2!,
    currentStepIndex: task.currentStepIndex,
    totalSteps: task.executionPlanV2!.steps.length,
  };

  // Update task status to environment_setup
  await taskRepo.update({ id: task.id }, {
    status: "environment_setup",
    workerPersona: step.persona,
  });
  task.status = "environment_setup";
  task.workerPersona = step.persona;

  await logTaskEvent(
    task.id,
    "status_change",
    `Setting up execution environment for step ${step.index + 1} (persona: ${step.persona})`,
  );

  // Spawn ECS task with step-specific environment
  const runner = getECSTaskRunner();

  // Update task jiraFields with step input for the worker to read
  // We modify the actual task so that ECS runner passes this data
  const originalJiraFields = task.jiraFields;
  task.jiraFields = {
    ...(originalJiraFields || {}),
    v2StepInput: stepInput,
    pipelineVersion: "v2",
  };

  try {
    const result = await runner.runWorkerTask(task, credentials);

    // Update task with ECS info
    await taskRepo.update({ id: task.id }, {
      ecsTaskArn: result.taskArn,
      ecsTaskId: result.taskId,
      status: "executing",
      startedAt: new Date(),
    });
    task.ecsTaskArn = result.taskArn;
    task.ecsTaskId = result.taskId;
    task.status = "executing";
    task.startedAt = new Date();

    await logTaskEvent(
      task.id,
      "status_change",
      `ECS task started for step ${step.index + 1}: ${result.taskId}`,
    );

    // Wait for ECS task completion with step-specific timeout
    const timeoutMs = getStepTimeout(step);
    const stepResult = await waitForStepCompletion(task, result.taskArn, step, timeoutMs);

    return stepResult;
  } catch (error) {
    logger.error("Failed to spawn worker for step", {
      taskId: task.id,
      stepIndex: step.index,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      status: "STEP_FAILED",
      logs: `Failed to spawn worker: ${error instanceof Error ? error.message : String(error)}`,
      errorMessage: error instanceof Error ? error.message : "Failed to spawn worker",
    };
  }
}

/**
 * Wait for an ECS task to complete and parse the step result from logs.
 * Uses step-specific timeout to prevent zombie steps from burning credits.
 */
async function waitForStepCompletion(
  task: WorkerTask,
  taskArn: string,
  step: PlannedStepV2,
  timeoutMs: number,
): Promise<WorkerStepResult> {
  const pollIntervalMs = 5000; // 5 seconds
  const startTime = Date.now();
  const timeoutMinutes = Math.round(timeoutMs / 60000);

  logger.info("Waiting for step completion", {
    taskId: task.id,
    stepIndex: step.index,
    timeoutMinutes,
  });

  while (Date.now() - startTime < timeoutMs) {
    try {
      const describeResult = await ecsClient.send(
        new DescribeTasksCommand({
          cluster: config.aws.ecsCluster,
          tasks: [taskArn],
        }),
      );

      const ecsTask = describeResult.tasks?.[0];
      if (!ecsTask) {
        return {
          status: "STEP_FAILED",
          logs: "ECS task not found",
          errorMessage: "ECS task not found during monitoring",
        };
      }

      const container = ecsTask.containers?.find((c) => c.name === "worker");
      const lastStatus = ecsTask.lastStatus || "UNKNOWN";

      if (lastStatus === "STOPPED") {
        const exitCode = container?.exitCode ?? -1;
        const stoppedReason = ecsTask.stoppedReason || container?.reason;

        // Check for Spot interruption
        if (
          ecsTask.stopCode === "SpotInterruption" ||
          (exitCode === 137 && stoppedReason?.toLowerCase().includes("spot"))
        ) {
          logger.warn("Spot interruption during step execution", {
            taskId: task.id,
            taskArn,
          });
          return {
            status: "STEP_FAILED",
            logs: "Spot capacity reclaimed during step execution",
            errorMessage: "Spot capacity reclaimed - step needs retry",
          };
        }

        // Parse result from task logs
        return await parseStepResultFromLogs(task.id, exitCode);
      }

      // Still running, wait and poll again
      await sleep(pollIntervalMs);
    } catch (error) {
      logger.error("Error polling ECS task status", {
        taskId: task.id,
        taskArn,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(pollIntervalMs);
    }
  }

  // Timeout reached - zombie step prevention
  logger.error("Step execution timed out (zombie step prevention)", {
    taskId: task.id,
    stepIndex: step.index,
    timeoutMinutes,
    elapsedMs: Date.now() - startTime,
  });

  return {
    status: "STEP_FAILED",
    logs: `Step execution timed out after ${timeoutMinutes} minutes (zombie step prevention)`,
    errorMessage: `Step ${step.index + 1} timed out after ${timeoutMinutes} minutes. Consider increasing timeoutMinutes if this step legitimately needs more time.`,
  };
}

/**
 * Parse step result from worker task logs.
 * Looks for V2-specific markers: ::step_result::, ::step_commit::, etc.
 */
async function parseStepResultFromLogs(
  taskId: string,
  exitCode: number,
): Promise<WorkerStepResult> {
  // Read result markers from task logs
  const logs = await AppDataSource.query(
    `SELECT message FROM worker_task_logs
     WHERE task_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [taskId],
  );

  let detectedResult: WorkerStepResult["status"] | null = null;
  let detectedCommitHash: string | null = null;
  let detectedErrorMessage: string | null = null;
  const detectedConstraints: string[] = [];
  let detectedRewindSuggestion: number | null = null;
  const allLogs: string[] = [];

  for (const log of logs) {
    const msg = log.message || "";
    allLogs.push(msg);

    // Look for V2 step result markers
    // ::step_result::STEP_COMPLETE or ::step_result::STEP_FAILED
    const stepResultMatch = msg.match(/::step_result::(\w+)/);
    if (stepResultMatch && !detectedResult) {
      const resultValue = stepResultMatch[1];
      if (resultValue === "STEP_COMPLETE" || resultValue === "STEP_FAILED" || resultValue === "NEEDS_REWIND") {
        detectedResult = resultValue as WorkerStepResult["status"];
      }
    }

    // Look for commit hash marker
    // ::step_commit::abc123
    const commitMatch = msg.match(/::step_commit::([a-f0-9]{7,40})/i);
    if (commitMatch && !detectedCommitHash) {
      detectedCommitHash = commitMatch[1];
    }

    // Look for error message marker
    // ::step_error::Some error message
    const errorMatch = msg.match(/::step_error::(.+?)(?:::|\n|$)/);
    if (errorMatch && !detectedErrorMessage) {
      detectedErrorMessage = errorMatch[1];
    }

    // Look for constraint markers (can be multiple)
    // ::step_constraint::Do not use framework X
    const constraintMatch = msg.match(/::step_constraint::(.+?)(?:::|\n|$)/);
    if (constraintMatch) {
      detectedConstraints.push(constraintMatch[1]);
    }

    // Look for rewind suggestion
    // ::step_rewind::3 (meaning rewind to step 3)
    const rewindMatch = msg.match(/::step_rewind::(\d+)/);
    if (rewindMatch && detectedRewindSuggestion === null) {
      detectedRewindSuggestion = parseInt(rewindMatch[1], 10);
    }

    // Also check for legacy result markers for backward compatibility
    const legacyResultMatch = msg.match(/::result::(\w+)/);
    if (legacyResultMatch && !detectedResult) {
      const legacy = legacyResultMatch[1];
      if (legacy === "deployed" || legacy === "completed" || legacy === "no_changes") {
        detectedResult = "STEP_COMPLETE";
      } else if (legacy === "failed" || legacy === "escalated") {
        detectedResult = "STEP_FAILED";
      }
    }
  }

  // Determine final result based on markers and exit code
  let finalStatus: WorkerStepResult["status"];
  if (detectedResult) {
    finalStatus = detectedResult;
  } else if (exitCode === 0) {
    finalStatus = "STEP_COMPLETE";
  } else {
    finalStatus = "STEP_FAILED";
  }

  return {
    status: finalStatus,
    commitHash: detectedCommitHash || undefined,
    logs: allLogs.slice(0, 50).join("\n"),
    suggestedConstraints: detectedConstraints.length > 0 ? detectedConstraints : undefined,
    rewindSuggestion: detectedRewindSuggestion !== null ? detectedRewindSuggestion : undefined,
    errorMessage: detectedErrorMessage || (finalStatus === "STEP_FAILED" ? "Step failed" : undefined),
  };
}

/**
 * Record a successful step completion.
 * Adds the commit to commit history.
 */
export async function recordStepCompletion(
  taskId: string,
  stepIndex: number,
  commitHash: string,
  persona: WorkerPersona,
): Promise<void> {
  const taskRepo = getTaskRepo();
  const task = await taskRepo.findOne({ where: { id: taskId } });

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const commit: StepCommit = {
    stepIndex,
    commitHash,
    persona,
    committedAt: new Date().toISOString(),
  };

  // Atomic JSONB append to commit history
  await taskRepo
    .createQueryBuilder()
    .update(WorkerTask)
    .set({
      commitHistory: () =>
        `COALESCE("commit_history", '[]'::jsonb) || :newCommit::jsonb`,
    })
    .where("id = :id", { id: taskId })
    .setParameters({ newCommit: JSON.stringify(commit) })
    .execute();

  logger.info("Recorded step completion", {
    taskId,
    stepIndex,
    commitHash,
    persona,
  });
}

/**
 * Handle a step failure.
 * Implements Plan Repair and Smart Rewind logic.
 * Returns true if pipeline should continue (retry/rewind), false if it should stop.
 */
async function handleStepFailure(
  task: WorkerTask,
  step: PlannedStepV2,
  result: WorkerStepResult,
): Promise<boolean> {
  const taskRepo = getTaskRepo();

  logger.warn("Step failed", {
    taskId: task.id,
    stepIndex: step.index,
    errorMessage: result.errorMessage,
    retryCount: task.currentStepRetryCount,
  });

  await logTaskEvent(
    task.id,
    "error",
    `Step ${step.index + 1} failed: ${result.errorMessage || "Unknown error"}`,
    { severity: "error" },
  );

  // Add any suggested constraints to the context sidecar
  if (result.suggestedConstraints?.length) {
    for (const constraint of result.suggestedConstraints) {
      task.addConstraint(constraint);
    }
    await logTaskEvent(
      task.id,
      "info",
      `Added ${result.suggestedConstraints.length} new constraint(s) from failed step`,
    );
  }

  // Determine recovery action
  const recovery = determineRecoveryAction(task, step, result);

  switch (recovery.action) {
    case "RETRY_STEP":
      // Simple retry - atomic increment of retry count + persist any new constraints
      await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          currentStepRetryCount: () => '"current_step_retry_count" + 1',
          contextSidecar: task.contextSidecar,
        })
        .where("id = :id", { id: task.id })
        .execute();
      task.currentStepRetryCount += 1;

      await logTaskEvent(
        task.id,
        "info",
        `Retrying step ${step.index + 1} (attempt ${task.currentStepRetryCount + 1}/${REWIND_THRESHOLDS.maxRetriesPerStep + 1})`,
      );
      return true;

    case "RETRY_WITH_MODIFIED_STEP":
      // Retry with modified step
      if (recovery.modifiedStep && task.executionPlanV2) {
        task.executionPlanV2.steps[step.index] = recovery.modifiedStep;
      }
      task.currentStepRetryCount += 1;

      if (recovery.newConstraint) {
        task.addConstraint(recovery.newConstraint);
      }
      await taskRepo.update({ id: task.id }, {
        currentStepRetryCount: task.currentStepRetryCount,
        executionPlanV2: task.executionPlanV2,
        contextSidecar: task.contextSidecar,
      });

      await logTaskEvent(
        task.id,
        "info",
        `Retrying step ${step.index + 1} with modifications`,
      );
      return true;

    case "REWIND": {
      // Rewind to a previous step
      const targetIndex = recovery.targetStepIndex ?? 0;
      const targetCommit = task.getCommitForStep(targetIndex - 1);

      // Trim commit history to target
      if (task.commitHistory) {
        task.commitHistory = task.commitHistory.filter(
          (c) => c.stepIndex < targetIndex,
        );
      }

      task.currentStepIndex = targetIndex;
      task.currentStepRetryCount = 0;

      if (recovery.newConstraint) {
        task.addConstraint(recovery.newConstraint);
      }
      await taskRepo.update({ id: task.id }, {
        currentStepIndex: targetIndex,
        currentStepRetryCount: 0,
        commitHistory: task.commitHistory,
        contextSidecar: task.contextSidecar,
      });

      await logTaskEvent(
        task.id,
        "warning",
        `Rewinding to step ${targetIndex + 1} (commit: ${targetCommit || "fresh start"})`,
        { severity: "warning" },
      );
      return true;
    }

    case "ESCALATE":
    default:
      // Escalate to human - stop pipeline
      await taskRepo.update({ id: task.id }, {
        status: "escalated",
        errorMessage: recovery.reason || result.errorMessage || "Step failed and could not recover",
        contextSidecar: task.contextSidecar,
      });

      await logTaskEvent(
        task.id,
        "error",
        `Pipeline escalated: ${recovery.reason || "Max retries exceeded or unrecoverable failure"}`,
        { severity: "error" },
      );
      return false;
  }
}

/**
 * Determine the recovery action for a failed step.
 * Implements the Plan Repair decision logic.
 */
function determineRecoveryAction(
  task: WorkerTask,
  step: PlannedStepV2,
  result: WorkerStepResult,
): RecoveryDecision {
  const totalSteps = task.executionPlanV2?.steps?.length || 0;

  // If worker explicitly requested a rewind
  if (result.status === "NEEDS_REWIND" && result.rewindSuggestion !== undefined) {
    const targetIndex = result.rewindSuggestion;

    // Check if rewind would exceed thresholds
    if (wouldExceedRewindThreshold(task.currentStepIndex, targetIndex, totalSteps)) {
      return {
        action: "ESCALATE",
        reason: `Rewind to step ${targetIndex + 1} would exceed threshold (rewinding ${task.currentStepIndex - targetIndex} steps)`,
      };
    }

    return {
      action: "REWIND",
      targetStepIndex: targetIndex,
      targetCommitHash: task.getCommitForStep(targetIndex - 1),
      newConstraint: result.suggestedConstraints?.[0],
    };
  }

  // Check if we've exceeded max retries for this step
  if (task.currentStepRetryCount >= REWIND_THRESHOLDS.maxRetriesPerStep) {
    // Max retries exceeded - consider rewind or escalate
    if (task.currentStepIndex > 0) {
      // Can we rewind one step?
      const targetIndex = task.currentStepIndex - 1;
      if (!wouldExceedRewindThreshold(task.currentStepIndex, targetIndex, totalSteps)) {
        return {
          action: "REWIND",
          targetStepIndex: targetIndex,
          targetCommitHash: task.getCommitForStep(targetIndex - 1),
          newConstraint: `Step ${step.index + 1} failed ${REWIND_THRESHOLDS.maxRetriesPerStep} times: ${result.errorMessage || "unknown error"}`,
        };
      }
    }

    // Can't rewind - escalate
    return {
      action: "ESCALATE",
      reason: `Step ${step.index + 1} failed ${REWIND_THRESHOLDS.maxRetriesPerStep} times without success`,
    };
  }

  // We have retries remaining - simple retry
  return {
    action: "RETRY_STEP",
  };
}

/**
 * Create a consolidated PR with all commits from the pipeline.
 */
export async function createConsolidatedPR(task: WorkerTask): Promise<void> {
  const taskRepo = getTaskRepo();
  const orgRepo = AppDataSource.getRepository(Organization);

  if (!task.executionPlanV2) {
    throw new Error("Cannot create PR without execution plan");
  }

  // Get org for SCM provider
  const org = await orgRepo.findOne({ where: { id: task.orgId } });
  if (!org) {
    throw new Error(`Organization not found: ${task.orgId}`);
  }

  // Get SCM provider for this org (GitHub, GitLab, or BitBucket)
  const scmProvider = getScmProvider(org);

  const commitCount = task.commitHistory?.length || 0;

  if (commitCount === 0) {
    // No commits means no changes were made
    await taskRepo.update({ id: task.id }, {
      status: "completed",
      completedAt: new Date(),
    });

    await logTaskEvent(
      task.id,
      "status_change",
      "Pipeline completed with no code changes",
    );
    return;
  }

  // Build PR title and body
  const plan = task.executionPlanV2;
  const prTitle = `[WorkerMill V2] ${task.summary}`;

  const stepSummaries = plan.steps
    .map((s, i) => {
      const commit = task.commitHistory?.find((c) => c.stepIndex === i);
      const status = commit ? `[Completed]` : `[Skipped]`;
      return `- ${status} Step ${i + 1}: ${s.title} (${s.persona})`;
    })
    .join("\n");

  const prBody = `## Summary

${plan.architecturalSummary}

## Execution Steps

${stepSummaries}

## Tech Stack

- **Language**: ${plan.techStack.language}
- **Framework**: ${plan.techStack.framework}
${plan.techStack.styling ? `- **Styling**: ${plan.techStack.styling}` : ""}
${plan.techStack.database ? `- **Database**: ${plan.techStack.database}` : ""}

## Commits

${task.commitHistory?.map((c) => `- \`${c.commitHash.slice(0, 7)}\`: Step ${c.stepIndex + 1} (${c.persona})`).join("\n") || "No commits"}

---

_Generated by WorkerMill V2 Pipeline_
_Jira: ${task.jiraIssueKey || "N/A"}_
`;

  // Determine head branch (should be set on task or derived from jira key)
  const headBranch =
    task.githubBranch ||
    `workermill/v2/${task.jiraIssueKey?.toLowerCase() || task.id.slice(0, 8)}`;

  // Create PR using SCM provider
  const repoId = scmProvider.parseRepoIdentifier(task.githubRepo);
  const prResult = await scmProvider.createPullRequest(repoId, {
    title: prTitle,
    body: prBody,
    head: headBranch,
    base: "main",
  });

  if (prResult.success) {
    // Determine final status based on workflow mode
    const finalStatus = task.deploymentEnabled ? "deployed" : "review_requested";

    await taskRepo.update({ id: task.id }, {
      githubPrUrl: prResult.prUrl || null,
      githubPrNumber: prResult.prNumber || null,
      status: finalStatus,
      completedAt: new Date(),
    });
    task.status = finalStatus;

    await logTaskEvent(
      task.id,
      "status_change",
      `PR created: ${prResult.prUrl}`,
      {
        metadata: {
          prUrl: prResult.prUrl,
          prNumber: prResult.prNumber,
        },
      },
    );

    logger.info("V2 Pipeline completed with PR", {
      taskId: task.id,
      prUrl: prResult.prUrl,
      status: task.status,
    });
  } else {
    // PR creation failed - mark as completed but log the issue
    await taskRepo.update({ id: task.id }, {
      status: "completed",
      completedAt: new Date(),
      errorMessage: "PR creation failed - changes committed but no PR",
    });

    await logTaskEvent(
      task.id,
      "warning",
      "Could not create PR - changes are committed but require manual PR creation",
      { severity: "warning" },
    );
  }
}

/**
 * Simple sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Find tasks that are ready for V2 pipeline execution.
 * These are tasks with:
 * - pipelineVersion = 'v2'
 * - status = 'queued' or 'executing' (for resume after crash)
 * - executionPlanV2 is set
 */
export async function findV2PipelineTasks(): Promise<WorkerTask[]> {
  const taskRepo = getTaskRepo();

  // REMOTE AGENT: Skip tasks claimed by agents or from orgs with active agents
  // LOCAL MODE: Also skip tasks from orgs with remote_agent_only = true (no ECS fallback)
  const activeAgentCutoff = new Date(Date.now() - 2 * 60 * 1000);
  const tasks = await taskRepo
    .createQueryBuilder("task")
    .where("task.pipelineVersion = :version", { version: "v2" })
    .andWhere("task.status IN (:...statuses)", { statuses: ["queued"] })
    .andWhere("task.execution_plan_v2 IS NOT NULL")
    .andWhere("task.claimed_by_agent IS NULL")
    .andWhere(
      `task.org_id NOT IN (
        SELECT DISTINCT org_id FROM remote_agents
        WHERE status = 'online' AND last_heartbeat_at > :activeAgentCutoff
      )`,
      { activeAgentCutoff },
    )
    .andWhere(
      `task.org_id NOT IN (
        SELECT id FROM organizations WHERE remote_agent_only = true
      )`,
    )
    .orderBy("task.createdAt", "ASC")
    .take(5)
    .getMany();

  return tasks;
}

/**
 * Resume a V2 pipeline that was interrupted (crash, spot interruption, etc.)
 */
export async function resumeV2Pipeline(taskId: string): Promise<void> {
  const taskRepo = getTaskRepo();
  const task = await taskRepo.findOne({ where: { id: taskId } });

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (!task.isV2Pipeline()) {
    throw new Error(`Task ${taskId} is not a V2 pipeline`);
  }

  logger.info("Resuming V2 pipeline", {
    taskId,
    currentStepIndex: task.currentStepIndex,
    commitHistory: task.commitHistory?.length || 0,
  });

  await logTaskEvent(
    taskId,
    "info",
    `Resuming pipeline from step ${task.currentStepIndex + 1}`,
  );

  // Clear any stale ECS references
  await taskRepo.update({ id: task.id }, {
    ecsTaskArn: null,
    ecsTaskId: null,
    status: "queued",
  });
  task.ecsTaskArn = null;
  task.ecsTaskId = null;
  task.status = "queued";

  // Run the pipeline (it will continue from currentStepIndex)
  await runSequentialPipeline(taskId);
}
