import { test, expect } from "@playwright/test";

/**
 * Error state tests.
 *
 * Verifies the application handles error conditions gracefully,
 * including nonexistent resources and invalid routes.
 */
test.describe("Error States", () => {
  test("task detail page for nonexistent ID shows error or redirects", async ({
    page,
  }) => {
    // Navigate to a task ID that doesn't exist
    await page.goto("/tasks/00000000-0000-0000-0000-000000000000");

    // Should show error message, 404, or redirect to dashboard
    const errorIndicator = page.locator(
      '[data-testid="error-state"], [data-testid="not-found"], :has-text("not found"), :has-text("error"), :has-text("Error")',
    );
    const dashboard = page.locator(
      '[data-testid="dashboard"], [data-testid="task-list"]',
    );

    // Should either show an error or redirect to dashboard
    await expect(errorIndicator.first().or(dashboard.first())).toBeVisible({
      timeout: 10000,
    });
  });

  test("nonexistent persona ID shows error or redirects", async ({
    page,
  }) => {
    await page.goto("/personas/nonexistent-persona-id-12345");

    // Should show error or redirect
    const errorIndicator = page.locator(
      '[data-testid="error-state"], [data-testid="not-found"], :has-text("not found"), :has-text("error")',
    );
    const personaStudio = page.locator(
      '[data-testid="persona-studio"], [data-testid="persona-detail"]',
    );

    await expect(errorIndicator.first().or(personaStudio.first())).toBeVisible(
      { timeout: 10000 },
    );
  });

  test("nonexistent board ID shows error or redirects", async ({ page }) => {
    await page.goto("/boards/nonexistent-board-id-12345");

    // Should show error or redirect
    const errorIndicator = page.locator(
      '[data-testid="error-state"], [data-testid="not-found"], :has-text("not found"), :has-text("error")',
    );
    const boardsList = page.locator(
      '[data-testid="boards-list"], [data-testid="board-view"]',
    );

    await expect(errorIndicator.first().or(boardsList.first())).toBeVisible({
      timeout: 10000,
    });
  });

  test("invalid route redirects to home", async ({ page }) => {
    await page.goto("/invalid-route-that-does-not-exist");

    // App.tsx catch-all redirects to /
    await expect(page).toHaveURL(/.*\/$/);
  });

  test("legacy /projects route redirects to /boards", async ({ page }) => {
    await page.goto("/projects");

    // App.tsx: <Route path="/projects" element={<Navigate to="/boards" replace />} />
    await expect(page).toHaveURL(/.*boards.*/);
  });

  test("legacy /epics route redirects to /boards", async ({ page }) => {
    await page.goto("/epics");

    // App.tsx: <Route path="/epics" element={<Navigate to="/boards" replace />} />
    await expect(page).toHaveURL(/.*boards.*/);
  });
});
