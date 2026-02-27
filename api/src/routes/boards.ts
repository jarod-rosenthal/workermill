/**
 * Kanban Boards API Routes
 *
 * Internal project boards (kb_*) for team task management.
 * Provides CRUD for boards, columns, cards, labels, comments, checklists, and activity.
 */

import crypto from "crypto";
import { Router, Request, Response } from "express";
import { AppDataSource } from "../db/connection.js";
import {
  KbBoard,
  KbColumn,
  KbCard,
  KbLabel,
  KbCardLabel,
  KbComment,
  KbChecklist,
  KbActivity,
  KbStarredBoard,
  KbCardDependency,
  Organization,
  User,
  WorkerTask,
  PLAN_FEATURES,
} from "../models/index.js";
import type { OrganizationPlan } from "../models/Organization.js";
import { RemoteAgent } from "../models/RemoteAgent.js";
import type { WorkerPersona } from "../models/WorkerTask.js";
import { syncKbCardColumn } from "../services/task-monitor.js";
import { resetCancelledTask } from "./tasks/lifecycle.js";
import { canCreateTask } from "../services/billing.js";
import { authenticateUser } from "../middleware/auth.js";
import { requireCurrentTos } from "../middleware/tos.js";
import { logger } from "../utils/logger.js";
import { body, param, query, validateRequest } from "../middleware/validation.js";

const router = Router();

// All routes require authentication
router.use(authenticateUser);
router.use(requireCurrentTos);

// =============================================================================
// Helper: Derive board prefix from name
// =============================================================================

/**
 * Derive a short prefix from a board name for issue keys.
 * "CalMill" → "CM", "TaskPulse Dashboard" → "TPD", "Bugs" → "BUG"
 */
function derivePrefix(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s\-\u2013\u2014_]+/)  // split on spaces, hyphens, en/em dashes, underscores
    .filter((w) => /[A-Za-z0-9]/.test(w));  // drop non-alphanumeric tokens

  if (words.length >= 2) {
    return words
      .slice(0, 5)
      .map((w) => w[0])
      .join("")
      .replace(/[^A-Z0-9]/gi, "")  // strip any remaining non-alphanumeric
      .toUpperCase();
  }

  const word = words[0] || "BD";
  if (word.length <= 3) return word.toUpperCase();
  return word.substring(0, 3).toUpperCase();
}

/**
 * Generate a unique prefix for a board within an org.
 * Appends incrementing digits on collision.
 */
async function generateUniquePrefix(
  boardRepo: import("typeorm").Repository<KbBoard>,
  orgId: string,
  name: string,
  preferredPrefix?: string,
): Promise<string> {
  let prefix =
    preferredPrefix
      ?.toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 10) || derivePrefix(name);

  const existing = await boardRepo
    .createQueryBuilder("b")
    .where("b.orgId = :orgId", { orgId })
    .select("b.prefix")
    .getMany();
  const usedPrefixes = new Set(existing.map((b) => b.prefix));

  if (!usedPrefixes.has(prefix)) return prefix;

  let attempt = 2;
  const base = prefix;
  while (usedPrefixes.has(prefix)) {
    prefix = `${base}${attempt}`;
    attempt++;
  }
  return prefix;
}

// =============================================================================
// Helper: Log activity
// =============================================================================

async function logActivity(
  boardId: string,
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const repo = AppDataSource.getRepository(KbActivity);
    await repo.save(
      repo.create({ boardId, userId, action, entityType, entityId, metadata: metadata || null })
    );
  } catch {
    // Activity logging is best-effort
  }
}

// =============================================================================
// Helper: Run a card as a WorkerTask
// =============================================================================

export async function runCardAsWorkerTask(
  cardId: string,
  orgId: string,
  boardExecutionId?: string,
): Promise<WorkerTask> {
  const cardRepo = AppDataSource.getRepository(KbCard);
  const orgRepo = AppDataSource.getRepository(Organization);
  const workerTaskRepo = AppDataSource.getRepository(WorkerTask);

  const card = await cardRepo.findOne({
    where: { id: cardId },
    relations: ["cardLabels", "cardLabels.label", "board"],
  });
  if (!card) throw new Error("Card not found");

  // Check no active worker task already linked
  if (card.workerTaskId) {
    const existing = await workerTaskRepo.findOne({ where: { id: card.workerTaskId } });
    if (existing && existing.status === "cancelled") {
      await resetCancelledTask(existing);
      syncKbCardColumn(existing.id, (existing.status as string) === "planning" ? "planning" : "claimed").catch(() => {});
      return existing;
    }
    if (existing && !["completed", "deployed", "failed", "review_rejected"].includes(existing.status)) {
      throw new Error("Card already has an active worker task");
    }
  }

  const org = await orgRepo.findOne({ where: { id: orgId } });
  if (!org) throw new Error("Organization not found");

  // Check billing/trial status before creating task
  const billingCheck = await canCreateTask(org);
  if (!billingCheck.allowed) {
    throw new Error(billingCheck.reason || "Billing check failed");
  }

  // Parse card labels for workflow flags (same logic as projects.ts assign)
  const labelNames = (card.cardLabels || []).map((cl) => cl.label?.name?.toLowerCase() || "");

  const hasReviewLabel = labelNames.includes("review");
  const hasDeployLabel = labelNames.includes("deploy");
  const managerEnabled = labelNames.includes("manager");
  const skipManagerReview = !hasReviewLabel && !org.autoReviewEnabled;
  const deploymentEnabled = hasDeployLabel || (org.autoDeployEnabled ?? false);
  const hasImproveLabel = labelNames.includes("improve");
  const improvementEnabled = hasImproveLabel || (org.autoImproveEnabled ?? false);
  const qualityGateBypass = labelNames.includes("bypass-quality-gate") || labelNames.includes("force-merge");
  const hasSdkLabel = labelNames.includes("sdk");
  const standardSdkMode = hasSdkLabel;
  const hasCriticLabel = labelNames.includes("critic");

  // Pipeline / execution mode detection
  const hasStandardLabel = labelNames.includes("standard") || labelNames.includes("v1");
  const isMultiProvider = labelNames.includes("multi-provider");
  const isV2Pipeline = !hasStandardLabel;

  const hasRoutingOverrides = org.providerRouting &&
    Object.keys(org.providerRouting as Record<string, unknown>).length > 0;

  // Provider selection
  let workerProvider = org.primaryProvider || "anthropic";
  const providerLabels = ["anthropic", "openai", "google", "gemini", "ollama"];
  const providerLabel = labelNames.find((l) => providerLabels.includes(l));
  if (providerLabel) {
    workerProvider = providerLabel === "gemini" ? "google" : providerLabel;
  }

  const canUseEpicMode = workerProvider === "anthropic" && !hasRoutingOverrides;

  let executionMode: "single" | "sequential" | "parallel" | "multi-expert" = "single";
  let pipelineVersion: "v1" | "v2" | null = null;

  if (isV2Pipeline && canUseEpicMode) {
    executionMode = "parallel";
    pipelineVersion = "v2";
  } else if (isV2Pipeline || isMultiProvider) {
    executionMode = "multi-expert";
    pipelineVersion = "v2";
  }

  const needsPlanning = isV2Pipeline || isMultiProvider;
  const initialStatus = needsPlanning ? "planning" : "queued";

  // Model selection from labels
  let workerModel: string;
  if (labelNames.includes("opus")) {
    workerModel = "claude-opus-4-6";
  } else if (labelNames.includes("sonnet")) {
    workerModel = "claude-sonnet-4-6";
  } else if (labelNames.includes("haiku")) {
    workerModel = "claude-haiku-4-5-20251001";
  } else {
    workerModel = org.defaultWorkerModel || "";
  }

  // Persona
  const basePersona = (org.defaultWorkerPersona || "backend_developer") as WorkerPersona;
  const workerPersona = needsPlanning ? "project_manager" : basePersona;

  // Repo (card-level override takes precedence over org default)
  const githubRepo = card.githubRepo || org.getDefaultRepo();
  if (!githubRepo) {
    throw new Error("No repository configured for organization");
  }

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
        throw new Error("No remote agent installed. Install the WorkerMill agent to run tasks: https://workermill.com/docs/remote-agent");
      } else {
        throw new Error("Remote agent is offline. Start the agent with 'workermill-agent start' to run tasks.");
      }
    }
  }

  // Build card description for worker
  const description = [
    card.title,
    card.description || "",
  ].filter(Boolean).join("\n\n");

  // Create WorkerTask
  const workerTask = workerTaskRepo.create({
    orgId: org.id,
    jiraIssueKey:
      card.board?.prefix && card.cardNumber
        ? `${card.board.prefix}-${card.cardNumber}`
        : `${card.board?.name?.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "BOARD"}-${card.id.slice(0, 8)}`,
    jiraIssueId: null,
    summary: card.title,
    description,
    workerPersona,
    workerModel,
    workerProvider,
    scmProvider: org.scmProvider || "github",
    githubRepo,
    status: initialStatus,
    priority: 3,
    maxRetries: org.defaultMaxRetries || 3,
    deploymentEnabled,
    skipManagerReview,
    improvementEnabled,
    qualityGateBypass,
    managerEnabled,
    standardSdkMode,
    pipelineVersion,
    executionMode,
    criticEnabled: hasCriticLabel,
    ticketSystem: "internal",
    boardExecutionId: boardExecutionId || null,
    jiraFields: {
      ...(card.board?.metadata?.qualityGates ? { qualityGates: card.board.metadata.qualityGates } : {}),
      ...(card.board?.metadata?.ciWorkflowPath ? { ciWorkflowPath: card.board.metadata.ciWorkflowPath } : {}),
    },
  });

  await workerTaskRepo.save(workerTask);

  // Link card to worker task
  await cardRepo.update(card.id, { workerTaskId: workerTask.id });

  // Move card to "In Progress" column
  syncKbCardColumn(workerTask.id, initialStatus === "planning" ? "planning" : "claimed").catch(() => {});

  logger.info("Created WorkerTask from board card", {
    cardId: card.id,
    workerTaskId: workerTask.id,
    status: initialStatus,
  });

  return workerTask;
}

