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
import { authenticateApiKey, authenticateSSE, authenticateRequest, authenticateUser } from "../middleware/auth.js";
import { acquireSSESlot, releaseSSESlot } from "../middleware/sse-limiter.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { validateRequest } from "../middleware/validation.js";
import {
  checkIn,
  checkOut,
  heartbeat,
  getActiveWorkers,
  reserveResource,
  releaseResource,
} from "../services/coordination.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerContext, WorkerCommand, WorkerTask, User, type ContextMessageType } from "../models/index.js";
import { logger } from "../utils/logger.js";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from "../utils/errors.js";
import { notifyBlockerDetected, type BlockerDetails } from "../services/notifications.js";
import { sendPushNotification } from "../services/push-notifications.js";
import { redis } from "../services/redis-client.js";

const router = Router();

const VALID_MESSAGE_TYPES: ContextMessageType[] = [
  "constraints",   // PRD-level constraints - posted by orchestrator BEFORE workers spawn
  "file_created",
  "file_modified",
  "decision",
  "dependency",
  "question",
  "answer",
  "completion",
  "blocker",
  "blocker_detected",  // Escalated blocker requiring human intervention
  "blocker_resolved",  // User resolved a blocker (retry/skip/abort)
  "rate_limited",      // Anthropic usage cap reached — stop retrying
  "warning",
  "progress",
  "story_ready",   // Story's dependencies met, available for claim in Epic mode
  "story_claimed", // Expert claimed a story in Epic mode
  "consultation",  // Targeted expert consultation (CONSULT-PERSONA: question?)
  "revision_requested", // Tech Lead requested revision with feedback
  "user_message",  // User message from dashboard (Talk to Worker)
  "worker_ack",    // Worker acknowledgment of user message
  "expert_response", // Expert mid-execution message to user (via .workermill-response.md)
];

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

    const parentTaskId = req.params.parentTaskId as string;
    const orgId = req.organization!.id;

    // VALIDATE org owns this parent task before setting up stream
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const parentTask = await taskRepo.findOne({
      where: { id: parentTaskId, orgId },
    });

    if (!parentTask) {
      res.status(404).json({ error: "Parent task not found" });
      return;
    }

    if (!acquireSSESlot(orgId, 20)) {
      res.status(429).json({ error: "Too many coordination connections" });
      return;
    }

    // Set up SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ parentTaskId })}\n\n`);

    if (redis.isConnected) {
      // REAL-TIME MODE: Subscribe to Redis channel, push instantly
      let isConnected = true;
      const unsubscribe = redis.subscribe(parentTaskId, (msg) => {
        if (!isConnected) return;
        try {
          const data = JSON.stringify(msg);
          res.write(`event: context\ndata: ${data}\n\n`);
        } catch { isConnected = false; }
      });

      // Heartbeat keeps the connection alive through proxies (CloudFront, ALB)
      const heartbeat = setInterval(() => {
        if (!isConnected) return;
        try {
          res.write(`:heartbeat\n\n`);
        } catch { isConnected = false; }
      }, 25000);

      req.on("close", () => {
        isConnected = false;
        unsubscribe();
        clearInterval(heartbeat);
        releaseSSESlot(orgId);
        logger.info("Context stream disconnected (redis)", { parentTaskId });
      });
    } else {
      // FALLBACK MODE: Poll DB every 5s (existing behavior when Redis is unavailable)
      let lastChecked = new Date();
      let isConnected = true;
      const contextRepo = AppDataSource.getRepository(WorkerContext);

      const pollInterval = setInterval(async () => {
        if (!isConnected) return;
        try {
          const newContexts = await contextRepo
            .createQueryBuilder("context")
            .where("context.parent_task_id = :parentTaskId", { parentTaskId })
            .andWhere("context.org_id = :orgId", { orgId })
            .andWhere("context.created_at > :lastChecked", { lastChecked })
            .andWhere("context.archived = :archived", { archived: false })
            .orderBy("context.created_at", "ASC")
            .getMany();

          if (newContexts.length > 0) {
            lastChecked = new Date();

            for (const context of newContexts) {
              const data = JSON.stringify({
                id: context.id,
                taskId: context.taskId,
                parentTaskId: context.parentTaskId,
                persona: context.persona,
                messageType: context.messageType,
                content: context.content,
                metadata: context.metadata,
                sessionId: context.sessionId,
                createdAt: context.createdAt,
              });
              try {
                res.write(`event: context\ndata: ${data}\n\n`);
              } catch { isConnected = false; return; }
            }
          }

          if (Date.now() - lastChecked.getTime() > 25000) {
            try {
              res.write(`:heartbeat\n\n`);
            } catch { isConnected = false; }
          }
        } catch (error) {
          logger.error("Error in context stream", {
            error: error instanceof Error ? error.message : String(error),
            parentTaskId,
          });
        }
      }, 5000);

      req.on("close", () => {
        isConnected = false;
        clearInterval(pollInterval);
        releaseSSESlot(orgId);
        logger.info("Context stream disconnected (polling)", { parentTaskId });
      });
    }
  }
);

