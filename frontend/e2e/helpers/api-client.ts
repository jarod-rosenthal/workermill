import type { APIRequestContext } from "@playwright/test";

/**
 * E2E test API client.
 *
 * Uses ONLY real production endpoints — no test-only routes.
 * All data creation goes through the same paths real users and workers use.
 */
export class APIClient {
  private apiURL: string;
  private request: APIRequestContext;

  constructor(request: APIRequestContext) {
    const baseURL = process.env.BASE_URL || "http://localhost:5173";
    // API is on :3001 locally, same host in production (proxied via /api)
    this.apiURL = baseURL.includes("localhost")
      ? baseURL.replace(/:\d+$/, ":3001")
      : baseURL;
    this.request = request;
  }

  // ── Webhooks (real production endpoints) ─────────────────────────

  createJiraWebhookPayload(options: {
    issueKey: string;
    summary: string;
    labels?: string[];
    description?: string;
  }) {
    return {
      webhookEvent: "jira:issue_updated",
      issue_event_type_name: "issue_generic",
      timestamp: Date.now(),
      issue: {
        key: options.issueKey,
        fields: {
          summary: options.summary,
          description:
            options.description ||
            `E2E test task created at ${new Date().toISOString()}`,
          issuetype: { name: "Task" },
          project: { key: options.issueKey.split("-")[0] },
          labels: options.labels || ["workermill"],
          status: { name: "To Do" },
        },
      },
      changelog: {
        items: [
          {
            field: "labels",
            fromString: "",
            toString: (options.labels || ["workermill"]).join(" "),
          },
        ],
      },
    };
  }

  async sendJiraWebhook(
    payload: ReturnType<typeof this.createJiraWebhookPayload>,
  ) {
    // Use org-scoped webhook endpoint (legacy /api/webhooks/jira was removed)
    // Local dev uses slug "local", production uses the org's actual slug
    const orgSlug = process.env.E2E_ORG_SLUG || "local";
    return this.request.post(`${this.apiURL}/api/webhooks/${orgSlug}/jira`, {
      data: payload,
    });
  }

  // ── Task queries (authenticated — uses Playwright storage state) ──

  async getTasks(params?: { status?: string; jiraKey?: string }) {
    const response = await this.request.get(
      `${this.apiURL}/api/control-center`,
      { params },
    );
    if (response.ok()) return response.json();
    return null;
  }

  async getTaskByJiraKey(jiraKey: string) {
    const data = await this.getTasks({ jiraKey });
    return data?.tasks?.find(
      (t: { jiraKey?: string; jiraIssueKey?: string }) =>
        t.jiraKey === jiraKey || t.jiraIssueKey === jiraKey,
    );
  }

  async getTask(taskId: string) {
    const response = await this.request.get(
      `${this.apiURL}/api/control-center/tasks/${taskId}`,
    );
    if (response.ok()) return response.json();
    return null;
  }

  // ── Task actions (authenticated — real admin endpoints) ──────────

  async cancelTask(taskId: string) {
    return this.request.post(`${this.apiURL}/api/tasks/${taskId}/cancel`);
  }

  async retryTask(taskId: string) {
    return this.request.post(`${this.apiURL}/api/tasks/${taskId}/retry`);
  }

  async deleteTask(taskId: string) {
    return this.request.delete(`${this.apiURL}/api/tasks/${taskId}`);
  }

}
