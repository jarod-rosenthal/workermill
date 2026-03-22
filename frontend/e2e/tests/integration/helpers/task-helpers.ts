import { APIClient } from "../../../helpers/api-client";
import { waitFor } from "../../../helpers/test-data";

/** All terminal statuses that end a task */
export const TERMINAL_STATUSES = [
  "pr_approved", "review_approved", "completed", "deployed",
  "review_requested", "failed", "escalated", "cancelled",
];

/** Success statuses (task completed its work) */
export const SUCCESS_STATUSES = [
  "pr_approved", "review_approved", "completed", "deployed", "review_requested",
];

/** Generate a unique INT- jira key */
export function createIntKey(): string {
  return `INT-${Date.now()}`;
}

/**
 * Poll for task status via control-center activeTasks list.
 * Uses getTaskByJiraKey (not getTask) because the /tasks/:id endpoint
 * returns 404 for tasks outside the display window.
 */
export async function waitForStatus(
  api: APIClient,
  jiraKey: string,
  targetStatuses: string[],
  timeout: number,
): Promise<string> {
  return waitFor(
    async () => {
      const task = await api.getTaskByJiraKey(jiraKey);
      if (!task) return null;
      if (targetStatuses.includes(task.status)) return task.status;
      return null;
    },
    { timeout, interval: 10_000 },
  );
}

/**
 * Create a task via webhook and wait for a terminal status.
 */
export async function createAndWait(
  api: APIClient,
  options: {
    jiraKey: string;
    summary: string;
    description: string;
    labels?: string[];
    timeout?: number;
  },
): Promise<{ status: string; taskId: string; jiraKey: string }> {
  const payload = api.createJiraWebhookPayload({
    issueKey: options.jiraKey,
    summary: options.summary,
    description: options.description,
    labels: options.labels,
  });

  const response = await api.sendJiraWebhook(payload);
  if (!response.ok()) {
    throw new Error(`Webhook failed: ${response.status()} ${await response.text()}`);
  }
  const { taskId } = await response.json();

  const status = await waitForStatus(
    api,
    options.jiraKey,
    TERMINAL_STATUSES,
    options.timeout || 480_000,
  );

  return { status, taskId, jiraKey: options.jiraKey };
}

// ─── Randomized Task Pools ──────────────────────────────────────────

interface TaskTemplate {
  file: string;
  fn: string;
  summary: string;
  description: string;
}

const UTILITY_TASKS: TaskTemplate[] = [
  {
    file: "src/utils/slugify.ts",
    fn: "slugify",
    summary: "Add slugify utility function",
    description: "Create {file} with a function {fn}(str: string): string that converts a string to a URL-friendly slug (lowercase, replace spaces with hyphens, remove special characters). Add tests.",
  },
  {
    file: "src/utils/truncate.ts",
    fn: "truncate",
    summary: "Add truncate utility function",
    description: "Create {file} with a function {fn}(str: string, maxLen: number): string that truncates a string to maxLen and adds '...' if truncated. Add tests.",
  },
  {
    file: "src/utils/debounce.ts",
    fn: "debounce",
    summary: "Add debounce utility function",
    description: "Create {file} with a function {fn}<T extends (...args: any[]) => void>(fn: T, delayMs: number): T that returns a debounced version of the function. Add tests.",
  },
  {
    file: "src/utils/clamp.ts",
    fn: "clamp",
    summary: "Add clamp utility function",
    description: "Create {file} with a function {fn}(value: number, min: number, max: number): number that clamps a number between min and max. Add tests.",
  },
  {
    file: "src/utils/deepClone.ts",
    fn: "deepClone",
    summary: "Add deepClone utility function",
    description: "Create {file} with a function {fn}<T>(obj: T): T that deep clones an object using structuredClone. Add tests.",
  },
  {
    file: "src/utils/retry.ts",
    fn: "retry",
    summary: "Add retry utility function",
    description: "Create {file} with an async function {fn}<T>(fn: () => Promise<T>, maxRetries: number, delayMs: number): Promise<T> that retries a function on failure. Add tests.",
  },
  {
    file: "src/utils/groupBy.ts",
    fn: "groupBy",
    summary: "Add groupBy utility function",
    description: "Create {file} with a function {fn}<T>(arr: T[], key: keyof T): Record<string, T[]> that groups array items by a key. Add tests.",
  },
  {
    file: "src/utils/memoize.ts",
    fn: "memoize",
    summary: "Add memoize utility function",
    description: "Create {file} with a function {fn}<T extends (...args: any[]) => any>(fn: T): T that caches results based on arguments. Add tests.",
  },
];

