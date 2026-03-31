import { execSync } from "child_process";
import type { HookConfig, HooksConfig } from "./config.js";
import * as logger from "./logger.js";

/**
 * Run pre/post tool hooks (existing behavior).
 */
export function runHooks(
  phase: "pre" | "post",
  toolName: string,
  hooks: HooksConfig | undefined,
  workingDir: string,
): void {
  if (!hooks) return;
  const hookList = phase === "pre" ? hooks.pre : hooks.post;
  if (!hookList) return;

  for (const hook of hookList) {
    // Check if this hook applies to this tool
    if (hook.tools && hook.tools.length > 0 && !hook.tools.includes("*") && !hook.tools.includes(toolName)) {
      continue;
    }
    executeHook(hook, workingDir, { WORKERMILL_TOOL: toolName, WORKERMILL_PHASE: phase });
  }
}

/**
 * Supported lifecycle events:
 * - session_start: CLI session begins
 * - session_end: CLI session ends
 * - ship_start: /ship orchestration begins
 * - ship_complete: /ship orchestration finishes (success or failure)
 * - review_complete: Tech lead review finishes
 * - compact: Context compaction triggered
 */
export type LifecycleEvent =
  | "session_start"
  | "session_end"
  | "ship_start"
  | "ship_complete"
  | "review_complete"
  | "compact";

/**
 * Run lifecycle event hooks.
 */
export function runLifecycleHooks(
  event: LifecycleEvent,
  hooks: HooksConfig | undefined,
  workingDir: string,
  extraEnv?: Record<string, string>,
): void {
  if (!hooks?.on) return;
  const hookList = hooks.on[event];
  if (!hookList) return;

  for (const hook of hookList) {
    executeHook(hook, workingDir, { WORKERMILL_EVENT: event, ...extraEnv });
  }
}

/**
 * Execute a single hook — supports "command" (shell) and "http" (POST) types.
 */
function executeHook(
  hook: HookConfig,
  workingDir: string,
  envVars: Record<string, string>,
): void {
  const type = hook.type || (hook.url ? "http" : "command");

  if (type === "http" && hook.url) {
    // Fire-and-forget HTTP POST
    try {
      const body = JSON.stringify(envVars);
      // Use fetch if available (Node 18+), otherwise skip
      if (typeof globalThis.fetch === "function") {
        void globalThis.fetch(hook.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(10000),
        }).catch((err: Error) => {
          logger.error(`HTTP hook failed: ${err.message}`, { url: hook.url });
        });
      }
    } catch (err) {
      logger.error(`HTTP hook error: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  // Command type (default)
  if (!hook.command) return;
  try {
    execSync(hook.command, {
      cwd: workingDir,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30000,
      env: { ...process.env, ...envVars },
    });
  } catch (err) {
    logger.error(`Hook failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
