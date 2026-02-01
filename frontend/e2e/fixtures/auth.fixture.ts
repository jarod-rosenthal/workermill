import { test as base, expect } from "@playwright/test";

/**
 * Extended test fixture that provides authenticated page context.
 *
 * The authentication state is set up once via auth.setup.ts and reused
 * across all tests that depend on the "setup" project.
 */
export const test = base.extend<{
  authenticatedPage: typeof base.prototype;
}>({
  authenticatedPage: async ({ page }, use) => {
    // Page already has storageState from setup project
    await use(page);
  },
});

export { expect };
