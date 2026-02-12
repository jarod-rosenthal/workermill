/**
 * Email Service - Rate Limiting and Email Logging
 */

import { AppDataSource } from "../../db/connection.js";
import { EmailLog, type EmailType, type EmailMetadata } from "../../models/EmailLog.js";
import { logger } from "../../utils/logger.js";

// Rate limit: 50 emails per user per day
const EMAIL_RATE_LIMIT = 50;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Check if user has exceeded email rate limit
 */
export async function isRateLimited(userId: string): Promise<boolean> {
  try {
    const emailLogRepo = AppDataSource.getRepository(EmailLog);
    const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);

    const count = await emailLogRepo.count({
      where: {
        userId,
        createdAt: AppDataSource.manager.connection.driver.options.type === "postgres"
          ? (await import("typeorm")).MoreThan(cutoff)
          : (await import("typeorm")).MoreThan(cutoff),
      },
    });

    return count >= EMAIL_RATE_LIMIT;
  } catch (error) {
    logger.warn("Failed to check email rate limit", { error, userId });
    return false;
  }
}

/**
 * Log an email send attempt to the database
 */
export async function logEmailSend(
  orgId: string,
  userId: string | null,
  recipientEmail: string,
  emailType: EmailType,
  subject: string,
  sesMessageId: string | null,
  status: "sent" | "failed",
  errorMessage: string | null,
  metadata: EmailMetadata = {}
): Promise<void> {
  try {
    const emailLogRepo = AppDataSource.getRepository(EmailLog);
    const emailLog = emailLogRepo.create({
      orgId,
      userId,
      recipientEmail,
      emailType,
      subject,
      sesMessageId,
      status,
      errorMessage,
      metadata,
      sentAt: status === "sent" ? new Date() : null,
    });
    await emailLogRepo.save(emailLog);
  } catch (error) {
    logger.error("Failed to log email send", { error, orgId, recipientEmail, emailType });
  }
}
