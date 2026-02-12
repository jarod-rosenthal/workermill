/**
 * Email Service - Invite Email Templates + Send
 */

import { SendEmailCommand } from "@aws-sdk/client-ses";
import { logger } from "../../utils/logger.js";
import type { OrgInvite } from "../../models/OrgInvite.js";
import type { Organization } from "../../models/Organization.js";
import type { User } from "../../models/User.js";
import { getSESClient, EMAIL_CONFIG, formatRole, formatExpirationDate } from "./helpers.js";

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
 * Generate HTML email template for existing user added to organization
 */
function generateOrgAddedEmailHtml(
  user: User,
  organization: Organization,
  role: string,
  addedBy: User
): string {
  const dashboardUrl = `${EMAIL_CONFIG.baseUrl}/dashboard`;
  const roleName = formatRole(role);
  const addedByName = addedBy.fullName || addedBy.email;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You've been added to ${organization.name} on WorkerMill</title>
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
              <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; background-color: #dcfce7; color: #166534; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Added to Team
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: #18181b; line-height: 1.3;">
                You've been added to ${organization.name}
              </h1>

              <p style="margin: 0 0 24px; font-size: 16px; color: #3f3f46; line-height: 1.6;">
                <strong>${addedByName}</strong> has added you to <strong>${organization.name}</strong> as a <strong>${roleName}</strong>. You can now access this organization from your dashboard.
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
                    <a href="${dashboardUrl}" style="display: inline-block; padding: 14px 32px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      Go to Dashboard
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; font-size: 14px; color: #71717a; line-height: 1.6; text-align: center;">
                Use the organization switcher in the top navigation to switch between your organizations.
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
 * Generate plain text email for existing user added to organization
 */
function generateOrgAddedEmailText(
  user: User,
  organization: Organization,
  role: string,
  addedBy: User
): string {
  const dashboardUrl = `${EMAIL_CONFIG.baseUrl}/dashboard`;
  const roleName = formatRole(role);
  const addedByName = addedBy.fullName || addedBy.email;

  return `
You've been added to ${organization.name} on WorkerMill

${addedByName} has added you to ${organization.name} as a ${roleName}. You can now access this organization from your dashboard.

Organization: ${organization.name}
Your Role: ${roleName}

Go to your dashboard:
${dashboardUrl}

Use the organization switcher in the top navigation to switch between your organizations.

---

WorkerMill - htop for AI workers
Real-time monitoring and orchestration for autonomous AI coding agents.
`.trim();
}

/**
 * Send notification email when an existing user is added to an organization
 *
 * @param user - The User being added
 * @param organization - The Organization they're being added to
 * @param role - The role they're being assigned
 * @param addedBy - The User who added them
 * @returns true if email was sent successfully, false otherwise
 */
export async function sendOrgAddedEmail(
  user: User,
  organization: Organization,
  role: string,
  addedBy: User
): Promise<boolean> {
  const client = getSESClient();

  const subject = `You've been added to ${organization.name} on WorkerMill`;
  const htmlBody = generateOrgAddedEmailHtml(user, organization, role, addedBy);
  const textBody = generateOrgAddedEmailText(user, organization, role, addedBy);

  try {
    const command = new SendEmailCommand({
      Source: EMAIL_CONFIG.sourceEmail,
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

    logger.info("Org added email sent successfully", {
      messageId: response.MessageId,
      email: user.email,
      orgId: organization.id,
      orgName: organization.name,
      userId: user.id,
      role,
      addedBy: addedBy.id,
    });

    return true;
  } catch (error) {
    logger.error("Failed to send org added email", {
      error: error instanceof Error ? error.message : String(error),
      email: user.email,
      orgId: organization.id,
      orgName: organization.name,
      userId: user.id,
    });

    return false;
  }
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
