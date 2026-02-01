import { test, expect } from "@playwright/test";
import { APIClient } from "../helpers/api-client";
import { createTestJiraKey, waitFor } from "../helpers/test-data";

/**
 * Log Streaming (SSE) tests.
 *
 * These tests verify the real-time log streaming functionality:
 * - Worker posts logs to API
 * - SSE streams logs to frontend
 * - Logs appear in UI without page refresh
 *
 * IMPORTANT: This tests the PostgreSQL + SSE log streaming pattern
 * that is documented as "sacred" in CLAUDE.md - do not modify the
 * underlying implementation without explicit approval.
 */
test.describe("Log Streaming", () => {
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

  test("logs stream in real-time via SSE", async ({ page }) => {
    const jiraKey = createTestJiraKey();
    createdTaskKeys.push(jiraKey);

    // Create a running task
    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Log Stream Test ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);
    const task = await waitFor(async () => apiClient.getTaskByJiraKey(jiraKey), {
      timeout: 15000,
    });

    // Claim the task to make it running
    await apiClient.claimTask(task.id);

    // Navigate to task detail page (where logs are displayed)
    await page.goto(`/tasks/${task.id}`);

    // Wait for the log output area to be present
    await page.waitForSelector('[data-testid="log-output"], .log-output, .terminal, pre', { timeout: 10000 });

    // Post first log entry via API (simulates worker)
    const logContent1 = `[${new Date().toISOString()}] First E2E test log entry`;
    await apiClient.postLog(task.id, logContent1);

    // Log should appear WITHOUT page refresh (SSE streaming)
    await expect(page.locator('[data-testid="log-output"], .log-output, .terminal, pre')).toContainText(
      "First E2E test log entry",
      { timeout: 10000 }
    );

    // Post second log entry
    const logContent2 = `[${new Date().toISOString()}] Second E2E test log entry`;
    await apiClient.postLog(task.id, logContent2);

    // Second log should also appear without refresh
    await expect(page.locator('[data-testid="log-output"], .log-output, .terminal, pre')).toContainText(
      "Second E2E test log entry",
      { timeout: 10000 }
    );
  });

  test("logs preserve order", async ({ page }) => {
    const jiraKey = createTestJiraKey();
    createdTaskKeys.push(jiraKey);

    // Create a running task
    await apiClient.sendJiraWebhook(
      apiClient.createJiraWebhookPayload({
        issueKey: jiraKey,
        summary: `E2E Log Order Test ${jiraKey}`,
        labels: ["workermill"],
      })
    );
    const task = await waitFor(async () => apiClient.getTaskByJiraKey(jiraKey), {
      timeout: 15000,
    });
    await apiClient.claimTask(task.id);

    // Navigate to task page
    await page.goto(`/tasks/${task.id}`);
    await page.waitForSelector('[data-testid="log-output"], .log-output, .terminal, pre', { timeout: 10000 });

    // Post multiple logs in sequence
    for (let i = 1; i <= 5; i++) {
      await apiClient.postLog(task.id, `Log entry ${i} of 5`);
      // Small delay to ensure ordering
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Wait for all logs to appear
    await expect(page.locator('[data-testid="log-output"], .log-output, .terminal, pre')).toContainText("Log entry 5", {
      timeout: 10000,
    });

    // Verify order - get log content and check sequence
    const logContent = await page
      .locator('[data-testid="log-output"], .log-output, .terminal, pre')
      .first()
      .textContent();

    if (logContent) {
      const entry1Index = logContent.indexOf("Log entry 1");
      const entry5Index = logContent.indexOf("Log entry 5");
      expect(entry1Index).toBeLessThan(entry5Index);
    }
  });

  test("logs display formatting correctly", async ({ page }) => {
    const jiraKey = createTestJiraKey();
    createdTaskKeys.push(jiraKey);

    // Create a running task
    await apiClient.sendJiraWebhook(
      apiClient.createJiraWebhookPayload({
        issueKey: jiraKey,
        summary: `E2E Log Format Test ${jiraKey}`,
        labels: ["workermill"],
      })
    );
    const task = await waitFor(async () => apiClient.getTaskByJiraKey(jiraKey), {
      timeout: 15000,
    });
    await apiClient.claimTask(task.id);

    await page.goto(`/tasks/${task.id}`);
    await page.waitForSelector('[data-testid="log-output"], .log-output, .terminal, pre', { timeout: 10000 });

    // Post log with special characters and formatting
    const formattedLog = `
=== Build Started ===
Running: npm install
Dependencies installed successfully!

Error: Something went wrong (just kidding)
Warning: This is a warning message

✓ All tests passed
`;

    await apiClient.postLog(task.id, formattedLog);

    // Verify the formatted content appears
    const logOutput = page.locator('[data-testid="log-output"], .log-output, .terminal, pre');
    await expect(logOutput).toContainText("Build Started", { timeout: 10000 });
    await expect(logOutput).toContainText("npm install");
    await expect(logOutput).toContainText("All tests passed");
  });

  test("log streaming continues after page navigation and return", async ({ page }) => {
    const jiraKey = createTestJiraKey();
    createdTaskKeys.push(jiraKey);

    // Create a running task
    await apiClient.sendJiraWebhook(
      apiClient.createJiraWebhookPayload({
        issueKey: jiraKey,
        summary: `E2E Log Navigate Test ${jiraKey}`,
        labels: ["workermill"],
      })
    );
    const task = await waitFor(async () => apiClient.getTaskByJiraKey(jiraKey), {
      timeout: 15000,
    });
    await apiClient.claimTask(task.id);

    // Navigate to task page and post first log
    await page.goto(`/tasks/${task.id}`);
    await page.waitForSelector('[data-testid="log-output"], .log-output, .terminal, pre', { timeout: 10000 });

    await apiClient.postLog(task.id, "Log before navigation");
    await expect(page.locator('[data-testid="log-output"], .log-output, .terminal, pre')).toContainText(
      "Log before navigation",
      { timeout: 10000 }
    );

    // Navigate away
    await page.goto("/dashboard");
    await page.waitForSelector('[data-testid="task-list"], .task-list', { timeout: 10000 });

    // Post log while on different page
    await apiClient.postLog(task.id, "Log during navigation");

    // Navigate back to task
    await page.goto(`/tasks/${task.id}`);
    await page.waitForSelector('[data-testid="log-output"], .log-output, .terminal, pre', { timeout: 10000 });

    // Both logs should be visible (historical logs loaded)
    const logOutput = page.locator('[data-testid="log-output"], .log-output, .terminal, pre');
    await expect(logOutput).toContainText("Log before navigation", { timeout: 10000 });
    await expect(logOutput).toContainText("Log during navigation", { timeout: 10000 });

    // New logs should still stream
    await apiClient.postLog(task.id, "Log after navigation");
    await expect(logOutput).toContainText("Log after navigation", { timeout: 10000 });
  });
});
