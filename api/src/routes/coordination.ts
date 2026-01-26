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
import { WorkerContext, WorkerCommand, WorkerTask, type ContextMessageType } from "../models/index.js";
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
              parentTaskId: context.parentTaskId,
              persona: context.persona,
              messageType: context.messageType,
              content: context.content,
              metadata: context.metadata,
              sessionId: context.sessionId,
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
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: "Validation failed", details: errors.array() });
      return;
    }

    try {
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
        res.status(404).json({ error: "Question not found" });
        return;
      }

      // Allow answering both questions and consultations (Phase 6: worker-to-worker answers)
      if (question.messageType !== "question" && question.messageType !== "consultation") {
        res.status(400).json({ error: "Referenced message is not a question or consultation" });
        return;
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
    } catch (error) {
      logger.error("Error submitting answer", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "Failed to submit answer" });
    }
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
  "constraints",   // PRD-level constraints - posted by orchestrator BEFORE workers spawn
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
  "story_ready",   // Story's dependencies met, available for claim in Epic mode
  "story_claimed", // Expert claimed a story in Epic mode
  "consultation",  // Targeted expert consultation (CONSULT-PERSONA: question?)
  "revision_requested", // Tech Lead requested revision with feedback
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
    body("content").isString().trim().notEmpty().withMessage("content is required"),
    body("metadata").optional().isObject(),
    body("sessionId").optional().isString().trim(),
  ],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
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

      logger.info("Worker context posted", {
        parentTaskId,
        taskId,
        persona,
        messageType,
        sessionId,
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
          sessionId: saved.sessionId,
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
  authenticateRequest, // Allow both JWT (frontend) and API key (workers) authentication
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
      const parentTaskId = req.params.parentTaskId as string;
      const messageType = req.query.messageType as ContextMessageType | undefined;
      const since = req.query.since as string | undefined;
      const limit = parseInt(req.query.limit as string) || 100;
      const includeArchived = req.query.includeArchived === "true";
      const orgId = req.organization!.id;

      // VALIDATE org owns this parent task before returning context
      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const parentTask = await taskRepo.findOne({
        where: { id: parentTaskId, orgId },
      });

      if (!parentTask) {
        res.status(404).json({ error: "Parent task not found" });
        return;
      }

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
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: "Validation failed", details: errors.array() });
      return;
    }

    try {
      const { storyId, claimedBy, parentTaskId } = req.body;
      const orgId = req.organization!.id;

      const contextRepo = AppDataSource.getRepository(WorkerContext);

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
        res.status(404).json({ error: "Story not found (no story_ready context with that ID)" });
        return;
      }

      // Verify it belongs to the specified parent
      if (storyReadyContext.parentTaskId !== parentTaskId) {
        res.status(400).json({
          error: "Story does not belong to specified parent task",
          details: {
            storyParentTaskId: storyReadyContext.parentTaskId,
            providedParentTaskId: parentTaskId
          },
        });
        return;
      }

      // Check if this story was already claimed (look for story_claimed message with same storyIndex)
      const storyIndex = storyReadyContext.metadata?.storyIndex as number;
      const existingClaim = await contextRepo.findOne({
        where: {
          parentTaskId,
          orgId,
          messageType: "story_claimed",
        },
      });

      // Check if any story_claimed message has the same storyIndex
      if (existingClaim) {
        const allClaims = await contextRepo.find({
          where: {
            parentTaskId,
            orgId,
            messageType: "story_claimed",
          },
        });

        const alreadyClaimed = allClaims.find(
          (c) => (c.metadata?.storyIndex as number) === storyIndex
        );

        if (alreadyClaimed) {
          res.status(409).json({
            error: "Story already claimed",
            details: {
              storyId,
              storyIndex,
              claimedBy: alreadyClaimed.metadata?.claimedBy,
              message: `Story ${storyIndex} was already claimed by ${alreadyClaimed.metadata?.claimedBy}`,
            },
          });
          return;
        }
      }

      // Story is available - create a story_claimed context message
      const storyTitle = storyReadyContext.metadata?.title as string || storyReadyContext.content;

      const claimedContextData = WorkerContext.create(
        parentTaskId,
        parentTaskId, // Use parentTaskId as taskId for context-based claiming
        orgId,
        claimedBy,
        "story_claimed",
        `${claimedBy} claimed story ${storyIndex}: ${storyTitle}`,
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

      logger.info("Story claimed in Epic mode", {
        storyReadyContextId: storyId,
        storyIndex,
        claimedBy,
        parentTaskId,
        orgId,
      });

      res.json({
        success: true,
        story: {
          id: storyId, // Return the context ID they sent
          storyIndex,
          storyTitle,
          persona: storyReadyContext.metadata?.persona,
          description: storyReadyContext.metadata?.description,
          targetFiles: storyReadyContext.metadata?.targetFiles,
        },
        context: {
          id: savedContext.id,
          parentTaskId: savedContext.parentTaskId,
          taskId: savedContext.taskId,
          persona: savedContext.persona,
          messageType: savedContext.messageType,
          content: savedContext.content,
          metadata: savedContext.metadata,
          createdAt: savedContext.createdAt,
        },
      });
    } catch (error) {
      logger.error("Error claiming story", {
        error: error instanceof Error ? error.message : String(error),
        storyId: req.body.storyId,
        claimedBy: req.body.claimedBy,
      });
      res.status(500).json({ error: "Failed to claim story" });
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

      // VALIDATE org owns this parent task before deleting context
      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const parentTask = await taskRepo.findOne({
        where: { id: parentTaskId, orgId },
      });

      if (!parentTask) {
        res.status(404).json({ error: "Parent task not found" });
        return;
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
    } catch (error) {
      logger.error("Error deleting context", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "Failed to delete context" });
    }
  }
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
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const parentTaskId = req.params.parentTaskId as string;
      const persona = req.params.persona as string;
      const orgId = req.organization!.id;

      // VALIDATE org owns this parent task before rolling back context
      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const parentTask = await taskRepo.findOne({
        where: { id: parentTaskId, orgId },
      });

      if (!parentTask) {
        res.status(404).json({ error: "Parent task not found" });
        return;
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
    } catch (error) {
      logger.error("Error rolling back persona context", {
        error: error instanceof Error ? error.message : String(error),
        parentTaskId: req.params.parentTaskId,
        persona: req.params.persona,
      });
      res.status(500).json({ error: "Failed to rollback persona context" });
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

      // VALIDATE org owns this task before creating command
      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id: taskId, orgId },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

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

      // VALIDATE org owns this task before returning commands
      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id: taskId, orgId },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
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

// =============================================================================
// Archive Context Messages
// =============================================================================

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
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: "Validation failed", details: errors.array() });
      return;
    }

    try {
      const { parentTaskId, all } = req.body;
      const orgId = req.organization!.id;

      if (!parentTaskId && !all) {
        res.status(400).json({ error: "Must provide either parentTaskId or all=true" });
        return;
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
    } catch (error) {
      logger.error("Error archiving context messages", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "Failed to archive context messages" });
    }
  }
);

export default router;
