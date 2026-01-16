/**
 * Custom Error Classes for WorkerMill API
 *
 * Provides semantic HTTP error handling with proper status codes.
 * Use these instead of manually setting res.status(xxx).json({ error: ... })
 *
 * Usage:
 *   throw new NotFoundError('Task not found');
 *   throw new BadRequestError('Invalid task ID format');
 *   throw new ConflictError('Task is already running');
 */

/**
 * Base application error class
 * All custom errors extend this class
 */
export abstract class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);

    // Set the prototype explicitly for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * 400 Bad Request
 * Use for validation failures, malformed requests, missing required fields
 */
export class BadRequestError extends AppError {
  constructor(message = "Bad request") {
    super(message, 400);
  }
}

/**
 * 401 Unauthorized
 * Use for missing or invalid authentication credentials
 */
export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401);
  }
}

/**
 * 403 Forbidden
 * Use when user is authenticated but lacks permission for the action
 */
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403);
  }
}

/**
 * 404 Not Found
 * Use when a requested resource doesn't exist
 */
export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404);
  }
}

/**
 * 409 Conflict
 * Use for state conflicts (e.g., task already running, duplicate entries)
 */
export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(message, 409);
  }
}

/**
 * 422 Unprocessable Entity
 * Use when request is syntactically valid but semantically invalid
 */
export class UnprocessableEntityError extends AppError {
  constructor(message = "Unprocessable entity") {
    super(message, 422);
  }
}

/**
 * 429 Too Many Requests
 * Use when rate limiting is triggered
 */
export class TooManyRequestsError extends AppError {
  public readonly retryAfter?: number;

  constructor(message = "Too many requests", retryAfter?: number) {
    super(message, 429);
    this.retryAfter = retryAfter;
  }
}

/**
 * 500 Internal Server Error
 * Use for unexpected server errors (prefer letting actual errors bubble up)
 */
export class InternalError extends AppError {
  constructor(message = "Internal server error") {
    super(message, 500, false); // isOperational = false for internal errors
  }
}

/**
 * 502 Bad Gateway
 * Use when an upstream service (e.g., Stripe, AWS) fails
 */
export class BadGatewayError extends AppError {
  constructor(message = "Bad gateway") {
    super(message, 502);
  }
}

/**
 * 503 Service Unavailable
 * Use when the service is temporarily unavailable (e.g., maintenance mode)
 */
export class ServiceUnavailableError extends AppError {
  constructor(message = "Service unavailable") {
    super(message, 503);
  }
}
