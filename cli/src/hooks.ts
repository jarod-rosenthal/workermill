import { execSync, spawn } from "child_process";
import type { HookConfig, HooksConfig } from "./config.js";
import * as logger from "./logger.js";

/** Max chars for tool input/output env vars to avoid OS env size limits. */
const MAX_ENV_VAR_LENGTH = 10000;

/**
 * Context about the tool invocation, passed to pre/post hooks via env vars.
 */
export interface ToolHookContext {
  /** The tool input (JSON stringified) */
  input?: string;
  /** The tool output/result (only available for post hooks) */
  output?: string;
  /** Whether the tool succeeded */
  success?: boolean;
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (value == null) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

function buildToolContextEnv(toolContext?: ToolHookContext): Record<string, string> {
  if (!toolContext) return {};
  const env: Record<string, string> = {};
  if (toolContext.input != null) {
    env.WORKERMILL_TOOL_INPUT = truncate(toolContext.input, MAX_ENV_VAR_LENGTH)!;
  }
  if (toolContext.output != null) {
    env.WORKERMILL_TOOL_OUTPUT = truncate(toolContext.output, MAX_ENV_VAR_LENGTH)!;
  }
  if (toolContext.success != null) {
    env.WORKERMILL_TOOL_SUCCESS = String(toolContext.success);
  }
  return env;
}

/**
 * Run pre/post tool hooks.
 */
export function runHooks(
  phase: "pre" | "post",
  toolName: string,
  hooks: HooksConfig | undefined,
  workingDir: string,
  toolContext?: ToolHookContext,
): void {
  if (!hooks) return;
  const hookList = phase === "pre" ? hooks.pre : hooks.post;
  if (!hookList) return;

  const contextEnv = buildToolContextEnv(toolContext);

  for (const hook of hookList) {
    // Check if this hook applies to this tool
    if (hook.tools && hook.tools.length > 0 && !hook.tools.includes("*") && !hook.tools.includes(toolName)) {
      continue;
    }
    executeHook(hook, workingDir, { WORKERMILL_TOOL: toolName, WORKERMILL_PHASE: phase, ...contextEnv });
  }
}

/**
 * Run pre-tool hooks and check if any blocked execution.
 * Returns { blocked: false } or { blocked: true, reason: string }.
 * A hook blocks by exiting with code 1 and printing a reason to stdout.
 * HTTP hooks cannot block (fire-and-forget).
 */
export function runPreHooksWithBlocking(
  toolName: string,
  hooks: HooksConfig | undefined,
  workingDir: string,
  toolContext?: ToolHookContext,
): { blocked: false } | { blocked: true; reason: string } {
  if (!hooks?.pre) return { blocked: false };

  const contextEnv = buildToolContextEnv(toolContext);
  const envVars = { WORKERMILL_TOOL: toolName, WORKERMILL_PHASE: "pre" as const, ...contextEnv };

  for (const hook of hooks.pre) {
    // Check if this hook applies to this tool
    if (hook.tools && hook.tools.length > 0 && !hook.tools.includes("*") && !hook.tools.includes(toolName)) {
      continue;
    }

    const type = hook.type || (hook.url ? "http" : "command");

    // HTTP hooks cannot block — fire-and-forget
    if (type === "http") {
      executeHook(hook, workingDir, envVars);
      continue;
    }

    // Command hooks: check exit code
    if (!hook.command) continue;
    try {
      execSync(hook.command, {
        cwd: workingDir,
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 30000,
        env: { ...process.env, ...envVars },
      });
    } catch (err: unknown) {
      // Non-zero exit — capture stdout as the reason
      const execErr = err as { stdout?: string; message?: string };
      const reason = (execErr.stdout || "").trim() || execErr.message || "Hook blocked execution";
      return { blocked: true, reason };
    }
  }

  return { blocked: false };
}

/**
 * Supported lifecycle events:
 * - session_start: CLI session begins
 * - session_end: CLI session ends
 * - ship_start: /ship orchestration begins
 * - ship_complete: /ship orchestration finishes (success or failure)
 * - review_complete: Tech lead review finishes
 * - compact: Context compaction triggered
 * - tool_error: Any tool execution error
 * - permission_denied: User denied a tool permission
 * - story_complete: Individual story in /ship completed
 * - memory_saved: A new memory/learning was extracted
 */
export type LifecycleEvent =
  | "session_start"
  | "session_end"
  | "ship_start"
  | "ship_complete"
  | "review_complete"
  | "compact"
  | "tool_error"
  | "permission_denied"
  | "story_complete"
  | "memory_saved";

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
 * If the hook has `async: true`, command hooks are spawned detached (fire-and-forget).
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

  // Async hooks: fire-and-forget via detached spawn
  if ((hook as HookConfig & { async?: boolean }).async) {
    try {
      spawn(hook.command, {
        shell: true,
        detached: true,
        stdio: "ignore",
        cwd: workingDir,
        env: { ...process.env, ...envVars },
      }).unref();
    } catch (err) {
      logger.error(`Async hook spawn failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

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
