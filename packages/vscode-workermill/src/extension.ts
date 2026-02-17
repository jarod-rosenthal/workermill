/**
 * WorkerMill VS Code Extension
 *
 * Connects to the local WorkerMill agent and provides:
 * - Sidebar Team Panel (tree view of tasks and experts)
 * - Status bar item with task count
 * - Native notifications for blockers, completions, failures
 * - Command palette commands for task management
 * - Live log streaming in output channels
 */

import * as vscode from "vscode";
import { AgentClient } from "./agent-client";
import { TeamTreeProvider } from "./team-tree";
import { StatusBar } from "./status-bar";
import { NotificationManager } from "./notifications";
import { LogTerminalManager } from "./log-terminal";

let client: AgentClient;
let statusBar: StatusBar;
let notifications: NotificationManager;
let logManager: LogTerminalManager;

export function activate(context: vscode.ExtensionContext): void {
  // Initialize agent client
  client = new AgentClient();

  // Set up tree view
  const treeProvider = new TeamTreeProvider(client);
  const treeView = vscode.window.createTreeView("workermill.teamPanel", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Set up status bar
  statusBar = new StatusBar(client);

  // Set up notifications
  notifications = new NotificationManager(client);

  // Set up log terminal manager
  logManager = new LogTerminalManager(client);

  // Register commands
  context.subscriptions.push(
    treeView,

    vscode.commands.registerCommand("workermill.refreshTasks", () => {
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand("workermill.showTeamPanel", () => {
      vscode.commands.executeCommand("workermill.teamPanel.focus");
    }),

    vscode.commands.registerCommand("workermill.runTask", async () => {
      if (!client.isConnected()) {
        vscode.window.showErrorMessage("WorkerMill agent is not running. Start with: workermill-agent start");
        return;
      }

      const input = await vscode.window.showInputBox({
        prompt: "Enter a ticket key (e.g., OCS-142) or task description",
        placeHolder: "OCS-142 or 'Add dark mode toggle to settings page'",
      });

      if (!input) return;

      try {
        // Determine if it's a ticket key or free-text description
        const isTicketKey = /^[A-Z]+-\d+$/.test(input.trim());
        if (isTicketKey) {
          await client.talkToWorker("run", input.trim()); // TODO: use proper run endpoint
        }
        vscode.window.showInformationMessage(`WorkerMill: Task "${input}" submitted`);
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

        // Pick a task
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
  if (logManager) logManager.dispose();
  if (statusBar) statusBar.dispose();
  if (notifications) notifications.dispose();
  if (client) client.dispose();
}
