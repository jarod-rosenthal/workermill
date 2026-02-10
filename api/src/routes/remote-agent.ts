/**
 * Remote Agent API Endpoints
 *
 * These endpoints allow a remote agent process (running on a customer machine)
 * to poll for tasks, run planning locally via Claude CLI, and spawn Docker
 * worker containers that report back to the cloud dashboard.
 *
 * Authenticated via org API key (x-api-key header), same as worker-api.ts.
 *
 * Endpoints:
 *   GET  /api/agent/poll              - Poll for tasks needing planning or execution
 *   POST /api/agent/claim             - Atomically claim a task
 *   POST /api/agent/plan-result       - Post raw Claude CLI output for server-side validation
 *   POST /api/agent/started           - Report that a worker container has been spawned
 *   POST /api/agent/heartbeat         - Heartbeat for active tasks
 *   GET  /api/agent/config            - Get non-sensitive org settings
 *   GET  /api/agent/planning-prompt   - Get fully assembled planning prompt for a task
 *   POST /api/agent/planning-progress - Relay real-time planning progress to SSE
 */

import { Router, type Request, type Response } from "express";
import { authenticateApiKey } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { RemoteAgent } from "../models/RemoteAgent.js";
import { In } from "typeorm";
import { logger } from "../utils/logger.js";
import { buildPlanningPrompt, type PlanningInput } from "../services/planning-agent-local.js";
import { publishStoriesReady } from "../services/orchestrator-v2.js";
import {
  convertToV2Format,
  validateAndFixPlan,
  convertBackToExecutionPlan,
  parseExecutionPlan,
} from "../services/planning-agent-local.js";
import type { WorkerPersona } from "../models/WorkerTask.js";
import type { ExecutionPlanV2 } from "../services/pipeline-v2-types.js";
import { planningProgressEmitter } from "../services/planning-progress-events.js";
import { getOrgCredentials } from "../services/orchestrator-v2.js";

const router = Router();

// ─── Agent version constants ──────────────────────────────────────────────────
// Bump LATEST_AGENT_VERSION when publishing a new agent release.
// Bump MIN_AGENT_VERSION when old agents MUST update (breaking changes).
const LATEST_AGENT_VERSION = "0.6.0";
const MIN_AGENT_VERSION = "0.2.0";

/** Simple semver "less than" comparison (major.minor.patch only). */
function semverLt(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return true;
    if ((pa[i] || 0) > (pb[i] || 0)) return false;
  }
  return false;
}

// All remote agent endpoints require API key authentication
router.use(authenticateApiKey);

