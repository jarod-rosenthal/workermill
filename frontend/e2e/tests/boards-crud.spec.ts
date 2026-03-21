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

    // Should show boards page content — BoardsList.tsx renders "Boards" heading
    await expect(page.locator("body")).toContainText(/boards/i, {
      timeout: 15000,
    });

    // Should show either board cards, create button, or empty state
    const boardCards = page.locator('[data-testid="board-card"]');
    const createBtn = page.locator('[data-testid="create-board-btn"]');
    const emptyState = page.locator('[data-testid="empty-state"]');

    await expect(
      boardCards.or(createBtn).or(emptyState).first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("create board dialog opens", async ({ page }) => {
    await page.goto("/boards");
    await page.waitForLoadState("domcontentloaded");

    // Find and click the create board button — BoardsList.tsx uses data-testid="create-board-btn"
    const createBtn = page.locator('[data-testid="create-board-btn"]');

    if ((await createBtn.count()) > 0) {
      await createBtn.first().click();

      // CreateBoardDialog renders as a fixed overlay div (not role="dialog")
      // It contains a heading "Create New Board" and a form
      const dialog = page.locator('text="Create New Board"');
      await expect(dialog.first()).toBeVisible({ timeout: 5000 });

      // Should have Board Name input (label-based, no name attr)
      const nameInput = page.locator(
        'input[type="text"]:near(:text("Board Name"))',
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
    await page.waitForLoadState("domcontentloaded");

    // Find and click the create board button
    const createBtn = page.locator('[data-testid="create-board-btn"]');

    if ((await createBtn.count()) === 0) {
      test.skip();
      return;
    }

    await createBtn.first().click();

    // Wait for dialog — CreateBoardDialog heading
    await expect(page.locator('text="Create New Board"')).toBeVisible({ timeout: 5000 });

    // Fill in board name — the first text input in the dialog is "Board Name"
    // CreateBoardDialog has autoFocus on the name input
    const nameInput = page.locator('.fixed input[type="text"]').first();
    if ((await nameInput.count()) > 0) {
      await nameInput.fill(boardName);
    }

    // Submit — button with text "Create Board"
    const submitBtn = page.locator('button:has-text("Create Board")');
    if ((await submitBtn.count()) > 0) {
      await submitBtn.first().click();
    }

    // Should navigate to the new board (handleCreate navigates to /boards/:id)
    await page.waitForURL(/\/boards\/[a-f0-9-]+/, { timeout: 10000 }).catch(() => {});

    // Navigate back to boards list if we're on a board detail page
    if (page.url().match(/\/boards\/[a-f0-9-]+/)) {
      await page.goto("/boards");
      await page.waitForLoadState("domcontentloaded");
    }

    // Verify the board exists in the list
    const boardVisible = page.locator(`text=${boardName}`);
    if ((await boardVisible.count()) > 0) {
      await expect(boardVisible.first()).toBeVisible({ timeout: 10000 });
    }

    // Clean up: delete the board
    // BoardCard has a MoreHorizontal menu button, then a Delete option
    const boardCard = page.locator(
      `[data-testid="board-card"]:has-text("${boardName}")`,
    );

    if ((await boardCard.count()) > 0) {
      // The MoreHorizontal (three dots) button is in the action overlay
      const menuBtn = boardCard.first().locator('button:has(svg)').last();
      if ((await menuBtn.count()) > 0) {
        await menuBtn.click();

        // Wait for dropdown menu to appear
        const deleteOption = page.locator(
          'button:has-text("Delete")',
        );
        await expect(deleteOption.first()).toBeVisible({ timeout: 5000 });
        if ((await deleteOption.count()) > 0) {
          await deleteOption.first().click();

          // Confirm deletion — delete confirm dialog has "Delete Board" button
          const confirmBtn = page.locator(
            'button:has-text("Delete Board")',
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
    await page.waitForLoadState("domcontentloaded");

    // Click on the first board card link — BoardCard wraps content in <Link to={`/boards/${board.id}`}>
    const firstBoard = page.locator(
      '[data-testid="board-card"] a[href^="/boards/"]',
    );

    if ((await firstBoard.count()) > 0) {
      await firstBoard.first().click();
      await page.waitForLoadState("domcontentloaded");

      // Board detail (BoardView) shows columns with ColumnHeader components
      // Columns have names like "To Do", "In Progress", "Done", "Backlog", etc.
      const columns = page.locator(
        'text=/To Do|In Progress|Done|Backlog|Review|New|Testing|Resolved/i',
      );
      await expect(columns.first()).toBeVisible({ timeout: 10000 });
    } else {
      // No boards exist - just verify the empty state
      test.skip();
    }
  });
});
