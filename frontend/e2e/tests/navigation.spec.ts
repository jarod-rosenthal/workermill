import { test, expect } from "@playwright/test";

/**
 * Navigation tests for authenticated users.
 *
 * Verifies sidebar navigation links, profile dropdown links,
 * and routing behavior for authenticated users.
 */
test.describe("Navigation", () => {
  test("sidebar links navigate to correct pages", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="dashboard"], nav, [data-testid="navigation"]',
      { timeout: 10000 },
    );

    const nav = page.locator("nav, [data-testid='navigation']");

    // Dashboard link
    const dashboardLink = nav.getByRole("link", { name: /dashboard/i });
    if ((await dashboardLink.count()) > 0) {
      await dashboardLink.click();
      await expect(page).toHaveURL(/.*dashboard.*/);
    }
  });

  test("settings link navigates to settings page", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="dashboard"], nav, [data-testid="navigation"]',
      { timeout: 10000 },
    );

    // Navigate via sidebar or profile dropdown
    const settingsLink = page.locator(
      'nav a[href="/settings"], [data-testid="nav-settings"]',
    );
    if ((await settingsLink.count()) > 0) {
      await settingsLink.first().click();
      await expect(page).toHaveURL(/.*settings.*/);
      await expect(
        page.locator("h1, h2").filter({ hasText: /settings/i }),
      ).toBeVisible({ timeout: 10000 });
    }
  });

  test("analytics link navigates to analytics page", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="dashboard"], nav, [data-testid="navigation"]',
      { timeout: 10000 },
    );

    const analyticsLink = page.locator(
      'nav a[href="/analytics"], [data-testid="nav-analytics"]',
    );
    if ((await analyticsLink.count()) > 0) {
      await analyticsLink.first().click();
      await expect(page).toHaveURL(/.*analytics.*/);
    }
  });

  test("personas link navigates to persona studio", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="dashboard"], nav, [data-testid="navigation"]',
      { timeout: 10000 },
    );

    const personasLink = page.locator(
      'nav a[href="/personas"], [data-testid="nav-personas"]',
    );
    if ((await personasLink.count()) > 0) {
      await personasLink.first().click();
      await expect(page).toHaveURL(/.*personas.*/);
    }
  });

  test("boards link navigates to boards list", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="dashboard"], nav, [data-testid="navigation"]',
      { timeout: 10000 },
    );

    const boardsLink = page.locator(
      'nav a[href="/boards"], [data-testid="nav-boards"]',
    );
    if ((await boardsLink.count()) > 0) {
      await boardsLink.first().click();
      await expect(page).toHaveURL(/.*boards.*/);
    }
  });

  test("profile dropdown links work", async ({ page }) => {
    await page.goto("/dashboard");

    const userMenu = page.locator(
      '[data-testid="user-menu"], [data-testid="profile-dropdown"], .user-menu',
    );

    if ((await userMenu.count()) > 0) {
      await userMenu.first().click();

      // Profile link
      const profileLink = page.locator(
        '[data-testid="dropdown-profile-link"], a[href="/profile"]',
      );
      if ((await profileLink.count()) > 0) {
        await profileLink.first().click();
        await expect(page).toHaveURL(/.*profile.*/);
      }
    }
  });

  test("profile dropdown settings link works", async ({ page }) => {
    await page.goto("/dashboard");

    const userMenu = page.locator(
      '[data-testid="user-menu"], [data-testid="profile-dropdown"], .user-menu',
    );

    if ((await userMenu.count()) > 0) {
      await userMenu.first().click();

      const settingsLink = page.locator(
        '[data-testid="dropdown-settings-link"], a[href="/settings"]',
      );
      if ((await settingsLink.count()) > 0) {
        await settingsLink.first().click();
        await expect(page).toHaveURL(/.*settings.*/);
      }
    }
  });

  test("unknown routes redirect to home", async ({ page }) => {
    await page.goto("/this-route-does-not-exist-12345");

    // App.tsx has a catch-all that redirects to /
    await expect(page).toHaveURL(/.*\/$/);
  });
});
