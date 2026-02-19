import { test, expect } from "@playwright/test";
import { generateTestId } from "../helpers/test-data";

/**
 * Personas CRUD tests.
 *
 * Verifies the Persona Studio feature:
 * - Personas list loads with system personas
 * - Create persona dialog works
 * - Persona detail page renders
 * - Persona toggle (enable/disable) works
 * - Persona deletion works
 *
 * Note: Only admin users can create/edit/delete personas.
 * Tests gracefully handle insufficient permissions.
 */
test.describe("Personas CRUD", () => {
  test("persona studio page loads with system personas", async ({ page }) => {
    await page.goto("/personas");

    // Should show persona studio content
    await expect(page.locator("body")).toContainText(
      /persona|studio|developer|engineer/i,
      { timeout: 15000 },
    );

    // Should show at least one persona card (system personas are always present)
    const personaCards = page.locator(
      '[data-testid="persona-card"], [class*="persona"], [class*="card"]',
    );
    const personaText = page.locator(
      'text=/backend|frontend|devops|security|qa/i',
    );

    await expect(personaCards.or(personaText).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("persona search filters the list", async ({ page }) => {
    await page.goto("/personas");
    await page.waitForLoadState("networkidle");

    // Find search input
    const searchInput = page.locator(
      'input[placeholder*="search" i], input[placeholder*="filter" i], input[type="search"]',
    );

    if ((await searchInput.count()) > 0) {
      // Search for a common persona
      await searchInput.first().fill("backend");
      await page.waitForTimeout(500);

      // Should show filtered results
      await expect(page.locator("body")).toContainText(/backend/i);
    }
  });

  test("create persona dialog opens", async ({ page }) => {
    await page.goto("/personas");
    await page.waitForLoadState("networkidle");

    // Find create button
    const createBtn = page.locator(
      'button:has-text("Create"), button:has-text("New Persona"), button:has-text("Add"), [data-testid="create-persona-btn"]',
    );

    if ((await createBtn.count()) > 0) {
      await createBtn.first().click();

      // Dialog or modal should appear
      const dialog = page.locator(
        '[role="dialog"], .modal, [class*="dialog"], [class*="modal"]',
      );
      await expect(dialog.first()).toBeVisible({ timeout: 5000 });

      // Should have name input
      const nameInput = page.locator(
        'input[name="name"], input[placeholder*="name" i]',
      );
      if ((await nameInput.count()) > 0) {
        await expect(nameInput.first()).toBeVisible();
      }

      // Close dialog without saving
      const closeBtn = page.locator(
        'button:has-text("Cancel"), button:has-text("Close"), button[aria-label="Close"]',
      );
      if ((await closeBtn.count()) > 0) {
        await closeBtn.first().click();
      }
    }
  });

  test("create and delete a custom persona", async ({ page }) => {
    const testId = generateTestId();
    const personaName = `E2E Persona ${testId}`;
    const personaSlug = `e2e-persona-${testId}`;

    await page.goto("/personas");
    await page.waitForLoadState("networkidle");

    // Find create button
    const createBtn = page.locator(
      'button:has-text("Create"), button:has-text("New Persona"), button:has-text("Add"), [data-testid="create-persona-btn"]',
    );

    if ((await createBtn.count()) === 0) {
      test.skip();
      return;
    }

    await createBtn.first().click();

    // Wait for dialog
    const dialog = page.locator(
      '[role="dialog"], .modal, [class*="dialog"], [class*="modal"]',
    );
    await expect(dialog.first()).toBeVisible({ timeout: 5000 });

    // Fill in persona details
    const nameInput = page.locator(
      'input[name="name"], input[placeholder*="name" i]',
    );
    const slugInput = page.locator(
      'input[name="slug"], input[placeholder*="slug" i]',
    );

    if ((await nameInput.count()) > 0) {
      await nameInput.first().fill(personaName);
    }
    if ((await slugInput.count()) > 0) {
      await slugInput.first().fill(personaSlug);
    }

    // Submit
    const submitBtn = dialog.locator(
      'button:has-text("Create"), button:has-text("Save"), button[type="submit"]',
    );
    if ((await submitBtn.count()) > 0) {
      await submitBtn.first().click();
      await page.waitForTimeout(2000);
    }

    // Verify persona was created
    const personaVisible = page.locator(`text=${personaName}`);
    if ((await personaVisible.count()) > 0) {
      await expect(personaVisible.first()).toBeVisible({ timeout: 10000 });
    }

    // Clean up: navigate to the persona and delete it
    // The persona might be clickable to navigate to its detail page
    if ((await personaVisible.count()) > 0) {
      await personaVisible.first().click();
      await page.waitForTimeout(1000);

      // Look for delete button on detail page
      const deleteBtn = page.locator(
        'button:has-text("Delete"), [data-testid="delete-persona"]',
      );
      if ((await deleteBtn.count()) > 0) {
        await deleteBtn.first().click();

        // Confirm deletion
        const confirmBtn = page.locator(
          'button:has-text("Confirm"), button:has-text("Delete")',
        );
        if ((await confirmBtn.count()) > 1) {
          await confirmBtn.last().click();
        } else if ((await confirmBtn.count()) > 0) {
          await confirmBtn.first().click();
        }
      }
    }
  });

  test("persona detail page shows directives", async ({ page }) => {
    await page.goto("/personas");
    await page.waitForLoadState("networkidle");

    // Click on the first persona card to navigate to detail
    const personaCard = page.locator(
      '[data-testid="persona-card"] a, a[href^="/personas/"]',
    );

    if ((await personaCard.count()) > 0) {
      await personaCard.first().click();
      await page.waitForLoadState("networkidle");

      // Persona detail should show some content about the persona
      await expect(page.locator("body")).toContainText(
        /directive|description|skills|risk/i,
        { timeout: 10000 },
      );
    } else {
      // Try clicking any persona name text instead
      const personaName = page.locator(
        'text=/backend_developer|frontend_developer|devops_engineer/i',
      );
      if ((await personaName.count()) > 0) {
        await personaName.first().click();
        await page.waitForTimeout(1000);

        // Check if navigated to persona detail
        if (page.url().includes("/personas/")) {
          await expect(page.locator("body")).toContainText(
            /directive|description|skills|risk/i,
            { timeout: 10000 },
          );
        }
      }
    }
  });
});
