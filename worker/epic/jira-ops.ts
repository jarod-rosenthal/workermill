/**
 * Jira Operations for Epic Executor
 *
 * Calls existing execution scripts to update Jira tickets.
 * All operations are non-blocking - Jira failures don't crash Epic.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export class JiraOps {
  private ticketKey: string;
  private hasCredentials: boolean;

  constructor(ticketKey?: string) {
    this.ticketKey = ticketKey || "";
    this.hasCredentials = !!(
      process.env.JIRA_BASE_URL &&
      process.env.JIRA_EMAIL &&
      process.env.JIRA_API_TOKEN &&
      this.ticketKey
    );
  }

  /**
   * Transition the Jira ticket to a new status.
   */
  async transitionTo(statusName: string): Promise<void> {
    if (!this.hasCredentials) {
      console.log("[JiraOps] Skipping transition - credentials not available");
      return;
    }

    const env = {
      ...process.env,
      TICKET_KEY: this.ticketKey,
      TRANSITION_NAME: statusName,
    };

    try {
      await execFileAsync(
        "node",
        ["/app/execution-compiled/ticket/transition_issue.js"],
        { env }
      );
      console.log(`[JiraOps] Transitioned to "${statusName}"`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[JiraOps] Transition failed: ${msg}`);
      // Continue - don't crash Epic
    }
  }

  /**
   * Post a comment to the Jira ticket.
   */
  async postComment(comment: string): Promise<void> {
    if (!this.hasCredentials) {
      console.log("[JiraOps] Skipping comment - credentials not available");
      return;
    }

    const env = {
      ...process.env,
      TICKET_KEY: this.ticketKey,
      COMMENT: comment,
    };

    try {
      await execFileAsync(
        "node",
        ["/app/execution-compiled/ticket/add_comment.js"],
        { env }
      );
      console.log("[JiraOps] Posted comment");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[JiraOps] Comment failed: ${msg}`);
      // Continue - don't crash Epic
    }
  }

  /**
   * Check if Jira integration is available.
   */
  isAvailable(): boolean {
    return this.hasCredentials;
  }
}
