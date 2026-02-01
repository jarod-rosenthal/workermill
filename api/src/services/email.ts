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
import { WorkerTask } from "../models/WorkerTask.js";

// SES client (lazy initialized)
let sesClient: SESClient | null = null;

function getSESClient(): SESClient {
  if (!sesClient) {
    // Use dedicated SES region (Ohio/us-east-2 where we have production access)
    sesClient = new SESClient({ region: config.aws.sesRegion });
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
 * Format a persona name for display (replace underscores with spaces, title case)
 */
function formatPersona(persona: string): string {
  return persona
    .replace(/_/g, " ")
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Get all unique personas from a task (synchronous version).
 *
 * Checks multiple sources in order:
 * 1. planJson.stories - Epic/Multi-Expert mode (V2 pipeline)
 * 2. subtasksJson - Single-container multi-persona mode
 * 3. workerPersona - Standard single-worker mode
 */
function getTaskPersonas(task: WorkerTask): string[] {
  const personas = new Set<string>();

  // Check planJson.stories for Epic/Multi-Expert mode (V2 pipeline)
  // This is the primary source for parallel and multi-expert execution modes
  // Try multiple possible structures since planJson can be various formats
  const planJson = task.planJson as {
    stories?: Array<{ persona?: string }>;
    strategy?: string;
  } | null;

  if (planJson?.stories && Array.isArray(planJson.stories)) {
    for (const story of planJson.stories) {
      if (story.persona) {
        personas.add(story.persona);
      }
    }
  }

  // Check subtasksJson for single-container multi-persona mode
  if (personas.size === 0 && task.subtasksJson && task.subtasksJson.length > 0) {
    for (const subtask of task.subtasksJson) {
      if (subtask.persona) {
        personas.add(subtask.persona);
      }
    }
  }

  // Fallback to main persona if no multi-persona data found
  if (personas.size === 0 && task.workerPersona) {
    personas.add(task.workerPersona);
  }

  return Array.from(personas);
}

/**
 * Get all unique personas from a task (async version).
 * This version also checks child tasks if they exist.
 *
 * For Epic mode, the parent task (project_manager) orchestrates child tasks
 * that are executed by actual expert personas. This function retrieves
 * personas from both planJson.stories AND from child task workerPersona fields.
 */
async function getTaskPersonasAsync(task: WorkerTask): Promise<string[]> {
  const personas = new Set<string>();

  // First, try the synchronous sources
  const syncPersonas = getTaskPersonas(task);
  for (const p of syncPersonas) {
    // Skip project_manager for parent tasks - it's the coordinator, not an expert
    if (p !== "project_manager" || !task.childTaskIds?.length) {
      personas.add(p);
    }
  }

  // If this is a parent task with child tasks, fetch personas from children
  // This captures the actual expert engineers who worked on the stories
  if (task.childTaskIds && task.childTaskIds.length > 0) {
    try {
      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const childTasks = await taskRepo.findByIds(task.childTaskIds);

      for (const child of childTasks) {
        if (child.workerPersona && child.workerPersona !== "project_manager") {
          personas.add(child.workerPersona);
        }
      }
    } catch (error) {
      logger.warn("Failed to fetch child task personas", {
        taskId: task.id,
        childTaskIds: task.childTaskIds,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // If we still only have project_manager and it's a parent task with stories,
  // the personas should be in planJson but we didn't find them
  // Log this for debugging
  if (personas.size === 0 || (personas.size === 1 && personas.has("project_manager"))) {
    logger.debug("Limited personas found for task", {
      taskId: task.id,
      jiraIssueKey: task.jiraIssueKey,
      foundPersonas: Array.from(personas),
      hasChildTasks: !!task.childTaskIds?.length,
      hasPlanJson: !!task.planJson,
      planJsonKeys: task.planJson ? Object.keys(task.planJson) : [],
    });
  }

  // Final fallback to main persona if still empty
  if (personas.size === 0 && task.workerPersona) {
    personas.add(task.workerPersona);
  }

  return Array.from(personas);
}

/**
 * Format task status for display in emails
 */
function formatTaskStatus(status: string): string {
  const statusLabels: Record<string, string> = {
    completed: "Completed",
    deployed: "Deployed",
    pr_approved: "PR Approved",
    review_approved: "Review Approved",
    review_requested: "Review Requested",
    pr_created: "PR Created",
    failed: "Failed",
    cancelled: "Cancelled",
    review_rejected: "Review Rejected",
    escalated: "Escalated",
  };

  return statusLabels[status] || status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Get badge styling for task status
 */
function getStatusBadgeStyle(status: string): { bg: string; text: string } {
  // Success states - green
  if (["completed", "deployed", "pr_approved", "review_approved"].includes(status)) {
    return { bg: "***REMOVED***dcfce7", text: "***REMOVED***166534" };
  }
  // Waiting/pending states - blue
  if (["review_requested", "pr_created"].includes(status)) {
    return { bg: "***REMOVED***dbeafe", text: "***REMOVED***1e40af" };
  }
  // Warning states - yellow
  if (["escalated"].includes(status)) {
    return { bg: "***REMOVED***fef3c7", text: "***REMOVED***92400e" };
  }
  // Error states - red
  if (["failed", "cancelled", "review_rejected"].includes(status)) {
    return { bg: "***REMOVED***fee2e2", text: "***REMOVED***991b1b" };
  }
  // Default - gray
  return { bg: "***REMOVED***f4f4f5", text: "***REMOVED***3f3f46" };
}

/**
 * Generate the worker(s) section HTML for email templates.
 * @param task - The worker task
 * @param preloadedPersonas - Optional pre-fetched personas (from async getTaskPersonasAsync)
 */
function generateWorkersHtml(task: WorkerTask, preloadedPersonas?: string[]): string {
  // Use preloaded personas if provided, otherwise fall back to sync function
  const personas = preloadedPersonas ?? getTaskPersonas(task);

  if (personas.length === 0) {
    return `
      <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">Worker</div>
      <div style="font-size: 14px; font-weight: 600; color: ***REMOVED***18181b;">AI Worker</div>
    `;
  }

  const label = personas.length > 1 ? "Expert Team" : "Worker";
  const formattedPersonas = personas.map(formatPersona);

  if (personas.length === 1) {
    return `
      <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">${label}</div>
      <div style="font-size: 14px; font-weight: 600; color: ***REMOVED***18181b;">${formattedPersonas[0]}</div>
    `;
  }

  // Multiple personas - show as a list with better formatting
  const personaList = formattedPersonas
    .map(p => `<div style="font-size: 13px; color: ***REMOVED***18181b; margin-top: 2px;">• ${p}</div>`)
    .join("");

  return `
    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">${label} (${personas.length})</div>
    ${personaList}
  `;
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
              <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; background-color: ***REMOVED***dcfce7; color: ***REMOVED***166534; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Added to Team
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3;">
                You've been added to ${organization.name}
              </h1>

              <p style="margin: 0 0 24px; font-size: 16px; color: ***REMOVED***3f3f46; line-height: 1.6;">
                <strong>${addedByName}</strong> has added you to <strong>${organization.name}</strong> as a <strong>${roleName}</strong>. You can now access this organization from your dashboard.
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
                    <a href="${dashboardUrl}" style="display: inline-block; padding: 14px 32px; background-color: ***REMOVED***18181b; color: ***REMOVED***ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      Go to Dashboard
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; font-size: 14px; color: ***REMOVED***71717a; line-height: 1.6; text-align: center;">
                Use the organization switcher in the top navigation to switch between your organizations.
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

// =============================================================================
// Welcome Email
// =============================================================================

/**
 * Generate HTML email template for welcome email from CEO
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
              <h1 style="margin: 0 0 24px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3;">
                Hi ${firstName},
              </h1>

              <p style="margin: 0 0 16px; font-size: 16px; color: ***REMOVED***3f3f46; line-height: 1.6;">
                I'm Jarod, the founder of WorkerMill, and I wanted to personally welcome you to the platform!
              </p>

              <p style="margin: 0 0 16px; font-size: 16px; color: ***REMOVED***3f3f46; line-height: 1.6;">
                We built WorkerMill to give developers superpowers — imagine having an AI coding team that works around the clock on your Jira tickets, creates pull requests, and helps you ship faster.
              </p>

              <p style="margin: 0 0 24px; font-size: 16px; color: ***REMOVED***3f3f46; line-height: 1.6;">
                ${orgContextLine}
              </p>

              <!-- Getting Started Section -->
              <div style="background-color: ***REMOVED***f4f4f5; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
                <div style="font-size: 16px; font-weight: 600; color: ***REMOVED***18181b; margin-bottom: 16px;">
                  Here are a few things to get you started:
                </div>

                <table role="presentation" style="width: 100%;">
                  <tr>
                    <td style="padding: 8px 0; vertical-align: top;">
                      <span style="color: ***REMOVED***10b981; font-weight: 600; margin-right: 8px;">✅</span>
                      <span style="font-size: 14px; color: ***REMOVED***3f3f46;"><strong>Connect your tools</strong> — Link Jira, Linear, or GitHub to start assigning tasks to AI workers.</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; vertical-align: top;">
                      <span style="color: ***REMOVED***10b981; font-weight: 600; margin-right: 8px;">✅</span>
                      <span style="font-size: 14px; color: ***REMOVED***3f3f46;"><strong>Try your first task</strong> — Add the "workermill" label to any Jira ticket and watch an AI worker pick it up.</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; vertical-align: top;">
                      <span style="color: ***REMOVED***10b981; font-weight: 600; margin-right: 8px;">✅</span>
                      <span style="font-size: 14px; color: ***REMOVED***3f3f46;"><strong>Invite your team</strong> — WorkerMill is better with teammates. Add them from Settings → Team.</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; vertical-align: top;">
                      <span style="color: ***REMOVED***10b981; font-weight: 600; margin-right: 8px;">✅</span>
                      <span style="font-size: 14px; color: ***REMOVED***3f3f46;"><strong>Check the dashboard</strong> — Monitor your AI workers in real-time with our "htop for AI workers" interface.</span>
                    </td>
                  </tr>
                </table>
              </div>

              <!-- Helpful Resources -->
              <div style="margin-bottom: 24px;">
                <div style="font-size: 14px; font-weight: 600; color: ***REMOVED***18181b; margin-bottom: 12px;">
                  Helpful Resources:
                </div>
                <p style="margin: 0 0 8px; font-size: 14px; color: ***REMOVED***3f3f46;">
                  📖 <a href="${docsUrl}" style="color: ***REMOVED***3b82f6; text-decoration: none;">Documentation</a> — Full guides and API reference
                </p>
                <p style="margin: 0 0 8px; font-size: 14px; color: ***REMOVED***3f3f46;">
                  🎬 <a href="${EMAIL_CONFIG.baseUrl}/getting-started" style="color: ***REMOVED***3b82f6; text-decoration: none;">Getting Started Guide</a> — Quick walkthrough
                </p>
                <p style="margin: 0; font-size: 14px; color: ***REMOVED***3f3f46;">
                  💬 <a href="mailto:support@workermill.com" style="color: ***REMOVED***3b82f6; text-decoration: none;">support@workermill.com</a> — We're here to help
                </p>
              </div>

              <!-- Good to Know Section -->
              <div style="background-color: ***REMOVED***fef3c7; border-left: 4px solid ***REMOVED***f59e0b; border-radius: 0 6px 6px 0; padding: 16px; margin-bottom: 24px;">
                <div style="font-size: 14px; font-weight: 600; color: ***REMOVED***92400e; margin-bottom: 8px;">Good to know:</div>
                <p style="margin: 0; font-size: 14px; color: ***REMOVED***78350f;">
                  Need help? Reply to this email or reach out at support@workermill.com
                </p>
              </div>

              <p style="margin: 0 0 24px; font-size: 16px; color: ***REMOVED***3f3f46; line-height: 1.6;">
                I'd love to hear how WorkerMill works for you. Drop me a note anytime!
              </p>

              <!-- Signature -->
              <div style="margin-bottom: 32px;">
                <p style="margin: 0; font-size: 16px; color: ***REMOVED***3f3f46;">Best,</p>
                <p style="margin: 4px 0 0; font-size: 16px; font-weight: 600; color: ***REMOVED***18181b;">Jarod Rosenthal</p>
                <p style="margin: 0; font-size: 14px; color: ***REMOVED***71717a;">CEO & Founder, WorkerMill</p>
              </div>

              <!-- CTA Button -->
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
CEO & Founder, WorkerMill

Go to Dashboard: ${dashboardUrl}

---

WorkerMill - htop for AI workers
Real-time monitoring and orchestration for autonomous AI coding agents.
`.trim();
}

/**
 * Send welcome email from CEO to new users
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

  // From address: Jarod Rosenthal <jarod.rosenthal@workermill.com>
  const fromAddress = "Jarod Rosenthal <jarod.rosenthal@workermill.com>";
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
  /** Pre-fetched personas from async getTaskPersonasAsync */
  personas?: string[];
}

interface CostAlertParams extends NotificationEmailParams {
  currentCost: number;
  threshold: number;
}

interface BillingEmailParams extends NotificationEmailParams {
  amountCents: number;
  balanceCents: number;
}

interface PaymentFailedParams extends NotificationEmailParams {
  reason: string;
}

interface LowBalanceParams extends NotificationEmailParams {
  balanceCents: number;
  thresholdCents: number;
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
              <td style="padding: 24px 40px; background-color: ***REMOVED***fafafa; border-top: 1px solid ***REMOVED***e4e4e7; border-radius: 0 0 8px 8px;">
                <table role="presentation" style="width: 100%;">
                  <tr>
                    <td style="text-align: center;">
                      <p style="margin: 0 0 8px; font-size: 14px; color: ***REMOVED***71717a;">
                        <strong>WorkerMill</strong> - htop for AI workers
                      </p>
                      <p style="margin: 0 0 16px; font-size: 12px; color: ***REMOVED***a1a1aa;">
                        This email was sent to you as a member of ${orgName}.
                      </p>
                      <p style="margin: 0; font-size: 12px; color: ***REMOVED***a1a1aa;">
                        <a href="${unsubscribeUrl}" style="color: ***REMOVED***71717a; text-decoration: underline;">Unsubscribe from these notifications</a>
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
                <div style="display: inline-block; background-color: ${badgeStyle.bg}; color: ${badgeStyle.text}; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  ${statusLabel}
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3; text-align: center;">
                ${task.jiraIssueKey}: ${task.summary || statusLabel}
              </h1>

              <table role="presentation" style="width: 100%; margin: 24px 0; background-color: ***REMOVED***f4f4f5; border-radius: 6px;">
                <tr>
                  <td style="padding: 12px 16px; border-right: 1px solid ***REMOVED***e4e4e7; vertical-align: top;">
                    ${generateWorkersHtml(task, personas)}
                  </td>
                  <td style="padding: 12px 16px; border-right: 1px solid ***REMOVED***e4e4e7; vertical-align: top;">
                    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">Duration</div>
                    <div style="font-size: 14px; font-weight: 600; color: ***REMOVED***18181b;">${task.ecsTaskSeconds ? Math.round(task.ecsTaskSeconds / 60) + "m" : "N/A"}</div>
                  </td>
                  <td style="padding: 12px 16px; border-right: 1px solid ***REMOVED***e4e4e7; vertical-align: top;">
                    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">Cost</div>
                    <div style="font-size: 14px; font-weight: 600; color: ***REMOVED***18181b;">$${task.estimatedCostUsd?.toFixed(2) || "0.00"}</div>
                  </td>
                  <td style="padding: 12px 16px; vertical-align: top;">
                    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">Quality</div>
                    <div style="font-size: 14px; font-weight: 600; color: ${task.qualityScore != null ? (task.qualityScore >= 90 ? '***REMOVED***10b981' : task.qualityScore >= 70 ? '***REMOVED***eab308' : task.qualityScore >= 50 ? '***REMOVED***f97316' : '***REMOVED***ef4444') : '***REMOVED***71717a'};">${task.qualityScore != null ? task.qualityScore + '%' : 'N/A'}</div>
                  </td>
                </tr>
              </table>

              ${task.qualityScore != null ? `
              <table role="presentation" style="width: 100%; margin-bottom: 24px; border: 1px solid ***REMOVED***e4e4e7; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px; background-color: ***REMOVED***fafafa;">
                    <div style="font-size: 14px; font-weight: 600; color: ***REMOVED***18181b; margin-bottom: 12px;">Quality Breakdown</div>
                    <table role="presentation" style="width: 100%;">
                      <tr>
                        <td style="padding: 4px 8px; font-size: 13px;">
                          ${task.typeErrors === 0 ? '✅' : '❌'} TypeCheck
                          <span style="color: ***REMOVED***71717a; margin-left: 4px;">${task.typeErrors === 0 ? 'Pass' : task.typeErrors + ' errors'}</span>
                        </td>
                        <td style="padding: 4px 8px; font-size: 13px;">
                          ${task.lintErrors === 0 ? '✅' : '⚠️'} Lint
                          <span style="color: ***REMOVED***71717a; margin-left: 4px;">${task.lintErrors === 0 ? 'Pass' : task.lintErrors + ' errors'}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 4px 8px; font-size: 13px;">
                          ${task.testsFailed === 0 ? '✅' : '❌'} Tests
                          <span style="color: ***REMOVED***71717a; margin-left: 4px;">${task.testsFailed === 0 ? (task.testsPassed ? task.testsPassed + ' passed' : 'Pass') : task.testsFailed + ' failed'}</span>
                        </td>
                        <td style="padding: 4px 8px; font-size: 13px;">
                          ${task.securityHigh === 0 ? '✅' : '🔴'} Security
                          <span style="color: ***REMOVED***71717a; margin-left: 4px;">${task.securityHigh === 0 ? 'Clean' : task.securityHigh + ' high'}</span>
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
                    <a href="${task.githubPrUrl}" style="display: inline-block; padding: 12px 24px; background-color: ***REMOVED***3b82f6; color: ***REMOVED***ffffff; text-decoration: none; font-size: 14px; font-weight: 600; border-radius: 6px;">
                      Review Pull Request
                    </a>
                  </td>
                </tr>
              </table>
              ` : ""}

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${dashboardUrl}" style="display: inline-block; padding: 14px 32px; background-color: ***REMOVED***18181b; color: ***REMOVED***ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
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
                <div style="display: inline-block; background-color: ***REMOVED***fee2e2; color: ***REMOVED***991b1b; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Task Failed
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3; text-align: center;">
                ${task.jiraIssueKey}: ${task.summary || "Task failed"}
              </h1>

              <table role="presentation" style="width: 100%; margin: 24px 0; background-color: ***REMOVED***f4f4f5; border-radius: 6px;">
                <tr>
                  <td style="padding: 12px 16px; border-right: 1px solid ***REMOVED***e4e4e7; vertical-align: top;">
                    ${generateWorkersHtml(task, personas)}
                  </td>
                  <td style="padding: 12px 16px; border-right: 1px solid ***REMOVED***e4e4e7; vertical-align: top;">
                    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">Duration</div>
                    <div style="font-size: 14px; font-weight: 600; color: ***REMOVED***18181b;">${task.ecsTaskSeconds ? Math.round(task.ecsTaskSeconds / 60) + "m" : "N/A"}</div>
                  </td>
                  <td style="padding: 12px 16px; vertical-align: top;">
                    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">Cost</div>
                    <div style="font-size: 14px; font-weight: 600; color: ***REMOVED***18181b;">$${task.estimatedCostUsd?.toFixed(2) || "0.00"}</div>
                  </td>
                </tr>
              </table>

              ${task.errorMessage ? `
              <div style="margin: 0 0 24px; background-color: ***REMOVED***fef2f2; border-left: 4px solid ***REMOVED***ef4444; border-radius: 0 6px 6px 0; padding: 16px;">
                <div style="font-size: 12px; color: ***REMOVED***991b1b; text-transform: uppercase; margin-bottom: 8px;">Error</div>
                <div style="font-size: 14px; color: ***REMOVED***7f1d1d; font-family: monospace; white-space: pre-wrap;">${task.errorMessage.substring(0, 500)}${task.errorMessage.length > 500 ? "..." : ""}</div>
              </div>
              ` : ""}

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${dashboardUrl}" style="display: inline-block; padding: 14px 32px; background-color: ***REMOVED***18181b; color: ***REMOVED***ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
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
                <div style="display: inline-block; background-color: ***REMOVED***fef3c7; color: ***REMOVED***92400e; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Cost Alert
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3; text-align: center;">
                Monthly spending has exceeded your threshold
              </h1>

              <table role="presentation" style="width: 100%; margin: 24px 0; background-color: ***REMOVED***f4f4f5; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px; text-align: center; border-right: 1px solid ***REMOVED***e4e4e7;">
                    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">Current Spend</div>
                    <div style="font-size: 28px; font-weight: 700; color: ***REMOVED***18181b;">$${currentCost.toFixed(2)}</div>
                  </td>
                  <td style="padding: 16px; text-align: center;">
                    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">Threshold</div>
                    <div style="font-size: 28px; font-weight: 700; color: ***REMOVED***71717a;">$${threshold.toFixed(2)}</div>
                  </td>
                </tr>
              </table>

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${settingsUrl}" style="display: inline-block; padding: 14px 32px; background-color: ***REMOVED***18181b; color: ***REMOVED***ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
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
                  Pull Request Created
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3; text-align: center;">
                ${task.jiraIssueKey}: ${task.summary || "New PR ready for review"}
              </h1>

              <p style="margin: 0 0 24px; font-size: 16px; color: ***REMOVED***3f3f46; line-height: 1.6; text-align: center;">
                A worker has created a pull request for this task. Please review the changes.
              </p>

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${prUrl}" style="display: inline-block; padding: 14px 32px; background-color: ***REMOVED***18181b; color: ***REMOVED***ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
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

// =============================================================================
// Billing Email Templates
// =============================================================================

/**
 * Generate payment success email HTML
 */
function generatePaymentSuccessEmailHtml(params: BillingEmailParams): string {
  const { organization, amountCents, balanceCents, unsubscribeUrl } = params;
  const billingUrl = `${EMAIL_CONFIG.baseUrl}/billing`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Receipt - WorkerMill</title>
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
                <div style="display: inline-block; background-color: ***REMOVED***dcfce7; color: ***REMOVED***166534; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Payment Successful
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3; text-align: center;">
                Thank you for your payment!
              </h1>

              <table role="presentation" style="width: 100%; margin: 24px 0; background-color: ***REMOVED***f4f4f5; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px; text-align: center; border-right: 1px solid ***REMOVED***e4e4e7;">
                    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">Amount Added</div>
                    <div style="font-size: 28px; font-weight: 700; color: ***REMOVED***166534;">+$${(amountCents / 100).toFixed(2)}</div>
                  </td>
                  <td style="padding: 16px; text-align: center;">
                    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">New Balance</div>
                    <div style="font-size: 28px; font-weight: 700; color: ***REMOVED***18181b;">$${(balanceCents / 100).toFixed(2)}</div>
                  </td>
                </tr>
              </table>

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${billingUrl}" style="display: inline-block; padding: 14px 32px; background-color: ***REMOVED***18181b; color: ***REMOVED***ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      View Billing
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${generateEmailFooter(unsubscribeUrl, organization.name)}`;
}

/**
 * Generate payment failed email HTML
 */
function generatePaymentFailedEmailHtml(params: PaymentFailedParams): string {
  const { organization, reason, unsubscribeUrl } = params;
  const billingUrl = `${EMAIL_CONFIG.baseUrl}/billing`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Failed - WorkerMill</title>
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
                <div style="display: inline-block; background-color: ***REMOVED***fee2e2; color: ***REMOVED***991b1b; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Payment Failed
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3; text-align: center;">
                We couldn't process your payment
              </h1>

              <p style="margin: 0 0 24px; font-size: 16px; color: ***REMOVED***3f3f46; line-height: 1.6; text-align: center;">
                Your AI workers have been paused until the payment issue is resolved.
              </p>

              <div style="margin: 0 0 24px; background-color: ***REMOVED***fef2f2; border-left: 4px solid ***REMOVED***ef4444; border-radius: 0 6px 6px 0; padding: 16px;">
                <div style="font-size: 12px; color: ***REMOVED***991b1b; text-transform: uppercase; margin-bottom: 8px;">Reason</div>
                <div style="font-size: 14px; color: ***REMOVED***7f1d1d;">${reason}</div>
              </div>

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${billingUrl}" style="display: inline-block; padding: 14px 32px; background-color: ***REMOVED***ef4444; color: ***REMOVED***ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      Update Payment Method
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${generateEmailFooter(unsubscribeUrl, organization.name)}`;
}

/**
 * Generate low balance warning email HTML
 */
function generateLowBalanceEmailHtml(params: LowBalanceParams): string {
  const { organization, balanceCents, thresholdCents, unsubscribeUrl } = params;
  const billingUrl = `${EMAIL_CONFIG.baseUrl}/billing`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Low Balance Warning - WorkerMill</title>
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
                <div style="display: inline-block; background-color: ***REMOVED***fef3c7; color: ***REMOVED***92400e; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Low Balance Warning
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3; text-align: center;">
                Your credit balance is running low
              </h1>

              <p style="margin: 0 0 24px; font-size: 16px; color: ***REMOVED***3f3f46; line-height: 1.6; text-align: center;">
                Add credits to continue using AI workers without interruption.
              </p>

              <table role="presentation" style="width: 100%; margin: 24px 0; background-color: ***REMOVED***fef3c7; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px; text-align: center;">
                    <div style="font-size: 12px; color: ***REMOVED***92400e; text-transform: uppercase;">Current Balance</div>
                    <div style="font-size: 36px; font-weight: 700; color: ***REMOVED***92400e;">$${(balanceCents / 100).toFixed(2)}</div>
                    <div style="font-size: 14px; color: ***REMOVED***a16207; margin-top: 4px;">Warning threshold: $${(thresholdCents / 100).toFixed(2)}</div>
                  </td>
                </tr>
              </table>

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${billingUrl}" style="display: inline-block; padding: 14px 32px; background-color: ***REMOVED***18181b; color: ***REMOVED***ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      Add Credits
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; font-size: 14px; color: ***REMOVED***71717a; text-align: center;">
                Tip: Enable auto-recharge to never run out of credits.
              </p>
            </td>
          </tr>

          ${generateEmailFooter(unsubscribeUrl, organization.name)}`;
}

/**
 * Generate auto-recharge success email HTML
 */
function generateAutoRechargeSuccessEmailHtml(params: BillingEmailParams): string {
  const { organization, amountCents, balanceCents, unsubscribeUrl } = params;
  const billingUrl = `${EMAIL_CONFIG.baseUrl}/billing`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Auto-Recharge Complete - WorkerMill</title>
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
                <div style="display: inline-block; background-color: ***REMOVED***dcfce7; color: ***REMOVED***166534; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                  Auto-Recharge Complete
                </div>
              </div>

              <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3; text-align: center;">
                Credits automatically added
              </h1>

              <p style="margin: 0 0 24px; font-size: 16px; color: ***REMOVED***3f3f46; line-height: 1.6; text-align: center;">
                Your credit balance was automatically topped up.
              </p>

              <table role="presentation" style="width: 100%; margin: 24px 0; background-color: ***REMOVED***f4f4f5; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px; text-align: center; border-right: 1px solid ***REMOVED***e4e4e7;">
                    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">Amount Added</div>
                    <div style="font-size: 28px; font-weight: 700; color: ***REMOVED***166534;">+$${(amountCents / 100).toFixed(2)}</div>
                  </td>
                  <td style="padding: 16px; text-align: center;">
                    <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase;">New Balance</div>
                    <div style="font-size: 28px; font-weight: 700; color: ***REMOVED***18181b;">$${(balanceCents / 100).toFixed(2)}</div>
                  </td>
                </tr>
              </table>

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${billingUrl}" style="display: inline-block; padding: 14px 32px; background-color: ***REMOVED***18181b; color: ***REMOVED***ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      View Billing
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${generateEmailFooter(unsubscribeUrl, organization.name)}`;
}

// =============================================================================
// Billing Email Send Functions
// =============================================================================

/**
 * Send payment success email (receipt)
 */
export async function sendPaymentSuccessEmail(
  user: User,
  organization: Organization,
  amountCents: number,
  balanceCents: number
): Promise<boolean> {
  if (!organization.emailNotificationsEnabled) return false;

  const unsubscribeToken = generateUnsubscribeToken(user.id, "billing");
  const unsubscribeUrl = `${EMAIL_CONFIG.baseUrl}/api/email/unsubscribe?token=${unsubscribeToken}`;

  const subject = `Payment Receipt - $${(amountCents / 100).toFixed(2)} added to your WorkerMill account`;
  const htmlBody = generatePaymentSuccessEmailHtml({
    user,
    organization,
    amountCents,
    balanceCents,
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
      "cost_alert", // Reusing existing type for billing
      subject,
      response.MessageId || null,
      "sent",
      null,
      { amountCents, balanceCents, type: "payment_success", unsubscribeToken }
    );

    logger.info("Payment success email sent", {
      userId: user.id,
      amountCents,
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
      { amountCents, balanceCents, type: "payment_success" }
    );

    logger.error("Failed to send payment success email", {
      error: errorMessage,
      userId: user.id,
    });

    return false;
  }
}

/**
 * Send payment failed email
 */
export async function sendPaymentFailedEmail(
  user: User,
  organization: Organization,
  reason: string
): Promise<boolean> {
  if (!organization.emailNotificationsEnabled) return false;

  const unsubscribeToken = generateUnsubscribeToken(user.id, "billing");
  const unsubscribeUrl = `${EMAIL_CONFIG.baseUrl}/api/email/unsubscribe?token=${unsubscribeToken}`;

  const subject = "Payment Failed - Your WorkerMill workers have been paused";
  const htmlBody = generatePaymentFailedEmailHtml({
    user,
    organization,
    reason,
    unsubscribeUrl,
  });

  const fromAddress = organization.emailFromAddress || EMAIL_CONFIG.sourceEmail;

  try {
    // Skip rate limit for payment failure - critical notification
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
      { reason, type: "payment_failed", unsubscribeToken }
    );

    logger.info("Payment failed email sent", {
      userId: user.id,
      reason,
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
      { reason, type: "payment_failed" }
    );

    logger.error("Failed to send payment failed email", {
      error: errorMessage,
      userId: user.id,
    });

    return false;
  }
}

/**
 * Send low balance warning email
 */
export async function sendLowBalanceEmail(
  user: User,
  organization: Organization,
  balanceCents: number,
  thresholdCents: number
): Promise<boolean> {
  if (!organization.emailNotificationsEnabled) return false;

  const unsubscribeToken = generateUnsubscribeToken(user.id, "billing");
  const unsubscribeUrl = `${EMAIL_CONFIG.baseUrl}/api/email/unsubscribe?token=${unsubscribeToken}`;

  const subject = `Low Balance Warning - $${(balanceCents / 100).toFixed(2)} remaining`;
  const htmlBody = generateLowBalanceEmailHtml({
    user,
    organization,
    balanceCents,
    thresholdCents,
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
      { balanceCents, thresholdCents, type: "low_balance", unsubscribeToken }
    );

    logger.info("Low balance email sent", {
      userId: user.id,
      balanceCents,
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
      { balanceCents, thresholdCents, type: "low_balance" }
    );

    logger.error("Failed to send low balance email", {
      error: errorMessage,
      userId: user.id,
    });

    return false;
  }
}

/**
 * Send auto-recharge success email
 */
export async function sendAutoRechargeSuccessEmail(
  user: User,
  organization: Organization,
  amountCents: number,
  balanceCents: number
): Promise<boolean> {
  if (!organization.emailNotificationsEnabled) return false;

  const unsubscribeToken = generateUnsubscribeToken(user.id, "billing");
  const unsubscribeUrl = `${EMAIL_CONFIG.baseUrl}/api/email/unsubscribe?token=${unsubscribeToken}`;

  const subject = `Auto-Recharge Complete - $${(amountCents / 100).toFixed(2)} added`;
  const htmlBody = generateAutoRechargeSuccessEmailHtml({
    user,
    organization,
    amountCents,
    balanceCents,
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
      { amountCents, balanceCents, type: "auto_recharge_success", unsubscribeToken }
    );

    logger.info("Auto-recharge success email sent", {
      userId: user.id,
      amountCents,
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
      { amountCents, balanceCents, type: "auto_recharge_success" }
    );

    logger.error("Failed to send auto-recharge success email", {
      error: errorMessage,
      userId: user.id,
    });

    return false;
  }
}

// =============================================================================
// Support Ticket Email Templates
// =============================================================================

import type { SupportTicket } from "../models/SupportTicket.js";

interface SupportTicketEmailParams {
  recipientEmail: string;
  ticket: SupportTicket;
  type: "created" | "updated" | "reply";
  replyContent?: string;
}

/**
 * Get badge styling for support ticket status
 */
function getSupportStatusBadgeStyle(status: string): { bg: string; text: string } {
  switch (status) {
    case "open":
      return { bg: "***REMOVED***dbeafe", text: "***REMOVED***1e40af" };
    case "in_progress":
      return { bg: "***REMOVED***fef3c7", text: "***REMOVED***92400e" };
    case "waiting":
      return { bg: "***REMOVED***f4f4f5", text: "***REMOVED***3f3f46" };
    case "resolved":
      return { bg: "***REMOVED***dcfce7", text: "***REMOVED***166534" };
    case "closed":
      return { bg: "***REMOVED***f4f4f5", text: "***REMOVED***71717a" };
    default:
      return { bg: "***REMOVED***f4f4f5", text: "***REMOVED***3f3f46" };
  }
}

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
        <p style="margin: 0 0 24px; font-size: 16px; color: ***REMOVED***3f3f46; line-height: 1.6;">
          We've received your support request and will get back to you as soon as possible.
        </p>
        <div style="margin: 0 0 24px; background-color: ***REMOVED***f4f4f5; border-radius: 6px; padding: 16px;">
          <div style="font-size: 12px; color: ***REMOVED***71717a; text-transform: uppercase; margin-bottom: 8px;">Your Message</div>
          <div style="font-size: 14px; color: ***REMOVED***18181b; white-space: pre-wrap;">${ticket.description.substring(0, 500)}${ticket.description.length > 500 ? "..." : ""}</div>
        </div>
      `;
      break;
    case "updated":
      title = "Ticket Status Updated";
      statusBadge = ticket.getDisplayStatus();
      mainContent = `
        <p style="margin: 0 0 24px; font-size: 16px; color: ***REMOVED***3f3f46; line-height: 1.6;">
          Your support ticket has been updated.
        </p>
      `;
      break;
    case "reply":
      title = "New Reply to Your Ticket";
      statusBadge = "Support Response";
      mainContent = `
        <p style="margin: 0 0 24px; font-size: 16px; color: ***REMOVED***3f3f46; line-height: 1.6;">
          Our support team has responded to your ticket.
        </p>
        ${replyContent ? `
        <div style="margin: 0 0 24px; background-color: ***REMOVED***f0f9ff; border-left: 4px solid ***REMOVED***3b82f6; border-radius: 0 6px 6px 0; padding: 16px;">
          <div style="font-size: 12px; color: ***REMOVED***1e40af; text-transform: uppercase; margin-bottom: 8px;">Support Response</div>
          <div style="font-size: 14px; color: ***REMOVED***18181b; white-space: pre-wrap;">${replyContent.substring(0, 1000)}${replyContent.length > 1000 ? "..." : ""}</div>
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

              <h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 600; color: ***REMOVED***18181b; line-height: 1.3; text-align: center;">
                ${ticket.ticketKey}
              </h1>

              <h2 style="margin: 0 0 24px; font-size: 18px; font-weight: 500; color: ***REMOVED***3f3f46; line-height: 1.4; text-align: center;">
                ${ticket.subject}
              </h2>

              ${mainContent}

              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${ticketUrl}" style="display: inline-block; padding: 14px 32px; background-color: ***REMOVED***18181b; color: ***REMOVED***ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                      View Ticket
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 0; font-size: 14px; color: ***REMOVED***71717a; text-align: center;">
                You can reply to this email or use the button above to respond.
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
                      <strong>WorkerMill Support</strong>
                    </p>
                    <p style="margin: 0; font-size: 12px; color: ***REMOVED***a1a1aa;">
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
