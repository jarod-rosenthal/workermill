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
    client.on("task:failed", (info: { id: string; error?: string }) => this.onTaskFailed(info));
    client.on("task:rate_limited", (info: { id: string }) => this.onTaskRateLimited(info));
  }

  private async onTaskCompleted(info: { id: string }): Promise<void> {
    try {
      const task = await this.client.getTask(info.id);
      const short = task.summary.length > 40 ? task.summary.substring(0, 40) + "..." : task.summary;
      const prUrl = task.prUrl || task.githubPrUrl;
      const actions = prUrl ? ["Open PR", "Show Logs"] : ["Show Logs"];
      vscode.window.showInformationMessage(
        `WorkerMill: "${short}" completed${prUrl ? " — PR ready" : ""}`,
        ...actions,
      ).then((action) => {
        if (action === "Open PR" && prUrl) {
          vscode.env.openExternal(vscode.Uri.parse(prUrl));
        } else if (action === "Show Logs") {
          vscode.commands.executeCommand("workermill.showTaskLogs");
        }
      });
    } catch { /* ignore */ }
  }

  private async onTaskFailed(info: { id: string; error?: string }): Promise<void> {
    try {
      const task = await this.client.getTask(info.id);
      const short = task.summary.length > 40 ? task.summary.substring(0, 40) + "..." : task.summary;
      const errorDetail = info.error ? `: ${info.error}` : "";
      vscode.window.showWarningMessage(
        `WorkerMill: "${short}" failed${errorDetail}`,
        "Show Logs",
        "Retry",
      ).then(async (action) => {
        if (action === "Show Logs") {
          vscode.commands.executeCommand("workermill.showTaskLogs");
        } else if (action === "Retry") {
          try {
            await this.client.retryTask(info.id);
            vscode.window.showInformationMessage(`WorkerMill: Retrying "${short}"`);
          } catch (err) {
            vscode.window.showErrorMessage(
              `Retry failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      });
    } catch { /* ignore */ }
  }

  private onTaskRateLimited(_info: { id: string }): void {
    vscode.window.showWarningMessage(
      "WorkerMill: Anthropic usage limit reached. Task paused — retry from the dashboard when your limit resets.",
      "Open Dashboard",
    ).then((action) => {
      if (action === "Open Dashboard") {
        vscode.env.openExternal(vscode.Uri.parse("https://workermill.com"));
      }
    });
  }

  dispose(): void {
    // No cleanup needed — notification handlers are GC'd with the client
  }
}
