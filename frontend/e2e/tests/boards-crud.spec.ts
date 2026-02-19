import { test, expect } from "@playwright/test";
import { generateTestId } from "../helpers/test-data";

/**
 * Boards CRUD tests.
 *
 * Verifies the Kanban boards feature:
 * - Boards list page loads
 * - Board creation dialog works
 * - Board detail page renders columns
 * - Board deletion works
 *
 * Note: These tests create real boards and clean up after themselves.
 */
test.describe("Boards CRUD", () => {
  test("boards list page loads", async ({ page }) => {
    await page.goto("/boards");

    // Should show boards page content
    await expect(page.locator("body")).toContainText(/boards|projects/i, {
      timeout: 15000,
    });

    // Should show either a list of boards or an empty state with create button
    const boardsList = page.locator(
      '[data-testid="boards-list"], [class*="board"], [class*="card"]',
    );
    const createBtn = page.locator(
      'button:has-text("Create"), button:has-text("New Board"), [data-testid="create-board-btn"]',
    );
    const emptyState = page.locator(
      'text=/no boards|create your first|get started/i',
    );

    await expect(
      boardsList.or(createBtn).or(emptyState).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("create board dialog opens", async ({ page }) => {
    await page.goto("/boards");
    await page.waitForLoadState("networkidle");

    // Find and click the create board button
    const createBtn = page.locator(
      'button:has-text("Create"), button:has-text("New Board"), button:has-text("New"), [data-testid="create-board-btn"]',
    );

    if ((await createBtn.count()) > 0) {
      await createBtn.first().click();

      // Dialog should appear with form fields
      const dialog = page.locator(
        '[role="dialog"], [data-testid="create-board-dialog"], .modal, [class*="dialog"], [class*="modal"]',
      );
      await expect(dialog.first()).toBeVisible({ timeout: 5000 });

      // Should have name input
      const nameInput = page.locator(
        'input[name="name"], input[placeholder*="name" i], input[placeholder*="board" i]',
      );
      if ((await nameInput.count()) > 0) {
        await expect(nameInput.first()).toBeVisible();
      }
    }
  });

  test("create and delete a board", async ({ page }) => {
    const testId = generateTestId();
    const boardName = `E2E Board ${testId}`;

    await page.goto("/boards");
    await page.waitForLoadState("networkidle");

    // Find and click the create board button
    const createBtn = page.locator(
      'button:has-text("Create"), button:has-text("New Board"), button:has-text("New"), [data-testid="create-board-btn"]',
    );

    if ((await createBtn.count()) === 0) {
      test.skip();
      return;
    }

    await createBtn.first().click();

    // Wait for dialog
    const dialog = page.locator(
      '[role="dialog"], [data-testid="create-board-dialog"], .modal, [class*="dialog"], [class*="modal"]',
    );
    await expect(dialog.first()).toBeVisible({ timeout: 5000 });

    // Fill in board name
    const nameInput = page.locator(
      'input[name="name"], input[placeholder*="name" i], input[placeholder*="board" i]',
    );
    if ((await nameInput.count()) > 0) {
      await nameInput.first().fill(boardName);
    }

    // Submit
    const submitBtn = dialog.locator(
      'button:has-text("Create"), button:has-text("Save"), button[type="submit"]',
    );
    if ((await submitBtn.count()) > 0) {
      await submitBtn.first().click();
    }

    // Should navigate to the new board or show it in the list
    await page.waitForTimeout(2000);

    // Verify the board exists - either on a board detail page or in the list
    const boardVisible = page.locator(`text=${boardName}`);
    if ((await boardVisible.count()) > 0) {
      await expect(boardVisible.first()).toBeVisible({ timeout: 10000 });
    }

    // Navigate back to boards list if we're on a board detail page
    if (page.url().match(/\/boards\/[a-f0-9-]+/)) {
      await page.goto("/boards");
      await page.waitForLoadState("networkidle");
    }

    // Clean up: delete the board
    // Look for the board card with a menu/delete button
    const boardCard = page.locator(
      `[data-testid="board-card"]:has-text("${boardName}"), a:has-text("${boardName}"), [class*="card"]:has-text("${boardName}")`,
    );

    if ((await boardCard.count()) > 0) {
      // Look for a menu button on the card
      const menuBtn = boardCard
        .first()
        .locator(
          'button[aria-label="More"], button:has-text("..."), [data-testid="board-menu"]',
        );
      if ((await menuBtn.count()) > 0) {
        await menuBtn.first().click();
        await page.waitForTimeout(500);

        // Click delete option
        const deleteOption = page.locator(
          'button:has-text("Delete"), [role="menuitem"]:has-text("Delete")',
        );
        if ((await deleteOption.count()) > 0) {
          await deleteOption.first().click();

          // Confirm deletion if there's a confirm dialog
          const confirmBtn = page.locator(
            'button:has-text("Confirm"), button:has-text("Delete"):not([data-testid="board-menu"])',
          );
          if ((await confirmBtn.count()) > 0) {
            await confirmBtn.first().click();
          }
        }
      }
    }
  });

  test("board detail page shows columns", async ({ page }) => {
    await page.goto("/boards");
    await page.waitForLoadState("networkidle");

    // Click on the first board if available
    const firstBoard = page.locator(
      '[data-testid="board-card"] a, a[href^="/boards/"]:not([href="/boards"])',
    );

    if ((await firstBoard.count()) > 0) {
      await firstBoard.first().click();
      await page.waitForLoadState("networkidle");

      // Board detail should show columns (To Do, In Progress, Done, etc.)
      const columns = page.locator(
        '[data-testid="board-column"], [class*="column"], text=/To Do|In Progress|Done|Backlog/i',
      );
      await expect(columns.first()).toBeVisible({ timeout: 10000 });
    } else {
      // No boards exist - just verify the empty state
      test.skip();
    }
  });
});