// Default columns for new boards (matches worker task lifecycle)
const DEFAULT_BOARD_COLUMNS = [
  { name: "To Do", position: 0, color: "#6b7280" },
  { name: "In Progress", position: 1, color: "#f59e0b" },
  { name: "Review", position: 2, color: "#8b5cf6" },
  { name: "Approved", position: 3, color: "#3b82f6" },
  { name: "Deployed", position: 4, color: "#10b981" },
];

const TEMPLATE_COLUMNS: Record<string, Array<{ name: string; position: number; color: string; wipLimit?: number }>> = {
  sprint: [
    { name: "To Do", position: 0, color: "#6b7280" },
    { name: "In Progress", position: 1, color: "#f59e0b", wipLimit: 3 },
    { name: "Review", position: 2, color: "#8b5cf6", wipLimit: 2 },
    { name: "Approved", position: 3, color: "#3b82f6", wipLimit: 2 },
    { name: "Deployed", position: 4, color: "#10b981" },
  ],
  bugs: [
    { name: "New", position: 0, color: "#ef4444" },
    { name: "Triaging", position: 1, color: "#f59e0b" },
    { name: "In Fix", position: 2, color: "#3b82f6" },
    { name: "Testing", position: 3, color: "#8b5cf6" },
    { name: "Resolved", position: 4, color: "#10b981" },
  ],
};

// =============================================================================
// Board Routes
// =============================================================================

/**
 * GET /api/boards
 * List boards for the user's organization
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const userId = req.user!.id;

    const boardRepo = AppDataSource.getRepository(KbBoard);
    const starRepo = AppDataSource.getRepository(KbStarredBoard);

    const boards = await boardRepo
      .createQueryBuilder("board")
      .where("board.orgId = :orgId", { orgId: org.id })
      .leftJoinAndSelect("board.columns", "columns")
      .orderBy("board.position", "ASC")
      .addOrderBy("board.createdAt", "DESC")
      .getMany();

    // Get starred board IDs for current user
    const starred = await starRepo.find({ where: { userId } });
    const starredIds = new Set(starred.map((s) => s.boardId));

    // Count cards per board
    const cardCounts = await AppDataSource.getRepository(KbCard)
      .createQueryBuilder("card")
      .select("card.boardId", "boardId")
      .addSelect("COUNT(*)", "count")
      .where("card.boardId IN (:...boardIds)", {
        boardIds: boards.length > 0 ? boards.map((b) => b.id) : ["00000000-0000-0000-0000-000000000000"],
      })
      .groupBy("card.boardId")
      .getRawMany();

    const countMap = new Map(cardCounts.map((c: { boardId: string; count: string }) => [c.boardId, parseInt(c.count)]));

    res.json({
      orgId: org.id,
      orgName: org.name,
      boards: boards.map((board) => ({
        id: board.id,
        name: board.name,
        description: board.description,
        prefix: board.prefix,
        position: board.position,
        template: board.template,
        metadata: board.metadata,
        columnCount: board.columns?.length || 0,
        cardCount: countMap.get(board.id) || 0,
        isStarred: starredIds.has(board.id),
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
      })),
    });
  } catch (error) {
    logger.error("Error listing boards", { error });
    res.status(500).json({ error: "Failed to list boards" });
  }
});

/**
 * POST /api/boards
 * Create a board with default columns
 */
router.post(
  "/",
  body("name").isString().notEmpty().isLength({ max: 200 }).withMessage("name is required (max 200 chars)"),
  body("description").optional().isString().isLength({ max: 2000 }),
  body("prefix").optional().isString().isLength({ max: 10 }),
  body("template").optional().isString().isIn(["project", "sprint", "bugs"]),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const user = req.user!;
      const { name, description, template, prefix: requestedPrefix } = req.body;

      const result = await AppDataSource.transaction(async (em) => {
        const boardRepo = em.getRepository(KbBoard);
        const colRepo = em.getRepository(KbColumn);

        // Get max position for ordering
        const maxPos = await boardRepo
          .createQueryBuilder("b")
          .where("b.orgId = :orgId", { orgId: org.id })
          .select("MAX(b.position)", "max")
          .getRawOne();

        const prefix = await generateUniquePrefix(boardRepo, org.id, name, requestedPrefix);

        const board = boardRepo.create({
          orgId: org.id,
          name,
          description: description || null,
          position: (maxPos?.max ?? -1) + 1,
          template: template || null,
          prefix,
          createdById: user.id,
        });
        await boardRepo.save(board);

        // Create columns based on template
        const colDefs = template && TEMPLATE_COLUMNS[template] ? TEMPLATE_COLUMNS[template] : DEFAULT_BOARD_COLUMNS;
        const columns: KbColumn[] = [];
        for (const def of colDefs) {
          const col = colRepo.create({
            boardId: board.id,
            name: def.name,
            position: def.position,
            color: def.color,
            wipLimit: (def as { wipLimit?: number }).wipLimit || null,
          });
          columns.push(col);
        }
        await colRepo.save(columns);

        return { board, columns };
      });

      await logActivity(result.board.id, user.id, "created", "board", result.board.id, { name });

      logger.info("Board created", { boardId: result.board.id, orgId: org.id });

      res.status(201).json({
        board: {
          id: result.board.id,
          name: result.board.name,
          description: result.board.description,
          prefix: result.board.prefix,
          position: result.board.position,
          template: result.board.template,
          createdAt: result.board.createdAt,
          columns: result.columns.map((c) => ({
            id: c.id,
            name: c.name,
            position: c.position,
            color: c.color,
            wipLimit: c.wipLimit,
          })),
        },
      });
    } catch (error) {
      logger.error("Error creating board", { error });
      res.status(500).json({ error: "Failed to create board" });
    }
  }
);