/**
 * POST /api/coordination/answer
 *
 * Submit an answer to a worker's question from the dashboard.
 * Creates an 'answer' context message with metadata linking to the original question.
 *
 * This enables Gap 1 from docs/TEAM_COLLABORATION_GAPS.md - dashboard can answer worker questions.
 *
 * Request body:
 * - messageId: UUID - The ID of the question context message to answer
 * - answer: string - The answer text
 * - persona: string (optional) - Persona of the answerer (defaults to 'dashboard')
 *
 * Response:
 * - success: boolean
 * - context: WorkerContext - The created answer message
 */
router.post(
  "/answer",
  authenticateRequest, // Allow JWT (dashboard) or API key (workers) authentication
  [
    body("messageId").isUUID().withMessage("messageId must be a valid UUID"),
    body("answer").isString().trim().notEmpty().withMessage("answer is required"),
    body("persona").optional().isString().trim(),
    body("taskId").optional().isUUID().withMessage("taskId must be a valid UUID if provided"),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { messageId, answer, persona, taskId } = req.body;
    const orgId = req.organization!.id;

    const contextRepo = AppDataSource.getRepository(WorkerContext);

    // Look up the original question/consultation by messageId
    const question = await contextRepo.findOne({
      where: {
        id: messageId,
        orgId,
      },
    });

    if (!question) {
      throw new NotFoundError("Question not found");
    }

    // Allow answering both questions and consultations (Phase 6: worker-to-worker answers)
    if (question.messageType !== "question" && question.messageType !== "consultation") {
      throw new BadRequestError("Referenced message is not a question or consultation");
    }

    // Create the answer context message
    // - Same parentTaskId as the question (links to the same workflow)
    // - taskId can be provided by workers answering sibling questions
    // - persona defaults to 'dashboard' for human answers
    const answerContext = contextRepo.create({
      parentTaskId: question.parentTaskId,
      taskId: taskId || null, // Workers can provide their taskId
      orgId,
      persona: persona || "dashboard",
      messageType: "answer" as ContextMessageType,
      content: answer,
      metadata: {
        questionId: messageId,
        questionContent: question.content,
        questionPersona: question.persona,
        questionType: question.messageType, // Track if answering question vs consultation
        targetPersona: question.metadata?.targetPersona, // For consultations
      },
    });

    const saved = await contextRepo.save(answerContext);

    // Publish to Redis for real-time SSE push
    redis.publishContext(question.parentTaskId, {
      id: saved.id,
      taskId: saved.taskId,
      parentTaskId: saved.parentTaskId,
      persona: saved.persona,
      messageType: saved.messageType,
      content: saved.content,
      metadata: saved.metadata,
      createdAt: saved.createdAt,
    });

    logger.info("Answer submitted to worker question/consultation", {
      answerId: saved.id,
      questionId: messageId,
      questionType: question.messageType,
      parentTaskId: question.parentTaskId,
      persona: saved.persona,
      answeringTaskId: taskId,
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
  })
);

const VALID_COMMAND_TYPES = ["message", "question", "pause", "resume", "toggle_self_review"] as const;

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
  authenticateRequest, // Allow both JWT (dashboard) and API key (workers) authentication
  [
    body("taskId").isUUID().withMessage("taskId must be a valid UUID"),
    body("type")
      .isString()
      .isIn(VALID_COMMAND_TYPES)
      .withMessage(`type must be one of: ${VALID_COMMAND_TYPES.join(", ")}`),
    body("content").isString().trim().notEmpty().withMessage("content is required"),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { taskId, type, content } = req.body;
    const orgId = req.organization!.id;

    // VALIDATE org owns this task before creating command
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId },
    });

    if (!task) {
      throw new NotFoundError("Task not found");
    }

    const commandRepo = AppDataSource.getRepository(WorkerCommand);
    const contextRepo = AppDataSource.getRepository(WorkerContext);

    const commandData = WorkerCommand.create(taskId, orgId, type, content);
    const command = commandRepo.create(commandData);
    const saved = await commandRepo.save(command);

    // Also echo "message" commands to the coordination feed for visibility
    // This makes user messages appear in the terminal and comms panel
    if (type === "message" || type === "resume") {
      const contextMessage = contextRepo.create({
        parentTaskId: task.parentTaskId || taskId, // Use parent if this is a child task
        taskId,
        orgId,
        persona: "dashboard",
        messageType: "user_message" as ContextMessageType,
        content: `📨 User message: ${content}`,
        metadata: {
          commandId: saved.id,
          commandType: type,
          source: "dashboard",
        },
      });
      const savedCtx = await contextRepo.save(contextMessage);

      // Publish to Redis for real-time SSE push
      const ctxParentTaskId = task.parentTaskId || taskId;
      redis.publishContext(ctxParentTaskId, {
        id: savedCtx.id,
        taskId: savedCtx.taskId,
        parentTaskId: savedCtx.parentTaskId,
        persona: savedCtx.persona,
        messageType: savedCtx.messageType,
        content: savedCtx.content,
        metadata: savedCtx.metadata,
        createdAt: savedCtx.createdAt,
      });
    }

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
  })
);