// ─── GET /poll ──────────────────────────────────────────────────────────────
// Remote agent polls for tasks that need planning or execution.
// Returns tasks in `planning` or `queued` status for the org.
router.get(
  "/poll",
  asyncHandler(async (req: Request, res: Response) => {
    const agentId = req.query.agentId as string;
    const org = req.organization!;

    if (!agentId) {
      res.status(400).json({ error: "agentId query parameter is required" });
      return;
    }

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Find tasks in planning or queued status for this org.
    // Exclude tasks with planStatus = "pending_approval" — those are being planned by
    // the cloud orchestrator. Letting the agent claim them wastes the cloud's planning effort.
    const tasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.org_id = :orgId", { orgId: org.id })
      .andWhere(
        `(
          (task.status = 'planning' AND (task.plan_status IS NULL OR task.plan_status = 'changes_requested'))
          OR task.status = 'queued'
        )`,
      )
      .orderBy("task.created_at", "ASC")
      .take(5)
      .getMany();

    // Filter out tasks already claimed by a different agent
    const availableTasks = tasks.filter(
      (t) => !t.claimedByAgent || t.claimedByAgent === agentId,
    );

    // Find manager tasks (log analysis / PR review) for the remote agent
    // These are tasks that would normally be handled by ECS manager spawns
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const managerTasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.org_id = :orgId", { orgId: org.id })
      .andWhere(
        `(
          (task.status IN ('completed', 'failed', 'deployed') AND task.manager_enabled = true AND task.manager_analysis_done = false AND task.completed_at > :cutoff)
          OR
          (task.status IN ('pr_created', 'review_requested', 'pr_approved') AND task.skip_manager_review = false AND task.github_pr_number IS NOT NULL AND (task.manager_ecs_task_arn IS NULL OR task.manager_ecs_task_arn = '') AND (task.execution_mode IS NULL OR task.execution_mode NOT IN ('parallel', 'multi-expert')))
        )`,
        { cutoff: oneHourAgo },
      )
      .orderBy("task.updated_at", "ASC")
      .limit(3)
      .getMany();

    res.json({
      tasks: availableTasks.map((t) => ({
        id: t.id,
        status: t.status,
        summary: t.summary,
        description: t.description,
        jiraIssueKey: t.jiraIssueKey,
        workerPersona: t.workerPersona,
        workerModel: t.workerModel,
        workerProvider: t.workerProvider,
        githubRepo: t.githubRepo,
        scmProvider: t.scmProvider,
        executionMode: t.executionMode,
        criticEnabled: t.criticEnabled,
        skipManagerReview: t.skipManagerReview,
        deploymentEnabled: t.deploymentEnabled,
        improvementEnabled: t.improvementEnabled,
        qualityGateBypass: t.qualityGateBypass,
        standardSdkMode: t.standardSdkMode,
        parentTaskId: t.parentTaskId,
        taskNotes: t.taskNotes,
        githubPrUrl: t.githubPrUrl,
        githubPrNumber: t.githubPrNumber,
        createdAt: t.createdAt,
      })),
      managerTasks: managerTasks.map((t) => ({
        id: t.id,
        status: t.status,
        summary: t.summary,
        description: t.description,
        jiraIssueKey: t.jiraIssueKey,
        githubRepo: t.githubRepo,
        scmProvider: t.scmProvider,
        githubPrUrl: t.githubPrUrl,
        githubPrNumber: t.githubPrNumber,
        managerEnabled: t.managerEnabled,
        managerAnalysisDone: t.managerAnalysisDone,
        skipManagerReview: t.skipManagerReview,
        // Determine which action the manager should take
        managerAction: t.managerEnabled && !t.managerAnalysisDone && ["completed", "failed", "deployed"].includes(t.status)
          ? "analyze_logs" as const
          : "review_pr" as const,
      })),
    });
  }),
);

