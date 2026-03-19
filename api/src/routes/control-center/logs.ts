import { Router, Request, Response } from "express";
import { GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { authenticateRequest, authenticateSSE, authenticateApiKey } from "../../middleware/auth.js";
import { acquireSSESlot, releaseSSESlot } from "../../middleware/sse-limiter.js";
import { asyncHandler } from "../../middleware/error-handler.js";
import { AppDataSource } from "../../db/connection.js";
import { Not, type FindOptionsWhere } from "typeorm";
import { WorkerTask, WorkerTaskLog, WorkerTaskError } from "../../models/index.js";
import type { WorkerLogType, WorkerLogSeverity } from "../../models/WorkerTaskLog.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/index.js";
import {
  NotFoundError,
} from "../../utils/errors.js";
import {
  parseRalphProgressMarker,
} from "../../services/log-parser.js";
import { body, param, query, validateRequest } from "../../middleware/validation.js";
import { planningProgressEmitter, type PlanningProgressEvent } from "../../services/planning-progress-events.js";
import { codeEventEmitter, type CodeEvent } from "../../services/code-events.js";
import {
  cloudwatchLogs,
  parseLogForError,
  parseCursor,
  capMessage,
  formatLogForResponse,
} from "./helpers.js";

const router = Router();

/**
 * GET /api/control-center/logs/:taskId
 * REST endpoint for polling task logs (fallback when SSE disconnects)
 */
router.get(
  "/logs/:taskId",
  authenticateRequest,
  param("taskId").isUUID().withMessage("taskId must be a valid UUID"),
  query("since").optional().isString(),
  query("limit").optional().isInt({ min: 1, max: 50000 }).withMessage("limit must be between 1 and 50000"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const taskId = req.params.taskId as string;
      const org = req.organization!;
      const since = req.query.since ? String(req.query.since) : null;
      // If no limit provided, fetch all logs (for completed task viewing)
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);

    // Verify task belongs to org
    const task = await taskRepo.findOne({ where: { id: taskId, orgId: org.id } });
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Parse cursor if provided (exclude code_event — has its own endpoint)
    const whereClause: FindOptionsWhere<WorkerTaskLog> = { taskId, type: Not("code_event" as WorkerLogType) };
    if (since) {
      const cursor = parseCursor(since);
      if (cursor) {
        // Get logs after cursor position (exclude code_event — has its own endpoint)
        const queryBuilder = logRepo
          .createQueryBuilder("log")
          .where("log.taskId = :taskId", { taskId })
          .andWhere("log.type != :excludeType", { excludeType: "code_event" })
          .andWhere(
            "(log.createdAt > :lastCreatedAt OR (log.createdAt = :lastCreatedAt AND log.id > :lastId))",
            { lastCreatedAt: cursor.lastCreatedAt, lastId: cursor.lastId }
          )
          .orderBy("log.createdAt", "ASC")
          .addOrderBy("log.id", "ASC");

        // Fetch limit+1 to detect hasMore
        if (limit !== undefined) {
          queryBuilder.take(limit + 1);
        }

        const logs = await queryBuilder.getMany();
        const hasMore = limit !== undefined && logs.length > limit;
        if (hasMore) logs.pop();
        const formatted = logs.map(formatLogForResponse);

        res.json({
          taskId,
          taskStatus: task.status,
          logs: formatted,
          nextCursor: formatted.length > 0 ? formatted[formatted.length - 1].cursor : null,
          hasMore,
        });
        return;
      }
    }

    // No cursor - get all logs for task (sorted chronologically)
    if (limit !== undefined) {
      // Fetch limit+1 in DESC order to detect hasMore, then reverse for chronological
      const logs = await logRepo.find({
        where: whereClause,
        order: { createdAt: "DESC" },
        take: limit + 1,
      });
      const hasMore = logs.length > limit;
      if (hasMore) logs.pop();
      const formatted = logs.reverse().map(formatLogForResponse);

      res.json({
        taskId,
        taskStatus: task.status,
        logs: formatted,
        nextCursor: formatted.length > 0 ? formatted[formatted.length - 1].cursor : null,
        hasMore,
      });
    } else {
      const logs = await logRepo.find({
        where: whereClause,
        order: { createdAt: "ASC" },
      });
      const formatted = logs.map(formatLogForResponse);

      res.json({
        taskId,
        taskStatus: task.status,
        logs: formatted,
        nextCursor: formatted.length > 0 ? formatted[formatted.length - 1].cursor : null,
        hasMore: false,
      });
    }
    } catch (error) {
      logger.error("Error fetching task logs", { error });
      res.status(500).json({ error: "Failed to fetch task logs" });
    }
  }
);

