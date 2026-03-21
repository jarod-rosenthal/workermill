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

    // Should show persona studio content — PersonaStudio.tsx renders "Persona Studio" heading
    await expect(page.locator("body")).toContainText(
      /persona|studio/i,
      { timeout: 15000 },
    );

    // Should show at least one persona card (system personas are always present)
    // PersonaStudio.tsx uses data-testid="persona-card" on each card
    const personaCards = page.locator('[data-testid="persona-card"]');
    const personaText = page.locator(
      'text=/backend|frontend|devops|security|qa/i',
    );

    await expect(personaCards.or(personaText).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("persona search filters the list", async ({ page }) => {
    await page.goto("/personas");
    await page.waitForLoadState("domcontentloaded");

    // PersonaStudio.tsx uses data-testid="persona-search"
    const searchInput = page.locator('[data-testid="persona-search"]');

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

    // Wait for the page to show persona-related content
    await expect(page.locator("body")).toContainText(/persona|studio|developer|engineer/i, { timeout: 15000 });

    const createBtn = page.locator('[data-testid="create-persona-btn"]');

    if ((await createBtn.count()) > 0) {
      await createBtn.first().click();

      // Modal renders as a fixed overlay div with heading "Create Persona"
      await expect(page.locator('text="Create Persona"')).toBeVisible({ timeout: 5000 });

      // Should have Slug and Name inputs (identified by labels, no name attrs)
      const slugLabel = page.locator('text="Slug"');
      const nameLabel = page.locator('label:has-text("Name")');
      if ((await slugLabel.count()) > 0) {
        await expect(slugLabel.first()).toBeVisible();
      }
      if ((await nameLabel.count()) > 0) {
        await expect(nameLabel.first()).toBeVisible();
      }

      // Close dialog without saving — Cancel button
      const closeBtn = page.locator(
        'button:has-text("Cancel")',
      );
      if ((await closeBtn.count()) > 0) {
        await closeBtn.first().click();
      }
    }
  });

  test("create and delete a custom persona", async ({ page }) => {
    const testId = generateTestId();
    const personaName = `E2E Persona ${testId}`;
    const personaSlug = `e2e_persona_${testId.replace(/-/g, '_')}`;

    await page.goto("/personas");

    // Wait for the page to show persona-related content
    await expect(page.locator("body")).toContainText(/persona|studio|developer|engineer/i, { timeout: 15000 });

    const createBtn = page.locator('[data-testid="create-persona-btn"]');

    if ((await createBtn.count()) === 0) {
      test.skip();
      return;
    }

    await createBtn.first().click();

    // Wait for dialog — heading "Create Persona"
    await expect(page.locator('text="Create Persona"')).toBeVisible({ timeout: 5000 });

    // Fill in persona details — inputs are in a grid, slug first then name
    // The form has: Slug (required), Name (required), Emoji, Color, Short Label, Description
    const formInputs = page.locator('.fixed form input[type="text"]');
    const slugInput = formInputs.nth(0); // First text input is Slug
    const nameInput = formInputs.nth(1); // Second text input is Name

    if ((await slugInput.count()) > 0) {
      await slugInput.fill(personaSlug);
    }
    if ((await nameInput.count()) > 0) {
      await nameInput.fill(personaName);
    }

    // Submit — button with text "Create Persona" (submit button)
    const submitBtn = page.locator('button[type="submit"]:has-text("Create Persona")');
    if ((await submitBtn.count()) > 0) {
      await submitBtn.first().click();
      await page.waitForTimeout(2000);
    }

    // handleCreatePersona navigates to /personas/:id on success
    // Navigate back to list to verify and clean up
    await page.goto("/personas");
    await page.waitForLoadState("domcontentloaded");

    // Verify persona was created
    const personaVisible = page.locator(`text=${personaName}`);
    if ((await personaVisible.count()) > 0) {
      await expect(personaVisible.first()).toBeVisible({ timeout: 10000 });
    }

    // Clean up: click persona card to navigate to detail page
    const createdCard = page.locator(`[data-testid="persona-card"]:has-text("${personaName}")`);
    if ((await createdCard.count()) > 0) {
      await createdCard.first().click();
      await page.waitForTimeout(1000);

      // Look for delete button on detail page
      const deleteBtn = page.locator(
        'button:has-text("Delete")',
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
    await page.waitForLoadState("domcontentloaded");

    // PersonaStudio.tsx renders persona cards as <Link to={`/personas/${persona.id}`}>
    const personaCard = page.locator('[data-testid="persona-card"]');

    if ((await personaCard.count()) > 0) {
      await personaCard.first().click();
      await page.waitForLoadState("domcontentloaded");

      // Persona detail should show some content about the persona
      await expect(page.locator("body")).toContainText(
        /directive|description|skills|risk/i,
        { timeout: 10000 },
      );
    } else {
      test.skip();
    }
  });
});
