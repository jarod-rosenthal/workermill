/**
 * Ticket Operations for Epic Executor
 *
 * Calls existing execution scripts to update tickets (Jira, Linear, GitHub).
 * All operations are non-blocking - ticket failures don't crash Epic.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

type TicketSystem = "jira" | "linear" | "github";

export class TicketOps {
  private ticketKey: string;
  private ticketSystem: TicketSystem;
  private hasCredentials: boolean;

  constructor(ticketKey?: string, ticketSystem?: string) {
    this.ticketKey = ticketKey || "";
    this.ticketSystem = (ticketSystem as TicketSystem) || "jira";

    // Check credentials based on ticket system
    switch (this.ticketSystem) {
      case "linear":
        this.hasCredentials = !!(process.env.LINEAR_API_KEY && this.ticketKey);
        break;
      case "github":
        this.hasCredentials = !!(
          process.env.GITHUB_TOKEN &&
          process.env.GITHUB_REPO &&
          this.ticketKey
        );
        break;
      case "jira":
      default:
        this.hasCredentials = !!(
          process.env.JIRA_BASE_URL &&
          process.env.JIRA_EMAIL &&
          process.env.JIRA_API_TOKEN &&
          this.ticketKey
        );
        break;
    }
  }

  /**
   * Transition the ticket to a new status.
   * Only supported for Jira — Linear and GitHub don't have Jira-style transitions.
   */
  async transitionTo(statusName: string): Promise<void> {
    if (!this.hasCredentials) {
      console.log("[TicketOps] Skipping transition - credentials not available");
      return;
    }

    // Transitions only apply to Jira
    if (this.ticketSystem !== "jira") {
      console.log(
        `[TicketOps] Skipping transition - not supported for ${this.ticketSystem}`,
      );
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
        { env },
      );
      console.log(`[TicketOps] Transitioned to "${statusName}"`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[TicketOps] Transition failed: ${msg}`);
      // Continue - don't crash Epic
    }
  }

  /**
   * Post a comment to the ticket.
   */
  async postComment(comment: string): Promise<void> {
    if (!this.hasCredentials) {
      console.log("[TicketOps] Skipping comment - credentials not available");
      return;
    }

    const env = {
      ...process.env,
      TICKET_KEY: this.ticketKey,
      TICKET_SYSTEM: this.ticketSystem,
      COMMENT: comment,
    };

    try {
      await execFileAsync(
        "node",
        ["/app/execution-compiled/ticket/add_comment.js"],
        { env },
      );
      console.log(`[TicketOps] Posted comment (${this.ticketSystem})`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[TicketOps] Comment failed: ${msg}`);
      // Continue - don't crash Epic
    }
  }

  /**
   * Check if ticket integration is available.
   */
  isAvailable(): boolean {
    return this.hasCredentials;
  }
}
