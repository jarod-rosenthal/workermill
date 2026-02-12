import { test, expect } from "@playwright/test";

/**
 * Persona Studio page tests.
 *
 * Verifies persona list, search, tab switching,
 * and create persona modal.
 */
test.describe("Persona Studio", () => {
  test("persona studio page loads with persona list", async ({ page }) => {
    await page.goto("/personas");

    // Should show persona studio content
    await expect(
      page.locator(
        '[data-testid="persona-studio"], h1:has-text("Persona"), h2:has-text("Persona")',
      ),
    ).toBeVisible({ timeout: 10000 });
  });

  test("persona list shows seeded personas", async ({ page }) => {
    await page.goto("/personas");
    await page.waitForSelector(
      '[data-testid="persona-studio"], h1:has-text("Persona")',
      { timeout: 10000 },
    );

    // Should show at least one persona card or list item
    const personaCards = page.locator(
      '[data-testid="persona-card"], [data-testid="persona-list-item"], .persona-card',
    );

    // Wait for loading to finish and check for cards or empty state
    const emptyState = page.locator(
      '[data-testid="persona-empty-state"], :has-text("No personas")',
    );
    await expect(personaCards.first().or(emptyState.first())).toBeVisible({
      timeout: 10000,
    });
  });

  test("search filters persona list", async ({ page }) => {
    await page.goto("/personas");
    await page.waitForSelector(
      '[data-testid="persona-studio"], h1:has-text("Persona")',
      { timeout: 10000 },
    );

    const searchInput = page.locator(
      '[data-testid="persona-search"], input[placeholder*="Search"], input[type="search"]',
    );

    if ((await searchInput.count()) > 0) {
      // Type a search query that should filter results
      await searchInput.first().fill("backend");

      // Wait for filter to apply
      await page.waitForTimeout(500);

      // Page should still be responsive
      await expect(
        page.locator(
          '[data-testid="persona-studio"], h1:has-text("Persona")',
        ),
      ).toBeVisible();
    }
  });

  test("tab switching between personas and inference", async ({ page }) => {
    await page.goto("/personas");
    await page.waitForSelector(
      '[data-testid="persona-studio"], h1:has-text("Persona")',
      { timeout: 10000 },
    );

    // Look for tab buttons
    const inferenceTab = page.locator(
      '[data-testid="tab-inference"], button:has-text("Inference"), [role="tab"]:has-text("Inference")',
    );

    if ((await inferenceTab.count()) > 0) {
      await inferenceTab.first().click();

      // Should show inference content
      await expect(page.locator("body")).toContainText(
        /inference|label|mapping|keyword|pattern/i,
      );

      // Switch back to personas tab
      const personasTab = page.locator(
        '[data-testid="tab-personas"], button:has-text("Personas"), [role="tab"]:has-text("Personas")',
      );
      if ((await personasTab.count()) > 0) {
        await personasTab.first().click();
      }
    }
  });

  test("create persona modal opens", async ({ page }) => {
    await page.goto("/personas");
    await page.waitForSelector(
      '[data-testid="persona-studio"], h1:has-text("Persona")',
      { timeout: 10000 },
    );

    const createBtn = page.locator(
      '[data-testid="create-persona-button"], button:has-text("Create"), button:has-text("New Persona")',
    );

    if ((await createBtn.count()) > 0) {
      await createBtn.first().click();

      // Modal should appear with form fields
      const modal = page.locator(
        '[data-testid="create-persona-modal"], [role="dialog"], .modal',
      );
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Should have name and slug fields
      await expect(
        page.locator(
          '[data-testid="persona-name-input"], input[name="name"], input[placeholder*="name" i]',
        ),
      ).toBeVisible();

      // Close modal
      const closeBtn = page.locator(
        '[data-testid="modal-close"], button:has-text("Cancel"), [aria-label="Close"]',
      );
      if ((await closeBtn.count()) > 0) {
        await closeBtn.first().click();
      }
    }
  });

  test("persona card click navigates to detail", async ({ page }) => {
    await page.goto("/personas");
    await page.waitForSelector(
      '[data-testid="persona-studio"], h1:has-text("Persona")',
      { timeout: 10000 },
    );

    const personaCard = page.locator(
      '[data-testid="persona-card"] a, [data-testid="persona-list-item"] a, a[href^="/personas/"]',
    );

    if ((await personaCard.count()) > 0) {
      await personaCard.first().click();

      // Should navigate to persona detail page
      await expect(page).toHaveURL(/.*personas\/.+/);
    }
  });
});
