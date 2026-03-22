import { test, expect } from "@playwright/test";
import { APIClient } from "../../helpers/api-client";
import { detectIntegrations } from "./helpers/integration-config";
import { cleanupBranches } from "./helpers/github-helpers";
import { waitForStatus, getRandomPrdTask, TERMINAL_STATUSES, SUCCESS_STATUSES } from "./helpers/task-helpers";

const isLocal = !process.env.BASE_URL;

test.describe("Multi-Story PRD Execution", () => {
  test.skip(!isLocal, "Integration tests only run against local stack");

  let api: APIClient;

  test.beforeEach(async ({ request }) => {
    api = new APIClient(request);
    const config = await detectIntegrations(request);
    test.skip(!config.hasOllama, "Ollama not available");
  });

  test.afterAll(async () => {
    await cleanupBranches("story/int-");
  });

  test("PRD task decomposes and all stories complete", async () => {
    test.setTimeout(720_000); // 12 min for multi-story

    const task = getRandomPrdTask();
    const payload = api.createJiraWebhookPayload({
      issueKey: task.jiraKey,
      summary: task.summary,
      description: task.description,
      labels: ["workermill", "prd"],
    });

    const response = await api.sendJiraWebhook(payload);
    expect(response.ok()).toBeTruthy();

    // Wait for terminal state — multi-story tasks take longer
    const finalStatus = await waitForStatus(
      api, task.jiraKey, TERMINAL_STATUSES, 660_000,
    );

    // Should succeed (not fail or escalate)
    expect(finalStatus).not.toBe("failed");
    expect(finalStatus).not.toBe("escalated");
  });
});
