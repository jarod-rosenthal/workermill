/**
 * Email Service - Unsubscribe Token Generation/Verification
 */

import crypto from "crypto";

function getUnsubscribeSecret(): string {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error("EMAIL_UNSUBSCRIBE_SECRET environment variable is required");
  return secret;
}

/**
 * Generate HMAC-signed unsubscribe token
 * Format: {userId}:{notificationType}:{timestamp}:{signature}
 */
export function generateUnsubscribeToken(
  userId: string,
  notificationType: string
): string {
  const timestamp = Date.now();
  const payload = `${userId}:${notificationType}:${timestamp}`;
  const signature = crypto
    .createHmac("sha256", getUnsubscribeSecret())
    .update(payload)
    .digest("hex")
    .substring(0, 16);

  return Buffer.from(`${payload}:${signature}`).toString("base64url");
}

/**
 * Verify and parse unsubscribe token
 * Returns null if invalid or expired (tokens expire after 30 days)
 */
export function verifyUnsubscribeToken(
  token: string
): { userId: string; notificationType: string; timestamp: number } | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const parts = decoded.split(":");

    if (parts.length !== 4) return null;

    const [userId, notificationType, timestampStr, signature] = parts;
    const timestamp = parseInt(timestampStr, 10);

    // Check expiration (30 days)
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - timestamp > thirtyDaysMs) {
      return null;
    }

    // Verify signature
    const payload = `${userId}:${notificationType}:${timestamp}`;
    const expectedSignature = crypto
      .createHmac("sha256", getUnsubscribeSecret())
      .update(payload)
      .digest("hex")
      .substring(0, 16);

    if (signature !== expectedSignature) {
      return null;
    }

    return { userId, notificationType, timestamp };
  } catch {
    return null;
  }
}
