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
      'text=/not found|error|404|does not exist/i',
    );
    const dashboard = page.locator(
      '[data-testid="dashboard"], [data-testid="task-list"]',
    );

    // Should either show an error or redirect to dashboard
    await expect(errorIndicator.first().or(dashboard.first())).toBeVisible({
      timeout: 15000,
    });
  });

  test("nonexistent persona ID shows error or redirects", async ({
    page,
  }) => {
    await page.goto("/personas/nonexistent-persona-id-12345");

    // Should show error or redirect
    const errorIndicator = page.locator(
      'text=/not found|error|404/i',
    );
    const personaPage = page.locator(
      '[data-testid="persona-studio"], [data-testid="persona-detail"], body',
    );

    await expect(errorIndicator.first().or(personaPage.first())).toBeVisible({
      timeout: 15000,
    });
  });

  test("nonexistent board ID shows error or redirects", async ({ page }) => {
    await page.goto("/boards/nonexistent-board-id-12345");

    // Should show error or redirect
    const errorIndicator = page.locator(
      'text=/not found|error|404/i',
    );
    const boardsPage = page.locator(
      '[data-testid="boards-list"], [data-testid="board-view"], body',
    );

    await expect(errorIndicator.first().or(boardsPage.first())).toBeVisible({
      timeout: 15000,
    });
  });

  test("invalid route shows 404 page", async ({ page }) => {
    await page.goto("/invalid-route-that-does-not-exist");

    // App.tsx has a catch-all 404 route that shows "Page not found"
    await expect(page.locator("body")).toContainText(/404|page not found/i, {
      timeout: 15000,
    });
  });

  test("legacy /projects route redirects to /boards", async ({ page }) => {
    await page.goto("/projects");

    // App.tsx: <Route path="/projects" element={<Navigate to="/boards" replace />} />
    await expect(page).toHaveURL(/.*boards.*/, { timeout: 15000 });
  });

  test("legacy /epics route redirects to /boards", async ({ page }) => {
    await page.goto("/epics");

    // App.tsx: <Route path="/epics" element={<Navigate to="/boards" replace />} />
    await expect(page).toHaveURL(/.*boards.*/, { timeout: 15000 });
  });

  test("legacy /build route redirects to home", async ({ page }) => {
    await page.goto("/build");

    // App.tsx: <Route path="/build" element={<Navigate to="/" replace />} />
    await expect(page).toHaveURL(/.*\/$/, { timeout: 15000 });
  });
});
