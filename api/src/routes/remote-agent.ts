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
import { WorkerTaskLog } from "../models/WorkerTaskLog.js";
import { RemoteAgent } from "../models/RemoteAgent.js";
import { User } from "../models/User.js";
import { In, Not } from "typeorm";
import { KbCard } from "../models/KbCard.js";
import { logger } from "../utils/logger.js";
import { buildPlanningPrompt, type PlanningInput } from "../services/planning-agent-local.js";
import { getExpertRegistry } from "../services/persona.js";
import { publishStoriesReady } from "../services/pipeline-executor.js";
import {
  convertToV2Format,
  validateAndFixPlan,
  convertBackToExecutionPlan,
  parseExecutionPlan,
} from "../services/planning-agent-local.js";
import type { WorkerPersona } from "../models/WorkerTask.js";
import type { ExecutionPlanV2 } from "../services/pipeline-v2-types.js";
import { planningProgressEmitter } from "../services/planning-progress-events.js";
import { getOrgCredentials } from "../services/org-credentials.js";
import { sendPushNotification } from "../services/push-notifications.js";
import { CRITIC_FEEDBACK_TEMPLATE, REFINEMENT_FEEDBACK_TEMPLATE } from "../services/prompt-templates.js";

const router = Router();

// ─── Stale claim throttle ────────────────────────────────────────────────────
// Track last stale-claim check per org to avoid running expensive queries on
// every 5-second poll. Only check once every 2 minutes per org.
const STALE_CHECK_INTERVAL_MS = 2 * 60 * 1000;
const lastStaleCheckByOrg = new Map<string, number>();

