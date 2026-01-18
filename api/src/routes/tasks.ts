import { Router, Request, Response } from "express";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask, WorkerTaskLog } from "../models/index.js";
import { authenticateRequest, authenticateApiKey } from "../middleware/auth.js";
import { getECSTaskRunner } from "../services/ecs-task-runner.js";
import { getCostTracker } from "../services/cost-tracker.js";
import { logger } from "../utils/logger.js";
import { body, param, query, validateRequest } from "../middleware/validation.js";
import { fetchJiraIssue, postJiraComment } from "../utils/jira.js";
import { inferPersonaFromJiraIssue } from "../services/persona-inference.js";
import { checkAndUnblockDependentTasks, cascadeCancellationToChildren } from "../services/orchestrator.js";

const router = Router();

// All routes require authentication
router.use(authenticateRequest);

/**
 * @swagger
 * /api/tasks:
 *   post:
 *     summary: Create a new task manually
 *     description: Creates a new worker task for the specified Jira issue. The task will be queued for execution by an AI worker.
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jiraIssueKey
 *             properties:
 *               jiraIssueKey:
 *                 type: string
 *                 description: Jira issue key (e.g., OCS-123)
 *                 example: OCS-123
 *               workerPersona:
 *                 type: string
 *                 description: Worker persona/role to use
 *                 default: backend_developer
 *                 example: frontend_developer
 *               workerModel:
 *                 type: string
 *                 description: AI model to use
 *                 default: claude-haiku-4-5-20251001
 *                 example: claude-sonnet-4-5-20250929
 *               summary:
 *                 type: string
 *                 description: Task summary (auto-generated if not provided)
 *                 example: Implement user authentication
 *               skipManagerReview:
 *                 type: boolean
 *                 description: Whether to skip manager review
 *                 default: true
 *     responses:
 *       201:
 *         description: Task created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 *       400:
 *         description: Task already exists or invalid input
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post(
  "/",
  body("jiraIssueKey").isString().notEmpty().withMessage("jiraIssueKey is required"),
  body("workerPersona").optional().isString(),
  body("workerModel").optional().isString(),
  body("summary").optional().isString(),
  body("skipManagerReview").optional().isBoolean(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { jiraIssueKey, workerPersona, workerModel, summary, skipManagerReview } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Check if task already exists for this issue
    const existingTask = await taskRepo.findOne({
      where: { jiraIssueKey, orgId: org.id },
    });

    if (existingTask && !existingTask.isTerminal()) {
      res.status(400).json({
        error: "Task already exists and is not complete",
        taskId: existingTask.id,
      });
      return;
    }

    // Fetch Jira ticket details to populate task with real data
    // This ensures manual tasks have the same information as webhook-triggered tasks
    let jiraSummary = summary;
    let jiraDescription: string | null = null;
    let jiraLabels: string[] = [];
    let inferredPersona = workerPersona;

    const jiraIssue = await fetchJiraIssue(jiraIssueKey);
    if (jiraIssue) {
      jiraSummary = summary || jiraIssue.summary;
      jiraDescription = jiraIssue.description || null;
      jiraLabels = jiraIssue.labels;

      // Infer persona from ticket if not explicitly provided
      if (!workerPersona) {
        inferredPersona = inferPersonaFromJiraIssue({
          summary: jiraIssue.summary,
          description: jiraIssue.description,
          labels: jiraLabels,
          fields: {},
        });
      }

      logger.info("Fetched Jira issue details for manual task", {
        jiraIssueKey,
        summary: jiraSummary,
        descriptionLength: jiraDescription?.length || 0,
        labels: jiraLabels,
        inferredPersona,
      });
    } else {
      logger.warn("Could not fetch Jira issue details - using defaults", { jiraIssueKey });
      jiraSummary = summary || `Manual task for ${jiraIssueKey}`;
    }

    // Create new task
    const task = taskRepo.create({
      orgId: org.id,
      jiraIssueKey,
      jiraIssueId: jiraIssueKey, // Use key as ID for manual tasks
      summary: jiraSummary,
      description: jiraDescription,
      workerPersona: inferredPersona || "backend_developer",
      workerModel: workerModel || "claude-haiku-4-5-20251001",
      githubRepo: org.defaultGithubRepo || "",
      status: "queued",
      retryCount: 0,
      maxRetries: 3,
      skipManagerReview: skipManagerReview !== false, // Default to true (no review), set false for review workflow
    });

    await taskRepo.save(task);

    logger.info("Created manual worker task", {
      taskId: task.id,
      jiraIssueKey,
      persona: task.workerPersona,
      model: task.workerModel,
      orgId: org.id,
    });

    res.status(201).json(task);
    } catch (error) {
      logger.error("Error creating task", { error });
      res.status(500).json({ error: "Failed to create task" });
    }
  }
);

/**
 * @swagger
 * /api/tasks:
 *   get:
 *     summary: List tasks
 *     description: Returns a paginated list of tasks for the authenticated organization
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [queued, claimed, environment_setup, executing, pr_created, review_requested, manager_review, pr_approved, review_approved, deploying, deployed, completed, failed, cancelled, escalated, review_rejected]
 *         description: Filter tasks by status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Maximum number of tasks to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of tasks to skip for pagination
 *     responses:
 *       200:
 *         description: List of tasks with pagination metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tasks:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Task'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                       description: Total number of tasks matching filter
 *                     limit:
 *                       type: integer
 *                       description: Number of tasks per page
 *                     offset:
 *                       type: integer
 *                       description: Current offset
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  "/",
  query("status").optional().isString(),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("limit must be between 1 and 100"),
  query("offset").optional().isInt({ min: 0 }).withMessage("offset must be a non-negative integer"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const { status, limit = 50, offset = 0 } = req.query;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const queryBuilder = taskRepo
      .createQueryBuilder("task")
      .where("task.orgId = :orgId", { orgId })
      .orderBy("task.createdAt", "DESC")
      .skip(Number(offset))
      .take(Math.min(Number(limit), 100));

    if (status) {
      queryBuilder.andWhere("task.status = :status", { status });
    }

    const [tasks, total] = await queryBuilder.getManyAndCount();

    res.json({
      tasks,
      pagination: {
        total,
        limit: Number(limit),
        offset: Number(offset),
      },
    });
    } catch (error) {
      logger.error("Error listing tasks", { error });
      res.status(500).json({ error: "Failed to list tasks" });
    }
  }
);

/**
 * @swagger
 * /api/tasks/{id}:
 *   get:
 *     summary: Get a specific task
 *     description: Returns detailed information about a single task by ID
 *     tags: [Tasks]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Task UUID
 *     responses:
 *       200:
 *         description: Task details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 *       404:
 *         description: Task not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get(
  "/:id",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = req.params.id as string;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id, orgId },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.json(task);
    } catch (error) {
      logger.error("Error getting task", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to get task" });
    }
  }
);

/**
 * GET /api/tasks/:id/logs
 * Get logs for a task
 */
