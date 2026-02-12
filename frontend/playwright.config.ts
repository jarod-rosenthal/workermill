import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for WorkerMill E2E tests.
 *
 * Tests can run against any environment:
 * - Local dev: http://localhost:5173 (default, auto-starts dev server)
 * - Deployed: Set BASE_URL=https://workermill.com
 * - CI: Set BASE_URL and CI=true (skips dev server startup)
 *
 * Environment variables:
 * - BASE_URL: Override the base URL (default: http://localhost:5173)
 * - E2E_TEST_USER_EMAIL: Test user email for authentication
 * - E2E_TEST_USER_PASSWORD: Test user password for authentication
 * - E2E_API_KEY: API key for test data setup/teardown via APIClient
 */
export default defineConfig({
  testDir: "./e2e/tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { outputFolder: "playwright-report" }], ["list"]],

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
    },

    // Unauthenticated tests (login page, etc.)
    {
      name: "unauthenticated",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /.*\.unauth\.spec\.ts/,
    },
  ],

  // Output folder for test artifacts
  outputDir: "e2e/test-results",

  // Global timeout for each test
  timeout: 60000,

  // Expect timeout
  expect: {
    timeout: 10000,
  },

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
