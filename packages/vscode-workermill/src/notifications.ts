/**
 * Notifications — VS Code native notifications for high-priority agent events.
 *
 * - Blocker escalated → error notification with Retry/Skip/Abort actions
 * - Task completed → info notification with Open PR action
 * - Task failed → warning notification with Retry action
 * - Plan ready → info notification with Approve/Edit actions
 */

import * as vscode from "vscode";
import { AgentClient, type TaskInfo } from "./agent-client";

export class NotificationManager {
  constructor(private client: AgentClient) {
    client.on("task:completed", (info: { id: string }) => this.onTaskCompleted(info));
    client.on("task:failed", (info: { id: string }) => this.onTaskFailed(info));
  }

  private async onTaskCompleted(info: { id: string }): Promise<void> {
    try {
      const task = await this.client.getTask(info.id);
      const short = task.summary.length > 40 ? task.summary.substring(0, 40) + "..." : task.summary;
      vscode.window.showInformationMessage(
        `WorkerMill: "${short}" completed`,
        "Show Logs",
      ).then((action) => {
        if (action === "Show Logs") {
          vscode.commands.executeCommand("workermill.showTaskLogs");
        }
      });
    } catch { /* ignore */ }
  }

  private async onTaskFailed(info: { id: string }): Promise<void> {
    try {
      const task = await this.client.getTask(info.id);
      const short = task.summary.length > 40 ? task.summary.substring(0, 40) + "..." : task.summary;
      vscode.window.showWarningMessage(
        `WorkerMill: "${short}" failed`,
        "Show Logs",
        "Retry",
      ).then((action) => {
        if (action === "Show Logs") {
          vscode.commands.executeCommand("workermill.showTaskLogs");
        }
        // Retry would need task recreation via cloud API
      });
    } catch { /* ignore */ }
  }

  dispose(): void {
    // No cleanup needed — notification handlers are GC'd with the client
  }
}
