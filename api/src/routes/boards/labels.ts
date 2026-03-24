/**
 * Label routes: org-level CRUD + card-label association.
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import {
  KbBoard,
  KbCard,
  KbLabel,
  KbCardLabel,
} from "../../models/index.js";
import { logger } from "../../utils/logger.js";
import { body, param, validateRequest } from "../../middleware/validation.js";
import { logActivity, runCardAsWorkerTask } from "./helpers.js";

const router = Router();

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

export default router;
