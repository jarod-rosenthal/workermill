import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask, PLAN_FEATURES } from "../../models/index.js";
import { KbCard } from "../../models/KbCard.js";
import { KbBoard } from "../../models/KbBoard.js";
import { KbColumn } from "../../models/KbColumn.js";
import type { OrganizationPlan } from "../../models/Organization.js";
import { RemoteAgent } from "../../models/RemoteAgent.js";
import { authenticateRequest } from "../../middleware/auth.js";
import { requireCurrentTos } from "../../middleware/tos.js";
import { logger } from "../../utils/logger.js";
import { body, param, query, validateRequest } from "../../middleware/validation.js";
import { fetchJiraIssue } from "../../utils/jira.js";
import { fetchLinearIssue } from "../../utils/linear.js";
import { inferPersonaFromJiraIssue } from "../../services/persona-inference.js";
import { syncKbCardColumn } from "../../services/task-monitor.js";
import { normalizeRepoWithOwner } from "./helpers.js";
import { resetCancelledTask } from "./lifecycle.js";
import { runCardAsWorkerTask } from "../boards/index.js";
import { taskCreationLimiter } from "../../middleware/rate-limit.js";
import { canCreateTask } from "../../services/billing.js";

const router = Router();

/**
 * Fetch an internal board card by its issue key (e.g. "WM-42").
 * Parses the prefix and card number, then looks up the KbCard.
 */
async function fetchBoardCard(
  orgId: string,
  issueKey: string,
): Promise<{
  summary: string;
  description: string;
  labels: string[];
  cardId: string;
  boardHasPrd: boolean;
  qualityGateCommands: Array<{ name: string; trigger: string; commands: string[] }> | null;
  ciWorkflowPath: string | null;
  cardPosition: number;
} | null> {
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

  // Build description with PRD appended — same as boards.ts runCardAsWorkerTask
  const description = [
    card.title,
    card.description || "",
    card.board?.prdContent
      ? `\n---\n\n## Full Build Specification\n\nThe following is the complete specification document. Your card description above defines your SCOPE — use this specification for exact technical details (API response shapes, field names, data structures, route parameters, UI component specs).\n\n${card.board.prdContent}`
      : "",
  ].filter(Boolean).join("\n\n");

  return {
    summary: card.title,
    description,
    labels: (card.cardLabels || [])
      .map((cl) => cl.label?.name)
      .filter(Boolean) as string[],
    cardId: card.id,
    boardHasPrd: !!(card.board?.prdContent),
    qualityGateCommands: card.board?.qualityGateCommands || null,
    ciWorkflowPath: card.board?.ciWorkflowPath || null,
    cardPosition: card.position ?? 0,
  };
}

