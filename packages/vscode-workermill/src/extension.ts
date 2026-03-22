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
import { AgentClient, type TaskInfo, type IssueInfo, type DependencyWarning } from "./agent-client";
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
  writeAgentConfig,
  getAgentBinaryPath,
  installAgent,
  startAgentProcess,
  stopAgentProcess,
  waitForAgentReady,
  promptInstallGit,
  promptInstallClaudeCli,
  readAgentStartupError,
  writeApiKeyToKeychain,
  stripApiKeyFromConfig,
  deleteApiKeyFromKeychain,
  resetStartAttempts,
  getAgentLogPath,
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

  // Spec diff: virtual document providers for validation gate repair review
  const specBeforeContent = { value: "" };
  const specAfterContent = { value: "" };
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("workermill-spec-before", {
      provideTextDocumentContent: () => specBeforeContent.value,
    }),
    vscode.workspace.registerTextDocumentContentProvider("workermill-spec-after", {
      provideTextDocumentContent: () => specAfterContent.value,
    }),
  );

  // ── Task lifecycle auto-sync ──

  // Sticky live diff: when user enables live code view, auto-enable it on the next cascaded task
  let liveDiffSticky = false;

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
      // Sticky live diff: arm the session during planning so the eye icon is visible
      if (liveDiffSticky) {
        try {
          LiveDiffManager.ensureOpen(client, { id: info.id, summary: info.summary });
          log(`[sticky] auto-opened live diff during planning for ${info.id}`);
        } catch (err) {
          log(`[sticky] ERROR auto-opening live diff during planning: ${err instanceof Error ? err.message : String(err)}`);
        }
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
      log(`[sticky] task:started id=${info.id} liveDiffSticky=${liveDiffSticky} activeSessions=${LiveDiffManager.hasActiveSessions()}`);

      // Auto-start live diff FIRST — before any other work that might throw
      // Use ensureOpen (not createOrShow) so we don't toggle OFF a session the
      // user already started during the planning phase of this same task.
      if (liveDiffSticky) {
        try {
          LiveDiffManager.ensureOpen(client, { id: info.id, summary: info.summary });
          log(`[sticky] auto-opened live diff for ${info.id}, sessions now=${LiveDiffManager.hasActiveSessions()}`);
          const label = info.summary.length > 50 ? `${info.summary.substring(0, 50)}...` : info.summary;
          vscode.window.setStatusBarMessage(`$(eye) Live code view: watching ${label}`, 5000);
        } catch (err) {
          log(`[sticky] ERROR auto-opening live diff: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

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
    // Close live diff for the completed task (next task will auto-start if sticky)
    log(`[sticky] task:completed id=${info.id} liveDiffSticky=${liveDiffSticky} sessions=${LiveDiffManager.hasActiveSessions()}`);
    LiveDiffManager.closeTask(info.id);
    log(`[sticky] after closeTask sessions=${LiveDiffManager.hasActiveSessions()}`);
  });

  client.on("task:failed", (info: { id: string }) => {
    log(`[sticky] task:failed id=${info.id} liveDiffSticky=${liveDiffSticky} sessions=${LiveDiffManager.hasActiveSessions()}`);
    if (currentFeedTaskId === info.id) {
      currentFeedTaskStatus = "failed";
      feedView.onTaskFinished(info.id, "failed");
    }
    logManager.onTaskFinished(info.id, "failed");
    // Close live diff for failed task too (matches completed behavior)
    LiveDiffManager.closeTask(info.id);
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
    { dispose: () => treeProvider.dispose() },
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

    // Delete a card from the backlog
    vscode.commands.registerCommand(
      "workermill.deleteCard",
      async (issueItem?: { issue?: { key: string; summary: string; _cardId?: string; _boardId?: string } }) => {
        if (!client.isConnected()) {
          vscode.window.showErrorMessage("WorkerMill agent is not running.");
          return;
        }

        const cardId = issueItem?.issue?._cardId;
        const boardId = issueItem?.issue?._boardId;
        if (!cardId || !boardId) {
          vscode.window.showWarningMessage("Cannot delete — card info missing.");
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          `Delete "${issueItem?.issue?.key}: ${issueItem?.issue?.summary}" from the backlog?`,
          { modal: true },
          "Delete",
        );
        if (confirm !== "Delete") return;

        try {
          await client.deleteCard(boardId, cardId);
          vscode.window.showInformationMessage(`Card ${issueItem?.issue?.key} deleted.`);
          treeProvider.refresh();
        } catch (err) {
          vscode.window.showErrorMessage(
            `Failed to delete card: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    ),

    // Delete a completed/pr_approved/failed task
    vscode.commands.registerCommand(
      "workermill.deleteTask",
      async (taskItem?: { task?: { id: string; summary: string } }) => {
        if (!client.isConnected()) {
          vscode.window.showErrorMessage("WorkerMill agent is not running.");
          return;
        }

        const taskId = taskItem?.task?.id;
        if (!taskId) {
          vscode.window.showWarningMessage("Cannot delete — task info missing.");
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          `Delete "${taskItem?.task?.summary}"? This cannot be undone.`,
          { modal: true },
          "Delete",
        );
        if (confirm !== "Delete") return;

        try {
          await client.deleteTask(taskId);
          vscode.window.showInformationMessage("Task deleted.");
          treeProvider.refresh();
        } catch (err) {
          vscode.window.showErrorMessage(
            `Failed to delete task: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    ),

    // New task — free-form description, no ticket key required
    vscode.commands.registerCommand("workermill.newTask", async () => {
      if (!client.isConnected()) {
        vscode.window.showErrorMessage(
          "WorkerMill agent is not running. Start with: workermill-agent start",
        );
        return;
      }

      const summary = await vscode.window.showInputBox({
        prompt: "What do you want to build or fix?",
        placeHolder: "e.g. Add dark mode toggle to the settings page",
        ignoreFocusOut: true,
      });
      if (!summary) return;

      // Auto-detect repo from workspace
      let selectedRepo: string | undefined;
      try {
        const repoInfo = await client.getRepos();
        if (repoInfo.repos.length === 1) {
          selectedRepo = repoInfo.repos[0];
        } else if (repoInfo.repos.length > 1) {
          selectedRepo = await vscode.window.showQuickPick(repoInfo.repos, {
            placeHolder: "Which repository?",
          });
          if (!selectedRepo) return;
        } else if (repoInfo.defaultRepo) {
          selectedRepo = repoInfo.defaultRepo;
        }
      } catch {
        // No repos configured — proceed without, worker will use default
      }

      try {
        await client.runFileAsTask(summary, summary, selectedRepo);
        vscode.window.showInformationMessage(`WorkerMill: Task submitted`);
        treeProvider.refresh();
        vscode.commands.executeCommand("workermill.teamPanel.focus");
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to create task: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

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
        const activeStatuses = new Set(["running", "executing", "consolidating", "integration_check", "deploying"]);
        const activeTasks = tasks.filter((t) => activeStatuses.has(t.status));

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
        const runningStatuses = new Set(["running", "executing", "planning", "consolidating",
          "integration_check", "deploying", "queued", "dispatching", "claimed", "environment_setup"]);
        const activeTasks = tasks.filter((t) => runningStatuses.has(t.status));

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
        const planningTasks = tasks.filter((t) => t.status === "planning" || t.status === "pending_plan_approval");

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
        // Track sticky state: ON if we just created a session, OFF if we just toggled it off
        liveDiffSticky = LiveDiffManager.hasActiveSessions();
        log(`[sticky] eye icon clicked task=${task.id} liveDiffSticky=${liveDiffSticky} sessions=${LiveDiffManager.hasActiveSessions()}`);
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
            const actStatuses = new Set(["running", "executing", "planning", "pending_plan_approval",
              "consolidating", "integration_check", "deploying", "queued", "dispatching", "claimed", "environment_setup"]);
            const active = tasks.filter((t) => actStatuses.has(t.status));
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
            `Stop task "${t.summary}"? This will terminate the running worker.`,
            { modal: true },
            "Stop Task",
          );
          if (confirm !== "Stop Task") return;
          try {
            await client.cancelTask(t.id);
            vscode.window.showInformationMessage(`Task stopped.`);
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

        // Infer board name from first # heading
        const headingMatch = fileContent.match(/^#\s+(.+)$/m);
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
            {
              onSpecReview: async (warnings: DependencyWarning[]) => {
                // Show warnings in terminal
                writeEmitter.fire(`\r\n\x1b[1m\x1b[93m⚠ Found ${warnings.length} issue${warnings.length !== 1 ? "s" : ""} in your spec:\x1b[0m\r\n`);
                for (const w of warnings) {
                  const icon = w.severity === "error" ? "\x1b[91m✗\x1b[0m" : "\x1b[93m!\x1b[0m";
                  writeEmitter.fire(`  ${icon} ${w.message}\r\n`);
                  writeEmitter.fire(`    \x1b[2m${w.suggestion}\x1b[0m\r\n`);
                }
                writeEmitter.fire("\r\n");

                const items: Array<{ label: string; description: string; value: "fix" | "proceed" | "cancel" }> = [
                  { label: "$(wrench) Fix Issues", description: "Let AI repair the spec before building", value: "fix" },
                  { label: "$(arrow-right) Proceed Anyway", description: "Build with the current spec as-is", value: "proceed" },
                  { label: "$(close) Cancel", description: "Abort the build", value: "cancel" },
                ];
                const picked = await vscode.window.showQuickPick(items, {
                  placeHolder: `${warnings.length} issue${warnings.length !== 1 ? "s" : ""} found — how do you want to proceed?`,
                });
                return picked?.value || "cancel";
              },

              onRepairComplete: async (diff: string, fixedPrd: string) => {
                writeEmitter.fire(`\x1b[92m✓\x1b[0m Spec repaired. Review the changes:\r\n`);

                // Show diff in native VS Code diff editor using virtual documents
                const beforeUri = vscode.Uri.parse(`workermill-spec-before://spec/original.md`);
                const afterUri = vscode.Uri.parse(`workermill-spec-after://spec/fixed.md`);

                // Update content for the providers
                specBeforeContent.value = fileContent;
                specAfterContent.value = fixedPrd;

                await vscode.commands.executeCommand("vscode.diff", beforeUri, afterUri, "Spec Repair — Review Changes");

                const items: Array<{ label: string; description: string; value: "accept" | "reject" }> = [
                  { label: "$(check) Accept Fix", description: "Build with the repaired spec", value: "accept" },
                  { label: "$(close) Reject Fix", description: "Go back to the warning screen", value: "reject" },
                ];
                const picked = await vscode.window.showQuickPick(items, {
                  placeHolder: "Accept the repaired spec?",
                });

                // Close the diff tab
                await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

                return picked?.value || "reject";
              },
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
            if (result.parentIssueUrl) {
              vscode.env.openExternal(vscode.Uri.parse(result.parentIssueUrl));
            } else if (result.boardId) {
              vscode.env.openExternal(
                vscode.Uri.parse(
                  `https://workermill.com/boards/${result.boardId}`,
                ),
              );
            }
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
        const headingMatch = fileContent.match(/^#\s+(.+)$/m);
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
          const binaryPath = getAgentBinaryPath();
          const isWindows = process.platform === "win32";
          const terminalOpts: vscode.TerminalOptions = { name: "WorkerMill Setup" };
          if (isWindows) terminalOpts.shellPath = "powershell.exe";
          const terminal = vscode.window.createTerminal(terminalOpts);
          terminal.show();
          terminal.sendText(isWindows ? `& "${binaryPath}" setup` : `"${binaryPath}" setup`);
          vscode.window.showInformationMessage(
            "Agent installed! Complete setup in the terminal, then start the agent.",
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
        const binaryPath = getAgentBinaryPath();
        const isWindows = process.platform === "win32";
        const terminalOpts: vscode.TerminalOptions = { name: "WorkerMill Setup" };
        if (isWindows) terminalOpts.shellPath = "powershell.exe";
        const terminal = vscode.window.createTerminal(terminalOpts);
        terminal.show();
        terminal.sendText(isWindows ? `& "${binaryPath}" setup` : `"${binaryPath}" setup`);
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
      if (isAgentConfigured()) {
        // Already configured — check if they want to switch to local
        const action = await vscode.window.showWarningMessage(
          "You already have a WorkerMill configuration. Connecting to a local instance will replace your current connection. Continue?",
          "Switch to Local",
          "Cancel",
        );
        if (action !== "Switch to Local") {
          return;
        }
      } else {
        // Not configured — confirm they want local dev
        const action = await vscode.window.showInformationMessage(
          "Connect to a local WorkerMill instance running on this machine. Make sure you've started the local stack first.",
          "Connect to localhost:3001",
          "View Setup Guide",
          "Cancel",
        );
        if (action === "View Setup Guide") {
          vscode.env.openExternal(
            vscode.Uri.parse("https://github.com/jarod-rosenthal/workermill/blob/main/docs/local-development.md"),
          );
          return;
        }
        if (action !== "Connect to localhost:3001") {
          return;
        }
      }

      // Write config pointing at local API with self-hosted key (auto-login, no SSO)
      writeAgentConfig({ apiUrl: "http://localhost:3001", apiKey: "self-hosted" });
      await vscode.commands.executeCommand("setContext", "workermill.agentConfigured", true);
      log("Wrote local dev config (localhost:3001, self-hosted key)");
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
          vscode.window.showInformationMessage(
            "WorkerMill agent is still starting. Click 'Connect Agent' once it's ready.",
          );
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
    // Show progress while waiting for agent to start (Docker Compose can take minutes)
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "WorkerMill",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Starting agent..." });
        const start = Date.now();
        const timeoutMs = 300_000; // 5 minutes — first-time image pulls can be slow
        const pollMs = 1_500;
        const portFile = path.join(os.homedir(), ".workermill", "agent.port");
        const logFile = path.join(os.homedir(), ".workermill", "agent.log");
        let lastLogSize = 0;
        try { lastLogSize = fs.statSync(logFile).size; } catch { /* no log yet */ }

        while (Date.now() - start < timeoutMs) {
          const elapsed = Math.round((Date.now() - start) / 1000);

          // Read new lines from agent.log to show real progress
          let statusMsg = `Starting up (${elapsed}s)...`;
          try {
            const currentSize = fs.statSync(logFile).size;
            if (currentSize > lastLogSize) {
              // Read last chunk of new log content
              const fd = fs.openSync(logFile, "r");
              const readSize = Math.min(currentSize - lastLogSize, 4096);
              const buf = Buffer.alloc(readSize);
              fs.readSync(fd, buf, 0, readSize, currentSize - readSize);
              fs.closeSync(fd);
              const recent = buf.toString("utf-8");
              lastLogSize = currentSize;

              // Extract meaningful progress from log lines
              if (/pulling|Pulling/i.test(recent)) {
                const imageMatch = recent.match(/Pulling.*?(ghcr\.io\/[^\s]+|pgvector[^\s]*|redis[^\s]*)/i);
                statusMsg = imageMatch
                  ? `Downloading ${imageMatch[1]} (${elapsed}s)...`
                  : `Downloading Docker images (${elapsed}s)...`;
              } else if (/API is healthy/i.test(recent)) {
                statusMsg = "API is ready, connecting...";
              } else if (/Waiting for API/i.test(recent)) {
                statusMsg = `Waiting for API to be ready (${elapsed}s)...`;
              } else if (/Connected to/i.test(recent)) {
                statusMsg = "Agent connected!";
              } else if (/Running migrations|migration/i.test(recent)) {
                statusMsg = `Running database migrations (${elapsed}s)...`;
              }
            }
          } catch { /* log file not available yet */ }

          progress.report({ message: statusMsg });

          // Check if port file appeared (agent is ready)
          try {
            const port = parseInt(fs.readFileSync(portFile, "utf-8").trim(), 10);
            if (port > 0) {
              progress.report({ message: "Agent connected!" });
              client.connect();
              return;
            }
          } catch { /* not ready yet */ }
          await new Promise((r) => setTimeout(r, pollMs));
        }
        // Timed out — but agent may still be starting
        vscode.window.showInformationMessage(
          "WorkerMill agent is still starting — first-time setup downloads ~2 GB of Docker images. Click 'Connect Agent' once it's ready.",
        );
      },
    );
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
    resetStartAttempts(); // Agent is alive — allow future restarts
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

  // Stop the agent + compose stack — non-blocking, compose down is fire-and-forget
  stopAgentProcess();
}