// ─── POST /claim ────────────────────────────────────────────────────────────
// Atomically claim a task for the remote agent.
router.post(
  "/claim",
  asyncHandler(async (req: Request, res: Response) => {
    const { taskId, agentId } = req.body;
    const org = req.organization!;

    if (!taskId || !agentId) {
      res.status(400).json({ error: "taskId and agentId are required" });
      return;
    }

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Atomic claim: only succeeds if task is still in planning/queued and unclaimed
    const result = await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        claimedByAgent: agentId,
        agentHeartbeatAt: new Date(),
      })
      .where(
        "id = :id AND org_id = :orgId AND status IN (:...statuses) AND (claimed_by_agent IS NULL OR claimed_by_agent = :agentId)",
        { id: taskId, orgId: org.id, statuses: ["planning", "queued"], agentId },
      )
      .execute();

    if ((result.affected || 0) === 0) {
      res.json({ claimed: false });
      return;
    }

    // Return full task details on successful claim
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
      relations: ["organization"],
    });

    // Fetch org credentials from Secrets Manager for the remote agent
    // These are the org's own credentials configured in Settings > Integrations
    let credentials: Record<string, string | undefined> = {};
    try {
      const orgCreds = await getOrgCredentials(org.id);
      credentials = {
        jiraBaseUrl: orgCreds.jiraBaseUrl,
        jiraEmail: orgCreds.jiraEmail,
        jiraApiToken: orgCreds.jiraApiToken,
        linearApiKey: orgCreds.linearApiKey,
        managerProvider: orgCreds.managerProvider,
        managerModelId: orgCreds.managerModelId,
        customerAwsAccessKeyId: orgCreds.customerAwsAccessKeyId,
        customerAwsSecretAccessKey: orgCreds.customerAwsSecretAccessKey,
        customerAwsRegion: orgCreds.customerAwsRegion,
        customerAwsRoleArn: orgCreds.customerAwsRoleArn,
        customerAwsExternalId: orgCreds.customerAwsExternalId,
        issueTrackerProvider: orgCreds.issueTrackerProvider,
        bitbucketEmail: orgCreds.bitbucketEmail,
        githubReviewerToken: orgCreds.githubReviewerToken,
        scmBaseUrl: orgCreds.scmBaseUrl,
        // AI provider API keys for multi-provider planning & execution
        anthropicApiKey: orgCreds.anthropicApiKey,
        openaiApiKey: orgCreds.openaiApiKey,
        googleApiKey: orgCreds.googleApiKey,
        ollamaBaseUrl: orgCreds.ollamaBaseUrl || org.ollamaBaseUrl || undefined,
        ollamaContextWindow: orgCreds.ollamaContextWindow ? String(orgCreds.ollamaContextWindow) : undefined,
        vllmBaseUrl: orgCreds.vllmBaseUrl,
      };
    } catch (err) {
      logger.warn("Failed to fetch org credentials for remote agent", {
        taskId,
        orgId: org.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info("Remote agent claimed task", {
      taskId,
      agentId,
      orgId: org.id,
      status: task?.status,
    });

    res.json({
      claimed: true,
      task: task
        ? {
            id: task.id,
            orgId: task.orgId,
            status: task.status,
            summary: task.summary,
            description: task.description,
            jiraIssueKey: task.jiraIssueKey,
            workerPersona: task.workerPersona,
            workerModel: task.workerModel,
            workerProvider: task.workerProvider,
            githubRepo: task.githubRepo,
            scmProvider: task.scmProvider,
            executionMode: task.executionMode,
            criticEnabled: task.criticEnabled,
            skipManagerReview: task.skipManagerReview,
            deploymentEnabled: task.deploymentEnabled,
            improvementEnabled: task.improvementEnabled,
            qualityGateBypass: task.qualityGateBypass,
            standardSdkMode: task.standardSdkMode,
            parentTaskId: task.parentTaskId,
            retryCount: task.retryCount,
            pipelineVersion: task.pipelineVersion,
            executionPlanV2: task.executionPlanV2,
            jiraFields: task.jiraFields,
            taskNotes: task.taskNotes,
            githubPrUrl: task.githubPrUrl,
            githubPrNumber: task.githubPrNumber,
          }
        : null,
      credentials,
    });
  }),
);

// ─── POST /claim-manager ─────────────────────────────────────────────────────
// Claim a manager task (log analysis or PR review) for the remote agent.
// Sets managerEcsTaskArn to 'remote-agent' to prevent duplicate claims.
router.post(
  "/claim-manager",
  asyncHandler(async (req: Request, res: Response) => {
    const { taskId, agentId, action } = req.body;
    const org = req.organization!;

    if (!taskId || !agentId || !action) {
      res.status(400).json({ error: "taskId, agentId, and action are required" });
      return;
    }

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    if (action === "analyze_logs") {
      // Atomic claim: only succeed if manager_analysis_done is still false
      const result = await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          managerAnalysisDone: true,
          managerEcsTaskArn: `remote-agent:${agentId}`,
        })
        .where(
          "id = :id AND org_id = :orgId AND manager_enabled = true AND manager_analysis_done = false",
          { id: taskId, orgId: org.id },
        )
        .execute();

      if ((result.affected || 0) === 0) {
        res.json({ claimed: false });
        return;
      }
    } else if (action === "review_pr") {
      // Atomic claim: only succeed if manager_ecs_task_arn is empty
      const result = await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "manager_review" as WorkerTask["status"],
          managerEcsTaskArn: `remote-agent:${agentId}`,
        })
        .where(
          "id = :id AND org_id = :orgId AND status IN (:...statuses) AND (manager_ecs_task_arn IS NULL OR manager_ecs_task_arn = '')",
          { id: taskId, orgId: org.id, statuses: ["pr_created", "review_requested", "pr_approved"] },
        )
        .execute();

      if ((result.affected || 0) === 0) {
        res.json({ claimed: false });
        return;
      }
    } else {
      res.status(400).json({ error: "action must be 'analyze_logs' or 'review_pr'" });
      return;
    }

    // Return task details and credentials
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    let credentials: Record<string, string | undefined> = {};
    try {
      const orgCreds = await getOrgCredentials(org.id);
      credentials = {
        managerProvider: orgCreds.managerProvider,
        managerModelId: orgCreds.managerModelId,
        anthropicApiKey: orgCreds.anthropicApiKey,
        openaiApiKey: orgCreds.openaiApiKey,
        googleApiKey: orgCreds.googleApiKey,
        ollamaBaseUrl: orgCreds.ollamaBaseUrl || org.ollamaBaseUrl || undefined,
        jiraBaseUrl: orgCreds.jiraBaseUrl,
        jiraEmail: orgCreds.jiraEmail,
        jiraApiToken: orgCreds.jiraApiToken,
        linearApiKey: orgCreds.linearApiKey,
        issueTrackerProvider: orgCreds.issueTrackerProvider,
      };
    } catch (err) {
      logger.warn("Failed to fetch org credentials for manager claim", {
        taskId,
        orgId: org.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info("Remote agent claimed manager task", {
      taskId,
      agentId,
      action,
      orgId: org.id,
    });

    res.json({
      claimed: true,
      task: task
        ? {
            id: task.id,
            status: task.status,
            summary: task.summary,
            description: task.description,
            jiraIssueKey: task.jiraIssueKey,
            githubRepo: task.githubRepo,
            scmProvider: task.scmProvider,
            githubPrUrl: task.githubPrUrl,
            githubPrNumber: task.githubPrNumber,
            reviewFeedback: task.reviewFeedback,
          }
        : null,
      credentials,
    });
  }),
);

