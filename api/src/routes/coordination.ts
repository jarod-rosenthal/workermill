/**
 * Worker Coordination API Routes
 *
 * Endpoints for multi-worker coordination:
 * - Check-in/out: Worker presence tracking
 * - Heartbeat: Liveness updates
 * - Resource reservations: Shared resource coordination
 * - Context sharing: Sibling communication (file changes, decisions, blockers)
 * - Commands: Dashboard-to-worker communication
 *
 * SIMPLIFIED: File locking and manifest endpoints removed.
 * Conflict prevention now handled via:
 * - storyDependencies for sequencing tasks
 * - file-overlap detection blocking dependent tasks
 * - separate git branches per task
 */

import { Router, Request, Response } from "express";
import { body, query, param, validationResult } from "express-validator";
import { authenticateApiKey, authenticateSSE, authenticateRequest } from "../middleware/auth.js";
import {
  checkIn,
  checkOut,
  heartbeat,
  getActiveWorkers,
  reserveResource,
  releaseResource,
} from "../services/coordination.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerContext, WorkerCommand, type ContextMessageType } from "../models/index.js";
import { logger } from "../utils/logger.js";

const router = Router();

/**
 * GET /api/coordination/context/:parentTaskId/stream
 *
 * SSE endpoint for real-time context updates.
 * Supports both JWT (frontend dashboard) and API key (workers) authentication.
 * This route is defined BEFORE the global API key auth to allow JWT tokens.
 */
router.get(
  "/context/:parentTaskId/stream",
  authenticateSSE,  // Supports JWT via query param for EventSource
  [param("parentTaskId").isUUID().withMessage("parentTaskId must be a valid UUID")],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: "Validation failed", details: errors.array() });
      return;
    }

    const { parentTaskId } = req.params;
    const orgId = req.organization!.id;

    // Set up SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ parentTaskId })}\n\n`);

    let lastChecked = new Date();
    const contextRepo = AppDataSource.getRepository(WorkerContext);

    // Poll for new context messages every 500ms
    const pollInterval = setInterval(async () => {
      try {
        const newContexts = await contextRepo
          .createQueryBuilder("context")
          .where("context.parent_task_id = :parentTaskId", { parentTaskId })
          .andWhere("context.org_id = :orgId", { orgId })
          .andWhere("context.created_at > :lastChecked", { lastChecked })
          .andWhere("context.archived = :archived", { archived: false }) // Only stream active (non-archived) messages
          .orderBy("context.created_at", "ASC")
          .getMany();

        if (newContexts.length > 0) {
          lastChecked = new Date();

          for (const context of newContexts) {
            const data = JSON.stringify({
              id: context.id,
              taskId: context.taskId,
              persona: context.persona,
              messageType: context.messageType,
              content: context.content,
              metadata: context.metadata,
              createdAt: context.createdAt,
            });
            res.write(`event: context\ndata: ${data}\n\n`);
          }
        }

        // Send heartbeat every 30 seconds to keep connection alive
        if (Date.now() - lastChecked.getTime() > 25000) {
          res.write(`:heartbeat\n\n`);
        }
      } catch (error) {
        logger.error("Error in context stream", {
          error: error instanceof Error ? error.message : String(error),
          parentTaskId,
        });
      }
    }, 500);

    // Clean up on client disconnect
    req.on("close", () => {
      clearInterval(pollInterval);
      logger.info("Context stream disconnected", { parentTaskId });
    });
  }
);

// All other coordination routes use API key authentication (called by workers)
router.use(authenticateApiKey);

/**
 * Validation error handler
 */
function handleValidationErrors(req: Request, res: Response): boolean {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: "Validation failed", details: errors.array() });
    return true;
  }
  return false;
}

/**
 * POST /api/coordination/check-in
 *
 * Called by workers when starting a task.
 * Records worker presence and returns any potential conflicts.
 */
