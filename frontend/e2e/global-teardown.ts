import { request } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Runs once after all tests. Cleans up E2E test data.
 */
async function globalTeardown() {
  const baseURL = process.env.BASE_URL || "http://localhost:5173";
  const apiURL = baseURL.includes("localhost")
    ? baseURL.replace(/:\d+$/, ":3001")
    : baseURL;

  // Load auth state to make authenticated cleanup requests
  const authFile = path.resolve(__dirname, ".auth/user.json");
  if (!fs.existsSync(authFile)) {
    console.log("[global-teardown] No auth state found, skipping cleanup");
    return;
  }

  const ctx = await request.newContext({
    baseURL: apiURL,
    storageState: authFile,
  });

  try {
    // Clean up E2E test tasks (all ages — cleanup everything from this run)
    const response = await ctx.delete("/api/control-center/tasks/cleanup", {
      params: { prefix: "E2E-", maxAge: "0" },
    });

    if (response.ok()) {
      const data = await response.json();
      console.log(`[global-teardown] Cleaned up ${data.deleted} E2E tasks`);
    } else {
      console.log(
        `[global-teardown] Cleanup returned ${response.status()} (may need admin role)`,
      );
    }
  } catch (err) {
    console.log("[global-teardown] Cleanup failed (non-fatal):", err);
  } finally {
    await ctx.dispose();
  }
}

export default globalTeardown;
