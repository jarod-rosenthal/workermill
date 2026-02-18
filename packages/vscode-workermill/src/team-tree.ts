/**
 * Team Tree View — sidebar tree showing active tasks, backlog, and recent.
 *
 * Structure:
 *   Active Tasks (N)
 *     ├── OCS-142: Add dark mode
 *     │   └── backend_developer — running
 *     └── OCS-143: Fix auth redirect
 *   Backlog (N)                          ← Jira tickets
 *     ├── ▶ OCS-150: Improve search      To Do
 *     └── ▶ OCS-151: Fix pagination       In Progress
 *   Recent (N)
 *     └── OCS-140: API rate limiting ✓
 */

import * as vscode from "vscode";
import { AgentClient, type TaskInfo, type IssueInfo } from "./agent-client";

type TreeItem = TaskTreeItem | IssueTreeItem | InfoTreeItem;

export class TeamTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private tasks: TaskInfo[] = [];
  private issues: IssueInfo[] = [];
  private connected = false;
  private issueLoadError: string | null = null;

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
    await this.refreshIssues();
    this._onDidChangeTreeData.fire(undefined);
  }

  async refreshIssues(): Promise<void> {
    if (!this.client.isConnected()) return;
    try {
      const result = await this.client.searchIssues();
      // Filter out completed issues client-side
      const doneStatuses = new Set(["done", "closed", "resolved"]);
      this.issues = (result.issues || []).filter(
        (i) => !i.status || !doneStatuses.has(i.status.toLowerCase()),
      );
      this.issueLoadError = null;
    } catch (err) {
      this.issueLoadError = err instanceof Error ? err.message : "Could not load issues";
    }
  }

  /** Search issues via the agent (for search command) */
  async searchIssues(query?: string, project?: string): Promise<IssueInfo[]> {
    if (!this.client.isConnected()) return [];
    try {
      const result = await this.client.searchIssues(query, project);
      return result.issues || [];
    } catch {
      return [];
    }
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

      // Active Tasks
      if (active.length > 0) {
        items.push(new InfoTreeItem(
          `Active Tasks (${active.length})`,
          undefined,
          "$(rocket)",
          vscode.TreeItemCollapsibleState.Expanded,
          active.map((t) => new TaskTreeItem(t)),
        ));
      } else {
        items.push(new InfoTreeItem("No active tasks", "Run a ticket from Backlog below", "$(inbox)"));
      }

      // Backlog (Jira issues)
      if (this.issueLoadError) {
        items.push(new InfoTreeItem("Backlog", this.issueLoadError, "$(list-unordered)"));
      } else if (this.issues.length > 0) {
        // Filter out issues that already have an active task
        const activeKeys = new Set(
          this.tasks
            .filter((t) => t.status === "running" || t.status === "planning")
            .map((t) => {
              // Extract issue key from summary (e.g. "OCS-142: Add dark mode" → "OCS-142")
              const match = t.summary.match(/^([A-Z]+-\d+)/);
              return match ? match[1] : null;
            })
            .filter(Boolean),
        );
        const backlogIssues = this.issues.filter((i) => !activeKeys.has(i.key));

        if (backlogIssues.length > 0) {
          items.push(new InfoTreeItem(
            `Backlog (${backlogIssues.length})`,
            undefined,
            "$(list-unordered)",
            vscode.TreeItemCollapsibleState.Expanded,
            backlogIssues.map((i) => new IssueTreeItem(i)),
          ));
        } else {
          items.push(new InfoTreeItem("Backlog", "All issues are being worked on", "$(list-unordered)"));
        }
      } else {
        items.push(new InfoTreeItem("Backlog", "No issues found", "$(list-unordered)"));
      }

      // Recent
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

    if (element instanceof IssueTreeItem) {
      // Issue children — show details
      const items: TreeItem[] = [];
      const i = element.issue;
      if (i.issueType) items.push(new InfoTreeItem(i.issueType, undefined, issueTypeIcon(i.issueType)));
      if (i.priority) items.push(new InfoTreeItem(i.priority, undefined, priorityIcon(i.priority)));
      if (i.assignee) items.push(new InfoTreeItem(i.assignee.displayName, undefined, "$(person)"));
      if (i.project) items.push(new InfoTreeItem(i.project.name, undefined, "$(repo)"));
      if (i.labels.length > 0) items.push(new InfoTreeItem(i.labels.join(", "), undefined, "$(tag)"));
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

    // Click a task → show feed in sidebar + open terminal
    this.command = {
      command: "workermill.selectTask",
      title: "Select Task",
      arguments: [task],
    };
  }
}

class IssueTreeItem extends vscode.TreeItem {
  constructor(public readonly issue: IssueInfo) {
    const label = `${issue.key}: ${issue.summary}`;
    const truncated = label.length > 55 ? label.substring(0, 55) + "..." : label;
    super(truncated, vscode.TreeItemCollapsibleState.Collapsed);

    this.id = `issue-${issue.key}`;
    this.description = issue.status || "";
    this.tooltip = `${issue.key}: ${issue.summary}\nStatus: ${issue.status || "Unknown"}\nType: ${issue.issueType || "Unknown"}\nPriority: ${issue.priority || "None"}\nAssignee: ${issue.assignee?.displayName || "Unassigned"}`;

    this.iconPath = new vscode.ThemeIcon("circle-outline", statusColor(issue.status));
    this.contextValue = "issue";

    // Click issue → show details in feed panel
    this.command = {
      command: "workermill.selectIssue",
      title: "Show Issue Details",
      arguments: [issue],
    };
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

function issueTypeIcon(issueType: string): string {
  const lower = issueType.toLowerCase();
  if (lower === "bug") return "$(bug)";
  if (lower === "story" || lower === "user story") return "$(bookmark)";
  if (lower === "epic") return "$(layers)";
  if (lower === "task") return "$(tasklist)";
  if (lower === "sub-task" || lower === "subtask") return "$(list-tree)";
  return "$(issue-opened)";
}

function priorityIcon(priority: string): string {
  const lower = priority.toLowerCase();
  if (lower === "highest" || lower === "blocker") return "$(arrow-up)";
  if (lower === "high" || lower === "critical") return "$(chevron-up)";
  if (lower === "medium") return "$(dash)";
  if (lower === "low") return "$(chevron-down)";
  if (lower === "lowest") return "$(arrow-down)";
  return "$(dash)";
}

function statusColor(status: string | null): vscode.ThemeColor | undefined {
  if (!status) return undefined;
  const lower = status.toLowerCase();
  if (lower === "done" || lower === "closed" || lower === "resolved") {
    return new vscode.ThemeColor("charts.green");
  }
  if (lower === "in progress" || lower === "in review") {
    return new vscode.ThemeColor("charts.blue");
  }
  return undefined; // default color for "To Do" etc.
}
