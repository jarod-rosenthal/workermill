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
    await AppDataSource.query("SELECT 1");

    // Active Redis health check
    let redisStatus: string;
    let redisLatencyMs: number | null = null;
    if (!redis.isConfigured) {
      redisStatus = "not_configured";
    } else {
      try {
        redisLatencyMs = await redis.ping();
        redisStatus = redisLatencyMs !== null ? "connected" : "disconnected";
      } catch {
        redisStatus = "error";
      }
    }

    // Pool stats for monitoring
    let pool: Record<string, number> = {};
    try {
      const pgPool = (AppDataSource.driver as any).master;
      if (pgPool) {
        const poolMax = parseInt(process.env.DB_POOL_MAX || "10", 10);
        const total = pgPool.totalCount ?? 0;
        const idle = pgPool.idleCount ?? 0;
        pool = {
          total,
          idle,
          waiting: pgPool.waitingCount ?? 0,
          active: total - idle,
          max: poolMax,
          utilizationPct:
            poolMax > 0 ? Math.round(((total - idle) / poolMax) * 100) : 0,
        };
      }
    } catch {
      // Best-effort pool monitoring
    }

    res.json({
      status: "ready",
      database: "connected",
      redis: redisStatus,
      ...(redisLatencyMs !== null && { redisLatencyMs }),
      pool,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "not ready",
      database: "disconnected",
    });
  }
});

export default router;
