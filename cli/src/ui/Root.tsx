import React, { useState, useCallback, useRef, useEffect } from "react";
import { useApp } from "ink";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { useAgent } from "./useAgent.js";
import { useOrchestrator } from "./useOrchestrator.js";
import { App } from "./App.js";
import { listSessions } from "../session.js";
import type { UseAgentOptions } from "./useAgent.js";

// ---------------------------------------------------------------------------
// History persistence
// ---------------------------------------------------------------------------

const HISTORY_DIR = path.join(os.homedir(), ".workermill");
const HISTORY_FILE = path.join(HISTORY_DIR, "history");
const MAX_HISTORY = 1000;

function loadHistory(): string[] {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, "utf-8").trim();
      if (!raw) return [];
      return raw.split("\n").slice(-MAX_HISTORY);
    }
  } catch {
    // Ignore read errors — start with empty history.
  }
  return [];
}

function appendHistory(line: string): void {
  try {
    if (!fs.existsSync(HISTORY_DIR)) {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
    fs.appendFileSync(HISTORY_FILE, line + "\n", "utf-8");
  } catch {
    // Ignore write errors — history is best-effort.
  }
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function getGitBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", {
      encoding: "utf-8",
      timeout: 2000,
    }).trim();
  } catch {
    return "";
  }
}

