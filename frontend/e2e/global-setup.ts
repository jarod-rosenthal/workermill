import { request } from "@playwright/test";

/**
 * Runs once before all tests. Verifies the target environment is healthy.
 * For local targets, retries the health check to allow the API time to start.
 */
async function globalSetup() {
  const baseURL = process.env.BASE_URL || "http://localhost:5173";

  // Derive API URL — locally API is on :3001, in production it's same host
  const apiURL = baseURL.includes("localhost")
    ? baseURL.replace(/:\d+$/, ":3001")
    : baseURL;

  const isLocal = !process.env.BASE_URL;
  const maxRetries = isLocal ? 30 : 1; // Retry for up to 30s on local
  const retryDelay = 1000;

  const ctx = await request.newContext({ baseURL: apiURL });

  try {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const health = await ctx.get("/health");
        if (health.ok()) {
          console.log(`[global-setup] API healthy at ${apiURL}`);
          return;
        }
      } catch {
        // Connection refused — API not ready yet
      }

      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, retryDelay));
      }
    }

    throw new Error(
      `API health check failed after ${maxRetries} attempts. Is the API running at ${apiURL}?`,
    );
  } finally {
    await ctx.dispose();
  }
}

export default globalSetup;