/**
 * GET /api/control-center/logs/:taskId/all
 * Fetch all logs for a task (used by Manager for log analysis)
 * Uses API key authentication
 */
router.get("/logs/:taskId/all", authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const taskId = req.params.taskId as string;
    const org = req.organization!;
    const limit = req.query.limit ? parseInt(String(req.query.limit)) : 500;
    const since = req.query.since ? String(req.query.since) : null;

    // Verify task belongs to org
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({ where: { id: taskId, orgId: org.id } });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Fetch logs ordered by creation time (exclude code_event — has its own endpoint)
    // Supports incremental polling via ?since=ISO8601
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);
    const qb = logRepo
      .createQueryBuilder("log")
      .where("log.task_id = :taskId", { taskId })
      .andWhere("log.type != :excludeType", { excludeType: "code_event" });

    if (since) {
      qb.andWhere("log.created_at > :since", { since: new Date(since) });
    }

    const logs = await qb
      .orderBy("log.created_at", "ASC")
      .take(limit)
      .getMany();

    res.json(logs.map((log) => ({
      id: log.id,
      type: log.type,
      message: capMessage(log.message),
      severity: log.severity,
      createdAt: log.createdAt,
      command: log.command,
      exitCode: log.exitCode,
      stdout: log.stdout,
      stderr: log.stderr,
      filePath: log.filePath,
      durationMs: log.durationMs,
      metadata: log.metadata,
    })));
  } catch (error) {
    logger.error("Error fetching all logs", { error, taskId: req.params.taskId });
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

/**
 * @swagger
 * /api/control-center/logs/{taskId}/stream:
 *   get:
 *     summary: Stream task logs in real-time (SSE)
 *     description: |
 *       Server-Sent Events (SSE) endpoint for streaming task logs in real-time from the database.
 *       Supports automatic resume via Last-Event-ID header or manual resume via 'since' query parameter.
 *       Polls database every 1 second for new logs. Automatically ends when task reaches terminal status.
 *     tags: [Logs]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Task UUID to stream logs for
 *       - in: query
 *         name: since
 *         schema:
 *           type: string
 *         description: |
 *           Resume cursor in format "ISO8601|UUID" (e.g., "2025-01-15T10:30:00.000Z|abc-123").
 *           If not provided, starts from 5 minutes ago.
 *     responses:
 *       200:
 *         description: SSE stream of task logs
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                   enum: [connected, log, status, complete, error]
 *                   description: Event type
 *                 taskId:
 *                   type: string
 *                   format: uuid
 *                   description: Task UUID (in 'connected' event)
 *                 status:
 *                   type: string
 *                   description: Current task status (in 'status' and 'complete' events)
 *                 cursor:
 *                   type: string
 *                   description: Resume cursor for this event
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   description: Log timestamp
 *                 logType:
 *                   type: string
 *                   description: Type of log entry
 *                 message:
 *                   type: string
 *                   description: Log message content
 *                 severity:
 *                   type: string
 *                   enum: [debug, info, warn, error]
 *                   description: Log severity level
 *       404:
 *         description: Task not found
 *       401:
 *         description: Unauthorized
 */
router.get("/logs/:taskId/stream", authenticateSSE, async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const org = req.organization!;
  const since = req.query.since ? String(req.query.since) : null;

  // Validate taskId is a valid UUID to prevent database errors
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(taskId)) {
    res.status(400).json({ error: "Invalid task ID format" });
    return;
  }

  // Verify task belongs to org
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  const task = await taskRepo.findOne({ where: { id: taskId, orgId: org.id } });

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const orgId = org.id;
  if (!acquireSSESlot(orgId, 10)) {
    res.status(429).json({ error: "Too many log stream connections" });
    return;
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Hint client how long to wait before reconnect attempts
  res.write("retry: 2000\n\n");

  let isConnected = true;
  let lastStatus = task.status;

  // Parse cursor from Last-Event-ID header (auto-managed by EventSource) or query param
  const lastEventIdHeader = req.headers["last-event-id"];
  const headerCursor = typeof lastEventIdHeader === "string" ? lastEventIdHeader : null;

  // Default to "now minus 30 seconds" to avoid replaying huge history on fresh connect.
  // The frontend fetches the most recent 100 logs via REST before connecting SSE,
  // so SSE only needs to catch up from a very recent point.
  let cursor = (headerCursor ? parseCursor(headerCursor) : null)
    || (since ? parseCursor(since) : null)
    || {
      lastCreatedAt: new Date(Date.now() - 30 * 1000),
      lastId: "00000000-0000-0000-0000-000000000000",
    };

  // Send initial connection message with current cursor
  res.write(`data: ${JSON.stringify({
    type: "connected",
    taskId,
    status: task.status,
    cursor: `${cursor.lastCreatedAt.toISOString()}|${cursor.lastId}`,
  })}\n\n`);

  const logRepo = AppDataSource.getRepository(WorkerTaskLog);

  const sendLogs = async () => {
    if (!isConnected) return;

    try {
      // Check for status changes (include orgId for defense-in-depth)
      const currentTask = await taskRepo.findOne({ where: { id: taskId, orgId: org.id } });
      if (!currentTask) {
        res.write(`data: ${JSON.stringify({ type: "error", message: "Task not found" })}\n\n`);
        res.end();
        return;
      }

      if (currentTask.status !== lastStatus) {
        try {
          res.write(`data: ${JSON.stringify({ type: "status", status: currentTask.status })}\n\n`);
        } catch { isConnected = false; return; }
        lastStatus = currentTask.status;
      }

      // Query for new logs after cursor position (handles timestamp ties with ID comparison)
      // Exclude code_event — those have their own dedicated endpoint + LiveDiffPanel
      const newLogs = await logRepo
        .createQueryBuilder("log")
        .where("log.taskId = :taskId", { taskId })
        .andWhere("log.type != :excludeType", { excludeType: "code_event" })
        .andWhere(
          "(log.createdAt > :lastCreatedAt OR (log.createdAt = :lastCreatedAt AND log.id > :lastId))",
          { lastCreatedAt: cursor.lastCreatedAt, lastId: cursor.lastId }
        )
        .orderBy("log.createdAt", "ASC")
        .addOrderBy("log.id", "ASC")
        .take(100)
        .getMany();

      // Send each log as a separate SSE event with event ID for resume
      for (const log of newLogs) {
        const eventId = `${log.createdAt.toISOString()}|${log.id}`;
        try {
          res.write(`id: ${eventId}\n`);
          res.write("event: log\n");
          res.write(`data: ${JSON.stringify({
            type: "log",
            id: log.id,
            timestamp: log.createdAt.toISOString(),
            logType: log.type,
            message: capMessage(log.message),
            severity: log.severity,
            command: log.command,
            exitCode: log.exitCode,
            filePath: log.filePath,
            durationMs: log.durationMs,
            metadata: log.metadata,
            cursor: eventId,
          })}\n\n`);
        } catch { isConnected = false; return; }

        // Check for Ralph progress markers and emit separate event
        const ralphProgress = parseRalphProgressMarker(log.message);
        if (ralphProgress) {
          try {
            res.write("event: ralph_progress\n");
            res.write(`data: ${JSON.stringify({
              type: "ralph_progress",
              currentStory: ralphProgress.currentStory,
              totalStories: ralphProgress.totalStories,
              currentStoryDescription: ralphProgress.currentStoryDescription,
              timestamp: log.createdAt.toISOString(),
            })}\n\n`);
          } catch { isConnected = false; return; }
        }

        // Update cursor
        cursor = { lastCreatedAt: log.createdAt, lastId: log.id };
      }

      // Check if task is complete
      if (currentTask.isTerminal()) {
        try {
          res.write(`data: ${JSON.stringify({
            type: "complete",
            status: currentTask.status,
            timestamp: new Date().toISOString(),
          })}\n\n`);
          res.end();
        } catch { isConnected = false; }
      }
    } catch (error) {
      logger.error("Error in SSE log stream", { error, taskId });
    }
  };

  const sendPing = () => {
    if (!isConnected) return;
    try {
      res.write("event: ping\n");
      res.write("data: {}\n\n");
    } catch { isConnected = false; }
  };

  // Initial fetch
  await sendLogs();

  // Poll every 2 seconds for new logs (reduced from 1s to cut per-client DB load)
  let inFlight = false;
  const logInterval = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await sendLogs();
    } finally {
      inFlight = false;
    }
  }, 2000);

  // Ping every 20 seconds to keep connection alive
  const pingInterval = setInterval(sendPing, 20000);

  // Subscribe to real-time planning progress events (in-memory, not persisted)
  const unsubscribePlanning = planningProgressEmitter.subscribeToProgress(
    taskId,
    (event: PlanningProgressEvent) => {
      if (!isConnected) return;
      try {
        res.write("event: planning_progress\n");
        res.write(`data: ${JSON.stringify({
          type: "planning_progress",
          phase: event.phase,
          elapsedSeconds: event.elapsedSeconds,
          detail: event.detail,
          charsGenerated: event.charsGenerated,
          toolCallCount: event.toolCallCount,
        })}\n\n`);
      } catch {
        isConnected = false;
      }
    },
  );

  // Subscribe to real-time code events (in-memory, not persisted) for Live Code Viewer
  const unsubscribeCode = codeEventEmitter.subscribeToCodeEvents(
    taskId,
    (event: CodeEvent) => {
      if (!isConnected) return;
      try {
        res.write("event: code_event\n");
        res.write(`data: ${JSON.stringify({
          type: "code_event",
          toolName: event.toolName,
          filePath: event.filePath,
          content: event.content,
          oldStr: event.oldStr,
          newStr: event.newStr,
          expert: event.expert,
          timestamp: event.timestamp,
        })}\n\n`);
      } catch {
        isConnected = false;
      }
    },
  );

  req.on("close", () => {
    isConnected = false;
    clearInterval(logInterval);
    clearInterval(pingInterval);
    unsubscribePlanning();
    unsubscribeCode();
    releaseSSESlot(orgId);
    logger.debug("Log stream client disconnected", { taskId });
  });
});

