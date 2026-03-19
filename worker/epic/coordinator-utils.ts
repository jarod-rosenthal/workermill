/**
 * Coordinator Utilities
 *
 * Shared helper functions used across coordinator modules.
 * These are stateless functions that operate on the coordinator context.
 */

import axios from "axios";

/**
 * Detect gate errors that no revision can fix (e.g. missing directories
 * referenced in the gate command, configuration errors).
 * Returns { unfixable: true, reason } when the gate output contains
 * patterns that indicate a structural problem rather than a code problem.
 */
export function isUnfixableGateError(output: string): { unfixable: boolean; reason: string } {
  // E902: ruff/flake8 "No such file or directory" — gate command references
  // a path that doesn't exist in the repo (e.g. `ruff check src/ tests/`
  // when tests/ hasn't been created yet)
  const e902Match = output.match(/E902\s+No such file or directory.*?-->\s*(\S+)/);
  if (e902Match) {
    return { unfixable: true, reason: `gate command references non-existent path: ${e902Match[1]}` };
  }

  // Generic "No such file or directory" from shell commands trying to enter
  // directories that don't exist
  const noSuchDir = output.match(/(?:cd|ls|cat|pushd):\s*(.+?):\s*No such file or directory/);
  if (noSuchDir) {
    return { unfixable: true, reason: `gate command references non-existent path: ${noSuchDir[1]}` };
  }

  // Command not found — tool isn't installed in the container
  const cmdNotFound = output.match(/(\S+):\s*(?:command not found|not found)/);
  if (cmdNotFound) {
    return { unfixable: true, reason: `required tool not installed: ${cmdNotFound[1]}` };
  }

  return { unfixable: false, reason: "" };
}

/**
 * Check if an error is a transient/retryable error (5xx, network timeout, etc.).
 * These should be retried rather than killing the epic.
 */
export function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  // Axios errors with 5xx status codes
  const axiosErr = error as { response?: { status?: number }; code?: string };
  if (axiosErr.response?.status && axiosErr.response.status >= 500) {
    return true;
  }

  // Network errors (ECONNRESET, ETIMEDOUT, ECONNREFUSED, etc.)
  if (axiosErr.code && ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EPIPE", "ERR_SOCKET_CONNECTION_TIMEOUT"].includes(axiosErr.code)) {
    return true;
  }

  // Check error message for common transient patterns
  const msg = error instanceof Error ? error.message : String(error);
  if (/status code (502|503|504)|socket hang up|ECONNRESET|ETIMEDOUT|network error/i.test(msg)) {
    return true;
  }

  return false;
}

/**
 * Extract PR number from a PR URL.
 * Supports multiple SCM providers:
 * - GitHub: https://github.com/owner/repo/pull/123
 * - GitLab: https://gitlab.com/owner/repo/-/merge_requests/123
 * - Bitbucket: https://bitbucket.org/workspace/repo/pull-requests/123
 */
export function extractPrNumber(prUrl: string): number | undefined {
  // GitHub: /pull/123
  const githubMatch = prUrl.match(/\/pull\/(\d+)/);
  if (githubMatch) {
    return parseInt(githubMatch[1], 10);
  }

  // Bitbucket: /pull-requests/123
  const bitbucketMatch = prUrl.match(/\/pull-requests\/(\d+)/);
  if (bitbucketMatch) {
    return parseInt(bitbucketMatch[1], 10);
  }

  // GitLab: /-/merge_requests/123
  const gitlabMatch = prUrl.match(/\/-\/merge_requests\/(\d+)/);
  if (gitlabMatch) {
    return parseInt(gitlabMatch[1], 10);
  }

  return undefined;
}

/**
 * Sleep helper.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Post a message to the task logs so it appears in the dashboard SSE stream.
 */
export async function postLog(
  apiBaseUrl: string,
  orgApiKey: string,
  parentTaskId: string,
  message: string,
  type: string = "info"
): Promise<void> {
  try {
    await axios.post(
      `${apiBaseUrl}/api/control-center/logs`,
      {
        taskId: parentTaskId,
        type,
        message: `[coordinator] ${message}`,
        severity: type === "error" ? "error" : "info",
      },
      { headers: { "x-api-key": orgApiKey }, timeout: 5000 }
    );
  } catch {
    // Fire and forget
  }
}

/**
 * Post a log message to the dashboard for real-time visibility.
 * Non-fatal — failures are silently ignored.
 */
