import { test, expect } from "@playwright/test";
import { APIClient } from "../../helpers/api-client";
import { detectIntegrations } from "./helpers/integration-config";
import { verifyBranchExists, verifyPRExists, getBranchDiff, cleanupBranches } from "./helpers/github-helpers";
import { createAndWait, getRandomUtilityTask, getRandomEndpointTask } from "./helpers/task-helpers";

const isLocal = !process.env.BASE_URL;

test.describe("GitHub Verification", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!isLocal, "Integration tests only run against local stack");

  let api: APIClient;
  let jiraKey: string;

  test.beforeEach(async ({ request }) => {
    api = new APIClient(request);
    const config = await detectIntegrations(request);
    test.skip(!config.hasGitHub, "GitHub not configured");
    test.skip(!config.hasOllama, "Ollama not available — need AI to generate code");
  });

  test.afterAll(async () => {
    // Clean up test branches
    await cleanupBranches("story/int-");
  });

  test("completed task creates branch with non-empty diff on GitHub", async () => {
    test.setTimeout(480_000);

    const task = getRandomUtilityTask();
    jiraKey = task.jiraKey;

    const result = await createAndWait(api, { ...task, timeout: 450_000 });
    expect(["pr_approved", "review_approved", "completed", "review_requested"].includes(result.status)).toBeTruthy();

    // Verify branch exists
    const keyLower = jiraKey.toLowerCase();
    const branch = await verifyBranchExists(`story/${keyLower}`);
    expect(branch).toBeTruthy();
    expect(branch!.name).toContain(keyLower);

    // Verify diff is non-empty
    const diff = await getBranchDiff(branch!.name);
    expect(diff).toBeTruthy();
    expect(diff!.files.length).toBeGreaterThan(0);
    expect(diff!.totalChanges).toBeGreaterThan(0);
  });

  test("completed task creates PR on GitHub", async () => {
    test.setTimeout(480_000);

    const task = getRandomEndpointTask();
    jiraKey = task.jiraKey;

    const result = await createAndWait(api, { ...task, timeout: 450_000 });
    expect(["pr_approved", "review_approved", "completed", "review_requested"].includes(result.status)).toBeTruthy();

    // Verify PR exists — unless the task completed without code changes
    const keyLower = jiraKey.toLowerCase();
    const branch = await verifyBranchExists(`story/${keyLower}`);
    if (!branch) {
      // No branch means either no code changes (completed) or branch deleted after merge (pr_approved)
      expect(["completed", "pr_approved", "review_approved"].includes(result.status)).toBeTruthy();
      // If PR was merged, verify via PR search (branch may be deleted but PR record remains)
      if (result.status === "pr_approved" || result.status === "review_approved") {
        const pr = await verifyPRExists(`story/${keyLower}`);
        expect(pr).toBeTruthy();
      }
    } else {
      // Branch exists — PR should exist (open for review_requested, any state otherwise)
      const pr = await verifyPRExists(`story/${keyLower}`);
      expect(pr).toBeTruthy();
      expect(pr!.title).toBeTruthy();
    }
  });

  test("cleanup helper deletes test branches", async () => {
    // This test verifies cleanup works — branches from prior tests should be deletable
    const deleted = await cleanupBranches("story/int-");
    // Just verify it doesn't throw — count may be 0 if prior cleanup already ran
    expect(deleted).toBeGreaterThanOrEqual(0);
  });
});
