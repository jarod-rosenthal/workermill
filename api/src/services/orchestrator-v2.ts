/**
 * WorkerMill Orchestrator V2 - Epic Workflow Runner
 *
 * This orchestrator handles Epic workflow execution with multi-persona sequential steps.
 * Key differences from V1:
 * - Multi-persona execution: Single container, persona hot-swap per step
 * - Git commit history IS the state machine
 * - Built-in TDD with verification types per step
 * - Plan Repair and Smart Rewind on failure
 * - Simpler status model: planning -> executing -> done/failed
 *
 * EPIC MODE IS NOW THE DEFAULT WORKFLOW.
 * All tasks go through Epic mode unless they have:
 * - `sdk` label → Standard SDK mode (single-task Claude Agent SDK)
 * - `multi-provider` label → Multi-Provider mode (sequential with provider routing)
 *
 * This file is SEPARATE from orchestrator.ts to avoid regression risk.
 * DO NOT merge these orchestrators without explicit user approval.
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
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
import { getReviewerGitHubToken } from "./orchestrator.js";
import {
  claimWarmContainer,
  assignTaskToContainer,
  buildTaskEnvironment,
  maintainPoolSize,
} from "./warm-pool.js";
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
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1") || modelId.includes("codex")) {
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
const secretsClient = new SecretsManagerClient({ region: config.aws.region });
const ecsClient = new ECSClient({ region: config.aws.region });

// Cache for org credentials (5 minute TTL)
const credentialsCache = new Map<
  string,
  { credentials: OrgCredentials; expiresAt: number }
>();

interface OrgCredentials {
  anthropicApiKey: string;
  githubToken: string;
  githubReviewerToken?: string;
  orgApiKey?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  providerApiKey?: string;
  providerId?: ProviderId;
  ollamaBaseUrl?: string;
  ollamaContextWindow?: number;
  vllmBaseUrl?: string;
  // Manager settings for Epic/PRD workflows
  managerProvider?: string;
  managerModelId?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  // Customer AWS cross-account deployment
  customerAwsRoleArn?: string;
  customerAwsExternalId?: string;
  customerAwsRegion?: string;
  // Multi-SCM provider support
  scmProvider?: "github" | "gitlab" | "bitbucket";
  scmBaseUrl?: string;
  scmToken?: string;
  bitbucketUsername?: string;
  bitbucketEmail?: string; // Required for Bitbucket API calls with API tokens (email:token Basic auth)
}

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
 * Get credentials for an organization from Secrets Manager
 *
 * SECURITY: All credentials are org-specific. NO global/platform fallbacks.
 * Each tenant must configure their own API keys in Settings.
 */