// All routes require authentication
router.use(authenticateRequest);
router.use(requireCurrentTos);

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

    // Check billing/trial status before creating task
    const billingCheck = await canCreateTask(org);
    if (!billingCheck.allowed) {
      res.status(402).json({ error: billingCheck.reason });
      return;
    }

    // Fetch issue tracker ticket details to populate task with real data
    // This ensures manual tasks have the same information as webhook-triggered tasks
    let issueSummary = summary;
    let issueDescription: string | null = null;
    let issueLabels: string[] = [];
    let inferredPersona = workerPersona;
    let jiraFields: Record<string, unknown> = {};
    let boardCardId: string | null = null;

    // Determine which issue tracker to use based on org settings
    const issueTrackerProvider = org.issueTrackerProvider;

    let issueData: { summary: string; description: string; labels: string[] } | null = null;
    // Board metadata from fetchBoardCard — used to populate jiraFields with buildPage, qualityGates, etc.
    let boardMeta: { boardHasPrd: boolean; qualityGateCommands: Array<{ name: string; trigger: string; commands: string[] }> | null; ciWorkflowPath: string | null; cardPosition: number } | null = null;

    if (issueTrackerProvider === "internal") {
      // Fetch from internal KbBoard/KbCard — card MUST exist for internal boards
      const boardCard = await fetchBoardCard(org.id, jiraIssueKey);
      if (boardCard) {
        issueData = boardCard;
        boardCardId = boardCard.cardId;
        boardMeta = boardCard;
        logger.info("Fetched internal board card details for task", {
          issueKey: jiraIssueKey,
          cardId: boardCardId,
          summary: issueData.summary,
          descriptionLength: issueData.description?.length || 0,
          labels: issueData.labels,
        });
      } else {
        logger.error("Internal board card not found — refusing to create task", { issueKey: jiraIssueKey });
        res.status(400).json({
          error: `Board card not found for ${jiraIssueKey}. Ensure the card exists and has a valid card number.`,
        });
        return;
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
        const boardCard = await fetchBoardCard(org.id, jiraIssueKey);
        if (boardCard) {
          issueData = boardCard;
          boardCardId = boardCard.cardId;
          boardMeta = boardCard;
        }
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
      // Store labels + board metadata in jiraFields (parity with boards.ts runCardAsWorkerTask)
      const isFoundationCard = boardMeta ? boardMeta.cardPosition === 0 : false;
      jiraFields = {
        labels: issueLabels,
        ...(boardMeta?.boardHasPrd ? { buildPage: true } : {}),
        ...(boardMeta?.qualityGateCommands ? { qualityGates: boardMeta.qualityGateCommands } : {}),
        ...(isFoundationCard ? { isFoundationCard: true } : {}),
        ...(boardMeta?.ciWorkflowPath ? { ciWorkflowPath: boardMeta.ciWorkflowPath } : {}),
      };

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
      issueSummary = summary || jiraIssueKey;
    }

    // =========================================================================
    // Epic mode is now the DEFAULT (standard workflow deprecated)
    // Use 'standard' or 'v1' label to explicitly opt-out to legacy execution
    // =========================================================================

    // Normalize labels to lowercase for comparison
    const labels = issueLabels.map((l) => l.toLowerCase());

    // Check for repo override label (e.g., "repo:owner/repo-name")
    // Falls back to org.getDefaultRepo() if not specified
    let repoOverride: string | null = null;
    const repoLabel = issueLabels.find((l: string) => l.toLowerCase().startsWith("repo:"));
    if (repoLabel) {
      repoOverride = repoLabel.substring(5); // Remove "repo:" prefix
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
      model = "claude-sonnet-4-6";
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
    const planFeats = PLAN_FEATURES[(org.plan as OrganizationPlan)] ?? PLAN_FEATURES.pro;
    if (!planFeats.cloudExecution) {
      // Pro tier can only execute via remote agent — check if one is registered
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
    if (boardCardId) {
      const cardRepo = AppDataSource.getRepository(KbCard);
      await cardRepo.update(boardCardId, { workerTaskId: task.id });
      syncKbCardColumn(task.id, initialStatus === "planning" ? "planning" : "claimed").catch(() => {});
      logger.info("Linked board card to worker task", { cardId: boardCardId, taskId: task.id });
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
 * POST /api/tasks/run-file
 *
 * Create a KbCard on a "Quick Tasks" board from inline markdown content
 * and immediately run it as a worker task. Used by the VS Code extension's
 * "Run as Task" command for .md files.
 */
router.post(
  "/run-file",
  taskCreationLimiter,
  body("summary")
    .isString()
    .notEmpty()
    .isLength({ max: 500 })
    .withMessage("summary is required and must be ≤ 500 characters"),
  body("description")
    .isString()
    .notEmpty()
    .isLength({ max: 500000 })
    .withMessage("description is required and must be ≤ 500KB"),
  body("githubRepo")
    .optional()
    .isString()
    .isLength({ max: 255 })
    .withMessage("githubRepo must be ≤ 255 characters"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { summary, description, githubRepo } = req.body;

      if (org.issueTrackerProvider === "github-issues") {
        // --- GitHub Issues path: create issue directly, no board/cards ---
        const targetRepo = githubRepo || org.getDefaultRepo();
        if (!targetRepo) {
          res.status(400).json({ error: "No repository configured for organization" });
          return;
        }

        const { createGithubIssueForTask } = await import("../../services/github-issues.js");
        const ghIssue = await createGithubIssueForTask(org.id, targetRepo, summary, description);
        const issueKey = `GH-${ghIssue.number}`;

        const taskRepo = AppDataSource.getRepository(WorkerTask);
        const task = taskRepo.create({
          orgId: org.id,
          jiraIssueKey: issueKey,
          jiraIssueId: issueKey,
          summary,
          description,
          workerPersona: "project_manager",
          workerModel: org.defaultWorkerModel || "",
          workerProvider: org.primaryProvider || "anthropic",
          ticketSystem: "github",
          scmProvider: org.scmProvider || "github",
          githubRepo: targetRepo,
          status: "planning",
          pipelineVersion: "v2",
          executionMode: "parallel",
          criticEnabled: false,
          deploymentEnabled: org.autoDeployEnabled ?? false,
          skipManagerReview: !org.autoReviewEnabled,
          improvementEnabled: org.autoImproveEnabled ?? false,
          standardSdkMode: false,
          retryCount: 0,
          maxRetries: 3,
          jiraFields: {
            githubParentIssueNumber: ghIssue.number,
          },
        });
        await taskRepo.save(task);

        logger.info("Created GitHub Issues task from run-file", {
          issueKey, ghIssueUrl: ghIssue.html_url, taskId: task.id, orgId: org.id,
        });

        res.status(201).json({
          taskId: task.id,
          issueKey,
          githubIssueUrl: ghIssue.html_url,
        });
        return;
      }

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const colRepo = AppDataSource.getRepository(KbColumn);
      const cardRepo = AppDataSource.getRepository(KbCard);

      // Find or create "Quick Tasks" board for this org
      let board = await boardRepo.findOne({
        where: { orgId: org.id, prefix: "QT" },
      });

      if (!board) {
        // Check if prefix "QT" is taken by another board name
        const maxPos = await boardRepo
          .createQueryBuilder("b")
          .where("b.orgId = :orgId", { orgId: org.id })
          .select("MAX(b.position)", "max")
          .getRawOne();

        board = boardRepo.create({
          orgId: org.id,
          name: "Quick Tasks",
          description: "Cards created from VS Code 'Run as Task'",
          position: (maxPos?.max ?? -1) + 1,
          prefix: "QT",
          nextCardNumber: 1,
        });
        await boardRepo.save(board);

        // Create default columns
        const defaultColumns = [
          { name: "To Do", position: 0, color: "#6b7280" },
          { name: "In Progress", position: 1, color: "#f59e0b" },
          { name: "Review", position: 2, color: "#8b5cf6" },
          { name: "Approved", position: 3, color: "#3b82f6" },
          { name: "Deployed", position: 4, color: "#10b981" },
        ];
        const columns: KbColumn[] = [];
        for (const def of defaultColumns) {
          columns.push(
            colRepo.create({
              boardId: board.id,
              name: def.name,
              position: def.position,
              color: def.color,
            }),
          );
        }
        await colRepo.save(columns);
      }

      // Get "To Do" column
      const todoColumn = await colRepo.findOne({
        where: { boardId: board.id, name: "To Do" },
      });
      if (!todoColumn) {
        res.status(500).json({ error: "Quick Tasks board has no 'To Do' column" });
        return;
      }

      // Atomically claim next card number
      const [{ next_num }] = await AppDataSource.query(
        `UPDATE "kb_boards" SET "next_card_number" = "next_card_number" + 1 WHERE "id" = $1 AND "org_id" = $2 RETURNING "next_card_number" - 1 AS next_num`,
        [board.id, org.id],
      );
      const cardNumber = Number(next_num) || 1;

      // Create card
      const card = cardRepo.create({
        boardId: board.id,
        columnId: todoColumn.id,
        title: summary,
        description,
        position: 0,
        cardNumber,
        githubRepo: githubRepo || org.getDefaultRepo() || null,
      });
      await cardRepo.save(card);

      // Run card as worker task (same logic as board "Run" button)
      const workerTask = await runCardAsWorkerTask(card.id, org.id);

      // If a specific repo was requested, override on the worker task
      if (githubRepo && workerTask.githubRepo !== githubRepo) {
        const taskRepo = AppDataSource.getRepository(WorkerTask);
        await taskRepo.update(workerTask.id, { githubRepo });
        workerTask.githubRepo = githubRepo;
      }

      const issueKey = `QT-${cardNumber}`;
      logger.info("Created Quick Task card and worker task", {
        issueKey,
        cardId: card.id,
        taskId: workerTask.id,
        boardId: board.id,
        orgId: org.id,
      });

      res.status(201).json({
        taskId: workerTask.id,
        issueKey,
        boardId: board.id,
        cardId: card.id,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("Error creating run-file task", { error: msg });
      res.status(500).json({ error: "Failed to create task" });
    }
  },
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
