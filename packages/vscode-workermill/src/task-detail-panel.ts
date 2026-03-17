/**
 * TaskDetailPanel — full task detail view in the main editor area.
 *
 * Opens as a WebviewPanel tab when the user clicks a task in the sidebar tree.
 * Shows: task header, story progress, coordination feed, and action buttons.
 * Polls for real-time updates.
 */

import * as vscode from "vscode";
import type { AgentClient, TaskInfo } from "./agent-client";

export class TaskDetailPanel {
  static readonly viewType = "workermill.taskDetail";
  private static currentPanels = new Map<string, TaskDetailPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly client: AgentClient;
  private readonly taskId: string;
  private pollTimer: NodeJS.Timeout | null = null;
  private disposed = false;
  private consecutiveErrors = 0;
  private currentInterval = 5_000;

  static createOrShow(client: AgentClient, task: TaskInfo): void {
    const existing = TaskDetailPanel.currentPanels.get(task.id);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const title =
      task.summary.length > 50
        ? task.summary.substring(0, 50) + "..."
        : task.summary;
    const panel = vscode.window.createWebviewPanel(
      TaskDetailPanel.viewType,
      title,
      { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.iconPath = new vscode.ThemeIcon("tasklist");
    new TaskDetailPanel(panel, client, task);
  }

  static disposeAll(): void {
    for (const p of TaskDetailPanel.currentPanels.values()) p.dispose();
  }

  private constructor(
    panel: vscode.WebviewPanel,
    client: AgentClient,
    task: TaskInfo,
  ) {
    this.panel = panel;
    this.client = client;
    this.taskId = task.id;
    TaskDetailPanel.currentPanels.set(task.id, this);
    this.panel.onDidDispose(() => this.dispose());
    this.panel.webview.html = this.getHtml(task);

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "cancel-task") {
        const confirm = await vscode.window.showWarningMessage(
          "Cancel this task?",
          { modal: true },
          "Cancel Task",
        );
        if (confirm === "Cancel Task") {
          try {
            await this.client.cancelTask(this.taskId);
            vscode.window.showInformationMessage("Task cancelled.");
          } catch (err) {
            vscode.window.showErrorMessage(
              `Failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      } else if (msg.type === "retry-task") {
        const confirmRetry = await vscode.window.showWarningMessage(
          "Retry this task?",
          { modal: true },
          "Retry",
        );
        if (confirmRetry === "Retry") {
          try {
            await this.client.retryTask(this.taskId);
            // Immediately update webview — hide retry bar and banner
            this.panel.webview.postMessage({ type: "retrySuccess" });
            vscode.window.showInformationMessage("Task queued for retry.");
          } catch (err) {
            // Re-enable the retry button so user can try again
            this.panel.webview.postMessage({ type: "retryFailed" });
            vscode.window.showErrorMessage(
              `Failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        } else {
          // User cancelled the confirmation — re-enable the button
          this.panel.webview.postMessage({ type: "retryFailed" });
        }
      } else if (msg.type === "blocker-response") {
        try {
          await this.client.respondToBlocker(
            this.taskId,
            msg.blockerId,
            msg.action,
            msg.guidance,
          );
        } catch (err) {
          vscode.window.showErrorMessage(
            `Failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    });

    // Start polling after a brief delay
    setTimeout(() => {
      if (!this.disposed) {
        this.poll();
        this.pollTimer = setInterval(() => this.poll(), this.currentInterval);
      }
    }, 500);
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
      const detail = await this.client.getTaskDetail(this.taskId);
      this.panel.webview.postMessage({ type: "taskDetail", data: detail });

      const coord = await this.client.getCoordinationFeed(this.taskId);
      this.panel.webview.postMessage({ type: "coordination", data: coord });

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

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    TaskDetailPanel.currentPanels.delete(this.taskId);
    this.panel.dispose();
  }

  private getHtml(task: TaskInfo): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  :root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --bg-secondary: var(--vscode-sideBar-background, #252526);
    --bg-tertiary: var(--vscode-input-background, #2d2d2d);
    --border: var(--vscode-panel-border, #3e3e42);
    --text: var(--vscode-foreground, #cccccc);
    --text-dim: var(--vscode-descriptionForeground, #808080);
    --text-bright: var(--vscode-editor-foreground, #ffffff);
    --accent: var(--vscode-focusBorder, #0098ff);
    --green: #4ec9b0; --yellow: #dcdcaa; --red: #f44747;
    --orange: #ce9178; --purple: #c586c0; --cyan: #9cdcfe;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    overflow-y: auto;
    padding: 0;
  }

  /* Header */
  .task-header {
    padding: 20px 24px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
  }
  .task-header h1 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-bright);
    line-height: 1.3;
    margin-bottom: 10px;
  }
  .meta-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  .badge {
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 12px;
    font-weight: 500;
  }
  .badge-status {
    color: #1e1e1e;
    font-weight: 600;
  }
  .badge-status.running { background: var(--green); }
  .badge-status.planning { background: var(--yellow); }
  .badge-status.completed { background: var(--green); }
  .badge-status.failed { background: var(--red); }
  .badge-status.cancelled { background: var(--red); }
  .badge-status.escalated { background: var(--orange); }
  .badge-info {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--cyan);
  }
  .badge-model {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--purple);
  }

  /* Info grid */
  .info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--border);
  }
  .info-card {
    background: var(--bg-secondary);
    border-radius: 8px;
    padding: 12px 16px;
    border: 1px solid var(--border);
  }
  .info-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-dim);
    margin-bottom: 4px;
  }
  .info-value {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-bright);
  }

  /* Story progress */
  .story-section {
    padding: 16px 24px;
    border-bottom: 1px solid var(--border);
    display: none;
  }
  .story-section.visible { display: block; }
  .story-section h2 {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-bright);
    margin-bottom: 8px;
  }
  .progress-container {
    background: var(--bg-tertiary);
    border-radius: 6px;
    height: 8px;
    overflow: hidden;
    margin-bottom: 6px;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--green), var(--cyan));
    border-radius: 6px;
    transition: width 0.5s ease;
    width: 0%;
  }
  .progress-label {
    font-size: 11px;
    color: var(--text-dim);
  }
  .progress-label span { color: var(--green); font-weight: 600; }

  /* Blocker alert */
  .blocker-section {
    padding: 16px 24px;
    display: none;
  }
  .blocker-section.visible { display: block; }
  .blocker-box {
    background: rgba(244, 71, 71, 0.1);
    border: 1px solid var(--red);
    border-radius: 8px;
    padding: 14px 16px;
  }
  .blocker-box h3 {
    font-size: 13px;
    color: var(--red);
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .blocker-box p {
    font-size: 12px;
    line-height: 1.5;
    color: var(--text);
    margin-bottom: 10px;
  }
  .blocker-actions {
    display: flex;
    gap: 6px;
  }

  /* Actions bar */
  .actions-bar {
    padding: 12px 24px;
    border-bottom: 1px solid var(--border);
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  .action-btn {
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-tertiary);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: background 0.15s, border-color 0.15s;
  }
  .action-btn:hover {
    background: var(--bg-secondary);
    border-color: var(--accent);
  }
  .action-btn.primary {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  .action-btn.primary:hover { opacity: 0.9; }
  .action-btn.danger {
    border-color: var(--red);
    color: var(--red);
  }
  .action-btn.danger:hover { background: rgba(244,71,71,0.15); }
  .action-btn.success {
    border-color: var(--green);
    color: var(--green);
  }
  .action-btn.success:hover { background: rgba(78,201,176,0.15); }
  .action-btn:disabled { opacity: 0.5; cursor: not-allowed; pointer-events: none; }

  /* Task details section */
  .detail-section {
    padding: 16px 24px;
    border-bottom: 1px solid var(--border);
  }
  .detail-section h2 {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-bright);
    margin-bottom: 10px;
  }
  .detail-description {
    font-size: 12px;
    line-height: 1.6;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
    overflow-y: auto;
    margin-bottom: 10px;
    padding: 10px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .detail-description:empty, .detail-description.empty { display: none; }
  .detail-links {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .detail-link {
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .detail-link-label {
    color: var(--text-dim);
    min-width: 60px;
  }
  .detail-link-value {
    color: var(--accent);
    text-decoration: none;
    word-break: break-all;
  }
  .detail-link-value.plain {
    color: var(--text);
    font-family: monospace;
    font-size: 11px;
  }


  /* Finished banner */
  .finished-banner {
    padding: 12px 24px;
    text-align: center;
    font-weight: 600;
    font-size: 13px;
    display: none;
  }
  .finished-banner.visible { display: block; }
  .finished-banner.completed { background: rgba(78,201,176,0.15); color: var(--green); }
  .finished-banner.failed { background: rgba(244,71,71,0.15); color: var(--red); }
  .finished-banner.cancelled { background: rgba(244,71,71,0.15); color: var(--red); }
  .error-detail {
    display: none;
    padding: 10px 24px 12px;
    background: rgba(244,71,71,0.08);
    border-top: 1px solid rgba(244,71,71,0.2);
    font-size: 12px;
    color: var(--text);
    line-height: 1.5;
    word-break: break-word;
  }
  .error-detail.visible { display: block; }
  .error-detail .error-label { color: var(--red); font-weight: 600; margin-right: 6px; }

  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
</style>
</head>
<body>

<div class="task-header">
  <h1 id="taskTitle">${esc(task.summary)}</h1>
  <div class="meta-row">
    <span id="statusBadge" class="badge badge-status ${task.status}">${task.status}</span>
    ${task.persona ? `<span class="badge badge-info">${esc(task.persona)}</span>` : ""}
    ${task.model ? `<span class="badge badge-model">${esc(task.model)}</span>` : ""}
    ${task.repo ? `<span class="badge badge-info">${esc(task.repo)}</span>` : ""}
  </div>
</div>

<div class="info-grid">
  <div class="info-card">
    <div class="info-label">Task ID</div>
    <div class="info-value" style="font-size:12px; font-family: monospace;">${esc(task.id.substring(0, 12))}...</div>
  </div>
  <div class="info-card">
    <div class="info-label">Started</div>
    <div class="info-value" id="startedAt" style="font-size:12px;">${task.startedAt ? formatDate(task.startedAt) : "—"}</div>
  </div>
  <div class="info-card" id="costCard" style="display:none">
    <div class="info-label">Cost</div>
    <div class="info-value" id="costValue">—</div>
  </div>
  <div class="info-card" id="durationCard" style="display:none">
    <div class="info-label">Duration</div>
    <div class="info-value" id="durationValue">—</div>
  </div>
</div>

<div class="story-section" id="storySection">
  <h2>Story Progress</h2>
  <div class="progress-container">
    <div class="progress-fill" id="progressFill"></div>
  </div>
  <div class="progress-label">
    <span id="storyCompleted">0</span> / <span id="storyTotal">0</span> stories completed
    <span id="storyFailed" style="color: var(--red); display: none;"> (<span id="storyFailedCount">0</span> failed)</span>
    <span style="float: right;"><span id="epicPercent" style="color: var(--green); font-weight: 600;">0%</span></span>
  </div>
</div>

<div class="blocker-section" id="blockerSection">
  <div class="blocker-box">
    <h3>&#x26A0; <span id="blockerTitle">Blocker</span></h3>
    <p id="blockerContent"></p>
    <div class="blocker-actions">
      <button class="action-btn primary" onclick="blockerAction('retry')">Retry</button>
      <button class="action-btn" style="border-color: var(--yellow); color: var(--yellow);" onclick="blockerAction('skip')">Skip</button>
      <button class="action-btn danger" onclick="blockerAction('abort')">Abort</button>
    </div>
  </div>
</div>

<div class="actions-bar" id="actionsBar"${["failed","cancelled","completed","deployed","pr_approved","review_approved","pr_created","review_requested","escalated","review_rejected"].includes(task.status) ? ` style="display:none"` : ""}>
  <button class="action-btn danger" onclick="cancelTask()">Cancel Task</button>
</div>
<div class="actions-bar" id="retryBar"${["failed","cancelled","escalated","review_rejected"].includes(task.status) ? ` style="display:flex"` : ` style="display:none"`}>
  <button class="action-btn primary" id="retryBtn" onclick="retryTask()">Retry Task</button>
</div>

<div class="detail-section" id="detailSection">
  <h2>Task Details</h2>
  <div class="detail-description" id="taskDescription">${task.description ? esc(task.description) : ""}</div>
  <div class="detail-links">
    <div class="detail-link" id="ticketRow" style="display:none">
      <span class="detail-link-label">Ticket</span>
      <span class="detail-link-value plain" id="ticketLink"></span>
    </div>
    <div class="detail-link" id="repoRow" style="display:none">
      <span class="detail-link-label">Repo</span>
      <span class="detail-link-value plain" id="repoName"></span>
    </div>
    <div class="detail-link" id="branchRow" style="display:none">
      <span class="detail-link-label">Branch</span>
      <span class="detail-link-value plain" id="branchName"></span>
    </div>
    <div class="detail-link" id="prRow" style="display:none">
      <span class="detail-link-label">PR</span>
      <a class="detail-link-value" id="prLink" href="#"></a>
    </div>
  </div>
</div>

<div class="finished-banner${["completed","deployed","pr_approved","review_approved","pr_created","review_requested"].includes(task.status) ? " visible completed" : ["failed","review_rejected"].includes(task.status) ? " visible failed" : task.status === "escalated" ? " visible failed" : task.status === "cancelled" ? " visible cancelled" : ""}" id="finishedBanner">${task.status === "completed" ? "&#x2705; Task completed successfully" : task.status === "deployed" ? "&#x2705; Deployed" : ["pr_approved","review_approved"].includes(task.status) ? "&#x2705; PR approved" : ["pr_created","review_requested"].includes(task.status) ? "&#x2705; PR ready for review" : ["failed","review_rejected"].includes(task.status) ? "&#x274C; Task failed" : task.status === "escalated" ? "&#x26A0; Task escalated — needs attention" : task.status === "cancelled" ? "&#x274C; Task cancelled" : ""}</div>
<div class="error-detail${["failed","review_rejected"].includes(task.status) && task.errorMessage ? " visible" : ""}" id="errorDetail">${["failed","review_rejected"].includes(task.status) && task.errorMessage ? `<span class="error-label">Error:</span>${esc(task.errorMessage)}` : ""}</div>


<script>
const vscode = acquireVsCodeApi();
let currentBlockerId = null;
let taskStatus = "${task.status}";

function cancelTask() { vscode.postMessage({ type: "cancel-task" }); }
function retryTask() {
  var btn = document.getElementById("retryBtn");
  if (btn) btn.disabled = true;
  vscode.postMessage({ type: "retry-task" });
}

function blockerAction(action) {
  if (!currentBlockerId) return;
  vscode.postMessage({ type: "blocker-response", blockerId: currentBlockerId, action: action });
  document.getElementById("blockerSection").classList.remove("visible");
  currentBlockerId = null;
}

function handleCoordinationItem(item) {
  // Handle blockers (activity feed is in the sidebar)
  if (item.messageType === "blocker_detected" || item.messageType === "blocker") {
    currentBlockerId = item.id;
    document.getElementById("blockerSection").classList.add("visible");
    document.getElementById("blockerTitle").textContent = "Blocker: " + (item.persona || "worker");
    document.getElementById("blockerContent").textContent = item.content || "Worker needs help.";
  }
  if (item.messageType === "blocker_resolved") {
    document.getElementById("blockerSection").classList.remove("visible");
    currentBlockerId = null;
  }
}

function updateStatus(status, errorMessage) {
  if (status === taskStatus && !errorMessage) return;
  taskStatus = status;
  const badge = document.getElementById("statusBadge");
  badge.textContent = status;
  badge.className = "badge badge-status " + status;

  // Show finished banner for terminal states
  var successStatuses = ["completed", "deployed", "pr_approved", "review_approved", "pr_created", "review_requested"];
  var failStatuses = ["failed", "review_rejected"];
  var retryStatuses = ["failed", "cancelled", "escalated", "review_rejected"];
  var terminalStatuses = successStatuses.concat(failStatuses).concat(["escalated", "cancelled"]);
  if (terminalStatuses.indexOf(status) !== -1) {
    const banner = document.getElementById("finishedBanner");
    const bannerClass = (successStatuses.indexOf(status) !== -1) ? "completed" : (status === "escalated") ? "failed" : status;
    banner.className = "finished-banner visible " + bannerClass;
    banner.textContent = status === "completed" ? "\\u2705 Task completed successfully"
      : status === "deployed" ? "\\u2705 Deployed"
      : status === "pr_approved" || status === "review_approved" ? "\\u2705 PR approved"
      : status === "pr_created" || status === "review_requested" ? "\\u2705 PR ready for review"
      : status === "escalated" ? "\\u26A0 Task escalated \\u2014 needs attention"
      : status === "cancelled" ? "\\u274C Task cancelled"
      : status === "review_rejected" ? "\\u274C Review rejected"
      : "\\u274C Task failed";
    // Show error detail for failed tasks
    var errEl = document.getElementById("errorDetail");
    if (failStatuses.indexOf(status) !== -1 && errorMessage) {
      errEl.innerHTML = '<span class="error-label">Error:</span>' + escHtml(errorMessage);
      errEl.className = "error-detail visible";
    } else {
      errEl.className = "error-detail";
      errEl.innerHTML = "";
    }
    document.getElementById("actionsBar").style.display = "none";
    document.getElementById("retryBar").style.display = (retryStatuses.indexOf(status) !== -1) ? "flex" : "none";
    var retryBtn = document.getElementById("retryBtn");
    if (retryBtn) retryBtn.disabled = false;
  } else {
    // Non-terminal: show cancel bar, hide retry bar and banner
    document.getElementById("actionsBar").style.display = "";
    document.getElementById("retryBar").style.display = "none";
    document.getElementById("finishedBanner").className = "finished-banner";
    document.getElementById("errorDetail").className = "error-detail";
  }
}

function escHtml(s) {
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

window.addEventListener("message", (event) => {
  const msg = event.data;

  if (msg.type === "retrySuccess") {
    document.getElementById("retryBar").style.display = "none";
    document.getElementById("finishedBanner").className = "finished-banner";
    document.getElementById("finishedBanner").textContent = "";
    var badge = document.getElementById("statusBadge");
    badge.textContent = "queued";
    badge.className = "badge badge-status planning";
    taskStatus = "queued";
    return;
  }

  if (msg.type === "retryFailed") {
    var retryBtn = document.getElementById("retryBtn");
    if (retryBtn) retryBtn.disabled = false;
    return;
  }

  if (msg.type === "coordination") {
    const items = msg.data?.contexts || msg.data || [];
    if (Array.isArray(items)) items.forEach(handleCoordinationItem);
  }

  if (msg.type === "taskDetail") {
    const d = msg.data;
    if (!d) return;

    // Update status (pass errorMessage for failed tasks)
    if (d.status) updateStatus(d.status, d.errorMessage || null);

    // Story progress
    if (d.isEpicWorkflow && d.storiesTotal > 0) {
      document.getElementById("storySection").classList.add("visible");
      document.getElementById("storyCompleted").textContent = d.storiesCompleted || 0;
      document.getElementById("storyTotal").textContent = d.storiesTotal || 0;
      document.getElementById("epicPercent").textContent = (d.epicProgress || 0) + "%";
      document.getElementById("progressFill").style.width = (d.epicProgress || 0) + "%";
      if (d.storiesFailed > 0) {
        document.getElementById("storyFailed").style.display = "";
        document.getElementById("storyFailedCount").textContent = d.storiesFailed;
      }
    }

    // Cost
    if (d.cost != null) {
      document.getElementById("costCard").style.display = "";
      document.getElementById("costValue").textContent = typeof d.cost === "number" ? "$" + d.cost.toFixed(2) : String(d.cost);
    }

    // Duration
    if (d.startedAt) {
      document.getElementById("durationCard").style.display = "";
      const start = new Date(d.startedAt).getTime();
      const end = d.completedAt ? new Date(d.completedAt).getTime() : Date.now();
      const mins = Math.round((end - start) / 60000);
      document.getElementById("durationValue").textContent = mins < 60 ? mins + " min" : Math.floor(mins / 60) + "h " + (mins % 60) + "m";
    }

    // Task details (description, ticket, branch, PR, repo)
    const descEl = document.getElementById("taskDescription");
    if (d.description) {
      descEl.textContent = d.description;
      descEl.classList.remove("empty");
    } else if (d.summary) {
      descEl.textContent = d.summary;
      descEl.classList.remove("empty");
    } else {
      descEl.classList.add("empty");
    }
    if (d.jiraIssueKey) {
      document.getElementById("ticketRow").style.display = "";
      const ticketLink = document.getElementById("ticketLink");
      ticketLink.textContent = d.jiraIssueKey;
    }
    if (d.githubBranch) {
      document.getElementById("branchRow").style.display = "";
      document.getElementById("branchName").textContent = d.githubBranch;
    }
    if (d.githubRepo) {
      document.getElementById("repoRow").style.display = "";
      document.getElementById("repoName").textContent = d.githubRepo;
    }
    if (d.githubPrUrl) {
      document.getElementById("prRow").style.display = "";
      const prLink = document.getElementById("prLink");
      const prNum = d.githubPrUrl.match(/\\/pull\\/(\\d+)/);
      prLink.textContent = prNum ? "PR #" + prNum[1] : d.githubPrUrl;
      prLink.setAttribute("href", d.githubPrUrl);
    }
  }
});
</script>
</body></html>`;
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
