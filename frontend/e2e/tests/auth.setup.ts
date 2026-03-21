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
  // Fail fast if credentials are missing
  if (!testUser.email) {
    throw new Error(
      "E2E_TEST_USER_EMAIL is not set. Set it in your environment or .env file before running E2E tests.",
    );
  }
  if (!testUser.password) {
    throw new Error(
      "E2E_TEST_USER_PASSWORD is not set. Set it in your environment or .env file before running E2E tests.",
    );
  }

  // Navigate to login page directly.
  // Going to "/" lands on the public homepage which doesn't redirect.
  // Going to "/login" triggers Cognito redirect or shows the login form.
  await page.goto("/login");

  // Wait for Cognito hosted UI redirect or for the login form to render.
  const loginTimeout = 45000;
  try {
    await page.waitForURL(/.*login.*|.*cognito.*|.*auth.*/, {
      timeout: loginTimeout,
    });
  } catch {
    const currentUrl = page.url();
    throw new Error(
      `Login page not loaded within ${loginTimeout}ms. ` +
        `Current URL: ${currentUrl}. ` +
        `Expected URL containing "login", "cognito", or "auth".`,
    );
  }

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
  // Works for both localhost (/) and workermill.com (/dashboard)
  await page.waitForURL(/.*dashboard.*|.*\/$/, { timeout: 30000 });

  // Verify we're authenticated by checking for dashboard elements
  await expect(
    page.locator('[data-testid="dashboard"], [data-testid="user-menu"], nav').first(),
  ).toBeVisible({
    timeout: 10000,
  });

  // Save authentication state
  await page.context().storageState({ path: authFile });

  console.log("Authentication setup complete");
});
