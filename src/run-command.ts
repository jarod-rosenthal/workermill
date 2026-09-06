import { streamText, stepCountIs } from "ai";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createModel, buildOllamaOptions } from "./engine/model-factory.js";
import { createToolDefinitions } from "./engine/tools/index.js";
import { canonicalizePath, createPathScope, resolvePath } from "./engine/path-policy.js";
import { executeToolCall, ToolExecutionError, type EffectiveSandbox, type ToolExecutionContext } from "./engine/tool-executor.js";
import { extractToolTargets } from "./engine/tool-policy.js";
import { cancelAndWaitForRunProcesses } from "./engine/process-runner.js";
import { cleanupScopedBackgroundProcesses } from "./engine/tools/bash-background.js";
import { formatProjectInstructions } from "./instructions.js";
import { formatPromptProjectContext } from "./project-context.js";
import { loadLearnings } from "./learnings.js";
import { createMCPRunResources, autoDetectMCPServersForRun } from "./mcp-client.js";
import { shutdownLSPRun } from "./engine/tools/lsp.js";
import type { SandboxSetting } from "./sandbox-mode.js";
import { getProviderForPersona } from "./config.js";
import { createSession, loadLatestSession, loadSessionById, addMessage, saveSession, type Session } from "./session.js";
import { CostTracker } from "./cost-tracker.js";
import { addUsage, settleUsage, usageFromSdk } from "./engine/model-usage.js";
import type { LedgerSnapshot } from "./cost-tracker.js";
import type { TokenUsage } from "./providers/types.js";
import type { CliConfig } from "./config.js";
import type { AIProvider } from "./engine/types.js";
import { runHooks, runLifecycleHooks, runPreHooksWithBlocking } from "./hooks.js";
import { checkpoint } from "./checkpoints.js";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};
export type RunFailureReason =
  | "invalid_options"
  | "permission_required"
  | "denied"
  | "cancelled"
  | "provider_error"
  | "hook_blocked"
  | "step_limit"
  | "os_sandbox_unavailable"
  | "cleanup_error";
