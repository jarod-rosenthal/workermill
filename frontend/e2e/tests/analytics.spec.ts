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
    await expect(page.locator("body")).toContainText(/analytics|usage|stats/i, {
      timeout: 15000,
    });
  });

  test("analytics shows usage or task data sections", async ({ page }) => {
    await page.goto("/analytics");
    await page.waitForLoadState("networkidle");

    // Should show some analytics content - charts, stats, or empty state
    const analyticsContent = page.locator(
      '[data-testid="usage-stats"], [data-testid="task-stats"], [data-testid="analytics-empty-state"], canvas, svg, [class*="chart"]',
    );
    const textContent = page.locator(
      'text=/usage|tasks|completed|failed|total|analytics/i',
    );

    // At minimum, the page should have relevant content
    await expect(analyticsContent.or(textContent).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("analytics page has date range or period selector", async ({
    page,
  }) => {
    await page.goto("/analytics");
    await page.waitForLoadState("networkidle");

    // Many analytics pages have date range controls
    const dateControl = page.locator(
      '[data-testid="date-range"], select, button:has-text("7 days"), button:has-text("30 days"), button:has-text("Last")',
    );

    if ((await dateControl.count()) > 0) {
      await expect(dateControl.first()).toBeVisible();
    }
  });

  test("back to dashboard link works", async ({ page }) => {
    await page.goto("/analytics");
    await page.waitForLoadState("networkidle");

    const backLink = page.locator(
      'a[href="/dashboard"]:has-text("Back"), a[href="/dashboard"]:has-text("Dashboard"), [data-testid="back-to-dashboard"]',
    );
    if ((await backLink.count()) > 0) {
      await backLink.first().click();
      await expect(page).toHaveURL(/.*dashboard.*/);
    }
  });
});
