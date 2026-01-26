/**
 * WorkerMill Email Service
 *
 * Handles transactional emails via AWS SES for team invites and notifications.
 */

import crypto from "crypto";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { AppDataSource } from "../db/connection.js";
import { EmailLog, type EmailType, type EmailMetadata } from "../models/EmailLog.js";
import type { OrgInvite } from "../models/OrgInvite.js";
import type { Organization } from "../models/Organization.js";
import type { User } from "../models/User.js";
import type { WorkerTask } from "../models/WorkerTask.js";

// SES client (lazy initialized)
let sesClient: SESClient | null = null;

function getSESClient(): SESClient {
  if (!sesClient) {
    sesClient = new SESClient({ region: config.aws.region });
  }
  return sesClient;
}

// Email configuration
const EMAIL_CONFIG = {
  sourceEmail: process.env.SES_SOURCE_EMAIL || "noreply@workermill.com",
  baseUrl: process.env.API_BASE_URL || "https://workermill.com",
};

/**
 * Format a role name for display
 */
function formatRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Format expiration date for display
 */
function formatExpirationDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Generate HTML email template for organization invite
 */
function generateInviteEmailHtml(
  invite: OrgInvite,
  organization: Organization
): string {
  const acceptUrl = `${EMAIL_CONFIG.baseUrl}/invites/${invite.token}`;
  const expirationDate = formatExpirationDate(invite.expiresAt);
  const roleName = formatRole(invite.role);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You've been invited to join ${organization.name} on WorkerMill</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #e4e4e7;">
              <div style="font-size: 28px; font-weight: 700; color: #18181b; letter-spacing: -0.5px;">
                WorkerMill
              </div>
              <div style="font-size: 14px; color: #71717a; margin-top: 4px;">
                Mission Control for AI Workers
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: #18181b; line-height: 1.3;">
                You've been invited to join ${organization.name}
              </h1>

              <p style="margin: 0 0 24px; font-size: 16px; color: #3f3f46; line-height: 1.6;">
                You've been invited to collaborate on <strong>${organization.name}</strong> as a <strong>${roleName}</strong>. Accept this invitation to start working with the team's AI-powered development workflow.
              </p>

              <!-- Role Badge -->
              <table role="presentation" style="width: 100%; margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #f4f4f5; border-radius: 6px; padding: 16px;">
                    <table role="presentation" style="width: 100%;">
                      <tr>
                        <td style="width: 50%; padding-right: 8px;">
                          <div style="font-size: 12px; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Organization</div>
                          <div style="font-size: 16px; font-weight: 600; color: #18181b;">${organization.name}</div>
                        </td>
                        <td style="width: 50%; padding-left: 8px;">
                          <div style="font-size: 12px; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Your Role</div>
                          <div style="font-size: 16px; font-weight: 600; color: #18181b;">${roleName}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; margin-bottom: 24px;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${acceptUrl}" style="display: inline-block; padding: 14px 32px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Expiration Warning -->
              <table role="presentation" style="width: 100%; margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 0 6px 6px 0; padding: 12px 16px;">
                    <div style="font-size: 14px; color: #92400e;">
                      <strong>This invitation expires on ${expirationDate}</strong> (7 days from when it was sent).
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Alternative Link -->
              <p style="margin: 0; font-size: 14px; color: #71717a; line-height: 1.6;">
                If the button above doesn't work, copy and paste this URL into your browser:
              </p>
              <p style="margin: 8px 0 0; font-size: 14px; color: #3b82f6; word-break: break-all;">
                <a href="${acceptUrl}" style="color: #3b82f6; text-decoration: underline;">${acceptUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #fafafa; border-top: 1px solid #e4e4e7; border-radius: 0 0 8px 8px;">
              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <p style="margin: 0 0 8px; font-size: 14px; color: #71717a;">
                      <strong>WorkerMill</strong> - htop for AI workers
                    </p>
                    <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
                      Real-time monitoring and orchestration for autonomous AI coding agents.
                    </p>
                    <p style="margin: 16px 0 0; font-size: 12px; color: #a1a1aa;">
                      If you didn't expect this invitation, you can safely ignore this email.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

/**
 * Generate plain text email for organization invite (fallback)
 */
function generateInviteEmailText(
  invite: OrgInvite,
  organization: Organization
): string {
  const acceptUrl = `${EMAIL_CONFIG.baseUrl}/invites/${invite.token}`;
  const expirationDate = formatExpirationDate(invite.expiresAt);
  const roleName = formatRole(invite.role);

  return `
You've been invited to join ${organization.name} on WorkerMill

You've been invited to collaborate on ${organization.name} as a ${roleName}. Accept this invitation to start working with the team's AI-powered development workflow.

Organization: ${organization.name}
Your Role: ${roleName}

Accept your invitation:
${acceptUrl}

IMPORTANT: This invitation expires on ${expirationDate} (7 days from when it was sent).

---

WorkerMill - htop for AI workers
Real-time monitoring and orchestration for autonomous AI coding agents.

If you didn't expect this invitation, you can safely ignore this email.
`.trim();
}

/**
 * Send an organization invite email
 *
 * @param invite - The OrgInvite entity
 * @param organization - The Organization entity
 * @returns true if email was sent successfully, false otherwise
 */
export async function sendInviteEmail(
  invite: OrgInvite,
  organization: Organization
): Promise<boolean> {
  const client = getSESClient();

  const subject = `You've been invited to join ${organization.name} on WorkerMill`;
  const htmlBody = generateInviteEmailHtml(invite, organization);
  const textBody = generateInviteEmailText(invite, organization);

  try {
    const command = new SendEmailCommand({
      Source: EMAIL_CONFIG.sourceEmail,
      Destination: {
        ToAddresses: [invite.email],
      },
      Message: {
        Subject: {
          Data: subject,
          Charset: "UTF-8",
        },
        Body: {
          Html: {
            Data: htmlBody,
            Charset: "UTF-8",
          },
          Text: {
            Data: textBody,
            Charset: "UTF-8",
          },
        },
      },
    });

    const response = await client.send(command);

    logger.info("Invite email sent successfully", {
      messageId: response.MessageId,
      email: invite.email,
      orgId: organization.id,
      orgName: organization.name,
      inviteId: invite.id,
    });

    return true;
  } catch (error) {
    logger.error("Failed to send invite email", {
      error: error instanceof Error ? error.message : String(error),
      email: invite.email,
      orgId: organization.id,
      orgName: organization.name,
      inviteId: invite.id,
    });

    return false;
  }
}

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

// =============================================================================
// Unsubscribe Token Generation
// =============================================================================

const UNSUBSCRIBE_SECRET = process.env.EMAIL_UNSUBSCRIBE_SECRET || "workermill-unsubscribe-secret";

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
    .createHmac("sha256", UNSUBSCRIBE_SECRET)
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
      .createHmac("sha256", UNSUBSCRIBE_SECRET)
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

// =============================================================================
// Email Rate Limiting
// =============================================================================

// Rate limit: 50 emails per user per day
const EMAIL_RATE_LIMIT = 50;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Check if user has exceeded email rate limit
 */
async function isRateLimited(userId: string): Promise<boolean> {
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

// =============================================================================
// Email Logging
// =============================================================================

/**
 * Log an email send attempt to the database
 */
async function logEmailSend(
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

// =============================================================================
// Notification Email Templates
// =============================================================================

interface NotificationEmailParams {
  user: User;
  organization: Organization;
  unsubscribeUrl: string;
}

interface TaskNotificationParams extends NotificationEmailParams {
  task: WorkerTask;
}

interface CostAlertParams extends NotificationEmailParams {
  currentCost: number;
  threshold: number;
}

interface PrCreatedParams extends NotificationEmailParams {
  task: WorkerTask;
  prUrl: string;
}

/**
 * Generate email footer with unsubscribe link
 */
function generateEmailFooter(unsubscribeUrl: string, orgName: string): string {
  return `
            <!-- Footer -->
            <tr>
              <td style="padding: 24px 40px; background-color: #fafafa; border-top: 1px solid #e4e4e7; border-radius: 0 0 8px 8px;">
                <table role="presentation" style="width: 100%;">
                  <tr>
                    <td style="text-align: center;">
                      <p style="margin: 0 0 8px; font-size: 14px; color: #71717a;">
                        <strong>WorkerMill</strong> - htop for AI workers
                      </p>
                      <p style="margin: 0 0 16px; font-size: 12px; color: #a1a1aa;">
                        This email was sent to you as a member of ${orgName}.
                      </p>
                      <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
                        <a href="${unsubscribeUrl}" style="color: #71717a; text-decoration: underline;">Unsubscribe from these notifications</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Generate task completed email HTML
 */
function generateTaskCompletedEmailHtml(params: TaskNotificationParams): string {
  const { user, organization, task, unsubscribeUrl } = params;
  const dashboardUrl = `${EMAIL_CONFIG.baseUrl}/dashboard`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Task Completed: ${task.jiraIssueKey}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #e4e4e7;">
              <div style="font-size: 28px; font-weight: 700; color: #18181b; letter-spacing: -0.5px;">
                WorkerMill
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; background-color: #dcfce7; color: #166534; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Task Completed
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: #18181b; line-height: 1.3; text-align: center;">
                ${task.jiraIssueKey}: ${task.summary || "Task completed"}
              </h1>

              <table role="presentation" style="width: 100%; margin: 24px 0; background-color: #f4f4f5; border-radius: 6px;">
                <tr>
                  <td style="padding: 12px 16px; border-right: 1px solid #e4e4e7;">
                    <div style="font-size: 12px; color: #71717a; text-transform: uppercase;">Worker</div>
                    <div style="font-size: 14px; font-weight: 600; color: #18181b;">${task.workerPersona?.replace(/_/g, " ") || "AI Worker"}</div>
                  </td>
                  <td style="padding: 12px 16px; border-right: 1px solid #e4e4e7;">
                    <div style="font-size: 12px; color: #71717a; text-transform: uppercase;">Duration</div>
                    <div style="font-size: 14px; font-weight: 600; color: #18181b;">${task.ecsTaskSeconds ? Math.round(task.ecsTaskSeconds / 60) + "m" : "N/A"}</div>
                  </td>
                  <td style="padding: 12px 16px;">
                    <div style="font-size: 12px; color: #71717a; text-transform: uppercase;">Cost</div>
                    <div style="font-size: 14px; font-weight: 600; color: #18181b;">$${task.estimatedCostUsd?.toFixed(2) || "0.00"}</div>
                  </td>
                </tr>
              </table>

              ${task.githubPrUrl ? `
              <table role="presentation" style="width: 100%; margin-bottom: 24px;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${task.githubPrUrl}" style="display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; border-radius: 6px;">
                      Review Pull Request
                    </a>
                  </td>
                </tr>
              </table>
              ` : ""}

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${dashboardUrl}" style="display: inline-block; padding: 14px 32px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      View Dashboard
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${generateEmailFooter(unsubscribeUrl, organization.name)}`;
}

/**
 * Generate task failed email HTML
 */
function generateTaskFailedEmailHtml(params: TaskNotificationParams): string {
  const { user, organization, task, unsubscribeUrl } = params;
  const dashboardUrl = `${EMAIL_CONFIG.baseUrl}/dashboard`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Task Failed: ${task.jiraIssueKey}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #e4e4e7;">
              <div style="font-size: 28px; font-weight: 700; color: #18181b; letter-spacing: -0.5px;">
                WorkerMill
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; background-color: #fee2e2; color: #991b1b; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Task Failed
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: #18181b; line-height: 1.3; text-align: center;">
                ${task.jiraIssueKey}: ${task.summary || "Task failed"}
              </h1>

              <table role="presentation" style="width: 100%; margin: 24px 0; background-color: #f4f4f5; border-radius: 6px;">
                <tr>
                  <td style="padding: 12px 16px; border-right: 1px solid #e4e4e7;">
                    <div style="font-size: 12px; color: #71717a; text-transform: uppercase;">Worker</div>
                    <div style="font-size: 14px; font-weight: 600; color: #18181b;">${task.workerPersona?.replace(/_/g, " ") || "AI Worker"}</div>
                  </td>
                  <td style="padding: 12px 16px; border-right: 1px solid #e4e4e7;">
                    <div style="font-size: 12px; color: #71717a; text-transform: uppercase;">Duration</div>
                    <div style="font-size: 14px; font-weight: 600; color: #18181b;">${task.ecsTaskSeconds ? Math.round(task.ecsTaskSeconds / 60) + "m" : "N/A"}</div>
                  </td>
                  <td style="padding: 12px 16px;">
                    <div style="font-size: 12px; color: #71717a; text-transform: uppercase;">Cost</div>
                    <div style="font-size: 14px; font-weight: 600; color: #18181b;">$${task.estimatedCostUsd?.toFixed(2) || "0.00"}</div>
                  </td>
                </tr>
              </table>

              ${task.errorMessage ? `
              <div style="margin: 0 0 24px; background-color: #fef2f2; border-left: 4px solid #ef4444; border-radius: 0 6px 6px 0; padding: 16px;">
                <div style="font-size: 12px; color: #991b1b; text-transform: uppercase; margin-bottom: 8px;">Error</div>
                <div style="font-size: 14px; color: #7f1d1d; font-family: monospace; white-space: pre-wrap;">${task.errorMessage.substring(0, 500)}${task.errorMessage.length > 500 ? "..." : ""}</div>
              </div>
              ` : ""}

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${dashboardUrl}" style="display: inline-block; padding: 14px 32px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      View Dashboard
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${generateEmailFooter(unsubscribeUrl, organization.name)}`;
}

/**
 * Generate cost alert email HTML
 */
function generateCostAlertEmailHtml(params: CostAlertParams): string {
  const { user, organization, currentCost, threshold, unsubscribeUrl } = params;
  const settingsUrl = `${EMAIL_CONFIG.baseUrl}/settings`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cost Alert: Threshold Exceeded</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #e4e4e7;">
              <div style="font-size: 28px; font-weight: 700; color: #18181b; letter-spacing: -0.5px;">
                WorkerMill
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; background-color: #fef3c7; color: #92400e; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Cost Alert
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: #18181b; line-height: 1.3; text-align: center;">
                Monthly spending has exceeded your threshold
              </h1>

              <table role="presentation" style="width: 100%; margin: 24px 0; background-color: #f4f4f5; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px; text-align: center; border-right: 1px solid #e4e4e7;">
                    <div style="font-size: 12px; color: #71717a; text-transform: uppercase;">Current Spend</div>
                    <div style="font-size: 28px; font-weight: 700; color: #18181b;">$${currentCost.toFixed(2)}</div>
                  </td>
                  <td style="padding: 16px; text-align: center;">
                    <div style="font-size: 12px; color: #71717a; text-transform: uppercase;">Threshold</div>
                    <div style="font-size: 28px; font-weight: 700; color: #71717a;">$${threshold.toFixed(2)}</div>
                  </td>
                </tr>
              </table>

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${settingsUrl}" style="display: inline-block; padding: 14px 32px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      Manage Settings
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${generateEmailFooter(unsubscribeUrl, organization.name)}`;
}

/**
 * Generate PR created email HTML
 */
function generatePrCreatedEmailHtml(params: PrCreatedParams): string {
  const { user, organization, task, prUrl, unsubscribeUrl } = params;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PR Created: ${task.jiraIssueKey}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #e4e4e7;">
              <div style="font-size: 28px; font-weight: 700; color: #18181b; letter-spacing: -0.5px;">
                WorkerMill
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; background-color: #dbeafe; color: #1e40af; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Pull Request Created
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: #18181b; line-height: 1.3; text-align: center;">
                ${task.jiraIssueKey}: ${task.summary || "New PR ready for review"}
              </h1>

              <p style="margin: 0 0 24px; font-size: 16px; color: #3f3f46; line-height: 1.6; text-align: center;">
                A worker has created a pull request for this task. Please review the changes.
              </p>

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${prUrl}" style="display: inline-block; padding: 14px 32px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      Review Pull Request
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${generateEmailFooter(unsubscribeUrl, organization.name)}`;
}

// =============================================================================
// Email Send Functions
// =============================================================================

/**
 * Check if user wants to receive a specific notification type
 */
function userWantsNotification(
  user: User,
  notificationType: "taskCompleted" | "taskFailed" | "costAlerts" | "prCreated" | "quotaWarning"
): boolean {
  const prefs = user.preferences?.email;
  if (!prefs) return true; // Default to sending if no preferences set

  const value = prefs[notificationType];
  return value !== false; // Default to true if undefined
}

/**
 * Send task completed notification email
 */
export async function sendTaskCompletedEmail(
  task: WorkerTask,
  user: User,
  organization: Organization
): Promise<boolean> {
  if (!organization.emailNotificationsEnabled) return false;
  if (!userWantsNotification(user, "taskCompleted")) return false;

  const unsubscribeToken = generateUnsubscribeToken(user.id, "taskCompleted");
  const unsubscribeUrl = `${EMAIL_CONFIG.baseUrl}/api/email/unsubscribe?token=${unsubscribeToken}`;

  const subject = `Task Completed: ${task.jiraIssueKey}`;
  const htmlBody = generateTaskCompletedEmailHtml({
    user,
    organization,
    task,
    unsubscribeUrl,
  });

  const fromAddress = organization.emailFromAddress || EMAIL_CONFIG.sourceEmail;

  try {
    // Check rate limit
    if (await isRateLimited(user.id)) {
      logger.warn("Email rate limit exceeded", { userId: user.id });
      return false;
    }

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
      "task_completed",
      subject,
      response.MessageId || null,
      "sent",
      null,
      { taskId: task.id, jiraIssueKey: task.jiraIssueKey || undefined, unsubscribeToken }
    );

    logger.info("Task completed email sent", {
      taskId: task.id,
      userId: user.id,
      messageId: response.MessageId,
    });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await logEmailSend(
      organization.id,
      user.id,
      user.email,
      "task_completed",
      subject,
      null,
      "failed",
      errorMessage,
      { taskId: task.id, jiraIssueKey: task.jiraIssueKey || undefined }
    );

    logger.error("Failed to send task completed email", {
      error: errorMessage,
      taskId: task.id,
      userId: user.id,
    });

    return false;
  }
}

/**
 * Send task failed notification email
 */
export async function sendTaskFailedEmail(
  task: WorkerTask,
  user: User,
  organization: Organization
): Promise<boolean> {
  if (!organization.emailNotificationsEnabled) return false;
  if (!userWantsNotification(user, "taskFailed")) return false;

  const unsubscribeToken = generateUnsubscribeToken(user.id, "taskFailed");
  const unsubscribeUrl = `${EMAIL_CONFIG.baseUrl}/api/email/unsubscribe?token=${unsubscribeToken}`;

  const subject = `Task Failed: ${task.jiraIssueKey}`;
  const htmlBody = generateTaskFailedEmailHtml({
    user,
    organization,
    task,
    unsubscribeUrl,
  });

  const fromAddress = organization.emailFromAddress || EMAIL_CONFIG.sourceEmail;

  try {
    if (await isRateLimited(user.id)) {
      logger.warn("Email rate limit exceeded", { userId: user.id });
      return false;
    }

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
      "task_failed",
      subject,
      response.MessageId || null,
      "sent",
      null,
      { taskId: task.id, jiraIssueKey: task.jiraIssueKey || undefined, unsubscribeToken }
    );

    logger.info("Task failed email sent", {
      taskId: task.id,
      userId: user.id,
      messageId: response.MessageId,
    });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await logEmailSend(
      organization.id,
      user.id,
      user.email,
      "task_failed",
      subject,
      null,
      "failed",
      errorMessage,
      { taskId: task.id, jiraIssueKey: task.jiraIssueKey || undefined }
    );

    logger.error("Failed to send task failed email", {
      error: errorMessage,
      taskId: task.id,
      userId: user.id,
    });

    return false;
  }
}

/**
 * Send cost alert notification email
 */
export async function sendCostAlertEmail(
  user: User,
  organization: Organization,
  currentCost: number,
  threshold: number
): Promise<boolean> {
  if (!organization.emailNotificationsEnabled) return false;
  if (!userWantsNotification(user, "costAlerts")) return false;

  const unsubscribeToken = generateUnsubscribeToken(user.id, "costAlerts");
  const unsubscribeUrl = `${EMAIL_CONFIG.baseUrl}/api/email/unsubscribe?token=${unsubscribeToken}`;

  const subject = `Cost Alert: Monthly spending exceeded $${threshold.toFixed(2)}`;
  const htmlBody = generateCostAlertEmailHtml({
    user,
    organization,
    currentCost,
    threshold,
    unsubscribeUrl,
  });

  const fromAddress = organization.emailFromAddress || EMAIL_CONFIG.sourceEmail;

  try {
    if (await isRateLimited(user.id)) {
      logger.warn("Email rate limit exceeded", { userId: user.id });
      return false;
    }

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
      "cost_alert",
      subject,
      response.MessageId || null,
      "sent",
      null,
      { threshold, currentCost, unsubscribeToken }
    );

    logger.info("Cost alert email sent", {
      userId: user.id,
      currentCost,
      threshold,
      messageId: response.MessageId,
    });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await logEmailSend(
      organization.id,
      user.id,
      user.email,
      "cost_alert",
      subject,
      null,
      "failed",
      errorMessage,
      { threshold, currentCost }
    );

    logger.error("Failed to send cost alert email", {
      error: errorMessage,
      userId: user.id,
    });

    return false;
  }
}

/**
 * Send PR created notification email
 */
export async function sendPrCreatedEmail(
  task: WorkerTask,
  user: User,
  organization: Organization,
  prUrl: string
): Promise<boolean> {
  if (!organization.emailNotificationsEnabled) return false;
  if (!userWantsNotification(user, "prCreated")) return false;

  const unsubscribeToken = generateUnsubscribeToken(user.id, "prCreated");
  const unsubscribeUrl = `${EMAIL_CONFIG.baseUrl}/api/email/unsubscribe?token=${unsubscribeToken}`;

  const subject = `PR Created: ${task.jiraIssueKey}`;
  const htmlBody = generatePrCreatedEmailHtml({
    user,
    organization,
    task,
    prUrl,
    unsubscribeUrl,
  });

  const fromAddress = organization.emailFromAddress || EMAIL_CONFIG.sourceEmail;

  try {
    if (await isRateLimited(user.id)) {
      logger.warn("Email rate limit exceeded", { userId: user.id });
      return false;
    }

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
      "pr_created",
      subject,
      response.MessageId || null,
      "sent",
      null,
      { taskId: task.id, jiraIssueKey: task.jiraIssueKey || undefined, prUrl, unsubscribeToken }
    );

    logger.info("PR created email sent", {
      taskId: task.id,
      userId: user.id,
      prUrl,
      messageId: response.MessageId,
    });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await logEmailSend(
      organization.id,
      user.id,
      user.email,
      "pr_created",
      subject,
      null,
      "failed",
      errorMessage,
      { taskId: task.id, jiraIssueKey: task.jiraIssueKey || undefined, prUrl }
    );

    logger.error("Failed to send PR created email", {
      error: errorMessage,
      taskId: task.id,
      userId: user.id,
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
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #e4e4e7;">
              <div style="font-size: 28px; font-weight: 700; color: #18181b; letter-spacing: -0.5px;">
                WorkerMill
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; background-color: #dbeafe; color: #1e40af; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Test Email
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: #18181b; line-height: 1.3; text-align: center;">
                Email Notifications Working
              </h1>

              <p style="margin: 0 0 24px; font-size: 16px; color: #3f3f46; line-height: 1.6; text-align: center;">
                This is a test email from WorkerMill. If you received this, your email notifications are configured correctly.
              </p>

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${dashboardUrl}" style="display: inline-block; padding: 14px 32px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
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