/**
 * GET /api/boards/labels
 * List org-level labels
 */
router.get("/labels", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const labelRepo = AppDataSource.getRepository(KbLabel);

    const labels = await labelRepo.find({
      where: { orgId: org.id },
      order: { name: "ASC" },
    });

    res.json({ labels });
  } catch (error) {
    logger.error("Error listing labels", { error });
    res.status(500).json({ error: "Failed to list labels" });
  }
});

/**
 * POST /api/boards/labels
 * Create a label
 */
router.post(
  "/labels",
  body("name").isString().notEmpty().isLength({ max: 100 }),
  body("color").isString().notEmpty().isLength({ max: 20 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { name, color } = req.body;

      const labelRepo = AppDataSource.getRepository(KbLabel);
      const label = labelRepo.create({ orgId: org.id, name, color });
      await labelRepo.save(label);

      res.status(201).json({ label });
    } catch (error) {
      logger.error("Error creating label", { error });
      res.status(500).json({ error: "Failed to create label" });
    }
  }
);

/**
 * PUT /api/boards/labels/:labelId
 * Update a label
 */
router.put(
  "/labels/:labelId",
  param("labelId").isUUID(),
  body("name").optional().isString().isLength({ max: 100 }),
  body("color").optional().isString().isLength({ max: 20 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const labelId = req.params.labelId as string;
      const { name, color } = req.body;

      const labelRepo = AppDataSource.getRepository(KbLabel);
      const label = await labelRepo.findOne({ where: { id: labelId, orgId: org.id } });

      if (!label) {
        res.status(404).json({ error: "Label not found" });
        return;
      }

      if (name !== undefined) label.name = name;
      if (color !== undefined) label.color = color;
      await labelRepo.save(label);

      res.json({ label });
    } catch (error) {
      logger.error("Error updating label", { error });
      res.status(500).json({ error: "Failed to update label" });
    }
  }
);

/**
 * DELETE /api/boards/labels/:labelId
 * Delete a label
 */
router.delete(
  "/labels/:labelId",
  param("labelId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const labelId = req.params.labelId as string;

      const labelRepo = AppDataSource.getRepository(KbLabel);
      const label = await labelRepo.findOne({ where: { id: labelId, orgId: org.id } });

      if (!label) {
        res.status(404).json({ error: "Label not found" });
        return;
      }

      await labelRepo.remove(label);
      res.json({ success: true });
    } catch (error) {
      logger.error("Error deleting label", { error });
      res.status(500).json({ error: "Failed to delete label" });
    }
  }
);

/**
 * GET /api/boards/:boardId
 * Get board with columns, cards (including labels, checklist, comment counts)
 */
router.get(
  "/:boardId",
  param("boardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({
        where: { id: boardId, orgId: org.id },
      });

      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      // Check if starred
      const starRepo = AppDataSource.getRepository(KbStarredBoard);
      const star = await starRepo.findOne({ where: { userId: req.user!.id, boardId } });

      // Load columns
      const colRepo = AppDataSource.getRepository(KbColumn);
      const columns = await colRepo.find({
        where: { boardId },
        order: { position: "ASC" },
      });

      // Load cards with labels, checklist items, worker task, and dependencies
      const cardRepo = AppDataSource.getRepository(KbCard);
      const cards = await cardRepo
        .createQueryBuilder("card")
        .where("card.boardId = :boardId", { boardId })
        .leftJoinAndSelect("card.cardLabels", "cardLabels")
        .leftJoinAndSelect("cardLabels.label", "label")
        .leftJoinAndSelect("card.checklistItems", "checklist")
        .leftJoinAndSelect("card.workerTask", "workerTask")
        .leftJoinAndSelect("card.assignee", "assignee")
        .leftJoinAndSelect("card.createdBy", "createdBy")
        .leftJoinAndSelect("card.dependencies", "dependencies")
        .leftJoinAndSelect("dependencies.dependsOnCard", "depCard")
        .leftJoinAndSelect("card.dependents", "dependents")
        .leftJoinAndSelect("dependents.card", "depByCard")
        .orderBy("card.position", "ASC")
        .getMany();

      // Count comments per card
      const commentCounts = await AppDataSource.getRepository(KbComment)
        .createQueryBuilder("c")
        .select("c.cardId", "cardId")
        .addSelect("COUNT(*)", "count")
        .where("c.cardId IN (:...cardIds)", {
          cardIds: cards.length > 0 ? cards.map((c) => c.id) : ["00000000-0000-0000-0000-000000000000"],
        })
        .groupBy("c.cardId")
        .getRawMany();
      const commentCountMap = new Map(commentCounts.map((r: { cardId: string; count: string }) => [r.cardId, parseInt(r.count)]));

      // Group cards by column
      const cardsByColumn = new Map<string, typeof cards>();
      for (const col of columns) {
        cardsByColumn.set(col.id, []);
      }
      for (const card of cards) {
        const list = cardsByColumn.get(card.columnId);
        if (list) list.push(card);
      }

      res.json({
        board: {
          id: board.id,
          name: board.name,
          description: board.description,
          position: board.position,
          template: board.template,
          prdContent: board.prdContent,
          prdSource: board.prdSource,
          githubRepo: board.githubRepo,
          metadata: board.metadata,
          isStarred: !!star,
          createdAt: board.createdAt,
          updatedAt: board.updatedAt,
          columns: columns.map((col) => ({
            id: col.id,
            boardId: col.boardId,
            name: col.name,
            position: col.position,
            color: col.color,
            wipLimit: col.wipLimit,
            createdAt: col.createdAt,
            cards: (cardsByColumn.get(col.id) || []).map((card) => ({
              id: card.id,
              boardId: card.boardId,
              columnId: card.columnId,
              title: card.title,
              description: card.description,
              position: card.position,
              priority: card.priority,
              dueDate: card.dueDate,
              coverColor: card.coverColor,
              assigneeId: card.assigneeId,
              assigneeName: card.assignee?.fullName || null,
              requesterName: card.createdBy?.fullName || null,
              issueKey: card.cardNumber ? `${board.prefix}-${card.cardNumber}` : null,
              workerTaskId: card.workerTaskId,
              workerStatus: card.workerTask?.status || null,
              githubRepo: card.githubRepo,
              labels: card.cardLabels?.map((cl) => ({
                id: cl.label?.id,
                name: cl.label?.name,
                color: cl.label?.color,
                createdAt: cl.label?.createdAt,
              })) || [],
              checklistItems: card.checklistItems?.map((item) => ({
                id: item.id,
                cardId: item.cardId,
                title: item.title,
                isCompleted: item.isCompleted,
                position: item.position,
                createdAt: item.createdAt,
              })) || [],
              dependencies: (card.dependencies || []).map((d) => ({
                cardId: d.dependsOnCardId,
                title: d.dependsOnCard?.title || null,
              })),
              dependents: (card.dependents || []).map((d) => ({
                cardId: d.cardId,
                title: d.card?.title || null,
              })),
              commentCount: commentCountMap.get(card.id) || 0,
              createdAt: card.createdAt,
              updatedAt: card.updatedAt,
            })),
          })),
        },
      });
    } catch (error) {
      logger.error("Error getting board", { error });
      res.status(500).json({ error: "Failed to get board" });
    }
  }
);

