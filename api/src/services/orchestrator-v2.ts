/**
 * WorkerMill Orchestrator V2 - Sequential Pipeline Runner
 *
 * This orchestrator handles V2 pipeline execution with vertical slice sequential steps.
 * Key differences from V1:
 * - Sequential execution: Single container, persona hot-swap per step
 * - Git commit history IS the state machine
 * - Built-in TDD with verification types per step
 * - Plan Repair and Smart Rewind on failure
 * - Simpler status model: planning -> executing -> done/failed
 *
 * Triggered by `prd-v2` Jira label for opt-in gradual rollout.
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
  type WorkerPersona,
} from "../models/index.js";
import { getECSTaskRunner } from "./ecs-task-runner.js";
import { config, getProviderCredentials } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { isValidProviderId, type ProviderId } from "../providers/types.js";
import { createPullRequest } from "../utils/github.js";
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
  orgApiKey?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  providerApiKey?: string;
  providerId?: ProviderId;
  ollamaBaseUrl?: string;
  ollamaContextWindow?: number;
  vllmBaseUrl?: string;
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
 */
async function getOrgCredentials(orgId: string): Promise<OrgCredentials> {
  const now = Date.now();
  const cached = credentialsCache.get(orgId);

  if (cached && cached.expiresAt > now) {
    return cached.credentials;
  }

  try {
    // Get org for API key
    const orgRepo = getOrgRepo();
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

    const credentials: OrgCredentials = {
      anthropicApiKey: anthropicSecret.SecretString || "",
      githubToken: githubSecret.SecretString || "",
      orgApiKey: org.apiKey || undefined,
      jiraBaseUrl,
      jiraEmail: jiraCredentials.email,
      jiraApiToken: jiraCredentials.api_token,
      ollamaBaseUrl: org.ollamaBaseUrl || undefined,
      ollamaContextWindow: org.ollamaContextWindow || 65536,
      vllmBaseUrl: org.vllmBaseUrl || undefined,
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
 * Check if a task should use V2 pipeline based on Jira labels
 */
export function shouldUseV2Pipeline(task: WorkerTask): boolean {
  // Check for explicit prd-v2 label
  const labels = (task.jiraFields as Record<string, unknown>)?.labels;
  if (Array.isArray(labels) && labels.includes("prd-v2")) {
    return true;
  }

  // Check if task already has pipelineVersion set to v2
  if (task.pipelineVersion === "v2") {
    return true;
  }

  return false;
}

/**
 * Main entry point for V2 pipeline execution.
 * Loops through steps sequentially, spawning workers for each step.
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

  const plan = task.executionPlanV2;
  const totalSteps = plan.steps.length;

  logger.info("Starting V2 sequential pipeline", {
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

  // Get credentials
  const credentials = await getOrgCredentials(task.orgId);

  // Fetch provider-specific API key if not using anthropic
  if (providerId !== "anthropic") {
    try {
      credentials.providerApiKey = await getProviderCredentials(
        task.orgId,
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
  let detectedConstraints: string[] = [];
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

    case "REWIND":
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

  if (!task.executionPlanV2) {
    throw new Error("Cannot create PR without execution plan");
  }

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

  // Create PR
  const prResult = await createPullRequest(task.githubRepo, {
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
