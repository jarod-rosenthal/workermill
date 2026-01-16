/**
 * Global Error Handler Middleware for WorkerMill API
 *
 * Catches all errors thrown from route handlers and returns appropriate HTTP responses.
 * Uses custom error classes from utils/errors.ts for semantic status codes.
 *
 * Usage:
 *   In route handlers, just throw errors:
 *     throw new NotFoundError('Task not found');
 *
 *   The error handler will catch it and return:
 *     HTTP 404: { "error": "Task not found" }
 */

import { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { AppError, TooManyRequestsError } from "../utils/errors.js";
import { logger, sanitizeForLogging } from "../utils/logger.js";

/**
 * Standard error response format
 */
interface ErrorResponse {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

/**
 * Global error handler middleware
 * Must be registered AFTER all routes but BEFORE Sentry's generic handler
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Handle known application errors with proper status codes
  if (err instanceof AppError) {
    const response: ErrorResponse = { error: err.message };

    // Add Retry-After header for rate limiting
    if (err instanceof TooManyRequestsError && err.retryAfter) {
      res.setHeader("Retry-After", err.retryAfter);
    }

    // Log operational errors at warning level, non-operational at error level
    if (err.isOperational) {
      logger.warn("Operational error", {
        statusCode: err.statusCode,
        message: err.message,
        path: req.path,
        method: req.method,
      });
    } else {
      logger.error("Non-operational error", {
        statusCode: err.statusCode,
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
      });
      // Report non-operational errors to Sentry
      Sentry.captureException(err);
    }

    res.status(err.statusCode).json(response);
    return;
  }

  // Handle unexpected errors (programming errors, etc.)
  // SECURITY: Sanitize request body to prevent logging sensitive data (passwords, tokens, etc.)
  logger.error("Unexpected error", {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: sanitizeForLogging(req.body),
    query: sanitizeForLogging(req.query),
  });

  // Report to Sentry
  Sentry.captureException(err);

  // Return generic 500 error (don't expose internal details)
  res.status(500).json({ error: "Internal server error" });
}

/**
 * 404 handler for unknown routes
 * Must be registered AFTER all routes but BEFORE the error handler
 */
export function notFoundHandler(
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.debug("Route not found", {
    path: req.path,
    method: req.method,
  });
  res.status(404).json({ error: "Not found" });
}

/**
 * Async handler wrapper
 * Wraps async route handlers to automatically catch errors and pass to error handler
 *
 * Usage:
 *   router.get('/tasks/:id', asyncHandler(async (req, res) => {
 *     const task = await findTask(req.params.id);
 *     if (!task) throw new NotFoundError('Task not found');
 *     res.json(task);
 *   }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
