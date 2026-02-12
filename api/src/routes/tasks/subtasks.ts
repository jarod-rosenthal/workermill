import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask } from "../../models/index.js";
import { authenticateRequest, authenticateApiKey } from "../../middleware/auth.js";
import { logger } from "../../utils/logger.js";
import { body, param, validateRequest } from "../../middleware/validation.js";

const router = Router();

// All routes require authentication (matches original global router.use(authenticateRequest))
router.use(authenticateRequest);

// =============================================================================
// Multi-Persona Single Container Endpoints
// =============================================================================

/**
 * POST /api/tasks/:id/subtask/:index/complete
 * Report completion status of a subtask in multi-persona execution.
 * Called by the worker container after each subtask completes.
 * Uses API key authentication (x-api-key header)
 */
router.post(
  "/:id/subtask/:index/complete",
  authenticateApiKey,
  param("id").isUUID().withMessage("id must be a valid UUID"),
  param("index").isInt({ min: 0 }).withMessage("index must be a non-negative integer"),
  body("status").isIn(["completed", "failed", "skipped"]).withMessage("status must be completed, failed, or skipped"),
  body("commitHash").optional().isString(),
  body("error").optional().isString(),
  body("persona").optional().isString(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const taskId = req.params.id as string;
      const subtaskIndex = parseInt(req.params.index as string, 10);
      const org = req.organization!;
      const { status, commitHash, error, persona } = req.body;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      // Support platform tasks: check both orgId and billingOrgId
      const task = await taskRepo.findOne({
        where: [
          { id: taskId, orgId: org.id },
          { id: taskId, billingOrgId: org.id },
        ],
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      if (!task.isMultiPersonaTask()) {
        res.status(400).json({ error: "Task is not a multi-persona task" });
        return;
      }

      const subtaskDef = task.subtasksJson?.[subtaskIndex];
      if (!subtaskDef) {
        res.status(400).json({ error: `Subtask ${subtaskIndex} not found` });
        return;
      }

      // Create subtask result
      const result = {
        index: subtaskIndex,
        status,
        commitHash: commitHash || undefined,
        error: error || undefined,
        startedAt: new Date().toISOString(), // Approximation - actual start tracked elsewhere
        completedAt: new Date().toISOString(),
        persona: persona || subtaskDef.persona,
      };

      // Add result and advance index
      task.addSubtaskResult(result);

      // Only advance index if successful
      if (status === "completed") {
        task.currentSubtaskIndex = subtaskIndex + 1;
      }

      await taskRepo.save(task);

      logger.info("Subtask completion reported", {
        taskId,
        subtaskIndex,
        status,
        commitHash,
        totalSubtasks: task.getSubtaskCount(),
        currentIndex: task.currentSubtaskIndex,
        progress: task.getMultiPersonaProgress(),
      });

      res.json({
        success: true,
        taskId,
        subtaskIndex,
        status,
        progress: task.getMultiPersonaProgress(),
        isComplete: task.isMultiPersonaComplete(),
      });
    } catch (error) {
      logger.error("Error reporting subtask completion", { error, taskId: req.params.id, subtaskIndex: req.params.index });
      res.status(500).json({ error: "Failed to report subtask completion" });
    }
  }
);

/**
 * GET /api/tasks/:id/subtask-progress
 * Get multi-persona execution progress for a task.
 * Returns current subtask index, results, and overall progress.
 */
router.get(
  "/:id/subtask-progress",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const taskId = req.params.id as string;
      const orgId = req.organization!.id;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id: taskId, orgId },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      if (!task.isMultiPersonaTask()) {
        res.json({
          isMultiPersonaTask: false,
          message: "Task is not using multi-persona execution",
        });
        return;
      }

      res.json({
        isMultiPersonaTask: true,
        taskId,
        totalSubtasks: task.getSubtaskCount(),
        currentSubtaskIndex: task.currentSubtaskIndex,
        progress: task.getMultiPersonaProgress(),
        isComplete: task.isMultiPersonaComplete(),
        subtasks: task.subtasksJson?.map((s, i) => ({
          index: i,
          title: s.title,
          persona: s.persona,
          result: task.getSubtaskResult(i),
        })),
      });
    } catch (error) {
      logger.error("Error getting subtask progress", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to get subtask progress" });
    }
  }
);

export default router;
