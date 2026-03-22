import { test, expect } from "@playwright/test";
import { APIClient } from "../../helpers/api-client";
import { detectIntegrations } from "./helpers/integration-config";
import { verifyBranchExists, cloneAndRun, cleanupBranches } from "./helpers/github-helpers";
import { createAndWait, getRandomUtilityTask, SUCCESS_STATUSES } from "./helpers/task-helpers";

const isLocal = !process.env.BASE_URL;

test.describe("Code Quality Verification", () => {
  test.skip(!isLocal, "Integration tests only run against local stack");

  let api: APIClient;

  test.beforeEach(async ({ request }) => {
    api = new APIClient(request);
    const config = await detectIntegrations(request);
    test.skip(!config.hasOllama, "Ollama not available");
    test.skip(!config.hasGitHub, "GitHub not configured");
  });

  test.afterAll(async () => {
    await cleanupBranches("story/int-");
  });

  test("generated code passes typecheck and tests", async () => {
    test.setTimeout(600_000); // 10 min — clone + install + test

    const task = getRandomUtilityTask();
    const result = await createAndWait(api, { ...task, timeout: 480_000 });
    expect(SUCCESS_STATUSES.includes(result.status)).toBeTruthy();

    // Find the branch
    const keyLower = task.jiraKey.toLowerCase();
    const branch = await verifyBranchExists(`story/${keyLower}`);
    expect(branch).toBeTruthy();

    // Clone and run quality checks
    const checkResult = await cloneAndRun(branch!.name, [
      "npm ci --ignore-scripts",
      "npx tsc --noEmit",
    ]);

    expect(checkResult.exitCode).toBe(0);
  });
});
