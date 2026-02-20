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

function readAgentConfig(): { apiUrl: string; apiKey: string } | null {
  try {
    const configPath = path.join(os.homedir(), ".workermill", "config.json");
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (raw.apiUrl && raw.apiKey) return { apiUrl: raw.apiUrl, apiKey: raw.apiKey };
  } catch { /* no config */ }
  return null;
}

function httpsRequest<T>(
  method: string,
  url: string,
  apiKey: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
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

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method,
        headers,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          httpsRequest<T>(method, res.headers.location, apiKey, body).then(resolve, reject);
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
      } else if (msg.type === "open-web-settings") {
        vscode.env.openExternal(vscode.Uri.parse(`${config.apiUrl}/settings`));
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
      const { status, data } = await httpsRequest<Record<string, unknown>>(
        "GET",
        `${config.apiUrl}/api/settings/integrations`,
        config.apiKey,
      );
      if (status >= 200 && status < 300) {
        this.postMessage({ type: "integrations-loaded", data });
      } else {
        this.postMessage({ type: "error", message: `Failed to load settings (HTTP ${status})` });
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
      const { status, data } = await httpsRequest<{ success?: boolean; error?: string }>(
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
      const { status } = await httpsRequest<{ error?: string }>(
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

  private async testJira(config: { apiUrl: string; apiKey: string }): Promise<void> {
    try {
      this.postMessage({ type: "testing" });
      const { status, data } = await httpsRequest<{ success?: boolean; message?: string; error?: string; user?: string }>(
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
      --input-border: var(--vscode-input-border, var(--vscode-widget-border, ***REMOVED***444));
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --btn-secondary-bg: var(--vscode-button-secondaryBackground);
      --btn-secondary-fg: var(--vscode-button-secondaryForeground);
      --success: var(--vscode-charts-green, ***REMOVED***3fb950);
      --error: var(--vscode-errorForeground, ***REMOVED***f85149);
      --muted: var(--vscode-descriptionForeground);
      --separator: var(--vscode-widget-border, ***REMOVED***333);
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
  </style>
</head>
<body>
  <h1>Settings</h1>
  <p class="subtitle">Configure integrations for your WorkerMill workspace</p>

  <div id="loading" class="loading">Loading settings...</div>

  <div id="content" class="hidden">
    <!-- Issue Tracker -->
    <div class="section">
      <h2>Issue Tracker</h2>
      <div class="radio-group">
        <label><input type="radio" name="tracker" value="jira" /> Jira</label>
        <label><input type="radio" name="tracker" value="github-issues" /> GitHub Issues</label>
        <label><input type="radio" name="tracker" value="linear" /> Linear</label>
        <label><input type="radio" name="tracker" value="internal" /> Internal Boards</label>
      </div>

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
      <div id="scm-status">
        <p>GitHub: <span id="scm-github-badge"></span></p>
        <p>Bitbucket: <span id="scm-bitbucket-badge"></span></p>
        <p>GitLab: <span id="scm-gitlab-badge"></span></p>
      </div>
      <div class="hint" style="margin-top: 8px;">Manage SCM tokens in <button class="btn-link" id="btn-web-settings-scm">web settings</button>.</div>
    </div>

    <!-- Account -->
    <div class="section">
      <h2>Account</h2>
      <div class="btn-row">
        <button class="btn-secondary" id="btn-dashboard">Open Dashboard</button>
        <button class="btn-secondary" id="btn-web-settings">All Settings (Web)</button>
      </div>
    </div>
  </div>

  <div class="footer">
    WorkerMill v0.1.7 &mdash; <a href="https://workermill.com/docs">Documentation</a>
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

        // Select current tracker radio
        const tracker = d.defaultIssueTracker || "jira";
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

        // Badges
        document.getElementById("github-badge").innerHTML = badge(d.github?.configured);
        document.getElementById("linear-badge").innerHTML = badge(d.linear?.configured);
        document.getElementById("scm-github-badge").innerHTML = badge(d.github?.configured);
        document.getElementById("scm-bitbucket-badge").innerHTML = badge(d.bitbucket?.configured);
        document.getElementById("scm-gitlab-badge").innerHTML = badge(d.gitlab?.configured);
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
    });

    // Initial load
    vscode.postMessage({ type: "load-integrations" });
  </script>
</body>
</html>`;
  }
}
