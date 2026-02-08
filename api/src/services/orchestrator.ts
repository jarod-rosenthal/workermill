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
  WorkerCheckIn,
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
import { executeSupportAgentTask } from "./support-agent-executor.js";
import { localEpicSpawner } from "./local-epic-spawner.js";
// DEPRECATED: These imports are only used by the deprecated processLocalPlanningAgent() function below.
// They are kept for rollback safety. To restore the local-only path, un-comment the call in
// processV2PipelinePlanning() and these imports become active again.
import { runLocalPlanningAgent } from "./planning-agent-local.js";
import { planningProgressEmitter, type PlanningProgressEvent } from "./planning-progress-events.js";
import { runLocalCriticAgent, shouldUseLocalCritic } from "./critic-agent-local.js";
// Unified path imports (llm-backend auto-detects ClaudeCliBackend vs AiSdkBackend)
import { isClaudeCliMode, ensureValidOAuthToken } from "./llm-backend.js";
import { canCreateTask, incrementTaskUsage } from "./billing.js";
import { canStartTaskWithinBudget } from "./budget-enforcement.js";
import { getCostTracker } from "./cost-tracker.js";
import { costEvents } from "./cost-events.js";
import { updateDirectiveOutcome } from "./directive-tracker.js";
import {
  notifyTaskCompleted,
  notifyTaskFailed,
  notifyCostAlert,
} from "./notifications.js";
import { runPlanningAgent, runPlanningAgentV2, runPlanningAgentV3, replanWithFeedback, shouldUseV2Planning, shouldUseV3Planning, TechStack } from "./planning-agent.js";
import { generateValidatedPlan, generatePlan, PlanValidationError, PlanProgressCallback, PlanningAgentConfig } from "./critic-agent.js";
import type { ExecutionPlanV2 } from "./pipeline-v2-types.js";
import { findV2PipelineTasks, runSequentialPipeline, publishStoriesReady } from "./orchestrator-v2.js";
import {
  postJiraComment,
  createJiraSubtask,
  createJiraStory,
  convertToEpic,
  transitionJiraIssue,
} from "../utils/jira.js";
import { getScmProvider } from "../scm-providers/index.js";
import { validateQualityGates } from "./quality-gates.js";
import {
  claimWarmContainer,
  assignTaskToContainer,
  buildTaskEnvironment,
  maintainAllWarmPools,
} from "./warm-pool.js";
import { expireOldReferrals } from "./referral.js";
import type { WorkerTaskStatus } from "../models/WorkerTask.js";

// =============================================================================
// Task State Machine
// =============================================================================

/**
 * Valid state transitions for worker tasks.
 * Key: current status, Value: array of valid next statuses
 *
 * This is used for logging invalid transitions, not blocking them (yet).
 * Once we're confident the state machine is correct, we can make it blocking.
 */
const VALID_TRANSITIONS: Record<WorkerTaskStatus, WorkerTaskStatus[]> = {
  // Planning states
  planning: ["pending_plan_approval", "queued", "failed", "cancelled"],
  pending_plan_approval: ["queued", "planning", "failed", "cancelled"], // Can re-plan

  // Execution states
  queued: ["dispatching", "claimed", "blocked", "failed", "cancelled"],
  dispatching: ["environment_setup", "executing", "failed", "cancelled"],
  claimed: ["environment_setup", "executing", "failed", "cancelled"],
  environment_setup: ["executing", "failed", "cancelled"],
  executing: [
    "pr_created", "review_requested", "deploying", "completed",
    "escalated", "failed", "cancelled", "manager_review"
  ],
  deploying: ["deployed", "completed", "failed", "cancelled"],

  // Waiting states
  blocked: ["queued", "executing", "failed", "cancelled"],
  pr_created: ["review_requested", "pr_approved", "manager_review", "queued", "failed", "cancelled"],
  review_requested: ["pr_approved", "queued", "failed", "cancelled"],
  manager_review: ["review_approved", "revision_needed", "review_rejected", "failed", "cancelled"],
  revision_needed: ["queued", "executing", "failed", "cancelled"],
  pr_approved: ["queued", "deploying", "deployed", "completed", "failed", "cancelled"],
  review_approved: ["queued", "deploying", "deployed", "completed", "failed", "cancelled"],
  escalated: ["queued", "failed", "cancelled", "completed"],

  // Terminal states (no valid transitions out)
  completed: [],
  deployed: [],
  failed: ["queued"], // Allow retry
  cancelled: [],
  review_rejected: [],
};

/**
 * Validate and log a task status transition.
 * Currently only logs invalid transitions without blocking.
 *
 * @param task - The task being updated
 * @param newStatus - The proposed new status
 * @returns true (always allows transition, logs if invalid)
 */
export function validateStatusTransition(
  task: WorkerTask,
  newStatus: WorkerTaskStatus
): boolean {
  const currentStatus = task.status as WorkerTaskStatus;
  const validNextStatuses = VALID_TRANSITIONS[currentStatus] || [];

  if (!validNextStatuses.includes(newStatus) && currentStatus !== newStatus) {
    logger.warn("Invalid status transition detected", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      currentStatus,
      newStatus,
      validTransitions: validNextStatuses,
    });
    // TODO: Once we're confident the state machine is complete,
    // return false here to block invalid transitions
  }

  return true;
}

// =============================================================================
// Planning Agent Visibility
// =============================================================================

/**
 * Provider icons for log visibility (consistent with worker/epic/executor.ts)
 */
const PROVIDER_ICONS: Record<string, string> = {
  anthropic: "🤖",
  openai: "🔷",
  google: "🔵",
  gemini: "🔵",
  ollama: "🏠",
};

/**
 * Get formatted log prefix for planning agent output.
 * Format: [🗺️ planning_agent 🔷] for planning + provider visibility
 */
function getPlanningAgentPrefix(provider: string): string {
  const providerIcon = PROVIDER_ICONS[provider] || "🤖";
  return `[🗺️ planning_agent ${providerIcon}]`;
}

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
  githubToken?: string; // Optional - only required for GitHub SCM provider
  githubReviewerToken?: string; // Separate token for PR reviews (avoids self-approval)
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
  maxReviewRevisions?: number;
  openaiApiKey?: string;
  googleApiKey?: string;
  // Customer AWS cross-account deployment
  customerAwsRoleArn?: string;
  customerAwsExternalId?: string;
  customerAwsRegion?: string;
  // Multi-SCM provider support
  scmProvider?: "github" | "gitlab" | "bitbucket";
  scmBaseUrl?: string; // For self-hosted instances (e.g., gitlab.company.com)
  scmToken?: string; // The SCM access token (GitHub/GitLab/BitBucket)
  bitbucketUsername?: string; // BitBucket requires username:app_password format
  bitbucketEmail?: string; // BitBucket API calls with API tokens require email:token auth
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

// Cache for reviewer GitHub tokens per org (separate from worker token for PR approvals)
const reviewerTokenCache = new Map<
  string,
  { token: string; expiresAt: number }
>();

/**
 * Get the GitHub reviewer token (separate account for PR approvals)
 * This allows the Virtual Manager/Tech Lead to approve PRs created by workers.
 *
 * Priority:
 * 1. Org-specific github-reviewer-token (from Settings → GitHub)
 * 2. Platform-wide github-reviewer-token
 * 3. Legacy manager-github-token (backward compatibility)
 */
export async function getReviewerGitHubToken(orgId: string): Promise<string> {
  const now = Date.now();
  const cached = reviewerTokenCache.get(orgId);

  if (cached && cached.expiresAt > now) {
    return cached.token;
  }

  const secretPrefix = `workermill/${config.environment}`;

  // Only use org-specific github-reviewer-token (no platform fallback for multi-tenancy)
  try {
    const orgSecret = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: `${secretPrefix}/orgs/${orgId}/github-reviewer-token`,
      }),
    );
    if (orgSecret.SecretString) {
      reviewerTokenCache.set(orgId, {
        token: orgSecret.SecretString,
        expiresAt: now + 5 * 60 * 1000,
      });
      return orgSecret.SecretString;
    }
  } catch {
    // Not found at org level - no fallback to platform secrets for security
  }

  logger.warn("No GitHub reviewer token configured for org", { orgId });
  return ""; // Will fall back to worker token (may fail due to self-approval)
}

