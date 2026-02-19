/**
 * Mission Control Panel — the "watch your team work" WebView.
 *
 * A rich panel showing:
 * - Story progress bar with expert assignments
 * - Live terminal output with syntax highlighting
 * - Coordination feed (expert collaboration chat)
 * - Live code view (files being modified)
 * - Talk input + blocker response controls
 */

import * as vscode from "vscode";
import { AgentClient, type TaskInfo, type LogLine } from "./agent-client";

export class MissionControlPanel {
  public static currentPanel: MissionControlPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly client: AgentClient;
  private taskId: string;
  private logUnsub: (() => void) | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private disposed = false;
  private lastLogTimestamp: string | null = null;
  private seenLogIds = new Set<string>();

  private constructor(panel: vscode.WebviewPanel, client: AgentClient, task: TaskInfo) {
    this.panel = panel;
    this.client = client;
    this.taskId = task.id;

    this.panel.webview.html = getWebviewContent(task);

    // Handle messages from the WebView
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "talk") {
        try {
          await this.client.talkToWorker(this.taskId, msg.message);
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to send message: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else if (msg.type === "blocker-response") {
        try {
          await this.client.respondToBlocker(this.taskId, msg.blockerId, msg.action, msg.guidance);
        } catch (err) {
          vscode.window.showErrorMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });

    // Subscribe to live logs
    this.logUnsub = this.client.subscribeToLogs(this.taskId, (log: LogLine) => {
      if (!this.disposed) {
        this.panel.webview.postMessage({ type: "log", line: log.line, severity: log.severity });
      }
    });

    // Poll for coordination feed + task detail every 3 seconds
    this.pollTimer = setInterval(() => this.pollUpdates(), 3000);
    this.pollUpdates(); // Initial fetch

    this.panel.onDidDispose(() => this.dispose());
  }

  static show(client: AgentClient, task: TaskInfo, extensionUri: vscode.Uri): void {
    const column = vscode.ViewColumn.Beside;

    if (MissionControlPanel.currentPanel) {
      // Reuse existing panel, update content
      MissionControlPanel.currentPanel.dispose();
    }

    const panel = vscode.window.createWebviewPanel(
      "workermill.missionControl",
      `WM: ${task.summary.substring(0, 30)}`,
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    MissionControlPanel.currentPanel = new MissionControlPanel(panel, client, task);
  }

  private async pollUpdates(): Promise<void> {
    if (this.disposed) return;

    try {
      // Fetch cloud-stored logs (works for all phases: planning + execution)
      const logs = await this.client.getCloudLogs(this.taskId, this.lastLogTimestamp || undefined) as Array<{
        id: string; message: string; severity?: string; createdAt: string;
        type?: string; command?: string; stdout?: string; stderr?: string;
      }>;
      if (Array.isArray(logs)) {
        for (const log of logs) {
          if (this.seenLogIds.has(log.id)) continue;
          this.seenLogIds.add(log.id);
          // Send the main message line
          if (log.message) {
            this.panel.webview.postMessage({
              type: "log",
              line: log.message,
              severity: log.severity || "info",
            });
          }
          // Also send stdout/stderr if present (command execution logs)
          if (log.stdout) {
            this.panel.webview.postMessage({ type: "log", line: log.stdout, severity: "info" });
          }
          if (log.stderr) {
            this.panel.webview.postMessage({ type: "log", line: log.stderr, severity: "error" });
          }
          this.lastLogTimestamp = log.createdAt;
        }
      }
    } catch { /* ignore — cloud may not be reachable */ }

    try {
      // Fetch coordination feed
      const coordData = await this.client.getCoordinationFeed(this.taskId);
      this.panel.webview.postMessage({ type: "coordination", data: coordData });
    } catch { /* ignore — cloud may not be reachable */ }

    try {
      // Fetch rich task detail (story progress, etc.)
      const detail = await this.client.getTaskDetail(this.taskId);
      this.panel.webview.postMessage({ type: "taskDetail", data: detail });
    } catch { /* ignore */ }
  }

  dispose(): void {
    this.disposed = true;
    if (this.logUnsub) this.logUnsub();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.panel.dispose();
    MissionControlPanel.currentPanel = undefined;
  }
}

// ── WebView HTML ──

function getWebviewContent(task: TaskInfo): string {
  return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mission Control</title>
<style>
  :root {
    --bg: ***REMOVED***1e1e1e;
    --bg-secondary: ***REMOVED***252526;
    --bg-tertiary: ***REMOVED***2d2d2d;
    --border: ***REMOVED***3e3e42;
    --text: ***REMOVED***cccccc;
    --text-dim: ***REMOVED***808080;
    --text-bright: ***REMOVED***ffffff;
    --accent: ***REMOVED***0098ff;
    --green: ***REMOVED***4ec9b0;
    --yellow: ***REMOVED***dcdcaa;
    --red: ***REMOVED***f44747;
    --orange: ***REMOVED***ce9178;
    --purple: ***REMOVED***c586c0;
    --cyan: ***REMOVED***9cdcfe;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Header ── */
  .header {
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    padding: 10px 16px;
    flex-shrink: 0;
  }
  .header h1 {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-bright);
    margin-bottom: 4px;
  }
  .header .meta {
    display: flex;
    gap: 12px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .header .meta .badge {
    background: var(--bg-tertiary);
    padding: 2px 8px;
    border-radius: 3px;
    color: var(--cyan);
  }

  /* ── Story Progress ── */
  .story-bar {
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    padding: 8px 16px;
    flex-shrink: 0;
    display: none;
  }
  .story-bar.visible { display: block; }
  .story-bar .label {
    font-size: 11px;
    color: var(--text-dim);
    margin-bottom: 6px;
  }
  .progress-track {
    height: 6px;
    background: var(--bg-tertiary);
    border-radius: 3px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--green);
    border-radius: 3px;
    transition: width 0.5s ease;
    width: 0%;
  }
  .story-chips {
    display: flex;
    gap: 4px;
    margin-top: 6px;
    flex-wrap: wrap;
  }
  .story-chip {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
  }
  .story-chip.completed { border-color: var(--green); color: var(--green); }
  .story-chip.running { border-color: var(--accent); color: var(--accent); }
  .story-chip.failed { border-color: var(--red); color: var(--red); }

  /* ── Main Content (split panels) ── */
  .main {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  /* ── Left Panel: Terminal + Code ── */
  .left-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border);
    min-width: 0;
  }

  .tab-bar {
    display: flex;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .tab {
    padding: 6px 14px;
    font-size: 11px;
    color: var(--text-dim);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    user-select: none;
  }
  .tab:hover { color: var(--text); }
  .tab.active {
    color: var(--text-bright);
    border-bottom-color: var(--accent);
  }

  .tab-content {
    flex: 1;
    overflow: hidden;
    display: none;
  }
  .tab-content.active { display: flex; flex-direction: column; }

  /* Terminal */
  .terminal {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
    font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .terminal .log-line { }
  .terminal .log-error { color: var(--red); }
  .terminal .log-warning { color: var(--yellow); }
  .terminal .log-success { color: var(--green); }
  .terminal .log-git { color: var(--cyan); }
  .terminal .log-marker { color: var(--purple); font-weight: bold; }

  /* Code View */
  .code-view {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
  }
  .code-file {
    margin-bottom: 12px;
  }
  .code-file-name {
    font-size: 11px;
    font-family: monospace;
    color: var(--cyan);
    padding: 4px 8px;
    background: var(--bg-tertiary);
    border-radius: 3px 3px 0 0;
    border: 1px solid var(--border);
    border-bottom: none;
  }
  .code-file-status {
    font-size: 10px;
    color: var(--green);
    float: right;
  }
  .no-files {
    color: var(--text-dim);
    font-style: italic;
    padding: 20px;
    text-align: center;
  }

  /* ── Right Panel: Coordination Feed ── */
  .right-panel {
    width: 320px;
    min-width: 280px;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }
  .feed-header {
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-bright);
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .feed {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }
  .feed-item {
    margin-bottom: 8px;
    padding: 8px 10px;
    background: var(--bg-secondary);
    border-radius: 6px;
    border-left: 3px solid var(--border);
  }
  .feed-item.question { border-left-color: var(--yellow); }
  .feed-item.answer { border-left-color: var(--green); }
  .feed-item.decision { border-left-color: var(--accent); }
  .feed-item.blocker, .feed-item.blocker_detected { border-left-color: var(--red); }
  .feed-item.blocker_resolved { border-left-color: var(--green); }
  .feed-item.completion { border-left-color: var(--green); }
  .feed-item.file_modified, .feed-item.file_created { border-left-color: var(--cyan); }
  .feed-item.user_message { border-left-color: var(--purple); }
  .feed-item.progress { border-left-color: var(--accent); }
  .feed-item.warning { border-left-color: var(--orange); }
  .feed-item.revision_requested { border-left-color: var(--orange); }

  .feed-persona {
    font-size: 11px;
    font-weight: 600;
    color: var(--cyan);
    margin-bottom: 3px;
  }
  .feed-persona .type-badge {
    font-weight: 400;
    font-size: 10px;
    color: var(--text-dim);
    margin-left: 6px;
  }
  .feed-content {
    font-size: 12px;
    line-height: 1.4;
    color: var(--text);
  }
  .feed-time {
    font-size: 10px;
    color: var(--text-dim);
    margin-top: 4px;
  }

  /* ── Talk Input ── */
  .talk-bar {
    background: var(--bg-secondary);
    border-top: 1px solid var(--border);
    padding: 8px;
    flex-shrink: 0;
    display: flex;
    gap: 6px;
  }
  .talk-input {
    flex: 1;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    padding: 6px 10px;
    font-size: 12px;
    font-family: inherit;
    outline: none;
  }
  .talk-input:focus { border-color: var(--accent); }
  .talk-input::placeholder { color: var(--text-dim); }
  .talk-btn {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .talk-btn:hover { opacity: 0.9; }

  /* ── Blocker Alert ── */
  .blocker-alert {
    background: ***REMOVED***3a1a1a;
    border: 1px solid var(--red);
    border-radius: 6px;
    padding: 10px 12px;
    margin: 8px;
    display: none;
  }
  .blocker-alert.visible { display: block; }
  .blocker-alert h3 {
    font-size: 12px;
    color: var(--red);
    margin-bottom: 6px;
  }
  .blocker-alert p {
    font-size: 12px;
    color: var(--text);
    margin-bottom: 8px;
  }
  .blocker-actions {
    display: flex;
    gap: 6px;
  }
  .blocker-actions button {
    padding: 4px 10px;
    border-radius: 3px;
    border: none;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
  }
  .btn-retry { background: var(--accent); color: white; }
  .btn-skip { background: var(--yellow); color: ***REMOVED***1e1e1e; }
  .btn-abort { background: var(--red); color: white; }

  /* scrollbar */
  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: ***REMOVED***555; }
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <h1>${escapeHtml(task.summary)}</h1>
  <div class="meta">
    <span class="badge">${escapeHtml(task.persona || "worker")}</span>
    <span class="badge">${escapeHtml(task.model || "default")}</span>
    <span class="badge">${escapeHtml(task.repo || "")}</span>
    <span id="statusBadge" class="badge" style="color: var(--green);">${task.status}</span>
  </div>
</div>

<!-- Story Progress -->
<div class="story-bar" id="storyBar">
  <div class="label">
    <span id="storyLabel">Stories: 0/0</span>
    <span id="epicProgress" style="float:right; color: var(--green);"></span>
  </div>
  <div class="progress-track">
    <div class="progress-fill" id="progressFill"></div>
  </div>
  <div class="story-chips" id="storyChips"></div>
</div>

<!-- Main Content -->
<div class="main">
  <!-- Left: Terminal + Code View -->
  <div class="left-panel">
    <div class="tab-bar">
      <div class="tab active" data-tab="terminal">Terminal</div>
      <div class="tab" data-tab="codeview">Live Code</div>
    </div>

    <div class="tab-content active" id="tab-terminal">
      <div class="terminal" id="terminal"></div>
    </div>

    <div class="tab-content" id="tab-codeview">
      <div class="code-view" id="codeView">
        <div class="no-files">Waiting for file changes...</div>
      </div>
    </div>
  </div>

  <!-- Right: Coordination Feed -->
  <div class="right-panel">
    <div class="feed-header">Expert Collaboration</div>

    <div class="blocker-alert" id="blockerAlert">
      <h3 id="blockerTitle">Blocker</h3>
      <p id="blockerContent"></p>
      <div class="blocker-actions">
        <button class="btn-retry" onclick="blockerAction('retry')">Retry</button>
        <button class="btn-skip" onclick="blockerAction('skip')">Skip</button>
        <button class="btn-abort" onclick="blockerAction('abort')">Abort</button>
      </div>
    </div>

    <div class="feed" id="feed"></div>

    <div class="talk-bar">
      <input class="talk-input" id="talkInput" type="text"
             placeholder="Talk to your team..." />
      <button class="talk-btn" onclick="sendMessage()">Send</button>
    </div>
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();
const terminal = document.getElementById('terminal');
const feed = document.getElementById('feed');
const codeView = document.getElementById('codeView');
const storyBar = document.getElementById('storyBar');
const talkInput = document.getElementById('talkInput');

// Track seen feed items to avoid duplicates
const seenFeedIds = new Set();
// Track modified files for code view
const modifiedFiles = new Map(); // filename → { persona, type, time }
let currentBlockerId = null;

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });
});

