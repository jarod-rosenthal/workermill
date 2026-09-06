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
import { boundedFetch, type HttpRequestOptions } from "./engine/http-request.js";

export interface TicketRequestOptions extends HttpRequestOptions {
  /** Model-directed operations must not turn failed remote writes into success. */
  strict?: boolean;
  /** Snapshot of credentials/repository context; never persisted or logged. */
  environment?: NodeJS.ProcessEnv;
}

/** Do not carry unrelated shell credentials into ticket calls or diagnostics. */
export function ticketEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ["GITHUB_TOKEN", "GITHUB_REPO", "JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "PARENT_JIRA_KEY", "LINEAR_API_KEY", "API_BASE_URL", "TASK_ID", "ORG_API_KEY"]) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

type TicketSystem = "jira" | "linear" | "github" | "internal";

export interface TicketSummary {
  key: string;
  title: string;
  status: string;
  labels?: string[];
}

/** Parse a Linear GraphQL response, throwing on GraphQL-level errors (which arrive with HTTP 200). */
function parseLinearResponse<T>(json: unknown): T {
  const res = json as { data?: T; errors?: Array<{ message: string; type?: string }> };
  if (res.errors && res.errors.length > 0) {
    const messages = res.errors.map((e) => e.message).join("; ");
    throw new Error(`Linear GraphQL error: ${messages}`);
  }
  return res.data as T;
}

/** Extract numeric issue number from GH-42, GH#42, GH42, #42, or bare 42 formats */
export function extractGithubIssueNumber(key: string): string {
  return key.replace(/^(GH[-#]?|#)/i, "");
}

export class TicketOps {
  private ticketKey: string;
  private ticketSystem: TicketSystem;
  private hasCredentials: boolean;
  private readonly environment: NodeJS.ProcessEnv;

  constructor(ticketKey?: string, ticketSystem?: string, private readonly requestOptions: TicketRequestOptions = {}) {
    this.environment = ticketEnvironment(requestOptions.environment);
    this.ticketKey = ticketKey || "";
    this.ticketSystem = (ticketSystem as TicketSystem) || "jira";

    // Check credentials based on ticket system
    switch (this.ticketSystem) {
      case "internal":
        // Internal board comments route through the WorkerMill API — no external creds needed
        this.hasCredentials = !!(
          this.environment.API_BASE_URL &&
          this.environment.TASK_ID &&
          this.environment.ORG_API_KEY &&
          this.ticketKey
        );
        break;
      case "linear":
        this.hasCredentials = !!(this.environment.LINEAR_API_KEY && this.ticketKey);
        break;
      case "github":
        this.hasCredentials = !!(
          this.environment.GITHUB_TOKEN &&
          this.environment.GITHUB_REPO &&
          this.ticketKey
        );
        break;
      case "jira":
      default:
        this.hasCredentials = !!(
          this.environment.JIRA_BASE_URL &&
          this.environment.JIRA_EMAIL &&
          this.environment.JIRA_API_TOKEN &&
          this.ticketKey
        );
        break;
    }
  }

  private request(url: string, init: RequestInit = {}): Promise<Response> {
    return boundedFetch(url, init, this.requestOptions);
  }

  /**
   * Get the effective ticket key — for child tasks with synthetic keys (e.g., OCS-408-S1),
   * use parent Jira key instead.
   */
  private getEffectiveTicketKey(): string {
    return this.environment.PARENT_JIRA_KEY || this.ticketKey;
  }

  /**
   * Transition the ticket to a new status.
   */
  async transitionTo(statusName: string): Promise<void> {
    this.requestOptions.signal?.throwIfAborted();
    if (!this.hasCredentials) {
      if (this.requestOptions.strict) throw new Error("Ticket credentials are unavailable");
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
      this.requestOptions.signal?.throwIfAborted();
      if (this.requestOptions.strict) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`[TicketOps] Transition failed: ${msg}`);
      // Continue - don't crash Epic
    }
  }

  /**
   * Post a comment to the ticket.
   */
  async postComment(comment: string): Promise<void> {
    this.requestOptions.signal?.throwIfAborted();
    if (!this.hasCredentials) {
      if (this.requestOptions.strict) throw new Error("Ticket credentials are unavailable");
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
      this.requestOptions.signal?.throwIfAborted();
      if (this.requestOptions.strict) throw error;
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
   * Check if credentials exist for a ticket system without requiring a specific ticket key.
   */
  static isSystemAvailable(ticketSystem: TicketSystem, environment: NodeJS.ProcessEnv = process.env): boolean {
    switch (ticketSystem) {
      case "internal":
        return !!(
          environment.API_BASE_URL &&
          environment.TASK_ID &&
          environment.ORG_API_KEY
        );
      case "linear":
        return !!environment.LINEAR_API_KEY;
      case "github":
        return !!(environment.GITHUB_TOKEN && environment.GITHUB_REPO);
      case "jira":
      default:
        return !!(
          environment.JIRA_BASE_URL &&
          environment.JIRA_EMAIL &&
          environment.JIRA_API_TOKEN
        );
    }
  }

  /**
   * List/search tickets for the configured tracker.
   */
  static async listTickets(
    ticketSystem: TicketSystem,
    query?: string,
    limit = 10,
    options: TicketRequestOptions = {},
  ): Promise<TicketSummary[]> {
    options.signal?.throwIfAborted();
    switch (ticketSystem) {
      case "github":
        return await this.listGithubIssues(query, limit, options);
      case "jira":
        return await this.listJiraIssues(query, limit, options);
      case "linear":
        return await this.listLinearIssues(query, limit, options);
      default:
        throw new Error(`list is not supported for ticket system: ${ticketSystem}`);
    }
  }

  /**
   * Fetch the ticket's title, body, and labels from the configured ticket system.
   * Returns null if credentials are missing or the fetch fails.
   */
  async fetchTicket(): Promise<{ title: string; body: string; labels?: string[] } | null> {
    this.requestOptions.signal?.throwIfAborted();
    if (!this.hasCredentials) return null;
    try {
      switch (this.ticketSystem) {
        case "github": return await this.fetchGithubIssue();
        case "jira": return await this.fetchJiraIssue();
        case "linear": return await this.fetchLinearIssue();
        default: return null;
      }
    } catch (error) {
      this.requestOptions.signal?.throwIfAborted();
      if (this.requestOptions.strict) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`[TicketOps] Failed to fetch ticket: ${msg}`);
      return null;
    }
  }

  private async fetchGithubIssue(): Promise<{ title: string; body: string; labels?: string[] }> {
    const repo = this.environment.GITHUB_REPO!;
    const issueNumber = extractGithubIssueNumber(this.ticketKey);
    const res = await this.request(`https://api.github.com/repos/${repo}/issues/${issueNumber}`, { headers: this.githubHeaders() });
    if (res.status === 401) throw new Error(`GitHub authentication failed — ensure GITHUB_TOKEN is set or run \`gh auth login\``);
    if (res.status === 403) throw new Error(`GitHub permission denied — your token may not have access to ${repo}`);
    if (res.status === 404) throw new Error(`GitHub issue ${repo}#${issueNumber} not found — verify the issue exists`);
    if (!res.ok) throw new Error(`GitHub API returned ${res.status} ${res.statusText}`);
    const data = await res.json() as { title: string; body: string | null; labels?: { name: string }[] };
    return { title: data.title, body: data.body || "", labels: data.labels?.map((l) => l.name) };
  }

  private async fetchJiraIssue(): Promise<{ title: string; body: string; labels?: string[] }> {
    const base = this.environment.JIRA_BASE_URL!;
    const key = this.getEffectiveTicketKey();
    const headers = { ...this.jiraAuth(), "Content-Type": "application/json" };
    const res = await this.request(`${base}/rest/api/3/issue/${key}?fields=summary,description,labels`, { headers });
    if (res.status === 401) throw new Error(`Jira authentication failed — check your email and API token in /setup`);
    if (res.status === 403) throw new Error(`Jira permission denied — your API token may not have access to ${key}`);
    if (res.status === 404) throw new Error(`Jira issue ${key} not found — verify the key is correct and the project exists`);
    if (!res.ok) throw new Error(`Jira API returned ${res.status} ${res.statusText}`);
    const data = await res.json() as { fields: { summary: string; description: unknown; labels?: string[] } };
    const body = this.adfToPlainText(data.fields.description);
    return { title: data.fields.summary, body, labels: data.fields.labels };
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
    const apiKey = this.environment.LINEAR_API_KEY!;
    const headers = { Authorization: apiKey, "Content-Type": "application/json" };
    const identifier = this.getEffectiveTicketKey();
    const res = await this.request("https://api.linear.app/graphql", {
      method: "POST", headers,
      body: JSON.stringify({
        query: `query GetIssue($identifier: String!) { issue(id: $identifier) { title description labels { nodes { name } } } }`,
        variables: { identifier },
      }),
    });
    if (res.status === 401) throw new Error(`Linear authentication failed — check your API key in /setup`);
    if (!res.ok) throw new Error(`Linear API returned ${res.status} ${res.statusText}`);
    const result = parseLinearResponse<{ issue?: { title: string; description: string | null; labels?: { nodes: { name: string }[] } } }>(await res.json());
    const issue = result?.issue;
    if (!issue) throw new Error(`Linear issue ${identifier} not found — verify the identifier and that your API key has access to this team`);
    return { title: issue.title, body: issue.description || "", labels: issue.labels?.nodes?.map((l) => l.name) };
  }

  private static githubHeaders(environment: NodeJS.ProcessEnv = process.env) {
    return {
      Authorization: `Bearer ${environment.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      "User-Agent": "WorkerMill-AI-Worker",
    };
  }

  private static jiraAuth(environment: NodeJS.ProcessEnv = process.env): { Authorization: string } {
    const email = environment.JIRA_EMAIL!;
    const token = environment.JIRA_API_TOKEN!;
    return {
      Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
    };
  }

  private static async listGithubIssues(query?: string, limit = 10, options: TicketRequestOptions = {}): Promise<TicketSummary[]> {
    const environment = options.environment ?? process.env;
    const request = (url: string, init: RequestInit) => boundedFetch(url, init, options);
    const repo = environment.GITHUB_REPO!;
    const trimmed = query?.trim();
    let res: Response;
    if (trimmed) {
      const q = encodeURIComponent(`repo:${repo} is:issue ${trimmed}`);
      res = await request(`https://api.github.com/search/issues?q=${q}&per_page=${limit}`, {
        headers: this.githubHeaders(environment),
      });
      if (res.status === 401) throw new Error("GitHub authentication failed while listing issues");
      if (!res.ok) throw new Error(`GitHub issue search failed — ${res.status} ${res.statusText}`);
      const data = await res.json() as {
        items?: Array<{ number: number; title: string; state: string; labels?: Array<{ name: string }> }>;
      };
      return (data.items || []).map((issue) => ({
        key: `#${issue.number}`,
        title: issue.title,
        status: issue.state,
        labels: issue.labels?.map((label) => label.name),
      }));
    }

    res = await request(
      `https://api.github.com/repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=${limit}`,
      { headers: this.githubHeaders(environment) },
    );
    if (res.status === 401) throw new Error("GitHub authentication failed while listing issues");
    if (!res.ok) throw new Error(`GitHub issue list failed — ${res.status} ${res.statusText}`);
    const data = await res.json() as Array<{
      number: number;
      title: string;
      state: string;
      pull_request?: unknown;
      labels?: Array<{ name: string }>;
    }>;
    return data
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        key: `#${issue.number}`,
        title: issue.title,
        status: issue.state,
        labels: issue.labels?.map((label) => label.name),
      }));
  }

  private static async listJiraIssues(query?: string, limit = 10, options: TicketRequestOptions = {}): Promise<TicketSummary[]> {
    const environment = options.environment ?? process.env;
    const request = (url: string, init: RequestInit) => boundedFetch(url, init, options);
    const base = environment.JIRA_BASE_URL!;
    const headers = {
      ...this.jiraAuth(environment),
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    const trimmed = query?.trim();
    const escaped = trimmed?.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const jql = escaped ? `text ~ "${escaped}" ORDER BY updated DESC` : "ORDER BY updated DESC";
    const res = await request(`${base}/rest/api/3/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jql,
        maxResults: limit,
        fields: ["summary", "status", "labels"],
      }),
    });
    if (res.status === 401) throw new Error("Jira authentication failed while listing issues");
    if (!res.ok) throw new Error(`Jira issue search failed — ${res.status} ${res.statusText}`);
    const data = await res.json() as {
      issues?: Array<{
        key: string;
        fields: {
          summary: string;
          status?: { name: string };
          labels?: string[];
        };
      }>;
    };
    return (data.issues || []).map((issue) => ({
      key: issue.key,
      title: issue.fields.summary,
      status: issue.fields.status?.name || "unknown",
      labels: issue.fields.labels || [],
    }));
  }

  private static async listLinearIssues(query?: string, limit = 10, options: TicketRequestOptions = {}): Promise<TicketSummary[]> {
    const environment = options.environment ?? process.env;
    const request = (url: string, init: RequestInit) => boundedFetch(url, init, options);
    const headers = {
      Authorization: environment.LINEAR_API_KEY!,
      "Content-Type": "application/json",
    };
    const trimmed = query?.trim();
    const graphqlQuery = trimmed
      ? `query SearchIssues($query: String!, $limit: Int!) {
          issues(
            first: $limit
            filter: {
              or: [
                { identifier: { containsIgnoreCase: $query } }
                { title: { containsIgnoreCase: $query } }
                { description: { containsIgnoreCase: $query } }
              ]
            }
          ) {
            nodes {
              identifier
              title
              state { name }
              labels { nodes { name } }
            }
          }
        }`
      : `query RecentIssues($limit: Int!) {
          issues(first: $limit) {
            nodes {
              identifier
              title
              state { name }
              labels { nodes { name } }
            }
          }
        }`;
    const res = await request("https://api.linear.app/graphql", {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: graphqlQuery,
        variables: trimmed ? { query: trimmed, limit } : { limit },
      }),
    });
    if (res.status === 401) throw new Error("Linear authentication failed while listing issues");
    if (!res.ok) throw new Error(`Linear issue search failed — ${res.status} ${res.statusText}`);
    const data = parseLinearResponse<{
      issues?: {
        nodes?: Array<{
          identifier: string;
          title: string;
          state?: { name: string };
          labels?: { nodes?: Array<{ name: string }> };
        }>;
      };
    }>(await res.json());
    return (data.issues?.nodes || []).map((issue) => ({
      key: issue.identifier,
      title: issue.title,
      status: issue.state?.name || "unknown",
      labels: issue.labels?.nodes?.map((label) => label.name) || [],
    }));
  }

  /**
   * Validate credentials for a ticket system without creating a TicketOps instance.
   * Returns null on success, or an error message string on failure.
   */
  static async validateCredentials(
    system: "github" | "jira" | "linear",
    config: { baseUrl?: string; email?: string; apiToken?: string; apiKey?: string; githubToken?: string; githubRepo?: string },
    options: TicketRequestOptions = {},
  ): Promise<string | null> {
    const request = (url: string, init: RequestInit) => boundedFetch(url, init, options);
    try {
      switch (system) {
        case "github": {
          const res = await request(`https://api.github.com/repos/${config.githubRepo}`, {
            headers: { Authorization: `Bearer ${config.githubToken}`, Accept: "application/vnd.github+json", "User-Agent": "WorkerMill-CLI" },
          });
          if (!res.ok) return `GitHub API returned ${res.status}: ${res.statusText}`;
          return null;
        }
        case "jira": {
          const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
          const res = await request(`${config.baseUrl}/rest/api/3/myself`, {
            headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
          });
          if (!res.ok) return `Jira API returned ${res.status}: ${res.statusText}`;
          return null;
        }
        case "linear": {
          const res = await request("https://api.linear.app/graphql", {
            method: "POST",
            headers: { Authorization: config.apiKey!, "Content-Type": "application/json" },
            body: JSON.stringify({ query: "{ viewer { id name } }" }),
          });
          if (!res.ok) return `Linear API returned ${res.status}: ${res.statusText}`;
          try {
            const data = parseLinearResponse<{ viewer?: { id: string } }>(await res.json());
            if (!data?.viewer?.id) return "Linear API key is invalid";
          } catch (e) {
            return e instanceof Error ? e.message : "Linear API key is invalid";
          }
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
    return TicketOps.jiraAuth(this.environment);
  }

  private async transitionJira(statusName: string): Promise<void> {
    const base = this.environment.JIRA_BASE_URL!;
    const key = this.getEffectiveTicketKey();
    const headers = { ...this.jiraAuth(), "Content-Type": "application/json" };

    // Get available transitions
    const res = await this.request(
      `${base}/rest/api/3/issue/${key}/transitions`,
      { headers },
    );
    if (res.status === 401) throw new Error(`Jira authentication failed when fetching transitions for ${key}`);
    if (res.status === 404) throw new Error(`Jira issue ${key} not found when fetching transitions`);
    if (!res.ok) throw new Error(`Jira transitions API returned ${res.status} for ${key}`);
    const data = await res.json() as { transitions?: Array<{ id: string; name: string; to: { name: string } }> };
    const transitions = data.transitions || [];

    // Find matching transition (case-insensitive)
    const target = transitions.find(
      (t: { name: string; to: { name: string } }) =>
        t.name.toLowerCase() === statusName.toLowerCase() ||
        t.to.name.toLowerCase() === statusName.toLowerCase(),
    );

    if (!target) {
      if (this.requestOptions.strict) throw new Error(`Jira transition "${statusName}" is unavailable`);
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

    const transitionRes = await this.request(
      `${base}/rest/api/3/issue/${key}/transitions`,
      { method: "POST", headers, body: JSON.stringify({ transition: { id: target.id } }) },
    );
    if (!transitionRes.ok) throw new Error(`Jira transition to "${statusName}" failed for ${key} — ${transitionRes.status} ${transitionRes.statusText}`);
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
    const base = this.environment.JIRA_BASE_URL!;
    const headers = { ...this.jiraAuth(), "Content-Type": "application/json" };
    const res = await this.request(
      `${base}/rest/api/3/issue/${ticketKey}/comment`,
      { method: "POST", headers, body: JSON.stringify({ body: this.textToJiraAdf(comment) }) },
    );
    if (res.status === 401) throw new Error(`Jira authentication failed when posting comment to ${ticketKey}`);
    if (!res.ok) throw new Error(`Jira comment failed for ${ticketKey} — ${res.status} ${res.statusText}`);
  }

  // --- GitHub ---

  private githubHeaders() {
    return TicketOps.githubHeaders(this.environment);
  }

  private async transitionGithub(statusName: string): Promise<void> {
    const repo = this.environment.GITHUB_REPO!;
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
      if (this.requestOptions.strict) throw new Error(`Invalid GitHub state: ${targetState}`);
      logger.warn(`[TicketOps] Invalid GitHub state: ${targetState}`);
      return;
    }
    const res = await this.request(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}`,
      { method: "PATCH", headers: this.githubHeaders(), body: JSON.stringify({ state: targetState }) },
    );
    if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
  }

  private async commentGithub(ticketKey: string, comment: string): Promise<void> {
    const repo = this.environment.GITHUB_REPO!;
    const issueNumber = extractGithubIssueNumber(ticketKey);
    const res = await this.request(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
      { method: "POST", headers: this.githubHeaders(), body: JSON.stringify({ body: comment }) },
    );
    if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
  }

  // --- Linear ---

  private async transitionLinear(statusName: string): Promise<void> {
    const apiKey = this.environment.LINEAR_API_KEY!;
    const headers = {
      Authorization: apiKey,
      "Content-Type": "application/json",
    };

    const identifier = this.getEffectiveTicketKey();

    // Resolve issue UUID, current state, and team states in one query
    const queryRes = await this.request(
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
    if (queryRes.status === 401) throw new Error(`Linear authentication failed when transitioning ${identifier}`);
    if (!queryRes.ok) throw new Error(`Linear API returned ${queryRes.status} when fetching ${identifier} for transition`);
    const queryData = parseLinearResponse<{ issue?: { id: string; state?: { id: string; name: string }; team?: { states: { nodes: Array<{ id: string; name: string }> } } } }>(await queryRes.json());

    const issue = queryData?.issue;
    if (!issue) throw new Error(`Linear issue ${identifier} not found when attempting transition to "${statusName}"`);

    const teamStates: Array<{ id: string; name: string }> = issue.team?.states?.nodes || [];
    const targetState = teamStates.find(
      (s) => s.name.toLowerCase() === statusName.toLowerCase()
    );

    if (!targetState) {
      if (this.requestOptions.strict) throw new Error(`Linear status "${statusName}" is unavailable`);
      // Soft failure — status may not exist in this team (e.g. "Escalated")
      logger.warn(`[TicketOps] Linear status "${statusName}" not found. Available: ${teamStates.map((s) => s.name).join(", ")}`);
      return;
    }

    if (targetState.id === issue.state?.id) return; // Already in target state

    const updateRes = await this.request(
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
    if (!updateRes.ok) throw new Error(`Linear transition to "${statusName}" failed for ${identifier} — ${updateRes.status}`);
    const updateData = parseLinearResponse<{ issueUpdate?: { success: boolean } }>(await updateRes.json());
    if (!updateData?.issueUpdate?.success) {
      if (this.requestOptions.strict) throw new Error("Linear issue update was not confirmed");
      logger.warn(`[TicketOps] Linear issueUpdate returned success: false for ${identifier}`);
    }
  }

  private async commentLinear(issueIdentifier: string, comment: string): Promise<void> {
    const apiKey = this.environment.LINEAR_API_KEY!;
    const headers = {
      Authorization: apiKey,
      "Content-Type": "application/json",
    };

    // Resolve issue UUID from identifier
    const issueRes = await this.request(
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
    if (issueRes.status === 401) throw new Error(`Linear authentication failed when posting comment to ${issueIdentifier}`);
    if (!issueRes.ok) throw new Error(`Linear API returned ${issueRes.status} when resolving ${issueIdentifier} for comment`);
    const issueData = parseLinearResponse<{ issue?: { id: string } }>(await issueRes.json());
    const issueId = issueData?.issue?.id;
    if (!issueId) {
      throw new Error(`Linear issue ${issueIdentifier} not found — cannot post comment`);
    }

    // Create comment
    const commentRes = await this.request(
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
    if (!commentRes.ok) throw new Error(`Linear comment creation failed for ${issueIdentifier} — ${commentRes.status}`);
    const commentData = parseLinearResponse<{ commentCreate?: { success: boolean } }>(await commentRes.json());
    if (!commentData?.commentCreate?.success) {
      if (this.requestOptions.strict) throw new Error("Linear comment creation was not confirmed");
      logger.warn(`[TicketOps] Linear comment creation returned success: false for ${issueIdentifier}`);
    }
  }

  // --- Internal (WorkerMill API) ---

  private async transitionInternal(statusName: string): Promise<void> {
    const apiBaseUrl = this.environment.API_BASE_URL;
    const taskId = this.environment.TASK_ID;
    const apiKey = this.environment.ORG_API_KEY;
    const res = await this.request(
      `${apiBaseUrl}/api/tasks/${taskId}/ticket-transition`,
      { method: "POST", headers: { "x-api-key": apiKey!, "Content-Type": "application/json" }, body: JSON.stringify({ status: statusName }) },
    );
    if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
  }

  private async commentInternal(comment: string): Promise<void> {
    const apiBaseUrl = this.environment.API_BASE_URL;
    const taskId = this.environment.TASK_ID;
    const apiKey = this.environment.ORG_API_KEY;
    const res = await this.request(
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
