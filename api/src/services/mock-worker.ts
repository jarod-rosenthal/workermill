/**
 * Mock Worker Service — Lightweight worker for E2E testing
 *
 * Posts synthetic logs and completes tasks through the same real API endpoints
 * that production workers use. Called by worker-spawner.ts when MOCK_WORKERS=true.
 *
 * Scenarios (based on Jira issue key prefix):
 * - E2E-FAIL-*   → failure
 * - E2E-BLOCKER-* → blocker/escalation
 * - E2E-SLOW-*   → slow execution (~12s)
 * - Everything else → success (~1s)
 */

import { logger } from "../utils/logger.js";

type MockScenario = "success" | "failure" | "blocker" | "slow";

interface MockWorkerOptions {
  taskId: string;
  apiBaseUrl: string;
  apiKey: string;
  jiraIssueKey: string;
  summary: string;
}

/**
 * Determine the mock scenario from the Jira issue key.
 */
function getScenario(jiraIssueKey: string): MockScenario {
  if (jiraIssueKey.startsWith("E2E-FAIL-")) return "failure";
  if (jiraIssueKey.startsWith("E2E-BLOCKER-")) return "blocker";
  if (jiraIssueKey.startsWith("E2E-SLOW-")) return "slow";
  return "success";
}

/**
 * Post log lines to the real API endpoint.
 */
async function postLog(
  apiBaseUrl: string,
  taskId: string,
  apiKey: string,
  message: string,
  type: string = "output",
  severity: string = "info",
): Promise<void> {
  const url = `${apiBaseUrl}/api/tasks/${taskId}/logs`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      logs: [{ type, message, severity }],
    }),
  });
  if (!res.ok) {
    logger.warn("[MockWorker] Failed to post log", {
      taskId,
      status: res.status,
      message,
    });
  }
}

/**
 * Call worker-complete on the real API endpoint.
 */
async function workerComplete(
  apiBaseUrl: string,
  taskId: string,
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const url = `${apiBaseUrl}/api/tasks/${taskId}/worker-complete`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    logger.warn("[MockWorker] Failed to call worker-complete", {
      taskId,
      status: res.status,
    });
  }
}

/**
 * Post a coordination context message (for blocker scenario).
 */
async function postContext(
  apiBaseUrl: string,
  taskId: string,
  apiKey: string,
  messageType: string,
  content: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const url = `${apiBaseUrl}/api/coordination/context`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      parentTaskId: taskId,
      taskId,
      persona: "mock_worker",
      messageType,
      content,
      metadata,
    }),
  });
  if (!res.ok) {
    logger.warn("[MockWorker] Failed to post context", {
      taskId,
      status: res.status,
      messageType,
    });
  }
}

/**
 * Sleep helper.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run the success scenario (~1s).
 */
async function runSuccess(opts: MockWorkerOptions): Promise<void> {
  const { taskId, apiBaseUrl, apiKey, summary } = opts;

  await postLog(apiBaseUrl, taskId, apiKey, `[mock] Starting mock execution for: ${summary}`);
  await sleep(200);
  await postLog(apiBaseUrl, taskId, apiKey, "[mock] Analyzing task requirements...");
  await sleep(200);
  await postLog(apiBaseUrl, taskId, apiKey, "[mock] Implementing changes...");
  await sleep(200);
  await postLog(apiBaseUrl, taskId, apiKey, "[mock] Running tests...");
  await sleep(200);
  await postLog(
    apiBaseUrl,
    taskId,
    apiKey,
    `::pr_url::https://github.com/mock-org/mock-repo/pull/1`,
    "result",
  );
  await postLog(apiBaseUrl, taskId, apiKey, "::result::review_requested", "result");
  await sleep(200);

  await workerComplete(apiBaseUrl, taskId, apiKey, {
    exitCode: 0,
    result: "review_requested",
    prUrl: "https://github.com/mock-org/mock-repo/pull/1",
    inputTokens: 1000,
    outputTokens: 500,
  });

  logger.info("[MockWorker] Success scenario completed", { taskId });
}

/**
 * Run the failure scenario (~0.6s).
 */
