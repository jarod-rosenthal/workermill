/**
 * SettingsPanel — integration settings webview in the editor area.
 *
 * Lets users configure Jira, GitHub Issues, or internal boards as their
 * issue tracker without leaving VS Code. Calls the cloud API directly
 * using the org API key stored in ~/.workermill/config.json.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import * as http from "http";
import { execFileSync } from "child_process";
import {
  stopAgentProcess,
  startAgentProcess,
  waitForAgentReady,
  getAgentBinaryPath,
} from "./agent-installer";

function readAgentConfig(): { apiUrl: string; apiKey: string } | null {
  try {
    const configPath = path.join(os.homedir(), ".workermill", "config.json");
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (raw.apiUrl && raw.apiKey) return { apiUrl: raw.apiUrl, apiKey: raw.apiKey };
  } catch { /* no config */ }
  return null;
}

function apiRequest<T>(
  method: string,
  url: string,
  apiKey: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const payload = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      Accept: "application/json",
      "User-Agent": "WorkerMill-VSCode",
    };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }

    const transport = isHttps ? https : http;
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          apiRequest<T>(method, res.headers.location, apiKey, body).then(resolve, reject);
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(data) as T });
          } catch {
            resolve({ status: res.statusCode || 0, data: {} as T });
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(30_000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

export class SettingsPanel {
  static readonly viewType = "workermill.settings";
  private static instance: SettingsPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private disposed = false;

  static createOrShow(extensionUri: vscode.Uri): void {
    if (SettingsPanel.instance) {
      SettingsPanel.instance.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      SettingsPanel.viewType,
      "WorkerMill Settings",
      { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.iconPath = new vscode.ThemeIcon("gear");
    SettingsPanel.instance = new SettingsPanel(panel);
  }

  static dispose(): void {
    SettingsPanel.instance?.dispose();
  }

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose());
    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      // Sandbox operations use local config only — no cloud API needed
      if (msg.type === "load-sandbox") {
        await this.loadSandbox();
        return;
      } else if (msg.type === "toggle-sandbox") {
        await this.toggleSandbox(msg.enabled);
        return;
      } else if (msg.type === "pull-sandbox-image") {
        this.pullSandboxImage();
        return;
      } else if (msg.type === "sign-out") {
        vscode.commands.executeCommand("workermill.signOut");
        return;
      }

      const config = readAgentConfig();
      if (!config) {
        this.postMessage({ type: "error", message: "Agent not configured. Please sign in first." });
        return;
      }

      if (msg.type === "load-integrations") {
        await this.loadIntegrations(config);
      } else if (msg.type === "save-jira") {
        await this.saveJira(config, msg);
      } else if (msg.type === "test-jira") {
        await this.testJira(config);
      } else if (msg.type === "save-tracker") {
        await this.saveTracker(config, msg.tracker);
      } else if (msg.type === "open-dashboard") {
        vscode.env.openExternal(vscode.Uri.parse(`${config.apiUrl}/dashboard`));
      } else if (msg.type === "save-repo") {
        await this.saveRepo(config, msg.defaultRepo);
      } else if (msg.type === "open-web-settings") {
        vscode.env.openExternal(vscode.Uri.parse(`${config.apiUrl}/settings`));
      } else if (msg.type === "open-pricing") {
        vscode.env.openExternal(vscode.Uri.parse(`${config.apiUrl}/pricing`));
      } else if (msg.type === "save-models") {
        await this.saveModels(config, msg);
      }
    });

    // Auto-load integrations on open
    const config = readAgentConfig();
    if (config) {
      this.loadIntegrations(config);
    }
  }

  private postMessage(msg: unknown): void {
    if (!this.disposed) this.panel.webview.postMessage(msg);
  }

  private async loadIntegrations(config: { apiUrl: string; apiKey: string }): Promise<void> {
    try {
      const [intResult, settingsResult] = await Promise.all([
        apiRequest<Record<string, unknown>>(
          "GET",
          `${config.apiUrl}/api/settings/integrations`,
          config.apiKey,
        ),
        apiRequest<Record<string, unknown>>(
          "GET",
          `${config.apiUrl}/api/settings`,
          config.apiKey,
        ),
      ]);
      if (intResult.status >= 200 && intResult.status < 300) {
        const merged = {
          ...intResult.data,
          defaultWorkerModel: settingsResult.data?.defaultWorkerModel,
          managerModelId: settingsResult.data?.managerModelId,
          planningAgentModel: settingsResult.data?.planningAgentModel,
        };
        this.postMessage({ type: "integrations-loaded", data: merged });
      } else {
        this.postMessage({ type: "error", message: `Failed to load settings (HTTP ${intResult.status})` });
      }
    } catch (err) {
      this.postMessage({ type: "error", message: `Could not reach API: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  private async saveJira(
    config: { apiUrl: string; apiKey: string },
    msg: { baseUrl: string; email: string; apiToken: string },
  ): Promise<void> {
    try {
      this.postMessage({ type: "saving" });
      const { status, data } = await apiRequest<{ success?: boolean; error?: string }>(
        "PUT",
        `${config.apiUrl}/api/settings/integrations/jira`,
        config.apiKey,
        { baseUrl: msg.baseUrl, email: msg.email, apiToken: msg.apiToken },
      );
      if (status >= 200 && status < 300 && (data as { success?: boolean }).success) {
        this.postMessage({ type: "save-success", message: "Jira settings saved" });
        // Reload integrations to reflect new state
        await this.loadIntegrations(config);
      } else {
        this.postMessage({ type: "save-error", message: (data as { error?: string }).error || `HTTP ${status}` });
      }
    } catch (err) {
      this.postMessage({ type: "save-error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async saveTracker(
    config: { apiUrl: string; apiKey: string },
    tracker: string,
  ): Promise<void> {
    try {
      const { status } = await apiRequest<{ error?: string }>(
        "PUT",
        `${config.apiUrl}/api/settings`,
        config.apiKey,
        { issueTrackerProvider: tracker },
      );
      if (status >= 200 && status < 300) {
        this.postMessage({ type: "tracker-saved", tracker });
      } else {
        this.postMessage({ type: "error", message: `Failed to save tracker (HTTP ${status})` });
      }
    } catch (err) {
      this.postMessage({ type: "error", message: `Could not save tracker: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  private async saveModels(
    config: { apiUrl: string; apiKey: string },
    msg: { workerModel: string; reviewerModel: string; plannerModel: string },
  ): Promise<void> {
    try {
      this.postMessage({ type: "models-saving" });
      const { status } = await apiRequest<{ error?: string }>(
        "PUT",
        `${config.apiUrl}/api/settings`,
        config.apiKey,
        {
          defaultWorkerModel: msg.workerModel,
          managerModelId: msg.reviewerModel,
          planningAgentModel: msg.plannerModel,
        },
      );
      if (status >= 200 && status < 300) {
        this.postMessage({ type: "models-saved" });
      } else {
        this.postMessage({ type: "models-save-error", message: `HTTP ${status}` });
      }
    } catch (err) {
      this.postMessage({ type: "models-save-error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async saveRepo(
    config: { apiUrl: string; apiKey: string },
    defaultRepo: string,
  ): Promise<void> {
    try {
      const { status, data } = await apiRequest<{ success?: boolean; error?: string }>(
        "PUT",
        `${config.apiUrl}/api/settings/integrations/github`,
        config.apiKey,
        { defaultRepo },
      );
      if (status >= 200 && status < 300) {
        this.postMessage({ type: "repo-saved", message: "Target repository saved" });
        await this.loadIntegrations(config);
      } else {
        this.postMessage({
          type: "repo-save-error",
          message: (data as { error?: string }).error || `HTTP ${status}`,
        });
      }
    } catch (err) {
      this.postMessage({
        type: "repo-save-error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async loadSandbox(): Promise<void> {
    const configPath = path.join(os.homedir(), ".workermill", "config.json");
    let sandbox: string = "none";
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (raw.sandbox === "docker") sandbox = "docker";
    } catch {
      /* no config */
    }

    let dockerAvailable = false;
    let dockerInstalled = false;
    try {
      execFileSync("docker", ["version"], { timeout: 5000, stdio: "pipe", windowsHide: true });
      dockerAvailable = true;
      dockerInstalled = true;
    } catch {
      // Docker daemon not running — check if CLI is installed
      try {
        execFileSync("docker", ["--version"], { timeout: 5000, stdio: "pipe", windowsHide: true });
        dockerInstalled = true;
      } catch {
        /* Docker not installed */
      }
    }

    this.postMessage({
      type: "sandbox-loaded",
      sandbox,
      dockerAvailable,
      dockerInstalled,
    });
  }

  private async toggleSandbox(enabled: boolean): Promise<void> {
    if (enabled) {
      try {
        execFileSync("docker", ["version"], { timeout: 5000, stdio: "pipe", windowsHide: true });
      } catch {
        let dockerInstalled = false;
        try {
          execFileSync("docker", ["--version"], { timeout: 5000, stdio: "pipe", windowsHide: true });
          dockerInstalled = true;
        } catch { /* not installed */ }
        this.postMessage({
          type: "sandbox-updated",
          sandbox: "none",
          error: dockerInstalled
            ? "Docker Desktop is not running. Please start Docker Desktop and try again."
            : "Docker is not installed. Please install Docker Desktop and try again.",
        });
        return;
      }
    }

    const configPath = path.join(os.homedir(), ".workermill", "config.json");
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      /* no config */
    }

    if (enabled) {
      config.sandbox = "docker";
    } else {
      delete config.sandbox;
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });

    this.postMessage({ type: "sandbox-restarting" });

    try {
      await stopAgentProcess();
      startAgentProcess();
      const port = await waitForAgentReady(undefined, 20_000);
      if (port) {
        this.postMessage({
          type: "sandbox-updated",
          sandbox: enabled ? "docker" : "none",
        });
      } else {
        this.postMessage({
          type: "sandbox-updated",
          sandbox: enabled ? "docker" : "none",
          error: "Agent restarted but did not become ready. Check agent logs.",
        });
      }
    } catch (err) {
      this.postMessage({
        type: "sandbox-updated",
        sandbox: enabled ? "docker" : "none",
        error: `Agent restart failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  private pullSandboxImage(): void {
    const binary = getAgentBinaryPath();
    const terminal = vscode.window.createTerminal({
      name: "Pull Sandbox Image",
      iconPath: new vscode.ThemeIcon("cloud-download"),
    });
    terminal.show();
    const cmd = os.platform() === "win32" ? `& "${binary}" pull` : `"${binary}" pull`;
    terminal.sendText(cmd);
  }

  private async testJira(config: { apiUrl: string; apiKey: string }): Promise<void> {
    try {
      this.postMessage({ type: "testing" });
      const { status, data } = await apiRequest<{ success?: boolean; message?: string; error?: string; user?: string }>(
        "POST",
        `${config.apiUrl}/api/settings/integrations/jira/test`,
        config.apiKey,
      );
      if (status >= 200 && status < 300 && (data as { success?: boolean }).success) {
        this.postMessage({ type: "test-success", message: `Connected as ${(data as { user?: string }).user || "unknown"}` });
      } else {
        this.postMessage({ type: "test-error", message: (data as { error?: string }).error || `HTTP ${status}` });
      }
    } catch (err) {
      this.postMessage({ type: "test-error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  private dispose(): void {
    this.disposed = true;
    SettingsPanel.instance = undefined;
    this.panel.dispose();
  }

  private getHtml(): string {
    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WorkerMill Settings</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --input-border: var(--vscode-input-border, var(--vscode-widget-border, #444));
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --btn-secondary-bg: var(--vscode-button-secondaryBackground);
      --btn-secondary-fg: var(--vscode-button-secondaryForeground);
      --success: var(--vscode-charts-green, #3fb950);
      --error: var(--vscode-errorForeground, #f85149);
      --muted: var(--vscode-descriptionForeground);
      --separator: var(--vscode-widget-border, #333);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      background: var(--bg);
      color: var(--fg);
      padding: 24px;
      max-width: 640px;
    }
    h1 { font-size: 1.4em; margin-bottom: 4px; }
    .subtitle { color: var(--muted); margin-bottom: 24px; }
    .section {
      border: 1px solid var(--separator);
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .section h2 { font-size: 1.1em; margin-bottom: 12px; }
    .field { margin-bottom: 12px; }
    .field label {
      display: block;
      font-weight: 600;
      margin-bottom: 4px;
      font-size: 0.9em;
    }
    .field input, .field select {
      width: 100%;
      padding: 6px 8px;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      font-family: inherit;
      font-size: inherit;
    }
    .field .hint {
      font-size: 0.85em;
      color: var(--muted);
      margin-top: 2px;
    }
    .radio-group { display: flex; gap: 16px; margin-bottom: 12px; }
    .radio-group label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      font-weight: normal;
    }
    .radio-group input[type="radio"] { margin: 0; }
    .btn-row { display: flex; gap: 8px; margin-top: 12px; }
    button {
      padding: 6px 14px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
    }
    .btn-primary { background: var(--btn-bg); color: var(--btn-fg); }
    .btn-primary:hover { background: var(--btn-hover); }
    .btn-secondary { background: var(--btn-secondary-bg); color: var(--btn-secondary-fg); }
    .btn-link {
      background: none;
      color: var(--vscode-textLink-foreground);
      padding: 6px 0;
      text-decoration: underline;
    }
    .status {
      padding: 8px 12px;
      border-radius: 4px;
      margin-top: 8px;
      font-size: 0.9em;
      display: none;
    }
    .status.visible { display: block; }
    .status.success { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
    .status.error { background: color-mix(in srgb, var(--error) 15%, transparent); color: var(--error); }
    .status.info { color: var(--muted); }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 0.8em;
      font-weight: 600;
    }
    .badge.configured { background: color-mix(in srgb, var(--success) 20%, transparent); color: var(--success); }
    .badge.not-configured { background: color-mix(in srgb, var(--error) 20%, transparent); color: var(--error); }
    .loading { color: var(--muted); font-style: italic; }
    .hidden { display: none !important; }
    .footer { margin-top: 24px; color: var(--muted); font-size: 0.85em; }
    .footer a { color: var(--vscode-textLink-foreground); text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
    .pro-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 0.75em;
      font-weight: 700;
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 15%, transparent);
      color: var(--vscode-textLink-foreground);
      margin-left: 4px;
      vertical-align: middle;
      letter-spacing: 0.03em;
    }
    .locked-option {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .locked-option input { pointer-events: none; }
    .scm-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .upgrade-hint {
      font-size: 0.85em;
      color: var(--vscode-textLink-foreground);
      margin-top: 8px;
    }
    .upgrade-hint a {
      color: var(--vscode-textLink-foreground);
      text-decoration: underline;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <h1>Settings</h1>
  <p class="subtitle">Configure integrations for your WorkerMill workspace</p>

  <div id="loading" class="loading">Loading settings...</div>

  <div id="content" class="hidden">
    <!-- AI Models -->
    <div class="section">
      <h2>AI Models</h2>
      <div class="field">
        <label>Expert Workers</label>
        <select id="model-worker"></select>
        <div class="hint">Model used for coding workers</div>
      </div>
      <div class="field">
        <label>Tech Lead</label>
        <select id="model-reviewer"></select>
        <div class="hint">Model used for code review</div>
      </div>
      <div class="field">
        <label>Project Manager</label>
        <select id="model-planner"></select>
        <div class="hint">Model used for planning</div>
      </div>
      <div class="btn-row">
        <button class="btn-primary" id="btn-save-models">Save</button>
      </div>
      <div id="models-status" class="status"></div>
    </div>

    <!-- Issue Tracker -->
    <div class="section">
      <h2>Issue Tracker</h2>
      <div class="radio-group" style="flex-wrap: wrap;">
        <label><input type="radio" name="tracker" value="internal" /> Internal Boards</label>
        <label><input type="radio" name="tracker" value="jira" /> Jira</label>
        <label id="tracker-github-label" class="locked-option"><input type="radio" name="tracker" value="github-issues" disabled /> GitHub Issues <span class="pro-badge">PRO</span></label>
        <label id="tracker-linear-label" class="locked-option"><input type="radio" name="tracker" value="linear" disabled /> Linear <span class="pro-badge">PRO</span></label>
      </div>
      <div id="tracker-upgrade" class="upgrade-hint hidden">Upgrade to Max to unlock all issue trackers. <a id="btn-upgrade-tracker" href="#">View plans</a></div>

      <div id="tracker-status" class="status"></div>

      <!-- Jira fields -->
      <div id="jira-fields" class="hidden">
        <div class="field">
          <label>Base URL</label>
          <input type="url" id="jira-url" placeholder="https://yourcompany.atlassian.net" />
          <div class="hint">Your Jira Cloud or Server URL</div>
        </div>
        <div class="field">
          <label>Email</label>
          <input type="email" id="jira-email" placeholder="you@company.com" />
        </div>
        <div class="field">
          <label>API Token</label>
          <input type="password" id="jira-token" placeholder="Your Jira API token" />
          <div class="hint">Generate at <a href="https://id.atlassian.com/manage-profile/security/api-tokens">id.atlassian.com</a></div>
        </div>
        <div class="btn-row">
          <button class="btn-primary" id="btn-save-jira">Save</button>
          <button class="btn-secondary" id="btn-test-jira">Test Connection</button>
        </div>
        <div id="jira-status" class="status"></div>
      </div>

      <!-- GitHub Issues info -->
      <div id="github-fields" class="hidden">
        <p>GitHub Issues uses your GitHub token from sign-in. <span id="github-badge"></span></p>
        <div class="hint">No additional configuration needed — your SCM credentials were saved during onboarding.</div>
      </div>

      <!-- Linear info -->
      <div id="linear-fields" class="hidden">
        <p>Linear integration status: <span id="linear-badge"></span></p>
        <div class="hint">Configure Linear API key and webhook in <button class="btn-link" id="btn-web-settings-linear">web settings</button>.</div>
      </div>

      <!-- Internal boards info -->
      <div id="boards-fields" class="hidden">
        <p>Using WorkerMill internal boards — no external issue tracker needed.</p>
        <div class="hint">Create and manage boards from the <button class="btn-link" id="btn-dashboard-boards">dashboard</button>.</div>
      </div>
    </div>

    <!-- SCM Status -->
    <div class="section">
      <h2>Source Control</h2>
      <div id="scm-status"></div>
      <div class="hint" style="margin-top: 8px;">Manage SCM tokens in <button class="btn-link" id="btn-web-settings-scm">web settings</button>.</div>
    </div>

    <!-- Target Repository -->
    <div class="section">
      <h2>Target Repository</h2>
      <p>The repository AI workers will target when running tasks.</p>
      <div class="field">
        <label>Default Repository</label>
        <input type="text" id="default-repo" placeholder="owner/repo" />
        <div class="hint">Format: <code>owner/repo</code> (e.g. workermill-examples/flagdeck)</div>
      </div>
      <div class="btn-row">
        <button class="btn-primary" id="btn-save-repo">Save</button>
      </div>
      <div id="repo-status" class="status"></div>
    </div>

    <!-- Docker Sandbox -->
    <div class="section">
      <h2>Docker Sandbox</h2>
      <p>Run AI workers inside Docker containers for filesystem and network isolation.</p>
      <div id="sandbox-status" class="status"></div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="sandbox-toggle" disabled />
          Enable Docker sandbox mode
        </label>
        <div class="hint">Requires Docker installed and running. Workers will run in containers instead of native processes.</div>
      </div>
      <div class="btn-row">
        <button class="btn-secondary" id="btn-pull-image">Pull Latest Image</button>
      </div>
      <div id="sandbox-pull-status" class="status"></div>
    </div>

    <!-- Account -->
    <div class="section">
      <h2>Account</h2>
      <div id="plan-info" class="hidden" style="margin-bottom: 12px;">
        <span>Plan: </span><span id="plan-name" class="badge configured">Free</span>
      </div>
      <div class="btn-row">
        <button class="btn-secondary" id="btn-dashboard">Open Dashboard</button>
        <button class="btn-secondary" id="btn-web-settings">All Settings (Web)</button>
        <button class="btn-secondary" id="btn-sign-out" style="margin-left: auto; color: var(--error);">Sign Out</button>
      </div>
    </div>
  </div>

  <div class="footer">
    WorkerMill &mdash; <a href="https://workermill.com/docs">Documentation</a>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // Elements
    const loadingEl = document.getElementById("loading");
    const contentEl = document.getElementById("content");
    const radios = document.querySelectorAll('input[name="tracker"]');
    const jiraFields = document.getElementById("jira-fields");
    const githubFields = document.getElementById("github-fields");
    const linearFields = document.getElementById("linear-fields");
    const boardsFields = document.getElementById("boards-fields");
    const jiraStatus = document.getElementById("jira-status");
    const trackerStatus = document.getElementById("tracker-status");

    let orgPlan = "pro";

    // Model options by provider
    const ANTHROPIC_MODELS = [
      { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
      { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ];
    const OPENAI_MODELS = [
      { value: "gpt-5.1-codex", label: "GPT-5.1 Codex" },
      { value: "gpt-4o", label: "GPT-4o" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini" },
      { value: "o1", label: "o1 (Reasoning)" },
      { value: "o1-mini", label: "o1 Mini" },
    ];
    const GOOGLE_MODELS = [
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    ];

    function populateModelSelect(selectId, currentValue) {
      const sel = document.getElementById(selectId);
      sel.innerHTML = "";
      const isPaid = orgPlan === "max" || orgPlan === "enterprise";

      // Anthropic group
      if (isPaid) {
        const ag = document.createElement("optgroup");
        ag.label = "Anthropic";
        ANTHROPIC_MODELS.forEach(m => {
          const o = document.createElement("option");
          o.value = m.value; o.textContent = m.label;
          if (m.value === currentValue) o.selected = true;
          ag.appendChild(o);
        });
        sel.appendChild(ag);

        const og = document.createElement("optgroup");
        og.label = "OpenAI";
        OPENAI_MODELS.forEach(m => {
          const o = document.createElement("option");
          o.value = m.value; o.textContent = m.label;
          if (m.value === currentValue) o.selected = true;
          og.appendChild(o);
        });
        sel.appendChild(og);

        const gg = document.createElement("optgroup");
        gg.label = "Google";
        GOOGLE_MODELS.forEach(m => {
          const o = document.createElement("option");
          o.value = m.value; o.textContent = m.label;
          if (m.value === currentValue) o.selected = true;
          gg.appendChild(o);
        });
        sel.appendChild(gg);
      } else {
        ANTHROPIC_MODELS.forEach(m => {
          const o = document.createElement("option");
          o.value = m.value; o.textContent = m.label;
          if (m.value === currentValue) o.selected = true;
          sel.appendChild(o);
        });
      }
    }

    // Radio toggle — skip save during initial load
    let initialLoad = true;
    radios.forEach(r => r.addEventListener("change", () => {
      const val = document.querySelector('input[name="tracker"]:checked').value;
      jiraFields.classList.toggle("hidden", val !== "jira");
      githubFields.classList.toggle("hidden", val !== "github-issues");
      linearFields.classList.toggle("hidden", val !== "linear");
      boardsFields.classList.toggle("hidden", val !== "internal");
      if (!initialLoad) {
        vscode.postMessage({ type: "save-tracker", tracker: val });
      }
    }));

    function applyPlanRestrictions(plan) {
      orgPlan = plan;
      const isPaid = plan === "max" || plan === "enterprise";

      // Issue tracker: Internal Boards + Jira = free, GitHub Issues + Linear = Pro
      const githubLabel = document.getElementById("tracker-github-label");
      const linearLabel = document.getElementById("tracker-linear-label");
      const githubRadio = githubLabel.querySelector("input");
      const linearRadio = linearLabel.querySelector("input");
      const trackerUpgrade = document.getElementById("tracker-upgrade");

      if (isPaid) {
        githubLabel.classList.remove("locked-option");
        linearLabel.classList.remove("locked-option");
        githubRadio.disabled = false;
        linearRadio.disabled = false;
        githubLabel.querySelectorAll(".pro-badge").forEach(b => b.classList.add("hidden"));
        linearLabel.querySelectorAll(".pro-badge").forEach(b => b.classList.add("hidden"));
        trackerUpgrade.classList.add("hidden");
      } else {
        githubLabel.classList.add("locked-option");
        linearLabel.classList.add("locked-option");
        githubRadio.disabled = true;
        linearRadio.disabled = true;
        trackerUpgrade.classList.remove("hidden");
      }
    }

    // Buttons
    document.getElementById("btn-save-jira").addEventListener("click", () => {
      vscode.postMessage({
        type: "save-jira",
        baseUrl: document.getElementById("jira-url").value.trim(),
        email: document.getElementById("jira-email").value.trim(),
        apiToken: document.getElementById("jira-token").value.trim(),
      });
    });
    document.getElementById("btn-test-jira").addEventListener("click", () => {
      vscode.postMessage({ type: "test-jira" });
    });
    document.getElementById("btn-dashboard").addEventListener("click", () => {
      vscode.postMessage({ type: "open-dashboard" });
    });
    document.getElementById("btn-web-settings").addEventListener("click", () => {
      vscode.postMessage({ type: "open-web-settings" });
    });
    document.getElementById("btn-web-settings-linear").addEventListener("click", () => {
      vscode.postMessage({ type: "open-web-settings" });
    });
    document.getElementById("btn-web-settings-scm").addEventListener("click", () => {
      vscode.postMessage({ type: "open-web-settings" });
    });
    document.getElementById("btn-dashboard-boards").addEventListener("click", () => {
      vscode.postMessage({ type: "open-dashboard" });
    });
    document.getElementById("btn-upgrade-tracker").addEventListener("click", (e) => {
      e.preventDefault();
      vscode.postMessage({ type: "open-pricing" });
    });
    document.getElementById("btn-save-models").addEventListener("click", () => {
      vscode.postMessage({
        type: "save-models",
        workerModel: document.getElementById("model-worker").value,
        reviewerModel: document.getElementById("model-reviewer").value,
        plannerModel: document.getElementById("model-planner").value,
      });
    });
    document.getElementById("btn-sign-out").addEventListener("click", () => {
      vscode.postMessage({ type: "sign-out" });
    });
    document.getElementById("btn-save-repo").addEventListener("click", () => {
      vscode.postMessage({ type: "save-repo", defaultRepo: document.getElementById("default-repo").value.trim() });
    });

    // Sandbox toggle
    const sandboxToggle = document.getElementById("sandbox-toggle");
    const sandboxStatus = document.getElementById("sandbox-status");
    sandboxToggle.addEventListener("change", () => {
      vscode.postMessage({ type: "toggle-sandbox", enabled: sandboxToggle.checked });
    });
    document.getElementById("btn-pull-image").addEventListener("click", () => {
      vscode.postMessage({ type: "pull-sandbox-image" });
    });

    function badge(configured) {
      return configured
        ? '<span class="badge configured">Connected</span>'
        : '<span class="badge not-configured">Not configured</span>';
    }

    function showStatus(el, cls, msg) {
      el.className = "status visible " + cls;
      el.textContent = msg;
    }

    // Message handler
    window.addEventListener("message", (event) => {
      const msg = event.data;

      if (msg.type === "integrations-loaded") {
        loadingEl.classList.add("hidden");
        contentEl.classList.remove("hidden");
        const d = msg.data;

        // Apply plan restrictions before selecting radios
        applyPlanRestrictions(d.plan || "pro");

        // Populate model dropdowns
        populateModelSelect("model-worker", d.defaultWorkerModel || "claude-sonnet-4-6");
        populateModelSelect("model-reviewer", d.managerModelId || "claude-opus-4-6");
        populateModelSelect("model-planner", d.planningAgentModel || "claude-opus-4-6");

        // Select current tracker radio (fall back to "internal" if selected tracker is locked)
        let tracker = d.defaultIssueTracker || "internal";
        const isPaid = orgPlan === "max" || orgPlan === "enterprise";
        if (!isPaid && (tracker === "github-issues" || tracker === "linear")) {
          tracker = "internal";
        }
        const trackerRadio = document.querySelector('input[name="tracker"][value="' + tracker + '"]');
        if (trackerRadio) {
          trackerRadio.checked = true;
          trackerRadio.dispatchEvent(new Event("change", { bubbles: true }));
        }

        initialLoad = false;

        // Fill Jira fields if configured
        if (d.jira) {
          if (d.jira.baseUrl) document.getElementById("jira-url").value = d.jira.baseUrl;
          if (d.jira.email) document.getElementById("jira-email").value = d.jira.email;
          if (d.jira.configured) showStatus(jiraStatus, "success", "Jira is configured");
        }

        // Badges (issue tracker)
        document.getElementById("github-badge").innerHTML = badge(d.github?.configured);
        document.getElementById("linear-badge").innerHTML = badge(d.linear?.configured);

        // Dynamic SCM rows — only show configured providers
        const scmContainer = document.getElementById("scm-status");
        const scmProviders = [
          { key: "github", label: "GitHub" },
          { key: "bitbucket", label: "Bitbucket" },
          { key: "gitlab", label: "GitLab" },
        ];
        const configuredScm = scmProviders.filter(p => d[p.key]?.configured);
        if (configuredScm.length > 0) {
          scmContainer.innerHTML = configuredScm.map(p =>
            '<div class="scm-row"><span>' + p.label + ':</span> ' + badge(true) + '</div>'
          ).join("");
        } else {
          scmContainer.innerHTML = '<p style="color:var(--muted)">No source control connected. Configure in <a href="#" id="btn-scm-web-link" style="color:var(--vscode-textLink-foreground)">web settings</a>.</p>';
          const scmLink = document.getElementById("btn-scm-web-link");
          if (scmLink) scmLink.addEventListener("click", (e) => { e.preventDefault(); vscode.postMessage({ type: "open-web-settings" }); });
        }

        // Populate target repo from SCM-specific default
        const scm = d.scmProvider || "github";
        let defaultRepo = "";
        if (scm === "github" && d.github?.defaultRepo) defaultRepo = d.github.defaultRepo;
        else if (scm === "bitbucket" && d.bitbucket?.defaultRepo) defaultRepo = d.bitbucket.defaultRepo;
        else if (scm === "gitlab" && d.gitlab?.defaultRepo) defaultRepo = d.gitlab.defaultRepo;
        const repoInput = document.getElementById("default-repo");
        if (repoInput) repoInput.value = defaultRepo;

        // Show plan in Account section
        const planInfo = document.getElementById("plan-info");
        const planName = document.getElementById("plan-name");
        planInfo.classList.remove("hidden");
        const planLabel = (d.plan || "pro").charAt(0).toUpperCase() + (d.plan || "pro").slice(1);
        planName.textContent = planLabel;
        planName.className = "badge " + ((d.plan === "max" || d.plan === "enterprise") ? "configured" : "not-configured");
      }

      // Model messages
      if (msg.type === "models-saving") {
        const ms = document.getElementById("models-status");
        showStatus(ms, "info", "Saving...");
      }
      if (msg.type === "models-saved") {
        const ms = document.getElementById("models-status");
        showStatus(ms, "success", "Models updated");
        setTimeout(() => ms.classList.remove("visible"), 3000);
      }
      if (msg.type === "models-save-error") {
        const ms = document.getElementById("models-status");
        showStatus(ms, "error", msg.message || "Failed to save models");
      }

      if (msg.type === "tracker-saved") {
        showStatus(trackerStatus, "success", "Issue tracker updated");
        setTimeout(() => trackerStatus.classList.remove("visible"), 3000);
      }

      if (msg.type === "error") {
        loadingEl.textContent = msg.message;
      }

      if (msg.type === "saving") {
        showStatus(jiraStatus, "info", "Saving...");
      }
      if (msg.type === "save-success") {
        showStatus(jiraStatus, "success", msg.message);
      }
      if (msg.type === "save-error") {
        showStatus(jiraStatus, "error", msg.message);
      }

      if (msg.type === "testing") {
        showStatus(jiraStatus, "info", "Testing connection...");
      }
      if (msg.type === "test-success") {
        showStatus(jiraStatus, "success", msg.message);
      }
      if (msg.type === "test-error") {
        showStatus(jiraStatus, "error", msg.message);
      }

      // Repo messages
      if (msg.type === "repo-saved") {
        const repoStatus = document.getElementById("repo-status");
        showStatus(repoStatus, "success", msg.message || "Repository saved");
        setTimeout(() => repoStatus.classList.remove("visible"), 3000);
      }
      if (msg.type === "repo-save-error") {
        const repoStatus = document.getElementById("repo-status");
        showStatus(repoStatus, "error", msg.message || "Failed to save repository");
      }

      // Sandbox messages
      if (msg.type === "sandbox-loaded") {
        sandboxToggle.checked = msg.sandbox === "docker";
        if (msg.dockerAvailable) {
          sandboxToggle.disabled = false;
          showStatus(sandboxStatus, "info", msg.sandbox === "docker" ? "Docker sandbox is active" : "Docker is available");
        } else if (msg.dockerInstalled) {
          sandboxToggle.disabled = true;
          showStatus(sandboxStatus, "error", "Docker is installed but not running — start Docker Desktop to enable sandbox mode");
        } else {
          sandboxToggle.disabled = true;
          showStatus(sandboxStatus, "error", "Docker not detected — install Docker to enable sandbox mode");
        }
      }
      if (msg.type === "sandbox-restarting") {
        sandboxToggle.disabled = true;
        showStatus(sandboxStatus, "info", "Restarting agent...");
      }
      if (msg.type === "sandbox-updated") {
        sandboxToggle.disabled = false;
        sandboxToggle.checked = msg.sandbox === "docker";
        if (msg.error) {
          showStatus(sandboxStatus, "error", msg.error);
        } else {
          showStatus(sandboxStatus, "success", msg.sandbox === "docker" ? "Docker sandbox enabled — agent restarted" : "Docker sandbox disabled — agent restarted");
          setTimeout(() => { sandboxStatus.className = "status"; }, 5000);
        }
      }
    });

    // Initial load
    vscode.postMessage({ type: "load-integrations" });
    vscode.postMessage({ type: "load-sandbox" });
  </script>
</body>
</html>`;
  }
}
