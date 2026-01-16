import rateLimit from "express-rate-limit";
import { logger } from "../utils/logger.js";

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
 * 200 requests per minute per IP (higher since they require authentication)
 */
export const authenticatedLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
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
 * Rate limiter for worker log ingestion endpoints
 * 1000 requests per minute per IP (high volume expected from workers)
 */
export const workerLogLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000,
  message: { error: "Too many log requests, please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    logger.warn("Worker log rate limit exceeded", {
      ip: req.ip,
      path: req.path,
      method: req.method,
    });
    res.status(options.statusCode).json(options.message);
  },
});