async function runFailure(opts: MockWorkerOptions): Promise<void> {
  const { taskId, apiBaseUrl, apiKey, summary } = opts;

  await postLog(apiBaseUrl, taskId, apiKey, `[mock] Starting mock execution for: ${summary}`);
  await sleep(200);
  await postLog(apiBaseUrl, taskId, apiKey, "[mock] Analyzing task requirements...");
  await sleep(200);
  await postLog(
    apiBaseUrl,
    taskId,
    apiKey,
    "[mock] ERROR: Build failed — type errors in src/index.ts",
    "output",
    "error",
  );
  await sleep(200);

  await workerComplete(apiBaseUrl, taskId, apiKey, {
    exitCode: 1,
    result: "failed",
    errorMessage: "Build failed — type errors in src/index.ts",
    inputTokens: 800,
    outputTokens: 300,
  });

  logger.info("[MockWorker] Failure scenario completed", { taskId });
}

/**
 * Run the blocker scenario (~0.6s).
 */
async function runBlocker(opts: MockWorkerOptions): Promise<void> {
  const { taskId, apiBaseUrl, apiKey, summary } = opts;

  await postLog(apiBaseUrl, taskId, apiKey, `[mock] Starting mock execution for: ${summary}`);
  await sleep(200);
  await postLog(apiBaseUrl, taskId, apiKey, "[mock] Analyzing task requirements...");
  await sleep(200);
  await postLog(
    apiBaseUrl,
    taskId,
    apiKey,
    "[mock] BLOCKER: Missing API credentials for external service",
    "output",
    "error",
  );

  // Post blocker_detected to the coordination feed
  await postContext(apiBaseUrl, taskId, apiKey, "blocker_detected", "Missing API credentials for external service", {
    storyIndex: 0,
    storyTitle: summary,
    errorCategory: "missing_credentials",
    errorMessage: "Missing API credentials for external service",
    affectedFiles: ["src/config.ts"],
    autoRetryAttempts: 3,
    maxAutoRetries: 3,
  });

  await sleep(200);

  await workerComplete(apiBaseUrl, taskId, apiKey, {
    exitCode: 1,
    result: "escalated",
    errorMessage: "Blocker: Missing API credentials for external service",
    inputTokens: 600,
    outputTokens: 200,
  });

  logger.info("[MockWorker] Blocker scenario completed", { taskId });
}

/**
 * Run the slow scenario (~12s).
 */
async function runSlow(opts: MockWorkerOptions): Promise<void> {
  const { taskId, apiBaseUrl, apiKey, summary } = opts;

  await postLog(apiBaseUrl, taskId, apiKey, `[mock] Starting mock execution for: ${summary}`);
  await sleep(2000);
  await postLog(apiBaseUrl, taskId, apiKey, "[mock] Analyzing task requirements...");
  await sleep(2000);
  await postLog(apiBaseUrl, taskId, apiKey, "[mock] Implementing changes (large refactor)...");
  await sleep(2000);
  await postLog(apiBaseUrl, taskId, apiKey, "[mock] Running full test suite...");
  await sleep(2000);
  await postLog(apiBaseUrl, taskId, apiKey, "[mock] Tests passed. Creating PR...");
  await sleep(2000);
  await postLog(
    apiBaseUrl,
    taskId,
    apiKey,
    "::pr_url::https://github.com/mock-org/mock-repo/pull/2",
    "result",
  );
  await postLog(apiBaseUrl, taskId, apiKey, "::result::review_requested", "result");
  await sleep(2000);

  await workerComplete(apiBaseUrl, taskId, apiKey, {
    exitCode: 0,
    result: "review_requested",
    prUrl: "https://github.com/mock-org/mock-repo/pull/2",
    inputTokens: 5000,
    outputTokens: 2500,
  });

  logger.info("[MockWorker] Slow scenario completed", { taskId });
}

/**
 * Spawn a mock worker — fire-and-forget.
 *
 * Runs the appropriate scenario based on the Jira issue key prefix,
 * posting logs and completing the task through the real API endpoints.
 */
export async function spawnMockWorker(opts: MockWorkerOptions): Promise<void> {
  const scenario = getScenario(opts.jiraIssueKey);

  logger.info("[MockWorker] Starting mock worker", {
    taskId: opts.taskId,
    jiraIssueKey: opts.jiraIssueKey,
    scenario,
  });

  try {
    switch (scenario) {
      case "success":
        await runSuccess(opts);
        break;
      case "failure":
        await runFailure(opts);
        break;
      case "blocker":
        await runBlocker(opts);
        break;
      case "slow":
        await runSlow(opts);
        break;
    }
  } catch (error) {
    logger.error("[MockWorker] Mock worker crashed", {
      taskId: opts.taskId,
      scenario,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
