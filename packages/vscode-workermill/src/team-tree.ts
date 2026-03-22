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
  agentConfigured = false;

  /** Debounce timer — coalesces rapid-fire events into a single refresh */
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guard against concurrent refresh() calls racing each other */
  private refreshInFlight = false;
  /** Periodic poll interval — catches missed SSE events */
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  /** Progress stage per task — parsed from log lines for richer status display */
  private taskStages = new Map<string, string>();

  constructor(private client: AgentClient) {
    // Listen for task state changes
    client.on("connected", () => {
      this.connected = true;
      this.refresh();
      this.startPolling();
    });

    client.on("disconnected", () => {
      this.connected = false;
      this.stopPolling();
      this._onDidChangeTreeData.fire(undefined);
    });

    // Snapshot from agent cleanup timer only contains in-memory tasks —
    // fetch the full merged list instead of blindly replacing.
    client.on("snapshot", () => this.scheduleRefresh());

    client.on("task:started", (info: { id: string }) => {
      this.taskStages.set(info.id, "starting");
      this.scheduleRefresh();
    });
    client.on("task:completed", (info: { id: string }) => {
      this.taskStages.delete(info.id);
      this.scheduleRefresh();
    });
    client.on("task:failed", (info: { id: string }) => {
      this.taskStages.delete(info.id);
      this.scheduleRefresh();
    });
    client.on("task:planning", (info: { id: string }) => {
      this.taskStages.set(info.id, "planning");
      this.scheduleRefresh();
    });
    client.on("task:plan_done", () => this.scheduleRefresh());
    client.on("state:changed", () => this.scheduleRefresh());

    // Parse log lines for progress stage keywords
    client.on("task:log", (info: { id: string; line: string }) => {
      const stage = this.parseStage(info.line);
      if (stage) {
        this.taskStages.set(info.id, stage);
        this.scheduleRefresh();
      }
    });
  }

  /** Extract a human-readable stage from a worker log line */
  private parseStage(line: string): string | null {
    // Order matters — match most specific first
    if (/\[CI Gate\].*polling/i.test(line)) return "CI polling";
    if (/\[CI Gate\].*passed/i.test(line)) return "CI passed";
    if (/\[CI Gate\].*failed/i.test(line)) return "CI failed";
    if (/\[CI Gate\].*fix/i.test(line)) return "CI fix";
    if (/\[CI Gate\]/i.test(line)) return "CI check";
    if (/\[validation\].*PR/i.test(line)) return "creating PR";
    if (/\[validation\].*push/i.test(line)) return "pushing";
    if (/\[validation\]/i.test(line)) return "validating";
    if (/quality.gate|pre-commit|running.*lint|running.*test|running.*typecheck|running.*build/i.test(line)) return "quality gate";
    if (/tech.lead.*review|manager.*review/i.test(line)) return "review";
    if (/self.review/i.test(line)) return "self-review";
    if (/cloning|clone.*repo/i.test(line)) return "cloning repo";
    if (/\[coordinator\].*spawn/i.test(line)) return "spawning expert";
    if (/expert.*start|story.*start|executing.*story/i.test(line)) return "coding";
    if (/pulling.*image|docker.*pull/i.test(line)) return "pulling image";
    return null;
  }

  /** Get the display stage for a task, falling back to status */
  getTaskStage(taskId: string): string | undefined {
    return this.taskStages.get(taskId);
  }

  /** Debounced refresh — coalesces events within 300ms into a single fetch */
  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refresh();
    }, 300);
  }

  /** Poll task status every 15s to catch missed SSE events */
  private startPolling(): void {
    this.stopPolling();
    this.pollInterval = setInterval(() => this.scheduleRefresh(), 15000);
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  dispose(): void {
    this.stopPolling();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  async refresh(): Promise<void> {
    if (!this.client.isConnected()) return;
    // Skip if a refresh is already in flight — it will pick up latest state
    if (this.refreshInFlight) return;
    this.refreshInFlight = true;
    try {
      this.tasks = await this.client.getTasks();
    } catch { /* ignore */ }
    await this.refreshIssues();
    this.refreshInFlight = false;
    this._onDidChangeTreeData.fire(undefined);
  }

  async refreshIssues(): Promise<void> {
    if (!this.client.isConnected()) return;
    try {
      const statusFilter = vscode.workspace.getConfiguration("workermill").get<string>("issueStatusFilter") || "";
      const result = await this.client.searchIssues(undefined, undefined, statusFilter || undefined);
      this.issues = result.issues || [];
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
      // Return empty so viewsWelcome content shows for both states
      return [];
    }

    if (!element) {
      // Root level — show categories
      const activeStatuses = new Set([
        "planning", "pending_plan_approval",
        "queued", "dispatching", "claimed", "environment_setup", "executing",
        "running", "reviewing", "consolidating", "integration_check", "deploying",
        "blocked", "manager_review", "revision_needed",
      ]);
      const doneStatuses = new Set([
        "pr_created", "review_requested", "pr_approved", "review_approved",
        "completed", "deployed",
      ]);
      const terminalFailStatuses = new Set([
        "failed", "cancelled", "review_rejected",
      ]);
      const attentionStatuses = new Set([
        "escalated",
      ]);
      const active = this.tasks.filter((t) => activeStatuses.has(t.status));
      const approved = this.tasks.filter((t) => doneStatuses.has(t.status));
      const terminalFailed = this.tasks.filter((t) => terminalFailStatuses.has(t.status));
      const needsAttention = this.tasks.filter((t) => attentionStatuses.has(t.status));

      const items: TreeItem[] = [];

      // Active Tasks
      if (active.length > 0) {
        items.push(new InfoTreeItem(
          `Active Tasks (${active.length})`,
          undefined,
          "$(rocket)",
          vscode.TreeItemCollapsibleState.Expanded,
          active.map((t) => new TaskTreeItem(t, this.taskStages.get(t.id))),
        ));
      } else {
        items.push(new InfoTreeItem("No active tasks", "Click + to create your first task", "$(inbox)"));
      }

      // Backlog (Jira issues)
      if (this.issueLoadError) {
        items.push(new InfoTreeItem("Backlog", this.issueLoadError, "$(list-unordered)"));
      } else if (this.issues.length > 0) {
        // Filter out issues that already have an active task
        const activeKeys = new Set(
          this.tasks
            .filter((t) => activeStatuses.has(t.status))
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
        items.push(new InfoTreeItem("Backlog", "Connect a repo in Settings to see issues", "$(list-unordered)"));
      }

      // PR Approved — tasks that completed successfully (always visible)
      if (approved.length > 0) {
        items.push(new InfoTreeItem(
          `PR Approved (${approved.length})`,
          undefined,
          "$(check-all)",
          vscode.TreeItemCollapsibleState.Expanded,
          approved.map((t) => new TaskTreeItem(t)),
        ));
      } else {
        items.push(new InfoTreeItem("PR Approved", "No completed tasks yet", "$(check-all)"));
      }

      // Failed/Cancelled — terminal failure states (collapsed by default)
      if (terminalFailed.length > 0) {
        items.push(new InfoTreeItem(
          `Failed/Cancelled (${terminalFailed.length})`,
          undefined,
          "$(error)",
          vscode.TreeItemCollapsibleState.Collapsed,
          terminalFailed.map((t) => new TaskTreeItem(t)),
        ));
      }

      // Needs Attention — escalated tasks requiring user action
      if (needsAttention.length > 0) {
        items.push(new InfoTreeItem(
          `Needs Attention (${needsAttention.length})`,
          undefined,
          "$(warning)",
          vscode.TreeItemCollapsibleState.Expanded,
          needsAttention.map((t) => new TaskTreeItem(t)),
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
      if (i.dependencyCount && i.dependencyCount > 0) {
        const met = i.dependencyCount - (i.blockedByCount ?? 0);
        const icon = (i.blockedByCount ?? 0) > 0 ? "$(lock)" : "$(unlock)";
        items.push(new InfoTreeItem(`${met}/${i.dependencyCount} deps met`, undefined, icon));
      }
      if (i.assignee) items.push(new InfoTreeItem(i.assignee.displayName, undefined, "$(person)"));
      if (i.project) items.push(new InfoTreeItem(i.project.name, undefined, "$(repo)"));
      if (i.labels.length > 0) items.push(new InfoTreeItem(i.labels.join(", "), undefined, "$(tag)"));
      return items;
    }

    return [];
  }
}

class TaskTreeItem extends vscode.TreeItem {
  constructor(public readonly task: TaskInfo, stage?: string) {
    const fullLabel = task.jiraIssueKey ? `${task.jiraIssueKey}: ${task.summary}` : task.summary;
    const label = fullLabel.length > 55 ? fullLabel.substring(0, 55) + "..." : fullLabel;
    super(label, vscode.TreeItemCollapsibleState.Collapsed);

    this.id = task.id;
    // Show progress stage for active tasks, raw status for terminal states
    const activeForStage = new Set(["running", "executing", "planning", "pending_plan_approval",
      "consolidating", "integration_check", "deploying", "queued", "dispatching", "claimed", "environment_setup"]);
    this.description = activeForStage.has(task.status) && stage
      ? stage
      : task.status;
    this.tooltip = `${task.summary}\nStatus: ${task.status}${stage ? `\nStage: ${stage}` : ""}\nPersona: ${task.persona || "default"}\nStarted: ${task.startedAt}${task.errorMessage ? `\nError: ${task.errorMessage}` : ""}`;

    switch (task.status) {
      // Active — spinning
      case "running":
      case "executing":
      case "consolidating":
      case "integration_check":
      case "deploying":
        this.iconPath = new vscode.ThemeIcon("sync~spin", new vscode.ThemeColor("charts.green"));
        break;
      // Planning — yellow
      case "planning":
      case "pending_plan_approval":
        this.iconPath = new vscode.ThemeIcon("lightbulb", new vscode.ThemeColor("charts.yellow"));
        break;
      // Queued/starting — waiting
      case "queued":
      case "dispatching":
      case "claimed":
      case "environment_setup":
        this.iconPath = new vscode.ThemeIcon("clock", new vscode.ThemeColor("charts.yellow"));
        break;
      // Blocked/review in progress
      case "blocked":
        this.iconPath = new vscode.ThemeIcon("lock", new vscode.ThemeColor("charts.orange"));
        break;
      case "manager_review":
      case "reviewing":
        this.iconPath = new vscode.ThemeIcon("eye", new vscode.ThemeColor("charts.blue"));
        break;
      case "revision_needed":
        this.iconPath = new vscode.ThemeIcon("pencil", new vscode.ThemeColor("charts.orange"));
        break;
      // PR created/awaiting review
      case "pr_created":
      case "review_requested":
        this.iconPath = new vscode.ThemeIcon("git-pull-request", new vscode.ThemeColor("charts.blue"));
        break;
      // Approved/completed
      case "pr_approved":
      case "review_approved":
        this.iconPath = new vscode.ThemeIcon("check-all", new vscode.ThemeColor("charts.green"));
        break;
      case "completed":
      case "deployed":
        this.iconPath = new vscode.ThemeIcon("check", new vscode.ThemeColor("charts.green"));
        break;
      // Needs attention
      case "escalated":
        this.iconPath = new vscode.ThemeIcon("megaphone", new vscode.ThemeColor("charts.orange"));
        break;
      case "failed":
      case "review_rejected":
        this.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
        break;
      case "cancelled":
        this.iconPath = new vscode.ThemeIcon("circle-slash", new vscode.ThemeColor("disabledForeground"));
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
    const isBlocked = (issue.blockedByCount ?? 0) > 0;
    const label = `${issue.key}: ${issue.summary}`;
    const truncated = label.length > 55 ? label.substring(0, 55) + "..." : label;
    super(truncated, vscode.TreeItemCollapsibleState.Collapsed);

    this.id = `issue-${issue.key}`;

    // Show blocked status and dependency info in description
    if (isBlocked) {
      this.description = `$(lock) Blocked (${issue.blockedByCount}/${issue.dependencyCount} deps)`;
    } else if (issue.dependencyCount && issue.dependencyCount > 0) {
      this.description = `$(unlock) ${issue.status || ""}`;
    } else {
      this.description = issue.status || "";
    }

    const blockedLine = isBlocked
      ? `\nBlocked: ${issue.blockedByCount} of ${issue.dependencyCount} dependencies unmet`
      : issue.dependencyCount
        ? `\nDependencies: all ${issue.dependencyCount} met`
        : "";
    this.tooltip = `${issue.key}: ${issue.summary}\nStatus: ${issue.status || "Unknown"}\nType: ${issue.issueType || "Unknown"}\nPriority: ${issue.priority || "None"}\nAssignee: ${issue.assignee?.displayName || "Unassigned"}${blockedLine}`;

    if (isBlocked) {
      this.iconPath = new vscode.ThemeIcon("lock", new vscode.ThemeColor("charts.orange"));
      this.contextValue = "issue-blocked";
    } else {
      this.iconPath = new vscode.ThemeIcon("circle-outline", statusColor(issue.status));
      this.contextValue = "issue";
    }

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
    tech_writer: "$(book)",
    project_manager: "$(checklist)",
    architect: "$(symbol-structure)",
    data_ml_engineer: "$(graph)",
    mobile_developer: "$(device-mobile)",
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
