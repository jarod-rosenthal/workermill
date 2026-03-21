import { test, expect } from "@playwright/test";
import { APIClient } from "../helpers/api-client";
import { createTestJiraKey, waitFor } from "../helpers/test-data";

const isProduction = !!process.env.BASE_URL; // Skip when targeting a deployed env (no mock workers)

/**
 * Webhook to Task Creation flow tests.
 *
 * Verifies the critical path:
 * Jira webhook -> API processing -> Task creation -> Dashboard display
 *
 * Uses the mock worker service via Jira key prefixes to control task outcomes.
 */
test.describe("Webhook to Task Flow", () => {
  // Webhook tests send Jira payloads and need mock workers for task completion.
  // The APIClient fixture also can't cross beforeAll→test scope in Playwright.
  test.skip(isProduction, "Requires mock workers and Jira webhook config — only runs against local stack");

  let apiClient: APIClient;
  const createdTaskIds: string[] = [];

  test.beforeEach(async ({ request }) => {
    apiClient = new APIClient(request);
  });

  test.afterAll(async () => {
    for (const id of createdTaskIds) {
      try {
        await apiClient.deleteTask(id);
      } catch {
        // Best-effort cleanup
      }
    }
  });

  test("Jira webhook creates task visible in dashboard", async ({ page }) => {
    const jiraKey = createTestJiraKey();

    // Send Jira webhook
    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Test Task ${jiraKey}`,
      labels: ["workermill"],
    });

    const webhookResponse = await apiClient.sendJiraWebhook(payload);
    expect(webhookResponse.ok()).toBeTruthy();

    // Wait for task to be created
    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 30000 },
    );
    expect(task).toBeTruthy();
    createdTaskIds.push(task.id);

    // Navigate to dashboard and verify task appears
    await page.goto("/dashboard");

    // Wait for task list to load
    await page.waitForSelector(
      '[data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    // Task should appear in the list
    await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
      timeout: 10000,
    });
  });

  test("Jira webhook with haiku label sets correct model", async () => {
    const jiraKey = createTestJiraKey();

    // Send Jira webhook with haiku label
    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Haiku Test ${jiraKey}`,
      labels: ["workermill", "haiku"],
    });

    const webhookResponse = await apiClient.sendJiraWebhook(payload);
    expect(webhookResponse.ok()).toBeTruthy();

    // Wait for task and verify model
    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 30000 },
    );

    expect(task).toBeTruthy();
    createdTaskIds.push(task.id);

    // Model should be haiku (check actual model name in API response)
    expect(task.model).toMatch(/haiku/i);
  });

  test("task initial status is queued or running", async ({ page }) => {
    const jiraKey = createTestJiraKey();

    // Create task via webhook
    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Status Test ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    // Wait for task
    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 30000 },
    );
    createdTaskIds.push(task.id);

    // Status should be queued or running (mock worker may have already picked it up)
    expect(["queued", "running", "planning"]).toContain(task.status);

    // Verify in UI
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    // Find the task row and check it exists
    const taskRow = page.locator(
      `tr:has-text("${jiraKey}"), [data-testid="task-card"]:has-text("${jiraKey}")`,
    );
    await expect(taskRow.first()).toBeVisible({ timeout: 10000 });
  });

  test("task can be viewed in detail page", async ({ page }) => {
    const jiraKey = createTestJiraKey();

    // Create task
    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Detail Test ${jiraKey}`,
      description: "This is a detailed description for testing",
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    // Wait for task
    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 30000 },
    );
    createdTaskIds.push(task.id);

    // Navigate to task detail page
    await page.goto(`/tasks/${task.id}`);

    // Should show task details (the dashboard might show the task inline instead)
    // Accept either a dedicated page or the dashboard with the task expanded
    await expect(page.locator("body")).toContainText(jiraKey, {
      timeout: 10000,
    });
  });

  test("task created via webhook completes via mock worker", async () => {
    const jiraKey = createTestJiraKey("success");

    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Complete Test ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 30000 },
    );
    createdTaskIds.push(task.id);

    // Mock worker should complete the task with review_requested (~5s)
    const completed = await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "review_requested" ? t : null;
      },
      { timeout: 60000, interval: 2000 },
    );

    expect(completed).toBeTruthy();
    expect(completed.status).toBe("review_requested");
  });
});
