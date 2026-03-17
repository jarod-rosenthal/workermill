/**
 * Log Terminal — shows live task logs in VS Code's integrated terminal.
 *
 * Uses Pseudoterminal API so logs appear as a real terminal tab (bottom panel)
 * alongside the user's own terminals, with ANSI color support.
 *
 * Shows only curated logs from the cloud API (same as the dashboard).
 * Raw worker stdout/stderr is intentionally excluded — it contains noisy
 * internal orchestration output (epic coordinator, mutex checks, etc.)
 * that isn't useful to the end user.
 *
 * Large markdown blocks (PR comments, review output) are collapsed to a
 * single summary line — the same content is already visible in the activity
 * feed, on the ticket (Jira/GitHub), and in the web dashboard.
 */

import * as vscode from "vscode";
import type { AgentClient, TaskInfo } from "./agent-client";

// ANSI color codes — bright variants for better contrast in dark/light themes
const RESET = "\x1b[0m";
const RED = "\x1b[91m";
const GREEN = "\x1b[92m";
const YELLOW = "\x1b[93m";
const BLUE = "\x1b[94m";
const MAGENTA = "\x1b[95m";
const CYAN = "\x1b[96m";
const WHITE = "\x1b[97m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
// Muted orange — matches dashboard's text-orange-300/70 for recoverable errors
const ORANGE = "\x1b[38;5;216m";

// Persona → bright color mapping
const PERSONA_COLORS: Record<string, string> = {
  backend_developer: BLUE,
  frontend_developer: CYAN,
  qa_engineer: GREEN,
  devops_engineer: YELLOW,
  security_engineer: MAGENTA,
  tech_lead: WHITE,
  tech_writer: CYAN,
  project_manager: YELLOW,
};

/** Extract persona name from `[emoji persona_name icon]` prefix (no spaces around emojis) */
function extractPersona(line: string): { persona: string; prefixEnd: number } | null {
  const m = line.match(/^\[.+?(\w+).+?\]\s*/);
  if (!m) return null;
  const persona = m[1];
  if (persona in PERSONA_COLORS) return { persona, prefixEnd: m[0].length };
  return null;
}

/**
 * Determine the ANSI color for a log line using structured fields first,
 * then content-based regex fallback.
 *
 * Color mapping matches the dashboard legend exactly:
 *   Red       → Fatal errors (metadata.errorType === "fatal")
 *   Orange    → Recoverable/unclassified errors (muted, like dashboard text-orange-300/70)
 *   Yellow    → Warnings
 *   Cyan      → Worker/System messages
 *   Green     → Success
 *   Purple    → Commands ($ prefix, npm, git)
 *   Gray/White → Default
 */
interface LogMeta {
  severity?: string;
  logType?: string;
  metadata?: { errorType?: "fatal" | "recoverable"; [key: string]: unknown };
}

