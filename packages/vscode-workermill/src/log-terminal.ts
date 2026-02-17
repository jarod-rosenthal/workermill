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
 */

import * as vscode from "vscode";
import type { AgentClient } from "./agent-client";

// ANSI color codes
const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

function colorize(line: string): string {
  if (/error|Error|ERROR|FAIL|panic|fatal/i.test(line)) return RED + line + RESET;
  if (/warn|Warning|WARNING/.test(line)) return YELLOW + line + RESET;
  if (/✓|success|PASS|completed|approved|merged/i.test(line)) return GREEN + line + RESET;
  if (/^(Cloning|Fetching|git |From |To |branch )/i.test(line)) return CYAN + line + RESET;
  if (/::result::|::pr_url::|::learning::|::blocker::/.test(line)) return BOLD + MAGENTA + line + RESET;
  if (/^\[.*?\]/.test(line)) return DIM + line + RESET;
  return line;
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
    this.writeLine(`${DIM}WorkerMill — streaming logs for task ${this.taskId.substring(0, 8)}...${RESET}`);
    this.writeLine("");

    // Poll cloud logs — curated postLog() messages only (same as dashboard)
    this.pollTimer = setInterval(() => this.pollCloudLogs(), 2000);
    this.pollCloudLogs();
  }

  close(): void {
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private writeLine(text: string): void {
    // Pseudoterminal needs \r\n for proper line breaks
    this.writeEmitter.fire(text + "\r\n");
  }

  private async pollCloudLogs(): Promise<void> {
    if (this.disposed) return;
    try {
      const raw = await this.client.getCloudLogs(this.taskId, this.lastLogTimestamp || undefined);

      // Handle both flat array and wrapped { logs: [...] } response formats
      const logs = (Array.isArray(raw) ? raw : (raw as { logs?: unknown[] })?.logs) as Array<{
        id: string; message: string; type?: string; severity?: string; createdAt: string;
        stdout?: string; stderr?: string; command?: string; exitCode?: number;
      }> | undefined;
      if (!logs) return;

      for (const log of logs) {
        if (this.seenLogIds.has(log.id)) continue;
        this.seenLogIds.add(log.id);

        // Colorize based on structured severity/type from the curated log
        if (log.message) {
          const color = log.severity === "error" ? RED
            : log.severity === "warn" ? YELLOW
            : null;
          this.writeLine(color ? color + log.message + RESET : colorize(log.message));
        }

        // Show command output if present (e.g., test runs, build output)
        if (log.stdout) this.writeLine(colorize(log.stdout));
        if (log.stderr) this.writeLine(RED + log.stderr + RESET);

        this.lastLogTimestamp = log.createdAt;
      }
    } catch { /* ignore */ }
  }
}

export class LogTerminalManager {
  private terminals = new Map<string, vscode.Terminal>();
  private client: AgentClient;

  constructor(client: AgentClient) {
    this.client = client;

    // Clean up references when terminals are closed by the user
    vscode.window.onDidCloseTerminal((t) => {
      for (const [id, term] of this.terminals) {
        if (term === t) { this.terminals.delete(id); break; }
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
    terminal.show();
  }

  dispose(): void {
    for (const terminal of this.terminals.values()) {
      terminal.dispose();
    }
    this.terminals.clear();
  }
}