/**
 * PUT /api/boards/:boardId
 * Update board name/description
 */
router.put(
  "/:boardId",
  param("boardId").isUUID(),
  body("name").optional().isString().isLength({ max: 200 }),
  body("description").optional().isString().isLength({ max: 2000 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const { name, description } = req.body;

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });

      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      if (name !== undefined) board.name = name;
      if (description !== undefined) board.description = description || null;
      await boardRepo.save(board);

      await logActivity(boardId, req.user!.id, "updated", "board", boardId, { name, description });

      res.json({ board: { id: board.id, name: board.name, description: board.description, updatedAt: board.updatedAt } });
    } catch (error) {
      logger.error("Error updating board", { error });
      res.status(500).json({ error: "Failed to update board" });
    }
  }
);

/**
 * DELETE /api/boards/:boardId
 * Delete board (cascades to columns, cards, etc.)
 */
router.delete(
  "/:boardId",
  param("boardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });

      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      await boardRepo.remove(board);
      logger.info("Board deleted", { boardId, orgId: org.id });

      res.json({ success: true });
    } catch (error) {
      logger.error("Error deleting board", { error });
      res.status(500).json({ error: "Failed to delete board" });
    }
  }
);

/**
 * POST /api/boards/:boardId/star
 * Toggle star/unstar a board
 */
router.post(
  "/:boardId/star",
  param("boardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const userId = req.user!.id;
      const boardId = req.params.boardId as string;

      // Verify board belongs to org
      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      const starRepo = AppDataSource.getRepository(KbStarredBoard);
      const existing = await starRepo.findOne({ where: { userId, boardId } });

      if (existing) {
        await starRepo.remove(existing);
        res.json({ starred: false });
      } else {
        await starRepo.save(starRepo.create({ userId, boardId }));
        res.json({ starred: true });
      }
    } catch (error) {
      logger.error("Error toggling star", { error });
      res.status(500).json({ error: "Failed to toggle star" });
    }
  }
);

// =============================================================================
// Column Routes
// =============================================================================

/**
 * GET /api/boards/:boardId/columns
 * List columns with their cards
 */
router.get(
  "/:boardId/columns",
  param("boardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;

      // Verify board
      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      const colRepo = AppDataSource.getRepository(KbColumn);
      const columns = await colRepo.find({
        where: { boardId },
        order: { position: "ASC" },
      });

      // Load cards for each column with worker task
      const cardRepo = AppDataSource.getRepository(KbCard);
      const cards = await cardRepo
        .createQueryBuilder("card")
        .where("card.boardId = :boardId", { boardId })
        .leftJoinAndSelect("card.cardLabels", "cardLabels")
        .leftJoinAndSelect("cardLabels.label", "label")
        .leftJoinAndSelect("card.checklistItems", "checklist")
        .leftJoinAndSelect("card.workerTask", "workerTask")
        .leftJoinAndSelect("card.assignee", "assignee")
        .leftJoinAndSelect("card.createdBy", "createdBy")
        .orderBy("card.position", "ASC")
        .getMany();

      const cardsByColumn = new Map<string, typeof cards>();
      for (const col of columns) {
        cardsByColumn.set(col.id, []);
      }
      for (const card of cards) {
        const list = cardsByColumn.get(card.columnId);
        if (list) list.push(card);
      }

      res.json({
        columns: columns.map((col) => ({
          id: col.id,
          name: col.name,
          position: col.position,
          color: col.color,
          wipLimit: col.wipLimit,
          cards: (cardsByColumn.get(col.id) || []).map((card) => ({
            id: card.id,
            title: card.title,
            description: card.description,
            position: card.position,
            priority: card.priority,
            dueDate: card.dueDate,
            assigneeId: card.assigneeId,
            assigneeName: card.assignee?.fullName || null,
            requesterName: card.createdBy?.fullName || null,
            coverColor: card.coverColor,
            issueKey: card.cardNumber ? `${board.prefix}-${card.cardNumber}` : null,
            workerTaskId: card.workerTaskId,
            workerStatus: card.workerTask?.status || null,
            githubRepo: card.githubRepo,
            labels: card.cardLabels?.map((cl) => ({
              id: cl.label?.id,
              name: cl.label?.name,
              color: cl.label?.color,
            })) || [],
            checklistTotal: card.checklistItems?.length || 0,
            checklistDone: card.checklistItems?.filter((i) => i.isCompleted).length || 0,
            createdAt: card.createdAt,
          })),
        })),
      });
    } catch (error) {
      logger.error("Error listing columns", { error });
      res.status(500).json({ error: "Failed to list columns" });
    }
  }
);

/**
 * POST /api/boards/:boardId/columns
 * Create a column
 */
router.post(
  "/:boardId/columns",
  param("boardId").isUUID(),
  body("name").isString().notEmpty().isLength({ max: 100 }),
  body("color").optional().isString().isLength({ max: 20 }),
  body("wipLimit").optional().isInt({ min: 1 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const { name, color, wipLimit } = req.body;

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      const colRepo = AppDataSource.getRepository(KbColumn);

      const maxPos = await colRepo
        .createQueryBuilder("c")
        .where("c.boardId = :boardId", { boardId })
        .select("MAX(c.position)", "max")
        .getRawOne();

      const col = colRepo.create({
        boardId,
        name,
        position: (maxPos?.max ?? -1) + 1,
        color: color || null,
        wipLimit: wipLimit || null,
      });
      await colRepo.save(col);

      await logActivity(boardId, req.user!.id, "created", "column", col.id, { name });

      res.status(201).json({
        column: { id: col.id, name: col.name, position: col.position, color: col.color, wipLimit: col.wipLimit },
      });
    } catch (error) {
      logger.error("Error creating column", { error });
      res.status(500).json({ error: "Failed to create column" });
    }
  }
);

/**
 * PUT /api/boards/:boardId/columns/:colId
 * Update column
 */
router.put(
  "/:boardId/columns/:colId",
  param("boardId").isUUID(),
  param("colId").isUUID(),
  body("name").optional().isString().isLength({ max: 100 }),
  body("color").optional().isString().isLength({ max: 20 }),
  body("wipLimit").optional().isInt({ min: 0 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const colId = req.params.colId as string;
      const { name, color, wipLimit } = req.body;

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      const colRepo = AppDataSource.getRepository(KbColumn);
      const col = await colRepo.findOne({ where: { id: colId, boardId } });
      if (!col) {
        res.status(404).json({ error: "Column not found" });
        return;
      }

      if (name !== undefined) col.name = name;
      if (color !== undefined) col.color = color || null;
      if (wipLimit !== undefined) col.wipLimit = wipLimit === 0 ? null : wipLimit;
      await colRepo.save(col);

      res.json({ column: { id: col.id, name: col.name, position: col.position, color: col.color, wipLimit: col.wipLimit } });
    } catch (error) {
      logger.error("Error updating column", { error });
      res.status(500).json({ error: "Failed to update column" });
    }
  }
);

