import { Router, Request, Response } from "express";
import {
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { body, validationResult } from "express-validator";
import rateLimit from "express-rate-limit";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { createStore } from "../../middleware/rate-limit.js";
import { cognitoClient } from "./helpers.js";

const router = Router();

// =============================================================================
// Password Reset (Cognito Forgot Password flow)
// =============================================================================

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per 15 min per IP
  message: { error: "Too many password reset attempts. Please try again later." },
  ...createStore("rl:pwreset:"),
});

/**
 * POST /api/auth/forgot-password
 * Request a password reset verification code via Cognito
 * Always returns 200 to prevent email enumeration
 */
router.post(
  "/forgot-password",
  passwordResetLimiter,
  [body("email").isEmail().normalizeEmail().withMessage("Valid email is required")],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: "Validation failed",
        details: errors.array(),
      });
    }

    const { email } = req.body;

    try {
      const command = new ForgotPasswordCommand({
        ClientId: config.cognito.clientId,
        Username: email,
      });
      await cognitoClient.send(command);
    } catch (error: any) {
      // Don't leak whether email exists — always return success
      logger.info("Forgot password request", { email, error: error.name });
    }

    // Always return 200 to prevent email enumeration
    res.json({
      message: "If an account exists with that email, a verification code has been sent.",
    });
  },
);

/**
 * POST /api/auth/reset-password
 * Reset password using Cognito verification code
 */
router.post(
  "/reset-password",
  passwordResetLimiter,
  [
    body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
    body("code").isString().notEmpty().isLength({ min: 1, max: 10 }).withMessage("Verification code is required"),
    body("newPassword")
      .isString()
      .isLength({ min: 8, max: 128 })
      .withMessage("Password must be between 8 and 128 characters"),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: "Validation failed",
        details: errors.array(),
      });
    }

    const { email, code, newPassword } = req.body;

    try {
      const command = new ConfirmForgotPasswordCommand({
        ClientId: config.cognito.clientId,
        Username: email,
        ConfirmationCode: code,
        Password: newPassword,
      });
      await cognitoClient.send(command);

      logger.info("Password reset successful", { email });
      res.json({ message: "Password has been reset successfully." });
    } catch (error: any) {
      logger.warn("Password reset failed", { email, error: error.name });

      if (error.name === "CodeMismatchException") {
        return res.status(400).json({ error: "Invalid or expired verification code." });
      }
      if (error.name === "ExpiredCodeException") {
        return res.status(400).json({
          error: "Verification code has expired. Please request a new one.",
        });
      }
      if (error.name === "InvalidPasswordException") {
        return res.status(400).json({
          error: "Password does not meet requirements. Must be at least 8 characters.",
        });
      }
      if (error.name === "LimitExceededException") {
        return res.status(429).json({ error: "Too many attempts. Please try again later." });
      }

      res.status(400).json({ error: "Unable to reset password. Please try again." });
    }
  },
);

export default router;
