/**
 * Email Service - Welcome Email Templates + Send
 */

import { SendEmailCommand } from "@aws-sdk/client-ses";
import { logger } from "../../utils/logger.js";
import type { Organization } from "../../models/Organization.js";
import type { User } from "../../models/User.js";
import { getSESClient, EMAIL_CONFIG } from "./helpers.js";
import { logEmailSend } from "./rate-limit.js";

/**
 * Generate HTML email template for welcome email from founder
 */
function generateWelcomeEmailHtml(
  user: User,
  organization: Organization,
  joinedViaInvite: boolean
): string {
  const dashboardUrl = `${EMAIL_CONFIG.baseUrl}/dashboard`;
  const docsUrl = "https://docs.workermill.com";
  const firstName = user.fullName?.split(" ")[0] || "there";

  const orgContextLine = joinedViaInvite
    ? `You've joined <strong>${organization.name}</strong> — great choice!`
    : `Thanks for creating <strong>${organization.name}</strong> on WorkerMill!`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to WorkerMill, ${firstName}!</title>
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
              <h1 style="margin: 0 0 24px; font-size: 24px; font-weight: 600; color: #18181b; line-height: 1.3;">
                Hi ${firstName},
              </h1>

              <p style="margin: 0 0 16px; font-size: 16px; color: #3f3f46; line-height: 1.6;">
                I'm Jarod, the founder of WorkerMill, and I wanted to personally welcome you to the platform!
              </p>

              <p style="margin: 0 0 16px; font-size: 16px; color: #3f3f46; line-height: 1.6;">
                We built WorkerMill to give developers superpowers — imagine having an AI coding team that works around the clock on your Jira tickets, creates pull requests, and helps you ship faster.
              </p>

              <p style="margin: 0 0 24px; font-size: 16px; color: #3f3f46; line-height: 1.6;">
                ${orgContextLine}
              </p>

              <!-- Getting Started Section -->
              <div style="background-color: #f4f4f5; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
                <div style="font-size: 16px; font-weight: 600; color: #18181b; margin-bottom: 16px;">
                  Here are a few things to get you started:
                </div>

                <table role="presentation" style="width: 100%;">
                  <tr>
                    <td style="padding: 8px 0; vertical-align: top;">
                      <span style="color: #10b981; font-weight: 600; margin-right: 8px;">✅</span>
                      <span style="font-size: 14px; color: #3f3f46;"><strong>Connect your tools</strong> — Link Jira, Linear, or GitHub to start assigning tasks to AI workers.</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; vertical-align: top;">
                      <span style="color: #10b981; font-weight: 600; margin-right: 8px;">✅</span>
                      <span style="font-size: 14px; color: #3f3f46;"><strong>Try your first task</strong> — Add the "workermill" label to any Jira ticket and watch an AI worker pick it up.</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; vertical-align: top;">
                      <span style="color: #10b981; font-weight: 600; margin-right: 8px;">✅</span>
                      <span style="font-size: 14px; color: #3f3f46;"><strong>Invite your team</strong> — WorkerMill is better with teammates. Add them from Settings → Team.</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; vertical-align: top;">
                      <span style="color: #10b981; font-weight: 600; margin-right: 8px;">✅</span>
                      <span style="font-size: 14px; color: #3f3f46;"><strong>Check the dashboard</strong> — Monitor your AI workers in real-time with our "htop for AI workers" interface.</span>
                    </td>
                  </tr>
                </table>
              </div>

              <!-- Helpful Resources -->
              <div style="margin-bottom: 24px;">
                <div style="font-size: 14px; font-weight: 600; color: #18181b; margin-bottom: 12px;">
                  Helpful Resources:
                </div>
                <p style="margin: 0 0 8px; font-size: 14px; color: #3f3f46;">
                  📖 <a href="${docsUrl}" style="color: #3b82f6; text-decoration: none;">Documentation</a> — Full guides and API reference
                </p>
                <p style="margin: 0 0 8px; font-size: 14px; color: #3f3f46;">
                  🎬 <a href="${EMAIL_CONFIG.baseUrl}/getting-started" style="color: #3b82f6; text-decoration: none;">Getting Started Guide</a> — Quick walkthrough
                </p>
                <p style="margin: 0; font-size: 14px; color: #3f3f46;">
                  💬 <a href="mailto:support@workermill.com" style="color: #3b82f6; text-decoration: none;">support@workermill.com</a> — We're here to help
                </p>
              </div>

              <!-- Good to Know Section -->
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 0 6px 6px 0; padding: 16px; margin-bottom: 24px;">
                <div style="font-size: 14px; font-weight: 600; color: #92400e; margin-bottom: 8px;">Good to know:</div>
                <p style="margin: 0; font-size: 14px; color: #78350f;">
                  Need help? Reply to this email or reach out at support@workermill.com
                </p>
              </div>

              <p style="margin: 0 0 24px; font-size: 16px; color: #3f3f46; line-height: 1.6;">
                I'd love to hear how WorkerMill works for you. Drop me a note anytime!
              </p>

              <!-- Signature -->
              <div style="margin-bottom: 32px;">
                <p style="margin: 0; font-size: 16px; color: #3f3f46;">Best,</p>
                <p style="margin: 4px 0 0; font-size: 16px; font-weight: 600; color: #18181b;">Jarod Rosenthal</p>
                <p style="margin: 0; font-size: 14px; color: #71717a;">Founder, WorkerMill</p>
              </div>

              <!-- CTA Button -->
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
 * Generate plain text email for welcome email (fallback)
 */
function generateWelcomeEmailText(
  user: User,
  organization: Organization,
  joinedViaInvite: boolean
): string {
  const dashboardUrl = `${EMAIL_CONFIG.baseUrl}/dashboard`;
  const docsUrl = "https://docs.workermill.com";
  const firstName = user.fullName?.split(" ")[0] || "there";

  const orgContextLine = joinedViaInvite
    ? `You've joined ${organization.name} — great choice!`
    : `Thanks for creating ${organization.name} on WorkerMill!`;

  return `
Hi ${firstName},

I'm Jarod, the founder of WorkerMill, and I wanted to personally welcome you to the platform!

We built WorkerMill to give developers superpowers — imagine having an AI coding team that works around the clock on your Jira tickets, creates pull requests, and helps you ship faster.

${orgContextLine}

HERE ARE A FEW THINGS TO GET YOU STARTED:

✅ Connect your tools — Link Jira, Linear, or GitHub to start assigning tasks to AI workers.

✅ Try your first task — Add the "workermill" label to any Jira ticket and watch an AI worker pick it up.

✅ Invite your team — WorkerMill is better with teammates. Add them from Settings → Team.

✅ Check the dashboard — Monitor your AI workers in real-time with our "htop for AI workers" interface.

HELPFUL RESOURCES:
• Documentation: ${docsUrl}
• Getting Started: ${EMAIL_CONFIG.baseUrl}/getting-started
• Support: support@workermill.com

GOOD TO KNOW:
• Need help? Reply to this email or reach out at support@workermill.com

I'd love to hear how WorkerMill works for you. Drop me a note anytime!

Best,
Jarod Rosenthal
Founder, WorkerMill

Go to Dashboard: ${dashboardUrl}

---

WorkerMill - htop for AI workers
Real-time monitoring and orchestration for autonomous AI coding agents.
`.trim();
}

/**
 * Send welcome email from founder to new users
 *
 * @param user - The User who just became active
 * @param organization - The Organization they belong to
 * @param joinedViaInvite - Whether they joined via invite (vs creating a new org)
 * @returns true if email was sent successfully, false otherwise
 */
export async function sendWelcomeEmail(
  user: User,
  organization: Organization,
  joinedViaInvite: boolean = false
): Promise<boolean> {
  const client = getSESClient();
  const firstName = user.fullName?.split(" ")[0] || "there";

  const fromAddress = "WorkerMill <support@workermill.com>";
  const subject = `Welcome to WorkerMill, ${firstName}!`;
  const htmlBody = generateWelcomeEmailHtml(user, organization, joinedViaInvite);
  const textBody = generateWelcomeEmailText(user, organization, joinedViaInvite);

  try {
    const command = new SendEmailCommand({
      Source: fromAddress,
      Destination: {
        ToAddresses: [user.email],
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

    // Log the email send
    await logEmailSend(
      organization.id,
      user.id,
      user.email,
      "welcome",
      subject,
      response.MessageId || null,
      "sent",
      null,
      { joinedViaInvite }
    );

    logger.info("Welcome email sent successfully", {
      messageId: response.MessageId,
      email: user.email,
      orgId: organization.id,
      orgName: organization.name,
      userId: user.id,
      joinedViaInvite,
    });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Log the failed attempt
    await logEmailSend(
      organization.id,
      user.id,
      user.email,
      "welcome",
      subject,
      null,
      "failed",
      errorMessage,
      { joinedViaInvite }
    );

    logger.error("Failed to send welcome email", {
      error: errorMessage,
      email: user.email,
      orgId: organization.id,
      orgName: organization.name,
      userId: user.id,
    });

    return false;
  }
}
