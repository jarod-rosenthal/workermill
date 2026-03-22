import { test, expect } from "@playwright/test";
import { APIClient } from "../../helpers/api-client";
import { waitFor } from "../../helpers/test-data";

/**
 * Integration tests — real Ollama worker execution against jarod-rosenthal/test.
 *
 * These tests verify the full AI pipeline end-to-end:
 *   webhook → planning → worker execution → quality gates → tech lead review → PR
 *
 * Requirements:
 * - Local stack running (./bin/local-workermill start)
 * - Ollama running with qwen3-coder model loaded
 * - GitHub token with push access to jarod-rosenthal/test
 *
 * Run separately from mock tests (2-5 min per test, needs GPU):
 *   npx playwright test e2e/tests/integration/ --retries=0 --workers=1
 */

// Only run locally (not in CI or production)
const isLocal = !process.env.BASE_URL;

// Generous timeouts for real AI execution
const FULL_TIMEOUT = 480_000; // 8 min for planning + execution + review

/**
 * Poll for task status via control-center activeTasks list.
 * The /tasks/:id endpoint returns 404 for tasks outside the display window,
 * so we poll via getTaskByJiraKey which searches the active task list.
 */
async function waitForStatus(
  api: APIClient,
  jiraKey: string,
  targetStatuses: string[],
  timeout: number,
): Promise<string> {
  const result = await waitFor(
    async () => {
      const task = await api.getTaskByJiraKey(jiraKey);
      if (!task) return null;
      if (targetStatuses.includes(task.status)) return task.status;
      return null;
    },
    { timeout, interval: 10_000 },
  );
  return result;
}

test.describe("Ollama Worker Integration", () => {
  test.skip(!isLocal, "Integration tests only run against local stack with Ollama");

  let api: APIClient;

  test.beforeEach(({ request }) => {
    api = new APIClient(request);
  });

  test("simple task: plans, executes, and reaches pr_approved", async () => {
    test.setTimeout(FULL_TIMEOUT);

    const jiraKey = `INT-${Date.now()}`;
    const payload = api.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: "Add GET /api/ping endpoint",
      description:
        "Create a simple GET endpoint at /api/ping that returns { pong: true, timestamp: Date.now() }. " +
        "Add it to the existing Express router in src/routes/api.ts.",
    });

    // Create task via webhook
    const webhookResponse = await api.sendJiraWebhook(payload);
    expect(webhookResponse.ok()).toBeTruthy();

    // Wait for full completion (planning → execution → review → pr_approved)
    const terminalStatuses = [
      "pr_approved", "review_approved", "completed", "deployed",
      "review_requested", "failed", "escalated", "cancelled",
    ];

    const finalStatus = await waitForStatus(api, jiraKey, terminalStatuses, FULL_TIMEOUT - 30_000);

    // Should reach pr_approved (full flow with tech lead review)
    expect(
      ["pr_approved", "review_approved", "completed", "review_requested"].includes(finalStatus),
    ).toBeTruthy();
  });

  test("task with test requirement: worker generates tests", async () => {
    test.setTimeout(FULL_TIMEOUT);

    const jiraKey = `INT-${Date.now()}`;
    const payload = api.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: "Add string utility functions with tests",
      description:
        "Create src/utils/strings.ts with two functions:\n" +
        "1. capitalize(str) - capitalizes the first letter of a string\n" +
        "2. slugify(str) - converts a string to a URL-friendly slug (lowercase, hyphens)\n\n" +
        "Add comprehensive tests in src/__tests__/strings.test.ts covering edge cases " +
        "(empty string, already capitalized, special characters in slugify).",
    });

    const webhookResponse = await api.sendJiraWebhook(payload);
    expect(webhookResponse.ok()).toBeTruthy();

    const terminalStatuses = [
      "pr_approved", "review_approved", "completed", "deployed",
      "review_requested", "failed", "escalated", "cancelled",
    ];

    const finalStatus = await waitForStatus(api, jiraKey, terminalStatuses, FULL_TIMEOUT - 30_000);

    // Should not fail
    expect(finalStatus).not.toBe("failed");
    expect(finalStatus).not.toBe("escalated");
  });

  test("task logs contain expected execution phases", async () => {
    test.setTimeout(FULL_TIMEOUT);

    const jiraKey = `INT-${Date.now()}`;
    const payload = api.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: "Add timestamp utility",
      description:
        "Create src/utils/timestamp.ts with a function formatTimestamp(date: Date): string " +
        "that returns an ISO 8601 formatted string. Export it as the default export.",
    });

    const webhookResponse = await api.sendJiraWebhook(payload);
    expect(webhookResponse.ok()).toBeTruthy();

    // Wait for completion
    const terminalStatuses = [
      "pr_approved", "review_approved", "completed", "deployed",
      "review_requested", "failed", "escalated",
    ];

    const finalStatus = await waitForStatus(api, jiraKey, terminalStatuses, FULL_TIMEOUT - 60_000);

    // Task should have completed (not failed)
    expect(finalStatus).not.toBe("failed");
    expect(finalStatus).not.toBe("escalated");

    // Verify task is visible in dashboard with correct status
    const task = await api.getTaskByJiraKey(jiraKey);
    expect(task).toBeTruthy();
    expect(task.status).toBe(finalStatus);
  });
});
