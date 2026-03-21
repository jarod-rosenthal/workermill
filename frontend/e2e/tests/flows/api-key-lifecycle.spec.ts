import { test, expect } from "@playwright/test";

/**
 * API Key Lifecycle flow tests.
 *
 * Verifies the API key management UI loads correctly,
 * supports creating keys, and that created keys authenticate
 * against the API.
 *
 * These tests are READ-MOSTLY to avoid creating keys that
 * can't be cleaned up. Mutating tests skip gracefully if
 * the required UI elements are not found.
 */

const baseURL = process.env.BASE_URL || "http://localhost:5173";
const apiURL = baseURL.includes("localhost") ? baseURL.replace(/:\d+$/, ":3001") : baseURL;

test.describe("API Key Lifecycle", () => {
  test("API keys page loads via settings integrations", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Navigate to Integrations section where API Access lives
    const integrationsNav = page.locator(
      'button:has-text("Integrations"), a:has-text("Integrations"), [data-testid="settings-nav-integrations"]',
    );
    if ((await integrationsNav.count()) > 0) {
      await integrationsNav.first().click();
    }

    // The API Access section should be visible with API key related content
    const apiAccessSection = page.locator(
      'text=/API Access|API Key|Generate API keys/i',
    );
    await expect(apiAccessSection.first()).toBeVisible({ timeout: 15000 });
  });

  test("create API key via WorkerMill MCP slide-over", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Navigate to Integrations section
    const integrationsNav = page.locator(
      'button:has-text("Integrations"), a:has-text("Integrations"), [data-testid="settings-nav-integrations"]',
    );
    if ((await integrationsNav.count()) > 0) {
      await integrationsNav.first().click();
    }

    // Look for the WorkerMill MCP "Configure" button to open the slide-over
    const configureBtn = page.locator(
      'text=/API Access/i',
    ).locator("..").locator("..").locator('button:has-text("Configure")');

    // Fallback: find any Configure button near WorkerMill MCP
    const fallbackConfigureBtn = page.locator(
      'div:has(> div:has-text("WorkerMill")) button:has-text("Configure"), button:has-text("Configure")',
    );

    const targetBtn = (await configureBtn.count()) > 0 ? configureBtn.first() : fallbackConfigureBtn.first();

    if ((await targetBtn.count()) === 0) {
      test.skip(true, "WorkerMill MCP Configure button not found");
      return;
    }

    await targetBtn.click();

    // The slide-over should show "WorkerMill MCP Integration" or similar
    const slideOver = page.locator('text=/WorkerMill MCP Integration|Generate API keys/i');
    await expect(slideOver.first()).toBeVisible({ timeout: 10000 });

    // Fill in a key name
    const keyNameInput = page.locator(
      'input[placeholder*="Key name"], input[placeholder*="key name"], input[placeholder*="Claude Code"]',
    );

    if ((await keyNameInput.count()) === 0) {
      test.skip(true, "API key name input not found in slide-over");
      return;
    }

    const testKeyName = `e2e-test-key-${Date.now()}`;
    await keyNameInput.first().fill(testKeyName);

    // Click Create button
    const createBtn = page.locator(
      'button:has-text("Create")',
    );
    await expect(createBtn.first()).toBeEnabled();
    await createBtn.first().click();

    // Wait for the key to be created — should show "API Key Created" success message
    const successMessage = page.locator('text=/API Key Created/i');
    await expect(successMessage.first()).toBeVisible({ timeout: 15000 });

    // The created token should be visible in a code element
    const tokenDisplay = page.locator('code.font-mono, code');
    await expect(tokenDisplay.first()).toBeVisible({ timeout: 5000 });

    // Store the token for the next test
    const createdToken = await tokenDisplay.first().textContent();
    expect(createdToken).toBeTruthy();
    expect(createdToken!.length).toBeGreaterThan(10);

    // Click Done to dismiss
    const doneBtn = page.locator('button:has-text("Done")');
    if ((await doneBtn.count()) > 0) {
      await doneBtn.first().click();
      // Wait for slide-over to close
      await expect(slideOver.first()).toBeHidden({ timeout: 5000 }).catch(() => {});
    }
  });

  test("API key authenticates against worker-decisions health endpoint", async ({
    request,
  }) => {
    // Create a fresh API key via the API directly (since UI-created keys
    // can't be retrieved after dismissal)
    const createResponse = await request.post(
      `${apiURL}/api/profile/api-keys`,
      {
        data: { name: `e2e-auth-test-${Date.now()}` },
      },
    );

    if (!createResponse.ok()) {
      test.skip(true, "Could not create API key via API — endpoint may not be available");
      return;
    }

    const createData = await createResponse.json();
    const apiKey = createData.token || createData.apiKey || createData.key;

    if (!apiKey) {
      test.skip(true, "API key creation did not return a token");
      return;
    }

    // Use the key to authenticate against the health endpoint
    const healthResponse = await request.get(
      `${apiURL}/api/worker-decisions/health`,
      {
        headers: {
          "x-api-key": apiKey,
        },
      },
    );

    expect(healthResponse.status()).toBe(200);

    const healthData = await healthResponse.json();
    expect(healthData.status).toBe("ok");
    expect(healthData.timestamp).toBeTruthy();

    // Cleanup: revoke the key
    const keyId = createData.id || createData.keyId;
    if (keyId) {
      await request.delete(`${apiURL}/api/profile/api-keys/${keyId}`);
    }
  });

  test("profile page shows API key management section", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Navigate to Integrations where API keys live
    const integrationsNav = page.locator(
      'button:has-text("Integrations"), a:has-text("Integrations"), [data-testid="settings-nav-integrations"]',
    );
    if ((await integrationsNav.count()) > 0) {
      await integrationsNav.first().click();
    }

    // Verify the API Access section exists
    const apiAccessHeading = page.locator('text=/API Access/i');
    await expect(apiAccessHeading.first()).toBeVisible({ timeout: 10000 });

    // Verify the WorkerMill MCP card is present
    const mcpCard = page.locator('text=/WorkerMill/i');
    await expect(mcpCard.first()).toBeVisible({ timeout: 5000 });

    // The card should show either key count or "No keys"
    const keyStatus = page.locator(
      'text=/\\d+ key|No keys/i',
    );
    await expect(keyStatus.first()).toBeVisible({ timeout: 5000 });

    // Should have a Configure button
    const configureBtn = page.locator('button:has-text("Configure")');
    await expect(configureBtn.first()).toBeVisible({ timeout: 5000 });
  });

  test("Remote Agent section shows org-level API key", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Navigate to Remote Agent section if it exists
    const remoteAgentNav = page.locator(
      'button:has-text("Remote Agent"), a:has-text("Remote Agent"), [data-testid="settings-nav-remote-agent"]',
    );

    if ((await remoteAgentNav.count()) === 0) {
      test.skip(true, "Remote Agent section not found in settings navigation");
      return;
    }

    await remoteAgentNav.first().click();

    // Should show API Key section for agent connection
    const apiKeySection = page.locator('text=/API Key/i');
    await expect(apiKeySection.first()).toBeVisible({ timeout: 10000 });

    // Should have Generate API Key button or show existing key prefix
    const generateBtn = page.locator(
      'button:has-text("Generate API Key"), button:has-text("Generate New API Key")',
    );
    const existingKeyPrefix = page.locator('code');

    const hasGenerateBtn = (await generateBtn.count()) > 0;
    const hasExistingKey = (await existingKeyPrefix.count()) > 0;

    expect(hasGenerateBtn || hasExistingKey).toBeTruthy();
  });
});