export function postDashboardLog(
  apiBaseUrl: string,
  orgApiKey: string,
  parentTaskId: string,
  message: string
): void {
  axios.post(
    `${apiBaseUrl}/api/control-center/logs`,
    {
      taskId: parentTaskId,
      message,
      logType: "system",
    },
    {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": orgApiKey,
      },
      timeout: 5000,
    }
  ).catch(() => {
    // Non-fatal — dashboard log post failure should not affect execution
  });
}

/**
 * Post a non-terminal progress update to the WorkerMill API.
 * Uses /api/tasks/:id/worker-progress for mid-task status transitions
 * (e.g. PR created, review started) without triggering terminal logic.
 */
export async function postProgressUpdate(
  apiBaseUrl: string,
  orgApiKey: string,
  parentTaskId: string,
  status: "review_requested" | "reviewing" | "consolidating" | "deploying" | "integration_check",
  prUrl?: string,
  prNumber?: number,
  revisionCount?: number
): Promise<void> {
  try {
    const apiUrl = `${apiBaseUrl}/api/tasks/${parentTaskId}/worker-progress`;
    await axios.post(
      apiUrl,
      { status, prUrl, prNumber, revisionCount },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": orgApiKey,
        },
        timeout: 5000,
      }
    );
    console.log(`[Epic] Progress update: ${status}${prUrl ? ` (${prUrl})` : ""}`);
  } catch (err) {
    // Non-fatal — don't crash the container for a progress update
    console.warn("[Epic] Failed to post progress update:", err instanceof Error ? err.message : err);
  }
}

/**
 * Update the parent task status in the WorkerMill API.
 * This signals to the orchestrator the Epic execution state.
 * Uses the /api/tasks/:id/worker-complete endpoint that workers normally call.
 */
export async function updateTaskStatus(
  apiBaseUrl: string,
  orgApiKey: string,
  parentTaskId: string,
  revisionCount: number,
  status: "pr_approved" | "failed" | "review_requested" | "deployed" | "quality_gate_failed" | "completed" | "escalated" | "running",
  resultSummary?: string,
  errorMessage?: string,
  prUrl?: string
): Promise<void> {
  const exitCode = (status === "failed" || status === "quality_gate_failed" || status === "escalated") ? 1 : 0;

  // Classify errors post-hoc before reporting completion
  // This marks all but the last error as "recoverable" for better UX
  try {
    const classifyUrl = `${apiBaseUrl}/api/control-center/logs/${parentTaskId}/classify-errors`;
    await axios.post(
      classifyUrl,
      { exitCode },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": orgApiKey,
        },
        timeout: 5000,
      }
    );
    console.log(`[Epic] Classified error logs (exitCode: ${exitCode})`);
  } catch (err) {
    // Non-fatal - log but continue
    console.warn("[Epic] Failed to classify errors:", err instanceof Error ? err.message : err);
  }

  try {
    const apiUrl = `${apiBaseUrl}/api/tasks/${parentTaskId}/worker-complete`;

    // Extract PR number from URL for orchestrator manager review detection
    const prNumber = prUrl ? extractPrNumber(prUrl) : undefined;

    await axios.post(
      apiUrl,
      {
        exitCode,
        result: status,
        errorMessage: errorMessage,
        prUrl: prUrl,
        prNumber: prNumber,
        revisionCount: revisionCount,  // Report inline review revision count
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": orgApiKey,
        },
        timeout: 10000,
      }
    );

    console.log(`[Epic] Task status updated to: ${status}${resultSummary ? ` - ${resultSummary}` : ""}${prNumber ? ` (PR #${prNumber})` : ""}`);

    // CRITICAL: Output ::result:: marker for ECS monitor
    // This prevents race condition where ECS monitor sets "completed" before API call finishes
    // The marker MUST be output AFTER the API call succeeds to ensure consistency
    console.log(`::result::${status}`);

    // Also post ::result:: to worker_task_logs so ECS monitor can find it
    // (console.log only goes to CloudWatch, not the DB logs table)
    await postLog(apiBaseUrl, orgApiKey, parentTaskId, `::result::${status}`, "system");
    if (prUrl) {
      console.log(`::pr_url::${prUrl}`);
    }
  } catch (err) {
    console.error("[Epic] Failed to update task status:", err instanceof Error ? err.message : err);
    // Don't throw - status update failure shouldn't crash the container
  }
}
