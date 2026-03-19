/**
 * Planning Workflow — Find, claim, and run planning for tasks
 *
 * Extracted from orchestrator.ts.
 * Used by: orchestrator.ts (pollLoop)
 *
 * Contains:
 * - findPlanningTasks(): Find tasks needing PRD analysis
 * - claimPlanningTask(): Atomically claim a planning task
 * - processPlanningTask(): Route to V1/V2/V3 planning or re-plan with feedback
 * - processV2PipelinePlanning(): Planner-Critic loop for V2 pipeline
 * - processLocalPlanningAgent(): Local Claude CLI planning path (EXECUTION_MODE=local)
 */

import { AppDataSource } from "../db/connection.js";
import {
  WorkerTask,
  type WorkerPersona,
} from "../models/index.js";
import { logger } from "../utils/logger.js";
import { notifyTaskFailed } from "./notifications.js";
import { postTicketComment } from "../utils/ticket-comments.js";
import { costEvents } from "./cost-events.js";
import {
  planningProgressEmitter,
  type PlanningProgressEvent,
} from "./planning-progress-events.js";
import {
  runPlanningAgent,
  runPlanningAgentV2,
  runPlanningAgentV3,
  replanWithFeedback,
  shouldUseV2Planning,
  shouldUseV3Planning,
  TechStack,
} from "./planning-agent/index.js";
import {
  generateValidatedPlan,
  generatePlan,
  PlanValidationError,
  PlanProgressCallback,
  PlanningAgentConfig,
} from "./critic-agent.js";
import {
  getTaskRepo,
  getPlanningAgentPrefix,
  logTaskEvent,
} from "./orchestrator-utils.js";
import type { WorkerTaskStatus } from "../models/WorkerTask.js";

// ============================================================================
// TERMINAL VISIBILITY — matches remote agent output format
// ============================================================================

/**
 * Log planning messages to the terminal (console) in addition to the database.
 * Matches the remote agent's output format: [HH:MM:SS] [task-id] message
 *
 * This ensures local WorkerMill and cloud ECS show the same planning visibility
 * as the remote agent CLI.
 */
function logPlanningToTerminal(taskId: string, message: string): void {
  const now = new Date();
  const ts = now.toLocaleTimeString("en-US", { hour12: false });
  const shortId = taskId.substring(0, 8);
  console.log(`[${ts}] [${shortId}] ${message}`);
}
// Local planning path — used by processLocalPlanningAgent() for EXECUTION_MODE=local
import {
  runLocalPlanningAgent,
} from "./planning-agent-local.js";
import {
  runLocalCriticAgent,
  shouldUseLocalCritic,
  formatLocalRefinementFeedback,
} from "./critic-agent-local.js";
import { getOrgCredentials } from "./org-credentials.js";

/**
 * Find tasks that need planning (PRD analysis)
 *
 * These are tasks with `status: "planning"` that haven't been analyzed yet.
 * The Planning Agent will analyze them and create an execution plan.
 */