router.get(
  "/:id/logs",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  query("nextToken").optional().isString(),
  query("limit").optional().isInt({ min: 1, max: 500 }).withMessage("limit must be between 1 and 500"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = req.params.id as string;
      const { nextToken, limit = 100 } = req.query;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id, orgId },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (!task.ecsTaskId) {
      res.json({ events: [], message: "Task has not started yet" });
      return;
    }

    const runner = getECSTaskRunner();
    const logs = await runner.getTaskLogs(task.ecsTaskId, {
      nextToken: nextToken as string | undefined,
      limit: Number(limit),
    });

    res.json(logs);
    } catch (error) {
      logger.error("Error getting task logs", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to get task logs" });
    }
  }
);

/**
 * POST /api/tasks/:id/cancel
 * Cancel a running task
 */
router.post(
  "/:id/cancel",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = req.params.id as string;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id, orgId },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (task.isTerminal()) {
      res.status(400).json({ error: "Task is already complete" });
      return;
    }

    // Stop ECS task if running
    if (task.ecsTaskArn) {
      const runner = getECSTaskRunner();
      await runner.stopTask(task.ecsTaskArn, "Cancelled by user");
    }

    // If this is a parent task (dispatching), also cancel all child tasks
    if (task.status === "dispatching" && task.childTaskIds && task.childTaskIds.length > 0) {
      const childTasks = await taskRepo.find({
        where: { parentTaskId: task.id },
      });

      const runner = getECSTaskRunner();
      for (const child of childTasks) {
        if (!child.isTerminal()) {
          // Stop ECS task if running
          if (child.ecsTaskArn) {
            try {
              await runner.stopTask(child.ecsTaskArn, "Parent cancelled by user");
            } catch (err) {
              logger.warn("Failed to stop child ECS task", { childId: child.id, err });
            }
          }
          child.status = "cancelled";
          child.completedAt = new Date();
          await taskRepo.save(child);
        }
      }

      logger.info("Cancelled child tasks", {
        parentId: id,
        childCount: childTasks.length,
      });
    }

    // Update task status
    task.status = "cancelled";
    task.completedAt = new Date();
    await taskRepo.save(task);

    // Cascade cancellation to any blocked child tasks
    // This handles the case where children exist but are still blocked waiting on dependencies
    // The existing code above handles running/non-terminal children, this handles blocked ones
    if (task.childTaskIds && task.childTaskIds.length > 0) {
      try {
        const cascadeResult = await cascadeCancellationToChildren(task, "Parent task was cancelled");
        if (cascadeResult.cancelledCount > 0) {
          logger.info("Cascaded cancellation to blocked children", {
            parentId: id,
            cancelledCount: cascadeResult.cancelledCount,
          });
        }
      } catch (cascadeErr) {
        logger.warn("Failed to cascade cancellation to blocked children", { parentId: id, err: cascadeErr });
      }
    }

    logger.info("Task cancelled", { taskId: id, orgId });
    res.json(task);
    } catch (error) {
      logger.error("Error cancelling task", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to cancel task" });
    }
  }
);