// =============================================================================
// Blocker Response Handling (User-facing, requires JWT auth)
// MUST be defined BEFORE router.use(authenticateApiKey)
// =============================================================================

/**
 * POST /api/coordination/blocker-response
 *
 * Handle user response to a detected blocker.
 * Posts a blocker_resolved message to the coordination feed.
 *
 * Request body:
 * - parentTaskId: UUID - The parent task ID
 * - blockerId: string - The blocker message ID
 * - action: "retry" | "skip" | "abort"
 * - guidance: string (optional) - Additional guidance for retry
 */
router.post(
  "/blocker-response",
  authenticateRequest,
  [
    body("parentTaskId").isUUID().withMessage("parentTaskId must be a valid UUID"),
    body("blockerId").isString().notEmpty().withMessage("blockerId is required"),
    body("action").isIn(["retry", "skip", "abort"]).withMessage("action must be retry, skip, or abort"),
    body("guidance").optional().isString(),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { parentTaskId, blockerId, action, guidance } = req.body;
    const orgId = req.organization!.id;
    const userId = req.user!.id;

    const contextRepo = AppDataSource.getRepository(WorkerContext);

    // Verify the blocker exists and belongs to this org
    // Accept both "blocker_detected" (from API) and "blocker" (from worker) message types
    let blocker = await contextRepo.findOne({
      where: {
        id: blockerId,
        parentTaskId,
        orgId,
        messageType: "blocker_detected",
      },
    });

    // Also check for "blocker" type with isEscalated metadata (from worker)
    if (!blocker) {
      blocker = await contextRepo.findOne({
        where: {
          id: blockerId,
          parentTaskId,
          orgId,
          messageType: "blocker",
        },
      });
    }

    if (!blocker) {
      throw new NotFoundError("Blocker not found");
    }

    // Post blocker_resolved message
    const resolvedMessage = contextRepo.create({
      parentTaskId,
      taskId: blocker.taskId,
      orgId,
      persona: "dashboard",
      messageType: "blocker_resolved",
      content: `Blocker resolved by user: ${action}${guidance ? ` - ${guidance}` : ""}`,
      metadata: {
        blockerId,
        action,
        guidance: guidance || null,
        respondedBy: userId,
        respondedAt: new Date().toISOString(),
        originalStoryIndex: blocker.metadata?.storyIndex,
      },
    });

    const savedResolved = await contextRepo.save(resolvedMessage);

    // Publish to Redis for real-time SSE push
    redis.publishContext(parentTaskId, {
      id: savedResolved.id,
      taskId: savedResolved.taskId,
      parentTaskId: savedResolved.parentTaskId,
      persona: savedResolved.persona,
      messageType: savedResolved.messageType,
      content: savedResolved.content,
      metadata: savedResolved.metadata,
      createdAt: savedResolved.createdAt,
    });

    logger.info("Blocker response recorded", {
      orgId,
      parentTaskId,
      blockerId,
      action,
      userId,
    });

    res.json({
      success: true,
      action,
      messageId: resolvedMessage.id,
    });
  })
);