router.post(
  "/check-in",
  [
    body("taskId").isUUID().withMessage("taskId must be a valid UUID"),
    body("workerId").isString().trim().notEmpty().withMessage("workerId is required"),
    body("repo").isString().trim().notEmpty().withMessage("repo is required"),
    body("branch").isString().trim().notEmpty().withMessage("branch is required"),
    body("status").isString().trim().notEmpty().withMessage("status is required"),
    body("currentFile").optional().isString(),
    body("filesModified").optional().isArray(),
    body("metadata").optional().isObject(),
  ],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { taskId, workerId, repo, branch, status, currentFile, filesModified, metadata } =
        req.body;

      const result = await checkIn({
        taskId,
        workerId,
        repo,
        branch,
        status,
        currentFile,
        filesModified,
        metadata,
      });

      res.json(result);
    } catch (error) {
      logger.error("Error in check-in", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to check in" });
    }
  }
);

/**
 * DELETE /api/coordination/check-out
 *
 * Called by workers when finishing a task.
 * Removes check-in record and releases all locks.
 */
router.delete(
  "/check-out",
  [body("taskId").isUUID().withMessage("taskId must be a valid UUID")],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { taskId } = req.body;
      const result = await checkOut(taskId);
      res.json(result);
    } catch (error) {
      logger.error("Error in check-out", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to check out" });
    }
  }
);

/**
 * POST /api/coordination/heartbeat
 *
 * Called periodically by workers to indicate they're still alive.
 * Updates heartbeat timestamp and optionally current status/file.
 */
router.post(
  "/heartbeat",
  [
    body("taskId").isUUID().withMessage("taskId must be a valid UUID"),
    body("status").optional().isString(),
    body("currentFile").optional().isString(),
    body("filesModified").optional().isArray(),
  ],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { taskId, status, currentFile, filesModified } = req.body;
      const result = await heartbeat({ taskId, status, currentFile, filesModified });
      res.json(result);
    } catch (error) {
      // Don't log error for "no check-in found" - this is expected if worker didn't check in
      if (error instanceof Error && error.message.includes("No check-in found")) {
        res.status(404).json({ error: error.message });
        return;
      }
      logger.error("Error in heartbeat", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to update heartbeat" });
    }
  }
);

/**
 * GET /api/coordination/active-workers
 *
 * Returns all active workers for the organization.
 * Optionally filter by repository.
 */
router.get(
  "/active-workers",
  [query("repo").optional().isString()],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const orgId = req.organization!.id;
      const repo = req.query.repo as string | undefined;

      const result = await getActiveWorkers(orgId, repo);
      res.json(result);
    } catch (error) {
      logger.error("Error getting active workers", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to get active workers" });
    }
  }
);

// SIMPLIFIED: File locking endpoints removed - workers use separate branches for conflict avoidance

/**
 * POST /api/coordination/resources/reserve
 *
 * Reserves a shared resource (test DB, deploy slot, etc.).
 */
router.post(
  "/resources/reserve",
  [
    body("taskId").isUUID().withMessage("taskId must be a valid UUID"),
    body("resourceType").isString().trim().notEmpty().withMessage("resourceType is required"),
    body("resourceId").optional().isString(),
    body("ttlSeconds").optional().isInt({ min: 30, max: 7200 }).withMessage("ttlSeconds must be between 30 and 7200"),
  ],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { taskId, resourceType, resourceId, ttlSeconds } = req.body;

      const result = await reserveResource(taskId, resourceType, resourceId, ttlSeconds);

      if (result.success) {
        res.json(result);
      } else {
        res.status(409).json(result);
      }
    } catch (error) {
      logger.error("Error reserving resource", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to reserve resource" });
    }
  }
);

/**
 * POST /api/coordination/resources/release
 *
 * Releases a resource reservation.
 */
