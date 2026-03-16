/**
 * Worker Spawner — Spawn ECS/local/support workers for claimed tasks
 *
 * Extracted from orchestrator.ts.
 * Used by: orchestrator.ts (pollLoop)
 *
 * Handles:
 * - Dry-run mode simulation
 * - Support agent in-process execution
 * - Local mode (Docker containers via localEpicSpawner)
 * - Cloud ECS mode (cold start or warm container pool)
 * - Provider credential resolution (Anthropic, OpenAI, Google, Ollama)
 * - Quality gate and resilience settings injection
 */

import { AppDataSource } from "../db/connection.js";
import {
  WorkerTask,
  Organization,
  PLAN_FEATURES,
  type OrganizationPlan,
} from "../models/index.js";
import { getECSTaskRunner } from "./ecs-task-runner.js";
import {
  getProviderCredentials,
} from "../config/index.js";
import { logger } from "../utils/logger.js";
import { isValidProviderId, type ProviderId } from "../providers/types.js";
import { executeSupportAgentTask } from "./support-agent-executor.js";
import {
  getOrgCredentials,
  getReviewerGitHubToken,
  type OrgCredentials,
} from "./org-credentials.js";
import { localEpicSpawner } from "./local-epic-spawner.js";
import { spawnMockWorker } from "./mock-worker.js";
import { incrementTaskUsage } from "./billing.js";
import {
  notifyTaskFailed,
} from "./notifications.js";
import { publishStoriesReady } from "./pipeline-executor.js";
import {
  claimWarmContainer,
  assignTaskToContainer,
  buildTaskEnvironment,
  maintainAllWarmPools,
} from "./warm-pool.js";
import { checkAndUnblockDependentTasks } from "./task-monitor.js";
import {
  logTaskEvent,
  state,
} from "./orchestrator-utils.js";


/**
 * Spawn an ECS worker for a task
 */
export async function spawnWorker(task: WorkerTask): Promise<void> {
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

      // Simulate completion after short delay — atomic update
      await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "completed",
          completedAt: new Date(),
          planningNotes: "DRY RUN: Simulated worker execution",
        } as Record<string, unknown>)
        .where("id = :id", { id: task.id })
        .execute();

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

      // MOCK WORKER MODE: Use lightweight mock instead of Docker container
      if (process.env.MOCK_WORKERS === "true") {
        logger.info("[MockWorker] Mock worker mode active, skipping Docker spawn", {
          taskId: task.id,
          jiraKey: task.jiraIssueKey,
        });

        // Update task status to executing — atomic update (same pattern as real workers)
        await taskRepo
          .createQueryBuilder()
          .update(WorkerTask)
          .set({ status: "executing", startedAt: new Date() } as Record<string, unknown>)
          .where("id = :id", { id: task.id })
          .execute();

        // Resolve API key from org
        const orgRepo = AppDataSource.getRepository(Organization);
        const org = await orgRepo.findOne({ where: { id: task.orgId } });
        const apiKey = process.env.ORG_API_KEY || process.env.PLATFORM_API_KEY || "local-dev";
        const port = process.env.PORT || 3001;
        const apiBaseUrl = `http://localhost:${port}`;

        // Fire-and-forget — mock worker runs asynchronously
        spawnMockWorker({
          taskId: task.id,
          apiBaseUrl,
          apiKey,
          jiraIssueKey: task.jiraIssueKey || "E2E-1",
          summary: task.summary || "Mock task",
        }).catch((error) => {
          logger.error("[MockWorker] Mock worker failed", {
            taskId: task.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });

        state.tasksProcessed++;
        return; // Skip Docker container spawn
      }

      // Update task status to executing — atomic update
      await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({ status: "executing", startedAt: new Date() } as Record<string, unknown>)
        .where("id = :id", { id: task.id })
        .execute();

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

      // Fetch credentials from Secrets Manager (same as ECS path)
      // This provides GitHub token, reviewer token, and SCM credentials
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

        // Fetch reviewer token for PR approvals (same as ECS path)
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

      // Spawn local Epic Coordinator asynchronously
      localEpicSpawner
        .spawnEpicCoordinator(task, localCredentials ? {
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
        } : undefined)
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

    // Enforce plan limits: Pro plan cannot use cloud execution (ECS)
    if (org) {
      const planFeatures =
        PLAN_FEATURES[org.plan as OrganizationPlan] ?? PLAN_FEATURES.pro;
      if (!planFeatures.cloudExecution) {
        logger.warn("Cloud execution blocked for plan without cloud access", {
          taskId: task.id,
          orgId: org.id,
          plan: org.plan,
        });
        throw new Error(
          "Cloud execution requires Pro plan or higher. Use local execution mode instead.",
        );
      }
    }

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

    // Update status to environment_setup — atomic update
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({ status: "environment_setup" } as Record<string, unknown>)
      .where("id = :id", { id: task.id })
      .execute();

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
        blockOnLintErrors: org.blockOnLintErrors ?? false,
        blockOnE2EFailures: org.blockOnE2EFailures ?? false,
        autoFixEnabled: org.autoFixEnabled ?? false,
        autoFixMaxIterations: org.autoFixMaxIterations,
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
      additionalEnv.SELF_REVIEW_ENABLED = hasSelfReviewLabel || (org.selfReviewEnabled === true) ? "true" : "false";
      // Other resilience settings
      additionalEnv.BLOCKER_MAX_AUTO_RETRIES = String(org.blockerMaxAutoRetries);
      additionalEnv.BLOCKER_AUTO_RETRY_ENABLED = org.blockerAutoRetryEnabled !== false ? "true" : "false";
      additionalEnv.MAX_FIX_RETRIES = String(org.maxFixRetries);
      if (org.maxAgentTurns != null) additionalEnv.MAX_AGENT_TURNS = String(org.maxAgentTurns);
      additionalEnv.BLOCKER_WAIT_TIMEOUT_MINUTES = String(org.blockerWaitTimeoutMinutes);
      additionalEnv.PUSH_AFTER_COMMIT = org.pushAfterCommit !== false ? "true" : "false";
      additionalEnv.GRACEFUL_SHUTDOWN_ENABLED = org.gracefulShutdownEnabled !== false ? "true" : "false";
      // Intent Engineering — org guidelines flow into worker system prompt
      if (org.aiGuidelines) {
        additionalEnv.ORG_GUIDELINES = org.aiGuidelines;
      }
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

      // Update task with ECS info from warm container — atomic update
      await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          ecsTaskArn: warmContainer.ecsTaskArn,
          ecsTaskId: warmContainer.ecsTaskId,
          status: "executing",
          startedAt: new Date(),
        } as Record<string, unknown>)
        .where("id = :id", { id: task.id })
        .execute();

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

      // Update task with ECS info — atomic update
      await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          ecsTaskArn: result.taskArn,
          ecsTaskId: result.taskId,
          status: "executing",
          startedAt: new Date(),
        } as Record<string, unknown>)
        .where("id = :id", { id: task.id })
        .execute();
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

    // Mark task as failed — atomic update
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Failed to spawn worker",
        completedAt: new Date(),
      } as Record<string, unknown>)
      .where("id = :id", { id: task.id })
      .execute();
    await notifyTaskFailed(task);

    state.errors++;
    throw error;
  }
}