// ─── GET /context/:parentTaskId ──────────────────────────────────────────────
// Defined BEFORE router.use(authenticateApiKey) so JWT auth works from the dashboard.
// Workers also call this with x-api-key to get existing context on startup.
/**
 * GET /api/coordination/context/:parentTaskId
 *
 * Get all context messages for a parent task (all sibling updates).
 * Workers call this on startup to get existing context.
 *
 * Query parameters:
 * - messageType: string (optional) - Filter by message type
 * - since: ISO timestamp (optional) - Only get messages after this time
 * - limit: number (optional) - Max messages to return (default: 1000)
 * - includeArchived: boolean (optional) - Include archived messages (default: false)
 *
 * Archived messages are from completed workflows. They're preserved for history
 * but filtered out by default so active workers don't see stale coordination.
 */
router.get(
  "/context/:parentTaskId",
  authenticateRequest, // Allow both JWT (frontend) and API key (workers) authentication
  [
    param("parentTaskId").isUUID().withMessage("parentTaskId must be a valid UUID"),
    query("messageType").optional().isIn(VALID_MESSAGE_TYPES),
    query("messageTypes").optional().isString(),
    query("since").optional().isISO8601(),
    query("limit").optional().isInt({ min: 1, max: 1000 }),
    query("offset").optional().isInt({ min: 0 }),
    query("includeArchived").optional().isBoolean(),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const parentTaskId = req.params.parentTaskId as string;
    const messageType = req.query.messageType as ContextMessageType | undefined;
    const messageTypes = req.query.messageTypes
      ? (req.query.messageTypes as string)
          .split(",")
          .filter((t) => VALID_MESSAGE_TYPES.includes(t as ContextMessageType))
      : undefined;
    const since = req.query.since as string | undefined;
    const limit = parseInt(req.query.limit as string) || 200;
    const offset = parseInt(req.query.offset as string) || 0;
    const includeArchived = req.query.includeArchived === "true";
    const orgId = req.organization!.id;

    // VALIDATE org owns this parent task before returning context
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const parentTask = await taskRepo.findOne({
      where: { id: parentTaskId, orgId },
    });

    if (!parentTask) {
      throw new NotFoundError("Parent task not found");
    }

    const contextRepo = AppDataSource.getRepository(WorkerContext);

    let queryBuilder = contextRepo
      .createQueryBuilder("context")
      .where("context.parent_task_id = :parentTaskId", { parentTaskId })
      .andWhere("context.org_id = :orgId", { orgId })
      .orderBy("context.created_at", "ASC")
      .skip(offset)
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

    if (!messageType && messageTypes && messageTypes.length > 0) {
      queryBuilder = queryBuilder.andWhere(
        "context.message_type IN (:...messageTypes)",
        { messageTypes }
      );
    }

    if (since) {
      queryBuilder = queryBuilder.andWhere("context.created_at > :since", {
        since: new Date(since),
      });
    }

    const [contexts, total] = await queryBuilder.getManyAndCount();

    res.json({
      parentTaskId,
      count: contexts.length,
      total,
      offset,
      limit,
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
  })
);

/**
 * GET /api/coordination/blockers/:parentTaskId
 *
 * Lightweight endpoint for blocker checks — returns only blocker-related messages.
 * Hits the (parent_task_id, message_type) composite index, returning typically 0-5 rows
 * instead of the full context feed (which can be 1000+ rows for large epics).
 */
router.get(
  "/blockers/:parentTaskId",
  authenticateRequest,
  [
    param("parentTaskId").isUUID().withMessage("parentTaskId must be a valid UUID"),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const parentTaskId = req.params.parentTaskId as string;
    const orgId = req.organization!.id;

    // Validate org owns this parent task
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const parentTask = await taskRepo.findOne({
      where: { id: parentTaskId, orgId },
    });

    if (!parentTask) {
      throw new NotFoundError("Parent task not found");
    }

    const contextRepo = AppDataSource.getRepository(WorkerContext);
    const contexts = await contextRepo
      .createQueryBuilder("context")
      .where("context.parent_task_id = :parentTaskId", { parentTaskId })
      .andWhere("context.org_id = :orgId", { orgId })
      .andWhere("context.archived = :archived", { archived: false })
      .andWhere("context.message_type IN (:...types)", {
        types: ["blocker", "blocker_detected", "blocker_resolved", "answer"],
      })
      .orderBy("context.created_at", "ASC")
      .getMany();

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
  })
);

