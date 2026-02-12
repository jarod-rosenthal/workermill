/**
 * Email Service - Shared Helpers
 *
 * SES client singleton, formatting utilities, and shared HTML generators.
 */

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask } from "../../models/WorkerTask.js";

// SES client (lazy initialized)
let sesClient: SESClient | null = null;

export function getSESClient(): SESClient {
  if (!sesClient) {
    // Use dedicated SES region (Ohio/us-east-2 where we have production access)
    sesClient = new SESClient({ region: config.aws.sesRegion });
  }
  return sesClient;
}

// Email configuration
export const EMAIL_CONFIG = {
  sourceEmail: process.env.SES_SOURCE_EMAIL || "noreply@workermill.com",
  baseUrl: process.env.API_BASE_URL || "https://workermill.com",
};

/**
 * Format a role name for display
 */
export function formatRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Format a persona name for display (replace underscores with spaces, title case)
 */
export function formatPersona(persona: string): string {
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
export function getTaskPersonas(task: WorkerTask): string[] {
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
export async function getTaskPersonasAsync(task: WorkerTask): Promise<string[]> {
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
export function formatTaskStatus(status: string): string {
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
export function getStatusBadgeStyle(status: string): { bg: string; text: string } {
  // Success states - green
  if (["completed", "deployed", "pr_approved", "review_approved"].includes(status)) {
    return { bg: "#dcfce7", text: "#166534" };
  }
  // Waiting/pending states - blue
  if (["review_requested", "pr_created"].includes(status)) {
    return { bg: "#dbeafe", text: "#1e40af" };
  }
  // Warning states - yellow
  if (["escalated"].includes(status)) {
    return { bg: "#fef3c7", text: "#92400e" };
  }
  // Error states - red
  if (["failed", "cancelled", "review_rejected"].includes(status)) {
    return { bg: "#fee2e2", text: "#991b1b" };
  }
  // Default - gray
  return { bg: "#f4f4f5", text: "#3f3f46" };
}

/**
 * Generate the worker(s) section HTML for email templates.
 * @param task - The worker task
 * @param preloadedPersonas - Optional pre-fetched personas (from async getTaskPersonasAsync)
 */
export function generateWorkersHtml(task: WorkerTask, preloadedPersonas?: string[]): string {
  // Use preloaded personas if provided, otherwise fall back to sync function
  const personas = preloadedPersonas ?? getTaskPersonas(task);

  if (personas.length === 0) {
    return `
      <div style="font-size: 12px; color: #71717a; text-transform: uppercase;">Worker</div>
      <div style="font-size: 14px; font-weight: 600; color: #18181b;">AI Worker</div>
    `;
  }

  const label = personas.length > 1 ? "Expert Team" : "Worker";
  const formattedPersonas = personas.map(formatPersona);

  if (personas.length === 1) {
    return `
      <div style="font-size: 12px; color: #71717a; text-transform: uppercase;">${label}</div>
      <div style="font-size: 14px; font-weight: 600; color: #18181b;">${formattedPersonas[0]}</div>
    `;
  }

  // Multiple personas - show as a list with better formatting
  const personaList = formattedPersonas
    .map(p => `<div style="font-size: 13px; color: #18181b; margin-top: 2px;">• ${p}</div>`)
    .join("");

  return `
    <div style="font-size: 12px; color: #71717a; text-transform: uppercase;">${label} (${personas.length})</div>
    ${personaList}
  `;
}

/**
 * Format expiration date for display
 */
export function formatExpirationDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Generate email footer with unsubscribe link
 */
export function generateEmailFooter(unsubscribeUrl: string, orgName: string): string {
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

// Re-export SendEmailCommand for use by sub-modules
export { SendEmailCommand };
