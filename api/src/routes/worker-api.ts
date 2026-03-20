/**
 * Worker API Endpoints
 *
 * These endpoints are called by local WorkerMill CLI workers to receive
 * instructions and report back. Authenticated via org API key.
 *
 * Endpoints:
 *   GET  /api/worker/plan           - Get assembled planning prompt
 *   POST /api/worker/plan-result    - Return raw LLM output for validation
 *   GET  /api/worker/claim          - Claim next available story
 *   GET  /api/worker/stories/:id    - Get story details
 *   POST /api/worker/status         - Report story progress/completion
 *   POST /api/worker/logs           - Stream terminal output (batched)
 *   GET  /api/worker/commands/:taskId - Poll for user messages
 *   POST /api/worker/blocker        - Escalate blocker to dashboard
 *   GET  /api/worker/skills/:persona - Get relevant skills for persona
 */

import { Router, type Request, type Response } from "express";
import { authenticateApiKey } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { WorkerTaskLog } from "../models/WorkerTaskLog.js";
import { WorkerContext } from "../models/WorkerContext.js";
import { WorkerCommand } from "../models/WorkerCommand.js";
import { ProceduralMemory } from "../models/ProceduralMemory.js";
import { logger } from "../utils/logger.js";

const router = Router();

// All worker API endpoints require API key authentication
router.use(authenticateApiKey);

const taskRepo = AppDataSource.getRepository(WorkerTask);
const logRepo = AppDataSource.getRepository(WorkerTaskLog);
const contextRepo = AppDataSource.getRepository(WorkerContext);
const commandRepo = AppDataSource.getRepository(WorkerCommand);
const memoryRepo = AppDataSource.getRepository(ProceduralMemory);

