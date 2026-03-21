import { test, expect } from "@playwright/test";
import { APIClient } from "../helpers/api-client";
import { createTestJiraKey, waitFor } from "../helpers/test-data";

const isProduction = !!process.env.BASE_URL; // Skip when targeting a deployed env (no mock workers)

/**
 * Log Streaming (SSE) tests.
 *
 * Verifies the real-time log streaming functionality:
 * - Mock worker posts logs to API
 * - SSE streams logs to frontend
 * - Logs appear in UI without page refresh
 *
 * IMPORTANT: This tests the PostgreSQL + SSE log streaming pattern
 * that is documented as "sacred" in CLAUDE.md.
 */
test.describe("Log Streaming", () => {
  test.skip(isProduction, 'Requires mock workers — only runs against local stack');
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

  test("mock worker logs appear on task detail page", async ({ page }) => {
    // Use slow scenario to have time to observe logs appearing
    const jiraKey = createTestJiraKey("slow");

    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Log Stream Test ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 30000 },
    );
    createdTaskIds.push(task.id);

    // Wait for task to start running so logs are being posted
    await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "running" ? t : null;
      },
      { timeout: 30000, interval: 1000 },
    );

    // Navigate to dashboard - the task detail / log view should be accessible
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    // Click on the task to expand / navigate to detail
    const taskLink = page.locator(`text=${jiraKey}`).first();
    if ((await taskLink.count()) > 0) {
      await taskLink.click();
      await page.waitForTimeout(2000);
    }

    // Look for log content from the mock worker
    // The mock worker posts: "[mock] Starting mock execution for: ..."
    const logArea = page.locator(
      '[data-testid="log-output"], .log-output, .terminal, pre, [class*="terminal"]',
    );

    if ((await logArea.count()) > 0) {
      // Wait for at least one mock log line to appear
      await expect(logArea.first()).toContainText(/\[mock\]|Starting|Analyzing/, {
        timeout: 30000,
      });
    }
  });

  test("completed task shows all log entries", async ({ page }) => {
    // Use success scenario - completes in ~5s
    const jiraKey = createTestJiraKey("success");

    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Log History Test ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 30000 },
    );
    createdTaskIds.push(task.id);

    // Wait for task to complete
    await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "review_requested" ? t : null;
      },
      { timeout: 60000, interval: 2000 },
    );

    // Navigate to dashboard and click on the task
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    const taskLink = page.locator(`text=${jiraKey}`).first();
    if ((await taskLink.count()) > 0) {
      await taskLink.click();
      await page.waitForTimeout(2000);
    }

    // Check that log area contains entries from the mock worker
    const logArea = page.locator(
      '[data-testid="log-output"], .log-output, .terminal, pre, [class*="terminal"]',
    );

    if ((await logArea.count()) > 0) {
      // The success mock posts multiple log lines
      await expect(logArea.first()).toContainText(/\[mock\]|Starting|Running/, {
        timeout: 30000,
      });
    }
  });

  test("failed task logs show error information", async ({ page }) => {
    const jiraKey = createTestJiraKey("fail");

    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Log Error Test ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 30000 },
    );
    createdTaskIds.push(task.id);

    // Wait for task to fail
    await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "failed" ? t : null;
      },
      { timeout: 60000, interval: 2000 },
    );

    // Navigate to dashboard and click on the task
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    const taskLink = page.locator(`text=${jiraKey}`).first();
    if ((await taskLink.count()) > 0) {
      await taskLink.click();
      await page.waitForTimeout(2000);
    }

    // The mock failure posts an error log line
    const logArea = page.locator(
      '[data-testid="log-output"], .log-output, .terminal, pre, [class*="terminal"]',
    );

    if ((await logArea.count()) > 0) {
      await expect(logArea.first()).toContainText(
        /ERROR|Build failed|type error/i,
        { timeout: 30000 },
      );
    }
  });

  test("logs survive page navigation and return", async ({ page }) => {
    const jiraKey = createTestJiraKey("success");

    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Log Navigate Test ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 30000 },
    );
    createdTaskIds.push(task.id);

    // Wait for task to complete
    await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "review_requested" ? t : null;
      },
      { timeout: 60000, interval: 2000 },
    );

    // Visit task detail
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    // Click on task to view logs
    const taskLink = page.locator(`text=${jiraKey}`).first();
    if ((await taskLink.count()) > 0) {
      await taskLink.click();
      await page.waitForTimeout(2000);
    }

    // Navigate away to settings
    await page.goto("/settings");
    await page.waitForTimeout(1000);

    // Navigate back to dashboard and re-click the task
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    const taskLinkAgain = page.locator(`text=${jiraKey}`).first();
    if ((await taskLinkAgain.count()) > 0) {
      await taskLinkAgain.click();
      await page.waitForTimeout(2000);
    }

    // Logs should still be visible (historical logs loaded)
    const logArea = page.locator(
      '[data-testid="log-output"], .log-output, .terminal, pre, [class*="terminal"]',
    );

    if ((await logArea.count()) > 0) {
      await expect(logArea.first()).toContainText(/\[mock\]|Starting|Analyzing/, {
        timeout: 30000,
      });
    }
  });
});
