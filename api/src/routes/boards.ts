/**
 * Kanban Boards API Routes
 *
 * Internal project boards (kb_*) for team task management.
 * Provides CRUD for boards, columns, cards, labels, comments, checklists, and activity.
 */

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
  Organization,
  WorkerTask,
} from "../models/index.js";
import type { WorkerPersona } from "../models/WorkerTask.js";
import { syncKbCardColumn } from "../services/task-monitor.js";
import { authenticateUser } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import { body, param, query, validateRequest } from "../middleware/validation.js";

const router = Router();

// All routes require authentication
router.use(authenticateUser);

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

async function runCardAsWorkerTask(
  cardId: string,
  orgId: string,
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
    if (existing && !["completed", "deployed", "failed", "cancelled", "review_rejected"].includes(existing.status)) {
      throw new Error("Card already has an active worker task");
    }
  }

  const org = await orgRepo.findOne({ where: { id: orgId } });
  if (!org) throw new Error("Organization not found");

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
    workerModel = "claude-sonnet-4-5-20250929";
  } else if (labelNames.includes("haiku")) {
    workerModel = "claude-haiku-4-5-20251001";
  } else {
    workerModel = org.defaultWorkerModel || "";
  }

  // Persona
  const basePersona = (org.defaultWorkerPersona || "backend_developer") as WorkerPersona;
  const workerPersona = needsPlanning ? "project_manager" : basePersona;

  // Repo
  const githubRepo = org.getDefaultRepo();
  if (!githubRepo) {
    throw new Error("No repository configured for organization");
  }

  // Build card description for worker
  const description = [
    card.title,
    card.description || "",
  ].filter(Boolean).join("\n\n");

  // Create WorkerTask
  const workerTask = workerTaskRepo.create({
    orgId: org.id,
    jiraIssueKey: `${card.board?.name?.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "BOARD"}-${card.id.slice(0, 8)}`,
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
  { name: "To Do", position: 0, color: "***REMOVED***6b7280" },
  { name: "In Progress", position: 1, color: "***REMOVED***f59e0b" },
  { name: "Review", position: 2, color: "***REMOVED***8b5cf6" },
  { name: "Approved", position: 3, color: "***REMOVED***3b82f6" },
  { name: "Done", position: 4, color: "***REMOVED***10b981" },
];

const TEMPLATE_COLUMNS: Record<string, Array<{ name: string; position: number; color: string; wipLimit?: number }>> = {
  sprint: [
    { name: "To Do", position: 0, color: "***REMOVED***6b7280" },
    { name: "In Progress", position: 1, color: "***REMOVED***f59e0b", wipLimit: 3 },
    { name: "Review", position: 2, color: "***REMOVED***8b5cf6", wipLimit: 2 },
    { name: "Approved", position: 3, color: "***REMOVED***3b82f6", wipLimit: 2 },
    { name: "Done", position: 4, color: "***REMOVED***10b981" },
  ],
  bugs: [
    { name: "New", position: 0, color: "***REMOVED***ef4444" },
    { name: "Triaging", position: 1, color: "***REMOVED***f59e0b" },
    { name: "In Fix", position: 2, color: "***REMOVED***3b82f6" },
    { name: "Testing", position: 3, color: "***REMOVED***8b5cf6" },
    { name: "Resolved", position: 4, color: "***REMOVED***10b981" },
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
      boards: boards.map((board) => ({
        id: board.id,
        name: board.name,
        description: board.description,
        position: board.position,
        template: board.template,
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
  body("template").optional().isString().isIn(["project", "sprint", "bugs"]),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const user = req.user!;
      const { name, description, template } = req.body;

      const result = await AppDataSource.transaction(async (em) => {
        const boardRepo = em.getRepository(KbBoard);
        const colRepo = em.getRepository(KbColumn);

        // Get max position for ordering
        const maxPos = await boardRepo
          .createQueryBuilder("b")
          .where("b.orgId = :orgId", { orgId: org.id })
          .select("MAX(b.position)", "max")
          .getRawOne();

        const board = boardRepo.create({
          orgId: org.id,
          name,
          description: description || null,
          position: (maxPos?.max ?? -1) + 1,
          template: template || null,
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

      // Load cards with labels, checklist items, and worker task
      const cardRepo = AppDataSource.getRepository(KbCard);
      const cards = await cardRepo
        .createQueryBuilder("card")
        .where("card.boardId = :boardId", { boardId })
        .leftJoinAndSelect("card.cardLabels", "cardLabels")
        .leftJoinAndSelect("cardLabels.label", "label")
        .leftJoinAndSelect("card.checklistItems", "checklist")
        .leftJoinAndSelect("card.workerTask", "workerTask")
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
              assigneeName: null,
              workerTaskId: card.workerTaskId,
              workerStatus: card.workerTask?.status || null,
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
            coverColor: card.coverColor,
            workerTaskId: card.workerTaskId,
            workerStatus: card.workerTask?.status || null,
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
  body("description").optional().isString(),
  body("priority").optional().isIn(["urgent", "high", "medium", "low"]),
  body("dueDate").optional().isISO8601(),
  body("coverColor").optional().isString().isLength({ max: 20 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const { columnId, title, description, priority, dueDate, coverColor } = req.body;

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
      });
      await cardRepo.save(card);

      await logActivity(boardId, req.user!.id, "created", "card", card.id, { title });

      res.status(201).json({ card });
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
          workerTaskId: card.workerTaskId,
          workerStatus: card.workerTask?.status || null,
          assignee: card.assignee
            ? { id: card.assignee.id, fullName: card.assignee.fullName, email: card.assignee.email }
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
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const cardId = req.params.cardId as string;
      const { title, description, priority, dueDate, assigneeId, coverColor } = req.body;

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
      if (msg === "No repository configured for organization") {
        res.status(400).json({ error: msg });
        return;
      }
      logger.error("Error running card as worker task", { error });
      res.status(500).json({ error: "Failed to run card as worker task" });
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
      const cardId = req.params.cardId as string;
      const labelId = req.params.labelId as string;

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
  body("content").isString().notEmpty(),
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

      // Only author can delete their comment
      if (comment.authorId !== userId) {
        res.status(403).json({ error: "You can only delete your own comments" });
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
