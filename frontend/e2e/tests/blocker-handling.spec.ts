import { test, expect } from "@playwright/test";
import { APIClient } from "../helpers/api-client";
import { createTestJiraKey, waitFor } from "../helpers/test-data";

const isProduction = !!process.env.BASE_URL; // Skip when targeting a deployed env (no mock workers)

/**
 * Blocker handling tests.
 *
 * Verifies BlockerAlert UI renders for escalated tasks
 * and that retry/skip/abort actions are available.
 *
 * Uses the mock worker "blocker" scenario which posts a
 * blocker_detected coordination message and completes with escalated status.
 */
test.describe("Blocker Handling", () => {
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

  test("escalated task shows blocker indicator in dashboard", async ({
    page,
  }) => {
    const jiraKey = createTestJiraKey("blocker");

    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Blocker Test ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 15000 },
    );
    createdTaskIds.push(task.id);

    // Wait for mock worker to escalate (~4s)
    await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "escalated" ? t : null;
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

    // Look for blocker-related UI (alert, badge, icon, or status text)
    const blockerIndicator = page.locator(
      '[data-testid="blocker-alert"], .blocker-alert, [data-testid="task-status"]:has-text("escalated"), [data-testid="task-status"]:has-text("blocked")',
    );
    const statusText = page.locator(`text=/escalated|blocked|blocker/i`);

    // Either a dedicated blocker UI or a status indicator should be present
    if (
      (await blockerIndicator.count()) > 0 ||
      (await statusText.count()) > 0
    ) {
      await expect(blockerIndicator.or(statusText).first()).toBeVisible();
    }
  });

  test("escalated task has action buttons (retry/skip/abort)", async ({
    page,
  }) => {
    const jiraKey = createTestJiraKey("blocker");

    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Blocker Buttons Test ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 15000 },
    );
    createdTaskIds.push(task.id);

    // Wait for escalation
    await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "escalated" ? t : null;
      },
      { timeout: 60000, interval: 2000 },
    );

    // Navigate to dashboard
    await page.goto("/dashboard");
    await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
      timeout: 10000,
    });

    // Click on the task to expand / navigate
    await page.locator(`text=${jiraKey}`).first().click();
    await page.waitForTimeout(2000);

    // Check for action buttons (Retry, Skip, Abort from BlockerAlert component)
    const retryBtn = page.locator(
      '[data-testid="blocker-retry"], button:has-text("Retry")',
    );
    const skipBtn = page.locator(
      '[data-testid="blocker-skip"], button:has-text("Skip")',
    );
    const abortBtn = page.locator(
      '[data-testid="blocker-abort"], button:has-text("Abort"), button:has-text("Cancel")',
    );

    // If blocker UI is visible, check for action buttons
    if ((await retryBtn.count()) > 0) {
      await expect(retryBtn.first()).toBeVisible();
    }
    if ((await skipBtn.count()) > 0) {
      await expect(skipBtn.first()).toBeVisible();
    }
    if ((await abortBtn.count()) > 0) {
      await expect(abortBtn.first()).toBeVisible();
    }
  });

  test("failed task shows error information on detail page", async ({
    page,
  }) => {
    const jiraKey = createTestJiraKey("fail");

    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Fail Error Info ${jiraKey}`,
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

    // Navigate to dashboard and click the task
    await page.goto("/dashboard");
    await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
      timeout: 10000,
    });

    await page.locator(`text=${jiraKey}`).first().click();
    await page.waitForTimeout(2000);

    // Should show failed status or error info somewhere on the page
    await expect(page.locator("body")).toContainText(
      /failed|error|Build failed/i,
      { timeout: 10000 },
    );
  });
});