// All other coordination routes use API key authentication (called by workers)
router.use(authenticateApiKey);

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
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
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
  })
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
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { taskId } = req.body;
    const result = await checkOut(taskId);
    res.json(result);
  })
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
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { taskId, status, currentFile, filesModified } = req.body;
    try {
      const result = await heartbeat({ taskId, status, currentFile, filesModified });
      res.json(result);
    } catch (error) {
      // Convert "no check-in found" to NotFoundError for proper 404 response
      if (error instanceof Error && error.message.includes("No check-in found")) {
        throw new NotFoundError(error.message);
      }
      throw error;
    }
  })
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
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.organization!.id;
    const repo = req.query.repo as string | undefined;

    const result = await getActiveWorkers(orgId, repo);
    res.json(result);
  })
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
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { taskId, resourceType, resourceId, ttlSeconds } = req.body;

    const result = await reserveResource(taskId, resourceType, resourceId, ttlSeconds);

    if (result.success) {
      res.json(result);
    } else {
      // Resource already reserved - return 409 Conflict
      res.status(409).json(result);
    }
  })
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
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { taskId, resourceType, resourceId } = req.body;

    const result = await releaseResource(taskId, resourceType, resourceId);
    res.json(result);
  })
);

// SIMPLIFIED: Manifest endpoints removed - file conflict detection is now handled via storyDependencies and file-overlap blocking

// =============================================================================
// Worker Context Endpoints (Multi-Agent Communication)
// =============================================================================
// The context system allows sibling workers (from same parent PRD) to share
// information in real-time: file changes, decisions, blockers, completions.

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
 * - sessionId: string (optional) - Session ID for threading (e.g., "backend_developer-story-1")
 */
router.post(
  "/context",
  [
    body("parentTaskId").isUUID().withMessage("parentTaskId must be a valid UUID"),
    body("taskId").optional({ values: "null" }).isUUID().withMessage("taskId must be a valid UUID if provided"),
    body("persona").isString().trim().notEmpty().withMessage("persona is required"),
    body("messageType")
      .isString()
      .isIn(VALID_MESSAGE_TYPES)
      .withMessage(`messageType must be one of: ${VALID_MESSAGE_TYPES.join(", ")}`),
    body("content").isString().trim().notEmpty().isLength({ max: 100000 }).withMessage("content is required and must be under 100KB"),
    body("metadata").optional().isObject().custom((value) => {
      if (JSON.stringify(value).length > 10000) throw new Error("Metadata too large (max 10KB)");
      return true;
    }),
    body("sessionId").optional().isString().trim(),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { parentTaskId, taskId, persona, messageType, content, metadata, sessionId } = req.body;
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
      sessionId: sessionId || null,
    });

    const saved = await contextRepo.save(context);

    // Publish to Redis for real-time SSE push
    redis.publishContext(parentTaskId, {
      id: saved.id,
      taskId: saved.taskId,
      parentTaskId: saved.parentTaskId,
      persona: saved.persona,
      messageType: saved.messageType,
      content: saved.content,
      metadata: saved.metadata,
      sessionId: saved.sessionId,
      createdAt: saved.createdAt,
    });

    logger.info("Worker context posted", {
      parentTaskId,
      taskId,
      persona,
      messageType,
      sessionId,
      orgId,
    });

    // Trigger notification for blocker_detected messages
    if (messageType === "blocker_detected" && metadata) {
      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const parentTask = await taskRepo.findOne({ where: { id: parentTaskId } });

      if (parentTask) {
        const blockerMetadata = metadata as {
          storyIndex?: number;
          storyTitle?: string;
          errorCategory?: string;
          errorMessage?: string;
          affectedFiles?: string[];
          dependentStories?: number[];
          autoRetryAttempts?: number;
          maxAutoRetries?: number;
        };

        const blockerDetails: BlockerDetails = {
          storyIndex: blockerMetadata.storyIndex ?? 0,
          storyTitle: blockerMetadata.storyTitle ?? "Unknown Story",
          errorCategory: blockerMetadata.errorCategory ?? "unknown",
          errorMessage: blockerMetadata.errorMessage ?? content,
          affectedFiles: blockerMetadata.affectedFiles ?? [],
          dependentStories: blockerMetadata.dependentStories ?? [],
          autoRetryAttempts: blockerMetadata.autoRetryAttempts ?? 0,
          maxAutoRetries: blockerMetadata.maxAutoRetries ?? 3,
        };

        // Send notifications asynchronously (don't block response)
        notifyBlockerDetected(parentTask, blockerDetails).catch((error) => {
          logger.error("Failed to send blocker notification", {
            parentTaskId,
            error: error instanceof Error ? error.message : String(error),
          });
        });

        // Send push notifications to all org members
        const userRepo = AppDataSource.getRepository(User);
        userRepo.find({ where: { orgId: parentTask.orgId } }).then((orgMembers) => {
          for (const member of orgMembers) {
            // Fire-and-forget push notification
            sendPushNotification(member.id, parentTask.orgId, {
              title: "Blocker detected",
              body: `Blocker on ${parentTask.jiraIssueKey || parentTask.summary || "task"} - ${blockerDetails.storyTitle}`,
              category: "blockers",
              data: {
                taskId: parentTask.id,
                type: "blocker_detected",
                issueKey: parentTask.jiraIssueKey || "",
                storyIndex: String(blockerDetails.storyIndex),
                errorCategory: blockerDetails.errorCategory,
              },
            }).catch((error) => {
              // Already logged in sendPushNotification, no need to log again
            });
          }
        }).catch((error) => {
          logger.error("Failed to fetch org members for push notification", {
            parentTaskId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }

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
        sessionId: saved.sessionId,
        createdAt: saved.createdAt,
      },
    });
  })
);