/**
 * POST /api/tasks/:id/retry
 * Retry a task - resets it to queued status for re-execution
 */
router.post(
  "/:id/retry",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = req.params.id as string;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id, orgId },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Allow retry for terminal and waiting states (not active states)
    const RETRYABLE_STATUSES = [
      "failed",
      "completed",
      "no_changes",
      "review_requested",
      "escalated",
      "cancelled",
      "deployed",
      "pr_approved",
      "pr_created",
      "planning",           // PRD planning phase
      "pending_plan_approval", // Waiting for plan approval
    ];

    if (!RETRYABLE_STATUSES.includes(task.status)) {
      res.status(400).json({
        error: "Task cannot be retried",
        reason: "Task is currently active",
      });
      return;
    }

    // Check if this is a PRD task - should go through planning again
    const labels = (task.jiraFields?.labels as string[] | undefined) || [];
    const isPrdTask = labels.includes("prd");

    // Reset ALL relevant fields for clean retry
    task.retryCount += 1;
    task.errorMessage = null;
    task.completedAt = null;
    task.startedAt = null;
    task.ecsTaskArn = null;
    task.ecsTaskId = null;
    task.githubPrUrl = null;
    task.githubPrNumber = null;
    task.githubBranch = null;
    task.taskNotes = null;

    if (isPrdTask) {
      // PRD tasks go through planning again
      task.status = "planning";
      task.planJson = null;  // Clear old plan
      task.planStatus = null;
      task.planFeedback = null;
      logger.info("PRD task queued for re-planning", { taskId: id, orgId, retryCount: task.retryCount });
    } else {
      // Regular tasks go straight to queued
      task.status = "queued";
      logger.info("Task queued for retry", { taskId: id, orgId, retryCount: task.retryCount });
    }

    await taskRepo.save(task);
    res.json(task);
    } catch (error) {
      logger.error("Error retrying task", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to retry task" });
    }
  }
);

// =============================================================================
// Plan Review Endpoints (PRD Orchestration)
// =============================================================================

/**
 * GET /api/tasks/:id/plan
 * Get the execution plan for a task (if it's a PRD task with a plan)
 */
router.get(
  "/:id/plan",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = req.params.id as string;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id, orgId },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      if (!task.planJson) {
        res.status(404).json({ error: "Task has no execution plan" });
        return;
      }

      res.json({
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        plan: task.planJson,
        planStatus: task.planStatus,
        planFeedback: task.planFeedback,
        planApprovedAt: task.planApprovedAt,
        planApprovedBy: task.planApprovedBy,
        planningNotes: task.planningNotes,
        // Include child tasks if this is a parent
        childTaskIds: task.childTaskIds,
        isParentTask: task.isParentTask(),
      });
    } catch (error) {
      logger.error("Error getting task plan", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to get task plan" });
    }
  }
);

/**
 * POST /api/tasks/:id/plan/approve
 * Approve the execution plan for a task with optional execution mode selection
 * This transitions the task from pending_plan_approval to queued (or creates child tasks)
 *
 * Body parameters:
 * - executionMode: 'autonomous' | 'supervised' (optional, default: 'autonomous')
 *   - autonomous: Workers run without intervention
 *   - supervised: Workers pause at checkpoints for human input
 */
