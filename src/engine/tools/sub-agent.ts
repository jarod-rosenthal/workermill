import { streamText, stepCountIs } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalizePath, createPathScope, type PathGrant, type PathScope } from "../path-policy.js";
import { executeToolCall, type ToolExecutionContext } from "../tool-executor.js";
import { cancelAndWaitForRunProcesses, runProcess } from "../process-runner.js";
import { runScopedProcess } from "../scoped-process.js";
import { cleanupScopedBackgroundProcesses } from "./bash-background.js";
import { shutdownLSPRun } from "./lsp.js";
import type { PermissionState } from "../tool-policy.js";

export const name = "sub_agent";
export const description = "Spawn a sub-agent to explore a codebase or work in an isolated git worktree. Non-isolated children are read-only; isolated changes remain on a separate branch for review.";
export const parameters = {
  type: "object" as const,
  properties: {
    prompt: { type: "string" as const, description: "A detailed task description for the sub-agent." },
    maxTurns: { type: "number" as const, description: "Maximum tool-use turns (default: 20)." },
    isolated: { type: "boolean" as const, description: "Use an isolated git worktree. Default: false." },
  },
  required: ["prompt"] as const,
};

export interface SubAgentParams { prompt: string; maxTurns?: number; isolated?: boolean; }
export interface SubAgentUsage { inputTokens: number; outputTokens: number; totalTokens: number; }
export interface SubAgentResult { success: boolean; content: string; turnsUsed: number; error?: string; }

/** Structural SDK-tool type; avoids coupling this security boundary to SDK internals. */
export interface ChildTool {
  execute?: (input: Record<string, unknown>) => unknown | Promise<unknown>;
  [key: string]: unknown;
}
export interface WorktreeInfo { worktreePath: string; branchName: string; startHead: string; scope: PathScope; }
export interface SubAgentExecutorOptions {
  /** Absent context never auto-approves isolated child writes. */
  executionContext?: ToolExecutionContext;
  onUsage?: (usage: SubAgentUsage) => void | Promise<void>;
  /** Produces normal registered tools using the already-canonical child scope. */
  createTools: (worktreePath: string, scope: PathScope, context: ToolExecutionContext) => Record<string, ChildTool>;
}

