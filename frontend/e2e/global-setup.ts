import { request } from "@playwright/test";

/**
 * Runs once before all tests. Verifies the target environment is healthy.
 */
async function globalSetup() {
  const baseURL = process.env.BASE_URL || "http://localhost:5173";

  // Derive API URL — locally API is on :3001, in production it's same host
  const apiURL = baseURL.includes("localhost")
    ? baseURL.replace(/:\d+$/, ":3001")
    : baseURL;

  const ctx = await request.newContext({ baseURL: apiURL });

  try {
    const health = await ctx.get("/health");
    if (!health.ok()) {
      throw new Error(
        `API health check failed (${health.status()}). Is the API running at ${apiURL}?`,
      );
    }
    console.log(`[global-setup] API healthy at ${apiURL}`);
  } finally {
    await ctx.dispose();
  }
}

export default globalSetup;
