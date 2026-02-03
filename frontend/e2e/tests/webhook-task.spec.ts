import { test, expect } from "@playwright/test";
import { APIClient } from "../helpers/api-client";
import { createTestJiraKey, waitFor } from "../helpers/test-data";

/**
 * Webhook to Task Creation flow tests.
 *
 * These tests verify the critical path:
 * Jira webhook → API processing → Task creation → Dashboard display
 */
test.describe("Webhook to Task Flow", () => {
  let apiClient: APIClient;
  const createdTaskKeys: string[] = [];

  test.beforeAll(async ({ request }) => {
    apiClient = new APIClient(request);
  });

  test.afterAll(async () => {
    // Clean up all test tasks
    for (const key of createdTaskKeys) {
      const task = await apiClient.getTaskByJiraKey(key);
      if (task) {
        await apiClient.deleteTestTask(task.id);
      }
    }
  });

  test("Jira webhook creates task visible in dashboard", async ({ page }) => {
    const jiraKey = createTestJiraKey();
    createdTaskKeys.push(jiraKey);

    // Send Jira webhook
    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Test Task ${jiraKey}`,
      labels: ["workermill"],
    });

    const webhookResponse = await apiClient.sendJiraWebhook(payload);
    expect(webhookResponse.ok()).toBeTruthy();

    // Wait for task to be created
    const task = await waitFor(async () => apiClient.getTaskByJiraKey(jiraKey), {
      timeout: 15000,
    });
    expect(task).toBeTruthy();

    // Navigate to dashboard and verify task appears
    await page.goto("/dashboard");

    // Wait for task list to load
    await page.waitForSelector('[data-testid="task-list"], .task-list, table', { timeout: 10000 });

    // Task should appear in the list
    await expect(page.locator(`text=${jiraKey}`)).toBeVisible({ timeout: 10000 });
  });

  test("Jira webhook with haiku label sets correct model", async ({ page: _page }) => {
    const jiraKey = createTestJiraKey();
    createdTaskKeys.push(jiraKey);

    // Send Jira webhook with haiku label
    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Haiku Test ${jiraKey}`,
      labels: ["workermill", "haiku"],
    });

    const webhookResponse = await apiClient.sendJiraWebhook(payload);
    expect(webhookResponse.ok()).toBeTruthy();

    // Wait for task and verify model
    const task = await waitFor(async () => apiClient.getTaskByJiraKey(jiraKey), {
      timeout: 15000,
    });

    expect(task).toBeTruthy();
    // Model should be haiku (check actual model name in API response)
    expect(task.model).toMatch(/haiku/i);
  });

  test("task initial status is queued", async ({ page }) => {
    const jiraKey = createTestJiraKey();
    createdTaskKeys.push(jiraKey);

    // Create task via webhook
    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Status Test ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    // Wait for task
    const task = await waitFor(async () => apiClient.getTaskByJiraKey(jiraKey), {
      timeout: 15000,
    });

    // Status should be queued
    expect(task.status).toBe("queued");

    // Verify in UI
    await page.goto("/dashboard");
    await page.waitForSelector('[data-testid="task-list"], .task-list', { timeout: 10000 });

    // Find the task row and check status
    const taskRow = page.locator(`tr:has-text("${jiraKey}"), [data-testid="task-row"]:has-text("${jiraKey}")`);
    await expect(taskRow).toBeVisible({ timeout: 10000 });
    await expect(taskRow.locator('[data-testid="task-status"], .status')).toContainText(/queued/i);
  });

  test("task can be viewed in detail page", async ({ page }) => {
    const jiraKey = createTestJiraKey();
    createdTaskKeys.push(jiraKey);

    // Create task
    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Detail Test ${jiraKey}`,
      description: "This is a detailed description for testing",
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    // Wait for task
    const task = await waitFor(async () => apiClient.getTaskByJiraKey(jiraKey), {
      timeout: 15000,
    });

    // Navigate to task detail page
    await page.goto(`/tasks/${task.id}`);

    // Should show task details
    await expect(page.locator("h1, h2").filter({ hasText: jiraKey })).toBeVisible({ timeout: 10000 });
    await expect(page.locator("body")).toContainText("E2E Detail Test");
  });
});
