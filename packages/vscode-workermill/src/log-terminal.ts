/**
 * Log Terminal — shows live task logs in a VS Code terminal/output channel.
 *
 * Creates an output channel per task with live log streaming from the agent.
 */

import * as vscode from "vscode";
import { AgentClient, type LogLine } from "./agent-client";

export class LogTerminalManager {
  private channels = new Map<string, vscode.OutputChannel>();
  private unsubscribers = new Map<string, () => void>();

  constructor(private client: AgentClient) {}

  /** Open (or focus) a log stream for a task */
  openLogs(taskId: string, taskSummary: string): void {
    // Reuse existing channel
    if (this.channels.has(taskId)) {
      this.channels.get(taskId)!.show(true);
      return;
    }

    const short = taskSummary.length > 30 ? taskSummary.substring(0, 30) + "..." : taskSummary;
    const channel = vscode.window.createOutputChannel(`WorkerMill: ${short}`, "log");
    this.channels.set(taskId, channel);
    channel.show(true);

    // Subscribe to live log stream
    const unsub = this.client.subscribeToLogs(taskId, (log: LogLine) => {
      channel.appendLine(log.line);
    });
    this.unsubscribers.set(taskId, unsub);
  }

  /** Close and clean up a specific task's log channel */
  closeLogs(taskId: string): void {
    const unsub = this.unsubscribers.get(taskId);
    if (unsub) { unsub(); this.unsubscribers.delete(taskId); }
    const channel = this.channels.get(taskId);
    if (channel) { channel.dispose(); this.channels.delete(taskId); }
  }

  dispose(): void {
    for (const unsub of this.unsubscribers.values()) unsub();
    for (const channel of this.channels.values()) channel.dispose();
    this.unsubscribers.clear();
    this.channels.clear();
  }
}