/**
 * POST /api/control-center/logs
 * Receive logs from the worker container
 * Used by the worker entrypoint to stream logs in real-time
 * Uses API key authentication (x-api-key header) for org verification
 */
router.post(
  "/logs",
  authenticateApiKey,
  body("taskId").isUUID().withMessage("taskId must be a valid UUID"),
  body("type").isString().notEmpty().withMessage("type is required"),
  body("message").isString().notEmpty().withMessage("message is required"),
  body("severity").optional().isIn(["debug", "info", "warn", "error"]).withMessage("severity must be debug, info, warn, or error"),
  body("command").optional().isString(),
  body("exitCode").optional().isInt(),
  body("stdout").optional().isString(),
  body("stderr").optional().isString(),
  body("filePath").optional().isString(),
  body("durationMs").optional().isInt(),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const { taskId, type, message, severity, command, exitCode, stdout, stderr, filePath, durationMs } = req.body;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);

    // Verify task exists AND belongs to the authenticated org (prevents cross-org data leakage)
    const task = await taskRepo.findOne({ where: { id: taskId, orgId: org.id } });
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    // Create and save log entry
    const logData = WorkerTaskLog.create(taskId, type, message, {
      severity: severity || "info",
      command,
      exitCode,
      stdout,
      stderr,
      filePath,
      durationMs,
    });

    const log = logRepo.create(logData);
    await logRepo.save(log);

    // Auto-persist errors/warnings for audit trail (survives client re-init)
    const parsedError = parseLogForError(message, severity, type);
    if (parsedError) {
      const errorRepo = AppDataSource.getRepository(WorkerTaskError);

      // Build error message: include stderr if available (contains actual error details)
      // Also include exitCode for context
      let fullErrorMessage = parsedError.message;
      if (stderr && stderr.trim()) {
        fullErrorMessage += `\n\nstderr:\n${stderr.trim()}`;
      }
      if (exitCode !== undefined && exitCode !== null && exitCode !== 0) {
        fullErrorMessage += `\n\nExit code: ${exitCode}`;
      }

      const errorData = WorkerTaskError.create(
        taskId,
        parsedError.type,
        parsedError.category,
        fullErrorMessage,
        {
          timestamp: log.createdAt.getTime(),
          file: parsedError.file,
          line: parsedError.line,
        }
      );
      const taskError = errorRepo.create(errorData);
      await errorRepo.save(taskError);
    }

    // Update task heartbeat (atomic — don't clobber other fields)
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({ lastHeartbeatAt: new Date() })
      .where("id = :id", { id: task.id })
      .execute();

    res.status(201).json({
      id: log.id,
      taskId: log.taskId,
      timestamp: log.createdAt,
    });
  })
);

