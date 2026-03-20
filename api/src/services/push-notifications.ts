/**
 * Push Notification Delivery Service
 *
 * Handles sending push notifications via Expo Push API to registered mobile devices.
 * Includes preference filtering and automatic cleanup of invalid push tokens.
 */

import { AppDataSource } from "../db/connection.js";
import { PushSubscription } from "../models/PushSubscription.js";
import { User, type NotificationPreferences } from "../models/User.js";
import { logger } from "../utils/logger.js";

interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  category: "completions" | "failures" | "blockers" | "plan_approvals";
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: "default";
  priority?: "default" | "normal" | "high";
}

interface ExpoReceipt {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: {
    error?: "DeviceNotRegistered" | "InvalidCredentials" | "MessageTooBig" | "MessageRateExceeded" | "MismatchSenderId" | "InvalidExpoToken";
  };
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Send a push notification to all registered devices for a user
 *
 * @param userId - The user ID to send notification to
 * @param orgId - The organization ID for scoping
 * @param notification - The notification payload
 * @returns Promise<void> - Fire-and-forget, does not throw on delivery failures
 */
export async function sendPushNotification(
  userId: string,
  orgId: string,
  notification: PushNotificationPayload
): Promise<void> {
  try {
    // Get user's notification preferences
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({
      where: { id: userId, orgId },
    });

    if (!user) {
      logger.debug("User not found for push notification", { userId, orgId });
      return;
    }

    // Check if user has this notification category enabled
    const preferences = user.notificationPreferences;
    if (!preferences || !isNotificationEnabled(preferences, notification.category)) {
      logger.debug("Push notification disabled for user", {
        userId,
        orgId,
        category: notification.category,
        preferences,
      });
      return;
    }

    // Get all push subscriptions for this user+org
    const pushRepo = AppDataSource.getRepository(PushSubscription);
    const subscriptions = await pushRepo.find({
      where: { userId, orgId },
    });

    if (subscriptions.length === 0) {
      logger.debug("No push subscriptions found for user", { userId, orgId });
      return;
    }

    // Build Expo messages for all subscriptions
    const messages: ExpoMessage[] = subscriptions.map((sub) => ({
      to: sub.expoPushToken,
      title: notification.title,
      body: notification.body,
      data: notification.data || {},
      sound: "default",
      priority: "high",
    }));

    // Send to Expo Push API using Node.js built-in fetch
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      logger.error("Expo Push API returned non-2xx status", {
        status: response.status,
        statusText: response.statusText,
        userId,
        orgId,
        category: notification.category,
      });
      return;
    }

    const result = await response.json() as { data: ExpoReceipt[] };
    const receipts = result.data;

    if (!Array.isArray(receipts)) {
      logger.error("Unexpected Expo Push API response format", {
        result,
        userId,
        orgId,
        category: notification.category,
      });
      return;
    }

    // Process receipts and clean up invalid tokens
    await processExpoReceipts(receipts, subscriptions);

    logger.info("Push notification sent successfully", {
      userId,
      orgId,
      category: notification.category,
      subscriptionCount: subscriptions.length,
      successCount: receipts.filter(r => r.status === "ok").length,
    });

  } catch (error) {
    // Fire-and-forget: log the error but don't throw
    logger.error("Failed to send push notification", {
      userId,
      orgId,
      category: notification.category,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Check if a notification category is enabled in user preferences
 */
function isNotificationEnabled(
  preferences: NotificationPreferences,
  category: PushNotificationPayload["category"]
): boolean {
  const categoryMap = {
    "completions": "push_completions",
    "failures": "push_failures",
    "blockers": "push_blockers",
    "plan_approvals": "push_plan_approvals",
  } as const;

  const preferenceKey = categoryMap[category];
  return preferences[preferenceKey] === true;
}

/**
 * Process Expo push receipts and clean up invalid tokens
 */
async function processExpoReceipts(
  receipts: ExpoReceipt[],
  subscriptions: PushSubscription[]
): Promise<void> {
  const pushRepo = AppDataSource.getRepository(PushSubscription);
  const tokensToRemove: string[] = [];

  for (let i = 0; i < receipts.length; i++) {
    const receipt = receipts[i];
    const subscription = subscriptions[i];

    if (!subscription) continue;

    if (receipt.status === "error") {
      const errorType = receipt.details?.error;

      // Remove tokens that are no longer valid
      if (errorType === "DeviceNotRegistered" || errorType === "InvalidExpoToken") {
        tokensToRemove.push(subscription.expoPushToken);

        logger.info("Removing invalid push token", {
          expoPushToken: subscription.expoPushToken.substring(0, 20) + "...",
          userId: subscription.userId,
          orgId: subscription.orgId,
          errorType,
          platform: subscription.platform,
          deviceName: subscription.deviceName,
        });
      } else {
        logger.warn("Push notification delivery failed", {
          expoPushToken: subscription.expoPushToken.substring(0, 20) + "...",
          userId: subscription.userId,
          orgId: subscription.orgId,
          errorType,
          message: receipt.message,
        });
      }
    }
  }

  // Batch remove invalid tokens
  if (tokensToRemove.length > 0) {
    try {
      await pushRepo
        .createQueryBuilder()
        .delete()
        .from(PushSubscription)
        .where("expo_push_token IN (:...tokens)", { tokens: tokensToRemove })
        .execute();

      logger.info("Removed invalid push tokens", {
        count: tokensToRemove.length,
      });
    } catch (error) {
      logger.error("Failed to remove invalid push tokens", {
        error: error instanceof Error ? error.message : String(error),
        tokensCount: tokensToRemove.length,
      });
    }
  }
}