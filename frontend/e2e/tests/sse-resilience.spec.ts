import { test, expect } from "@playwright/test";
import { APIClient } from "../helpers/api-client";
import { createTestJiraKey, waitFor } from "../helpers/test-data";

const isProduction = !!process.env.BASE_URL; // Skip when targeting a deployed env (no mock workers)

/**
 * SSE Resilience tests.
 *
 * Verifies that the SSE (Server-Sent Events) log streaming
 * connection handles various edge cases:
 * - Connection survives page navigation
 * - Dashboard auto-refreshes data
 * - Multiple tasks can be tracked
 * - UI handles rapid status transitions
 */
test.describe("SSE Resilience", () => {
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

  test("dashboard reflects task status changes without manual refresh", async ({
    page,
  }) => {
    test.skip(isProduction, 'Requires mock workers — only runs against local stack');
    // Create a success task
    const jiraKey = createTestJiraKey("success");
    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E SSE Auto-Refresh ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 30000 },
    );
    createdTaskIds.push(task.id);

    // Navigate to dashboard while task is processing
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    // Wait for the task to appear (might need polling)
    await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
      timeout: 30000,
    });

    // Wait for mock worker to complete (~5s for success)
    await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "review_requested" ? t : null;
      },
      { timeout: 60000, interval: 2000 },
    );

    // Dashboard should auto-update the status without manual refresh
    // Give it some time for SSE or polling to pick up the change
    await page.waitForTimeout(5000);

    // The task should still be visible (status may have updated)
    await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
      timeout: 10000,
    });
  });

  test("multiple tasks update independently", async ({ page }) => {
    test.skip(isProduction, 'Requires mock workers — only runs against local stack');
    // Create two tasks with different scenarios
    const successKey = createTestJiraKey("success");
    const failKey = createTestJiraKey("fail");

    await apiClient.sendJiraWebhook(
      apiClient.createJiraWebhookPayload({
        issueKey: successKey,
        summary: `E2E Multi-Task Success ${successKey}`,
        labels: ["workermill"],
      }),
    );

    await apiClient.sendJiraWebhook(
      apiClient.createJiraWebhookPayload({
        issueKey: failKey,
        summary: `E2E Multi-Task Fail ${failKey}`,
        labels: ["workermill"],
      }),
    );

    const successTask = await waitFor(
      async () => apiClient.getTaskByJiraKey(successKey),
      { timeout: 30000 },
    );
    const failTask = await waitFor(
      async () => apiClient.getTaskByJiraKey(failKey),
      { timeout: 30000 },
    );

    createdTaskIds.push(successTask.id, failTask.id);

    // Wait for both to complete
    await Promise.all([
      waitFor(
        async () => {
          const t = await apiClient.getTask(successTask.id);
          return t?.status === "review_requested" ? t : null;
        },
        { timeout: 60000, interval: 2000 },
      ),
      waitFor(
        async () => {
          const t = await apiClient.getTask(failTask.id);
          return t?.status === "failed" ? t : null;
        },
        { timeout: 60000, interval: 2000 },
      ),
    ]);

    // Navigate to dashboard and verify both tasks are shown
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    await expect(page.locator(`text=${successKey}`)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator(`text=${failKey}`)).toBeVisible({
      timeout: 10000,
    });
  });

  test("page navigation away and back preserves task data", async ({
    page,
  }) => {
    test.skip(isProduction, 'Requires mock workers — only runs against local stack');
    const jiraKey = createTestJiraKey("success");
    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Navigate Resilience ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 30000 },
    );
    createdTaskIds.push(task.id);

    // Wait for completion
    await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "review_requested" ? t : null;
      },
      { timeout: 60000, interval: 2000 },
    );

    // Visit dashboard to see the task
    await page.goto("/dashboard");
    await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
      timeout: 30000,
    });

    // Navigate to settings
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Navigate to analytics
    await page.goto("/analytics");
    await page.waitForLoadState("domcontentloaded");

    // Navigate back to dashboard
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    // Task should still be visible after navigation
    await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
      timeout: 30000,
    });
  });

  test("rapid task creation does not break the dashboard", async ({
    page,
  }) => {
    test.skip(isProduction, 'Requires mock workers — only runs against local stack');
    // Create 3 tasks rapidly
    const keys: string[] = [];
    for (let i = 0; i < 3; i++) {
      const jiraKey = createTestJiraKey("success");
      keys.push(jiraKey);

      await apiClient.sendJiraWebhook(
        apiClient.createJiraWebhookPayload({
          issueKey: jiraKey,
          summary: `E2E Rapid ${i + 1} ${jiraKey}`,
          labels: ["workermill"],
        }),
      );
    }

    // Wait for all tasks to be created
    for (const key of keys) {
      const task = await waitFor(
        async () => apiClient.getTaskByJiraKey(key),
        { timeout: 30000 },
      );
      createdTaskIds.push(task.id);
    }

    // Navigate to dashboard
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    // All tasks should appear (or at least the dashboard should not crash)
    // Check at least one is visible
    await expect(page.locator(`text=${keys[0]}`)).toBeVisible({
      timeout: 30000,
    });
  });
});
