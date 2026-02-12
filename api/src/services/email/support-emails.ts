/**
 * Email Service - Support Ticket Email Templates + Send
 */

import { SendEmailCommand } from "@aws-sdk/client-ses";
import { logger } from "../../utils/logger.js";
import type { SupportTicket } from "../../models/SupportTicket.js";
import { getSESClient, EMAIL_CONFIG } from "./helpers.js";

// =============================================================================
// Types
// =============================================================================

interface SupportTicketEmailParams {
  recipientEmail: string;
  ticket: SupportTicket;
  type: "created" | "updated" | "reply";
  replyContent?: string;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get badge styling for support ticket status
 */
function getSupportStatusBadgeStyle(status: string): { bg: string; text: string } {
  switch (status) {
    case "open":
      return { bg: "#dbeafe", text: "#1e40af" };
    case "in_progress":
      return { bg: "#fef3c7", text: "#92400e" };
    case "waiting":
      return { bg: "#f4f4f5", text: "#3f3f46" };
    case "resolved":
      return { bg: "#dcfce7", text: "#166534" };
    case "closed":
      return { bg: "#f4f4f5", text: "#71717a" };
    default:
      return { bg: "#f4f4f5", text: "#3f3f46" };
  }
}

// =============================================================================
// HTML Generator
// =============================================================================

/**
 * Generate support ticket email HTML
 */
function generateSupportTicketEmailHtml(params: SupportTicketEmailParams): string {
  const { ticket, type, replyContent } = params;
  const ticketUrl = `${EMAIL_CONFIG.baseUrl}/support/${ticket.ticketKey}`;
  const badgeStyle = getSupportStatusBadgeStyle(ticket.status);

  let title: string;
  let statusBadge: string;
  let mainContent: string;

  switch (type) {
    case "created":
      title = "Support Ticket Created";
      statusBadge = "New Ticket";
      mainContent = `
        <p style="margin: 0 0 24px; font-size: 16px; color: #3f3f46; line-height: 1.6;">
          We've received your support request and will get back to you as soon as possible.
        </p>
        <div style="margin: 0 0 24px; background-color: #f4f4f5; border-radius: 6px; padding: 16px;">
          <div style="font-size: 12px; color: #71717a; text-transform: uppercase; margin-bottom: 8px;">Your Message</div>
          <div style="font-size: 14px; color: #18181b; white-space: pre-wrap;">${ticket.description.substring(0, 500)}${ticket.description.length > 500 ? "..." : ""}</div>
        </div>
      `;
      break;
    case "updated":
      title = "Ticket Status Updated";
      statusBadge = ticket.getDisplayStatus();
      mainContent = `
        <p style="margin: 0 0 24px; font-size: 16px; color: #3f3f46; line-height: 1.6;">
          Your support ticket has been updated.
        </p>
      `;
      break;
    case "reply":
      title = "New Reply to Your Ticket";
      statusBadge = "Support Response";
      mainContent = `
        <p style="margin: 0 0 24px; font-size: 16px; color: #3f3f46; line-height: 1.6;">
          Our support team has responded to your ticket.
        </p>
        ${replyContent ? `
        <div style="margin: 0 0 24px; background-color: #f0f9ff; border-left: 4px solid #3b82f6; border-radius: 0 6px 6px 0; padding: 16px;">
          <div style="font-size: 12px; color: #1e40af; text-transform: uppercase; margin-bottom: 8px;">Support Response</div>
          <div style="font-size: 14px; color: #18181b; white-space: pre-wrap;">${replyContent.substring(0, 1000)}${replyContent.length > 1000 ? "..." : ""}</div>
        </div>
        ` : ""}
      `;
      break;
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}: ${ticket.ticketKey}</title>
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
                Support
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; background-color: ${badgeStyle.bg}; color: ${badgeStyle.text}; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  ${statusBadge}
                </div>
              </div>

              <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 600; color: #18181b; line-height: 1.3; text-align: center;">
                ${ticket.ticketKey}
              </h1>

              <h2 style="margin: 0 0 24px; font-size: 18px; font-weight: 500; color: #3f3f46; line-height: 1.4; text-align: center;">
                ${ticket.subject}
              </h2>

              ${mainContent}

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${ticketUrl}" style="display: inline-block; padding: 14px 32px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      View Ticket
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; font-size: 14px; color: #71717a; text-align: center;">
                You can reply to this email or use the button above to respond.
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
                      <strong>WorkerMill Support</strong>
                    </p>
                    <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
                      This email was sent regarding ticket ${ticket.ticketKey}.
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

// =============================================================================
// Send Function
// =============================================================================

/**
 * Send support ticket notification email
 */
export async function sendSupportTicketEmail(
  recipientEmail: string,
  type: "created" | "updated" | "reply",
  ticket: SupportTicket,
  replyContent?: string
): Promise<boolean> {
  let subject: string;

  switch (type) {
    case "created":
      subject = `[${ticket.ticketKey}] Support Ticket Created: ${ticket.subject}`;
      break;
    case "updated":
      subject = `[${ticket.ticketKey}] Ticket ${ticket.getDisplayStatus()}: ${ticket.subject}`;
      break;
    case "reply":
      subject = `[${ticket.ticketKey}] New Reply: ${ticket.subject}`;
      break;
  }

  const htmlBody = generateSupportTicketEmailHtml({
    recipientEmail,
    ticket,
    type,
    replyContent,
  });

  try {
    const client = getSESClient();
    const command = new SendEmailCommand({
      Source: EMAIL_CONFIG.sourceEmail,
      ReplyToAddresses: [`support+${ticket.ticketKey}@workermill.com`],
      Destination: { ToAddresses: [recipientEmail] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: { Html: { Data: htmlBody, Charset: "UTF-8" } },
      },
    });

    const response = await client.send(command);

    logger.info("Support ticket email sent", {
      ticketId: ticket.id,
      ticketKey: ticket.ticketKey,
      type,
      recipientEmail,
      messageId: response.MessageId,
    });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error("Failed to send support ticket email", {
      error: errorMessage,
      ticketId: ticket.id,
      ticketKey: ticket.ticketKey,
      type,
      recipientEmail,
    });

    return false;
  }
}
