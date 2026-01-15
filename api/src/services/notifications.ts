/**
 * WorkerMill Notifications Service
 *
 * Handles Slack webhook notifications for task events.
 */

import { AppDataSource } from "../db/connection.js";
import { Organization } from "../models/Organization.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { logger } from "../utils/logger.js";

interface SlackMessage {
  text: string;
  blocks?: SlackBlock[];
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: { type: string; text: string }[];
  accessory?: { type: string; text: { type: string; text: string }; url: string };
}

/**
 * Send a Slack notification to an organization's webhook
 */
async function sendSlackNotification(
  webhookUrl: string,
  message: SlackMessage
): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      logger.error("Slack webhook failed", {
        status: response.status,
        statusText: response.statusText,
      });
      return false;
    }

    return true;
  } catch (error) {
    logger.error("Failed to send Slack notification", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Notify when a task is completed successfully
 */
export async function notifyTaskCompleted(task: WorkerTask): Promise<void> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: task.orgId } });

  if (!org?.slackWebhookUrl) return;

  const message: SlackMessage = {
    text: `Task completed: ${task.jiraIssueKey}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Task Completed", emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Ticket:*\n${task.jiraIssueKey}` },
          { type: "mrkdwn", text: `*Status:*\n${task.status}` },
          { type: "mrkdwn", text: `*Worker:*\n${task.workerPersona}` },
          {
            type: "mrkdwn",
            text: `*Duration:*\n${task.ecsTaskSeconds ? `${Math.round(task.ecsTaskSeconds / 60)}m` : "N/A"}`,
          },
        ],
      },
    ],
  };

  if (task.githubPrUrl) {
    message.blocks!.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Pull Request:* <${task.githubPrUrl}|View PR>` },
    });
  }

  await sendSlackNotification(org.slackWebhookUrl, message);
  logger.info("Sent task completed notification", { taskId: task.id, orgId: org.id });
}

/**
 * Notify when a task fails
 */
export async function notifyTaskFailed(task: WorkerTask): Promise<void> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: task.orgId } });

  if (!org?.slackWebhookUrl) return;

  const message: SlackMessage = {
    text: `Task failed: ${task.jiraIssueKey}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Task Failed", emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Ticket:*\n${task.jiraIssueKey}` },
          { type: "mrkdwn", text: `*Worker:*\n${task.workerPersona}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Error:*\n\`\`\`${task.errorMessage || "Unknown error"}\`\`\``,
        },
      },
    ],
  };

  await sendSlackNotification(org.slackWebhookUrl, message);
  logger.info("Sent task failed notification", { taskId: task.id, orgId: org.id });
}

/**
 * Notify when cost threshold is exceeded
 */
export async function notifyCostAlert(
  orgId: string,
  currentCost: number,
  threshold: number
): Promise<void> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: orgId } });

  if (!org?.slackWebhookUrl) return;

  const message: SlackMessage = {
    text: `Cost alert: Monthly spending exceeded $${threshold}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Cost Alert", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Monthly spending has exceeded your alert threshold.\n\n*Current:* $${currentCost.toFixed(2)}\n*Threshold:* $${threshold.toFixed(2)}`,
        },
      },
    ],
  };

  await sendSlackNotification(org.slackWebhookUrl, message);
  logger.info("Sent cost alert notification", { orgId, currentCost, threshold });
}

/**
 * Notify when quota is nearly exhausted
 */
export async function notifyQuotaWarning(
  orgId: string,
  used: number,
  quota: number
): Promise<void> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: orgId } });

  if (!org?.slackWebhookUrl) return;

  const percent = Math.round((used / quota) * 100);

  const message: SlackMessage = {
    text: `Quota warning: ${percent}% of monthly tasks used`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Quota Warning", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `You've used *${percent}%* of your monthly task quota.\n\n*Used:* ${used} tasks\n*Quota:* ${quota} tasks\n*Remaining:* ${quota - used} tasks`,
        },
      },
    ],
  };

  await sendSlackNotification(org.slackWebhookUrl, message);
  logger.info("Sent quota warning notification", { orgId, used, quota, percent });
}

/**
 * Test Slack webhook configuration
 */
export async function testSlackWebhook(webhookUrl: string): Promise<boolean> {
  const message: SlackMessage = {
    text: "WorkerMill webhook test successful!",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Your Slack webhook is configured correctly. You'll receive notifications for task completions, failures, and alerts.",
        },
      },
    ],
  };

  return sendSlackNotification(webhookUrl, message);
}
