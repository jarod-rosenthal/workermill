/**
 * Card routes: CRUD, move, reorder, run, dependencies.
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import {
  KbBoard,
  KbColumn,
  KbCard,
  KbCardDependency,
  User,
} from "../../models/index.js";
import { logger } from "../../utils/logger.js";
import { body, param, validateRequest } from "../../middleware/validation.js";
import { logActivity, runCardAsWorkerTask } from "./helpers.js";

const router = Router();

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

export default router;
