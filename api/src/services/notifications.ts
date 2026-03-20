/**
 * WorkerMill Notifications Service
 *
 * Handles Slack webhook and email notifications for task events.
 * Also triggers automatic skill extraction and memory creation.
 */

import { AppDataSource } from "../db/connection.js";
import { Organization } from "../models/Organization.js";
import { User } from "../models/User.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { EpisodicMemory } from "../models/EpisodicMemory.js";
import { logger } from "../utils/logger.js";
import {
  sendTaskCompletedEmail,
  sendTaskFailedEmail,
  sendCostAlertEmail,
  sendPrCreatedEmail,
} from "./email/index.js";
import { skillExtractor } from "./skill-extractor.js";
import { sendPushNotification } from "./push-notifications.js";

/**
 * Get the first active user in an organization for push notifications.
 * Since tasks don't have a specific owner, we send notifications to any active user in the org.
 */
async function getOrgNotificationUser(orgId: string): Promise<string | null> {
  try {
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({
      where: { orgId },
      select: ["id"],
      order: { createdAt: "ASC" }, // Get the first user (typically the admin/owner)
    });
    return user?.id || null;
  } catch (error) {
    logger.warn("Failed to find notification user for org", {
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

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
      signal: AbortSignal.timeout(30000), // 30 second timeout for external webhooks
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

  if (!org) return;

  // Send Slack notification
  if (org.slackWebhookUrl) {
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
  }

  // Send email notifications to all org members
  if (org.emailNotificationsEnabled) {
    const userRepo = AppDataSource.getRepository(User);
    const orgMembers = await userRepo.find({
      where: { orgId: org.id },
    });

    for (const member of orgMembers) {
      try {
        await sendTaskCompletedEmail(task, member, org);
      } catch (error) {
        logger.warn("Failed to send task completed email", {
          userId: member.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  logger.info("Sent task completed notification", { taskId: task.id, orgId: org.id });

  // Send push notification for task completion (fire-and-forget)
  getOrgNotificationUser(task.orgId).then(userId => {
    if (userId) {
      sendPushNotification(userId, task.orgId, {
        title: "Task completed",
        body: `Task completed — ${task.summary || task.jiraIssueKey || 'Unknown task'}`,
        data: {
          taskId: task.id,
          issueKey: task.jiraIssueKey || '',
          type: 'task_completed'
        },
        category: "completions"
      });
    }
  }).catch(error => {
    logger.warn("Failed to send push notification for task completion", {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  // Auto-extract skills and create episodic memory if enabled
  // Include all success terminal states, not just "completed"
  const successStatuses = ["completed", "deployed", "pr_approved", "review_requested"];
  if (org.autoSkillExtraction && successStatuses.includes(task.status)) {
    try {
      // Extract skills from task logs (creates procedural memories)
      const extractionResult = await skillExtractor.extractFromTask(org.id, task.id, {
        autoCreate: true,
        minConfidence: 0.6,
      });

      if (extractionResult.skillsCreated.length > 0 || extractionResult.skillsUpdated.length > 0) {
        logger.info("Auto-extracted skills from completed task", {
          taskId: task.id,
          orgId: org.id,
          skillsCreated: extractionResult.skillsCreated.length,
          skillsUpdated: extractionResult.skillsUpdated.length,
        });
      }

      // Create episodic memory for successful task completion
      await createEpisodicMemoryForTask(task, org, "success");
    } catch (error) {
      // Don't fail the notification if skill extraction fails
      logger.warn("Failed to auto-extract skills from task", {
        taskId: task.id,
        orgId: org.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Notify when a task fails
 */
export async function notifyTaskFailed(task: WorkerTask): Promise<void> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: task.orgId } });

  if (!org) return;

  // Send Slack notification
  if (org.slackWebhookUrl) {
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
  }

  // Send email notifications to all org members
  if (org.emailNotificationsEnabled) {
    const userRepo = AppDataSource.getRepository(User);
    const orgMembers = await userRepo.find({
      where: { orgId: org.id },
    });

    for (const member of orgMembers) {
      try {
        await sendTaskFailedEmail(task, member, org);
      } catch (error) {
        logger.warn("Failed to send task failed email", {
          userId: member.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  logger.info("Sent task failed notification", { taskId: task.id, orgId: org.id });

  // Send push notification for task failure (fire-and-forget)
  getOrgNotificationUser(task.orgId).then(userId => {
    if (userId) {
      sendPushNotification(userId, task.orgId, {
        title: "Task failed",
        body: `Task failed — ${task.errorMessage || task.summary || task.jiraIssueKey || 'Unknown reason'}`,
        data: {
          taskId: task.id,
          issueKey: task.jiraIssueKey || '',
          type: 'task_failed'
        },
        category: "failures"
      });
    }
  }).catch(error => {
    logger.warn("Failed to send push notification for task failure", {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  // Create episodic memory for failed task (learning from failures)
  if (org.autoSkillExtraction) {
    try {
      await createEpisodicMemoryForTask(task, org, "failure");
    } catch (error) {
      logger.warn("Failed to create episodic memory for failed task", {
        taskId: task.id,
        orgId: org.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
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

  if (!org) return;

  // Send Slack notification
  if (org.slackWebhookUrl) {
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
  }

  // Send email notifications to all org members
  if (org.emailNotificationsEnabled) {
    const userRepo = AppDataSource.getRepository(User);
    const orgMembers = await userRepo.find({
      where: { orgId: org.id },
    });

    for (const member of orgMembers) {
      try {
        await sendCostAlertEmail(member, org, currentCost, threshold);
      } catch (error) {
        logger.warn("Failed to send cost alert email", {
          userId: member.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

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
    text: `Usage warning: ${percent}% of monthly task quota used`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Usage Warning", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `You've used *${percent}%* of your monthly task quota.\n\nVisit your <https://workermill.com/billing|Billing page> to view detailed usage or upgrade your plan.`,
        },
      },
    ],
  };

  await sendSlackNotification(org.slackWebhookUrl, message);
  logger.info("Sent quota warning notification", { orgId, used, quota, percent });
}

/**
 * Notify when a PR is created
 */
export async function notifyPrCreated(
  task: WorkerTask,
  prUrl: string
): Promise<void> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: task.orgId } });

  if (!org) return;

  // Send Slack notification
  if (org.slackWebhookUrl) {
    const message: SlackMessage = {
      text: `PR created for ${task.jiraIssueKey}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "Pull Request Created", emoji: true },
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
          text: { type: "mrkdwn", text: `*Pull Request:* <${prUrl}|View PR>` },
        },
      ],
    };

    await sendSlackNotification(org.slackWebhookUrl, message);
  }

  // Send email notifications to all org members
  if (org.emailNotificationsEnabled) {
    const userRepo = AppDataSource.getRepository(User);
    const orgMembers = await userRepo.find({
      where: { orgId: org.id },
    });

    for (const member of orgMembers) {
      try {
        await sendPrCreatedEmail(task, member, org, prUrl);
      } catch (error) {
        logger.warn("Failed to send PR created email", {
          userId: member.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  logger.info("Sent PR created notification", { taskId: task.id, orgId: org.id, prUrl });
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

/**
 * Create episodic memory from a completed or failed task.
 * This captures task experiences for future learning.
 */
async function createEpisodicMemoryForTask(
  task: WorkerTask,
  org: Organization,
  outcome: "success" | "failure"
): Promise<void> {
  const episodicRepo = AppDataSource.getRepository(EpisodicMemory);

  // Determine event type based on outcome
  const eventType = outcome === "success" ? "task_completed" : "task_failed";

  // Generate summary based on task data
  const summary = outcome === "success"
    ? `Successfully completed: ${task.summary || task.jiraIssueKey || "Unnamed task"}`
    : `Failed task: ${task.summary || task.jiraIssueKey || "Unnamed task"} - ${task.errorMessage || "Unknown error"}`;

  // Build outcome details with lessons learned
  const outcomeDetails = outcome === "success"
    ? `Task completed by ${task.workerPersona} using ${task.workerModel}. Duration: ${task.ecsTaskSeconds ? Math.round(task.ecsTaskSeconds / 60) + " minutes" : "unknown"}. Commits: ${task.commitHistory?.length || 0}. ${task.githubPrUrl ? "PR created successfully." : ""}`
    : `Task failed with error: ${task.errorMessage || "Unknown"}. Consider: checking prerequisites, reviewing error patterns, or adjusting approach.`;

  // Build context details
  const contextDetails = {
    filesAffected: task.commitHistory?.flatMap(c => (c as { files?: string[] }).files || []) || [],
    error: outcome === "failure" ? (task.errorMessage || undefined) : undefined,
    toolsUsed: [task.workerModel],
    retriesNeeded: task.retryCount || 0,
    jiraIssueKey: task.jiraIssueKey || undefined,
  };

  // Check if we already have an episodic memory for this task
  const existing = await episodicRepo.findOne({
    where: {
      orgId: org.id,
      taskId: task.id,
      eventType: eventType as "task_completed" | "task_failed",
    },
  });

  if (existing) {
    // Update existing memory
    existing.summary = summary;
    existing.details = contextDetails;
    existing.outcomeDetails = outcomeDetails;
    await episodicRepo.save(existing);
    logger.debug("Updated existing episodic memory for task", { taskId: task.id, outcome });
  } else {
    // Create new episodic memory
    const memory = episodicRepo.create({
      orgId: org.id,
      taskId: task.id,
      repository: task.githubRepo || "unknown",
      eventType: eventType as "task_completed" | "task_failed",
      summary,
      details: contextDetails,
      outcome: outcome as "success" | "failure",
      outcomeDetails,
      persona: task.workerPersona,
      model: task.workerModel,
      effectivenessScore: outcome === "success" ? 1.0 : 0.0,
    });

    await episodicRepo.save(memory);
    logger.info("Created episodic memory for task", { taskId: task.id, outcome, eventType });
  }
}

/**
 * Blocker information for notifications
 */
export interface BlockerDetails {
  storyIndex: number;
  storyTitle: string;
  errorCategory: string;
  errorMessage: string;
  affectedFiles: string[];
  dependentStories: number[];
  autoRetryAttempts: number;
  maxAutoRetries: number;
}

/**
 * Notify when a blocker is detected in Epic mode.
 * Sends Slack and email notifications to alert the team.
 */
export async function notifyBlockerDetected(
  task: WorkerTask,
  blocker: BlockerDetails
): Promise<void> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: task.orgId } });

  if (!org) return;

  const dashboardUrl = `https://workermill.com/tasks/${task.id}`;
  const blockedStoriesText = blocker.dependentStories.length > 0
    ? `Stories ${blocker.dependentStories.join(", ")} are blocked`
    : "No dependent stories affected";

  // Send Slack notification
  if (org.slackWebhookUrl) {
    const message: SlackMessage = {
      text: `⚠️ Blocker detected: ${task.jiraIssueKey} - Story ${blocker.storyIndex}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "⚠️ Epic Blocker Detected", emoji: true },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Ticket:*\n${task.jiraIssueKey}` },
            { type: "mrkdwn", text: `*Story:*\n#${blocker.storyIndex}: ${blocker.storyTitle}` },
            { type: "mrkdwn", text: `*Error Type:*\n${blocker.errorCategory}` },
            { type: "mrkdwn", text: `*Auto-Retry:*\n${blocker.autoRetryAttempts}/${blocker.maxAutoRetries} attempts` },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Error:*\n\`\`\`${blocker.errorMessage.slice(0, 500)}${blocker.errorMessage.length > 500 ? "..." : ""}\`\`\``,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Affected Files:*\n${blocker.affectedFiles.slice(0, 5).join("\n") || "Unknown"}${blocker.affectedFiles.length > 5 ? `\n...and ${blocker.affectedFiles.length - 5} more` : ""}`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Impact:*\n${blockedStoriesText}`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `<${dashboardUrl}|View in Dashboard>`,
          },
        },
      ],
    };

    await sendSlackNotification(org.slackWebhookUrl, message);
  }

  // Send email notifications to all org members
  if (org.emailNotificationsEnabled) {
    const userRepo = AppDataSource.getRepository(User);
    const orgMembers = await userRepo.find({
      where: { orgId: org.id },
    });

    // Note: Email template for blockers would need to be added to email.ts
    // For now, we just log that email would be sent
    logger.info("Would send blocker email to org members", {
      taskId: task.id,
      orgId: org.id,
      memberCount: orgMembers.length,
      blocker: {
        storyIndex: blocker.storyIndex,
        errorCategory: blocker.errorCategory,
      },
    });
  }

  logger.info("Sent blocker detected notification", {
    taskId: task.id,
    orgId: org.id,
    storyIndex: blocker.storyIndex,
    errorCategory: blocker.errorCategory,
    dependentStories: blocker.dependentStories,
  });
}