function shellQuote(arg: string): string { return `'${arg.replace(/'/g, "'\\''")}'`; }
async function gitAdmin(cwd: string, args: readonly string[], signal: AbortSignal, runId: string): Promise<string> {
  signal.throwIfAborted();
  const command = ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args].map(shellQuote).join(" ");
  const result = await runProcess({ runId, command, cwd, signal, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, terminationGraceMs: 250 });
  signal.throwIfAborted();
  if (result.reason !== "exited" || result.exitCode !== 0 || result.outputTruncated) {
    throw new Error(`git ${args[0]} failed (${result.reason}): ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().split(/\s+/).slice(0, 4).join("-").slice(0, 40) || "task";
}
function isWithin(root: string, candidate: string): boolean { return candidate === root || candidate.startsWith(root + path.sep); }

/**
 * Git worktree metadata is outside the checkout. These write exceptions cover
 * only this child worktree's git dir, object store, and own branch ref/log.
 * They intentionally exclude the parent checkout, config, hooks, and other refs.
 */
async function gitMetadataGrants(workingDir: string, worktreePath: string, branchId: string, signal: AbortSignal, runId: string): Promise<PathGrant[]> {
  const parentGitDir = canonicalizePath(await gitAdmin(workingDir, ["rev-parse", "--absolute-git-dir"], signal, runId));
  const commonDir = canonicalizePath(await gitAdmin(workingDir, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal, runId));
  const childCommonDir = canonicalizePath(await gitAdmin(worktreePath, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal, runId));
  const childGitDir = canonicalizePath(await gitAdmin(worktreePath, ["rev-parse", "--absolute-git-dir"], signal, runId));
  if (!isWithin(commonDir, parentGitDir) || childCommonDir !== commonDir || !isWithin(path.join(commonDir, "worktrees"), childGitDir)) {
    throw new Error("Unable to grant minimum Git metadata: worktree Git directories are outside canonical repository metadata");
  }
  const objectsPath = path.join(commonDir, "objects");
  const refNamespace = path.join(commonDir, "refs", "heads", "workermill", branchId);
  const logNamespace = path.join(commonDir, "logs", "refs", "heads", "workermill", branchId);
  // Linux sandbox allowWrite ignores nonexistent paths; make the two directory
  // capabilities real before the child is launched. They contain only its ref.
  fs.mkdirSync(refNamespace, { recursive: true });
  fs.mkdirSync(logNamespace, { recursive: true });
  const objects = canonicalizePath(objectsPath);
  const canonicalRefNamespace = canonicalizePath(refNamespace);
  const canonicalLogNamespace = canonicalizePath(logNamespace);
  if (objects !== objectsPath || canonicalRefNamespace !== refNamespace || canonicalLogNamespace !== logNamespace) throw new Error("Unable to grant minimum Git metadata: objects or ref namespace is not its canonical lexical path");
  return [
    { root: childGitDir, access: "read_write" },
    { root: objects, access: "read_write" },
    { root: canonicalRefNamespace, access: "read_write" },
    { root: canonicalLogNamespace, access: "read_write" },
  ];
}

export async function createWorktree(workingDir: string, prompt: string, signal = new AbortController().signal, runId = `child-admin-${crypto.randomUUID()}`): Promise<WorktreeInfo> {
  const branchId = crypto.randomUUID();
  const name = `${slugify(prompt)}-${branchId}`;
  const branchName = `workermill/${branchId}/work`;
  const workspace = canonicalizePath(workingDir);
  const worktreeBase = path.join(workspace, ".workermill", "worktrees");
  if (canonicalizePath(worktreeBase) !== worktreeBase) {
    throw new Error("Worktree directory must not redirect through a symlink");
  }
  const commonDir = canonicalizePath(await gitAdmin(workspace, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal, runId));
  for (const relative of ["objects", "worktrees", "refs/heads/workermill", "logs/refs/heads/workermill"]) {
    const candidate = path.join(commonDir, relative);
    if (canonicalizePath(candidate) !== candidate) throw new Error("Git metadata namespace must not redirect through a symlink");
  }
  const worktreePath = path.join(worktreeBase, name);
  try {
    fs.mkdirSync(worktreeBase, { recursive: true });
    // Do not run checkout filters on the host. Populate the checkout through
    // the child's selected process boundary after its scope is established.
    await gitAdmin(workspace, ["worktree", "add", "--no-checkout", "-b", branchName, worktreePath, "HEAD"], signal, runId);
    const startHead = await gitAdmin(worktreePath, ["rev-parse", "HEAD"], signal, runId);
    return { worktreePath, branchName, startHead, scope: createPathScope(worktreePath, await gitMetadataGrants(workingDir, worktreePath, branchId, signal, runId)) };
  } catch (error) {
    throw new Error(`Failed to establish isolated child scope: ${error instanceof Error ? error.message : String(error)}. Inspect branch ${branchName} and worktree ${worktreePath}; any partial work is preserved.`);
  }
}

interface WorktreeState { kind: "empty" | "changed" | "unknown"; diffStat: string; }
async function inspectWorktree(worktree: WorktreeInfo, context: ToolExecutionContext): Promise<WorktreeState> {
  // Status/diff can execute configured Git clean filters. They must not run
  // on the host outside an OS child's boundary, even during finalization.
  const inspectionSignal = AbortSignal.any([context.signal, AbortSignal.timeout(5_000)]);
  const inspectGit = async (args: readonly string[]): Promise<string> => {
    inspectionSignal.throwIfAborted();
    const command = ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args]
      .map((arg) => "'" + arg.replace(/'/g, "'\\''") + "'").join(" ");
    const result = await runScopedProcess({
      runId: `child-inspection-${crypto.randomUUID()}`, signal: inspectionSignal,
      cwd: worktree.worktreePath, command,
      timeoutMs: 5_000, maxOutputBytes: 64 * 1024, terminationGraceMs: 250,
    }, {
      sandbox: context.effectiveSandbox === "os" ? "os" : true,
      scope: worktree.scope,
      capabilities: { allowedNetworkDomains: [], allowLocalBinding: false, allowDockerSocket: false },
    });
    if (result.reason !== "exited" || result.exitCode !== 0 || result.outputTruncated) throw new Error("Unable to inspect complete child state");
    inspectionSignal.throwIfAborted();
    return result.stdout.trim();
  };
  try {
    inspectionSignal.throwIfAborted();
    const status = await inspectGit(["status", "--porcelain", "--untracked-files=all", "--ignored=matching"]);
    const head = await inspectGit(["rev-parse", "HEAD"]);
    const diffStat = [
      await inspectGit(["diff", "--no-ext-diff", "--no-textconv", "--stat", "HEAD"]),
      await inspectGit(["diff", "--no-ext-diff", "--no-textconv", "--stat", "--cached"]),
      head === worktree.startHead ? "" : await inspectGit(["diff", "--no-ext-diff", "--no-textconv", "--stat", `${worktree.startHead}..HEAD`]),
    ].filter(Boolean).join("\n");
    return { kind: !status && head === worktree.startHead ? "empty" : "changed", diffStat: diffStat || (head === worktree.startHead ? "(no diff stat available)" : "(committed changes)") };
  } catch (error) {
    if (inspectionSignal.aborted) throw error;
    return { kind: "unknown", diffStat: "(unable to inspect worktree state)" };
  }
}
async function removeConfirmedEmptyWorktree(workingDir: string, worktree: WorktreeInfo, signal: AbortSignal, runId: string): Promise<void> {
  await gitAdmin(workingDir, ["worktree", "remove", worktree.worktreePath], signal, runId);
  await gitAdmin(workingDir, ["branch", "-d", worktree.branchName], signal, runId);
}

function conservativePermissionState(workspace: string, readOnlyRole: boolean): PermissionState {
  return { mode: "default", trustAll: false, sessionAllow: new Set(), rules: {}, readOnlyRole, workspace };
}
function childContext(parent: ToolExecutionContext | undefined, scope: PathScope, readOnlyRole: boolean, signal: AbortSignal): ToolExecutionContext {
  return {
    runId: `sub-agent-${crypto.randomUUID()}`,
    workspace: scope.workspace, scope, effectiveSandbox: parent?.effectiveSandbox === "os" ? "os" : "path",
    signal,
    getPermissionState: () => {
      const inherited = parent?.getPermissionState() ?? conservativePermissionState(scope.workspace, readOnlyRole);
      return { ...inherited, workspace: scope.workspace, readOnlyRole: inherited.readOnlyRole || readOnlyRole };
    },
    // executeToolCall supplies this child context as the final callback
    // argument, so inherited adapters can use its workspace instead of a
    // captured parent cwd.
    prompt: parent?.prompt, preHook: parent?.preHook, checkpoint: parent?.checkpoint,
    postHook: parent?.postHook, event: parent?.event,
    allowedNetworkDomains: parent?.allowedNetworkDomains,
    allowLocalBinding: parent?.allowLocalBinding,
    allowDockerSocket: false,
  };
}

/** Every child tool takes the same policy/hook/cancellation path as parent tools. */
export function wrapChildTools(
  tools: Record<string, ChildTool>,
  context: ToolExecutionContext,
  onFailure?: (error: unknown) => void,
  pending?: Set<Promise<unknown>>,
): Record<string, ChildTool> {
  return Object.fromEntries(Object.entries(tools).flatMap(([toolName, definition]) => {
    if (!definition.execute || toolName === "sub_agent") return [];
    const execute = definition.execute;
    return [[toolName, { ...definition, execute: (input: Record<string, unknown>) => {
      const call = executeToolCall(toolName, input, () => execute(input), context).catch((error: unknown) => {
        onFailure?.(error);
        throw error;
      });
      pending?.add(call);
      void call.then(() => pending?.delete(call), () => pending?.delete(call));
      return call;
    } }]];
  }));
}
function childAbortController(parent: AbortSignal | undefined): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 5 * 60 * 1000);
  timer.unref();
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) controller.abort();
  return { controller, dispose: () => { clearTimeout(timer); parent?.removeEventListener("abort", abort); } };
}
async function runSubAgent(
  model: LanguageModel,
  rawTools: Record<string, ChildTool>,
  prompt: string,
  maxTurns: number,
  system: string,
  context: ToolExecutionContext,
  controller: AbortController,
  outerSignal: AbortSignal,
  onUsage?: SubAgentExecutorOptions["onUsage"],
): Promise<SubAgentResult> {
  let turnsUsed = 0;
  let lastToolCount = 0;
  let content = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let terminalError: unknown;
  let result: SubAgentResult;
  const pending = new Set<Promise<unknown>>();
  const tools = wrapChildTools(rawTools, context, (error) => {
    terminalError ??= error;
    controller.abort();
  }, pending);
  try {
    if (context.signal.aborted) throw new Error("Sub-agent cancelled before model startup.");
    // ChildTool is structural because dynamic SDK schemas erase input generics.
    const stream = streamText({
      model, system, prompt, tools: tools as unknown as ToolSet,
      stopWhen: stepCountIs(maxTurns),
      abortSignal: context.signal,
      onStepFinish({ toolCalls, usage, text }) {
        turnsUsed++;
        lastToolCount = toolCalls.length;
        inputTokens += usage.inputTokens ?? 0;
        outputTokens += usage.outputTokens ?? 0;
        content += text;
      },
    });
    for await (const _chunk of stream.textStream) { /* drives tool execution */ }
    content = await stream.text;
    const usage = await stream.totalUsage;
    inputTokens = usage?.inputTokens ?? inputTokens;
    outputTokens = usage?.outputTokens ?? outputTokens;
    if (terminalError) throw terminalError;
    if (context.signal.aborted) throw new Error("Sub-agent cancelled.");
    const finishReason = await stream.finishReason;
    if (finishReason === "tool-calls" || (turnsUsed >= maxTurns && lastToolCount > 0)) {
      throw new Error("Sub-agent stopped with an unfinished tool loop at its turn limit.");
    }
    if (finishReason !== "stop") throw new Error(`Sub-agent ended without completion: ${finishReason}`);
    if (context.signal.aborted) throw new Error("Sub-agent cancelled after model completion.");
    result = { success: true, content, turnsUsed };
  } catch (error) {
    const cause = terminalError ?? error;
    result = {
      success: false, content, turnsUsed,
      error: `Sub-agent failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  // Transport failure can finish before concurrently dispatched tool calls.
  // Await the whole tool lifetime, including hooks, not only OS process exit.
  // Failed model attempts must stop tools before draining. Successful model
  // attempts keep their signal live until every dispatched tool settles.
  if (!result.success || terminalError) controller.abort(new Error("Sub-agent model attempt failed"));
  while (pending.size > 0) await Promise.allSettled([...pending]);
  if (result.success && terminalError) {
    result = { success: false, content, turnsUsed, error: `Sub-agent failed: ${terminalError instanceof Error ? terminalError.message : String(terminalError)}` };
  }
  controller.abort(new Error("Sub-agent model attempt finished"));
  try {
    await onUsage?.({ inputTokens, outputTokens, totalTokens: inputTokens + outputTokens });
  } catch (error) {
    result = { ...result, success: false, error: `Unable to record child usage: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (result.success && outerSignal.aborted) {
    result = { ...result, success: false, error: "Sub-agent cancelled during finalization." };
  }
  return result;
}

export function createSubAgentExecutor(
  model: LanguageModel,
  workingDir: string,
  readOnlyTools: Record<string, ChildTool>,
  options: SubAgentExecutorOptions,
) {
  return async function execute({ prompt, maxTurns = 20, isolated = false }: SubAgentParams): Promise<SubAgentResult> {
    if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 50) {
      return { success: false, content: "", turnsUsed: 0, error: "maxTurns must be an integer from 1 through 50." };
    }
    const parent = options.executionContext;
    const lifetime = childAbortController(parent?.signal);
    const outerSignal = lifetime.controller.signal;
    const modelController = new AbortController();
    const modelSignal = AbortSignal.any([outerSignal, modelController.signal]);
    let context: ToolExecutionContext | undefined;
    let worktree: WorktreeInfo | undefined;
    let result: SubAgentResult = { success: false, content: "", turnsUsed: 0, error: "Child did not start." };
    try {
    try {
      if (outerSignal.aborted) throw new Error("Parent run is cancelled.");
      if (isolated) {
        if (!parent) throw new Error("A parent permission context is required for isolated work.");
        const state = parent.getPermissionState();
        if (state.mode === "plan" || state.readOnlyRole) throw new Error("Parent permission state is read-only.");
        worktree = await createWorktree(workingDir, prompt, outerSignal, `child-admin-${crypto.randomUUID()}`);
        context = childContext(parent, worktree.scope, false, modelSignal);
        const checkout = await runScopedProcess({
          runId: context.runId, signal: modelSignal, cwd: worktree.worktreePath,
          command: "git -c core.hooksPath=/dev/null -c core.fsmonitor=false read-tree --reset -u HEAD",
          timeoutMs: 30_000, maxOutputBytes: 64 * 1024, terminationGraceMs: 250,
        }, {
          sandbox: context.effectiveSandbox === "os" ? "os" : true,
          scope: worktree.scope,
          capabilities: {
            allowedNetworkDomains: context.allowedNetworkDomains,
            allowLocalBinding: context.allowLocalBinding,
            allowDockerSocket: false,
          },
        });
        if (checkout.reason !== "exited" || checkout.exitCode !== 0) {
          throw new Error(`Child checkout failed (${checkout.reason}): ${checkout.stderr}`);
        }
        result = await runSubAgent(
          model, options.createTools(worktree.worktreePath, worktree.scope, context),
          prompt, maxTurns,
          `Work only in isolated checkout ${worktree.worktreePath}. Changes remain on your branch for review. Do not spawn children. Path checks are not arbitrary-shell containment.`,
          context, modelController, outerSignal, options.onUsage,
        );
      } else {
        const scope = parent?.scope ?? createPathScope(workingDir);
        context = childContext(parent, scope, true, modelSignal);
        // Rebuild closures with the child's scope/signal instead of retaining
        // full-disk or stale parent execution options.
        const rebuilt = options.createTools(workingDir, scope, context);
        const tools = Object.fromEntries(Object.keys(readOnlyTools)
          .filter((name) => rebuilt[name]).map((name) => [name, rebuilt[name]]));
        result = await runSubAgent(
          model, tools, prompt, maxTurns,
          "Explore the codebase using read-only tools. Do not modify files or spawn children. Provide specific findings.",
          context, modelController, outerSignal, options.onUsage,
        );
      }
    } catch (error) {
      result = {
        success: false, content: "", turnsUsed: 0,
        error: `Sub-agent failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      modelController.abort(new Error("Sub-agent model cleanup"));
      if (context) {
        const cleanup = await Promise.allSettled([
          Promise.resolve().then(() => cancelAndWaitForRunProcesses(context!.runId)),
          Promise.resolve().then(() => cleanupScopedBackgroundProcesses(context!.runId)),
          Promise.resolve().then(() => shutdownLSPRun(context!.runId)),
        ]);
        const failures = cleanup.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");
        if (failures.length) {
          const detail = failures.map(entry => entry.reason instanceof Error ? entry.reason.message : String(entry.reason)).join("; ");
        result = {
          success: false, content: "", turnsUsed: 0,
          error: `Child cleanup failed: ${detail}`,
        };
        }
      }
    }

    if (result.success && outerSignal.aborted) {
      result = { ...result, success: false, error: "Sub-agent cancelled during cleanup." };
    }
    if (!worktree) return result;
    const identity = `Branch \`${worktree.branchName}\`; worktree \`${worktree.worktreePath}\`.`;
    // Unsuccessful children are always preserved; do not delay cancellation
    // by invoking repository-defined filters merely to produce a diff summary.
    let state: WorktreeState = { kind: "unknown", diffStat: "(inspection skipped after failure or cancellation)" };
    if (result.success && context) {
      try {
        const administrativeContext = { ...context, signal: outerSignal };
        state = await inspectWorktree(worktree, administrativeContext);
      } catch (error) {
        result = { ...result, success: false, error: `Child inspection cancelled: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
    if (result.success && state.kind === "empty") {
      try {
        outerSignal.throwIfAborted();
        await removeConfirmedEmptyWorktree(workingDir, worktree, outerSignal, `child-admin-${crypto.randomUUID()}`);
        return { ...result, content: `${result.content}\n\n${identity} Confirmed empty and removed.` };
      } catch (error) {
        return {
          ...result, success: false,
          error: `Cleanup failed: ${error instanceof Error ? error.message : String(error)}\n\n${identity} Inspect the remaining local state.`,
        };
      }
    }
    const detail = state.kind === "unknown"
      ? "State could not be confirmed; preserved for inspection."
      : `Preserved for inspection.\n${state.diffStat}`;
    return result.success
      ? { ...result, content: `${result.content}\n\n${identity} ${detail}` }
      : { ...result, error: `${result.error ?? "Sub-agent failed"}\n\n${identity} ${detail}` };
    } finally {
      lifetime.controller.abort(new Error("Sub-agent administrative lifetime finished"));
      lifetime.dispose();
    }
  };
}

/** Prune Git administrative records only; never removes child worktrees. */
export function cleanupStaleWorktrees(workingDir: string, signal = new AbortController().signal): void {
  void gitAdmin(workingDir, ["worktree", "prune"], signal, `child-admin-${crypto.randomUUID()}`).catch(() => { /* best effort */ });
}
