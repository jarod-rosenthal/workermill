import React, { useState, useCallback, useRef, useEffect } from "react";
import { useApp } from "ink";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { useAgent } from "./useAgent.js";
import { useOrchestrator } from "./useOrchestrator.js";
import { App } from "./App.js";
import { listSessions, saveSession } from "../session.js";
import { loadConfig, saveConfig } from "../config.js";
import { loadCustomCommands } from "../custom-commands.js";
import { loadPersona, listAvailablePersonas } from "../personas.js";
import { stopAllMCPServers } from "../mcp-client.js";
import * as logger from "../logger.js";
import { loadMemories, addMemory, removeMemory } from "../memory.js";
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
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      timeout: 2000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (branch && branch !== "HEAD") return branch;
  } catch { /* not a git repo or no commits */ }

  // Fallback for repos with no commits — read HEAD ref directly
  try {
    const head = execSync("git symbolic-ref --short HEAD", {
      encoding: "utf-8",
      timeout: 2000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (head) return head;
  } catch { /* ignore */ }

  return "";
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

**Ship** — Create software with multiple specialist AI agents.
Type \`/ship <description>\` or \`/ship spec.md\` and I'll plan stories,
assign experts (backend, frontend, devops, security), execute, and review.
Creates a feature branch for all changes — your current branch stays clean.

---

**Commands**

| Command | Description |
|---|---|
| \`/ship <task>\` | Multi-expert orchestration — plan, execute, review, ship |
| \`/retry\` | Re-plan and re-run the last task |
| \`/settings\` | View/change settings (review, ollama, etc.) |
| \`/undo\` | Revert last build's changes (git stash or reset) |
| \`/diff\` | Preview uncommitted changes |
| \`/plan\` | Toggle plan mode (read-only, explore before committing) |
| \`/trust\` | Auto-approve all tool calls for this session |
| \`/init\` | Generate \`WORKERMILL.md\` for this project |
| \`/permissions\` | Manage tool permissions (trust/ask/allow/deny) |
| \`/model\` | Show or switch model (\`/model provider/model\`) |
| \`/cost\` | Session cost and token usage |
| \`/status\` | Session info |
| \`/git\` | Git branch and status |
| \`/sessions\` | List/switch sessions |
| \`/log\` | Show recent CLI log entries |
| \`/skills\` | List custom commands |
| \`/personas\` | List, show, or create personas |
| \`/mcp\` | Show MCP server status |
| \`/chrome\` | Open/close headless Chrome browser |
| \`/voice\` | Voice input — speak instead of type |
| \`/schedule\` | Create/list/delete scheduled tasks |
| \`/update\` | Update to latest version |
| \`/release-notes\` | Show changelog |
| \`/hooks\` | Show configured pre/post tool hooks |
| \`/editor\` | Open \\$EDITOR for longer input |
| \`/quit\` | Exit |

**Shortcuts:** \`!command\` runs shell directly, \`ESC\` cancels, \`Ctrl+C Ctrl+C\` exits.`;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RootProps extends UseAgentOptions {
  workingDir: string;
  /** Display strings for each role (e.g. "ollama/qwen3-coder:30b"). */
  roleModels?: { worker: string; planner: string; reviewer: string };
  /** Resolved CLI config (includes --auto-revise and other CLI overrides). */
  cliConfig?: import("../config.js").CliConfig;
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
  const orchestrator = useOrchestrator(addOrchestratorMessage, agent.setCost, props.cliConfig, agent.incrementToolCount);

  // Track the last build task for /retry
  const lastBuildTask = useRef<string | null>(null);

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
          const customCmds = loadCustomCommands();
          if (customCmds.length > 0) {
            const customTable = customCmds.map(c => `| \`/${c.name}\` | ${c.description} |`).join("\n");
            agent.addSystemMessage(
              `**Custom Commands**\n\n| Command | Description |\n|---|---|\n${customTable}`
            );
          }
          break;
        }

        // ---- /model ----
        case "model": {
          if (!arg) {
            agent.addSystemMessage(
              `**Current model:** ${props.provider}/${props.model}\n\n` +
              "To switch: `/model <provider>/<model>` (e.g., `/model anthropic/claude-sonnet-4-6`)\n\n" +
              "**Supported providers:** ollama, anthropic, openai, google"
            );
          } else {
            // Parse provider/model
            const modelParts = arg.split("/");
            let newProvider: string;
            let newModel: string;
            if (modelParts.length >= 2) {
              newProvider = modelParts[0];
              newModel = modelParts.slice(1).join("/");
            } else {
              // Just a model name — keep current provider
              newProvider = props.provider;
              newModel = arg;
            }

            // Update config
            const modelConfig = loadConfig();
            if (modelConfig) {
              if (!modelConfig.providers[newProvider]) {
                modelConfig.providers[newProvider] = { model: newModel };
              } else {
                modelConfig.providers[newProvider].model = newModel;
              }
              modelConfig.default = newProvider;
              saveConfig(modelConfig);
            }

            agent.addSystemMessage(
              `**Model switched** to \`${newProvider}/${newModel}\`\n\n` +
              "Restart the CLI to use the new model. Config saved to `~/.workermill/cli.json`."
            );
          }
          break;
        }

        // ---- /cost ----
        case "cost": {
          const costUsd = agent.cost;
          const totalTokens = agent.tokens;
          const sessionMessages = agent.session.messages.length;
          agent.addSystemMessage(
            `**Session Cost Estimate**\n\n` +
            `| Metric | Value |\n` +
            `|---|---|\n` +
            `| Model | ${props.provider}/${props.model} |\n` +
            `| Est. cost | ~$${costUsd.toFixed(2)} |\n` +
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
          const mode = agent.permissionMode === "trust all" ? "TRUST ALL" : agent.permissionMode;
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

        // ---- /ship (primary) and /build (alias) ----
        case "ship":
        case "build": {
          if (!arg) {
            agent.addSystemMessage(
              "**Usage:** `/ship <task description>` or `/ship spec.md`\n\n" +
              "Runs WorkerMill multi-expert orchestration: plans stories, assigns specialist personas, " +
              "executes with tool calls, reviews, and ships.\n\n" +
              "**Note:** Creates a feature branch (`workermill/<task>`) for all changes. " +
              "Your current branch is restored when the session completes or is cancelled."
            );
          } else if (orchestrator.running) {
            agent.addSystemMessage("Orchestration is already running. Wait for it to complete.");
          } else {
            lastBuildTask.current = arg;
            agent.addUserMessage(`/ship ${arg}`);
            orchestrator.start(arg, agent.permissionMode === "trust all", props.sandboxed);
          }
          break;
        }

        // ---- /retry ----
        case "retry": {
          if (orchestrator.running) {
            agent.addSystemMessage("Orchestration is already running. Wait for it to complete.");
          } else if (!lastBuildTask.current) {
            agent.addSystemMessage("No previous task to retry. Use `/ship <task>` first.");
          } else {
            const task = lastBuildTask.current;
            agent.addUserMessage(`/retry ${task.slice(0, 60)}...`);
            orchestrator.start(task, agent.permissionMode === "trust all", props.sandboxed);
          }
          break;
        }

        // ---- /undo ----
        case "undo": {
          try {
            // Check if there are uncommitted changes
            const status = execSync("git status --porcelain 2>/dev/null", {
              cwd: props.workingDir, encoding: "utf-8", timeout: 5000,
            }).trim();

            if (!status) {
              // No uncommitted changes — try undoing last commit
              try {
                const lastMsg = execSync("git log -1 --format=%s 2>/dev/null", {
                  cwd: props.workingDir, encoding: "utf-8", timeout: 5000,
                }).trim();
                execSync("git reset HEAD~1", { cwd: props.workingDir, encoding: "utf-8", timeout: 5000 });
                agent.addSystemMessage(`**Undone** last commit: "${lastMsg}"\n\nChanges are now unstaged. Run \`/undo\` again to discard them.`);
              } catch {
                agent.addSystemMessage("Nothing to undo — no uncommitted changes and no commits to reset.");
              }
            } else {
              // Has uncommitted changes — stash them
              const fileCount = status.split("\n").length;
              execSync("git stash push -m 'workermill-undo'", {
                cwd: props.workingDir, encoding: "utf-8", timeout: 10000,
              });
              agent.addSystemMessage(`**Undone** — stashed ${fileCount} changed files.\n\nRecover with \`!git stash pop\` if needed.`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            agent.addSystemMessage(`**Undo failed:** ${msg}\n\nMake sure you're in a git repository.`);
          }
          break;
        }

        // ---- /diff ----
        case "diff": {
          try {
            const diffStat = execSync("git diff --stat 2>/dev/null", {
              cwd: props.workingDir, encoding: "utf-8", timeout: 5000,
            }).trim();
            const untracked = execSync("git ls-files --others --exclude-standard 2>/dev/null", {
              cwd: props.workingDir, encoding: "utf-8", timeout: 5000,
            }).trim();
            const diff = execSync("git diff 2>/dev/null", {
              cwd: props.workingDir, encoding: "utf-8", timeout: 10000,
            }).trim();

            const parts: string[] = [];
            if (diffStat) parts.push(`**Changes:**\n\`\`\`\n${diffStat}\n\`\`\``);
            if (untracked) parts.push(`**New files:**\n${untracked.split("\n").map(f => `- \`${f}\``).join("\n")}`);
            if (diff) {
              parts.push(`**Diff:**\n\`\`\`diff\n${diff}\n\`\`\``);
            }

            if (parts.length === 0) {
              agent.addSystemMessage("No changes. Working tree is clean.");
            } else {
              agent.addSystemMessage(parts.join("\n\n"));
            }
          } catch (err) {
            logger.debug("/diff command failed", { error: err instanceof Error ? err.message : String(err) });
            agent.addSystemMessage("Not a git repository, or git is not installed.");
          }
          break;
        }

        // ---- /clear ----
        case "clear": {
          // Reset the session — start fresh while keeping the UI
          const session = agent.session;
          session.messages = [];
          session.totalTokens = 0;
          saveSession(session);
          agent.addSystemMessage("Conversation cleared. Starting fresh.");
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

        // ---- /settings ----
        case "settings":
        case "config": {
          const config = loadConfig();
          if (!config) {
            agent.addSystemMessage("No config found. Run setup first.");
            break;
          }

          if (!arg) {
            // Show current settings
            const ollamaHost = config.providers?.ollama?.host || "http://localhost:11434";
            const ollamaCtx = config.providers?.ollama?.contextLength || 65536;
            const reviewEnabled = config.review?.enabled !== false;
            const maxRevisions = config.review?.maxRevisions ?? 3;
            const approvalThreshold = config.review?.approvalThreshold ?? 8;
            const criticThreshold = config.review?.criticThreshold ?? 8;
            const autoRevise = config.review?.autoRevise ?? false;
            const useCritic = config.review?.useCritic ?? false;
            const branchPrefix = config.git?.branchPrefix || "workermill";

            agent.addSystemMessage(
              `**Settings** (\`~/.workermill/cli.json\`)\n\n` +
              `| Setting | Value | Command |\n` +
              `|---|---|---|\n` +
              `| Ollama host | \`${ollamaHost}\` | \`/settings ollama.host <url>\` |\n` +
              `| Ollama context | ${ollamaCtx} | \`/settings ollama.context <n>\` |\n` +
              `| Review enabled | ${reviewEnabled} | \`/settings review.enabled <true/false>\` |\n` +
              `| Max revisions | ${maxRevisions} | \`/settings review.maxRevisions <n>\` |\n` +
              `| Approval threshold | ${approvalThreshold} | \`/settings review.threshold <n>\` |\n` +
              `| Critic threshold | ${criticThreshold} | \`/settings review.criticThreshold <n>\` |\n` +
              `| Auto-revise | ${autoRevise} | \`/settings review.autoRevise <true/false>\` |\n` +
              `| Critic pass | ${useCritic} | \`/settings review.critic <true/false>\` |\n` +
              `| Branch prefix | ${branchPrefix} | \`/settings git.branchPrefix <name>\` |`
            );
          } else {
            // Parse key=value or key value
            const parts = arg.split(/[\s=]+/);
            const key = parts[0];
            const value = parts.slice(1).join(" ");

            if (!value) {
              agent.addSystemMessage(`Usage: \`/settings ${key} <value>\``);
              break;
            }

            const boolVal = (v: string) => v === "true" || v === "1" || v === "on" || v === "yes";
            const numVal = (v: string) => parseInt(v, 10);

            switch (key) {
              case "ollama.host": {
                if (!config.providers.ollama) config.providers.ollama = { model: "qwen3-coder:30b" };
                config.providers.ollama.host = value;
                break;
              }
              case "ollama.context": {
                if (!config.providers.ollama) config.providers.ollama = { model: "qwen3-coder:30b" };
                config.providers.ollama.contextLength = numVal(value);
                break;
              }
              case "review.enabled": {
                config.review = { ...config.review, enabled: boolVal(value) };
                break;
              }
              case "review.maxRevisions": {
                config.review = { ...config.review, maxRevisions: numVal(value) };
                break;
              }
              case "review.threshold": {
                config.review = { ...config.review, approvalThreshold: numVal(value) };
                break;
              }
              case "review.autoRevise": {
                config.review = { ...config.review, autoRevise: boolVal(value) };
                break;
              }
              case "review.criticThreshold": {
                config.review = { ...config.review, criticThreshold: numVal(value) };
                break;
              }
              case "review.critic": {
                config.review = { ...config.review, useCritic: boolVal(value) };
                break;
              }
              case "git.branchPrefix": {
                config.git = { ...config.git, branchPrefix: value };
                break;
              }
              default:
                agent.addSystemMessage(`Unknown setting: \`${key}\`. Type \`/settings\` to see all options.`);
                break;
            }

            if (["ollama.host", "ollama.context", "review.enabled", "review.maxRevisions", "review.threshold", "review.criticThreshold", "review.autoRevise", "review.critic", "git.branchPrefix"].includes(key)) {
              saveConfig(config);
              agent.addSystemMessage(`**Updated** \`${key}\` → \`${value}\` (saved to ~/.workermill/cli.json)`);
            }
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

        // ---- /hooks ----
        case "hooks": {
          const hooksConfig = loadConfig();
          const hooks = hooksConfig?.hooks;
          if (!hooks || (!hooks.pre?.length && !hooks.post?.length)) {
            agent.addSystemMessage("No hooks configured. Add hooks to `~/.workermill/cli.json`:\n\n```json\n\"hooks\": {\n  \"pre\": [{ \"command\": \"echo before\", \"tools\": [\"write_file\"] }],\n  \"post\": [{ \"command\": \"npx eslint --fix\", \"tools\": [\"write_file\", \"edit_file\"] }]\n}\n```");
          } else {
            const lines: string[] = [];
            if (hooks.pre?.length) {
              lines.push("**Pre-tool hooks:**");
              for (const h of hooks.pre) lines.push(`- \`${h.command}\` (tools: ${h.tools?.join(", ") || "*"})`);
            }
            if (hooks.post?.length) {
              lines.push("**Post-tool hooks:**");
              for (const h of hooks.post) lines.push(`- \`${h.command}\` (tools: ${h.tools?.join(", ") || "*"})`);
            }
            agent.addSystemMessage(lines.join("\n"));
          }
          break;
        }

        // ---- /permissions ----
        case "permissions": {
          if (!arg) {
            // Show current permissions
            const mode = props.trustAll ? "**trust all** — all tools auto-approved" : "**ask** — prompts for each tool";
            agent.addSystemMessage(
              `**Permission mode:** ${mode}\n\n` +
              "Commands:\n" +
              "- `/permissions trust` — auto-approve all tools\n" +
              "- `/permissions ask` — prompt for each tool\n" +
              "- `/permissions allow <tool>` — always allow a specific tool\n" +
              "- `/permissions deny <tool>` — always deny a specific tool\n" +
              "- `/permissions reset` — reset to default (ask mode)\n\n" +
              "**Tools:** bash, read_file, write_file, edit_file, glob, grep, ls, fetch, git, patch, web_search, sub_agent, todo"
            );
          } else {
            const parts = arg.split(/\s+/);
            const action = parts[0];
            const toolName = parts[1];

            switch (action) {
              case "trust":
                agent.setTrustAll(true);
                agent.addSystemMessage("**Trust mode ON.** All tools auto-approved.");
                break;
              case "ask":
                agent.setTrustAll(false);
                agent.addSystemMessage("**Ask mode ON.** Tools require approval.");
                break;
              case "allow":
                if (!toolName) {
                  agent.addSystemMessage("Usage: `/permissions allow <tool>`");
                } else {
                  agent.allowTool(toolName);
                  agent.addSystemMessage(`**Allowed** \`${toolName}\` for this session.`);
                }
                break;
              case "deny":
                if (!toolName) {
                  agent.addSystemMessage("Usage: `/permissions deny <tool>`");
                } else {
                  agent.denyTool(toolName);
                  agent.addSystemMessage(`**Denied** \`${toolName}\` for this session. The tool will be blocked.`);
                }
                break;
              case "reset":
                agent.setTrustAll(false);
                agent.addSystemMessage("**Permissions reset** to ask mode.");
                break;
              default:
                agent.addSystemMessage("Unknown action. Use: trust, ask, allow, deny, reset");
            }
          }
          break;
        }

        // ---- /setup ----
        case "setup": {
          // Can't run readline-based setup after Ink has taken over stdin.
          // Clear config so next run triggers fresh setup automatically.
          try {
            const configPath = path.join(os.homedir(), ".workermill", "cli.json");
            if (fs.existsSync(configPath)) {
              fs.unlinkSync(configPath);
              agent.addSystemMessage("**Config cleared.** Type `/exit` and run `workermill` again to re-run setup.");
            } else {
              agent.addSystemMessage("No config found. Type `/exit` and run `workermill` to start setup.");
            }
          } catch (err) {
            agent.addSystemMessage(`Failed to clear config: ${err instanceof Error ? err.message : String(err)}`);
          }
          break;
        }

        // ---- /quit, /exit ----
        case "quit":
        case "exit":
        case "q": {
          stopAllMCPServers();
          void import("../browser.js").then(m => m.browserClose());
          exit();
          // Force process exit — Ink's exit() only stops rendering but
          // dangling listeners (stdin, timers) can keep the process alive.
          setTimeout(() => process.exit(0), 100);
          break;
        }

        // ---- /init ----
        case "init": {
          const wmPath = path.join(props.workingDir, "WORKERMILL.md");
          const exists = fs.existsSync(wmPath);
          const isForce = arg?.includes("--force");

          if (exists && !isForce) {
            // Re-run: review and suggest improvements
            agent.addSystemMessage("**Reviewing WORKERMILL.md...** I'll analyze your project and suggest improvements.");
            agent.submit(
              `Read the existing WORKERMILL.md file and review it against the current state of the codebase.

Use your tools to explore — read key source files, check directory structure, look at configs, tests, and dependencies. Then compare what WORKERMILL.md says vs what actually exists.

Evaluate the WORKERMILL.md on these criteria:
- **Accuracy** — Does it match the current codebase? Are file paths, commands, and patterns still correct?
- **Completeness** — Is anything important missing? New modules, changed architecture, added dependencies?
- **Specificity** — Does it reference actual file paths and commands, or is it generic boilerplate?
- **Actionability** — Would an AI agent reading this know exactly how to work in this codebase?
- **Conciseness** — Is it under ~200 lines? Are there redundant sections?

Then either:
1. If improvements are needed, update the file directly with write_file and explain what you changed.
2. If it's already good, say so and suggest any minor additions.

Do NOT rewrite from scratch unless it's severely outdated — preserve the user's custom sections.`
            );
          } else {
            // First run: generate from scratch
            agent.addSystemMessage("**Analyzing codebase...** I'll explore your project and generate `WORKERMILL.md`.");
            agent.submit(
              `Explore this codebase thoroughly and create a WORKERMILL.md file in the project root. This file will be read by ALL AI agents working on this project — it's the single source of truth for how to work in this codebase.

Use your tools aggressively — list directories, read package.json/requirements.txt/Cargo.toml/go.mod/pyproject.toml, read key source files, check test structure, look at CI configs, read existing docs. Understand the project before writing.

Write a WORKERMILL.md with these sections:

## 1. Project Overview
- What this project does in 1-2 sentences
- Who it's for and what problem it solves

## 2. Tech Stack
- Languages and versions (be specific: "TypeScript 5.x with strict mode", not just "TypeScript")
- Frameworks (Express 4.x, React 19, Next.js 15, etc.)
- Database, ORM, cache, message queue
- Key libraries that shape how code is written

## 3. Architecture
- Directory structure with purpose of each top-level directory
- Architectural pattern (monolith, microservices, monorepo, MVC, clean architecture)
- Data flow — how a request moves through the system
- Key abstractions and patterns used throughout

## 4. Quick Reference
Build a command table:
| Task | Command |
|------|---------|
| Install | \`npm install\` |
| Dev server | \`npm run dev\` |
| Test | \`npm test\` |
| Build | \`npm run build\` |
| Lint | \`npm run lint\` |
| Type check | \`npx tsc --noEmit\` |

Include ALL available scripts, not just the obvious ones.

## 5. Coding Standards
Observe the actual code and document what you see:
- Naming conventions (camelCase, snake_case, file naming)
- File structure patterns (one component per file, barrel exports, etc.)
- Import ordering conventions
- Error handling patterns
- How state is managed
- Comment style and when comments are used

## 6. Key Files & Entry Points
List the most important files an agent should know about:
- Main entry point(s)
- Route definitions
- Database schema/models
- Config files
- Environment variables (.env structure)

## 7. Testing
- Test framework and runner
- Where tests live (co-located, separate directory)
- How to run a single test
- Test patterns used (unit, integration, e2e)
- Any test fixtures or helpers

## 8. Common Pitfalls
Things that would trip up an AI agent:
- Gotchas specific to this codebase
- Environment requirements (specific Node version, Docker needed, etc.)
- Files that should NOT be modified
- Patterns that look wrong but are intentional

## 9. Git & Workflow
- Branch naming conventions
- Commit message format
- PR process if any

Rules for writing:
- Be SPECIFIC — reference actual file paths, actual commands, actual patterns
- Be CONCISE — target under 200 lines, no filler
- Every line should help an AI agent work better in this codebase
- If you can't determine something from the code, leave it out rather than guessing
- Use code blocks for commands and file paths

Write the file with write_file to WORKERMILL.md in the project root.`
            );
          }
          break;
        }

        // ---- /log ----
        case "log": {
          const projectHash = require("crypto").createHash("md5").update(props.workingDir).digest("hex").slice(0, 8);
          const logPath = path.join(os.homedir(), ".workermill", "logs", projectHash, "cli.log");
          try {
            if (!fs.existsSync(logPath)) {
              agent.addSystemMessage("No log file found. Logs are stored in `~/.workermill/logs/`");
              break;
            }
            const content = fs.readFileSync(logPath, "utf-8");
            const lines = content.trim().split("\n");
            const tail = lines.slice(-20).join("\n");
            agent.addSystemMessage(`**Last 20 log entries:**\n\n\`\`\`\n${tail}\n\`\`\``);
          } catch (err) {
            agent.addSystemMessage(`Failed to read log: ${err instanceof Error ? err.message : String(err)}`);
          }
          break;
        }

        // ---- /update ----
        case "update": {
          agent.addSystemMessage("**Updating WorkerMill CLI...**");
          try {
            const result = execSync("npm install -g workermill@latest 2>&1", {
              encoding: "utf-8", timeout: 60_000,
            }).trim();
            const versionMatch = result.match(/workermill@([\d.]+)/);
            const newVersion = versionMatch ? versionMatch[1] : "latest";
            agent.addSystemMessage(`**Updated to v${newVersion}.** Restart the CLI to use the new version.`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("EACCES") || msg.includes("permission")) {
              agent.addSystemMessage("**Permission denied.** Try:\n\n```\nsudo npm install -g workermill@latest\n```\n\nOr use npx which always gets the latest:\n```\nnpx workermill@latest\n```");
            } else {
              agent.addSystemMessage(`**Update failed:** ${msg.slice(0, 200)}\n\nTry manually: \`npm install -g workermill@latest\``);
            }
          }
          break;
        }

        // ---- /chrome ----
        case "chrome":
        case "browser": {
          void (async () => {
            const { browserOpen, browserClose, isBrowserOpen } = await import("../browser.js");
            if (arg === "close" || arg === "stop") {
              const result = await browserClose();
              agent.addSystemMessage(result);
            } else if (isBrowserOpen()) {
              agent.addSystemMessage("**Browser already open.** The agent can use `browser_navigate`, `browser_screenshot`, etc.\n\nUse `/chrome close` to shut it down.");
            } else {
              const result = await browserOpen();
              agent.addSystemMessage(`${result}\n\nThe agent now has browser tools: \`browser_navigate\`, \`browser_screenshot\`, \`browser_click\`, \`browser_fill\`, \`browser_evaluate\`, \`browser_console\`.`);
            }
          })();
          break;
        }

        // ---- /voice ----
        case "voice": {
          void (async () => {
            const { isVoiceAvailable, listenForVoice } = await import("../voice.js");
            const { available, tool, installHint } = isVoiceAvailable();

            if (!available) {
              agent.addSystemMessage(`**Voice input not available.**\n\n${installHint}`);
              return;
            }

            agent.addSystemMessage(`**Listening...** (${tool}) — speak now, stops on silence.`);

            const result = await listenForVoice();
            if (result.error) {
              agent.addSystemMessage(`**Voice error:** ${result.error}`);
            } else if (!result.text) {
              agent.addSystemMessage("**No speech detected.** Try again with `/voice`.");
            } else {
              agent.addSystemMessage(`**Heard:** "${result.text}"`);
              agent.submit(result.text);
            }
          })();
          break;
        }

        // ---- /release-notes ----
        case "release-notes":
        case "releasenotes":
        case "changelog": {
          try {
            // Try to read CHANGELOG.md from the npm package
            const changelogPaths = [
              path.join(import.meta.dirname || __dirname, "../../CHANGELOG.md"),
              path.join(import.meta.dirname || __dirname, "../CHANGELOG.md"),
              path.join(process.cwd(), "node_modules/workermill/CHANGELOG.md"),
            ];

            let content: string | null = null;
            for (const p of changelogPaths) {
              try {
                if (fs.existsSync(p)) {
                  content = fs.readFileSync(p, "utf-8");
                  break;
                }
              } catch { continue; }
            }

            if (content) {
              agent.addSystemMessage(content);
            } else {
              agent.addSystemMessage(
                "Changelog not found locally. View online:\nhttps://github.com/jarod-rosenthal/workermill/blob/main/cli/CHANGELOG.md"
              );
            }
          } catch (err) {
            logger.debug("Failed to read changelog", { error: err instanceof Error ? err.message : String(err) });
            agent.addSystemMessage(
              "Changelog not found. View online:\nhttps://github.com/jarod-rosenthal/workermill/blob/main/cli/CHANGELOG.md"
            );
          }
          break;
        }

        // ---- /skills ----
        case "skills": {
          const customCmds = loadCustomCommands();
          const lines: string[] = ["**Skills & Custom Commands**\n"];

          if (customCmds.length > 0) {
            lines.push("**Custom Commands** (`.workermill/commands/` or `~/.workermill/commands/`):\n");
            lines.push("| Command | Description |");
            lines.push("|---|---|");
            for (const c of customCmds) {
              lines.push(`| \`/${c.name}\` | ${c.description} |`);
            }
          } else {
            lines.push("No custom commands found.\n");
            lines.push("Create `.workermill/commands/deploy.md` to add `/deploy`:\n");
            lines.push("```markdown");
            lines.push("---");
            lines.push("name: deploy");
            lines.push("description: Deploy to production");
            lines.push("---");
            lines.push("Run the deploy script and report results.");
            lines.push("```");
          }

          agent.addSystemMessage(lines.join("\n"));
          break;
        }

        // ---- /as <persona> <task> ----
        case "as": {
          if (!arg || !arg.includes(" ")) {
            const allPersonas = listAvailablePersonas();
            agent.addSystemMessage(
              "**Usage:** `/as <persona> <task>`\n\n" +
              "Run a task with a specific expert persona's system prompt.\n\n" +
              `**Available:** ${allPersonas.join(", ")}\n\n` +
              "**Example:** \`/as security_engineer review the auth middleware for vulnerabilities\`"
            );
          } else {
            const spaceIdx2 = arg.indexOf(" ");
            const personaSlug = arg.slice(0, spaceIdx2).replace(/-/g, "_");
            const task = arg.slice(spaceIdx2 + 1).trim();
            const p = loadPersona(personaSlug);
            if (!p) {
              agent.addSystemMessage(`Persona \`${personaSlug}\` not found. Use \`/personas\` to list all.`);
            } else {
              // Prepend persona context to the task so the agent adopts the role
              const personaPrefix =
                `[Acting as **${p.name}** — ${p.description}]\n\n` +
                `## Expert Instructions\n\n${p.systemPrompt}\n\n` +
                `## Task\n\n`;
              agent.submit(personaPrefix + task);
            }
          }
          break;
        }

        // ---- /remember ----
        case "remember": {
          if (!arg) {
            agent.addSystemMessage("**Usage:** `/remember <text>` — save a memory for this project\n\nExamples:\n- `/remember This project uses Prisma, not Sequelize`\n- `/remember Always run migrations before tests`");
          } else {
            const mem = addMemory("preference", arg);
            agent.addSystemMessage(`**Remembered:** ${mem.content}`);
          }
          break;
        }

        // ---- /forget ----
        case "forget": {
          if (!arg) {
            agent.addSystemMessage("**Usage:** `/forget <text>` — remove a memory matching the text");
          } else {
            const removed = removeMemory(arg);
            agent.addSystemMessage(removed ? `**Forgot:** memory matching "${arg}"` : `No memory found matching "${arg}". Use \`/memories\` to list all.`);
          }
          break;
        }

        // ---- /memories ----
        case "memories":
        case "memory": {
          const memories = loadMemories();
          if (memories.length === 0) {
            agent.addSystemMessage("No memories saved for this project.\n\nMemories are saved automatically when the agent discovers something, or manually with `/remember <text>`.");
          } else {
            const lines = ["**Project Memories**\n"];
            const typeLabels: Record<string, string> = { learning: "Learning", preference: "Preference", context: "Context", correction: "Correction" };
            for (const m of memories) {
              lines.push(`- **[${typeLabels[m.type] || m.type}]** ${m.content} \`(${m.id})\``);
            }
            lines.push(`\n${memories.length} memories. Use \`/forget <id or text>\` to remove.`);
            agent.addSystemMessage(lines.join("\n"));
          }
          break;
        }

        // ---- /personas ----
        case "personas": {
          const allPersonas = listAvailablePersonas();

          if (!arg) {
            // List all personas with source
            const lines: string[] = ["**Personas**\n"];
            const projectDir = path.join(props.workingDir, ".workermill", "personas");
            const userDir = path.join(os.homedir(), ".workermill", "personas");

            for (const slug of allPersonas) {
              const p = loadPersona(slug);
              if (!p) continue;
              let source = "built-in";
              if (fs.existsSync(path.join(projectDir, `${slug.replace(/_/g, "-")}.md`)) ||
                  fs.existsSync(path.join(projectDir, `${slug}.md`))) {
                source = "project";
              } else if (fs.existsSync(path.join(userDir, `${slug.replace(/_/g, "-")}.md`)) ||
                         fs.existsSync(path.join(userDir, `${slug}.md`))) {
                source = "user";
              }
              lines.push(`- **${p.name}** (\`${slug}\`) — ${p.description} [${source}]`);
            }

            lines.push("\n**Customize:**");
            lines.push("- `/personas show <name>` — view a persona's prompt");
            lines.push("- `/personas create <name>` — scaffold a custom persona");
            lines.push("- Override built-ins by placing a file in `.workermill/personas/` or `~/.workermill/personas/`");

            agent.addSystemMessage(lines.join("\n"));
          } else if (arg.startsWith("show ")) {
            const slug = arg.slice(5).trim().replace(/-/g, "_");
            const p = loadPersona(slug);
            if (!p) {
              agent.addSystemMessage(`Persona \`${slug}\` not found. Use \`/personas\` to list all.`);
            } else {
              agent.addSystemMessage(
                `**${p.name}** (\`${p.slug}\`)\n\n` +
                `**Description:** ${p.description}\n` +
                `**Tools:** ${p.tools.join(", ")}\n\n` +
                `**System Prompt:**\n\`\`\`\n${p.systemPrompt}\n\`\`\``
              );
            }
          } else if (arg.startsWith("create ")) {
            const slug = arg.slice(7).trim().replace(/\s+/g, "_").toLowerCase();
            const personaDir = path.join(props.workingDir, ".workermill", "personas");
            const personaPath = path.join(personaDir, `${slug}.md`);

            if (fs.existsSync(personaPath)) {
              agent.addSystemMessage(`Persona \`${slug}\` already exists at \`${personaPath}\`. Edit it directly.`);
            } else {
              if (!fs.existsSync(personaDir)) fs.mkdirSync(personaDir, { recursive: true });
              const template = `---\nname: ${slug.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}\nslug: ${slug}\ndescription: Custom ${slug.replace(/_/g, " ")} persona\ntools: [bash, read_file, write_file, edit_file, patch, glob, grep, ls, fetch, sub_agent]\n---\n\nYou are a senior ${slug.replace(/_/g, " ")}. Write clean, production-ready code.\n\n<!-- Customize this prompt for your project -->\n`;
              fs.writeFileSync(personaPath, template, "utf-8");
              agent.addSystemMessage(
                `**Created** \`.workermill/personas/${slug}.md\`\n\n` +
                "Edit the file to customize the system prompt, tools, and description. " +
                "This persona will override the built-in one with the same name, or be available as a new persona for the planner to assign."
              );
            }
          } else {
            agent.addSystemMessage("Usage: `/personas`, `/personas show <name>`, `/personas create <name>`");
          }
          break;
        }

        // ---- /mcp ----
        case "mcp": {
          const config = loadConfig();
          const mcpConfig = config?.mcp;
          if (!mcpConfig || Object.keys(mcpConfig).length === 0) {
            agent.addSystemMessage(
              "**No MCP servers configured.**\n\n" +
              "Add MCP servers to `~/.workermill/cli.json`:\n\n" +
              "```json\n\"mcp\": {\n  \"my-server\": {\n    \"command\": \"npx\",\n    \"args\": [\"-y\", \"my-mcp-server\"]\n  }\n}\n```\n\n" +
              "Servers start automatically when the CLI launches."
            );
          } else {
            const lines: string[] = ["**MCP Servers**\n"];
            for (const [name, cfg] of Object.entries(mcpConfig)) {
              lines.push(`- **${name}** — \`${cfg.command}${cfg.args ? " " + cfg.args.join(" ") : ""}\``);
            }
            agent.addSystemMessage(lines.join("\n"));
          }
          break;
        }

        // ---- /schedule ----
        case "schedule": {
          void (async () => {
            const { createSchedule, listSchedules, deleteSchedule } = await import("../schedule.js") as any;

            if (!arg) {
              // List schedules
              const schedules = listSchedules();
              if (schedules.length === 0) {
                agent.addSystemMessage(
                  "**No scheduled tasks.**\n\n" +
                  "Usage:\n" +
                  "- `/schedule \"review PRs\" every day at 9am`\n" +
                  "- `/schedule \"dep audit\" every monday`\n" +
                  "- `/schedule list`\n" +
                  "- `/schedule delete <name>`"
                );
              } else {
                const rows = schedules.map((s: any) =>
                  `| ${s.name} | \`${s.cron}\` | \`${s.prompt.slice(0, 40)}\` | ${new Date(s.createdAt).toLocaleDateString()} |`
                ).join("\n");
                agent.addSystemMessage(
                  `**Scheduled Tasks**\n\n| Name | Schedule | Prompt | Created |\n|---|---|---|---|\n${rows}\n\n` +
                  "Use `/schedule delete <name>` to remove."
                );
              }
            } else if (arg.startsWith("delete ")) {
              const name = arg.slice(7).trim();
              const result = deleteSchedule(name);
              agent.addSystemMessage(result.message);
            } else if (arg === "list") {
              // Same as no arg — list schedules
              const schedules = listSchedules();
              if (schedules.length === 0) {
                agent.addSystemMessage("No scheduled tasks.");
              } else {
                const rows = schedules.map((s: any) =>
                  `- **${s.name}** — \`${s.cron}\` — "${s.prompt.slice(0, 50)}"`
                ).join("\n");
                agent.addSystemMessage(`**Scheduled Tasks**\n\n${rows}`);
              }
            } else {
              // Parse: /schedule "name" <schedule>
              // or: /schedule <prompt> <schedule>
              const quoteMatch = arg.match(/^"([^"]+)"\s+(.+)$/);
              if (quoteMatch) {
                const [, name, schedule] = quoteMatch;
                const result = createSchedule(name, name, schedule, props.workingDir);
                agent.addSystemMessage(result.message);
              } else {
                // Try to split at known schedule keywords
                const scheduleKeywords = ["every", "daily", "weekly", "hourly", "at "];
                let splitIdx = -1;
                for (const kw of scheduleKeywords) {
                  const idx = arg.toLowerCase().indexOf(kw);
                  if (idx > 0) { splitIdx = idx; break; }
                }

                if (splitIdx > 0) {
                  const prompt = arg.slice(0, splitIdx).trim();
                  const schedule = arg.slice(splitIdx).trim();
                  const result = createSchedule(prompt, prompt, schedule, props.workingDir);
                  agent.addSystemMessage(result.message);
                } else {
                  agent.addSystemMessage(
                    "**Usage:**\n" +
                    "- `/schedule \"review PRs\" every day at 9am`\n" +
                    "- `/schedule check CI failures every hour`\n" +
                    "- `/schedule dep audit weekly`"
                  );
                }
              }
            }
          })();
          break;
        }

        // ---- Unknown slash command (or custom command) ----
        default: {
          // Check custom commands before reporting unknown
          const customCommands = loadCustomCommands();
          const customCmd = customCommands.find(c => c.name === cmd);
          if (customCmd) {
            agent.addUserMessage(`/${cmd}${arg ? " " + arg : ""}`);
            agent.submit(customCmd.prompt + (arg ? `\n\nAdditional context: ${arg}` : ""));
            break;
          }
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
      onCancel={orchestrator.running ? orchestrator.cancel : agent.cancel}
      onRollback={agent.rollback}
      onCyclePermissionMode={agent.cyclePermissionMode}
      permissionMode={agent.permissionMode}
      messages={agent.messages}
      status={orchestrator.running ? "tool_running" : agent.status}
      statusDetail={orchestrator.running ? orchestrator.statusMessage : agent.statusDetail}
      permissionRequest={agent.permissionRequest}
      orchestratorConfirm={orchestrator.confirmRequest}
      orchestratorStatus={orchestrator.statusMessage}
      buildPreviewLine={orchestrator.previewLine}
      streamingToolCalls={agent.streamingToolCalls}
      tokens={agent.tokens}
      cost={agent.cost}
      gitBranch={gitBranch}
      inputHistory={inputHistory}
      roleModels={props.roleModels}
      toolCounts={agent.toolCounts}
      sessionStart={agent.sessionStart}
    />
  );
}
