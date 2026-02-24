# Native Live Diff Viewer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the webview-based LiveDiffPanel with native VS Code diff editors powered by TextDocumentContentProvider, giving full syntax highlighting, line numbers, and real-time updates.

**Architecture:** Two TextDocumentContentProviders (`workermill-before:`, `workermill-after:`) supply virtual document content. A LiveDiffManager polls code events, maintains per-file before/after state, and opens/refreshes diffs via `vscode.diff`. Auto-follows the most recently edited file.

**Tech Stack:** VS Code Extension API (TextDocumentContentProvider, vscode.diff command, StatusBarItem, QuickPick)

---

### Task 1: Create LiveDiffManager with Content Providers

**Files:**
- Create: `packages/vscode-workermill/src/live-diff-manager.ts`

**Step 1: Create the file with content providers and manager class**

```typescript
/**
 * LiveDiffManager — Native VS Code diff viewer for live code changes.
 * Uses TextDocumentContentProvider to supply virtual before/after documents,
 * then opens them with vscode.diff for full syntax highlighting and native UX.
 */

import * as vscode from "vscode";
import type { AgentClient, CodeEventRecord } from "./agent-client";

// ── Per-file state ──

interface FileState {
  before: string;
  after: string;
  expert: string;
  timestamp: string;
  /** Track first vs. cumulative edits: once set, before stays frozen */
  beforeFrozen: boolean;
}

// ── Content Providers ──

/** Shared store so content providers can look up file state by URI */
const fileStates = new Map<string, Map<string, FileState>>();

function stateKey(taskId: string, filePath: string): string {
  return `${taskId}::${filePath}`;
}

function getFileState(taskId: string, filePath: string): FileState | undefined {
  return fileStates.get(taskId)?.get(filePath);
}

/** Parse a workermill-before://taskId/path or workermill-after://taskId/path URI */
function parseUri(uri: vscode.Uri): { taskId: string; filePath: string } | null {
  // authority = taskId, path = /full/file/path.ts
  const taskId = uri.authority;
  const filePath = uri.path; // includes leading /
  if (!taskId || !filePath) return null;
  return { taskId, filePath: filePath.slice(1) }; // strip leading /
}

export class BeforeContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    const parsed = parseUri(uri);
    if (!parsed) return "";
    return getFileState(parsed.taskId, parsed.filePath)?.before ?? "";
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
    const parsed = parseUri(uri);
    if (!parsed) return "";
    return getFileState(parsed.taskId, parsed.filePath)?.after ?? "";
  }

  fireChange(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

// ── LiveDiffManager ──

export class LiveDiffManager {
  private static instances = new Map<string, LiveDiffManager>();

  private static beforeProvider: BeforeContentProvider;
  private static afterProvider: AfterContentProvider;

  private readonly client: AgentClient;
  private readonly taskId: string;
  private readonly taskSummary: string;

  private files = new Map<string, FileState>();
  /** Ordered list of file paths, most recently changed first */
  private fileOrder: string[] = [];
  /** Currently displayed file path (null = none open) */
  private currentFile: string | null = null;

  private pollTimer: NodeJS.Timeout | null = null;
  private lastTimestamp: string | null = null;
  private disposed = false;
  private consecutiveErrors = 0;
  private currentInterval = 2_000;

  private statusBarItem: vscode.StatusBarItem;

  /** Debounce timer for firing content provider changes */
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingUris = new Set<string>();

  /** Register the two content providers — call once at extension activation */
  static register(context: vscode.ExtensionContext): void {
    LiveDiffManager.beforeProvider = new BeforeContentProvider();
    LiveDiffManager.afterProvider = new AfterContentProvider();
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(
        "workermill-before",
        LiveDiffManager.beforeProvider,
      ),
      vscode.workspace.registerTextDocumentContentProvider(
        "workermill-after",
        LiveDiffManager.afterProvider,
      ),
      LiveDiffManager.beforeProvider,
      LiveDiffManager.afterProvider,
    );
  }

  static createOrShow(client: AgentClient, task: { id: string; summary: string }): void {
    const existing = LiveDiffManager.instances.get(task.id);
    if (existing) {
      // Already watching — show the file picker
      existing.showFilePicker();
      return;
    }
    new LiveDiffManager(client, task.id, task.summary);
  }

  static disposeAll(): void {
    for (const inst of LiveDiffManager.instances.values()) inst.dispose();
  }

  private constructor(client: AgentClient, taskId: string, taskSummary: string) {
    this.client = client;
    this.taskId = taskId;
    this.taskSummary = taskSummary;

    // Initialize state store for this task
    fileStates.set(taskId, this.files);

    LiveDiffManager.instances.set(taskId, this);

    // Status bar
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      50,
    );
    this.statusBarItem.command = "workermill.liveDiffPickFile";
    this.updateStatusBar();
    this.statusBarItem.show();

    // Start polling
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.currentInterval);
  }

  private updateStatusBar(): void {
    const count = this.files.size;
    if (count === 0) {
      this.statusBarItem.text = "$(eye) Live: watching...";
      this.statusBarItem.tooltip = `Watching for code changes — ${this.taskSummary}`;
    } else {
      this.statusBarItem.text = `$(eye) Live: ${count} file${count === 1 ? "" : "s"}`;
      this.statusBarItem.tooltip = `${count} file${count === 1 ? "" : "s"} changed — click to browse`;
    }
  }

  private resetInterval(ms: number): void {
    this.currentInterval = ms;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.poll(), ms);
  }

  private async poll(): Promise<void> {
    if (this.disposed) return;
    if (!this.client.isConnected()) return;
    try {
      const events = await this.client.getCodeEvents(
        this.taskId,
        this.lastTimestamp || undefined,
      );
      if (events.length > 0) {
        this.lastTimestamp = events[events.length - 1].createdAt;
        this.processEvents(events);
      }
      this.consecutiveErrors = 0;
      if (this.currentInterval !== 2_000) {
        this.resetInterval(2_000);
      }
    } catch {
      this.consecutiveErrors++;
      if (this.consecutiveErrors >= 3) {
        const backed = Math.min(this.currentInterval * 2, 30_000);
        this.resetInterval(backed);
      }
    }
  }

  private shortPath(fp: string): string {
    const m = fp.match(/worktrees\/[^/]+\/(.+)/);
    if (m) return m[1];
    return fp;
  }

  private processEvents(events: CodeEventRecord[]): void {
    let latestFile: string | null = null;

    for (const ev of events) {
      const rawPath = ev.filePath || "(unknown)";
      const fp = this.shortPath(rawPath);
      const meta = ev.metadata;
      if (!meta) continue;

      const isEdit = meta.toolName === "Edit" && meta.oldStr;
      const isWrite = meta.toolName === "Write" || meta.isWrite;

      let state = this.files.get(fp);

      if (isEdit) {
        if (!state) {
          // First edit for this file — before = oldStr
          state = {
            before: meta.oldStr || "",
            after: meta.newStr || "",
            expert: meta.expert || "",
            timestamp: ev.createdAt,
            beforeFrozen: true,
          };
          this.files.set(fp, state);
          this.fileOrder.push(fp);
        } else {
          // Cumulative: keep original before, update after
          state.after = meta.newStr || "";
          state.expert = meta.expert || state.expert;
          state.timestamp = ev.createdAt;
        }
      } else if (isWrite) {
        // Write = new file or full overwrite
        const content = ev.message || "";
        state = {
          before: "",
          after: content,
          expert: meta.expert || "",
          timestamp: ev.createdAt,
          beforeFrozen: true,
        };
        this.files.set(fp, state);
        if (!this.fileOrder.includes(fp)) {
          this.fileOrder.push(fp);
        }
      }

      if (state) {
        latestFile = fp;
        this.scheduleDebouncedUpdate(fp);
      }
    }

    // Re-sort file order: most recently changed first
    this.fileOrder.sort((a, b) => {
      const ta = this.files.get(a)?.timestamp || "";
      const tb = this.files.get(b)?.timestamp || "";
      return tb.localeCompare(ta);
    });

    this.updateStatusBar();

    // Auto-follow: switch to most recently edited file
    if (latestFile && latestFile !== this.currentFile) {
      this.openDiff(latestFile);
    }
  }

  private scheduleDebouncedUpdate(fp: string): void {
    this.pendingUris.add(fp);
    if (this.debounceTimer) return; // already scheduled
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      for (const pendingFp of this.pendingUris) {
        const beforeUri = vscode.Uri.parse(
          `workermill-before://${this.taskId}/${pendingFp}`,
        );
        const afterUri = vscode.Uri.parse(
          `workermill-after://${this.taskId}/${pendingFp}`,
        );
        LiveDiffManager.beforeProvider.fireChange(beforeUri);
        LiveDiffManager.afterProvider.fireChange(afterUri);
      }
      this.pendingUris.clear();
    }, 500);
  }

  private async openDiff(fp: string): Promise<void> {
    this.currentFile = fp;

    const beforeUri = vscode.Uri.parse(
      `workermill-before://${this.taskId}/${fp}`,
    );
    const afterUri = vscode.Uri.parse(
      `workermill-after://${this.taskId}/${fp}`,
    );

    const fileName = fp.split("/").pop() || fp;
    const state = this.files.get(fp);
    const expert = state?.expert ? ` (${state.expert})` : "";
    const title = `${fileName}${expert} — Live Diff`;

    await vscode.commands.executeCommand(
      "vscode.diff",
      beforeUri,
      afterUri,
      title,
      { preview: true, preserveFocus: true } as vscode.TextDocumentShowOptions,
    );
  }

  async showFilePicker(): Promise<void> {
    if (this.files.size === 0) {
      vscode.window.showInformationMessage("No code changes yet.");
      return;
    }

    const items = this.fileOrder.map((fp) => {
      const state = this.files.get(fp)!;
      const fileName = fp.split("/").pop() || fp;
      const dir = fp.includes("/")
        ? fp.substring(0, fp.lastIndexOf("/"))
        : "";
      return {
        label: fileName,
        description: dir,
        detail: state.expert
          ? `${state.expert} — ${this.ago(state.timestamp)}`
          : this.ago(state.timestamp),
        fp,
      };
    });

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `${this.files.size} file${this.files.size === 1 ? "" : "s"} changed`,
      title: "Live Code Changes",
    });

    if (picked) {
      this.openDiff(picked.fp);
    }
  }

  private ago(iso: string): string {
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 5) return "just now";
    if (d < 60) return `${Math.floor(d)}s ago`;
    if (d < 3600) return `${Math.floor(d / 60)}m ago`;
    return new Date(iso).toLocaleTimeString();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.statusBarItem.dispose();
    fileStates.delete(this.taskId);
    LiveDiffManager.instances.delete(this.taskId);
  }
}
```

**Step 2: Verify the file compiles**

Run: `cd packages/vscode-workermill && npx tsc --noEmit src/live-diff-manager.ts`
Expected: No errors (or only errors from unresolved imports that extension.ts will fix)

**Step 3: Commit**

```bash
git add packages/vscode-workermill/src/live-diff-manager.ts
git commit -m "feat(vscode): add LiveDiffManager with native diff content providers"
```

---

### Task 2: Wire LiveDiffManager into extension.ts

**Files:**
- Modify: `packages/vscode-workermill/src/extension.ts`

**Step 1: Replace imports — swap LiveDiffPanel → LiveDiffManager**

In `extension.ts`, change:
```typescript
import { LiveDiffPanel } from "./live-diff-panel";
```
to:
```typescript
import { LiveDiffManager } from "./live-diff-manager";
```

**Step 2: Register content providers at activation**

Add this right after `const logManager = new LogTerminalManager(client);` (line 124):
```typescript
  // Live diff content providers (native VS Code diff)
  LiveDiffManager.register(context);