router.post(
  "/:id/plan/approve",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  body("executionMode")
    .optional()
    .isIn(["autonomous", "supervised"])
    .withMessage("executionMode must be 'autonomous' or 'supervised'"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const userId = req.user!.id;
      const id = req.params.id as string;
      const executionMode = (req.body.executionMode as "autonomous" | "supervised") || "autonomous";

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id, orgId },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      if (!task.planJson) {
        res.status(400).json({ error: "Task has no execution plan to approve" });
        return;
      }

      if (task.planStatus !== "pending_approval") {
        res.status(400).json({
          error: "Plan is not pending approval",
          currentStatus: task.planStatus,
        });
        return;
      }

      // Approve the plan
      task.planStatus = "approved";
      task.planApprovedAt = new Date();
      task.planApprovedBy = userId;

      // Check if this is a multi-story plan that needs a feature branch
      const currentPlan = task.planJson as { strategy?: string; stories?: unknown[] } | null;
      const isMultiStory = currentPlan?.strategy === "multi" && currentPlan?.stories && currentPlan.stories.length > 1;
      let featureBranch: string | null = null;

      if (isMultiStory) {
        // Create feature branch for multi-story workflow
        // All story PRs will target this branch, then final PR goes to main
        featureBranch = `feature/${task.jiraIssueKey}`;

        // Import and call GitHub utility to create the branch
        const { createBranch } = await import("../utils/github.js");
        const branchCreated = await createBranch(task.githubRepo, featureBranch, "main");

        if (branchCreated) {
          logger.info("Created feature branch for multi-story workflow", {
            taskId: id,
            jiraIssueKey: task.jiraIssueKey,
            featureBranch,
          });
        } else {
          logger.warn("Failed to create feature branch, stories will target main", {
            taskId: id,
            jiraIssueKey: task.jiraIssueKey,
            featureBranch,
          });
          featureBranch = null;
        }
      }

      // Store execution mode and feature branch in planJson for orchestrator to read
      task.planJson = {
        ...task.planJson,
        executionMode,
        featureBranch, // Feature branch for multi-story workflow
        approvalMetadata: {
          approvedAt: new Date().toISOString(),
          approvedBy: userId,
          mode: executionMode,
        },
      };

      // Store feature branch on the task itself for easy access
      if (featureBranch) {
        task.githubBranch = featureBranch;
      }

      // Transition task to queued for execution
      task.status = "queued";

      await taskRepo.save(task);

      logger.info("Plan approved", {
        taskId: id,
        jiraIssueKey: task.jiraIssueKey,
        approvedBy: userId,
        executionMode,
        orgId,
      });

      // Post execution starting comment to Jira (non-blocking)
      // Re-read plan from saved task to get featureBranch
      const savedPlan = task.planJson as {
        strategy?: string;
        stories?: Array<{ title: string; persona: string }>;
        primaryPersona?: string;
        featureBranch?: string;
      } | null;
      const storyCount = savedPlan?.stories?.length || 1;
      const branchInfo = featureBranch ? `\nFeature branch: ${featureBranch}` : "";
      const executionComment = [
        "[Project Manager - Execution Starting]",
        "",
        `✅ Plan approved in ${executionMode.toUpperCase()} mode`,
        branchInfo,
        "",
        `Dispatching ${storyCount} ${storyCount === 1 ? "story" : "stories"} for execution...`,
        "",
        savedPlan?.stories
          ? savedPlan.stories.map((s, i) => `${i + 1}. [${s.persona}] ${s.title}`).join("\n")
          : `Primary persona: ${savedPlan?.strategy === "single" ? savedPlan.primaryPersona || "backend_developer" : "TBD"}`,
        "",
        "Workers are now executing. Updates will be posted on completion.",
      ].join("\n");

      if (task.jiraIssueKey) {
        postJiraComment(task.jiraIssueKey, executionComment).catch((err) => {
          logger.warn("Failed to post execution starting comment to Jira", { err, jiraKey: task.jiraIssueKey });
        });
      }

      res.json({
        success: true,
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        planStatus: task.planStatus,
        status: task.status,
        executionMode,
        message: `Plan approved in ${executionMode} mode, task queued for execution`,
      });
    } catch (error) {
      logger.error("Error approving plan", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to approve plan" });
    }
  }
);

/**
 * POST /api/tasks/:id/plan/request-changes
 * Request changes to the execution plan
 * The planning agent will re-run with the feedback
 */
