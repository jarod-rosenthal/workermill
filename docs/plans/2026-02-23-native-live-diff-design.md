# Native Live Diff Viewer — Design

**Date**: 2026-02-23
**Status**: Approved
**Replaces**: `LiveDiffPanel` (webview-based custom HTML diff)

## Problem

The current live code view (`LiveDiffPanel`) is a webview with custom HTML rendering. It has no syntax highlighting, no line numbers, no keyboard navigation, 5-second polling, and looks nothing like VS Code's native diff. It needs to be replaced with something that uses VS Code's built-in diff editor.

## Solution

Use `TextDocumentContentProvider` with two URI schemes (`workermill-before:`, `workermill-after:`) to provide virtual before/after content for each file. Open diffs with `vscode.diff` command. Fire `onDidChange` events on the content providers when new code events arrive to refresh the diff in real-time.

## Architecture

```
Worker → Cloud API → Agent Local API → VS Code Extension
                                            │
                                    LiveDiffManager
                                    ├── polls code events (2s interval)
                                    ├── maintains per-file before/after state
                                    ├── fires onDidChange on content providers
                                    └── opens/updates vscode.diff editors
                                            │
                              ┌──────────────┼──────────────┐
                    BeforeContentProvider  AfterContentProvider
                    (workermill-before:)   (workermill-after:)
                              │                     │
                              └────── vscode.diff ──┘
```

## Components

### LiveDiffManager

Replaces `LiveDiffPanel`. One instance per task (singleton map by taskId).

- Stores per-task state: `Map<filePath, { before: string, after: string, expert: string, timestamp: string }>`
- Polls `getCodeEvents()` every 2 seconds
- On new events: updates before/after state, fires content provider `onDidChange`, auto-follows latest file
- Opens diff via `vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, title)`
- Auto-closes previous diff when switching to new file (single diff open at a time)
- Status bar item: "Live: N files changed" — click opens quick-pick for file navigation

### Content Providers

Two `TextDocumentContentProvider` instances registered globally at extension activation.

- URI format: `workermill-before://taskId/full/file/path.ts` (extension preserved for syntax highlighting)
- `provideTextDocumentContent(uri)` looks up stored before/after content from LiveDiffManager
- `onDidChange` EventEmitter fired when content updates → VS Code re-reads the document

### Event Processing

- **Edit event**: `before` = `oldStr`, `after` = `newStr`. For cumulative edits to same file: `before` = state before FIRST edit, `after` = state after LATEST edit.
- **Write event**: `before` = `""` (empty string), `after` = full file content. Diff shows all lines as green additions (same as git new file).
- Debounce `onDidChange` firing to 500ms to avoid thrashing on rapid edits.

### Auto-Follow Behavior

- New code event for different file → auto-switch diff to that file
- Previous diff tab closes
- User can re-open any file via quick-pick (status bar click or command palette)
- Selecting from quick-pick pins that file until next new-file event

### File Navigation

- Status bar item: `$(eye) Live: 5 files` with click → quick-pick
- Quick-pick items sorted by most recently changed, show expert name and timestamp
- Command: `workermill.liveDiffPickFile`

## Files Changed

| File | Action |
|------|--------|
| `packages/vscode-workermill/src/live-diff-panel.ts` | Delete |
| `packages/vscode-workermill/src/live-diff-manager.ts` | Create |
| `packages/vscode-workermill/src/extension.ts` | Edit — register providers, swap LiveDiffPanel → LiveDiffManager |

## Edge Cases

- **Large files (>100KB)**: Already truncated at worker. No additional handling.
- **Binary files**: Ignored (filter by extension if needed).
- **Rapid edits**: Debounce onDidChange to 500ms.
- **Task completes**: Stop polling, keep last diff open.
- **Agent disconnected**: Pause polling with exponential backoff.
- **Multiple tasks**: Each task gets its own LiveDiffManager instance, own diff editor.

## Data Flow (unchanged)

Worker `postCodeEvent()` → `POST /api/control-center/code-events` → stored in `WorkerTaskLog` → `GET /api/control-center/code-events/:taskId?since=` → agent proxy → VS Code polls.

No changes needed to the worker, cloud API, or agent local API.