function getLogColor(line: string, meta?: LogMeta): string {
  const isFatalError = meta?.metadata?.errorType === "fatal";
  const isError =
    meta?.severity === "error" ||
    meta?.logType === "error" ||
    line.includes("[ERROR]") ||
    line.includes("Error") ||
    line.includes("error:");

  if (isError && isFatalError) return RED;
  if (isError) return ORANGE;

  if (
    meta?.severity === "warning" ||
    meta?.logType === "warning" ||
    line.includes("[WARN]") ||
    line.includes("Warning")
  )
    return YELLOW;

  if (line.includes("[worker]") || line.includes("Claude") || line.includes("Starting"))
    return CYAN;

  if (line.includes("[SUCCESS]") || line.includes("Completed") || line.includes("success"))
    return GREEN;

  if (line.startsWith("$") || line.includes("npm ") || line.includes("git "))
    return MAGENTA;

  if (/::result::|::pr_url::|::learning::|::blocker::/.test(line)) return MAGENTA;

  // Persona-prefixed lines get persona color
  const p = extractPersona(line);
  if (p) return PERSONA_COLORS[p.persona] || WHITE;

  // Dim internal/noise lines
  if (/^\[(THINKING|WAITING|POLLING|HEARTBEAT|MUTEX)\b/i.test(line)) return DIM;

  return WHITE;
}

function colorizeLine(line: string, meta?: LogMeta): string {
  if (!line.trim()) return line;

  const color = getLogColor(line, meta);

  // Persona-prefixed lines: bold prefix + colored body
  const p = extractPersona(line);
  if (p) {
    const pColor = PERSONA_COLORS[p.persona] || color;
    const prefix = line.substring(0, p.prefixEnd);
    const body = line.substring(p.prefixEnd);
    return BOLD + pColor + prefix + RESET + pColor + body + RESET;
  }

  return color + line + RESET;
}

/** Strip markdown syntax for terminal readability */
function stripMarkdown(text: string): string {
  return (
    text
      // Code fences
      .replace(/^```\w*$/gm, "")
      // Table separator rows (e.g. |---|---|) — handle optional leading whitespace
      .replace(/^\s*\|[\s\-:|]+\|$/gm, "")
      // Horizontal rules
      .replace(/^[-*_]{3,}$/gm, "")
      // Headers → UPPERCASE
      .replace(/^#{1,6}\s+(.+)$/gm, (_m, h: string) => h.toUpperCase())
      // Bold
      .replace(/\*\*(.+?)\*\*/g, "$1")
      // Italic
      .replace(/\*(.+?)\*/g, "$1")
      // Inline code
      .replace(/`([^`]+)`/g, "$1")
      // Links [text](url) → text (url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      // Table rows — strip leading/trailing pipes, keep cell content (handle optional indent)
      .replace(/^\s*\|(.+)\|$/gm, (_m, cells: string) =>
        cells
          .split("|")
          .map((c: string) => c.trim())
          .filter(Boolean)
          .join("  "),
      )
      // Cap excessive leading whitespace (preserve up to 4 spaces for basic indentation)
      .replace(/^([ \t]+)/gm, (_m, ws: string) => (ws.length > 4 ? "    " : ws))
      // Collapse 3+ consecutive blank lines to 1
      .replace(/\n{3,}/g, "\n\n")
  );
}

/** Collapse large markdown blocks (review output, merge validation) to a summary */
function collapseCommentBlock(message: string, type?: string): string | null {
  if (type !== "manager") return null;

  const lines = message.split("\n");
  if (lines.length < 5) return null;

  // Count markdown signals
  let signals = 0;
  for (const l of lines) {
    if (/^\s*\|.+\|$/.test(l)) signals++; // table row
    if (/^#{1,6}\s/.test(l)) signals++; // header
    if (/\*\*.+\*\*/.test(l)) signals++; // bold
    if (/^```/.test(l)) signals++; // code fence
    if (signals >= 2) break;
  }
  if (signals < 2) return null;

  // Find first non-empty, non-markdown-decoration line as preview
  const preview =
    lines.find((l) => l.trim() && !/^```|^#{1,6}\s|^\|[\s\-:|]+\||^[-*_]{3,}$/.test(l.trim())) ||
    lines[0];
  const sizeKB = Math.round(Buffer.byteLength(message, "utf8") / 1024);
  const previewTrimmed = preview.trim().substring(0, 80);

  return `${DIM}[collapsed ${lines.length} lines, ${sizeKB}KB] ${previewTrimmed}${lines.length > 1 ? "..." : ""}${RESET}`;
}

class TaskPseudoterminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<void>();
  onDidWrite = this.writeEmitter.event;
  onDidClose = this.closeEmitter.event;

  private client: AgentClient;
  private taskId: string;
  private pollTimer: NodeJS.Timeout | null = null;
  private seenLogIds = new Set<string>();
  private lastLogTimestamp: string | null = null;
  private disposed = false;
  private consecutiveErrors = 0;
  private currentInterval = 4_000;

  constructor(client: AgentClient, taskId: string) {
    this.client = client;
    this.taskId = taskId;
  }

  open(): void {
    this.writeLine(
      `${DIM}WorkerMill — streaming logs for task ${this.taskId.substring(0, 8)}...${RESET}`,
    );
    this.writeLine("");

    // Poll cloud logs — curated postLog() messages only (same as dashboard)
    this.consecutiveErrors = 0;
    this.currentInterval = 4_000;
    this.pollTimer = setInterval(() => this.pollCloudLogs(), this.currentInterval);
    this.pollCloudLogs();
  }

  close(): void {
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  /** Restart polling after a retry — resume log streaming */
  restart(): void {
    if (this.disposed) return;
    this.writeLine("");
    this.writeLine(`${DIM}--- Retrying task ---${RESET}`);
    this.writeLine("");
    if (!this.pollTimer) {
      this.currentInterval = 4_000;
      this.consecutiveErrors = 0;
      this.pollCloudLogs();
    }
  }

  /** Stop polling and write a final status line */
  onTaskFinished(status: "completed" | "failed"): void {
    // Do one last poll to capture final logs, then stop
    this.pollCloudLogs().then(() => {
      if (this.disposed) return;
      this.writeLine("");
      this.writeLine(
        status === "completed"
          ? `${GREEN}${BOLD}--- Task completed ---${RESET}`
          : `${RED}${BOLD}--- Task failed ---${RESET}`,
      );
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    });
  }

  private writeLine(text: string): void {
    // Pseudoterminal needs \r\n for proper line breaks
    this.writeEmitter.fire(text + "\r\n");
  }

  private writeMultiline(text: string, meta?: LogMeta): void {
    for (const line of text.split("\n")) {
      this.writeLine(colorizeLine(line, meta));
    }
  }

  private resetInterval(ms: number): void {
    this.currentInterval = ms;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.pollCloudLogs(), ms);
  }

  private async pollCloudLogs(): Promise<void> {
    if (this.disposed) return;
    if (!this.client.isConnected()) return;
    try {
      const raw = await this.client.getCloudLogs(
        this.taskId,
        this.lastLogTimestamp || undefined,
      );

      // Handle both flat array and wrapped { logs: [...] } response formats
      const logs = (Array.isArray(raw) ? raw : (raw as { logs?: unknown[] })?.logs) as
        | Array<{
            id: string;
            message: string;
            type?: string;
            severity?: string;
            createdAt: string;
            stdout?: string;
            stderr?: string;
            command?: string;
            exitCode?: number;
            metadata?: { errorType?: "fatal" | "recoverable"; [key: string]: unknown };
          }>
        | undefined;
      if (!logs) return;

      for (const log of logs) {
        if (this.seenLogIds.has(log.id)) continue;
        this.seenLogIds.add(log.id);

        // Colorize using structured fields (severity, logType, metadata)
        // to match the dashboard legend exactly
        if (log.message) {
          // Try collapsing large markdown blocks first
          const collapsed = collapseCommentBlock(log.message, log.type);
          if (collapsed) {
            this.writeLine(collapsed);
          } else {
            const cleaned = stripMarkdown(log.message);
            const meta: LogMeta = {
              severity: log.severity,
              logType: log.type,
              metadata: log.metadata,
            };
            this.writeMultiline(cleaned, meta);
          }
        }

        // Show command output if present (e.g., test runs, build output)
        if (log.stdout) this.writeMultiline(log.stdout);
        if (log.stderr) {
          for (const line of log.stderr.split("\n")) {
            this.writeLine(RED + line + RESET);
          }
        }

        this.lastLogTimestamp = log.createdAt;
      }

      this.consecutiveErrors = 0;
      if (this.currentInterval !== 4_000) {
        this.resetInterval(4_000);
      }
    } catch {
      this.consecutiveErrors++;
      if (this.consecutiveErrors >= 3) {
        const backed = Math.min(this.currentInterval * 2, 30_000);
        this.resetInterval(backed);
      }
    }
  }
}

export class LogTerminalManager {
  private terminals = new Map<string, vscode.Terminal>();
  private ptys = new Map<string, TaskPseudoterminal>();
  private client: AgentClient;

  constructor(client: AgentClient) {
    this.client = client;

    // Clean up references when terminals are closed by the user
    vscode.window.onDidCloseTerminal((t) => {
      for (const [id, term] of this.terminals) {
        if (term === t) {
          this.terminals.delete(id);
          this.ptys.delete(id);
          break;
        }
      }
    });
  }

  /** Open (or focus) a log terminal for a task. Restarts polling if terminal was stopped. */
  openLogs(taskId: string, taskSummary: string): void {
    // Reuse existing terminal — restart polling if it was stopped (retry scenario)
    const existing = this.terminals.get(taskId);
    if (existing) {
      existing.show();
      const pty = this.ptys.get(taskId);
      if (pty) pty.restart();
      return;
    }

    const short = taskSummary.length > 35 ? taskSummary.substring(0, 35) + "..." : taskSummary;
    const pty = new TaskPseudoterminal(this.client, taskId);
    const terminal = vscode.window.createTerminal({
      name: `WM: ${short}`,
      pty,
      iconPath: new vscode.ThemeIcon("radio-tower"),
    });

    this.terminals.set(taskId, terminal);
    this.ptys.set(taskId, pty);
    terminal.show();
  }

  /** Notify that a task has finished — stop polling its log terminal */
  onTaskFinished(taskId: string, status: "completed" | "failed"): void {
    const pty = this.ptys.get(taskId);
    if (pty) {
      pty.onTaskFinished(status);
    }
  }

  /** Remove PTYs for tasks no longer in the agent's task list */
  reconcile(activeTasks: TaskInfo[]): void {
    const activeIds = new Set(activeTasks.map((t) => t.id));
    for (const [id, pty] of this.ptys) {
      if (!activeIds.has(id)) {
        pty.onTaskFinished("completed");
        this.ptys.delete(id);
      }
    }
  }

  dispose(): void {
    for (const terminal of this.terminals.values()) {
      terminal.dispose();
    }
    this.terminals.clear();
    this.ptys.clear();
  }
}