// ─── POST /plan-result ──────────────────────────────────────────────────────
// Agent posts raw Claude CLI output for server-side validation and plan building.
router.post(
  "/plan-result",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      taskId,
      rawOutput,
      agentId,
      criticScore: agentCriticScore,
      criticRisks: agentCriticRisks,
      criticHistory: agentCriticHistory,
      criticIterations: agentCriticIterations,
      fileCapTruncations: agentFileCapTruncations,
      planningDurationMs: agentPlanningDurationMs,
    } = req.body;
    const org = req.organization!;

    if (!taskId || !rawOutput) {
      res.status(400).json({ error: "taskId and rawOutput are required" });
      return;
    }

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Verify agent owns this task (skip check if agentId not provided for backward compat)
    if (agentId && task.claimedByAgent && task.claimedByAgent !== agentId) {
      res.status(403).json({ error: "Task not claimed by this agent" });
      return;
    }

    try {
      // Parse execution plan from raw output
      const rawPlan = parseExecutionPlan(rawOutput);

      // Convert to V2 format for validation
      const { themes, stories: storiesV2, mutexGroups } = convertToV2Format(rawPlan);

      // Validate and auto-fix
      const validated = validateAndFixPlan(themes, storiesV2, taskId);

      // Convert back to ExecutionPlan format with V2 data attached
      const finalPlan = convertBackToExecutionPlan(rawPlan, validated.stories, mutexGroups);

      // Build executionPlanV2 for the coordinator
      const steps = validated.stories.map((story) => ({
        index: story.index,
        persona: story.persona as WorkerPersona,
        title: story.title,
        description: story.scope,
        acceptanceCriteria: story.acceptanceCriteria,
        dependencies: story.dependencies,
        estimatedEffort: story.estimatedComplexity,
        targetFiles: story.targetFiles,
        phase: story.phase,
        canonicalOrder: story.canonicalOrder,
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
        risks: finalPlan.risks,
        assumptions: finalPlan.assumptions,
        criticScore: typeof agentCriticScore === "number" ? agentCriticScore : 100,
        criticRisks: Array.isArray(agentCriticRisks) ? agentCriticRisks : [],
        mutexGroups,
        metadata: {
          ...(typeof agentCriticIterations === "number" && { iterationCount: agentCriticIterations }),
          ...(Array.isArray(agentCriticHistory) && { criticHistory: agentCriticHistory }),
          ...(typeof agentFileCapTruncations === "number" && { fileCapTruncations: agentFileCapTruncations }),
          ...(typeof agentPlanningDurationMs === "number" && { planningDurationMs: agentPlanningDurationMs }),
          generatedAt: new Date().toISOString(),
        },
      };

      // Atomic transition: planning → queued with all fields in one UPDATE.
      // Setting JSON fields in the same UPDATE avoids a race window where the task
      // is queued but executionPlanV2 is still null.
      const transitionResult = await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "queued" as WorkerTask["status"],
          planStatus: "approved",
          currentStepIndex: 0,
          executionPlanV2: executionPlanV2 as unknown as ExecutionPlanV2,
          planJson: executionPlanV2 as any,
          contextSidecar: [],
          commitHistory: [],
        })
        .where("id = :id AND org_id = :orgId AND status = :status", {
          id: taskId,
          orgId: org.id,
          status: "planning",
        })
        .execute();

      if ((transitionResult.affected || 0) === 0) {
        const current = await taskRepo.findOne({
          where: { id: taskId, orgId: org.id },
        });
        res
          .status(409)
          .json({
            error: `Task is in '${current?.status}' state, expected 'planning'`,
          });
        return;
      }

      logger.info("Remote agent plan result processed", {
        taskId,
        orgId: org.id,
        storyCount: rawPlan.stories.length,
      });

      res.json({
        taskId,
        status: "queued",
        storyCount: rawPlan.stories.length,
        message: "Plan validated and approved. Task is now queued for execution.",
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to process remote agent plan result", {
        taskId,
        orgId: org.id,
        error: errorMessage,
      });

      // Mark task as failed if plan parsing fails
      task.status = "failed";
      task.errorMessage = `Plan validation failed: ${errorMessage}`;
      await taskRepo.save(task);

      res.status(422).json({
        error: "Plan validation failed",
        detail: errorMessage,
      });
    }
  }),
);

