/**
 * Warm Container Pool API Routes
 *
 * Endpoints for warm containers to register and poll for task assignments.
 * These are called by the warm-wait.sh script running in ECS containers.
 */

import { Router, Request, Response } from "express";
import { body, param, validationResult } from "express-validator";
import {
  registerContainerReady,
  getContainerAssignment,
  updateHeartbeat,
  getPoolStatus,
  POLL_TIMEOUT_MS,
} from "../services/warm-pool.js";
import { logger } from "../utils/logger.js";
import { authenticateRequest } from "../middleware/auth.js";

const router = Router();

/**
 * Validate platform API key for warm container authentication
 * Warm containers use a platform-level key, not org-specific keys
 */
function validatePlatformApiKey(req: Request, res: Response, next: () => void): void {
  const apiKey = req.headers["x-api-key"] as string;
  const platformKey = process.env.WARM_POOL_API_KEY || process.env.PLATFORM_API_KEY;

  if (!platformKey) {
    logger.error("WARM_POOL_API_KEY or PLATFORM_API_KEY not configured");
    res.status(500).json({ error: "Server configuration error" });
    return;
  }

  if (!apiKey || apiKey !== platformKey) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  next();
}

/**
 * POST /api/warm-pool/ready
 * Register a warm container as ready to receive tasks
 */
router.post(
  "/ready",
  validatePlatformApiKey,
  [
    body("ecsTaskId").isString().notEmpty(),
    body("ecsTaskArn").isString().notEmpty(),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { ecsTaskId, ecsTaskArn } = req.body;

    try {
      const container = await registerContainerReady(ecsTaskId, ecsTaskArn);

      if (!container) {
        res.status(404).json({
          error: "Container not found",
          message: "No warming container found with this ECS task ID",
        });
        return;
      }

      res.json({
        status: "ready",
        containerId: container.id,
        message: "Container registered as ready",
      });
    } catch (error) {
      logger.error("Failed to register container as ready", { ecsTaskId, error });
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * GET /api/warm-pool/poll/:ecsTaskId
 * Long-poll for task assignment (30s timeout)
 * Also serves as heartbeat for the container
 */
router.get(
  "/poll/:ecsTaskId",
  validatePlatformApiKey,
  [param("ecsTaskId").isString().notEmpty()],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const ecsTaskId = req.params.ecsTaskId as string;

    try {
      // Check for assignment immediately
      let assignment = await getContainerAssignment(ecsTaskId);

      if (assignment.status === "assigned" || assignment.status === "terminate") {
        if (!res.headersSent) {
          res.json(assignment);
        }
        return;
      }

      // Long-poll: wait for assignment with timeout
      const startTime = Date.now();
      const pollInterval = 2000; // Check every 2 seconds

      const poll = async (): Promise<void> => {
        // Check if response already sent (e.g., by timeout middleware)
        if (res.headersSent) {
          return;
        }

        const elapsed = Date.now() - startTime;

        if (elapsed >= POLL_TIMEOUT_MS) {
          // Timeout reached, return waiting status
          if (!res.headersSent) {
            res.json({ status: "waiting" });
          }
          return;
        }

        // Check for assignment
        assignment = await getContainerAssignment(ecsTaskId);

        if (assignment.status === "assigned" || assignment.status === "terminate") {
          if (!res.headersSent) {
            res.json(assignment);
          }
          return;
        }

        // Wait before next check
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        await poll();
      };

      await poll();
    } catch (error) {
      logger.error("Failed to poll for assignment", { ecsTaskId, error });
      if (!res.headersSent) {
        res.status(500).json({
          status: "error",
          message: "Internal server error",
        });
      }
    }
  },
);

/**
 * GET /api/warm-pool/status/:orgId
 * Get warm pool status for an organization (for dashboard)
 * Requires authentication and org membership
 */
router.get(
  "/status/:orgId",
  authenticateRequest,
  [param("orgId").isUUID()],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const orgId = req.params.orgId as string;
    const userOrg = req.organization;

    // Verify user has access to this org
    if (!userOrg || userOrg.id !== orgId) {
      res.status(403).json({ error: "Access denied to this organization" });
      return;
    }

    try {
      const status = await getPoolStatus(orgId);
      res.json(status);
    } catch (error) {
      logger.error("Failed to get pool status", { orgId, error });
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
