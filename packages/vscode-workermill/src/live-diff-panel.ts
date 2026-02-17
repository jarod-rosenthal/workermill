/**
 * LiveDiffPanel — Live diff editor view.
 * Shows the most recent code change per file like a VS Code diff —
 * actual code lines with red (removed) / green (added) highlights.
 * File tabs at top, one file at a time, updates in place.
 */

import * as vscode from "vscode";
import type { AgentClient, CodeEventRecord, TaskInfo } from "./agent-client";

export class LiveDiffPanel {
  static readonly viewType = "workermill.liveDiff";
  private static currentPanels = new Map<string, LiveDiffPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly client: AgentClient;
  private readonly taskId: string;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastTimestamp: string | null = null;
  private disposed = false;

  static createOrShow(client: AgentClient, task: TaskInfo): void {
    const existing = LiveDiffPanel.currentPanels.get(task.id);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    const title =
      task.summary.length > 40
        ? `Live: ${task.summary.substring(0, 40)}...`
        : `Live: ${task.summary}`;
    const panel = vscode.window.createWebviewPanel(
      LiveDiffPanel.viewType,
      title,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true },
    );
    panel.iconPath = new vscode.ThemeIcon("eye");
    new LiveDiffPanel(panel, client, task.id);
  }

  static disposeAll(): void {
    for (const p of LiveDiffPanel.currentPanels.values()) p.dispose();
  }

  private constructor(panel: vscode.WebviewPanel, client: AgentClient, taskId: string) {
    this.panel = panel;
    this.client = client;
    this.taskId = taskId;
    LiveDiffPanel.currentPanels.set(taskId, this);
    this.panel.onDidDispose(() => this.dispose());
    this.panel.webview.html = this.getHtml();
    setTimeout(() => {
      if (!this.disposed) {
        this.poll();
        this.pollTimer = setInterval(() => this.poll(), 2000);
      }
    }, 1000);
  }

  private async poll(): Promise<void> {
    if (this.disposed) return;
    try {
      const events = await this.client.getCodeEvents(this.taskId, this.lastTimestamp || undefined);
      if (events.length > 0) {
        this.lastTimestamp = events[events.length - 1].createdAt;
        this.panel.webview.postMessage({ type: "append", events });
      }
    } catch (_) { /* retry */ }
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    LiveDiffPanel.currentPanels.delete(this.taskId);
    this.panel.dispose();
  }

  private getHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
    font-size: 13px;
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
    height: 100vh; display: flex; flex-direction: column; overflow: hidden;
  }

  /* Tab bar */
  .tabs {
    display: flex; overflow-x: auto;
    background: var(--vscode-editorGroupHeader-tabsBackground, ***REMOVED***252526);
    border-bottom: 1px solid var(--vscode-panel-border);
    flex-shrink: 0;
  }
  .tab {
    padding: 6px 14px; font-size: 12px;
    cursor: pointer; white-space: nowrap;
    border-right: 1px solid var(--vscode-panel-border);
    border-bottom: 2px solid transparent;
    color: var(--vscode-tab-inactiveForeground, ***REMOVED***888);
    background: transparent;
    display: flex; align-items: center; gap: 6px;
  }
  .tab:hover { color: var(--vscode-editor-foreground); }
  .tab.active {
    color: var(--vscode-tab-activeForeground, var(--vscode-editor-foreground));
    border-bottom-color: var(--vscode-tab-activeBorderTop, ***REMOVED***3fb950);
    background: var(--vscode-editor-background);
  }
  .tab .dot {
    width: 6px; height: 6px; border-radius: 50%; background: ***REMOVED***3fb950;
    flex-shrink: 0;
  }

  /* File header */
  .file-hdr {
    padding: 6px 16px; font-size: 11px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-sideBar-background, rgba(0,0,0,0.15));
    border-bottom: 1px solid var(--vscode-panel-border);
    display: flex; align-items: center; gap: 8px;
    flex-shrink: 0;
  }
  .file-hdr .path { flex: 1; opacity: 0.6; overflow: hidden; text-overflow: ellipsis; }
  .file-hdr .who { color: ***REMOVED***3fb950; }

  /* Editor area */
  .editor {
    flex: 1; overflow: auto;
    counter-reset: line;
  }

  .empty {
    display: flex; align-items: center; justify-content: center;
    height: 100%; color: var(--vscode-descriptionForeground);
    font-size: 13px; opacity: 0.5;
  }

  /* Code lines — looks like a real editor */
  .line {
    display: flex; min-height: 20px; line-height: 20px;
    font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
    font-size: 13px;
    transition: background 0.3s;
  }
  .line .gutter {
    width: 50px; min-width: 50px; text-align: right;
    padding-right: 12px;
    color: var(--vscode-editorLineNumber-foreground, rgba(255,255,255,0.2));
    user-select: none; font-size: 12px;
    background: inherit;
  }
  .line .sign {
    width: 16px; min-width: 16px; text-align: center;
    font-weight: 700; user-select: none;
  }
  .line .code {
    flex: 1; white-space: pre; padding-right: 16px;
    overflow-x: visible;
  }

  /* Diff colors */
  .line.del {
    background: var(--vscode-diffEditor-removedTextBackground, rgba(248,81,73,0.2));
  }
  .line.del .sign { color: ***REMOVED***f85149; }
  .line.del .gutter { background: rgba(248,81,73,0.08); }

  .line.add {
    background: var(--vscode-diffEditor-insertedTextBackground, rgba(63,185,80,0.2));
  }
  .line.add .sign { color: ***REMOVED***3fb950; }
  .line.add .gutter { background: rgba(63,185,80,0.08); }

  .line.ctx { opacity: 0.55; }

  /* Separator between hunks */
  .hunk-sep {
    height: 24px; display: flex; align-items: center;
    padding-left: 50px;
    background: var(--vscode-sideBar-background, rgba(0,0,0,0.1));
    border-top: 1px solid var(--vscode-panel-border);
    border-bottom: 1px solid var(--vscode-panel-border);
    font-size: 10px; color: var(--vscode-descriptionForeground); opacity: 0.5;
  }

  /* New edit flash */
  .flash .line.add { animation: flashGreen 1.5s ease-out; }
  .flash .line.del { animation: flashRed 1.5s ease-out; }
  @keyframes flashGreen {
    0% { background: rgba(63,185,80,0.45); }
    100% { background: var(--vscode-diffEditor-insertedTextBackground, rgba(63,185,80,0.2)); }
  }
  @keyframes flashRed {
    0% { background: rgba(248,81,73,0.45); }
    100% { background: var(--vscode-diffEditor-removedTextBackground, rgba(248,81,73,0.2)); }
  }

  .write-msg {
    padding: 20px; text-align: center;
    color: ***REMOVED***3fb950; font-size: 13px;
  }
