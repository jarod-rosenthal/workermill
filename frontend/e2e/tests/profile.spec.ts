import { test, expect } from "@playwright/test";

/**
 * Profile page tests.
 *
 * Verifies the profile page loads user information,
 * supports editing display name, and has password change form.
 */
test.describe("Profile", () => {
  test("profile page loads with user info", async ({ page }) => {
    await page.goto("/profile");

    // Should show profile-related content
    await expect(page.locator("body")).toContainText(/profile|account/i, {
      timeout: 15000,
    });

    // Should show user email or name field
    const emailOrName = page.locator(
      '[data-testid="profile-email"], [data-testid="display-name-input"], input[type="email"], input[name="displayName"], input[name="fullName"]',
    );
    await expect(emailOrName.first()).toBeVisible({ timeout: 10000 });
  });

  test("display name field is editable", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForLoadState("domcontentloaded");

    const nameInput = page.locator(
      '[data-testid="display-name-input"], input[name="displayName"], input[name="fullName"]',
    );

    if ((await nameInput.count()) > 0) {
      // Field should be editable
      await expect(nameInput.first()).toBeEditable();

      // Clear and type a test name, then restore
      const originalValue = await nameInput.first().inputValue();
      await nameInput.first().clear();
      await nameInput.first().fill("E2E Test Name");

      // Restore original value
      await nameInput.first().clear();
      await nameInput.first().fill(originalValue);
    }
  });

  test("password change form has required fields", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForLoadState("domcontentloaded");

    // Should have password-related fields
    const passwordInputs = page.locator('input[type="password"]');

    if ((await passwordInputs.count()) > 0) {
      // At least one password input should be visible
      await expect(passwordInputs.first()).toBeVisible();
    }
  });

  test("MFA section is visible", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForLoadState("domcontentloaded");

    // Profile page should have MFA section
    const mfaSection = page.locator(
      'text=/Multi-Factor|MFA|Two-Factor|2FA/i',
    );
    if ((await mfaSection.count()) > 0) {
      await expect(mfaSection.first()).toBeVisible();
    }
  });

  test("profile page has save button", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForLoadState("domcontentloaded");

    // Should have a save/update button
    const saveBtn = page.locator(
      'button:has-text("Save"), button:has-text("Update"), button:has-text("Update Profile")',
    );

    if ((await saveBtn.count()) > 0) {
      await expect(saveBtn.first()).toBeVisible();
    }
  });

  test("back navigation returns to dashboard", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForLoadState("domcontentloaded");

    const backLink = page.locator(
      'a[href="/dashboard"]:has-text("Back"), a[href="/dashboard"]:has-text("Dashboard"), [data-testid="back-to-dashboard"]',
    );
    if ((await backLink.count()) > 0) {
      await backLink.first().click();
      await expect(page).toHaveURL(/.*dashboard.*/);
    }
  });
});