/**
 * DELETE /api/boards/:boardId/columns/:colId
 * Delete a column (reassign cards to first remaining column)
 */
router.delete(
  "/:boardId/columns/:colId",
  param("boardId").isUUID(),
  param("colId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const colId = req.params.colId as string;

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      await AppDataSource.transaction(async (em) => {
        const colRepo = em.getRepository(KbColumn);
        const cardRepo = em.getRepository(KbCard);

        const col = await colRepo.findOne({ where: { id: colId, boardId } });
        if (!col) throw new Error("Column not found");

        // Move cards to first remaining column
        const otherCol = await colRepo.findOne({
          where: { boardId },
          order: { position: "ASC" },
        });

        if (otherCol && otherCol.id !== colId) {
          await cardRepo.update({ columnId: colId }, { columnId: otherCol.id });
        } else {
          // Last column — delete all cards
          await cardRepo.delete({ columnId: colId });
        }

        await colRepo.remove(col);
      });

      await logActivity(boardId, req.user!.id, "deleted", "column", colId);

      res.json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (msg === "Column not found") {
        res.status(404).json({ error: "Column not found" });
        return;
      }
      logger.error("Error deleting column", { error });
      res.status(500).json({ error: "Failed to delete column" });
    }
  }
);

/**
 * PATCH /api/boards/:boardId/columns/reorder
 * Reorder columns
 */
router.patch(
  "/:boardId/columns/reorder",
  param("boardId").isUUID(),
  body("columnIds").isArray(),
  body("columnIds.*").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const { columnIds } = req.body as { columnIds: string[] };

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      await AppDataSource.transaction(async (em) => {
        const colRepo = em.getRepository(KbColumn);
        for (let i = 0; i < columnIds.length; i++) {
          await colRepo.update({ id: columnIds[i], boardId }, { position: i });
        }
      });

      res.json({ success: true });
    } catch (error) {
      logger.error("Error reordering columns", { error });
      res.status(500).json({ error: "Failed to reorder columns" });
    }
  }
);

// =============================================================================
// Card Routes
// =============================================================================

/**
 * POST /api/boards/:boardId/cards
 * Create a card in a column
 */
router.post(
  "/:boardId/cards",
  param("boardId").isUUID(),
  body("columnId").isUUID(),
  body("title").isString().notEmpty().isLength({ max: 500 }),
  body("description").optional().isString().isLength({ max: 5000 }),
  body("priority").optional().isIn(["urgent", "high", "medium", "low"]),
  body("dueDate").optional().isISO8601(),
  body("coverColor").optional().isString().isLength({ max: 20 }),
  body("githubRepo").optional().isString().isLength({ max: 255 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const { columnId, title, description, priority, dueDate, coverColor, githubRepo } = req.body;

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      const colRepo = AppDataSource.getRepository(KbColumn);
      const col = await colRepo.findOne({ where: { id: columnId, boardId } });
      if (!col) {
        res.status(404).json({ error: "Column not found" });
        return;
      }

      const cardRepo = AppDataSource.getRepository(KbCard);

      // Atomically claim the next card number (org check via board lookup above)
      const numResult = await AppDataSource.query(
        `UPDATE "kb_boards" SET "next_card_number" = "next_card_number" + 1 WHERE "id" = $1 AND "org_id" = $2 RETURNING "next_card_number" - 1 AS next_num`,
        [boardId, org.id],
      );
      const next_num: number = numResult?.[0]?.next_num ?? board.nextCardNumber ?? 1;

      const maxPos = await cardRepo
        .createQueryBuilder("c")
        .where("c.columnId = :columnId", { columnId })
        .select("MAX(c.position)", "max")
        .getRawOne();

      const card = cardRepo.create({
        boardId,
        columnId,
        title,
        description: description || null,
        position: (maxPos?.max ?? -1) + 1,
        priority: priority || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        coverColor: coverColor || null,
        githubRepo: githubRepo || null,
        cardNumber: next_num,
        createdById: req.user?.id || null,
      });
      await cardRepo.save(card);

      await logActivity(boardId, req.user!.id, "created", "card", card.id, { title });

      // Look up the creator name for the response
      const creator = req.user?.id
        ? await AppDataSource.getRepository(User).findOne({ where: { id: req.user.id }, select: ["id", "fullName"] })
        : null;

      res.status(201).json({
        card: {
          id: card.id,
          boardId: card.boardId,
          columnId: card.columnId,
          title: card.title,
          description: card.description,
          position: card.position,
          priority: card.priority,
          dueDate: card.dueDate,
          coverColor: card.coverColor,
          assigneeId: card.assigneeId ?? null,
          assigneeName: null,
          requesterName: creator?.fullName || null,
          issueKey: next_num != null ? `${board.prefix}-${next_num}` : null,
          workerTaskId: card.workerTaskId ?? null,
          workerStatus: null,
          githubRepo: card.githubRepo,
          labels: [],
          checklistItems: [],
          commentCount: 0,
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
        },
      });
    } catch (error) {
      logger.error("Error creating card", { error });
      res.status(500).json({ error: "Failed to create card" });
    }
  }
);

/**
 * GET /api/boards/:boardId/cards/:cardId
 * Get card detail with labels, comments, checklist
 */
router.get(
  "/:boardId/cards/:cardId",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const cardId = req.params.cardId as string;

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      const cardRepo = AppDataSource.getRepository(KbCard);
      const card = await cardRepo
        .createQueryBuilder("card")
        .where("card.id = :cardId", { cardId })
        .andWhere("card.boardId = :boardId", { boardId })
        .leftJoinAndSelect("card.cardLabels", "cardLabels")
        .leftJoinAndSelect("cardLabels.label", "label")
        .leftJoinAndSelect("card.comments", "comments")
        .leftJoinAndSelect("comments.author", "commentAuthor")
        .leftJoinAndSelect("card.checklistItems", "checklist")
        .leftJoinAndSelect("card.assignee", "assignee")
        .leftJoinAndSelect("card.createdBy", "createdBy")
        .leftJoinAndSelect("card.workerTask", "workerTask")
        .addOrderBy("comments.createdAt", "DESC")
        .addOrderBy("checklist.position", "ASC")
        .getOne();

      if (!card) {
        res.status(404).json({ error: "Card not found" });
        return;
      }

      res.json({
        card: {
          id: card.id,
          boardId: card.boardId,
          columnId: card.columnId,
          title: card.title,
          description: card.description,
          position: card.position,
          priority: card.priority,
          dueDate: card.dueDate,
          coverColor: card.coverColor,
          issueKey: card.cardNumber ? `${board.prefix}-${card.cardNumber}` : null,
          workerTaskId: card.workerTaskId,
          workerStatus: card.workerTask?.status || null,
          githubRepo: card.githubRepo,
          assignee: card.assignee
            ? { id: card.assignee.id, fullName: card.assignee.fullName, email: card.assignee.email }
            : null,
          requester: card.createdBy
            ? { id: card.createdBy.id, fullName: card.createdBy.fullName }
            : null,
          labels: card.cardLabels?.map((cl) => ({
            id: cl.label?.id,
            name: cl.label?.name,
            color: cl.label?.color,
          })) || [],
          comments: card.comments?.map((c) => ({
            id: c.id,
            content: c.content,
            author: c.author
              ? { id: c.author.id, fullName: c.author.fullName }
              : null,
            createdAt: c.createdAt,
          })) || [],
          checklist: card.checklistItems?.map((i) => ({
            id: i.id,
            title: i.title,
            isCompleted: i.isCompleted,
            position: i.position,
          })) || [],
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
        },
      });
    } catch (error) {
      logger.error("Error getting card", { error });
      res.status(500).json({ error: "Failed to get card" });
    }
  }
);

