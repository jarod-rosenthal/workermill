/**
 * Activity feed and attachment routes.
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import {
  KbBoard,
  KbCard,
  KbActivity,
  KbCardAttachment,
} from "../../models/index.js";
import { logger } from "../../utils/logger.js";
import { param, query, validateRequest } from "../../middleware/validation.js";
import { upload } from "./helpers.js";

const router = Router();

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

// =============================================================================
// Attachment Routes
// =============================================================================

/**
 * POST /api/boards/cards/:cardId/attachments
 * Upload a file attachment to a card
 */
router.post(
  "/cards/:cardId/attachments",
  param("cardId").isUUID(),
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const cardId = req.params.cardId as string;
      const file = req.file;

      if (!file) {
        res.status(400).json({ error: "No file provided" });
        return;
      }

      const cardRepo = AppDataSource.getRepository(KbCard);
      const card = await cardRepo.findOne({
        where: { id: cardId },
        relations: ["board"],
      });
      if (!card || card.board.orgId !== org.id) {
        res.status(404).json({ error: "Card not found" });
        return;
      }

      const attachmentRepo = AppDataSource.getRepository(KbCardAttachment);
      const attachment = attachmentRepo.create({
        cardId,
        filename: file.originalname,
        contentType: file.mimetype,
        sizeBytes: file.size,
        data: file.buffer,
        uploadedById: req.user!.id,
      });
      await attachmentRepo.save(attachment);

      res.status(201).json({
        id: attachment.id,
        filename: attachment.filename,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        uploadedById: attachment.uploadedById,
        createdAt: attachment.createdAt,
      });
    } catch (error) {
      logger.error("Error uploading attachment", { error });
      res.status(500).json({ error: "Failed to upload attachment" });
    }
  }
);

/**
 * GET /api/boards/cards/:cardId/attachments
 * List all attachments for a card (metadata only, no binary)
 */
router.get(
  "/cards/:cardId/attachments",
  param("cardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const cardId = req.params.cardId as string;

      const cardRepo = AppDataSource.getRepository(KbCard);
      const card = await cardRepo.findOne({
        where: { id: cardId },
        relations: ["board"],
      });
      if (!card || card.board.orgId !== org.id) {
        res.status(404).json({ error: "Card not found" });
        return;
      }

      const attachmentRepo = AppDataSource.getRepository(KbCardAttachment);
      const attachments = await attachmentRepo.find({
        where: { cardId },
        select: ["id", "filename", "contentType", "sizeBytes", "uploadedById", "createdAt"],
        order: { createdAt: "ASC" },
      });

      res.json(attachments);
    } catch (error) {
      logger.error("Error listing attachments", { error });
      res.status(500).json({ error: "Failed to list attachments" });
    }
  }
);

export default router;