```

**Step 3: Update the openLiveDiff command**

Change the command handler (around line 597-604) from:
```typescript
    vscode.commands.registerCommand(
      "workermill.openLiveDiff",
      (treeItem?: { task?: { id: string; summary: string; status: string } }) => {
        const task = treeItem?.task;
        if (!task?.id || !client.isConnected()) return;
        LiveDiffPanel.createOrShow(client, task as any);
      },
    ),
```
to:
```typescript
    vscode.commands.registerCommand(
      "workermill.openLiveDiff",
      (treeItem?: { task?: { id: string; summary: string; status: string } }) => {
        const task = treeItem?.task;
        if (!task?.id || !client.isConnected()) return;
        LiveDiffManager.createOrShow(client, task);
      },
    ),
```

**Step 4: Add the file picker command**

Add after the openLiveDiff command registration, inside the `context.subscriptions.push(...)` block:
```typescript
    vscode.commands.registerCommand("workermill.liveDiffPickFile", () => {
      // Delegate to whichever LiveDiffManager instance is active
      // (the status bar item's command triggers this)
    }),
```

Note: The status bar `command` is already set to `workermill.liveDiffPickFile` in LiveDiffManager. The command just needs to exist — the status bar triggers `showFilePicker()` on the manager that owns it. However since the command is global and we may have multiple managers, we should pick the most recent one. Actually, the simpler approach: LiveDiffManager.showFilePicker is called from the status bar which is per-instance. But VS Code commands are global. So we need a static method:

Replace the command with:
```typescript
    vscode.commands.registerCommand("workermill.liveDiffPickFile", async () => {
      // Find the most recently active LiveDiffManager and show its picker
      // LiveDiffManager handles this internally
    }),