router.post(
  "/resources/release",
  [
    body("taskId").isUUID().withMessage("taskId must be a valid UUID"),
    body("resourceType").isString().trim().notEmpty().withMessage("resourceType is required"),
    body("resourceId").isString().trim().notEmpty().withMessage("resourceId is required"),
  ],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { taskId, resourceType, resourceId } = req.body;

      const result = await releaseResource(taskId, resourceType, resourceId);
      res.json(result);
    } catch (error) {
      logger.error("Error releasing resource", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to release resource" });
    }
  }
);

// SIMPLIFIED: Manifest endpoints removed - file conflict detection is now handled via storyDependencies and file-overlap blocking

// =============================================================================
// Worker Context Endpoints (Multi-Agent Communication)
// =============================================================================
// The context system allows sibling workers (from same parent PRD) to share
// information in real-time: file changes, decisions, blockers, completions.

const VALID_MESSAGE_TYPES: ContextMessageType[] = [
  "file_created",
  "file_modified",
  "decision",
  "dependency",
  "question",
  "answer",
  "completion",
  "blocker",
  "warning",
  "progress",
];

/**
 * POST /api/coordination/context
 *
 * Post a context message for siblings to see.
 * Called by workers to share updates about their progress.
 *
 * Request body:
 * - parentTaskId: UUID - The parent PRD task ID (links siblings)
 * - taskId: UUID - This worker's task ID
 * - persona: string - Worker's persona (for display)
 * - messageType: ContextMessageType - Type of message
 * - content: string - The message content
 * - metadata: object (optional) - Additional structured data
 */
router.post(
  "/context",
  [
    body("parentTaskId").isUUID().withMessage("parentTaskId must be a valid UUID"),
    body("taskId").isUUID().withMessage("taskId must be a valid UUID"),
    body("persona").isString().trim().notEmpty().withMessage("persona is required"),
    body("messageType")
      .isString()
      .isIn(VALID_MESSAGE_TYPES)
      .withMessage(`messageType must be one of: ${VALID_MESSAGE_TYPES.join(", ")}`),
    body("content").isString().trim().notEmpty().withMessage("content is required"),
    body("metadata").optional().isObject(),
  ],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { parentTaskId, taskId, persona, messageType, content, metadata } = req.body;
      const orgId = req.organization!.id;

      const contextRepo = AppDataSource.getRepository(WorkerContext);

      const context = contextRepo.create({
        parentTaskId,
        taskId,
        orgId,
        persona,
        messageType,
        content,
        metadata: metadata || null,
      });

      const saved = await contextRepo.save(context);

      logger.info("Worker context posted", {
        parentTaskId,
        taskId,
        persona,
        messageType,
        orgId,
      });

      res.status(201).json({
        success: true,
        context: {
          id: saved.id,
          parentTaskId: saved.parentTaskId,
          taskId: saved.taskId,
          persona: saved.persona,
          messageType: saved.messageType,
          content: saved.content,
          metadata: saved.metadata,
          createdAt: saved.createdAt,
        },
      });
    } catch (error) {
      logger.error("Error posting context", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "Failed to post context" });
    }
  }
);

/**
 * GET /api/coordination/context/:parentTaskId
 *
 * Get all context messages for a parent task (all sibling updates).
 * Workers call this on startup to get existing context.
 *
 * Query parameters:
 * - messageType: string (optional) - Filter by message type
 * - since: ISO timestamp (optional) - Only get messages after this time
 * - limit: number (optional) - Max messages to return (default: 100)
 * - includeArchived: boolean (optional) - Include archived messages (default: false)
 *
 * Archived messages are from completed workflows. They're preserved for history
 * but filtered out by default so active workers don't see stale coordination.
 */
