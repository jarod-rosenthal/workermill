/**
 * Status Bar — shows agent connection status, active task count, and cost.
 *
 * Format: $(rocket) WorkerMill: 2 tasks · 4 experts · $1.23  |  ⚠ 1 blocker
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { AgentClient, type AgentStatus, type TaskInfo } from "./agent-client";

export class StatusBar {
  private item: vscode.StatusBarItem;
  private connected = false;
  private tasks: TaskInfo[] = [];
  private sandbox: "none" | "docker" = "none";
  private orgName: string | undefined;

  constructor(private client: AgentClient) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = "workermill.showTeamPanel";

    // Read org name from config
    try {
      const configPath = path.join(os.homedir(), ".workermill", "config.json");
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (raw.orgName) this.orgName = raw.orgName;
    } catch {
      /* no config */
    }

    this.update();
    this.item.show();

    client.on("connected", (status: AgentStatus) => {
      this.connected = true;
      if (status?.sandbox) this.sandbox = status.sandbox;
      // Refresh org name from config (may have changed during org switch)
      try {
        const cfgPath = path.join(os.homedir(), ".workermill", "config.json");
        const raw = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
        this.orgName = raw.orgName || undefined;
      } catch {
        /* ignore */
      }
      this.refreshAndUpdate();
    });

    client.on("disconnected", () => {
      this.connected = false;
      this.update();
    });

    client.on("snapshot", (tasks: TaskInfo[]) => {
      this.tasks = tasks;
      this.update();
    });

    client.on("task:started", () => this.refreshAndUpdate());
    client.on("task:completed", () => this.refreshAndUpdate());
    client.on("task:failed", () => this.refreshAndUpdate());
    client.on("task:planning", () => this.refreshAndUpdate());
    client.on("state:changed", () => this.refreshAndUpdate());
  }

  private async refreshAndUpdate(): Promise<void> {
    if (!this.client.isConnected()) return;
    try {
      const status = await this.client.getStatus();
      this.tasks = status.tasks || [];
      if (status.sandbox) this.sandbox = status.sandbox;
    } catch {
      try {
        this.tasks = await this.client.getTasks();
      } catch {
        /* ignore */
      }
    }
    this.update();
  }

  private update(): void {
    if (!this.connected) {
      this.item.text = "$(plug) WorkerMill: Disconnected";
      this.item.tooltip = "WorkerMill agent not running. Start with: workermill-agent start";
      this.item.backgroundColor = undefined;
      return;
    }

    const active = this.tasks.filter((t) => t.status === "running" || t.status === "planning");
    const failed = this.tasks.filter((t) => t.status === "failed");

    const sandboxTag = this.sandbox === "docker" ? " $(shield) Docker" : "";
    const orgTag = this.orgName ? ` [${this.orgName}]` : "";

    if (active.length === 0) {
      this.item.text = `$(rocket) WorkerMill${orgTag}: Idle${sandboxTag}`;
      this.item.tooltip = `WorkerMill agent connected — no active tasks${this.orgName ? `\nOrganization: ${this.orgName}` : ""}${this.sandbox === "docker" ? "\nDocker sandbox enabled" : ""}`;
      this.item.backgroundColor = undefined;
      return;
    }

    const parts: string[] = [`${active.length} task${active.length !== 1 ? "s" : ""}`];

    if (failed.length > 0) {
      parts.push(`${failed.length} failed`);
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else {
      this.item.backgroundColor = undefined;
    }

    this.item.text = `$(rocket) WorkerMill${orgTag}: ${parts.join(" · ")}${sandboxTag}`;
    this.item.tooltip = active.map((t) => `${t.status === "planning" ? "Planning" : "Running"}: ${t.summary}`).join("\n") + (this.sandbox === "docker" ? "\nDocker sandbox enabled" : "");
  }

  dispose(): void {
    this.item.dispose();
  }
}