/**
 * POST /api/control-center/logs/batch
 * Receive multiple log entries in a single request.
 * Used by the remote agent planner to reduce HTTP round-trips.
 */
router.post(
  "/logs/batch",
  authenticateApiKey,
  body("entries").isArray({ min: 1, max: 100 }).withMessage("entries must be an array of 1-100 log entries"),
  body("entries.*.taskId").isUUID().withMessage("each entry must have a valid taskId"),
  body("entries.*.type").isString().notEmpty().withMessage("each entry must have a type"),
  body("entries.*.message").isString().notEmpty().withMessage("each entry must have a message"),
  body("entries.*.severity").optional().isIn(["debug", "info", "warn", "error"]),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const entries = req.body.entries as Array<{
      taskId: string;
      type: WorkerLogType;
      message: string;
      severity?: WorkerLogSeverity;
    }>;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);

    // All entries must be for the same task (simplifies auth check)
    const taskIds = [...new Set(entries.map(e => e.taskId))];
    if (taskIds.length > 1) {
      res.status(400).json({ error: "All entries must be for the same taskId" });
      return;
    }

    const taskId = taskIds[0];
    const task = await taskRepo.findOne({ where: { id: taskId, orgId: org.id } });
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    // Bulk insert all log entries
    const logEntities = entries.map(entry =>
      logRepo.create(
        WorkerTaskLog.create(entry.taskId, entry.type, entry.message, {
          severity: entry.severity || "info",
        }),
      ),
    );
    await logRepo.save(logEntities);

    // Update task heartbeat once
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({ lastHeartbeatAt: new Date() })
      .where("id = :id", { id: task.id })
      .execute();

    res.status(201).json({ inserted: logEntities.length });
  }),
);

