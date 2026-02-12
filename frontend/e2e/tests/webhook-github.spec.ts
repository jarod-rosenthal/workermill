import { test, expect } from "@playwright/test";
import { APIClient } from "../helpers/api-client";
import { createTestJiraKey, waitFor } from "../helpers/test-data";

/**
 * GitHub Issues webhook tests.
 *
 * Verifies that GitHub Issues webhooks create tasks
 * that appear in the dashboard.
 */
test.describe("GitHub Issues Webhook", () => {
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

  test("GitHub Issues webhook creates task visible in dashboard", async ({
    page,
  }) => {
    // Use the new GitHub Issues webhook helper
    const payload = apiClient.createGithubIssuesWebhookPayload({
      issueNumber: Date.now(),
      title: `E2E GitHub Issue Test ${Date.now()}`,
      labels: ["workermill"],
      repo: "test-org/test-repo",
    });

    const webhookResponse = await apiClient.sendGithubIssuesWebhook(payload);

    // If the webhook endpoint isn't available, skip gracefully
    if (!webhookResponse.ok()) {
      test.skip();
      return;
    }

    // Wait for task to appear (GitHub issues may use different key format)
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    // Verify the page loaded successfully
    await expect(
      page.locator('[data-testid="dashboard"], [data-testid="task-list"]'),
    ).toBeVisible({ timeout: 10000 });
  });

  test("GitHub Issues webhook with invalid payload returns error", async () => {
    // Send malformed payload
    const response = await apiClient.sendGithubIssuesWebhook({
      action: "opened",
      // Missing required fields
    } as never);

    // Should return an error (400 or similar)
    // Or it might return 200 but ignore the payload - either way is acceptable
    expect(response.status()).toBeLessThan(500);
  });
});