// =============================================================================
// Epic Story Claiming (Multi-Expert Coordination)
// =============================================================================
// When experts in Epic mode see available stories, they claim them atomically.
// This prevents race conditions where multiple experts try to work on the same story.

/**
 * POST /api/coordination/claim
 *
 * Atomically claim a story for an expert in Epic mode.
 *
 * IMPORTANT: storyId is actually the WorkerContext ID (story_ready message ID),
 * NOT a WorkerTask ID. This endpoint handles the mapping.
 *
 * Request body:
 * - storyId: UUID - The story_ready context message ID to claim
 * - claimedBy: string - The expert/persona claiming the story
 * - parentTaskId: UUID - The parent PRD task ID
 *
 * Response:
 * - 200: Story successfully claimed
 * - 409: Story already claimed
 * - 404: Story not found
 */
router.post(
  "/claim",
  authenticateRequest, // Allow both JWT (dashboard) and API key (workers) authentication
  [
    body("storyId").isUUID().withMessage("storyId must be a valid UUID"),
    body("claimedBy").isString().trim().notEmpty().withMessage("claimedBy is required"),
    body("parentTaskId").isUUID().withMessage("parentTaskId must be a valid UUID"),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { storyId, claimedBy, parentTaskId } = req.body;
    const orgId = req.organization!.id;

    // SECURITY FIX: Use a transaction to prevent race conditions in story claiming.
    // Without this, two concurrent requests could both pass the "already claimed" check
    // and both create claim records, causing double-execution of the same story.
    const result = await AppDataSource.transaction(async (transactionalEntityManager) => {
      const contextRepo = transactionalEntityManager.getRepository(WorkerContext);

      // storyId is actually the WorkerContext ID (story_ready message)
      // Look up the story_ready context message
      const storyReadyContext = await contextRepo.findOne({
        where: {
          id: storyId,
          orgId,
          messageType: "story_ready",
        },
      });

      if (!storyReadyContext) {
        throw new NotFoundError("Story not found (no story_ready context with that ID)");
      }

      // Verify it belongs to the specified parent
      if (storyReadyContext.parentTaskId !== parentTaskId) {
        throw new BadRequestError("Story does not belong to specified parent task");
      }

      const storyIndex = storyReadyContext.metadata?.storyIndex as number;

      // ATOMIC CHECK: Find all existing claims for this parent in the same transaction
      // This prevents TOCTOU race conditions between checking and inserting
      // NOTE: Exclude archived claims - these are from previous retry attempts
      const allClaims = await contextRepo.find({
        where: {
          parentTaskId,
          orgId,
          messageType: "story_claimed",
          archived: false,
        },
      });

      // Check if this specific story was already claimed
      const alreadyClaimed = allClaims.find(
        (c) => (c.metadata?.storyIndex as number) === storyIndex
      );

      if (alreadyClaimed) {
        throw new ConflictError(
          `Story ${storyIndex} was already claimed by ${alreadyClaimed.metadata?.claimedBy}`
        );
      }

      // Story is available - create a story_claimed context message
      const storyTitle = storyReadyContext.metadata?.title as string || storyReadyContext.content;

      const claimedContextData = WorkerContext.create(
        parentTaskId,
        parentTaskId, // Use parentTaskId as taskId for context-based claiming
        orgId,
        claimedBy,
        "story_claimed",
        `${claimedBy} claimed ${storyTitle}`,
        {
          storyIndex,
          storyTitle,
          storyReadyContextId: storyId,
          claimedBy,
          claimedAt: new Date().toISOString(),
          persona: storyReadyContext.metadata?.persona,
          description: storyReadyContext.metadata?.description,
          targetFiles: storyReadyContext.metadata?.targetFiles,
        }
      );

      const claimedContext = contextRepo.create(claimedContextData);
      const savedContext = await contextRepo.save(claimedContext);

      return {
        storyIndex,
        storyTitle,
        storyReadyContext,
        savedContext,
      };
    });

    // Publish to Redis AFTER transaction commits
    redis.publishContext(parentTaskId, {
      id: result.savedContext.id,
      taskId: result.savedContext.taskId,
      parentTaskId: result.savedContext.parentTaskId,
      persona: result.savedContext.persona,
      messageType: result.savedContext.messageType,
      content: result.savedContext.content,
      metadata: result.savedContext.metadata,
      createdAt: result.savedContext.createdAt,
    });

    logger.info("Story claimed in Epic mode", {
      storyReadyContextId: storyId,
      storyIndex: result.storyIndex,
      claimedBy,
      parentTaskId,
      orgId,
    });

    res.json({
      success: true,
      story: {
        id: storyId, // Return the context ID they sent
        storyIndex: result.storyIndex,
        storyTitle: result.storyTitle,
        persona: result.storyReadyContext.metadata?.persona,
        description: result.storyReadyContext.metadata?.description,
        targetFiles: result.storyReadyContext.metadata?.targetFiles,
      },
      context: {
        id: result.savedContext.id,
        parentTaskId: result.savedContext.parentTaskId,
        taskId: result.savedContext.taskId,
        persona: result.savedContext.persona,
        messageType: result.savedContext.messageType,
        content: result.savedContext.content,
        metadata: result.savedContext.metadata,
        createdAt: result.savedContext.createdAt,
      },
    });
  })
);