export async function findPlanningTasks(): Promise<WorkerTask[]> {
  const taskRepo = getTaskRepo();

  // Find tasks in planning status that need planning:
  // - planStatus IS NULL: new tasks that haven't been planned yet
  // - planStatus = 'changes_requested': user requested plan changes and task is back in planning
  // Load organization relation to access org settings (e.g., storyCalibrationMultiplier)
  //
  // REMOTE AGENT: Skip tasks from orgs that use remote agents.
  // 1. remoteAgentOnly orgs: cloud NEVER plans — agent is the only planner.
  // 2. Non-remoteAgentOnly orgs with active agents: skip if heartbeat < 2 min.
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
    // Hard gate: never plan for remoteAgentOnly orgs
    .andWhere("organization.remote_agent_only IS NOT TRUE")
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
  const skipPlanner =
    Array.isArray(labels) && labels.includes("skip-planner");

  logger.info("Starting V2 pipeline planning", {
    taskId: task.id,
    jiraIssueKey: task.jiraIssueKey,
    skipPlanner,
  });

  // RESUME LOGIC: Skip planning if this is a retry/resume with existing plan
  // This preserves the execution plan when resuming failed Epic tasks
  const hasExistingPlan =
    task.planJson &&
    ((task.planJson as { stories?: unknown[] }).stories?.length ||
      (task.planJson as { steps?: unknown[] }).steps?.length);
  const isRetryOrResume = (task.retryCount || 0) > 0;

  if (isRetryOrResume && hasExistingPlan) {
    logger.info("Skipping planning for retry/resume - using existing plan", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      retryCount: task.retryCount,
      storyCount:
        (task.planJson as { stories?: unknown[] }).stories?.length ||
        (task.planJson as { steps?: unknown[] }).steps?.length,
    });

    await logTaskEvent(
      task.id,
      "status_change",
      `[💡 planning_agent 🤖] Resuming with existing plan (retry #${task.retryCount}) - skipping re-planning`,
    );

    // Restore executionPlanV2 from planJson if needed — but ONLY if it's V2 format (has steps)
    // Epic-mode plans have "stories" not "steps" and should go through dispatchMultiStoryPlan instead
    if (!task.executionPlanV2 && task.planJson) {
      const plan = task.planJson as {
        steps?: unknown[];
        stories?: unknown[];
      };
      if (plan.steps?.length) {
        task.executionPlanV2 = task.planJson as unknown as import("./pipeline-v2-types.js").ExecutionPlanV2;
      }
      // If plan has stories (Epic mode), leave executionPlanV2 null so it routes through dispatchMultiStoryPlan
    }

    // Transition directly to queued — atomic update
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        status: "queued" as WorkerTask["status"],
        planStatus: "approved",
        executionPlanV2: task.executionPlanV2 ?? undefined,
      } as Record<string, unknown>)
      .where("id = :id", { id: task.id })
      .execute();
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

  if (skipPlanner) {
    // Build config from organization settings
    const agentConfig: PlanningAgentConfig = {
      provider: (task.organization?.planningAgentProvider || "anthropic") as
        | "anthropic"
        | "openai"
        | "google"
        | "ollama",
      model:
        task.organization?.planningAgentModel ||
        "claude-sonnet-4-5-20250929",
      orgId: task.orgId,
      ollamaBaseUrl: task.organization?.ollamaBaseUrl || undefined,
    };

    const prefix = getPlanningAgentPrefix(agentConfig.provider);

    const skipPlannerMsg = `${prefix} Skipping Critic validation (skip-planner label) - generating plan using ${agentConfig.provider}/${agentConfig.model}`;
    await logTaskEvent(task.id, "status_change", skipPlannerMsg);
    logPlanningToTerminal(task.id, skipPlannerMsg);

    try {
      // Generate plan with Claude but skip the Critic validation loop
      // This still creates proper multi-persona steps, just without iterative refinement
      const prd = `# ${task.summary}\n\n${task.description || ""}`;

      const executionPlanV2 = await generatePlan(prd, agentConfig);

      logger.info("V2 skip-planner: plan generated without validation", {
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        stepCount: executionPlanV2.steps.length,
        personas: executionPlanV2.steps.map((s) => s.persona),
      });

      const skipGenMsg = `${prefix} Plan generated (skip-planner): ${executionPlanV2.steps.length} steps`;
      await logTaskEvent(task.id, "status_change", skipGenMsg);
      logPlanningToTerminal(task.id, skipGenMsg);

      // Log each step
      for (const step of executionPlanV2.steps) {
        const stepMsg = `${prefix} Step ${step.index + 1}: [${step.persona}] ${step.title}`;
        await logTaskEvent(task.id, "info", stepMsg);
        logPlanningToTerminal(task.id, stepMsg);
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
          planJson: executionPlanV2 as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- TypeORM _QueryDeepPartialEntity incompatibility
          contextSidecar: [],
          commitHistory: [],
        })
        .where("id = :id AND claimed_by_agent IS NULL", { id: task.id })
        .execute();

      if ((skipPlannerTransition.affected || 0) === 0) {
        logger.info(
          "Aborting skip-planner save - remote agent claimed task during planning",
          {
            taskId: task.id,
          },
        );
        return;
      }

      const skipApprovedMsg = `${prefix} Plan auto-approved (skip-planner) - ready for multi-persona execution`;
      await logTaskEvent(task.id, "status_change", skipApprovedMsg);
      logPlanningToTerminal(task.id, skipApprovedMsg);

      // Post plan to Jira
      const planSummary = [
        `[V2 Pipeline - Execution Plan (Skip-Planner Mode)]`,
        ``,
        `**Mode:** Skip-planner (no Critic validation)`,
        `**Tech Stack:** ${executionPlanV2.techStack.language} / ${executionPlanV2.techStack.framework}`,
        ``,
        `**Steps (${executionPlanV2.steps.length}):**`,
        ...executionPlanV2.steps.map(
          (s) => `${s.index + 1}. [${s.persona}] ${s.title}`,
        ),
        ``,
        `Plan auto-approved. Sequential multi-persona execution starting...`,
      ].join("\n");

      if (task.jiraIssueKey) {
        await postTicketComment(task.orgId, task.jiraIssueKey, planSummary);
      }

      return;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("V2 skip-planner planning failed", {
        taskId: task.id,
        error: errorMessage,
      });

      const skipFailMsg = `${prefix} Skip-planner planning failed: ${errorMessage}`;
      await logTaskEvent(task.id, "error", skipFailMsg);
      logPlanningToTerminal(task.id, skipFailMsg);

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
    provider: (task.organization?.planningAgentProvider || "anthropic") as
      | "anthropic"
      | "openai"
      | "google"
      | "ollama",
    model:
      task.organization?.planningAgentModel || "",
    orgId: task.orgId,
    ollamaBaseUrl: task.organization?.ollamaBaseUrl || undefined,
  };

  const prefix = getPlanningAgentPrefix(agentConfig.provider);
  const criticStatus = task.criticEnabled
    ? "with Critic validation"
    : "without Critic (add 'critic' label to enable)";
  const startMsg = `${prefix} Starting V2 Pipeline planning ${criticStatus} using ${agentConfig.provider}/${agentConfig.model}`;
  await logTaskEvent(task.id, "status_change", startMsg);
  logPlanningToTerminal(task.id, startMsg);

  try {
    // Construct PRD from task description
    const prd = `# ${task.summary}\n\n${task.description || ""}`;

    // Progress callback to stream Planner-Critic iterations to task logs AND terminal
    const progressCallback: PlanProgressCallback = async (
      message,
      details,
    ) => {
      await logTaskEvent(task.id, "info", message, {
        metadata: details ? { plannerCritic: details } : undefined,
      });
      // Echo to terminal for local visibility (matches remote agent format)
      logPlanningToTerminal(task.id, message);
    };

    // Real-time stream progress callback for SSE planning progress bar on dashboard
    const streamProgressCallback = (event: PlanningProgressEvent) => {
      planningProgressEmitter.emitProgress(task.id, event);
    };

    // Generate and validate plan with Planner-Critic loop
    // Skip critic validation if criticEnabled is false (no 'critic' label)
    const skipCritic = !task.criticEnabled;

    // Simplified planning mode: run planner once, critic once, always approve
    // Achieved by setting maxAttempts=1 — generateValidatedPlan will do one
    // iteration and use best-plan fallback if critic rejects
    const jiraFields = (task.jiraFields ?? {}) as Record<string, unknown>;
    const isBuildPageTask = jiraFields.buildPage === true;
    const org = task.organization;
    // Task planning is always simplified; only full builds use the configurable mode
    const orgPlanningMode = isBuildPageTask
      ? (org?.prdPlanningMode || org?.planningMode || "simplified")
      : "simplified";
    const maxAttempts = orgPlanningMode === "simplified" ? 1 : 3;

    // Periodic heartbeat log so the terminal doesn't appear dead during planning.
    // First update at 30s, then every 60s — minimal, not spammy.
    const planStartTime = Date.now();
    let planHeartbeatInterval: ReturnType<typeof setInterval> | null = null;

    const logPlanningHeartbeat = () => {
      const elapsed = Math.round((Date.now() - planStartTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      const heartbeatMsg = `${prefix} Planning in progress — analyzing requirements and decomposing into steps (${timeStr} elapsed)`;
      logTaskEvent(task.id, "info", heartbeatMsg).catch(() => {});
      logPlanningToTerminal(task.id, heartbeatMsg);
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
      executionPlanV2 = await generateValidatedPlan(
        prd,
        agentConfig,
        maxAttempts,
        progressCallback,
        skipCritic,
        streamProgressCallback,
        task.organization?.maxTargetFiles,
      );
    } finally {
      clearPlanningHeartbeat();
    }

    logger.info("V2 plan validated successfully", {
      taskId: task.id,
      stepCount: executionPlanV2.steps.length,
      criticScore: executionPlanV2.criticScore,
      techStack: executionPlanV2.techStack.framework,
    });

    const validatedMsg = `${prefix} Plan validated: ${executionPlanV2.steps.length} steps, score ${executionPlanV2.criticScore}/100`;
    await logTaskEvent(task.id, "status_change", validatedMsg);
    logPlanningToTerminal(task.id, validatedMsg);

    // Log each step
    for (const step of executionPlanV2.steps) {
      const stepMsg = `${prefix} Step ${step.index + 1}: [${step.persona}] ${step.title}`;
      await logTaskEvent(task.id, "info", stepMsg);
      logPlanningToTerminal(task.id, stepMsg);
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
        planJson: executionPlanV2 as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- TypeORM _QueryDeepPartialEntity incompatibility
        contextSidecar: [],
        commitHistory: [],
      })
      .where("id = :id AND claimed_by_agent IS NULL", { id: task.id })
      .execute();

    if ((planTransition.affected || 0) === 0) {
      logger.info(
        "Aborting plan save - remote agent claimed task during planning",
        {
          taskId: task.id,
        },
      );
      return;
    }

    // Emit real-time cost event so dashboard updates immediately (ported from local path)
    if (
      task.estimatedCostUsd ||
      task.planningInputTokens ||
      task.planningOutputTokens
    ) {
      costEvents.emitCostUpdate({
        taskId: task.id,
        orgId: task.orgId,
        inputTokens: task.inputTokens || 0,
        outputTokens: task.outputTokens || 0,
        estimatedCostUsd: task.estimatedCostUsd || 0,
        timestamp: new Date().toISOString(),
      });
    }

    const approvedMsg = `${prefix} Plan approved - ready for sequential execution`;
    await logTaskEvent(task.id, "status_change", approvedMsg);
    logPlanningToTerminal(task.id, approvedMsg);

    // Post plan to Jira
    const planSummary = [
      `[V2 Pipeline - Execution Plan]`,
      ``,
      `**Critic Score:** ${executionPlanV2.criticScore}/100`,
      `**Tech Stack:** ${executionPlanV2.techStack.language} / ${executionPlanV2.techStack.framework}`,
      ``,
      `**Steps (${executionPlanV2.steps.length}):**`,
      ...executionPlanV2.steps.map(
        (s) => `${s.index + 1}. [${s.persona}] ${s.title}`,
      ),
      ``,
      `Plan auto-approved by Critic Agent. Sequential execution starting...`,
    ].join("\n");

    if (task.jiraIssueKey) {
      await postTicketComment(task.orgId, task.jiraIssueKey, planSummary);
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

      const validationFailMsg = `${prefix} Plan validation failed after ${error.iterations} iterations (score: ${error.lastScore}/100)`;
      await logTaskEvent(task.id, "error", validationFailMsg);
      logPlanningToTerminal(task.id, validationFailMsg);

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
        logger.info(
          "Skipping plan escalation - remote agent claimed task",
          { taskId: task.id },
        );
        return;
      }
      // Set JSON field via atomic update (avoids clobbering concurrent changes)
      await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          planJson: {
            validationFailed: true,
            iterations: error.iterations,
            lastScore: error.lastScore,
            risks: error.lastRisks,
            suggestions: error.lastSuggestions,
          },
        } as Record<string, unknown>)
        .where("id = :id", { id: task.id })
        .execute();

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
        await postTicketComment(
          task.orgId,
          task.jiraIssueKey,
          escalationMessage,
        );
      }
    } else {
      // Unexpected error
      logger.error("V2 pipeline planning failed", {
        taskId: task.id,
        error: errorMessage,
      });

      const planFailMsg = `${prefix} V2 Planning failed: ${errorMessage}`;
      await logTaskEvent(task.id, "error", planFailMsg);
      logPlanningToTerminal(task.id, planFailMsg);

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
export async function processPlanningTask(task: WorkerTask): Promise<void> {
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
        "Starting task analysis with Planning Agent",
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
        "Using V3 inventory-based planning",
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
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    logger.error("Failed to analyze planning task", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      error: errorMessage,
    });

    // Log the error
    await logTaskEvent(
      task.id,
      "error",
      `Planning failed: ${errorMessage}`,
    );

    // Mark task as failed — atomic update
    const taskRepo = getTaskRepo();
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        status: "failed" as WorkerTask["status"],
        errorMessage: `Planning Agent failed: ${errorMessage}`,
      })
      .where("id = :id", { id: task.id })
      .execute();
    await notifyTaskFailed(task);
  }
}

