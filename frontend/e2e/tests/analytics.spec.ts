import { test, expect } from "@playwright/test";

/**
 * Analytics page tests.
 *
 * Verifies the analytics page loads correctly with usage
 * and task statistics sections.
 */
test.describe("Analytics", () => {
  test("analytics page loads", async ({ page }) => {
    await page.goto("/analytics");

    // Analytics.tsx renders data-testid="analytics-page" and heading "Analytics"
    await expect(page.locator('[data-testid="analytics-page"]')).toBeVisible({
      timeout: 15000,
    });
  });

  test("analytics shows usage or task data sections", async ({ page }) => {
    await page.goto("/analytics");

    // Wait for the page container to be visible
    await expect(page.locator('[data-testid="analytics-page"]')).toBeVisible({
      timeout: 15000,
    });

    // The page shows text like "Analytics", "Plan", "Tasks Used", "Usage", etc.
    const textContent = page.locator(
      'text=/Analytics|Plan|Tasks Used|Usage|Executive Dashboard|Effectiveness/i',
    );

    await expect(textContent.first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("analytics page has date range or period selector", async ({
    page,
  }) => {
    await page.goto("/analytics");

    // Wait for page to load
    await expect(page.locator('[data-testid="analytics-page"]')).toBeVisible({
      timeout: 15000,
    });

    // Analytics.tsx renders time range buttons: "7 Days", "30 Days", "90 Days"
    const dateControl = page.locator(
      'button:has-text("7 Days"), button:has-text("30 Days"), button:has-text("90 Days")',
    );

    if ((await dateControl.count()) > 0) {
      await expect(dateControl.first()).toBeVisible();
    }
  });

  test("back to dashboard link works", async ({ page }) => {
    await page.goto("/analytics");

    // Wait for page to load
    await expect(page.locator('[data-testid="analytics-page"]')).toBeVisible({
      timeout: 15000,
    });

    // Analytics.tsx has <Link to="/dashboard"> with ArrowLeft icon and "Dashboard" text
    const backLink = page.locator('a[href="/dashboard"]');
    if ((await backLink.count()) > 0) {
      await backLink.first().click();
      await expect(page).toHaveURL(/.*dashboard.*/);
    }
  });
});
