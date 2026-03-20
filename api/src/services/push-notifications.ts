/**
 * WorkerMill Push Notifications Service
 *
 * Handles push notification delivery via Expo Push API.
 * Looks up user's push tokens, checks notification preferences,
 * sends via fetch to exp.host, handles DeviceNotRegistered by removing invalid tokens.
 * Fire-and-forget from callers.
 */

import { AppDataSource } from "../db/connection.js";
import { PushSubscription } from "../models/PushSubscription.js";
import { User, type NotificationPreferences } from "../models/User.js";
import { logger } from "../utils/logger.js";

/**
 * Push notification categories that can be filtered by user preferences
 */
export type PushNotificationCategory = "completions" | "failures" | "blockers" | "plan_approvals";

/**
 * Notification data for push delivery
 */
export interface PushNotificationData {
  title: string;
  body: string;
  data?: Record<string, string>;
  category: PushNotificationCategory;
}

/**
 * Expo Push API message format
 * @see https://docs.expo.dev/push-notifications/sending-notifications/#message-format
 */
interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: string;
  badge?: number;
  channelId?: string;
  categoryId?: string;
  mutableContent?: boolean;
  ttl?: number;
  expiration?: number;
  priority?: "default" | "normal" | "high";
}

/**
 * Expo Push API response format
 */
interface ExpoPushResponse {
  data: Array<{
    status: "ok" | "error";
    id?: string;
    message?: string;
    details?: {
      error?: "DeviceNotRegistered" | "InvalidCredentials" | "MessageTooBig" | "MessageRateExceeded";
    };
  }>;
}

/**
 * Expo Push API receipt format for checking delivery status
 */
interface ExpoPushReceipt {
  status: "ok" | "error";
  message?: string;
  details?: {
    error?: "DeviceNotRegistered" | "MessageTooBig" | "MessageRateExceeded" | "InvalidCredentials";
  };
}

/**
 * Map push notification categories to user preference keys
 */
const CATEGORY_TO_PREFERENCE_KEY: Record<PushNotificationCategory, keyof NotificationPreferences> = {
  completions: "push_completions",
  failures: "push_failures",
  blockers: "push_blockers",
  plan_approvals: "push_plan_approvals",
} as const;

/**
 * Send push notification to a user via Expo Push API.
 * This function is fire-and-forget - callers do NOT await.
 *
 * @param userId - User ID to send notification to
 * @param orgId - Organization ID for multi-tenancy
 * @param notification - Notification data including category for preference filtering
 */
export async function sendPushNotification(
  userId: string,
  orgId: string,
  notification: PushNotificationData
): Promise<void> {
  try {
    // Query push subscriptions for user+org
    const pushSubscriptionRepo = AppDataSource.getRepository(PushSubscription);
    const userSubscriptions = await pushSubscriptionRepo.find({
      where: {
        userId,
        orgId,
      },
    });

    if (userSubscriptions.length === 0) {
      logger.debug("No push subscriptions found for user", { userId, orgId });
      return;
    }

    // Check user notification preferences
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({
      where: { id: userId },
      select: ["id", "notificationPreferences"],
    });

    if (!user) {
      logger.warn("User not found for push notification", { userId, orgId });
      return;
    }

    // Check if user has disabled this category of notifications
    const preferenceKey = CATEGORY_TO_PREFERENCE_KEY[notification.category];
    const preferences = user.notificationPreferences || {};

    if (preferences[preferenceKey] === false) {
      logger.debug("User has disabled push notifications for category", {
        userId,
        orgId,
        category: notification.category,
      });
      return;
    }

    // Prepare push messages for all user devices
    const pushMessages: ExpoPushMessage[] = userSubscriptions.map(subscription => ({
      to: subscription.expoPushToken,
      title: notification.title,
      body: notification.body,
      data: notification.data || {},
      sound: "default",
      priority: "high" as const,
      channelId: "default",
    }));

    // Send notifications via Expo Push API
    await sendExpoPushMessages(pushMessages);

    logger.info("Sent push notification", {
      userId,
      orgId,
      category: notification.category,
      deviceCount: userSubscriptions.length,
    });

  } catch (error) {
    // Fire-and-forget - log error but don't throw
    logger.error("Failed to send push notification", {
      userId,
      orgId,
      category: notification.category,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Send messages to Expo Push API and handle responses.
 * Removes invalid tokens on DeviceNotRegistered errors.
 */
async function sendExpoPushMessages(messages: ExpoPushMessage[]): Promise<void> {
  if (messages.length === 0) return;

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
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
      });
      return;
    }

    const result = await response.json() as ExpoPushResponse;

    if (!result.data || !Array.isArray(result.data)) {
      logger.error("Invalid response format from Expo Push API", { result });
      return;
    }

    // Process responses and handle errors
    for (let i = 0; i < result.data.length; i++) {
      const responseData = result.data[i];
      const message = messages[i];

      if (!message) continue;

      if (responseData.status === "error") {
        if (responseData.details?.error === "DeviceNotRegistered") {
          // Remove invalid token from database
          await removeInvalidPushToken(message.to);
        } else {
          logger.warn("Expo push message failed", {
            token: message.to.substring(0, 10) + "...", // Log partial token for debugging
            error: responseData.details?.error || "unknown",
            message: responseData.message,
          });
        }
      }
    }

  } catch (error) {
    logger.error("Failed to call Expo Push API", {
      error: error instanceof Error ? error.message : String(error),
      messageCount: messages.length,
    });
  }
}

/**
 * Remove invalid push token from database when DeviceNotRegistered error occurs
 */
async function removeInvalidPushToken(expoPushToken: string): Promise<void> {
  try {
    const pushSubscriptionRepo = AppDataSource.getRepository(PushSubscription);
    const result = await pushSubscriptionRepo.delete({ expoPushToken });

    if (result.affected && result.affected > 0) {
      logger.info("Removed invalid push token", {
        token: expoPushToken.substring(0, 10) + "...", // Log partial token for privacy
        removedCount: result.affected,
      });
    } else {
      logger.warn("No push subscription found to remove", {
        token: expoPushToken.substring(0, 10) + "...",
      });
    }
  } catch (error) {
    logger.error("Failed to remove invalid push token", {
      token: expoPushToken.substring(0, 10) + "...",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}