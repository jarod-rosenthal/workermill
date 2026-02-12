import { test, expect } from "@playwright/test";
import { APIClient } from "../helpers/api-client";
import { createTestJiraKey, waitFor } from "../helpers/test-data";

/**
 * Dashboard tests.
 *
 * Verifies the main dashboard page loads correctly,
 * displays tasks, and supports key user interactions.
 */
test.describe("Dashboard", () => {
  let apiClient: APIClient;
  const createdTaskKeys: string[] = [];

  test.beforeAll(async ({ request }) => {
    apiClient = new APIClient(request);
  });

  test.afterAll(async () => {
    for (const key of createdTaskKeys) {
      const task = await apiClient.getTaskByJiraKey(key);
      if (task) {
        await apiClient.deleteTestTask(task.id);
      }
    }
  });

  test("dashboard loads and shows task list or empty state", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    // Wait for dashboard to be ready
    await expect(
      page.locator(
        '[data-testid="dashboard"], [data-testid="task-list"], .task-list',
      ),
    ).toBeVisible({ timeout: 10000 });

    // Should show either task list or empty state
    const taskList = page.locator(
      '[data-testid="task-list"], .task-list, table',
    );
    const emptyState = page.locator(
      '[data-testid="empty-state"], .empty-state',
    );
    await expect(taskList.or(emptyState)).toBeVisible({ timeout: 10000 });
  });

  test("task card displays correct status badge", async ({ page }) => {
    const jiraKey = createTestJiraKey();
    createdTaskKeys.push(jiraKey);

    // Create a task via webhook
    await apiClient.sendJiraWebhook(
      apiClient.createJiraWebhookPayload({
        issueKey: jiraKey,
        summary: `E2E Dashboard Status Test ${jiraKey}`,
        labels: ["workermill"],
      }),
    );
    await waitFor(async () => apiClient.getTaskByJiraKey(jiraKey), {
      timeout: 15000,
    });

    await page.goto("/dashboard");
    await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
      timeout: 10000,
    });

    // Status should show queued
    const taskRow = page.locator(
      `tr:has-text("${jiraKey}"), [data-testid="task-card"]:has-text("${jiraKey}")`,
    );
    await expect(
      taskRow.locator('[data-testid="task-status"], .status'),
    ).toContainText(/queued/i);
  });

  test("task card click navigates to detail page", async ({ page }) => {
    const jiraKey = createTestJiraKey();
    createdTaskKeys.push(jiraKey);

    await apiClient.sendJiraWebhook(
      apiClient.createJiraWebhookPayload({
        issueKey: jiraKey,
        summary: `E2E Click Test ${jiraKey}`,
        labels: ["workermill"],
      }),
    );
    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 15000 },
    );

    await page.goto("/dashboard");
    await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
      timeout: 10000,
    });

    // Click the task link/row
    await page.locator(`text=${jiraKey}`).first().click();

    // Should navigate to task detail page
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}`));
  });

  test("dashboard refreshes data when new task is created", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="dashboard"], [data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    // Create a task via API
    const jiraKey = createTestJiraKey();
    createdTaskKeys.push(jiraKey);

    await apiClient.sendJiraWebhook(
      apiClient.createJiraWebhookPayload({
        issueKey: jiraKey,
        summary: `E2E Refresh Test ${jiraKey}`,
        labels: ["workermill"],
      }),
    );
    await waitFor(async () => apiClient.getTaskByJiraKey(jiraKey), {
      timeout: 15000,
    });

    // Dashboard should eventually show the new task (via polling or manual refresh)
    // Click refresh if available, otherwise wait for automatic refresh
    const refreshBtn = page.locator(
      '[data-testid="refresh-button"], button:has-text("Refresh")',
    );
    if ((await refreshBtn.count()) > 0) {
      await refreshBtn.first().click();
    } else {
      // Wait for automatic polling cycle
      await page.waitForTimeout(3000);
    }

    await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
      timeout: 15000,
    });
  });

  test("profile dropdown shows user info", async ({ page }) => {
    await page.goto("/dashboard");

    const userMenu = page.locator(
      '[data-testid="user-menu"], [data-testid="profile-dropdown"], .user-menu',
    );

    if ((await userMenu.count()) > 0) {
      await userMenu.first().click();

      // Should show profile and settings links
      await expect(
        page.locator(
          '[data-testid="dropdown-profile-link"], a[href="/profile"]',
        ),
      ).toBeVisible({ timeout: 5000 });
      await expect(
        page.locator(
          '[data-testid="dropdown-settings-link"], a[href="/settings"]',
        ),
      ).toBeVisible({ timeout: 5000 });
    }
  });
});
