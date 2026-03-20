import { Router, Request, Response } from "express";
import { body, validationResult } from "express-validator";
import { AppDataSource } from "../db/connection.js";
import { PushSubscription, User, NotificationPreferences } from "../models/index.js";
import { authenticateUser } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import { BadRequestError } from "../utils/errors.js";

const router = Router();

// Validation middleware for push registration
const validatePushRegistration = [
  body("expoPushToken")
    .isString()
    .isLength({ min: 1, max: 255 })
    .withMessage("Valid expo push token is required"),
  body("platform")
    .isIn(["ios", "android"])
    .withMessage("Platform must be 'ios' or 'android'"),
  body("deviceName")
    .optional()
    .isString()
    .isLength({ max: 255 })
    .withMessage("Device name must be a string with max 255 characters"),
];

/**
 * POST /api/push/register
 * Register or update push subscription for current user/org
 */
router.post("/register", authenticateUser, validatePushRegistration, async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        error: "validation_error",
        message: "Validation failed",
        details: errors.array(),
      });
      return;
    }

    const { expoPushToken, platform, deviceName } = req.body;
    const userId = req.user!.id;
    const orgId = req.organization!.id;

    const pushSubscriptionRepo = AppDataSource.getRepository(PushSubscription);

    // Upsert: find existing subscription for this user/org, or create new one
    let subscription = await pushSubscriptionRepo.findOne({
      where: { userId, orgId },
    });

    if (subscription) {
      // Update existing subscription
      subscription.expoPushToken = expoPushToken;
      subscription.platform = platform;
      subscription.deviceName = deviceName || null;
      subscription = await pushSubscriptionRepo.save(subscription);

      logger.info("Push subscription updated", {
        userId,
        orgId,
        platform,
        tokenPrefix: expoPushToken.substring(0, 12),
      });
    } else {
      // Create new subscription
      subscription = pushSubscriptionRepo.create({
        userId,
        orgId,
        expoPushToken,
        platform,
        deviceName: deviceName || null,
      });
      subscription = await pushSubscriptionRepo.save(subscription);

      logger.info("Push subscription created", {
        userId,
        orgId,
        platform,
        tokenPrefix: expoPushToken.substring(0, 12),
      });
    }

    res.status(200).json({
      id: subscription.id,
      expoPushToken: subscription.expoPushToken,
      platform: subscription.platform,
    });
  } catch (error) {
    logger.error("Error registering push subscription", {
      error: error instanceof Error ? error.message : String(error),
      userId: req.user?.id,
      orgId: req.organization?.id,
    });

    res.status(500).json({
      error: "internal_error",
      message: "Failed to register push subscription",
    });
  }
});

/**
 * DELETE /api/push/register
 * Remove push subscription for current user/org
 */
router.delete("/register", authenticateUser, [
  body("expoPushToken")
    .isString()
    .isLength({ min: 1, max: 255 })
    .withMessage("Valid expo push token is required"),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        error: "validation_error",
        message: "Validation failed",
        details: errors.array(),
      });
      return;
    }

    const { expoPushToken } = req.body;
    const userId = req.user!.id;
    const orgId = req.organization!.id;

    const pushSubscriptionRepo = AppDataSource.getRepository(PushSubscription);

    // Find and delete subscription matching user/org and token
    const deleteResult = await pushSubscriptionRepo.delete({
      userId,
      orgId,
      expoPushToken,
    });

    logger.info("Push subscription unregistered", {
      userId,
      orgId,
      tokenPrefix: expoPushToken.substring(0, 12),
      deletedCount: deleteResult.affected || 0,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error("Error unregistering push subscription", {
      error: error instanceof Error ? error.message : String(error),
      userId: req.user?.id,
      orgId: req.organization?.id,
    });

    res.status(500).json({
      error: "internal_error",
      message: "Failed to unregister push subscription",
    });
  }
});

/**
 * GET /api/push/prefs
 * Get notification preferences for current user
 */
router.get("/prefs", authenticateUser, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const userRepo = AppDataSource.getRepository(User);

    const user = await userRepo.findOne({
      where: { id: userId },
      select: ["id", "notificationPreferences"],
    });

    if (!user) {
      res.status(404).json({
        error: "user_not_found",
        message: "User not found",
      });
      return;
    }

    // Return preferences with defaults if not set
    const defaults: NotificationPreferences = {
      push_completions: true,
      push_failures: true,
      push_blockers: true,
      push_plan_approvals: true,
    };

    const prefs: NotificationPreferences = {
      ...defaults,
      ...user.notificationPreferences,
    };

    res.status(200).json(prefs);
  } catch (error) {
    logger.error("Error getting notification preferences", {
      error: error instanceof Error ? error.message : String(error),
      userId: req.user?.id,
    });

    res.status(500).json({
      error: "internal_error",
      message: "Failed to get notification preferences",
    });
  }
});

/**
 * PUT /api/push/prefs
 * Update notification preferences for current user
 */
router.put("/prefs", authenticateUser, [
  body("push_completions")
    .optional()
    .isBoolean()
    .withMessage("push_completions must be a boolean"),
  body("push_failures")
    .optional()
    .isBoolean()
    .withMessage("push_failures must be a boolean"),
  body("push_blockers")
    .optional()
    .isBoolean()
    .withMessage("push_blockers must be a boolean"),
  body("push_plan_approvals")
    .optional()
    .isBoolean()
    .withMessage("push_plan_approvals must be a boolean"),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        error: "validation_error",
        message: "Validation failed",
        details: errors.array(),
      });
      return;
    }

    const userId = req.user!.id;
    const userRepo = AppDataSource.getRepository(User);

    const user = await userRepo.findOne({
      where: { id: userId },
    });

    if (!user) {
      res.status(404).json({
        error: "user_not_found",
        message: "User not found",
      });
      return;
    }

    // Update notification preferences (partial update)
    const updatedPrefs: NotificationPreferences = {
      ...user.notificationPreferences,
      ...req.body,
    };

    await userRepo.update(userId, {
      notificationPreferences: updatedPrefs,
    });

    logger.info("Notification preferences updated", {
      userId,
      updatedFields: Object.keys(req.body),
    });

    res.status(200).json(updatedPrefs);
  } catch (error) {
    logger.error("Error updating notification preferences", {
      error: error instanceof Error ? error.message : String(error),
      userId: req.user?.id,
    });

    res.status(500).json({
      error: "internal_error",
      message: "Failed to update notification preferences",
    });
  }
});

export default router;