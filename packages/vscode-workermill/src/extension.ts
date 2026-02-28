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
import { LiveDiffManager } from "./live-diff-manager";
import { TaskDetailPanel } from "./task-detail-panel";
import { SettingsPanel } from "./settings-panel";
import {
  isAgentInstalled,
  isAgentConfigured,
  getAgentBinaryPath,
  installAgent,
  startAgentProcess,
  stopAgentProcess,
  waitForAgentReady,
  promptInstallGit,
  readAgentStartupError,
  writeApiKeyToKeychain,
  stripApiKeyFromConfig,
  deleteApiKeyFromKeychain,
} from "./agent-installer";
import {
  signUpWithGitHub,
  signInWithGitHub,
  signInWithEmail,
  signInWithGoogle,
  handleAuthCallback,
  enterApiKey,
  promptScmSetup,
} from "./github-onboard";
import { initSecretStorage, getApiKey, storeApiKey, deleteApiKey } from "./secret-storage";

/**
 * Show a QuickPick for repository selection if multiple repos are configured.
 * Returns the selected repo, or undefined if the user cancelled.
 */
async function pickRepo(agentClient: AgentClient): Promise<string | undefined> {
  try {
    const { repos, defaultRepo } = await agentClient.getRepos();

    // No repos configured — use default if available
    if (repos.length === 0 && defaultRepo) return defaultRepo;
    if (repos.length === 0) {
      vscode.window.showWarningMessage(
        "No repositories configured. Add one in WorkerMill Settings > Integrations.",
      );
      return undefined;
    }

    // Single repo — auto-select
    if (repos.length === 1) return repos[0];

    // Multiple repos — show QuickPick
    const items = repos.map((r) => ({
      label: r,
      description: r === defaultRepo ? "(default)" : "",
    }));

    // Put default repo first
    if (defaultRepo) {
      const idx = items.findIndex((i) => i.label === defaultRepo);
      if (idx > 0) {
        const [item] = items.splice(idx, 1);
        items.unshift(item);
      }
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select target repository",
    });

    return selected?.label;
  } catch (err) {
    // If repos endpoint fails (e.g., older agent), fall back to no repo selection
    vscode.window.showWarningMessage(
      `Could not fetch repositories: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

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

  // Live diff: register virtual document content providers
  LiveDiffManager.register(context);

  // ── Task lifecycle auto-sync ──

  // Show feed and terminal as soon as planning begins (immediate feedback)
  client.on(
    "task:planning",
    (info: { id: string; summary: string; description?: string }) => {
      if (
        !currentFeedTaskId ||
        currentFeedTaskStatus === "completed" ||
        currentFeedTaskStatus === "pr_approved" ||
        currentFeedTaskStatus === "failed" ||
        currentFeedTaskStatus === "escalated"
      ) {
        const taskInfo: TaskInfo = {
          ...info,
          status: "planning",
          startedAt: new Date().toISOString(),
        };
        feedView.showTask(taskInfo);
        currentFeedTaskId = info.id;
        currentFeedTaskStatus = "planning";
      }
      // Focus feed first, then open terminal last so terminal gets final focus
      vscode.commands.executeCommand("workermill.feedPanel.focus");
      logManager.openLogs(info.id, info.summary);
    },
  );

  // Auto-switch feed to new task when it starts (only if feed is idle or showing finished task)
  client.on(
    "task:started",
    (info: { id: string; summary: string; description?: string; persona?: string; model?: string; repo?: string }) => {
      // Always switch to the new task — the previous one is done or this is more important
      const taskInfo: TaskInfo = {
        ...info,
        status: "running",
        startedAt: new Date().toISOString(),
      };
      feedView.showTask(taskInfo);
      currentFeedTaskId = info.id;
      currentFeedTaskStatus = "running";

      // Focus feed first, then open terminal last so terminal gets final focus
      vscode.commands.executeCommand("workermill.feedPanel.focus");
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

  // Output channel for diagnostics (Output > WorkerMill)
  const outputChannel = vscode.window.createOutputChannel("WorkerMill");
  context.subscriptions.push(outputChannel);
  const log = (msg: string) => outputChannel.appendLine(msg);
  log("WorkerMill extension activated");

  // Initialize secure secret storage (OS keychain via VS Code SecretStorage API)
  initSecretStorage(context.secrets);

  // Migrate existing plaintext API key from config.json → keychain + SecretStorage
  (async () => {
    try {
      const existing = await getApiKey();
      if (!existing) {
        const configPath = path.join(os.homedir(), ".workermill", "config.json");
        try {
          const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          if (raw.apiKey) {
            log("Migrating API key from config.json to secure storage...");
            await storeApiKey(raw.apiKey);
            writeApiKeyToKeychain(raw.apiKey);
            stripApiKeyFromConfig();
            log("API key migrated successfully");
          }
        } catch {
          /* no config or parse error */
        }
      }
    } catch (err) {
      log(`Secret storage migration error: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();

  // Register URI handler for SSO callbacks (vscode://workermill.workermill/auth-callback)
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: async (uri: vscode.Uri) => {
        if (uri.path === "/auth-callback") {
          log(`URI callback received: ${uri.path}`);

          // Check if this is a SCM configuration callback (from GitHub App install)
          const params = new URLSearchParams(uri.query);
          if (params.get("scmConfigured") === "true") {
            const method = params.get("method") || "unknown";
            log(`SCM configured via ${method}`);
            vscode.window.showInformationMessage(
              `Repository access configured via ${method === "github-app" ? "GitHub App" : method}. You're all set!`,
            );
            return;
          }

          const success = await handleAuthCallback(uri, log);
          if (success) {
            treeProvider.agentConfigured = true;
            vscode.commands.executeCommand("setContext", "workermill.agentConfigured", true);
            client.connect();
          }
        }
      },
    }),
  );

  // Register commands
  context.subscriptions.push(
    treeView,
    feedViewDisposable,

    vscode.commands.registerCommand("workermill.refreshTasks", () => {
      treeProvider.refresh();
    }),

    // Click task in tree → show detail panel + feed + open terminal
    vscode.commands.registerCommand(
      "workermill.selectTask",
      (task: TaskInfo) => {
        feedView.showTask(task);
        currentFeedTaskId = task.id;
        currentFeedTaskStatus = task.status;
        logManager.openLogs(task.id, task.summary);
        TaskDetailPanel.createOrShow(client, task);
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
      async (issueItem?: { issue?: { key: string; summary: string; blockedByCount?: number; _cardId?: string; _boardId?: string } }) => {
        if (!client.isConnected()) {
          vscode.window.showErrorMessage(
            "WorkerMill agent is not running. Start with: workermill-agent start",
          );
          return;
        }

        const issueKey = issueItem?.issue?.key;
        if (!issueKey) return;

        if ((issueItem?.issue?.blockedByCount ?? 0) > 0) {
          vscode.window.showWarningMessage(
            `Cannot run "${issueKey}" — blocked by ${issueItem!.issue!.blockedByCount} unmet dependencies`,
          );
          return;
        }

        const confirm = await vscode.window.showInformationMessage(
          `Run "${issueKey}: ${issueItem?.issue?.summary}" with WorkerMill?`,
          "Run",
          "Cancel",
        );
        if (confirm !== "Run") return;

        try {
          await client.runIssue(issueKey, issueItem?.issue?._cardId, issueItem?.issue?._boardId);
          vscode.window.showInformationMessage(`WorkerMill: ${issueKey} submitted`);
          treeProvider.refresh();
          // Reveal sidebar so user sees the task appear
          vscode.commands.executeCommand("workermill.teamPanel.focus");
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
          // Reveal sidebar so user sees the task appear
          vscode.commands.executeCommand("workermill.teamPanel.focus");
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
        // Reveal sidebar so user sees the task appear
        vscode.commands.executeCommand("workermill.teamPanel.focus");
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    // Filter backlog by status — quick pick with current statuses
    vscode.commands.registerCommand("workermill.filterBacklog", async () => {
      if (!client.isConnected()) {
        vscode.window.showErrorMessage("WorkerMill agent is not running.");
        return;
      }

      const current = vscode.workspace.getConfiguration("workermill").get<string>("issueStatusFilter") || "";

      // Fetch all issues (unfiltered) to discover available statuses
      let statuses: string[] = [];
      try {
        const result = await client.searchIssues();
        const statusSet = new Set<string>();
        for (const issue of result.issues || []) {
          if (issue.status) statusSet.add(issue.status);
        }
        statuses = Array.from(statusSet).sort();
      } catch {
        // If fetch fails, still show the basic options
      }

      const items: vscode.QuickPickItem[] = [
        { label: "Show All", description: current === "" ? "(current)" : "", detail: "Show all open issues" },
        ...statuses.map((s) => ({
          label: s,
          description: s.toLowerCase() === current.toLowerCase() ? "(current)" : "",
        })),
      ];

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: current ? `Filtered by: ${current}` : "Showing all issues",
        title: "Filter Backlog by Status",
      });

      if (!selected) return;

      const newFilter = selected.label === "Show All" ? "" : selected.label;
      await vscode.workspace.getConfiguration("workermill").update("issueStatusFilter", newFilter, vscode.ConfigurationTarget.Global);
      treeProvider.refresh();
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
        LiveDiffManager.createOrShow(client, task);
      },
    ),

    vscode.commands.registerCommand("workermill.liveDiffPicker", () => {
      LiveDiffManager.showActiveFilePicker();
    }),

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

    // Build a board from a spec (.md file) — context menu + editor title button
    vscode.commands.registerCommand(
      "workermill.buildFromPrd",
      async (uri?: vscode.Uri) => {
        if (!client.isConnected()) {
          vscode.window.showErrorMessage(
            "WorkerMill agent is not running. Start with: workermill-agent start",
          );
          return;
        }

        // Get file content — from context menu URI or active editor
        let fileContent: string;
        let fileUri: vscode.Uri | undefined;

        if (uri) {
          fileUri = uri;
          const bytes = await vscode.workspace.fs.readFile(uri);
          fileContent = Buffer.from(bytes).toString("utf-8");
        } else {
          const editor = vscode.window.activeTextEditor;
          if (!editor || editor.document.languageId !== "markdown") {
            vscode.window.showWarningMessage(
              "Open a .md file or right-click one in the explorer.",
            );
            return;
          }
          fileUri = editor.document.uri;
          fileContent = editor.document.getText();
        }

        if (!fileContent.trim()) {
          vscode.window.showWarningMessage("The selected file is empty.");
          return;
        }

        // Pick target repo via QuickPick (falls back to git remote detection)
        let githubRepo: string | undefined;
        const pickedRepo = await pickRepo(client);
        if (pickedRepo === undefined) return; // cancelled
        githubRepo = pickedRepo;

        // Infer board name from first ***REMOVED*** heading
        const headingMatch = fileContent.match(/^***REMOVED***\s+(.+)$/m);
        const inferredName = headingMatch ? headingMatch[1].trim() : undefined;

        // Ask for board name
        const boardName = await vscode.window.showInputBox({
          prompt: "Board name for this product build",
          value: inferredName || "",
          placeHolder: "e.g. User Authentication Redesign",
        });

        if (boardName === undefined) return; // cancelled

        // Open a terminal to show real-time progress
        const writeEmitter = new vscode.EventEmitter<string>();
        const closeEmitter = new vscode.EventEmitter<void>();
        const pty: vscode.Pseudoterminal = {
          onDidWrite: writeEmitter.event,
          onDidClose: closeEmitter.event,
          open: () => {
            writeEmitter.fire(
              "\x1b[1m\x1b[94mWorkerMill Product Build\x1b[0m\r\n",
            );
            writeEmitter.fire(
              "\x1b[2mBuilding product...\x1b[0m\r\n\r\n",
            );
          },
          close: () => {},
        };
        const terminal = vscode.window.createTerminal({
          name: "WM: Product Build",
          pty,
          iconPath: new vscode.ThemeIcon("rocket"),
        });
        terminal.show();

        try {
          const result = await client.buildFromPrdStreaming(
            {
              source: "text",
              content: fileContent,
              githubRepo,
              boardName: boardName || undefined,
            },
            (message) => {
              writeEmitter.fire(`\x1b[96m>\x1b[0m ${message}\r\n`);
            },
          );

          writeEmitter.fire("\r\n");
          writeEmitter.fire(
            `\x1b[1m\x1b[92m✓ Created board "${result.boardName}" with ${result.cardCount} cards\x1b[0m\r\n`,
          );

          // Refresh sidebar so new board cards appear in Backlog
          treeProvider.refresh();

          const action = await vscode.window.showInformationMessage(
            `WorkerMill: Created board "${result.boardName}" with ${result.cardCount} cards`,
            "Open in Dashboard",
          );

          if (action === "Open in Dashboard") {
            vscode.env.openExternal(
              vscode.Uri.parse(
                `https://workermill.com/boards/${result.boardId}`,
              ),
            );
          }
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : String(err);
          writeEmitter.fire(`\r\n\x1b[1m\x1b[91m✗ ${msg}\x1b[0m\r\n`);
          vscode.window.showErrorMessage(
            `Product Build failed: ${msg}`,
          );
        }
      },
    ),

    // Run a .md file as a single worker task — context menu + editor title
    vscode.commands.registerCommand(
      "workermill.runFileAsTask",
      async (uri?: vscode.Uri) => {
        if (!client.isConnected()) {
          vscode.window.showErrorMessage(
            "WorkerMill agent is not running. Start with: workermill-agent start",
          );
          return;
        }

        // Get file content — from context menu URI or active editor
        let fileContent: string;
        let fileName: string;

        if (uri) {
          const bytes = await vscode.workspace.fs.readFile(uri);
          fileContent = Buffer.from(bytes).toString("utf-8");
          fileName = path.basename(uri.fsPath, ".md");
        } else {
          const editor = vscode.window.activeTextEditor;
          if (!editor || editor.document.languageId !== "markdown") {
            vscode.window.showWarningMessage(
              "Open a .md file or right-click one in the explorer.",
            );
            return;
          }
          fileContent = editor.document.getText();
          fileName = path.basename(editor.document.fileName, ".md");
        }

        if (!fileContent.trim()) {
          vscode.window.showWarningMessage("The selected file is empty.");
          return;
        }

        // Extract first heading as summary, fallback to filename
        const headingMatch = fileContent.match(/^***REMOVED***\s+(.+)$/m);
        const summary = headingMatch ? headingMatch[1].trim() : fileName;

        // Pick target repo
        const selectedRepo = await pickRepo(client);
        if (selectedRepo === undefined) return; // cancelled

        // Confirm
        const confirm = await vscode.window.showInformationMessage(
          `Run "${summary}" as a task against ${selectedRepo}?`,
          "Run",
          "Cancel",
        );
        if (confirm !== "Run") return;

        try {
          await client.runFileAsTask(summary, fileContent, selectedRepo);
          vscode.window.showInformationMessage(
            `WorkerMill: "${summary}" submitted as task`,
          );
          treeProvider.refresh();
          vscode.commands.executeCommand("workermill.teamPanel.focus");
        } catch (err) {
          vscode.window.showErrorMessage(
            `Failed to run as task: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    ),

    // Install/update agent binary from CDN
    vscode.commands.registerCommand("workermill.installAgent", async () => {
      const success = await installAgent();
      if (success && !client.isConnected()) {
        const configPath = path.join(os.homedir(), ".workermill", "config.json");
        if (fs.existsSync(configPath)) {
          startAgentProcess();
          client.connect();
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

    // Start agent
    vscode.commands.registerCommand("workermill.startAgent", async () => {
      if (!isAgentInstalled()) {
        const choice = await vscode.window.showInformationMessage(
          "WorkerMill agent is not installed.",
          "Install",
        );
        if (choice === "Install") {
          vscode.commands.executeCommand("workermill.installAgent");
        }
        return;
      }
      if (!isAgentConfigured()) {
        const terminal = vscode.window.createTerminal("WorkerMill Setup");
        terminal.show();
        terminal.sendText("workermill-agent setup");
        vscode.window.showInformationMessage(
          "Run setup first, then start the agent.",
        );
        return;
      }
      startAgentProcess();
      client.connect();
      vscode.window.showInformationMessage("WorkerMill agent starting...");
    }),

    // Stop agent
    vscode.commands.registerCommand("workermill.stopAgent", async () => {
      if (!isAgentInstalled()) {
        vscode.window.showWarningMessage("WorkerMill agent is not installed.");
        return;
      }
      const stopped = await stopAgentProcess();
      if (stopped) {
        vscode.window.showInformationMessage("WorkerMill agent stopped.");
      } else {
        vscode.window.showWarningMessage("Agent may not be running or failed to stop.");
      }
    }),

    // Sign out — stop agent, delete config + keychain secrets, reset to welcome view
    vscode.commands.registerCommand("workermill.signOut", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Sign out of WorkerMill? This will stop the agent and remove your configuration.",
        { modal: true },
        "Sign Out",
      );
      if (confirm !== "Sign Out") return;

      log("Signing out...");
      client.disconnect();
      await stopAgentProcess();

      // Clear API key from all storage locations
      await deleteApiKey();           // VS Code SecretStorage
      deleteApiKeyFromKeychain();     // OS keychain
      log("API key cleared from secure storage");

      // Delete config file
      const configPath = path.join(os.homedir(), ".workermill", "config.json");
      try {
        fs.unlinkSync(configPath);
      } catch {
        /* already gone */
      }

      // Reset context keys to show welcome view
      treeProvider.agentConfigured = false;
      vscode.commands.executeCommand("setContext", "workermill.agentConfigured", false);
      vscode.commands.executeCommand("setContext", "workermill.agentConnected", false);
      treeProvider.refresh();

      vscode.window.showInformationMessage(
        "Signed out of WorkerMill. Use the sidebar to sign in with a different account.",
      );
    }),

    // Restart agent
    vscode.commands.registerCommand("workermill.restartAgent", async () => {
      if (!isAgentInstalled()) {
        vscode.window.showWarningMessage("WorkerMill agent is not installed.");
        return;
      }
      vscode.window.showInformationMessage("Restarting WorkerMill agent...");
      await stopAgentProcess();
      // Brief delay to let the process fully exit
      await new Promise((r) => setTimeout(r, 2000));
      startAgentProcess();
      vscode.window.showInformationMessage("WorkerMill agent restarted.");
    }),

    vscode.commands.registerCommand(
      "workermill.signUpWithGitHub",
      async () => {
        const success = await signUpWithGitHub(log);
        if (success) {
          treeProvider.agentConfigured = true;
          vscode.commands.executeCommand("setContext", "workermill.agentConfigured", true);
          client.connect();
        }
      },
    ),

    vscode.commands.registerCommand(
      "workermill.signInWithGitHub",
      async () => {
        const success = await signInWithGitHub(log);
        if (success) {
          treeProvider.agentConfigured = true;
          vscode.commands.executeCommand("setContext", "workermill.agentConfigured", true);
          client.connect();
        }
      },
    ),

    vscode.commands.registerCommand(
      "workermill.signInWithEmail",
      async () => {
        const success = await signInWithEmail(log);
        if (success) {
          treeProvider.agentConfigured = true;
          vscode.commands.executeCommand("setContext", "workermill.agentConfigured", true);
          client.connect();
        }
      },
    ),

    vscode.commands.registerCommand(
      "workermill.signInWithGoogle",
      async () => {
        const success = await signInWithGoogle(log);
        if (success) {
          treeProvider.agentConfigured = true;
          vscode.commands.executeCommand("setContext", "workermill.agentConfigured", true);
          client.connect();
        }
      },
    ),

    vscode.commands.registerCommand("workermill.manualSetup", async () => {
      const success = await enterApiKey(log);
      if (success) {
        treeProvider.agentConfigured = true;
        vscode.commands.executeCommand("setContext", "workermill.agentConfigured", true);
        client.connect();
      }
    }),

    vscode.commands.registerCommand("workermill.setupStandalone", async () => {
      if (!isAgentInstalled()) {
        const choice = await vscode.window.showInformationMessage(
          "WorkerMill agent binary is required. Install it first?",
          "Install",
        );
        if (choice === "Install") {
          vscode.commands.executeCommand("workermill.installAgent");
        }
        return;
      }
      // Launch standalone init in a terminal
      const terminal = vscode.window.createTerminal("WorkerMill Standalone Setup");
      terminal.show();
      terminal.sendText("workermill-agent init --standalone");
      // Listen for config file creation
      const configPath = path.join(os.homedir(), ".workermill", "config.json");
      const checkInterval = setInterval(() => {
        if (fs.existsSync(configPath)) {
          clearInterval(checkInterval);
          treeProvider.agentConfigured = true;
          vscode.commands.executeCommand("setContext", "workermill.agentConfigured", true);
          vscode.window.showInformationMessage(
            "Standalone mode configured! Starting agent...",
          );
          startAgentProcess(log);
          waitForAgentReady(log, 10_000).then((port) => {
            if (port) client.connect();
          });
        }
      }, 2000);
      // Stop checking after 5 minutes
      setTimeout(() => clearInterval(checkInterval), 300_000);
    }),

    vscode.commands.registerCommand("workermill.configureScm", async () => {
      // Read API key from keychain first, then fall back to config file
      let apiKey = await getApiKey();
      if (!apiKey) {
        const configPath = path.join(os.homedir(), ".workermill", "config.json");
        try {
          const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          apiKey = config.apiKey;
        } catch {
          /* no config */
        }
      }

      if (!apiKey) {
        vscode.window.showErrorMessage(
          "Not signed in. Please sign in first, then configure repository access.",
        );
        return;
      }

      await promptScmSetup(apiKey, log);
    }),

    // Single "Connect" action: install-if-needed → start-if-not-running → connect
    vscode.commands.registerCommand("workermill.connectAgent", async () => {
      if (!isAgentInstalled()) {
        log("Installing agent...");
        const installed = await installAgent();
        if (!installed) return;
      }
      if (!isAgentConfigured()) {
        // Agent binary exists but no config — guide to sign in
        vscode.window.showInformationMessage(
          "Agent installed but not configured. Sign in to get started.",
        );
        return;
      }
      if (!client.isConnected()) {
        const hasGit = await promptInstallGit(log);
        if (!hasGit) {
          vscode.window.showWarningMessage(
            "Git is required for WorkerMill. Install Git and reload VS Code.",
          );
          return;
        }
        startAgentProcess(log);
        const port = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Connecting to WorkerMill agent...",
          },
          () => waitForAgentReady(log),
        );
        if (port) {
          client.connect();
        } else {
          const error = readAgentStartupError();
          if (error) {
            if (/pulling|downloading|starting ollama/i.test(error)) {
              vscode.window.showInformationMessage(
                "WorkerMill agent is starting up (this may take a moment).",
              );
            } else {
              vscode.window.showErrorMessage(`WorkerMill agent failed to start: ${error}`);
            }
          } else {
            vscode.window.showWarningMessage(
              "Agent didn't start. Check ~/.workermill/agent.log for details.",
            );
          }
        }
      }
    }),

    vscode.commands.registerCommand("workermill.openDashboard", () => {
      vscode.env.openExternal(vscode.Uri.parse("https://workermill.com/dashboard"));
    }),

    vscode.commands.registerCommand("workermill.openSettings", () => {
      SettingsPanel.createOrShow(context.extensionUri);
    }),
  );

  // Diagnostic logging for agent auto-start
  const installed = isAgentInstalled();
  const configured = isAgentConfigured();
  log(`Agent binary: ${getAgentBinaryPath()}`);
  log(`Agent installed: ${installed}, configured: ${configured}`);
  treeProvider.agentConfigured = configured;
  vscode.commands.executeCommand("setContext", "workermill.agentConfigured", configured);
  vscode.commands.executeCommand("setContext", "workermill.agentConnected", false);

  // Auto-start agent if installed and configured, otherwise let welcome view guide user
  if (installed && configured) {
    startAgentProcess(log);
    // Check if agent actually started after a brief delay
    waitForAgentReady(log, 10_000).then((port) => {
      if (!port) {
        const error = readAgentStartupError();
        if (error) {
          // Agent still starting up (Docker image pull, Ollama, etc.) — not a real error
          if (/pulling|downloading|starting ollama/i.test(error)) {
            vscode.window.showInformationMessage(
              "WorkerMill agent is starting up (this may take a moment).",
            );
          } else {
            vscode.window.showErrorMessage(`WorkerMill: ${error}`);
          }
        }
      }
    });
  } else if (configured && !installed) {
    log("Agent configured but not installed — auto-installing...");
    installAgent().then((success) => {
      if (success) {
        startAgentProcess(log);
        client.connect();
      }
    });
  } else if (!configured) {
    log("Agent not configured — showing welcome view");
    // Reveal the sidebar so the welcome view (with Sign Up / Sign In buttons) is visible
    vscode.commands.executeCommand("workermill.teamPanel.focus");
  }

  // Connect to agent (reconnect loop handles timing if agent isn't ready yet)
  client.connect();

  client.on("connected", (status) => {
    log(`Connected to agent ${status.agentId} (v${status.version})`);
    vscode.commands.executeCommand("setContext", "workermill.agentConnected", true);
  });

  client.on("disconnected", () => {
    log("Agent disconnected — will retry with backoff");
    vscode.commands.executeCommand("setContext", "workermill.agentConnected", false);
  });

  // RAG auto-offer disabled — feature not ready yet. Re-enable once Ollama
  // setup + indexing pipeline is fully tested end-to-end.
  // client.on("ragAutoOffer", (gpu) => { ... });

  client.on("reconnectGaveUp", () => {
    log("Reconnect attempts exhausted");
    vscode.window
      .showWarningMessage(
        "Could not connect to WorkerMill agent after multiple attempts.",
        "Retry",
      )
      .then((action) => {
        if (action === "Retry") {
          client.connect();
        }
      });
  });
}

export async function deactivate(): Promise<void> {
  LiveDiffManager.disposeAll();
  TaskDetailPanel.disposeAll();
  SettingsPanel.dispose();
  if (logManager) logManager.dispose();
  if (statusBar) statusBar.dispose();
  if (notifications) notifications.dispose();
  if (client) client.dispose();

  // Stop the agent process when VS Code closes
  await stopAgentProcess();
}
