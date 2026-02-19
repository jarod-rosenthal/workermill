/** Test user credentials from environment */
export const testUser = {
  email: process.env.E2E_TEST_USER_EMAIL || "",
  password: process.env.E2E_TEST_USER_PASSWORD || "",
};

/** Generate a unique test ID */
export function generateTestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Create a Jira key for E2E tests.
 * Prefix controls mock worker behavior:
 *   E2E-TEST-*      → success (default)
 *   E2E-FAIL-*      → failure
 *   E2E-BLOCKER-*   → escalation
 *   E2E-SLOW-*      → slow execution (30s)
 */
export function createTestJiraKey(
  scenario: "success" | "fail" | "blocker" | "slow" = "success",
): string {
  const prefix =
    scenario === "fail"
      ? "E2E-FAIL"
      : scenario === "blocker"
        ? "E2E-BLOCKER"
        : scenario === "slow"
          ? "E2E-SLOW"
          : "E2E-TEST";
  return `${prefix}-${Date.now()}`;
}

/**
 * Poll until a condition returns a truthy value, or timeout.
 */
export async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  opts: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const timeout = opts.timeout ?? 30000;
  const interval = opts.interval ?? 1000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error(`waitFor timed out after ${timeout}ms`);
}
