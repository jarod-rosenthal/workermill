import { streamText, stepCountIs } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalizePath, createPathScope, type PathGrant, type PathScope } from "../path-policy.js";
import { executeToolCall, type ToolExecutionContext } from "../tool-executor.js";
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

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 }).trim();
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
function gitMetadataGrants(workingDir: string, worktreePath: string, branchId: string): PathGrant[] {
  const parentGitDir = canonicalizePath(git(workingDir, ["rev-parse", "--absolute-git-dir"]));
  const commonDir = canonicalizePath(git(workingDir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const childCommonDir = canonicalizePath(git(worktreePath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const childGitDir = canonicalizePath(git(worktreePath, ["rev-parse", "--absolute-git-dir"]));
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

export function createWorktree(workingDir: string, prompt: string): WorktreeInfo {
  const branchId = crypto.randomUUID();
  const name = `${slugify(prompt)}-${branchId}`;
  const branchName = `workermill/${branchId}/work`;
  const worktreePath = path.join(workingDir, ".workermill", "worktrees", name);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  // Argument arrays make prompt/branch/path shell inert. UUID makes both names collision-safe.
  git(workingDir, ["worktree", "add", "-b", branchName, worktreePath, "HEAD"]);
  const startHead = git(worktreePath, ["rev-parse", "HEAD"]);
  try {
    return { worktreePath, branchName, startHead, scope: createPathScope(worktreePath, gitMetadataGrants(workingDir, worktreePath, branchId)) };
  } catch (error) {
    throw new Error(`Failed to establish isolated child scope: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface WorktreeState { kind: "empty" | "changed" | "unknown"; diffStat: string; }
function inspectWorktree(worktree: WorktreeInfo): WorktreeState {
  try {
    const status = git(worktree.worktreePath, ["status", "--porcelain", "--untracked-files=all", "--ignored=matching"]);
    const head = git(worktree.worktreePath, ["rev-parse", "HEAD"]);
    const diffStat = [
      git(worktree.worktreePath, ["diff", "--stat", "HEAD"]),
      git(worktree.worktreePath, ["diff", "--stat", "--cached"]),
      head === worktree.startHead ? "" : git(worktree.worktreePath, ["diff", "--stat", `${worktree.startHead}..HEAD`]),
    ].filter(Boolean).join("\n");
    return { kind: !status && head === worktree.startHead ? "empty" : "changed", diffStat: diffStat || (head === worktree.startHead ? "(no diff stat available)" : "(committed changes)") };
  } catch { return { kind: "unknown", diffStat: "(unable to inspect worktree state)" }; }
}
function removeConfirmedEmptyWorktree(workingDir: string, worktree: WorktreeInfo): void {
  git(workingDir, ["worktree", "remove", worktree.worktreePath]);
  git(workingDir, ["branch", "-d", worktree.branchName]);
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
export function wrapChildTools(tools: Record<string, ChildTool>, context: ToolExecutionContext): Record<string, ChildTool> {
  return Object.fromEntries(Object.entries(tools).flatMap(([toolName, definition]) => {
    if (!definition.execute || toolName === "sub_agent") return [];
    const execute = definition.execute;
    return [[toolName, { ...definition, execute: (input: Record<string, unknown>) => executeToolCall(toolName, input, () => execute(input), context) }]];
  }));
}
function childAbortSignal(parent: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(5 * 60 * 1000);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}
async function runSubAgent(model: LanguageModel, tools: Record<string, ChildTool>, prompt: string, maxTurns: number, system: string, signal: AbortSignal, onUsage?: SubAgentExecutorOptions["onUsage"]): Promise<SubAgentResult> {
  try {
    let turnsUsed = 0;
    // ChildTool is structural because the SDK's generic input types are not
    // preserved through the registered-tool selection in index.ts.
    const stream = streamText({ model, system, prompt, tools: tools as unknown as ToolSet, stopWhen: stepCountIs(maxTurns), abortSignal: signal, onStepFinish() { turnsUsed++; } });
    for await (const _chunk of stream.textStream) { /* consuming drives tool execution */ }
    if (signal.aborted) return { success: false, content: "", turnsUsed, error: "Sub-agent cancelled." };
    const content = await stream.text;
    const usage = await stream.totalUsage;
    if (onUsage) {
      const inputTokens = usage?.inputTokens ?? 0;
      const outputTokens = usage?.outputTokens ?? 0;
      await onUsage({ inputTokens, outputTokens, totalTokens: inputTokens + outputTokens });
    }
    return { success: true, content, turnsUsed };
  } catch (error) {
    return { success: false, content: "", turnsUsed: 0, error: `Sub-agent failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function createSubAgentExecutor(model: LanguageModel, workingDir: string, readOnlyTools: Record<string, ChildTool>, options: SubAgentExecutorOptions) {
  return async function execute({ prompt, maxTurns = 20, isolated = false }: SubAgentParams): Promise<SubAgentResult> {
    const parent = options.executionContext;
    if (!Number.isFinite(maxTurns) || maxTurns < 1 || maxTurns > 50) return { success: false, content: "", turnsUsed: 0, error: "maxTurns must be a finite number from 1 through 50." };
    const signal = childAbortSignal(parent?.signal);
    if (!isolated) {
      const scope = parent?.scope ?? createPathScope(workingDir);
      const context = childContext(parent, scope, true, signal);
      return runSubAgent(model, wrapChildTools(readOnlyTools, context), prompt, maxTurns,
        "You are a codebase exploration agent. You can read files, search, and list directories. You cannot modify files, run commands, access MCP tools, or spawn sub-agents. Provide specific findings.", signal, options.onUsage);
    }
    // Conservative no-context behavior: isolated writes never receive implicit permission.
    if (!parent) return { success: false, content: "", turnsUsed: 0, error: "Cannot start isolated sub-agent: a parent permission context is required." };
    if (parent.signal.aborted) return { success: false, content: "", turnsUsed: 0, error: "Cannot start isolated sub-agent: parent run is cancelled." };
    const preflight = parent.getPermissionState();
    if (preflight.mode === "plan" || preflight.readOnlyRole) return { success: false, content: "", turnsUsed: 0, error: "Cannot start isolated sub-agent: parent permission state is read-only." };

    let worktree: WorktreeInfo;
    try { git(workingDir, ["rev-parse", "--is-inside-work-tree"]); worktree = createWorktree(workingDir, prompt); }
    catch (error) { return { success: false, content: "", turnsUsed: 0, error: `Failed to create isolated worktree: ${error instanceof Error ? error.message : String(error)}` }; }
    const identity = `Branch \`${worktree.branchName}\`; worktree \`${worktree.worktreePath}\`.`;
    let result: SubAgentResult;
    try {
      const context = childContext(parent, worktree.scope, false, signal);
      result = await runSubAgent(model, wrapChildTools(options.createTools(worktree.worktreePath, worktree.scope, context), context), prompt, maxTurns,
        `You are working in isolated git worktree ${worktree.worktreePath}. Work only in that checkout. Commit changes when appropriate; they remain on your branch. Do not spawn sub-agents. Path-mode checks constrain explicit file tools but do not contain arbitrary shell commands.`, signal, options.onUsage);
    } catch (error) { result = { success: false, content: "", turnsUsed: 0, error: `Sub-agent failed: ${error instanceof Error ? error.message : String(error)}` }; }

    const state = inspectWorktree(worktree);
    if (result.success && state.kind === "empty") {
      try { removeConfirmedEmptyWorktree(workingDir, worktree); return { ...result, content: `${result.content}\n\n${identity} Confirmed empty and removed.` }; }
      catch (error) { return { success: false, content: `${result.content}\n\n${identity} Cleanup failed; preserved for inspection.`, turnsUsed: result.turnsUsed, error: `Failed to clean confirmed-empty worktree: ${error instanceof Error ? error.message : String(error)}` }; }
    }
    const detail = state.kind === "unknown" ? "State could not be confirmed; preserved for inspection." : `Preserved for inspection.\n${state.diffStat}`;
    return result.success ? { ...result, content: `${result.content}\n\n${identity} ${detail}` } : { ...result, error: `${result.error ?? "Sub-agent failed"}\n\n${identity} ${detail}` };
  };
}

/** Prune Git administrative records only; never removes child worktrees. */
export function cleanupStaleWorktrees(workingDir: string): void { try { git(workingDir, ["worktree", "prune"]); } catch { /* best effort */ } }
