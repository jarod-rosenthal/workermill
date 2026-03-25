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
import type { OrchestrationOutput } from "../orchestrator.js";
import { loadConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Persona emoji map -- EXACT match from tui.ts (PERSONA_EMOJIS)
// Kept inline so this hook has zero runtime dependency on chalk/tui.
// ---------------------------------------------------------------------------

const PERSONA_EMOJIS: Record<string, string> = {
  frontend_developer: "\u{1F3A8}",   // 🎨
  backend_developer: "\u{1F4BB}",    // 💻
  fullstack_developer: "\u{1F4BB}",  // 💻
  devops_engineer: "\u{1F527}",      // 🔧
  security_engineer: "\u{1F512}",    // 🔐
  qa_engineer: "\u{1F9EA}",          // 🧪
  tech_writer: "\u{1F4DD}",          // 📝
  project_manager: "\u{1F4CB}",      // 📋
  architect: "\u{1F3D7}\uFE0F",      // 🏗️
  database_engineer: "\u{1F4CA}",    // 📊
  data_engineer: "\u{1F4CA}",        // 📊
  data_ml_engineer: "\u{1F4CA}",     // 📊
  ml_engineer: "\u{1F4CA}",          // 📊
  mobile_developer: "\u{1F4F1}",     // 📱
  tech_lead: "\u{1F451}",            // 👑
  manager: "\u{1F454}",              // 👔
  support_agent: "\u{1F4AC}",        // 💬
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
  resolve: (yes: boolean) => void;
}

export interface UseOrchestratorReturn {
  /** Whether orchestration is currently running. */
  running: boolean;
  /** Start orchestration for a task. */
  start: (task: string, trustAll: boolean, sandboxed: boolean) => void;
  /** Cancel the running orchestration. */
  cancel: () => void;
  /** Current status message (replaces ora spinner in the old TUI). */
  statusMessage: string;
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
): UseOrchestratorReturn {
  const [running, setRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [confirmRequest, setConfirmRequest] =
    useState<OrchestratorConfirmRequest | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
      setConfirmRequest(null);

      // Fire-and-forget async work; errors are caught internally.
      void (async () => {
        try {
          // ---- Config ------------------------------------------------
          const config = loadConfig();
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
                addMessage(`[${emoji} ${persona}] ${trimmed}`);
              }
            },

            coordinatorLog(message: string): void {
              addMessage(`[${getEmoji("coordinator")} coordinator] ${message}`);
            },

            error(message: string): void {
              addMessage(`**Error:** ${message}`);
            },

            status(message: string): void {
              setStatusMessage(message);
            },

            statusDone(message?: string): void {
              if (message) {
                addMessage(message);
              }
              setStatusMessage("");
            },

            confirm(prompt: string): Promise<boolean> {
              return new Promise<boolean>((resolve) => {
                setConfirmRequest({
                  prompt,
                  resolve: (yes: boolean) => {
                    setConfirmRequest(null);
                    resolve(yes);
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
              addMessage(
                `[${emoji} ${persona}] \u{2193} ${toolName}${detail ? " " + detail : ""}`,
              );
              // Keep status line simple — the tool call is already in the message list
              setStatusMessage(`${persona}: working...`);
            },

            updateCost(cost: number): void {
              setCost?.(cost);
            },
          };

          // Skip classification — user explicitly invoked /build, so go
          // straight to multi-expert orchestration.

          // ---- Run full orchestration --------------------------------
          await runOrchestration(config, task, trustAll, sandboxed, output, controller.signal);

          addMessage("**Orchestration complete.**");
        } catch (err: unknown) {
          if (controller.signal.aborted) {
            addMessage("**Build cancelled.**");
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            addMessage(`**Orchestration failed:** ${msg}`);
          }
        } finally {
          setRunning(false);
          setStatusMessage("");
          setConfirmRequest(null);
        }
      })();
    },
    [addMessage],
  );

  // ------------------------------------------------------------------
  // Return
  // ------------------------------------------------------------------

  return { running, start, cancel, statusMessage, confirmRequest };
}