// ─── POST /started ──────────────────────────────────────────────────────────
// Agent reports it has spawned a worker container for a queued task.
router.post(
  "/started",
  asyncHandler(async (req: Request, res: Response) => {
    const { taskId, agentId } = req.body;
    const org = req.organization!;

    if (!taskId) {
      res.status(400).json({ error: "taskId is required" });
      return;
    }

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Verify agent owns this task (skip check if agentId not provided for backward compat)
    if (agentId && task.claimedByAgent && task.claimedByAgent !== agentId) {
      res.status(403).json({ error: "Task not claimed by this agent" });
      return;
    }

    // Atomic transition: queued → executing (prevents clobbering concurrent changes)
    const now = new Date();
    const updateResult = await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        status: "executing",
        startedAt: now,
        agentHeartbeatAt: now,
      })
      .where("id = :id AND org_id = :orgId AND status = :status", {
        id: taskId,
        orgId: org.id,
        status: "queued",
      })
      .execute();

    if ((updateResult.affected || 0) === 0) {
      res.status(409).json({ error: `Task is not in 'queued' state` });
      return;
    }

    // Publish stories ready messages to coordination feed
    // Uses the shared publisher that includes dependencies, targetFiles, and mutexGroups
    await publishStoriesReady(task);

    logger.info("Remote agent started task execution", {
      taskId,
      agentId,
      orgId: org.id,
    });

    res.json({ ok: true });
  }),
);

// ─── POST /heartbeat ────────────────────────────────────────────────────────
// Agent sends periodic heartbeat for active tasks.
router.post(
  "/heartbeat",
  asyncHandler(async (req: Request, res: Response) => {
    const { agentId, activeTasks, agentVersion } = req.body;
    const org = req.organization!;

    if (!agentId || !Array.isArray(activeTasks)) {
      res.status(400).json({ error: "agentId and activeTasks array are required" });
      return;
    }

    // ALWAYS update remote_agents table — even with no active tasks.
    // The orchestrator uses remote_agents.last_heartbeat_at to detect active agents
    // and skip their org's tasks. Without this, the agent appears offline after 2 min.
    const agentRepo = AppDataSource.getRepository(RemoteAgent);
    const setFields: Record<string, unknown> = {
      lastHeartbeatAt: new Date(),
      activeTasks: activeTasks.length,
      status: "online" as const,
    };
    if (agentVersion) {
      setFields.agentVersion = agentVersion;
    }
    await agentRepo
      .createQueryBuilder()
      .update(RemoteAgent)
      .set(setFields)
      .where("org_id = :orgId AND agent_id = :agentId", {
        orgId: org.id,
        agentId,
      })
      .execute();

    // Compute update flags for the agent
    const updateAvailable = agentVersion ? semverLt(agentVersion, LATEST_AGENT_VERSION) : false;
    const updateRequired = agentVersion ? semverLt(agentVersion, MIN_AGENT_VERSION) : false;

    if (activeTasks.length === 0) {
      res.json({ ok: true, updated: 0, cancelledTasks: [], updateAvailable, updateRequired, latestVersion: LATEST_AGENT_VERSION });
      return;
    }

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Batch update heartbeat for all active tasks
    const result = await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({ agentHeartbeatAt: new Date() })
      .where("id IN (:...ids) AND org_id = :orgId AND claimed_by_agent = :agentId", {
        ids: activeTasks,
        orgId: org.id,
        agentId,
      })
      .execute();

    // Check if any of the agent's active tasks have been cancelled via the dashboard
    const cancelledTasks = await taskRepo
      .createQueryBuilder("t")
      .select(["t.id"])
      .where("t.id IN (:...ids) AND t.org_id = :orgId AND t.status = :status", {
        ids: activeTasks,
        orgId: org.id,
        status: "cancelled",
      })
      .getMany();

    const cancelledIds = cancelledTasks.map((t) => t.id);
    if (cancelledIds.length > 0) {
      logger.info("Notifying agent of cancelled tasks", { agentId, cancelledIds });
    }

    res.json({ ok: true, updated: result.affected || 0, cancelledTasks: cancelledIds, updateAvailable, updateRequired, latestVersion: LATEST_AGENT_VERSION });
  }),
);