</style>
</head>
<body>
  <div class="tabs" id="tabs"></div>
  <div class="file-hdr" id="fileHdr" style="display:none">
    <span class="path" id="filePath"></span>
    <span class="who" id="fileWho"></span>
    <span id="fileTime"></span>
  </div>
  <div class="editor" id="editor">
    <div class="empty">Watching for code changes...</div>
  </div>

  <script>
    var tabsEl = document.getElementById("tabs");
    var fileHdr = document.getElementById("fileHdr");
    var filePath = document.getElementById("filePath");
    var fileWho = document.getElementById("fileWho");
    var fileTime = document.getElementById("fileTime");
    var editor = document.getElementById("editor");

    // State per file: keep only the LATEST edit (this is a live view, not history)
    var files = {};
    var fileOrder = [];
    var selected = null;
    var displayedEventId = null; // track what's currently shown to avoid re-rendering

    window.addEventListener("message", function(e) {
      var msg = e.data;
      if (msg.type !== "append" || !msg.events) return;

      for (var i = 0; i < msg.events.length; i++) {
        var ev = msg.events[i];
        var fp = shortPath(ev.filePath || "(unknown)");

        if (!files[fp]) {
          files[fp] = { fullPath: ev.filePath, latest: ev };
          fileOrder.push(fp);
        }
        files[fp].latest = ev;
      }

      // Sort tabs: most recently changed first
      fileOrder.sort(function(a, b) {
        return new Date(files[b].latest.createdAt).getTime() -
               new Date(files[a].latest.createdAt).getTime();
      });

      // Follow the action — switch to whatever was just edited
      var newest = fileOrder[0];
      if (newest) selected = newest;

      rebuildTabs();

      // Only re-render if the displayed content actually changed
      if (selected && files[selected].latest.id !== displayedEventId) {
        var isNew = displayedEventId !== null; // don't flash on first load
        displayedEventId = files[selected].latest.id;
        showFile(selected, isNew);
      }
    });

    function rebuildTabs() {
      tabsEl.innerHTML = "";
      var activeTab = null;
      for (var i = 0; i < fileOrder.length; i++) {
        var fp = fileOrder[i];
        var tab = document.createElement("div");
        tab.className = "tab" + (fp === selected ? " active" : "");

        var name = fp.split("/").pop() || fp;
        tab.textContent = name;
        tab.title = fp;

        if (fp === selected) activeTab = tab;

        (function(path) {
          tab.addEventListener("click", function() {
            selected = path;
            displayedEventId = files[path].latest.id;
            rebuildTabs();
            showFile(path, false);
          });
        })(fp);

        tabsEl.appendChild(tab);
      }
      // Scroll active tab into view
      if (activeTab) activeTab.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    function showFile(fp, isNew) {
      var f = files[fp];
      if (!f) return;
      f.hasNew = false;

      var ev = f.latest;
      var meta = ev.metadata;
      var isEdit = meta && meta.toolName === "Edit" && meta.oldStr;

      // Update header
      fileHdr.style.display = "flex";
      filePath.textContent = f.fullPath || fp;
      fileWho.textContent = (meta && meta.expert) ? meta.expert : "";
      fileTime.textContent = ago(ev.createdAt);

      if (isEdit) {
        var oldLines = splitStr(meta.oldStr || "");
        var newLines = splitStr(meta.newStr || "");

        var html = '<div class="' + (isNew ? 'flash' : '') + '">';

        // Removed lines
        for (var j = 0; j < oldLines.length; j++) {
          html += '<div class="line del">' +
            '<span class="gutter"></span>' +
            '<span class="sign">-</span>' +
            '<span class="code">' + esc(oldLines[j]) + '</span></div>';
        }

        // Separator
        if (oldLines.length > 0 && newLines.length > 0) {
          html += '<div class="hunk-sep">~~~</div>';
        }

        // Added lines
        for (var k = 0; k < newLines.length; k++) {
          html += '<div class="line add">' +
            '<span class="gutter"></span>' +
            '<span class="sign">+</span>' +
            '<span class="code">' + esc(newLines[k]) + '</span></div>';
        }

        html += '</div>';
        editor.innerHTML = html;
      } else {
        editor.innerHTML = '<div class="write-msg">New file created' +
          ((meta && meta.expert) ? ' by <b>' + esc(meta.expert) + '</b>' : '') +
          '</div>';
      }
    }

    function shortPath(fp) {
      var m = fp.match(/worktrees\\/[^\\/]+\\/(.+)/);
      if (m) return m[1];
      var parts = fp.split("/");
      if (parts.length > 3) return parts.slice(-3).join("/");
      return fp;
    }

    function esc(s) {
      if (!s) return "";
      return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function ago(iso) {
      var d = (Date.now() - new Date(iso).getTime()) / 1000;
      if (d < 5) return "just now";
      if (d < 60) return Math.floor(d) + "s ago";
      if (d < 3600) return Math.floor(d / 60) + "m ago";
      return new Date(iso).toLocaleTimeString();
    }

    function splitStr(s) {
      if (!s) return [];
      var r = s.replace(/\\\\n/g, "\\n");
      return r.split("\\n");
    }
  </script>
</body>
</html>`;
  }
}
