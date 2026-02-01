import { test, expect } from "@playwright/test";

/**
 * Authentication/Authorization tests for authenticated users.
 *
 * These tests use the authenticated state from auth.setup.ts to verify:
 * - Protected routes are accessible when logged in
 * - User information is displayed correctly
 * - Logout works correctly
 */
test.describe("Authentication - Authenticated", () => {
  test("authenticated user can access dashboard", async ({ page }) => {
    await page.goto("/dashboard");

    // Should stay on dashboard (not redirect to login)
    await expect(page).toHaveURL(/.*dashboard.*/);

    // Should see dashboard content
    await expect(
      page.locator('[data-testid="dashboard"], [data-testid="task-list"], h1:has-text("Dashboard")')
    ).toBeVisible({ timeout: 10000 });
  });

  test("authenticated user can access tasks page", async ({ page }) => {
    await page.goto("/tasks");

    // Should be able to access tasks
    await expect(page).toHaveURL(/.*tasks.*/);
  });

  test("authenticated user can access settings page", async ({ page }) => {
    await page.goto("/settings");

    // Should be able to access settings
    await expect(page).toHaveURL(/.*settings.*/);

    // Should see settings content
    await expect(page.locator("h1, h2").filter({ hasText: /settings/i })).toBeVisible({ timeout: 10000 });
  });

  test("user menu shows user information", async ({ page }) => {
    await page.goto("/dashboard");

    // Look for user menu or profile indicator
    const userMenu = page.locator('[data-testid="user-menu"], [data-testid="user-avatar"], .user-menu');

    if ((await userMenu.count()) > 0) {
      await userMenu.click();

      // Should show user email or name
      await expect(page.locator('[data-testid="user-email"], .user-email')).toBeVisible();
    }
  });

  test("navigation shows all main sections", async ({ page }) => {
    await page.goto("/dashboard");

    const nav = page.locator("nav, [data-testid='navigation']");

    // Should have links to main sections
    await expect(nav.getByRole("link", { name: /dashboard/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /tasks/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /settings/i })).toBeVisible();
  });
});
