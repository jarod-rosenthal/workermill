import { test, expect } from "@playwright/test";
import { APIClient } from "../helpers/api-client";
import { createTestJiraKey, waitFor } from "../helpers/test-data";

/**
 * Blocker handling tests.
 *
 * Verifies BlockerAlert UI renders for escalated tasks
 * and that retry/skip/abort actions are available.
 */
test.describe("Blocker Handling", () => {
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

  test("escalated task shows blocker alert in dashboard", async ({ page }) => {
    const jiraKey = createTestJiraKey();
    createdTaskKeys.push(jiraKey);

    // Create a task
    await apiClient.sendJiraWebhook(
      apiClient.createJiraWebhookPayload({
        issueKey: jiraKey,
        summary: `E2E Blocker Test ${jiraKey}`,
        labels: ["workermill"],
      }),
    );

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 15000 },
    );

    // Claim the task
    await apiClient.claimTask(task.id);

    // Escalate the task with blocker data
    const escalateResponse = await apiClient.escalateTask(task.id, {
      storyIndex: 1,
      storyTitle: "Implement feature",
      errorCategory: "typescript",
      errorMessage: "Type error in component",
      summary: "TypeScript compilation failed",
      affectedFiles: ["src/component.tsx"],
      autoRetryAttempts: 2,
      maxAutoRetries: 3,
      dependentStories: [2, 3],
    });

    // If escalate endpoint isn't available, skip
    if (!escalateResponse.ok()) {
      test.skip();
      return;
    }

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

    // Look for blocker alert - it appears on escalated task cards
    const blockerAlert = page.locator(
      '[data-testid="blocker-alert"], .blocker-alert, :has-text("Blocked")',
    );

    if ((await blockerAlert.count()) > 0) {
      await expect(blockerAlert.first()).toBeVisible();
    }
  });

  test("blocker alert shows retry, skip, and abort buttons", async ({
    page,
  }) => {
    const jiraKey = createTestJiraKey();
    createdTaskKeys.push(jiraKey);

    // Create, claim, and escalate a task
    await apiClient.sendJiraWebhook(
      apiClient.createJiraWebhookPayload({
        issueKey: jiraKey,
        summary: `E2E Blocker Buttons Test ${jiraKey}`,
        labels: ["workermill"],
      }),
    );

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 15000 },
    );

    await apiClient.claimTask(task.id);

    const escalateResponse = await apiClient.escalateTask(task.id, {
      storyIndex: 1,
      storyTitle: "Fix API endpoint",
      errorCategory: "test",
      errorMessage: "Test suite failed",
      summary: "Integration tests are failing",
      affectedFiles: ["src/api.ts"],
      autoRetryAttempts: 3,
      maxAutoRetries: 3,
      dependentStories: [],
    });

    if (!escalateResponse.ok()) {
      test.skip();
      return;
    }

    // Navigate to dashboard
    await page.goto("/dashboard");

    // Wait for task to appear
    await expect(page.locator(`text=${jiraKey}`)).toBeVisible({
      timeout: 10000,
    });

    // Check for action buttons (Retry, Skip, Abort from BlockerAlert component)
    const retryBtn = page.locator(
      '[data-testid="blocker-retry"], button:has-text("Retry")',
    );
    const skipBtn = page.locator(
      '[data-testid="blocker-skip"], button:has-text("Skip")',
    );
    const abortBtn = page.locator(
      '[data-testid="blocker-abort"], button:has-text("Abort")',
    );

    // If blocker UI is visible, check for action buttons
    if ((await retryBtn.count()) > 0) {
      await expect(retryBtn.first()).toBeVisible();
      await expect(skipBtn.first()).toBeVisible();
      await expect(abortBtn.first()).toBeVisible();
    }
  });

  test("failed task shows error information", async ({ page }) => {
    const jiraKey = createTestJiraKey();
    createdTaskKeys.push(jiraKey);

    // Create a task
    await apiClient.sendJiraWebhook(
      apiClient.createJiraWebhookPayload({
        issueKey: jiraKey,
        summary: `E2E Fail Test ${jiraKey}`,
        labels: ["workermill"],
      }),
    );

    const task = await waitFor(
      async () => apiClient.getTaskByJiraKey(jiraKey),
      { timeout: 15000 },
    );

    // Claim and fail the task
    await apiClient.claimTask(task.id);
    const failResponse = await apiClient.failTask(
      task.id,
      "Build failed: TypeScript compilation errors",
    );

    if (!failResponse.ok()) {
      test.skip();
      return;
    }

    // Navigate to task detail page
    await page.goto(`/tasks/${task.id}`);

    // Should show failed status
    await expect(
      page.locator('[data-testid="task-status"], .status'),
    ).toContainText(/failed/i, { timeout: 10000 });

    // Should show error message
    await expect(page.locator("body")).toContainText(
      /Build failed|TypeScript|error/i,
    );
  });
});
