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
 */

import { Router, type Request, type Response } from "express";
import { authenticateApiKey } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { WorkerContext } from "../models/WorkerContext.js";
import { In } from "typeorm";
import { logger } from "../utils/logger.js";
import { buildPlanningPrompt, type PlanningInput } from "../services/planning-agent-local.js";
import {
  convertToV2Format,
  validateAndFixPlan,
  convertBackToExecutionPlan,
  parseExecutionPlan,
} from "../services/planning-agent-local.js";
import type { WorkerPersona } from "../models/WorkerTask.js";
import type { ExecutionPlanV2 } from "../services/pipeline-v2-types.js";

const router = Router();

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

    // Find tasks in planning or queued status for this org
    const tasks = await taskRepo.find({
      where: [
        { orgId: org.id, status: "planning" },
        { orgId: org.id, status: "queued" },
      ],
      order: { createdAt: "ASC" },
      take: 5,
    });

    // Filter out tasks already claimed by a different agent
    const availableTasks = tasks.filter(
      (t) => !t.claimedByAgent || t.claimedByAgent === agentId,
    );

    res.json({
      tasks: availableTasks.map((t) => ({
        id: t.id,
        status: t.status,
        summary: t.summary,
        description: t.description,
        jiraIssueKey: t.jiraIssueKey,
        workerPersona: t.workerPersona,
        workerModel: t.workerModel,
        githubRepo: t.githubRepo,
        scmProvider: t.scmProvider,
        executionMode: t.executionMode,
        criticEnabled: t.criticEnabled,
        createdAt: t.createdAt,
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
        "id = :id AND org_id = :orgId AND status IN (:...statuses) AND claimed_by_agent IS NULL",
        { id: taskId, orgId: org.id, statuses: ["planning", "queued"] },
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
            executionPlanV2: task.executionPlanV2,
            jiraFields: task.jiraFields,
          }
        : null,
    });
  }),
);

// ─── POST /plan-result ──────────────────────────────────────────────────────
// Agent posts raw Claude CLI output for server-side validation and plan building.
router.post(
  "/plan-result",
  asyncHandler(async (req: Request, res: Response) => {
    const { taskId, rawOutput } = req.body;
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

    if (task.status !== "planning") {
      res.status(409).json({ error: `Task is in '${task.status}' state, expected 'planning'` });
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
        criticScore: 100, // Auto-approved for remote agent
        mutexGroups,
      };

      // Store plan and transition to queued (auto-approve for V1)
      task.executionPlanV2 = executionPlanV2 as unknown as ExecutionPlanV2;
      task.status = "queued";
      task.planStatus = "approved";
      task.planJson = executionPlanV2 as unknown as Record<string, unknown>;
      task.currentStepIndex = 0;
      task.contextSidecar = [];
      task.commitHistory = [];
      await taskRepo.save(task);

      logger.info("Remote agent plan result processed", {
        taskId,
        orgId: org.id,
        storyCount: rawPlan.stories.length,
      });

      res.json({
        taskId: task.id,
        status: task.status,
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

    // Transition to executing
    task.status = "executing";
    task.startedAt = new Date();
    task.agentHeartbeatAt = new Date();
    await taskRepo.save(task);

    // Publish stories ready messages to coordination feed
    if (task.executionPlanV2) {
      const contextRepo = AppDataSource.getRepository(WorkerContext);
      const plan = task.executionPlanV2 as unknown as { steps?: Array<{ index: number; persona: string; title: string }> };
      const steps = plan.steps || [];

      for (const step of steps) {
        const storyContext = contextRepo.create({
          parentTaskId: taskId,
          orgId: org.id,
          persona: step.persona || "backend_developer",
          messageType: "story_ready" as WorkerContext["messageType"],
          content: step.title,
          metadata: {
            storyIndex: step.index,
            persona: step.persona,
            title: step.title,
          },
        });
        await contextRepo.save(storyContext);
      }

      logger.info("Published stories ready for remote agent task", {
        taskId,
        storyCount: steps.length,
      });
    }

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
    const { agentId, activeTasks } = req.body;
    const org = req.organization!;

    if (!agentId || !Array.isArray(activeTasks)) {
      res.status(400).json({ error: "agentId and activeTasks array are required" });
      return;
    }

    if (activeTasks.length === 0) {
      res.json({ ok: true, updated: 0 });
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

    res.json({ ok: true, updated: result.affected || 0 });
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
    const planningInput: PlanningInput = {
      taskId: task.id,
      title: task.summary || task.jiraIssueKey || "Unnamed Task",
      description: task.description || "",
      jiraIssueKey: task.jiraIssueKey || undefined,
      labels: (task.jiraFields as Record<string, unknown>)?.labels as string[] | undefined,
    };

    const prompt = buildPlanningPrompt(planningInput);

    res.json({
      taskId: task.id,
      prompt,
      model: org.planningAgentModel || "sonnet",
    });
  }),
);

export default router;