// ─── GET /plan ───────────────────────────────────────────────────────────────
// Worker requests the assembled planning prompt for a task.
// Server builds the prompt (templates, stack config, skills); worker runs the LLM call.
router.get(
  "/plan",
  asyncHandler(async (req: Request, res: Response) => {
    const taskId = req.query.taskId as string;
    const org = req.organization!;

    if (!taskId) {
      res.status(400).json({ error: "taskId query parameter is required" });
      return;
    }

    const task = await taskRepo.findOne({
      where: [
        { id: taskId, orgId: org.id },
        { id: taskId, billingOrgId: org.id },
      ],
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (task.status !== "planning") {
      res.status(409).json({ error: `Task is in '${task.status}' state, expected 'planning'` });
      return;
    }

    // TODO: Call assembleFullPlanningPrompt() from build-planner service
    // For now, return the task description as a placeholder prompt
    res.json({
      taskId: task.id,
      systemPrompt: "You are an expert software engineer. Analyze the following project description and create a detailed execution plan with stories.",
      userPrompt: `Project: ${task.summary}\n\n${task.description ?? ""}`,
      model: task.workerModel || "",
    });
  }),
);

// ─── POST /plan-result ───────────────────────────────────────────────────────
// Worker returns raw LLM output from planning. Server validates and builds plan.
router.post(
  "/plan-result",
  asyncHandler(async (req: Request, res: Response) => {
    const { taskId, rawOutput } = req.body;
    const org = req.organization!;

    if (!taskId || !rawOutput) {
      res.status(400).json({ error: "taskId and rawOutput are required" });
      return;
    }

    const task = await taskRepo.findOne({
      where: [
        { id: taskId, orgId: org.id },
        { id: taskId, billingOrgId: org.id },
      ],
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (task.status !== "planning") {
      res.status(409).json({ error: `Task is in '${task.status}' state, expected 'planning'` });
      return;
    }

    // TODO: Call validateAndBuildPlan() from build-planner service
    // For now, store the raw output and transition to pending_plan_approval
    task.status = "pending_plan_approval";
    // Store raw plan output in jiraFields as a temporary location
    task.jiraFields = { ...task.jiraFields, rawPlanOutput: rawOutput };
    await taskRepo.save(task);

    logger.info(`Plan result received for task ${taskId}`, { taskId, orgId: org.id });

    res.json({
      taskId: task.id,
      status: task.status,
      message: "Plan received. Validation pending.",
    });
  }),
);

// ─── GET /claim ──────────────────────────────────────────────────────────────
// Worker claims the next available story for execution.
// Stories are tracked as WorkerContext items with messageType 'story_queued'.
router.get(
  "/claim",
  asyncHandler(async (req: Request, res: Response) => {
    const taskId = req.query.taskId as string;
    const org = req.organization!;

    if (!taskId) {
      res.status(400).json({ error: "taskId query parameter is required" });
      return;
    }

    const task = await taskRepo.findOne({
      where: [
        { id: taskId, orgId: org.id },
        { id: taskId, billingOrgId: org.id },
      ],
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Atomically claim the next queued story (prevents two workers claiming the same one)
    // Subquery finds the oldest queued story; UPDATE...WHERE ensures only one worker wins.
    const claimResult = await contextRepo
      .createQueryBuilder()
      .update(WorkerContext)
      .set({ messageType: "story_claimed" as WorkerContext["messageType"] })
      .where(
        "id = (SELECT id FROM worker_context WHERE parent_task_id = :taskId AND message_type = :queued ORDER BY created_at ASC LIMIT 1)",
        { taskId, queued: "story_queued" },
      )
      .returning("*")
      .execute();

    const claimed = claimResult.raw[0];
    if (!claimed) {
      res.json(null); // No stories available
      return;
    }

    const metadata = (claimed.metadata ?? {}) as Record<string, unknown>;
    res.json({
      storyId: claimed.id,
      storyIndex: metadata.storyIndex ?? 0,
      persona: claimed.persona ?? "backend_developer",
      prompt: metadata.prompt ?? claimed.content,
      branch: (metadata.branch as string) ?? "main",
      taskId,
      repoUrl: task.githubRepo,
      model: task.workerModel,
    });
  }),
);

// ─── GET /stories/:id ────────────────────────────────────────────────────────
// Get full story details including persona, constraints, and dependencies.
router.get(
  "/stories/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const storyId = req.params.id as string;
    const org = req.organization!;

    const story = await contextRepo.findOne({
      where: { id: storyId },
    });

    if (!story) {
      res.status(404).json({ error: "Story not found" });
      return;
    }

    // Verify org ownership via the parent task
    const task = await taskRepo.findOne({
      where: [
        { id: story.parentTaskId, orgId: org.id },
        { id: story.parentTaskId, billingOrgId: org.id },
      ],
    });

    if (!task) {
      res.status(404).json({ error: "Story not found" });
      return;
    }

    const metadata = (story.metadata ?? {}) as Record<string, unknown>;
    res.json({
      id: story.id,
      taskId: story.parentTaskId,
      storyIndex: metadata.storyIndex ?? 0,
      persona: story.persona ?? "backend_developer",
      prompt: metadata.prompt ?? story.content,
      branch: (metadata.branch as string) ?? "main",
      dependencies: metadata.dependencies ?? [],
      mutexGroup: metadata.mutexGroup ?? null,
      constraints: metadata.constraints ?? {},
    });
  }),
);

// ─── POST /status ────────────────────────────────────────────────────────────
// Worker reports story progress or completion.
router.post(
  "/status",
  asyncHandler(async (req: Request, res: Response) => {
    const { taskId, storyId, status, ...details } = req.body;
    const org = req.organization!;

    if (!taskId || !storyId || !status) {
      res.status(400).json({ error: "taskId, storyId, and status are required" });
      return;
    }

    const task = await taskRepo.findOne({
      where: [
        { id: taskId, orgId: org.id },
        { id: taskId, billingOrgId: org.id },
      ],
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Update story context item
    if (storyId) {
      const story = await contextRepo.findOne({ where: { id: storyId } });
      if (story) {
        story.messageType = `story_${status}` as WorkerContext["messageType"];
        story.metadata = { ...(story.metadata ?? {}), ...details };
        await contextRepo.save(story);
      }
    }

    // Update task status for terminal story states
    if (status === "completed" || status === "failed") {
      const pendingStories = await contextRepo.count({
        where: {
          parentTaskId: taskId,
          messageType: "story_queued" as WorkerContext["messageType"],
        },
      });
      const runningStories = await contextRepo.count({
        where: {
          parentTaskId: taskId,
          messageType: "story_claimed" as WorkerContext["messageType"],
        },
      });

      if (pendingStories === 0 && runningStories === 0) {
        const failedStories = await contextRepo.count({
          where: {
            parentTaskId: taskId,
            messageType: "story_failed" as WorkerContext["messageType"],
          },
        });
        task.status = failedStories > 0 ? "failed" : "pr_created";
        await taskRepo.save(task);
      }
    }

    logger.info(`Story ${storyId} status: ${status}`, { taskId, storyId, status });

    res.json({ success: true });
  }),
);

// ─── POST /logs ──────────────────────────────────────────────────────────────
// Worker streams terminal output (batched every 500ms).
// This mirrors the existing POST /api/tasks/:taskId/logs endpoint.
router.post(
  "/logs",
  asyncHandler(async (req: Request, res: Response) => {
    const { taskId, logs } = req.body;
    const org = req.organization!;

    if (!taskId || !logs) {
      res.status(400).json({ error: "taskId and logs are required" });
      return;
    }

    const task = await taskRepo.findOne({
      where: [
        { id: taskId, orgId: org.id },
        { id: taskId, billingOrgId: org.id },
      ],
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Accept logs as a single string (newline-separated) or array of strings
    const logLines: string[] = Array.isArray(logs)
      ? logs.map((l: unknown) => String(l))
      : String(logs).split("\n");

    const logEntities = logLines.map((line) =>
      logRepo.create({
        taskId,
        type: "claude_output",
        message: line,
        severity: "info",
      }),
    );

    await logRepo.save(logEntities);
    res.status(201).json({ success: true, count: logEntities.length });
  }),
);

// ─── GET /commands/:taskId ───────────────────────────────────────────────────
// Worker polls for pending user messages / commands.
router.get(
  "/commands/:taskId",
  asyncHandler(async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;
    const org = req.organization!;

    const task = await taskRepo.findOne({
      where: [
        { id: taskId, orgId: org.id },
        { id: taskId, billingOrgId: org.id },
      ],
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Query pending commands from WorkerCommand table
    const commands = await commandRepo.find({
      where: {
        taskId,
        orgId: org.id,
        status: "pending",
      },
      order: { createdAt: "ASC" },
    });

    res.json({
      commands: commands.map((cmd) => ({
        id: cmd.id,
        type: cmd.type,
        message: cmd.content,
        createdAt: cmd.createdAt,
      })),
    });
  }),
);

// ─── POST /blocker ───────────────────────────────────────────────────────────
// Worker escalates a blocker to the dashboard.
router.post(
  "/blocker",
  asyncHandler(async (req: Request, res: Response) => {
    const { taskId, storyId, summary, errorMessage, errorCategory } = req.body;
    const org = req.organization!;

    if (!taskId || !summary) {
      res.status(400).json({ error: "taskId and summary are required" });
      return;
    }

    const task = await taskRepo.findOne({
      where: [
        { id: taskId, orgId: org.id },
        { id: taskId, billingOrgId: org.id },
      ],
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Create blocker context item in coordination feed
    const blockerItem = contextRepo.create({
      parentTaskId: taskId,
      orgId: org.id,
      persona: "system",
      messageType: "blocker_escalated" as WorkerContext["messageType"],
      content: summary,
      metadata: {
        storyId,
        errorMessage,
        errorCategory: errorCategory ?? "unknown",
        escalatedAt: new Date().toISOString(),
      },
    });
    await contextRepo.save(blockerItem);

    // Update task status to escalated
    task.status = "escalated";
    await taskRepo.save(task);

    logger.warn(`Blocker escalated for task ${taskId}`, {
      taskId,
      storyId,
      errorCategory,
      summary,
    });

    res.status(201).json({ success: true, blockerId: blockerItem.id });
  }),
);

// ─── GET /skills/:persona ────────────────────────────────────────────────────
// Get relevant procedural memory / skills for the given persona.
router.get(
  "/skills/:persona",
  asyncHandler(async (req: Request, res: Response) => {
    const persona = req.params.persona as string;
    const org = req.organization!;

    const skills = await memoryRepo.find({
      where: {
        orgId: org.id,
      },
      order: { createdAt: "DESC" },
      take: 20,
    });

    // Filter by persona via applicableTo metadata (persona not a direct column)
    const personaSkills = skills.filter((s) => {
      if (!s.applicableTo) return true; // No filter = applies to all
      const keywords = s.applicableTo.keywords ?? [];
      return keywords.includes(persona) || keywords.length === 0;
    });

    res.json({
      skills: personaSkills.map((s) => ({
        name: s.name,
        description: s.description,
        insight: s.insight,
      })),
    });
  }),
);

export default router;