router.post(
  "/:id/plan/request-changes",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  body("feedback").isString().notEmpty().withMessage("feedback is required"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const userId = req.user!.id;
      const id = req.params.id as string;
      const { feedback } = req.body;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id, orgId },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      if (!task.planJson) {
        res.status(400).json({ error: "Task has no execution plan" });
        return;
      }

      if (task.planStatus !== "pending_approval") {
        res.status(400).json({
          error: "Plan is not pending approval",
          currentStatus: task.planStatus,
        });
        return;
      }

      // Store feedback and transition to re-planning
      task.planStatus = "changes_requested";
      task.planFeedback = feedback;

      // Reset to planning status so orchestrator re-runs planning agent
      task.status = "planning";

      await taskRepo.save(task);

      logger.info("Plan changes requested", {
        taskId: id,
        jiraIssueKey: task.jiraIssueKey,
        requestedBy: userId,
        feedback: feedback.substring(0, 100), // Log first 100 chars
        orgId,
      });

      res.json({
        success: true,
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        planStatus: task.planStatus,
        status: task.status,
        message: "Changes requested, task will be re-planned with feedback",
      });
    } catch (error) {
      logger.error("Error requesting plan changes", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to request plan changes" });
    }
  }
);

/**
 * GET /api/tasks/:id/children
 * Get child tasks for a parent PRD task
 */
router.get(
  "/:id/children",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = req.params.id as string;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const parentTask = await taskRepo.findOne({
        where: { id, orgId },
      });

      if (!parentTask) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      // Check if task is a parent task (has prd label or planJson)
      const isPrdTask = parentTask.isParentTask() || parentTask.planJson;

      if (!isPrdTask) {
        res.json({
          parentTaskId: id,
          isParentTask: false,
          children: [],
        });
        return;
      }

      // Check if we're in planning phase (before approval) or transition phase (approved but children not yet created)
      const isPlanningPhase = ["planning", "pending_plan_approval"].includes(parentTask.status);
      const isTransitionPhase = ["queued", "dispatching"].includes(parentTask.status);

      // Get plan data
      const planJson = parentTask.planJson as {
        strategy?: string;
        stories?: Array<{
          id: string;
          title: string;
          persona: string;
          description?: string;
          dependencies?: string[];
        }>;
      } | null;

      // First, check if actual child tasks exist in the database
      const existingChildren = await taskRepo
        .createQueryBuilder("task")
        .where("task.parent_task_id = :parentId", { parentId: id })
        .orderBy("task.story_index", "ASC")
        .getMany();

      // If child tasks exist, return them (this is the main case after orchestrator creates children)
      if (existingChildren.length > 0) {
        res.json({
          parentTaskId: id,
          jiraIssueKey: parentTask.jiraIssueKey,
          summary: parentTask.summary,
          status: parentTask.status,
          isParentTask: true,
          isPlanningPhase: false,
          childCount: existingChildren.length,
          children: existingChildren.map((child) => ({
            id: child.id,
            storyIndex: child.storyIndex,
            storyTitle: child.storyTitle,
            persona: child.workerPersona,
            model: child.workerModel,
            status: child.status,
            dependencies: child.storyDependencies,
            githubPrUrl: child.githubPrUrl,
            startedAt: child.startedAt,
            completedAt: child.completedAt,
            estimatedCostUsd: child.estimatedCostUsd,
          })),
        });
        return;
      }

      // If no child tasks exist yet but we have planned stories, show them
      // This covers: planning phase, pending approval, and the gap between approval and child task creation
      if ((isPlanningPhase || isTransitionPhase) && planJson?.stories?.length) {
        // Determine the status to show for planned stories
        let plannedStatus = "planned";
        if (parentTask.status === "queued") {
          plannedStatus = "queued"; // Approved and waiting to be dispatched
        } else if (parentTask.status === "dispatching") {
          plannedStatus = "queued"; // Being dispatched, children will be created soon
        }

        res.json({
          parentTaskId: id,
          jiraIssueKey: parentTask.jiraIssueKey,
          summary: parentTask.summary,
          status: parentTask.status,
          isParentTask: true,
          isPlanningPhase: isPlanningPhase,
          childCount: planJson.stories.length,
          children: planJson.stories.map((story, index) => ({
            id: story.id || `planned-${index}`,
            storyIndex: index + 1,
            storyTitle: story.title,
            persona: story.persona,
            model: parentTask.workerModel,
            status: plannedStatus, // Use appropriate status based on parent state
            dependencies: story.dependencies || [],
            description: story.description,
            githubPrUrl: null,
            startedAt: null,
            completedAt: null,
            estimatedCostUsd: 0,
          })),
        });
        return;
      }

      // Fallback: no children and no plan - return empty
      res.json({
        parentTaskId: id,
        jiraIssueKey: parentTask.jiraIssueKey,
        summary: parentTask.summary,
        status: parentTask.status,
        isParentTask: true,
        isPlanningPhase: false,
        childCount: 0,
        children: [],
      });
    } catch (error) {
      logger.error("Error getting child tasks", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to get child tasks" });
    }
  }
);

