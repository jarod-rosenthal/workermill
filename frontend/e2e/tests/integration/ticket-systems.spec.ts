import { test, expect } from "@playwright/test";
import { APIClient } from "../../helpers/api-client";
import { detectIntegrations, type IntegrationConfig } from "./helpers/integration-config";
import { createIntKey } from "./helpers/task-helpers";

const isLocal = !process.env.BASE_URL;
const API_URL = "http://localhost:3001";

test.describe("Ticket System Integration", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!isLocal, "Integration tests only run against local stack");

  let api: APIClient;
  let config: IntegrationConfig;
  const createdTaskIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    config = await detectIntegrations(request);
  });

  test.beforeEach(async ({ request }) => {
    api = new APIClient(request);
  });

  test.afterAll(async ({ request }) => {
    // Cancel any running tasks we created
    for (const id of createdTaskIds) {
      try { await api.cancelTask(id); } catch { /* best effort */ }
    }
  });

  test("Jira webhook creates task with correct metadata", async ({ request }) => {
    test.skip(!config.hasJira, "Jira not configured");
    test.setTimeout(30_000);

    const jiraKey = createIntKey();
    const payload = api.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: "Jira integration test",
      description: "Testing Jira webhook handling",
    });

    const response = await api.sendJiraWebhook(payload);
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.taskId).toBeTruthy();
    expect(body.status).toBe("created");
    createdTaskIds.push(body.taskId);

    // Cancel immediately — we just need to verify creation
    await api.cancelTask(body.taskId);
  });

  test("Linear webhook creates task", async ({ request }) => {
    test.skip(!config.hasLinear, "Linear not configured");
    test.setTimeout(30_000);

    const orgSlug = config.originalSettings.slug || "local";
    const response = await request.post(`${API_URL}/api/webhooks/${orgSlug}/linear`, {
      data: {
        type: "Issue",
        action: "update",
        data: {
          id: `linear-test-${Date.now()}`,
          identifier: `INT-${Date.now()}`,
          title: "Linear integration test",
          description: "Testing Linear webhook handling",
          state: { name: "In Progress" },
          labels: { nodes: [{ name: "workermill" }] },
          team: { key: "INT" },
        },
      },
    });

    // Linear webhook should accept the payload (200 or 201)
    expect(response.status()).toBeLessThan(300);
  });

  test("GitHub Issues webhook creates task", async ({ request }) => {
    test.skip(!config.hasGitHubIssues, "GitHub Issues not configured");
    test.setTimeout(30_000);

    const orgSlug = config.originalSettings.slug || "local";
    const response = await request.post(`${API_URL}/api/webhooks/${orgSlug}/github-issues`, {
      data: {
        action: "labeled",
        issue: {
          number: Date.now(),
          title: "GitHub Issues integration test",
          body: "Testing GitHub Issues webhook handling",
          labels: [{ name: "workermill" }],
          state: "open",
          user: { login: "test-user" },
        },
        repository: {
          full_name: "jarod-rosenthal/test",
        },
        label: { name: "workermill" },
      },
    });

    expect(response.status()).toBeLessThan(300);
  });
});
