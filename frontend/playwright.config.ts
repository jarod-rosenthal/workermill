import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for WorkerMill E2E tests.
 *
 * Tests run against the production environment (workermill.com) which provides:
 * - Real authentication via Cognito
 * - Real database (PostgreSQL via self-hosted runner in VPC)
 * - Real API endpoints
 *
 * Environment variables:
 * - BASE_URL: Override the base URL (default: https://workermill.com)
 * - E2E_TEST_USER_EMAIL: Test user email for authentication
 * - E2E_TEST_USER_PASSWORD: Test user password for authentication
 */
export default defineConfig({
  testDir: "./e2e/tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { outputFolder: "playwright-report" }], ["list"]],

  use: {
    baseURL: process.env.BASE_URL || "https://workermill.com",
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

  // Web server - not used since we test against deployed environment
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:5173',
  //   reuseExistingServer: !process.env.CI,
  // },
});