/**
 * DELETE /api/tasks/:id
 * Delete a task from history
 */
router.delete(
  "/:id",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = req.params.id as string;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id, orgId },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Only allow deleting terminal tasks, queued tasks, or waiting tasks (like escalated)
    if (!task.isTerminal() && !task.isWaiting() && task.status !== "queued") {
      res.status(400).json({
        error: "Cannot delete active task",
        reason: "Only completed, failed, cancelled, queued, or escalated tasks can be deleted"
      });
      return;
    }

    await taskRepo.remove(task);

    logger.info("Task deleted", { taskId: id, orgId, status: task.status });
    res.json({ success: true, message: "Task deleted successfully" });
    } catch (error) {
      logger.error("Error deleting task", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to delete task" });
    }
  }
);

/**
 * POST /api/tasks/:id/usage
 * Report token usage from worker (called by log-parser.cjs during execution)
 * Uses API key authentication (x-api-key header)
 *
 * IMPORTANT: This endpoint matches oncallshift's /api/v1/ai-worker-tasks/:id/usage
 * - Uses idempotency check via usageReportedAt
 * - Sets tokens directly (not additive) - log-parser already uses Math.max()
 * - Calculates cost immediately
 * - Updates org cumulative cost
 */
router.post(
  "/:id/usage",
  authenticateApiKey,
  param("id").isUUID().withMessage("id must be a valid UUID"),
  body("model").optional().isString(),
  body("inputTokens").optional().isInt({ min: 0 }).withMessage("inputTokens must be a non-negative integer"),
  body("outputTokens").optional().isInt({ min: 0 }).withMessage("outputTokens must be a non-negative integer"),
  body("cacheCreationTokens").optional().isInt({ min: 0 }),
  body("cacheReadTokens").optional().isInt({ min: 0 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const taskId = req.params.id as string;
      const org = req.organization!;
      const {
        model,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
      } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Idempotency check: reject if usage already reported
    if (task.usageReportedAt) {
      res.status(409).json({
        error: "Usage already reported for this task",
        usageReportedAt: task.usageReportedAt,
        existingCost: task.estimatedCostUsd,
      });
      return;
    }

    logger.info("Token usage reported", {
      taskId,
      model,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
    });

    // Set tokens directly (not additive - log-parser uses Math.max())
    task.inputTokens = Number(inputTokens) || 0;
    task.outputTokens = Number(outputTokens) || 0;
    task.cacheCreationTokens = Number(cacheCreationTokens) || 0;
    task.cacheReadTokens = Number(cacheReadTokens) || 0;

    // Update model if provided
    if (model) {
      task.workerModel = model;
    }

    // Mark usage as reported (idempotency)
    task.usageReportedAt = new Date();

    // Calculate ECS duration if task has started
    if (task.startedAt) {
      task.ecsTaskSeconds = Math.floor((Date.now() - task.startedAt.getTime()) / 1000);
    }

    // Calculate cost using task method
    task.estimatedCostUsd = task.calculateCost();

    await taskRepo.save(task);

    // Update org cumulative cost
    try {
      const costTracker = getCostTracker(AppDataSource);
      await costTracker.recordTaskCost(taskId);
    } catch (costError) {
      logger.error("Failed to record task cost to org", { taskId, error: costError });
    }

    logger.info("Token usage recorded", {
      taskId,
      inputTokens: task.inputTokens,
      outputTokens: task.outputTokens,
      estimatedCostUsd: task.estimatedCostUsd,
    });

    res.json({
      success: true,
      taskId,
      estimatedCostUsd: task.estimatedCostUsd,
    });
  } catch (error) {
    logger.error("Error recording token usage", { error, taskId: req.params.id });
    res.status(500).json({ error: "Failed to record token usage" });
  }
});

/**
 * POST /api/tasks/:id/worker-complete
 * Called by the worker container when task completes
 * Uses API key authentication (x-api-key header)
 */
