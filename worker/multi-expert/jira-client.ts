/**
 * Jira Client for Multi-Expert Mode
 *
 * Handles Jira ticket updates during multi-expert execution.
 * Calls existing execution scripts to update Jira tickets.
 * All operations are non-blocking - Jira failures don't crash execution.
 * Based on worker/epic/jira-ops.ts.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Jira operations for multi-expert mode.
 */
export class JiraClient {
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

    if (this.hasCredentials) {
      console.log(`[JiraClient] Initialized for ticket: ${this.ticketKey}`);
    } else {
      console.log("[JiraClient] Jira integration not available (missing credentials)");
    }
  }

  /**
   * Check if Jira integration is available.
   */
  isAvailable(): boolean {
    return this.hasCredentials;
  }

  /**
   * Transition the Jira ticket to a new status.
   * Status names: "In Progress", "In Review", "Done", etc.
   */
  async transitionTo(statusName: string): Promise<void> {
    if (!this.hasCredentials) {
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
      console.log(`[JiraClient] Transitioned to "${statusName}"`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[JiraClient] Transition failed: ${msg}`);
      // Continue - don't crash execution
    }
  }

  /**
   * Post a comment to the Jira ticket.
   */
  async addComment(comment: string): Promise<void> {
    if (!this.hasCredentials) {
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
      console.log("[JiraClient] Posted comment");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[JiraClient] Comment failed: ${msg}`);
      // Continue - don't crash execution
    }
  }

  /**
   * Add a work log entry to the Jira ticket.
   * Time should be in Jira format (e.g., "1h 30m", "2h", "45m").
   */
  async addWorkLog(timeSpent: string, description: string): Promise<void> {
    if (!this.hasCredentials) {
      return;
    }

    const env = {
      ...process.env,
      TICKET_KEY: this.ticketKey,
      TIME_SPENT: timeSpent,
      WORK_DESCRIPTION: description,
    };

    try {
      // Note: This assumes a work log script exists at this path
      // If not, the error will be caught and logged
      await execFileAsync(
        "node",
        ["/app/execution-compiled/ticket/add_worklog.js"],
        { env }
      );
      console.log(`[JiraClient] Added work log: ${timeSpent}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[JiraClient] Work log failed: ${msg}`);
      // Continue - don't crash execution
    }
  }

  /**
   * Post story start comment to Jira.
   */
  async storyStarted(
    storyIndex: number,
    storyTitle: string,
    persona: string,
    provider: string,
    model: string
  ): Promise<void> {
    const comment = [
      `*Story ${storyIndex} Started*`,
      `*Title:* ${storyTitle}`,
      `*Expert:* ${persona}`,
      `*Provider:* ${provider}`,
      `*Model:* ${model}`,
      `*Started:* ${new Date().toISOString()}`,
    ].join("\n");

    await this.addComment(comment);
  }

  /**
   * Post story completion comment to Jira.
   */
  async storyCompleted(
    storyIndex: number,
    storyTitle: string,
    persona: string,
    filesModified?: string[]
  ): Promise<void> {
    const comment = [
      `*Story ${storyIndex} Completed* :white_check_mark:`,
      `*Title:* ${storyTitle}`,
      `*Expert:* ${persona}`,
      filesModified && filesModified.length > 0
        ? `*Files Modified:* ${filesModified.slice(0, 5).join(", ")}${filesModified.length > 5 ? ` (+${filesModified.length - 5} more)` : ""}`
        : "",
      `*Completed:* ${new Date().toISOString()}`,
    ]
      .filter(Boolean)
      .join("\n");

    await this.addComment(comment);
  }

  /**
   * Post story failure comment to Jira.
   */
  async storyFailed(
    storyIndex: number,
    storyTitle: string,
    persona: string,
    error: string
  ): Promise<void> {
    const comment = [
      `*Story ${storyIndex} Failed* :x:`,
      `*Title:* ${storyTitle}`,
      `*Expert:* ${persona}`,
      `*Error:* ${error}`,
      `*Failed:* ${new Date().toISOString()}`,
    ].join("\n");

    await this.addComment(comment);
  }

  /**
   * Post final summary to Jira after all stories complete.
   * Always transitions to Done regardless of outcome.
   */
  async postFinalSummary(
    completedCount: number,
    failedCount: number,
    prUrl?: string
  ): Promise<void> {
    const status = failedCount > 0 ? ":warning:" : ":white_check_mark:";
    const comment = [
      `*Multi-Expert Execution Complete* ${status}`,
      `*Stories Completed:* ${completedCount}`,
      `*Stories Failed:* ${failedCount}`,
      prUrl ? `*Pull Request:* ${prUrl}` : "",
      `*Finished:* ${new Date().toISOString()}`,
    ]
      .filter(Boolean)
      .join("\n");

    await this.addComment(comment);

    // Always transition to Done - task is complete regardless of review status
    await this.transitionTo("Done");
  }
}
