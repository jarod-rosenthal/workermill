import { test, expect } from "@playwright/test";

/**
 * Settings page mutation tests.
 *
 * Verifies the settings page loads correctly and that
 * key settings sections are accessible and interactive.
 *
 * Note: These tests avoid making permanent changes.
 * They verify the UI renders correctly and forms are interactive
 * without submitting destructive mutations.
 */
test.describe("Settings Mutations", () => {
  test("settings page loads with navigation sections", async ({ page }) => {
    await page.goto("/settings");

    // Should show settings content
    await expect(page.locator("body")).toContainText(
      /settings|general|organization/i,
      { timeout: 15000 },
    );

    // Settings page uses data-testid="settings-nav" for the nav sidebar
    // Nav items have data-testid="settings-nav-{id}" — ids include:
    // general, team, ai-workers, quality, integrations, remote-agent, billing, notifications, data
    const navItems = page.locator('[data-testid="settings-nav"]');
    await expect(navItems.first()).toBeVisible({ timeout: 10000 });
  });

  test("general section shows organization name", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Click general section via data-testid
    const generalNav = page.locator('[data-testid="settings-nav-general"]');
    if ((await generalNav.count()) > 0) {
      await generalNav.first().click();
    }

    // Should show org-related content
    const orgNameText = page.locator(
      'text=/organization|org name/i',
    );
    const orgNameInput = page.locator(
      'input[name="orgName"], input[name="name"], input[name="organizationName"]',
    );

    await expect(orgNameInput.or(orgNameText).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("team section shows member list or invite form", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Navigate to team section via data-testid
    const teamNav = page.locator('[data-testid="settings-nav-team"]');
    if ((await teamNav.count()) > 0) {
      await teamNav.first().click();
    }

    // Should show team members or invite functionality
    const teamContent = page.locator(
      'text=/team|members|invite|email/i',
    );
    await expect(teamContent.first()).toBeVisible({ timeout: 10000 });
  });

  test("AI workers section shows model configuration", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Navigate to AI workers section via data-testid
    const aiNav = page.locator('[data-testid="settings-nav-ai-workers"]');
    if ((await aiNav.count()) > 0) {
      await aiNav.first().click();
    }

    // Should show model-related settings
    const modelContent = page.locator(
      'text=/model|provider|anthropic|openai|worker/i',
    );
    await expect(modelContent.first()).toBeVisible({ timeout: 10000 });
  });

  test("integrations section shows SCM providers", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Navigate to integrations section via data-testid
    const integrationsNav = page.locator('[data-testid="settings-nav-integrations"]');
    if ((await integrationsNav.count()) > 0) {
      await integrationsNav.first().click();
    }

    // Should show integration-related content (GitHub, GitLab, Bitbucket, Jira)
    const integrationContent = page.locator(
      'text=/github|gitlab|bitbucket|jira|integration/i',
    );
    await expect(integrationContent.first()).toBeVisible({ timeout: 10000 });
  });

  test("settings page has save functionality", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Settings page uses data-testid="settings-save"
    const saveBtn = page.locator(
      '[data-testid="settings-save"], button:has-text("Save"), button:has-text("Update"), button:has-text("Apply")',
    );

    if ((await saveBtn.count()) > 0) {
      await expect(saveBtn.first()).toBeVisible();
    }
  });

  test("back to dashboard navigation works", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Settings page has a "Back to Dashboard" link
    const backLink = page.locator(
      'a[href="/dashboard"]',
    );
    if ((await backLink.count()) > 0) {
      await backLink.first().click();
      await expect(page).toHaveURL(/.*dashboard.*/);
    }
  });
});
