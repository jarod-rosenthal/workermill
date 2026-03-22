import { test as setup } from "@playwright/test";
import { resetRepoToBaseline, cleanupBranches } from "./helpers/github-helpers";

/**
 * Integration test setup — runs once before all integration tests.
 * Resets the test repo (jarod-rosenthal/test) to a clean baseline
 * so tests don't collide with files/branches from previous runs.
 */
// Only run when integration tests are being executed (not mock E2E)
const isIntegrationRun = process.argv.some((a) => a.includes("integration"));

setup("reset test repo to baseline", async () => {
  setup.skip(!isIntegrationRun, "Skipping repo reset — not an integration test run");
  setup.setTimeout(30_000);

  console.log("[integration-setup] Resetting jarod-rosenthal/test to e2e-baseline tag...");
  await resetRepoToBaseline();
  console.log("[integration-setup] Repo reset complete");

  // Also clean up any leftover story branches
  const deleted = await cleanupBranches("story/");
  if (deleted > 0) {
    console.log(`[integration-setup] Cleaned up ${deleted} stale branches`);
  }
});
