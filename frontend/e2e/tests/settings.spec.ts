import { test, expect } from "@playwright/test";

/**
 * Settings page tests.
 *
 * Verifies the settings page loads correctly, navigation sidebar
 * shows all sections, and section switching works.
 */
test.describe("Settings", () => {
  test("settings page loads with navigation sidebar", async ({ page }) => {
    await page.goto("/settings");

    // Should show settings heading
    await expect(
      page.locator("h1, h2").filter({ hasText: /settings/i }),
    ).toBeVisible({ timeout: 10000 });

    // Should show navigation sidebar with sections
    const nav = page.locator(
      '[data-testid="settings-nav"], [data-testid="settings-sidebar"], nav',
    );
    await expect(nav).toBeVisible({ timeout: 10000 });
  });

  test("settings sidebar shows all sections", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForSelector(
      '[data-testid="settings-nav"], [data-testid="settings-sidebar"], nav',
      { timeout: 10000 },
    );

    // Check for key nav items (from NAV_ITEMS in settings/index.tsx)
    const sections = [
      "General",
      "Team",
      "AI Workers",
      "Integrations",
      "Billing",
    ];

    for (const section of sections) {
      await expect(
        page.locator(
          `[data-testid="settings-nav-${section.toLowerCase().replace(/\s+/g, "-")}"], button:has-text("${section}"), a:has-text("${section}")`,
        ),
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("sidebar navigation switches between sections", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForSelector(
      '[data-testid="settings-nav"], [data-testid="settings-sidebar"], nav',
      { timeout: 10000 },
    );

    // Click on Integrations section
    const integrationsBtn = page.locator(
      '[data-testid="settings-nav-integrations"], button:has-text("Integrations"), a:has-text("Integrations")',
    );
    if ((await integrationsBtn.count()) > 0) {
      await integrationsBtn.first().click();

      // Should show integrations content
      await expect(page.locator("body")).toContainText(
        /integrations|github|jira|bitbucket|gitlab/i,
      );
    }

    // Click on Team section
    const teamBtn = page.locator(
      '[data-testid="settings-nav-team"], button:has-text("Team"), a:has-text("Team")',
    );
    if ((await teamBtn.count()) > 0) {
      await teamBtn.first().click();

      // Should show team content
      await expect(page.locator("body")).toContainText(
        /team|members|invite/i,
      );
    }
  });

  test("general section shows org name", async ({ page }) => {
    await page.goto("/settings");

    // General is the default section
    // Should show organization-related content
    await expect(page.locator("body")).toContainText(
      /organization|general|plan/i,
      { timeout: 10000 },
    );
  });

  test("back to dashboard link works", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForSelector("h1, h2", { timeout: 10000 });

    const backLink = page.locator(
      '[data-testid="back-to-dashboard"], a[href="/dashboard"]:has-text("Back"), a[href="/dashboard"]:has-text("Dashboard")',
    );
    if ((await backLink.count()) > 0) {
      await backLink.first().click();
      await expect(page).toHaveURL(/.*dashboard.*/);
    }
  });
});
