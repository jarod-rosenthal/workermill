import { Request, Response, NextFunction } from "express";
import { AppDataSource } from "../db/connection.js";
import { logger } from "../utils/logger.js";

// Endpoints exempt from pool health gating — always processed
const EXEMPT_PATHS = [
  "/health",
  "/api/agent/poll",
  "/api/agent/heartbeat",
  "/api/tasks/",
  "/api/coordination/",
  "/api/control-center/logs",
  "/api/status",
];

/**
 * Middleware that returns 503 when DB pool utilization exceeds threshold.
 * Essential endpoints (health checks, agent poll, worker logs) are exempt.
 * ALB sees 503s and routes traffic to healthier instances.
 */
export function poolHealthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Skip for exempt paths
  if (EXEMPT_PATHS.some((p) => req.path.startsWith(p))) {
    return next();
  }

  try {
    const pool = (AppDataSource.driver as any)?.master;
    if (!pool) return next();

    const poolMax = parseInt(process.env.DB_POOL_MAX || "10", 10);
    const total: number = pool.totalCount ?? 0;
    const idle: number = pool.idleCount ?? 0;
    const active = total - idle;
    const utilization = poolMax > 0 ? active / poolMax : 0;

    if (utilization >= 0.8) {
      logger.warn("Pool health gate: rejecting request", {
        path: req.path,
        active,
        idle,
        total,
        poolMax,
        utilizationPct: Math.round(utilization * 100),
      });
      res.setHeader("Retry-After", "1");
      res.status(503).json({
        error: "Service temporarily unavailable — high database load",
        retryAfter: 1,
      });
      return;
    }
  } catch {
    // Best-effort — never block requests due to monitoring failure
  }

  next();
}
