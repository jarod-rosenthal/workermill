import { logger } from "../utils/logger.js";

interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{
    type: string;
    text: string;
  }>;
  elements?: Array<{
    type: string;
    text: string;
  }>;
}

interface SlackMessage {
  text: string;
  blocks?: SlackBlock[];
}

/**
 * Send a notification to a Slack webhook URL
 */
export async function sendSlackNotification(
  webhookUrl: string,
  message: SlackMessage
): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error("Slack notification failed", {
        status: response.status,
        body: text,
      });
      return false;
    }

    logger.debug("Slack notification sent successfully");
    return true;
  } catch (err) {
    logger.error("Failed to send Slack notification", { err });
    return false;
  }
}

/**
 * Send a simple text notification to Slack
 */
export async function sendSlackText(
  webhookUrl: string,
  text: string
): Promise<boolean> {
  return sendSlackNotification(webhookUrl, { text });
}
