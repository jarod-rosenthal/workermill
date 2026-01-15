/**
 * WorkerMill Email Service
 *
 * Handles transactional emails via AWS SES for team invites and notifications.
 */

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import type { OrgInvite } from "../models/OrgInvite.js";
import type { Organization } from "../models/Organization.js";

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
              <div style="font-size: 14px; color: ***REMOVED***71717a; margin-top: 4px;">
                Mission Control for AI Workers
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3;">
                You've been invited to join ${organization.name}
              </h1>

              <p style="margin: 0 0 24px; font-size: 16px; color: ***REMOVED***3f3f46; line-height: 1.6;">
                You've been invited to collaborate on <strong>${organization.name}</strong> as a <strong>${roleName}</strong>. Accept this invitation to start working with the team's AI-powered development workflow.
              </p>

              <!-- Role Badge -->
              <table role="presentation" style="width: 100%; margin-bottom: 24px;">
                <tr>
                  <td style="background-color: ***REMOVED***f4f4f5; border-radius: 6px; padding: 16px;">
                    <table role="presentation" style="width: 100%;">
                      <tr>
                        <td style="width: 50%; padding-right: 8px;">
                          <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Organization</div>
                          <div style="font-size: 16px; font-weight: 600; color: ***REMOVED***18181b;">${organization.name}</div>
                        </td>
                        <td style="width: 50%; padding-left: 8px;">
                          <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Your Role</div>
                          <div style="font-size: 16px; font-weight: 600; color: ***REMOVED***18181b;">${roleName}</div>
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
                    <a href="${acceptUrl}" style="display: inline-block; padding: 14px 32px; background-color: ***REMOVED***18181b; color: ***REMOVED***ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Expiration Warning -->
              <table role="presentation" style="width: 100%; margin-bottom: 24px;">
                <tr>
                  <td style="background-color: ***REMOVED***fef3c7; border-left: 4px solid ***REMOVED***f59e0b; border-radius: 0 6px 6px 0; padding: 12px 16px;">
                    <div style="font-size: 14px; color: ***REMOVED***92400e;">
                      <strong>This invitation expires on ${expirationDate}</strong> (7 days from when it was sent).
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Alternative Link -->
              <p style="margin: 0; font-size: 14px; color: ***REMOVED***71717a; line-height: 1.6;">
                If the button above doesn't work, copy and paste this URL into your browser:
              </p>
              <p style="margin: 8px 0 0; font-size: 14px; color: ***REMOVED***3b82f6; word-break: break-all;">
                <a href="${acceptUrl}" style="color: ***REMOVED***3b82f6; text-decoration: underline;">${acceptUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: ***REMOVED***fafafa; border-top: 1px solid ***REMOVED***e4e4e7; border-radius: 0 0 8px 8px;">
              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <p style="margin: 0 0 8px; font-size: 14px; color: ***REMOVED***71717a;">
                      <strong>WorkerMill</strong> - htop for AI workers
                    </p>
                    <p style="margin: 0; font-size: 12px; color: ***REMOVED***a1a1aa;">
                      Real-time monitoring and orchestration for autonomous AI coding agents.
                    </p>
                    <p style="margin: 16px 0 0; font-size: 12px; color: ***REMOVED***a1a1aa;">
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
