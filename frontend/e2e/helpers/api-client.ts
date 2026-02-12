import type { APIRequestContext } from "@playwright/test";

/**
 * Test API client for setting up and tearing down test data.
 *
 * Uses direct API calls rather than UI interactions for faster test setup.
 * All test data created through this client should be cleaned up after tests.
 */
export class APIClient {
  private baseUrl: string;
  private apiKey: string;
  private request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.baseUrl = process.env.BASE_URL || "http://localhost:5173";
    this.apiKey = process.env.E2E_API_KEY || "";
    this.request = request;
  }

  private get headers() {
    return {
      "Content-Type": "application/json",
      ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
    };
  }

  /**
   * Creates a Jira webhook payload for testing task creation.
   */
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
          description: options.description || `E2E test task created at ${new Date().toISOString()}`,
          issuetype: { name: "Task" },
          project: { key: options.issueKey.split("-")[0] },
          labels: (options.labels || ["workermill"]).map((name) => ({ name })),
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

  /**
   * Sends a simulated Jira webhook to create a task.
   */
  async sendJiraWebhook(payload: ReturnType<typeof this.createJiraWebhookPayload>) {
    const response = await this.request.post(`${this.baseUrl}/api/webhooks/jira`, {
      headers: this.headers,
      data: payload,
    });
    return response;
  }

  /**
   * Gets a task by ID.
   */
  async getTask(taskId: string) {
    const response = await this.request.get(`${this.baseUrl}/api/control-center/tasks/${taskId}`, {
      headers: this.headers,
    });
    if (response.ok()) {
      return response.json();
    }
    return null;
  }

  /**
   * Gets task by Jira key.
   */
  async getTaskByJiraKey(jiraKey: string) {
    const response = await this.request.get(`${this.baseUrl}/api/control-center/tasks`, {
      headers: this.headers,
      params: { jiraKey },
    });
    if (response.ok()) {
      const data = await response.json();
      return data.tasks?.find((t: { jiraKey: string }) => t.jiraKey === jiraKey);
    }
    return null;
  }

  /**
   * Posts a log entry to a task (simulates worker posting logs).
   */
  async postLog(taskId: string, content: string) {
    const response = await this.request.post(`${this.baseUrl}/api/tasks/${taskId}/logs`, {
      headers: this.headers,
      data: { content },
    });
    return response;
  }

  /**
   * Claims a task (simulates orchestrator claiming).
   * This is a test-only endpoint that must be enabled in dev environment.
   */
  async claimTask(taskId: string) {
    const response = await this.request.post(`${this.baseUrl}/api/test/tasks/${taskId}/claim`, {
      headers: this.headers,
    });
    return response;
  }

  /**
   * Completes a task (simulates worker completing).
   * This is a test-only endpoint that must be enabled in dev environment.
   */
  async completeTask(taskId: string, result: { result: string; prUrl?: string }) {
    const response = await this.request.post(`${this.baseUrl}/api/test/tasks/${taskId}/complete`, {
      headers: this.headers,
      data: result,
    });
    return response;
  }

  /**
   * Creates a task and claims it (for testing running tasks).
   */
  async createRunningTask(jiraKey?: string) {
    const key = jiraKey || `E2E-TEST-${Date.now()}`;
    const payload = this.createJiraWebhookPayload({
      issueKey: key,
      summary: `E2E Test Running Task ${Date.now()}`,
      labels: ["workermill"],
    });

    await this.sendJiraWebhook(payload);

    // Wait for task to be created
    let task = null;
    for (let i = 0; i < 10; i++) {
      task = await this.getTaskByJiraKey(key);
      if (task) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!task) {
      throw new Error(`Task with jiraKey ${key} was not created`);
    }

    // Claim the task
    await this.claimTask(task.id);

    return task;
  }

  /**
   * Deletes a test task and associated data.
   * This is a test-only endpoint that must be enabled in dev environment.
   */
  async deleteTestTask(taskId: string) {
    const response = await this.request.delete(`${this.baseUrl}/api/test/tasks/${taskId}`, {
      headers: this.headers,
    });
    return response;
  }

  /**
   * Cleans up all tasks created by E2E tests (matching E2E-TEST- prefix).
   */
  async cleanupTestTasks() {
    const response = await this.request.delete(`${this.baseUrl}/api/test/cleanup`, {
      headers: this.headers,
      params: { prefix: "E2E-TEST-" },
    });
    return response;
  }

  /**
   * Fails a task (simulates worker failure).
   * This is a test-only endpoint that must be enabled in dev environment.
   */
  async failTask(taskId: string, errorMessage?: string) {
    const response = await this.request.post(`${this.baseUrl}/api/test/tasks/${taskId}/fail`, {
      headers: this.headers,
      data: { error: errorMessage },
    });
    return response;
  }

  /**
   * Escalates a task with a blocker (simulates worker escalation).
   * This is a test-only endpoint that must be enabled in dev environment.
   */
  async escalateTask(
    taskId: string,
    blockerData: {
      blockerType: string;
      summary: string;
      details?: string;
    },
  ) {
    const response = await this.request.post(
      `${this.baseUrl}/api/test/tasks/${taskId}/escalate`,
      {
        headers: this.headers,
        data: blockerData,
      },
    );
    return response;
  }

  /**
   * Creates a GitHub Issues webhook payload for testing task creation.
   */
  createGithubIssuesWebhookPayload(options: {
    repo: string;
    issueNumber: number;
    title: string;
    body?: string;
    labels?: string[];
  }) {
    return {
      action: "labeled",
      issue: {
        number: options.issueNumber,
        title: options.title,
        body: options.body || `E2E test issue created at ${new Date().toISOString()}`,
        labels: (options.labels || ["workermill"]).map((name) => ({ name })),
        state: "open",
        html_url: `https://github.com/${options.repo}/issues/${options.issueNumber}`,
      },
      repository: {
        full_name: options.repo,
        html_url: `https://github.com/${options.repo}`,
      },
      label: {
        name: "workermill",
      },
    };
  }

  /**
   * Sends a simulated GitHub Issues webhook to create a task.
   */
  async sendGithubIssuesWebhook(
    payload: ReturnType<typeof this.createGithubIssuesWebhookPayload>,
  ) {
    const response = await this.request.post(
      `${this.baseUrl}/api/webhooks/github-issues`,
      {
        headers: this.headers,
        data: payload,
      },
    );
    return response;
  }

  /**
   * Checks whether test routes are available on the current environment.
   * Returns true if the /api/test/health endpoint responds successfully.
   */
  async checkTestRoutes(): Promise<boolean> {
    try {
      const response = await this.request.get(`${this.baseUrl}/api/test/health`, {
        headers: this.headers,
      });
      return response.ok();
    } catch {
      return false;
    }
  }
}
