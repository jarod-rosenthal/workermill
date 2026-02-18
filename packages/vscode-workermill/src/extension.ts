/**
 * WorkerMill VS Code Extension
 *
 * Layout:
 * - Left sidebar: Team tree (task list) + Activity feed (expert collaboration)
 * - Bottom terminal: Live task logs as pseudoterminal tabs
 * - Editor area: untouched — just your code
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { AgentClient, type TaskInfo, type IssueInfo } from "./agent-client";
import { TeamTreeProvider } from "./team-tree";
import { FeedViewProvider } from "./feed-view";
import { StatusBar } from "./status-bar";
import { NotificationManager } from "./notifications";
import { LogTerminalManager } from "./log-terminal";
import { LiveDiffPanel } from "./live-diff-panel";
import {
  isAgentInstalled,
  installAgent,
  startAgentProcess,
} from "./agent-installer";

let client: AgentClient;
let statusBar: StatusBar;
let notifications: NotificationManager;
let logManager: LogTerminalManager;
let feedView: FeedViewProvider;

// Track which task the feed is currently showing
let currentFeedTaskId: string | null = null;
let currentFeedTaskStatus: string | null = null;

export function activate(context: vscode.ExtensionContext): void {
  client = new AgentClient();

  // Sidebar: Team tree view
  const treeProvider = new TeamTreeProvider(client);
  const treeView = vscode.window.createTreeView("workermill.teamPanel", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Sidebar: Activity feed (WebviewView below the tree)
  feedView = new FeedViewProvider(client);
  const feedViewDisposable = vscode.window.registerWebviewViewProvider(
    FeedViewProvider.viewType,
    feedView,
    { webviewOptions: { retainContextWhenHidden: true } },
  );

  // Status bar
  statusBar = new StatusBar(client);

  // Notifications
  notifications = new NotificationManager(client);

  // Terminal log manager
  logManager = new LogTerminalManager(client);

  // ── Task lifecycle auto-sync ──

  // Auto-switch feed to new task when it starts (only if feed is idle or showing finished task)
  client.on(
    "task:started",
    (info: { id: string; summary: string; persona?: string; model?: string; repo?: string }) => {
      if (
        !currentFeedTaskId ||
        currentFeedTaskStatus === "completed" ||
        currentFeedTaskStatus === "failed"
      ) {
        const taskInfo: TaskInfo = {
          ...info,
          status: "running",
          startedAt: new Date().toISOString(),
        };
        feedView.showTask(taskInfo);
        currentFeedTaskId = info.id;
        currentFeedTaskStatus = "running";
      }
      // Auto-open log terminal for new task
      logManager.openLogs(info.id, info.summary);
    },
  );

  // Stop feed polling when task completes
  client.on("task:completed", (info: { id: string }) => {
    if (currentFeedTaskId === info.id) {
      currentFeedTaskStatus = "completed";
      feedView.onTaskFinished(info.id, "completed");
    }
    logManager.onTaskFinished(info.id, "completed");
  });

  client.on("task:failed", (info: { id: string }) => {
    if (currentFeedTaskId === info.id) {
      currentFeedTaskStatus = "failed";
      feedView.onTaskFinished(info.id, "failed");
    }
    logManager.onTaskFinished(info.id, "failed");
  });

  // Reconcile state when agent sends updated task list (e.g., after cleanup)
  client.on("snapshot", (tasks: TaskInfo[]) => {
    logManager.reconcile(tasks);
    // If the task we're watching was removed from the agent, reset tracking
    if (currentFeedTaskId) {
      const stillExists = tasks.some((t) => t.id === currentFeedTaskId);
      if (!stillExists) {
        currentFeedTaskId = null;
        currentFeedTaskStatus = null;
      }
    }
  });

  // Register commands
  context.subscriptions.push(
    treeView,
    feedViewDisposable,

    vscode.commands.registerCommand("workermill.refreshTasks", () => {
      treeProvider.refresh();
    }),

    // Click task in tree → show feed + open terminal
    vscode.commands.registerCommand(
      "workermill.selectTask",
      (task: TaskInfo) => {
        feedView.showTask(task);
        currentFeedTaskId = task.id;
        currentFeedTaskStatus = task.status;
        logManager.openLogs(task.id, task.summary);
      },
    ),

    // Click issue in tree → show details in feed panel
    vscode.commands.registerCommand(
      "workermill.selectIssue",
      (issue: IssueInfo) => {
        feedView.showIssue(issue);
      },
    ),

    vscode.commands.registerCommand("workermill.showTeamPanel", () => {
      vscode.commands.executeCommand("workermill.teamPanel.focus");
    }),

    // Run a Jira issue from the tree view (inline play button)
    vscode.commands.registerCommand(
      "workermill.runIssue",
      async (issueItem?: { issue?: { key: string; summary: string } }) => {
        if (!client.isConnected()) {
          vscode.window.showErrorMessage(
            "WorkerMill agent is not running. Start with: workermill-agent start",
          );
          return;
        }

        const issueKey = issueItem?.issue?.key;
        if (!issueKey) return;

        const confirm = await vscode.window.showInformationMessage(
          `Run "${issueKey}: ${issueItem?.issue?.summary}" with WorkerMill?`,
          "Run",
          "Cancel",
        );
        if (confirm !== "Run") return;

        try {
          await client.runIssue(issueKey);
          vscode.window.showInformationMessage(`WorkerMill: ${issueKey} submitted`);
          treeProvider.refresh();
        } catch (err) {
          vscode.window.showErrorMessage(
            `Failed to run issue: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    ),

    // Search and run via quick pick (command palette)
    vscode.commands.registerCommand("workermill.runTask", async () => {
      if (!client.isConnected()) {
        vscode.window.showErrorMessage(
          "WorkerMill agent is not running. Start with: workermill-agent start",
        );
        return;
      }

      const input = await vscode.window.showInputBox({
        prompt: "Enter a ticket key (e.g., OCS-142)",
        placeHolder: "OCS-142",
      });

      if (!input) return;

      try {
        const issueKey = input.trim().toUpperCase();
        if (/^[A-Z]+-\d+$/.test(issueKey)) {
          await client.runIssue(issueKey);
          vscode.window.showInformationMessage(`WorkerMill: ${issueKey} submitted`);
          treeProvider.refresh();
        } else {
          vscode.window.showWarningMessage("Please enter a valid ticket key (e.g., OCS-142)");
        }
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to create task: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    // Search Jira issues and run from QuickPick
    vscode.commands.registerCommand("workermill.searchIssues", async () => {
      if (!client.isConnected()) {
        vscode.window.showErrorMessage("WorkerMill agent is not running.");
        return;
      }

      // Step 1: Get search text
      const query = await vscode.window.showInputBox({
        prompt: "Search issues in your issue tracker",
        placeHolder: "e.g. dark mode, authentication, OCS-142...",
      });
      if (query === undefined) return; // cancelled

      // Step 2: Search
      const results = await treeProvider.searchIssues(query || undefined);
      if (results.length === 0) {
        vscode.window.showInformationMessage(
          query ? `No issues found for "${query}".` : "No issues found.",
        );
        return;
      }

      // Step 3: Show results in QuickPick
      const items = results.map((i) => ({
        label: `${i.key}: ${i.summary}`,
        description: i.status || "",
        detail: [i.issueType, i.priority, i.assignee?.displayName].filter(Boolean).join(" | "),
        issue: i,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `${results.length} issues found — select to run`,
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!selected) return;

      const confirm = await vscode.window.showInformationMessage(
        `Run "${selected.issue.key}: ${selected.issue.summary}" with WorkerMill?`,
        "Run",
        "Cancel",
      );
      if (confirm !== "Run") return;

      try {
        await client.runIssue(selected.issue.key);
        vscode.window.showInformationMessage(`WorkerMill: ${selected.issue.key} submitted`);
        treeProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand("workermill.talkToWorker", async () => {
      if (!client.isConnected()) {
        vscode.window.showErrorMessage("WorkerMill agent is not running.");
        return;
      }

      try {
        const tasks = await client.getTasks();
        const activeTasks = tasks.filter((t) => t.status === "running");

        if (activeTasks.length === 0) {
          vscode.window.showInformationMessage("No active tasks to talk to.");
          return;
        }

        const selected =
          activeTasks.length === 1
            ? activeTasks[0]
            : await vscode.window
                .showQuickPick(
                  activeTasks.map((t) => ({
                    label: t.summary,
                    description: t.persona || "",
                    detail: t.id,
                    task: t,
                  })),
                  { placeHolder: "Select a task to message" },
                )
                .then((item) =>
                  item
                    ? (item as unknown as { task: (typeof activeTasks)[0] }).task
                    : undefined,
                );

        if (!selected) return;

        const message = await vscode.window.showInputBox({
          prompt: `Message to ${selected.persona || "worker"} on "${selected.summary}"`,
          placeHolder: "Type your message...",
        });

        if (!message) return;

        await client.talkToWorker(selected.id, message);
        vscode.window.showInformationMessage("Message sent to worker.");
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand("workermill.showTaskLogs", async () => {
      if (!client.isConnected()) {
        vscode.window.showErrorMessage("WorkerMill agent is not running.");
        return;
      }

      try {
        const tasks = await client.getTasks();
        const activeTasks = tasks.filter(
          (t) => t.status === "running" || t.status === "planning",
        );

        if (activeTasks.length === 0) {
          vscode.window.showInformationMessage("No active tasks.");
          return;
        }

        const selected =
          activeTasks.length === 1
            ? activeTasks[0]
            : await vscode.window
                .showQuickPick(
                  activeTasks.map((t) => ({
                    label: t.summary,
                    description: t.status,
                    detail: t.id,
                    task: t,
                  })),
                  { placeHolder: "Select a task to view logs" },
                )
                .then((item) =>
                  item
                    ? (item as unknown as { task: (typeof activeTasks)[0] }).task
                    : undefined,
                );

        if (!selected) return;

        logManager.openLogs(selected.id, selected.summary);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand("workermill.approvePlan", async () => {
      if (!client.isConnected()) {
        vscode.window.showErrorMessage("WorkerMill agent is not running.");
        return;
      }

      try {
        const tasks = await client.getTasks();
        const planningTasks = tasks.filter((t) => t.status === "planning");

        if (planningTasks.length === 0) {
          vscode.window.showInformationMessage("No plans awaiting approval.");
          return;
        }

        for (const task of planningTasks) {
          const action = await vscode.window.showInformationMessage(
            `Approve plan for "${task.summary}"?`,
            "Approve",
            "Reject",
          );

          if (action === "Approve") {
            await client.approvePlan(task.id);
            vscode.window.showInformationMessage("Plan approved.");
          } else if (action === "Reject") {
            const feedback = await vscode.window.showInputBox({
              prompt: "Feedback for the planner",
              placeHolder: "What should be changed?",
            });
            if (feedback) {
              await client.rejectPlan(task.id, feedback);
              vscode.window.showInformationMessage("Plan rejected with feedback.");
            }
          }
        }
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    // Open live code changes panel for a running task (eye icon in tree)
    vscode.commands.registerCommand(
      "workermill.openLiveDiff",
      (treeItem?: { task?: { id: string; summary: string; status: string } }) => {
        const task = treeItem?.task;
        if (!task?.id || !client.isConnected()) return;
        LiveDiffPanel.createOrShow(client, task as any);
      },
    ),

    // Cancel a running/planning task (stop button in tree)
    vscode.commands.registerCommand(
      "workermill.cancelTask",
      async (treeItem?: { task?: TaskInfo }) => {
        if (!client.isConnected()) {
          vscode.window.showErrorMessage("WorkerMill agent is not running.");
          return;
        }

        const task = treeItem?.task;
        if (!task?.id) {
          // Fallback: pick from active tasks
          try {
            const tasks = await client.getTasks();
            const active = tasks.filter((t) => t.status === "running" || t.status === "planning");
            if (active.length === 0) {
              vscode.window.showInformationMessage("No active tasks to cancel.");
              return;
            }
            const picked =
              active.length === 1
                ? active[0]
                : await vscode.window
                    .showQuickPick(
                      active.map((t) => ({
                        label: t.summary,
                        description: t.status,
                        task: t,
                      })),
                      { placeHolder: "Select a task to cancel" },
                    )
                    .then((item) =>
                      item ? (item as unknown as { task: TaskInfo }).task : undefined,
                    );
            if (!picked) return;
            return cancelWithConfirm(picked);
          } catch (err) {
            vscode.window.showErrorMessage(
              `Failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            return;
          }
        }

        return cancelWithConfirm(task);

        async function cancelWithConfirm(t: TaskInfo): Promise<void> {
          const confirm = await vscode.window.showWarningMessage(
            `Cancel "${t.summary}"?`,
            { modal: true },
            "Cancel Task",
          );
          if (confirm !== "Cancel Task") return;
          try {
            await client.cancelTask(t.id);
            vscode.window.showInformationMessage(`Task cancelled.`);
          } catch (err) {
            vscode.window.showErrorMessage(
              `Failed to cancel: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      },
    ),

    // Install/update agent binary from GitHub Releases
    vscode.commands.registerCommand("workermill.installAgent", async () => {
      const success = await installAgent();
      if (success && !client.isConnected()) {
        const configPath = path.join(os.homedir(), ".workermill", "config.json");
        if (fs.existsSync(configPath)) {
          startAgentProcess();
          vscode.window.showInformationMessage("Agent starting...");
        } else {
          const terminal = vscode.window.createTerminal("WorkerMill Setup");
          terminal.show();
          terminal.sendText("workermill-agent setup");
          vscode.window.showInformationMessage(
            "Agent installed! Complete setup in the terminal, then run 'workermill-agent start'.",
          );
        }
      }
    }),
  );

  // Check if agent binary is installed, prompt to install if missing
  if (!isAgentInstalled()) {
    vscode.window
      .showInformationMessage(
        "WorkerMill agent is not installed. Install it now to enable AI worker management.",
        "Install",
        "Later",
      )
      .then(async (choice) => {
        if (choice !== "Install") return;
        const success = await installAgent();
        if (!success) return;
        const configPath = path.join(os.homedir(), ".workermill", "config.json");
        if (fs.existsSync(configPath)) {
          startAgentProcess();
        } else {
          const terminal = vscode.window.createTerminal("WorkerMill Setup");
          terminal.show();
          terminal.sendText("workermill-agent setup");
          vscode.window.showInformationMessage(
            "Agent installed! Complete setup in the terminal, then run 'workermill-agent start'.",
          );
        }
      });
  }

  // Connect to agent (reconnect loop handles timing if agent isn't ready yet)
  client.connect();

  // Log activation
  const outputChannel = vscode.window.createOutputChannel("WorkerMill");
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine("WorkerMill extension activated");

  client.on("connected", (status) => {
    outputChannel.appendLine(`Connected to agent ${status.agentId} (v${status.version})`);
  });

  client.on("disconnected", () => {
    outputChannel.appendLine("Agent disconnected — will retry in 5s");
  });
}

export function deactivate(): void {
  LiveDiffPanel.disposeAll();
  if (logManager) logManager.dispose();
  if (statusBar) statusBar.dispose();
  if (notifications) notifications.dispose();
  if (client) client.dispose();
}
