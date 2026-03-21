import { test as setup, expect } from "@playwright/test";
import { testUser } from "../helpers/test-data";

const authFile = "e2e/.auth/user.json";

/**
 * Authentication setup - runs once before all tests.
 *
 * Handles two modes:
 * 1. Production/Cognito: Navigates to /login, fills credentials, submits form
 * 2. Local dev (EXECUTION_MODE=local): /login auto-authenticates and redirects to /dashboard
 */
setup("authenticate", async ({ page }) => {
  const isProduction = !!process.env.BASE_URL?.includes("workermill.com");

  // Production mode: require credentials
  if (isProduction) {
    if (!testUser.email || !testUser.password) {
      throw new Error(
        "E2E_TEST_USER_EMAIL and E2E_TEST_USER_PASSWORD must be set for production tests.",
      );
    }
  }

  // Navigate to login page
  await page.goto("/login");

  // Wait to see where we end up — either login form or auto-redirect to dashboard
  try {
    // If we land on dashboard within 10s, local auto-login worked — skip credential fill
    await page.waitForURL(/.*dashboard.*/, { timeout: 10000 });
    console.log("Auto-login detected (local mode) — skipping credential fill");
  } catch {
    // Still on login/cognito page — need to fill credentials
    if (!testUser.email || !testUser.password) {
      throw new Error(
        "Login form displayed but E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD not set.",
      );
    }

    const currentUrl = page.url();

    if (currentUrl.includes("cognito")) {
      // Cognito hosted UI
      await page.fill('input[name="username"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.click('input[type="submit"], button[type="submit"]');
    } else {
      // Custom login form
      await page.fill('[data-testid="email-input"], input[type="email"]', testUser.email);
      await page.fill('[data-testid="password-input"], input[type="password"]', testUser.password);
      await page.click('[data-testid="login-button"], button[type="submit"]');
    }

    // Wait for redirect to dashboard after login
    await page.waitForURL(/.*dashboard.*|.*\/$/, { timeout: 30000 });
  }

  // Verify we're authenticated
  await expect(
    page.locator('[data-testid="dashboard"], [data-testid="user-menu"], nav').first(),
  ).toBeVisible({ timeout: 10000 });

  // Save authentication state
  await page.context().storageState({ path: authFile });
  console.log("Authentication setup complete");
});
