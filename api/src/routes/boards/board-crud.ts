/**
 * Board CRUD routes: list, create, get, update, delete, star, run-all, cancel-all.
 */

import crypto from "crypto";
import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import {
  KbBoard,
  KbColumn,
  KbCard,
  KbComment,
  KbStarredBoard,
  WorkerTask,
} from "../../models/index.js";
import { logger } from "../../utils/logger.js";
import { body, param, query, validateRequest } from "../../middleware/validation.js";
import {
  generateUniquePrefix,
  logActivity,
  DEFAULT_BOARD_COLUMNS,
  TEMPLATE_COLUMNS,
} from "./helpers.js";

const router = Router();

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
        qualityGateCommands: board.qualityGateCommands,
        ciWorkflowPath: board.ciWorkflowPath,
        priority: board.priority,
        dueDate: board.dueDate,
        assigneeId: board.assigneeId,
        status: board.status,
        prdSource: board.prdSource,
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
          qualityGateCommands: board.qualityGateCommands,
          ciWorkflowPath: board.ciWorkflowPath,
          priority: board.priority,
          dueDate: board.dueDate,
          assigneeId: board.assigneeId,
          status: board.status,
          columnsLocked: !!board.prdSource,
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
  body("priority").optional({ nullable: true }).isIn(["urgent", "high", "medium", "low", null]),
  body("dueDate").optional({ nullable: true }),
  body("assigneeId").optional({ nullable: true }),
  body("status").optional().isIn(["active", "completed", "archived"]),
  body("qualityGateCommands").optional({ nullable: true }),
  body("ciWorkflowPath").optional({ nullable: true }).isString().isLength({ max: 500 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const boardId = req.params.boardId as string;
      const {
        name, description, priority, dueDate, assigneeId, status,
        qualityGateCommands, ciWorkflowPath,
      } = req.body;

      const boardRepo = AppDataSource.getRepository(KbBoard);
      const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });

      if (!board) {
        res.status(404).json({ error: "Board not found" });
        return;
      }

      if (name !== undefined) board.name = name;
      if (description !== undefined) board.description = description || null;
      if (priority !== undefined) board.priority = priority;
      if (dueDate !== undefined) board.dueDate = dueDate ? new Date(dueDate) : null;
      if (assigneeId !== undefined) board.assigneeId = assigneeId;
      if (status !== undefined) board.status = status;
      if (ciWorkflowPath !== undefined) {
        board.ciWorkflowPath = ciWorkflowPath && typeof ciWorkflowPath === "string" ? ciWorkflowPath.trim() || null : null;
      }
      if (qualityGateCommands !== undefined) {
        if (qualityGateCommands === null) {
          board.qualityGateCommands = null;
        } else if (Array.isArray(qualityGateCommands)) {
          const validated: Array<{ name: string; trigger: string; commands: string[] }> = [];
          for (const gate of qualityGateCommands) {
            if (
              typeof gate.name === "string" && gate.name.trim() &&
              typeof gate.trigger === "string" && gate.trigger.trim() &&
              Array.isArray(gate.commands) && gate.commands.every((c: unknown) => typeof c === "string")
            ) {
              validated.push({ name: gate.name.trim(), trigger: gate.trigger.trim(), commands: gate.commands });
            }
          }
          board.qualityGateCommands = validated.length > 0 ? validated : null;
        }
      }

      await boardRepo.save(board);

      await logActivity(boardId, req.user!.id, "updated", "board", boardId, { name, description, priority, status });

      res.json({
        board: {
          id: board.id,
          name: board.name,
          description: board.description,
          priority: board.priority,
          dueDate: board.dueDate,
          assigneeId: board.assigneeId,
          status: board.status,
          qualityGateCommands: board.qualityGateCommands,
          ciWorkflowPath: board.ciWorkflowPath,
          updatedAt: board.updatedAt,
        },
      });
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
      const { processUnblockedCards } = await import("../../services/board-execution.js");
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

export default router;
