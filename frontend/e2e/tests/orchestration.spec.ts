import { test, expect } from "@playwright/test";
import { APIClient } from "../helpers/api-client";
import { createTestJiraKey, waitFor } from "../helpers/test-data";

/**
 * Task Orchestration Lifecycle tests.
 *
 * These tests verify the task state machine:
 * queued → running → completed/failed
 *
 * Uses test-only API endpoints to simulate orchestrator and worker actions.
 */
test.describe("Task Orchestration Lifecycle", () => {
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

  test("task progresses from queued to running when claimed", async ({ page }) => {
    const jiraKey = createTestJiraKey();
    createdTaskKeys.push(jiraKey);

    // Create task via webhook
    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Claim Test ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    // Wait for task to be created
    const task = await waitFor(async () => apiClient.getTaskByJiraKey(jiraKey), {
      timeout: 15000,
    });
    expect(task.status).toBe("queued");

    // Navigate to task page
    await page.goto(`/tasks/${task.id}`);
    await expect(page.locator('[data-testid="task-status"], .status')).toContainText(/queued/i);

    // Simulate orchestrator claiming the task
    const claimResponse = await apiClient.claimTask(task.id);
    expect(claimResponse.ok()).toBeTruthy();

    // Refresh and verify status changed
    await page.reload();
    await expect(page.locator('[data-testid="task-status"], .status')).toContainText(/running/i, { timeout: 5000 });
  });

  test("task progresses from running to completed", async ({ page }) => {
    const jiraKey = createTestJiraKey();
    createdTaskKeys.push(jiraKey);

    // Create and claim task
    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Complete Test ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);
    const task = await waitFor(async () => apiClient.getTaskByJiraKey(jiraKey), {
      timeout: 15000,
    });

    // Claim the task
    await apiClient.claimTask(task.id);

    // Navigate to task page
    await page.goto(`/tasks/${task.id}`);
    await expect(page.locator('[data-testid="task-status"], .status')).toContainText(/running/i, { timeout: 5000 });

    // Complete the task
    const completeResponse = await apiClient.completeTask(task.id, {
      result: "deployed",
      prUrl: "https://github.com/test/test/pull/123",
    });
    expect(completeResponse.ok()).toBeTruthy();

    // Refresh and verify status changed
    await page.reload();
    await expect(page.locator('[data-testid="task-status"], .status')).toContainText(/completed/i, { timeout: 5000 });

    // Should show PR link
    await expect(page.locator('a[href*="github.com"]')).toBeVisible();
  });

  test("completed task shows result type", async ({ page }) => {
    const jiraKey = createTestJiraKey();
    createdTaskKeys.push(jiraKey);

    // Create, claim, and complete task with specific result
    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Result Test ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);
    const task = await waitFor(async () => apiClient.getTaskByJiraKey(jiraKey), {
      timeout: 15000,
    });

    await apiClient.claimTask(task.id);
    await apiClient.completeTask(task.id, { result: "review_requested" });

    // Verify in UI
    await page.goto(`/tasks/${task.id}`);
    await expect(page.locator('[data-testid="task-result"], .result')).toContainText(/review/i, { timeout: 5000 });
  });

  test("dashboard shows correct counts by status", async ({ page }) => {
    // Create tasks in different states
    const queuedKey = createTestJiraKey();
    const runningKey = createTestJiraKey();
    createdTaskKeys.push(queuedKey, runningKey);

    // Create queued task
    await apiClient.sendJiraWebhook(
      apiClient.createJiraWebhookPayload({
        issueKey: queuedKey,
        summary: `E2E Queued ${queuedKey}`,
        labels: ["workermill"],
      })
    );

    // Create and claim running task
    await apiClient.sendJiraWebhook(
      apiClient.createJiraWebhookPayload({
        issueKey: runningKey,
        summary: `E2E Running ${runningKey}`,
        labels: ["workermill"],
      })
    );
    const runningTask = await waitFor(async () => apiClient.getTaskByJiraKey(runningKey), { timeout: 15000 });
    await apiClient.claimTask(runningTask.id);

    // Navigate to dashboard
    await page.goto("/dashboard");
    await page.waitForSelector('[data-testid="task-list"], .task-list', { timeout: 10000 });

    // Both tasks should be visible
    await expect(page.locator(`text=${queuedKey}`)).toBeVisible({ timeout: 5000 });
    await expect(page.locator(`text=${runningKey}`)).toBeVisible({ timeout: 5000 });

    // Status indicators should show correct states
    const queuedRow = page.locator(`[data-testid="task-row"]:has-text("${queuedKey}"), tr:has-text("${queuedKey}")`);
    const runningRow = page.locator(`[data-testid="task-row"]:has-text("${runningKey}"), tr:has-text("${runningKey}")`);

    await expect(queuedRow.locator('[data-testid="task-status"], .status')).toContainText(/queued/i);
    await expect(runningRow.locator('[data-testid="task-status"], .status')).toContainText(/running/i);
  });
});
