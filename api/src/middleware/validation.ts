/**
 * Input Validation Middleware
 *
 * Provides shared validation utilities using express-validator.
 * Used across all API routes to ensure consistent input validation.
 */

import { Request, Response, NextFunction } from "express";
import { validationResult, ValidationChain } from "express-validator";

/**
 * Middleware to handle validation errors from express-validator.
 * Returns 400 with structured error array if validation fails.
 * Use after validation chains in route definitions.
 *
 * @example
 * router.post('/endpoint',
 *   body('field').isString(),
 *   validateRequest,
 *   async (req, res) => { ... }
 * );
 */
export function validateRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      error: "Validation failed",
      details: errors.array(),
    });
    return;
  }
  next();
}

/**
 * Helper function to check validation errors inline (non-middleware pattern).
 * Returns true if there are errors (and sends response), false otherwise.
 * Useful for routes that already use this pattern (like coordination.ts).
 *
 * @example
 * if (handleValidationErrors(req, res)) return;
 */
export function handleValidationErrors(req: Request, res: Response): boolean {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      error: "Validation failed",
      details: errors.array(),
    });
    return true;
  }
  return false;
}

/**
 * Create a validation middleware that runs validation chains and handles errors.
 * Useful for wrapping multiple validators into a single middleware.
 *
 * @example
 * const validateCreateTask = validate([
 *   body('jiraIssueKey').isString().notEmpty(),
 *   body('workerPersona').optional().isIn(['backend_developer', 'frontend_developer']),
 * ]);
 *
 * router.post('/', validateCreateTask, async (req, res) => { ... });
 */
export function validate(validations: ValidationChain[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Run all validations
    await Promise.all(validations.map((validation) => validation.run(req)));

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        error: "Validation failed",
        details: errors.array(),
      });
      return;
    }
    next();
  };
}

// Re-export express-validator functions for convenience
export {
  body,
  param,
  query,
  header,
  cookie,
  validationResult,
} from "express-validator";