/**
 * PUT /api/boards/:boardId/cards/:cardId
 * Update card fields
 */
router.put(
  "/:boardId/cards/:cardId",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  body("title").optional().isString().isLength({ max: 500 }),
  body("description").optional().isString(),
  body("priority").optional().isIn(["urgent", "high", "medium", "low", ""]),
  body("dueDate").optional(),
  body("assigneeId").optional(),
  body("coverColor").optional(),
  body("githubRepo").optional().isString().isLength({ max: 255 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const cardId = req.params.cardId as string;
      const { title, description, priority, dueDate, assigneeId, coverColor, githubRepo } = req.body;

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      const cardRepo = AppDataSource.getRepository(KbCard);
      const card = await cardRepo.findOne({ where: { id: cardId, boardId } });
      if (!card) {
        res.status(404).json({ error: "Card not found" });
        return;
      }

      if (title !== undefined) card.title = title;
      if (description !== undefined) card.description = description || null;
      if (priority !== undefined) card.priority = priority || null;
      if (dueDate !== undefined) card.dueDate = dueDate ? new Date(dueDate) : null;
      if (assigneeId !== undefined) card.assigneeId = assigneeId || null;
      if (coverColor !== undefined) card.coverColor = coverColor || null;
      if (githubRepo !== undefined) card.githubRepo = githubRepo || null;
      await cardRepo.save(card);

      await logActivity(boardId, req.user!.id, "updated", "card", cardId);

      res.json({ card });
    } catch (error) {
      logger.error("Error updating card", { error });
      res.status(500).json({ error: "Failed to update card" });
    }
  }
);

/**
 * DELETE /api/boards/:boardId/cards/:cardId
 * Delete a card
 */
router.delete(
  "/:boardId/cards/:cardId",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const cardId = req.params.cardId as string;

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      const cardRepo = AppDataSource.getRepository(KbCard);
      const card = await cardRepo.findOne({ where: { id: cardId, boardId } });
      if (!card) {
        res.status(404).json({ error: "Card not found" });
        return;
      }

      await cardRepo.remove(card);
      await logActivity(boardId, req.user!.id, "deleted", "card", cardId, { title: card.title });

      res.json({ success: true });
    } catch (error) {
      logger.error("Error deleting card", { error });
      res.status(500).json({ error: "Failed to delete card" });
    }
  }
);

/**
 * PATCH /api/boards/:boardId/cards/:cardId/move
 * Move card to a different column and/or position
 */
router.patch(
  "/:boardId/cards/:cardId/move",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  body("columnId").isUUID(),
  body("position").isInt({ min: 0 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const cardId = req.params.cardId as string;
      const { columnId, position } = req.body;

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      await AppDataSource.transaction(async (em) => {
        const cardRepo = em.getRepository(KbCard);
        const colRepo = em.getRepository(KbColumn);

        const card = await cardRepo.findOne({ where: { id: cardId, boardId } });
        if (!card) throw new Error("Card not found");

        const targetCol = await colRepo.findOne({ where: { id: columnId, boardId } });
        if (!targetCol) throw new Error("Column not found");

        card.columnId = columnId;
        card.position = position;
        await cardRepo.save(card);
      });

      await logActivity(boardId, req.user!.id, "moved", "card", cardId, { columnId, position });

      res.json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (msg === "Card not found") {
        res.status(404).json({ error: "Card not found" });
        return;
      }
      if (msg === "Column not found") {
        res.status(404).json({ error: "Column not found" });
        return;
      }
      logger.error("Error moving card", { error });
      res.status(500).json({ error: "Failed to move card" });
    }
  }
);

/**
 * PATCH /api/boards/:boardId/cards/reorder
 * Batch reorder cards (within same or across columns)
 */
router.patch(
  "/:boardId/cards/reorder",
  param("boardId").isUUID(),
  body("items").isArray(),
  body("items.*.cardId").isUUID(),
  body("items.*.columnId").isUUID(),
  body("items.*.position").isInt({ min: 0 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const { items } = req.body as { items: Array<{ cardId: string; columnId: string; position: number }> };

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      await AppDataSource.transaction(async (em) => {
        const cardRepo = em.getRepository(KbCard);
        for (const item of items) {
          await cardRepo.update(
            { id: item.cardId, boardId },
            { columnId: item.columnId, position: item.position }
          );
        }
      });

      res.json({ success: true });
    } catch (error) {
      logger.error("Error reordering cards", { error });
      res.status(500).json({ error: "Failed to reorder cards" });
    }
  }
);

// =============================================================================
// Run Card as Worker Task
// =============================================================================

/**
 * POST /api/boards/:boardId/cards/:cardId/run
 * Run a card as an AI worker task
 */
router.post(
  "/:boardId/cards/:cardId/run",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const cardId = req.params.cardId as string;

      // Verify board belongs to org
      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      // Verify card belongs to board
      const cardRepo = AppDataSource.getRepository(KbCard);
      const card = await cardRepo.findOne({ where: { id: cardId, boardId } });
      if (!card) {
        res.status(404).json({ error: "Card not found" });
        return;
      }

      // Enforce dependencies — block if any dependency card's worker task is not completed/deployed
      const depRepo = AppDataSource.getRepository(KbCardDependency);
      const deps = await depRepo.find({
        where: { cardId },
        relations: ["dependsOnCard", "dependsOnCard.workerTask"],
      });
      const unmetDeps = deps.filter((d) => {
        const depTask = d.dependsOnCard?.workerTask;
        return !depTask || !["completed", "deployed"].includes(depTask.status);
      });
      if (unmetDeps.length > 0) {
        const blockers = unmetDeps.map((d) => d.dependsOnCard?.title).join(", ");
        res.status(409).json({
          error: `Card is blocked by: ${blockers}`,
          blockedBy: unmetDeps.map((d) => d.dependsOnCardId),
        });
        return;
      }

      const workerTask = await runCardAsWorkerTask(cardId, org.id);

      await logActivity(boardId, req.user!.id, "worker_triggered", "card", cardId, {
        workerTaskId: workerTask.id,
      });

      res.status(201).json({
        success: true,
        workerTask: { id: workerTask.id, status: workerTask.status },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to run card";
      if (msg === "Card already has an active worker task") {
        res.status(409).json({ error: msg });
        return;
      }
      if (msg === "No repository configured for organization" ||
          msg.startsWith("No remote agent installed") ||
          msg.startsWith("Remote agent is offline")) {
        res.status(400).json({ error: msg });
        return;
      }
      logger.error("Error running card as worker task", { error });
      res.status(500).json({ error: "Failed to run card as worker task" });
    }
  }
);

