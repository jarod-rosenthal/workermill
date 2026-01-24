/**
 * Email Routes
 *
 * Handles email-related endpoints including unsubscribe functionality.
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../db/connection.js";
import { User } from "../models/index.js";
import { verifyUnsubscribeToken } from "../services/email.js";
import { logger } from "../utils/logger.js";
import { query, validateRequest } from "../middleware/validation.js";

const router = Router();

/**
 * GET /api/email/unsubscribe
 * Handle email unsubscribe requests (no login required for CAN-SPAM compliance)
 */
router.get(
  "/unsubscribe",
  query("token").notEmpty().withMessage("Token is required"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const token = req.query.token as string;

      // Verify and parse the token
      const tokenData = verifyUnsubscribeToken(token);

      if (!tokenData) {
        // Show a friendly error page
        res.status(400).send(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Invalid Unsubscribe Link - WorkerMill</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 40px 20px; background: #f4f4f5; }
              .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; text-align: center; }
              h1 { color: #18181b; margin-bottom: 16px; }
              p { color: #71717a; line-height: 1.6; }
              a { color: #3b82f6; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Invalid or Expired Link</h1>
              <p>This unsubscribe link is invalid or has expired. Unsubscribe links are valid for 30 days.</p>
              <p>You can manage your email preferences by logging into the <a href="https://workermill.com/settings">WorkerMill dashboard</a>.</p>
            </div>
          </body>
          </html>
        `);
        return;
      }

      const { userId, notificationType } = tokenData;

      // Get the user
      const userRepo = AppDataSource.getRepository(User);
      const user = await userRepo.findOne({ where: { id: userId } });

      if (!user) {
        res.status(404).send(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>User Not Found - WorkerMill</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 40px 20px; background: #f4f4f5; }
              .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; text-align: center; }
              h1 { color: #18181b; margin-bottom: 16px; }
              p { color: #71717a; line-height: 1.6; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>User Not Found</h1>
              <p>We couldn't find your account. You may have already been removed from our system.</p>
            </div>
          </body>
          </html>
        `);
        return;
      }

      // Update the user's email preferences
      const emailPrefs = user.preferences?.email || {};
      const updatedEmailPrefs = {
        ...emailPrefs,
        [notificationType]: false,
      };

      user.preferences = {
        ...user.preferences,
        email: updatedEmailPrefs,
      };

      await userRepo.save(user);

      logger.info("User unsubscribed from email notifications", {
        userId,
        notificationType,
      });

      // Map notification type to friendly name
      const notificationNames: Record<string, string> = {
        taskCompleted: "Task Completed",
        taskFailed: "Task Failed",
        costAlerts: "Cost Alerts",
        prCreated: "Pull Request Created",
        quotaWarning: "Quota Warning",
      };

      const friendlyName = notificationNames[notificationType] || notificationType;

      // Show success page
      res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Unsubscribed - WorkerMill</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 40px 20px; background: #f4f4f5; }
            .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; text-align: center; }
            h1 { color: #18181b; margin-bottom: 16px; }
            p { color: #71717a; line-height: 1.6; }
            .success { color: #166534; background: #dcfce7; padding: 12px 20px; border-radius: 6px; display: inline-block; margin-bottom: 20px; }
            a { color: #3b82f6; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success">Successfully Unsubscribed</div>
            <h1>Email Preferences Updated</h1>
            <p>You have been unsubscribed from <strong>${friendlyName}</strong> email notifications.</p>
            <p>You can manage all your email preferences in the <a href="https://workermill.com/settings">WorkerMill dashboard</a>.</p>
          </div>
        </body>
        </html>
      `);
    } catch (error) {
      logger.error("Error processing unsubscribe request", { error });
      res.status(500).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Error - WorkerMill</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 40px 20px; background: #f4f4f5; }
            .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; text-align: center; }
            h1 { color: #18181b; margin-bottom: 16px; }
            p { color: #71717a; line-height: 1.6; }
            a { color: #3b82f6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Something Went Wrong</h1>
            <p>We encountered an error processing your request. Please try again or manage your preferences in the <a href="https://workermill.com/settings">WorkerMill dashboard</a>.</p>
          </div>
        </body>
        </html>
      `);
    }
  }
);

export default router;
