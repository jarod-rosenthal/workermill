import { test, expect } from "@playwright/test";
import { APIClient } from "../helpers/api-client";
import { createTestJiraKey, waitFor } from "../helpers/test-data";

const isProduction = !!process.env.BASE_URL; // Skip when targeting a deployed env (no mock workers)

/**
 * Task Lifecycle tests.
 *
 * Verifies the full task lifecycle through mock worker scenarios:
 * - Success: queued -> running -> review_requested
 * - Failure: queued -> running -> failed
 * - Blocker: queued -> running -> escalated
 * - Cancel: queued/running -> cancelled
 * - Retry: failed -> queued (re-queued)
 */
test.describe("Task Lifecycle", () => {
  test.skip(isProduction, 'Requires mock workers — only runs against local stack');
  let apiClient: APIClient;
  const createdTaskIds: string[] = [];

  test.beforeAll(async ({ request }) => {
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

  test("success scenario: task reaches review_requested", async () => {
    const jiraKey = createTestJiraKey("success");

    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Success Lifecycle ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 15000 },
    );
    createdTaskIds.push(task.id);

    // Wait for mock worker to complete (~5s for success)
    const completed = await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "review_requested" ? t : null;
      },
      { timeout: 60000, interval: 2000 },
    );

    expect(completed.status).toBe("review_requested");
  });

  test("failure scenario: task reaches failed status", async () => {
    const jiraKey = createTestJiraKey("fail");

    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Fail Lifecycle ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 15000 },
    );
    createdTaskIds.push(task.id);

    // Wait for mock worker to fail (~3s for failure)
    const failed = await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "failed" ? t : null;
      },
      { timeout: 60000, interval: 2000 },
    );

    expect(failed.status).toBe("failed");
  });

  test("blocker scenario: task reaches escalated status", async () => {
    const jiraKey = createTestJiraKey("blocker");

    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Blocker Lifecycle ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 15000 },
    );
    createdTaskIds.push(task.id);

    // Wait for mock worker to escalate (~4s for blocker)
    const escalated = await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "escalated" ? t : null;
      },
      { timeout: 60000, interval: 2000 },
    );

    expect(escalated.status).toBe("escalated");
  });

  test("cancel: running task can be cancelled", async () => {
    // Use slow scenario so the task stays running long enough to cancel
    const jiraKey = createTestJiraKey("slow");

    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Cancel Lifecycle ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 15000 },
    );
    createdTaskIds.push(task.id);

    // Wait for task to be running
    await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "running" ? t : null;
      },
      { timeout: 30000, interval: 1000 },
    );

    // Cancel the task
    const cancelResponse = await apiClient.cancelTask(task.id);
    expect(cancelResponse.ok()).toBeTruthy();

    // Verify it's cancelled
    const cancelled = await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "cancelled" ? t : null;
      },
      { timeout: 15000, interval: 1000 },
    );

    expect(cancelled.status).toBe("cancelled");
  });

  test("retry: failed task can be retried", async () => {
    const jiraKey = createTestJiraKey("fail");

    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Retry Lifecycle ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 15000 },
    );
    createdTaskIds.push(task.id);

    // Wait for failure
    await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "failed" ? t : null;
      },
      { timeout: 60000, interval: 2000 },
    );

    // Retry the task
    const retryResponse = await apiClient.retryTask(task.id);
    expect(retryResponse.ok()).toBeTruthy();

    // Task should be re-queued or running again
    const retried = await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "queued" || t?.status === "running" ? t : null;
      },
      { timeout: 15000, interval: 1000 },
    );

    expect(["queued", "running"]).toContain(retried.status);
  });

  test("task status is reflected in dashboard UI", async ({ page }) => {
    const jiraKey = createTestJiraKey("success");

    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E UI Status ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 15000 },
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

    // Navigate to dashboard
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    // Task should be visible
    await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
      timeout: 10000,
    });

    // Status badge should show review-related text
    const taskCard = page.locator(
      `[data-testid="task-card"]:has-text("${jiraKey}"), tr:has-text("${jiraKey}")`,
    );
    if ((await taskCard.count()) > 0) {
      const statusBadge = taskCard
        .first()
        .locator('[data-testid="task-status"], .status');
      if ((await statusBadge.count()) > 0) {
        await expect(statusBadge.first()).toContainText(
          /review|completed|done/i,
        );
      }
    }
  });
});