router.get(
  "/context/:parentTaskId",
  [
    param("parentTaskId").isUUID().withMessage("parentTaskId must be a valid UUID"),
    query("messageType").optional().isIn(VALID_MESSAGE_TYPES),
    query("since").optional().isISO8601(),
    query("limit").optional().isInt({ min: 1, max: 500 }),
    query("includeArchived").optional().isBoolean(),
  ],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { parentTaskId } = req.params;
      const messageType = req.query.messageType as ContextMessageType | undefined;
      const since = req.query.since as string | undefined;
      const limit = parseInt(req.query.limit as string) || 100;
      const includeArchived = req.query.includeArchived === "true";
      const orgId = req.organization!.id;

      const contextRepo = AppDataSource.getRepository(WorkerContext);

      let queryBuilder = contextRepo
        .createQueryBuilder("context")
        .where("context.parent_task_id = :parentTaskId", { parentTaskId })
        .andWhere("context.org_id = :orgId", { orgId })
        .orderBy("context.created_at", "ASC")
        .take(limit);

      // Filter out archived messages by default (active workers shouldn't see stale coordination)
      if (!includeArchived) {
        queryBuilder = queryBuilder.andWhere("context.archived = :archived", { archived: false });
      }

      if (messageType) {
        queryBuilder = queryBuilder.andWhere("context.message_type = :messageType", {
          messageType,
        });
      }

      if (since) {
        queryBuilder = queryBuilder.andWhere("context.created_at > :since", {
          since: new Date(since),
        });
      }

      const contexts = await queryBuilder.getMany();

      res.json({
        parentTaskId,
        count: contexts.length,
        contexts: contexts.map((c) => ({
          id: c.id,
          taskId: c.taskId,
          persona: c.persona,
          messageType: c.messageType,
          content: c.content,
          metadata: c.metadata,
          createdAt: c.createdAt,
          archived: c.archived,
          archivedAt: c.archivedAt,
        })),
      });
    } catch (error) {
      logger.error("Error getting context", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "Failed to get context" });
    }
  }
);

/**
 * DELETE /api/coordination/context/:parentTaskId
 *
 * Delete all context for a parent task. Called when parent task completes.
 */
router.delete(
  "/context/:parentTaskId",
  [param("parentTaskId").isUUID().withMessage("parentTaskId must be a valid UUID")],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const parentTaskId = req.params.parentTaskId as string;
      const orgId = req.organization!.id;

      const contextRepo = AppDataSource.getRepository(WorkerContext);

      const result = await contextRepo.delete({
        parentTaskId,
        orgId,
      });

      logger.info("Context cleared", {
        parentTaskId,
        deletedCount: result.affected,
      });

      res.json({
        success: true,
        deleted: result.affected || 0,
      });
    } catch (error) {
      logger.error("Error deleting context", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "Failed to delete context" });
    }
  }
);

// =============================================================================
// Worker Command Endpoints (Dashboard-to-Worker Communication)
// =============================================================================
// Commands allow the dashboard to send messages/questions to running workers.
// Workers poll for pending commands and acknowledge receipt.

const VALID_COMMAND_TYPES = ["message", "question", "pause", "resume"] as const;

/**
 * POST /api/coordination/commands
 *
 * Dashboard sends a command to a running worker.
 * Commands are queued until the worker polls for them.
 *
 * Request body:
 * - taskId: UUID - Target task ID
 * - type: 'message' | 'question' | 'pause' | 'resume' - Command type
 * - content: string - Command content/message
 *
 * Response:
 * - success: boolean
 * - command: WorkerCommand - The created command
 */
router.post(
  "/commands",
  [
    body("taskId").isUUID().withMessage("taskId must be a valid UUID"),
    body("type")
      .isString()
      .isIn(VALID_COMMAND_TYPES)
      .withMessage(`type must be one of: ${VALID_COMMAND_TYPES.join(", ")}`),
    body("content").isString().trim().notEmpty().withMessage("content is required"),
  ],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { taskId, type, content } = req.body;
      const orgId = req.organization!.id;

      const commandRepo = AppDataSource.getRepository(WorkerCommand);

      const commandData = WorkerCommand.create(taskId, orgId, type, content);
      const command = commandRepo.create(commandData);
      const saved = await commandRepo.save(command);

      logger.info("Worker command created", {
        commandId: saved.id,
        taskId,
        type,
        orgId,
      });

      res.status(201).json({
        success: true,
        command: {
          id: saved.id,
          taskId: saved.taskId,
          type: saved.type,
          content: saved.content,
          status: saved.status,
          createdAt: saved.createdAt,
        },
      });
    } catch (error) {
      logger.error("Error creating command", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "Failed to create command" });
    }
  }
);

