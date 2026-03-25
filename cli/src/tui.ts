import chalk from "chalk";
import { execSync } from "child_process";
import * as logger from "./logger.js";

// Track tool usage counts for status bar
const toolCounts: Record<string, number> = {};

// Cache git branch — updated periodically
let cachedGitBranch = "";
let lastBranchCheck = 0;
function getGitBranch(): string {
  const now = Date.now();
  if (now - lastBranchCheck > 10_000) { // refresh every 10s
    lastBranchCheck = now;
    try {
      cachedGitBranch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", { encoding: "utf-8", timeout: 2000 }).trim();
    } catch { cachedGitBranch = ""; }
  }
  return cachedGitBranch;
}

export function incrementToolCount(toolName: string): void {
  toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;
}

export function printHeader(version: string, provider?: string, model?: string, cwd?: string): void {
  console.log();
  console.log(chalk.bold.white(`  WorkerMill`) + chalk.dim(` v${version}`));
  if (provider && model) {
    console.log(chalk.dim(`  ${provider}/`) + chalk.white(model));
  }
  if (cwd) {
    console.log(chalk.dim(`  cwd: `) + chalk.white(cwd));
  }
  console.log(chalk.dim(`  /help`) + chalk.dim(` for commands, `) + chalk.dim(`Ctrl+C`) + chalk.dim(` to cancel`));
  console.log();
}

/**
 * Format a tool call message — matches worker/epic/collaboration-detector.ts exactly.
 * Format: Tool: toolname → path/command/pattern
 */
export function formatToolCall(toolName: string, toolInput: Record<string, unknown>): string {
  let msg = `Tool: ${toolName}`;
  if (toolInput) {
    if (toolInput.file_path) msg += ` → ${toolInput.file_path}`;
    else if (toolInput.path) msg += ` → ${toolInput.path}`;
    else if (toolInput.command) msg += ` → ${String(toolInput.command).substring(0, 500)}`;
    else if (toolInput.pattern) msg += ` → pattern: ${toolInput.pattern}`;
    else {
      const keys = Object.keys(toolInput).slice(0, 3);
      if (keys.length > 0) {
        msg += ` → ${keys.map(k => `${k}: ${String(toolInput[k]).substring(0, 200)}`).join(", ")}`;
      }
    }
  }
  return msg;
}

export function printToolCall(toolName: string, toolInput: Record<string, unknown>): void {
  incrementToolCount(toolName);
  logger.tool(toolName, toolInput);

  // Claude Code style: ↓ ToolName path/detail
  const arrow = chalk.dim("  ↓ ");
  const label = chalk.cyan;

  switch (toolName) {
    case "bash": {
      let cmd = String(toolInput.command || "");
      // Truncate heredoc content — just show the command, not the file contents
      const heredocIdx = cmd.indexOf("<<");
      if (heredocIdx > 0) cmd = cmd.slice(0, heredocIdx).trim() + " << ...";
      // Truncate long commands
      if (cmd.length > 120) cmd = cmd.slice(0, 117) + "...";
      console.log(arrow + label("Bash ") + chalk.yellow(cmd));
      break;
    }

    case "read_file":
      console.log(arrow + label("Read ") + chalk.white(String(toolInput.path || "")));
      break;

    case "write_file":
      console.log(arrow + label("Write ") + chalk.white(String(toolInput.path || "")));
      break;

    case "edit_file":
      console.log(arrow + label("Edit ") + chalk.white(String(toolInput.path || "")));
      break;

    case "patch":
      console.log(arrow + label("Patch ") + chalk.white("(multi-file)"));
      break;

    case "glob":
      console.log(arrow + label("Glob ") + chalk.white(String(toolInput.pattern || "")));
      break;

    case "grep":
      console.log(arrow + label("Grep ") + chalk.white(String(toolInput.pattern || "")));
      break;

    case "ls":
      console.log(arrow + label("List ") + chalk.white(String(toolInput.path || ".")));
      break;

    case "fetch":
      console.log(arrow + label("Fetch ") + chalk.white(String(toolInput.url || "")));
      break;

    case "sub_agent":
      console.log(arrow + label("Agent ") + chalk.white(String(toolInput.prompt || "").slice(0, 80)));
      break;

    case "git":
      console.log(arrow + label("Git ") + chalk.white(`${toolInput.action}${toolInput.args ? " " + toolInput.args : ""}`));
      break;

    default:
      console.log(arrow + label(toolName));
  }
}

/**
 * Persona emojis — EXACT match from WorkerMill's frontend/src/hooks/usePersonas.ts
 * and packages/vscode-workermill/src/feed-view.ts
 */
const PERSONA_EMOJIS: Record<string, string> = {
  frontend_developer: "\u{1F3A8}",   // 🎨
  backend_developer: "\u{1F4BB}",    // 💻
  fullstack_developer: "\u{1F4BB}",  // 💻 (same as backend)
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
  planner: "\u{1F4A1}",              // 💡 (planning_agent)
  coordinator: "\u{1F3AF}",          // 🎯
  critic: "\u{1F50D}",               // 🔍
  reviewer: "\u{1F50D}",             // 🔍
};

