import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, ".env") });

/**
 * Playwright config for integration tests ONLY.
 *
 * Forces sequential execution (1 worker, no parallelism) because
 * all tests share a single Ollama GPU instance.
 *
 * Usage:
 *   npx playwright test --config=playwright.integration.config.ts
 */
export default defineConfig({
  testDir: "./e2e/tests/integration",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],

  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: "integration",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],

  timeout: 480_000,
  expect: { timeout: 10000 },
});