router.post("/:id/worker-complete", authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const org = req.organization!;
    const {
      exitCode,
      result,        // 'deployed' | 'review_requested' | 'no_changes' | 'completed' | 'failed'
      prUrl,
      prNumber,
      branch,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      errorMessage,
    } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Skip if task already completed
    if (task.isTerminal()) {
      logger.info("Task already completed, ignoring worker-complete", { taskId, currentStatus: task.status });
      res.json({ status: "ignored", reason: "Task already completed" });
      return;
    }

    logger.info("Worker completion reported", {
      taskId,
      exitCode,
      result,
      prUrl,
      inputTokens,
      outputTokens,
    });

    // Map result to status
    let newStatus: typeof task.status;
    switch (result) {
      case "deployed":
        newStatus = "deployed";
        break;
      case "review_requested":
        newStatus = "review_requested";
        break;
      case "escalated":
        newStatus = "escalated";
        break;
      case "no_changes":
      case "completed":
        newStatus = "completed";
        break;
      case "failed":
      default:
        newStatus = exitCode === 0 ? "completed" : "failed";
        break;
    }

    // Update task
    task.status = newStatus;
    task.completedAt = new Date();

    if (prUrl) {
      task.githubPrUrl = prUrl;
    }
    if (prNumber) {
      task.githubPrNumber = Number(prNumber);
    }
    if (branch) {
      task.githubBranch = branch;
    }
    if (errorMessage) {
      task.errorMessage = errorMessage;
    }

    // Calculate ECS task duration
    if (task.startedAt) {
      task.ecsTaskSeconds = Math.floor((new Date().getTime() - task.startedAt.getTime()) / 1000);
    }

    // Token usage and cost are handled by the /usage endpoint (called by log-parser.cjs)
    // Only calculate cost here if usage wasn't already reported
    if (!task.usageReportedAt) {
      // Fallback: update tokens if provided in payload (backward compatibility)
      if (inputTokens !== undefined) {
        task.inputTokens = (task.inputTokens || 0) + Number(inputTokens);
      }
      if (outputTokens !== undefined) {
        task.outputTokens = (task.outputTokens || 0) + Number(outputTokens);
      }
      if (cacheCreationTokens !== undefined) {
        task.cacheCreationTokens = (task.cacheCreationTokens || 0) + Number(cacheCreationTokens);
      }
      if (cacheReadTokens !== undefined) {
        task.cacheReadTokens = (task.cacheReadTokens || 0) + Number(cacheReadTokens);
      }

      // Calculate cost
      task.estimatedCostUsd = task.calculateCost();
    }

    await taskRepo.save(task);

    // Record cost to org cumulative (only if not already done by /usage endpoint)
    if (!task.usageReportedAt) {
      try {
        const costTracker = getCostTracker(AppDataSource);
        await costTracker.recordTaskCost(taskId);
      } catch (costError) {
        logger.error("Failed to record task cost", { taskId, error: costError });
      }
    }

    logger.info("Task completion processed", {
      taskId,
      newStatus,
      cost: task.estimatedCostUsd,
      inputTokens: task.inputTokens,
      outputTokens: task.outputTokens,
    });

    // If this is a child task that completed successfully, check if any blocked siblings can now run
    // Include review_requested to match the internal logic in checkAndUnblockDependentTasks
    if (["completed", "deployed", "review_requested"].includes(newStatus) && task.parentTaskId) {
      try {
        await checkAndUnblockDependentTasks(task);
      } catch (unblockError) {
        logger.warn("Failed to check/unblock dependent tasks", { taskId, error: unblockError });
      }
    }

    res.json({
      status: "processed",
      taskId,
      newStatus,
      cost: task.estimatedCostUsd,
    });
  } catch (error) {
    logger.error("Error processing worker-complete", { error, taskId: req.params.id });
    res.status(500).json({ error: "Failed to process worker completion" });
  }
});

/**
 * POST /api/tasks/:id/manager-complete
 * Called by the Manager ECS task when it completes PR review
 * Uses API key authentication (x-api-key header)
 */