/**
 * POST /api/control-center/logs/:taskId/classify-errors
 * Post-hoc error classification: marks errors as "fatal" or "recoverable"
 *
 * Called by workers at task completion to distinguish real errors from false alarms.
 * - If exitCode !== 0: the LAST error is marked "fatal", all others "recoverable"
 * - If exitCode === 0: ALL errors are marked "recoverable" (task succeeded despite errors)
 *
 * This allows the frontend to:
 * - Show fatal errors in red (actual failures)
 * - Show recoverable errors in muted colors (false alarms, retried operations)
 */
router.post(
  "/logs/:taskId/classify-errors",
  authenticateApiKey,
  param("taskId").isUUID().withMessage("taskId must be a valid UUID"),
  body("exitCode").isInt().withMessage("exitCode is required"),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const taskId = req.params.taskId as string;
    const exitCode = req.body.exitCode as number;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);

    // Verify task exists and belongs to org
    const task = await taskRepo.findOne({ where: { id: taskId, orgId: org.id } });
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    // Get all error logs for this task, ordered by creation time
    const errorLogs = await logRepo.find({
      where: { taskId, severity: "error" as WorkerLogSeverity },
      order: { createdAt: "ASC" },
    });

    if (errorLogs.length === 0) {
      res.json({
        taskId,
        classified: 0,
        message: "No error logs to classify",
      });
      return;
    }

    // Classify errors based on exit code
    let fatalCount = 0;
    let recoverableCount = 0;

    for (let i = 0; i < errorLogs.length; i++) {
      const log = errorLogs[i];
      const isLastError = i === errorLogs.length - 1;

      // Only the last error before non-zero exit is "fatal"
      // All other errors are "recoverable" (agent recovered or exit was clean)
      const errorType = (exitCode !== 0 && isLastError) ? "fatal" : "recoverable";

      // Update metadata with errorType
      log.metadata = {
        ...(log.metadata || {}),
        errorType,
      };

      if (errorType === "fatal") {
        fatalCount++;
      } else {
        recoverableCount++;
      }
    }

    // Batch save all updates
    await logRepo.save(errorLogs);

    logger.info("Classified error logs", {
      taskId,
      exitCode,
      total: errorLogs.length,
      fatal: fatalCount,
      recoverable: recoverableCount,
    });

    res.json({
      taskId,
      exitCode,
      classified: errorLogs.length,
      fatal: fatalCount,
      recoverable: recoverableCount,
    });
  })
);