export function getPersonaEmoji(persona: string): string {
  return PERSONA_EMOJIS[persona] || "🤖";
}

/**
 * Print tool result — matches WorkerMill worker output (collaboration-detector.ts).
 * Worker only prints "Tool result received" — no content dump.
 * Tool contents stay in logs; the console shows tool calls + agent text only.
 */
export function printToolResult(_toolName: string, _result: string): void {
  // Worker pattern: console.log(`${prefix} Tool result received`)
  // The CLI already prints the tool call via wmLog() — matching the worker,
  // we don't dump tool result contents to the terminal. The agent's own text
  // output (printed via printAgentText/wmLog) provides the necessary context.
}

/**
 * Print a WorkerMill-style log line.
 * Format: [emoji persona_slug 🏠] message
 * Matches the exact output from worker/epic/coordinator.ts
 */
export function wmLog(persona: string, message: string): void {
  const emoji = getPersonaEmoji(persona);
  console.log(chalk.cyan(`[${emoji} ${persona} 🏠] `) + chalk.white(message));
  logger.info(`[${persona}] ${message}`);
}

/**
 * Write a WorkerMill-style prefix for streaming text.
 * Returns the prefix string so caller can write chunks after it.
 */
export function wmLogPrefix(persona: string): string {
  const emoji = getPersonaEmoji(persona);
  return chalk.cyan(`[${emoji} ${persona} 🏠] `);
}

/**
 * Print a WorkerMill-style coordinator log line.
 * Format: [coordinator] message
 */
export function wmCoordinatorLog(message: string): void {
  console.log(chalk.cyan("[coordinator] ") + chalk.white(message));
  logger.info(`[coordinator] ${message}`);
}

function renderTable(lines: string[]): void {
  const rows = lines.map(line =>
    line.split("|").map(cell => cell.trim()).filter(Boolean)
  );
  // Skip separator rows (only dashes/colons)
  const dataRows = rows.filter(row => !row.every(cell => /^[-:]+$/.test(cell)));
  if (dataRows.length === 0) return;

  const colWidths = dataRows[0].map((_, colIdx) =>
    Math.max(...dataRows.map(row => (row[colIdx] || "").length))
  );

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const formatted = row.map((cell, j) => cell.padEnd(colWidths[j] || 0)).join(" │ ");
    if (i === 0) {
      console.log(chalk.bold(`  ${formatted}`));
      console.log(chalk.dim(`  ${"─".repeat(formatted.length)}`));
    } else {
      console.log(chalk.white(`  ${formatted}`));
    }
  }
}

export function printAgentText(text: string): void {
  if (!text.trim()) return;

  let inCodeBlock = false;
  let codeLanguage = "";
  let codeLines: string[] = [];
  let inTable = false;
  let tableLines: string[] = [];

  for (const line of text.split("\n")) {
    if (line.startsWith("```") && !inCodeBlock) {
      // Flush table if we were in one
      if (inTable) {
        renderTable(tableLines);
        inTable = false;
        tableLines = [];
      }
      inCodeBlock = true;
      codeLanguage = line.slice(3).trim();
      codeLines = [];
      continue;
    }

    if (line.startsWith("```") && inCodeBlock) {
      inCodeBlock = false;
      // Print code block
      if (codeLanguage) {
        console.log(chalk.dim(`    ${codeLanguage}`));
      }
      for (const codeLine of codeLines) {
        console.log(chalk.white(`    ${highlightCode(codeLine)}`));
      }
      console.log();
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Table accumulation
    if (line.trimStart().startsWith("|")) {
      inTable = true;
      tableLines.push(line);
      continue;
    }

    // Flush table if we just left one
    if (inTable) {
      renderTable(tableLines);
      inTable = false;
      tableLines = [];
    }

    // Horizontal rule
    if (line.match(/^[-*_]{3,}\s*$/)) {
      console.log(chalk.dim(`  ${"─".repeat(Math.min(60, (process.stdout.columns || 80) - 4))}`));
      continue;
    }

    // Task list checkboxes
    if (line.match(/^[-*]\s+\[[ x]\]/)) {
      const checked = line.includes("[x]");
      const text = line.replace(/^[-*]\s+\[[ x]\]\s*/, "");
      console.log(chalk.white(`  ${checked ? "☑" : "☐"} ${text}`));
      continue;
    }

    // Nested lists (indented by 2+ spaces)
    const nestedListMatch = line.match(/^(\s{2,})[-*]\s+(.*)/);
    if (nestedListMatch) {
      const indent = Math.floor(nestedListMatch[1].length / 2);
      console.log(chalk.white(`  ${"  ".repeat(indent)}• ${nestedListMatch[2]}`));
      continue;
    }

    // Markdown rendering
    if (line.startsWith("# ")) {
      console.log(chalk.bold.white(`\n  ${line.slice(2)}`));
    } else if (line.startsWith("## ")) {
      console.log(chalk.bold.white(`\n  ${line.slice(3)}`));
    } else if (line.startsWith("### ")) {
      console.log(chalk.bold.dim(`\n  ${line.slice(4)}`));
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      console.log(chalk.white(`  ${line}`));
    } else if (line.startsWith("> ")) {
      console.log(chalk.dim(`  ${line}`));
    } else if (line.trim() === "") {
      console.log();
    } else {
      // Inline formatting
      let formatted = line;
      formatted = formatted.replace(/\*\*(.*?)\*\*/g, (_, text) => chalk.bold(text));
      formatted = formatted.replace(/`([^`]+)`/g, (_, code) => chalk.cyan(code));
      console.log(chalk.white(`  ${formatted}`));
    }
  }

  // Flush remaining table
  if (inTable && tableLines.length > 0) {
    renderTable(tableLines);
  }

  // Close unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    for (const codeLine of codeLines) {
      console.log(chalk.white(`    ${highlightCode(codeLine)}`));
    }
  }
}

function highlightCode(line: string): string {
  let result = line;
  // Strings
  result = result.replace(/(["'`])(?:(?=(\\?))\2.)*?\1/g, (m) => chalk.green(m));
  // Comments
  result = result.replace(/(\/\/.*$)/gm, (m) => chalk.dim(m));
  result = result.replace(/(#.*$)/gm, (m) => chalk.dim(m));
  // Keywords
  result = result.replace(
    /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|this|def|self|type|interface)\b/g,
    (m) => chalk.magenta(m)
  );
  // Types
  result = result.replace(
    /\b(string|number|boolean|void|null|undefined|true|false|Promise|Array)\b/g,
    (m) => chalk.yellow(m)
  );
  return result;
}