// ─── GET /config ────────────────────────────────────────────────────────────
// Returns non-sensitive org settings for agent configuration.
router.get(
  "/config",
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;

    res.json({
      maxConcurrentWorkers: org.maxConcurrentWorkers ?? 4,
      maxParallelExperts: org.maxParallelExperts ?? 4,
      defaultWorkerModel: org.defaultWorkerModel ?? "claude-sonnet-4-20250514",
      scmProvider: org.scmProvider ?? "github",
      defaultGithubRepo: org.defaultGithubRepo ?? null,
      defaultBitbucketRepo: org.defaultBitbucketRepo ?? null,
      defaultGitlabRepo: org.defaultGitlabRepo ?? null,
      blockerMaxAutoRetries: org.blockerMaxAutoRetries ?? 3,
      blockerAutoRetryEnabled: org.blockerAutoRetryEnabled !== false,
      pushAfterCommit: org.pushAfterCommit !== false,
      gracefulShutdownEnabled: org.gracefulShutdownEnabled !== false,
      selfReviewEnabled: org.selfReviewEnabled !== false,
      // Multi-provider settings
      primaryProvider: org.primaryProvider ?? "anthropic",
      planningAgentProvider: org.planningAgentProvider ?? "anthropic",
      planningAgentModel: org.planningAgentModel ?? null,
      providerRouting: org.providerRouting ?? {},
      ollamaBaseUrl: org.ollamaBaseUrl ?? null,
    });
  }),
);

// ─── GET /planning-prompt ───────────────────────────────────────────────────
// Returns the fully assembled planning prompt for a task.
router.get(
  "/planning-prompt",
  asyncHandler(async (req: Request, res: Response) => {
    const taskId = req.query.taskId as string;
    const org = req.organization!;

    if (!taskId) {
      res.status(400).json({ error: "taskId query parameter is required" });
      return;
    }

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (task.status !== "planning") {
      res.status(409).json({ error: `Task is in '${task.status}' state, expected 'planning'` });
      return;
    }

    // Build planning input from task
    const jiraFields = (task.jiraFields ?? {}) as Record<string, unknown>;
    const isBuildPageTask = jiraFields.buildPage === true;

    const planningInput: PlanningInput = {
      taskId: task.id,
      title: task.summary || task.jiraIssueKey || "Unnamed Task",
      description: task.description || "",
      jiraIssueKey: task.jiraIssueKey || undefined,
      labels: jiraFields.labels as string[] | undefined,
      stackTemplate: (jiraFields.stackTemplate as string) || undefined,
      maxParallelExperts: org.maxParallelExperts ?? 4,
    };

    const prompt = buildPlanningPrompt(planningInput);

    const provider = org.planningAgentProvider || org.primaryProvider || "anthropic";
    const isAnthropicPlanning = provider === "anthropic";

    // Model resolution: use provider-specific planning model, then fall back
    // Build page tasks use Opus 4.6 but only if planning via Anthropic
    let model: string;
    if (isBuildPageTask && isAnthropicPlanning) {
      model = "claude-opus-4-6";
    } else if (isAnthropicPlanning) {
      model = org.defaultWorkerModel || org.planningAgentModel || "sonnet";
    } else {
      // Non-Anthropic: planningAgentModel is the org-configured model for this provider
      model = org.planningAgentModel || org.defaultWorkerModel || "gpt-4o";
    }

    res.json({
      taskId: task.id,
      prompt,
      model,
      provider,
    });
  }),
);

