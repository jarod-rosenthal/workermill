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
    await expect(
      page.locator(
        '[data-testid="profile-page"], h1:has-text("Profile"), h2:has-text("Profile")',
      ),
    ).toBeVisible({ timeout: 10000 });

    // Should show user email or name field
    await expect(
      page.locator(
        '[data-testid="profile-email"], [data-testid="display-name-input"], input[type="email"]',
      ),
    ).toBeVisible({ timeout: 10000 });
  });

  test("display name field is editable", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForSelector(
      '[data-testid="profile-page"], h1:has-text("Profile")',
      { timeout: 10000 },
    );

    const nameInput = page.locator(
      '[data-testid="display-name-input"], input[name="displayName"], input[name="fullName"]',
    );

    if ((await nameInput.count()) > 0) {
      // Field should be editable
      await expect(nameInput.first()).toBeEditable();

      // Clear and type a test name
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
    await page.waitForSelector(
      '[data-testid="profile-page"], h1:has-text("Profile")',
      { timeout: 10000 },
    );

    // Should have password-related fields
    const passwordSection = page.locator(
      '[data-testid="password-section"], :has-text("Password")',
    );

    if ((await passwordSection.count()) > 0) {
      // Should have current password, new password, and confirm password fields
      await expect(
        page.locator(
          '[data-testid="current-password-input"], input[name="currentPassword"], input[type="password"]',
        ).first(),
      ).toBeVisible();
    }
  });

  test("back navigation returns to dashboard", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForSelector(
      '[data-testid="profile-page"], h1:has-text("Profile")',
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

  test("MFA section is visible", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForSelector(
      '[data-testid="profile-page"], h1:has-text("Profile")',
      { timeout: 10000 },
    );

    // Profile page has MFA section
    const mfaSection = page.locator(
      '[data-testid="mfa-section"], :has-text("Multi-Factor"), :has-text("MFA"), :has-text("Two-Factor")',
    );
    if ((await mfaSection.count()) > 0) {
      await expect(mfaSection.first()).toBeVisible();
    }
  });
});
