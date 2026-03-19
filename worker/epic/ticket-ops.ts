/**
 * Ticket Operations for Epic Executor
 *
 * Posts comments and transitions tickets (Jira, Linear, GitHub, Internal).
 * All operations are non-blocking - ticket failures don't crash Epic.
 *
 * Previously shelled out to /app/execution-compiled/ticket/*.js (Docker-only paths).
 * Now inlines the HTTP calls directly so it works in both Docker and native Node.js.
 */

import axios from "axios";

type TicketSystem = "jira" | "linear" | "github" | "internal";

/** Extract numeric issue number from GH-42, #42, or bare 42 formats */
export function extractGithubIssueNumber(key: string): string {
  return key.replace(/^(GH-|#)/, "");
}

export class TicketOps {
  private ticketKey: string;
  private ticketSystem: TicketSystem;
  private hasCredentials: boolean;

  constructor(ticketKey?: string, ticketSystem?: string) {
    this.ticketKey = ticketKey || "";
    this.ticketSystem = (ticketSystem as TicketSystem) || "jira";

    // Check credentials based on ticket system
    switch (this.ticketSystem) {
      case "internal":
        // Internal board comments route through the WorkerMill API — no external creds needed
        this.hasCredentials = !!(
          process.env.API_BASE_URL &&
          process.env.TASK_ID &&
          process.env.ORG_API_KEY &&
          this.ticketKey
        );
        break;
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
   * Get the effective ticket key — for child tasks with synthetic keys (e.g., OCS-408-S1),
   * use parent Jira key instead.
   */
  private getEffectiveTicketKey(): string {
    return process.env.PARENT_JIRA_KEY || this.ticketKey;
  }

  /**
   * Transition the ticket to a new status.
   */
  async transitionTo(statusName: string): Promise<void> {
    if (!this.hasCredentials) {
      console.log("[TicketOps] Skipping transition - credentials not available");
      return;
    }

    try {
      switch (this.ticketSystem) {
        case "jira":
          await this.transitionJira(statusName);
          break;
        case "github":
          await this.transitionGithub(statusName);
          break;
        case "internal":
          await this.transitionInternal(statusName);
          break;
        case "linear":
          // Linear transitions via GraphQL issueUpdate
          await this.transitionLinear(statusName);
          break;
      }
      console.log(`[TicketOps] Transitioned to "${statusName}" (${this.ticketSystem})`);
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

    try {
      const effectiveKey = this.getEffectiveTicketKey();

      switch (this.ticketSystem) {
        case "jira":
          await this.commentJira(effectiveKey, comment);
          break;
        case "linear":
          await this.commentLinear(effectiveKey, comment);
          break;
        case "github":
          await this.commentGithub(effectiveKey, comment);
          break;
        case "internal":
          await this.commentInternal(comment);
          break;
      }
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

  // --- Jira ---

  private jiraAuth(): { Authorization: string } {
    const email = process.env.JIRA_EMAIL!;
    const token = process.env.JIRA_API_TOKEN!;
    return {
      Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
    };
  }

  private async transitionJira(statusName: string): Promise<void> {
    const base = process.env.JIRA_BASE_URL!;
    const key = this.getEffectiveTicketKey();
    const headers = { ...this.jiraAuth(), "Content-Type": "application/json" };

    // Get available transitions
    const { data } = await axios.get(
      `${base}/rest/api/3/issue/${key}/transitions`,
      { headers },
    );
    const transitions = data.transitions || [];

    // Find matching transition (case-insensitive)
    const target = transitions.find(
      (t: { name: string; to: { name: string } }) =>
        t.name.toLowerCase() === statusName.toLowerCase() ||
        t.to.name.toLowerCase() === statusName.toLowerCase(),
    );

    if (!target) {
      // Escalated/Review Requested may not exist in simpler workflows — not an error
      const soft = ["escalated", "review requested"];
      if (soft.includes(statusName.toLowerCase())) {
        console.log(
          `[TicketOps] "${statusName}" not in Jira workflow — ticket stays in current status`,
        );
        return;
      }
      console.warn(
        `[TicketOps] Transition "${statusName}" not available. Available: ${transitions.map((t: { name: string }) => t.name).join(", ")}`,
      );
      return;
    }

    await axios.post(
      `${base}/rest/api/3/issue/${key}/transitions`,
      { transition: { id: target.id } },
      { headers },
    );
  }

  private textToJiraAdf(text: string) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const paragraphs = text.split("\n\n").map((para) => {
      const lineText = para.replace(/\n/g, " ");
      const content: Array<Record<string, unknown>> = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = urlRegex.exec(lineText)) !== null) {
        if (match.index > lastIndex) {
          content.push({ type: "text", text: lineText.slice(lastIndex, match.index) });
        }
        content.push({ type: "inlineCard", attrs: { url: match[1] } });
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < lineText.length) {
        content.push({ type: "text", text: lineText.slice(lastIndex) });
      }
      if (content.length === 0) {
        content.push({ type: "text", text: lineText });
      }
      return { type: "paragraph", content };
    });
    return { type: "doc", version: 1, content: paragraphs };
  }

  private async commentJira(ticketKey: string, comment: string): Promise<void> {
    const base = process.env.JIRA_BASE_URL!;
    const headers = { ...this.jiraAuth(), "Content-Type": "application/json" };
    await axios.post(
      `${base}/rest/api/3/issue/${ticketKey}/comment`,
      { body: this.textToJiraAdf(comment) },
      { headers },
    );
  }

  // --- GitHub ---

  private githubHeaders() {
    return {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      "User-Agent": "WorkerMill-AI-Worker",
    };
  }

  private async transitionGithub(statusName: string): Promise<void> {
    const repo = process.env.GITHUB_REPO!;
    const issueNumber = extractGithubIssueNumber(this.getEffectiveTicketKey());
    const stateMap: Record<string, string> = {
      done: "closed",
      closed: "closed",
      resolved: "closed",
      open: "open",
      reopened: "open",
      "in progress": "open",
    };
    const targetState = stateMap[statusName.toLowerCase()] || statusName.toLowerCase();
    if (!["open", "closed"].includes(targetState)) {
      console.warn(`[TicketOps] Invalid GitHub state: ${targetState}`);
      return;
    }
    await axios.patch(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}`,
      { state: targetState },
      { headers: this.githubHeaders() },
    );
  }

  private async commentGithub(ticketKey: string, comment: string): Promise<void> {
    const repo = process.env.GITHUB_REPO!;
    const issueNumber = extractGithubIssueNumber(ticketKey);
    await axios.post(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
      { body: comment },
      { headers: this.githubHeaders() },
    );
  }

  // --- Linear ---

  private async transitionLinear(statusName: string): Promise<void> {
    const apiKey = process.env.LINEAR_API_KEY!;
    const headers = {
      Authorization: apiKey,
      "Content-Type": "application/json",
    };

    const identifier = this.getEffectiveTicketKey();

    // Resolve issue UUID, current state, and team states in one query
    const queryRes = await axios.post(
      "https://api.linear.app/graphql",
      {
        query: `query GetIssueAndStates($identifier: String!) {
          issue(id: $identifier) {
            id
            state { id name }
            team { states { nodes { id name } } }
          }
        }`,
        variables: { identifier },
      },
      { headers },
    );

    const issue = queryRes.data?.data?.issue;
    if (!issue) throw new Error(`Linear issue not found: ${identifier}`);

    const teamStates: Array<{ id: string; name: string }> = issue.team?.states?.nodes || [];
    const targetState = teamStates.find(
      (s) => s.name.toLowerCase() === statusName.toLowerCase()
    );

    if (!targetState) {
      // Soft failure — status may not exist in this team (e.g. "Escalated")
      console.warn(`[TicketOps] Linear status "${statusName}" not found. Available: ${teamStates.map((s) => s.name).join(", ")}`);
      return;
    }

    if (targetState.id === issue.state?.id) return; // Already in target state

    await axios.post(
      "https://api.linear.app/graphql",
      {
        query: `mutation UpdateIssueState($issueId: String!, $stateId: String!) {
          issueUpdate(id: $issueId, input: { stateId: $stateId }) { success }
        }`,
        variables: { issueId: issue.id, stateId: targetState.id },
      },
      { headers },
    );
  }

  private async commentLinear(issueIdentifier: string, comment: string): Promise<void> {
    const apiKey = process.env.LINEAR_API_KEY!;
    const headers = {
      Authorization: apiKey,
      "Content-Type": "application/json",
    };

    // Resolve issue UUID from identifier
    const issueRes = await axios.post(
      "https://api.linear.app/graphql",
      {
        query: `query GetIssueId($identifier: String!) { issue(id: $identifier) { id } }`,
        variables: { identifier: issueIdentifier },
      },
      { headers },
    );
    const issueId = issueRes.data?.data?.issue?.id;
    if (!issueId) {
      throw new Error(`Linear issue not found: ${issueIdentifier}`);
    }

    // Create comment
    await axios.post(
      "https://api.linear.app/graphql",
      {
        query: `mutation CreateComment($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success } }`,
        variables: { issueId, body: comment },
      },
      { headers },
    );
  }

  // --- Internal (WorkerMill API) ---

  private async transitionInternal(statusName: string): Promise<void> {
    const apiBaseUrl = process.env.API_BASE_URL;
    const taskId = process.env.TASK_ID;
    const apiKey = process.env.ORG_API_KEY;
    await axios.post(
      `${apiBaseUrl}/api/tasks/${taskId}/ticket-transition`,
      { status: statusName },
      { headers: { "x-api-key": apiKey, "Content-Type": "application/json" } },
    );
  }

  private async commentInternal(comment: string): Promise<void> {
    const apiBaseUrl = process.env.API_BASE_URL;
    const taskId = process.env.TASK_ID;
    const apiKey = process.env.ORG_API_KEY;
    await axios.post(
      `${apiBaseUrl}/api/tasks/${taskId}/ticket-comment`,
      { comment },
      { headers: { "x-api-key": apiKey, "Content-Type": "application/json" } },
    );
  }
}

/**
 * Format helpers for rich GitHub Issue comments.
 * Used by worker milestone events when ticketSystem === "github".
 */
export const GitHubCommentFormat = {
  workStarted(model: string, branch: string): string {
    return [
      `## WorkerMill — Execution Started`,
      `**Worker:** ${model} | **Branch:** \`${branch}\``,
    ].join("\n");
  },

  prCreated(prNumber: number, prTitle: string, prUrl: string, filesChanged: string[]): string {
    const fileList = filesChanged.map((f) => `- \`${f}\``).join("\n");
    return [
      `## Pull Request Created`,
      `[#${prNumber} — ${prTitle}](${prUrl})`,
      ``,
      `<details>`,
      `<summary>Files changed (${filesChanged.length})</summary>`,
      ``,
      fileList,
      ``,
      `</details>`,
    ].join("\n");
  },

  qualityGatesPassed(results: Array<{ name: string; duration: string }>): string {
    const lines = results.map((r) => `✓ ${r.name} (${r.duration})`).join("\n");
    return [
      `## Quality Gates Passed`,
      ``,
      `<details>`,
      `<summary>Pre-commit checks (${results.length}/${results.length} passed)</summary>`,
      ``,
      "```",
      lines,
      "```",
      ``,
      `</details>`,
    ].join("\n");
  },

  qualityGatesFailed(results: Array<{ name: string; output: string; passed: boolean }>): string {
    const passed = results.filter((r) => r.passed).length;
    const lines = results.map((r) => `${r.passed ? "✓" : "✗"} ${r.name}`).join("\n");
    const failedDetails = results
      .filter((r) => !r.passed)
      .map((r) => `### ${r.name}\n\`\`\`\n${r.output.substring(0, 3000)}\n\`\`\``)
      .join("\n\n");
    return [
      `## Quality Gates Failed`,
      ``,
      `<details>`,
      `<summary>Pre-commit checks (${passed}/${results.length} passed)</summary>`,
      ``,
      "```",
      lines,
      "```",
      ``,
      failedDetails,
      ``,
      `</details>`,
    ].join("\n");
  },

  completed(summary: string, prUrl?: string): string {
    const parts = [`## Task Completed`, ``, summary];
    if (prUrl) parts.push(``, `**PR:** ${prUrl}`);
    return parts.join("\n");
  },

  failed(error: string, retriesRemaining: number): string {
    return [
      `## Task Failed`,
      ``,
      `<details>`,
      `<summary>Error details</summary>`,
      ``,
      "```",
      error.substring(0, 5000),
      "```",
      ``,
      `</details>`,
      ``,
      `**Retries remaining:** ${retriesRemaining}`,
    ].join("\n");
  },
};