/**
 * DELETE /api/coordination/context/:parentTaskId
 *
 * Delete all context for a parent task. Called when parent task completes.
 */
router.delete(
  "/context/:parentTaskId",
  [param("parentTaskId").isUUID().withMessage("parentTaskId must be a valid UUID")],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const parentTaskId = req.params.parentTaskId as string;
    const orgId = req.organization!.id;

    // VALIDATE org owns this parent task before deleting context
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const parentTask = await taskRepo.findOne({
      where: { id: parentTaskId, orgId },
    });

    if (!parentTask) {
      throw new NotFoundError("Parent task not found");
    }

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
  })
);

/**
 * DELETE /api/coordination/context/:parentTaskId/persona/:persona
 *
 * Rollback context for a specific persona. Used when a subtask fails and needs
 * to retry without stale context from the failed attempt.
 *
 * This is critical for multi-persona single container execution:
 * - When subtask N fails, we rollback persona N's context
 * - The retry attempt starts fresh without conflicting decisions/file changes
 */
router.delete(
  "/context/:parentTaskId/persona/:persona",
  [
    param("parentTaskId").isUUID().withMessage("parentTaskId must be a valid UUID"),
    param("persona").isString().trim().notEmpty().withMessage("persona is required"),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const parentTaskId = req.params.parentTaskId as string;
    const persona = req.params.persona as string;
    const orgId = req.organization!.id;

    // VALIDATE org owns this parent task before rolling back context
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const parentTask = await taskRepo.findOne({
      where: { id: parentTaskId, orgId },
    });

    if (!parentTask) {
      throw new NotFoundError("Parent task not found");
    }

    const contextRepo = AppDataSource.getRepository(WorkerContext);

    // Delete all context messages from this persona for this parent task
    const result = await contextRepo
      .createQueryBuilder()
      .delete()
      .from(WorkerContext)
      .where("parent_task_id = :parentTaskId", { parentTaskId })
      .andWhere("org_id = :orgId", { orgId })
      .andWhere("persona = :persona", { persona })
      .execute();

    logger.info("Context rolled back for persona", {
      parentTaskId,
      persona,
      deletedCount: result.affected,
    });

    res.json({
      success: true,
      parentTaskId,
      persona,
      deleted: result.affected || 0,
    });
  })
);

