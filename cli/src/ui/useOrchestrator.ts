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

import { useState, useCallback, useRef } from "react";
import type { OrchestrationOutput, RetryPlan } from "../orchestrator.js";
import { resolveConfig, type CliConfig } from "../config.js";
import { getRetryableRun } from "../ship-state.js";

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

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Pending confirmation request surfaced to the UI layer. */
export interface OrchestratorConfirmRequest {
  prompt: string;
  resolve: (yes: boolean, mode?: "always" | "trust") => void;
}

export interface UseOrchestratorReturn {
  /** Whether orchestration is currently running. */
  running: boolean;
  /** Start orchestration for a task. */
  start: (task: string, trustAll: boolean, sandboxed: boolean) => void;
  /** Retry the most recent incomplete run — skips planning, resumes from first incomplete story. Returns false if nothing to retry. */
  retry: (trustAll: boolean, sandboxed: boolean) => boolean;
  /** Cancel the running orchestration. */
  cancel: () => void;
  /** Current status message (replaces ora spinner in the old TUI). */
  statusMessage: string;
  /** Latest build output line (shown in dynamic area). */
  previewLine: string;
  /** Non-null when the orchestrator is waiting for user confirmation. */
  confirmRequest: OrchestratorConfirmRequest | null;
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
  addMessage: (content: string, role?: "user" | "assistant") => void,
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
  const [statusMessage, setStatusMessage] = useState("");
  const [previewLine, setPreviewLine] = useState("");
  const [confirmRequest, setConfirmRequest] =
    useState<OrchestratorConfirmRequest | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const retryPlanRef = useRef<RetryPlan | null>(null);

  // ------------------------------------------------------------------
  // cancel()
  // ------------------------------------------------------------------

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  // ------------------------------------------------------------------
  // start()
  // ------------------------------------------------------------------

  const start = useCallback(
    (task: string, trustAll: boolean, sandboxed: boolean) => {
      // Abort any previous run
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setRunning(true);
      setStatusMessage("");
      setPreviewLine("");
      setConfirmRequest(null);

      // Fire-and-forget async work; errors are caught internally.
      void (async () => {
        // emitLine: commit each line to Static immediately so it renders
        // once and never re-renders. Only the latest line stays in the
        // dynamic area as a preview.
        function emitLine(line: string): void {
          addMessage(line);
          setPreviewLine(line);
        }
        function flushLine(): void {
          setPreviewLine("");
        }

        // ---- Config ------------------------------------------------
        // Use the CLI-resolved config (has --auto-revise etc.) if available,
        // otherwise fall back to loading from disk.  Hoisted above try so
        // `finally` can read `config.bell`.
        const config = cliConfig ?? resolveConfig();

        try {
          if (!config) {
            addMessage(
              "No provider configured. Run `workermill` (setup) first.",
            );
            setRunning(false);
            return;
          }

          // ---- Dynamic import to avoid circular deps -----------------
          const { runOrchestration } = await import(
            "../orchestrator.js"
          );

          // ---- Build the OrchestrationOutput adapter -----------------
          const output: OrchestrationOutput = {
            log(persona: string, message: string): void {
              const emoji = getEmoji(persona);
              const trimmed = message.trim();
              if (trimmed) {
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
              return new Promise((resolve) => {
                setConfirmRequest({
                  prompt,
                  resolve: (yes: boolean, mode?: "always" | "trust") => {
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

            toolCall(
              persona: string,
              toolName: string,
              toolInput: Record<string, unknown>,
            ): void {
              // Build a detail string showing what the tool is doing.
              // Must handle ALL tool input shapes — especially web_search.query
              // and sub_agent.prompt which were previously invisible.
              let detail = "";
              if (toolInput.file_path) {
                detail = String(toolInput.file_path);
              } else if (toolInput.path) {
                detail = String(toolInput.path);
              } else if (toolInput.command) {
                const cmd = String(toolInput.command);
                detail = cmd.length > 120 ? cmd.slice(0, 117) + "..." : cmd;
              } else if (toolInput.query) {
                detail = String(toolInput.query).slice(0, 120);
              } else if (toolInput.prompt) {
                detail = String(toolInput.prompt).slice(0, 120);
              } else if (toolInput.pattern) {
                detail = `pattern: ${String(toolInput.pattern)}`;
              } else if (toolInput.url) {
                detail = String(toolInput.url);
              } else if (toolInput.action) {
                detail = String(toolInput.action);
              } else {
                // Fallback: show first few key=value pairs
                const keys = Object.keys(toolInput).slice(0, 3);
                if (keys.length > 0) {
                  detail = keys.map(k => `${k}: ${String(toolInput[k]).slice(0, 80)}`).join(", ");
                }
              }

              const emoji = getEmoji(persona);
              emitLine(
                `[${emoji} ${persona}] \u{2193} ${toolName}${detail ? " " + detail : ""}`,
              );
              // Update status bar tool counts
              incrementToolCount?.(toolName);
              // Keep status line simple — the tool call is already in the message list
              setStatusMessage(`${persona}: working...`);
            },

            updateBranch(branch: string): void {
              setGitBranch?.(branch);
            },

            updateCost(cost: number): void {
              setCost?.(cost);
            },

            updateTokPerSec(providerModel: string, tokPerSec: number): void {
              setTokPerSec?.(providerModel, tokPerSec);
            },
          };

          // Skip classification — user explicitly invoked /build, so go
          // straight to multi-expert orchestration.

          // ---- Run full orchestration --------------------------------
          const retryPlan = retryPlanRef.current;
          retryPlanRef.current = null;
          await runOrchestration(config, task, trustAll, sandboxed, output, controller.signal, retryPlan ?? undefined);

          flushLine();
          addMessage(retryPlan ? "**Retry complete.**" : "**Orchestration complete.**");
        } catch (err: unknown) {
          flushLine();
          if (controller.signal.aborted) {
            addMessage("**Build cancelled.**");
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            addMessage(`**Orchestration failed:** ${msg}`);
          }
        } finally {
          setRunning(false);
          setStatusMessage("");
          setPreviewLine("");
          setConfirmRequest(null);
          // Beep on build completion (not on cancel) if sound notifications enabled
          if (config.bell && !controller.signal.aborted) {
            process.stdout.write("\x07");
          }
        }
      })();
    },
    [addMessage, cliConfig],
  );

  // ------------------------------------------------------------------
  // retry() — read persisted state, resume from first incomplete story
  // ------------------------------------------------------------------

  const retry = useCallback(
    (trustAll: boolean, sandboxed: boolean): boolean => {
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
  // Return
  // ------------------------------------------------------------------

  return { running, start, retry, cancel, statusMessage, previewLine, confirmRequest };
}
