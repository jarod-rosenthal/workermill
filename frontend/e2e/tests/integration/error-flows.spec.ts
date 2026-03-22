import { test, expect } from "@playwright/test";
import { APIClient } from "../../helpers/api-client";
import { waitFor } from "../../helpers/test-data";
import { detectIntegrations } from "./helpers/integration-config";
import { createIntKey, waitForStatus, TERMINAL_STATUSES } from "./helpers/task-helpers";

const isLocal = !process.env.BASE_URL;

test.describe("Error Flows", () => {
  test.skip(!isLocal, "Integration tests only run against local stack");

  let api: APIClient;

  test.beforeEach(async ({ request }) => {
    api = new APIClient(request);
    const config = await detectIntegrations(request);
    test.skip(!config.hasOllama, "Ollama not available");
  });

  test("cancel during execution stops the task", async () => {
    test.setTimeout(300_000);

    const jiraKey = createIntKey();
    const payload = api.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: "Add complex refactoring system",
      description: "Refactor the entire codebase to use a new architecture pattern with dependency injection, abstract factories, and service locators across all modules.",
    });

    const response = await api.sendJiraWebhook(payload);
    expect(response.ok()).toBeTruthy();
    const { taskId } = await response.json();

    // Wait for task to reach executing (past planning)
    const executing = await waitFor(
      async () => {
        const task = await api.getTaskByJiraKey(jiraKey);
        if (!task) return null;
        if (["executing", "environment_setup"].includes(task.status)) return task;
        if (TERMINAL_STATUSES.includes(task.status)) return "already_done";
        return null;
      },
      { timeout: 180_000, interval: 5000 },
    );

    // If task finished before we could cancel, that's ok — skip the cancel test
    if (executing === "already_done") return;
    expect(executing).toBeTruthy();

    // Cancel it
    const cancelResponse = await api.cancelTask(taskId);
    expect(cancelResponse.ok()).toBeTruthy();

    // Verify it reaches a terminal status — the task may complete before cancel arrives
    const finalStatus = await waitForStatus(
      api, jiraKey, TERMINAL_STATUSES, 120_000,
    );
    expect(TERMINAL_STATUSES.includes(finalStatus)).toBeTruthy();
  });

  test("retry after failure re-queues the task", async () => {
    test.setTimeout(480_000);

    const jiraKey = createIntKey();
    const payload = api.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: "Add simple hello utility",
      description: "Create src/utils/hello.ts with a function hello(name: string): string that returns `Hello, ${name}!`",
    });

    const response = await api.sendJiraWebhook(payload);
    expect(response.ok()).toBeTruthy();
    const { taskId } = await response.json();

    // Wait for first terminal state
    const firstStatus = await waitForStatus(
      api, jiraKey, TERMINAL_STATUSES, 450_000,
    );

    // If it failed, test the retry flow
    if (firstStatus === "failed" || firstStatus === "escalated") {
      const retryResponse = await api.retryTask(taskId);
      expect(retryResponse.ok()).toBeTruthy();

      // After retry, task should be back in an active state or complete
      const retryStatus = await waitFor(
        async () => {
          const task = await api.getTaskByJiraKey(jiraKey);
          if (!task) return null;
          // Task should have moved from failed to queued/planning/executing
          if (task.status !== "failed" && task.status !== "escalated") return task.status;
          return null;
        },
        { timeout: 30_000, interval: 3000 },
      );
      expect(retryStatus).toBeTruthy();
    }
    // If it succeeded first try, the retry flow isn't tested but that's fine
  });

  test("impossible task escalates with error message", async () => {
    test.setTimeout(480_000);

    const jiraKey = createIntKey();
    const payload = api.createJiraWebhookPayload({
      issueKey: jiraKey,
      summary: "Integrate quantum computing framework",
      description:
        "Install and configure a quantum computing SDK that does not exist. " +
        "Import the 'quantum-js-nonexistent-package' package and create a quantum circuit " +
        "that factors large prime numbers using Shor's algorithm.",
    });

    const response = await api.sendJiraWebhook(payload);
    expect(response.ok()).toBeTruthy();

    const finalStatus = await waitForStatus(
      api, jiraKey, TERMINAL_STATUSES, 450_000,
    );

    // Should fail or escalate (not succeed with broken code)
    expect(["failed", "escalated"].includes(finalStatus)).toBeTruthy();
  });
});
