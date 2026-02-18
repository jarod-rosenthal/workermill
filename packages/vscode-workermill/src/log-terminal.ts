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

/** Extract persona name from `[emoji persona_name icon]` prefix */
function extractPersona(line: string): { persona: string; prefixEnd: number } | null {
  const m = line.match(/^\[.+?\s+(\w+)\s+.+?\]\s*/);
  if (!m) return null;
  const persona = m[1];
  if (persona in PERSONA_COLORS) return { persona, prefixEnd: m[0].length };
  return null;
}

function colorize(line: string): string {
  if (/error|Error|ERROR|FAIL|panic|fatal/i.test(line)) return RED + line + RESET;
  if (/warn|Warning|WARNING/.test(line)) return YELLOW + line + RESET;
  if (/✓|success|PASS|completed|approved|merged/i.test(line)) return GREEN + line + RESET;
  if (/^(Cloning|Fetching|git |From |To |branch )/i.test(line)) return CYAN + line + RESET;
  if (/::result::|::pr_url::|::learning::|::blocker::/.test(line)) return BOLD + MAGENTA + line + RESET;

  // Persona-prefixed lines get persona color
  const p = extractPersona(line);
  if (p) {
    const color = PERSONA_COLORS[p.persona];
    const prefix = line.substring(0, p.prefixEnd);
    const body = line.substring(p.prefixEnd);
    return BOLD + color + prefix + RESET + color + body + RESET;
  }

  // Only dim truly internal/noise lines
  if (/^\[(THINKING|WAITING|POLLING|HEARTBEAT|MUTEX)\b/i.test(line)) return DIM + line + RESET;

  // Default: bright white so text isn't washed out by the terminal's default foreground
  if (line.trim()) return WHITE + line + RESET;
  return line;
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
    this.pollTimer = setInterval(() => this.pollCloudLogs(), 2000);
    this.pollCloudLogs();
  }

  close(): void {
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
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

  private writeMultiline(text: string): void {
    for (const line of text.split("\n")) {
      this.writeLine(colorize(line));
    }
  }

  private async pollCloudLogs(): Promise<void> {
    if (this.disposed) return;
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
          }>
        | undefined;
      if (!logs) return;

      for (const log of logs) {
        if (this.seenLogIds.has(log.id)) continue;
        this.seenLogIds.add(log.id);

        // Colorize based on structured severity/type from the curated log
        if (log.message) {
          // Try collapsing large markdown blocks first
          const collapsed = collapseCommentBlock(log.message, log.type);
          if (collapsed) {
            this.writeLine(collapsed);
          } else {
            const cleaned = stripMarkdown(log.message);
            const color =
              log.severity === "error" ? RED : log.severity === "warn" ? YELLOW : null;
            if (color) {
              for (const line of cleaned.split("\n")) {
                this.writeLine(color + line + RESET);
              }
            } else {
              this.writeMultiline(cleaned);
            }
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
    } catch {
      /* ignore */
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

  /** Open (or focus) a log terminal for a task */
  openLogs(taskId: string, taskSummary: string): void {
    // Reuse existing terminal
    const existing = this.terminals.get(taskId);
    if (existing) {
      existing.show();
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