// =============================================================================
// Card Dependency Routes
// =============================================================================

/**
 * POST /api/boards/:boardId/cards/:cardId/dependencies
 * Add a dependency (cardId depends on dependsOnCardId)
 */
router.post(
  "/:boardId/cards/:cardId/dependencies",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  body("dependsOnCardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const cardId = req.params.cardId as string;
      const { dependsOnCardId } = req.body;

      // Reject self-dependency
      if (cardId === dependsOnCardId) {
        res.status(400).json({ error: "A card cannot depend on itself" });
        return;
      }

      // Verify board belongs to org
      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      // Verify both cards belong to the same board
      const cardRepo = AppDataSource.getRepository(KbCard);
      const card = await cardRepo.findOne({ where: { id: cardId, boardId } });
      if (!card) {
        res.status(404).json({ error: "Card not found" });
        return;
      }

      const depCard = await cardRepo.findOne({ where: { id: dependsOnCardId, boardId } });
      if (!depCard) {
        res.status(404).json({ error: "Dependency card not found on this board" });
        return;
      }

      // Check for existing dependency
      const depRepo = AppDataSource.getRepository(KbCardDependency);
      const existing = await depRepo.findOne({ where: { cardId, dependsOnCardId } });
      if (existing) {
        res.status(409).json({ error: "Dependency already exists" });
        return;
      }

      const dep = depRepo.create({ cardId, dependsOnCardId });
      await depRepo.save(dep);

      await logActivity(boardId, req.user!.id, "dependency_added", "card", cardId, {
        dependsOnCardId,
      });

      res.status(201).json({ dependency: dep });
    } catch (error) {
      logger.error("Error adding card dependency", { error });
      res.status(500).json({ error: "Failed to add dependency" });
    }
  }
);

/**
 * DELETE /api/boards/:boardId/cards/:cardId/dependencies/:depCardId
 * Remove a dependency
 */
router.delete(
  "/:boardId/cards/:cardId/dependencies/:depCardId",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  param("depCardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const cardId = req.params.cardId as string;
      const depCardId = req.params.depCardId as string;

      // Verify board belongs to org
      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      const depRepo = AppDataSource.getRepository(KbCardDependency);
      const dep = await depRepo.findOne({ where: { cardId, dependsOnCardId: depCardId } });
      if (!dep) {
        res.status(404).json({ error: "Dependency not found" });
        return;
      }

      await depRepo.remove(dep);

      await logActivity(boardId, req.user!.id, "dependency_removed", "card", cardId, {
        dependsOnCardId: depCardId,
      });

      res.json({ success: true });
    } catch (error) {
      logger.error("Error removing card dependency", { error });
      res.status(500).json({ error: "Failed to remove dependency" });
    }
  }
);

/**
 * GET /api/boards/:boardId/cards/:cardId/dependencies
 * List dependencies for a card
 */
router.get(
  "/:boardId/cards/:cardId/dependencies",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const cardId = req.params.cardId as string;

      // Verify board belongs to org
      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      const depRepo = AppDataSource.getRepository(KbCardDependency);
      const deps = await depRepo.find({
        where: { cardId },
        relations: ["dependsOnCard"],
      });

      res.json({
        dependencies: deps.map((d) => ({
          cardId: d.dependsOnCardId,
          title: d.dependsOnCard?.title || "",
        })),
      });
    } catch (error) {
      logger.error("Error listing card dependencies", { error });
      res.status(500).json({ error: "Failed to list dependencies" });
    }
  }
);

// =============================================================================
// Board Batch Operations
// =============================================================================

/**
 * POST /api/boards/:boardId/run-all
 * Execute all cards respecting dependencies
 */
router.post(
  "/:boardId/run-all",
  param("boardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;

      // Verify board belongs to org
      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      // Generate a batch ID so all cards in this run-all share a workspace
      const boardExecutionId = crypto.randomUUID();

      // Dynamic import — board-execution service may be created by a parallel task
      const { processUnblockedCards } = await import("../services/board-execution.js");
      const result = await processUnblockedCards(boardId, org.id, boardExecutionId);

      await logActivity(boardId, req.user!.id, "run_all", "board", boardId);

      res.json(result);
    } catch (error) {
      logger.error("Error running all cards", { error });
      res.status(500).json({ error: "Failed to run all cards" });
    }
  }
);

/**
 * POST /api/boards/:boardId/cancel-all
 * Cancel all in-flight tasks for a board
 */
router.post(
  "/:boardId/cancel-all",
  param("boardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;

      // Verify board belongs to org
      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      // Load all cards with worker tasks
      const cardRepo = AppDataSource.getRepository(KbCard);
      const cards = await cardRepo.find({
        where: { boardId },
        relations: ["workerTask"],
      });

      const workerTaskRepo = AppDataSource.getRepository(WorkerTask);
      let cancelled = 0;

      for (const card of cards) {
        if (card.workerTask && !card.workerTask.isTerminal()) {
          await workerTaskRepo.update(card.workerTask.id, { status: "cancelled" });
          cancelled++;
        }
      }

      await logActivity(boardId, req.user!.id, "cancel_all", "board", boardId, { cancelled });

      res.json({ cancelled });
    } catch (error) {
      logger.error("Error cancelling all tasks", { error });
      res.status(500).json({ error: "Failed to cancel all tasks" });
    }
  }
);

// =============================================================================
// Card Label Routes
// =============================================================================

/**
 * POST /api/boards/:boardId/cards/:cardId/labels
 * Add label to card
 */
router.post(
  "/:boardId/cards/:cardId/labels",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  body("labelId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const cardId = req.params.cardId as string;
      const { labelId } = req.body;

      // Verify board
      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      // Verify card
      const cardRepo = AppDataSource.getRepository(KbCard);
      const card = await cardRepo.findOne({ where: { id: cardId, boardId } });
      if (!card) {
        res.status(404).json({ error: "Card not found" });
        return;
      }

      // Verify label belongs to org
      const labelRepo = AppDataSource.getRepository(KbLabel);
      const label = await labelRepo.findOne({ where: { id: labelId, orgId: org.id } });
      if (!label) {
        res.status(404).json({ error: "Label not found" });
        return;
      }

      const clRepo = AppDataSource.getRepository(KbCardLabel);
      const existing = await clRepo.findOne({ where: { cardId, labelId } });
      if (existing) {
        res.json({ success: true, message: "Label already attached" });
        return;
      }

      await clRepo.save(clRepo.create({ cardId, labelId }));

      // Auto-trigger worker task when "workermill" label is added
      if (label.name.toLowerCase() === "workermill") {
        try {
          const workerTask = await runCardAsWorkerTask(cardId, org.id);
          await logActivity(boardId, req.user!.id, "worker_triggered", "card", cardId, {
            workerTaskId: workerTask.id,
          });
        } catch (triggerError) {
          logger.warn("Failed to auto-trigger worker task from label", {
            cardId,
            error: triggerError instanceof Error ? triggerError.message : String(triggerError),
          });
        }
      }

      res.status(201).json({ success: true });
    } catch (error) {
      logger.error("Error adding label to card", { error });
      res.status(500).json({ error: "Failed to add label" });
    }
  }
);

/**
 * DELETE /api/boards/:boardId/cards/:cardId/labels/:labelId
 * Remove label from card
 */
