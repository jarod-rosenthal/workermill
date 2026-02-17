/**
 * Team Tree View — sidebar tree showing active tasks and expert status.
 *
 * Structure:
 *   Active Tasks (N)
 *     ├── OCS-142: Add dark mode
 *     │   └── backend_developer — running
 *     └── OCS-143: Fix auth redirect
 *   Recent (N)
 *     └── OCS-140: API rate limiting ✓
 */

import * as vscode from "vscode";
import { AgentClient, type TaskInfo } from "./agent-client";

type TreeItem = TaskTreeItem | InfoTreeItem;

export class TeamTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private tasks: TaskInfo[] = [];
  private connected = false;

  constructor(private client: AgentClient) {
    // Listen for task state changes
    client.on("connected", () => {
      this.connected = true;
      this.refresh();
    });

    client.on("disconnected", () => {
      this.connected = false;
      this._onDidChangeTreeData.fire(undefined);
    });

    client.on("snapshot", (tasks: TaskInfo[]) => {
      this.tasks = tasks;
      this._onDidChangeTreeData.fire(undefined);
    });

    client.on("task:started", () => this.refresh());
    client.on("task:completed", () => this.refresh());
    client.on("task:failed", () => this.refresh());
    client.on("task:planning", () => this.refresh());
    client.on("task:plan_done", () => this.refresh());
    client.on("state:changed", () => this.refresh());
  }

  async refresh(): Promise<void> {
    if (!this.client.isConnected()) return;
    try {
      this.tasks = await this.client.getTasks();
    } catch { /* ignore */ }
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    if (!this.connected) {
      return [new InfoTreeItem("Agent not connected", "Waiting for workermill-agent...", "$(plug)")];
    }

    if (!element) {
      // Root level — show categories
      const active = this.tasks.filter((t) => t.status === "running" || t.status === "planning");
      const recent = this.tasks.filter((t) => t.status === "completed" || t.status === "failed");

      const items: TreeItem[] = [];

      if (active.length > 0) {
        items.push(new InfoTreeItem(
          `Active Tasks (${active.length})`,
          undefined,
          "$(rocket)",
          vscode.TreeItemCollapsibleState.Expanded,
          active.map((t) => new TaskTreeItem(t)),
        ));
      } else {
        items.push(new InfoTreeItem("No active tasks", "Label a ticket or run a task to start", "$(inbox)"));
      }

      if (recent.length > 0) {
        items.push(new InfoTreeItem(
          `Recent (${recent.length})`,
          undefined,
          "$(history)",
          vscode.TreeItemCollapsibleState.Collapsed,
          recent.map((t) => new TaskTreeItem(t)),
        ));
      }

      return items;
    }

    if (element instanceof InfoTreeItem) {
      return element.children || [];
    }

    if (element instanceof TaskTreeItem) {
      // Task children — show persona, model, repo
      const items: TreeItem[] = [];
      const t = element.task;
      if (t.persona) items.push(new InfoTreeItem(t.persona, undefined, personaIcon(t.persona)));
      if (t.model) items.push(new InfoTreeItem(t.model, undefined, "$(hubot)"));
      if (t.repo) items.push(new InfoTreeItem(t.repo, undefined, "$(repo)"));
      return items;
    }

    return [];
  }
}

class TaskTreeItem extends vscode.TreeItem {
  constructor(public readonly task: TaskInfo) {
    const label = task.summary.length > 50 ? task.summary.substring(0, 50) + "..." : task.summary;
    super(label, vscode.TreeItemCollapsibleState.Collapsed);

    this.id = task.id;
    this.description = task.status;
    this.tooltip = `${task.summary}\nStatus: ${task.status}\nPersona: ${task.persona || "default"}\nStarted: ${task.startedAt}`;

    switch (task.status) {
      case "running":
        this.iconPath = new vscode.ThemeIcon("sync~spin", new vscode.ThemeColor("charts.green"));
        break;
      case "planning":
        this.iconPath = new vscode.ThemeIcon("lightbulb", new vscode.ThemeColor("charts.yellow"));
        break;
      case "completed":
        this.iconPath = new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.green"));
        break;
      case "failed":
        this.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
        break;
    }

    this.contextValue = `task-${task.status}`;
  }
}

class InfoTreeItem extends vscode.TreeItem {
  children?: TreeItem[];

  constructor(
    label: string,
    description?: string,
    icon?: string,
    collapsibleState?: vscode.TreeItemCollapsibleState,
    children?: TreeItem[],
  ) {
    super(label, children ? (collapsibleState ?? vscode.TreeItemCollapsibleState.Expanded) : vscode.TreeItemCollapsibleState.None);
    if (description) this.description = description;
    if (icon) this.iconPath = new vscode.ThemeIcon(icon.replace("$(", "").replace(")", ""));
    this.children = children;
  }
}

function personaIcon(persona: string): string {
  const map: Record<string, string> = {
    frontend_developer: "$(paintcan)",
    backend_developer: "$(server)",
    devops_engineer: "$(gear)",
    security_engineer: "$(shield)",
    qa_engineer: "$(beaker)",
    database_administrator: "$(database)",
    tech_writer: "$(book)",
    project_manager: "$(checklist)",
    planning_agent: "$(lightbulb)",
  };
  return map[persona] || "$(person)";
}