/**
 * Local planning agent path — uses Claude CLI directly via OAuth.
 *
 * Called by processV2PipelinePlanning() when EXECUTION_MODE=local.
 * Spawns a local Claude CLI process for planning (no API key needed),
 * applies file cap, runs critic if enabled, then transitions task to queued.
 */
async function processLocalPlanningAgent(
  task: WorkerTask,
  taskRepo: ReturnType<typeof getTaskRepo>,
): Promise<void> {
  const prefix = "[💡 planning_agent 🤖]";
  const targetRepo =
    task.githubRepo || process.env.TARGET_REPO_PATH || "unknown";

  await logTaskEvent(
    task.id,
    "status_change",
    `${prefix} Starting local planning with Claude CLI (OAuth)`,
  );

  await logTaskEvent(
    task.id,
    "info",
    `${prefix} Target repository: ${targetRepo}`,
  );

  try {
    // Fetch SCM token so the local planner can clone the target repo
    let scmToken: string | undefined;
    if (task.githubRepo && task.orgId) {
      try {
        const creds = await getOrgCredentials(task.orgId);
        scmToken = creds.scmToken || creds.githubToken || undefined;
      } catch (credErr) {
        logger.warn("Could not fetch SCM token for local planner — will use TARGET_REPO_PATH fallback", {
          taskId: task.id,
          error: credErr instanceof Error ? credErr.message : String(credErr),
        });
      }
    }

    // Construct planning input from task
    const planningInput = {
      taskId: task.id,
      title: task.summary || task.jiraIssueKey || "Unnamed Task",
      description: task.description || "",
      jiraIssueKey: task.jiraIssueKey || undefined,
      labels: (task.jiraFields as Record<string, unknown>)?.labels as
        | string[]
        | undefined,
      githubRepo: task.githubRepo || undefined,
      scmProvider: task.scmProvider || undefined,
      scmToken,
    };

    // Run local planning agent with milestone logs + real-time progress via emitter
    const plan = await runLocalPlanningAgent(
      planningInput,
      (milestone) => {
        logTaskEvent(task.id, "info", `${prefix} ${milestone}`).catch(
          () => {},
        );
      },
      (event) => {
        planningProgressEmitter.emitProgress(task.id, event);
      },
    );

    // Update planning token usage on the task for cost tracking — atomic increment
    if (plan.usage) {
      await AppDataSource.query(
        `UPDATE "worker_tasks"
         SET "planningInputTokens" = COALESCE("planningInputTokens", 0) + $1,
             "planningOutputTokens" = COALESCE("planningOutputTokens", 0) + $2
         WHERE "id" = $3`,
        [plan.usage.inputTokens, plan.usage.outputTokens, task.id],
      );
      // Re-fetch to get accurate totals for cost calculation
      const updated = await taskRepo.findOne({ where: { id: task.id } });
      if (updated) {
        const newCost = updated.calculateCost();
        await taskRepo
          .createQueryBuilder()
          .update(WorkerTask)
          .set({ estimatedCostUsd: newCost } as Record<string, unknown>)
          .where("id = :id", { id: task.id })
          .execute();
        task.planningInputTokens = updated.planningInputTokens;
        task.planningOutputTokens = updated.planningOutputTokens;
        task.estimatedCostUsd = newCost;
      }
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

    // Normalize targetFiles arrays (ensure they exist) — no truncation
    for (const story of plan.stories) {
      if (!story.targetFiles || !Array.isArray(story.targetFiles)) {
        story.targetFiles = [];
      }
    }

    await logTaskEvent(
      task.id,
      "info",
      `${prefix} Plan created: ${plan.stories.length} stories`,
    );

    // Log each story
    for (const story of plan.stories) {
      await logTaskEvent(
        task.id,
        "info",
        `${prefix} Story ${story.id}: [${story.persona}] ${story.title} (${story.estimatedEffort})`,
      );
    }

    // Run critic if enabled (criticEnabled flag or 'critic' label)
    let criticScore = 100; // Default auto-approved
    if (task.criticEnabled && shouldUseLocalCritic()) {
      await logTaskEvent(
        task.id,
        "status_change",
        `${prefix} Running Critic Agent for plan validation`,
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
        `${prefix} Critic score: ${criticScore}/100 - ${criticResult.approved ? "approved" : "needs revision"}`,
      );

      if (!criticResult.approved) {
        // Store partial info and mark for manual approval — atomic update
        await taskRepo
          .createQueryBuilder()
          .update(WorkerTask)
          .set({
            status: "pending_plan_approval",
            planStatus: "pending_approval",
            planJson: {
              localPlan: plan,
              criticFeedback: criticResult,
            },
          } as Record<string, unknown>)
          .where("id = :id", { id: task.id })
          .execute();
        return;
      }

      // Approved — run refinement pass if critic has suggestions
      const hasFeedback =
        criticResult.risks.length > 0 ||
        (criticResult.suggestions && criticResult.suggestions.length > 0) ||
        (criticResult.storyFeedback && criticResult.storyFeedback.length > 0);

      if (hasFeedback) {
        await logTaskEvent(
          task.id,
          "info",
          `${prefix} Running refinement pass — incorporating reviewer suggestions...`,
        );

        try {
          const refinementFeedback = formatLocalRefinementFeedback(criticResult, undefined, plan);
          const refinedPlan = await runLocalPlanningAgent(
            {
              ...planningInput,
              refinementFeedback,
            },
            (milestone) => {
              logTaskEvent(task.id, "info", `${prefix} [refinement] ${milestone}`).catch(() => {});
            },
            (event) => {
              planningProgressEmitter.emitProgress(task.id, event);
            },
          );

          // Replace plan stories with refined versions
          plan.stories = refinedPlan.stories;
          plan.risks = refinedPlan.risks;
          plan.assumptions = refinedPlan.assumptions;
          if ("storiesV2" in refinedPlan) {
            (plan as typeof refinedPlan).storiesV2 = refinedPlan.storiesV2;
          }
          if ("mutexGroups" in refinedPlan) {
            (plan as typeof refinedPlan).mutexGroups = refinedPlan.mutexGroups;
          }

          await logTaskEvent(
            task.id,
            "info",
            `${prefix} Refinement complete — plan updated with reviewer suggestions`,
          );
        } catch (refineErr) {
          const errMsg = refineErr instanceof Error ? refineErr.message : String(refineErr);
          logger.warn("Refinement pass failed, using original approved plan", {
            taskId: task.id,
            error: errMsg,
          });
          await logTaskEvent(
            task.id,
            "info",
            `${prefix} ⚠️ Refinement pass failed (${errMsg.substring(0, 100)}) — using original approved plan`,
          );
          // Fall through with original plan
        }
      }
    }

    // Convert local plan to ExecutionPlanV2 format for compatibility
    // Use pre-validated V2 data if available (from planning-agent-local validation)
    const hasValidatedV2 =
      "storiesV2" in plan && plan.storiesV2?.length > 0;

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
          dependencies: story.dependencies
            .map((d) => plan.stories.findIndex((s) => s.id === d))
            .filter((i) => i >= 0),
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
        (step.dependencies || []).map((dep) => ({
          from: dep,
          to: step.index,
        })),
      ),
      risks: plan.risks,
      assumptions: plan.assumptions,
      criticScore,
      // Include mutex groups if available from validation
      mutexGroups: hasValidatedV2
        ? (plan as { mutexGroups?: Record<string, number[]> }).mutexGroups
        : undefined,
    };

    if (hasValidatedV2) {
      logger.info("Using pre-validated V2 plan data", {
        taskId: task.id,
        stepCount: steps.length,
        mutexGroupCount: Object.keys(executionPlanV2.mutexGroups || {})
          .length,
        dependencies: steps.map((s) => ({
          index: s.index,
          deps: s.dependencies,
        })),
      });
    }

    // Store plan and transition to queued — atomic update
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        executionPlanV2: executionPlanV2 as unknown as WorkerTask["executionPlanV2"],
        status: "queued" as WorkerTask["status"],
        planStatus: "approved",
        planJson: executionPlanV2 as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- TypeORM _QueryDeepPartialEntity incompatibility
        currentStepIndex: 0,
        contextSidecar: [],
        commitHistory: [],
      } as Record<string, unknown>)
      .where("id = :id", { id: task.id })
      .execute();

    await logTaskEvent(
      task.id,
      "status_change",
      `${prefix} Plan approved (score: ${criticScore}) - ready for local Epic execution`,
    );

    logger.info("Local planning complete, task queued for execution", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      storyCount: plan.stories.length,
      criticScore,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    logger.error("Local planning agent failed", {
      taskId: task.id,
      error: errorMessage,
    });

    await logTaskEvent(
      task.id,
      "error",
      `${prefix} Planning failed: ${errorMessage}`,
    );

    // Atomic update to prevent clobbering concurrent changes
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        status: "failed" as WorkerTask["status"],
        errorMessage: `Local Planning Agent failed: ${errorMessage}`,
      })
      .where("id = :id", { id: task.id })
      .execute();
    await notifyTaskFailed(task);
  }
}
