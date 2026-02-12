import { test, expect } from "@playwright/test";

/**
 * Navigation tests for unauthenticated users.
 *
 * Verifies that protected routes redirect to login,
 * and that public routes remain accessible.
 */
test.describe("Navigation - Unauthenticated", () => {
  test("redirects from /dashboard to login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/.*login.*|.*cognito.*|.*auth.*/);
  });

  test("redirects from /settings to login", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/.*login.*|.*cognito.*|.*auth.*/);
  });

  test("redirects from /profile to login", async ({ page }) => {
    await page.goto("/profile");
    await expect(page).toHaveURL(/.*login.*|.*cognito.*|.*auth.*/);
  });

  test("redirects from /analytics to login", async ({ page }) => {
    await page.goto("/analytics");
    await expect(page).toHaveURL(/.*login.*|.*cognito.*|.*auth.*/);
  });

  test("redirects from /personas to login", async ({ page }) => {
    await page.goto("/personas");
    await expect(page).toHaveURL(/.*login.*|.*cognito.*|.*auth.*/);
  });

  test("redirects from /boards to login", async ({ page }) => {
    await page.goto("/boards");
    await expect(page).toHaveURL(/.*login.*|.*cognito.*|.*auth.*/);
  });

  test("redirects from /billing to login", async ({ page }) => {
    await page.goto("/billing");
    await expect(page).toHaveURL(/.*login.*|.*cognito.*|.*auth.*/);
  });

  test("home page is accessible without auth", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toContainText(
      /WorkerMill|Mission Control|AI/i,
    );
  });

  test("docs pages are accessible without auth", async ({ page }) => {
    await page.goto("/docs");
    await expect(page.locator("body")).toContainText(
      /documentation|docs|guide|overview/i,
    );
  });

  test("docs quick-start is accessible without auth", async ({ page }) => {
    await page.goto("/docs/quick-start");
    await expect(page.locator("body")).toContainText(
      /quick.?start|getting.?started|setup/i,
    );
  });

  test("status page is accessible without auth", async ({ page }) => {
    await page.goto("/status");
    // Should not redirect to login
    await expect(page).not.toHaveURL(/.*login.*|.*cognito.*|.*auth.*/);
  });
});
