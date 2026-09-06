/**
 * React hook that drives the WorkerMill multi-expert orchestrator and bridges
 * its output into Ink/React state so the TUI can render it.
 *
 * The orchestrator is invoked via `/build <task>` and fans out work to
 * multiple persona-specific agents (frontend, backend, devops, etc.).
 * This hook translates the `OrchestrationOutput` callback interface into
 * React state updates consumed by the existing `<MessageList>` / `<App>`
 * components.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { OrchestrationOutput, RetryPlan } from "../orchestrator.js";
import { resolveConfig, loadConfig, saveConfig, type CliConfig } from "../config.js";
import { getRetryableRun } from "../ship-state.js";
import { notifyIfEnabled } from "../notify.js";
import { shouldCommitStatusUpdate } from "./orchestrator-status.js";
import { createEmptyUsageSummary, type UsageSummary } from "../cost-tracker.js";
import { execSync } from "child_process";
import { TicketOps } from "../ticket-ops.js";
import { parseProgramEpicsFromIssueBody } from "../program-queue.js";
import { getProgramRun, saveProgramRun, clearProgramRun } from "../program-state.js";
import { execGh, getCurrentBranch } from "../git-ops.js";
import { formatLiveViewUrlMessage } from "../live-view-url.js";
import { runGateCommand } from "../gate-runner.js";
import type { ToolCallInfo } from "./types.js";

const PREVIEW_THROTTLE_MS = 120;
export const SESSION_SUMMARY_DIVIDER = "────────────────────────";

// ---------------------------------------------------------------------------
// Persona emoji map -- EXACT match from tui.ts (PERSONA_EMOJIS)
// Kept inline so this hook has zero runtime dependency on chalk/tui.
// ---------------------------------------------------------------------------

const PERSONA_EMOJIS: Record<string, string> = {
  // Must match worker/epic/experts.ts — no invented personas
  frontend_developer: "\u{1F3A8}",   // 🎨
  backend_developer: "\u{1F4BB}",    // 💻
  devops_engineer: "\u{1F527}",      // 🔧
  security_engineer: "\u{1F512}",    // 🔐
  qa_engineer: "\u{1F9EA}",          // 🧪
  tech_writer: "\u{1F4DD}",          // 📝
  project_manager: "\u{1F4CB}",      // 📋
  architect: "\u{1F3D7}\uFE0F",      // 🏗️
  data_ml_engineer: "\u{1F4CA}",     // 📊
  mobile_developer: "\u{1F4F1}",     // 📱
  tech_lead: "\u{1F451}",            // 👑
  manager: "\u{1F454}",              // 👔
  support_agent: "\u{1F4AC}",        // 💬
  // CLI-specific roles (used by orchestrator, not in worker expert configs)
  planner: "\u{1F4A1}",              // 💡
  coordinator: "\u{1F3AF}",          // 🎯
  critic: "\u{1F50D}",               // 🔍
  reviewer: "\u{1F50D}",             // 🔍
};

function getEmoji(persona: string): string {
  return PERSONA_EMOJIS[persona] || "\u{1F916}"; // 🤖
}

function formatTokenCount(tokens: number): string {
  return tokens.toLocaleString();
}

function formatCost(cost: number): string {
  if (cost <= 0) return "$0.00";
  if (cost < 0.01) return "<$0.01";
  return `~$${cost.toFixed(2)}`;
}

function formatModelBreakdown(summary: UsageSummary): string {
  if (summary.byModel.length === 0) return "";

  const lines: string[] = [];
  // Sort by cost descending so the most expensive model is first
  const sorted = [...summary.byModel].sort((a, b) => b.cost - a.cost);
  for (const model of sorted) {
    if (model.inputTokens <= 0 && model.outputTokens <= 0) continue;
    lines.push(`  ${model.provider}/${model.model}: ${formatTokenCount(model.inputTokens)} in · ${formatTokenCount(model.outputTokens)} out · ${formatCost(model.cost)}`);
  }
  return lines.join("\n");
}

export function addSessionSummaryDivider(
  addMessage: (message: string) => void,
  hasOperationalOutput: boolean,
): void {
  if (!hasOperationalOutput) return;
  addMessage(SESSION_SUMMARY_DIVIDER);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function normalizeGithubIssueRef(input: string): string | null {
  const trimmed = input.trim().replace(/\s+/g, "");
  if (/^#\d+$/.test(trimmed)) return trimmed;
  if (/^GH[-#]?\d+$/i.test(trimmed)) {
    const n = trimmed.replace(/^GH[-#]?/i, "");
    return `#${n}`;
  }
  return null;
}

function ensureGithubEnv(): void {
  if (!process.env.GITHUB_TOKEN) {
    try {
      process.env.GITHUB_TOKEN = execSync("gh auth token 2>/dev/null", {
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
    } catch {
      // best effort
    }
  }
  if (!process.env.GITHUB_REPO) {
    try {
      const remote = execSync("git remote get-url origin 2>/dev/null", {
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
      const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
      if (match) process.env.GITHUB_REPO = match[1].replace(/\.git$/, "");
    } catch {
      // best effort
    }
  }
}

function flattenEpicIssueKeys(epics: { issueKeys: string[] }[]): string[] {
  return epics.flatMap((epic) => epic.issueKeys);
}

function isBalanceOrQuotaErrorMessage(message: string): boolean {
  return /quota|insufficient|credit|balance|billing|rate\s*limit|429/i.test(message);
}

function sameProgramPlan(
  left: { issueKeys: string[] }[],
  right: { issueKeys: string[] }[],
): boolean {
  const a = flattenEpicIssueKeys(left);
  const b = flattenEpicIssueKeys(right);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function describeEditOperation(oldText: string, newText: string): "insert" | "delete" | "replace" | "noop" {
  if (!oldText && newText) return "insert";
  if (oldText && !newText) return "delete";
  if (oldText === newText) return "noop";
  return "replace";
}

function summarizePatch(patchText: string): { files: number; hunks: number; firstTarget: string } {
  const hunks = (patchText.match(/^@@/gm) || []).length;
  const targets = [...patchText.matchAll(/^\+\+\+\s+(?:[ab]\/)?(.+)$/gm)]
    .map((m) => m[1].trim())
    .filter((target) => target && target !== "/dev/null");
  const uniqueTargets = [...new Set(targets)];
  return {
    files: uniqueTargets.length,
    hunks,
    firstTarget: uniqueTargets[0] || "",
  };
}

/** Build a compact, differentiating tool detail so repeated edits are visibly distinct. */
function formatToolCallDetail(
  toolName: string,
  toolInput: Record<string, unknown>,
  nextFileSequence?: (path: string) => number,
): string {
  const filePath = asString(toolInput.file_path) || asString(toolInput.path);
  const nextSeqFor = (path: string): string => {
    if (!nextFileSequence) return "";
    const n = nextFileSequence(path);
    return n > 0 ? `#${n} ` : "";
  };

  if (toolName === "edit_file") {
    const oldText = asString(toolInput.old_string);
    const newText = asString(toolInput.new_string);
    const replaceAll = toolInput.replaceAll === true ? " x*" : "";
    if (oldText || newText) {
      const seq = nextSeqFor(filePath);
      const op = describeEditOperation(oldText, newText);
      const bytes = `${oldText.length}->${newText.length}b`;
      const lines = `${countLines(oldText)}->${countLines(newText)}l`;
      return `${filePath}${filePath ? " " : ""}[${seq}${op} ${bytes} ${lines}${replaceAll}]`;
    }
    if (filePath) return filePath;
  }

  if (toolName === "write_file") {
    const content = asString(toolInput.content);
    if (content) {
      const seq = nextSeqFor(filePath);
      return `${filePath}${filePath ? " " : ""}[${seq}write ${content.length}b ${countLines(content)}l]`;
    }
    if (filePath) return filePath;
  }

  if (toolName === "patch") {
    const patchText = asString(toolInput.patch_text);
    if (patchText) {
      const { files, hunks, firstTarget } = summarizePatch(patchText);
      const target = firstTarget || filePath;
      const seq = target ? nextSeqFor(target) : "";
      return `${target}${target ? " " : ""}[${seq}${files || 1}f ${hunks}h patch]`;
    }
    if (filePath) return filePath;
  }

  // Generic display fallback across all tools.
  if (filePath) return filePath;
  if (toolInput.command) {
    const cmd = String(toolInput.command);
    return cmd.length > 120 ? cmd.slice(0, 117) + "..." : cmd;
  }
  if (toolInput.query) return String(toolInput.query).slice(0, 120);
  if (toolInput.prompt) return String(toolInput.prompt).slice(0, 120);
  if (toolInput.pattern) return `pattern: ${String(toolInput.pattern)}`;
  if (toolInput.url) return String(toolInput.url);
  if (toolInput.action) return String(toolInput.action);

  const keys = Object.keys(toolInput).slice(0, 3);
  if (keys.length > 0) {
    return keys.map(k => `${k}: ${String(toolInput[k]).slice(0, 80)}`).join(", ");
  }
  return "";
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Pending confirmation request surfaced to the UI layer. */
export interface OrchestratorConfirmRequest {
  prompt: string;
  resolve: (yes: boolean, mode?: "always" | "trust") => void;
}

/** Pending free-text prompt request surfaced to the UI layer. */
export interface OrchestratorPromptRequest {
  question: string;
  suggestion: string;
  resolve: (answer: string) => void;
}

export interface OrchestratorRunCompletion {
  success: boolean;
  cancelled?: boolean;
  error?: string;
}

export interface OrchestratorStartOptions {
  onComplete?: (result: OrchestratorRunCompletion) => void;
}

export interface UseOrchestratorReturn {
  /** Whether orchestration is currently running. */
  running: boolean;
  /** Whether orchestration is currently paused. */
  paused: boolean;
  /** Start orchestration for a task. */
  start: (
    task: string,
    trustAll: boolean | (() => boolean),
    sandboxed: boolean | "os",
    ticketKey?: string,
    options?: OrchestratorStartOptions,
  ) => void;
  /** Start full-spec program orchestration from a parent issue. */
  startProgram: (parentIssueRef: string, trustAll: boolean | (() => boolean), sandboxed: boolean | "os") => void;
  /** Retry the most recent incomplete run — skips planning, resumes from first incomplete story. Returns false if nothing to retry. */
  retry: (trustAll: boolean | (() => boolean), sandboxed: boolean | "os") => boolean;
  /** Run a standalone Tech Lead review. Target: "branch", "diff", or "#42" (PR number). */
  review: (trustAll: boolean | (() => boolean), sandboxed: boolean | "os", target?: string) => void;
  /** Pause a running orchestration. */
  pause: () => void;
  /** Resume a paused orchestration. */
  resume: () => void;
  /** Cancel the running orchestration. */
  cancel: () => void;
  /** Current status message (replaces ora spinner in the old TUI). */
  statusMessage: string;
  /** Latest build output line (shown in dynamic area). */
  previewLine: string;
  /** Non-null when the orchestrator is waiting for user confirmation. */
  confirmRequest: OrchestratorConfirmRequest | null;
  /** Non-null when the orchestrator is waiting for a free-text answer. */
  promptRequest: OrchestratorPromptRequest | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Drives the multi-expert orchestrator and funnels all output into the
 * existing Ink message list via `addMessage`.
 *
 * @param addMessage - Callback to push a rendered line into the `<Static>`
 *   message list. Accepts markdown-ish content and an optional role
 *   (defaults to `"assistant"`).
 */
export function useOrchestrator(
  addMessage: (content: string, role?: "user" | "assistant", toolCalls?: ToolCallInfo[]) => void,
  setCost?: (cost: number) => void,
  /** Config with CLI overrides (e.g. --auto-revise) already applied. */
  cliConfig?: CliConfig,
  /** Increment a tool count in the status bar. */
  incrementToolCount?: (toolName: string) => void,
  /** Update the git branch in the status bar. */
  setGitBranch?: (branch: string) => void,
  /** Update tokens-per-second for a model in the status bar. */
  setTokPerSec?: (providerModel: string, tokPerSec: number) => void,
): UseOrchestratorReturn {
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const pauseWaitersRef = useRef<Array<() => void>>([]);
  const [statusMessage, setStatusMessageRaw] = useState("");
  const statusMessageRef = useRef("");
  const lastStatusUpdate = useRef(0);
  const setStatusMessage = useCallback((msg: string) => {
    const now = Date.now();
    const current = statusMessageRef.current;
    if (!shouldCommitStatusUpdate(current, msg, now - lastStatusUpdate.current)) return;
    lastStatusUpdate.current = now;
    statusMessageRef.current = msg;
    setStatusMessageRaw(msg);
  }, []);
  const [previewLine, setPreviewLine] = useState("");
  const previewLineRef = useRef("");
  const pendingPreviewLineRef = useRef<string | null>(null);
  const lastPreviewUpdateRef = useRef(0);
  const previewTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [confirmRequest, setConfirmRequest] =
    useState<OrchestratorConfirmRequest | null>(null);
  const [promptRequest, setPromptRequest] =
    useState<OrchestratorPromptRequest | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const retryPlanRef = useRef<RetryPlan | null>(null);
  const usageSummaryRef = useRef<UsageSummary>(createEmptyUsageSummary());

  const releasePauseWaiters = useCallback(() => {
    if (pauseWaitersRef.current.length === 0) return;
    const waiters = pauseWaitersRef.current.splice(0, pauseWaitersRef.current.length);
    for (const resolve of waiters) resolve();
  }, []);

  const setPausedState = useCallback((next: boolean) => {
    pausedRef.current = next;
    setPaused(next);
  }, []);

  const pause = useCallback(() => {
    if (pausedRef.current) return;
    setPausedState(true);
    setStatusMessage("Paused — run /pause to resume");
  }, [setPausedState, setStatusMessage]);

  const resume = useCallback(() => {
    if (!pausedRef.current) return;
    setPausedState(false);
    setStatusMessage("");
    releasePauseWaiters();
  }, [releasePauseWaiters, setPausedState, setStatusMessage]);

  const waitIfPaused = useCallback(async () => {
    while (pausedRef.current) {
      await new Promise<void>((resolve) => {
        pauseWaitersRef.current.push(resolve);
      });
    }
  }, []);

  const resetUsageSummary = useCallback(() => {
    usageSummaryRef.current = createEmptyUsageSummary();
  }, []);

  const commitUsageSummary = useCallback((summary: UsageSummary) => {
    usageSummaryRef.current = summary;
  }, []);

  const commitPreviewLine = useCallback((line: string) => {
    if (previewLineRef.current === line) return;
    previewLineRef.current = line;
    lastPreviewUpdateRef.current = Date.now();
    setPreviewLine(line);
  }, []);

  const setPreviewLineThrottled = useCallback((line: string) => {
    if (line === previewLineRef.current || line === pendingPreviewLineRef.current) return;
    const now = Date.now();
    const elapsed = now - lastPreviewUpdateRef.current;
    if (elapsed >= PREVIEW_THROTTLE_MS) {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
      pendingPreviewLineRef.current = null;
      commitPreviewLine(line);
      return;
    }

    pendingPreviewLineRef.current = line;
    if (previewTimerRef.current) return;
    previewTimerRef.current = setTimeout(() => {
      previewTimerRef.current = null;
      const pending = pendingPreviewLineRef.current;
      pendingPreviewLineRef.current = null;
      if (pending != null) commitPreviewLine(pending);
    }, PREVIEW_THROTTLE_MS - elapsed);
  }, [commitPreviewLine]);

  const clearPreviewLine = useCallback(() => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    pendingPreviewLineRef.current = null;
    commitPreviewLine("");
  }, [commitPreviewLine]);

  // ------------------------------------------------------------------
  // cancel()
  // ------------------------------------------------------------------

  const cancel = useCallback(() => {
    const controller = abortRef.current;
    // An idle cancel is intentionally a no-op: it must not leave a stale
    // "Cancelling" status after a completed run.
    if (!controller) return;
    controller.abort();
    // If orchestration is waiting on a confirm/prompt promise, resolve it so
    // the async run can unwind instead of keeping the UI in a stale "running" state.
    setConfirmRequest((req) => {
      if (req) req.resolve(false);
      return null;
    });
    setPromptRequest((req) => {
      if (req) req.resolve("");
      return null;
    });
    // Keep the UI busy until the orchestration finalizer drains its owned
    // resources.  Global cleanup here would also kill an independent run.
    setStatusMessage("Cancelling — waiting for active work to stop...");
    setPausedState(false);
    releasePauseWaiters();
  }, [releasePauseWaiters, setPausedState, setStatusMessage]);

  useEffect(() => () => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    const controller = abortRef.current;
    if (!controller) return;
    controller.abort();
    setConfirmRequest((request) => {
      request?.resolve(false);
      return null;
    });
    setPromptRequest((request) => {
      request?.resolve("");
      return null;
    });
    setPausedState(false);
    releasePauseWaiters();
  }, [releasePauseWaiters, setPausedState]);

  // ------------------------------------------------------------------
  // start()
  // ------------------------------------------------------------------

  const start = useCallback(
    (
      task: string,
      trustAll: boolean | (() => boolean),
      sandboxed: boolean | "os",
      ticketKey?: string,
      options?: OrchestratorStartOptions,
    ) => {
      // Claim synchronously. React state has not necessarily rendered yet,
      // so `running` cannot prevent two same-tick starts from overlapping.
      if (abortRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;

      setRunning(true);
      setPausedState(false);
      setStatusMessage("");
      clearPreviewLine();
      setConfirmRequest(null);
      resetUsageSummary();

      // Fire-and-forget async work; errors are caught internally.
      void (async () => {
        let hasOperationalOutput = false;
        let completion: OrchestratorRunCompletion = { success: false };
        // emitLine: commit each line to Static immediately so it renders
        // once and never re-renders. Only the latest line stays in the
        // dynamic area as a preview.
        function emitLine(line: string): void {
          const normalized = line.replace(/\r\n/g, "\n").replace(/\n+$/g, "");
          hasOperationalOutput = true;
          addMessage(normalized);
          setPreviewLineThrottled(normalized);
        }
        function flushLine(): void {
          clearPreviewLine();
        }

        // ---- Config ------------------------------------------------
        // Always reload from disk so /settings changes take effect
        // without restarting the CLI. CLI flags (--auto-revise etc.)
        // are preserved by merging from the startup config.
        const freshConfig = resolveConfig();
        const config = freshConfig
          ? {
              ...freshConfig,
              review: {
                ...freshConfig.review,
                // Preserve --auto-revise CLI flag if it was set at startup
                ...(cliConfig?.review?.autoRevise ? { autoRevise: true } : {}),
              },
              // Preserve --live-view / --no-live-view CLI flag if it was set at startup
              ...(cliConfig?.liveView !== undefined ? { liveView: cliConfig.liveView } : {}),
            }
          : cliConfig ?? null;

        try {
          if (!config) {
            addMessage(
              "No provider configured. Run `workermill` (setup) first.",
            );
            setRunning(false);
            return;
          }

          // ---- Create live view server if enabled -------------------
          let liveViewServer: import("../live-view-server.js").LiveViewServer | undefined;
          if (config.liveView === true || config.liveView === "auto") {
            const { createLiveViewServer } = await import("../live-view-server.js");
            const mainBranch = getCurrentBranch(process.cwd()); // from git-ops
            liveViewServer = createLiveViewServer(process.cwd(), mainBranch || "main");
            emitLine(formatLiveViewUrlMessage(liveViewServer.port));
          }

          // ---- Dynamic import to avoid circular deps -----------------
          const { runOrchestration } = await import(
            "../orchestrator.js"
          );

          // Track completion stats for summary
          const seenPersonas = new Set<string>();
          let storiesCompleted = 0;
          const startTime = Date.now();
          const fileSequences = new Map<string, number>();
          const nextFileSequence = (path: string): number => {
            if (!path) return 0;
            const next = (fileSequences.get(path) || 0) + 1;
            fileSequences.set(path, next);
            return next;
          };

          // ---- Build the OrchestrationOutput adapter -----------------
          const output: OrchestrationOutput = {
            log(persona: string, message: string): void {
              const emoji = getEmoji(persona);
              const trimmed = message.trim();
              if (trimmed) {
                seenPersonas.add(persona);
                if (trimmed.includes("— completed!")) storiesCompleted++;
                emitLine(`[${emoji} ${persona}] ${trimmed}`);
              }
            },

            coordinatorLog(message: string): void {
              emitLine(`[${getEmoji("coordinator")} coordinator] ${message}`);
            },

            error(message: string): void {
              emitLine(`**Error:** ${message}`);
            },

            status(message: string): void {
              setStatusMessage(message);
            },

            statusDone(message?: string): void {
              if (message) {
                emitLine(message);
              }
              setStatusMessage("");
            },

            confirm(prompt: string): Promise<boolean | { allowed: boolean; mode?: "always" | "trust" }> {
              // Always show user decision prompts — bypass mode only applies
              // to tool permissions, not orchestrator decisions like revisions.
              if (controller.signal.aborted || abortRef.current !== controller) return Promise.resolve(false);
              return new Promise((resolve) => {
                setConfirmRequest({
                  prompt,
                  resolve: (yes: boolean, mode?: "always" | "trust") => {
                    if (abortRef.current !== controller) return;
                    setConfirmRequest(null);
                    if (mode) {
                      resolve({ allowed: yes, mode });
                    } else {
                      resolve(yes);
                    }
                  },
                });
              });
            },

            askText(question: string, suggestion: string): Promise<string> {
              if (controller.signal.aborted || abortRef.current !== controller) return Promise.resolve("");
              return new Promise((resolve) => {
                setPromptRequest({
                  question,
                  suggestion,
                  resolve: (answer: string) => {
                    if (abortRef.current !== controller) return;
                    setPromptRequest(null);
                    resolve(answer || suggestion);
                  },
                });
              });
            },

            toolCall(
              persona: string,
              toolName: string,
              toolInput: Record<string, unknown>,
            ): void {
              const detail = formatToolCallDetail(toolName, toolInput, nextFileSequence);

              const emoji = getEmoji(persona);
              emitLine(
                `[${emoji} ${persona}] \u{2193} ${toolName}${detail ? " " + detail : ""}`,
              );
              // Update status bar tool counts
              incrementToolCount?.(toolName);
              if (["edit_file", "write_file", "patch", "multi_edit_file"].includes(toolName)) {
                const toolCall: ToolCallInfo = {
                  id: `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  name: toolName,
                  input: toolInput,
                  status: "done",
                };
                addMessage("", "assistant", [toolCall]);
              }
            },

            updateBranch(branch: string): void {
              setGitBranch?.(branch);
            },

            updateCost(cost: number): void {
              setCost?.(cost);
            },

            updateUsageSummary(summary: UsageSummary): void {
              commitUsageSummary(summary);
            },

            updateTokPerSec(providerModel: string, tokPerSec: number): void {
              setTokPerSec?.(providerModel, tokPerSec);
            },

            waitIfPaused: async (): Promise<void> => {
              await waitIfPaused();
            },

            requestPause: async (): Promise<void> => {
              pause();
              await waitIfPaused();
            },
          };

          // Skip classification — user explicitly invoked /build, so go
          // straight to multi-expert orchestration.

          // ---- Run full orchestration --------------------------------
          const retryPlan = retryPlanRef.current;
          retryPlanRef.current = null;
          const result = await runOrchestration(
            config,
            task,
            trustAll,
            sandboxed,
            output,
            controller,
            retryPlan ?? undefined,
            ticketKey,
            liveViewServer,
          );
          completion = {
            success:
              result.stories.length > 0 &&
              result.completedStoryIds.length === result.stories.length,
            error:
              result.stories.length > 0 &&
              result.completedStoryIds.length !== result.stories.length
                ? "build_incomplete"
                : undefined,
          };

          flushLine();
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const mins = Math.floor(elapsed / 60);
          const secs = elapsed % 60;
          const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
          const parts: string[] = [];
          if (storiesCompleted > 0) parts.push(`${storiesCompleted} ${storiesCompleted === 1 ? "story" : "stories"}`);
          parts.push(timeStr);
          parts.push(formatCost(usageSummaryRef.current.total.cost));
          addSessionSummaryDivider(addMessage, hasOperationalOutput);
          addMessage(`**Shipped.** ${parts.join(" · ")}`);
          const modelBreakdown = formatModelBreakdown(usageSummaryRef.current);
          if (modelBreakdown) {
            addMessage(modelBreakdown);
          }
          notifyIfEnabled(config.bell, "WorkerMill", "Ship complete");
        } catch (err: unknown) {
          flushLine();
          if (controller.signal.aborted) {
            addMessage("**Build cancelled.**");
            completion = { success: false, cancelled: true, error: "cancelled" };
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            addMessage(`**Orchestration failed:** ${msg}`);
            completion = { success: false, error: msg };
            notifyIfEnabled(config?.bell, "WorkerMill", "Ship failed");
          }
        } finally {
          if (abortRef.current !== controller) return;
          abortRef.current = null;
          setRunning(false);
          setPausedState(false);
          setStatusMessage("");
          clearPreviewLine();
          setConfirmRequest(null);
          releasePauseWaiters();
          try {
            options?.onComplete?.(completion);
          } catch {
            // Completion callbacks are best-effort and should never crash the orchestrator.
          }
        }
      })();
    },
    [addMessage, clearPreviewLine, cliConfig, commitUsageSummary, incrementToolCount, pause, releasePauseWaiters, resetUsageSummary, setCost, setGitBranch, setPausedState, setPreviewLineThrottled, setStatusMessage, setTokPerSec, waitIfPaused],
  );

  // ------------------------------------------------------------------
  // startProgram() — full-spec orchestration across epic child issues
  // ------------------------------------------------------------------

  const startProgram = useCallback(
    (parentIssueRef: string, trustAll: boolean | (() => boolean), sandboxed: boolean | "os") => {
      if (abortRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;

      setRunning(true);
      setPausedState(false);
      setStatusMessage("");
      clearPreviewLine();
      setConfirmRequest(null);
      resetUsageSummary();

      void (async () => {
        let hasOperationalOutput = false;
        function emitLine(line: string): void {
          const normalized = line.replace(/\r\n/g, "\n").replace(/\n+$/g, "");
          hasOperationalOutput = true;
          addMessage(normalized);
          setPreviewLineThrottled(normalized);
        }
        function flushLine(): void {
          clearPreviewLine();
        }

        const freshConfig = resolveConfig();
        const config = freshConfig
          ? {
              ...freshConfig,
              review: {
                ...freshConfig.review,
                ...(cliConfig?.review?.autoRevise ? { autoRevise: true } : {}),
              },
            }
          : cliConfig ?? null;

        try {
          if (!config) {
            addMessage("No provider configured. Run `workermill` (setup) first.");
            setRunning(false);
            return;
          }

          const normalizedParent = normalizeGithubIssueRef(parentIssueRef);
          if (!normalizedParent) {
            addMessage("`/orchestrate` expects a GitHub parent issue reference like `#123`.");
            return;
          }

          ensureGithubEnv();
          const parentOps = new TicketOps(normalizedParent, "github");
          if (!parentOps.isAvailable()) {
            addMessage("GitHub auth/repo not available. Run `gh auth login` and ensure git remote points to GitHub.");
            return;
          }

          const parent = await parentOps.fetchTicket();
          if (!parent) {
            addMessage(`Could not fetch parent issue ${normalizedParent}.`);
            return;
          }

          const workingDir = process.cwd();
          const maxIssues = Math.max(1, config.program?.maxIssues ?? config.program?.maxSubIssues ?? 25);
          const maxAutoRetries = Math.max(0, config.program?.maxAutoRetries ?? 1);
          const gateMode = config.program?.gateMode ?? "advisory";
          const programGates = (config.program?.gates || []).map((g) => g.trim()).filter(Boolean);

          let epics = parseProgramEpicsFromIssueBody(parent.body || "");
          if (epics.length === 0) {
            emitLine(`[${getEmoji("planner")} planner] No child issues found in ${normalizedParent} — decomposing parent issue into sub-issues...`);
            const { decomposeParentIssue, materializeProgramSubIssues } = await import("../program-bootstrap.js");
            const decomposition = await decomposeParentIssue(
              config,
              parent,
              (msg) => emitLine(`[${getEmoji("system")} system] ${msg}`),
            );

            const decomposedCount = decomposition.cards.length;
            if (decomposedCount > maxIssues) {
              addMessage(`Program aborted: decomposition produced ${decomposedCount} issues (max ${maxIssues}). Raise \`program.maxIssues\` or narrow the parent issue scope.`);
              return;
            }
            const generated = await materializeProgramSubIssues(
              config,
              normalizedParent,
              parent,
              (msg) => emitLine(`[${getEmoji("system")} system] ${msg}`),
              decomposition,
            );
            epics = generated.epics;
            if (epics.length === 0) {
              addMessage(`Program decomposition did not produce child issues for ${normalizedParent}.`);
              return;
            }
            addMessage(`Generated ${generated.createdIssueKeys.length} child issue(s): ${generated.createdIssueKeys.join(", ")}`);
          }

          const totalIssues = epics.reduce((sum, e) => sum + e.issueKeys.length, 0);
          if (totalIssues <= 0) {
            addMessage(`Program aborted: no executable issues were found for ${normalizedParent}.`);
            return;
          }
          if (totalIssues > maxIssues) {
            addMessage(`Program aborted: ${totalIssues} sub-issues exceeds \`program.maxIssues=${maxIssues}\`.`);
            return;
          }

          let completedIssueKeys: string[] = [];
          const existingRun = getProgramRun(workingDir, normalizedParent);
          if (existingRun && existingRun.status !== "complete") {
            if (sameProgramPlan(existingRun.epics, epics)) {
              completedIssueKeys = [...existingRun.completedIssueKeys];
              if (completedIssueKeys.length > 0) {
                emitLine(`[${getEmoji("system")} system] Resuming /orchestrate: ${completedIssueKeys.length}/${totalIssues} issue(s) already complete.`);
              }
            } else {
              emitLine(`[${getEmoji("system")} system] Existing program state did not match current plan; resetting saved state.`);
              clearProgramRun(workingDir, normalizedParent);
            }
          }

          addMessage(`Starting /orchestrate from ${normalizedParent}: ${epics.length} epic(s), ${totalIssues} sub-issue(s).`);

          const { runOrchestration } = await import("../orchestrator.js");

          const seenPersonas = new Set<string>();
          let storiesCompleted = 0;
          let shippedIssues = completedIssueKeys.length;
          let cursorEpicIndex = 0;
          let cursorIssueIndex = 0;
          const startTime = Date.now();
          const fileSequences = new Map<string, number>();
          const nextFileSequence = (path: string): number => {
            if (!path) return 0;
            const next = (fileSequences.get(path) || 0) + 1;
            fileSequences.set(path, next);
            return next;
          };

          const output: OrchestrationOutput = {
            log(persona: string, message: string): void {
              const emoji = getEmoji(persona);
              const trimmed = message.trim();
              if (trimmed) {
                seenPersonas.add(persona);
                if (trimmed.includes("— completed!")) storiesCompleted++;
                emitLine(`[${emoji} ${persona}] ${trimmed}`);
              }
            },
            coordinatorLog(message: string): void {
              emitLine(`[${getEmoji("coordinator")} coordinator] ${message}`);
            },
            error(message: string): void {
              emitLine(`**Error:** ${message}`);
            },
            status(message: string): void {
              setStatusMessage(message);
            },
            statusDone(message?: string): void {
              if (message) emitLine(message);
              setStatusMessage("");
            },
            confirm(prompt: string): Promise<boolean | { allowed: boolean; mode?: "always" | "trust" }> {
              if (controller.signal.aborted || abortRef.current !== controller) return Promise.resolve(false);
              return new Promise((resolve) => {
                setConfirmRequest({
                  prompt,
                  resolve: (yes: boolean, mode?: "always" | "trust") => {
                    if (abortRef.current !== controller) return;
                    setConfirmRequest(null);
                    if (mode) resolve({ allowed: yes, mode });
                    else resolve(yes);
                  },
                });
              });
            },
            askText(question: string, suggestion: string): Promise<string> {
              if (controller.signal.aborted || abortRef.current !== controller) return Promise.resolve("");
              return new Promise((resolve) => {
                setPromptRequest({
                  question,
                  suggestion,
                  resolve: (answer: string) => {
                    if (abortRef.current !== controller) return;
                    setPromptRequest(null);
                    resolve(answer || suggestion);
                  },
                });
              });
            },
            toolCall(persona: string, toolName: string, toolInput: Record<string, unknown>): void {
              const detail = formatToolCallDetail(toolName, toolInput, nextFileSequence);
              const emoji = getEmoji(persona);
              emitLine(`[${emoji} ${persona}] \u{2193} ${toolName}${detail ? " " + detail : ""}`);
              incrementToolCount?.(toolName);
            },
            updateBranch(branch: string): void {
              setGitBranch?.(branch);
            },
            updateCost(cost: number): void {
              setCost?.(cost);
            },
            updateUsageSummary(summary: UsageSummary): void {
              commitUsageSummary(summary);
            },
            updateTokPerSec(providerModel: string, tokPerSec: number): void {
              setTokPerSec?.(providerModel, tokPerSec);
            },
            waitIfPaused: async (): Promise<void> => {
              await waitIfPaused();
            },
            requestPause: async (): Promise<void> => {
              pause();
              await waitIfPaused();
            },
          };

          let alwaysEpics = false;

          const persistProgramState = (
            status: "running" | "paused" | "complete",
            failureCode?: string,
            failureMessage?: string,
          ): void => {
            saveProgramRun({
              workingDir,
              parentIssueRef: normalizedParent,
              parentTitle: parent.title,
              epics,
              completedIssueKeys,
              currentEpicIndex: cursorEpicIndex,
              currentIssueIndex: cursorIssueIndex,
              status,
              lastFailureCode: failureCode,
              lastFailureMessage: failureMessage,
              updatedAt: "",
            });
          };

          const runProgramGatesForEpic = async (epicTitle: string): Promise<boolean> => {
            if (programGates.length === 0) return true;
            emitLine(`[${getEmoji("system")} system] Running program gates after epic "${epicTitle}" (${gateMode})...`);
            for (const gate of programGates) {
              try {
                await runGateCommand(gate, workingDir, 300_000);
                emitLine(`[${getEmoji("system")} system] Gate passed: \`${gate}\``);
              } catch (error: unknown) {
                const raw = error as { stdout?: string; stderr?: string; message?: string };
                const detail = [raw.stdout, raw.stderr, raw.message].filter(Boolean).join("\n").trim();
                const condensed = detail ? detail.slice(0, 280) : "no output";
                emitLine(`[${getEmoji("system")} system] Gate failed: \`${gate}\` (${condensed})`);
                if (gateMode === "required") return false;
              }
            }
            return true;
          };

          persistProgramState("running");

          for (let e = 0; e < epics.length; e++) {
            const epic = epics[e];
            emitLine(`[${getEmoji("planner")} planner] Program epic ${e + 1}/${epics.length}: ${epic.title} (${epic.issueKeys.length} issues)`);

            for (let i = 0; i < epic.issueKeys.length; i++) {
              cursorEpicIndex = e;
              cursorIssueIndex = i;
              if (controller.signal.aborted) {
                addMessage("Program cancelled.");
                return;
              }
              const issueKey = epic.issueKeys[i];
              if (completedIssueKeys.includes(issueKey)) {
                emitLine(`[${getEmoji("system")} system] Skipping completed issue: ${issueKey}`);
                continue;
              }

              persistProgramState("running");
              emitLine(`[${getEmoji("coordinator")} coordinator] Program issue ${i + 1}/${epic.issueKeys.length}: /build ${issueKey}`);

              let result = await runOrchestration(
                config,
                issueKey,
                trustAll,
                sandboxed,
                output,
                controller,
                undefined,
                issueKey,
              );

              const isComplete = () =>
                result.stories.length > 0 &&
                result.completedStoryIds.length === result.stories.length;

              // Program retry delegates to /build's retry path via RetryPlan.
              let retryAttempt = 0;
              while (
                !isComplete() &&
                retryAttempt < maxAutoRetries &&
                result.featureBranch &&
                result.mainBranch
              ) {
                retryAttempt += 1;
                const retryPlan: RetryPlan = {
                  stories: result.stories,
                  completedStoryIds: [...result.completedStoryIds],
                  featureBranch: result.featureBranch,
                  mainBranch: result.mainBranch,
                };
                emitLine(`[${getEmoji("system")} system] Program auto-retry ${retryAttempt}/${maxAutoRetries}: ${issueKey}`);
                result = await runOrchestration(
                  config,
                  result.userTask,
                  trustAll,
                  sandboxed,
                  output,
                  controller,
                  retryPlan,
                  issueKey,
                );
              }

              if (!isComplete()) {
                persistProgramState("paused", "build_incomplete", `Issue ${issueKey} incomplete after ${maxAutoRetries} auto-retr${maxAutoRetries === 1 ? "y" : "ies"}.`);
                addMessage(`Program paused: ${issueKey} did not complete after retry. Resolve and re-run \`/orchestrate ${normalizedParent}\`.`);
                return;
              }

              completedIssueKeys.push(issueKey);
              shippedIssues++;
              persistProgramState("running");
            }

            const gatesPassed = await runProgramGatesForEpic(epic.title);
            if (!gatesPassed) {
              persistProgramState("paused", "gate_failed", `Program gate failed after epic "${epic.title}".`);
              addMessage(`Program paused: required program gate failed after epic "${epic.title}".`);
              return;
            }

            if (e < epics.length - 1 && !alwaysEpics) {
              const nextEpic = epics[e + 1];
              const rv = await output.confirm(`Continue to next epic "${nextEpic.title}"?`);
              let allowed = false;
              if (typeof rv === "object") {
                allowed = rv.allowed;
                if (rv.mode === "always" && allowed) {
                  alwaysEpics = true;
                }
              } else {
                allowed = rv;
              }
              if (!allowed) {
                persistProgramState("paused", "epic_prompt_declined", `Paused before epic "${nextEpic.title}".`);
                addMessage("Program paused at epic boundary.");
                return;
              }
            }
          }

          clearProgramRun(workingDir, normalizedParent);

          flushLine();
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const mins = Math.floor(elapsed / 60);
          const secs = elapsed % 60;
          const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
          const parts: string[] = [];
          if (seenPersonas.size > 0) parts.push(`${seenPersonas.size} expert${seenPersonas.size === 1 ? "" : "s"}`);
          if (storiesCompleted > 0) parts.push(`${storiesCompleted} ${storiesCompleted === 1 ? "story" : "stories"} shipped`);
          parts.push(`${shippedIssues} issue${shippedIssues === 1 ? "" : "s"}`);
          parts.push(timeStr);
          addSessionSummaryDivider(addMessage, hasOperationalOutput);
          addMessage(`**Program complete.** ${parts.join(" · ")}`);
          const usageSummaryMessage = formatModelBreakdown(usageSummaryRef.current);
          if (usageSummaryMessage) addMessage(usageSummaryMessage);
          notifyIfEnabled(config.bell, "WorkerMill", "Program complete");
        } catch (err: unknown) {
          flushLine();
          if (controller.signal.aborted) {
            addMessage("**Program cancelled.**");
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            const failureCode = isBalanceOrQuotaErrorMessage(msg) ? "quota_or_balance" : "program_error";
            try {
              saveProgramRun({
                workingDir: process.cwd(),
                parentIssueRef: normalizeGithubIssueRef(parentIssueRef) || parentIssueRef,
                parentTitle: parentIssueRef,
                epics: [],
                completedIssueKeys: [],
                currentEpicIndex: 0,
                currentIssueIndex: 0,
                status: "paused",
                lastFailureCode: failureCode,
                lastFailureMessage: msg,
                updatedAt: "",
              });
            } catch {
              // best effort persistence
            }
            addMessage(`**Program failed:** ${msg}`);
          }
        } finally {
          if (abortRef.current !== controller) return;
          abortRef.current = null;
          setRunning(false);
          setPausedState(false);
          setStatusMessage("");
          clearPreviewLine();
          setConfirmRequest(null);
          releasePauseWaiters();
        }
      })();
    },
    [addMessage, clearPreviewLine, cliConfig, commitUsageSummary, incrementToolCount, pause, releasePauseWaiters, resetUsageSummary, setCost, setGitBranch, setPausedState, setPreviewLineThrottled, setStatusMessage, setTokPerSec, waitIfPaused],
  );

  // ------------------------------------------------------------------
  // retry() — read persisted state, resume from first incomplete story
  // ------------------------------------------------------------------

  const retry = useCallback(
    (trustAll: boolean | (() => boolean), sandboxed: boolean | "os"): boolean => {
      const run = getRetryableRun(process.cwd());
      if (!run) return false;

      const retryPlan: RetryPlan = {
        stories: run.stories,
        completedStoryIds: [...run.completedStoryIds],
        featureBranch: run.featureBranch,
        mainBranch: run.mainBranch,
      };

      // Reuse start() — pass retryPlan via the task string (parsed in the async body)
      // Actually, we need to thread retryPlan through. Store it in a ref for the start callback.
      retryPlanRef.current = retryPlan;
      start(run.userTask, trustAll, sandboxed);
      return true;
    },
    [start],
  );

  // ------------------------------------------------------------------
  // review() — standalone Tech Lead review
  // ------------------------------------------------------------------

  const review = useCallback(
    (trustAll: boolean | (() => boolean), sandboxed: boolean | "os", target?: string) => {
      if (abortRef.current) return;
      setRunning(true);
      setPausedState(false);
      setStatusMessage("Reviewing...");
      resetUsageSummary();

      const controller = new AbortController();
      abortRef.current = controller;

      (async () => {
        let hasOperationalOutput = false;
        function emitLine(line: string): void {
          const normalized = line.replace(/\r\n/g, "\n").replace(/\n+$/g, "");
          hasOperationalOutput = true;
          addMessage(normalized);
          setPreviewLineThrottled(normalized);
        }
        function flushLine(): void {
          clearPreviewLine();
        }

        const freshReviewConfig = resolveConfig();
        const config = freshReviewConfig
          ? {
              ...freshReviewConfig,
              review: {
                ...freshReviewConfig.review,
                ...(cliConfig?.review?.autoRevise ? { autoRevise: true } : {}),
              },
            }
          : cliConfig ?? null;
        if (!config) {
          addMessage("No provider configured. Run `workermill` (setup) first.");
          setRunning(false);
          return;
        }

        try {
          const { runStandaloneReview } = await import("../orchestrator.js");

          const seenPersonas = new Set<string>();
          const startTime = Date.now();
          const fileSequences = new Map<string, number>();
          const nextFileSequence = (path: string): number => {
            if (!path) return 0;
            const next = (fileSequences.get(path) || 0) + 1;
            fileSequences.set(path, next);
            return next;
          };

          const output: OrchestrationOutput = {
            log(persona: string, message: string): void {
              const emoji = getEmoji(persona);
              const trimmed = message.trim();
              if (trimmed) {
                seenPersonas.add(persona);
                emitLine(`[${emoji} ${persona}] ${trimmed}`);
              }
            },
            coordinatorLog(message: string): void {
              emitLine(`[🎯 coordinator] ${message}`);
            },
            toolCall(persona: string, toolName: string, input: Record<string, unknown>): void {
              const emoji = getEmoji(persona);
              const detail = formatToolCallDetail(toolName, input, nextFileSequence);
              emitLine(`[${emoji} ${persona}] ↓ ${toolName}${detail ? ` ${detail}` : ""}`);
              incrementToolCount?.(toolName);
              if (["edit_file", "write_file", "patch"].includes(toolName)) {
                const toolCall: ToolCallInfo = {
                  id: `orch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  name: toolName,
                  input,
                  status: "done",
                };
                addMessage("", "assistant", [toolCall]);
              }
            },
            error(message: string): void { emitLine(`Error: ${message}`); },
            status(msg: string): void { setStatusMessage(msg); },
            statusDone(): void { setStatusMessage(""); },
            confirm: async (prompt: string) => {
              if (controller.signal.aborted || abortRef.current !== controller) return false;
              return new Promise<boolean>((resolve) => {
                setConfirmRequest({
                  prompt,
                  resolve: (yes: boolean) => {
                    if (abortRef.current !== controller) return;
                    setConfirmRequest(null);
                    resolve(yes);
                  },
                });
              });
            },
            updateCost(cost: number): void {
              setCost?.(cost);
            },
            updateUsageSummary(summary: UsageSummary): void {
              commitUsageSummary(summary);
            },
            updateTokPerSec(providerModel: string, tokPerSec: number): void {
              setTokPerSec?.(providerModel, tokPerSec);
            },
            updateBranch: undefined,
            waitIfPaused: async (): Promise<void> => {
              await waitIfPaused();
            },
            requestPause: async (): Promise<void> => {
              pause();
              await waitIfPaused();
            },
          };

          const result = await runStandaloneReview(config, output, target, controller.signal);

          flushLine();

          if (result) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const mins = Math.floor(elapsed / 60);
            const secs = elapsed % 60;
            const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
            addSessionSummaryDivider(addMessage, hasOperationalOutput);

            if (result.decision === "approved") {
              addMessage(`**Review complete.** Score: ${result.score}/10 · ${timeStr}`);
            } else {
              addMessage(`**Review complete.** Score: ${result.score}/10 · ${timeStr}`);

              // Ask user if they want to create an issue and fix
              const shouldFix = await output.confirm(
                "Create a GitHub issue with these findings and fix them?"
              );
              const yes = typeof shouldFix === "boolean" ? shouldFix : shouldFix?.allowed;

              if (yes) {
                // Create GH issue from review feedback
                const { execSync } = await import("child_process");

                // Build a useful title from context
                let reviewSubject = "";
                try {
                  const branch = execSync("git branch --show-current 2>/dev/null", { encoding: "utf-8", stdio: "pipe" }).trim();
                  if (branch && branch !== "main" && branch !== "master") {
                    // Use branch name, cleaned up: GH-1/full-stack-task → Full stack task
                    reviewSubject = branch.replace(/^[^/]+\//, "").replace(/-/g, " ").replace(/^\w/, c => c.toUpperCase());
                  }
                } catch { /* not a git repo */ }
                if (!reviewSubject) {
                  try {
                    const remote = execSync("git remote get-url origin 2>/dev/null", { encoding: "utf-8", stdio: "pipe" }).trim();
                    const match = remote.match(/[/:]([^/]+?)(?:\.git)?$/);
                    if (match) reviewSubject = match[1];
                  } catch { /* no remote */ }
                }
                if (!reviewSubject) reviewSubject = "codebase";

                // Extract first concrete issue from feedback for the title
                const firstIssue = result.feedback.split("\n").find(l => /^\d+\.|^-|^\*/.test(l.trim()));
                const issueSummary = firstIssue
                  ? firstIssue.replace(/^\d+\.\s*|^[-*]\s*/, "").replace(/\*\*/g, "").slice(0, 60).trim()
                  : "quality improvements";

                const issueTitle = `[Review] ${reviewSubject}: ${issueSummary}`;
                const issueBody = `## Tech Lead Review\n\n**Score:** ${result.score}/10\n**Decision:** ${result.decision}\n\n${result.feedback}\n\n---\n*Created by [WorkerMill CLI](https://workermill.com) /review*`;

                try {
                  const issueUrl = execGh(
                    ["issue", "create", "--title", issueTitle, "--body-file", "-"],
                    { cwd: process.cwd(), input: issueBody, timeout: 15_000 },
                  );
                  // Extract issue number from URL
                  const issueMatch = issueUrl.match(/\/issues\/(\d+)/);
                  const issueNumber = issueMatch ? `#${issueMatch[1]}` : null;

                  if (issueNumber) {
                    emitLine(`[🎯 coordinator] Created issue ${issueNumber}: ${issueTitle}`);
                    emitLine(`[🎯 coordinator] ${issueUrl}`);
                    flushLine();

                    // Kick off /build with the new issue
                    setRunning(false);
                    start(`Fix code review findings from ${issueNumber}`, trustAll, sandboxed, issueNumber);
                    return; // start() takes over — skip the finally block's setRunning(false)
                  } else {
                    emitLine(`[🎯 coordinator] Issue created: ${issueUrl}`);
                    addMessage("Issue created but couldn't parse the number. Run `/build` manually with the issue number.");
                  }
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  emitLine(`[🎯 coordinator] Failed to create issue: ${msg}`);
                  addMessage(`Could not create GitHub issue. You can fix manually or run \`/build\` with the review feedback.`);
                }
              }
            }
            const usageSummaryMessage = formatModelBreakdown(usageSummaryRef.current);
            if (usageSummaryMessage) {
              addMessage(usageSummaryMessage);
            }
          }
        } catch (err: unknown) {
          flushLine();
          if (controller.signal.aborted) {
            addMessage("**Review cancelled.**");
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            addMessage(`**Review failed:** ${msg}`);
          }
        } finally {
          if (abortRef.current !== controller) return;
          abortRef.current = null;
          setRunning(false);
          setPausedState(false);
          setStatusMessage("");
          clearPreviewLine();
          setConfirmRequest(null);
          releasePauseWaiters();
        }
      })();
    },
    [addMessage, clearPreviewLine, cliConfig, commitUsageSummary, incrementToolCount, pause, releasePauseWaiters, resetUsageSummary, running, setPausedState, setPreviewLineThrottled, setStatusMessage, setCost, setTokPerSec, start, waitIfPaused],
  );

  // ------------------------------------------------------------------
  // Return
  // ------------------------------------------------------------------

  return { running, paused, start, startProgram, retry, review, pause, resume, cancel, statusMessage, previewLine, confirmRequest, promptRequest };
}
