import { Router, Request, Response } from "express";
import { authenticateUser } from "../middleware/auth.js";
import { AppDataSource } from "../db/connection.js";
import { PushSubscription, User, type PushPlatform } from "../models/index.js";
import { logger } from "../utils/logger.js";

const router = Router();

// All routes require authentication
router.use(authenticateUser);

/**
 * POST /api/push/register
 * Register or update a push notification subscription
 */
router.post("/register", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const org = req.organization!;
    const { expoPushToken, platform, deviceName } = req.body;

    // Validate required fields
    if (!expoPushToken || typeof expoPushToken !== "string") {
      return res.status(400).json({ error: "expoPushToken is required and must be a string" });
    }

    if (!platform || !["ios", "android"].includes(platform)) {
      return res.status(400).json({ error: "platform is required and must be 'ios' or 'android'" });
    }

    // Validate deviceName if provided
    if (deviceName !== undefined && (typeof deviceName !== "string" || deviceName.length > 255)) {
      return res.status(400).json({ error: "deviceName must be a string with max 255 characters" });
    }

    const pushRepo = AppDataSource.getRepository(PushSubscription);

    // Check if subscription already exists for this user+org+token
    let subscription = await pushRepo.findOne({
      where: {
        userId: user.id,
        orgId: org.id,
        expoPushToken,
      },
    });

    if (subscription) {
      // Update existing subscription
      subscription.platform = platform as PushPlatform;
      subscription.deviceName = deviceName || null;
      await pushRepo.save(subscription);

      logger.info("Push subscription updated", {
        userId: user.id,
        orgId: org.id,
        platform,
        subscriptionId: subscription.id,
      });
    } else {
      // Create new subscription
      subscription = pushRepo.create({
        userId: user.id,
        orgId: org.id,
        expoPushToken,
        platform: platform as PushPlatform,
        deviceName: deviceName || null,
      });

      await pushRepo.save(subscription);

      logger.info("Push subscription created", {
        userId: user.id,
        orgId: org.id,
        platform,
        subscriptionId: subscription.id,
      });
    }

    res.json({
      id: subscription.id,
      expoPushToken: subscription.expoPushToken,
      platform: subscription.platform,
    });
  } catch (error: any) {
    logger.error("Error registering push subscription", { error: error.message });

    // Handle unique constraint violation (duplicate token)
    if (error.code === "23505" && error.constraint === "uq_push_subscriptions_token") {
      return res.status(409).json({
        error: "This push token is already registered to another user"
      });
    }

    res.status(500).json({ error: "Failed to register push subscription" });
  }
});

/**
 * DELETE /api/push/register
 * Remove a push notification subscription
 */
router.delete("/register", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const { expoPushToken } = req.body;

    // Validate required fields
    if (!expoPushToken || typeof expoPushToken !== "string") {
      return res.status(400).json({ error: "expoPushToken is required and must be a string" });
    }

    const pushRepo = AppDataSource.getRepository(PushSubscription);

    // Find subscription for this user and token (don't filter by org - user might want to remove all instances)
    const subscription = await pushRepo.findOne({
      where: {
        userId: user.id,
        expoPushToken,
      },
    });

    if (!subscription) {
      return res.status(404).json({ error: "Push subscription not found" });
    }

    await pushRepo.remove(subscription);

    logger.info("Push subscription removed", {
      userId: user.id,
      subscriptionId: subscription.id,
      expoPushToken,
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error("Error removing push subscription", { error: error.message });
    res.status(500).json({ error: "Failed to remove push subscription" });
  }
});

/**
 * GET /api/push/prefs
 * Get notification preferences for the current user
 */
router.get("/prefs", async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    // notification_preferences is a jsonb column on the users table
    const preferences = user.notificationPreferences || {
      push_completions: true,
      push_failures: true,
      push_blockers: true,
      push_plan_approvals: true,
    };

    res.json(preferences);
  } catch (error: any) {
    logger.error("Error getting notification preferences", { error: error.message });
    res.status(500).json({ error: "Failed to get notification preferences" });
  }
});

/**
 * PUT /api/push/prefs
 * Update notification preferences for the current user
 */
router.put("/prefs", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const preferences = req.body;

    // Validate that preferences is an object
    if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
      return res.status(400).json({ error: "Preferences must be an object" });
    }

    // Validate individual preference fields if provided
    const validKeys = ["push_completions", "push_failures", "push_blockers", "push_plan_approvals"];
    const providedKeys = Object.keys(preferences);

    for (const key of providedKeys) {
      if (!validKeys.includes(key)) {
        return res.status(400).json({
          error: `Invalid preference key: ${key}. Valid keys are: ${validKeys.join(", ")}`
        });
      }

      if (typeof preferences[key] !== "boolean") {
        return res.status(400).json({
          error: `Preference ${key} must be a boolean`
        });
      }
    }

    // Merge with existing preferences to preserve other keys
    const currentPrefs = user.notificationPreferences || {
      push_completions: true,
      push_failures: true,
      push_blockers: true,
      push_plan_approvals: true,
    };

    const updatedPrefs = {
      ...currentPrefs,
      ...preferences,
    };

    // Update user record
    const userRepo = AppDataSource.getRepository(User);
    await userRepo.update({ id: user.id }, { notificationPreferences: updatedPrefs });

    logger.info("Notification preferences updated", {
      userId: user.id,
      updatedKeys: providedKeys,
    });

    res.json(updatedPrefs);
  } catch (error: any) {
    logger.error("Error updating notification preferences", { error: error.message });
    res.status(500).json({ error: "Failed to update notification preferences" });
  }
});

export default router;