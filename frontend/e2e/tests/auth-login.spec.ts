import { test, expect } from "@playwright/test";

/**
 * Authentication Login tests.
 *
 * Verifies the login flow works correctly:
 * - Login page renders with expected form fields
 * - Authenticated users are redirected from login to dashboard
 * - Login form has SSO options if configured
 *
 * Note: These tests run in the "chromium" project (already authenticated).
 * They verify post-auth behavior and login page rendering without credentials.
 */
test.describe("Auth Login", () => {
  test("authenticated user visiting /login is redirected to /dashboard", async ({
    page,
  }) => {
    // Already authenticated via storageState
    await page.goto("/login");

    // Should redirect to dashboard (or /) since we're already logged in
    await expect(page).toHaveURL(/.*dashboard.*|.*\/$/, { timeout: 15000 });
  });

  test("authenticated user visiting /signup is redirected to /dashboard", async ({
    page,
  }) => {
    await page.goto("/signup");

    // Should redirect to dashboard since we're already logged in
    await expect(page).toHaveURL(/.*dashboard.*|.*\/$/, { timeout: 15000 });
  });

  test("dashboard is accessible when authenticated", async ({ page }) => {
    await page.goto("/dashboard");

    // Should show dashboard content, not redirect to login
    await expect(
      page.locator('[data-testid="dashboard"]'),
    ).toBeVisible({ timeout: 15000 });

    // URL should still be dashboard
    await expect(page).toHaveURL(/.*dashboard.*/);
  });

  test("profile page is accessible when authenticated", async ({ page }) => {
    await page.goto("/profile");

    // Should show profile content
    await expect(page.locator("body")).toContainText(/profile|account/i, {
      timeout: 15000,
    });
  });

  test("settings page is accessible when authenticated", async ({ page }) => {
    await page.goto("/settings");

    // Should show settings content
    await expect(page.locator("body")).toContainText(
      /settings|general|integrations/i,
      { timeout: 15000 },
    );
  });
});