// Auto-scroll terminal
let autoScroll = true;
terminal.addEventListener('scroll', () => {
  const atBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 50;
  autoScroll = atBottom;
});

// Talk input
talkInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && talkInput.value.trim()) {
    sendMessage();
  }
});

function sendMessage() {
  const msg = talkInput.value.trim();
  if (!msg) return;
  vscode.postMessage({ type: 'talk', message: msg });
  talkInput.value = '';
  // Add to feed immediately
  addFeedItem({ persona: 'you', messageType: 'user_message', content: msg, createdAt: new Date().toISOString() });
}

function blockerAction(action) {
  if (!currentBlockerId) return;
  vscode.postMessage({ type: 'blocker-response', blockerId: currentBlockerId, action });
  document.getElementById('blockerAlert').classList.remove('visible');
  currentBlockerId = null;
}

// Classify log line for coloring
function classifyLog(line) {
  if (/error|Error|ERROR|✗|FAIL|panic|fatal/i.test(line)) return 'log-error';
  if (/warn|Warning|WARNING|⚠/.test(line)) return 'log-warning';
  if (/✓|success|PASS|completed|approved|merged/i.test(line)) return 'log-success';
  if (/^(Cloning|Fetching|git |From |To |branch |\\* )/i.test(line)) return 'log-git';
  if (/::result::|::pr_url::|::learning::|::blocker::/.test(line)) return 'log-marker';
  return 'log-line';
}

