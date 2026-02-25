import rateLimit, { type Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import Redis from "ioredis";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";

/**
 * Extract a user/org-scoped key for rate limiting.
 * Falls back to IP when no auth context is available.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userOrgKey(req: any): string {
  if (req.user?.id) return `user:${req.user.id}`;
  if (req.organization?.id) return `org:${req.organization.id}`;
  return req.ip || "unknown";
}

/**
 * Shared Redis client for rate limiting (lazy, one connection for all limiters).
 */
let redisClient: Redis | null = null;

function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;
  if (!config.redisUrl) return null;

  try {
    // RedisStore runs a Lua script in its constructor, so the connection must
    // be ready immediately. Use default (eager) connect with offline queue
    // enabled so commands buffer until the handshake completes.
    redisClient = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 2,
    });

    redisClient.on("error", (err) => {
      logger.warn("Rate limiter Redis error", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return redisClient;
  } catch (err) {
    logger.warn("Failed to create Redis rate limit client — using in-memory", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Create a Redis-backed store for a rate limiter.
 * Each limiter MUST have its own RedisStore instance with a unique prefix.
 */
export function createStore(prefix: string): Partial<Pick<Options, "store">> {
  const client = getRedisClient();
  if (!client) return {};

  return {
    store: new RedisStore({
      sendCommand: (...args: string[]) => client.call(args[0], ...args.slice(1)) as never,
      prefix,
    }),
  };
}

/**
 * Rate limiter for webhook endpoints (Jira, GitHub, Linear)
 * 100 requests per minute per IP
 * These are public endpoints that receive external service calls
 */
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  ...createStore("rl:webhook:"),
  handler: (req, res, _next, options) => {
    logger.warn("Webhook rate limit exceeded", {
      ip: req.ip,
      path: req.path,
      method: req.method,
    });
    res.status(options.statusCode).json(options.message);
  },
});

/**
 * Rate limiter for authenticated API endpoints
 * 200 requests per minute per user/org (keyed by authenticated identity)
 */
export const authenticatedLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  keyGenerator: userOrgKey,
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  ...createStore("rl:auth:"),
  handler: (req, res, _next, options) => {
    logger.warn("API rate limit exceeded", {
      ip: req.ip,
      path: req.path,
      method: req.method,
      userId: (req as unknown as { user?: { id: string } }).user?.id,
    });
    res.status(options.statusCode).json(options.message);
  },
});

/**
 * Strict rate limiter for sensitive operations (auth, password reset, etc.)
 * 10 requests per minute per IP
 */
export const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: "Too many attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
  ...createStore("rl:strict:"),
  handler: (req, res, _next, options) => {
    logger.warn("Strict rate limit exceeded", {
      ip: req.ip,
      path: req.path,
      method: req.method,
    });
    res.status(options.statusCode).json(options.message);
  },
});

/**
 * Rate limiter for task creation — prevents abuse of the Pro tier
 * 20 tasks per hour per user/org
 */
export const taskCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  keyGenerator: userOrgKey,
  message: { error: "Task creation rate limit exceeded. Try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  ...createStore("rl:taskcreate:"),
  handler: (req, res, _next, options) => {
    logger.warn("Task creation rate limit exceeded", {
      ip: req.ip,
      path: req.path,
      method: req.method,
    });
    res.status(options.statusCode).json(options.message);
  },
});

/**
 * Rate limiter for worker log ingestion endpoints
 * 1000 requests per minute per IP (high volume expected from workers)
 */
export const workerLogLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000,
  message: { error: "Too many log requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  ...createStore("rl:workerlog:"),
  handler: (req, res, _next, options) => {
    logger.warn("Worker log rate limit exceeded", {
      ip: req.ip,
      path: req.path,
      method: req.method,
    });
    res.status(options.statusCode).json(options.message);
  },
});