async function getOrgCredentials(orgId: string): Promise<OrgCredentials> {
  const now = Date.now();
  const cached = credentialsCache.get(orgId);

  if (cached && cached.expiresAt > now) {
    return cached.credentials;
  }

  try {
    // Get org for API key and settings
    const orgRepo = getOrgRepo();
    const org = await orgRepo.findOne({ where: { id: orgId } });
    if (!org) {
      throw new Error(`Organization not found: ${orgId}`);
    }

    const env = config.environment;
    const basePath = `workermill/${env}/orgs/${orgId}`;

    /**
     * Helper to fetch org-specific integration secrets
     * Tries both integrations/ path and root path (legacy)
     * NO platform fallback - returns null if not configured for this org
     */
    const getOrgIntegrationSecret = async (secretName: string): Promise<string | null> => {
      // Try integrations/ path first (new structure)
      try {
        const secret = await secretsClient.send(
          new GetSecretValueCommand({ SecretId: `${basePath}/integrations/${secretName}` }),
        );
        if (secret.SecretString) return secret.SecretString;
      } catch {
        // Not found in integrations/
      }

      // Try root path (legacy structure)
      try {
        const secret = await secretsClient.send(
          new GetSecretValueCommand({ SecretId: `${basePath}/${secretName}` }),
        );
        if (secret.SecretString) return secret.SecretString;
      } catch {
        // Not found at root either
      }

      return null; // Not configured for this org - NO platform fallback
    };

    // Fetch org-specific secrets (NO platform fallback for multi-tenancy security)
    const [githubToken, jiraSecretString, anthropicKey] = await Promise.all([
      getOrgIntegrationSecret("github-token"),
      getOrgIntegrationSecret("jira-credentials"),
      getProviderCredentials(orgId, "anthropic").catch(() => null),
    ]);

    // GitHub token is REQUIRED for all workers (also used as fallback for GitHub SCM)
    if (!githubToken) {
      throw new Error(
        `GitHub token not configured for organization '${org.name}'. ` +
          `Please configure at Settings > Integrations > GitHub before running workers.`,
      );
    }

    // Get SCM provider token based on org settings (NO cross-provider fallback)
    let scmToken = githubToken; // Default to GitHub token
    let bitbucketUsername: string | undefined;
    let bitbucketEmail: string | undefined;

    if (org.scmProvider && org.scmProvider !== "github") {
      // Non-GitHub SCM providers require their own token - no fallback to GitHub
      const scmSecretString = await getOrgIntegrationSecret(`${org.scmProvider}-token`);

      if (!scmSecretString) {
        throw new Error(
          `${org.scmProvider} token not configured for organization '${org.name}'. ` +
            `Please configure at Settings > Integrations > ${org.scmProvider} before running workers.`,
        );
      }

      if (org.scmProvider === "bitbucket") {
        // BitBucket credentials - supports both new API token and legacy app password formats
        // New format (2025+): { email, api_token } - git uses x-bitbucket-api-token-auth as username
        //   - Git clone: https://x-bitbucket-api-token-auth:<token>@bitbucket.org/...
        //   - API calls: Basic auth with email:token (NOT x-bitbucket-api-token-auth:token!)
        // Legacy format: { username, app_password }
        //   - Both git and API use username:app_password
        try {
          const bbCreds = JSON.parse(scmSecretString);

          // New API token format
          if (bbCreds.api_token) {
            bitbucketUsername = "x-bitbucket-api-token-auth";
            bitbucketEmail = bbCreds.email; // CRITICAL: Required for API calls
            scmToken = bbCreds.api_token;
          }
          // Legacy app password format
          else if (bbCreds.username && bbCreds.app_password) {
            bitbucketUsername = bbCreds.username;
            scmToken = bbCreds.app_password;
          }
          // Fallback
          else if (bbCreds.token) {
            bitbucketUsername = "x-bitbucket-api-token-auth";
            bitbucketEmail = bbCreds.email;
            scmToken = bbCreds.token;
          }

          if (!scmToken) {
            throw new Error("BitBucket credentials missing api_token or app_password");
          }
        } catch (parseError) {
          throw new Error(
            `Invalid BitBucket credentials format for organization '${org.name}'. ` +
              `Expected JSON with 'email' and 'api_token' (new) or 'username' and 'app_password' (legacy).`,
          );
        }
      } else {
        scmToken = scmSecretString;
      }
    }

    // Parse Jira credentials JSON (optional - not all orgs use Jira)
    let jiraCredentials: {
      domain?: string;
      base_url?: string;
      email?: string;
      api_token?: string;
    } = {};
    if (jiraSecretString) {
      try {
        jiraCredentials = JSON.parse(jiraSecretString);
      } catch {
        logger.warn("Failed to parse Jira credentials JSON", { orgId });
      }
    }

    // Handle both 'base_url' (full URL) and 'domain' (just domain) formats
    let jiraBaseUrl: string | undefined;
    if (jiraCredentials.base_url) {
      jiraBaseUrl = jiraCredentials.base_url;
    } else if (jiraCredentials.domain) {
      jiraBaseUrl = `https://${jiraCredentials.domain}`;
    }

    const credentials: OrgCredentials = {
      anthropicApiKey: anthropicKey || "",
      githubToken,
      orgApiKey: org.apiKey || undefined,
      jiraBaseUrl,
      jiraEmail: jiraCredentials.email,
      jiraApiToken: jiraCredentials.api_token,
      ollamaBaseUrl: org.ollamaBaseUrl || undefined,
      ollamaContextWindow: org.ollamaContextWindow || 65536,
      vllmBaseUrl: org.vllmBaseUrl || undefined,
      // Manager provider and model for Epic/PRD workflows
      managerProvider: org.managerProvider || "openai",
      managerModelId: org.managerModelId || undefined,
      // Multi-SCM provider support
      scmProvider: org.scmProvider || "github",
      scmBaseUrl: org.scmBaseUrl || undefined,
      scmToken,
      bitbucketUsername,
      bitbucketEmail,
    };

    // Fetch manager provider API keys (for Epic inline reviewer)
    // These are needed when the manager uses non-Anthropic providers
    try {
      credentials.googleApiKey = await getProviderCredentials(orgId, "google");
    } catch {
      // Google key is optional - only needed if org uses Google for manager
    }
    try {
      credentials.openaiApiKey = await getProviderCredentials(orgId, "openai");
    } catch {
      // OpenAI key is optional - only needed if org uses OpenAI for manager
    }

    // Try to fetch customer AWS role configuration
    try {
      const awsRoleSecret = await secretsClient.send(
        new GetSecretValueCommand({
          SecretId: `workermill/${config.environment}/orgs/${orgId}/aws-role-config`,
        }),
      );
      if (awsRoleSecret.SecretString) {
        const awsRoleConfig = JSON.parse(awsRoleSecret.SecretString);
        if (awsRoleConfig.roleArn) {
          credentials.customerAwsRoleArn = awsRoleConfig.roleArn;
          credentials.customerAwsExternalId = awsRoleConfig.externalId;
          credentials.customerAwsRegion = awsRoleConfig.region || "us-east-1";
        }
      }
    } catch {
      // AWS role not configured - this is optional
      logger.debug("No customer AWS role configured for org", { orgId });
    }

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
 * Invalidate cached credentials for an organization.
 * Called when org settings change to ensure fresh credentials are fetched.
 */
export function invalidateOrgCredentialsCacheV2(orgId: string): void {
  credentialsCache.delete(orgId);
  logger.debug("Invalidated V2 credentials cache for org", { orgId });
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

  let publishedCount = 0;

  for (const step of plan.steps) {
    // Check if story has dependencies (stories that must complete first)
    // Note: dependsOn is an optional extension to PlannedStepV2 for Epic mode
    const stepWithDeps = step as PlannedStepV2 & { dependsOn?: number[] };
    const dependencies = stepWithDeps.dependsOn || [];

    // Only publish stories with no dependencies initially
    // Stories with dependencies will be published when their dependencies complete
    if (dependencies.length > 0) {
      logger.info("Skipping story with dependencies", {
        taskId: task.id,
        storyIndex: step.index,
        title: step.title,
        dependencies,
      });
      continue;
    }

    // Create story_ready context message
    const contextData = {
      parentTaskId: task.id,
      taskId: null, // No worker assigned yet
      orgId: task.orgId,
      persona: step.persona,
      messageType: "story_ready" as const,
      content: `Story ${step.index + 1}: ${step.title}`,
      metadata: {
        storyIndex: step.index,
        persona: step.persona,
        title: step.title,
        description: step.description,
        targetFiles: step.targetFiles,
        referenceFiles: step.referenceFiles,
        verificationType: step.verificationType,
        dependencies: dependencies,
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

  // Check for phased execution label
  const labels = (task.jiraFields as Record<string, unknown>)?.labels;
  const isPhasedMode = Array.isArray(labels) && labels.some(
    (l: string) => l.toLowerCase() === "phased"
  );
  if (isPhasedMode) {
    additionalEnv.PHASED_MODE = "true";
    logger.info("Phased execution enabled for Epic task", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
    });
  }

  // Track all providers used for dashboard visibility
  // Epic mode always uses Anthropic for workers, but planning and review may use different providers
  const org = await orgRepo.findOne({ where: { id: task.orgId } });
  const allProviders = new Set<string>();

  // Planning agent provider
  const planningModel = org?.planningAgentModel || "claude-sonnet-4-5-20250929";
  const planningProvider = inferProviderFromModel(planningModel);
  if (planningProvider) allProviders.add(planningProvider);

  // Epic workers always use Anthropic (Claude Agent SDK)
  allProviders.add("anthropic");

  // Manager/reviewer provider
  const managerProvider = org?.managerProvider || "openai";
  allProviders.add(managerProvider);

  task.providersUsed = Array.from(allProviders);

  logger.info("Epic task provider tracking", {
    taskId: task.id,
    planningProvider,
    workerProvider: "anthropic",
    managerProvider,
    allProviders: task.providersUsed,
  });

  // Update task status
  task.status = "environment_setup";
  await taskRepo.save(task);

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
    task.ecsTaskArn = warmContainer.ecsTaskArn;
    task.ecsTaskId = warmContainer.ecsTaskId;
    task.status = "executing";
    task.startedAt = new Date();
    await taskRepo.save(task);

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
    task.ecsTaskArn = result.taskArn;
    task.ecsTaskId = result.taskId;
    task.status = "executing";
    task.startedAt = new Date();
    await taskRepo.save(task);

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

    task.status = "failed";
    task.errorMessage = `Failed to spawn Epic container: ${error instanceof Error ? error.message : String(error)}`;
    await taskRepo.save(task);

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
    const planningModel = org?.planningAgentModel || "claude-sonnet-4-5-20250929";
    const planningProvider = inferProviderFromModel(planningModel);
    if (planningProvider) allProviders.add(planningProvider);

    // Add manager/reviewer provider
    const managerProvider = org?.managerProvider || "openai";
    allProviders.add(managerProvider);

    // Store all providers used for dashboard visibility
    task.providersUsed = Array.from(allProviders);
  } else {
    // Even without explicit provider routing, track all agents' providers
    const allProviders = new Set<string>();

    // Planning agent provider
    const planningModel = org?.planningAgentModel || "claude-sonnet-4-5-20250929";
    const planningProvider = inferProviderFromModel(planningModel);
    if (planningProvider) allProviders.add(planningProvider);

    // Default worker provider (from org settings)
    const defaultWorkerProvider = org?.primaryProvider || "anthropic";
    allProviders.add(defaultWorkerProvider);

    // Manager/reviewer provider
    const managerProvider = org?.managerProvider || "openai";
    allProviders.add(managerProvider);

    task.providersUsed = Array.from(allProviders);
  }

  // Update task status
  task.status = "environment_setup";
  await taskRepo.save(task);

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
    task.ecsTaskArn = warmContainer.ecsTaskArn;
    task.ecsTaskId = warmContainer.ecsTaskId;
    task.status = "executing";
    task.startedAt = new Date();
    await taskRepo.save(task);

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
    task.ecsTaskArn = result.taskArn;
    task.ecsTaskId = result.taskId;
    task.status = "executing";
    task.startedAt = new Date();
    await taskRepo.save(task);

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

    task.status = "failed";
    task.errorMessage = `Failed to spawn multi-expert container: ${error instanceof Error ? error.message : String(error)}`;
    await taskRepo.save(task);

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
  task.status = "environment_setup";
  task.currentSubtaskIndex = 0;
  task.subtaskResults = [];
  await taskRepo.save(task);

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
    task.ecsTaskArn = result.taskArn;
    task.ecsTaskId = result.taskId;
    task.status = "executing";
    task.startedAt = new Date();
    await taskRepo.save(task);

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

    task.status = "failed";
    task.errorMessage = `Failed to spawn multi-persona container: ${error instanceof Error ? error.message : String(error)}`;
    await taskRepo.save(task);

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
  const task = await taskRepo.findOne({ where: { id: taskId } });

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
  if ((task.executionMode === "parallel" || task.executionMode === "multi-expert") &&
      task.githubRepo && !task.githubBranch) {
    const featureBranch = `feature/${task.jiraIssueKey || task.id.slice(0, 8)}`;

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
          task.scmProvider = scmProviderToUse;
          await taskRepo.save(task);
        }

        const repoId = scmProvider.parseRepoIdentifier(repoToUse);
        const branchCreated = await scmProvider.createBranch(repoId, featureBranch, "main");

        if (branchCreated) {
          task.githubBranch = featureBranch;
          await taskRepo.save(task);

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
    await taskRepo.save(task);

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
  task.status = "executing";
  await taskRepo.save(task);

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
    task.currentStepRetryCount = 0;
    await taskRepo.save(task);

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
      task.currentStepIndex = stepIndex + 1;
      await taskRepo.save(task);

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
  task.status = "environment_setup";
  // Update persona to match the step's persona
  task.workerPersona = step.persona;
  await taskRepo.save(task);

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
    task.ecsTaskArn = result.taskArn;
    task.ecsTaskId = result.taskId;
    task.status = "executing";
    task.startedAt = new Date();
    await taskRepo.save(task);

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

  // Add to commit history
  if (!task.commitHistory) {
    task.commitHistory = [];
  }
  task.commitHistory.push(commit);

  await taskRepo.save(task);

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
      // Simple retry - increment retry count and continue
      task.currentStepRetryCount += 1;
      await taskRepo.save(task);

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
      await taskRepo.save(task);

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
      await taskRepo.save(task);

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
      task.status = "escalated";
      task.errorMessage = recovery.reason || result.errorMessage || "Step failed and could not recover";
      await taskRepo.save(task);

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
    task.status = "completed";
    task.completedAt = new Date();
    await taskRepo.save(task);

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

  const prBody = `***REMOVED******REMOVED*** Summary

${plan.architecturalSummary}

***REMOVED******REMOVED*** Execution Steps

${stepSummaries}

***REMOVED******REMOVED*** Tech Stack

- **Language**: ${plan.techStack.language}
- **Framework**: ${plan.techStack.framework}
${plan.techStack.styling ? `- **Styling**: ${plan.techStack.styling}` : ""}
${plan.techStack.database ? `- **Database**: ${plan.techStack.database}` : ""}

***REMOVED******REMOVED*** Commits

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
    task.githubPrUrl = prResult.prUrl || null;
    task.githubPrNumber = prResult.prNumber || null;

    // Determine final status based on workflow mode
    if (task.deploymentEnabled) {
      // Auto-deploy: mark as deployed (worker will have merged and deployed)
      task.status = "deployed";
    } else {
      // Standard: wait for review
      task.status = "review_requested";
    }

    task.completedAt = new Date();
    await taskRepo.save(task);

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
    task.status = "completed";
    task.completedAt = new Date();
    task.errorMessage = "PR creation failed - changes committed but no PR";
    await taskRepo.save(task);

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

  const tasks = await taskRepo
    .createQueryBuilder("task")
    .where("task.pipelineVersion = :version", { version: "v2" })
    .andWhere("task.status IN (:...statuses)", { statuses: ["queued"] })
    .andWhere("task.execution_plan_v2 IS NOT NULL")
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
  task.ecsTaskArn = null;
  task.ecsTaskId = null;
  task.status = "queued";
  await taskRepo.save(task);

  // Run the pipeline (it will continue from currentStepIndex)
  await runSequentialPipeline(taskId);
}