// Persona emoji map
const personaEmoji = {
  frontend_developer: '\\u{1F3A8}',
  backend_developer: '\\u{1F4BB}',
  devops_engineer: '\\u{1F527}',
  security_engineer: '\\u{1F512}',
  qa_engineer: '\\u{1F9EA}',
  tech_writer: '\\u{1F4DD}',
  project_manager: '\\u{1F4CB}',
  architect: '\\u{1F3D7}',
  data_ml_engineer: '\\u{1F4CA}',
  mobile_developer: '\\u{1F4F1}',
  planning_agent: '\\u{1F4A1}',
  tech_lead: '\\u{1F451}',
  manager: '\\u{1F454}',
  support_agent: '\\u{1F4AC}',
  coordinator: '\\u{1F3AF}',
  dashboard: '\\u{1F4CA}',
  you: '\\u{1F464}',
};

function getEmoji(persona) {
  return personaEmoji[persona] || '\\u{1F916}';
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return ''; }
}

function addFeedItem(item) {
  if (item.id && seenFeedIds.has(item.id)) return;
  if (item.id) seenFeedIds.add(item.id);

  const div = document.createElement('div');
  div.className = 'feed-item ' + (item.messageType || '');

  const typeLabel = (item.messageType || '').replace(/_/g, ' ');

  div.innerHTML =
    '<div class="feed-persona">' +
    getEmoji(item.persona) + ' ' + escapeHtml(item.persona || 'system') +
    '<span class="type-badge">' + typeLabel + '</span></div>' +
    '<div class="feed-content">' + escapeHtml(item.content || '') + '</div>' +
    '<div class="feed-time">' + formatTime(item.createdAt) + '</div>';

  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function updateCodeView() {
  if (modifiedFiles.size === 0) {
    codeView.innerHTML = '<div class="no-files">Waiting for file changes...</div>';
    return;
  }

  let html = '';
  for (const [filename, info] of modifiedFiles) {
    html +=
      '<div class="code-file">' +
      '<div class="code-file-name">' +
      escapeHtml(filename) +
      '<span class="code-file-status">' +
      getEmoji(info.persona) + ' ' + (info.type === 'file_created' ? 'created' : 'modified') +
      '</span></div></div>';
  }
  codeView.innerHTML = html;
}

// Handle messages from extension
window.addEventListener('message', (event) => {
  const msg = event.data;

  if (msg.type === 'log') {
    const cls = classifyLog(msg.line);
    const div = document.createElement('div');
    div.className = cls;
    div.textContent = msg.line;
    terminal.appendChild(div);
    if (autoScroll) terminal.scrollTop = terminal.scrollHeight;

    // Extract file modifications from log lines
    const fileMatch = msg.line.match(/(?:Modified|Created|Writing|Editing)\\s+([\\w/.-]+\\.\\w+)/i);
    if (fileMatch) {
      modifiedFiles.set(fileMatch[1], {
        persona: '${escapeHtml(task.persona || "worker")}',
        type: 'file_modified',
        time: new Date().toISOString()
      });
      updateCodeView();
    }
  }

  if (msg.type === 'coordination') {
    const data = msg.data;
    const items = data?.contexts || data || [];
    if (Array.isArray(items)) {
      for (const item of items) {
        addFeedItem(item);

        // Track file changes
        if (item.messageType === 'file_modified' || item.messageType === 'file_created') {
          const filename = item.content?.replace(/^(Modified|Created)\\s+/i, '') || item.content;
          if (filename) {
            modifiedFiles.set(filename, {
              persona: item.persona,
              type: item.messageType,
              time: item.createdAt
            });
            updateCodeView();
          }
        }

        // Show blocker alert
        if (item.messageType === 'blocker_detected' || item.messageType === 'blocker') {
          currentBlockerId = item.id;
          document.getElementById('blockerAlert').classList.add('visible');
          document.getElementById('blockerTitle').textContent =
            getEmoji(item.persona) + ' Blocker: ' + (item.persona || 'worker');
          document.getElementById('blockerContent').textContent = item.content || 'Worker is stuck and needs your help.';
        }

        // Hide blocker alert on resolution
        if (item.messageType === 'blocker_resolved') {
          document.getElementById('blockerAlert').classList.remove('visible');
          currentBlockerId = null;
        }
      }
    }
  }

  if (msg.type === 'taskDetail') {
    const d = msg.data;
    if (!d) return;

    // Update status
    document.getElementById('statusBadge').textContent = d.status || '';
    document.getElementById('statusBadge').style.color =
      d.status === 'executing' ? 'var(--green)' :
      d.status === 'failed' ? 'var(--red)' :
      d.status === 'pr_created' ? 'var(--purple)' :
      d.status === 'completed' || d.status === 'deployed' ? 'var(--green)' :
      'var(--cyan)';

    // Update story progress
    if (d.isEpicWorkflow && d.storiesTotal > 0) {
      storyBar.classList.add('visible');
      document.getElementById('storyLabel').textContent =
        'Stories: ' + d.storiesCompleted + '/' + d.storiesTotal +
        (d.storiesFailed > 0 ? ' (' + d.storiesFailed + ' failed)' : '');
      document.getElementById('epicProgress').textContent = d.epicProgress + '%';
      document.getElementById('progressFill').style.width = d.epicProgress + '%';
    }

    // Update cost if available
    if (d.estimatedCostUsd != null) {
      const costBadge = document.querySelector('.meta .badge:last-child');
      // Don't overwrite status badge — add a new one or update existing
    }
  }
});
</script>

</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&***REMOVED***039;");
}
