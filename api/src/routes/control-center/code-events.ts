import { Router, Request, Response } from "express";
import { authenticateApiKey } from "../../middleware/auth.js";
import { body, validateRequest } from "../../middleware/validation.js";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask } from "../../models/index.js";
import { codeEventEmitter, type CodeEvent } from "../../services/code-events.js";

const router = Router();

/**
 * POST /api/control-center/code-events
 * Receive code write/edit events from worker containers for Live Code Viewer.
 * Ephemeral — emits to in-memory EventEmitter, NO database write.
 * Uses API key authentication (x-api-key header) for org verification.
 */
router.post(
  "/code-events",
  authenticateApiKey,
  body("taskId").isUUID().withMessage("taskId must be a valid UUID"),
  body("toolName")
    .isIn(["Write", "Edit"])
    .withMessage("toolName must be Write or Edit"),
  body("filePath").isString().notEmpty().withMessage("filePath is required"),
  body("content").optional().isString(),
  body("oldStr").optional().isString(),
  body("newStr").optional().isString(),
  body("expert").optional().isString(),
  validateRequest,
  async (req: Request, res: Response) => {
    const org = req.organization!;
    const { taskId, toolName, filePath, content, oldStr, newStr, expert } =
      req.body;

    // Verify task belongs to org
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Emit to in-memory EventEmitter — NO database write
    const event: CodeEvent = {
      taskId,
      toolName,
      filePath,
      content: content
        ? content.substring(0, 100_000)
        : undefined, // Truncate at 100KB
      oldStr: oldStr ? oldStr.substring(0, 100_000) : undefined,
      newStr: newStr ? newStr.substring(0, 100_000) : undefined,
      expert,
      timestamp: new Date().toISOString(),
    };

    codeEventEmitter.emitCodeEvent(taskId, event);

    res.status(202).json({ ok: true });
  },
);

export default router;
