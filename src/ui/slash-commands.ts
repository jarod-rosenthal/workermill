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
import { getStateRoot } from "../state-root.js";
import {
  loadConfig,
  resolveConfig,
  getProviderForPersona,
} from "../config.js";
import chalk from "chalk";
import { loadCustomCommands } from "../custom-commands.js";
import { loadPersona, listAvailablePersonas } from "../personas.js";
import { stopAllMCPServers } from "../mcp-client.js";
import { getRetryableRun } from "../ship-state.js";
import { runLifecycleHooks } from "../hooks.js";
import { shutdown as shutdownLSP } from "../engine/tools/lsp.js";
import { cleanupStaleWorktrees } from "../engine/tools/sub-agent.js";
import { undoLast, undoFile, listCheckpoints, clearCheckpoints } from "../checkpoints.js";
import * as logger from "../logger.js";
import { handleSettingsCommand } from "./commands/settings.js";
import { handlePermissionsCommand, handleTrustCommand } from "./commands/permissions.js";
import {
  handleModelCommand, handleCostCommand, handleStatusCommand,
  handleCompactCommand, handleClearCommand, handleEditCommand,
  handleGitCommand, handleDiffCommand, handleChangedCommand,
  handleSessionsCommand,
} from "./commands/session.js";
import {
  handleInitCommand, handleRememberCommand, handleForgetCommand,
  handleMemoriesCommand, handlePersonasCommand, handleSkillsCommand,
  handleMcpCommand, handleProjectsCommand,
} from "./commands/project.js";

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
  // Jira/Linear: PROJ-123 (case-insensitive input, normalized to uppercase)
  if (/^[A-Z][A-Z0-9]+-\d+$/i.test(trimmed)) {
    return { system: "external", key: trimmed.toUpperCase() };
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

export function formatReleaseNotesForDisplay(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const sectionMatches = [...normalized.matchAll(/^## .*(?:\n(?!## ).*)*/gm)];
  if (sectionMatches.length <= 1) return normalized;

  const firstSectionIndex = sectionMatches[0]?.index ?? 0;
  const preamble = normalized.slice(0, firstSectionIndex).trimEnd();
  const sections = sectionMatches.map((match) => match[0].trimEnd());
  const unreleased = sections.find((section) => section.startsWith("## [Unreleased]"));
  const released = sections.filter((section) => !section.startsWith("## [Unreleased]"));
  const reordered = [...released.reverse()];
  if (unreleased) reordered.push(unreleased);

  return `${preamble}\n\n${reordered.join("\n\n")}\n`;
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
  "allow", "as", "ask", "bell", "browser", "build", "changed", "changelog", "chrome",
  "cancel", "clear", "compact", "config", "cost", "deny", "diff", "edit", "exit",
  "forget", "git", "h", "help", "hooks", "init", "key", "log", "mcp",
  "memories", "memory", "model", "permissions", "personas", "projects", "q", "quit",
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

**Build** — Create software with multiple specialist AI agents.
Type \`/build <description>\` or \`/build spec.md\` and I'll plan stories,
assign experts (backend, frontend, devops, security), execute, and review.
Creates a feature branch for all changes — your current branch stays clean.

---

**Commands**

| Command | Description |
|---|---|
| \`/build <task>\` | Multi-expert orchestration — plan, execute, review, ship |
| \`/orchestrate <#issue>\` | **[experimental]** Full-spec orchestration across epic sub-issues |
| \`/pause\` | Pause or resume a running \`/build\` orchestration |
| \`/cancel\` | Cancel the current running operation (same as \`ESC\`) |
| \`/as <persona> <task>\` | Run a task with a specific expert (\`/as security_engineer audit auth\`) |
| \`/review [task]\` | Code review using the tech lead (defaults to recent changes) |
| \`/retry\` | Re-plan and re-run the last task |
| \`/model [provider/model]\` | Switch worker model (\`/model ollama/qwen3-coder:30b 256k\`) |
| \`/model planner [provider/model]\` | Switch planner model (\`/model planner google/gemini-3.1-pro\`) |
| \`/model reviewer [provider/model]\` | Switch reviewer model (\`/model reviewer openai/gpt-5.3-codex\`) |
| \`/init\` | Generate or validate \`AGENT.md\` |
| \`/compact [focus]\` | Compress conversation (\`/compact focus on the API changes\`) |
| \`/settings\` | View/change settings (review, ollama, routing, keys) |
| \`/settings key <provider> <key>\` | Add an API key inline |
| \`/permissions\` | Manage tool permissions (trust/ask/allow/deny) |
| \`/trust\` | Auto-approve all tools for this session |
| \`/undo\` | Revert last build's changes |
| \`/changed\` | Show files changed in this session |
| \`/diff\` | Preview uncommitted changes |
| \`/git\` | Git branch and status |
| \`/personas\` | List, show, or create personas |
| \`/projects\` | List known projects |
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
| \`/edit\` | Open editor for longer input (\`/settings editor vim|nano|auto\`) |
| \`/chrome\` | Headless Chrome *(experimental)* |
| \`/voice\` | Voice input *(experimental)* |
| \`/schedule\` | Scheduled tasks *(experimental)* |
| \`/update\` | Check for updates |
| \`/release-notes\` | Show changelog |
| \`/quit\` | Exit |

**Shortcuts:** \`!command\` runs shell, \`ESC\` cancels, \`ESC ESC\` rolls back, \`Ctrl+P\` pause/resume \`/build\`, \`Shift+Tab\` cycles permissions, \`Ctrl+C\` exits (or cancels while running), \`←/→\` cursor, \`Tab\` autocomplete.

---

**Quality Gates & Spec Check** *(off by default — enable in \`.workermill/config.json\`)*

| Option | What it does |
|---|---|
| \`review.specCheck: true\` | Before planning: prompts you to answer up to 3 ambiguities in your task description |
| \`review.critic: true\` | Between planning and execution: scores the plan 1-10 and refines it until it passes |
| \`review.criticThreshold: 8\` | Plan score the critic must reach to approve (default 8) |
| \`review.verifyEnabled: false\` | Disable planner-generated verification commands (enabled by default) |
| \`qualityGates: [{name, commands}]\` | Static project-wide assertions that run on every \`/build\` — use for invariants like "app starts" |

Gate failures are passed to the tech lead reviewer as context. No retry loop — failures are flagged as must-fix during review.

See \`docs/quality-gates.md\` for full documentation and examples.`;

// ---------------------------------------------------------------------------
// Context interface
// ---------------------------------------------------------------------------

export interface SlashCommandContext {
  addSystemMessage: (content: string) => void;
  addUserMessage: (content: string) => void;
  submit: (
    input: string,
    displayText?: string,
    options?: {
      modelOverride?: { provider: string; model: string; apiKey?: string; host?: string; contextLength?: number };
    },
  ) => void;
  provider: string;
  model: string;
  workingDir: string;
  session: {
    id: string;
    messages: any[];
    totalTokens: number;
    startedAt: string;
    updatedAt: string;
    name?: string;
    provider: string;
    model: string;
  };
  cost: number;
  tokens: number;
  permissionMode: string;
  trustAll: boolean;
  /** Live getter for trust-all state — reads current mode, not the value at /build launch */
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
  startOrchestrator: (
    task: string,
    trustAll: boolean | (() => boolean),
    sandboxed: boolean | "os",
    ticketKey?: string,
    options?: { onComplete?: (result: { success: boolean; cancelled?: boolean; error?: string }) => void },
  ) => void;
  startProgram?: (parentIssueRef: string, trustAll: boolean | (() => boolean), sandboxed: boolean | "os") => void;
  retryOrchestrator: (trustAll: boolean | (() => boolean), sandboxed: boolean | "os") => boolean;
  startReview: (trustAll: boolean | (() => boolean), sandboxed: boolean | "os", target?: string) => void;
  lastBuildTask: string | null;
  setLastBuildTask: (task: string) => void;
  sandboxed?: boolean | "os";
  exit?: () => void;
  switchModel?: (
    provider: string,
    model: string,
    providerConfig?: { host?: string; contextLength?: number; apiKey?: string },
  ) => void;
  updateRoleModels?: () => void;
  forceCompact?: (focusInstructions?: string) => Promise<{ before: number; after: number }>;
  setLiveViewEnabled?: (enabled: boolean) => string | null;
  getLiveViewUrl?: () => string | null;
  setInlineEditPreviewEnabled?: (enabled: boolean) => void;
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
      handleModelCommand(arg, ctx);
      break;
    }

    // ---- /cost ----
    case "cost": {
      handleCostCommand(arg, ctx);
      break;
    }

    // ---- /status ----
    case "status": {
      handleStatusCommand(arg, ctx);
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
          "Uses your configured reviewer model (`/settings route tech_lead <provider>/<model>`)."
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
      handleTrustCommand(arg, ctx);
      break;
    }

    // ---- /build (primary) and /ship (backward-compat alias) ----
    case "ship":
    case "build": {
      if (!arg) {
        ctx.addSystemMessage(
          "**Usage:** `/build <task>` — accepts inline text, a .md file, or a ticket reference\n\n" +
          "**Examples:**\n" +
          "- `/build add dark mode to settings` — inline task\n" +
          "- `/build ./specs/auth-redesign.md` — from spec file\n" +
          "- `/build #123` or `/build GH-123` — from GitHub Issue\n" +
          "- `/build PROJ-123` — from Jira/Linear ticket\n\n" +
          "`/ship` is also accepted as an alias.\n\n" +
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
          ctx.addUserMessage(`/${cmd} ${ticketRef.key}`);
          ctx.startOrchestrator(ticketRef.key, ctx.isTrustAll, ctx.sandboxed ?? "os", ticketRef.key);
        } else {
          ctx.setLastBuildTask(arg);
          ctx.addUserMessage(`/${cmd} ${arg}`);
          ctx.startOrchestrator(arg, ctx.isTrustAll, ctx.sandboxed ?? "os");
        }
      }
      break;
    }

    // ---- /orchestrate ----
    case "orchestrate": {
      const orchConfig = loadConfig();
      if (!orchConfig?.experimental) {
        ctx.addSystemMessage("`/orchestrate` is an experimental feature. Enable it with `/settings experimental true`.");
        break;
      }
      if (!arg) {
        ctx.addSystemMessage(
          "**Usage:** `/orchestrate #<parent-issue>`\n\n" +
          "Runs full-spec orchestration from a parent GitHub issue. " +
          "If child issues already exist, it uses them. If not, it decomposes the parent issue, creates child issues, " +
          "links them under the parent, then ships each child in dependency order.\n\n" +
          "**Examples:**\n" +
          "- `/orchestrate #120`\n" +
          "- `/orchestrate GH-120`\n\n" +
          "Epic boundaries prompt with `y/n/a`:\n" +
          "- `y` continue once\n" +
          "- `n` pause\n" +
          "- `a` continue all remaining epics (persisted globally)"
        );
        break;
      }
      if (ctx.orchestratorRunning) {
        ctx.addSystemMessage("Orchestration is already running. Wait for it to complete.");
        break;
      }
      const parentRef = detectTicketRef(arg);
      if (!parentRef || parentRef.system !== "github") {
        ctx.addSystemMessage("`/orchestrate` currently supports GitHub parent issues only (use `#123` or `GH-123`).");
        break;
      }
      if (!ctx.startProgram) {
        ctx.addSystemMessage("`/orchestrate` is not available in this runtime.");
        break;
      }
      ctx.addUserMessage(`/orchestrate ${parentRef.key}`);
      ctx.startProgram(parentRef.key, ctx.isTrustAll, ctx.sandboxed ?? "os");
      break;
    }

    // ---- /pause ----
    case "pause": {
      if (!ctx.orchestratorRunning) {
        ctx.addSystemMessage("No `/build` orchestration is running.");
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
          ctx.addSystemMessage("Nothing to retry. No incomplete `/build` runs found for this project.");
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

    // ---- /changed ----
    case "changed": {
      handleChangedCommand(arg, ctx);
      break;
    }

    // ---- /diff ----
    case "diff": {
      handleDiffCommand(arg, ctx);
      break;
    }

    // ---- /clear ----
    case "clear": {
      handleClearCommand(arg, ctx);
      break;
    }

    // ---- /compact ----
    case "compact": {
      handleCompactCommand(arg, ctx);
      break;
    }

    // ---- /git ----
    case "git": {
      handleGitCommand(arg, ctx);
      break;
    }

    // ---- /edit ----
    case "edit": {
      handleEditCommand(arg, ctx);
      break;
    }

    // ---- /settings ----
    case "settings":
    case "config": {
      handleSettingsCommand(arg, ctx);
      break;
    }

    // ---- /sessions ----
    case "sessions": {
      handleSessionsCommand(arg, ctx);
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
      handlePermissionsCommand(arg, ctx);
      break;
    }

    // ---- /setup ----
    case "setup": {
      // /setup reset — wipe config and restart
      if (arg === "reset") {
        try {
          const configPath = path.join(getStateRoot(), "cli.json");
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
      try {
        runLifecycleHooks("session_end", resolveConfig()?.hooks, ctx.workingDir, {
          WORKERMILL_SESSION_ID: ctx.session.id,
          WORKERMILL_SESSION_TOKENS: String(ctx.session.totalTokens),
          WORKERMILL_SESSION_COST: ctx.cost.toFixed(4),
          WORKERMILL_EXIT_REASON: "command",
        });
      } catch { /* hooks are best-effort */ }
      stopAllMCPServers();
      shutdownLSP();
      cleanupStaleWorktrees(ctx.workingDir);
      clearCheckpoints();
      // Explicit /browser state is session-owned; model-turn resources close
      // in useAgent's awaited per-run cleanup.
      void import("../browser.js").then(m => m.browserClose());
      printSessionGoodbye(ctx);
      ctx.exit?.();
      // Force process exit — Ink's exit() only stops rendering but
      // dangling listeners (stdin, timers) can keep the process alive.
      // Skip in test environment to avoid vitest "process.exit unexpectedly called" errors.
      if (typeof process.env.VITEST === "undefined") {
        setTimeout(() => process.exit(0), 100);
      }
      break;
    }

    // ---- /init ----
    case "init": {
      handleInitCommand(arg, ctx);
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
          ctx.addSystemMessage(formatReleaseNotesForDisplay(content));
        } else {
          ctx.addSystemMessage(
            "Changelog not found locally. View online:\nhttps://github.com/jarod-rosenthal/workermill/blob/main/CHANGELOG.md"
          );
        }
      } catch (err) {
        logger.debug("Failed to read changelog", { error: err instanceof Error ? err.message : String(err) });
        ctx.addSystemMessage(
          "Changelog not found. View online:\nhttps://github.com/jarod-rosenthal/workermill/blob/main/CHANGELOG.md"
        );
      }
      break;
    }

    // ---- /skills ----
    case "skills": {
      handleSkillsCommand(arg, ctx);
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
          try {
            const config = resolveConfig();
            const routed = getProviderForPersona(config, p.provider || personaSlug);
            ctx.submit(personaPrefix + task, `/as ${personaSlug} ${task}`, {
              modelOverride: {
                provider: routed.provider,
                model: routed.model,
                apiKey: routed.apiKey,
                host: routed.host,
                contextLength: routed.contextLength,
              },
            });
          } catch (error) {
            logger.warn("Failed to resolve routed model for /as persona; continuing with current session model", {
              persona: personaSlug,
              error: error instanceof Error ? error.message : String(error),
            });
            ctx.submit(personaPrefix + task, `/as ${personaSlug} ${task}`);
          }
        }
      }
      break;
    }

    // ---- /remember ----
    case "remember": {
      handleRememberCommand(arg, ctx);
      break;
    }

    // ---- /forget ----
    case "forget": {
      handleForgetCommand(arg, ctx);
      break;
    }

    // ---- /memories ----
    case "memories":
    case "memory": {
      handleMemoriesCommand(arg, ctx);
      break;
    }

    // ---- /personas ----
    case "personas": {
      handlePersonasCommand(arg, ctx);
      break;
    }

    // ---- /mcp ----
    case "mcp": {
      handleMcpCommand(arg, ctx);
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

    // ---- /projects ----
    case "projects": {
      handleProjectsCommand(arg, ctx);
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
