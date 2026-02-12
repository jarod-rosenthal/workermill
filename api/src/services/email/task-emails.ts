/**
 * Email Service - Task Notification Templates + Send
 */

import { SendEmailCommand } from "@aws-sdk/client-ses";
import { logger } from "../../utils/logger.js";
import type { Organization } from "../../models/Organization.js";
import type { User } from "../../models/User.js";
import { WorkerTask } from "../../models/WorkerTask.js";
import {
  getSESClient,
  EMAIL_CONFIG,
  formatTaskStatus,
  getStatusBadgeStyle,
  generateWorkersHtml,
  generateEmailFooter,
  getTaskPersonasAsync,
} from "./helpers.js";
import { generateUnsubscribeToken } from "./unsubscribe.js";
import { isRateLimited, logEmailSend } from "./rate-limit.js";

// =============================================================================
// Types
// =============================================================================

interface NotificationEmailParams {
  user: User;
  organization: Organization;
  unsubscribeUrl: string;
}

interface TaskNotificationParams extends NotificationEmailParams {
  task: WorkerTask;
  /** Pre-fetched personas from async getTaskPersonasAsync */
  personas?: string[];
}

interface CostAlertParams extends NotificationEmailParams {
  currentCost: number;
  threshold: number;
}

interface PrCreatedParams extends NotificationEmailParams {
  task: WorkerTask;
  prUrl: string;
}

// =============================================================================
// HTML Generators
// =============================================================================

/**
 * Generate task completed email HTML
 */
function generateTaskCompletedEmailHtml(params: TaskNotificationParams): string {
  const { user, organization, task, unsubscribeUrl, personas } = params;
  const dashboardUrl = `${EMAIL_CONFIG.baseUrl}/dashboard`;
  const statusLabel = formatTaskStatus(task.status);
  const badgeStyle = getStatusBadgeStyle(task.status);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${statusLabel}: ${task.jiraIssueKey}</title>
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
                <div style="display: inline-block; background-color: ${badgeStyle.bg}; color: ${badgeStyle.text}; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  ${statusLabel}
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: #18181b; line-height: 1.3; text-align: center;">
                ${task.jiraIssueKey}: ${task.summary || statusLabel}
              </h1>

              <table role="presentation" style="width: 100%; margin: 24px 0; background-color: #f4f4f5; border-radius: 6px;">
                <tr>
                  <td style="padding: 12px 16px; border-right: 1px solid #e4e4e7; vertical-align: top;">
                    ${generateWorkersHtml(task, personas)}
                  </td>
                  <td style="padding: 12px 16px; border-right: 1px solid #e4e4e7; vertical-align: top;">
                    <div style="font-size: 12px; color: #71717a; text-transform: uppercase;">Duration</div>
                    <div style="font-size: 14px; font-weight: 600; color: #18181b;">${task.ecsTaskSeconds ? Math.round(task.ecsTaskSeconds / 60) + "m" : "N/A"}</div>
                  </td>
                  <td style="padding: 12px 16px; border-right: 1px solid #e4e4e7; vertical-align: top;">
                    <div style="font-size: 12px; color: #71717a; text-transform: uppercase;">Cost</div>
                    <div style="font-size: 14px; font-weight: 600; color: #18181b;">$${task.estimatedCostUsd?.toFixed(2) || "0.00"}</div>
                  </td>
                  <td style="padding: 12px 16px; vertical-align: top;">
                    <div style="font-size: 12px; color: #71717a; text-transform: uppercase;">Quality</div>
                    <div style="font-size: 14px; font-weight: 600; color: ${task.qualityScore != null ? (task.qualityScore >= 90 ? '#10b981' : task.qualityScore >= 70 ? '#eab308' : task.qualityScore >= 50 ? '#f97316' : '#ef4444') : '#71717a'};">${task.qualityScore != null ? task.qualityScore + '%' : 'N/A'}</div>
                  </td>
                </tr>
              </table>

              ${task.qualityScore != null ? `
              <table role="presentation" style="width: 100%; margin-bottom: 24px; border: 1px solid #e4e4e7; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px; background-color: #fafafa;">
                    <div style="font-size: 14px; font-weight: 600; color: #18181b; margin-bottom: 12px;">Quality Breakdown</div>
                    <table role="presentation" style="width: 100%;">
                      <tr>
                        <td style="padding: 4px 8px; font-size: 13px;">
                          ${task.typeErrors === 0 ? '✅' : '❌'} TypeCheck
                          <span style="color: #71717a; margin-left: 4px;">${task.typeErrors === 0 ? 'Pass' : task.typeErrors + ' errors'}</span>
                        </td>
                        <td style="padding: 4px 8px; font-size: 13px;">
                          ${task.lintErrors === 0 ? '✅' : '⚠️'} Lint
                          <span style="color: #71717a; margin-left: 4px;">${task.lintErrors === 0 ? 'Pass' : task.lintErrors + ' errors'}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 4px 8px; font-size: 13px;">
                          ${task.testsFailed === 0 ? '✅' : '❌'} Tests
                          <span style="color: #71717a; margin-left: 4px;">${task.testsFailed === 0 ? (task.testsPassed ? task.testsPassed + ' passed' : 'Pass') : task.testsFailed + ' failed'}</span>
                        </td>
                        <td style="padding: 4px 8px; font-size: 13px;">
                          ${task.securityHigh === 0 ? '✅' : '🔴'} Security
                          <span style="color: #71717a; margin-left: 4px;">${task.securityHigh === 0 ? 'Clean' : task.securityHigh + ' high'}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              ` : ""}

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
  const { user, organization, task, unsubscribeUrl, personas } = params;
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
                  <td style="padding: 12px 16px; border-right: 1px solid #e4e4e7; vertical-align: top;">
                    ${generateWorkersHtml(task, personas)}
                  </td>
                  <td style="padding: 12px 16px; border-right: 1px solid #e4e4e7; vertical-align: top;">
                    <div style="font-size: 12px; color: #71717a; text-transform: uppercase;">Duration</div>
                    <div style="font-size: 14px; font-weight: 600; color: #18181b;">${task.ecsTaskSeconds ? Math.round(task.ecsTaskSeconds / 60) + "m" : "N/A"}</div>
                  </td>
                  <td style="padding: 12px 16px; vertical-align: top;">
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

  // Fetch all expert personas for this task (including from child tasks for Epic mode)
  const personas = await getTaskPersonasAsync(task);

  const statusLabel = formatTaskStatus(task.status);
  const subject = `${statusLabel}: ${task.jiraIssueKey}`;
  const htmlBody = generateTaskCompletedEmailHtml({
    user,
    organization,
    task,
    unsubscribeUrl,
    personas,
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

  // Fetch all expert personas for this task (including from child tasks for Epic mode)
  const personas = await getTaskPersonasAsync(task);

  const subject = `Task Failed: ${task.jiraIssueKey}`;
  const htmlBody = generateTaskFailedEmailHtml({
    user,
    organization,
    task,
    unsubscribeUrl,
    personas,
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
