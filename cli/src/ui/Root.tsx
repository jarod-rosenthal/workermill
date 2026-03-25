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
import { loadConfig, saveConfig } from "../config.js";
import { loadCustomCommands } from "../custom-commands.js";
import { stopAllMCPServers } from "../mcp-client.js";
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
| \`/retry\` | Re-plan and re-run the last build task |
| \`/settings\` | View/change settings (review, ollama, etc.) |
| \`/undo\` | Revert last build's changes (git stash or reset) |
| \`/diff\` | Preview uncommitted changes |
| \`/plan\` | Toggle plan mode (read-only, explore before committing) |
| \`/trust\` | Auto-approve all tool calls for this session |
| \`/init\` | Generate \`.workermill/instructions.md\` for this project |
| \`/model\` | Show or switch model (\`/model provider/model\`) |
| \`/cost\` | Session cost and token usage |
| \`/status\` | Session info |
| \`/git\` | Git branch and status |
| \`/sessions\` | List/switch sessions |
| \`/log\` | Show recent CLI log entries |
| \`/hooks\` | Show configured pre/post tool hooks |
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

  // Track the last build task for /retry
  const lastBuildTask = useRef<string | null>(null);

  // Auto-start build if launched via `wm build "task"`
  const buildStarted = useRef(false);
  useEffect(() => {
    if (props.initialBuildTask && !buildStarted.current) {
      buildStarted.current = true;
      lastBuildTask.current = props.initialBuildTask;
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
              "Note: takes effect on the next prompt. The current conversation continues with the new model."
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
            lastBuildTask.current = arg;
            agent.addUserMessage(`/build ${arg}`);
            orchestrator.start(arg, props.trustAll, props.sandboxed);
          }
          break;
        }

        // ---- /retry ----
        case "retry": {
          if (orchestrator.running) {
            agent.addSystemMessage("Orchestration is already running. Wait for it to complete.");
          } else if (!lastBuildTask.current) {
            agent.addSystemMessage("No previous build to retry. Use `/build <task>` first.");
          } else {
            const task = lastBuildTask.current;
            agent.addUserMessage(`/retry ${task.slice(0, 60)}...`);
            orchestrator.start(task, props.trustAll, props.sandboxed);
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
              const truncated = diff.length > 3000 ? diff.slice(0, 3000) + "\n... (truncated, use !git diff for full output)" : diff;
              parts.push(`**Diff:**\n\`\`\`diff\n${truncated}\n\`\`\``);
            }

            if (parts.length === 0) {
              agent.addSystemMessage("No changes. Working tree is clean.");
            } else {
              agent.addSystemMessage(parts.join("\n\n"));
            }
          } catch {
            agent.addSystemMessage("Not a git repository, or git is not installed.");
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
            const approvalThreshold = config.review?.approvalThreshold ?? 80;
            const autoRevise = config.review?.autoRevise ?? false;
            const useCritic = config.review?.useCritic ?? false;

            agent.addSystemMessage(
              `**Settings** (\`~/.workermill/cli.json\`)\n\n` +
              `| Setting | Value | Command |\n` +
              `|---|---|---|\n` +
              `| Ollama host | \`${ollamaHost}\` | \`/settings ollama.host <url>\` |\n` +
              `| Ollama context | ${ollamaCtx} | \`/settings ollama.context <n>\` |\n` +
              `| Review enabled | ${reviewEnabled} | \`/settings review.enabled <true/false>\` |\n` +
              `| Max revisions | ${maxRevisions} | \`/settings review.maxRevisions <n>\` |\n` +
              `| Approval threshold | ${approvalThreshold} | \`/settings review.threshold <n>\` |\n` +
              `| Auto-revise | ${autoRevise} | \`/settings review.autoRevise <true/false>\` |\n` +
              `| Critic pass | ${useCritic} | \`/settings review.critic <true/false>\` |`
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
              case "review.critic": {
                config.review = { ...config.review, useCritic: boolVal(value) };
                break;
              }
              default:
                agent.addSystemMessage(`Unknown setting: \`${key}\`. Type \`/settings\` to see all options.`);
                break;
            }

            if (["ollama.host", "ollama.context", "review.enabled", "review.maxRevisions", "review.threshold", "review.autoRevise", "review.critic"].includes(key)) {
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

        // ---- /quit, /exit ----
        case "quit":
        case "exit":
        case "q": {
          stopAllMCPServers();
          exit();
          // Force process exit — Ink's exit() only stops rendering but
          // dangling listeners (stdin, timers) can keep the process alive.
          setTimeout(() => process.exit(0), 100);
          break;
        }

        // ---- /init ----
        case "init": {
          const instructionsPath = path.join(props.workingDir, ".workermill", "instructions.md");
          if (fs.existsSync(instructionsPath) && !arg?.includes("--force")) {
            agent.addSystemMessage(`\`.workermill/instructions.md\` already exists. Use \`/init --force\` to overwrite.`);
            break;
          }

          // Gather project info
          const initParts: string[] = ["# Project Instructions\n"];

          // Package.json
          try {
            const pkg = JSON.parse(fs.readFileSync(path.join(props.workingDir, "package.json"), "utf-8"));
            initParts.push(`## Project: ${pkg.name || "unknown"}`);
            if (pkg.description) initParts.push(pkg.description);
            initParts.push("");
            if (pkg.scripts) {
              initParts.push("## Available Scripts");
              for (const [name, scriptCmd] of Object.entries(pkg.scripts)) {
                initParts.push(`- \`npm run ${name}\` — ${scriptCmd}`);
              }
              initParts.push("");
            }
            if (pkg.dependencies) {
              initParts.push(`## Key Dependencies`);
              initParts.push(Object.keys(pkg.dependencies as Record<string, string>).slice(0, 20).map(d => `- ${d}`).join("\n"));
              initParts.push("");
            }
          } catch { /* no package.json */ }

          // Python
          try {
            if (fs.existsSync(path.join(props.workingDir, "requirements.txt"))) {
              const reqs = fs.readFileSync(path.join(props.workingDir, "requirements.txt"), "utf-8").trim();
              initParts.push("## Python Dependencies");
              initParts.push("```");
              initParts.push(reqs.split("\n").slice(0, 20).join("\n"));
              initParts.push("```\n");
            }
          } catch { /* ignore */ }

          // pyproject.toml
          try {
            if (fs.existsSync(path.join(props.workingDir, "pyproject.toml"))) {
              initParts.push("## Python Project");
              initParts.push("Uses pyproject.toml for configuration.\n");
            }
          } catch { /* ignore */ }

          // Docker
          try {
            if (fs.existsSync(path.join(props.workingDir, "Dockerfile")) || fs.existsSync(path.join(props.workingDir, "docker-compose.yml"))) {
              initParts.push("## Docker");
              initParts.push("This project uses Docker for containerization.\n");
            }
          } catch { /* ignore */ }

          // Git info
          try {
            const remoteUrl = execSync("git remote get-url origin 2>/dev/null", {
              cwd: props.workingDir, encoding: "utf-8", timeout: 3000,
            }).trim();
            if (remoteUrl) initParts.push(`## Repository\n${remoteUrl}\n`);
          } catch { /* ignore */ }

          // Directory structure
          try {
            const tree = execSync("find . -maxdepth 2 -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.workermill/*' -not -path '*/dist/*' -not -path '*/build/*' | head -30", {
              cwd: props.workingDir, encoding: "utf-8", timeout: 5000,
            }).trim();
            if (tree) {
              initParts.push("## File Structure (top-level)");
              initParts.push("```");
              initParts.push(tree);
              initParts.push("```\n");
            }
          } catch { /* ignore */ }

          initParts.push("## Coding Standards\n");
          initParts.push("<!-- Add your project-specific rules here -->");
          initParts.push("<!-- Examples: -->");
          initParts.push("<!-- - Use TypeScript strict mode -->");
          initParts.push("<!-- - Always write tests for new features -->");
          initParts.push("<!-- - Use conventional commits -->\n");

          // Write the file
          const initDir = path.dirname(instructionsPath);
          if (!fs.existsSync(initDir)) fs.mkdirSync(initDir, { recursive: true });
          fs.writeFileSync(instructionsPath, initParts.join("\n"), "utf-8");

          agent.addSystemMessage(`**Created** \`.workermill/instructions.md\`\n\nEdit it to add your coding standards and project-specific rules. All agents will read this file automatically.`);
          break;
        }

        // ---- /log ----
        case "log": {
          const logPath = path.join(props.workingDir, ".workermill", "cli.log");
          try {
            if (!fs.existsSync(logPath)) {
              agent.addSystemMessage("No log file found at `.workermill/cli.log`");
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
      messages={agent.messages}
      status={orchestrator.running ? "tool_running" : agent.status}
      statusDetail={orchestrator.running ? orchestrator.statusMessage : agent.statusDetail}
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