/**
 * GET /api/coordination/commands/:taskId/pending
 *
 * Worker polls for pending commands. Returns all commands with status='pending'.
 *
 * URL parameters:
 * - taskId: UUID - Task ID to get commands for
 *
 * Response:
 * - commands: WorkerCommand[] - Array of pending commands
 */
router.get(
  "/commands/:taskId/pending",
  [param("taskId").isUUID().withMessage("taskId must be a valid UUID")],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const taskId = req.params.taskId as string;
      const orgId = req.organization!.id;

      const commandRepo = AppDataSource.getRepository(WorkerCommand);

      const commands = await commandRepo.find({
        where: {
          taskId,
          orgId,
          status: "pending",
        },
        order: {
          createdAt: "ASC",
        },
      });

      res.json({
        commands: commands.map((cmd) => ({
          id: cmd.id,
          taskId: cmd.taskId,
          type: cmd.type,
          content: cmd.content,
          status: cmd.status,
          createdAt: cmd.createdAt,
        })),
      });
    } catch (error) {
      logger.error("Error getting pending commands", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "Failed to get pending commands" });
    }
  }
);

/**
 * POST /api/coordination/commands/:commandId/acknowledge
 *
 * Worker acknowledges receipt of a command.
 * For 'question' type commands, a response can be included.
 *
 * URL parameters:
 * - commandId: UUID - Command ID to acknowledge
 *
 * Request body (optional):
 * - response: string - Response to the command (for 'question' type)
 *
 * Response:
 * - success: boolean
 * - command: WorkerCommand - The updated command
 */
router.post(
  "/commands/:commandId/acknowledge",
  [
    param("commandId").isUUID().withMessage("commandId must be a valid UUID"),
    body("response").optional().isString(),
  ],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const commandId = req.params.commandId as string;
      const { response } = req.body;
      const orgId = req.organization!.id;

      const commandRepo = AppDataSource.getRepository(WorkerCommand);

      const command = await commandRepo.findOne({
        where: {
          id: commandId,
          orgId,
        },
      });

      if (!command) {
        res.status(404).json({ error: "Command not found" });
        return;
      }

      if (!command.isPending()) {
        res.status(400).json({ error: "Command has already been acknowledged" });
        return;
      }

      // Update command status
      command.acknowledgedAt = new Date();

      if (response && command.type === "question") {
        // If response provided for a question, mark as responded
        command.status = "responded";
        command.response = response;
        command.respondedAt = new Date();
      } else if (command.type === "question") {
        // Question without response, just acknowledged
        command.status = "acknowledged";
      } else {
        // Non-question commands are completed on acknowledgment
        command.status = "completed";
      }

      const saved = await commandRepo.save(command);

      logger.info("Worker command acknowledged", {
        commandId: saved.id,
        taskId: saved.taskId,
        type: saved.type,
        status: saved.status,
        hasResponse: !!response,
      });

      res.json({
        success: true,
        command: {
          id: saved.id,
          taskId: saved.taskId,
          type: saved.type,
          content: saved.content,
          status: saved.status,
          response: saved.response,
          acknowledgedAt: saved.acknowledgedAt,
          respondedAt: saved.respondedAt,
          createdAt: saved.createdAt,
        },
      });
    } catch (error) {
      logger.error("Error acknowledging command", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "Failed to acknowledge command" });
    }
  }
);

export default router;
