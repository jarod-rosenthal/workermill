/**
 * Feed View — sidebar WebviewView showing expert collaboration feed.
 *
 * Lives below the Team tree in the WorkerMill sidebar panel.
 * Shows: story progress, coordination feed, talk input, blocker alerts.
 * Switches context when the user selects a different task.
 */

import * as vscode from "vscode";
import { AgentClient, type TaskInfo, type IssueInfo } from "./agent-client";

export class FeedViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "workermill.feedPanel";

  private view: vscode.WebviewView | undefined;
  private client: AgentClient;
  private currentTaskId: string | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private seenFeedIds = new Set<string>();
  private consecutiveErrors = 0;
  private currentInterval = 5_000;

  constructor(client: AgentClient) {
    this.client = client;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getIdleHtml();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (!this.currentTaskId) return;
      if (msg.type === "talk") {
        try {
          await this.client.talkToWorker(this.currentTaskId, msg.message);
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to send: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else if (msg.type === "blocker-response") {
        try {
          await this.client.respondToBlocker(this.currentTaskId, msg.blockerId, msg.action, msg.guidance);
        } catch (err) {
          vscode.window.showErrorMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });

    webviewView.onDidDispose(() => {
      this.stopPolling();
      this.view = undefined;
    });
  }

  /** Switch the feed to show a different task */
  showTask(task: TaskInfo): void {
    if (!this.view) return;

    this.stopPolling();
    this.currentTaskId = task.id;
    this.seenFeedIds.clear();
    this.view.webview.html = getFeedHtml(task);

    // Start polling
    this.consecutiveErrors = 0;
    this.currentInterval = 5_000;
    this.pollTimer = setInterval(() => this.pollUpdates(), this.currentInterval);
    this.pollUpdates();
  }

  /** Show issue details in the feed panel */
  showIssue(issue: IssueInfo): void {
    if (!this.view) return;
    this.stopPolling();
    this.currentTaskId = null;
    this.seenFeedIds.clear();
    this.view.webview.html = getIssueHtml(issue);
  }

  /** Clear the feed (no task selected) */
  clear(): void {
    if (!this.view) return;
    this.stopPolling();
    this.currentTaskId = null;
    this.seenFeedIds.clear();
    this.view.webview.html = getIdleHtml();
  }

  /** Notify that the currently-displayed task has finished */
  onTaskFinished(taskId: string, finalStatus: "completed" | "failed"): void {
    if (this.currentTaskId !== taskId) return;
    this.stopPolling();
    // Do one final poll to capture any last coordination items, then notify webview
    this.pollUpdates().then(() => {
      if (this.view) {
        this.view.webview.postMessage({ type: "taskFinished", status: finalStatus });
      }
    });
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private resetInterval(ms: number): void {
    this.currentInterval = ms;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.pollUpdates(), ms);
  }

  private async pollUpdates(): Promise<void> {
    if (!this.view || !this.currentTaskId) return;
    if (!this.client.isConnected()) return;

    try {
      const coordData = await this.client.getCoordinationFeed(this.currentTaskId);
      this.view.webview.postMessage({ type: "coordination", data: coordData });

      const detail = await this.client.getTaskDetail(this.currentTaskId);
      this.view.webview.postMessage({ type: "taskDetail", data: detail });

      this.consecutiveErrors = 0;
      if (this.currentInterval !== 5_000) {
        this.resetInterval(5_000);
      }
    } catch {
      this.consecutiveErrors++;
      if (this.consecutiveErrors >= 3) {
        const backed = Math.min(this.currentInterval * 2, 30_000);
        this.resetInterval(backed);
      }
    }
  }
}

// ── HTML templates ──

function getIdleHtml(): string {
  return /*html*/ `<!DOCTYPE html>
<html><head><style>
  body { background: transparent; color: #808080; font-family: -apple-system, sans-serif; font-size: 12px; display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center; }
</style></head>
<body><p>Click a task above to see<br>expert collaboration</p></body></html>`;
}

function getFeedHtml(task: TaskInfo): string {
  return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  :root {
    --bg: transparent;
    --bg-secondary: var(--vscode-sideBar-background, #252526);
    --bg-tertiary: var(--vscode-input-background, #2d2d2d);
    --border: var(--vscode-sideBar-border, #3e3e42);
    --text: var(--vscode-foreground, #cccccc);
    --text-dim: var(--vscode-descriptionForeground, #808080);
    --text-bright: var(--vscode-editor-foreground, #ffffff);
    --accent: var(--vscode-focusBorder, #0098ff);
    --green: #4ec9b0; --yellow: #dcdcaa; --red: #f44747;
    --orange: #ce9178; --purple: #c586c0; --cyan: #9cdcfe;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 12px; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

  /* Header */
  .header { padding: 8px 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .header h2 { font-size: 12px; font-weight: 600; color: var(--text-bright); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .header .meta { display: flex; gap: 6px; margin-top: 3px; flex-wrap: wrap; }
  .badge { font-size: 10px; background: var(--bg-tertiary); padding: 1px 6px; border-radius: 3px; color: var(--cyan); }

  /* Story Progress */
  .story-bar { padding: 6px 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; display: none; }
  .story-bar.visible { display: block; }
  .story-bar .label { font-size: 10px; color: var(--text-dim); margin-bottom: 4px; }
  .progress-track { height: 4px; background: var(--bg-tertiary); border-radius: 2px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--green); border-radius: 2px; transition: width 0.5s ease; width: 0%; }

  /* Feed */
  .feed { flex: 1; overflow-y: auto; padding: 6px; }
  .feed-item { margin-bottom: 6px; padding: 6px 8px; background: var(--bg-tertiary); border-radius: 5px; border-left: 3px solid var(--border); }
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

  .feed-persona { font-size: 11px; font-weight: 600; color: var(--cyan); margin-bottom: 2px; }
  .feed-persona .type-badge { font-weight: 400; font-size: 9px; color: var(--text-dim); margin-left: 4px; }
  .feed-content { font-size: 11px; line-height: 1.4; color: var(--text); word-wrap: break-word; }
  .feed-time { font-size: 9px; color: var(--text-dim); margin-top: 2px; }

  /* Blocker */
  .blocker-alert { background: #3a1a1a; border: 1px solid var(--red); border-radius: 5px; padding: 8px; margin: 6px; display: none; flex-shrink: 0; }
  .blocker-alert.visible { display: block; }
  .blocker-alert h3 { font-size: 11px; color: var(--red); margin-bottom: 4px; }
  .blocker-alert p { font-size: 11px; margin-bottom: 6px; }
  .blocker-actions { display: flex; gap: 4px; }
  .blocker-actions button { padding: 3px 8px; border-radius: 3px; border: none; font-size: 10px; cursor: pointer; }
  .btn-retry { background: var(--accent); color: white; }
  .btn-skip { background: var(--yellow); color: #1e1e1e; }
  .btn-abort { background: var(--red); color: white; }

  /* Talk */
  .talk-bar { padding: 6px; border-top: 1px solid var(--border); flex-shrink: 0; display: flex; gap: 4px; }
  .talk-input { flex: 1; background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 3px; color: var(--text); padding: 4px 8px; font-size: 11px; outline: none; }
  .talk-input:focus { border-color: var(--accent); }
  .talk-input::placeholder { color: var(--text-dim); }
  .talk-btn { background: var(--accent); color: white; border: none; border-radius: 3px; padding: 4px 8px; font-size: 11px; cursor: pointer; }

  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
</style>
</head>
<body>

<div class="header">
  <h2>${esc(task.summary)}</h2>
  <div class="meta">
    <span class="badge">${esc(task.persona || "worker")}</span>
    <span class="badge">${esc(task.model || "")}</span>
    <span id="statusBadge" class="badge" style="color: var(--green);">${task.status}</span>
  </div>
</div>

<div class="story-bar" id="storyBar">
  <div class="label"><span id="storyLabel">Stories: 0/0</span> <span id="epicProgress" style="float:right; color: var(--green);"></span></div>
  <div class="progress-track"><div class="progress-fill" id="progressFill"></div></div>
</div>

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
  <input class="talk-input" id="talkInput" type="text" placeholder="Talk to your team..." />
  <button class="talk-btn" onclick="sendMessage()">Send</button>
</div>

<script>
const vscode = acquireVsCodeApi();
const feed = document.getElementById('feed');
const talkInput = document.getElementById('talkInput');
const seenFeedIds = new Set();
let currentBlockerId = null;

talkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && talkInput.value.trim()) sendMessage(); });

function sendMessage() {
  const msg = talkInput.value.trim();
  if (!msg) return;
  vscode.postMessage({ type: 'talk', message: msg });
  talkInput.value = '';
  addFeedItem({ persona: 'you', messageType: 'user_message', content: msg, createdAt: new Date().toISOString() });
}

function blockerAction(action) {
  if (!currentBlockerId) return;
  vscode.postMessage({ type: 'blocker-response', blockerId: currentBlockerId, action });
  document.getElementById('blockerAlert').classList.remove('visible');
  currentBlockerId = null;
}

const personaEmoji = {
  frontend_developer: '\\u{1F3A8}', backend_developer: '\\u{1F4BB}', devops_engineer: '\\u{1F527}',
  security_engineer: '\\u{1F512}', qa_engineer: '\\u{1F9EA}',
  tech_writer: '\\u{1F4DD}', project_manager: '\\u{1F4CB}',
  architect: '\\u{1F3D7}', data_ml_engineer: '\\u{1F4CA}', mobile_developer: '\\u{1F4F1}',
  planning_agent: '\\u{1F4A1}', tech_lead: '\\u{1F451}',
  manager: '\\u{1F454}', support_agent: '\\u{1F4AC}', coordinator: '\\u{1F3AF}',
  dashboard: '\\u{1F4CA}', you: '\\u{1F464}',
};
function getEmoji(p) { return personaEmoji[p] || '\\u{1F916}'; }
function formatTime(iso) { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }
function esc(s) { return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

function addFeedItem(item) {
  if (item.id && seenFeedIds.has(item.id)) return;
  if (item.id) seenFeedIds.add(item.id);
  const div = document.createElement('div');
  div.className = 'feed-item ' + (item.messageType || '');
  const typeLabel = (item.messageType || '').replace(/_/g, ' ');
  div.innerHTML =
    '<div class="feed-persona">' + getEmoji(item.persona) + ' ' + esc(item.persona || 'system') +
    '<span class="type-badge">' + typeLabel + '</span></div>' +
    '<div class="feed-content">' + esc(item.content || '') + '</div>' +
    '<div class="feed-time">' + formatTime(item.createdAt) + '</div>';
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;

  if (item.messageType === 'blocker_detected' || item.messageType === 'blocker') {
    currentBlockerId = item.id;
    document.getElementById('blockerAlert').classList.add('visible');
    document.getElementById('blockerTitle').textContent = getEmoji(item.persona) + ' Blocker: ' + (item.persona || 'worker');
    document.getElementById('blockerContent').textContent = item.content || 'Worker needs help.';
  }
  if (item.messageType === 'blocker_resolved') {
    document.getElementById('blockerAlert').classList.remove('visible');
    currentBlockerId = null;
  }
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'coordination') {
    const items = msg.data?.contexts || msg.data || [];
    if (Array.isArray(items)) items.forEach(addFeedItem);
  }
  if (msg.type === 'taskFinished') {
    var banner = document.createElement('div');
    banner.className = 'feed-item ' + (msg.status === 'completed' ? 'completion' : 'blocker');
    banner.innerHTML =
      '<div class="feed-persona">System</div>' +
      '<div class="feed-content" style="font-weight:600;">Task ' + esc(msg.status) + '</div>' +
      '<div class="feed-time">' + formatTime(new Date().toISOString()) + '</div>';
    feed.appendChild(banner);
    feed.scrollTop = feed.scrollHeight;
    document.getElementById('statusBadge').textContent = msg.status;
    document.getElementById('statusBadge').style.color = msg.status === 'completed' ? 'var(--green)' : 'var(--red)';
    document.getElementById('talkInput').disabled = true;
    document.getElementById('talkInput').placeholder = 'Task ' + msg.status;
  }
  if (msg.type === 'taskDetail') {
    const d = msg.data;
    if (!d) return;
    document.getElementById('statusBadge').textContent = d.status || '';
    if (d.isEpicWorkflow && d.storiesTotal > 0) {
      document.getElementById('storyBar').classList.add('visible');
      document.getElementById('storyLabel').textContent =
        'Stories: ' + d.storiesCompleted + '/' + d.storiesTotal + (d.storiesFailed > 0 ? ' (' + d.storiesFailed + ' failed)' : '');
      document.getElementById('epicProgress').textContent = d.epicProgress + '%';
      document.getElementById('progressFill').style.width = d.epicProgress + '%';
    }
  }
});
</script>
</body></html>`;
}

function getIssueHtml(issue: IssueInfo): string {
  const priorityColors: Record<string, string> = {
    highest: "var(--red)", blocker: "var(--red)", critical: "var(--red)",
    high: "var(--orange)", medium: "var(--yellow)", low: "var(--cyan)", lowest: "var(--text-dim)",
  };
  const priColor = priorityColors[(issue.priority || "").toLowerCase()] || "var(--text-dim)";

  const descriptionHtml = issue.description
    ? esc(issue.description).replace(/\n/g, "<br>")
    : '<span style="color: var(--text-dim);">No description</span>';

  return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  :root {
    --bg: transparent;
    --bg-tertiary: var(--vscode-input-background, #2d2d2d);
    --border: var(--vscode-sideBar-border, #3e3e42);
    --text: var(--vscode-foreground, #cccccc);
    --text-dim: var(--vscode-descriptionForeground, #808080);
    --text-bright: var(--vscode-editor-foreground, #ffffff);
    --accent: var(--vscode-focusBorder, #0098ff);
    --green: #4ec9b0; --yellow: #dcdcaa; --red: #f44747;
    --orange: #ce9178; --cyan: #9cdcfe;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 12px; overflow-y: auto; }

  .header { padding: 10px; border-bottom: 1px solid var(--border); }
  .header .key { font-size: 11px; color: var(--accent); font-weight: 600; }
  .header h2 { font-size: 13px; font-weight: 600; color: var(--text-bright); margin-top: 2px; line-height: 1.3; }
  .meta { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
  .badge { font-size: 10px; background: var(--bg-tertiary); padding: 2px 7px; border-radius: 3px; }

  .section { padding: 10px; border-bottom: 1px solid var(--border); }
  .section-title { font-size: 10px; font-weight: 600; text-transform: uppercase; color: var(--text-dim); letter-spacing: 0.5px; margin-bottom: 6px; }
  .description { font-size: 12px; line-height: 1.5; color: var(--text); white-space: pre-wrap; word-wrap: break-word; }

  .detail-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 11px; }
  .detail-label { color: var(--text-dim); }
  .detail-value { color: var(--text-bright); text-align: right; }

  .labels { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
  .label-tag { font-size: 10px; background: var(--bg-tertiary); border: 1px solid var(--border); padding: 1px 6px; border-radius: 10px; color: var(--cyan); }

  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
</style>
</head>
<body>

<div class="header">
  <div class="key">${esc(issue.key)}</div>
  <h2>${esc(issue.summary)}</h2>
  <div class="meta">
    <span class="badge" style="color: var(--green);">${esc(issue.status || "Unknown")}</span>
    ${issue.issueType ? `<span class="badge">${esc(issue.issueType)}</span>` : ""}
    ${issue.priority ? `<span class="badge" style="color: ${priColor};">${esc(issue.priority)}</span>` : ""}
  </div>
</div>

<div class="section">
  <div class="section-title">Description</div>
  <div class="description">${descriptionHtml}</div>
</div>

<div class="section">
  <div class="section-title">Details</div>
  ${issue.assignee ? `<div class="detail-row"><span class="detail-label">Assignee</span><span class="detail-value">${esc(issue.assignee.displayName)}</span></div>` : ""}
  ${issue.project ? `<div class="detail-row"><span class="detail-label">Project</span><span class="detail-value">${esc(issue.project.name)}</span></div>` : ""}
  ${issue.labels.length > 0 ? `<div style="margin-top: 6px;"><div class="labels">${issue.labels.map((l) => `<span class="label-tag">${esc(l)}</span>`).join("")}</div></div>` : ""}
</div>

</body></html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