// ─── POST /register ──────────────────────────────────────────────────────────
// Agent calls on startup to register/upsert itself in remote_agents table.
router.post(
  "/register",
  asyncHandler(async (req: Request, res: Response) => {
    const { agentId, hostname, platform, nodeVersion, dockerVersion, claudeVersion, maxWorkers, agentVersion } =
      req.body;
    const org = req.organization!;

    if (!agentId) {
      res.status(400).json({ error: "agentId is required" });
      return;
    }

    const agentRepo = AppDataSource.getRepository(RemoteAgent);

    // Upsert: insert or update on (org_id, agent_id) unique constraint
    await agentRepo
      .createQueryBuilder()
      .insert()
      .into(RemoteAgent)
      .values({
        orgId: org.id,
        agentId,
        hostname: hostname || null,
        platform: platform || null,
        nodeVersion: nodeVersion || null,
        dockerVersion: dockerVersion || null,
        claudeVersion: claudeVersion || null,
        agentVersion: agentVersion || null,
        maxWorkers: maxWorkers || 2,
        activeTasks: 0,
        status: "online" as const,
        lastHeartbeatAt: new Date(),
      })
      .orUpdate(
        [
          "hostname",
          "platform",
          "node_version",
          "docker_version",
          "claude_version",
          "agent_version",
          "max_workers",
          "active_tasks",
          "status",
          "last_heartbeat_at",
          "updated_at",
        ],
        ["org_id", "agent_id"],
      )
      .execute();

    logger.info("Remote agent registered", { agentId, orgId: org.id, agentVersion });

    const updateAvailable = agentVersion ? semverLt(agentVersion, LATEST_AGENT_VERSION) : false;
    const updateRequired = agentVersion ? semverLt(agentVersion, MIN_AGENT_VERSION) : false;

    res.json({ registered: true, updateAvailable, updateRequired, latestVersion: LATEST_AGENT_VERSION });
  }),
);

// ─── POST /deregister ────────────────────────────────────────────────────────
// Agent calls on shutdown to mark itself offline.
router.post(
  "/deregister",
  asyncHandler(async (req: Request, res: Response) => {
    const { agentId } = req.body;
    const org = req.organization!;

    if (!agentId) {
      res.status(400).json({ error: "agentId is required" });
      return;
    }

    const agentRepo = AppDataSource.getRepository(RemoteAgent);

    await agentRepo
      .createQueryBuilder()
      .update(RemoteAgent)
      .set({ status: "offline", activeTasks: 0, lastHeartbeatAt: new Date() })
      .where("org_id = :orgId AND agent_id = :agentId", {
        orgId: org.id,
        agentId,
      })
      .execute();

    logger.info("Remote agent deregistered", { agentId, orgId: org.id });

    res.json({ ok: true });
  }),
);

// ─── POST /planning-progress ─────────────────────────────────────────────────
// Remote agent posts real-time planning progress updates.
// Relayed to the in-memory SSE emitter so the dashboard shows the same
// animated progress bar as local/cloud planning.
router.post(
  "/planning-progress",
  asyncHandler(async (req: Request, res: Response) => {
    const { taskId, phase, elapsedSeconds, detail, charsGenerated, toolCallCount } = req.body;

    if (!taskId || !phase) {
      res.status(400).json({ error: "taskId and phase are required" });
      return;
    }

    planningProgressEmitter.emitProgress(taskId, {
      phase,
      elapsedSeconds: elapsedSeconds || 0,
      detail: detail || "",
      charsGenerated: charsGenerated || 0,
      toolCallCount: toolCallCount || 0,
    });

    res.json({ ok: true });
  }),
);

export default router;
