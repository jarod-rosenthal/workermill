import { test, expect } from "@playwright/test";
import { APIClient } from "../../helpers/api-client";
import { createTestJiraKey, waitFor } from "../../helpers/test-data";

const isProduction = !!process.env.BASE_URL?.includes('workermill.com');

/**
 * Multi-Task Parallel Execution flow tests.
 *
 * Verifies that multiple tasks can be created concurrently,
 * execute in parallel with different outcomes, and reflect
 * correctly in the dashboard UI.
 */
test.describe("Multi-Task Parallel Execution", () => {
  test.skip(isProduction, 'Requires mock workers — only runs against local stack');
  let apiClient: APIClient;
  const createdTaskIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    apiClient = new APIClient(request);
  });

  test.afterAll(async () => {
    for (const id of createdTaskIds) {
      try {
        await apiClient.cancelTask(id).catch(() => {});
        await apiClient.deleteTask(id);
      } catch {
        // Best-effort cleanup
      }
    }
  });

  test("three tasks created concurrently all appear with unique IDs", async ({
    page,
  }) => {
    const jiraKeys = [
      createTestJiraKey("success"),
      createTestJiraKey("success"),
      createTestJiraKey("success"),
    ];

    // Send all 3 webhooks rapidly (no awaiting between sends)
    const webhookPromises = jiraKeys.map((jiraKey) => {
      const payload = apiClient.createJiraWebhookPayload({
        issueKey: jiraKey,
        summary: `E2E Parallel Task ${jiraKey}`,
        labels: ["workermill"],
      });
      return apiClient.sendJiraWebhook(payload);
    });

    const responses = await Promise.all(webhookPromises);
    for (const response of responses) {
      expect(response.ok()).toBeTruthy();
    }

    // Wait for all 3 tasks to be created
    const tasks = await Promise.all(
      jiraKeys.map((jiraKey) =>
        waitFor(async () => apiClient.getTaskByJiraKey(jiraKey), {
          timeout: 15000,
        }),
      ),
    );

    for (const task of tasks) {
      expect(task).toBeTruthy();
      createdTaskIds.push(task.id);
    }

    // Verify all 3 have unique IDs
    const uniqueIds = new Set(tasks.map((t) => t.id));
    expect(uniqueIds.size).toBe(3);

    // Verify all 3 appear in dashboard
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    for (const jiraKey of jiraKeys) {
      await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
        timeout: 10000,
      });
    }
  });

  test("mixed outcomes: success, failure, and blocker resolve correctly", async () => {
    const scenarios = [
      { scenario: "success" as const, expectedStatus: "review_requested" },
      { scenario: "fail" as const, expectedStatus: "failed" },
      { scenario: "blocker" as const, expectedStatus: "escalated" },
    ];

    const jiraKeys = scenarios.map((s) => ({
      ...s,
      jiraKey: createTestJiraKey(s.scenario),
    }));

    // Send all webhooks concurrently
    const webhookPromises = jiraKeys.map(({ jiraKey, scenario }) => {
      const payload = apiClient.createJiraWebhookPayload({
        issueKey: jiraKey,
        summary: `E2E Mixed ${scenario} ${jiraKey}`,
        labels: ["workermill"],
      });
      return apiClient.sendJiraWebhook(payload);
    });

    const responses = await Promise.all(webhookPromises);
    for (const response of responses) {
      expect(response.ok()).toBeTruthy();
    }

    // Wait for all tasks to be created
    const tasks = await Promise.all(
      jiraKeys.map(({ jiraKey }) =>
        waitFor(async () => apiClient.getTaskByJiraKey(jiraKey), {
          timeout: 15000,
        }),
      ),
    );

    for (const task of tasks) {
      expect(task).toBeTruthy();
      createdTaskIds.push(task.id);
    }

    // Wait for each task to reach its expected terminal status
    const completedTasks = await Promise.all(
      jiraKeys.map(({ expectedStatus }, index) =>
        waitFor(
          async () => {
            const t = await apiClient.getTask(tasks[index].id);
            return t?.status === expectedStatus ? t : null;
          },
          { timeout: 60000, interval: 2000 },
        ),
      ),
    );

    // Verify each task reached its expected status
    for (let i = 0; i < scenarios.length; i++) {
      expect(completedTasks[i].status).toBe(scenarios[i].expectedStatus);
    }
  });

  test("slow task can be cancelled during execution", async ({ page }) => {
    const jiraKey = createTestJiraKey("slow");

    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Cancel Parallel ${jiraKey}`,
      labels: ["workermill"],
    });

    const webhookResponse = await apiClient.sendJiraWebhook(payload);
    expect(webhookResponse.ok()).toBeTruthy();

    // Wait for task to be created
    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 15000 },
    );
    expect(task).toBeTruthy();
    createdTaskIds.push(task.id);

    // Wait for task to start executing (running state)
    await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "running" ? t : null;
      },
      { timeout: 30000, interval: 1000 },
    );

    // Cancel the task via API
    const cancelResponse = await apiClient.cancelTask(task.id);
    expect(cancelResponse.ok()).toBeTruthy();

    // Verify task reaches cancelled status
    const cancelled = await waitFor(
      async () => {
        const t = await apiClient.getTask(task.id);
        return t?.status === "cancelled" ? t : null;
      },
      { timeout: 15000, interval: 1000 },
    );
    expect(cancelled.status).toBe("cancelled");

    // Verify dashboard reflects cancellation
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
      timeout: 10000,
    });

    // Check for cancelled status indicator in the task row
    const taskCard = page.locator(
      `[data-testid="task-card"]:has-text("${jiraKey}"), tr:has-text("${jiraKey}")`,
    );
    if ((await taskCard.count()) > 0) {
      const statusBadge = taskCard
        .first()
        .locator('[data-testid="task-status"], .status');
      if ((await statusBadge.count()) > 0) {
        await expect(statusBadge.first()).toContainText(/cancel/i);
      }
    }
  });

  test("dashboard shows all active tasks simultaneously", async ({ page }) => {
    const jiraKeys = [
      createTestJiraKey("success"),
      createTestJiraKey("success"),
      createTestJiraKey("success"),
    ];

    // Create all 3 tasks concurrently
    const webhookPromises = jiraKeys.map((jiraKey) => {
      const payload = apiClient.createJiraWebhookPayload({
        issueKey: jiraKey,
        summary: `E2E Dashboard Parallel ${jiraKey}`,
        labels: ["workermill"],
      });
      return apiClient.sendJiraWebhook(payload);
    });

    const responses = await Promise.all(webhookPromises);
    for (const response of responses) {
      expect(response.ok()).toBeTruthy();
    }

    // Wait for all tasks to be created via API
    const tasks = await Promise.all(
      jiraKeys.map((jiraKey) =>
        waitFor(async () => apiClient.getTaskByJiraKey(jiraKey), {
          timeout: 15000,
        }),
      ),
    );

    for (const task of tasks) {
      expect(task).toBeTruthy();
      createdTaskIds.push(task.id);
    }

    // Navigate to dashboard
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    // Verify all 3 tasks are visible with their Jira keys
    for (const jiraKey of jiraKeys) {
      await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
        timeout: 10000,
      });
    }

    // Verify each task has a distinct row/card in the list
    for (const jiraKey of jiraKeys) {
      const taskRow = page.locator(
        `tr:has-text("${jiraKey}"), [data-testid="task-card"]:has-text("${jiraKey}")`,
      );
      await expect(taskRow.first()).toBeVisible({ timeout: 10000 });
    }
  });
});
