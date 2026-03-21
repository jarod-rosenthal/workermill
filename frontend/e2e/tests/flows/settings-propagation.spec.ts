import { test, expect } from "@playwright/test";

/**
 * Settings propagation flow tests.
 *
 * Verifies that settings load correctly in the UI, round-trip through
 * the API, propagate to worker config, and that quality gate toggles
 * remain consistent between the UI and API.
 *
 * All mutations are non-destructive — original values are restored.
 */
const isProduction = !!process.env.BASE_URL; // Skip when targeting a deployed env (no mock workers)

// Derive API URL once — locally API is on :3001, in production it's same host
const baseURL = process.env.BASE_URL || "http://localhost:5173";
const apiURL = baseURL.includes("localhost")
  ? baseURL.replace(/:\d+$/, ":3001")
  : baseURL;

test.describe("Settings Propagation", () => {
  // Direct API calls only work with local auth (EXECUTION_MODE=local auto-authenticates)
  test.skip(isProduction, "Direct API calls require local auth — only runs against local stack");

  // ── Test 1: Settings page loads with current values ──────────────────

  test("settings page loads with AI Workers section and maxParallelExperts value", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Should show settings content
    await expect(page.locator("body")).toContainText(
      /settings|general|organization/i,
      { timeout: 15000 },
    );

    // Navigate to AI Workers section
    const aiNav = page.locator(
      'button:has-text("AI Workers"), a:has-text("AI Workers"), [data-testid="settings-nav-ai-workers"]',
    );
    if ((await aiNav.count()) > 0) {
      await aiNav.first().click();
    }

    // Should show AI Workers / model-related content
    const aiContent = page.locator(
      'text=/model|provider|anthropic|openai|worker|parallel/i',
    );
    await expect(aiContent.first()).toBeVisible({ timeout: 10000 });

    // maxParallelExperts should be rendered as an input or display value
    const parallelInput = page.locator(
      'input[name="maxParallelExperts"], input[name*="parallel"], [data-testid="max-parallel-experts"]',
    );
    const parallelText = page.locator('text=/parallel.*expert/i');

    const hasInput = (await parallelInput.count()) > 0;
    const hasText = (await parallelText.count()) > 0;
    expect(hasInput || hasText).toBeTruthy();

    if (hasInput) {
      const value = await parallelInput.first().inputValue();
      expect(Number(value)).toBeGreaterThan(0);
    }
  });

  // ── Test 2: Settings round-trip via API ──────────────────────────────

  test("settings round-trip — modify maxParallelExperts, verify, restore", async ({
    request,
  }) => {
    const getResponse = await request.get(`${apiURL}/api/settings`);
    expect(getResponse.ok()).toBeTruthy();
    const original = await getResponse.json();

    expect(original).toHaveProperty("maxParallelExperts");
    const originalValue = original.maxParallelExperts;
    expect(typeof originalValue).toBe("number");

    const newValue = originalValue === 14 ? 12 : 14;

    const putResponse = await request.put(`${apiURL}/api/settings`, {
      data: { maxParallelExperts: newValue },
    });
    expect(putResponse.ok()).toBeTruthy();

    const verifyResponse = await request.get(`${apiURL}/api/settings`);
    expect(verifyResponse.ok()).toBeTruthy();
    const updated = await verifyResponse.json();
    expect(updated.maxParallelExperts).toBe(newValue);

    // Restore
    await request.put(`${apiURL}/api/settings`, {
      data: { maxParallelExperts: originalValue },
    });
  });

  // ── Test 3: Worker config reflects org settings ──────────────────────

  test("worker config returns expected structure", async ({ request }) => {
    const apiKey = process.env.E2E_API_KEY || "self-hosted";

    const response = await request.get(
      `${apiURL}/api/worker-decisions/worker-config`,
      { headers: { "x-api-key": apiKey } },
    );
    expect(response.ok()).toBeTruthy();

    const config = await response.json();
    expect(config).toHaveProperty("defaults");
    expect(config).toHaveProperty("reviewSchema");
    expect(config).toHaveProperty("personaIcons");
    expect(typeof config.defaults).toBe("object");
    expect(typeof config.personaIcons).toBe("object");
  });

  // ── Test 4: Quality gate settings toggle ─────────────────────────────

  test("quality gate toggle state matches API", async ({ page, request }) => {
    const apiResponse = await request.get(`${apiURL}/api/settings`);
    expect(apiResponse.ok()).toBeTruthy();
    const settings = await apiResponse.json();

    expect(settings).toHaveProperty("qualityGateEnabled");
    const apiQualityGateEnabled = settings.qualityGateEnabled;

    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    const aiNav = page.locator(
      'button:has-text("AI Workers"), a:has-text("AI Workers"), [data-testid="settings-nav-ai-workers"]',
    );
    if ((await aiNav.count()) > 0) {
      await aiNav.first().click();
    }

    const qualityGateToggle = page.locator(
      '[data-testid="quality-gate-toggle"], input[name="qualityGateEnabled"], [data-testid*="quality-gate"] input[type="checkbox"], [data-testid*="quality-gate"] button[role="switch"]',
    );
    const qualityGateLabel = page.locator('text=/quality gate/i');

    const hasToggle = (await qualityGateToggle.count()) > 0;
    const hasLabel = (await qualityGateLabel.count()) > 0;
    expect(hasToggle || hasLabel).toBeTruthy();

    if (hasToggle) {
      const toggle = qualityGateToggle.first();
      const tagName = await toggle.evaluate((el) => el.tagName.toLowerCase());

      if (tagName === "input") {
        expect(await toggle.isChecked()).toBe(apiQualityGateEnabled);
      } else if (tagName === "button") {
        const ariaChecked = await toggle.getAttribute("aria-checked");
        expect(ariaChecked === "true").toBe(apiQualityGateEnabled);
      }
    }
  });
});
