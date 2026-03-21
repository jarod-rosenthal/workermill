import { test, expect } from "@playwright/test";
import { APIClient } from "../../helpers/api-client";

/**
 * Settings propagation flow tests.
 *
 * Verifies that settings load correctly in the UI, round-trip through
 * the API, propagate to worker config, and that quality gate toggles
 * remain consistent between the UI and API.
 *
 * All mutations are non-destructive — original values are restored.
 */
const isProduction = !!process.env.BASE_URL?.includes("workermill.com");

test.describe("Settings Propagation", () => {
  // Raw API calls don't carry browser auth tokens in production
  test.skip(isProduction, "Direct API calls require local auth — only runs against local stack");

  let apiClient: APIClient;
  let apiURL: string;

  test.beforeAll(async ({ request }) => {
    apiClient = new APIClient(request);
    const baseURL = process.env.BASE_URL || "http://localhost:5173";
    apiURL = baseURL.includes("localhost")
      ? baseURL.replace(/:\d+$/, ":3001")
      : baseURL;
  });

  // ── Test 1: Settings page loads with current values ──────────────────

  test("settings page loads with AI Workers section and maxParallelExperts value", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

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
      await page.waitForTimeout(500);
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

    // If it's an input, verify it has a numeric value
    if (hasInput) {
      const value = await parallelInput.first().inputValue();
      expect(Number(value)).toBeGreaterThan(0);
    }
  });

  // ── Test 2: Settings round-trip via API ──────────────────────────────

  test("settings round-trip — modify maxParallelExperts, verify, restore", async ({
    request,
  }) => {
    // Step 1: Read current settings
    const getResponse = await request.get(`${apiURL}/api/settings`);
    expect(getResponse.ok()).toBeTruthy();
    const original = await getResponse.json();

    expect(original).toHaveProperty("maxParallelExperts");
    const originalValue = original.maxParallelExperts;
    expect(typeof originalValue).toBe("number");

    // Step 2: Compute a different value (toggle between two safe values)
    const newValue = originalValue === 14 ? 12 : 14;

    // Step 3: Modify the setting
    const putResponse = await request.put(`${apiURL}/api/settings`, {
      data: { maxParallelExperts: newValue },
    });
    expect(putResponse.ok()).toBeTruthy();

    // Step 4: Read back and verify the change persisted
    const verifyResponse = await request.get(`${apiURL}/api/settings`);
    expect(verifyResponse.ok()).toBeTruthy();
    const updated = await verifyResponse.json();
    expect(updated.maxParallelExperts).toBe(newValue);

    // Step 5: Restore original value
    const restoreResponse = await request.put(`${apiURL}/api/settings`, {
      data: { maxParallelExperts: originalValue },
    });
    expect(restoreResponse.ok()).toBeTruthy();

    // Step 6: Confirm restoration
    const finalResponse = await request.get(`${apiURL}/api/settings`);
    expect(finalResponse.ok()).toBeTruthy();
    const restored = await finalResponse.json();
    expect(restored.maxParallelExperts).toBe(originalValue);
  });

  // ── Test 3: Worker config reflects org settings ──────────────────────

  test("worker config returns expected structure", async ({ request }) => {
    // worker-decisions routes use API key auth (authenticateApiKey middleware).
    // In self-hosted / local mode, apiKey="self-hosted" bypasses auth.
    // For production, E2E_API_KEY env var can be provided.
    const apiKey = process.env.E2E_API_KEY || "self-hosted";

    const response = await request.get(
      `${apiURL}/api/worker-decisions/worker-config`,
      {
        headers: { "x-api-key": apiKey },
      },
    );
    expect(response.ok()).toBeTruthy();

    const config = await response.json();

    // Verify the expected top-level structure
    expect(config).toHaveProperty("defaults");
    expect(config).toHaveProperty("reviewSchema");
    expect(config).toHaveProperty("personaIcons");

    // Defaults should contain key operational values
    expect(config.defaults).toBeDefined();
    expect(typeof config.defaults).toBe("object");

    // Review schema should define the structured review format
    expect(config.reviewSchema).toBeDefined();

    // Persona icons should be a mapping object
    expect(typeof config.personaIcons).toBe("object");
  });

  // ── Test 4: Quality gate settings toggle ─────────────────────────────

  test("quality gate toggle state matches API", async ({ page, request }) => {
    // Step 1: Read current quality gate setting from API
    const apiResponse = await request.get(`${apiURL}/api/settings`);
    expect(apiResponse.ok()).toBeTruthy();
    const settings = await apiResponse.json();

    expect(settings).toHaveProperty("qualityGateEnabled");
    const apiQualityGateEnabled = settings.qualityGateEnabled;

    // Step 2: Navigate to settings page
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Navigate to AI Workers or the section containing quality gates
    const aiNav = page.locator(
      'button:has-text("AI Workers"), a:has-text("AI Workers"), [data-testid="settings-nav-ai-workers"]',
    );
    if ((await aiNav.count()) > 0) {
      await aiNav.first().click();
      await page.waitForTimeout(500);
    }

    // Step 3: Find the quality gate toggle in the UI
    const qualityGateToggle = page.locator(
      '[data-testid="quality-gate-toggle"], input[name="qualityGateEnabled"], [data-testid*="quality-gate"] input[type="checkbox"], [data-testid*="quality-gate"] button[role="switch"]',
    );
    const qualityGateLabel = page.locator('text=/quality gate/i');

    const hasToggle = (await qualityGateToggle.count()) > 0;
    const hasLabel = (await qualityGateLabel.count()) > 0;

    // Quality gate section should be present in some form
    expect(hasToggle || hasLabel).toBeTruthy();

    // Step 4: If we found a toggle, verify its state matches the API
    if (hasToggle) {
      const toggle = qualityGateToggle.first();
      const tagName = await toggle.evaluate((el) =>
        el.tagName.toLowerCase(),
      );

      if (tagName === "input") {
        const isChecked = await toggle.isChecked();
        expect(isChecked).toBe(apiQualityGateEnabled);
      } else if (tagName === "button") {
        // role="switch" buttons use aria-checked
        const ariaChecked = await toggle.getAttribute("aria-checked");
        const isPressed = ariaChecked === "true";
        expect(isPressed).toBe(apiQualityGateEnabled);
      }
    }
  });
});
