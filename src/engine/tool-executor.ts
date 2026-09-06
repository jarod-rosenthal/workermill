import type { PathScope } from "./path-policy.js";
import { decideToolPermission, type PermissionDecision, type PermissionState } from "./tool-policy.js";
import { getToolMeta } from "./tools/tool-metadata.js";

export type EffectiveSandbox = "path" | "os" | "none";

export interface ToolExecutionEvent {
  phase: "start" | "complete";
  runId: string;
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: unknown;
}

export interface ToolExecutionContext {
  runId: string;
  workspace: string;
  scope: PathScope;
  effectiveSandbox: EffectiveSandbox;
  signal: AbortSignal;
  getPermissionState: () => PermissionState;
  readonly allowedNetworkDomains?: readonly string[];
  readonly allowLocalBinding?: boolean;
  readonly allowDockerSocket?: boolean;
  prompt?: (toolName: string, input: Record<string, unknown>, reason: string) => boolean | Promise<boolean>;
  preHook?: (toolName: string, input: Record<string, unknown>) => PreHookResult | Promise<PreHookResult>;
  checkpoint?: (toolName: string, input: Record<string, unknown>) => void | Promise<void>;
  postHook?: (toolName: string, input: Record<string, unknown>, output: unknown, error?: unknown) => void | Promise<void>;
  event?: (event: ToolExecutionEvent) => void | Promise<void>;
}

export type PreHookResult =
  | boolean
  | string
  | void
  | { blocked: boolean; reason?: string }
  | { allowed: boolean; reason?: string };

export type ToolExecutionErrorCode = "denied" | "permission_required" | "cancelled" | "hook_blocked";

export class ToolExecutionError extends Error {
  readonly code: ToolExecutionErrorCode;

  constructor(code: ToolExecutionErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ToolExecutionError";
    this.code = code;
  }
}

const mutationQueues = new Map<string, Promise<void>>();

function cancelled(context: ToolExecutionContext): never {
  throw new ToolExecutionError("cancelled", `tool ${context.runId} was cancelled`);
}

function checkCancelled(context: ToolExecutionContext): void {
  if (context.signal.aborted) cancelled(context);
}

function acquire(workspace: string, signal: AbortSignal): Promise<() => void> {
  const prior = mutationQueues.get(workspace) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  let released = false;
  const current = new Promise<void>((resolve) => { releaseCurrent = () => { if (!released) { released = true; resolve(); } }; });
  const queued = prior.then(() => current);
  mutationQueues.set(workspace, queued);

  return new Promise<() => void>((resolve, reject) => {
    let settled = false;
    const cancel = (): void => {
      if (settled) return;
      settled = true;
      // A cancelled waiter still has to advance the tail after its predecessor.
      void prior.then(() => releaseCurrent());
      reject(new ToolExecutionError("cancelled", "tool execution was cancelled while queued"));
    };
    if (signal.aborted) { cancel(); return; }
    const onAbort = (): void => {
      cancel();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    prior.then(() => {
      signal.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      resolve(() => {
        releaseCurrent();
        if (mutationQueues.get(workspace) === queued) mutationQueues.delete(workspace);
      });
    }, (error: unknown) => {
      signal.removeEventListener("abort", onAbort);
      if (!settled) { settled = true; reject(error); }
    });
  });
}

function hookBlocked(result: PreHookResult): string | null {
  if (result === false) return "pre-hook blocked tool execution";
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "blocked" in result && result.blocked) return result.reason ?? "pre-hook blocked tool execution";
  if (result && typeof result === "object" && "allowed" in result && !result.allowed) return result.reason ?? "pre-hook blocked tool execution";
  return null;
}

async function askPermission(
  decision: PermissionDecision,
  name: string,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<boolean> {
  if (decision.kind !== "ask") return decision.kind === "allow";
  if (!context.prompt) throw new ToolExecutionError("permission_required", decision.reason);
  if (context.signal.aborted) cancelled(context);
  let abortHandler!: () => void;
  const abort = new Promise<never>((_, reject) => {
    abortHandler = () => reject(new ToolExecutionError("cancelled", "permission prompt was cancelled"));
    context.signal.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve(context.prompt(name, input, decision.reason)), abort]);
  } finally {
    context.signal.removeEventListener("abort", abortHandler);
  }
}

/** Execute one tool through policy, hooks, checkpointing, and lifecycle events. */
export async function executeToolCall<T>(
  name: string,
  input: Record<string, unknown>,
  execute: () => T | Promise<T>,
  context: ToolExecutionContext,
): Promise<T> {
  checkCancelled(context);
  const readState = context.getPermissionState();
  const initial = decideToolPermission(name, input, readState.workspace ? readState : { ...readState, workspace: context.scope.workspace });
  if (initial.kind === "deny") throw new ToolExecutionError("denied", initial.reason);
  const authorized = await askPermission(initial, name, input, context);
  if (!authorized) throw new ToolExecutionError("denied", "permission prompt was declined");
  checkCancelled(context);

  const meta = getToolMeta(name);
  const mutating = name === "sub_agent" || !meta.isReadOnly;
  const release = mutating ? await acquire(context.scope.workspace, context.signal) : undefined;
  let started = false;
  let output: T | undefined;
  let executionError: unknown;
  try {
    checkCancelled(context);
    const currentState = context.getPermissionState();
    const current = decideToolPermission(name, input, currentState.workspace ? currentState : { ...currentState, workspace: context.scope.workspace });
    const unchangedAuthorization = current.kind === initial.kind && current.reason === initial.reason;
    if (current.kind === "deny") throw new ToolExecutionError("denied", current.reason);
    if (current.kind === "ask" && !unchangedAuthorization) {
      const currentAuthorized = await askPermission(current, name, input, context);
      if (!currentAuthorized) throw new ToolExecutionError("denied", "permission prompt was declined");
    }
    checkCancelled(context);
    if (context.preHook) {
      let preHookResult: PreHookResult;
      try {
        preHookResult = await context.preHook(name, input);
      } catch (error) {
        throw new ToolExecutionError("hook_blocked", error instanceof Error ? error.message : "pre-hook failed", { cause: error });
      }
      const block = hookBlocked(preHookResult);
      if (block) throw new ToolExecutionError("hook_blocked", block);
    }
    checkCancelled(context);
    if (context.checkpoint) await context.checkpoint(name, input);
    checkCancelled(context);
    started = true;
    output = await execute();
    // A late successful adapter result is still cancellation, and must not be
    // reported as a successful tool call.
    checkCancelled(context);
    return output;
  } catch (error) {
    executionError = error;
    throw error;
  } finally {
    try {
      if (started) {
        try {
          if (context.postHook) await context.postHook(name, input, output, executionError);
        } finally {
          if (context.event) await context.event({ phase: "complete", runId: context.runId, toolName: name, input, output, error: executionError });
        }
      }
    } finally {
      release?.();
    }
  }
}
