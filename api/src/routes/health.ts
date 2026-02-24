import { Router, Request, Response } from "express";
import { AppDataSource } from "../db/connection.js";
import { redis } from "../services/redis-client.js";

const router = Router();

/**
 * GET /health
 * Basic health check
 */
router.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * GET /health/ready
 * Readiness check - verifies database connection
 */
router.get("/ready", async (_req: Request, res: Response) => {
  try {
    // Check database connection
    await AppDataSource.query("SELECT 1");

    const redisStatus = !redis.isConfigured
      ? "not_configured"
      : redis.isConnected
        ? "connected"
        : "disconnected";

    res.json({
      status: "ready",
      database: "connected",
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "not ready",
      database: "disconnected",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
