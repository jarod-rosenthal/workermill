import { test, expect } from "@playwright/test";

/**
 * Authentication/Authorization tests for unauthenticated users.
 *
 * These tests run without authentication state to verify:
 * - Protected routes redirect to login
 * - Public routes are accessible
 * - Login page renders correctly
 */
test.describe("Authentication - Unauthenticated", () => {
  test("redirects unauthenticated users from dashboard to login", async ({ page }) => {
    // Try to access protected dashboard route
    await page.goto("/dashboard");

    // Should redirect to login (Cognito hosted UI or custom login)
    await expect(page).toHaveURL(/.*login.*|.*cognito.*|.*auth.*/);
  });

  test("redirects unauthenticated users from settings page to login", async ({ page }) => {
    // Try to access protected settings route
    await page.goto("/settings");

    // Should redirect to login
    await expect(page).toHaveURL(/.*login.*|.*cognito.*|.*auth.*/);
  });

  test("home page is accessible without authentication", async ({ page }) => {
    // Home/landing page should be public
    await page.goto("/");

    // Should see some content (hero, features, etc.)
    await expect(page.locator("body")).toContainText(/WorkerMill|Mission Control|AI/i);
  });

  test("docs pages are accessible without authentication", async ({ page }) => {
    // Documentation should be public
    await page.goto("/docs");

    // Should see documentation content
    await expect(page.locator("body")).toContainText(/documentation|docs|guide/i);
  });
});
