/**
 * Column routes: list, create, update, delete, reorder.
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import {
  KbBoard,
  KbColumn,
  KbCard,
} from "../../models/index.js";
import { logger } from "../../utils/logger.js";
import { body, param, validateRequest } from "../../middleware/validation.js";
import { logActivity } from "./helpers.js";

const router = Router();

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

export default router;
