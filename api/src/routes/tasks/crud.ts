import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask } from "../../models/index.js";
import { authenticateRequest } from "../../middleware/auth.js";
import { logger } from "../../utils/logger.js";
import { body, param, query, validateRequest } from "../../middleware/validation.js";
import { fetchJiraIssue } from "../../utils/jira.js";
import { fetchLinearIssue } from "../../utils/linear.js";
import { inferPersonaFromJiraIssue } from "../../services/persona-inference.js";
import { normalizeRepoWithOwner } from "./helpers.js";

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
  body("deploymentEnabled").optional().isBoolean(),
  body("improvementEnabled").optional().isBoolean(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const {
        jiraIssueKey: rawIssueKey,
        workerPersona,
        workerModel,
        summary,
        skipManagerReview,
        deploymentEnabled: explicitDeploymentEnabled,
        improvementEnabled: explicitImprovementEnabled,
      } = req.body;

      // Normalize issue key to uppercase for consistency
      const jiraIssueKey = rawIssueKey.toUpperCase();

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

    // Fetch issue tracker ticket details to populate task with real data
    // This ensures manual tasks have the same information as webhook-triggered tasks
    let issueSummary = summary;
    let issueDescription: string | null = null;
    let issueLabels: string[] = [];
    let inferredPersona = workerPersona;
    let jiraFields: Record<string, unknown> = {};

    // Determine which issue tracker to use based on org settings
    const issueTrackerProvider = org.issueTrackerProvider || "jira";

    let issueData: { summary: string; description: string; labels: string[] } | null = null;

    if (issueTrackerProvider === "linear") {
      // Fetch from Linear
      issueData = await fetchLinearIssue(org.id, jiraIssueKey);
      if (issueData) {
        logger.info("Fetched Linear issue details for manual task", {
          issueKey: jiraIssueKey,
          summary: issueData.summary,
          descriptionLength: issueData.description?.length || 0,
          labels: issueData.labels,
        });
      } else {
        logger.warn("Could not fetch Linear issue details - using defaults", { issueKey: jiraIssueKey });
      }
    } else {
      // Default to Jira
      issueData = await fetchJiraIssue(org.id, jiraIssueKey);
      if (issueData) {
        logger.info("Fetched Jira issue details for manual task", {
          jiraIssueKey,
          summary: issueData.summary,
          descriptionLength: issueData.description?.length || 0,
          labels: issueData.labels,
        });
      } else {
        logger.warn("Could not fetch Jira issue details - using defaults", { jiraIssueKey });
      }
    }

    if (issueData) {
      issueSummary = summary || issueData.summary;
      issueDescription = issueData.description || null;
      issueLabels = issueData.labels;
      // Store labels in jiraFields for downstream use (e.g., retry logic, label detection)
      jiraFields = { labels: issueLabels };

      // Infer persona from ticket if not explicitly provided
      if (!workerPersona) {
        inferredPersona = await inferPersonaFromJiraIssue(
          {
            summary: issueData.summary,
            description: issueData.description,
            labels: issueLabels,
            fields: {},
          },
          undefined, // explicitPersona
          org.id     // orgId for org-specific inference rules
        );
      }
    } else {
      issueSummary = summary || `Manual task for ${jiraIssueKey}`;
    }

    // =========================================================================
    // Epic mode is now the DEFAULT (standard workflow deprecated)
    // Use 'standard' or 'v1' label to explicitly opt-out to legacy execution
    // =========================================================================

    // Normalize labels to lowercase for comparison
    const labels = issueLabels.map((l) => l.toLowerCase());

    // Check for repo override label (e.g., "repo:oncallshift/oncallshift-mobile")
    // Also supports direct repo name labels (e.g., "oncallshift-mobile", "oncallshift-api")
    // Falls back to org.getDefaultRepo() if not specified
    // Search original labels (case-sensitive) for repo name preservation
    let repoOverride: string | null = null;
    const repoLabel = issueLabels.find((l: string) => l.toLowerCase().startsWith("repo:"));
    if (repoLabel) {
      repoOverride = repoLabel.substring(5); // Remove "repo:" prefix
    } else {
      // Check for direct repo name labels (e.g., "oncallshift-mobile", "oncallshift-api", "oncallshift-web")
      // Extract owner from default repo to construct full path
      const defaultRepo = org.getDefaultRepo();
      const owner = defaultRepo?.split("/")[0];
      if (owner) {
        const knownRepoNames = ["oncallshift-mobile", "oncallshift-api", "oncallshift-web"];
        const repoNameLabel = labels.find((l) => knownRepoNames.includes(l));
        if (repoNameLabel) {
          repoOverride = `${owner}/${repoNameLabel}`;
          logger.info("Detected repo name label, using as override", { repoNameLabel, repoOverride });
        }
      }
    }
    const targetRepo = normalizeRepoWithOwner(repoOverride, org.getDefaultRepo());

    // Check for explicit opt-out to standard/legacy workflow
    const hasStandardLabel = labels.some((l) => l === "standard" || l === "v1");

    // Epic mode is the default unless explicitly opted out
    const isV2Pipeline = !hasStandardLabel;

    // Detect Multi-Provider workflow (sequential with provider routing)
    const isMultiProvider = labels.includes("multi-provider");

    // Detect Standard SDK mode (single task with SDK instead of CLI)
    const isStandardSdk = labels.includes("sdk");

    // Detect critic mode
    const hasCriticLabel = labels.includes("critic");

    // Tasks needing planning: Epic (default) or Multi-Provider
    const needsPlanning = isV2Pipeline || isMultiProvider;

    // Initial status: planning phase for Epic/Multi-Provider, queued for legacy
    const initialStatus = needsPlanning ? "planning" : "queued";

    // For tasks that need planning, use project_manager persona for the planning phase
    const taskPersona = needsPlanning ? "project_manager" : (inferredPersona || "backend_developer");

    // Determine execution mode based on provider settings
    // - Epic mode (parallel): Only for Anthropic with no routing overrides
    // - Multi-expert mode: For non-Anthropic providers or when routing overrides exist
    const hasRoutingOverrides = org.providerRouting &&
      Object.keys(org.providerRouting as Record<string, unknown>).length > 0;
    const canUseEpicMode = (org.primaryProvider === "anthropic" || !org.primaryProvider) && !hasRoutingOverrides;

    let executionMode: "single" | "sequential" | "parallel" | "multi-expert" = "single";
    let pipelineVersion: "v1" | "v2" | null = null;
    if (isV2Pipeline && canUseEpicMode) {
      executionMode = "parallel"; // Epic mode (Anthropic only)
      pipelineVersion = "v2";
    } else if (isV2Pipeline || isMultiProvider) {
      executionMode = "multi-expert"; // Multi-provider mode (any provider)
      pipelineVersion = "v2";
    }

    // Model selection from labels (opus > sonnet > haiku > org default)
    let model: string;
    if (workerModel) {
      model = workerModel; // Explicit override takes precedence
    } else if (labels.includes("opus")) {
      model = "claude-opus-4-6";
    } else if (labels.includes("sonnet")) {
      model = "claude-sonnet-4-5-20250929";
    } else if (labels.includes("haiku")) {
      model = "claude-haiku-4-5-20251001";
    } else {
      model = org.defaultWorkerModel || "";
    }

    // Review configuration: If review label present → require review
    const hasReviewLabel = labels.includes("review");
    const reviewRequired = hasReviewLabel || (org.autoReviewEnabled ?? false);

    // skipManagerReview logic:
    // - If explicitly passed as parameter, use that
    // - If review label present, require review (skipManagerReview = false)
    // - Otherwise, skip review (skipManagerReview = true)
    const finalSkipManagerReview = skipManagerReview !== undefined
      ? skipManagerReview
      : !reviewRequired;

    // Deploy configuration:
    // - If explicitly passed as parameter, use that (dashboard button)
    // - If deploy label present → enable auto-deploy
    // - If org.autoDeployEnabled → enable auto-deploy
    // - Otherwise → disabled
    const hasDeployLabel = labels.includes("deploy");
    const deploymentEnabled = explicitDeploymentEnabled !== undefined
      ? explicitDeploymentEnabled
      : (hasDeployLabel || (org.autoDeployEnabled ?? false));

    // Improvement configuration:
    // - If explicitly passed as parameter, use that (dashboard button)
    // - If improve label present → enable improvement
    // - If org.autoImproveEnabled → enable improvement
    // - Otherwise → disabled
    const hasImproveLabel = labels.includes("improve");
    const improvementEnabled = explicitImprovementEnabled !== undefined
      ? explicitImprovementEnabled
      : (hasImproveLabel || (org.autoImproveEnabled ?? false));

    logger.info("Configured task execution mode", {
      jiraIssueKey,
      labels: issueLabels,
      isV2Pipeline,
      isMultiProvider,
      isStandardSdk,
      hasStandardLabel,
      needsPlanning,
      initialStatus,
      pipelineVersion,
      executionMode,
      // Provider-based mode selection
      primaryProvider: org.primaryProvider || "anthropic",
      hasRoutingOverrides,
      canUseEpicMode,
      model,
      hasReviewLabel,
      hasDeployLabel,
      hasCriticLabel,
      finalSkipManagerReview,
      deploymentEnabled,
      // SCM configuration
      scmProvider: org.scmProvider || "github",
      repoOverride,
      targetRepo,
    });

    // Create new task
    const task = taskRepo.create({
      orgId: org.id,
      jiraIssueKey,
      jiraIssueId: jiraIssueKey, // Use key as ID for manual tasks
      summary: issueSummary,
      description: issueDescription,
      jiraFields, // Store full Jira fields including labels
      workerPersona: taskPersona,
      workerModel: model,
      scmProvider: org.scmProvider || "github",
      githubRepo: targetRepo,
      status: initialStatus,
      pipelineVersion,
      executionMode,
      criticEnabled: hasCriticLabel,
      deploymentEnabled,
      skipManagerReview: finalSkipManagerReview,
      improvementEnabled,
      standardSdkMode: isStandardSdk,
      retryCount: 0,
      maxRetries: 3,
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

export default router;
