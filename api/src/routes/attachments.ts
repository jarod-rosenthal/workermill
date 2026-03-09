import { Router, Request, Response } from "express";
import { param } from "express-validator";
import { AppDataSource } from "../db/connection.js";
import { KbCardAttachment, KbCard } from "../models/index.js";
import { validateRequest } from "../middleware/validation.js";
import { logger } from "../utils/logger.js";

const router = Router();

/**
 * GET /api/attachments/:id
 * Download raw file bytes. Accepts JWT auth or task token.
 */
router.get(
  "/:id",
  param("id").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const attachmentRepo = AppDataSource.getRepository(KbCardAttachment);
      const attachment = await attachmentRepo.findOne({
        where: { id: req.params.id as string },
      });

      if (!attachment) {
        res.status(404).json({ error: "Attachment not found" });
        return;
      }

      // Verify org access
      const cardRepo = AppDataSource.getRepository(KbCard);
      const card = await cardRepo.findOne({
        where: { id: attachment.cardId },
        relations: ["board"],
      });
      if (!card || card.board.orgId !== req.organization!.id) {
        res.status(404).json({ error: "Attachment not found" });
        return;
      }

      res.setHeader("Content-Type", attachment.contentType);
      res.setHeader("Content-Length", attachment.sizeBytes);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${attachment.filename.replace(/"/g, '\\"')}"`
      );
      res.send(attachment.data);
    } catch (error) {
      logger.error("Error downloading attachment", { error });
      res.status(500).json({ error: "Failed to download attachment" });
    }
  }
);

/**
 * DELETE /api/attachments/:id
 * Delete an attachment. Uploader or board admin only.
 */
router.delete(
  "/:id",
  param("id").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const attachmentRepo = AppDataSource.getRepository(KbCardAttachment);
      const attachment = await attachmentRepo.findOne({
        where: { id: req.params.id as string },
        select: ["id", "cardId", "uploadedById"],
      });

      if (!attachment) {
        res.status(404).json({ error: "Attachment not found" });
        return;
      }

      const cardRepo = AppDataSource.getRepository(KbCard);
      const card = await cardRepo.findOne({
        where: { id: attachment.cardId },
        relations: ["board"],
      });
      if (!card || card.board.orgId !== req.organization!.id) {
        res.status(404).json({ error: "Attachment not found" });
        return;
      }

      // Only uploader or org admin can delete
      if (attachment.uploadedById !== req.user!.id && req.orgRole !== "admin" && req.orgRole !== "owner") {
        res.status(403).json({ error: "Not authorized to delete this attachment" });
        return;
      }

      await attachmentRepo.remove(attachment);
      res.json({ success: true });
    } catch (error) {
      logger.error("Error deleting attachment", { error });
      res.status(500).json({ error: "Failed to delete attachment" });
    }
  }
);

export default router;