export type RunStatus = "ok" | "failed" | "cancelled";
export interface RunResult {
  status: RunStatus;
  reason?: RunFailureReason;
  error?: string;
  exitCode: number;
  sessionId: string | null;
  model: string | null;
  text: string;
  toolCalls: number;
  tokens: { input: number; output: number };
  costUsd: number;
  durationMs: number;
  usageLedger?: LedgerSnapshot;
  usageComplete?: boolean;
}
export interface RunOptions {
  prompt: string;
  json?: boolean;
  session?: string;
  continue?: boolean;
  model?: string;
  maxSteps?: number;
  singlePrompt?: boolean;
  sandboxed?: SandboxSetting;
  signal?: AbortSignal;
}
const EXIT_CODES: Record<RunFailureReason, number> = {
  invalid_options: 2, permission_required: 3, denied: 4, step_limit: 5,
  os_sandbox_unavailable: 6, provider_error: 1, hook_blocked: 1, cleanup_error: 1, cancelled: 130,
};
function failure(
  start: number,
  reason: RunFailureReason,
  error: string,
  extra: Partial<RunResult> = {},
): RunResult {
  return {
    status: reason === "cancelled" ? "cancelled" : "failed",
    reason,
    error,
    exitCode: EXIT_CODES[reason],
    sessionId: extra.sessionId ?? null,
    model: extra.model ?? null,
    text: extra.text ?? "",
    toolCalls: extra.toolCalls ?? 0,
    tokens: extra.tokens ?? { input: 0, output: 0 },
    costUsd: extra.costUsd ?? 0,
    durationMs: Date.now() - start,
    usageLedger: extra.usageLedger ?? { calls: [], totals: { callCount: 0, reportedUsageCalls: 0, partialUsageCalls: 0, missingUsageCalls: 0, knownPricingCalls: 0, unknownPricingCalls: 0, localApiCalls: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedApiCost: 0 } },
    usageComplete: extra.usageComplete ?? true,
  };
}
function maxSteps(value: number | undefined, start: number): number | RunResult {
  if (value === undefined) return 50;
  return Number.isFinite(value) && Number.isInteger(value) && value > 0
    ? value : failure(start, "invalid_options", "--max-steps must be a finite positive integer");
}
function effectiveSandbox(value: SandboxSetting | undefined): EffectiveSandbox {
  return value === "os" ? "os" : value === false ? "none" : "path";
}
function appendLedger(previous: LedgerSnapshot | undefined, next: LedgerSnapshot): LedgerSnapshot {
  if (!previous) return next;
  const a = previous.totals;
  const b = next.totals;
  return {
    calls: [...previous.calls, ...next.calls],
    totals: {
      callCount: a.callCount + b.callCount,
      reportedUsageCalls: a.reportedUsageCalls + b.reportedUsageCalls,
      partialUsageCalls: a.partialUsageCalls + b.partialUsageCalls,
      missingUsageCalls: a.missingUsageCalls + b.missingUsageCalls,
      knownPricingCalls: a.knownPricingCalls + b.knownPricingCalls,
      unknownPricingCalls: a.unknownPricingCalls + b.unknownPricingCalls,
      localApiCalls: a.localApiCalls + b.localApiCalls,
      inputTokens: a.inputTokens + b.inputTokens,
      outputTokens: a.outputTokens + b.outputTokens,
      cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
      cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
      estimatedApiCost: a.estimatedApiCost + b.estimatedApiCost,
    },
  };
}
function reasonFor(error: unknown, signal: AbortSignal): RunFailureReason {
  if (signal.aborted || (error instanceof ToolExecutionError && error.code === "cancelled")) return "cancelled";
  if (error instanceof ToolExecutionError && (error.code === "denied" || error.code === "permission_required")) return error.code;
  if (error && typeof error === "object" && "code" in error && error.code === "os_sandbox_unavailable") return "os_sandbox_unavailable";
  return "provider_error";
}
function checkpointAuthorizedTargets(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
): void {
  const checkpointTools = new Set(["write_file", "edit_file", "multi_edit_file", "patch"]);
  if (!checkpointTools.has(toolName)) return;
  for (const target of extractToolTargets(toolName, input)) {
    const resolved = context.effectiveSandbox === "none"
      ? canonicalizePath(path.resolve(context.workspace, target))
      : resolvePath(context.scope, target, "read_write");
    checkpoint(resolved, toolName);
  }
}
function wrapTools(
  rawTools: Record<string, unknown>,
  context: ToolExecutionContext,
  onError: (error: ToolExecutionError) => void,
  pending: Set<Promise<unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(rawTools).map(([name, definition]) => {
    // SDK gap: Tool generics are provider-schema-specific after dynamic MCP composition.
    const raw = definition as { execute?: (input: Record<string, unknown>) => unknown };
    if (!raw.execute) return [name, definition];
    return [name, { ...raw, execute: (input: Record<string, unknown>) => {
      const call = (async () => {
      try { return await executeToolCall(name, input, () => raw.execute!(input), context); }
      catch (error) { if (error instanceof ToolExecutionError) onError(error); throw error; }
      })();
      pending.add(call);
      return call.finally(() => pending.delete(call));
    }}];
  }));
}
export function resolveRunModelSelection(config: CliConfig, overrideModel?: string): { provider: string; model: string } {
  const base = getProviderForPersona(config);
  if (!overrideModel) return { provider: base.provider, model: base.model };
  if (!overrideModel.includes("/")) return { provider: base.provider, model: overrideModel };
  const [provider, model] = overrideModel.split("/", 2);
  if (!config.providers[provider]) throw new Error("Provider " + provider + " not configured. Configure it first with /setup or /settings key " + provider + " <api-key>.");
  return { provider, model };
}
export async function runCommand(options: RunOptions, config: CliConfig, workingDir: string): Promise<RunResult> {
  const start = Date.now();
  const stepLimit = maxSteps(options.maxSteps, start);
  if (typeof stepLimit !== "number") return stepLimit;
  if (options.session && options.continue) return failure(start, "invalid_options", "--session and --continue are mutually exclusive");
  let provider: string;
  let model: string;
  try { ({ provider, model } = resolveRunModelSelection(config, options.model)); }
  catch (error) { return failure(start, "invalid_options", error instanceof Error ? error.message : String(error)); }
  const modelIdentity = provider + "/" + model;
  const providerConfig = config.providers[provider];
  if (!providerConfig) return failure(start, "invalid_options", "Provider " + provider + " not configured", { model: modelIdentity });
  const runId = randomUUID();
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromParent, { once: true });
  const abortFromSigint = () => controller.abort();
  process.once("SIGINT", abortFromSigint);
  const costs = new CostTracker();
  let toolCalls = 0;
  let text = "";
  let usage: Partial<TokenUsage> | undefined;
  let hasFinalUsage = false;
  let modelStarted = false;
  let result: RunResult | undefined;
  let completedSteps = 0;
  let lastStepHadToolCalls = false;
  let terminalToolError: ToolExecutionError | undefined;
  const pendingTools = new Set<Promise<unknown>>();
  let mcpResources: ReturnType<typeof createMCPRunResources> | undefined;
  let session: Session | null | undefined;
  let shouldSaveSession = false;
  try {
    mcpResources = createMCPRunResources({ runId, workspace: workingDir, signal: controller.signal });
    const requestedSandbox = options.sandboxed ?? config.sandbox ?? true;
    if (requestedSandbox === "os") {
      const { getOSSandboxDependencyStatus } = await import("./sandbox-mode.js");
      const status = getOSSandboxDependencyStatus();
      if (!status.supported || status.errors.length) {
        return failure(start, "os_sandbox_unavailable", "OS sandbox requested but unavailable: " + status.errors.join(", "), { model: modelIdentity });
      }
    }
    let messages: ChatMessage[];
    if (options.singlePrompt) {
      session = createSession(provider, model);
      session.id = "single";
      messages = [{ role: "user", content: options.prompt }];
    } else if (options.session) {
      session = loadSessionById(options.session);
      if (!session) return failure(start, "invalid_options", "Session " + options.session + " not found", { model: modelIdentity });
      session.provider = provider;
      session.model = model;
      addMessage(session, "user", options.prompt);
      messages = session.messages.map((message) => ({ role: message.role, content: message.content }));
    } else if (options.continue) {
      session = loadLatestSession();
      if (!session) return failure(start, "invalid_options", "No recent session to continue", { model: modelIdentity });
      session.provider = provider;
      session.model = model;
      addMessage(session, "user", options.prompt);
      messages = session.messages.map((message) => ({ role: message.role, content: message.content }));
    } else {
      session = createSession(provider, model);
      addMessage(session, "user", options.prompt);
      messages = session.messages.map((message) => ({ role: message.role, content: message.content }));
    }
    if (options.signal?.aborted) controller.abort();
    if (controller.signal.aborted) throw new ToolExecutionError("cancelled", "headless run cancelled");
    const scope = createPathScope(workingDir, config.sandboxCapabilities?.extraPathGrants ?? []);
    const context: ToolExecutionContext = {
      runId, workspace: scope.workspace, scope, effectiveSandbox: effectiveSandbox(requestedSandbox), signal: controller.signal,
      allowedNetworkDomains: config.sandboxCapabilities?.allowedNetworkDomains, allowLocalBinding: config.sandboxCapabilities?.allowLocalBinding,
      allowDockerSocket: config.sandboxCapabilities?.allowDockerSocket,
      // Headless has no prompt callback: R04 returns permission_required for asks.
      getPermissionState: () => ({ mode: "default", trustAll: false, sessionAllow: new Set<string>(), rules: config.permissions ?? {}, readOnlyRole: false, workspace: scope.workspace }),
      checkpoint: (toolName, input, executingContext) => {
        checkpointAuthorizedTargets(toolName, input, executingContext);
      },
      preHook: (toolName, input, executingContext) => runPreHooksWithBlocking(toolName, config.hooks, executingContext.workspace, { input: JSON.stringify(input) }),
      postHook: (toolName, input, output, error, executingContext) => runHooks("post", toolName, config.hooks, executingContext.workspace, {
        input: JSON.stringify(input), output: output === undefined ? undefined : JSON.stringify(output), success: error === undefined,
      }),
      event: (event, executingContext) => {
        if (event.phase === "complete" && event.error) {
          runLifecycleHooks("tool_error", config.hooks, executingContext.workspace);
        }
      },
    };
    const mcpConfig = await autoDetectMCPServersForRun(config.mcp || {}, {
      runId,
      workspace: workingDir,
      signal: controller.signal,
    });
    mcpResources.register(mcpConfig);
    await mcpResources.ensureStarted();
    if (controller.signal.aborted) throw new ToolExecutionError("cancelled", "headless run cancelled");
    const aiModel = createModel(provider as AIProvider, model, providerConfig.host, providerConfig.contextLength, providerConfig.apiKey);
    const builtinTools = createToolDefinitions(workingDir, aiModel, requestedSandbox, {
      runId, signal: controller.signal, scope, sandboxCapabilities: config.sandboxCapabilities, executionContext: context,
      onSubAgentUsage: async (childUsage) => {
        costs.recordCall({ callId: childUsage.callId, persona: "child", provider, model, usage: childUsage.usage, usageComplete: childUsage.usageComplete });
      },
    });
    const mcpTools = mcpResources.getToolDefinitions();
    const tools = wrapTools({ ...builtinTools, ...mcpTools }, context, (error) => {
      terminalToolError ??= error;
      controller.abort();
    }, pendingTools);
    let system = "You are WorkerMill, an AI coding agent. Working directory: " + workingDir + "\n";
    const instructions = formatProjectInstructions(workingDir);
    if (instructions) system += instructions;
    const projectContext = formatPromptProjectContext(workingDir);
    if (projectContext) system += projectContext;
    const learnings = loadLearnings();
    if (learnings.length) system += "\n\n## Project Learnings\n" + learnings.map((learning) => "- " + learning).join("\n");
    const mcpKeys = Object.keys(mcpTools);
    if (mcpKeys.length) system += "\n\n## MCP Tools\n\nAdditional MCP servers: " + [...new Set(mcpKeys.map((key) => key.split("__")[1]))].join(", ");
    // SDK gap: streamText's generic tool map cannot represent dynamic MCP tools.
    modelStarted = true;
    const stream = streamText({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK gap documented above.
      model: aiModel, system, messages: messages as any, tools: tools as any, stopWhen: stepCountIs(stepLimit),
      abortSignal: controller.signal, ...buildOllamaOptions(provider as AIProvider, providerConfig.contextLength),
      onStepFinish({ text: stepText, toolCalls: stepCalls, usage: stepUsage }) {
        completedSteps++;
        if (stepText) text += stepText;
        if (stepCalls) toolCalls += stepCalls.length;
        lastStepHadToolCalls = Boolean(stepCalls?.length);
        usage = addUsage(usage, usageFromSdk(stepUsage));
      },
    });
    for await (const _ of stream.textStream) { /* drive stream */ }
    // A transport can finish before a dispatched tool promise settles. Let
    // successful work finish before finalization aborts the owned resources.
    const settledTools = await Promise.allSettled([...pendingTools]);
    const failedTool = settledTools.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failedTool) throw failedTool.reason;
    text = await stream.text;
    const settled = settleUsage(usage, usageFromSdk(await stream.totalUsage));
    usage = settled.usage;
    hasFinalUsage = settled.usageComplete;
    if (terminalToolError) throw terminalToolError;
    if (controller.signal.aborted) throw new ToolExecutionError("cancelled", "headless run cancelled");
    const finishReason = await stream.finishReason;
    if (controller.signal.aborted) throw new ToolExecutionError("cancelled", "headless run cancelled");
    if ((completedSteps >= stepLimit && lastStepHadToolCalls) || finishReason === "tool-calls") {
      result = failure(start, "step_limit", "The configured maximum step count was exhausted", { sessionId: options.singlePrompt ? null : session.id, model: modelIdentity, text, toolCalls });
      return result;
    }
    if (finishReason !== "stop") {
      throw new Error("Model stream ended with non-success finish reason: " + finishReason);
    }
    if (!options.singlePrompt) shouldSaveSession = true;
    result = { status: "ok", exitCode: 0, sessionId: options.singlePrompt ? null : session.id, model: modelIdentity, text, toolCalls, tokens: { input: 0, output: 0 }, costUsd: 0, durationMs: Date.now() - start, usageLedger: costs.getLedgerSnapshot(), usageComplete: true };
    return result;
  } catch (error) {
    const reason = terminalToolError?.code ?? reasonFor(error, controller.signal);
    result = failure(start, reason, error instanceof Error ? error.message : String(error), { sessionId: options.singlePrompt ? null : session?.id ?? null, model: modelIdentity, text, toolCalls });
    return result;
  } finally {
    process.removeListener("SIGINT", abortFromSigint);
    options.signal?.removeEventListener("abort", abortFromParent);
    controller.abort();
    const cleanupErrors: string[] = [];
    // A provider can reject after dispatching a tool. Drain every owned call
    // before returning, but do not relabel the provider failure as a cleanup
    // failure merely because abort correctly rejected an in-flight tool.
    await Promise.allSettled([...pendingTools]);
    if (modelStarted) costs.recordCall({ callId: `headless:${runId}`, persona: "run", provider, model, usage, usageComplete: hasFinalUsage });
    const ledger = costs.getLedgerSnapshot();
    if (result) {
      result.tokens = { input: ledger.totals.inputTokens, output: ledger.totals.outputTokens };
      result.costUsd = ledger.totals.estimatedApiCost;
      result.usageLedger = ledger;
      result.usageComplete = ledger.totals.partialUsageCalls === 0 && ledger.totals.missingUsageCalls === 0;
      result.durationMs = Date.now() - start;
    }
    try {
      await cancelAndWaitForRunProcesses(runId);
    } catch (error) {
      cleanupErrors.push("Process cleanup failed: " + String(error));
    }
    try {
      await cleanupScopedBackgroundProcesses(runId);
    } catch (error) {
      cleanupErrors.push("Background cleanup failed: " + String(error));
    }
    try {
      await mcpResources?.close();
    } catch (error) {
      cleanupErrors.push("MCP cleanup failed: " + String(error));
    }
    try {
      await shutdownLSPRun(runId);
    } catch (error) {
      cleanupErrors.push("LSP cleanup failed: " + String(error));
    }
    if (cleanupErrors.length) {
      return failure(start, "cleanup_error", cleanupErrors.join("; "), {
        sessionId: options.singlePrompt ? null : session?.id ?? null,
        model: modelIdentity, text, toolCalls, tokens: result?.tokens, costUsd: result?.costUsd, usageLedger: ledger, usageComplete: result?.usageComplete,
      });
    }
    if (shouldSaveSession && session) {
      try {
        addMessage(session, "assistant", text);
        session.totalTokens += ledger.totals.inputTokens + ledger.totals.outputTokens;
        session.totalCostUsd = (session.totalCostUsd ?? 0) + ledger.totals.estimatedApiCost;
        session.usageLedger = appendLedger(session.usageLedger, ledger);
        saveSession(session);
      } catch (error) {
        return failure(start, "provider_error", "Unable to save the completed session: " + String(error), {
          sessionId: session.id, model: modelIdentity, text, toolCalls, tokens: result?.tokens, costUsd: result?.costUsd, usageLedger: ledger, usageComplete: result?.usageComplete,
        });
      }
    }
  }
}
