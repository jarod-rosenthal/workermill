/**
 * Ticket Operations for Epic Executor
 *
 * Posts comments and transitions tickets (Jira, Linear, GitHub, Internal).
 * All operations are non-blocking - ticket failures don't crash Epic.
 *
 * Previously shelled out to /app/execution-compiled/ticket/*.js (Docker-only paths).
 * Now inlines the HTTP calls directly so it works in both Docker and native Node.js.
 */

import * as logger from "./logger.js";

type TicketSystem = "jira" | "linear" | "github" | "internal";

/** Extract numeric issue number from GH-42, #42, or bare 42 formats */
export function extractGithubIssueNumber(key: string): string {
  return key.replace(/^(GH-|#)/i, "");
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
      logger.debug("[TicketOps] Skipping transition - credentials not available");
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
      logger.info(`[TicketOps] Transitioned to "${statusName}" (${this.ticketSystem})`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`[TicketOps] Transition failed: ${msg}`);
      // Continue - don't crash Epic
    }
  }

  /**
   * Post a comment to the ticket.
   */
  async postComment(comment: string): Promise<void> {
    if (!this.hasCredentials) {
      logger.debug("[TicketOps] Skipping comment - credentials not available");
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
      logger.info(`[TicketOps] Posted comment (${this.ticketSystem})`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`[TicketOps] Comment failed: ${msg}`);
      // Continue - don't crash Epic
    }
  }

  /**
   * Check if ticket integration is available.
   */
  isAvailable(): boolean {
    return this.hasCredentials;
  }

  /**
   * Fetch the ticket's title, body, and labels from the configured ticket system.
   * Returns null if credentials are missing or the fetch fails.
   */
  async fetchTicket(): Promise<{ title: string; body: string; labels?: string[] } | null> {
    if (!this.hasCredentials) return null;
    try {
      switch (this.ticketSystem) {
        case "github": return await this.fetchGithubIssue();
        case "jira": return await this.fetchJiraIssue();
        case "linear": return await this.fetchLinearIssue();
        default: return null;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`[TicketOps] Failed to fetch ticket: ${msg}`);
      return null;
    }
  }

  private async fetchGithubIssue(): Promise<{ title: string; body: string; labels?: string[] }> {
    const repo = process.env.GITHUB_REPO!;
    const issueNumber = extractGithubIssueNumber(this.ticketKey);
    const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, { headers: this.githubHeaders() });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
    const data = await res.json() as { title: string; body: string | null; labels?: { name: string }[] };
    return { title: data.title, body: data.body || "", labels: data.labels?.map((l) => l.name) };
  }

  private async fetchJiraIssue(): Promise<{ title: string; body: string; labels?: string[] }> {
    const base = process.env.JIRA_BASE_URL!;
    const key = this.getEffectiveTicketKey();
    const headers = { ...this.jiraAuth(), "Content-Type": "application/json" };
    const res = await fetch(`${base}/rest/api/3/issue/${key}?fields=summary,description,labels`, { headers });
    if (!res.ok) throw new Error(`Jira API ${res.status}: ${res.statusText}`);
    const data = await res.json() as { fields: { summary: string; description: unknown; labels?: { name: string }[] } };
    const body = this.adfToPlainText(data.fields.description);
    return { title: data.fields.summary, body, labels: data.fields.labels?.map((l) => l.name) };
  }

  private adfToPlainText(adf: unknown): string {
    if (!adf || typeof adf !== "object") return "";
    const doc = adf as { content?: unknown[] };
    if (!doc.content) return "";
    const extractText = (node: unknown): string => {
      if (!node || typeof node !== "object") return "";
      const n = node as { type?: string; text?: string; content?: unknown[] };
      if (n.type === "text" && n.text) return n.text;
      if (n.content) return n.content.map(extractText).join("");
      return "";
    };
    return doc.content.map((block) => extractText(block)).filter(Boolean).join("\n\n");
  }

  private async fetchLinearIssue(): Promise<{ title: string; body: string; labels?: string[] }> {
    const apiKey = process.env.LINEAR_API_KEY!;
    const headers = { Authorization: apiKey, "Content-Type": "application/json" };
    const identifier = this.getEffectiveTicketKey();
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST", headers,
      body: JSON.stringify({
        query: `query GetIssue($identifier: String!) { issue(id: $identifier) { title description labels { nodes { name } } } }`,
        variables: { identifier },
      }),
    });
    if (!res.ok) throw new Error(`Linear API ${res.status}: ${res.statusText}`);
    const result = await res.json() as { data?: { issue?: { title: string; description: string | null; labels?: { nodes: { name: string }[] } } } };
    const issue = result.data?.issue;
    if (!issue) throw new Error(`Linear issue not found: ${identifier}`);
    return { title: issue.title, body: issue.description || "", labels: issue.labels?.nodes?.map((l) => l.name) };
  }

  /**
   * Validate credentials for a ticket system without creating a TicketOps instance.
   * Returns null on success, or an error message string on failure.
   */
  static async validateCredentials(
    system: "github" | "jira" | "linear",
    config: { baseUrl?: string; email?: string; apiToken?: string; apiKey?: string; githubToken?: string; githubRepo?: string },
  ): Promise<string | null> {
    try {
      switch (system) {
        case "github": {
          const res = await fetch(`https://api.github.com/repos/${config.githubRepo}`, {
            headers: { Authorization: `Bearer ${config.githubToken}`, Accept: "application/vnd.github+json", "User-Agent": "WorkerMill-CLI" },
          });
          if (!res.ok) return `GitHub API returned ${res.status}: ${res.statusText}`;
          return null;
        }
        case "jira": {
          const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
          const res = await fetch(`${config.baseUrl}/rest/api/3/myself`, {
            headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
          });
          if (!res.ok) return `Jira API returned ${res.status}: ${res.statusText}`;
          return null;
        }
        case "linear": {
          const res = await fetch("https://api.linear.app/graphql", {
            method: "POST",
            headers: { Authorization: config.apiKey!, "Content-Type": "application/json" },
            body: JSON.stringify({ query: "{ viewer { id name } }" }),
          });
          if (!res.ok) return `Linear API returned ${res.status}: ${res.statusText}`;
          const data = await res.json() as { data?: { viewer?: { id: string } } };
          if (!data.data?.viewer?.id) return "Linear API key is invalid";
          return null;
        }
        default: return `Unknown ticket system: ${system}`;
      }
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
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
    const res = await fetch(
      `${base}/rest/api/3/issue/${key}/transitions`,
      { headers },
    );
    if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
    const data = await res.json() as { transitions?: Array<{ id: string; name: string; to: { name: string } }> };
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
        logger.info(
          `[TicketOps] "${statusName}" not in Jira workflow — ticket stays in current status`,
        );
        return;
      }
      logger.warn(
        `[TicketOps] Transition "${statusName}" not available. Available: ${transitions.map((t: { name: string }) => t.name).join(", ")}`,
      );
      return;
    }

    const transitionRes = await fetch(
      `${base}/rest/api/3/issue/${key}/transitions`,
      { method: "POST", headers, body: JSON.stringify({ transition: { id: target.id } }) },
    );
    if (!transitionRes.ok) throw new Error(`${transitionRes.status}: ${transitionRes.statusText}`);
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
    const res = await fetch(
      `${base}/rest/api/3/issue/${ticketKey}/comment`,
      { method: "POST", headers, body: JSON.stringify({ body: this.textToJiraAdf(comment) }) },
    );
    if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
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
      logger.warn(`[TicketOps] Invalid GitHub state: ${targetState}`);
      return;
    }
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}`,
      { method: "PATCH", headers: this.githubHeaders(), body: JSON.stringify({ state: targetState }) },
    );
    if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
  }

  private async commentGithub(ticketKey: string, comment: string): Promise<void> {
    const repo = process.env.GITHUB_REPO!;
    const issueNumber = extractGithubIssueNumber(ticketKey);
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
      { method: "POST", headers: this.githubHeaders(), body: JSON.stringify({ body: comment }) },
    );
    if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
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
    const queryRes = await fetch(
      "https://api.linear.app/graphql",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: `query GetIssueAndStates($identifier: String!) {
          issue(id: $identifier) {
            id
            state { id name }
            team { states { nodes { id name } } }
          }
        }`,
          variables: { identifier },
        }),
      },
    );
    if (!queryRes.ok) throw new Error(`${queryRes.status}: ${queryRes.statusText}`);
    const queryData = await queryRes.json() as { data?: { issue?: { id: string; state?: { id: string; name: string }; team?: { states: { nodes: Array<{ id: string; name: string }> } } } } };

    const issue = queryData.data?.issue;
    if (!issue) throw new Error(`Linear issue not found: ${identifier}`);

    const teamStates: Array<{ id: string; name: string }> = issue.team?.states?.nodes || [];
    const targetState = teamStates.find(
      (s) => s.name.toLowerCase() === statusName.toLowerCase()
    );

    if (!targetState) {
      // Soft failure — status may not exist in this team (e.g. "Escalated")
      logger.warn(`[TicketOps] Linear status "${statusName}" not found. Available: ${teamStates.map((s) => s.name).join(", ")}`);
      return;
    }

    if (targetState.id === issue.state?.id) return; // Already in target state

    const updateRes = await fetch(
      "https://api.linear.app/graphql",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: `mutation UpdateIssueState($issueId: String!, $stateId: String!) {
          issueUpdate(id: $issueId, input: { stateId: $stateId }) { success }
        }`,
          variables: { issueId: issue.id, stateId: targetState.id },
        }),
      },
    );
    if (!updateRes.ok) throw new Error(`${updateRes.status}: ${updateRes.statusText}`);
  }

  private async commentLinear(issueIdentifier: string, comment: string): Promise<void> {
    const apiKey = process.env.LINEAR_API_KEY!;
    const headers = {
      Authorization: apiKey,
      "Content-Type": "application/json",
    };

    // Resolve issue UUID from identifier
    const issueRes = await fetch(
      "https://api.linear.app/graphql",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: `query GetIssueId($identifier: String!) { issue(id: $identifier) { id } }`,
          variables: { identifier: issueIdentifier },
        }),
      },
    );
    if (!issueRes.ok) throw new Error(`${issueRes.status}: ${issueRes.statusText}`);
    const issueData = await issueRes.json() as { data?: { issue?: { id: string } } };
    const issueId = issueData.data?.issue?.id;
    if (!issueId) {
      throw new Error(`Linear issue not found: ${issueIdentifier}`);
    }

    // Create comment
    const commentRes = await fetch(
      "https://api.linear.app/graphql",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: `mutation CreateComment($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success } }`,
          variables: { issueId, body: comment },
        }),
      },
    );
    if (!commentRes.ok) throw new Error(`${commentRes.status}: ${commentRes.statusText}`);
  }

  // --- Internal (WorkerMill API) ---

  private async transitionInternal(statusName: string): Promise<void> {
    const apiBaseUrl = process.env.API_BASE_URL;
    const taskId = process.env.TASK_ID;
    const apiKey = process.env.ORG_API_KEY;
    const res = await fetch(
      `${apiBaseUrl}/api/tasks/${taskId}/ticket-transition`,
      { method: "POST", headers: { "x-api-key": apiKey!, "Content-Type": "application/json" }, body: JSON.stringify({ status: statusName }) },
    );
    if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
  }

  private async commentInternal(comment: string): Promise<void> {
    const apiBaseUrl = process.env.API_BASE_URL;
    const taskId = process.env.TASK_ID;
    const apiKey = process.env.ORG_API_KEY;
    const res = await fetch(
      `${apiBaseUrl}/api/tasks/${taskId}/ticket-comment`,
      { method: "POST", headers: { "x-api-key": apiKey!, "Content-Type": "application/json" }, body: JSON.stringify({ comment }) },
    );
    if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
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
