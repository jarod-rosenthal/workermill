/**
 * Comment and checklist routes.
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import {
  KbBoard,
  KbCard,
  KbComment,
  KbChecklist,
} from "../../models/index.js";
import { logger } from "../../utils/logger.js";
import { body, param, validateRequest } from "../../middleware/validation.js";
import { logActivity } from "./helpers.js";

const router = Router();

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

export default router;
