import { Request, Response, NextFunction } from "express";
import { TOS_VERSION } from "../constants/tos.js";

/**
 * Middleware that enforces current TOS version acceptance.
 * Returns 403 if the authenticated user has not accepted the current TOS.
 * Skips enforcement when:
 * - No req.user (API key auth without user context)
 * - EXECUTION_MODE is "local" (local development)
 */
export function requireCurrentTos(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Skip if no user context (API key auth, webhook, etc.)
  if (!req.user) {
    next();
    return;
  }

  // Skip in local development mode
  if (process.env.EXECUTION_MODE === "local") {
    next();
    return;
  }

  // Check if user has accepted current TOS version
  if (req.user.tosVersion !== TOS_VERSION) {
    res.status(403).json({
      error: "Terms of Service acceptance required",
      tosUpdateRequired: true,
      currentTosVersion: TOS_VERSION,
    });
    return;
  }

  next();
}
