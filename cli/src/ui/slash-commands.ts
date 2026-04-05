/**
 * Extracted slash-command handler — pure logic, no React dependency.
 *
 * Every reference that previously read from the React component (agent, props,
 * orchestrator, useRef) is now accessed through the `SlashCommandContext`
 * interface so the logic can be tested without Ink.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { listSessions, saveSession } from "../session.js";
import { loadConfig, saveConfig, loadProjectSettings, saveProjectSettings, loadLocalSettings, PermissionRuleConfig } from "../config.js";
import chalk from "chalk";
import { loadCustomCommands } from "../custom-commands.js";
import { loadPersona, listAvailablePersonas } from "../personas.js";
import { stopAllMCPServers, getMCPTools, hasMCPServers, hasMCPRegistered, getMCPServerInfo } from "../mcp-client.js";
import { getRetryableRun } from "../ship-state.js";
import { shutdown as shutdownLSP } from "../../../packages/engine/src/tools/lsp.js";
import { cleanupStaleWorktrees } from "../../../packages/engine/src/tools/sub-agent.js";
import { undoLast, undoFile, listCheckpoints, clearCheckpoints } from "../checkpoints.js";
import * as logger from "../logger.js";
import { loadMemories, addMemory, removeMemory } from "../memory.js";
import { findModelInfo } from "../provider-registry.js";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Ticket reference detection
// ---------------------------------------------------------------------------

/** Detect if input is a ticket reference. Returns { system, key } or null. */
function detectTicketRef(input: string): { system: "github" | "external"; key: string } | null {
  // Normalize: collapse whitespace, trim
  const trimmed = input.trim().replace(/\s+/g, "");
  // GitHub: #11, GH-11, GH11, GH #11, GH#11 (space collapsed above)
  if (/^#\d+$/.test(trimmed) || /^GH[-#]?\d+$/i.test(trimmed)) {
    return { system: "github", key: trimmed };
  }
  // Jira/Linear: PROJ-123
  if (/^[A-Z][A-Z0-9]+-\d+$/i.test(trimmed)) {
    return { system: "external", key: trimmed };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Session goodbye — prints a brief summary on exit
// ---------------------------------------------------------------------------

export function printSessionGoodbye(ctx: SlashCommandContext): void {
  const elapsed = ctx.session.startedAt
    ? Math.round((Date.now() - new Date(ctx.session.startedAt).getTime()) / 1000)
    : 0;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const parts: string[] = [timeStr];
  if (ctx.session.totalTokens > 0) {
    const k = (ctx.session.totalTokens / 1000).toFixed(1);
    parts.push(`${k}k tokens`);
  }
  if (ctx.cost > 0) {
    parts.push(`~$${ctx.cost.toFixed(2)}`);
  }
  // Git diffstat — insertions/deletions are more useful than message count
  try {
    const stat = execSync("git diff --shortstat HEAD 2>/dev/null || git diff --shortstat 2>/dev/null", {
      encoding: "utf-8",
      cwd: ctx.workingDir,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (stat) {
      // "3 files changed, 45 insertions(+), 12 deletions(-)"
      const ins = stat.match(/(\d+) insertion/);
      const del = stat.match(/(\d+) deletion/);
      const files = stat.match(/(\d+) file/);
      const diffParts: string[] = [];
      if (files) diffParts.push(`${files[1]} files`);
      if (ins) diffParts.push(`+${ins[1]}`);
      if (del) diffParts.push(`-${del[1]}`);
      if (diffParts.length > 0) parts.push(diffParts.join(", "));
    }
  } catch { /* not a git repo or no changes */ }

  console.log(chalk.dim(`\n  ${parts.join(" · ")}`));
  console.log();
}

// ---------------------------------------------------------------------------
// Public helpers (also used by Root.tsx for periodic branch refresh)
// ---------------------------------------------------------------------------

export function getGitBranch(): string {
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

export function getGitStatus(cwd: string): string {
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
// Built-in command names — custom commands with these names will be shadowed
// ---------------------------------------------------------------------------

export const BUILTIN_COMMANDS = new Set([
  "allow", "as", "ask", "bell", "browser", "build", "changelog", "chrome",
  "cancel", "clear", "compact", "config", "cost", "deny", "diff", "editor", "exit",
  "forget", "git", "h", "help", "hooks", "init", "key", "log", "mcp",
  "memories", "memory", "model", "permissions", "personas", "q", "quit",
  "pause", "release-notes", "releasenotes", "remember", "reset", "retry", "review",
  "route", "sandbox", "schedule", "sessions", "settings", "setup", "ship",
  "skills", "status", "trust", "undo", "update", "voice",
]);

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

export const HELP_TEXT = `**WorkerMill** — AI coding agent for your terminal.

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
| \`/pause\` | Pause or resume a running \`/ship\` orchestration |
| \`/cancel\` | Cancel the current running operation (same as \`ESC\`) |
| \`/as <persona> <task>\` | Run a task with a specific expert (\`/as security_engineer audit auth\`) |
| \`/review [task]\` | Code review using the tech lead (defaults to recent changes) |
| \`/retry\` | Re-plan and re-run the last task |
| \`/model [provider/model]\` | Switch worker model (\`/model ollama/qwen3-coder:30b 256k\`) |
| \`/model planner [provider/model]\` | Switch planner model (\`/model planner google/gemini-3.1-pro\`) |
| \`/model reviewer [provider/model]\` | Switch reviewer model (\`/model reviewer openai/gpt-5.3-codex\`) |
| \`/init\` | Generate or validate \`WORKERMILL.md\` |
| \`/compact [focus]\` | Compress conversation (\`/compact focus on the API changes\`) |
| \`/settings\` | View/change settings (review, ollama, routing, keys) |
| \`/settings key <provider> <key>\` | Add an API key inline |
| \`/permissions\` | Manage tool permissions (trust/ask/allow/deny) |
| \`/trust\` | Auto-approve all tools for this session |
| \`/undo\` | Revert last build's changes |
| \`/diff\` | Preview uncommitted changes |
| \`/git\` | Git branch and status |
| \`/personas\` | List, show, or create personas |
| \`/remember <text>\` | Save a project memory |
| \`/forget <id>\` | Remove a memory |
| \`/memories\` | View saved memories |
| \`/sessions\` | List/switch sessions |
| \`/cost\` | Session cost and token usage |
| \`/status\` | Session info |
| \`/setup\` | Re-run provider setup wizard |
| \`/clear\` | Reset conversation |
| \`/skills\` | Custom commands from \`.workermill/commands/\` |
| \`/hooks\` | View pre/post tool hooks |
| \`/mcp\` | MCP server status |
| \`/log\` | Recent CLI log entries |
| \`/editor\` | Open \\$EDITOR for longer input |
| \`/chrome\` | Headless Chrome *(experimental)* |
| \`/voice\` | Voice input *(experimental)* |
| \`/schedule\` | Scheduled tasks *(experimental)* |
| \`/update\` | Check for updates |
| \`/release-notes\` | Show changelog |
| \`/quit\` | Exit |

**Shortcuts:** \`!command\` runs shell, \`ESC\` cancels, \`ESC ESC\` rolls back, \`Ctrl+P\` pause/resume \`/ship\`, \`Shift+Tab\` cycles permissions, \`Ctrl+C\` exits (or cancels while running), \`←/→\` cursor, \`Tab\` autocomplete.

---

**Quality Gates & Spec Check** *(off by default — enable in \`.workermill/config.json\`)*

| Option | What it does |
|---|---|
| \`review.specCheck: true\` | Before planning: prompts you to answer up to 3 ambiguities in your task description |
| \`review.verifyEnabled: true\` | After workers finish: runs planner-generated output assertions before the reviewer sees the diff |
| \`qualityGates: [{name, commands}]\` | Static project-wide assertions that run on every \`/ship\` — use for invariants like "app starts" |

Gate failures are passed to the tech lead reviewer as context. No retry loop — failures are flagged as must-fix during review.

See \`cli/docs/quality-gates.md\` for full documentation and examples.`;

// ---------------------------------------------------------------------------
// Context interface
// ---------------------------------------------------------------------------

export interface SlashCommandContext {
  addSystemMessage: (content: string) => void;
  addUserMessage: (content: string) => void;
  submit: (input: string, displayText?: string) => void;
  provider: string;
  model: string;
  workingDir: string;
  session: {
    id: string;
    messages: any[];
    totalTokens: number;
    startedAt: string;
    name?: string;
    provider: string;
    model: string;
  };
  cost: number;
  tokens: number;
  permissionMode: string;
  trustAll: boolean;
  /** Live getter for trust-all state — reads current mode, not the value at /ship launch */
  isTrustAll: () => boolean;
  planMode: boolean;
  setPlanMode: (v: boolean) => void;
  setTrustAll: (v: boolean) => void;
  allowTool: (name: string) => void;
  denyTool: (name: string) => void;
  orchestratorRunning: boolean;
  orchestratorPaused: boolean;
  pauseOrchestrator: () => void;
  resumeOrchestrator: () => void;
  cancelCurrentOperation: () => void;
  isBusy: boolean;
  startOrchestrator: (task: string, trustAll: boolean | (() => boolean), sandboxed: boolean | "os", ticketKey?: string) => void;
  retryOrchestrator: (trustAll: boolean | (() => boolean), sandboxed: boolean | "os") => boolean;
  startReview: (trustAll: boolean | (() => boolean), sandboxed: boolean | "os", target?: string) => void;
  lastBuildTask: string | null;
  setLastBuildTask: (task: string) => void;
  sandboxed?: boolean | "os";
  exit?: () => void;
  switchModel?: (provider: string, model: string) => void;
  updateRoleModels?: () => void;
  forceCompact?: (focusInstructions?: string) => Promise<{ before: number; after: number }>;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Dispatch a slash command. Returns `true` if the input was handled,
 * `false` if it's not a slash command.
 */
export function handleSlashCommand(input: string, ctx: SlashCommandContext): boolean {
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
      ctx.addSystemMessage(HELP_TEXT);
      const customCmds = loadCustomCommands();
      if (customCmds.length > 0) {
        const customTable = customCmds.map(c => `| \`/${c.name}\` | ${c.description} |`).join("\n");
        ctx.addSystemMessage(
          `**Custom Commands**\n\n| Command | Description |\n|---|---|\n${customTable}`
        );
      }
      break;
    }

    // ---- /model ----
    case "model": {
      if (!arg) {
        ctx.addSystemMessage(
          `**Current model:** ${ctx.provider}/${ctx.model}\n\n` +
          "**Switch models:**\n" +
          "| What | Command |\n" +
          "|---|---|\n" +
          "| Worker model | `/model <provider>/<model>` |\n" +
          "| Planner model | `/model planner <provider>/<model>` |\n" +
          "| Reviewer model | `/model reviewer <provider>/<model>` |\n\n" +
          "Example: `/model reviewer openai/gpt-5.3-codex`\n\n" +
          "**Context window:** Add size after model name for local models:\n" +
          "`/model ollama/qwen3-coder:30b 64k` or `/model lmstudio/deepseek-r1 128k`\n" +
          "Local models default to 128k if not specified.\n\n" +
          "**Supported providers:** ollama, lmstudio, anthropic, openai, google\n\n" +
          "**Tip:** For a full catalog of available models, run \`wm models\` outside a session."
        );
      } else {
        // Detect role prefix: /model planner|reviewer <provider>/<model>
        const roleAliases: Record<string, string> = { planner: "planner", reviewer: "tech_lead", "tech_lead": "tech_lead" };
        const tokens = arg.split(/\s+/);
        let targetRole: string | null = null;
        let targetRoleDisplay: string | null = null;
        if (tokens.length >= 2 && roleAliases[tokens[0].toLowerCase()]) {
          targetRoleDisplay = tokens[0].toLowerCase();
          targetRole = roleAliases[targetRoleDisplay];
          tokens.shift(); // remove role prefix, rest is provider/model
        }
        const modelArg = tokens[0];
        // Check for optional context size (e.g. "256k", "128k", "1m")
        let contextOverride: number | undefined;
        let remainderStart = 1;
        if (tokens[1] && /^\d+[km]$/i.test(tokens[1])) {
          const ctxStr = tokens[1].toLowerCase();
          if (ctxStr.endsWith("m")) {
            contextOverride = parseInt(ctxStr, 10) * 1_048_576;
          } else {
            contextOverride = parseInt(ctxStr, 10) * 1024;
          }
          remainderStart = 2;
        }
        const remainder = tokens.slice(remainderStart).join(" ").trim();
        const modelParts = modelArg.split("/");
        let newProvider: string;
        let newModel: string;
        if (modelParts.length >= 2) {
          newProvider = modelParts[0];
          newModel = modelParts.slice(1).join("/");
        } else {
          newProvider = ctx.provider;
          newModel = modelArg;
        }

        // Check if the provider needs an API key and whether we have one
        const envKeyMap: Record<string, string> = {
          anthropic: "ANTHROPIC_API_KEY",
          openai: "OPENAI_API_KEY",
          google: "GOOGLE_GENERATIVE_AI_API_KEY",
          xai: "XAI_API_KEY",
          groq: "GROQ_API_KEY",
          deepseek: "DEEPSEEK_API_KEY",
          mistral: "MISTRAL_API_KEY",
        };
        const needsKey = !!envKeyMap[newProvider];
        const modelConfig = loadConfig();
        const existingProviderConfig = modelConfig?.providers?.[newProvider];
        const hasConfigKey = !!existingProviderConfig?.apiKey;
        const envVar = envKeyMap[newProvider];
        const hasEnvKey = !!(envVar && process.env[envVar]);

        if (needsKey && !hasConfigKey && !hasEnvKey) {
          // No credentials — tell the user how to provide them
          ctx.addSystemMessage(
            `**Cannot switch to \`${newProvider}\`** — no API key found.\n\n` +
            `Add your key: \`/settings key ${newProvider} <your-api-key>\`\n` +
            `Then run \`/model ${modelArg}\` again.`
          );
          break;
        }

        // Update config
        if (modelConfig) {
          if (!targetRole) {
            // Worker switch — ensure provider entry exists with correct model, always set as default
            if (!modelConfig.providers[newProvider]) {
              const keyRef = hasEnvKey ? `{env:${envVar}}` : undefined;
              modelConfig.providers[newProvider] = { model: newModel, ...(keyRef ? { apiKey: keyRef } : {}), ...(contextOverride ? { contextLength: contextOverride } : {}) };
            } else {
              modelConfig.providers[newProvider].model = newModel;
              if (contextOverride) modelConfig.providers[newProvider].contextLength = contextOverride;
            }
            modelConfig.default = newProvider;
          } else {
            // Role switch — create base provider entry for API key storage only (no model, to avoid
            // polluting the worker config with the role's model). Create a dedicated role entry.
            if (!modelConfig.providers[newProvider]) {
              const keyRef = hasEnvKey ? `{env:${envVar}}` : undefined;
              modelConfig.providers[newProvider] = { model: "", ...(keyRef ? { apiKey: keyRef } : {}) };
            }
            const roleProviderKey = `${newProvider}_${targetRole}`;
            const baseEntry = modelConfig.providers[newProvider];
            const apiKey = baseEntry?.apiKey || (hasEnvKey ? `{env:${envVar}}` : undefined);
            modelConfig.providers[roleProviderKey] = {
              model: newModel,
              ...(apiKey ? { apiKey } : {}),
              ...(baseEntry?.host ? { host: baseEntry.host } : {}),
              ...(contextOverride ? { contextLength: contextOverride } : {}),
            };
            modelConfig.routing = { ...modelConfig.routing, [targetRole]: roleProviderKey };
          }
          saveConfig(modelConfig);
        }

        // Display
        const ctxLabel = contextOverride
          ? ` (${contextOverride >= 1_048_576 ? `${contextOverride / 1_048_576}M` : `${contextOverride / 1024}k`} context)`
          : "";
        const roleLabel = targetRoleDisplay ? `**${targetRoleDisplay}** ` : "";

        if (targetRole) {
          // Role switch — update status bar
          ctx.addSystemMessage(
            `\n${roleLabel}switched to \`${newProvider}/${newModel}\`${ctxLabel} — active now.`
          );
          ctx.updateRoleModels?.();
        } else if (ctx.switchModel) {
          // Worker switch — hot-swap
          ctx.switchModel(newProvider, newModel);

          const isLocalProvider = newProvider === "ollama" || newProvider === "lmstudio";
          const configCtx = modelConfig?.providers?.[newProvider]?.contextLength;
          const newCtxWindow = contextOverride
            || (isLocalProvider ? configCtx : undefined)
            || findModelInfo(newModel)?.contextWindow
            || (isLocalProvider ? 128_000 : 256_000);
          // Hint: local models default to 128k if no context specified
          const ctxHint = isLocalProvider && !contextOverride && !configCtx
            ? `\n*Tip: Local models default to 128k context. Set explicitly: \`/model ${newProvider}/${newModel} 64k\`*`
            : "";
          if (ctx.tokens > 0 && ctx.tokens > newCtxWindow * 0.8 && ctx.forceCompact) {
            ctx.addSystemMessage(
              `\n**Model switched** to \`${newProvider}/${newModel}\`${ctxLabel || (isLocalProvider ? ` (${newCtxWindow / 1024}k context)` : "")} — compacting conversation to fit...${ctxHint}`
            );
            void ctx.forceCompact().then(({ before, after }) => {
              ctx.addSystemMessage(`Compacted ${before} → ${after} messages.`);
            });
          } else {
            ctx.addSystemMessage(
              `\n**Model switched** to \`${newProvider}/${newModel}\`${ctxLabel || (isLocalProvider ? ` (${newCtxWindow / 1024}k context)` : "")} — active now.${ctxHint}`
            );
          }
        } else {
          ctx.addSystemMessage(
            `**Model switched** to \`${newProvider}/${newModel}\` — config saved. Takes effect on next session.`
          );
        }

        // If there's a trailing command (e.g. "/model openai/gpt-5.4 /as backend_developer do X"),
        // dispatch it as a follow-up slash command.
        if (remainder.startsWith("/")) {
          handleSlashCommand(remainder, ctx);
        } else if (remainder) {
          // Trailing text that isn't a command — submit as a prompt
          ctx.submit(remainder);
        }
      }
      break;
    }

    // ---- /cost ----
    case "cost": {
      const costUsd = ctx.cost;
      const totalTokens = ctx.tokens;
      const sessionMessages = ctx.session.messages.length;
      ctx.addSystemMessage(
        `**Session Cost Estimate**\n\n` +
        `| Metric | Value |\n` +
        `|---|---|\n` +
        `| Model | ${ctx.provider}/${ctx.model} |\n` +
        `| Est. cost | ~$${costUsd.toFixed(2)} |\n` +
        `| Last input tokens | ${totalTokens.toLocaleString()} |\n` +
        `| Session tokens | ${ctx.session.totalTokens.toLocaleString()} |\n` +
        `| Messages | ${sessionMessages} |`
      );
      break;
    }

    // ---- /status ----
    case "status": {
      const session = ctx.session;
      const msgCount = session.messages.length;
      const mode = ctx.permissionMode || "default";
      ctx.addSystemMessage(
        `**Session Status**\n\n` +
        `| Field | Value |\n` +
        `|---|---|\n` +
        `| Session ID | \`${session.id.slice(0, 8)}...\` |\n` +
        `| Provider / Model | ${ctx.provider}/${ctx.model} |\n` +
        `| Messages | ${msgCount} |\n` +
        `| Session tokens | ${session.totalTokens.toLocaleString()} |\n` +
        `| Cost | $${ctx.cost.toFixed(4)} |\n` +
        `| Mode | ${mode} |\n` +
        `| Working dir | \`${ctx.workingDir}\` |\n` +
        `| Started | ${session.startedAt} |`
      );
      break;
    }

    // ---- /review [task] ----
    case "review": {
      if (!arg) {
        ctx.addSystemMessage(
          "**Usage:**\n\n" +
          "| Command | What it reviews |\n" +
          "|---|---|\n" +
          "| `/review branch` | Full diff of the current feature branch vs main |\n" +
          "| `/review diff` | Uncommitted changes only |\n" +
          "| `/review #42` | A GitHub PR by number |\n\n" +
          "Uses your configured reviewer model (`/settings route tech_lead <provider>`)."
        );
        break;
      }
      if (ctx.orchestratorRunning) {
        ctx.addSystemMessage("A build is already running. Wait for it to complete.");
        break;
      }
      ctx.addUserMessage(`/review ${arg}`);
      ctx.startReview(ctx.isTrustAll, ctx.sandboxed ?? "os", arg);
      break;
    }

    // ---- /trust ----
    case "trust": {
      ctx.setTrustAll(true);
      ctx.addSystemMessage(
        "**Trust mode ON.** All non-dangerous tool calls will be auto-approved for this session. " +
        "Dangerous operations (force push, rm -rf, etc.) still require confirmation."
      );
      break;
    }

    // ---- /ship (primary) and /build (alias) ----
    case "ship":
    case "build": {
      if (!arg) {
        ctx.addSystemMessage(
          "**Usage:** `/ship <task>` — accepts inline text, a .md file, or a ticket reference\n\n" +
          "**Examples:**\n" +
          "- `/ship add dark mode to settings` — inline task\n" +
          "- `/ship ./specs/auth-redesign.md` — from spec file\n" +
          "- `/ship #42` — from GitHub Issue\n" +
          "- `/ship PROJ-123` — from Jira/Linear ticket\n\n" +
          "Runs WorkerMill multi-expert orchestration: plans stories, assigns specialist personas, " +
          "executes with tool calls, reviews, and ships.\n\n" +
          "**Note:** Plans on your current branch, then creates a feature branch after you approve. " +
          "Stays on the feature branch when done so you can review, test, and push."
        );
      } else if (ctx.orchestratorRunning) {
        ctx.addSystemMessage("Orchestration is already running. Wait for it to complete.");
      } else {
        // Warn if there's an incomplete run (informational — doesn't block)
        const existing = getRetryableRun(process.cwd());
        if (existing) {
          ctx.addSystemMessage(
            `Note: you have an incomplete run on branch \`${existing.featureBranch}\` ` +
            `(${existing.completedStoryIds.length}/${existing.stories.length} stories done). ` +
            `Use \`/retry\` to continue it instead.`
          );
        }
        // Detect ticket references — pass the key to the orchestrator which
        // handles the async fetch internally (handleSlashCommand is sync).
        const ticketRef = detectTicketRef(arg);
        if (ticketRef) {
          ctx.setLastBuildTask(arg);
          ctx.addUserMessage(`/ship ${ticketRef.key}`);
          ctx.startOrchestrator(ticketRef.key, ctx.isTrustAll, ctx.sandboxed ?? "os", ticketRef.key);
        } else {
          ctx.setLastBuildTask(arg);
          ctx.addUserMessage(`/ship ${arg}`);
          ctx.startOrchestrator(arg, ctx.isTrustAll, ctx.sandboxed ?? "os");
        }
      }
      break;
    }

    // ---- /pause ----
    case "pause": {
      if (!ctx.orchestratorRunning) {
        ctx.addSystemMessage("No `/ship` orchestration is running.");
        break;
      }
      if (ctx.orchestratorPaused) {
        ctx.resumeOrchestrator();
        ctx.addSystemMessage("Resumed orchestration.");
      } else {
        ctx.pauseOrchestrator();
        ctx.addSystemMessage("Paused orchestration. Run `/pause` again to resume.");
      }
      break;
    }

    // ---- /cancel ----
    case "cancel": {
      if (!ctx.isBusy) {
        ctx.addSystemMessage("Nothing is currently running.");
        break;
      }
      ctx.cancelCurrentOperation();
      ctx.addSystemMessage("Cancelling current operation...");
      break;
    }

    // ---- /retry ----
    case "retry": {
      if (ctx.orchestratorRunning) {
        ctx.addSystemMessage("Orchestration is already running. Wait for it to complete.");
      } else {
        ctx.addUserMessage("/retry");
        const started = ctx.retryOrchestrator(ctx.isTrustAll, ctx.sandboxed ?? "os");
        if (!started) {
          ctx.addSystemMessage("Nothing to retry. No incomplete `/ship` runs found for this project.");
        }
      }
      break;
    }

    // ---- /undo ----
    case "undo": {
      // File-level undo via checkpoints (default), or git-level undo via /undo git
      if (arg === "git") {
        // Legacy git-based undo
        try {
          const status = execSync("git status --porcelain 2>/dev/null", {
            cwd: ctx.workingDir, encoding: "utf-8", timeout: 5000,
          }).trim();
          if (!status) {
            try {
              const lastMsg = execSync("git log -1 --format=%s 2>/dev/null", {
                cwd: ctx.workingDir, encoding: "utf-8", timeout: 5000,
              }).trim();
              execSync("git reset HEAD~1", { cwd: ctx.workingDir, encoding: "utf-8", timeout: 5000 });
              ctx.addSystemMessage(`**Undone** last commit: "${lastMsg}"\n\nChanges are now unstaged.`);
            } catch {
              ctx.addSystemMessage("Nothing to undo — no uncommitted changes and no commits to reset.");
            }
          } else {
            const fileCount = status.split("\n").length;
            execSync("git stash push -m 'workermill-undo'", {
              cwd: ctx.workingDir, encoding: "utf-8", timeout: 10000,
            });
            ctx.addSystemMessage(`**Undone** — stashed ${fileCount} changed files.\n\nRecover with \`!git stash pop\` if needed.`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.addSystemMessage(`**Undo failed:** ${msg}`);
        }
      } else if (arg === "list") {
        const cps = listCheckpoints();
        if (cps.length === 0) {
          ctx.addSystemMessage("No file checkpoints in this session.");
        } else {
          const lines = cps.map((cp, i) => `${i + 1}. \`${cp.file}\` (${cp.time})`);
          ctx.addSystemMessage(`**Checkpoints** (${cps.length}):\n${lines.join("\n")}`);
        }
      } else if (arg && isNaN(Number(arg))) {
        // Undo specific file
        const restored = undoFile(arg);
        if (restored) {
          ctx.addSystemMessage(`**Restored** \`${arg}\` to pre-edit state.`);
        } else {
          ctx.addSystemMessage(`No checkpoint found for \`${arg}\`.`);
        }
      } else {
        // Undo last N edits (default 1)
        const count = arg ? parseInt(arg, 10) : 1;
        const restored = undoLast(count);
        if (restored.length === 0) {
          ctx.addSystemMessage("No file checkpoints to undo. Use `/undo git` for git-level undo.");
        } else {
          ctx.addSystemMessage(`**Restored** ${restored.length} file(s):\n${restored.map(f => `- \`${f}\``).join("\n")}`);
        }
      }
      break;
    }

    // ---- /diff ----
    case "diff": {
      try {
        // If on a feature branch, show committed changes vs main/master
        const currentBr = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", {
          cwd: ctx.workingDir, encoding: "utf-8", timeout: 2000,
        }).trim();
        const isFeatureBranch = currentBr && currentBr !== "main" && currentBr !== "master";

        // Determine the base to diff against
        let baseBranch = "";
        if (isFeatureBranch) {
          // Find which of main/master exists
          try {
            execSync("git rev-parse --verify main 2>/dev/null", { cwd: ctx.workingDir, stdio: "pipe" });
            baseBranch = "main";
          } catch {
            try {
              execSync("git rev-parse --verify master 2>/dev/null", { cwd: ctx.workingDir, stdio: "pipe" });
              baseBranch = "master";
            } catch { /* neither exists */ }
          }
        }

        const diffRange = baseBranch ? `${baseBranch}..HEAD` : "";
        const diffStat = execSync(`git diff --stat ${diffRange} 2>/dev/null`, {
          cwd: ctx.workingDir, encoding: "utf-8", timeout: 5000,
        }).trim();
        const untracked = execSync("git ls-files --others --exclude-standard 2>/dev/null", {
          cwd: ctx.workingDir, encoding: "utf-8", timeout: 5000,
        }).trim();
        const diff = execSync(`git diff ${diffRange} 2>/dev/null`, {
          cwd: ctx.workingDir, encoding: "utf-8", timeout: 10000,
        }).trim();

        const parts: string[] = [];
        if (baseBranch) parts.push(`Comparing \`${currentBr}\` to \`${baseBranch}\``);
        if (diffStat) parts.push(`**Changes:**\n\`\`\`\n${diffStat}\n\`\`\``);
        if (untracked) parts.push(`**New files:**\n${untracked.split("\n").map(f => `- \`${f}\``).join("\n")}`);
        if (diff) {
          parts.push(`**Diff:**\n\`\`\`diff\n${diff}\n\`\`\``);
        }

        if (parts.length === 0) {
          ctx.addSystemMessage("No changes. Working tree is clean.");
        } else {
          ctx.addSystemMessage(parts.join("\n\n"));
        }
      } catch (err) {
        logger.debug("/diff command failed", { error: err instanceof Error ? err.message : String(err) });
        ctx.addSystemMessage("Not a git repository, or git is not installed.");
      }
      break;
    }

    // ---- /clear ----
    case "clear": {
      // Reset the session — start fresh while keeping the UI
      const session = ctx.session;
      session.messages = [];
      session.totalTokens = 0;
      saveSession(session);
      ctx.addSystemMessage("Conversation cleared. Starting fresh.");
      break;
    }

    // ---- /compact ----
    case "compact": {
      if (!ctx.forceCompact) {
        ctx.addSystemMessage("Compaction not available.");
        break;
      }
      const msgCount = ctx.session.messages.length;
      if (msgCount <= 2 && ctx.tokens === 0) {
        ctx.addSystemMessage("Nothing to compact — conversation is empty.");
        break;
      }
      ctx.addSystemMessage(`**Compacting...** ~${ctx.tokens.toLocaleString()} tokens${arg ? ` (preserving: ${arg})` : ""}`);
      void ctx.forceCompact(arg || undefined).then(({ before, after }) => {
        ctx.addSystemMessage(`**Compacted.** ~${before.toLocaleString()} → ~${after.toLocaleString()} tokens.`);
      });
      break;
    }

    // ---- /git ----
    case "git": {
      const gitInfo = getGitStatus(ctx.workingDir);
      ctx.addSystemMessage(gitInfo);
      break;
    }

    // ---- /editor ----
    case "editor": {
      const editor = process.env.EDITOR || process.env.VISUAL || "vi";
      const tmpFile = path.join(os.tmpdir(), `workermill-${Date.now()}.md`);
      try {
        fs.writeFileSync(tmpFile, "", "utf-8");
        execSync(`${editor} ${tmpFile}`, {
          cwd: ctx.workingDir,
          stdio: "inherit",
          timeout: 5 * 60 * 1000,
        });
        const contents = fs.readFileSync(tmpFile, "utf-8").trim();
        if (contents) {
          ctx.addUserMessage(contents);
          ctx.submit(contents);
        } else {
          ctx.addSystemMessage("Editor closed with no content. Nothing submitted.");
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        ctx.addSystemMessage(`Failed to open editor (\`${editor}\`): ${errMsg}`);
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
        ctx.addSystemMessage("No config found. Run setup first.");
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
        const autoBranch = config.review?.autoBranch ?? false;
        const sandboxEnabled = config.sandbox !== false;
        const bellEnabled = config.bell === true;
        const allowRules = config.permissions?.allow || [];
        const denyRules = config.permissions?.deny || [];

        ctx.addSystemMessage(
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
          `| Auto checkout branch | ${autoBranch} | \`/settings review.autoBranch <true/false>\` |\n` +
          `| Sandbox | ${sandboxEnabled} | \`/settings sandbox <true/false>\` |\n` +
          `| Beep when /ship finishes | ${bellEnabled} | \`/settings bell <true/false>\` |\n` +
          `| Issue tracker | ${config.ticketSystem || "github"} | \`/settings tickets <github\\|jira\\|linear>\` |\n` +
          `| API keys | — | \`/settings key <provider> <api-key>\` |\n` +
          `| Permission allow rules | ${allowRules.length} rule(s) | Edit \`cli.json\` |\n` +
          `| Permission deny rules | ${denyRules.length} rule(s) | Edit \`cli.json\` |`
        );

        // Show routing if configured
        const routing = config.routing;
        if (routing && Object.keys(routing).length > 0) {
          const routingRows = Object.entries(routing).map(
            ([persona, provider]) => `| ${persona} | ${provider} |`
          );
          ctx.addSystemMessage(
            `\n**Persona Routing** (\`/settings route <persona> <provider>\`)\n\n` +
            `| Persona | Provider |\n|---|---|\n` +
            routingRows.join("\n") +
            `\n\nUnrouted personas use the default provider (\`${config.default}\`).`
          );
        }
      } else {
        // Parse key=value or key value
        const parts = arg.split(/[\s=]+/);
        const key = parts[0];
        const value = parts.slice(1).join(" ");

        if (!value) {
          ctx.addSystemMessage(`Usage: \`/settings ${key} <value>\``);
          break;
        }

        const boolVal = (v: string) => v === "true" || v === "1" || v === "on" || v === "yes";
        const numVal = (v: string) => parseInt(v, 10);
        let settingApplied = true;

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
          case "review.autoBranch": {
            config.review = { ...config.review, autoBranch: boolVal(value) };
            break;
          }
          case "sandbox": {
            config.sandbox = boolVal(value);
            break;
          }
          case "bell": {
            config.bell = boolVal(value);
            break;
          }
          case "tickets": {
            const valid = ["github", "jira", "linear"];
            if (!valid.includes(value)) {
              ctx.addSystemMessage(`Invalid tracker: \`${value}\`. Use one of: ${valid.join(", ")}`);
              settingApplied = false;
              break;
            }
            config.ticketSystem = value as "github" | "jira" | "linear";
            if (value === "jira" && !config.jira) {
              ctx.addSystemMessage("**Switched to Jira.** Now set credentials:\n\n```\n/settings jira.url https://myteam.atlassian.net\n/settings jira.email you@company.com\n/settings jira.token <api-token>\n```");
            } else if (value === "linear" && !config.linear) {
              ctx.addSystemMessage("**Switched to Linear.** Now set your API key:\n\n```\n/settings linear.key <api-key>\n```");
            }
            break;
          }
          case "jira.url": {
            config.jira = { ...config.jira || { baseUrl: "", email: "", apiToken: "" }, baseUrl: value };
            break;
          }
          case "jira.email": {
            config.jira = { ...config.jira || { baseUrl: "", email: "", apiToken: "" }, email: value };
            break;
          }
          case "jira.token": {
            config.jira = { ...config.jira || { baseUrl: "", email: "", apiToken: "" }, apiToken: value };
            break;
          }
          case "linear.key": {
            config.linear = { apiKey: value };
            break;
          }
          case "route": {
            // /settings route <persona> <provider>
            const routeParts = value.split(/\s+/);
            if (routeParts.length < 2) {
              ctx.addSystemMessage("**Usage:** `/settings route <persona> <provider>`\n\nExample: `/settings route backend_developer anthropic`");
              break;
            }
            const [persona, provider] = routeParts;
            if (!config.providers[provider]) {
              ctx.addSystemMessage(`Provider \`${provider}\` not found in config. Available: ${Object.keys(config.providers).join(", ")}\n\nTo add a provider first: \`/settings key ${provider} <api-key>\``);
              settingApplied = false;
              break;
            }
            config.routing = { ...config.routing, [persona]: provider };
            break;
          }
          case "key": {
            // /settings key <provider> <api-key>
            const keyParts = value.split(/\s+/);
            if (keyParts.length < 2) {
              ctx.addSystemMessage("**Usage:** `/settings key <provider> <api-key>`\n\nExample: `/settings key anthropic sk-ant-...`");
              break;
            }
            const [keyProvider, ...keyRest] = keyParts;
            const apiKeyValue = keyRest.join(" ").trim();
            if (!config.providers[keyProvider]) {
              config.providers[keyProvider] = { model: "", apiKey: apiKeyValue };
            } else {
              config.providers[keyProvider].apiKey = apiKeyValue;
            }
            // Also set in process.env so it's immediately usable
            const envNames: Record<string, string> = {
              anthropic: "ANTHROPIC_API_KEY",
              openai: "OPENAI_API_KEY",
              google: "GOOGLE_GENERATIVE_AI_API_KEY",
              xai: "XAI_API_KEY",
              groq: "GROQ_API_KEY",
              deepseek: "DEEPSEEK_API_KEY",
              mistral: "MISTRAL_API_KEY",
            };
            const envName = envNames[keyProvider];
            if (envName) {
              process.env[envName] = apiKeyValue;
            }
            break;
          }
          default:
            ctx.addSystemMessage(`Unknown setting: \`${key}\`. Type \`/settings\` to see all options.`);
            settingApplied = false;
            break;
        }

        if (settingApplied && ["ollama.host", "ollama.context", "review.enabled", "review.maxRevisions", "review.threshold", "review.criticThreshold", "review.autoRevise", "review.critic", "sandbox", "bell", "route", "key", "tickets", "jira.url", "jira.email", "jira.token", "linear.key"].includes(key)) {
          saveConfig(config);
          ctx.addSystemMessage(`**Updated** \`${key}\` → \`${value}\` (saved to ~/.workermill/cli.json)`);
        }
      }
      break;
    }

    // ---- /sessions ----
    case "sessions": {
      const sessions = listSessions(20);
      if (sessions.length === 0) {
        ctx.addSystemMessage("No saved sessions found.");
      } else {
        const rows = sessions.map((s) => {
          const date = new Date(s.startedAt).toLocaleString();
          const name = s.name || s.preview;
          return `| \`${s.id.slice(0, 8)}\` | ${name} | ${s.messageCount} msgs | ${s.totalTokens.toLocaleString()} tokens | ${date} |`;
        });
        ctx.addSystemMessage(
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
        ctx.addSystemMessage("No hooks configured. Add hooks to `~/.workermill/cli.json`:\n\n```json\n\"hooks\": {\n  \"pre\": [{ \"command\": \"echo before\", \"tools\": [\"write_file\"] }],\n  \"post\": [{ \"command\": \"npx eslint --fix\", \"tools\": [\"write_file\", \"edit_file\"] }]\n}\n```");
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
        ctx.addSystemMessage(lines.join("\n"));
      }
      break;
    }

    // ---- /permissions ----
    case "permissions": {
      if (!arg) {
        const modeLabel = ctx.permissionMode || "default";
        const global = loadConfig();
        const pSettings = loadProjectSettings();
        const lSettings = loadLocalSettings();

        // Collect rules with sources
        const rules: Array<{ rule: string; type: "allow" | "ask" | "deny"; source: "global" | "project" | "local" }> = [];

        const addRules = (config: PermissionRuleConfig | null | undefined, source: "global" | "project" | "local") => {
          if (!config) return;
          config.allow?.forEach(rule => rules.push({ rule, type: "allow", source }));
          config.ask?.forEach(rule => rules.push({ rule, type: "ask", source }));
          config.deny?.forEach(rule => rules.push({ rule, type: "deny", source }));
        };

        addRules(global?.permissions, "global");
        addRules(pSettings, "project");
        addRules(lSettings, "local");

        const rulesInfo = rules.length > 0
          ? `\n\n**Rules (${rules.length}):**\n` +
            rules.map(r => `[${r.source}] ${r.type === "allow" ? "Allow" : r.type === "deny" ? "Deny" : "Ask"}: \`${r.rule}\``).join("\n")
          : "";

        ctx.addSystemMessage(
          `**Permission mode:** ${modeLabel} *(shift+tab to cycle)*\n\n` +
          "**Modes:** default → acceptEdits → plan → bypassPermissions\n\n" +
          "Commands:\n" +
          "- `/permissions allow <tool>` — allow a tool permanently (saved to project settings)\n" +
          "- `/permissions deny <tool>` — deny a tool permanently (saved to project settings)\n" +
          "- `/permissions reset` — reset to default mode\n\n" +
          "Approving a bash command with **Yes, don't ask again** saves a permanent rule (saved to local settings)." +
          rulesInfo
        );
      } else {
        const parts = arg.split(/\s+/);
        const action = parts[0];
        const toolName = parts[1];

        switch (action) {
          case "trust":
          case "bypass":
            ctx.setTrustAll(true);
            ctx.addSystemMessage("**bypassPermissions mode ON.** All tools auto-approved.");
            break;
          case "ask":
          case "default":
            ctx.setTrustAll(false);
            ctx.addSystemMessage("**default mode ON.** Tools require approval.");
            break;
          case "allow": {
            if (!toolName) {
              ctx.addSystemMessage("Usage: `/permissions allow <tool or pattern>`\n\nExamples:\n- `/permissions allow bash` — allow all bash\n- `/permissions allow bash(npm run *)` — allow npm run commands\n- `/permissions allow edit_file` — allow all file edits");
            } else {
              // Save to project settings
              const pSettings = loadProjectSettings() || {};
              pSettings.allow = pSettings.allow || [];
              if (!pSettings.allow.includes(toolName)) {
                pSettings.allow.push(toolName);
                saveProjectSettings(pSettings);
              }
              // Also add to session for immediate effect
              ctx.allowTool(toolName.split("(")[0]); // session set uses bare tool name
              ctx.addSystemMessage(`**Allowed** \`${toolName}\` — saved to project settings.`);
            }
            break;
          }
          case "deny": {
            if (!toolName) {
              ctx.addSystemMessage("Usage: `/permissions deny <tool or pattern>`");
            } else {
              // Save to project settings
              const pSettings = loadProjectSettings() || {};
              pSettings.deny = pSettings.deny || [];
              if (!pSettings.deny.includes(toolName)) {
                pSettings.deny.push(toolName);
                saveProjectSettings(pSettings);
              }
              ctx.denyTool(toolName.split("(")[0]);
              ctx.addSystemMessage(`**Denied** \`${toolName}\` — saved to project settings.`);
            }
            break;
          }
          case "reset":
            ctx.setTrustAll(false);
            ctx.addSystemMessage("**Permissions reset** to ask mode.");
            break;
          default:
            ctx.addSystemMessage("Unknown action. Use: trust, ask, allow, deny, reset");
        }
      }
      break;
    }

    // ---- /setup ----
    case "setup": {
      // /setup reset — wipe config and restart
      if (arg === "reset") {
        try {
          const configPath = path.join(os.homedir(), ".workermill", "cli.json");
          if (fs.existsSync(configPath)) {
            fs.unlinkSync(configPath);
            ctx.addSystemMessage("**Config cleared.** Type `/exit` and run `workermill` to re-run setup.");
          } else {
            ctx.addSystemMessage("No config to clear.");
          }
        } catch (err) {
          ctx.addSystemMessage(`Failed to clear config: ${err instanceof Error ? err.message : String(err)}`);
        }
        break;
      }

      // /setup — show current config and how to change each part
      const setupConfig = loadConfig();
      if (!setupConfig) {
        ctx.addSystemMessage("No config found. Type `/exit` and run `workermill` to start setup.");
        break;
      }

      const providers = Object.entries(setupConfig.providers).map(
        ([name, p]) => `  - **${name}**: ${p.model}${p.apiKey ? " (key set)" : ""}${p.host ? ` (${p.host})` : ""}`
      );
      const routing = setupConfig.routing || {};
      const plannerRoute = routing.planner || routing.critic || setupConfig.default;
      const reviewerRoute = routing.tech_lead || setupConfig.default;

      ctx.addSystemMessage(
        `**Current config** (\`~/.workermill/cli.json\`)\n\n` +
        `**Workers:** ${setupConfig.default}\n` +
        `**Planner:** ${plannerRoute}\n` +
        `**Reviewer:** ${reviewerRoute}\n\n` +
        `**Providers:**\n${providers.join("\n")}\n\n` +
        `---\n\n` +
        `**To change things:**\n\n` +
        `| What | Command |\n` +
        `|---|---|\n` +
        `| Add/update API key | \`/settings key <provider> <key>\` |\n` +
        `| Switch worker model | \`/model <provider>/<model>\` |\n` +
        `| Switch planner model | \`/model planner <provider>/<model>\` |\n` +
        `| Switch reviewer model | \`/model reviewer <provider>/<model>\` |\n` +
        `| Add a new provider | \`/settings key <provider> <key>\` then \`/model <provider>/<model>\` |\n` +
        `| Issue tracker | \`/settings tickets <github\\|jira\\|linear>\` |\n` +
        `| Start over from scratch | \`/setup reset\` |`
      );
      break;
    }

    // ---- /quit, /exit ----
    case "quit":
    case "exit":
    case "q": {
      stopAllMCPServers();
      shutdownLSP();
      cleanupStaleWorktrees(ctx.workingDir);
      clearCheckpoints();
      void import("../browser.js").then(m => m.browserClose());
      printSessionGoodbye(ctx);
      ctx.exit?.();
      // Force process exit — Ink's exit() only stops rendering but
      // dangling listeners (stdin, timers) can keep the process alive.
      setTimeout(() => process.exit(0), 100);
      break;
    }

    // ---- /init ----
    case "init": {
      ctx.addSystemMessage("**Tip:** Add `.workermill/*.local.json` to your `.gitignore` to keep personal permission overrides out of version control.");

      const wmPath = path.join(ctx.workingDir, "WORKERMILL.md");
      const exists = fs.existsSync(wmPath);
      const isForce = arg?.includes("--force");

      if (exists && !isForce) {
        // Re-run: validate existing file, bias toward stability
        ctx.addSystemMessage("**Validating WORKERMILL.md...** Checking accuracy against current codebase.");
        ctx.submit(
          `Read the existing WORKERMILL.md file and validate it against the current state of the codebase.

IMPORTANT: Your default stance is that the file is correct. Do NOT make changes unless something is **concretely wrong or missing**. Rewording for style, reordering sections, or adding "nice to have" content are NOT valid reasons to edit. If the file is accurate and complete, say "WORKERMILL.md is up to date — no changes needed." and stop.

Use your tools to spot-check — read a few key files, verify commands still work, confirm directory structure matches. You do not need to exhaustively re-explore the entire codebase.

Only flag issues that are **factually incorrect**:
- A file path, command, or pattern that no longer exists
- A new top-level module or major dependency that is completely absent
- A command that would fail if an agent ran it

Do NOT touch:
- Wording, tone, or section ordering
- Content that is accurate but could be "more detailed"
- Sections the user wrote manually (custom notes, pitfalls, workflow preferences)

If you find concrete issues, list them and ask the user whether to apply fixes — do NOT write changes automatically. Present a short summary like:

**Found 2 issues:**
1. \`npm run typecheck\` should be \`npx tsc -b\` (command changed)
2. Missing \`api/src/middleware/\` section (new module added since last init)

**Apply fixes?** (say yes or I'll leave it as-is)`,
          "/init (validating WORKERMILL.md)"
        );
      } else {
        // First run: generate from scratch
        ctx.addSystemMessage("**Analyzing codebase...** I'll explore your project and generate `WORKERMILL.md`.");
        ctx.submit(
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

Write the file with write_file to WORKERMILL.md in the project root.`,
          "/init (generating WORKERMILL.md)"
        );
      }
      break;
    }

    // ---- /log ----
    case "log": {
      const logPath = logger.getLogPath(ctx.workingDir);
      try {
        if (!fs.existsSync(logPath)) {
          ctx.addSystemMessage("No log file found. Logs are stored in `~/.workermill/logs/`");
          break;
        }
        const content = fs.readFileSync(logPath, "utf-8");
        const lines = content.trim().split("\n");
        const tail = lines.slice(-20).join("\n");
        ctx.addSystemMessage(`**Last 20 log entries:**\n\n\`\`\`\n${tail}\n\`\`\`\n\nTip: use \`wm logs --follow\` outside the session for live streaming, or \`wm logs --json | jq\` for scripting.`);
      } catch (err) {
        ctx.addSystemMessage(`Failed to read log: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    // ---- /update ----
    case "update": {
      ctx.addSystemMessage("**Updating WorkerMill CLI...**");
      try {
        const result = execSync("npm install -g workermill@latest 2>&1", {
          encoding: "utf-8", timeout: 60_000,
        }).trim();
        const versionMatch = result.match(/workermill@([\d.]+)/);
        const newVersion = versionMatch ? versionMatch[1] : "latest";
        ctx.addSystemMessage(`**Updated to v${newVersion}.** Restart the CLI to use the new version.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("EACCES") || msg.includes("permission")) {
          ctx.addSystemMessage("**Permission denied.** Try:\n\n```\nsudo npm install -g workermill@latest\n```\n\nOr use npx which always gets the latest:\n```\nnpx workermill@latest\n```");
        } else {
          ctx.addSystemMessage(`**Update failed:** ${msg.slice(0, 200)}\n\nTry manually: \`npm install -g workermill@latest\``);
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
          ctx.addSystemMessage(result);
        } else if (isBrowserOpen()) {
          ctx.addSystemMessage("**Browser already open.** The agent can use `browser_navigate`, `browser_screenshot`, etc.\n\nUse `/chrome close` to shut it down.");
        } else {
          const result = await browserOpen();
          ctx.addSystemMessage(`${result}\n\nThe agent now has browser tools: \`browser_navigate\`, \`browser_screenshot\`, \`browser_click\`, \`browser_fill\`, \`browser_evaluate\`, \`browser_console\`.`);
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
          ctx.addSystemMessage(`**Voice input not available.**\n\n${installHint}`);
          return;
        }

        ctx.addSystemMessage(`**Listening...** (${tool}) — speak now, stops on silence.`);

        const result = await listenForVoice();
        if (result.error) {
          ctx.addSystemMessage(`**Voice error:** ${result.error}`);
        } else if (!result.text) {
          ctx.addSystemMessage("**No speech detected.** Try again with `/voice`.");
        } else {
          ctx.addSystemMessage(`**Heard:** "${result.text}"`);
          ctx.submit(result.text);
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
          ctx.addSystemMessage(content);
        } else {
          ctx.addSystemMessage(
            "Changelog not found locally. View online:\nhttps://github.com/jarod-rosenthal/workermill/blob/main/cli/CHANGELOG.md"
          );
        }
      } catch (err) {
        logger.debug("Failed to read changelog", { error: err instanceof Error ? err.message : String(err) });
        ctx.addSystemMessage(
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
        const shadowed: string[] = [];
        for (const c of customCmds) {
          if (BUILTIN_COMMANDS.has(c.name)) {
            lines.push(`| \`/${c.name}\` | ${c.description} ⚠️ **shadowed by built-in** |`);
            shadowed.push(c.name);
          } else {
            lines.push(`| \`/${c.name}\` | ${c.description} |`);
          }
        }
        if (shadowed.length > 0) {
          lines.push(`\n⚠️ **${shadowed.length} command(s) shadowed:** \`${shadowed.join("`, `")}\` — these match built-in commands and will never run. Rename them to avoid the conflict.`);
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

      ctx.addSystemMessage(lines.join("\n"));
      break;
    }

    // ---- /as <persona> <task> ----
    case "as": {
      if (!arg || !arg.includes(" ")) {
        const allPersonas = listAvailablePersonas();
        ctx.addSystemMessage(
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
          ctx.addSystemMessage(`Persona \`${personaSlug}\` not found. Use \`/personas\` to list all.`);
        } else {
          // Prepend persona context to the task so the agent adopts the role
          const personaPrefix =
            `[Acting as **${p.name}** — ${p.description}]\n\n` +
            `## Expert Instructions\n\n${p.systemPrompt}\n\n` +
            `## Task\n\n`;
          ctx.submit(personaPrefix + task, `/as ${personaSlug} ${task}`);
        }
      }
      break;
    }

    // ---- /remember ----
    case "remember": {
      if (!arg) {
        ctx.addSystemMessage("**Usage:** `/remember <text>` — save a memory for this project\n\nExamples:\n- `/remember This project uses Prisma, not Sequelize`\n- `/remember Always run migrations before tests`");
      } else {
        const mem = addMemory("preference", arg);
        ctx.addSystemMessage(`**Remembered:** ${mem.content}`);
      }
      break;
    }

    // ---- /forget ----
    case "forget": {
      if (!arg) {
        ctx.addSystemMessage("**Usage:** `/forget <text>` — remove a memory matching the text");
      } else {
        const removed = removeMemory(arg);
        ctx.addSystemMessage(removed ? `**Forgot:** memory matching "${arg}"` : `No memory found matching "${arg}". Use \`/memories\` to list all.`);
      }
      break;
    }

    // ---- /memories ----
    case "memories":
    case "memory": {
      const memories = loadMemories();
      if (memories.length === 0) {
        ctx.addSystemMessage("No memories saved for this project.\n\nMemories are saved automatically when the agent discovers something, or manually with `/remember <text>`.");
      } else {
        const lines = ["**Project Memories**\n"];
        const typeLabels: Record<string, string> = { learning: "Learning", preference: "Preference", context: "Context", correction: "Correction" };
        for (const m of memories) {
          lines.push(`- **[${typeLabels[m.type] || m.type}]** ${m.content} \`(${m.id})\``);
        }
        lines.push(`\n${memories.length} memories. Use \`/forget <id or text>\` to remove.`);
        ctx.addSystemMessage(lines.join("\n"));
      }
      break;
    }

    // ---- /personas ----
    case "personas": {
      const allPersonas = listAvailablePersonas();

      if (!arg) {
        // List all personas with source
        const lines: string[] = ["**Personas**\n"];
        const projectDir = path.join(ctx.workingDir, ".workermill", "personas");
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

        ctx.addSystemMessage(lines.join("\n"));
      } else if (arg.startsWith("show ")) {
        const slug = arg.slice(5).trim().replace(/-/g, "_");
        const p = loadPersona(slug);
        if (!p) {
          ctx.addSystemMessage(`Persona \`${slug}\` not found. Use \`/personas\` to list all.`);
        } else {
          ctx.addSystemMessage(
            `**${p.name}** (\`${p.slug}\`)\n\n` +
            `**Description:** ${p.description}\n` +
            `**Tools:** ${p.tools.join(", ")}\n\n` +
            `**System Prompt:**\n\`\`\`\n${p.systemPrompt}\n\`\`\``
          );
        }
      } else if (arg.startsWith("create ")) {
        const slug = arg.slice(7).trim().replace(/\s+/g, "_").toLowerCase();
        const personaDir = path.join(ctx.workingDir, ".workermill", "personas");
        const personaPath = path.join(personaDir, `${slug}.md`);

        if (fs.existsSync(personaPath)) {
          ctx.addSystemMessage(`Persona \`${slug}\` already exists at \`${personaPath}\`. Edit it directly.`);
        } else {
          if (!fs.existsSync(personaDir)) fs.mkdirSync(personaDir, { recursive: true });
          const template = `---\nname: ${slug.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}\nslug: ${slug}\ndescription: Custom ${slug.replace(/_/g, " ")} persona\ntools: [bash, read_file, write_file, edit_file, patch, glob, grep, ls, fetch, sub_agent]\n---\n\nYou are a senior ${slug.replace(/_/g, " ")}. Write clean, production-ready code.\n\n<!-- Customize this prompt for your project -->\n`;
          fs.writeFileSync(personaPath, template, "utf-8");
          ctx.addSystemMessage(
            `**Created** \`.workermill/personas/${slug}.md\`\n\n` +
            "Edit the file to customize the system prompt, tools, and description. " +
            "This persona will override the built-in one with the same name, or be available as a new persona for the planner to assign."
          );
        }
      } else {
        ctx.addSystemMessage("Usage: `/personas`, `/personas show <name>`, `/personas create <name>`");
      }
      break;
    }

    // ---- /mcp ----
    case "mcp": {
      if (hasMCPServers()) {
        const tools = getMCPTools();
        const serverInfo = getMCPServerInfo();
        const transportByName = new Map(serverInfo.map((s) => [s.name, s.transport]));
        const byServer = new Map<string, string[]>();
        for (const { serverName, tool } of tools) {
          if (!byServer.has(serverName)) byServer.set(serverName, []);
          byServer.get(serverName)!.push(tool.name);
        }
        const lines: string[] = ["**MCP Servers (active)**\n"];
        for (const [name, toolNames] of byServer) {
          const transport = transportByName.get(name) || "stdio";
          lines.push(`- **${name}** (${transport}) — ${toolNames.length} tools: ${toolNames.join(", ")}`);
        }
        ctx.addSystemMessage(lines.join("\n"));
      } else if (hasMCPRegistered()) {
        ctx.addSystemMessage(
          "**MCP servers detected.** Tools will be available on your first prompt."
        );
      } else {
        ctx.addSystemMessage(
          "**No MCP servers configured.**\n\n" +
          "MCP servers are auto-detected from Docker Desktop, or add them to `~/.workermill/cli.json`:\n\n" +
          "**stdio** (local process):\n" +
          "```json\n\"mcp\": {\n  \"my-server\": {\n    \"command\": \"npx\",\n    \"args\": [\"-y\", \"my-mcp-server\"]\n  }\n}\n```\n\n" +
          "**http** or **sse** (remote server):\n" +
          "```json\n\"mcp\": {\n  \"my-server\": {\n    \"transport\": \"http\",\n    \"url\": \"https://my-mcp-server.example.com/mcp\",\n    \"headers\": { \"Authorization\": \"Bearer <token>\" }\n  }\n}\n```\n\n" +
          "Servers start on your first prompt."
        );
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
            ctx.addSystemMessage(
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
            ctx.addSystemMessage(
              `**Scheduled Tasks**\n\n| Name | Schedule | Prompt | Created |\n|---|---|---|---|\n${rows}\n\n` +
              "Use `/schedule delete <name>` to remove."
            );
          }
        } else if (arg.startsWith("delete ")) {
          const name = arg.slice(7).trim();
          const result = deleteSchedule(name);
          ctx.addSystemMessage(result.message);
        } else if (arg === "list") {
          // Same as no arg — list schedules
          const schedules = listSchedules();
          if (schedules.length === 0) {
            ctx.addSystemMessage("No scheduled tasks.");
          } else {
            const rows = schedules.map((s: any) =>
              `- **${s.name}** — \`${s.cron}\` — "${s.prompt.slice(0, 50)}"`
            ).join("\n");
            ctx.addSystemMessage(`**Scheduled Tasks**\n\n${rows}`);
          }
        } else {
          // Parse: /schedule "name" <schedule>
          // or: /schedule <prompt> <schedule>
          const quoteMatch = arg.match(/^"([^"]+)"\s+(.+)$/);
          if (quoteMatch) {
            const [, name, schedule] = quoteMatch;
            const result = createSchedule(name, name, schedule, ctx.workingDir);
            ctx.addSystemMessage(result.message);
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
              const result = createSchedule(prompt, prompt, schedule, ctx.workingDir);
              ctx.addSystemMessage(result.message);
            } else {
              ctx.addSystemMessage(
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
        ctx.addUserMessage(`/${cmd}${arg ? " " + arg : ""}`);
        ctx.submit(customCmd.prompt + (arg ? `\n\nAdditional context: ${arg}` : ""), `/${cmd}${arg ? " " + arg : ""}`);
        break;
      }
      ctx.addSystemMessage(
        `Unknown command: \`/${cmd}\`\n\nType \`/help\` to see all available commands.`
      );
      break;
    }
  }

  return true;
}