/**
 * GET /api/control-center/errors/:taskId
 * Get all persisted errors/warnings for a task.
 * Survives worker restarts and client re-initialization.
 */
router.get(
  "/errors/:taskId",
  authenticateRequest,
  param("taskId").isUUID().withMessage("taskId must be a valid UUID"),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;
    const org = req.organization!;

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const errorRepo = AppDataSource.getRepository(WorkerTaskError);

    // Verify task exists and belongs to org
    const task = await taskRepo.findOne({ where: { id: taskId, orgId: org.id } });
    if (!task) {
      throw new NotFoundError("Task not found");
    }

    // Fetch all persisted errors ordered by timestamp
    const errors = await errorRepo.find({
      where: { taskId },
      order: { timestamp: "ASC" },
    });

    res.json({
      taskId,
      errors: errors.map(e => ({
        id: e.id,
        timestamp: Number(e.timestamp),
        type: e.type,
        category: e.category,
        message: e.message,
        file: e.file,
        line: e.line,
      })),
    });
  })
);

/**
 * GET /api/control-center/logs/:taskId/cloudwatch
 * SSE stream for real-time CloudWatch logs (actual container output)
 */
router.get("/logs/:taskId/cloudwatch", authenticateSSE, async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const org = req.organization!;

  // Verify task belongs to org and has ECS task ID
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  const task = await taskRepo.findOne({ where: { id: taskId, orgId: org.id } });

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (!task.ecsTaskId) {
    res.status(400).json({ error: "Task has no ECS task ID - worker not yet started" });
    return;
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write("retry: 2000\n\n");

  let isConnected = true;
  let nextToken: string | undefined;

  const logGroupName = `/ecs/workermill-${config.environment}/worker`;
  const logStreamName = `worker/worker/${task.ecsTaskId}`;

  req.on("close", () => {
    isConnected = false;
    logger.debug("CloudWatch log stream client disconnected", { taskId });
  });

  // Send initial connection message
  res.write(`data: ${JSON.stringify({
    type: "connected",
    taskId,
    ecsTaskId: task.ecsTaskId,
    logGroup: logGroupName,
    logStream: logStreamName,
  })}\n\n`);

  const fetchAndSendLogs = async () => {
    if (!isConnected) return;

    try {
      const command = new GetLogEventsCommand({
        logGroupName,
        logStreamName,
        startFromHead: nextToken ? false : true,
        nextToken,
        limit: 100,
      });

      const response = await cloudwatchLogs.send(command);

      if (response.events && response.events.length > 0) {
        for (const event of response.events) {
          if (!isConnected) break;
          res.write(`event: log\n`);
          res.write(`data: ${JSON.stringify({
            type: "log",
            timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString(),
            message: event.message || "",
            ingestionTime: event.ingestionTime,
          })}\n\n`);
        }
      }

      // Update token for next fetch
      if (response.nextForwardToken && response.nextForwardToken !== nextToken) {
        nextToken = response.nextForwardToken;
      }

      // Check if task is terminal (include orgId for defense-in-depth)
      const currentTask = await taskRepo.findOne({ where: { id: taskId, orgId: org.id } });
      if (currentTask?.isTerminal()) {
        res.write(`data: ${JSON.stringify({
          type: "complete",
          status: currentTask.status,
        })}\n\n`);
        res.end();
        return;
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Log stream might not exist yet - that's OK, keep polling
      if (!errorMessage.includes("ResourceNotFoundException")) {
        logger.error("Error fetching CloudWatch logs", { error: errorMessage, taskId, logStreamName });
      }
    }
  };

  // Initial fetch
  await fetchAndSendLogs();

  // Poll every 2 seconds for new logs (reduced from 1s to cut per-client DB load)
  const logInterval = setInterval(async () => {
    if (!isConnected) {
      clearInterval(logInterval);
      return;
    }
    await fetchAndSendLogs();
  }, 2000);

  // Ping every 20 seconds
  const pingInterval = setInterval(() => {
    if (!isConnected) return;
    res.write("event: ping\ndata: {}\n\n");
  }, 20000);

  req.on("close", () => {
    clearInterval(logInterval);
    clearInterval(pingInterval);
  });
});

export default router;
