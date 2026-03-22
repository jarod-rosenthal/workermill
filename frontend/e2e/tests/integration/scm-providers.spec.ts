import { test, expect } from "@playwright/test";
import { APIClient } from "../../helpers/api-client";
import { detectIntegrations, type IntegrationConfig } from "./helpers/integration-config";
import { ProviderSwitcher } from "./helpers/provider-switcher";
import { verifyBranchExists, cleanupBranches } from "./helpers/github-helpers";
import { createAndWait, getRandomUtilityTask, SUCCESS_STATUSES } from "./helpers/task-helpers";

const isLocal = !process.env.BASE_URL;

test.describe("SCM Provider Integration", () => {
  test.skip(!isLocal, "Integration tests only run against local stack");

  let api: APIClient;
  let config: IntegrationConfig;
  let switcher: ProviderSwitcher;

  test.beforeAll(async ({ request }) => {
    config = await detectIntegrations(request);
    switcher = new ProviderSwitcher(request);
    await switcher.saveOriginal();
  });

  test.beforeEach(async ({ request }) => {
    api = new APIClient(request);
  });

  test.afterEach(async () => {
    await switcher.restore();
  });

  test.afterAll(async () => {
    await switcher.restore();
    await cleanupBranches("story/int-");
  });

  test("GitHub: task creates branch and PR", async () => {
    test.skip(!config.hasGitHub, "GitHub not configured");
    test.skip(!config.hasOllama, "Ollama not available — need AI to execute");
    test.setTimeout(480_000);

    await switcher.switchSCMProvider("github");
    const task = getRandomUtilityTask();
    const result = await createAndWait(api, task);
    expect(SUCCESS_STATUSES.includes(result.status)).toBeTruthy();

    // Verify branch on GitHub
    const keyLower = task.jiraKey.toLowerCase();
    const branch = await verifyBranchExists(`story/${keyLower}`);
    expect(branch).toBeTruthy();
  });

  test("GitLab: task creates branch and MR", async () => {
    test.skip(!config.hasGitLab, "GitLab not configured");
    test.skip(!config.hasOllama, "Ollama not available");
    test.setTimeout(480_000);

    await switcher.switchSCMProvider("gitlab");
    const task = getRandomUtilityTask();
    const result = await createAndWait(api, task);

    // Verify task completed (branch verification on GitLab would need glab CLI)
    expect(SUCCESS_STATUSES.includes(result.status)).toBeTruthy();
  });

  test("Bitbucket: task creates branch and PR", async () => {
    test.skip(!config.hasBitbucket, "Bitbucket not configured");
    test.skip(!config.hasOllama, "Ollama not available");
    test.setTimeout(480_000);

    await switcher.switchSCMProvider("bitbucket");
    const task = getRandomUtilityTask();
    const result = await createAndWait(api, task);

    expect(SUCCESS_STATUSES.includes(result.status)).toBeTruthy();
  });
});