// =============================================================================
// Worker Command Endpoints (Dashboard-to-Worker Communication)
// =============================================================================
// Commands allow the dashboard to send messages/questions to running workers.
// Workers poll for pending commands and acknowledge receipt.

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
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;
    const orgId = req.organization!.id;

    // VALIDATE org owns this task before returning commands
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId },
    });

    if (!task) {
      throw new NotFoundError("Task not found");
    }

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
  })
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
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
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
      throw new NotFoundError("Command not found");
    }

    if (!command.isPending()) {
      throw new BadRequestError("Command has already been acknowledged");
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
  })
);

// Archive Context Messages
// =============================================================================

/**
 * POST /api/coordination/archive-claims
 *
 * Archive story_claimed and completion messages for specific story indices.
 * Used for selective revision: when only certain stories need to be re-executed,
 * we archive their claims/completions so the coordinator can re-claim them.
 *
 * Request body:
 * - parentTaskId: UUID - The parent task ID
 * - storyIndices: number[] - Array of story indices to archive claims for
 *
 * This enables selective revision where only affected stories are re-executed.
 */
router.post(
  "/archive-claims",
  authenticateApiKey,
  [
    body("parentTaskId").isUUID().withMessage("parentTaskId must be a valid UUID"),
    body("storyIndices").isArray({ min: 1 }).withMessage("storyIndices must be a non-empty array"),
    body("storyIndices.*").isInt({ min: 0 }).withMessage("storyIndices must contain non-negative integers"),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { parentTaskId, storyIndices } = req.body;
    const orgId = req.organization!.id;

    // VALIDATE org owns this parent task before archiving
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const parentTask = await taskRepo.findOne({
      where: { id: parentTaskId, orgId },
    });

    if (!parentTask) {
      throw new NotFoundError("Parent task not found");
    }

    const contextRepo = AppDataSource.getRepository(WorkerContext);
    const now = new Date();

    // Archive story_claimed and completion messages for specified story indices
    // We use a raw query to efficiently check metadata->>'storyIndex' IN (...)
    // TypeORM's QueryBuilder doesn't handle JSONB array membership elegantly
    const storyIndicesStr = storyIndices.join(",");

    const result = await contextRepo
      .createQueryBuilder()
      .update(WorkerContext)
      .set({ archived: true, archivedAt: now })
      .where("parent_task_id = :parentTaskId", { parentTaskId })
      .andWhere("org_id = :orgId", { orgId })
      .andWhere("archived = false")
      .andWhere("message_type IN (:...messageTypes)", {
        messageTypes: ["story_claimed", "completion"],
      })
      .andWhere(`(metadata->>'storyIndex')::int IN (${storyIndicesStr})`)
      .execute();

    logger.info("Archived story claims for selective revision", {
      orgId,
      parentTaskId,
      storyIndices,
      archivedCount: result.affected,
    });

    res.json({
      success: true,
      archivedCount: result.affected,
      storyIndices,
    });
  })
);

/**
 * POST /api/coordination/archive
 *
 * Archive context messages to clear the communication feed.
 * Archived messages are hidden from active workers but preserved for history.
 *
 * Request body:
 * - parentTaskId: UUID (optional) - Archive messages for specific parent task
 * - all: boolean (optional) - Archive all messages for the organization
 *
 * At least one of parentTaskId or all=true must be provided.
 */
router.post(
  "/archive",
  authenticateRequest,
  [
    body("parentTaskId").optional().isUUID().withMessage("parentTaskId must be a valid UUID"),
    body("all").optional().isBoolean().withMessage("all must be a boolean"),
  ],
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const { parentTaskId, all } = req.body;
    const orgId = req.organization!.id;

    if (!parentTaskId && !all) {
      throw new BadRequestError("Must provide either parentTaskId or all=true");
    }

    const contextRepo = AppDataSource.getRepository(WorkerContext);
    const now = new Date();

    let result;
    if (all) {
      // Archive all non-archived messages for this org
      result = await contextRepo
        .createQueryBuilder()
        .update(WorkerContext)
        .set({ archived: true, archivedAt: now })
        .where("org_id = :orgId", { orgId })
        .andWhere("archived = false")
        .execute();
    } else {
      // Archive messages for specific parent task
      result = await contextRepo
        .createQueryBuilder()
        .update(WorkerContext)
        .set({ archived: true, archivedAt: now })
        .where("parent_task_id = :parentTaskId", { parentTaskId })
        .andWhere("org_id = :orgId", { orgId })
        .andWhere("archived = false")
        .execute();
    }

    logger.info("Archived context messages", {
      orgId,
      parentTaskId: parentTaskId || "all",
      archivedCount: result.affected,
    });

    res.json({
      success: true,
      archivedCount: result.affected,
    });
  })
);

export default router;