export function printError(message: string): void {
  console.log(chalk.red(`\n  ✗ ${message}\n`));
}

export function printSuccess(message: string): void {
  console.log(chalk.green(`\n  ✓ ${message}\n`));
}

// Session start time for elapsed display
const sessionStartTime = Date.now();

/** Format token count like Claude Code: 1.2k, 45k, 1.2M */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/** Format elapsed time like Claude Code: >1m, >5m, >12m */
function formatElapsed(): string {
  const mins = Math.floor((Date.now() - sessionStartTime) / 60_000);
  if (mins < 1) return "<1m";
  return `>${mins}m`;
}

/** Build a context usage bar (filled/empty blocks) like Claude Code */
function contextBar(tokens: number, maxContext: number): string {
  const barLen = 8;
  const usage = Math.min(1, tokens / maxContext);
  const filled = Math.round(usage * barLen);
  const empty = barLen - filled;
  const color = usage < 0.5 ? chalk.green : usage < 0.8 ? chalk.yellow : chalk.red;
  return color("\u2588".repeat(filled)) + chalk.dim("\u2591".repeat(empty));
}

export function printStatusBar(
  provider: string,
  model: string,
  tokens: number,
  permissionMode: string,
  cost?: number,
  maxContext?: number
): string {
  const width = process.stdout.columns || 80;
  const bg = chalk.bgRgb(30, 30, 30);

  // Model display — compact like Claude Code: [model]
  const modelDisplay = ` ${model} `;

  // Context bar — uses configured context length or provider default
  const bar = contextBar(tokens, maxContext || 128_000);
  const tokStr = formatTokens(tokens);

  // Tool counts — compact: Bash x3 | Read x5
  const shortNames: Record<string, string> = {
    bash: "Bash",
    read_file: "Read",
    write_file: "Write",
    edit_file: "Edit",
    glob: "Glob",
    grep: "Grep",
    ls: "List",
    fetch: "Fetch",
    patch: "Patch",
    sub_agent: "Agent",
    git: "Git",
  };

  const countParts = Object.entries(toolCounts)
    .filter(([_, count]) => count > 0)
    .map(([name, count]) => `${shortNames[name] || name} x${count}`);
  const toolStr = countParts.length > 0 ? countParts.join(" | ") : "";

  // Git branch (cached)
  const gitBranch = getGitBranch();

  // Working directory name
  const cwd = process.cwd().split("/").pop() || "";

  // Cost string
  const costStr = cost !== undefined && cost > 0 ? `~$${cost.toFixed(2)} | ` : "";

  // Time + mode
  const elapsed = formatElapsed();
  const modeStr = permissionMode || "ask";

  // Assemble: [model] [bar] tokens | cwd git:(branch) | tools | cost elapsed mode
  const left = bg.white(modelDisplay) + " " + bar + " " + bg.white(tokStr);
  const middle = gitBranch
    ? bg.dim(" | ") + bg.white(cwd) + bg.dim(" git:(") + bg.green(gitBranch) + bg.dim(")")
    : bg.dim(" | ") + bg.white(cwd);
  const tools = toolStr ? bg.dim(" | ") + bg.dim(toolStr) : "";
  const right = bg.dim(" | ") + bg.dim(costStr) + bg.white(elapsed) + bg.dim("  ") + bg.green(modeStr) + " ";

  // Calculate visible content length (strip ANSI for padding)
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const contentLen = stripAnsi(left).length + stripAnsi(middle).length + stripAnsi(tools).length + stripAnsi(right).length;
  const pad = Math.max(0, width - contentLen);

  return left + middle + tools + bg(" ".repeat(pad)) + right;
}
