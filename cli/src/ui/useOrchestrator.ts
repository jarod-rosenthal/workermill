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
import { notifyIfEnabled } from "../notify.js";

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
  start: (task: string, trustAll: boolean | (() => boolean), sandboxed: boolean, ticketKey?: string) => void;
  /** Retry the most recent incomplete run — skips planning, resumes from first incomplete story. Returns false if nothing to retry. */
  retry: (trustAll: boolean | (() => boolean), sandboxed: boolean) => boolean;
  /** Run a standalone Tech Lead review. Target: "branch", "diff", or "#42" (PR number). */
  review: (trustAll: boolean | (() => boolean), sandboxed: boolean, target?: string) => void;
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
    (task: string, trustAll: boolean | (() => boolean), sandboxed: boolean, ticketKey?: string) => {
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

          // Track completion stats for summary
          const seenPersonas = new Set<string>();
          let storiesCompleted = 0;
          const startTime = Date.now();

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
          await runOrchestration(config, task, trustAll, sandboxed, output, controller.signal, retryPlan ?? undefined, ticketKey);

          flushLine();
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const mins = Math.floor(elapsed / 60);
          const secs = elapsed % 60;
          const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
          const parts: string[] = [];
          if (seenPersonas.size > 0) parts.push(`${seenPersonas.size} expert${seenPersonas.size === 1 ? "" : "s"}`);
          if (storiesCompleted > 0) parts.push(`${storiesCompleted} ${storiesCompleted === 1 ? "story" : "stories"} shipped`);
          parts.push(timeStr);
          addMessage(`**Shipped.** ${parts.join(" · ")}`);
          notifyIfEnabled(config.bell, "WorkerMill", "Ship complete");
        } catch (err: unknown) {
          flushLine();
          if (controller.signal.aborted) {
            addMessage("**Build cancelled.**");
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            addMessage(`**Orchestration failed:** ${msg}`);
            notifyIfEnabled(config.bell, "WorkerMill", "Ship failed");
          }
        } finally {
          setRunning(false);
          setStatusMessage("");
          setPreviewLine("");
          setConfirmRequest(null);
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
  // review() — standalone Tech Lead review
  // ------------------------------------------------------------------

  const review = useCallback(
    (trustAll: boolean | (() => boolean), sandboxed: boolean, target?: string) => {
      if (running) return;
      setRunning(true);
      setStatusMessage("Reviewing...");

      const controller = new AbortController();
      abortRef.current = controller;

      (async () => {
        function emitLine(line: string): void {
          addMessage(line);
          setPreviewLine(line);
        }
        function flushLine(): void {
          setPreviewLine("");
        }

        const config = cliConfig ?? resolveConfig();
        if (!config) {
          addMessage("No provider configured. Run `workermill` (setup) first.");
          setRunning(false);
          return;
        }

        try {
          const { runStandaloneReview } = await import("../orchestrator.js");

          const seenPersonas = new Set<string>();
          const startTime = Date.now();

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
              const detail = input.command || input.file_path || input.path || input.pattern || "";
              emitLine(`[${emoji} ${persona}] ↓ ${toolName} ${detail}`);
            },
            error(message: string): void { emitLine(`Error: ${message}`); },
            status(msg: string): void { setStatusMessage(msg); },
            statusDone(): void { setStatusMessage(""); },
            confirm: async (prompt: string) => {
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
            updateCost(cost: number): void {
              setCost?.(cost);
            },
            updateTokPerSec(providerModel: string, tokPerSec: number): void {
              setTokPerSec?.(providerModel, tokPerSec);
            },
            updateBranch: undefined,
          };

          const result = await runStandaloneReview(config, output, target, controller.signal);

          flushLine();

          if (result) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const mins = Math.floor(elapsed / 60);
            const secs = elapsed % 60;
            const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

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
                  const issueUrl = execSync(
                    `gh issue create --title "${issueTitle.replace(/"/g, '\\"')}" --body-file -`,
                    { cwd: process.cwd(), encoding: "utf-8", input: issueBody, stdio: ["pipe", "pipe", "pipe"], timeout: 15_000 },
                  ).trim();
                  // Extract issue number from URL
                  const issueMatch = issueUrl.match(/\/issues\/(\d+)/);
                  const issueNumber = issueMatch ? `#${issueMatch[1]}` : null;

                  if (issueNumber) {
                    emitLine(`[🎯 coordinator] Created issue ${issueNumber}: ${issueTitle}`);
                    emitLine(`[🎯 coordinator] ${issueUrl}`);
                    flushLine();

                    // Kick off /ship with the new issue
                    setRunning(false);
                    start(`Fix code review findings from ${issueNumber}`, trustAll, sandboxed, issueNumber);
                    return; // start() takes over — skip the finally block's setRunning(false)
                  } else {
                    emitLine(`[🎯 coordinator] Issue created: ${issueUrl}`);
                    addMessage("Issue created but couldn't parse the number. Run `/ship` manually with the issue number.");
                  }
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  emitLine(`[🎯 coordinator] Failed to create issue: ${msg}`);
                  addMessage(`Could not create GitHub issue. You can fix manually or run \`/ship\` with the review feedback.`);
                }
              }
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
          setRunning(false);
          setStatusMessage("");
          setPreviewLine("");
          setConfirmRequest(null);
        }
      })();
    },
    [addMessage, cliConfig],
  );

  // ------------------------------------------------------------------
  // Return
  // ------------------------------------------------------------------

  return { running, start, retry, review, cancel, statusMessage, previewLine, confirmRequest };
}
