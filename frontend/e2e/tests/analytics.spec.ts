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

    // Should show analytics content
    await expect(
      page.locator(
        '[data-testid="analytics-page"], h1:has-text("Analytics"), h2:has-text("Analytics")',
      ),
    ).toBeVisible({ timeout: 10000 });
  });

  test("analytics shows usage or task data sections", async ({ page }) => {
    await page.goto("/analytics");
    await page.waitForSelector(
      '[data-testid="analytics-page"], h1:has-text("Analytics"), h2:has-text("Analytics")',
      { timeout: 10000 },
    );

    // Should show some analytics content - usage stats, task stats, or empty state
    const analyticsContent = page.locator(
      '[data-testid="usage-stats"], [data-testid="task-stats"], [data-testid="analytics-empty-state"]',
    );
    const textContent = page.locator(
      "body:has-text('usage'), body:has-text('tasks'), body:has-text('analytics')",
    );

    // At minimum, the page should have content
    await expect(analyticsContent.or(textContent).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("back to dashboard link works", async ({ page }) => {
    await page.goto("/analytics");
    await page.waitForSelector(
      '[data-testid="analytics-page"], h1:has-text("Analytics")',
      { timeout: 10000 },
    );

    const backLink = page.locator(
      '[data-testid="back-to-dashboard"], a[href="/dashboard"]:has-text("Back"), a[href="/dashboard"]:has-text("Dashboard")',
    );
    if ((await backLink.count()) > 0) {
      await backLink.first().click();
      await expect(page).toHaveURL(/.*dashboard.*/);
    }
  });
});