// ─── Agent version constants ──────────────────────────────────────────────────
// Bump LATEST_AGENT_VERSION when publishing a new agent release.
// Bump MIN_AGENT_VERSION when old agents MUST update (breaking changes).
const LATEST_AGENT_VERSION = "0.10.91";
const MIN_AGENT_VERSION = "0.10.0";

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

    // Reclaim stale tasks: throttled to once per 2 minutes per org to avoid
    // exhausting the DB connection pool (max 10) on every 5-second poll.
    const now = Date.now();
    const lastCheck = lastStaleCheckByOrg.get(org.id) || 0;
    if (now - lastCheck > STALE_CHECK_INTERVAL_MS) {
      lastStaleCheckByOrg.set(org.id, now);

      const STALE_CLAIM_MINUTES = 5;
      const staleCutoff = new Date(now - STALE_CLAIM_MINUTES * 60 * 1000);
      const agentRepo = AppDataSource.getRepository(RemoteAgent);

      const staleCandidates = await taskRepo
        .createQueryBuilder("task")
        .where("task.org_id = :orgId", { orgId: org.id })
        .andWhere("task.status IN (:...statuses)", { statuses: ["planning", "queued"] })
        .andWhere("task.claimed_by_agent IS NOT NULL")
        .andWhere("task.claimed_by_agent != :agentId", { agentId })
        .getMany();

      // Batch-fetch all claiming agents in one query (avoids N+1)
      const claimingAgentIds = [
        ...new Set(staleCandidates.map((t) => t.claimedByAgent).filter(Boolean)),
      ];
      const claimingAgents =
        claimingAgentIds.length > 0
          ? await agentRepo
              .createQueryBuilder("agent")
              .where("agent.org_id = :orgId", { orgId: org.id })
              .andWhere("agent.agent_id IN (:...agentIds)", {
                agentIds: claimingAgentIds,
              })
              .getMany()
          : [];
      const agentMap = new Map(claimingAgents.map((a) => [a.agentId, a]));

      for (const staleTask of staleCandidates) {
        const claimingAgent = agentMap.get(staleTask.claimedByAgent!);

        const isStale =
          !claimingAgent ||
          claimingAgent.status === "offline" ||
          claimingAgent.lastHeartbeatAt < staleCutoff;

        if (isStale) {
          await taskRepo
            .createQueryBuilder()
            .update(WorkerTask)
            .set({ claimedByAgent: null as unknown as string })
            .where("id = :id AND claimed_by_agent = :oldAgent", {
              id: staleTask.id,
              oldAgent: staleTask.claimedByAgent,
            })
            .execute();

          logger.info("Released stale agent claim on task", {
            taskId: staleTask.id,
            previousAgent: staleTask.claimedByAgent,
            agentStatus: claimingAgent?.status ?? "not_found",
            lastHeartbeat:
              claimingAgent?.lastHeartbeatAt?.toISOString() ?? "never",
          });
        }
      }
    }

    // Bail if the request already timed out during stale-claim processing
    if (req.timedout) return;

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

    // Bail if the request timed out during main task query
    if (req.timedout) return;

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

    // Bail if the request timed out during manager task query
    if (req.timedout) return;

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
        boardExecutionId: t.boardExecutionId,
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

    // Check maxConcurrentWorkers before claiming (exclude the task being claimed
    // so a task in "planning" status doesn't block its own claim)
    const activeCount = await taskRepo.count({
      where: {
        orgId: org.id,
        id: Not(taskId),
        status: In(["planning", "claimed", "environment_setup", "executing", "deploying", "dispatching"]),
      },
    });

    if (activeCount >= org.maxConcurrentWorkers) {
      logger.debug("Agent claim rejected: at max concurrent workers", {
        taskId,
        agentId,
        activeCount,
        maxConcurrentWorkers: org.maxConcurrentWorkers,
      });
      res.json({ claimed: false, reason: "at_capacity" });
      return;
    }

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

    // Inject quality gate commands from board if task was created from a board card
    // The PRD decomposition flow stores gates on the board, not on the task's jiraFields
    let boardQualityGates: Record<string, unknown> = {};
    if (task) {
      try {
        const card = await AppDataSource.getRepository(KbCard).findOne({
          where: { workerTaskId: task.id },
          relations: ["board"],
        });
        const isFoundationCard = card?.position === 0;
        if (card?.board?.qualityGateCommands) {
          boardQualityGates.qualityGates = card.board.qualityGateCommands;
        }
        if (isFoundationCard) {
          boardQualityGates.isFoundationCard = true;
        }
        if (card?.board?.ciWorkflowPath) {
          boardQualityGates.ciWorkflowPath = card.board.ciWorkflowPath;
        }
      } catch (err) {
        logger.warn("Failed to fetch board quality gates for task", {
          taskId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

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
        // SCM tokens — allows remote agent to use org credentials instead of local tokens
        scmToken: orgCreds.scmToken,
        githubToken: orgCreds.githubToken,
        bitbucketUsername: orgCreds.bitbucketUsername,
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

    // Diagnostic: log token prefixes so we can debug clone failures
    const ghTok = credentials.githubToken;
    const scmTok = credentials.scmToken;
    logger.info("Remote agent claimed task", {
      taskId,
      agentId,
      orgId: org.id,
      status: task?.status,
      githubTokenPrefix: ghTok ? `${ghTok.substring(0, 8)}...` : "(none)",
      scmTokenPrefix: scmTok ? `${scmTok.substring(0, 4)}...` : "(none)",
      githubRepo: task?.githubRepo,
      scmProvider: task?.scmProvider,
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
            jiraFields: { ...task.jiraFields, ...boardQualityGates },
            taskNotes: task.taskNotes,
            githubPrUrl: task.githubPrUrl,
            githubPrNumber: task.githubPrNumber,
            boardExecutionId: task.boardExecutionId,
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
        // SCM tokens for repo access
        scmToken: orgCreds.scmToken,
        githubToken: orgCreds.githubToken,
        bitbucketUsername: orgCreds.bitbucketUsername,
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

      // Server-side story cap safety net: truncate to org's maxStories
      const calibration = org.storyCalibrationMultiplier;
      const baseServerMax = Math.max(3, Math.round(20 * calibration));
      const isBuildPage = ((task.jiraFields ?? {}) as Record<string, unknown>).buildPage === true;
      const serverMaxStories = isBuildPage ? Math.max(baseServerMax, 20) : baseServerMax;
      if (rawPlan.stories.length > serverMaxStories) {
        const originalCount = rawPlan.stories.length;
        rawPlan.stories = rawPlan.stories.slice(0, serverMaxStories);
        logger.warn("Server-side story cap applied to remote agent plan", {
          taskId,
          originalCount,
          maxStories: serverMaxStories,
          calibration,
        });
      }

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
          planJson: executionPlanV2 as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- TypeORM _QueryDeepPartialEntity incompatibility
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

      // Send push notifications to all org members about the ready plan
      const userRepo = AppDataSource.getRepository(User);
      userRepo.find({ where: { orgId: org.id } }).then((orgMembers) => {
        for (const member of orgMembers) {
          // Fire-and-forget push notification
          sendPushNotification(member.id, org.id, {
            title: "Plan ready",
            body: `Plan ready for ${task.jiraIssueKey || task.summary || "task"} - review and approve`,
            category: "plan_approvals",
            data: {
              taskId: task.id,
              type: "plan_ready",
              issueKey: task.jiraIssueKey || "",
              storyCount: String(rawPlan.stories.length),
            },
          }).catch((error) => {
            // Already logged in sendPushNotification, no need to log again
          });
        }
      }).catch((error) => {
        logger.error("Failed to fetch org members for push notification", {
          taskId,
          error: error instanceof Error ? error.message : String(error),
        });
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

      // Mark task as failed if plan parsing fails (atomic to avoid clobbering concurrent changes)
      await taskRepo.update(
        { id: taskId, orgId: org.id },
        { status: "failed", errorMessage: `Plan validation failed: ${errorMessage}` },
      );

      res.status(422).json({
        error: "Plan validation failed",
      });
    }
  }),
);

// ─── POST /plan-failed ──────────────────────────────────────────────────────
// Agent reports that planning exhausted all critic iterations without approval.
// Transitions the task to "failed" so it doesn't loop in "planning" forever.
router.post(
  "/plan-failed",
  asyncHandler(async (req: Request, res: Response) => {
    const { taskId, agentId, reason, criticHistory, status: requestedStatus } = req.body;
    const org = req.organization!;

    if (!taskId) {
      res.status(400).json({ error: "taskId is required" });
      return;
    }

    // Allow "escalated" status for tasks that need human clarification (e.g., empty requirements)
    const targetStatus = requestedStatus === "escalated" ? "escalated" : "failed";

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Atomic transition: planning → failed/escalated (only if still in planning)
    const result = await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        status: targetStatus as WorkerTask["status"],
        errorMessage: reason || "Planning failed: critic rejected after max iterations",
      })
      .where(
        "id = :id AND org_id = :orgId AND status = :status",
        { id: taskId, orgId: org.id, status: "planning" },
      )
      .execute();

    if ((result.affected || 0) === 0) {
      const current = await taskRepo.findOne({
        where: { id: taskId, orgId: org.id },
      });
      res.status(409).json({
        error: `Task is in '${current?.status}' state, expected 'planning'`,
      });
      return;
    }

    logger.info("Remote agent reported planning failure", {
      taskId,
      agentId,
      orgId: org.id,
      reason,
      status: targetStatus,
    });

    res.json({ ok: true, status: targetStatus });
  }),
);

// ─── POST /resume-plan ──────────────────────────────────────────────────────
// Agent signals that a retried task should resume with its existing plan.
// The API preserved planJson/executionPlanV2 during retry — this endpoint
// transitions the task from planning → queued without re-planning.
router.post(
  "/resume-plan",
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

    // Verify agent owns this task
    if (agentId && task.claimedByAgent && task.claimedByAgent !== agentId) {
      res.status(403).json({ error: "Task not claimed by this agent" });
      return;
    }

    // Verify the task has an existing plan to resume with
    if (!task.executionPlanV2 && !task.planJson) {
      res.status(409).json({ error: "Task has no existing plan to resume" });
      return;
    }

    // Atomic transition: planning → queued (keep existing plan intact)
    const transitionResult = await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        status: "queued" as WorkerTask["status"],
        planStatus: "approved",
        currentStepIndex: 0,
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

    logger.info("Remote agent resumed task with existing plan", {
      taskId,
      agentId,
      orgId: org.id,
      retryCount: task.retryCount,
    });

    res.json({
      taskId,
      status: "queued",
      message: "Task resumed with existing plan. Queued for execution.",
    });
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
    const { agentId, activeTasks, agentVersion, gpuAvailable, gpuVendor, localRagEnabled, ollamaRunning, diagnostics } = req.body;
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
    if (typeof gpuAvailable === "boolean") {
      setFields.gpuAvailable = gpuAvailable;
    }
    if (typeof gpuVendor === "string") {
      setFields.gpuVendor = gpuVendor || null;
    }
    if (typeof localRagEnabled === "boolean") {
      setFields.localRagEnabled = localRagEnabled;
    }
    if (typeof ollamaRunning === "boolean") {
      setFields.ollamaRunning = ollamaRunning;
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

    // Store agent diagnostics if present and there's a task to attach them to
    if (Array.isArray(diagnostics) && diagnostics.length > 0) {
      if (activeTasks.length > 0) {
        const logRepo = AppDataSource.getRepository(WorkerTaskLog);
        const logsToSave = diagnostics.slice(0, 50).map((d: { ts?: string; level?: string; component?: string; message?: string }) => {
          const log = new WorkerTaskLog();
          log.taskId = activeTasks[0];
          log.type = "system";
          log.message = `[agent:${d.component || "unknown"}] ${d.message || ""}`.substring(0, 5000);
          log.severity = d.level === "error" ? "error" : d.level === "warn" ? "warning" : "info";
          log.metadata = { component: d.component, agentId, ts: d.ts };
          return log;
        });
        // Fire-and-forget — don't block heartbeat response
        logRepo.save(logsToSave).catch((err) => {
          logger.warn("Failed to save agent diagnostics", { error: err instanceof Error ? err.message : String(err) });
        });
      } else {
        // No active task — log server-side for visibility
        for (const d of diagnostics.slice(0, 10) as Array<{ level?: string; component?: string; message?: string }>) {
          logger.warn("Agent diagnostic (no active task)", { agentId, orgId: org.id, component: d.component, message: d.message, level: d.level });
        }
      }
    }

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
      maxConcurrentWorkers: org.maxConcurrentWorkers,
      maxParallelExperts: org.maxParallelExperts,
      defaultWorkerModel: org.defaultWorkerModel ?? "",
      scmProvider: org.scmProvider ?? "github",
      defaultGithubRepo: org.defaultGithubRepo ?? null,
      defaultBitbucketRepo: org.defaultBitbucketRepo ?? null,
      defaultGitlabRepo: org.defaultGitlabRepo ?? null,
      blockerMaxAutoRetries: org.blockerMaxAutoRetries,
      blockerAutoRetryEnabled: org.blockerAutoRetryEnabled !== false,
      blockerWaitTimeoutMinutes: org.blockerWaitTimeoutMinutes,
      pushAfterCommit: org.pushAfterCommit !== false,
      gracefulShutdownEnabled: org.gracefulShutdownEnabled !== false,
      selfReviewEnabled: org.selfReviewEnabled === true,
      // Multi-provider settings
      primaryProvider: org.primaryProvider ?? "anthropic",
      planningAgentProvider: org.planningAgentProvider ?? "anthropic",
      planningAgentModel: org.planningAgentModel ?? null,
      providerRouting: org.providerRouting ?? {},
      managerModelId: org.managerModelId ?? null,
      ollamaBaseUrl: org.ollamaBaseUrl ?? null,
      // Worker image registry
      workerImageUrl: "ghcr.io/jarod-rosenthal/worker:latest",
      ecrRegistry: "",
      // Intent Engineering
      aiGuidelines: org.aiGuidelines ?? null,
      // Review workflow settings
      maxReviewRevisions: org.maxReviewRevisions,
      maxPerStoryRevisions: org.maxPerStoryRevisions,
      maxFixRetries: org.maxFixRetries,
      // Codebase RAG
      codebaseIndexingEnabled: org.codebaseIndexingEnabled === true,
      // Quality gate thresholds (passed through to worker via QUALITY_THRESHOLDS env var)
      qualityThresholds: {
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
      },
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

    // Calculate maxStories from org calibration multiplier
    // Formula: max(3, round(20 * multiplier)), default multiplier 0.4 → max 8 stories
    const calibrationMultiplier = org.storyCalibrationMultiplier;
    // Prompt hint: always use base cap so LLM targets a reasonable number
    const maxStories = Math.max(3, Math.round(20 * calibrationMultiplier));
    // Truncation ceiling: PRD tasks get higher cap so valid stories aren't chopped
    const storyCap = isBuildPageTask ? Math.max(maxStories, 20) : maxStories;

    // Fetch available personas for dynamic planner prompt
    const experts = await getExpertRegistry(org.id);
    const availablePersonas = experts
      .filter((e) => !e.reviewOnly)
      .map((e) => ({
        slug: e.slug,
        name: e.name,
        description: e.description,
        specialties: e.specialties,
      }));

    const planningInput: PlanningInput = {
      taskId: task.id,
      title: task.summary || task.jiraIssueKey || "Unnamed Task",
      description: task.description || "",
      jiraIssueKey: task.jiraIssueKey || undefined,
      labels: jiraFields.labels as string[] | undefined,
      stackTemplate: (jiraFields.stackTemplate as string) || undefined,
      taskNotes: task.taskNotes || undefined,
      maxParallelExperts: org.maxParallelExperts,
      maxStories,
      maxTargetFiles: org.maxTargetFiles,
      availablePersonas,
      orgGuidelines: org.aiGuidelines ?? undefined,
    };

    const prompt = buildPlanningPrompt(planningInput);

    const provider = org.planningAgentProvider || org.primaryProvider || "anthropic";
    const isAnthropicPlanning = provider === "anthropic";

    // Planning model comes from org settings — never hardcode model names
    const model = org.planningAgentModel;
    if (!model) {
      res.status(400).json({
        error: "No planning agent model configured. Set 'Planning Agent Model' in Settings > AI Workers.",
      });
      return;
    }

    const preComputedStories = (jiraFields.preComputedStories as unknown[] | undefined) || undefined;

    res.json({
      taskId: task.id,
      prompt,
      model,
      provider,
      maxStories,
      storyCap,
      maxTargetFiles: org.maxTargetFiles,
      planningMode: isBuildPageTask
        ? (org.prdPlanningMode || org.planningMode || "simplified")
        : "simplified",
      validPersonas: availablePersonas.map((p: { slug: string }) => p.slug),
      ...(preComputedStories ? { preComputedStories } : {}),
    });
  }),
);

// ─── POST /register ──────────────────────────────────────────────────────────
// Agent calls on startup to register/upsert itself in remote_agents table.
router.post(
  "/register",
  asyncHandler(async (req: Request, res: Response) => {
    const { agentId, hostname, platform, nodeVersion, dockerVersion, claudeVersion, maxWorkers, agentVersion, gpuAvailable, gpuVendor, localRagEnabled, ollamaRunning } =
      req.body;
    const org = req.organization!;

    if (!agentId) {
      res.status(400).json({ error: "agentId is required" });
      return;
    }

    const agentRepo = AppDataSource.getRepository(RemoteAgent);

    // Track which API key prefix the agent is using
    const apiKeyHeader = req.headers["x-api-key"] as string | undefined;
    const agentApiKeyPrefix = apiKeyHeader ? apiKeyHeader.substring(0, 12) : null;

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
        gpuAvailable: gpuAvailable === true,
        gpuVendor: gpuVendor || null,
        localRagEnabled: localRagEnabled === true,
        ollamaRunning: ollamaRunning === true,
        apiKeyPrefix: agentApiKeyPrefix,
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
          "gpu_available",
          "gpu_vendor",
          "local_rag_enabled",
          "ollama_running",
          "api_key_prefix",
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

// ─── GET /prd-prompt ────────────────────────────────────────────────────────
// Returns the PRD decomposition system prompt.
// Single source of truth — agent fetches this instead of hardcoding its own copy.
router.get(
  "/prd-prompt",
  asyncHandler(async (_req: Request, res: Response) => {
    const { SYSTEM_PROMPT } = await import("../services/prd-decomposer.js");
    res.json({ systemPrompt: SYSTEM_PROMPT });
  }),
);

// ─── GET /critic-prompt ──────────────────────────────────────────────────────
// Returns the critic prompt template and approval threshold.
// Keeps proprietary evaluation logic server-side instead of embedded in the npm package.
router.get(
  "/critic-prompt",
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const maxTargetFiles = parseInt(req.query.maxTargetFiles as string, 10) || org.maxTargetFiles;

    // Fetch available personas so the critic knows which are valid
    const experts = await getExpertRegistry(org.id);
    const validPersonaSlugs = experts
      .filter((e) => !e.reviewOnly)
      .map((e) => e.slug);

    const CRITIC_PROMPT = `You are a Senior Architect reviewing an execution plan. Your job is to ensure the plan is appropriately sized for the task.

Review this execution plan against the task requirements:

## Task Requirements
{{PRD}}

## PROPOSED EXECUTION PLAN
{{PLAN}}

## Review Guidelines

**IMPORTANT: Match plan size to task complexity**

- Simple tasks (typos, config changes, single-file fixes) = 1 step is CORRECT
- Medium tasks (2-4 files, small features) = 2-3 steps is appropriate
- Complex tasks (new systems, security) = 3-5 steps is appropriate

**Do NOT penalize:**
- Single-step plans for genuinely simple tasks
- Using one persona when only one skill is needed
- Stories with many targetFiles — foundation/scaffolding stories legitimately need 15-25+ files

**DO check for:**
1. **Missing Requirements** - Does the plan cover what the task asks for?
2. **Scope Clarity** - Is each story's description a brief scope label (2-3 lines max)? Only penalize descriptions longer than 5 lines. Stories should NOT rewrite ticket requirements.
3. **Security Issues** - Only for tasks involving auth, user data, or external input
4. **Unfocused Scope** - Each step should own a single concern (e.g., "database layer", "auth system", "UI components"). Deduct points only if a step mixes unrelated concerns. Do NOT penalize steps for listing many files — foundation/scaffolding steps legitimately touch 15-25+ files.
5. **Missing Operational Steps** - If the task requires deployment, provisioning, migrations, or running commands, does the plan include operational steps? Writing code is not the same as deploying it.
6. **Overlapping File Scope** - If two or more steps share the same targetFiles, this causes parallel merge conflicts. Steps MUST NOT overlap on targetFiles. Deduct 10 points per shared file across steps.
7. **Serialization Bottleneck** - If more than half the stories depend on a single story, the plan has a bottleneck. Deduct 15 points — split the foundation or allow more parallel work.
8. **Requirement Rewriting** - If any story description contains implementation details, acceptance criteria, or rewritten requirements from the task description, deduct 15 points per offending story. Story descriptions must be 2-3 line scope labels (e.g., "Database layer — migrations and entity definitions.\\nAdds the new table and TypeORM entity."). The original ticket is the spec.
9. **Invalid Persona** - Each story's persona MUST be one of: ${validPersonaSlugs.map((s: string) => `\`${s}\``).join(", ")}. Any other persona value is invalid — deduct 20 points per story with an invalid persona.

## Scoring Guide

- **90-100**: Plan matches task complexity, requirements covered
- **75-89**: Minor gaps but fundamentally sound
- **50-74**: Significant issues or wrong-sized for the task
- **0-49**: Fundamentally flawed

## Output Format

Respond with ONLY a JSON object (no markdown, no explanation):
{"approved": boolean, "score": number, "risks": ["risk1", "risk2"], "suggestions": ["suggestion1", "suggestion2"], "storyFeedback": [{"storyId": "step-0", "feedback": "specific feedback", "suggestedChanges": ["change1"]}]}

Rules:
- approved = true if score >= {{THRESHOLD}} AND plan is right-sized for task
- risks = specific issues (empty array if none)
- suggestions = actionable improvements (empty array if none)
- storyFeedback = per-step feedback (optional, only for steps that need changes)`;

    const threshold = org.criticApprovalThreshold;
    const finalPrompt = CRITIC_PROMPT.replace(/\{\{THRESHOLD\}\}/g, String(threshold));

    res.json({
      promptTemplate: finalPrompt,
      approvalThreshold: threshold,
      maxTargetFiles,
      criticFeedbackTemplate: CRITIC_FEEDBACK_TEMPLATE,
      refinementFeedbackTemplate: REFINEMENT_FEEDBACK_TEMPLATE,
    });
  }),
);

// ─── POST /configure-scm ──────────────────────────────────────────────────
// Save an SCM token from the VS Code extension.
// Validates the token against the provider's API before saving.
router.post(
  "/configure-scm",
  asyncHandler(async (req: Request, res: Response) => {
    const { token, provider } = req.body;
    const org = req.organization!;

    if (!token || !provider) {
      res.status(400).json({ error: "token and provider are required" });
      return;
    }

    if (!["github", "bitbucket", "gitlab"].includes(provider)) {
      res
        .status(400)
        .json({ error: "provider must be github, bitbucket, or gitlab" });
      return;
    }

    // Validate the token against the provider's API
    let username: string | null = null;
    try {
      if (provider === "github") {
        const axios = (await import("axios")).default;
        const userResponse = await axios.get("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
          timeout: 10000,
        });
        username = userResponse.data.login;
      } else if (provider === "gitlab") {
        const axios = (await import("axios")).default;
        const baseUrl = org.scmBaseUrl || "https://gitlab.com";
        const userResponse = await axios.get(`${baseUrl}/api/v4/user`, {
          headers: { "PRIVATE-TOKEN": token },
          timeout: 10000,
        });
        username = userResponse.data.username;
      }
      // Bitbucket validation can be added later
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("SCM token validation failed", {
        orgId: org.id,
        provider,
        error: msg,
      });
      res.status(401).json({
        error:
          "Token validation failed. Check that your token has repo access.",
      });
      return;
    }

    // Save to org secrets
    const { saveOrgSecret } = await import("./settings/helpers.js");
    const secretName =
      provider === "github" ? "github-token" : `${provider}-token`;
    await saveOrgSecret(org.id, secretName, token);

    // Invalidate credential cache so the new token is used immediately
    const { invalidateOrgCredentialsCache } = await import(
      "../services/org-credentials.js"
    );
    invalidateOrgCredentialsCache(org.id);

    // Update org scmProvider if not already set to this provider
    if (org.scmProvider !== provider) {
      const orgRepo = AppDataSource.getRepository(
        (await import("../models/index.js")).Organization,
      );
      await orgRepo.update({ id: org.id }, { scmProvider: provider });
    }

    logger.info("SCM token configured via remote agent", {
      orgId: org.id,
      provider,
      username,
    });

    res.json({ configured: true, username, provider });
  }),
);

// ─── GET /scm-status ────────────────────────────────────────────────────────
// Check if SCM is configured for the org. Used by VS Code to poll after
// GitHub App installation or to show "not configured" warnings.
router.get(
  "/scm-status",
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const provider = org.scmProvider || "github";

    let configured = false;
    let username: string | null = null;

    // Check for GitHub App installation first
    if (provider === "github" && org.githubAppInstallationId) {
      configured = true;
      username = "(GitHub App)";
    } else {
      try {
        // Check for PAT in secrets
        const { getOrgSecret } = await import("./settings/helpers.js");
        const secretName =
          provider === "github" ? "github-token" : `${provider}-token`;
        const token = await getOrgSecret(org.id, secretName);
        configured = !!token;
      } catch {
        // Secrets fetch failed — treat as not configured
      }
    }

    res.json({ configured, provider, username });
  }),
);

export default router;
