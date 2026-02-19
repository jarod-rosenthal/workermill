import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask, PLAN_FEATURES } from "../../models/index.js";
import { KbCard } from "../../models/KbCard.js";
import { KbBoard } from "../../models/KbBoard.js";
import type { OrganizationPlan } from "../../models/Organization.js";
import { RemoteAgent } from "../../models/RemoteAgent.js";
import { authenticateRequest } from "../../middleware/auth.js";
import { logger } from "../../utils/logger.js";
import { body, param, query, validateRequest } from "../../middleware/validation.js";
import { fetchJiraIssue } from "../../utils/jira.js";
import { fetchLinearIssue } from "../../utils/linear.js";
import { inferPersonaFromJiraIssue } from "../../services/persona-inference.js";
import { syncKbCardColumn } from "../../services/task-monitor.js";
import { normalizeRepoWithOwner } from "./helpers.js";
import { resetCancelledTask } from "./lifecycle.js";
import { taskCreationLimiter } from "../../middleware/rate-limit.js";

const router = Router();

/**
 * Fetch an internal board card by its issue key (e.g. "WM-42").
 * Parses the prefix and card number, then looks up the KbCard.
 */
async function fetchBoardCard(
  orgId: string,
  issueKey: string,
): Promise<{ summary: string; description: string; labels: string[] } | null> {
  // Match prefix-number where prefix may contain non-ASCII chars (e.g., em dashes from board names)
  const match = issueKey.match(/^(.+)-(\d+)$/);
  if (!match) return null;

  const [, prefix, numStr] = match;
  const cardNumber = parseInt(numStr, 10);

  const cardRepo = AppDataSource.getRepository(KbCard);
  const card = await cardRepo.findOne({
    where: {
      cardNumber,
      board: { prefix: prefix.toUpperCase(), orgId },
    },
    relations: ["board", "cardLabels", "cardLabels.label"],
  });

  if (!card) return null;

  return {
    summary: card.title,
    description: card.description || "",
    labels: (card.cardLabels || [])
      .map((cl) => cl.label?.name)
      .filter(Boolean) as string[],
  };
}

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
 *                 description: Jira issue key (e.g., PROJ-123)
 *                 example: PROJ-123
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
 *               $ref: '***REMOVED***/components/schemas/Task'
 *       400:
 *         description: Task already exists or invalid input
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '***REMOVED***/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post(
  "/",
  taskCreationLimiter,
  body("jiraIssueKey")
    .isString()
    .notEmpty()
    .isLength({ max: 200 })
    .withMessage("jiraIssueKey is required and must be ≤ 200 characters"),
  body("workerPersona").optional().isString().isLength({ max: 100 }),
  body("workerModel").optional().isString().isLength({ max: 100 }),
  body("summary")
    .optional()
    .isString()
    .isLength({ max: 5000 })
    .withMessage("summary must be ≤ 5000 characters"),
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

    // If existing task was cancelled, reset it for re-execution instead of creating a new one
    if (existingTask && existingTask.status === "cancelled") {
      await resetCancelledTask(existingTask);
      syncKbCardColumn(existingTask.id, (existingTask.status as string) === "planning" ? "planning" : "claimed").catch(() => {});
      res.status(200).json(existingTask);
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

    if (issueTrackerProvider === "internal") {
      // Fetch from internal KbBoard/KbCard
      issueData = await fetchBoardCard(org.id, jiraIssueKey);
      if (issueData) {
        logger.info("Fetched internal board card details for task", {
          issueKey: jiraIssueKey,
          summary: issueData.summary,
          descriptionLength: issueData.description?.length || 0,
          labels: issueData.labels,
        });
      } else {
        logger.warn("Could not fetch internal board card - using defaults", { issueKey: jiraIssueKey });
      }
    } else if (issueTrackerProvider === "linear") {
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
      // Default to Jira (also try internal boards as fallback)
      issueData = await fetchJiraIssue(org.id, jiraIssueKey);
      if (!issueData) {
        issueData = await fetchBoardCard(org.id, jiraIssueKey);
      }
      if (issueData) {
        logger.info("Fetched issue details for manual task", {
          jiraIssueKey,
          summary: issueData.summary,
          descriptionLength: issueData.description?.length || 0,
          labels: issueData.labels,
        });
      } else {
        logger.warn("Could not fetch issue details - using defaults", { jiraIssueKey });
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

    // Pre-flight: Verify the org has a way to execute tasks
    const planFeats = PLAN_FEATURES[(org.plan as OrganizationPlan)] ?? PLAN_FEATURES.free;
    if (!planFeats.cloudExecution) {
      // Free tier can only execute via remote agent — check if one is registered
      const agentRepo = AppDataSource.getRepository(RemoteAgent);
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      const onlineAgent = await agentRepo
        .createQueryBuilder("agent")
        .where("agent.orgId = :orgId", { orgId: org.id })
        .andWhere("agent.lastHeartbeatAt > :cutoff", { cutoff: twoMinutesAgo })
        .getOne();
      if (!onlineAgent) {
        const anyAgent = await agentRepo.findOne({ where: { orgId: org.id } });
        if (!anyAgent) {
          res.status(400).json({
            error: "No remote agent installed. Install the WorkerMill agent to run tasks.",
            docs: "https://workermill.com/docs/remote-agent",
          });
          return;
        } else {
          res.status(400).json({
            error: "Remote agent is offline. Start the agent with 'workermill-agent start' to run tasks.",
          });
          return;
        }
      }
    }

    // Map issueTrackerProvider to ticketSystem value
    const ticketSystem = issueTrackerProvider === "github-issues"
      ? "github"
      : (issueTrackerProvider as "jira" | "linear" | "internal");

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
      ticketSystem,
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

    // Link to KbCard and move it on the board (same as board run endpoint)
    if (issueTrackerProvider === "internal" || (!issueData && issueTrackerProvider === "jira")) {
      // Try to find the matching KbCard
      const keyMatch = jiraIssueKey.match(/^(.+)-(\d+)$/);
      if (keyMatch) {
        const cardRepo = AppDataSource.getRepository(KbCard);
        const card = await cardRepo.findOne({
          where: {
            cardNumber: parseInt(keyMatch[2], 10),
            board: { prefix: keyMatch[1].toUpperCase(), orgId: org.id },
          },
          relations: ["board"],
        });
        if (card) {
          await cardRepo.update(card.id, { workerTaskId: task.id });
          syncKbCardColumn(task.id, initialStatus === "planning" ? "planning" : "claimed").catch(() => {});
        }
      }
    }

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
 *                     $ref: '***REMOVED***/components/schemas/Task'
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
 *               $ref: '***REMOVED***/components/schemas/Task'
 *       404:
 *         description: Task not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '***REMOVED***/components/schemas/Error'
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
    if (!task.isTerminal() && !task.isWaiting() && task.status !== "queued" && task.status !== "planning" && task.status !== "pending_plan_approval") {
      res.status(400).json({
        error: "Cannot delete active task",
        reason: "Only completed, failed, cancelled, queued, planning, or escalated tasks can be deleted"
      });
      return;
    }

    // Cascade-delete all related records in a transaction.
    // The worker_task_logs table has a safeguard trigger that blocks mass deletes,
    // so we bypass it via the app.allow_log_delete session variable (requires transaction for SET LOCAL).
    await AppDataSource.transaction(async (manager) => {
      await manager.query(`SET LOCAL app.allow_log_delete = 'authorized'`);
      // Delete owned records
      await manager.query(`DELETE FROM worker_task_logs WHERE task_id = $1`, [id]);
      await manager.query(`DELETE FROM worker_check_ins WHERE task_id = $1`, [id]);
      await manager.query(`DELETE FROM worker_file_locks WHERE task_id = $1`, [id]);
      await manager.query(`DELETE FROM worker_contexts WHERE parent_task_id = $1 OR task_id = $1`, [id]);
      await manager.query(`DELETE FROM worker_commands WHERE task_id = $1`, [id]);
      await manager.query(`DELETE FROM worker_task_errors WHERE task_id = $1`, [id]);
      await manager.query(`DELETE FROM worker_task_token_usage WHERE task_id = $1`, [id]);
      await manager.query(`DELETE FROM worker_resource_reservations WHERE task_id = $1`, [id]);
      await manager.query(`DELETE FROM task_relationships WHERE source_task_id = $1 OR target_task_id = $1`, [id]);
      await manager.query(`DELETE FROM pr_feedback WHERE task_id = $1`, [id]);
      await manager.query(`DELETE FROM episodic_memories WHERE task_id = $1`, [id]);
      await manager.query(`DELETE FROM procedural_memories WHERE source_task_id = $1`, [id]);
      await manager.query(`DELETE FROM credit_transactions WHERE task_id = $1`, [id]);
      await manager.query(`DELETE FROM warm_containers WHERE assigned_task_id = $1`, [id]);
      // Nullify FK references in tables that shouldn't be deleted
      await manager.query(`UPDATE kb_cards SET worker_task_id = NULL WHERE worker_task_id = $1`, [id]);
      await manager.query(`UPDATE projects SET worker_task_id = NULL WHERE worker_task_id = $1`, [id]);
      await manager.query(`UPDATE support_tickets SET ai_response_task_id = NULL WHERE ai_response_task_id = $1`, [id]);
      await manager.query(`UPDATE internal_tasks SET worker_task_id = NULL WHERE worker_task_id = $1`, [id]);
      // Orphan child tasks rather than cascade-delete them
      await manager.query(`UPDATE worker_tasks SET parent_task_id = NULL WHERE parent_task_id = $1`, [id]);
      // Delete the task itself
      await manager.query(`DELETE FROM worker_tasks WHERE id = $1`, [id]);
    });

    logger.info("Task deleted", { taskId: id, orgId, status: task.status });
    res.json({ success: true, message: "Task deleted successfully" });
    } catch (error) {
      logger.error("Error deleting task", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to delete task" });
    }
  }
);

export default router;
