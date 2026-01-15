/**
 * Worker Coordination API Routes
 *
 * Endpoints for multi-worker coordination:
 * - Check-in/out: Worker presence tracking
 * - Heartbeat: Liveness updates
 * - File locks: Prevent concurrent file edits
 * - Resource reservations: Shared resource coordination
 */

import { Router, Request, Response } from "express";
import { body, query, validationResult } from "express-validator";
import { authenticateApiKey } from "../middleware/auth.js";
import {
  checkIn,
  checkOut,
  heartbeat,
  getActiveWorkers,
  acquireFileLocks,
  releaseFileLocks,
  getFileLocks,
  reserveResource,
  releaseResource,
  declareManifest,
  getManifests,
  clearManifest,
} from "../services/coordination.js";
import { logger } from "../utils/logger.js";

const router = Router();

// All coordination routes use API key authentication (called by workers)
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

/**
 * POST /api/coordination/locks/acquire
 *
 * Attempts to acquire exclusive locks on the specified files.
 * Returns which files were locked and any conflicts.
 */
router.post(
  "/locks/acquire",
  [
    body("taskId").isUUID().withMessage("taskId must be a valid UUID"),
    body("repo").isString().trim().notEmpty().withMessage("repo is required"),
    body("filePaths").isArray({ min: 1 }).withMessage("filePaths must be a non-empty array"),
    body("filePaths.*").isString().trim().notEmpty().withMessage("Each filePath must be a non-empty string"),
    body("lockType").optional().isIn(["exclusive", "shared"]).withMessage("lockType must be 'exclusive' or 'shared'"),
    body("ttlSeconds").optional().isInt({ min: 30, max: 3600 }).withMessage("ttlSeconds must be between 30 and 3600"),
  ],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { taskId, repo, filePaths, lockType, ttlSeconds } = req.body;

      const result = await acquireFileLocks(taskId, repo, filePaths, lockType, ttlSeconds);
      res.json(result);
    } catch (error) {
      logger.error("Error acquiring locks", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to acquire locks" });
    }
  }
);

/**
 * POST /api/coordination/locks/release
 *
 * Releases file locks held by the specified task.
 * If filePaths is not provided, releases all locks held by the task.
 */
router.post(
  "/locks/release",
  [
    body("taskId").isUUID().withMessage("taskId must be a valid UUID"),
    body("filePaths").optional().isArray(),
    body("filePaths.*").optional().isString(),
  ],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { taskId, filePaths } = req.body;

      const result = await releaseFileLocks(taskId, filePaths);
      res.json(result);
    } catch (error) {
      logger.error("Error releasing locks", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to release locks" });
    }
  }
);

/**
 * GET /api/coordination/locks
 *
 * Returns all active file locks for a repository.
 */
router.get(
  "/locks",
  [query("repo").isString().trim().notEmpty().withMessage("repo query parameter is required")],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const orgId = req.organization!.id;
      const repo = req.query.repo as string;

      const locks = await getFileLocks(orgId, repo);
      res.json({ locks });
    } catch (error) {
      logger.error("Error getting locks", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to get locks" });
    }
  }
);

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

// =============================================================================
// Git Manifest Endpoints
// =============================================================================
// The manifest system allows workers to declare their intent to modify files
// BEFORE they start editing. This enables conflict detection across workers.

/**
 * POST /api/coordination/manifest/declare
 *
 * Called by workers after analyzing/planning phase to declare which files
 * they intend to modify. Checks for conflicts with existing file locks and
 * auto-acquires locks if no conflicts exist.
 *
 * Request body:
 * - taskId: UUID - Task ID declaring the manifest
 * - repo: string - Repository (owner/name)
 * - branch: string - Branch being worked on
 * - filesToModify: string[] - File paths worker intends to edit
 * - ttlSeconds: number (optional) - TTL for acquired locks (default: 30 min)
 *
 * Response:
 * - success: boolean - True if no conflicts and locks acquired
 * - conflicts: FileLock[] - Any conflicting files held by other workers
 * - locksAcquired: string[] - Files that were successfully locked
 */
router.post(
  "/manifest/declare",
  [
    body("taskId").isUUID().withMessage("taskId must be a valid UUID"),
    body("repo").isString().trim().notEmpty().withMessage("repo is required"),
    body("branch").isString().trim().notEmpty().withMessage("branch is required"),
    body("filesToModify").isArray({ min: 1 }).withMessage("filesToModify must be a non-empty array"),
    body("filesToModify.*").isString().trim().notEmpty().withMessage("Each file path must be a non-empty string"),
    body("ttlSeconds").optional().isInt({ min: 60, max: 7200 }).withMessage("ttlSeconds must be between 60 and 7200"),
  ],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const { taskId, repo, branch, filesToModify, ttlSeconds } = req.body;

      const result = await declareManifest({
        taskId,
        repo,
        branch,
        filesToModify,
        ttlSeconds,
      });

      // Return 409 Conflict if there are conflicts, 200 OK otherwise
      if (!result.success) {
        res.status(409).json(result);
      } else {
        res.json(result);
      }
    } catch (error) {
      logger.error("Error declaring manifest", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to declare manifest" });
    }
  }
);

/**
 * GET /api/coordination/manifest
 *
 * Returns all active manifests for a repository. Use this to see which files
 * other workers have declared intent to modify.
 *
 * Query parameters:
 * - repo: string (required) - Repository (owner/name)
 * - branch: string (optional) - Filter by branch
 *
 * Response:
 * - manifests: ManifestEntry[] - List of active manifests with files and expiry
 */
router.get(
  "/manifest",
  [
    query("repo").isString().trim().notEmpty().withMessage("repo query parameter is required"),
    query("branch").optional().isString(),
  ],
  async (req: Request, res: Response) => {
    if (handleValidationErrors(req, res)) return;

    try {
      const orgId = req.organization!.id;
      const repo = req.query.repo as string;
      const branch = req.query.branch as string | undefined;

      const result = await getManifests(orgId, repo, branch);
      res.json(result);
    } catch (error) {
      logger.error("Error getting manifests", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to get manifests" });
    }
  }
);

/**
 * DELETE /api/coordination/manifest/:taskId
 *
 * Clears a manifest when a task completes. This releases all file locks
 * held by the task. Called automatically on task completion or can be
 * called explicitly if a worker decides not to modify certain files.
 *
 * URL parameters:
 * - taskId: UUID - Task ID whose manifest should be cleared
 *
 * Response:
 * - success: boolean
 * - released: number - Number of locks released
 */
router.delete(
  "/manifest/:taskId",
  async (req: Request, res: Response) => {
    const taskId = req.params.taskId as string;

    // Validate taskId is a UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(taskId)) {
      res.status(400).json({ error: "taskId must be a valid UUID" });
      return;
    }

    try {
      const result = await clearManifest(taskId);
      res.json(result);
    } catch (error) {
      logger.error("Error clearing manifest", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to clear manifest" });
    }
  }
);

export default router;
