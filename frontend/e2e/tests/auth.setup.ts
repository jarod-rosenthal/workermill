import { test as setup, expect } from "@playwright/test";
import { testUser } from "../helpers/test-data";

const authFile = "e2e/.auth/user.json";

/**
 * Authentication setup - runs once before all tests.
 *
 * Logs in via Cognito hosted UI and saves the session state
 * to be reused by other tests.
 */
setup("authenticate", async ({ page }) => {
  // Skip if no credentials provided
  if (!testUser.password) {
    console.warn("⚠️  E2E_TEST_USER_PASSWORD not set, skipping authentication setup");
    // Create empty auth state
    await page.context().storageState({ path: authFile });
    return;
  }

  // Navigate to the app - should redirect to login
  await page.goto("/");

  // Wait for redirect to Cognito hosted UI or login page
  // WorkerMill uses Cognito hosted UI for authentication
  await page.waitForURL(/.*login.*|.*cognito.*|.*auth.*/, { timeout: 30000 });

  // Check if we're on Cognito hosted UI
  const isCognitoUI = page.url().includes("cognito");

  if (isCognitoUI) {
    // Fill Cognito hosted UI login form
    await page.fill('input[name="username"]', testUser.email);
    await page.fill('input[name="password"]', testUser.password);
    await page.click('input[type="submit"], button[type="submit"]');
  } else {
    // Fill custom login form (if using custom UI)
    await page.fill('[data-testid="email-input"], input[type="email"]', testUser.email);
    await page.fill('[data-testid="password-input"], input[type="password"]', testUser.password);
    await page.click('[data-testid="login-button"], button[type="submit"]');
  }

  // Wait for successful login - should redirect to dashboard
  await page.waitForURL(/.*dashboard.*|.*\/$/, { timeout: 30000 });

  // Verify we're authenticated by checking for dashboard elements
  await expect(page.locator('[data-testid="dashboard"], [data-testid="user-menu"], nav')).toBeVisible({
    timeout: 10000,
  });

  // Save authentication state
  await page.context().storageState({ path: authFile });

  console.log("✅ Authentication setup complete");
});