// Backward compatibility alias
async function getManagerGitHubToken(): Promise<string> {
  // For backward compatibility with manager tasks that don't have orgId context
  // This fetches the legacy manager-github-token directly
  try {
    const secret = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: `workermill/${config.environment}/manager-github-token`,
      }),
    );
    return secret.SecretString || "";
  } catch {
    return "";
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

    // Helper to fetch org-specific secret (checks integrations/ then root path, NEVER platform)
    const getOrgIntegrationSecret = async (secretName: string): Promise<string | null> => {
      const basePath = `workermill/${config.environment}/orgs/${orgId}`;

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
    const [jiraSecretString, anthropicKey] = await Promise.all([
      getOrgIntegrationSecret("jira-credentials"),
      getProviderCredentials(orgId, "anthropic").catch(() => null),
    ]);

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

    // Fetch OpenAI API key (org-specific only, no platform fallback)
    let openaiApiKey: string | undefined;
    try {
      openaiApiKey = await getProviderCredentials(orgId, "openai");
    } catch {
      // OpenAI key is optional - only needed if org uses OpenAI for manager
      logger.debug("OpenAI API key not configured for org", { orgId });
    }

    // Fetch Google API key (org-specific only, no platform fallback)
    let googleApiKey: string | undefined;
    try {
      googleApiKey = await getProviderCredentials(orgId, "google");
    } catch {
      // Google key is optional - only needed if org uses Google for manager
      logger.debug("Google API key not configured for org", { orgId });
    }

    // Get SCM provider token based on org settings (NO cross-provider fallback)
    let scmToken: string | null = null;
    let bitbucketUsername: string | undefined;
    let bitbucketEmail: string | undefined;
    const scmProvider = org.scmProvider || "github";

    if (scmProvider !== "github") {
      // Non-GitHub SCM providers require their own token - no fallback to GitHub
      const scmSecretString = await getOrgIntegrationSecret(`${scmProvider}-token`);

      if (!scmSecretString) {
        throw new Error(
          `${scmProvider} token not configured for organization '${org.name}'. ` +
            `Please configure at Settings > Integrations > ${scmProvider} before running workers.`,
        );
      }

      if (scmProvider === "bitbucket") {
        // BitBucket credentials - supports both new API token and legacy app password formats
        // New format (2025+): { email, api_token } - git uses x-bitbucket-api-token-auth as username
        // Legacy format: { username, app_password }
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
            // Detect if app_password is actually an Atlassian API token (starts with ATATT)
            // API tokens require x-bitbucket-api-token-auth as username for git
            // AND email:token Basic auth for API calls
            if (bbCreds.app_password.startsWith("ATATT")) {
              bitbucketUsername = "x-bitbucket-api-token-auth";
              // ATATT tokens require email for API calls - use email if provided, otherwise use username (email)
              bitbucketEmail = bbCreds.email || bbCreds.username;
            } else {
              bitbucketUsername = bbCreds.username;
            }
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
    } else {
      // GitHub SCM provider - fetch GitHub token
      const githubToken = await getOrgIntegrationSecret("github-token");
      if (!githubToken) {
        throw new Error(
          `GitHub token not configured for organization '${org.name}'. ` +
            `Please configure at Settings > Integrations > GitHub before running workers.`,
        );
      }
      scmToken = githubToken;
    }

    const credentials: OrgCredentials = {
      anthropicApiKey: anthropicKey || "", // May be empty if org uses different provider
      githubToken: scmProvider === "github" ? scmToken || undefined : undefined,
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
      maxReviewRevisions: org.maxReviewRevisions ?? 3,
      openaiApiKey,
      googleApiKey,
      // Multi-SCM provider support
      scmProvider: org.scmProvider || "github",
      scmBaseUrl: org.scmBaseUrl || undefined,
      scmToken,
      bitbucketUsername,
      bitbucketEmail,
    };

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
 * Find queued tasks that can be executed
 * Respects:
 * - System enabled: skip all tasks when system is in maintenance mode
 * - Persona concurrency: only 1 active task per persona per org
 * - Task cooldown: skip tasks whose Jira ticket had a recent attempt (within org.taskCooldownSeconds)
 * - Max concurrent workers: limit active tasks per org to org.maxConcurrentWorkers
 * - Per-repo concurrency: limit active workers per repo via coordination service check-ins
 */
async function findQueuedTasks(): Promise<WorkerTask[]> {
  const taskRepo = getTaskRepo();
  const orgRepo = getOrgRepo();

  // Get all queued tasks (exclude tasks claimed by a remote agent — those run locally)
  // REMOTE AGENT: Also skip tasks from orgs with active remote agents (heartbeat within 2 min).
  // This prevents the cloud orchestrator from racing the agent to claim queued tasks.
  const activeAgentCutoff = new Date(Date.now() - 2 * 60 * 1000);
  const queuedTasks = await taskRepo
    .createQueryBuilder("task")
    .where("task.status = :status", { status: "queued" })
    .andWhere("task.claimed_by_agent IS NULL")
    .andWhere(
      `task.org_id NOT IN (
        SELECT DISTINCT org_id FROM remote_agents
        WHERE status = 'online' AND last_heartbeat_at > :activeAgentCutoff
      )`,
      { activeAgentCutoff },
    )
    .orderBy("task.createdAt", "ASC")
    .take(10)
    .getMany();

  if (queuedTasks.length === 0) {
    return [];
  }

  // Get unique org IDs from queued tasks to check systemEnabled
  const orgIds = [...new Set(queuedTasks.map((t) => t.orgId))];
  const orgsForCheck = await orgRepo.find({
    where: { id: In(orgIds) },
    select: ["id", "systemEnabled"],
  });

  // Build set of orgs with system disabled (maintenance mode)
  const maintenanceOrgs = new Set<string>();
  for (const org of orgsForCheck) {
    if (!org.systemEnabled) {
      maintenanceOrgs.add(org.id);
      logger.debug("Organization in maintenance mode - skipping tasks", {
        orgId: org.id,
      });
    }
  }

  // Filter out tasks from orgs in maintenance mode early
  const nonMaintenanceTasks = queuedTasks.filter(
    (task) => !maintenanceOrgs.has(task.orgId)
  );

  if (nonMaintenanceTasks.length === 0) {
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

  // Fetch org settings for cooldown and maxConcurrentWorkers
  // Note: orgIds was already computed above for the maintenance check
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
  const jiraIssueKeys = [...new Set(nonMaintenanceTasks.map((t) => t.jiraIssueKey))];
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
  // LOCAL MODE: Skip quota checks - using user's Claude Max subscription
  const quotaEligibleOrgs = new Set<string>();
  const quotaBlockedOrgs = new Set<string>();
  const isLocalMode = process.env.EXECUTION_MODE === "local";

  for (const orgId of orgIds) {
    const org = orgSettings.get(orgId);
    if (!org) continue;

    // Skip quota check in local mode
    if (isLocalMode) {
      quotaEligibleOrgs.add(orgId);
      continue;
    }

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

  // Check budget limits for each org (AI FinOps)
  // LOCAL MODE: Skip budget checks - using user's Claude Max subscription
  const budgetBlockedOrgs = new Set<string>();

  for (const orgId of orgIds) {
    const org = orgSettings.get(orgId);
    if (!org) continue;

    // Skip budget check in local mode
    if (isLocalMode) {
      continue;
    }

    const withinBudget = await canStartTaskWithinBudget(org);
    if (!withinBudget) {
      budgetBlockedOrgs.add(orgId);
      logger.warn("Organization blocked by budget limit - tasks will remain queued", {
        orgId,
        orgName: org.name,
      });
    }
  }

  // Filter to tasks that can be executed
  // Note: already filtered out tasks from orgs in maintenance mode above
  const eligibleTasks = nonMaintenanceTasks.filter((task) => {
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

    // Check budget limits (AI FinOps)
    if (budgetBlockedOrgs.has(task.orgId)) {
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
  // Load organization relation to access org settings (e.g., storyCalibrationMultiplier)
  //
  // REMOTE AGENT: Skip tasks from orgs with active remote agents (heartbeat within 2 min).
  // This prevents the cloud orchestrator from racing the agent to plan tasks.
  const activeAgentCutoff = new Date(Date.now() - 2 * 60 * 1000);
  const planningTasks = await taskRepo
    .createQueryBuilder("task")
    .leftJoinAndSelect("task.organization", "organization")
    .where("task.status = :status", { status: "planning" })
    .andWhere(
      "(task.planStatus IS NULL OR task.planStatus = :changesRequested)",
      {
        changesRequested: "changes_requested",
      },
    )
    .andWhere("task.claimed_by_agent IS NULL")
    .andWhere(
      `task.org_id NOT IN (
        SELECT DISTINCT org_id FROM remote_agents
        WHERE status = 'online' AND last_heartbeat_at > :activeAgentCutoff
      )`,
      { activeAgentCutoff },
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
      "id = :id AND status = :status AND (plan_status IS NULL OR plan_status = :changesRequested) AND claimed_by_agent IS NULL",
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
 * Process V2 Pipeline planning
 *
 * Uses the Planner-Critic loop from critic-agent.ts to generate a validated
 * ExecutionPlanV2 with sequential steps.
 *
 * After successful planning:
 * - executionPlanV2 is populated
 * - Status transitions to "queued" for sequential execution
 *
 * Labels:
 * - 'skip-planner': Bypass Planner-Critic loop, create minimal plan for direct execution
 */
async function processV2PipelinePlanning(task: WorkerTask): Promise<void> {
  const taskRepo = getTaskRepo();

  // Check for skip-planner label to bypass Planner-Critic
  const labels = (task.jiraFields as Record<string, unknown>)?.labels;
  const skipPlanner = Array.isArray(labels) && labels.includes("skip-planner");

  logger.info("Starting V2 pipeline planning", {
    taskId: task.id,
    jiraIssueKey: task.jiraIssueKey,
    skipPlanner,
  });

  // RESUME LOGIC: Skip planning if this is a retry/resume with existing plan
  // This preserves the execution plan when resuming failed Epic tasks
  const hasExistingPlan = task.planJson && (
    (task.planJson as { stories?: unknown[] }).stories?.length ||
    (task.planJson as { steps?: unknown[] }).steps?.length
  );
  const isRetryOrResume = (task.retryCount || 0) > 0;

  if (isRetryOrResume && hasExistingPlan) {
    logger.info("Skipping planning for retry/resume - using existing plan", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      retryCount: task.retryCount,
      storyCount: (task.planJson as { stories?: unknown[] }).stories?.length ||
                  (task.planJson as { steps?: unknown[] }).steps?.length,
    });

    await logTaskEvent(
      task.id,
      "status_change",
      `[🗺️ planning_agent 🤖] Resuming with existing plan (retry #${task.retryCount}) - skipping re-planning`
    );

    // Restore executionPlanV2 from planJson if needed — but ONLY if it's V2 format (has steps)
    // Epic-mode plans have "stories" not "steps" and should go through dispatchMultiStoryPlan instead
    if (!task.executionPlanV2 && task.planJson) {
      const plan = task.planJson as { steps?: unknown[]; stories?: unknown[] };
      if (plan.steps?.length) {
        task.executionPlanV2 = task.planJson as unknown as import("./pipeline-v2-types.js").ExecutionPlanV2;
      }
      // If plan has stories (Epic mode), leave executionPlanV2 null so it routes through dispatchMultiStoryPlan
    }

    // Transition directly to queued
    task.status = "queued";
    task.planStatus = "approved";
    await taskRepo.save(task);
    return;
  }

  // REMOTE AGENT: Atomic check — bail if a remote agent claimed this task since we loaded it.
  // Uses UPDATE with WHERE to close the race window between re-fetch and proceeding.
  const agentCheck = await taskRepo
    .createQueryBuilder()
    .update(WorkerTask)
    .set({ planningNotes: "cloud_planning_lock" })
    .where("id = :id AND status = :status AND claimed_by_agent IS NULL", {
      id: task.id,
      status: "planning",
    })
    .execute();
  if ((agentCheck.affected || 0) === 0) {
    logger.info(
      "Aborting cloud planning - task claimed by remote agent or status changed",
      { taskId: task.id },
    );
    return;
  }

  // LOCAL MODE: Fail fast if OAuth token is missing (Claude CLI needs it)
  // ROLLBACK: To restore the deprecated local-only path, uncomment the imports
  // at the top of this file and restore: `await processLocalPlanningAgent(task, taskRepo); return;`
  const isLocalMode = isClaudeCliMode();
  if (isLocalMode) {
    const hasOAuthToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
    logger.info("Local mode detected — using unified path with ClaudeCliBackend", {
      taskId: task.id,
      executionMode: process.env.EXECUTION_MODE,
      hasOAuthToken,
    });

    if (!hasOAuthToken) {
      logger.error("OAuth token required for local execution mode", { taskId: task.id });
      task.status = "failed";
      task.errorMessage = "OAuth token not configured. Run 'claude auth login' and restart the API.";
      await taskRepo.save(task);
      return;
    }
  }

  if (skipPlanner) {
    // Build config from organization settings
    const agentConfig: PlanningAgentConfig = {
      provider: (task.organization?.planningAgentProvider || "anthropic") as "anthropic" | "openai" | "google" | "ollama",
      model: task.organization?.planningAgentModel || "claude-sonnet-4-5-20250929",
      orgId: task.orgId,
      ollamaBaseUrl: task.organization?.ollamaBaseUrl || undefined,
    };

    const prefix = getPlanningAgentPrefix(agentConfig.provider);

    await logTaskEvent(
      task.id,
      "status_change",
      `${prefix} Skipping Critic validation (skip-planner label) - generating plan using ${agentConfig.provider}/${agentConfig.model}`
    );

    try {
      // Generate plan with Claude but skip the Critic validation loop
      // This still creates proper multi-persona steps, just without iterative refinement
      const prd = `# ${task.summary}\n\n${task.description || ""}`;

      const executionPlanV2 = await generatePlan(prd, agentConfig);

      logger.info("V2 skip-planner: plan generated without validation", {
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        stepCount: executionPlanV2.steps.length,
        personas: executionPlanV2.steps.map(s => s.persona),
      });

      await logTaskEvent(
        task.id,
        "status_change",
        `${prefix} Plan generated (skip-planner): ${executionPlanV2.steps.length} steps`
      );

      // Log each step
      for (const step of executionPlanV2.steps) {
        await logTaskEvent(
          task.id,
          "info",
          `${prefix} Step ${step.index + 1}: [${step.persona}] ${step.title}`
        );
      }

      // Store plan and transition to queued (auto-approved since we skipped critic).
      // REMOTE AGENT: Use atomic UPDATE to avoid clobbering claimed_by_agent.
      // All fields set in one UPDATE to avoid a race window where task is queued but planless.
      const skipPlannerTransition = await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "queued" as WorkerTask["status"],
          planStatus: "approved",
          planningNotes: null as unknown as string,
          currentStepIndex: 0,
          executionPlanV2: {
            ...executionPlanV2,
            criticScore: 100, // Auto-approved
          },
          planJson: executionPlanV2 as any,
          contextSidecar: [],
          commitHistory: [],
        })
        .where("id = :id AND claimed_by_agent IS NULL", { id: task.id })
        .execute();

      if ((skipPlannerTransition.affected || 0) === 0) {
        logger.info("Aborting skip-planner save - remote agent claimed task during planning", {
          taskId: task.id,
        });
        return;
      }

      await logTaskEvent(
        task.id,
        "status_change",
        `${prefix} Plan auto-approved (skip-planner) - ready for multi-persona execution`
      );

      // Post plan to Jira
      const planSummary = [
        `[V2 Pipeline - Execution Plan (Skip-Planner Mode)]`,
        ``,
        `**Mode:** Skip-planner (no Critic validation)`,
        `**Tech Stack:** ${executionPlanV2.techStack.language} / ${executionPlanV2.techStack.framework}`,
        ``,
        `**Steps (${executionPlanV2.steps.length}):**`,
        ...executionPlanV2.steps.map(
          (s) => `${s.index + 1}. [${s.persona}] ${s.title}`
        ),
        ``,
        `Plan auto-approved. Sequential multi-persona execution starting...`,
      ].join("\n");

      if (task.jiraIssueKey) {
        await postJiraComment(task.orgId, task.jiraIssueKey, planSummary);
      }

      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("V2 skip-planner planning failed", {
        taskId: task.id,
        error: errorMessage,
      });

      await logTaskEvent(task.id, "error", `${prefix} Skip-planner planning failed: ${errorMessage}`);

      // REMOTE AGENT: Only fail if agent hasn't claimed this task
      const failResult = await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "failed" as WorkerTask["status"],
          errorMessage,
        })
        .where("id = :id AND claimed_by_agent IS NULL", { id: task.id })
        .execute();
      if ((failResult.affected || 0) > 0) {
        await notifyTaskFailed(task);
      }
      return;
    }
  }

  // Build config from organization settings
  const agentConfig: PlanningAgentConfig = {
    provider: (task.organization?.planningAgentProvider || "anthropic") as "anthropic" | "openai" | "google" | "ollama",
    model: task.organization?.planningAgentModel || "claude-sonnet-4-5-20250929",
    orgId: task.orgId,
    ollamaBaseUrl: task.organization?.ollamaBaseUrl || undefined,
  };

  const prefix = getPlanningAgentPrefix(agentConfig.provider);
  const criticStatus = task.criticEnabled ? "with Critic validation" : "without Critic (add 'critic' label to enable)";
  await logTaskEvent(
    task.id,
    "status_change",
    `${prefix} Starting V2 Pipeline planning ${criticStatus} using ${agentConfig.provider}/${agentConfig.model}`
  );

  try {
    // Construct PRD from task description
    const prd = `# ${task.summary}\n\n${task.description || ""}`;

    // Progress callback to stream Planner-Critic iterations to task logs
    const progressCallback: PlanProgressCallback = async (message, details) => {
      await logTaskEvent(task.id, "info", message, {
        metadata: details ? { plannerCritic: details } : undefined,
      });
    };

    // Real-time stream progress callback for SSE planning progress bar on dashboard
    const streamProgressCallback = (event: PlanningProgressEvent) => {
      planningProgressEmitter.emitProgress(task.id, event);
    };

    // Generate and validate plan with Planner-Critic loop
    // Skip critic validation if criticEnabled is false (no 'critic' label)
    const skipCritic = !task.criticEnabled;

    // Periodic heartbeat log so the terminal doesn't appear dead during planning.
    // First update at 30s, then every 60s — minimal, not spammy.
    const planStartTime = Date.now();
    let planHeartbeatInterval: ReturnType<typeof setInterval> | null = null;

    const logPlanningHeartbeat = () => {
      const elapsed = Math.round((Date.now() - planStartTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      logTaskEvent(task.id, "info",
        `${prefix} Planning in progress — analyzing requirements and decomposing into steps (${timeStr} elapsed)`
      ).catch(() => {});
    };

    const planHeartbeatTimeout = setTimeout(() => {
      logPlanningHeartbeat();
      planHeartbeatInterval = setInterval(logPlanningHeartbeat, 60_000);
    }, 30_000);

    const clearPlanningHeartbeat = () => {
      clearTimeout(planHeartbeatTimeout);
      if (planHeartbeatInterval) clearInterval(planHeartbeatInterval);
    };

    let executionPlanV2: Awaited<ReturnType<typeof generateValidatedPlan>>;
    try {
      executionPlanV2 = await generateValidatedPlan(prd, agentConfig, 3, progressCallback, skipCritic, streamProgressCallback);
    } finally {
      clearPlanningHeartbeat();
    }

    logger.info("V2 plan validated successfully", {
      taskId: task.id,
      stepCount: executionPlanV2.steps.length,
      criticScore: executionPlanV2.criticScore,
      techStack: executionPlanV2.techStack.framework,
    });

    await logTaskEvent(
      task.id,
      "status_change",
      `${prefix} Plan validated: ${executionPlanV2.steps.length} steps, score ${executionPlanV2.criticScore}/100`
    );

    // Log each step
    for (const step of executionPlanV2.steps) {
      await logTaskEvent(
        task.id,
        "info",
        `${prefix} Step ${step.index + 1}: [${step.persona}] ${step.title}`
      );
    }

    // Store the plan and transition to queued for execution.
    // REMOTE AGENT: Use atomic UPDATE to avoid clobbering claimed_by_agent if an agent
    // claimed this task during the planning window (which can be 30s to 5 min).
    // All fields set in one UPDATE to avoid a race window where task is queued but planless.
    const planTransition = await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        status: "queued" as WorkerTask["status"],
        planStatus: "approved",
        planningNotes: null as unknown as string,
        currentStepIndex: 0,
        executionPlanV2,
        planJson: executionPlanV2 as any,
        contextSidecar: [],
        commitHistory: [],
      })
      .where("id = :id AND claimed_by_agent IS NULL", { id: task.id })
      .execute();

    if ((planTransition.affected || 0) === 0) {
      logger.info("Aborting plan save - remote agent claimed task during planning", {
        taskId: task.id,
      });
      return;
    }

    // Emit real-time cost event so dashboard updates immediately (ported from local path)
    if (task.estimatedCostUsd || task.planningInputTokens || task.planningOutputTokens) {
      costEvents.emitCostUpdate({
        taskId: task.id,
        orgId: task.orgId,
        inputTokens: task.inputTokens || 0,
        outputTokens: task.outputTokens || 0,
        estimatedCostUsd: task.estimatedCostUsd || 0,
        timestamp: new Date().toISOString(),
      });
    }

    await logTaskEvent(
      task.id,
      "status_change",
      `${prefix} Plan approved - ready for sequential execution`
    );

    // Post plan to Jira
    const planSummary = [
      `[V2 Pipeline - Execution Plan]`,
      ``,
      `**Critic Score:** ${executionPlanV2.criticScore}/100`,
      `**Tech Stack:** ${executionPlanV2.techStack.language} / ${executionPlanV2.techStack.framework}`,
      ``,
      `**Steps (${executionPlanV2.steps.length}):**`,
      ...executionPlanV2.steps.map(
        (s) => `${s.index + 1}. [${s.persona}] ${s.title}`
      ),
      ``,
      `Plan auto-approved by Critic Agent. Sequential execution starting...`,
    ].join("\n");

    if (task.jiraIssueKey) {
      await postJiraComment(task.orgId, task.jiraIssueKey, planSummary);
    }

    logger.info("V2 pipeline planning complete, task queued for execution", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    if (error instanceof PlanValidationError) {
      // Plan validation failed after max iterations - escalate
      logger.warn("V2 plan validation failed, escalating to human", {
        taskId: task.id,
        iterations: error.iterations,
        lastScore: error.lastScore,
        risks: error.lastRisks,
      });

      await logTaskEvent(
        task.id,
        "error",
        `${prefix} Plan validation failed after ${error.iterations} iterations (score: ${error.lastScore}/100)`
      );

      // Store partial info and mark as needing human review.
      // REMOTE AGENT: Only escalate if agent hasn't claimed this task.
      const escalateResult = await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "pending_plan_approval" as WorkerTask["status"],
          planStatus: "pending_approval",
        })
        .where("id = :id AND claimed_by_agent IS NULL", { id: task.id })
        .execute();
      if ((escalateResult.affected || 0) === 0) {
        logger.info("Skipping plan escalation - remote agent claimed task", { taskId: task.id });
        return;
      }
      // Set JSON field via fresh reload
      const escalateTask = await taskRepo.findOne({ where: { id: task.id } });
      if (escalateTask) {
        escalateTask.planJson = {
          validationFailed: true,
          iterations: error.iterations,
          lastScore: error.lastScore,
          risks: error.lastRisks,
          suggestions: error.lastSuggestions,
        } as unknown as Record<string, unknown>;
        await taskRepo.save(escalateTask);
      }

      // Post to Jira for human review
      const escalationMessage = [
        `[V2 Pipeline - Plan Validation Failed]`,
        ``,
        `The Critic Agent rejected the plan after ${error.iterations} iterations.`,
        `Last score: ${error.lastScore}/100`,
        ``,
        `**Identified Risks:**`,
        ...error.lastRisks.map((r) => `- ${r}`),
        ``,
        `**Suggestions:**`,
        ...error.lastSuggestions.map((s) => `- ${s}`),
        ``,
        `Please review and provide feedback or approve manually.`,
      ].join("\n");

      if (task.jiraIssueKey) {
        await postJiraComment(task.orgId, task.jiraIssueKey, escalationMessage);
      }
    } else {
      // Unexpected error
      logger.error("V2 pipeline planning failed", {
        taskId: task.id,
        error: errorMessage,
      });

      await logTaskEvent(task.id, "error", `${prefix} V2 Planning failed: ${errorMessage}`);

      // REMOTE AGENT: Only fail if agent hasn't claimed this task
      const failPlanResult = await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "failed" as WorkerTask["status"],
          errorMessage,
        })
        .where("id = :id AND claimed_by_agent IS NULL", { id: task.id })
        .execute();
      if ((failPlanResult.affected || 0) > 0) {
        await notifyTaskFailed(task);
      }
    }
  }
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
    pipelineVersion: task.pipelineVersion,
  });

  // V2 Pipeline: Use Planner-Critic loop from critic-agent.ts
  if (task.pipelineVersion === "v2") {
    await processV2PipelinePlanning(task);
    return;
  }

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
    // V3 planning is the default for PRD/Epic tickets (inventory-based dual scoring)
    // V2 is legacy, V1 is for simple tickets
    const useV3 = shouldUseV3Planning(task);
    const useV2 = !useV3 && shouldUseV2Planning(task);

    if (useV3 && !isReplanning) {
      await logTaskEvent(
        task.id,
        "info",
        "Using V3 inventory-based planning (PRD/Epic detected)",
      );
    } else if (useV2 && !isReplanning) {
      await logTaskEvent(
        task.id,
        "info",
        "Using V2 multi-phase planning",
      );
    }

    const plan = isReplanning
      ? await replanWithFeedback(task, task.planFeedback!)
      : useV3
        ? await runPlanningAgentV3(task)
        : useV2
          ? await runPlanningAgentV2(task)
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
    await notifyTaskFailed(task);
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
    .where("id = :id AND status = :status AND claimed_by_agent IS NULL", { id: taskId, status: "queued" })
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
 * Extract and post PRD constraints to the coordination context.
 *
 * This function extracts tech stack constraints, framework requirements, and
 * other project-level constraints from the PRD description and posts them
 * as a "constraints" context message. All child workers will receive this
 * in their sibling context at startup, ensuring alignment on tech decisions.
 *
 * This MUST be called BEFORE spawning any child workers (as per Gemini 3 Pro's
 * recommendation for avoiding race conditions).
 */
async function postPrdConstraints(task: WorkerTask, techStack?: TechStack): Promise<void> {
  const contextRepo = AppDataSource.getRepository(WorkerContext);
  const allConstraints: string[] = [];

  // ==========================================================================
  // PRIORITY 1: Use techStack from Planning Agent (authoritative source)
  // ==========================================================================
  // When the planning agent provides techStack decisions, these take precedence
  // because they were explicitly decided with full context of the codebase and PRD.
  if (techStack) {
    // Build structured constraint messages from techStack
    const stackConstraints: string[] = [];

    // Language constraint
    stackConstraints.push(`**Language**: ${techStack.language}`);

    // Framework constraint (critical for "no framework" scenarios)
    if (techStack.framework === "none" || techStack.framework === "vanilla") {
      stackConstraints.push(`**Framework**: NONE - Do NOT use any frameworks (React, Vue, Angular, etc.)`);
    } else {
      stackConstraints.push(`**Framework**: ${techStack.framework}`);
    }

    // Styling constraint
    if (techStack.styling && techStack.styling !== "n/a") {
      if (techStack.styling === "vanilla-css" || techStack.styling === "vanilla") {
        stackConstraints.push(`**Styling**: Vanilla CSS only - No CSS frameworks or preprocessors`);
      } else {
        stackConstraints.push(`**Styling**: ${techStack.styling}`);
      }
    }

    // Database
    if (techStack.database && techStack.database !== "none" && techStack.database !== "n/a") {
      stackConstraints.push(`**Database**: ${techStack.database}`);
    }

    // Testing
    if (techStack.testing) {
      stackConstraints.push(`**Testing**: ${techStack.testing}`);
    }

    // Build tool
    if (techStack.buildTool) {
      stackConstraints.push(`**Build Tool**: ${techStack.buildTool}`);
    }

    // Add all structured constraints
    allConstraints.push(...stackConstraints);

    // Add verbatim PRD constraints if any
    if (techStack.prdConstraints && techStack.prdConstraints.length > 0) {
      allConstraints.push("");
      allConstraints.push("**Verbatim PRD Constraints (must be followed exactly):**");
      allConstraints.push(...techStack.prdConstraints.map(c => `- ${c}`));
    }

    // Add rationale for transparency
    if (techStack.rationale) {
      allConstraints.push("");
      allConstraints.push(`_Rationale: ${techStack.rationale}_`);
    }

    logger.info("Using techStack from planning agent for constraints", {
      taskId: task.id,
      techStack,
    });
  }

  // ==========================================================================
  // PRIORITY 2: Fallback to regex extraction from PRD description
  // ==========================================================================
  // Only used if no techStack was provided (legacy path or single-story tasks)
  if (allConstraints.length === 0 && task.description) {
    const constraintPatterns = [
      /tech\s*stack[:\s]*([^\n]+(?:\n(?![A-Z#])[^\n]+)*)/gi,
      /(?:technical?\s*)?constraints?[:\s]*([^\n]+(?:\n(?![A-Z#])[^\n]+)*)/gi,
      /(?:no|don'?t|avoid|must\s+not)\s+(?:use\s+)?(?:any\s+)?(?:frameworks?|libraries?|react|vue|angular|jquery)[^\n]*/gi,
      /(?:pure|vanilla|plain)\s+(?:html|css|js|javascript)[^\n]*/gi,
      /(?:must|should|required?)\s+(?:use|be)\s+(?:only\s+)?(?:html|css|js|javascript|typescript|python|node)[^\n]*/gi,
    ];

    const description = task.description;

    for (const pattern of constraintPatterns) {
      const matches = description.matchAll(pattern);
      for (const match of matches) {
        const constraint = match[0].trim();
        if (constraint && !allConstraints.includes(constraint)) {
          allConstraints.push(constraint);
        }
      }
    }

    // Also look for explicit constraint sections
    const sectionMatch = description.match(/##?\s*(?:technical?\s*)?constraints?[:\s]*\n([\s\S]*?)(?=\n##|\n\n\n|$)/i);
    if (sectionMatch) {
      const sectionContent = sectionMatch[1].trim();
      if (sectionContent && !allConstraints.includes(sectionContent)) {
        allConstraints.push(sectionContent);
      }
    }

    // If no explicit constraints found, include key parts of the description
    // that mention technology choices
    if (allConstraints.length === 0) {
      const techMentions = description.match(/(?:using|with|in)\s+(?:pure\s+)?(?:html|css|javascript|typescript|react|vue|angular|node|python)[^\n]*/gi);
      if (techMentions) {
        allConstraints.push(...techMentions.map(m => m.trim()));
      }
    }
  }

  // ==========================================================================
  // If no constraints found at all, skip posting
  // ==========================================================================
  if (allConstraints.length === 0) {
    logger.info("No constraints found (no techStack and no PRD constraints)", {
      taskId: task.id,
      jiraKey: task.jiraIssueKey,
    });
    return;
  }

  // Format constraints for context message
  const constraintsContent = techStack
    ? `## MANDATORY Tech Stack Constraints (from Planning Agent)

**ALL workers MUST follow these tech stack decisions. Deviating from these is NOT allowed.**

${allConstraints.join("\n")}

**VIOLATION OF THESE CONSTRAINTS WILL CAUSE YOUR WORK TO BE REJECTED.**
If you're unsure about a technology choice, ask via the sibling Q&A system.`
    : `## PRD Technical Constraints

The following constraints apply to ALL stories in this PRD. You MUST adhere to these:

${allConstraints.map(c => `- ${c}`).join("\n")}

**IMPORTANT**: Do not deviate from these constraints. If you're unsure, ask via the sibling Q&A system.`;

  // Post to coordination context
  const context = contextRepo.create({
    parentTaskId: task.id,
    taskId: task.id, // Posted by the orchestrator (parent task)
    orgId: task.orgId,
    persona: "orchestrator", // Special persona for system messages
    messageType: "constraints" as const,
    content: constraintsContent,
    metadata: {
      extractedConstraints: allConstraints,
      techStack: techStack || null,
      source: techStack ? "planning-agent" : "prd-regex",
      prdJiraKey: task.jiraIssueKey,
      postedAt: new Date().toISOString(),
    },
  });

  await contextRepo.save(context);

  logger.info("Posted constraints to coordination context", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
    constraintCount: allConstraints.length,
    source: techStack ? "planning-agent" : "prd-regex",
    techStack: techStack || null,
  });

  await logTaskEvent(
    task.id,
    "info",
    techStack
      ? `🔧 Posted tech stack constraints from planning agent (${techStack.language}/${techStack.framework})`
      : `📋 Posted ${allConstraints.length} PRD constraint(s) to worker coordination feed`,
  );
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
    techStack?: TechStack; // Tech stack decisions from planning agent
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

    // Set a simulated feature branch so isPrdWorkflow detection works for child unblocking
    const simulatedFeatureBranch = `feature/${task.jiraIssueKey}-dry-run`;
    task.githubBranch = simulatedFeatureBranch;

    await logTaskEvent(task.id, "info", `[DRY RUN] Would create feature branch: ${simulatedFeatureBranch}`);
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
  // Skip in local mode - git-ops.ts handles branch creation locally via direct git commands
  const isLocalMode = process.env.EXECUTION_MODE === "local";
  if (task.githubRepo && !featureBranch && !isLocalMode) {
    // Generate feature branch name: feature/<jira-key>
    featureBranch = `feature/${task.jiraIssueKey || task.id.slice(0, 8)}`;

    try {
      // Get the organization to determine the correct SCM provider
      const orgRepo = AppDataSource.getRepository(Organization);
      const org = await orgRepo.findOne({ where: { id: task.orgId } });

      if (org) {
        // Use SCM provider abstraction for multi-provider support (GitHub, GitLab, BitBucket)
        const scmProvider = getScmProvider(org);
        const repoId = scmProvider.parseRepoIdentifier(task.githubRepo);
        const branchCreated = await scmProvider.createBranch(repoId, featureBranch, "main");

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
            scmProvider: org.scmProvider || "github",
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
            scmProvider: org.scmProvider || "github",
          });
          featureBranch = undefined;
        }
      } else {
        logger.warn("Could not find org for task, skipping branch creation", { taskId: task.id });
        featureBranch = undefined;
      }
    } catch (error) {
      logger.warn("Error creating feature branch", {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      await logTaskEvent(task.id, "info", `⚠️ Error creating feature branch - PRs will target main`);
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
    const converted = await convertToEpic(task.orgId, task.jiraIssueKey);
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

  // ==========================================================================
  // POST PRD CONSTRAINTS TO COORDINATION FEED (BEFORE spawning any workers)
  // ==========================================================================
  // This ensures all workers see the tech stack constraints in their startup
  // context. Per Gemini 3 Pro's recommendation: this MUST be synchronous and
  // complete BEFORE any workers are spawned to avoid race conditions.
  //
  // When the planning agent provides techStack, it becomes the authoritative
  // source for technology decisions (language, framework, styling, etc.)
  await postPrdConstraints(task, executionPlan.techStack as TechStack | undefined);

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
          task.orgId,
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
          task.orgId,
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
  const orgRepo = getOrgRepo();

  // Get org for SCM provider
  const org = await orgRepo.findOne({ where: { id: parentTask.orgId } });
  if (!org) {
    logger.error("Organization not found for task", { taskId: parentTask.id, orgId: parentTask.orgId });
    throw new Error(`Organization not found: ${parentTask.orgId}`);
  }

  // Get SCM provider for this org (GitHub, GitLab, or BitBucket)
  const scmProvider = getScmProvider(org);

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
    `🔄 Phase 3: Merging ${sortedChildren.length} story PRs in dependency order via ${scmProvider.displayName}...`
  );

  let successCount = 0;
  let conflictCount = 0;

  for (const child of sortedChildren) {
    try {
      const storyIndex = (child.jiraFields as any)?.storyIndex || "?";
      const repoId = scmProvider.parseRepoIdentifier(child.githubRepo!);

      await logTaskEvent(
        parentTask.id,
        "info",
        `Merging Story ${storyIndex}: PR #${child.githubPrNumber}`
      );

      // First attempt to merge
      let merged = await scmProvider.mergePullRequest(
        repoId,
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
        const prStatus = await scmProvider.getPullRequestStatus(repoId, child.githubPrNumber!);

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
          const updateResult = await scmProvider.updatePullRequestBranch(repoId, child.githubPrNumber!);

          if (updateResult.success) {
            await logTaskEvent(
              parentTask.id,
              "info",
              `✅ Updated PR #${child.githubPrNumber} branch - retrying merge...`
            );

            // Wait for SCM to process the update
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // Retry the merge
            merged = await scmProvider.mergePullRequest(
              repoId,
              child.githubPrNumber!,
              {
                mergeMethod: "squash",
                commitTitle: `${child.jiraIssueKey}: ${child.summary}`,
              }
            );
          } else {
            // Check what files are conflicting
            const conflicts = await scmProvider.getPullRequestConflicts(repoId, child.githubPrNumber!);

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
          parentTask.orgId,
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
        parentTask.orgId,
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
    // Visibility window is configurable via org settings (default 1 minute, max 60 minutes)
    if (parentIsDryRun) {
      // Fetch org to get configurable visibility window
      const orgRepo = AppDataSource.getRepository(Organization);
      const org = await orgRepo.findOne({ where: { id: parentTask.orgId } });
      const visibilityMinutes = org?.dryRunVisibilityMinutes || 1;
      const DRY_RUN_VISIBILITY_SECONDS = visibilityMinutes * 60;

      logger.info("[DRY RUN] Workflow complete - will auto-cleanup after visibility window", {
        parentTaskId: parentTask.id,
        jiraIssueKey: parentTask.jiraIssueKey,
        childCount: childTasks.length,
        cleanupInMinutes: visibilityMinutes,
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
 * Check and unblock dependent tasks when a child task completes.
 *
 * This function IS actively called from:
 * - tasks.ts: when worker status updates to terminal state
 * - webhooks.ts: when GitHub PR events arrive
 * - orchestrator.ts: when task monitor detects completion
 *
 * Dependency Flow:
 * 1. Stories with dependencies start as "blocked" status
 * 2. When a dependency completes AND its PR merges, blocked stories are checked
 * 3. If all dependencies are satisfied, the story transitions to "queued"
 * 4. Phase 3 then merges all PRs in storyIndex order
 *
 * PRD Workflow Dependency Rules:
 * - For "deployed" status: PR is merged, dependents can proceed
 * - For "review_requested" status: PR created but not merged, verify PR merge status
 * - For "completed" status: Task done but no PR, dependents can proceed
 */
export async function checkAndUnblockDependentTasks(
  completedTask: WorkerTask,
): Promise<void> {
  // Only process child tasks (tasks with a parent)
  if (!completedTask.parentTaskId) {
    logger.debug("[UNBLOCK] Skipping - task has no parent", { taskId: completedTask.id });
    return;
  }

  const taskRepo = getTaskRepo();
  const orgRepo = getOrgRepo();
  const contextRepo = AppDataSource.getRepository(WorkerContext);

  // Get org for SCM provider
  const org = await orgRepo.findOne({ where: { id: completedTask.orgId } });
  const scmProvider = org ? getScmProvider(org) : null;

  // Get the completed task's story index from jiraFields
  const completedFields = completedTask.jiraFields as {
    storyIndex?: number;
  } | null;
  const completedStoryIndex = completedFields?.storyIndex;

  logger.info("[UNBLOCK] Starting dependency check", {
    taskId: completedTask.id,
    jiraKey: completedTask.jiraIssueKey,
    parentTaskId: completedTask.parentTaskId,
    storyIndex: completedStoryIndex,
    taskStatus: completedTask.status,
    jiraFields: completedTask.jiraFields,
  });

  if (!completedStoryIndex) {
    logger.warn("[UNBLOCK] Skipping - task has no storyIndex in jiraFields", {
      taskId: completedTask.id,
      jiraFields: completedTask.jiraFields,
    });
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

  logger.info("[UNBLOCK] Found blocked siblings", {
    completedTaskId: completedTask.id,
    completedStoryIndex,
    blockedCount: blockedSiblings.length,
    blockedTasks: blockedSiblings.map(t => ({
      id: t.id,
      jiraKey: t.jiraIssueKey,
      storyIndex: (t.jiraFields as { storyIndex?: number } | null)?.storyIndex,
      storyDependencies: (t.jiraFields as { storyDependencies?: number[] } | null)?.storyDependencies,
    })),
  });

  if (blockedSiblings.length === 0) {
    logger.info("[UNBLOCK] No blocked siblings to unblock", { completedTaskId: completedTask.id });
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
        !isPrdWorkflow &&
        scmProvider
      ) {
        // Task has a PR in review - check if it's actually merged
        // Skip this check for PRD workflows - they consolidate PRs at the end
        try {
          const repoId = scmProvider.parseRepoIdentifier(sibling.githubRepo);
          const prStatus = await scmProvider.getPullRequestStatus(
            repoId,
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

  // Log the completion map for debugging
  logger.info("[UNBLOCK] Built completion map", {
    completedTaskId: completedTask.id,
    isPrdWorkflow,
    completionMap: Array.from(completionMap.entries()).map(([idx, data]) => ({
      storyIndex: idx,
      isComplete: data.isComplete,
      isFailed: data.isFailed,
      prMerged: data.prMerged,
      taskStatus: data.task.status,
      taskId: data.task.id,
    })),
  });

  // Check each blocked sibling to see if its dependencies are now met (or failed)
  for (const blockedTask of blockedSiblings) {
    const blockedFields = blockedTask.jiraFields as {
      storyDependencies?: number[];
    } | null;
    const dependencies = blockedFields?.storyDependencies || [];
    const blockedStoryIndex = (blockedTask.jiraFields as { storyIndex?: number } | null)?.storyIndex;

    logger.info("[UNBLOCK] Checking blocked task dependencies", {
      blockedTaskId: blockedTask.id,
      blockedStoryIndex,
      dependencies,
      dependencyStatuses: dependencies.map(depIdx => {
        const depStatus = completionMap.get(depIdx);
        return {
          depIndex: depIdx,
          found: !!depStatus,
          isComplete: depStatus?.isComplete,
          isFailed: depStatus?.isFailed,
          prMerged: depStatus?.prMerged,
          taskStatus: depStatus?.task?.status,
        };
      }),
    });

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

    logger.info("[UNBLOCK] Dependency check result", {
      blockedTaskId: blockedTask.id,
      blockedStoryIndex,
      allDepsComplete,
      pendingDeps,
      pendingPrMerge,
      willUnblock: allDepsComplete,
    });

    if (allDepsComplete) {
      blockedTask.status = "queued";
      await taskRepo.save(blockedTask);
      logger.info("[UNBLOCK] Successfully unblocked task", {
        taskId: blockedTask.id,
        storyIndex: blockedStoryIndex,
      });

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
 * Process planning using local Claude CLI + OAuth token.
 * Used when EXECUTION_MODE=local for development with Claude Max subscription.
 */
async function processLocalPlanningAgent(
  task: WorkerTask,
  taskRepo: ReturnType<typeof getTaskRepo>
): Promise<void> {
  const prefix = "[🗺️ planning_agent 🤖]";
  const targetRepo = task.githubRepo || process.env.TARGET_REPO_PATH || "unknown";

  await logTaskEvent(
    task.id,
    "status_change",
    `${prefix} Starting local planning with Claude CLI (OAuth)`
  );

  await logTaskEvent(
    task.id,
    "info",
    `${prefix} Target repository: ${targetRepo}`
  );

  try {
    // Construct planning input from task
    const planningInput = {
      taskId: task.id,
      title: task.summary || task.jiraIssueKey || "Unnamed Task",
      description: task.description || "",
      jiraIssueKey: task.jiraIssueKey || undefined,
      labels: (task.jiraFields as Record<string, unknown>)?.labels as string[] | undefined,
    };

    // Run local planning agent with milestone logs + real-time progress via emitter
    const plan = await runLocalPlanningAgent(
      planningInput,
      (milestone) => {
        logTaskEvent(task.id, "info", `${prefix} ${milestone}`).catch(() => {});
      },
      (event) => {
        planningProgressEmitter.emitProgress(task.id, event);
      },
    );

    // Update planning token usage on the task for cost tracking
    if (plan.usage) {
      task.planningInputTokens = (task.planningInputTokens || 0) + plan.usage.inputTokens;
      task.planningOutputTokens = (task.planningOutputTokens || 0) + plan.usage.outputTokens;
      task.estimatedCostUsd = task.calculateCost();
      await taskRepo.save(task);
      logger.info("Updated planning token usage", {
        taskId: task.id,
        planningInputTokens: task.planningInputTokens,
        planningOutputTokens: task.planningOutputTokens,
        totalCostUsd: plan.usage.totalCostUsd,
        estimatedCostUsd: task.estimatedCostUsd,
      });

      // Emit real-time cost event so dashboard updates immediately
      costEvents.emitCostUpdate({
        taskId: task.id,
        orgId: task.orgId,
        inputTokens: task.inputTokens || 0,
        outputTokens: task.outputTokens || 0,
        estimatedCostUsd: task.estimatedCostUsd,
        timestamp: new Date().toISOString(),
      });
    }

    await logTaskEvent(
      task.id,
      "info",
      `${prefix} Plan created: ${plan.stories.length} stories`
    );

    // Log each story
    for (const story of plan.stories) {
      await logTaskEvent(
        task.id,
        "info",
        `${prefix} Story ${story.id}: [${story.persona}] ${story.title} (${story.estimatedEffort})`
      );
    }

    // Run critic if enabled (criticEnabled flag or 'critic' label)
    let criticScore = 100; // Default auto-approved
    if (task.criticEnabled && shouldUseLocalCritic()) {
      await logTaskEvent(
        task.id,
        "status_change",
        `${prefix} Running Critic Agent for plan validation`
      );

      const criticResult = await runLocalCriticAgent({
        taskId: task.id,
        plan,
        originalRequirements: `${task.summary}\n\n${task.description || ""}`,
        iteration: 1,
      });

      criticScore = criticResult.score;

      await logTaskEvent(
        task.id,
        "info",
        `${prefix} Critic score: ${criticScore}/100 - ${criticResult.approved ? "approved" : "needs revision"}`
      );

      if (!criticResult.approved) {
        // Store partial info and mark for manual approval
        task.status = "pending_plan_approval";
        task.planStatus = "pending_approval";
        task.planJson = {
          localPlan: plan,
          criticFeedback: criticResult,
        } as unknown as Record<string, unknown>;
        await taskRepo.save(task);
        return;
      }
    }

    // Convert local plan to ExecutionPlanV2 format for compatibility
    // Use pre-validated V2 data if available (from planning-agent-local validation)
    const hasValidatedV2 = "storiesV2" in plan && plan.storiesV2?.length > 0;

    const steps = hasValidatedV2
      ? plan.storiesV2.map((story) => ({
          index: story.index,
          persona: story.persona as WorkerPersona,
          title: story.title,
          description: story.scope,
          acceptanceCriteria: story.acceptanceCriteria,
          dependencies: story.dependencies, // Already numeric from validation
          estimatedEffort: story.estimatedComplexity,
          targetFiles: story.targetFiles,
          phase: story.phase,
          canonicalOrder: story.canonicalOrder,
        }))
      : plan.stories.map((story, index) => ({
          index,
          persona: story.persona as WorkerPersona,
          title: story.title,
          description: story.description,
          acceptanceCriteria: story.acceptanceCriteria,
          dependencies: story.dependencies.map(d =>
            plan.stories.findIndex(s => s.id === d)
          ).filter(i => i >= 0),
          estimatedEffort: story.estimatedEffort,
        }));

    const executionPlanV2 = {
      techStack: {
        language: "typescript",
        framework: "unknown",
        testingFramework: "vitest",
      },
      steps,
      dependencies: steps.flatMap((step) =>
        (step.dependencies || []).map(dep => ({
          from: dep,
          to: step.index,
        }))
      ),
      risks: plan.risks,
      assumptions: plan.assumptions,
      criticScore,
      // Include mutex groups if available from validation
      mutexGroups: hasValidatedV2 ? (plan as { mutexGroups?: Record<string, number[]> }).mutexGroups : undefined,
    };

    if (hasValidatedV2) {
      logger.info("Using pre-validated V2 plan data", {
        taskId: task.id,
        stepCount: steps.length,
        mutexGroupCount: Object.keys(executionPlanV2.mutexGroups || {}).length,
        dependencies: steps.map(s => ({ index: s.index, deps: s.dependencies })),
      });
    }

    // Store plan and transition to queued
    task.executionPlanV2 = executionPlanV2 as unknown as import("./pipeline-v2-types.js").ExecutionPlanV2;
    task.status = "queued";
    task.planStatus = "approved";
    task.planJson = executionPlanV2 as unknown as Record<string, unknown>;
    task.currentStepIndex = 0;
    task.contextSidecar = [];
    task.commitHistory = [];
    await taskRepo.save(task);

    await logTaskEvent(
      task.id,
      "status_change",
      `${prefix} Plan approved (score: ${criticScore}) - ready for local Epic execution`
    );

    logger.info("Local planning complete, task queued for execution", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      storyCount: plan.stories.length,
      criticScore,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error("Local planning agent failed", {
      taskId: task.id,
      error: errorMessage,
    });

    await logTaskEvent(
      task.id,
      "error",
      `${prefix} Planning failed: ${errorMessage}`
    );

    task.status = "failed";
    task.errorMessage = `Local Planning Agent failed: ${errorMessage}`;
    await taskRepo.save(task);
    await notifyTaskFailed(task);
  }
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

      // CRITICAL: Unblock dependent tasks that are waiting on this dry-run task
      // Without this call, blocked siblings would never transition to "queued"
      // because dry-run tasks bypass ECS monitoring and worker API completion paths
      if (task.parentTaskId) {
        try {
          await checkAndUnblockDependentTasks(task);
          logger.info("[DRY RUN] Checked and unblocked dependent tasks", {
            taskId: task.id,
            parentTaskId: task.parentTaskId,
          });
        } catch (unblockError) {
          logger.warn("[DRY RUN] Failed to unblock dependent tasks", {
            taskId: task.id,
            error: unblockError instanceof Error ? unblockError.message : String(unblockError),
          });
        }
      }

      return; // Don't actually spawn ECS
    }

    // SUPPORT AGENT: Run in-process instead of spawning ECS
    // This provides faster response times and doesn't require git/repo operations
    if (task.workerPersona === "support_agent") {
      logger.info("Running support agent in-process", {
        taskId: task.id,
        ticketKey: task.jiraIssueKey,
      });

      await logTaskEvent(
        task.id,
        "status_change",
        "Starting support agent (in-process execution)",
      );

      // Run the support agent executor asynchronously
      executeSupportAgentTask(task)
        .then((result) => {
          logger.info("Support agent completed", {
            taskId: task.id,
            ticketKey: task.jiraIssueKey,
            action: result.action,
            confidenceScore: result.confidenceScore,
          });
        })
        .catch((error) => {
          logger.error("Support agent failed", {
            taskId: task.id,
            ticketKey: task.jiraIssueKey,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return; // Don't spawn ECS for support agents
    }

    // LOCAL MODE: Spawn local process instead of ECS task
    // This is used for local development with Claude Max subscription (OAuth authentication)
    if (localEpicSpawner.isLocalMode()) {
      logger.info("Running in local execution mode", {
        taskId: task.id,
        jiraKey: task.jiraIssueKey,
        persona: task.workerPersona,
      });

      await logTaskEvent(
        task.id,
        "status_change",
        "Starting local Epic Coordinator (local execution mode)",
      );

      // Update task status to executing
      task.status = "executing";
      task.startedAt = new Date();
      await taskRepo.save(task);

      // CRITICAL: Publish story_ready messages BEFORE spawning container
      // This creates WorkerContext records that the coordinator will poll for.
      // Only publishes stories with no dependencies initially - dependent stories
      // will be published when their dependencies complete.
      if (task.executionPlanV2?.steps?.length) {
        await publishStoriesReady(task);
        logger.info("Published story_ready messages for local Epic mode", {
          taskId: task.id,
          storyCount: task.executionPlanV2.steps.length,
        });
      }

      // Spawn local Epic Coordinator asynchronously
      localEpicSpawner
        .spawnEpicCoordinator(task)
        .then(() => {
          logger.info("Local Epic Coordinator started", {
            taskId: task.id,
            jiraKey: task.jiraIssueKey,
          });
        })
        .catch((error) => {
          logger.error("Local Epic Coordinator failed to start", {
            taskId: task.id,
            jiraKey: task.jiraIssueKey,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      // Note: Task completion is handled by the local coordinator posting to the API
      // or by local monitoring (to be implemented)
      state.tasksProcessed++;
      return; // Don't spawn ECS
    }

    // Determine provider from task or default to anthropic
    const providerId: ProviderId =
      task.workerProvider && isValidProviderId(task.workerProvider)
        ? (task.workerProvider as ProviderId)
        : "anthropic";

    // Load org for settings (quality thresholds, provider routing, etc.)
    // For platform tasks (e.g., support agent), use billingOrgId to get platform org settings
    const settingsOrgId = task.getCredentialsOrgId();
    const orgRepo = AppDataSource.getRepository(Organization);
    const org = await orgRepo.findOne({ where: { id: settingsOrgId } });

    // For AI SDK multi-expert mode, resolve the underlying provider from org's providerRouting
    let aiSdkUnderlyingProvider: string | undefined;
    let aiSdkUnderlyingModel: string | undefined;

    if (task.workerProvider === "ai-sdk") {

      if (org?.providerRouting) {
        const routing = (
          org.providerRouting as Record<
            string,
            { provider: string; model?: string }
          >
        )[task.workerPersona];
        if (routing) {
          aiSdkUnderlyingProvider = routing.provider;
          aiSdkUnderlyingModel = routing.model;
          logger.info("AI SDK multi-expert: resolved provider routing", {
            taskId: task.id,
            persona: task.workerPersona,
            underlyingProvider: aiSdkUnderlyingProvider,
            underlyingModel: aiSdkUnderlyingModel,
          });
        }
      }

      // Default to anthropic if no routing configured
      if (!aiSdkUnderlyingProvider) {
        aiSdkUnderlyingProvider = org?.primaryProvider || "anthropic";
        logger.info("AI SDK multi-expert: using default provider", {
          taskId: task.id,
          persona: task.workerPersona,
          underlyingProvider: aiSdkUnderlyingProvider,
        });
      }
    }

    logger.info("Spawning worker for task", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      persona: task.workerPersona,
      provider: providerId,
      aiSdkUnderlyingProvider,
    });

    // Log setting up environment
    await logTaskEvent(
      task.id,
      "status_change",
      `Setting up execution environment (provider: ${task.workerProvider === "ai-sdk" ? `ai-sdk/${aiSdkUnderlyingProvider}` : providerId})`,
    );

    // Get credentials for the org (uses billingOrgId for platform tasks)
    const credentialsOrgId = task.getCredentialsOrgId();
    const credentials = await getOrgCredentials(credentialsOrgId);

    // For tasks with review enabled, get separate GitHub token for PR approvals
    // This avoids GitHub's self-approval restriction where the same token can't create and approve a PR
    if (!task.skipManagerReview) {
      try {
        const reviewerToken = await getReviewerGitHubToken(credentialsOrgId);
        if (reviewerToken) {
          credentials.githubReviewerToken = reviewerToken;
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

    // Fetch provider-specific API key if not using anthropic
    // For AI SDK mode, fetch credentials for the underlying provider
    const effectiveProvider =
      task.workerProvider === "ai-sdk"
        ? aiSdkUnderlyingProvider
        : providerId;

    if (effectiveProvider && effectiveProvider !== "anthropic") {
      try {
        // Use credentialsOrgId (platform org for platform tasks, customer org otherwise)
        credentials.providerApiKey = await getProviderCredentials(
          credentialsOrgId,
          effectiveProvider as ProviderId,
        );
        credentials.providerId = effectiveProvider as ProviderId;
        logger.info("Fetched provider credentials", {
          taskId: task.id,
          provider: effectiveProvider,
          isAiSdk: task.workerProvider === "ai-sdk",
          credentialsOrgId,
        });
      } catch (error) {
        logger.error("Failed to fetch provider credentials", {
          taskId: task.id,
          provider: effectiveProvider,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error(
          `Provider credentials not configured for '${effectiveProvider}'. Please configure API key in Settings.`,
        );
      }
    }

    // Update status to environment_setup
    task.status = "environment_setup";
    await taskRepo.save(task);

    // Build additional environment for AI SDK mode and quality gate settings
    const additionalEnv: Record<string, string> = {};
    if (task.workerProvider === "ai-sdk") {
      additionalEnv.AI_SDK_UNDERLYING_PROVIDER =
        aiSdkUnderlyingProvider || "anthropic";
      if (aiSdkUnderlyingModel) {
        additionalEnv.WORKER_MODEL = aiSdkUnderlyingModel;
      }
    }

    // Add quality gate thresholds from organization settings
    if (org) {
      additionalEnv.QUALITY_THRESHOLDS = JSON.stringify({
        qualityGateEnabled: org.qualityGateEnabled ?? false,
        minQualityScore: org.minQualityScore,
        minTestCoveragePercent: org.minTestCoveragePercent,
        maxSecurityHighVulns: org.maxSecurityHighVulns,
        blockOnTypeErrors: org.blockOnTypeErrors ?? false,
        blockOnTestFailures: org.blockOnTestFailures ?? false,
      });

      // Resilience settings: self-review (label overrides org default)
      const taskFields = task.jiraFields as Record<string, unknown> | undefined;
      const taskLabels = taskFields?.labels;
      const issueLabels = (taskFields?.issue as Record<string, unknown> | undefined)?.labels;
      const hasSelfReviewLabel = (
        (Array.isArray(taskLabels) && taskLabels.some((l: unknown) => typeof l === "string" && (l as string).toLowerCase() === "self-review")) ||
        (Array.isArray(issueLabels) && issueLabels.some((l: unknown) => {
          if (typeof l === "string") return l.toLowerCase() === "self-review";
          if (l && typeof l === "object" && "name" in l) return ((l as { name: string }).name || "").toLowerCase() === "self-review";
          return false;
        }))
      );
      additionalEnv.SELF_REVIEW_ENABLED = hasSelfReviewLabel || (org.selfReviewEnabled !== false) ? "true" : "false";
      // Other resilience settings
      additionalEnv.BLOCKER_MAX_AUTO_RETRIES = String(org.blockerMaxAutoRetries ?? 3);
      additionalEnv.BLOCKER_AUTO_RETRY_ENABLED = org.blockerAutoRetryEnabled !== false ? "true" : "false";
      additionalEnv.PUSH_AFTER_COMMIT = org.pushAfterCommit !== false ? "true" : "false";
      additionalEnv.GRACEFUL_SHUTDOWN_ENABLED = org.gracefulShutdownEnabled !== false ? "true" : "false";
    }

    // Try to claim a warm container first (eliminates cold-start latency)
    const warmContainer = await claimWarmContainer(task.orgId);

    if (warmContainer) {
      logger.info("Using warm container for task", {
        taskId: task.id,
        containerId: warmContainer.id,
        ecsTaskId: warmContainer.ecsTaskId,
      });

      await logTaskEvent(
        task.id,
        "status_change",
        `Using warm container: ${warmContainer.ecsTaskId.substring(0, 12)}`,
      );

      // Build environment variables for the task
      const taskEnv = buildTaskEnvironment(task, credentials);

      // Add additional AI SDK env vars if present
      for (const [key, value] of Object.entries(additionalEnv)) {
        taskEnv[key] = value;
      }

      // Assign task to the warm container (stores env vars for container to fetch)
      await assignTaskToContainer(warmContainer.id, task.id, taskEnv);

      // Update task with ECS info from warm container
      task.ecsTaskArn = warmContainer.ecsTaskArn;
      task.ecsTaskId = warmContainer.ecsTaskId;
      task.status = "executing";
      task.startedAt = new Date();
      await taskRepo.save(task);

      // Log ECS task started
      await logTaskEvent(
        task.id,
        "status_change",
        `Warm container assigned: ${warmContainer.ecsTaskId}`,
      );

      // Trigger pool maintenance to spawn a replacement
      maintainAllWarmPools().catch((error) => {
        logger.warn("Failed to maintain warm pools after assignment", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    } else {
      // No warm container available - fall back to cold start
      logger.info("No warm container available, using cold start", {
        taskId: task.id,
      });

      // Spawn ECS task (cold start)
      const runner = getECSTaskRunner();

      const result = await runner.runWorkerTask(
        task,
        credentials,
        Object.keys(additionalEnv).length > 0 ? { additionalEnv } : undefined,
      );

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
    }

    logger.info("Worker spawned successfully", {
      taskId: task.id,
      ecsTaskId: task.ecsTaskId,
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
    await notifyTaskFailed(task);

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
  //
  // IMPORTANT: Exclude Epic (parallel) and Multi-Expert (multi-expert) execution modes
  // because they have their own inline Tech Lead review built-in.
  // Virtual Manager review is only for V1 single-worker tasks.
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
    // Exclude Epic and Multi-Expert modes - they have inline Tech Lead review
    .andWhere(
      "(task.execution_mode IS NULL OR task.execution_mode NOT IN (:...excludedModes))",
      { excludedModes: ["parallel", "multi-expert"] },
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
  // Skip ECS monitoring in local mode - local tasks complete via API calls or local monitoring
  if (localEpicSpawner.isLocalMode()) {
    return;
  }

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

  const ecsTasksMap: Map<
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
        await notifyTaskFailed(task);
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
          await notifyTaskFailed(task);

          await logTaskEvent(
            task.id,
            "error",
            `Task failed: Spot capacity reclaimed ${task.maxRetries} times (max retries exceeded)`,
            { severity: "error" },
          );
          continue;
        }
      }

      // Read result markers from task logs (include severity for error detection)
      const logs = await AppDataSource.query(
        `SELECT message, severity, type FROM worker_task_logs
         WHERE task_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [task.id],
      );

      let detectedResult: string | null = null;
      let detectedPrUrl: string | null = null;
      let detectedPrNumber: number | null = null;
      let detectedErrorMessage: string | null = null;
      let lastErrorSeverityMessage: string | null = null;

      for (const log of logs) {
        const msg = log.message || "";
        const severity = log.severity || "";
        const logType = log.type || "";

        // Look for result marker
        const resultMatch = msg.match(/::result::(\w+)/);
        if (resultMatch && !detectedResult) {
          detectedResult = resultMatch[1];
        }

        // Look for PR URL marker (GitHub, GitLab, Bitbucket)
        const prUrlMatch = msg.match(
          /::pr_url::(https:\/\/(?:github\.com|gitlab\.com|bitbucket\.org)\/[^\s]+)/,
        );
        if (prUrlMatch && !detectedPrUrl) {
          detectedPrUrl = prUrlMatch[1];
        }

        // Look for PR number marker
        const prNumMatch = msg.match(/::pr_number::(\d+)/);
        if (prNumMatch && !detectedPrNumber) {
          detectedPrNumber = parseInt(prNumMatch[1], 10);
        }

        // Look for explicit error marker (::error::message) - highest priority
        const errorMatch = msg.match(/::error::(.+)/);
        if (errorMatch && !detectedErrorMessage) {
          detectedErrorMessage = errorMatch[1].trim();
        }

        // Look for revision count marker (for inline reviews in Epic/Multi-Expert mode)
        const revisionMatch = msg.match(/::revision_count::(\d+)/);
        if (revisionMatch) {
          const parsedRevision = parseInt(revisionMatch[1], 10);
          if (!isNaN(parsedRevision) && parsedRevision >= 0) {
            task.revisionCount = parsedRevision;
          }
        }

        // Capture last error severity log message (fallback for error detection)
        // Only capture meaningful error messages, not generic markers
        if ((severity === "error" || logType === "error") && !lastErrorSeverityMessage) {
          // Skip generic result markers and capture actual error content
          if (!msg.startsWith("::") && msg.length > 10) {
            lastErrorSeverityMessage = msg;
          }
        }
      }

      // Use error severity message as fallback if no explicit ::error:: marker
      if (!detectedErrorMessage && lastErrorSeverityMessage) {
        detectedErrorMessage = lastErrorSeverityMessage;
      }

      // Determine final status based on detected result or exit code
      let newStatus: typeof task.status;
      if (detectedResult) {
        switch (detectedResult) {
          case "deployed":
            newStatus = "deployed";
            break;
          case "pr_created":
            newStatus = "pr_created";
            break;
          case "review_requested":
            newStatus = "review_requested";
            break;
          case "pr_approved":
            newStatus = "pr_approved";
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
        errorMessage?: string;
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

      // Capture error message when task fails
      if (newStatus === "failed") {
        // Priority: 1) ::error:: marker from logs, 2) ECS stopped reason, 3) Generic message
        if (detectedErrorMessage) {
          updateFields.errorMessage = detectedErrorMessage;
        } else if (ecsInfo.stoppedReason) {
          updateFields.errorMessage = ecsInfo.stoppedReason;
        } else {
          updateFields.errorMessage = `Task failed with exit code ${ecsInfo.exitCode}`;
        }
        logger.info("Captured error message for failed task", {
          taskId: task.id,
          errorMessage: updateFields.errorMessage,
          source: detectedErrorMessage ? "log_marker" : (ecsInfo.stoppedReason ? "ecs_reason" : "exit_code"),
        });
      }

      await taskRepo.update(task.id, updateFields);

      // Update local task object for subsequent logic
      task.status = newStatus;
      task.completedAt = completedAt;
      if (updateFields.githubPrUrl) task.githubPrUrl = updateFields.githubPrUrl;
      if (updateFields.githubPrNumber) task.githubPrNumber = updateFields.githubPrNumber;
      if (updateFields.ecsTaskSeconds) task.ecsTaskSeconds = updateFields.ecsTaskSeconds;
      if (updateFields.errorMessage) task.errorMessage = updateFields.errorMessage;

      // COST RECOVERY: If usage wasn't reported via the /usage endpoint, try to recover from:
      // 1. Partial tokens (from incremental /usage/partial reports during execution)
      // 2. Log markers (::input_tokens::, ::output_tokens::, etc.)
      // This ensures costs are captured even when workers fail/crash before final POST
      const freshTask = await taskRepo.findOne({ where: { id: task.id } });
      if (freshTask && !freshTask.usageReportedAt) {
        let recovered = false;

        // Option A: Use partial tokens if they were captured during execution
        if (
          freshTask.partialTokensUpdatedAt &&
          (freshTask.inputTokens > 0 || freshTask.outputTokens > 0)
        ) {
          freshTask.estimatedCostUsd = freshTask.calculateCost();
          freshTask.usageReportedAt = new Date();
          await taskRepo.save(freshTask);

          // Update org cumulative cost
          try {
            const costTracker = getCostTracker(AppDataSource);
            await costTracker.recordTaskCost(freshTask.id);
          } catch (costError) {
            logger.warn("Failed to record recovered cost to org", {
              taskId: task.id,
              error: costError instanceof Error ? costError.message : String(costError),
            });
          }

          logger.info("COST_RECOVERED_FROM_PARTIAL: Captured cost from incremental reports", {
            taskId: task.id,
            jiraIssueKey: task.jiraIssueKey,
            inputTokens: freshTask.inputTokens,
            outputTokens: freshTask.outputTokens,
            estimatedCostUsd: freshTask.estimatedCostUsd,
          });
          recovered = true;
        }

        // Option B: Parse logs for token markers if no partial tokens
        if (!recovered) {
          let recoveredInput = 0;
          let recoveredOutput = 0;
          let recoveredCacheCreate = 0;
          let recoveredCacheRead = 0;

          for (const log of logs) {
            const msg = log.message || "";

            const inputMatch = msg.match(/::input_tokens::(\d+)/);
            if (inputMatch) {
              recoveredInput = Math.max(recoveredInput, parseInt(inputMatch[1], 10));
            }

            const outputMatch = msg.match(/::output_tokens::(\d+)/);
            if (outputMatch) {
              recoveredOutput = Math.max(recoveredOutput, parseInt(outputMatch[1], 10));
            }

            const cacheCreateMatch = msg.match(/::cache_creation_tokens::(\d+)/);
            if (cacheCreateMatch) {
              recoveredCacheCreate = Math.max(recoveredCacheCreate, parseInt(cacheCreateMatch[1], 10));
            }

            const cacheReadMatch = msg.match(/::cache_read_tokens::(\d+)/);
            if (cacheReadMatch) {
              recoveredCacheRead = Math.max(recoveredCacheRead, parseInt(cacheReadMatch[1], 10));
            }
          }

          if (recoveredInput > 0 || recoveredOutput > 0) {
            freshTask.inputTokens = recoveredInput;
            freshTask.outputTokens = recoveredOutput;
            freshTask.cacheCreationTokens = recoveredCacheCreate;
            freshTask.cacheReadTokens = recoveredCacheRead;
            freshTask.estimatedCostUsd = freshTask.calculateCost();
            freshTask.usageReportedAt = new Date();
            await taskRepo.save(freshTask);

            // Update org cumulative cost
            try {
              const costTracker = getCostTracker(AppDataSource);
              await costTracker.recordTaskCost(freshTask.id);
            } catch (costError) {
              logger.warn("Failed to record recovered cost to org", {
                taskId: task.id,
                error: costError instanceof Error ? costError.message : String(costError),
              });
            }

            logger.info("COST_RECOVERED_FROM_MARKERS: Captured cost from log markers", {
              taskId: task.id,
              jiraIssueKey: task.jiraIssueKey,
              inputTokens: recoveredInput,
              outputTokens: recoveredOutput,
              cacheCreationTokens: recoveredCacheCreate,
              cacheReadTokens: recoveredCacheRead,
              estimatedCostUsd: freshTask.estimatedCostUsd,
            });
          }
          // NOTE: Dead code removed - else-if had same condition as if, so could never execute.
          // Cost audit discrepancy check was intended but had logic bug.
        }
      }

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

      // COST VALIDATION: Warn if completed task has zero cost (possible tracking gap)
      if (["completed", "deployed", "review_requested"].includes(newStatus)) {
        const finalTask = await taskRepo.findOne({ where: { id: task.id } });
        if (finalTask) {
          const hasCost = (finalTask.estimatedCostUsd ?? 0) > 0;
          const hasTokens = (finalTask.inputTokens ?? 0) > 0 || (finalTask.outputTokens ?? 0) > 0;

          if (!hasCost && !hasTokens) {
            // Zero cost on completed task - likely a tracking gap
            logger.warn("COST_VALIDATION_WARNING: Completed task has zero cost - possible tracking gap", {
              taskId: task.id,
              jiraIssueKey: task.jiraIssueKey,
              status: newStatus,
              inputTokens: finalTask.inputTokens,
              outputTokens: finalTask.outputTokens,
              estimatedCostUsd: finalTask.estimatedCostUsd,
              usageReportedAt: finalTask.usageReportedAt,
            });

            await logTaskEvent(
              task.id,
              "info",
              "⚠️ Cost tracking: Task completed with $0.00 cost. Tokens may not have been captured.",
              { severity: "warning", metadata: { estimatedCostUsd: 0, inputTokens: 0, outputTokens: 0 } },
            );

            // Flag the task for dashboard visibility
            await taskRepo.update(task.id, {
              taskNotes: (finalTask.taskNotes || "") + "\n\n⚠️ COST_WARNING: Zero cost on completion - review token tracking",
            });
          }
        }
      }

      // DIRECTIVE EFFECTIVENESS: Update directive metrics when task reaches terminal state
      if (["completed", "deployed", "failed"].includes(newStatus)) {
        try {
          const finalTaskForDirectives = await taskRepo.findOne({ where: { id: task.id } });
          if (finalTaskForDirectives && finalTaskForDirectives.directivesUsed?.length > 0) {
            const success = newStatus === "completed" || newStatus === "deployed";
            await updateDirectiveOutcome(task.id, {
              success,
              qualityScore: finalTaskForDirectives.qualityScore,
              accuracyScore: finalTaskForDirectives.accuracyScore,
              reviewOutcome: finalTaskForDirectives.reviewOutcome,
            });
            logger.debug("Updated directive effectiveness metrics", {
              taskId: task.id,
              success,
              directivesCount: finalTaskForDirectives.directivesUsed.length,
            });
          }
        } catch (directiveError) {
          logger.warn("Failed to update directive effectiveness metrics", {
            taskId: task.id,
            error: directiveError instanceof Error ? directiveError.message : String(directiveError),
          });
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

      // Send Slack notifications for terminal and waiting statuses
      // Wrap in try/catch so notification failures don't break orchestration
      try {
        // Notify on all terminal and waiting states where the worker has finished
        // - completed/deployed: Task fully done
        // - pr_approved: Tech Lead approved, ready for merge/deploy
        // - review_requested: PR created, waiting for human review
        // - escalated: Task needs human intervention
        if (newStatus === "completed" || newStatus === "deployed" ||
            newStatus === "pr_approved" || newStatus === "review_requested" ||
            newStatus === "escalated") {
          await notifyTaskCompleted(task);
          logger.debug("Sent task completed notification", {
            taskId: task.id,
            status: newStatus,
          });
        } else if (newStatus === "failed") {
          await notifyTaskFailed(task);
          logger.debug("Sent task failed notification", {
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
  // Skip ECS monitoring in local mode
  if (localEpicSpawner.isLocalMode()) {
    return;
  }

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

  const ecsTasksMap: Map<
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

        case "revision_needed": {
          task.revisionCount = (task.revisionCount || 0) + 1;
          // Get org's maxReviewRevisions setting (use credentialsOrgId for platform tasks)
          const revisionCredentials = await getOrgCredentials(task.getCredentialsOrgId());
          const maxRevisions = revisionCredentials?.maxReviewRevisions ?? 3;
          if (task.canRevise(maxRevisions)) {
            newStatus = "queued";
            task.taskNotes = `REVISION_RUN: Manager requested changes (attempt ${task.revisionCount}/${maxRevisions}). Feedback: ${detectedFeedback || "See logs"}`;
            task.completedAt = null;
            task.ecsTaskArn = null;
            task.ecsTaskId = null;
            task.startedAt = null;
            logger.info(
              "Manager requested revision via log detection, re-queueing",
              { taskId: task.id, revisionCount: task.revisionCount, maxRevisions },
            );
          } else {
            newStatus = "escalated";
            task.errorMessage = `Max revisions (${maxRevisions}) reached. Requires human intervention. Final feedback: ${detectedFeedback || "See logs"}`;
            logger.info("Max revisions reached via log detection, escalating", {
              taskId: task.id,
              maxRevisions,
            });
          }
          break;
        }

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
  // Skip in local mode - Epic Mode has inline Tech Lead review
  if (localEpicSpawner.isLocalMode()) {
    logger.info("Skipping Manager spawn in local mode (inline review used)", {
      taskId: task.id,
    });
    return;
  }

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

    // Get credentials for the org (needed to store manager provider/model)
    // Use credentialsOrgId for platform tasks
    const managerCredentials = await getOrgCredentials(task.getCredentialsOrgId());

    // Update status to manager_review and store which provider/model is performing the review
    task.status = "manager_review";
    task.managerProvider = managerCredentials.managerProvider || "openai";
    task.managerModel = managerCredentials.managerModelId || "gpt-5.1-codex";
    await taskRepo.save(task);

    // Get separate manager GitHub token for PR approvals (avoids self-approval block)
    const managerToken = await getManagerGitHubToken();
    if (managerToken) {
      managerCredentials.githubToken = managerToken;
    }

    // Spawn Manager ECS task
    const runner = getECSTaskRunner();
    const result = await runner.runManagerTask(task, managerCredentials, "review_pr");

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
  // Skip in local mode - log analysis not needed for local development
  if (localEpicSpawner.isLocalMode()) {
    logger.info("Skipping Manager log analysis in local mode", {
      taskId: task.id,
    });
    return;
  }

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

    // Get credentials for the org (use credentialsOrgId for platform tasks)
    const analysisCredentials = await getOrgCredentials(task.getCredentialsOrgId());

    // Get separate manager GitHub token (for consistency with PR review)
    const managerToken = await getManagerGitHubToken();
    if (managerToken) {
      analysisCredentials.githubToken = managerToken;
    }

    // Spawn Manager ECS task for log analysis
    const runner = getECSTaskRunner();
    const result = await runner.runManagerTask(
      task,
      analysisCredentials,
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

          // Check if this is a V2 pipeline task with execution plan - route to sequential pipeline
          if (task.isV2Pipeline() && task.executionPlanV2) {
            logger.info("V2 pipeline task claimed, routing to sequential pipeline", {
              taskId: task.id,
              jiraIssueKey: task.jiraIssueKey,
              stepCount: task.executionPlanV2.steps?.length || 0,
            });
            runSequentialPipeline(task.id).catch((error) => {
              logger.error("Error in V2 runSequentialPipeline", {
                taskId: task.id,
                error: error instanceof Error ? error.message : String(error),
              });
            });
            continue;
          }

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

      // Process V2 Pipeline tasks ready for sequential execution
      const v2PipelineTasks = await findV2PipelineTasks();
      for (const task of v2PipelineTasks) {
        if (!state.running) break;

        logger.info("Starting V2 sequential pipeline execution", {
          taskId: task.id,
          jiraIssueKey: task.jiraIssueKey,
          stepCount: task.executionPlanV2?.steps?.length || 0,
          currentStepIndex: task.currentStepIndex,
        });

        // Run V2 sequential pipeline (don't await - let it run async)
        runSequentialPipeline(task.id).catch((error) => {
          logger.error("Error in V2 runSequentialPipeline", {
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
      // Also checks for hung tasks (no heartbeat in 10+ min) and fails them
      if (state.tasksProcessed % 12 === 0 || state.tasksProcessed === 0) {
        await cleanupStaleCoordination().catch((error) => {
          logger.error("Error in cleanupStaleCoordination", {
            error: error instanceof Error ? error.message : String(error),
          });
        });

        // Fail tasks with stale heartbeats (hung workers) or no heartbeat at all
        await failHungTasks().catch((error) => {
          logger.error("Error in failHungTasks", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }

      // Fail orphaned tasks (ECS task missing or stuck without check-in)
      // Run every ~5 minutes (60 polls * 5 seconds = 300 seconds)
      if (state.tasksProcessed % 60 === 0 || state.tasksProcessed === 0) {
        await failOrphanedTasks().catch((error) => {
          logger.error("Error in failOrphanedTasks", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }

      // Proactively refresh OAuth token in local mode to prevent expiration during idle periods.
      // Run every ~1 hour (720 polls * 5 seconds = 3600 seconds).
      // Ensures containers spawned later get a fresh token via the bind-mounted credentials file.
      if (process.env.EXECUTION_MODE === "local" && state.tasksProcessed % 720 === 0 && state.tasksProcessed > 0) {
        ensureValidOAuthToken().catch((error) => {
          logger.warn("Periodic OAuth token refresh failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }

      // Maintain warm container pools
      // Run every ~30 seconds (6 polls * 5 seconds = 30 seconds)
      if (state.tasksProcessed % 6 === 0) {
        await maintainAllWarmPools().catch((error) => {
          logger.error("Error in maintainAllWarmPools", {
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
 * Invalidate the cached credentials for an organization.
 * Call this when org settings are updated to ensure workers get fresh credentials.
 */
export function invalidateOrgCredentialsCache(orgId: string): void {
  const deleted = credentialsCache.delete(orgId);
  if (deleted) {
    logger.info("Invalidated credentials cache for org", { orgId });
  }
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
  // Skip orphan detection in local mode - ECS ARN checks don't apply
  if (localEpicSpawner.isLocalMode()) {
    return;
  }

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
      .andWhere("task.claimed_by_agent IS NULL")
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
      await notifyTaskFailed(task);
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
    const existingEcsArns = new Set<string>();
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
      await notifyTaskFailed(task);
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
        await notifyTaskFailed(task);
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
 * Fail hung tasks with stale or missing heartbeats
 *
 * This catches tasks where:
 * 1. The ECS container is still running (not caught by failOrphanedTasks)
 * 2. But the worker inside hasn't sent a heartbeat in 10+ minutes
 * 3. OR the worker never sent a check-in at all (executing for 10+ min with no heartbeat)
 *
 * This indicates the worker is hung (infinite loop, deadlock, API unavailable, etc.)
 * The task is failed WITHOUT auto-retry - user can manually re-queue if desired.
 */
async function failHungTasks(): Promise<void> {
  const taskRepo = getTaskRepo();
  const checkInRepo = AppDataSource.getRepository(WorkerCheckIn);

  // 10 minute threshold - tasks without heartbeat for 10+ min are considered hung
  const HUNG_THRESHOLD_MS = 10 * 60 * 1000;
  const hungThreshold = new Date(Date.now() - HUNG_THRESHOLD_MS);

  try {
    // Find tasks in executing status using LEFT JOIN to catch:
    // 1. Tasks with stale heartbeats (heartbeat_at < threshold)
    // 2. Tasks with NO check-in at all (ci.task_id IS NULL) that have been executing 10+ min
    const hungTasks = await taskRepo
      .createQueryBuilder("task")
      .leftJoin(
        WorkerCheckIn,
        "ci",
        "ci.task_id = task.id"
      )
      .where("task.status = :status", { status: "executing" })
      .andWhere("task.claimed_by_agent IS NULL")
      .andWhere(
        "(ci.heartbeat_at < :threshold OR (ci.task_id IS NULL AND task.updated_at < :threshold))",
        { threshold: hungThreshold }
      )
      .select([
        "task.id",
        "task.jiraIssueKey",
        "task.status",
        "task.ecsTaskArn",
        "task.updatedAt",
        "ci.heartbeatAt",
        "ci.taskId",
      ])
      .limit(10)
      .getRawMany();

    if (hungTasks.length === 0) return;

    let failedCount = 0;

    for (const row of hungTasks) {
      const taskId = row.task_id;
      const jiraIssueKey = row.task_jiraIssueKey || row.task_jira_issue_key;
      const heartbeatAt = row.ci_heartbeatAt || row.ci_heartbeat_at;
      const updatedAt = row.task_updatedAt || row.task_updated_at;
      const ecsTaskArn = row.task_ecsTaskArn || row.task_ecs_task_arn;
      const hasCheckIn = row.ci_taskId || row.ci_task_id;

      // Calculate minutes since last activity
      const referenceTime = heartbeatAt ? new Date(heartbeatAt) : new Date(updatedAt);
      const minutesSinceActivity = Math.round(
        (Date.now() - referenceTime.getTime()) / 60000
      );

      const reason = hasCheckIn
        ? `stale heartbeat (last: ${minutesSinceActivity} min ago)`
        : `no heartbeat ever received (executing for ${minutesSinceActivity} min)`;

      logger.warn("Failing hung task", {
        taskId,
        jiraIssueKey,
        ecsTaskArn,
        heartbeatAt: heartbeatAt || null,
        hasCheckIn: !!hasCheckIn,
        minutesSinceActivity,
        reason,
      });

      // Fetch the full task to update
      const task = await taskRepo.findOne({ where: { id: taskId } });
      if (!task) continue;

      // Don't fail if status changed while we were processing
      if (task.status !== "executing") {
        logger.info("Task status changed, skipping hung check", {
          taskId,
          currentStatus: task.status,
        });
        continue;
      }

      task.status = "failed";
      task.completedAt = new Date();
      task.errorMessage = hasCheckIn
        ? `Worker hung: no heartbeat for ${minutesSinceActivity} minutes. The worker may have crashed, hit an infinite loop, or lost API connectivity. Re-queue the task to retry.`
        : `Worker hung: no heartbeat received after ${minutesSinceActivity} minutes. The worker may have failed to start, crashed early, or lost API connectivity. Re-queue the task to retry.`;
      await taskRepo.save(task);
      await notifyTaskFailed(task);

      await logTaskEvent(task.id, "error", task.errorMessage, {
        severity: "error",
      });

      // Clean up any stale check-in (if exists)
      if (hasCheckIn) {
        await checkInRepo.delete({ taskId });
      }

      failedCount++;
    }

    if (failedCount > 0) {
      logger.info("Failed hung tasks", { count: failedCount });
    }
  } catch (error) {
    logger.error("Error in failHungTasks", {
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
      .andWhere("task.claimed_by_agent IS NULL")
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
      await notifyTaskFailed(task);
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
      .andWhere("task.claimed_by_agent IS NULL")
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
 * Release tasks claimed by dead remote agents.
 * If a remote agent crashes without releasing its tasks, the heartbeat will go stale.
 * After 10 minutes with no heartbeat, release the task back to the queue.
 */
async function releaseStaleAgentTasks(): Promise<void> {
  const taskRepo = getTaskRepo();
  const STALE_HEARTBEAT_MINUTES = 10;
  const cutoff = new Date(Date.now() - STALE_HEARTBEAT_MINUTES * 60 * 1000);

  try {
    // Find tasks claimed by a remote agent with stale heartbeat
    // Includes "executing" — if the agent dies mid-execution, failOrphanedTasks and
    // failHungTasks skip agent-claimed tasks, so this is the only cleanup path.
    const staleTasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.claimed_by_agent IS NOT NULL")
      .andWhere("task.status IN (:...statuses)", {
        statuses: ["planning", "queued", "claimed", "executing"],
      })
      .andWhere("task.agent_heartbeat_at < :cutoff", { cutoff })
      .limit(10)
      .getMany();

    for (const task of staleTasks) {
      const minutesSinceHeartbeat = Math.round(
        (Date.now() - (task.agentHeartbeatAt?.getTime() || 0)) / (60 * 1000),
      );

      logger.warn("Releasing task from dead remote agent", {
        taskId: task.id,
        claimedByAgent: task.claimedByAgent,
        status: task.status,
        minutesSinceHeartbeat,
      });

      if (task.status === "executing") {
        // Fail executing tasks — can't safely resume mid-execution
        const errorMessage = `Remote agent lost (no heartbeat for ${minutesSinceHeartbeat} minutes). Task was mid-execution and cannot be safely resumed.`;
        await taskRepo
          .createQueryBuilder()
          .update(WorkerTask)
          .set({
            claimedByAgent: null as unknown as string,
            agentHeartbeatAt: null as unknown as Date,
            status: "failed" as WorkerTask["status"],
            errorMessage,
            completedAt: new Date(),
          })
          .where("id = :id AND claimed_by_agent = :agent", {
            id: task.id,
            agent: task.claimedByAgent,
          })
          .execute();

        await notifyTaskFailed(task);
        await logTaskEvent(task.id, "error", errorMessage, { severity: "error" });
      } else {
        // Release pre-execution tasks back to their appropriate state
        const resetStatus = task.executionPlanV2 ? "queued" : "planning";
        await taskRepo
          .createQueryBuilder()
          .update(WorkerTask)
          .set({
            claimedByAgent: null as unknown as string,
            agentHeartbeatAt: null as unknown as Date,
            status: resetStatus as WorkerTask["status"],
          })
          .where("id = :id AND claimed_by_agent = :agent", {
            id: task.id,
            agent: task.claimedByAgent,
          })
          .execute();

        await logTaskEvent(
          task.id,
          "system",
          `Task released from remote agent (no heartbeat for ${minutesSinceHeartbeat} minutes). Re-queued for processing.`,
          { severity: "warning" },
        );
      }
    }

    if (staleTasks.length > 0) {
      logger.info("Released stale remote agent tasks", { count: staleTasks.length });
    }
  } catch (error) {
    logger.error("Error in releaseStaleAgentTasks", {
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
      releaseStaleAgentTasks(),
      expireOldReferrals().catch((error) => {
        logger.error("Error expiring old referrals", {
          error: error instanceof Error ? error.message : String(error),
        });
      }),
    ]).catch((error) => {
      logger.error("Error during cleanup operations", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    // Run every hour
    await new Promise((resolve) => setTimeout(resolve, 60 * 60 * 1000));
  }
}