router.delete(
  "/:boardId/cards/:cardId/labels/:labelId",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  param("labelId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const cardId = req.params.cardId as string;
      const labelId = req.params.labelId as string;

      // Verify board belongs to org
      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      const clRepo = AppDataSource.getRepository(KbCardLabel);
      const cl = await clRepo.findOne({ where: { cardId, labelId } });
      if (!cl) {
        res.status(404).json({ error: "Card label not found" });
        return;
      }

      await clRepo.remove(cl);
      res.json({ success: true });
    } catch (error) {
      logger.error("Error removing label from card", { error });
      res.status(500).json({ error: "Failed to remove label" });
    }
  }
);

// =============================================================================
// Comment Routes
// =============================================================================

/**
 * GET /api/boards/:boardId/cards/:cardId/comments
 * List comments for a card
 */
router.get(
  "/:boardId/cards/:cardId/comments",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const cardId = req.params.cardId as string;

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      const commentRepo = AppDataSource.getRepository(KbComment);
      const comments = await commentRepo.find({
        where: { cardId },
        relations: ["author"],
        order: { createdAt: "DESC" },
      });

      res.json({
        comments: comments.map((c) => ({
          id: c.id,
          content: c.content,
          author: c.author ? { id: c.author.id, fullName: c.author.fullName } : null,
          createdAt: c.createdAt,
        })),
      });
    } catch (error) {
      logger.error("Error listing comments", { error });
      res.status(500).json({ error: "Failed to list comments" });
    }
  }
);

/**
 * POST /api/boards/:boardId/cards/:cardId/comments
 * Add a comment
 */
router.post(
  "/:boardId/cards/:cardId/comments",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  body("content").isString().notEmpty().isLength({ max: 5000 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const cardId = req.params.cardId as string;
      const { content } = req.body;

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      const cardRepo = AppDataSource.getRepository(KbCard);
      const card = await cardRepo.findOne({ where: { id: cardId, boardId } });
      if (!card) {
        res.status(404).json({ error: "Card not found" });
        return;
      }

      const commentRepo = AppDataSource.getRepository(KbComment);
      const comment = commentRepo.create({
        cardId,
        authorId: req.user!.id,
        content,
      });
      await commentRepo.save(comment);

      await logActivity(boardId, req.user!.id, "commented", "card", cardId);

      res.status(201).json({
        comment: {
          id: comment.id,
          content: comment.content,
          author: { id: req.user!.id, fullName: req.user!.fullName },
          createdAt: comment.createdAt,
        },
      });
    } catch (error) {
      logger.error("Error adding comment", { error });
      res.status(500).json({ error: "Failed to add comment" });
    }
  }
);

/**
 * DELETE /api/boards/:boardId/cards/:cardId/comments/:commentId
 * Delete a comment
 */
router.delete(
  "/:boardId/cards/:cardId/comments/:commentId",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  param("commentId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const commentId = req.params.commentId as string;
      const userId = req.user!.id;

      const commentRepo = AppDataSource.getRepository(KbComment);
      const comment = await commentRepo.findOne({ where: { id: commentId } });
      if (!comment) {
        res.status(404).json({ error: "Comment not found" });
        return;
      }

      // Any org member can delete comments on their board (agents leave comments users may want to clean up)
      const boardId = req.params.boardId as string;
      const org = req.organization!;
      const board = await AppDataSource.getRepository(KbBoard).findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      await commentRepo.remove(comment);
      res.json({ success: true });
    } catch (error) {
      logger.error("Error deleting comment", { error });
      res.status(500).json({ error: "Failed to delete comment" });
    }
  }
);

// =============================================================================
// Checklist Routes
// =============================================================================

/**
 * POST /api/boards/:boardId/cards/:cardId/checklist
 * Add a checklist item
 */
router.post(
  "/:boardId/cards/:cardId/checklist",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  body("title").isString().notEmpty().isLength({ max: 500 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const cardId = req.params.cardId as string;
      const { title } = req.body;

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      const cardRepo = AppDataSource.getRepository(KbCard);
      const card = await cardRepo.findOne({ where: { id: cardId, boardId } });
      if (!card) {
        res.status(404).json({ error: "Card not found" });
        return;
      }

      const checkRepo = AppDataSource.getRepository(KbChecklist);

      const maxPos = await checkRepo
        .createQueryBuilder("c")
        .where("c.cardId = :cardId", { cardId })
        .select("MAX(c.position)", "max")
        .getRawOne();

      const item = checkRepo.create({
        cardId,
        title,
        isCompleted: false,
        position: (maxPos?.max ?? -1) + 1,
      });
      await checkRepo.save(item);

      res.status(201).json({ item });
    } catch (error) {
      logger.error("Error adding checklist item", { error });
      res.status(500).json({ error: "Failed to add checklist item" });
    }
  }
);

/**
 * PUT /api/boards/:boardId/cards/:cardId/checklist/:itemId
 * Toggle/update checklist item
 */
router.put(
  "/:boardId/cards/:cardId/checklist/:itemId",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  param("itemId").isUUID(),
  body("title").optional().isString().isLength({ max: 500 }),
  body("isCompleted").optional().isBoolean(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const itemId = req.params.itemId as string;
      const { title, isCompleted } = req.body;

      const checkRepo = AppDataSource.getRepository(KbChecklist);
      const item = await checkRepo.findOne({ where: { id: itemId } });
      if (!item) {
        res.status(404).json({ error: "Checklist item not found" });
        return;
      }

      if (title !== undefined) item.title = title;
      if (isCompleted !== undefined) item.isCompleted = isCompleted;
      await checkRepo.save(item);

      res.json({ item });
    } catch (error) {
      logger.error("Error updating checklist item", { error });
      res.status(500).json({ error: "Failed to update checklist item" });
    }
  }
);

/**
 * DELETE /api/boards/:boardId/cards/:cardId/checklist/:itemId
 * Delete checklist item
 */
router.delete(
  "/:boardId/cards/:cardId/checklist/:itemId",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  param("itemId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const itemId = req.params.itemId as string;

      const checkRepo = AppDataSource.getRepository(KbChecklist);
      const item = await checkRepo.findOne({ where: { id: itemId } });
      if (!item) {
        res.status(404).json({ error: "Checklist item not found" });
        return;
      }

      await checkRepo.remove(item);
      res.json({ success: true });
    } catch (error) {
      logger.error("Error deleting checklist item", { error });
      res.status(500).json({ error: "Failed to delete checklist item" });
    }
  }
);

// =============================================================================
// Activity Route
// =============================================================================

/**
 * GET /api/boards/:boardId/activity
 * Board activity feed
 */
router.get(
  "/:boardId/activity",
  param("boardId").isUUID(),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const limit = (req.query.limit as unknown as number) || 50;

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      const activityRepo = AppDataSource.getRepository(KbActivity);
      const activities = await activityRepo.find({
        where: { boardId },
        relations: ["user"],
        order: { createdAt: "DESC" },
        take: limit,
      });

      res.json({
        activities: activities.map((a) => ({
          id: a.id,
          action: a.action,
          entityType: a.entityType,
          entityId: a.entityId,
          metadata: a.metadata,
          user: a.user ? { id: a.user.id, fullName: a.user.fullName } : null,
          createdAt: a.createdAt,
        })),
      });
    } catch (error) {
      logger.error("Error listing activity", { error });
      res.status(500).json({ error: "Failed to list activity" });
    }
  }
);

export default router;