router.post("/:id/manager-complete", authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const org = req.organization!;
    const {
      decision,       // 'approved' | 'revision_needed' | 'rejected'
      feedback,
      codeQualityScore,
      managerModel,
    } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    logger.info("Manager completion reported", {
      taskId,
      decision,
      codeQualityScore,
      managerModel,
    });

    // Store review feedback
    task.reviewFeedback = feedback || null;

    // Handle decision
    let newStatus: typeof task.status;
    switch (decision) {
      case "approved":
        // Manager approved - proceed to deploy
        newStatus = "review_approved";
        logger.info("Manager approved PR, proceeding to deployment", { taskId });
        break;

      case "revision_needed":
        // Check if we can still revise
        task.revisionCount = (task.revisionCount || 0) + 1;
        if (task.canRevise()) {
          // Re-queue for worker to address feedback
          newStatus = "queued";
          task.taskNotes = `REVISION_RUN: Manager requested changes (attempt ${task.revisionCount}/3). Feedback: ${feedback}`;
          task.completedAt = null;
          task.ecsTaskArn = null;
          task.ecsTaskId = null;
          task.startedAt = null;
          logger.info("Manager requested revision, re-queueing task", {
            taskId,
            revisionCount: task.revisionCount
          });
        } else {
          // Max revisions reached - mark as failed
          newStatus = "failed";
          task.errorMessage = `Max revisions (3) reached. Final feedback: ${feedback}`;
          logger.info("Max revisions reached, marking task as failed", { taskId });
        }
        break;

      case "rejected":
        // Manager rejected - task cannot be completed
        newStatus = "review_rejected";
        task.errorMessage = `Rejected by Virtual Manager: ${feedback}`;
        logger.info("Manager rejected PR", { taskId, feedback });
        break;

      default:
        // Unknown decision - log but don't change status
        logger.warn("Unknown manager decision", { taskId, decision });
        res.status(400).json({ error: "Invalid decision value" });
        return;
    }

    task.status = newStatus;

    // If approved, always trigger deployment (manager approval implies deploy intent)
    // Tasks that went through manager review should auto-deploy after approval
    if (newStatus === "review_approved") {
      // Re-queue for deployment run
      task.status = "queued";
      task.taskNotes = `DEPLOYMENT_RUN: Manager approved PR. Deploy and merge.`;
      task.completedAt = null;
      task.ecsTaskArn = null;
      task.ecsTaskId = null;
      task.startedAt = null;
      logger.info("Manager approved, re-queueing for deployment", { taskId });
    }

    await taskRepo.save(task);

    logger.info("Manager completion processed", {
      taskId,
      newStatus: task.status,
      revisionCount: task.revisionCount,
    });

    res.json({
      status: "processed",
      taskId,
      newStatus: task.status,
      decision,
    });
  } catch (error) {
    logger.error("Error processing manager-complete", { error, taskId: req.params.id });
    res.status(500).json({ error: "Failed to process manager completion" });
  }
});

/**
 * POST /api/tasks/:id/logs
 * Post logs from worker container
 * Uses API key authentication (x-api-key header)
 */
router.post("/:id/logs", authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const org = req.organization!;
    const logs = req.body.logs as Array<{
      type: string;
      message: string;
      severity?: string;
      metadata?: Record<string, unknown>;
      command?: string;
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      filePath?: string;
      durationMs?: number;
    }>;

    if (!Array.isArray(logs) || logs.length === 0) {
      res.status(400).json({ error: "logs array is required" });
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

    const logRepo = AppDataSource.getRepository(WorkerTaskLog);
    const logEntities = logs.map((log) =>
      logRepo.create({
        taskId,
        type: log.type as any,
        message: log.message,
        severity: (log.severity as any) || "info",
        metadata: log.metadata || null,
        command: log.command || null,
        exitCode: log.exitCode ?? null,
        stdout: log.stdout || null,
        stderr: log.stderr || null,
        filePath: log.filePath || null,
        durationMs: log.durationMs ?? null,
      })
    );

    await logRepo.save(logEntities);

    res.json({ success: true, count: logEntities.length });
  } catch (error) {
    logger.error("Error posting task logs", { error, taskId: req.params.id });
    res.status(500).json({ error: "Failed to post logs" });
  }
});

/**
 * POST /api/tasks/:id/usage
 * Update token usage for a task (called during execution)
 * Uses API key authentication (x-api-key header)
 */
router.post("/:id/usage", authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const org = req.organization!;
    const {
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
    } = req.body;

    const costTracker = getCostTracker(AppDataSource);
    const task = await costTracker.updateTaskUsage(taskId, {
      inputTokens: inputTokens ? Number(inputTokens) : undefined,
      outputTokens: outputTokens ? Number(outputTokens) : undefined,
      cacheCreationTokens: cacheCreationTokens ? Number(cacheCreationTokens) : undefined,
      cacheReadTokens: cacheReadTokens ? Number(cacheReadTokens) : undefined,
    });

    res.json({
      status: "updated",
      taskId,
      inputTokens: task.inputTokens,
      outputTokens: task.outputTokens,
      estimatedCost: task.estimatedCostUsd,
    });
  } catch (error) {
    logger.error("Error updating task usage", { error, taskId: req.params.id });
    res.status(500).json({ error: "Failed to update task usage" });
  }
});

export default router;
