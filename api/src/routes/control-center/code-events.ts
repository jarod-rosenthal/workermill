import { Router, Request, Response } from "express";
import { authenticateApiKey } from "../../middleware/auth.js";
import {
  body,
  param,
  query,
  validateRequest,
} from "../../middleware/validation.js";
import { asyncHandler } from "../../middleware/error-handler.js";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask, WorkerTaskLog } from "../../models/index.js";
import {
  codeEventEmitter,
  type CodeEvent,
} from "../../services/code-events.js";
import { MoreThan } from "typeorm";

const router = Router();

/**
 * POST /api/control-center/code-events
 * Receive code write/edit events from worker containers for Live Code Viewer.
 * Persists to WorkerTaskLog AND emits to in-memory EventEmitter for SSE.
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
  asyncHandler(async (req: Request, res: Response) => {
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

    // Emit to in-memory EventEmitter for SSE clients
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

    // Persist to WorkerTaskLog for historical retrieval
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);
    const action = toolName === "Write" ? "Wrote" : "Edited";
    // For Write events, persist `content` as `newStr` so the Live Diff viewer can show it
    // Match the SSE transmission limit (100KB) so VS Code polling gets the same data as the dashboard SSE
    const PERSIST_LIMIT = 100_000;
    const persistedNewStr = newStr
      ? newStr.substring(0, PERSIST_LIMIT)
      : content
        ? content.substring(0, PERSIST_LIMIT)
        : null;
    const logData = WorkerTaskLog.create(taskId, "code_event", `${action} ${filePath}`, {
      filePath,
      metadata: {
        toolName,
        expert: expert || null,
        oldStr: oldStr ? oldStr.substring(0, PERSIST_LIMIT) : null,
        newStr: persistedNewStr,
        isWrite: toolName === "Write",
      },
    });
    const log = logRepo.create(logData);
    await logRepo.save(log);

    res.status(202).json({ ok: true });
  }),
);

/**
 * GET /api/control-center/code-events/:taskId
 * Fetch persisted code events for a task. Supports incremental polling via ?since=ISO8601.
 * Used by the VS Code extension's LiveDiffPanel (via agent local-api proxy).
 */
router.get(
  "/code-events/:taskId",
  authenticateApiKey,
  param("taskId").isUUID().withMessage("taskId must be a valid UUID"),
  query("since").optional().isISO8601().withMessage("since must be an ISO8601 date"),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const taskId = req.params.taskId as string;
    const since = req.query.since ? String(req.query.since) : null;

    // Verify task belongs to org
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const logRepo = AppDataSource.getRepository(WorkerTaskLog);

    const whereClause: Record<string, unknown> = {
      taskId,
      type: "code_event" as const,
    };
    if (since) {
      whereClause.createdAt = MoreThan(new Date(since));
    }

    const logs = await logRepo.find({
      where: whereClause,
      order: { createdAt: "ASC" },
      take: 500,
    });

    res.json(
      logs.map((log) => ({
        id: log.id,
        filePath: log.filePath,
        message: log.message,
        metadata: log.metadata,
        createdAt: log.createdAt,
      })),
    );
  }),
);

export default router;
