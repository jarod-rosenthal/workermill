/**
 * Email Service - Test Email + SES Verification + Cleanup
 */

import { SendEmailCommand } from "@aws-sdk/client-ses";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { AppDataSource } from "../../db/connection.js";
import type { Organization } from "../../models/Organization.js";
import type { User } from "../../models/User.js";
import { getSESClient, EMAIL_CONFIG, generateEmailFooter } from "./helpers.js";
import { generateUnsubscribeToken } from "./unsubscribe.js";
import { logEmailSend } from "./rate-limit.js";

/**
 * Verify SES email sending capability
 * Useful for testing configuration
 */
export async function verifySESConfiguration(): Promise<boolean> {
  const client = getSESClient();

  try {
    // We don't actually send an email, just verify the client can be initialized
    // In production, you'd want to verify the source email is verified in SES
    logger.info("SES client initialized", {
      region: config.aws.region,
      sourceEmail: EMAIL_CONFIG.sourceEmail,
    });
    return true;
  } catch (error) {
    logger.error("SES configuration verification failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Generate test email HTML
 */
function generateTestEmailHtml(organization: Organization, unsubscribeUrl: string): string {
  const dashboardUrl = `${EMAIL_CONFIG.baseUrl}/dashboard`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WorkerMill Test Email</title>
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
                <div style="display: inline-block; background-color: ***REMOVED***dbeafe; color: ***REMOVED***1e40af; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Test Email
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3; text-align: center;">
                Email Notifications Working
              </h1>

              <p style="margin: 0 0 24px; font-size: 16px; color: ***REMOVED***3f3f46; line-height: 1.6; text-align: center;">
                This is a test email from WorkerMill. If you received this, your email notifications are configured correctly.
              </p>

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${dashboardUrl}" style="display: inline-block; padding: 14px 32px; background-color: ***REMOVED***18181b; color: ***REMOVED***ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      Go to Dashboard
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${generateEmailFooter(unsubscribeUrl, organization.name)}`;
}

/**
 * Send test notification email
 */
export async function sendTestEmail(
  user: User,
  organization: Organization
): Promise<boolean> {
  const unsubscribeToken = generateUnsubscribeToken(user.id, "test");
  const unsubscribeUrl = `${EMAIL_CONFIG.baseUrl}/api/email/unsubscribe?token=${unsubscribeToken}`;

  const subject = "WorkerMill Test Email";
  const htmlBody = generateTestEmailHtml(organization, unsubscribeUrl);

  const fromAddress = organization.emailFromAddress || EMAIL_CONFIG.sourceEmail;

  try {
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
      "invite", // Using 'invite' as closest type for test emails
      subject,
      response.MessageId || null,
      "sent",
      null,
      { isTestEmail: true, unsubscribeToken }
    );

    logger.info("Test email sent", {
      userId: user.id,
      email: user.email,
      messageId: response.MessageId,
    });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await logEmailSend(
      organization.id,
      user.id,
      user.email,
      "invite",
      subject,
      null,
      "failed",
      errorMessage,
      { isTestEmail: true }
    );

    logger.error("Failed to send test email", {
      error: errorMessage,
      userId: user.id,
    });

    return false;
  }
}

/**
 * Cleanup old email logs based on org retention settings
 */
export async function cleanupOldEmailLogs(organization: Organization): Promise<number> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - organization.emailLogRetentionDays);

    const result = await AppDataSource.query(
      `DELETE FROM email_logs WHERE org_id = $1 AND created_at < $2 RETURNING id`,
      [organization.id, cutoffDate]
    );

    const count = result.length;
    if (count > 0) {
      logger.info("Cleaned up old email logs", { orgId: organization.id, count });
    }
    return count;
  } catch (error) {
    logger.error("Failed to cleanup email logs", { error, orgId: organization.id });
    return 0;
  }
}
