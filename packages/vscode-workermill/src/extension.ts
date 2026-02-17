/**
 * WorkerMill VS Code Extension
 *
 * Layout:
 * - Left sidebar: Team tree (task list) + Activity feed (expert collaboration)
 * - Bottom terminal: Live task logs as pseudoterminal tabs
 * - Editor area: untouched — just your code
 */

import * as vscode from "vscode";
import { AgentClient } from "./agent-client";
import { TeamTreeProvider } from "./team-tree";
import { FeedViewProvider } from "./feed-view";
import { StatusBar } from "./status-bar";
import { NotificationManager } from "./notifications";
import { LogTerminalManager } from "./log-terminal";
import { LiveDiffPanel } from "./live-diff-panel";

let client: AgentClient;
let statusBar: StatusBar;
let notifications: NotificationManager;
let logManager: LogTerminalManager;
let feedView: FeedViewProvider;

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

  // Register commands
  context.subscriptions.push(
    treeView,
    feedViewDisposable,

    vscode.commands.registerCommand("workermill.refreshTasks", () => {
      treeProvider.refresh();
    }),

    // Click task in tree → show feed + open terminal
    vscode.commands.registerCommand("workermill.selectTask", (task: { id: string; summary: string; status: string; persona?: string; model?: string; repo?: string; startedAt: string }) => {
      // Load coordination feed in the sidebar
      feedView.showTask(task);
      // Open log terminal for this task
      logManager.openLogs(task.id, task.summary);
    }),

    vscode.commands.registerCommand("workermill.showTeamPanel", () => {
      vscode.commands.executeCommand("workermill.teamPanel.focus");
    }),

    // Run a Jira issue from the tree view (inline play button)
    vscode.commands.registerCommand("workermill.runIssue", async (issueItem?: { issue?: { key: string; summary: string } }) => {
      if (!client.isConnected()) {
        vscode.window.showErrorMessage("WorkerMill agent is not running. Start with: workermill-agent start");
        return;
      }

      const issueKey = issueItem?.issue?.key;
      if (!issueKey) return;

      const confirm = await vscode.window.showInformationMessage(
        `Run "${issueKey}: ${issueItem.issue.summary}" with WorkerMill?`,
        "Run",
        "Cancel",
      );
      if (confirm !== "Run") return;

      try {
        await client.runIssue(issueKey);
        vscode.window.showInformationMessage(`WorkerMill: ${issueKey} submitted`);
        treeProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to run issue: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    // Search and run via quick pick (command palette)
    vscode.commands.registerCommand("workermill.runTask", async () => {
      if (!client.isConnected()) {
        vscode.window.showErrorMessage("WorkerMill agent is not running. Start with: workermill-agent start");
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
        vscode.window.showErrorMessage(`Failed to create task: ${err instanceof Error ? err.message : String(err)}`);
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

        const selected = activeTasks.length === 1
          ? activeTasks[0]
          : await vscode.window.showQuickPick(
              activeTasks.map((t) => ({ label: t.summary, description: t.persona || "", detail: t.id, task: t })),
              { placeHolder: "Select a task to message" },
            ).then((item) => item ? (item as unknown as { task: typeof activeTasks[0] }).task : undefined);

        if (!selected) return;

        const message = await vscode.window.showInputBox({
          prompt: `Message to ${selected.persona || "worker"} on "${selected.summary}"`,
          placeHolder: "Type your message...",
        });

        if (!message) return;

        await client.talkToWorker(selected.id, message);
        vscode.window.showInformationMessage("Message sent to worker.");
      } catch (err) {
        vscode.window.showErrorMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("workermill.showTaskLogs", async () => {
      if (!client.isConnected()) {
        vscode.window.showErrorMessage("WorkerMill agent is not running.");
        return;
      }

      try {
        const tasks = await client.getTasks();
        const activeTasks = tasks.filter((t) => t.status === "running" || t.status === "planning");

        if (activeTasks.length === 0) {
          vscode.window.showInformationMessage("No active tasks.");
          return;
        }

        const selected = activeTasks.length === 1
          ? activeTasks[0]
          : await vscode.window.showQuickPick(
              activeTasks.map((t) => ({ label: t.summary, description: t.status, detail: t.id, task: t })),
              { placeHolder: "Select a task to view logs" },
            ).then((item) => item ? (item as unknown as { task: typeof activeTasks[0] }).task : undefined);

        if (!selected) return;

        logManager.openLogs(selected.id, selected.summary);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
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
        vscode.window.showErrorMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    // Open live code changes panel for a running task (eye icon in tree)
    vscode.commands.registerCommand("workermill.openLiveDiff", (treeItem?: { task?: { id: string; summary: string; status: string } }) => {
      const task = treeItem?.task;
      if (!task?.id || !client.isConnected()) return;
      LiveDiffPanel.createOrShow(client, task as any);
    }),
  );

  // Connect to agent
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
