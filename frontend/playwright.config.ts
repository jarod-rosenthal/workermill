import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from frontend/ directory (for E2E credentials)
dotenv.config({ path: resolve(__dirname, ".env") });

/**
 * Playwright configuration for WorkerMill E2E tests.
 *
 * One test suite that runs against any environment:
 * - Local dev: http://localhost:5173 (default, auto-starts dev server)
 * - Production: Set BASE_URL=https://workermill.com
 * - CI: Set BASE_URL and CI=true
 *
 * Environment variables (set in frontend/.env or shell):
 * - BASE_URL: Override the base URL (default: http://localhost:5173)
 * - E2E_TEST_USER_EMAIL: Test user email for authentication
 * - E2E_TEST_USER_PASSWORD: Test user password for authentication
 */
export default defineConfig({
  testDir: "./e2e/tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [
    ["html", { outputFolder: "playwright-report" }],
    ["list"],
    ...(process.env.CI ? [["./e2e/github-summary-reporter.ts"] as [string]] : []),
  ],

  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    // Setup project that handles authentication
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },

    // Main test suite using authenticated state
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
      testIgnore: /auth-routes\.spec\.ts/,
    },

    // Unauthenticated tests (route protection, public pages)
    {
      name: "unauthenticated",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /auth-routes\.spec\.ts/,
    },
  ],

  outputDir: "e2e/test-results",
  timeout: 60000,
  expect: { timeout: 10000 },

  // Only start dev servers if not running against a deployed environment
  ...(!process.env.CI && !process.env.BASE_URL
    ? {
        webServer: [
          {
            command: "npx vite",
            url: "http://localhost:5173",
            reuseExistingServer: true,
            timeout: 30000,
          },
        ],
      }
    : {}),
});