const ENDPOINT_TASKS: TaskTemplate[] = [
  {
    file: "src/routes/status.ts",
    fn: "status",
    summary: "Add GET /api/status endpoint",
    description: "Create {file} with a GET /api/status endpoint that returns { status: 'healthy', version: '1.0.0', timestamp: new Date().toISOString() }. Register in src/app.ts.",
  },
  {
    file: "src/routes/echo.ts",
    fn: "echo",
    summary: "Add POST /api/echo endpoint",
    description: "Create {file} with a POST /api/echo endpoint that returns the request body back as JSON. Register in src/app.ts.",
  },
  {
    file: "src/routes/time.ts",
    fn: "time",
    summary: "Add GET /api/time endpoint",
    description: "Create {file} with a GET /api/time endpoint that returns { utc: new Date().toUTCString(), unix: Date.now() }. Register in src/app.ts.",
  },
  {
    file: "src/routes/random.ts",
    fn: "random",
    summary: "Add GET /api/random endpoint",
    description: "Create {file} with a GET /api/random endpoint that returns { value: Math.random(), min: 0, max: 1 }. Accept optional min/max query params. Register in src/app.ts.",
  },
];

/** Pick a random task from a pool, interpolating file/fn into the description */
function pickRandom(pool: TaskTemplate[]): { summary: string; description: string } {
  const t = pool[Math.floor(Math.random() * pool.length)];
  return {
    summary: t.summary,
    description: t.description.replace(/\{file\}/g, t.file).replace(/\{fn\}/g, t.fn),
  };
}

/**
 * Get a randomized test task. Each call returns a different task
 * from the pool so re-runs don't collide.
 */
export function getRandomUtilityTask(): { jiraKey: string; summary: string; description: string } {
  const task = pickRandom(UTILITY_TASKS);
  return { jiraKey: createIntKey(), ...task };
}

export function getRandomEndpointTask(): { jiraKey: string; summary: string; description: string } {
  const task = pickRandom(ENDPOINT_TASKS);
  return { jiraKey: createIntKey(), ...task };
}

/**
 * Get a provider-specific test task (unique file per provider to avoid conflicts).
 */
const PROVIDER_TASKS: Record<string, TaskTemplate> = {
  ollama: {
    file: "src/utils/format.ts",
    fn: "formatBytes",
    summary: "Add formatBytes utility",
    description: "Create {file} with a function {fn}(bytes: number): string that formats bytes to human-readable (KB, MB, GB). Add tests.",
  },
  openai: {
    file: "src/utils/validate.ts",
    fn: "validateEmail",
    summary: "Add validateEmail utility",
    description: "Create {file} with a function {fn}(email: string): boolean that validates email format using a regex. Add tests.",
  },
  google: {
    file: "src/utils/parse.ts",
    fn: "parseQueryString",
    summary: "Add parseQueryString utility",
    description: "Create {file} with a function {fn}(qs: string): Record<string, string> that parses URL query strings. Add tests.",
  },
  anthropic: {
    file: "src/utils/transform.ts",
    fn: "camelToSnake",
    summary: "Add camelToSnake utility",
    description: "Create {file} with a function {fn}(str: string): string that converts camelCase to snake_case. Add tests.",
  },
};

export function getProviderTask(provider: string): { jiraKey: string; summary: string; description: string } {
  const t = PROVIDER_TASKS[provider] || PROVIDER_TASKS.ollama;
  return {
    jiraKey: createIntKey(),
    summary: t.summary,
    description: t.description.replace(/\{file\}/g, t.file).replace(/\{fn\}/g, t.fn),
  };
}

/** Multi-story PRD task that naturally decomposes into 2-3 stories */
const PRD_TASKS: TaskTemplate[] = [
  {
    file: "src/",
    fn: "preferences",
    summary: "Add user preferences system",
    description:
      "Build a user preferences system:\n" +
      "1. Create a Preferences interface in src/types/preferences.ts with fields: theme ('light'|'dark'), language (string), notifications (boolean)\n" +
      "2. Add GET /api/preferences and PUT /api/preferences endpoints in src/routes/preferences.ts with an in-memory store\n" +
      "3. Add comprehensive tests for both endpoints in src/__tests__/preferences.test.ts",
  },
  {
    file: "src/",
    fn: "bookmarks",
    summary: "Add bookmarks feature",
    description:
      "Build a bookmarks system:\n" +
      "1. Create a Bookmark interface in src/types/bookmark.ts with fields: id (string), url (string), title (string), createdAt (Date)\n" +
      "2. Add CRUD endpoints: GET /api/bookmarks, POST /api/bookmarks, DELETE /api/bookmarks/:id in src/routes/bookmarks.ts with an in-memory store\n" +
      "3. Add comprehensive tests for all endpoints in src/__tests__/bookmarks.test.ts",
  },
];

export function getRandomPrdTask(): { jiraKey: string; summary: string; description: string } {
  const task = pickRandom(PRD_TASKS);
  return { jiraKey: createIntKey(), ...task };
}
