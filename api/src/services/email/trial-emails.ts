/**
 * Email Service - Trial Reminder Email Templates + Send
 */

import { SendEmailCommand } from "@aws-sdk/client-ses";
import { logger } from "../../utils/logger.js";
import type { Organization } from "../../models/Organization.js";
import { UserOrganization } from "../../models/UserOrganization.js";
import { AppDataSource } from "../../db/connection.js";
import { getSESClient, EMAIL_CONFIG, generateEmailFooter } from "./helpers.js";
import { generateUnsubscribeToken } from "./unsubscribe.js";
import { isRateLimited, logEmailSend } from "./rate-limit.js";
import { In } from "typeorm";

// =============================================================================
// HTML Generator
// =============================================================================

function generateTrialReminderHtml(
  organization: Organization,
  daysRemaining: number,
  unsubscribeUrl: string,
): string {
  const billingUrl = `${EMAIL_CONFIG.baseUrl}/billing`;
  const isExpired = daysRemaining <= 0;

  const badgeBg = isExpired ? "***REMOVED***fee2e2" : "***REMOVED***fef3c7";
  const badgeText = isExpired ? "***REMOVED***991b1b" : "***REMOVED***92400e";
  const badgeLabel = isExpired ? "Trial Ended" : "Trial Ending Soon";

  const headline = isExpired
    ? "Your Pro trial has ended"
    : `Your Pro trial ends in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`;

  const bodyText = isExpired
    ? "Your 90-day Pro trial has ended. Subscribe at $19/mo to continue running AI worker tasks with WorkerMill."
    : `Your WorkerMill Pro trial ends in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}. Subscribe at $19/mo to keep your AI worker workflows running without interruption.`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headline} - WorkerMill</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: ***REMOVED***f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: ***REMOVED***ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid ***REMOVED***e4e4e7;">
              <div style="font-size: 28px; font-weight: 700; color: ***REMOVED***18181b; letter-spacing: -0.5px;">
                WorkerMill
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; background-color: ${badgeBg}; color: ${badgeText}; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  ${badgeLabel}
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3; text-align: center;">
                ${headline}
              </h1>

              <p style="margin: 0 0 24px; font-size: 16px; color: ***REMOVED***52525b; line-height: 1.6; text-align: center;">
                ${bodyText}
              </p>

              <table role="presentation" style="width: 100%; margin: 24px 0; background-color: ***REMOVED***f4f4f5; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px; text-align: center; border-right: 1px solid ***REMOVED***e4e4e7;">
                    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">Plan</div>
                    <div style="font-size: 20px; font-weight: 700; color: ***REMOVED***18181b;">Pro</div>
                  </td>
                  <td style="padding: 16px; text-align: center;">
                    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">Price</div>
                    <div style="font-size: 20px; font-weight: 700; color: ***REMOVED***18181b;">$19/mo</div>
                  </td>
                </tr>
              </table>

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${billingUrl}" style="display: inline-block; padding: 14px 32px; background-color: ***REMOVED***18181b; color: ***REMOVED***ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      Subscribe Now
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${generateEmailFooter(unsubscribeUrl, organization.name)}`;
}

// =============================================================================
// Send Function
// =============================================================================

/**
 * Send trial reminder email to all admins/owners of an organization
 */
export async function sendTrialReminderEmail(
  organization: Organization,
  daysRemaining: number,
): Promise<void> {
  if (!organization.emailNotificationsEnabled) return;

  // Find admin/owner users for this org via UserOrganization
  const userOrgRepo = AppDataSource.getRepository(UserOrganization);
  const adminMemberships = await userOrgRepo.find({
    where: {
      orgId: organization.id,
      role: In(["admin", "owner"]),
    },
    relations: ["user"],
  });

  const fromAddress = organization.emailFromAddress || EMAIL_CONFIG.sourceEmail;

  const isExpired = daysRemaining <= 0;
  const subject = isExpired
    ? "Your WorkerMill Pro trial has ended"
    : `Your WorkerMill Pro trial ends in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`;

  for (const membership of adminMemberships) {
    const user = membership.user;
    if (!user?.email) continue;

    try {
      if (await isRateLimited(user.id)) {
        logger.warn("Email rate limit exceeded for trial reminder", {
          userId: user.id,
        });
        continue;
      }

      const unsubscribeToken = generateUnsubscribeToken(user.id, "billing");
      const unsubscribeUrl = `${EMAIL_CONFIG.baseUrl}/api/email/unsubscribe?token=${unsubscribeToken}`;

      const htmlBody = generateTrialReminderHtml(
        organization,
        daysRemaining,
        unsubscribeUrl,
      );

      const client = getSESClient();
      const command = new SendEmailCommand({
        Source: fromAddress,
        Destination: { ToAddresses: [user.email] },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Html: { Data: htmlBody, Charset: "UTF-8" } },
        },
      });

      const response = await client.send(command);

      await logEmailSend(
        organization.id,
        user.id,
        user.email,
        "cost_alert", // Reusing existing type for billing-related emails
        subject,
        response.MessageId || null,
        "sent",
        null,
        {
          type: "trial_reminder",
          daysRemaining,
          unsubscribeToken,
        },
      );

      logger.info("Trial reminder email sent", {
        userId: user.id,
        orgId: organization.id,
        daysRemaining,
        messageId: response.MessageId,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error("Failed to send trial reminder email", {
        error: errorMessage,
        userId: user.id,
        orgId: organization.id,
        daysRemaining,
      });
    }
  }
}
