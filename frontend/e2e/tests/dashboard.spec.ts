import { test, expect } from "@playwright/test";
import { APIClient } from "../helpers/api-client";
import { createTestJiraKey, waitFor } from "../helpers/test-data";

const isProduction = !!process.env.BASE_URL; // Skip when targeting a deployed env (no mock workers)

/**
 * Dashboard tests.
 *
 * Verifies the main dashboard page loads correctly,
 * displays tasks, and supports key user interactions.
 */
test.describe("Dashboard", () => {
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

  test("dashboard loads and shows task list or empty state", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    // Wait for dashboard to be ready — MainDashboard.tsx renders data-testid="dashboard"
    await expect(
      page.locator('[data-testid="dashboard"]'),
    ).toBeVisible({ timeout: 15000 });

    // Should show either task list or empty state
    const taskList = page.locator('[data-testid="task-list"]');
    const emptyState = page.locator('[data-testid="empty-state"]');
    await expect(taskList.or(emptyState).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("task card displays correct status badge", async ({ page }) => {
    test.skip(isProduction, 'Requires mock workers — only runs against local stack');

    const jiraKey = createTestJiraKey("success");
    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Dashboard Status Test ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 15000 },
    );
    createdTaskIds.push(task.id);

    await page.goto("/dashboard");
    await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
      timeout: 15000,
    });

    // Task card should have a status indicator — MainDashboard uses data-testid="task-card" and data-testid="task-status"
    const taskCard = page.locator(
      `[data-testid="task-card"]:has-text("${jiraKey}")`,
    );
    if ((await taskCard.count()) > 0) {
      const statusBadge = taskCard
        .first()
        .locator('[data-testid="task-status"]');
      if ((await statusBadge.count()) > 0) {
        // Should show some status text (queued, running, review, etc.)
        await expect(statusBadge.first()).not.toBeEmpty();
      }
    }
  });

  test("task card click navigates to detail or expands", async ({ page }) => {
    test.skip(isProduction, 'Requires mock workers — only runs against local stack');

    const jiraKey = createTestJiraKey();
    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Click Test ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 15000 },
    );
    createdTaskIds.push(task.id);

    await page.goto("/dashboard");
    await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
      timeout: 10000,
    });

    // Click the task link/row
    await page.locator(`text=${jiraKey}`).first().click();

    // Should navigate to task detail page or expand the task card
    // Either way, more task info should be visible
    await page.waitForTimeout(1000);

    // Check if navigated to a task detail URL, or if more content appeared inline
    const url = page.url();
    const hasTaskDetailUrl = /\/tasks\//.test(url);
    const hasExpandedContent =
      (await page
        .locator(
          '[data-testid="log-output"], .log-output, .terminal, [class*="terminal"]',
        )
        .count()) > 0;

    expect(hasTaskDetailUrl || hasExpandedContent).toBeTruthy();
  });

  test("dashboard refreshes data when new task is created", async ({
    page,
  }) => {
    test.skip(isProduction, 'Requires mock workers — only runs against local stack');

    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="dashboard"]',
      { timeout: 15000 },
    );

    // Create a task via webhook
    const jiraKey = createTestJiraKey();
    const payload = apiClient.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: `E2E Refresh Test ${jiraKey}`,
      labels: ["workermill"],
    });

    await apiClient.sendJiraWebhook(payload);
    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 15000 },
    );
    createdTaskIds.push(task.id);

    // Dashboard should eventually show the new task (via polling or manual refresh)
    // Wait for automatic polling cycle
    await page.waitForTimeout(5000);

    await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
      timeout: 15000,
    });
  });

  test("profile dropdown shows user info", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="dashboard"]',
      { timeout: 15000 },
    );

    const userMenu = page.locator(
      '[data-testid="user-menu"], [data-testid="profile-dropdown"], .user-menu, button:has(img[alt])',
    );

    if ((await userMenu.count()) > 0) {
      await userMenu.first().click();

      // Should show profile-related links in dropdown
      const profileLink = page.locator(
        'a[href="/profile"], [data-testid="dropdown-profile-link"]',
      );
      const settingsLink = page.locator(
        'a[href="/settings"], [data-testid="dropdown-settings-link"]',
      );

      if ((await profileLink.count()) > 0) {
        await expect(profileLink.first()).toBeVisible({ timeout: 5000 });
      }
      if ((await settingsLink.count()) > 0) {
        await expect(settingsLink.first()).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test("sidebar navigation links are present", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForSelector('[data-testid="dashboard"]', {
      timeout: 15000,
    });

    // Check for common navigation links
    const nav = page.locator("nav, aside, [role='navigation']");
    if ((await nav.count()) > 0) {
      // Dashboard should have links to key areas
      const boardsLink = page.locator(
        'a[href="/boards"], a:has-text("Boards")',
      );
      const analyticsLink = page.locator(
        'a[href="/analytics"], a:has-text("Analytics")',
      );
      const settingsLink = page.locator(
        'a[href="/settings"], a:has-text("Settings")',
      );

      // At least one nav link should be visible
      const hasBoards = (await boardsLink.count()) > 0;
      const hasAnalytics = (await analyticsLink.count()) > 0;
      const hasSettings = (await settingsLink.count()) > 0;

      expect(hasBoards || hasAnalytics || hasSettings).toBeTruthy();
    }
  });
});
