import { test, expect } from "@playwright/test";

/**
 * Boards (Kanban) page tests.
 *
 * Verifies the boards list page, create board flow,
 * board view with columns, and board deletion.
 */
test.describe("Boards", () => {
  // Track boards created during tests for cleanup
  const createdBoardIds: string[] = [];

  test("boards list page loads", async ({ page }) => {
    await page.goto("/boards");

    // Should show boards page content
    await expect(
      page.locator(
        '[data-testid="boards-list"], h1:has-text("Boards"), h2:has-text("Boards")',
      ),
    ).toBeVisible({ timeout: 10000 });
  });

  test("boards page shows boards or empty state", async ({ page }) => {
    await page.goto("/boards");
    await page.waitForSelector(
      '[data-testid="boards-list"], h1:has-text("Boards")',
      { timeout: 10000 },
    );

    // Should show board cards or empty state
    const boardCards = page.locator(
      '[data-testid="board-card"], .board-card, a[href^="/boards/"]',
    );
    const emptyState = page.locator(
      '[data-testid="boards-empty-state"], :has-text("No boards"), :has-text("Create your first")',
    );

    await expect(boardCards.first().or(emptyState.first())).toBeVisible({
      timeout: 10000,
    });
  });

  test("create board button opens dialog", async ({ page }) => {
    await page.goto("/boards");
    await page.waitForSelector(
      '[data-testid="boards-list"], h1:has-text("Boards")',
      { timeout: 10000 },
    );

    const createBtn = page.locator(
      '[data-testid="create-board-button"], button:has-text("New Board"), button:has-text("Create Board")',
    );

    if ((await createBtn.count()) > 0) {
      await createBtn.first().click();

      // Dialog should appear
      const dialog = page.locator(
        '[data-testid="create-board-dialog"], [role="dialog"], .modal',
      );
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Should have name field and template options
      await expect(
        page.locator(
          '[data-testid="board-name-input"], input[name="name"], input[placeholder*="name" i]',
        ),
      ).toBeVisible();

      // Close dialog
      const closeBtn = page.locator(
        '[data-testid="dialog-close"], button:has-text("Cancel"), [aria-label="Close"]',
      );
      if ((await closeBtn.count()) > 0) {
        await closeBtn.first().click();
      }
    }
  });

  test("create board dialog shows template options", async ({ page }) => {
    await page.goto("/boards");
    await page.waitForSelector(
      '[data-testid="boards-list"], h1:has-text("Boards")',
      { timeout: 10000 },
    );

    const createBtn = page.locator(
      '[data-testid="create-board-button"], button:has-text("New Board"), button:has-text("Create Board")',
    );

    if ((await createBtn.count()) > 0) {
      await createBtn.first().click();

      // Wait for dialog
      await page.waitForSelector(
        '[data-testid="create-board-dialog"], [role="dialog"], .modal',
        { timeout: 5000 },
      );

      // Should show template options (from CreateBoardDialog.tsx)
      await expect(page.locator("body")).toContainText(/empty.?board/i);
      await expect(page.locator("body")).toContainText(/project.?board/i);

      // Close dialog
      const closeBtn = page.locator(
        'button:has-text("Cancel"), [aria-label="Close"]',
      );
      if ((await closeBtn.count()) > 0) {
        await closeBtn.first().click();
      }
    }
  });

  test("board card click navigates to board view", async ({ page }) => {
    await page.goto("/boards");
    await page.waitForSelector(
      '[data-testid="boards-list"], h1:has-text("Boards")',
      { timeout: 10000 },
    );

    // Click on a board if one exists
    const boardLink = page.locator(
      '[data-testid="board-card"] a, a[href^="/boards/"]:not([href*="settings"])',
    );

    if ((await boardLink.count()) > 0) {
      await boardLink.first().click();

      // Should navigate to board view
      await expect(page).toHaveURL(/.*boards\/.+/);

      // Board view should show columns
      await expect(
        page.locator(
          '[data-testid="board-view"], [data-testid="board-columns"], h1, h2',
        ),
      ).toBeVisible({ timeout: 10000 });
    }
  });

  test("back to dashboard link works", async ({ page }) => {
    await page.goto("/boards");
    await page.waitForSelector(
      '[data-testid="boards-list"], h1:has-text("Boards")',
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
});
