/**
 * LiveDiffManager — Native VS Code diff editor for live code changes.
 *
 * Replaces the webview-based LiveDiffPanel with real diff editors using
 * TextDocumentContentProvider for before/after virtual documents.
 * Provides syntax highlighting, proper diff navigation, and all the
 * built-in diff editor features VS Code offers.
 */

import * as vscode from "vscode";
import type { AgentClient, CodeEventRecord } from "./agent-client";

// ── Virtual document URI schemes ──

const BEFORE_SCHEME = "workermill-before";
const AFTER_SCHEME = "workermill-after";

// ── Shared state for content providers ──

interface FileState {
  before: string;
  after: string;
  expert: string | null;
  toolName: "Write" | "Edit" | null;
  lastUpdated: number;
}

/** Global map: `${taskId}/${filePath}` → FileState */
const fileStates = new Map<string, FileState>();

function stateKey(taskId: string, filePath: string): string {
  return `${taskId}/${filePath}`;
}

// ── Content Providers ──

export class BeforeContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    const key = `${uri.authority}${uri.path}`;
    const state = fileStates.get(key);
    return state?.before ?? "";
  }

  fireChange(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

export class AfterContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    const key = `${uri.authority}${uri.path}`;
    const state = fileStates.get(key);
    return state?.after ?? "";
  }

  fireChange(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

// ── LiveDiffManager ──

/** Singleton providers registered once at activation */
let beforeProvider: BeforeContentProvider | null = null;
let afterProvider: AfterContentProvider | null = null;

/** Active managers keyed by taskId */
const managers = new Map<string, LiveDiffManager>();

export class LiveDiffManager {
  private readonly client: AgentClient;
  private readonly taskId: string;
  private readonly taskSummary: string;

  private files = new Map<string, FileState>();
  private fileOrder: string[] = [];
  private currentFile: string | null = null;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastTimestamp: string | null = null;
  private consecutiveErrors = 0;
  private currentInterval = 5_000;
  private disposed = false;

  private statusBarItem: vscode.StatusBarItem;

  /** Debounce timer for firing onDidChange events */
  private fireDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFireUris = new Set<string>();

  /** Output channel for diagnostics (shared across instances) */
  private static outputChannel: vscode.OutputChannel | null = null;

  private log(msg: string): void {
    if (!LiveDiffManager.outputChannel) {
      LiveDiffManager.outputChannel = vscode.window.createOutputChannel("WorkerMill");
    }
    LiveDiffManager.outputChannel.appendLine(`[live-diff ${this.taskId.slice(0, 8)}] ${msg}`);
  }

  // ── Static API ──

  /**
   * Register both content providers at extension activation.
   * Call once from `activate()`.
   */
  static register(context: vscode.ExtensionContext): void {
    beforeProvider = new BeforeContentProvider();
    afterProvider = new AfterContentProvider();

    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(BEFORE_SCHEME, beforeProvider),
      vscode.workspace.registerTextDocumentContentProvider(AFTER_SCHEME, afterProvider),
      beforeProvider,
      afterProvider,
    );
  }

  /**
   * Toggle live diff for a task: start if not active, stop if already active.
   */
  static createOrShow(
    client: AgentClient,
    task: { id: string; summary: string },
  ): void {
    const existing = managers.get(task.id);
    if (existing) {
      existing.dispose(); // Toggle OFF — stop live diff
      return;
    }
    new LiveDiffManager(client, task.id, task.summary);
  }

  /**
   * Ensure live diff is open for a task — does NOT toggle off if already active.
   * Used by sticky auto-open on task:started to avoid killing a session the user
   * already started during the planning phase.
   */
  static ensureOpen(
    client: AgentClient,
    task: { id: string; summary: string },
  ): void {
    if (managers.has(task.id)) return; // already watching — leave it alone
    new LiveDiffManager(client, task.id, task.summary);
  }

  /** Close the live diff session for a specific task. */
  static closeTask(taskId: string): void {
    const mgr = managers.get(taskId);
    if (mgr) mgr.dispose();
  }

  /** Check if any live diff session is currently active. */
  static hasActiveSessions(): boolean {
    return managers.size > 0;
  }

  /** Dispose all active managers. */
  static disposeAll(): void {
    for (const m of managers.values()) m.dispose();
  }

  /**
   * Show file picker for the active manager (if exactly one),
   * or let the user pick which task first.
   */
  static showActiveFilePicker(): void {
    if (managers.size === 0) {
      vscode.window.showInformationMessage("No live diff sessions active.");
      return;
    }
    if (managers.size === 1) {
      const mgr = managers.values().next().value as LiveDiffManager;
      mgr.showFilePicker();
      return;
    }
    // Multiple tasks — pick one first
    const items = Array.from(managers.values()).map((m) => ({
      label: m.taskSummary,
      description: `${m.files.size} files`,
      manager: m,
    }));
    vscode.window
      .showQuickPick(items, { placeHolder: "Select a task" })
      .then((item) => {
        if (item) item.manager.showFilePicker();
      });
  }

  // ── Instance ──

  private constructor(client: AgentClient, taskId: string, summary: string) {
    this.client = client;
    this.taskId = taskId;
    this.taskSummary =
      summary.length > 40 ? `${summary.substring(0, 40)}...` : summary;

    managers.set(taskId, this);

    // Status bar: "$(eye) Live: 0 files"
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBarItem.command = "workermill.liveDiffPicker";
    this.updateStatusBar();
    this.statusBarItem.show();

    // Start polling after a brief delay (matches existing pattern)
    setTimeout(() => {
      if (!this.disposed) {
        this.poll();
        this.pollTimer = setInterval(() => this.poll(), this.currentInterval);
      }
    }, 500);
  }

  private updateStatusBar(): void {
    const count = this.files.size;
    this.statusBarItem.text = `$(eye) Live: ${count} file${count !== 1 ? "s" : ""}`;
    this.statusBarItem.tooltip = `WorkerMill Live Diff — ${this.taskSummary} (click to switch files)`;
  }

  // ── Polling ──

  private resetInterval(ms: number): void {
    this.currentInterval = ms;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.poll(), ms);
  }

  private async poll(): Promise<void> {
    if (this.disposed) return;
    if (!this.client.isConnected()) {
      this.log("poll skipped — client disconnected");
      return;
    }

    try {
      const events = await this.client.getCodeEvents(
        this.taskId,
        this.lastTimestamp || undefined,
      );

      if (events.length > 0) {
        this.log(`poll: ${events.length} new events`);
        this.lastTimestamp = events[events.length - 1].createdAt;
        this.processEvents(events);
      }

      this.consecutiveErrors = 0;
      if (this.currentInterval !== 5_000) {
        this.resetInterval(5_000);
      }
    } catch (err) {
      this.consecutiveErrors++;
      this.log(`poll error #${this.consecutiveErrors}: ${err instanceof Error ? err.message : String(err)}`);
      if (this.consecutiveErrors >= 3) {
        const backed = Math.min(this.currentInterval * 2, 30_000);
        this.resetInterval(backed);
        this.log(`backing off to ${backed}ms`);
      }
    }
  }

  // ── Event Processing ──

  private processEvents(events: CodeEventRecord[]): void {
    let newestFile: string | null = null;

    for (const ev of events) {
      if (!ev.filePath) continue;
      const fp = stripWorktreePrefix(ev.filePath);
      if (!fp) continue;
      const meta = ev.metadata;

      if (!meta) continue;

      const isEdit = meta.toolName === "Edit" && meta.oldStr !== null;
      const isWrite = meta.toolName === "Write" || meta.isWrite === true;

      if (!isEdit && !isWrite) continue;

      const key = stateKey(this.taskId, fp);
      const existing = this.files.get(fp);

      if (isEdit) {
        if (existing) {
          // Cumulative edit: freeze before on first event, update after on subsequent
          // Matches dashboard behavior (useTaskStreaming.ts)
          existing.after = meta.newStr ?? "";
          existing.expert = meta.expert ?? existing.expert;
          existing.toolName = "Edit";
          existing.lastUpdated = Date.now();
          fileStates.set(key, existing);
        } else {
          const state: FileState = {
            before: meta.oldStr ?? "",
            after: meta.newStr ?? "",
            expert: meta.expert ?? null,
            toolName: "Edit",
            lastUpdated: Date.now(),
          };
          this.files.set(fp, state);
          fileStates.set(key, state);
        }
      } else {
        // Write event: empty before, full content as after
        // content is persisted as newStr in metadata by the API
        const state: FileState = {
          before: "",
          after: meta.newStr ?? ev.message,
          expert: meta.expert ?? null,
          toolName: "Write",
          lastUpdated: Date.now(),
        };
        this.files.set(fp, state);
        fileStates.set(key, state);
      }

      this.scheduleFire(fp);
      newestFile = fp;
    }

    if (newestFile) {
      // Rebuild file order by most recently changed
      this.fileOrder = Array.from(this.files.keys()).sort((a, b) => {
        const stateA = this.files.get(a);
        const stateB = this.files.get(b);
        return (stateB?.lastUpdated ?? 0) - (stateA?.lastUpdated ?? 0);
      });

      this.updateStatusBar();

      // Auto-follow the most recently edited file
      if (newestFile !== this.currentFile) {
        this.openDiff(newestFile);
      } else {
        // Same file updated — fire change events immediately for the current file
        this.flushFires();
      }
    }
  }

  // ── Debounced onDidChange ──

  private scheduleFire(fp: string): void {
    this.pendingFireUris.add(fp);
    if (this.fireDebounceTimer) clearTimeout(this.fireDebounceTimer);
    this.fireDebounceTimer = setTimeout(() => this.flushFires(), 500);
  }

  private flushFires(): void {
    if (this.fireDebounceTimer) {
      clearTimeout(this.fireDebounceTimer);
      this.fireDebounceTimer = null;
    }

    for (const fp of this.pendingFireUris) {
      const beforeUri = buildUri(BEFORE_SCHEME, this.taskId, fp);
      const afterUri = buildUri(AFTER_SCHEME, this.taskId, fp);
      beforeProvider?.fireChange(beforeUri);
      afterProvider?.fireChange(afterUri);
    }
    this.pendingFireUris.clear();
  }

  // ── Diff Editor ──

  async openDiff(fp: string): Promise<void> {
    this.currentFile = fp;

    // Close any existing live diff tab so we reuse a single tab
    await this.closeLiveDiffTab();

    const beforeUri = buildUri(BEFORE_SCHEME, this.taskId, fp);
    const afterUri = buildUri(AFTER_SCHEME, this.taskId, fp);

    const state = this.files.get(fp);
    const expert = state?.expert;
    const tool = state?.toolName;
    const fileName = fp.split("/").pop() || fp;
    const parts = [fileName];
    if (expert || tool) {
      const meta = [tool, expert].filter(Boolean).join(" \u2014 ");
      parts.push(`(${meta})`);
    }
    parts.push("\u2014 Live Diff");
    const title = parts.join(" ");

    vscode.commands.executeCommand(
      "vscode.diff",
      beforeUri,
      afterUri,
      title,
      { preview: true, preserveFocus: true } as vscode.TextDocumentShowOptions,
    );
  }

  /** Close any open tab whose URI matches our before/after schemes for this task. */
  private async closeLiveDiffTab(): Promise<void> {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (
          input &&
          typeof input === "object" &&
          "modified" in input &&
          "original" in input
        ) {
          const diffInput = input as { original: vscode.Uri; modified: vscode.Uri };
          if (
            diffInput.modified.scheme === AFTER_SCHEME &&
            diffInput.modified.authority === this.taskId
          ) {
            await vscode.window.tabGroups.close(tab);
            return;
          }
        }
      }
    }
  }

  // ── File Picker ──

  showFilePicker(): void {
    if (this.files.size === 0) {
      vscode.window.showInformationMessage(
        "No code changes yet. Watching for edits...",
      );
      return;
    }

    const now = Date.now();
    const items = this.fileOrder.map((fp) => {
      const state = this.files.get(fp);
      const fileName = fp.split("/").pop() || fp;
      const dir = fp.includes("/")
        ? fp.substring(0, fp.lastIndexOf("/"))
        : "";
      const expert = state?.expert ?? "";
      const tool = state?.toolName ?? "";
      const toolIcon = tool === "Write" ? "$(new-file)" : tool === "Edit" ? "$(edit)" : "";
      const ago = state ? relativeTime(now - state.lastUpdated) : "";

      return {
        label: `${toolIcon} ${fileName}`.trim(),
        description: [dir, expert].filter(Boolean).join(" \u2014 "),
        detail: ago,
        filePath: fp,
      };
    });

    vscode.window
      .showQuickPick(items, {
        placeHolder: `${this.files.size} changed files`,
        matchOnDescription: true,
      })
      .then((item) => {
        if (item) this.openDiff(item.filePath);
      });
  }

  // ── Cleanup ──

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.fireDebounceTimer) clearTimeout(this.fireDebounceTimer);

    // Close the live diff tab
    this.closeLiveDiffTab();

    // Remove shared file states for this task
    for (const fp of this.files.keys()) {
      fileStates.delete(stateKey(this.taskId, fp));
    }

    this.statusBarItem.dispose();
    managers.delete(this.taskId);
  }
}

// ── Helpers ──

function buildUri(scheme: string, taskId: string, filePath: string): vscode.Uri {
  // authority = taskId, path = /filePath (preserves file extension for syntax highlighting)
  return vscode.Uri.parse(`${scheme}://${taskId}/${filePath}`);
}

/**
 * Strip worktree prefix from paths.
 * e.g. `worktrees/abc123/src/foo.ts` → `src/foo.ts`
 */
function stripWorktreePrefix(fp: string): string {
  const match = fp.match(/worktrees\/[^/]+\/(.+)/);
  return match ? match[1] : fp;
}

/** Human-readable relative time (e.g. "just now", "3s ago", "2m ago") */
function relativeTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
