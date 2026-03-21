import { test, expect } from "@playwright/test";

/**
 * Auth Route Protection tests.
 *
 * These run in the "unauthenticated" project (no storage state),
 * verifying that protected routes redirect to /login and public
 * routes remain accessible.
 */
test.describe("Route Protection (Unauthenticated)", () => {
  const isLocal = !process.env.BASE_URL;

  test("visiting /dashboard redirects to /login", async ({ page }) => {
    test.skip(isLocal, "Local mode auto-logs in — no login redirect");
    await page.goto("/dashboard");

    // Should redirect to login or cognito auth page
    await expect(page).toHaveURL(/.*login.*|.*cognito.*|.*auth.*/, {
      timeout: 30000,
    });
  });

  test("visiting /settings redirects to /login", async ({ page }) => {
    test.skip(isLocal, "Local mode auto-logs in — no login redirect");
    await page.goto("/settings");

    await expect(page).toHaveURL(/.*login.*|.*cognito.*|.*auth.*/, {
      timeout: 30000,
    });
  });

  test("visiting /profile redirects to /login", async ({ page }) => {
    test.skip(isLocal, "Local mode auto-logs in — no login redirect");
    await page.goto("/profile");

    await expect(page).toHaveURL(/.*login.*|.*cognito.*|.*auth.*/, {
      timeout: 30000,
    });
  });

  test("visiting /analytics redirects to /login", async ({ page }) => {
    test.skip(isLocal, "Local mode auto-logs in — no login redirect");
    await page.goto("/analytics");

    await expect(page).toHaveURL(/.*login.*|.*cognito.*|.*auth.*/, {
      timeout: 30000,
    });
  });

  test("visiting /boards redirects to /login", async ({ page }) => {
    test.skip(isLocal, "Local mode auto-logs in — no login redirect");
    await page.goto("/boards");

    await expect(page).toHaveURL(/.*login.*|.*cognito.*|.*auth.*/, {
      timeout: 30000,
    });
  });

  test("visiting /personas redirects to /login", async ({ page }) => {
    test.skip(isLocal, "Local mode auto-logs in — no login redirect");
    await page.goto("/personas");

    await expect(page).toHaveURL(/.*login.*|.*cognito.*|.*auth.*/, {
      timeout: 30000,
    });
  });

  test("visiting /billing redirects to /login", async ({ page }) => {
    test.skip(isLocal, "Local mode auto-logs in — no login redirect");
    await page.goto("/billing");

    await expect(page).toHaveURL(/.*login.*|.*cognito.*|.*auth.*/, {
      timeout: 30000,
    });
  });
});

test.describe("Public Routes (Unauthenticated)", () => {
  test("landing page (/) is accessible", async ({ page }) => {
    await page.goto("/");

    // Should not redirect to login
    await expect(page).toHaveURL(/.*\/$/);

    // Should show landing page content
    await expect(page.locator("body")).toContainText(
      /WorkerMill|AI|agent|worker/i,
      { timeout: 15000 },
    );
  });

  test("login page is accessible", async ({ page }) => {
    await page.goto("/login");

    // Should stay on login page (or redirect to cognito)
    await expect(page).toHaveURL(/.*login.*|.*cognito.*|.*auth.*/, {
      timeout: 30000,
    });
  });

  test("docs overview is accessible", async ({ page }) => {
    await page.goto("/docs");

    // Should show docs content without redirecting to login
    await expect(page).toHaveURL(/.*docs.*/);
    await expect(page.locator("body")).toContainText(
      /documentation|overview|getting started|quick start/i,
      { timeout: 15000 },
    );
  });

  test("docs quick-start is accessible", async ({ page }) => {
    await page.goto("/docs/quick-start");

    await expect(page).toHaveURL(/.*docs\/quick-start.*/);
    await expect(page.locator("body")).toContainText(/quick start|get started/i, {
      timeout: 15000,
    });
  });

  test("status page is accessible", async ({ page }) => {
    await page.goto("/status");

    await expect(page).toHaveURL(/.*status.*/);
    await expect(page.locator("body")).toContainText(/status|operational|system/i, {
      timeout: 15000,
    });
  });

  test("legal pages are accessible", async ({ page }) => {
    await page.goto("/terms");
    await expect(page).toHaveURL(/.*terms.*/);

    await page.goto("/privacy");
    await expect(page).toHaveURL(/.*privacy.*/);

    await page.goto("/security");
    await expect(page).toHaveURL(/.*security.*/);
  });
});
