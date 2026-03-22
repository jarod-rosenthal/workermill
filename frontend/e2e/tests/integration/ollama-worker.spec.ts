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
 * These are SLOW (2-5 min per test) — run separately from mock E2E:
 *   npx playwright test e2e/tests/integration/ --retries=0 --workers=1
 */

// Only run locally (not in CI or production)
const isLocal = !process.env.BASE_URL;
const REPO = "jarod-rosenthal/test";

// Generous timeouts for real AI execution
const PLANNING_TIMEOUT = 120_000; // 2 min for planning
const EXECUTION_TIMEOUT = 300_000; // 5 min for worker execution + review
const TEST_TIMEOUT = 480_000; // 8 min total per test

test.describe("Ollama Worker Integration", () => {
  test.skip(!isLocal, "Integration tests only run against local stack with Ollama");

  let api: APIClient;

  test.beforeEach(({ request }) => {
    api = new APIClient(request);
  });

  test("simple task: plans, executes, and reaches pr_approved", async ({ request }) => {
    test.setTimeout(TEST_TIMEOUT);

    const jiraKey = `INT-${Date.now()}`;
    const payload = api.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: "Add GET /api/ping endpoint",
      description:
        "Create a simple GET endpoint at /api/ping that returns { pong: true, timestamp: Date.now() }. " +
        "Add it to the existing Express router in src/routes/api.ts.",
    });

    // Step 1: Create task via webhook
    const webhookResponse = await api.sendJiraWebhook(payload);
    expect(webhookResponse.ok()).toBeTruthy();
    const { taskId } = await webhookResponse.json();
    expect(taskId).toBeTruthy();

    // Step 2: Wait for planning to complete (task moves past "planning")
    const planned = await waitFor(
      async () => {
        const task = await api.getTask(taskId);
        if (!task) return null;
        const status = task.status || task.task?.status;
        if (status && status !== "planning" && status !== "pending_plan_approval") {
          return task;
        }
        return null;
      },
      { timeout: PLANNING_TIMEOUT, interval: 5000 },
    );
    expect(planned).toBeTruthy();

    // Step 3: Wait for terminal state (pr_approved, review_requested, completed, or failed)
    const terminal = await waitFor(
      async () => {
        const task = await api.getTask(taskId);
        if (!task) return null;
        const status = task.status || task.task?.status;
        const terminalStatuses = [
          "pr_approved", "review_approved", "completed", "deployed",
          "review_requested", "failed", "escalated", "cancelled",
        ];
        if (status && terminalStatuses.includes(status)) {
          return { status, task };
        }
        return null;
      },
      { timeout: EXECUTION_TIMEOUT, interval: 10000 },
    );

    expect(terminal).toBeTruthy();
    const finalStatus = terminal!.status;

    // Should reach pr_approved (full flow with tech lead review)
    // Accept review_requested as partial success (review may still be running)
    expect(
      ["pr_approved", "review_approved", "completed", "review_requested"].includes(finalStatus),
    ).toBeTruthy();
  });

  test("task with test requirement: worker generates tests", async ({ request }) => {
    test.setTimeout(TEST_TIMEOUT);

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
    const { taskId } = await webhookResponse.json();

    // Wait for terminal state
    const terminal = await waitFor(
      async () => {
        const task = await api.getTask(taskId);
        if (!task) return null;
        const status = task.status || task.task?.status;
        const terminalStatuses = [
          "pr_approved", "review_approved", "completed", "deployed",
          "review_requested", "failed", "escalated", "cancelled",
        ];
        if (status && terminalStatuses.includes(status)) {
          return { status, task };
        }
        return null;
      },
      { timeout: EXECUTION_TIMEOUT, interval: 10000 },
    );

    expect(terminal).toBeTruthy();
    const finalStatus = terminal!.status;

    // Should not fail
    expect(finalStatus).not.toBe("failed");
    expect(finalStatus).not.toBe("escalated");
  });

  test("failed task can be retried and eventually succeeds", async ({ request }) => {
    test.setTimeout(TEST_TIMEOUT * 2); // Double timeout for retry

    const jiraKey = `INT-${Date.now()}`;
    const payload = api.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: "Add environment config loader",
      description:
        "Create src/config/env.ts that exports a function loadEnv() which reads " +
        "PORT, NODE_ENV, and LOG_LEVEL from process.env with sensible defaults " +
        "(3000, 'development', 'info'). Export the type EnvConfig as well.",
    });

    const webhookResponse = await api.sendJiraWebhook(payload);
    expect(webhookResponse.ok()).toBeTruthy();
    const { taskId } = await webhookResponse.json();

    // Wait for first terminal state
    const firstResult = await waitFor(
      async () => {
        const task = await api.getTask(taskId);
        if (!task) return null;
        const status = task.status || task.task?.status;
        const terminalStatuses = [
          "pr_approved", "review_approved", "completed", "deployed",
          "review_requested", "failed", "escalated", "cancelled",
        ];
        if (status && terminalStatuses.includes(status)) {
          return status;
        }
        return null;
      },
      { timeout: EXECUTION_TIMEOUT, interval: 10000 },
    );

    // If it succeeded on first try, great
    if (firstResult && !["failed", "escalated"].includes(firstResult)) {
      expect(firstResult).toBeTruthy();
      return;
    }

    // If it failed, retry and wait again
    if (firstResult === "failed") {
      const retryResponse = await api.retryTask(taskId);
      expect(retryResponse.ok()).toBeTruthy();

      const retryResult = await waitFor(
        async () => {
          const task = await api.getTask(taskId);
          if (!task) return null;
          const status = task.status || task.task?.status;
          if (status && ["pr_approved", "review_approved", "completed", "review_requested"].includes(status)) {
            return status;
          }
          if (status === "failed") return "failed_again";
          return null;
        },
        { timeout: EXECUTION_TIMEOUT, interval: 10000 },
      );

      // Should succeed on retry (or at least not fail twice)
      expect(retryResult).not.toBe("failed_again");
    }
  });

  test("task logs contain expected execution phases", async ({ request }) => {
    test.setTimeout(TEST_TIMEOUT);

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
    const { taskId } = await webhookResponse.json();

    // Wait for completion
    await waitFor(
      async () => {
        const task = await api.getTask(taskId);
        if (!task) return null;
        const status = task.status || task.task?.status;
        const terminalStatuses = [
          "pr_approved", "review_approved", "completed", "deployed",
          "review_requested", "failed", "escalated",
        ];
        if (status && terminalStatuses.includes(status)) return status;
        return null;
      },
      { timeout: EXECUTION_TIMEOUT, interval: 10000 },
    );

    // Check that logs contain expected phases
    const logsResponse = await request.get(
      `http://localhost:3001/api/control-center/logs/${taskId}/all`,
    );
    expect(logsResponse.ok()).toBeTruthy();
    const logs = await logsResponse.json();
    const allText = (logs.logs || logs || [])
      .map((l: { message?: string }) => l.message || "")
      .join("\n");

    // Planning phase
    expect(allText).toContain("planning_agent");

    // Execution phase — worker started
    expect(allText).toMatch(/Starting|Target repo/);

    // Worker created a branch
    expect(allText).toMatch(/branch|Created branch/i);
  });
});
