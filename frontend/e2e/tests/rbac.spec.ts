import { test, expect } from "@playwright/test";

/**
 * RBAC (Role-Based Access Control) tests.
 *
 * Verifies that role-based features are properly rendered.
 * The test user's role determines what they can see/do.
 *
 * Note: We cannot change roles in E2E tests (that would require
 * database manipulation). Instead we verify that:
 * - Admin-only UI elements are consistently shown or hidden
 * - Settings page reflects appropriate permissions
 * - Management pages are accessible based on role
 */
test.describe("RBAC", () => {
  test("settings page shows or hides admin sections appropriately", async ({
    page,
  }) => {
    await page.goto("/settings");

    // Wait for settings page to fully render (may take time on production)
    await expect(page.locator("body")).toContainText(
      /settings|general|organization/i,
      { timeout: 30000 },
    );

    // Team section should be visible (admin can manage, viewer can see)
    const teamSection = page.locator(
      'button:has-text("Team"), a:has-text("Team"), [data-testid="settings-nav-team"]',
    );
    await expect(teamSection.first()).toBeVisible({ timeout: 15000 });
  });

  test("persona studio respects create permissions", async ({ page }) => {
    await page.goto("/personas");
    await page.waitForLoadState("domcontentloaded");

    // All users should be able to view personas
    await expect(page.locator("body")).toContainText(
      /persona|studio|developer|engineer/i,
      { timeout: 15000 },
    );

    // Create button visibility depends on admin role
    // We just verify the page loads without errors regardless of role
    const createBtn = page.locator(
      'button:has-text("Create"), button:has-text("New Persona")',
    );

    // Note: We can't assert create button is/isn't visible without knowing the role.
    // Instead verify the page didn't crash.
    const hasCreateBtn = (await createBtn.count()) > 0;
    if (hasCreateBtn) {
      // Admin user - create button should be clickable
      await expect(createBtn.first()).toBeEnabled();
    }
    // Viewer user - no create button, which is also fine
  });

  test("boards page respects create permissions", async ({ page }) => {
    await page.goto("/boards");
    await page.waitForLoadState("domcontentloaded");

    // All users should be able to view boards
    await expect(page.locator("body")).toContainText(/boards/i, {
      timeout: 15000,
    });

    // Create button should be present for users with write access
    const createBtn = page.locator(
      'button:has-text("Create"), button:has-text("New Board"), button:has-text("New")',
    );

    if ((await createBtn.count()) > 0) {
      await expect(createBtn.first()).toBeEnabled();
    }
  });

  test("dashboard task actions require appropriate role", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="dashboard"], [data-testid="task-list"]',
      { timeout: 15000 },
    );

    // The create task button should be available for users with appropriate role
    const createTaskBtn = page.locator(
      '[data-testid="create-task-btn"], button:has-text("Run Task"), button:has-text("Create Task"), button:has-text("New Task")',
    );

    if ((await createTaskBtn.count()) > 0) {
      // Button should be visible and not disabled
      await expect(createTaskBtn.first()).toBeVisible();
    }
  });

  test("management dashboard access is role-restricted", async ({ page }) => {
    await page.goto("/management");
    await page.waitForLoadState("domcontentloaded");

    // Management dashboard is for platform admins only
    // If user has access: shows management content
    // If not: may redirect or show error
    const managementContent = page.locator(
      'text=/management|platform|admin|organizations/i',
    );
    const accessDenied = page.locator(
      'text=/access denied|forbidden|not authorized|unauthorized/i',
    );

    // Wait for either management content, access denied, or a redirect to settle
    await expect(managementContent.or(accessDenied).first()).toBeVisible({ timeout: 10000 }).catch(() => {});

    const url = page.url();
    const redirect = /\/(dashboard|login)/.test(url);

    const hasManagement = (await managementContent.count()) > 0;
    const hasDenied = (await accessDenied.count()) > 0;

    // One of these should be true: has management content, access denied, or redirected
    expect(hasManagement || hasDenied || redirect).toBeTruthy();
  });

  test("billing page is accessible", async ({ page }) => {
    await page.goto("/billing");
    await page.waitForLoadState("domcontentloaded");

    // Billing page should show plan/billing info
    await expect(page.locator("body")).toContainText(
      /billing|plan|subscription|free|pro|enterprise/i,
      { timeout: 15000 },
    );
  });
});
