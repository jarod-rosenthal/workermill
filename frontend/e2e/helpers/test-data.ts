/**
 * Test data constants and factories for E2E tests.
 */

/**
 * Test user credentials from environment variables.
 * These should be set in GitHub Actions secrets.
 */
export const testUser = {
  email: process.env.E2E_TEST_USER_EMAIL || "e2e-test@workermill.com",
  password: process.env.E2E_TEST_USER_PASSWORD || "",
};

/**
 * Generates a unique test ID with timestamp.
 */
export function generateTestId(): string {
  return `E2E-TEST-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Creates a unique Jira-style key for test tasks.
 */
export function createTestJiraKey(): string {
  return `E2E-${Date.now()}`;
}

/**
 * Test task data factory.
 */
export function createTestTask(overrides: Partial<TestTask> = {}): TestTask {
  const id = generateTestId();
  return {
    jiraKey: `E2E-${Date.now()}`,
    summary: `E2E Test Task ${id}`,
    description: `Automated E2E test task created at ${new Date().toISOString()}`,
    labels: ["workermill"],
    ...overrides,
  };
}

interface TestTask {
  jiraKey: string;
  summary: string;
  description: string;
  labels: string[];
}

/**
 * Test GitHub issue data factory.
 */
export function createTestGithubIssue(
  overrides: Partial<TestGithubIssue> = {},
): TestGithubIssue {
  return {
    repo: "test-org/test-repo",
    issueNumber: Math.floor(Math.random() * 10000) + 1,
    title: `E2E Test Issue ${Date.now()}`,
    body: `Automated E2E test issue created at ${new Date().toISOString()}`,
    labels: ["workermill"],
    ...overrides,
  };
}

interface TestGithubIssue {
  repo: string;
  issueNumber: number;
  title: string;
  body: string;
  labels: string[];
}

/**
 * Test blocker data factory.
 */
export function createTestBlocker(overrides: Partial<TestBlocker> = {}): TestBlocker {
  return {
    blockerType: "typescript",
    summary: "Type error in module",
    details: "Cannot assign type 'string' to type 'number'",
    ...overrides,
  };
}

interface TestBlocker {
  blockerType: string;
  summary: string;
  details: string;
}

/**
 * Wait helper for polling conditions.
 */
export async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  options: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const { timeout = 10000, interval = 500 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await fn();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`waitFor timed out after ${timeout}ms`);
}