```

Actually, the simplest approach: since the status bar item is per-manager, each manager sets `this.statusBarItem.command = "workermill.liveDiffPickFile"` but that's a global command. To route it correctly, add a static `showActiveFilePicker()` method to LiveDiffManager and call it from the command. Add this to `live-diff-manager.ts`:

```typescript
  /** Called by the global command — finds the most recent manager and shows its picker */
  static async showActiveFilePicker(): Promise<void> {
    // Pick the manager with the most files (or most recent activity)
    let best: LiveDiffManager | null = null;
    for (const inst of LiveDiffManager.instances.values()) {
      if (!best || inst.files.size > best.files.size) {
        best = inst;
      }
    }
    if (best) {
      await best.showFilePicker();
    } else {
      vscode.window.showInformationMessage("No live diff sessions active.");
    }
  }
```

Then the command in extension.ts:
```typescript
    vscode.commands.registerCommand("workermill.liveDiffPickFile", () => {
      LiveDiffManager.showActiveFilePicker();
    }),
```

**Step 5: Update deactivate()**

Change:
```typescript
  LiveDiffPanel.disposeAll();
```
to:
```typescript
  LiveDiffManager.disposeAll();
```

**Step 6: Add the new command to package.json**

In `packages/vscode-workermill/package.json`, add to the `commands` array:
```json
{
  "command": "workermill.liveDiffPickFile",
  "title": "WorkerMill: Browse Live Code Changes",
  "icon": "$(list-flat)"
}
```

**Step 7: Type-check the extension**

Run: `cd packages/vscode-workermill && npx tsc --noEmit`
Expected: No errors

**Step 8: Commit**

```bash
git add packages/vscode-workermill/src/extension.ts packages/vscode-workermill/src/live-diff-manager.ts packages/vscode-workermill/package.json
git commit -m "feat(vscode): wire LiveDiffManager into extension, add file picker command"
```

---

### Task 3: Delete Old LiveDiffPanel

**Files:**
- Delete: `packages/vscode-workermill/src/live-diff-panel.ts`

**Step 1: Delete the old file**

```bash
rm packages/vscode-workermill/src/live-diff-panel.ts
```

**Step 2: Verify no remaining references**

Run: `grep -r "live-diff-panel\|LiveDiffPanel" packages/vscode-workermill/src/`
Expected: No output (all references already updated in Task 2)

**Step 3: Type-check**

Run: `cd packages/vscode-workermill && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add -u packages/vscode-workermill/src/live-diff-panel.ts
git commit -m "refactor(vscode): remove old webview-based LiveDiffPanel"
```

---

### Task 4: Handle Write Events (Full File Content)

The current `CodeEventRecord` stores Write content in the `message` field but the metadata doesn't include the file content directly. Check how Write events arrive and ensure we extract content correctly.

**Files:**
- Modify: `packages/vscode-workermill/src/live-diff-manager.ts`

**Step 1: Verify Write event shape**

Look at how the worker posts Write events (`worker/epic/executor.ts:1436-1440`):
```typescript
this.postCodeEvent("Write", input.file_path, expert, {
  content: input.content,
});
```

And how the API stores it (`api/src/routes/control-center/code-events.ts`):
- `content` goes into the `message` field of `WorkerTaskLog`
- `toolName` goes into `metadata.toolName`

So for Write events: `ev.message` = file content, `ev.metadata.toolName` = "Write".

**Step 2: Update processEvents to handle Write correctly**

In `live-diff-manager.ts`, the Write handling currently uses `ev.message`. Verify this is correct by checking the `CodeEventRecord` type:
```typescript
export interface CodeEventRecord {
  id: string;
  filePath: string | null;
  message: string;        // ← This holds the content for Write events
  metadata: {
    toolName: "Write" | "Edit";
    expert: string | null;
    oldStr: string | null;
    newStr: string | null;
    isWrite?: boolean;
  } | null;
  createdAt: string;
}
```

The code in Task 1 already uses `ev.message` for Write content. This is correct.

**Step 3: Type-check**

Run: `cd packages/vscode-workermill && npx tsc --noEmit`
Expected: No errors

No commit needed — this is verification only. If changes were needed, commit them.

---

### Task 5: Build, Package, and Test

**Files:**
- No code changes

**Step 1: Build the extension**

Run: `cd packages/vscode-workermill && npm run build`
Expected: Successful build with no errors

**Step 2: Package the VSIX**

Bump version in `packages/vscode-workermill/package.json` (increment patch version), then:
Run: `cd packages/vscode-workermill && npx @vscode/vsce package --no-dependencies`
Expected: Produces a `.vsix` file

**Step 3: Manual test plan**

To test locally:
1. Install the VSIX: `code --install-extension workermill-*.vsix`
2. Reload VS Code
3. Start a WorkerMill task (any running task)
4. Click the eye icon next to the task in the sidebar tree
5. Verify: A native VS Code diff editor opens (not a webview)
6. Verify: Syntax highlighting works (colors match the file extension)
7. Verify: Status bar shows "Live: N files" and updates as events arrive
8. Verify: Clicking the status bar item shows a quick-pick with changed files
9. Verify: Diff auto-switches when worker edits a different file
10. Wait for Write event: verify all-green diff (empty before, full content after)
11. Wait for Edit event: verify red/green inline diff for old/new strings

**Step 4: Commit version bump and tag**

```bash
git add packages/vscode-workermill/package.json
git commit -m "chore(vscode): bump version for native live diff release"
git tag vscode-v<NEW_VERSION>
git push origin vscode-v<NEW_VERSION>
```