function getGitStatus(cwd: string): string {
  let branch = "(unknown)";
  let status = "(unable to read)";
  try {
    branch = execSync("git branch --show-current 2>/dev/null", {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    }).trim() || "(detached HEAD)";
  } catch {
    branch = "(not a git repo)";
  }
  try {
    const raw = execSync("git status --short 2>/dev/null", {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    status = raw || "(clean)";
  } catch {
    status = "(not a git repo)";
  }
  return `**Git branch:** ${branch}\n\n\`\`\`\n${status}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Static help text
// ---------------------------------------------------------------------------

const HELP_TEXT = `**WorkerMill** — AI coding agent for your terminal.

**Two ways to work:**

**Chat** — Ask anything. I'll read files, write code, run commands.
Just type your question or task and press Enter.

**Build** — Create software with multiple specialist AI agents.
Type \`/build <description>\` and I'll plan stories, assign experts
(backend, frontend, devops, security), execute, and review.

Or from the command line: \`wm build "your task"\`

---

**Commands**

| Command | Description |
|---|---|
| \`/build <task>\` | Multi-expert orchestration — the main feature |
| \`/plan\` | Toggle plan mode (read-only, explore before committing) |
| \`/trust\` | Auto-approve all tool calls for this session |
| \`/model\` | Show current provider and model |
| \`/cost\` | Session cost and token usage |
| \`/status\` | Session info |
| \`/git\` | Git branch and status |
| \`/sessions\` | List/switch sessions |
| \`/editor\` | Open \\$EDITOR for longer input |
| \`/quit\` | Exit |

**Shortcuts:** \`!command\` runs shell directly, \`ESC\` cancels, \`Ctrl+C Ctrl+C\` exits.`;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RootProps extends UseAgentOptions {
  workingDir: string;
  /** If set, auto-starts orchestration with this task on mount (from `wm build`). */
  initialBuildTask?: string;
  /** Display strings for each role (e.g. "ollama/qwen3-coder:30b"). */
  roleModels?: { worker: string; planner: string; reviewer: string };
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

/**
 * Root wrapper that connects the useAgent hook to the App component.
 * Handles ALL slash commands with static output (no LLM involvement),
 * shell escapes via `!`, and persistent input history.
 */
export function Root(props: RootProps): React.ReactElement {
  const { exit } = useApp();
  const agent = useAgent(props);

  // Orchestrator for /build — pushes messages via agent.addSystemMessage
  const addOrchestratorMessage = useCallback(
    (content: string, role?: "user" | "assistant") => {
      if (role === "user") {
        agent.addUserMessage(content);
      } else {
        agent.addSystemMessage(content);
      }
    },
    [agent],
  );
  const orchestrator = useOrchestrator(addOrchestratorMessage, agent.setCost);

  // Auto-start build if launched via `wm build "task"`
  const buildStarted = useRef(false);
  useEffect(() => {
    if (props.initialBuildTask && !buildStarted.current) {
      buildStarted.current = true;
      agent.addUserMessage(`/build ${props.initialBuildTask}`);
      orchestrator.start(props.initialBuildTask, props.trustAll, props.sandboxed);
    }
  }, [props.initialBuildTask, props.trustAll, props.sandboxed, agent, orchestrator]);

  const [inputHistory, setInputHistory] = useState<string[]>(() => loadHistory());
  const [gitBranch, setGitBranch] = useState(() => getGitBranch());
  const lastBranchCheck = useRef(Date.now());

  // Refresh git branch periodically (every 10 seconds, on submit).
  const refreshGitBranch = useCallback(() => {
    const now = Date.now();
    if (now - lastBranchCheck.current > 10_000) {
      lastBranchCheck.current = now;
      setGitBranch(getGitBranch());
    }
  }, []);

  // Push an entry to the in-memory and on-disk history.
  const pushHistory = useCallback((line: string) => {
    setInputHistory((prev) => {
      const next = [...prev, line].slice(-MAX_HISTORY);
      return next;
    });
    appendHistory(line);
  }, []);

  // ------- Slash-command handler ------- //

  const handleSlashCommand = useCallback(
    (input: string): boolean => {
      const trimmed = input.trim();
      if (!trimmed.startsWith("/")) return false;

      const spaceIdx = trimmed.indexOf(" ", 1);
      const cmd = spaceIdx === -1
        ? trimmed.slice(1).toLowerCase()
        : trimmed.slice(1, spaceIdx).toLowerCase();
      const arg = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

      switch (cmd) {
        // ---- /help ----
        case "help":
        case "h":
        case "?": {
          agent.addSystemMessage(HELP_TEXT);
          break;
        }

        // ---- /model ----
        case "model": {
          agent.addSystemMessage(
            `**Current model:** ${props.provider}/${props.model}\n\n` +
            "**Supported model families:**\n" +
            "- Anthropic: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5\n" +
            "- OpenAI: gpt-5.4, gpt-5.4-mini\n" +
            "- Google: gemini-3.1-pro, gemini-3.1-flash-lite\n" +
            "- Ollama: any locally-hosted model\n\n" +
            "To change: edit `~/.workermill/cli.json` or restart with `--provider` / `--model` flags."
          );
          break;
        }

        // ---- /cost ----
        case "cost": {
          const costUsd = agent.cost;
          const totalTokens = agent.tokens;
          const sessionMessages = agent.session.messages.length;
          agent.addSystemMessage(
            `**Session Cost Summary**\n\n` +
            `| Metric | Value |\n` +
            `|---|---|\n` +
            `| Model | ${props.provider}/${props.model} |\n` +
            `| Total cost | $${costUsd.toFixed(4)} |\n` +
            `| Last input tokens | ${totalTokens.toLocaleString()} |\n` +
            `| Session tokens | ${agent.session.totalTokens.toLocaleString()} |\n` +
            `| Messages | ${sessionMessages} |`
          );
          break;
        }

        // ---- /status ----
        case "status": {
          const session = agent.session;
          const msgCount = session.messages.length;
          const mode = props.planMode ? "PLAN (read-only)" : props.trustAll ? "TRUST ALL" : "ask";
          agent.addSystemMessage(
            `**Session Status**\n\n` +
            `| Field | Value |\n` +
            `|---|---|\n` +
            `| Session ID | \`${session.id.slice(0, 8)}...\` |\n` +
            `| Provider / Model | ${props.provider}/${props.model} |\n` +
            `| Messages | ${msgCount} |\n` +
            `| Session tokens | ${session.totalTokens.toLocaleString()} |\n` +
            `| Cost | $${agent.cost.toFixed(4)} |\n` +
            `| Mode | ${mode} |\n` +
            `| Working dir | \`${props.workingDir}\` |\n` +
            `| Started | ${session.startedAt} |`
          );
          break;
        }

        // ---- /plan ----
        case "plan": {
          const newPlan = !props.planMode;
          agent.setPlanMode(newPlan);
          agent.addSystemMessage(
            newPlan
              ? "**Plan mode ON.** Only read-only tools (read_file, glob, grep, ls, sub_agent) are available. Write operations are blocked."
              : "**Plan mode OFF.** All tools are now available."
          );
          break;
        }

        // ---- /trust ----
        case "trust": {
          agent.setTrustAll(true);
          agent.addSystemMessage(
            "**Trust mode ON.** All non-dangerous tool calls will be auto-approved for this session. " +
            "Dangerous operations (force push, rm -rf, etc.) still require confirmation."
          );
          break;
        }

        // ---- /build <task> ----
        case "build": {
          if (!arg) {
            agent.addSystemMessage(
              "**Usage:** `/build <task description>`\n\n" +
              "Runs WorkerMill multi-expert orchestration: classifies complexity, plans stories, " +
              "executes per-persona with tool calls, reviews, and revision loops."
            );
          } else if (orchestrator.running) {
            agent.addSystemMessage("Orchestration is already running. Wait for it to complete.");
          } else {
            agent.addUserMessage(`/build ${arg}`);
            orchestrator.start(arg, props.trustAll, props.sandboxed);
          }
          break;
        }

        // ---- /clear ----
        case "clear": {
          agent.addSystemMessage(
            "Screen clearing is not fully supported in the Ink terminal framework. " +
            "Previous messages rendered via `Static` cannot be removed. " +
            "The conversation continues below."
          );
          break;
        }

        // ---- /compact ----
        case "compact": {
          const inputTokens = agent.tokens;
          if (inputTokens > 0) {
            agent.addSystemMessage(
              "Compaction is triggered automatically when context usage exceeds 80%. " +
              `Current last-observed input tokens: ${inputTokens.toLocaleString()}. ` +
              "To force compaction, send a message and the agent will evaluate context pressure."
            );
          } else {
            agent.addSystemMessage(
              "No token usage recorded yet. Compaction happens automatically when context usage exceeds 80% of the model limit."
            );
          }
          break;
        }

        // ---- /git ----
        case "git": {
          const gitInfo = getGitStatus(props.workingDir);
          agent.addSystemMessage(gitInfo);
          break;
        }

        // ---- /editor ----
        case "editor": {
          const editor = process.env.EDITOR || process.env.VISUAL || "vi";
          const tmpFile = path.join(os.tmpdir(), `workermill-${Date.now()}.md`);
          try {
            fs.writeFileSync(tmpFile, "", "utf-8");
            execSync(`${editor} ${tmpFile}`, {
              cwd: props.workingDir,
              stdio: "inherit",
              timeout: 5 * 60 * 1000,
            });
            const contents = fs.readFileSync(tmpFile, "utf-8").trim();
            if (contents) {
              agent.addUserMessage(contents);
              agent.submit(contents);
            } else {
              agent.addSystemMessage("Editor closed with no content. Nothing submitted.");
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            agent.addSystemMessage(`Failed to open editor (\`${editor}\`): ${errMsg}`);
          } finally {
            try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
          }
          break;
        }

        // ---- /sessions ----
        case "sessions": {
          const sessions = listSessions(20);
          if (sessions.length === 0) {
            agent.addSystemMessage("No saved sessions found.");
          } else {
            const rows = sessions.map((s) => {
              const date = new Date(s.startedAt).toLocaleString();
              const name = s.name || s.preview;
              return `| \`${s.id.slice(0, 8)}\` | ${name} | ${s.messageCount} msgs | ${s.totalTokens.toLocaleString()} tokens | ${date} |`;
            });
            agent.addSystemMessage(
              `**Recent Sessions** (${sessions.length})\n\n` +
              `| ID | Name | Messages | Tokens | Date |\n` +
              `|---|---|---|---|---|\n` +
              rows.join("\n")
            );
          }
          break;
        }

        // ---- /quit, /exit ----
        case "quit":
        case "exit":
        case "q": {
          exit();
          break;
        }

        // ---- Unknown slash command ----
        default: {
          agent.addSystemMessage(
            `Unknown command: \`/${cmd}\`\n\nType \`/help\` to see all available commands.`
          );
          break;
        }
      }

      return true;
    },
    [agent, props, exit],
  );

  // ------- Shell escape handler ------- //

  const handleShellEscape = useCallback(
    (input: string): boolean => {
      if (!input.startsWith("!")) return false;

      const bashCmd = input.slice(1).trim();
      if (!bashCmd) {
        agent.addSystemMessage("Usage: `!<command>` -- run a shell command and display the output.");
        return true;
      }

      let output: string;
      let exitCode = 0;
      try {
        output = execSync(bashCmd, {
          cwd: props.workingDir,
          encoding: "utf-8",
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        });
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string; status?: number };
        output = (execErr.stdout || "") + (execErr.stderr || "");
        exitCode = execErr.status ?? 1;
      }

      const trimmedOutput = output.trim();
      const header = exitCode !== 0 ? `\`$ ${bashCmd}\` (exit ${exitCode})` : `\`$ ${bashCmd}\``;
      if (trimmedOutput) {
        agent.addSystemMessage(`${header}\n\n\`\`\`\n${trimmedOutput}\n\`\`\``);
      } else {
        agent.addSystemMessage(`${header}\n\n(no output)`);
      }
      return true;
    },
    [agent, props.workingDir],
  );

  // ------- Main submit handler ------- //

  const handleSubmit = useCallback(
    (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;

      // Record in history (all inputs, including commands).
      pushHistory(trimmed);

      // Slash commands -- fully static, no LLM.
      if (handleSlashCommand(trimmed)) {
        return;
      }

      // Shell escape -- execute locally, display result.
      if (handleShellEscape(trimmed)) {
        return;
      }

      // Regular prompt -- refresh git branch, send to agent.
      refreshGitBranch();
      agent.submit(trimmed);
    },
    [agent, pushHistory, handleSlashCommand, handleShellEscape, refreshGitBranch],
  );

  return (
    <App
      provider={props.provider}
      model={props.model}
      workingDir={props.workingDir}
      maxContext={props.contextLength || 128_000}
      trustAll={props.trustAll}
      planMode={props.planMode}
      onSubmit={handleSubmit}
      onCancel={agent.cancel}
      messages={agent.messages}
      status={orchestrator.running ? "tool_running" : agent.status}
      permissionRequest={agent.permissionRequest}
      orchestratorConfirm={orchestrator.confirmRequest}
      orchestratorStatus={orchestrator.statusMessage}
      tokens={agent.tokens}
      cost={agent.cost}
      gitBranch={gitBranch}
      inputHistory={inputHistory}
      roleModels={props.roleModels}
    />
  );
}
