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
  writeAgentConfig,
  readApiKeyFromKeychain,
  writeApiKeyToKeychain,
  stripApiKeyFromConfig,
} from "./agent-installer";
import { getApiKey, storeApiKey } from "./secret-storage";

function readAgentConfig(): {
  apiUrl: string;
  apiKey: string;
  orgId?: string;
  orgName?: string;
  orgSlug?: string;
} | null {
  try {
    const configPath = path.join(os.homedir(), ".workermill", "config.json");
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    if (!raw.apiUrl) return null;

    // Try OS keychain first, fall back to config.json plaintext
    let apiKey = readApiKeyFromKeychain();
    if (!apiKey && raw.apiKey) {
      apiKey = raw.apiKey;
    }
    if (!apiKey) return null;

    return {
      apiUrl: raw.apiUrl,
      apiKey,
      orgId: raw.orgId,
      orgName: raw.orgName,
      orgSlug: raw.orgSlug,
    };
  } catch {
    /* no config */
  }
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
      } else if (msg.type === "set-docker-memory") {
        await this.setDockerMemory(msg.dockerMemoryGb);
        return;
      } else if (msg.type === "pull-sandbox-image") {
        this.pullSandboxImage();
        return;
      } else if (msg.type === "sign-out") {
        vscode.commands.executeCommand("workermill.signOut");
        return;
      } else if (msg.type === "load-rag") {
        await this.loadRag();
        return;
      } else if (msg.type === "toggle-rag") {
        await this.toggleRag(msg.enabled);
        return;
      } else if (msg.type === "set-ollama-port") {
        await this.setOllamaPort(msg.port);
        return;
      } else if (msg.type === "index-repo") {
        await this.indexRepo(msg.repository);
        return;
      } else if (msg.type === "setup-rag") {
        await this.setupRag();
        return;
      }

      // ── Cloud mode: requires API credentials ──
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
        const dashboardBase = config.apiUrl;
        vscode.env.openExternal(vscode.Uri.parse(`${dashboardBase}/dashboard`));
      } else if (msg.type === "save-repo") {
        await this.saveRepo(config, msg.defaultRepo, msg.provider);
      } else if (msg.type === "save-scm") {
        await this.saveScm(config, msg);
      } else if (msg.type === "test-scm-bitbucket") {
        await this.testBitbucket(config);
      } else if (msg.type === "test-scm-github") {
        await this.testScm(config, "github");
      } else if (msg.type === "test-scm-gitlab") {
        await this.testScm(config, "gitlab");
      } else if (msg.type === "open-web-settings") {
        const settingsBase = config.apiUrl;
        vscode.env.openExternal(vscode.Uri.parse(`${settingsBase}/settings`));
      } else if (msg.type === "open-pricing") {
        vscode.env.openExternal(vscode.Uri.parse(`${config.apiUrl}/pricing`));
      } else if (msg.type === "save-models") {
        await this.saveModels(config, msg);
      } else if (msg.type === "save-worker-behavior") {
        await this.saveWorkerBehavior(config, msg);
      } else if (msg.type === "save-quality-gate") {
        await this.saveQualityGate(config, msg);
      } else if (msg.type === "save-linear") {
        await this.saveLinear(config, msg);
      } else if (msg.type === "switch-org") {
        await this.switchOrg(config, msg.orgId);
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

  private async loadIntegrations(config: {
    apiUrl: string;
    apiKey: string;
    orgId?: string;
  }): Promise<void> {
    try {
      const [intResult, settingsResult, orgsResult] = await Promise.all([
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
        apiRequest<Array<{ id: string; name: string; slug: string; role: string }>>(
          "GET",
          `${config.apiUrl}/api/settings/organizations`,
          config.apiKey,
        ),
      ]);
      if (intResult.status >= 200 && intResult.status < 300) {
        const orgs =
          orgsResult.status >= 200 && orgsResult.status < 300
            ? orgsResult.data
            : [];
        const s = settingsResult.data || {};
        const merged = {
          ...s,
          ...intResult.data,
          orgName: s.name,
          orgSlug: s.slug,
          orgId: s.id || config.orgId,
          defaultWorkerModel: s.defaultWorkerModel,
          managerModelId: s.managerModelId,
          planningAgentModel: s.planningAgentModel,
          organizations: orgs,
        };
        this.postMessage({ type: "integrations-loaded", data: merged });
      } else {
        this.postMessage({
          type: "error",
          message: `Failed to load settings (HTTP ${intResult.status})`,
        });
      }
    } catch (err) {
      this.postMessage({
        type: "error",
        message: `Could not reach API: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ── Cloud mode handlers ──

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
      const { status, data } = await apiRequest<{ success?: boolean; error?: string; settings?: Record<string, unknown> }>(
        "PUT",
        `${config.apiUrl}/api/settings`,
        config.apiKey,
        {
          defaultWorkerModel: msg.workerModel,
          managerModelId: msg.reviewerModel,
          planningAgentModel: msg.plannerModel,
        },
      );
      if (status >= 200 && status < 300 && data?.success) {
        // Verify the API echoed back the correct values
        const saved = data.settings;
        const workerOk = !saved || saved.defaultWorkerModel === msg.workerModel;
        const reviewerOk = !saved || saved.managerModelId === msg.reviewerModel;
        const plannerOk = !saved || saved.planningAgentModel === msg.plannerModel;
        if (workerOk && reviewerOk && plannerOk) {
          this.postMessage({ type: "models-saved" });
        } else {
          this.postMessage({ type: "models-save-error", message: `Save confirmed but values differ — got worker=${saved?.defaultWorkerModel}, reviewer=${saved?.managerModelId}, planner=${saved?.planningAgentModel}` });
        }
      } else if (status >= 200 && status < 300) {
        // 2xx but no success flag — might be a different response shape
        this.postMessage({ type: "models-save-error", message: `Unexpected response: ${JSON.stringify(data).substring(0, 200)}` });
      } else {
        this.postMessage({ type: "models-save-error", message: `HTTP ${status}: ${data?.error || JSON.stringify(data).substring(0, 200)}` });
      }
    } catch (err) {
      this.postMessage({ type: "models-save-error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async saveWorkerBehavior(
    config: { apiUrl: string; apiKey: string },
    msg: {
      maxPerStoryRevisions: number;
      maxReviewRevisions: number;
      maxFixRetries: number;
      blockerWaitTimeoutMinutes: number;
      pushAfterCommit: boolean;
      maxParallelExperts: number;
      maxStories: number;
      maxTargetFiles: number;
      selfReviewEnabled: boolean;
      blockerAutoRetryEnabled: boolean;
      gracefulShutdownEnabled: boolean;
    },
  ): Promise<void> {
    try {
      this.postMessage({ type: "saving" });
      const { status, data } = await apiRequest<{ success?: boolean; error?: string }>(
        "PUT",
        `${config.apiUrl}/api/settings`,
        config.apiKey,
        {
          maxPerStoryRevisions: msg.maxPerStoryRevisions,
          maxReviewRevisions: msg.maxReviewRevisions,
          maxFixRetries: msg.maxFixRetries,
          blockerWaitTimeoutMinutes: msg.blockerWaitTimeoutMinutes,
          pushAfterCommit: msg.pushAfterCommit,
          maxParallelExperts: msg.maxParallelExperts,
          maxStories: msg.maxStories,
          maxTargetFiles: msg.maxTargetFiles,
          selfReviewEnabled: msg.selfReviewEnabled,
          blockerAutoRetryEnabled: msg.blockerAutoRetryEnabled,
          gracefulShutdownEnabled: msg.gracefulShutdownEnabled,
        },
      );
      if (status >= 200 && status < 300) {
        this.postMessage({ type: "worker-behavior-saved" });
      } else {
        this.postMessage({ type: "worker-behavior-save-error", message: data?.error || `HTTP ${status}` });
      }
    } catch (err) {
      this.postMessage({ type: "worker-behavior-save-error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async saveQualityGate(
    config: { apiUrl: string; apiKey: string },
    msg: {
      qualityGateEnabled: boolean;
      blockOnTypeErrors: boolean;
      blockOnTestFailures: boolean;
      blockOnLintErrors: boolean;
      blockOnE2EFailures: boolean;
      autoFixEnabled: boolean;
      autoFixMaxIterations: number;
    },
  ): Promise<void> {
    try {
      this.postMessage({ type: "saving" });
      const { status, data } = await apiRequest<{ success?: boolean; error?: string }>(
        "PUT",
        `${config.apiUrl}/api/settings`,
        config.apiKey,
        {
          qualityGateEnabled: msg.qualityGateEnabled,
          blockOnTypeErrors: msg.blockOnTypeErrors,
          blockOnTestFailures: msg.blockOnTestFailures,
          blockOnLintErrors: msg.blockOnLintErrors,
          blockOnE2EFailures: msg.blockOnE2EFailures,
          autoFixEnabled: msg.autoFixEnabled,
          autoFixMaxIterations: msg.autoFixMaxIterations,
        },
      );
      if (status >= 200 && status < 300) {
        this.postMessage({ type: "quality-gate-saved" });
      } else {
        this.postMessage({ type: "quality-gate-save-error", message: data?.error || `HTTP ${status}` });
      }
    } catch (err) {
      this.postMessage({ type: "quality-gate-save-error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async saveLinear(
    config: { apiUrl: string; apiKey: string },
    msg: { apiKey: string },
  ): Promise<void> {
    try {
      this.postMessage({ type: "saving" });
      const { status, data } = await apiRequest<{ success?: boolean; error?: string }>(
        "PUT",
        `${config.apiUrl}/api/settings/integrations/linear`,
        config.apiKey,
        { api_key: msg.apiKey },
      );
      if (status >= 200 && status < 300) {
        this.postMessage({ type: "save-success", message: "Linear API key saved" });
        await this.loadIntegrations(config);
      } else {
        this.postMessage({ type: "save-error", message: (data as { error?: string }).error || `HTTP ${status}` });
      }
    } catch (err) {
      this.postMessage({ type: "save-error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async saveRepo(
    config: { apiUrl: string; apiKey: string },
    defaultRepo: string,
    provider: string = "github",
  ): Promise<void> {
    try {
      const { status, data } = await apiRequest<{ success?: boolean; error?: string }>(
        "PUT",
        `${config.apiUrl}/api/settings/integrations/${provider}`,
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

  private async saveScm(
    config: { apiUrl: string; apiKey: string },
    msg: { provider: string; token?: string; reviewerToken?: string; username?: string; appPassword?: string },
  ): Promise<void> {
    try {
      this.postMessage({ type: "scm-saving" });

      const endpointMap: Record<string, string> = {
        github: "/api/settings/integrations/github",
        bitbucket: "/api/settings/integrations/bitbucket",
        gitlab: "/api/settings/integrations/gitlab",
      };
      const endpoint = endpointMap[msg.provider];
      if (!endpoint) {
        this.postMessage({ type: "scm-save-error", message: `Unknown SCM provider: ${msg.provider}` });
        return;
      }

      let body: Record<string, string> = {};
      if (msg.provider === "github") {
        if (!msg.token) {
          this.postMessage({ type: "scm-save-error", message: "Token is required" });
          return;
        }
        body = { token: msg.token };
        if (msg.reviewerToken) body.reviewerToken = msg.reviewerToken;
      } else if (msg.provider === "bitbucket") {
        if (!msg.appPassword) {
          this.postMessage({ type: "scm-save-error", message: "Token is required" });
          return;
        }
        body = { appPassword: msg.appPassword };
        // The UI "username" field is actually the Bitbucket email address.
        // API needs it as both: email (for REST API auth) and username (legacy compat).
        if (msg.username) {
          body.email = msg.username;
          body.username = msg.username;
        }
      } else if (msg.provider === "gitlab") {
        if (!msg.token) {
          this.postMessage({ type: "scm-save-error", message: "Token is required" });
          return;
        }
        body = { token: msg.token };
      }

      const { status, data } = await apiRequest<{ success?: boolean; error?: string }>(
        "PUT",
        `${config.apiUrl}${endpoint}`,
        config.apiKey,
        body,
      );

      if (status >= 200 && status < 300) {
        // Also set this as the default SCM provider
        await apiRequest("PUT", `${config.apiUrl}/api/settings`, config.apiKey, {
          scmProvider: msg.provider,
        });
        this.postMessage({ type: "scm-saved", message: `${msg.provider} credentials saved` });
        await this.loadIntegrations(config);
      } else {
        this.postMessage({
          type: "scm-save-error",
          message: (data as { error?: string }).error || `HTTP ${status}`,
        });
      }
    } catch (err) {
      this.postMessage({
        type: "scm-save-error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async loadSandbox(): Promise<void> {
    const configPath = path.join(os.homedir(), ".workermill", "config.json");
    let dockerMemoryGb: number = 4;
    const totalRamGb = Math.round(os.totalmem() / (1024 * 1024 * 1024));
    const maxDockerMemoryGb = Math.max(4, totalRamGb - 4); // leave 4 GB for OS
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (raw.dockerMemoryGb && raw.dockerMemoryGb >= 4 && raw.dockerMemoryGb <= maxDockerMemoryGb) {
        dockerMemoryGb = raw.dockerMemoryGb;
      }
    } catch {
      /* no config */
    }

    let dockerAvailable = false;
    try {
      execFileSync("docker", ["version"], { timeout: 5000, stdio: "pipe", windowsHide: true });
      dockerAvailable = true;
    } catch {
      /* Docker not available */
    }

    this.postMessage({
      type: "sandbox-loaded",
      sandbox: "docker",
      dockerAvailable,
      dockerInstalled: dockerAvailable,
      dockerMemoryGb,
      maxDockerMemoryGb,
      totalRamGb,
    });
  }

  // toggleSandbox kept for memory changes only — sandbox is always Docker
  private async toggleSandbox(_enabled: boolean): Promise<void> {
    // Sandbox cannot be disabled — Docker is required
    this.postMessage({ type: "sandbox-updated", sandbox: "docker" });
  }

  private async setDockerMemory(gb: number): Promise<void> {
    const configPath = path.join(os.homedir(), ".workermill", "config.json");
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      /* no config */
    }

    config.dockerMemoryGb = gb;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });

    // Restart agent if sandbox is active so the new limit takes effect
    if (config.sandbox === "docker") {
      try {
        await stopAgentProcess();
        startAgentProcess();
        await waitForAgentReady(undefined, 20_000);
      } catch {
        // Non-fatal — setting is saved, agent will pick it up on next start
      }
    }

    this.postMessage({ type: "docker-memory-saved", dockerMemoryGb: gb });
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

  private async loadRag(): Promise<void> {
    const configPath = path.join(os.homedir(), ".workermill", "config.json");
    let localRag = false;
    let ollamaPort = 11434;
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (raw.localRag === true) localRag = true;
      if (raw.ollamaPort && typeof raw.ollamaPort === "number") ollamaPort = raw.ollamaPort;
    } catch {
      /* no config */
    }

    // Query agent local API for GPU/Ollama status
    let gpu: { available: boolean; vendor: string; model: string | null; memoryMb: number | null } = {
      available: false,
      vendor: "none",
      model: null,
      memoryMb: null,
    };
    let ollama: { installed: boolean; running: boolean; models: string[] } = {
      installed: false,
      running: false,
      models: [],
    };

    const agentPort = this.readAgentPort();
    if (agentPort) {
      try {
        const ragStatus = await this.agentApiGet<{
          gpu: typeof gpu;
          ollama: typeof ollama;
          localRagEnabled: boolean;
        }>(agentPort, "/api/rag/status");
        gpu = ragStatus.gpu;
        ollama = ragStatus.ollama;
      } catch {
        // Agent not reachable — show config-only state
      }
    }

    this.postMessage({ type: "rag-loaded", localRag, ollamaPort, gpu, ollama });
  }

  private async toggleRag(enabled: boolean): Promise<void> {
    const configPath = path.join(os.homedir(), ".workermill", "config.json");
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      /* no config */
    }

    config.localRag = enabled;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });

    this.postMessage({ type: "rag-restarting" });

    try {
      await stopAgentProcess();
      startAgentProcess();
      const port = await waitForAgentReady(undefined, 20_000);
      if (port) {
        this.postMessage({ type: "rag-updated", localRag: enabled });
        // Refresh full RAG status after restart
        await this.loadRag();
      } else {
        this.postMessage({
          type: "rag-updated",
          localRag: enabled,
          error: "Agent restarted but did not become ready. Check agent logs.",
        });
      }
    } catch (err) {
      this.postMessage({
        type: "rag-updated",
        localRag: enabled,
        error: `Agent restart failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  private async setOllamaPort(port: number): Promise<void> {
    const configPath = path.join(os.homedir(), ".workermill", "config.json");
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      /* no config */
    }

    config.ollamaPort = port;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });

    // Restart if local RAG is active so the port change takes effect
    if (config.localRag === true) {
      try {
        await stopAgentProcess();
        startAgentProcess();
        await waitForAgentReady(undefined, 20_000);
      } catch {
        // Non-fatal — setting is saved
      }
    }

    this.postMessage({ type: "ollama-port-saved", ollamaPort: port });
  }

  private async indexRepo(repository: string): Promise<void> {
    const agentPort = this.readAgentPort();
    if (!agentPort) {
      this.postMessage({ type: "index-error", error: "Agent not running" });
      return;
    }

    // Subscribe to SSE for indexing progress
    const sseHeaders: Record<string, string> = { Accept: "text/event-stream" };
    const token = this.readAgentToken();
    if (token) sseHeaders["Authorization"] = `Bearer ${token}`;
    const sseReq = http.get(
      { hostname: "127.0.0.1", port: agentPort, path: "/api/stream/rag", headers: sseHeaders },
      (res) => {
        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf-8");
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            const eventMatch = part.match(/^event:\s*(.+)$/m);
            const dataMatch = part.match(/^data:\s*(.+)$/m);
            if (eventMatch && dataMatch) {
              try {
                const data = JSON.parse(dataMatch[1]);
                if (eventMatch[1] === "rag:progress") {
                  const msg = data.indexed && data.total
                    ? `${data.message} (${data.indexed}/${data.total})`
                    : data.message;
                  this.postMessage({ type: "index-progress", message: msg });
                } else if (eventMatch[1] === "rag:complete") {
                  const msg = data.indexedFiles != null
                    ? `Done — ${data.indexedFiles} files, ${data.totalChunks} chunks indexed`
                    : "Indexing complete";
                  this.postMessage({ type: "index-complete", message: msg });
                  sseReq.destroy();
                } else if (eventMatch[1] === "rag:error") {
                  this.postMessage({ type: "index-error", error: data.error });
                  sseReq.destroy();
                }
              } catch { /* ignore parse errors */ }
            }
          }
        });
      },
    );
    sseReq.on("error", () => { /* SSE failed — indexing still runs */ });

    // Trigger indexing — returns 202 immediately
    try {
      await this.agentApiPost(agentPort, "/api/rag/index", { repository });
      this.postMessage({ type: "indexing-started" });
    } catch (err) {
      this.postMessage({
        type: "index-error",
        error: err instanceof Error ? err.message : String(err),
      });
      sseReq.destroy();
    }
  }

  private async setupRag(): Promise<void> {
    const agentPort = this.readAgentPort();
    if (!agentPort) {
      this.postMessage({ type: "rag-setup-error", error: "Agent not running" });
      return;
    }

    // Subscribe to SSE for progress updates
    const sseHeaders: Record<string, string> = { Accept: "text/event-stream" };
    const sseToken = this.readAgentToken();
    if (sseToken) sseHeaders["Authorization"] = `Bearer ${sseToken}`;
    const sseReq = http.get(
      { hostname: "127.0.0.1", port: agentPort, path: "/api/stream/rag", headers: sseHeaders },
      (res) => {
        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf-8");
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            const eventMatch = part.match(/^event:\s*(.+)$/m);
            const dataMatch = part.match(/^data:\s*(.+)$/m);
            if (eventMatch && dataMatch) {
              try {
                const data = JSON.parse(dataMatch[1]);
                if (eventMatch[1] === "rag:setup-progress") {
                  this.postMessage({ type: "rag-setup-progress", message: data.message });
                } else if (eventMatch[1] === "rag:setup-complete") {
                  this.postMessage({ type: "rag-setup-complete" });
                  this.loadRag(); // Refresh full status
                  sseReq.destroy();
                } else if (eventMatch[1] === "rag:setup-error") {
                  this.postMessage({ type: "rag-setup-error", error: data.error });
                  sseReq.destroy();
                }
              } catch { /* ignore parse errors */ }
            }
          }
        });
      },
    );
    sseReq.on("error", () => { /* SSE connection failed — progress won't show but setup still runs */ });

    // Trigger setup — returns 202 immediately; progress/completion/error come via SSE
    try {
      await this.agentApiPost(agentPort, "/api/rag/setup", {});
    } catch (err) {
      this.postMessage({
        type: "rag-setup-error",
        error: err instanceof Error ? err.message : String(err),
      });
      sseReq.destroy();
    }
    // SSE stream stays open — destroyed when setup-complete or setup-error arrives
  }

  private readAgentPort(): number | null {
    try {
      const portFile = path.join(os.homedir(), ".workermill", "agent.port");
      if (fs.existsSync(portFile)) {
        const port = parseInt(fs.readFileSync(portFile, "utf-8").trim(), 10);
        return isNaN(port) ? null : port;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  private readAgentToken(): string | null {
    try {
      const tokenFile = path.join(os.homedir(), ".workermill", "agent.token");
      if (fs.existsSync(tokenFile)) {
        return fs.readFileSync(tokenFile, "utf-8").trim() || null;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  private agentApiGet<T>(port: number, urlPath: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = { Accept: "application/json" };
      const token = this.readAgentToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const req = http.get(
        { hostname: "127.0.0.1", port, path: urlPath, headers },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(body) as T);
            } catch {
              reject(new Error("Invalid JSON"));
            }
          });
        },
      );
      req.on("error", reject);
      req.setTimeout(10_000, () => {
        req.destroy();
        reject(new Error("Timeout"));
      });
    });
  }

  private agentApiPost(port: number, urlPath: string, data: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(data);
      const postHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(payload)),
      };
      const token = this.readAgentToken();
      if (token) postHeaders["Authorization"] = `Bearer ${token}`;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: urlPath,
          method: "POST",
          headers: postHeaders,
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(body);
              if (res.statusCode && res.statusCode >= 400) {
                reject(
                  new Error(
                    (parsed as { error?: string })?.error || `HTTP ${res.statusCode}`,
                  ),
                );
                return;
              }
              resolve(parsed);
            } catch {
              reject(new Error("Invalid JSON"));
            }
          });
        },
      );
      req.on("error", reject);
      req.setTimeout(30_000, () => {
        req.destroy();
        reject(new Error("Timeout"));
      });
      req.write(payload);
      req.end();
    });
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

  private async testBitbucket(config: { apiUrl: string; apiKey: string }): Promise<void> {
    try {
      this.postMessage({ type: "scm-test-testing", provider: "bitbucket" });
      const { status, data } = await apiRequest<{ success?: boolean; message?: string; error?: string; user?: string }>(
        "POST",
        `${config.apiUrl}/api/settings/integrations/bitbucket/test`,
        config.apiKey,
      );
      if (status >= 200 && status < 300 && (data as { success?: boolean }).success) {
        this.postMessage({ type: "scm-test-success", provider: "bitbucket", message: `Connected as ${(data as { user?: string }).user || "unknown"}` });
      } else {
        this.postMessage({ type: "scm-test-error", provider: "bitbucket", message: (data as { error?: string }).error || `HTTP ${status}` });
      }
    } catch (err) {
      this.postMessage({ type: "scm-test-error", provider: "bitbucket", message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async testScm(config: { apiUrl: string; apiKey: string }, provider: "github" | "gitlab"): Promise<void> {
    try {
      this.postMessage({ type: "scm-test-testing", provider });
      const { status, data } = await apiRequest<{ success?: boolean; message?: string; error?: string; user?: string }>(
        "POST",
        `${config.apiUrl}/api/settings/integrations/${provider}/test`,
        config.apiKey,
      );
      if (status >= 200 && status < 300 && (data as { success?: boolean }).success) {
        // GitHub returns user in workerToken.user, GitLab returns in user directly
        const d = data as { workerToken?: { user?: string }; user?: string };
        const user = (provider === "github" ? d.workerToken?.user : d.user) || "connected";
        this.postMessage({ type: "scm-test-success", provider, message: `Connected as ${user}` });
      } else {
        this.postMessage({ type: "scm-test-error", provider, message: (data as { error?: string }).error || `HTTP ${status}` });
      }
    } catch (err) {
      this.postMessage({ type: "scm-test-error", provider, message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async switchOrg(
    config: { apiUrl: string; apiKey: string },
    orgId: string,
  ): Promise<void> {
    try {
      this.postMessage({ type: "org-switching" });

      const { status, data } = await apiRequest<{
        apiKey: string;
        orgId: string;
        orgName: string;
        orgSlug: string;
      }>("POST", `${config.apiUrl}/api/auth/switch-org-key`, config.apiKey, {
        orgId,
      });

      if (status < 200 || status >= 300) {
        this.postMessage({
          type: "org-switch-error",
          message: `Failed to switch org (HTTP ${status})`,
        });
        return;
      }

      // Store new API key in secure storage + keychain
      await storeApiKey(data.apiKey);
      const keychainOk = writeApiKeyToKeychain(data.apiKey);

      // Write config (apiKey only to disk as fallback if keychain failed)
      writeAgentConfig({
        apiUrl: config.apiUrl,
        apiKey: keychainOk ? "" : data.apiKey,
        orgId: data.orgId,
        orgName: data.orgName,
        orgSlug: data.orgSlug,
      });
      if (keychainOk) {
        stripApiKeyFromConfig();
      }

      // Restart agent with new config (same pattern as sandbox toggle)
      this.postMessage({ type: "org-switching" });
      await stopAgentProcess();
      startAgentProcess();
      const port = await waitForAgentReady(undefined, 20_000);

      if (port) {
        // Reload settings panel data with new org context
        const newConfig = readAgentConfig();
        if (newConfig) {
          await this.loadIntegrations(newConfig);
        }
        this.postMessage({ type: "org-switched", orgName: data.orgName });
      } else {
        this.postMessage({
          type: "org-switch-error",
          message: "Agent restarted but did not become ready. Check agent logs.",
        });
      }
    } catch (err) {
      this.postMessage({
        type: "org-switch-error",
        message: `Switch failed: ${err instanceof Error ? err.message : String(err)}`,
      });
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
      --accent-setup: var(--vscode-textLink-foreground, #4da6ff);
      --accent-integration: var(--vscode-charts-green, #3fb950);
      --accent-advanced: var(--vscode-charts-orange, #d29922);
      --accent-account: var(--vscode-descriptionForeground, #888);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      background: var(--bg);
      color: var(--fg);
      padding: 24px;
    }
    .settings-layout {
      display: flex;
      gap: 24px;
      max-width: 920px;
    }
    .settings-nav {
      position: sticky;
      top: 0;
      align-self: flex-start;
      width: 180px;
      min-width: 180px;
      padding-top: 8px;
    }
    .settings-nav a {
      display: block;
      padding: 5px 12px;
      color: var(--muted);
      text-decoration: none;
      font-size: 0.85em;
      border-left: 2px solid transparent;
      margin-bottom: 2px;
      border-radius: 0 3px 3px 0;
    }
    .settings-nav a:hover {
      color: var(--fg);
      background: color-mix(in srgb, var(--fg) 5%, transparent);
    }
    .settings-nav a.active {
      color: var(--fg);
      font-weight: 600;
      border-left-color: var(--btn-bg);
    }
    .settings-nav .nav-group {
      margin-bottom: 12px;
    }
    .settings-nav .nav-group-label {
      font-size: 0.7em;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      padding: 0 12px;
      margin-bottom: 4px;
    }
    .settings-content {
      flex: 1;
      max-width: 720px;
      min-width: 0;
    }
    @media (max-width: 500px) {
      .settings-nav { display: none; }
      .settings-layout { max-width: 100%; }
      .settings-content { max-width: 100%; }
    }
    h1 { font-size: 1.4em; margin-bottom: 4px; }
    .subtitle { color: var(--muted); margin-bottom: 24px; }
    .section {
      border: 1px solid var(--separator);
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 16px;
      border-left: 3px solid transparent;
    }
    .section-setup { border-left-color: var(--accent-setup); }
    .section-integration { border-left-color: var(--accent-integration); }
    .section-advanced { border-left-color: var(--accent-advanced); }
    .section-account { border-left-color: var(--accent-account); }
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
    .sandbox-warning {
      padding: 10px 14px;
      border-radius: 4px;
      margin-bottom: 12px;
      font-size: 0.9em;
      line-height: 1.4;
      background: color-mix(in srgb, var(--vscode-charts-orange, #d29922) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-charts-orange, #d29922) 30%, transparent);
      color: var(--fg);
    }
    .sandbox-warning strong {
      color: var(--vscode-charts-orange, #d29922);
    }
  </style>
</head>
<body>
  <h1>Settings</h1>
  <p class="subtitle">Configure integrations for your WorkerMill workspace <span id="org-label"></span></p>

  <div id="loading" class="loading">Loading settings...</div>

  <div class="settings-layout">
  <nav class="settings-nav hidden" id="settings-nav">
    <div class="nav-group">
      <div class="nav-group-label">Setup</div>
      <a href="#section-repo" data-section="section-repo">Target Repository</a>
      <a href="#section-scm" data-section="section-scm">Source Control</a>
      <a href="#section-models" data-section="section-models">AI Models</a>
    </div>
    <div class="nav-group">
      <div class="nav-group-label">Integrations</div>
      <a href="#section-tracker" data-section="section-tracker">Issue Tracker</a>
    </div>
    <div class="nav-group">
      <div class="nav-group-label">Advanced</div>
      <a href="#section-quality" data-section="section-quality">Quality Gate</a>
      <a href="#section-worker" data-section="section-worker">Worker Behavior</a>
      <a href="#section-docker" data-section="section-docker">Docker Sandbox</a>
      <a href="#section-rag" data-section="section-rag">Local RAG</a>
    </div>
    <div class="nav-group">
      <div class="nav-group-label">Account</div>
      <a href="#section-account" data-section="section-account">Account</a>
    </div>
  </nav>

  <div class="settings-content">
  <div id="content" class="hidden">
    <!-- Target Repository -->
    <div class="section section-setup" id="section-repo">
      <h2>Target Repository</h2>
      <p>The repository AI workers will target when running tasks.</p>
      <div class="field">
        <label>Default Repository</label>
        <input type="text" id="default-repo" placeholder="owner/repo" />
        <div class="hint">Format: <code>owner/repo</code> (e.g. workermill-examples/flagdeck)</div>
      </div>
      <div id="repo-status" class="status"></div>
    </div>

    <!-- Source Control -->
    <div class="section section-setup" id="section-scm">
      <h2>Source Control</h2>
      <div class="radio-group" style="flex-wrap: wrap;">
        <label><input type="radio" name="scm" value="github" /> GitHub <span id="scm-github-badge"></span></label>
        <label id="scm-bitbucket-label" class="locked-option"><input type="radio" name="scm" value="bitbucket" disabled /> Bitbucket <span class="pro-badge">MAX</span> <span id="scm-bitbucket-badge"></span></label>
        <!-- GitLab hidden — not yet tested -->
        <label id="scm-gitlab-label" class="locked-option" style="display:none;"><input type="radio" name="scm" value="gitlab" disabled /> GitLab <span class="pro-badge">MAX</span> <span id="scm-gitlab-badge"></span></label>
      </div>
      <div id="scm-upgrade" class="upgrade-hint hidden">Upgrade to Max to unlock Bitbucket. <a id="btn-upgrade-scm" href="#">View plans</a></div>

      <!-- GitHub SCM fields -->
      <div id="scm-github-fields" class="hidden">
        <div class="field">
          <label>Token</label>
          <input type="password" id="scm-github-token" placeholder="GitHub personal access token" />
          <div class="hint">Personal access token with repo scope</div>
        </div>
        <div class="field">
          <label>Reviewer Token (optional)</label>
          <input type="password" id="scm-github-reviewer-token" placeholder="GitHub personal access token" />
          <div class="hint">Separate token for PR approvals (uses main token if blank)</div>
        </div>
        <div class="btn-row">
          <button class="btn-secondary" id="btn-test-scm-github">Test Connection</button>
          <button class="btn-primary" id="btn-save-scm-github">Save</button>
        </div>
        <div id="scm-github-status" class="status"></div>
      </div>

      <!-- Bitbucket SCM fields -->
      <div id="scm-bitbucket-fields" class="hidden">
        <div class="field">
          <label>Username / Email</label>
          <input type="text" id="scm-bb-username" placeholder="email address (for app passwords)" />
        </div>
        <div class="field">
          <label>App Password or Repository Access Token</label>
          <input type="password" id="scm-bb-token" placeholder="App password or repository access token" />
          <div class="hint">App Password (requires username above) or Repository Access Token (username optional, defaults to x-token-auth)</div>
        </div>
        <div class="btn-row">
          <button class="btn-primary" id="btn-save-scm-bitbucket">Save</button>
          <button class="btn-secondary" id="btn-test-scm-bitbucket">Test Connection</button>
        </div>
        <div id="scm-bitbucket-status" class="status"></div>
      </div>

      <!-- GitLab SCM fields -->
      <div id="scm-gitlab-fields" class="hidden">
        <div class="field">
          <label>Token</label>
          <input type="password" id="scm-gitlab-token" placeholder="GitLab personal access token" />
          <div class="hint">Personal access token with api scope</div>
        </div>
        <div class="btn-row">
          <button class="btn-secondary" id="btn-test-scm-gitlab">Test Connection</button>
          <button class="btn-primary" id="btn-save-scm-gitlab">Save</button>
        </div>
        <div id="scm-gitlab-status" class="status"></div>
      </div>
    </div>

    <!-- AI Models -->
    <div class="section section-setup" id="section-models">
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
        <label>Planning Agent</label>
        <select id="model-planner"></select>
        <div class="hint">Model used by the planning agent</div>
      </div>
      <div id="models-status" class="status"></div>
    </div>

    <!-- Issue Tracker -->
    <div class="section section-integration" id="section-tracker">
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

      <!-- Linear info (cloud) -->
      <div id="linear-fields" class="hidden">
        <div id="linear-cloud-section">
          <p>Linear integration status: <span id="linear-badge"></span></p>
          <div class="hint">Configure Linear API key and webhook in <button class="btn-link" id="btn-web-settings-linear">web settings</button>.</div>
        </div>
      </div>

      <!-- GitHub Issues info -->
      <div id="github-fields" class="hidden">
        <div id="github-cloud-section">
          <p>GitHub Issues uses your GitHub token from sign-in. <span id="github-badge"></span></p>
          <div class="hint">No additional configuration needed — your SCM credentials were saved during onboarding.</div>
        </div>
      </div>

      <!-- Internal boards info -->
      <div id="boards-fields" class="hidden">
        <div id="boards-cloud-section">
          <p>Using WorkerMill internal boards — no external issue tracker needed.</p>
          <div class="hint">Create and manage boards from the <button class="btn-link" id="btn-dashboard-boards">dashboard</button>.</div>
        </div>
      </div>
    </div>

    <!-- Quality Gate -->
    <div class="section section-advanced" id="section-quality">
      <h2>Quality Gate</h2>
      <div class="field">
        <label style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="qg-enabled" checked />
          Enable Quality Gates
        </label>
        <div class="hint">Run quality checks (typecheck, lint, tests) before creating PRs.</div>
      </div>
      <div id="qg-options">
        <div class="field">
          <label style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="qg-block-type-errors" checked />
            Block on TypeScript errors
          </label>
          <div class="hint">Fail the quality gate if TypeScript type-check errors are found.</div>
        </div>
        <div class="field">
          <label style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="qg-block-test-failures" />
            Block on test failures
          </label>
          <div class="hint">Fail the quality gate if tests fail. Only enable if your repo has a test suite.</div>
        </div>
        <div class="field">
          <label style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="qg-block-lint-errors" checked />
            Block on lint errors
          </label>
          <div class="hint">Fail the quality gate if lint errors are found (ruff, eslint, etc.).</div>
        </div>
        <div class="field">
          <label style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="qg-block-e2e-failures" />
            Block on E2E test failures
          </label>
          <div class="hint">Fail the quality gate if end-to-end tests fail.</div>
        </div>
        <div class="field">
          <label style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="qg-autofix" checked />
            Auto-Fix Agent
          </label>
          <div class="hint">Automatically attempt to fix quality issues before blocking.</div>
        </div>
        <div class="field" id="qg-autofix-iterations-field">
          <label>Auto-Fix Max Iterations</label>
          <input type="number" id="qg-autofix-iterations" min="1" max="10" value="3" />
          <div class="hint">Max attempts for the auto-fix agent to resolve quality issues (1-10).</div>
        </div>
      </div>
      <div id="quality-gate-status" class="status"></div>
    </div>

    <!-- Worker Behavior -->
    <div class="section section-advanced" id="section-worker">
      <h2>Worker Behavior</h2>
      <div class="field">
        <label>PR Review Max Revisions</label>
        <input type="number" id="wk-pr-revisions" min="0" max="10" value="3" />
        <div class="hint">Max tech lead review rounds on the PR. Set to 0 to skip review.</div>
      </div>
      <div class="field">
        <label>Fix Retries</label>
        <input type="number" id="wk-fix-retries" min="0" max="10" value="5" />
        <div class="hint">Max retry attempts for quality gate failures and CI fix. 0 = no retries.</div>
      </div>
      <div class="field">
        <label>Blocker Wait Timeout (minutes)</label>
        <input type="number" id="wk-blocker-timeout" min="1" max="120" value="20" />
        <div class="hint">Minutes to wait for human blocker resolution before aborting (1-120).</div>
      </div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="wk-push-after-commit" checked />
          Push after each commit
        </label>
        <div class="hint">Push to remote immediately after each commit.</div>
      </div>
      <div class="field">
        <label>Max Parallel Experts</label>
        <input type="number" id="wk-max-parallel" min="1" max="16" value="8" />
        <div class="hint">Maximum parallel worker agents for epic execution (1-16).</div>
      </div>
      <div class="field">
        <label>Max Stories</label>
        <input type="number" id="wk-max-stories" min="1" max="20" value="8" />
        <div class="hint">Maximum stories the planner can create per task (1-20).</div>
      </div>
      <div class="field">
        <label>Max Target Files</label>
        <input type="number" id="wk-max-target-files" min="3" max="50" value="15" />
        <div class="hint">Recommended max files per story. Soft guideline, not enforced (3-50).</div>
      </div>
      <div class="field">
        <label>Planning Mode</label>
        <select id="wk-planning-mode">
          <option value="simplified">Simplified</option>
          <option value="strict">Strict</option>
        </select>
        <div class="hint">Simplified: single pass, critic feedback never blocks. Strict: full critic loop, plan must meet approval threshold.</div>
      </div>
      <div class="field" id="wk-threshold-field">
        <label>Critic Approval Threshold</label>
        <input type="number" id="wk-critic-threshold" min="50" max="100" value="85" />
        <div class="hint">Minimum critic score (50-100) for plan approval in strict mode.</div>
      </div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="wk-self-review" checked />
          Self-Review
        </label>
        <div class="hint">Workers review their own changes before committing.</div>
      </div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="wk-blocker-auto-retry" checked />
          Auto-Retry on Blockers
        </label>
        <div class="hint">Automatically retry when a worker hits a blocker.</div>
      </div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="wk-graceful-shutdown" checked />
          Graceful Shutdown
        </label>
        <div class="hint">Allow workers to finish current work before stopping.</div>
      </div>
      <div id="worker-behavior-status" class="status"></div>
    </div>

    <!-- Docker Sandbox -->
    <div class="section section-advanced" id="section-docker">
      <h2>Docker Sandbox</h2>
      <p>AI workers run inside Docker containers for filesystem and network isolation. Docker is required.</p>
      <div id="sandbox-warning" class="sandbox-warning hidden"></div>
      <div id="sandbox-status" class="status"></div>
      <div class="field" style="display:none;">
        <input type="checkbox" id="sandbox-toggle" checked disabled />
      </div>
      </div>
      <div class="field" id="docker-memory-field" style="display:none">
        <label>Container Memory Limit</label>
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="range" id="docker-memory-slider" min="4" max="12" step="1" value="4" style="flex:1" />
          <span id="docker-memory-value" style="min-width:40px;text-align:right;font-weight:600;">4 GB</span>
        </div>
        <div class="hint" id="docker-memory-hint">Min 4 GB. Swap adds 2 GB on top.</div>
      </div>
      <div class="btn-row">
        <button class="btn-secondary" id="btn-pull-image">Pull Latest Image</button>
      </div>
      <div id="sandbox-pull-status" class="status"></div>
    </div>

    <!-- Local RAG -->
    <div class="section section-advanced" id="section-rag">
      <h2>Local RAG <span class="badge" style="background:color-mix(in srgb, var(--vscode-textLink-foreground) 15%, transparent);color:var(--vscode-textLink-foreground);">Experimental</span></h2>
      <div class="field">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span style="font-weight:600;font-size:0.9em;">GPU</span>
          <span id="gpu-status" style="font-size:0.9em;color:var(--muted);">Detecting...</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:600;font-size:0.9em;">Ollama</span>
          <span style="display:flex;align-items:center;gap:8px;">
            <span id="ollama-status" style="font-size:0.9em;color:var(--muted);">Checking...</span>
            <button class="btn-primary hidden" id="btn-setup-rag" style="padding:3px 10px;font-size:0.85em;">Install Ollama</button>
          </span>
        </div>
      </div>
      <div id="rag-setup-status" class="status"></div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="local-rag-toggle" />
          Enable local codebase indexing
        </label>
        <div class="hint">Use your GPU to generate embeddings locally instead of cloud processing</div>
      </div>
      <div class="field">
        <label>Ollama Port</label>
        <input type="number" id="ollama-port" value="11434" min="1024" max="65535" />
      </div>
      <div class="field">
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="btn-primary" id="btn-index-repo" disabled>Index Repository</button>
          <span id="index-repo-label" style="font-size:0.9em;color:var(--muted);"></span>
        </div>
        <span id="index-status" class="hint" style="margin-top:4px;display:block;"></span>
      </div>
      <div id="rag-status" class="status"></div>
    </div>

    <!-- Organization (only visible for multi-org users) -->
    <div id="org-section" class="section section-account hidden">
      <h2>Organization</h2>
      <div class="field">
        <label>Active Organization</label>
        <select id="org-select"></select>
        <div class="hint">Switch your workspace to a different organization</div>
      </div>
      <div id="org-status" class="status"></div>
    </div>

    <!-- Account -->
    <div class="section section-account" id="section-account">
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
  </div><!-- .settings-content -->
  </div><!-- .settings-layout -->

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

    // Model options by provider — top 3 per provider (Feb 2026)
    const ANTHROPIC_MODELS = [
      { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
      { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ];
    const OPENAI_MODELS = [
      { value: "gpt-5.2", label: "GPT-5.2" },
      { value: "o3-pro", label: "o3 Pro (Reasoning)" },
      { value: "gpt-5-mini", label: "GPT-5 Mini" },
    ];
    const GOOGLE_MODELS = [
      { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
      { value: "gemini-3-pro-preview", label: "Gemini 3 Pro" },
      { value: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
    ];
    const OLLAMA_MODELS = [
      { value: "qwen3-coder:30b", label: "Qwen 3 Coder 30B" },
      { value: "devstral-small-2:24b-instruct-2512-q8_0", label: "Devstral Small 24B" },
      { value: "qwen2.5-coder:14b", label: "Qwen 2.5 Coder 14B" },
      { value: "deepseek-r1:70b", label: "DeepSeek R1 70B" },
      { value: "llama3.3:70b", label: "Llama 3.3 70B" },
      { value: "mistral:7b-instruct", label: "Mistral 7B Instruct" },
      { value: "llama3.1:8b", label: "Llama 3.1 8B" },
    ];
    // Premium-only models for tech lead and reviewer roles
    const ANTHROPIC_PREMIUM = ANTHROPIC_MODELS.filter(m => m.value !== "claude-haiku-4-5-20251001");
    const OPENAI_PREMIUM = OPENAI_MODELS.filter(m => m.value !== "gpt-5-mini");
    const GOOGLE_PREMIUM = GOOGLE_MODELS.filter(m => !m.value.includes("flash"));

    function populateModelSelect(selectId, currentValue, premiumOnly) {
      const sel = document.getElementById(selectId);
      sel.innerHTML = "";
      const isPaid = orgPlan === "max" || orgPlan === "enterprise";
      const aModels = premiumOnly ? ANTHROPIC_PREMIUM : ANTHROPIC_MODELS;
      const oModels = premiumOnly ? OPENAI_PREMIUM : OPENAI_MODELS;
      const gModels = premiumOnly ? GOOGLE_PREMIUM : GOOGLE_MODELS;

      if (isPaid) {
        const ag = document.createElement("optgroup");
        ag.label = "Anthropic";
        aModels.forEach(m => {
          const o = document.createElement("option");
          o.value = m.value; o.textContent = m.label;
          if (m.value === currentValue) o.selected = true;
          ag.appendChild(o);
        });
        sel.appendChild(ag);

        const og = document.createElement("optgroup");
        og.label = "OpenAI";
        oModels.forEach(m => {
          const o = document.createElement("option");
          o.value = m.value; o.textContent = m.label;
          if (m.value === currentValue) o.selected = true;
          og.appendChild(o);
        });
        sel.appendChild(og);

        const gg = document.createElement("optgroup");
        gg.label = "Google";
        gModels.forEach(m => {
          const o = document.createElement("option");
          o.value = m.value; o.textContent = m.label;
          if (m.value === currentValue) o.selected = true;
          gg.appendChild(o);
        });
        sel.appendChild(gg);

        const lg = document.createElement("optgroup");
        lg.label = "Ollama (Local)";
        OLLAMA_MODELS.forEach(m => {
          const o = document.createElement("option");
          o.value = m.value; o.textContent = m.label;
          if (m.value === currentValue) o.selected = true;
          lg.appendChild(o);
        });
        sel.appendChild(lg);
      } else {
        aModels.forEach(m => {
          const o = document.createElement("option");
          o.value = m.value; o.textContent = m.label;
          if (m.value === currentValue) o.selected = true;
          sel.appendChild(o);
        });
      }
    }

    // Sidebar nav: IntersectionObserver for active section highlighting
    const settingsNav = document.getElementById("settings-nav");
    const navLinks = settingsNav.querySelectorAll("a[data-section]");
    const sectionObserver = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          navLinks.forEach(function(link) { link.classList.remove("active"); });
          const activeLink = settingsNav.querySelector('a[data-section="' + entry.target.id + '"]');
          if (activeLink) activeLink.classList.add("active");
        }
      });
    }, { rootMargin: "-20% 0px -60% 0px", threshold: 0 });

    // Observe sections once content is shown
    function observeSections() {
      document.querySelectorAll(".section[id]").forEach(function(section) {
        sectionObserver.observe(section);
      });
    }

    // SCM radio toggle — skip save during initial load
    const scmRadios = document.querySelectorAll('input[name="scm"]');
    const scmGithubFields = document.getElementById("scm-github-fields");
    const scmBitbucketFields = document.getElementById("scm-bitbucket-fields");
    const scmGitlabFields = document.getElementById("scm-gitlab-fields");
    let scmInitialLoad = true;
    scmRadios.forEach(r => r.addEventListener("change", () => {
      const val = document.querySelector('input[name="scm"]:checked').value;
      scmGithubFields.classList.toggle("hidden", val !== "github");
      scmBitbucketFields.classList.toggle("hidden", val !== "bitbucket");
      scmGitlabFields.classList.toggle("hidden", val !== "gitlab");
    }));

    // Issue tracker radio toggle — skip save during initial load
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

      // SCM: Bitbucket + GitLab = Max plan
      const scmBbLabel = document.getElementById("scm-bitbucket-label");
      const scmGlLabel = document.getElementById("scm-gitlab-label");
      const scmBbRadio = scmBbLabel.querySelector("input");
      const scmGlRadio = scmGlLabel.querySelector("input");
      const scmUpgrade = document.getElementById("scm-upgrade");

      if (isPaid) {
        scmBbLabel.classList.remove("locked-option");
        scmGlLabel.classList.remove("locked-option");
        scmBbRadio.disabled = false;
        scmGlRadio.disabled = false;
        scmBbLabel.querySelectorAll(".pro-badge").forEach(b => b.classList.add("hidden"));
        scmGlLabel.querySelectorAll(".pro-badge").forEach(b => b.classList.add("hidden"));
        scmUpgrade.classList.add("hidden");
      } else {
        scmBbLabel.classList.add("locked-option");
        scmGlLabel.classList.add("locked-option");
        scmBbRadio.disabled = true;
        scmGlRadio.disabled = true;
        scmUpgrade.classList.remove("hidden");
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
    const btnWebSettingsLinear = document.getElementById("btn-web-settings-linear");
    if (btnWebSettingsLinear) {
      btnWebSettingsLinear.addEventListener("click", () => {
        vscode.postMessage({ type: "open-web-settings" });
      });
    }
    // SCM save buttons
    document.getElementById("btn-save-scm-github").addEventListener("click", () => {
      vscode.postMessage({
        type: "save-scm",
        provider: "github",
        token: document.getElementById("scm-github-token").value.trim(),
        reviewerToken: document.getElementById("scm-github-reviewer-token").value.trim() || undefined,
      });
    });
    document.getElementById("btn-save-scm-bitbucket").addEventListener("click", () => {
      vscode.postMessage({
        type: "save-scm",
        provider: "bitbucket",
        username: document.getElementById("scm-bb-username").value.trim(),
        appPassword: document.getElementById("scm-bb-token").value.trim(),
      });
    });
    document.getElementById("btn-test-scm-bitbucket").addEventListener("click", () => {
      vscode.postMessage({ type: "test-scm-bitbucket" });
    });
    document.getElementById("btn-test-scm-github")?.addEventListener("click", () => {
      vscode.postMessage({ type: "test-scm-github" });
    });
    document.getElementById("btn-test-scm-gitlab")?.addEventListener("click", () => {
      vscode.postMessage({ type: "test-scm-gitlab" });
    });
    document.getElementById("btn-save-scm-gitlab").addEventListener("click", () => {
      vscode.postMessage({
        type: "save-scm",
        provider: "gitlab",
        token: document.getElementById("scm-gitlab-token").value.trim(),
      });
    });
    document.getElementById("btn-upgrade-scm").addEventListener("click", (e) => {
      e.preventDefault();
      vscode.postMessage({ type: "open-pricing" });
    });
    document.getElementById("btn-dashboard-boards").addEventListener("click", () => {
      vscode.postMessage({ type: "open-dashboard" });
    });
    document.getElementById("btn-upgrade-tracker").addEventListener("click", (e) => {
      e.preventDefault();
      vscode.postMessage({ type: "open-pricing" });
    });
    document.getElementById("btn-sign-out").addEventListener("click", () => {
      vscode.postMessage({ type: "sign-out" });
    });
    // ── Autosave: debounced save for non-credential fields ──
    let autosaveTimers = {};
    function autosave(key, delayMs, saveFn) {
      clearTimeout(autosaveTimers[key]);
      autosaveTimers[key] = setTimeout(saveFn, delayMs);
    }

    // Target repo — autosave on input (debounced 800ms)
    document.getElementById("default-repo").addEventListener("input", () => {
      autosave("repo", 800, () => {
        const repo = document.getElementById("default-repo").value.trim();
        if (repo) {
          const activeScm = (document.querySelector('input[name="scm"]:checked') || {}).value || "github";
          vscode.postMessage({ type: "save-repo", defaultRepo: repo, provider: activeScm });
          // Update RAG label to match
          if (indexRepoLabel) indexRepoLabel.textContent = repo;
        }
      });
    });

    // AI Models — autosave on change (instant, select dropdowns)
    ["model-worker", "model-reviewer", "model-planner"].forEach(function(id) {
      document.getElementById(id).addEventListener("change", () => {
        autosave("models", 300, () => {
          vscode.postMessage({
            type: "save-models",
            workerModel: document.getElementById("model-worker").value,
            reviewerModel: document.getElementById("model-reviewer").value,
            plannerModel: document.getElementById("model-planner").value,
          });
        });
      });
    });

    // Worker behavior — autosave on change (debounced 500ms for number inputs)
    function saveWorkerBehavior() {
      autosave("worker-behavior", 500, function() {
        var fixRetries = parseInt(document.getElementById("wk-fix-retries").value) || 0;
        vscode.postMessage({
          type: "save-worker-behavior",
          maxPerStoryRevisions: 0,
          maxReviewRevisions: parseInt(document.getElementById("wk-pr-revisions").value) || 0,
          maxFixRetries: fixRetries,
          blockerWaitTimeoutMinutes: parseInt(document.getElementById("wk-blocker-timeout").value) || 20,
          pushAfterCommit: document.getElementById("wk-push-after-commit").checked,
          planningMode: document.getElementById("wk-planning-mode").value,
          criticApprovalThreshold: parseInt(document.getElementById("wk-critic-threshold").value) || 85,
          maxParallelExperts: parseInt(document.getElementById("wk-max-parallel").value) || 10,
          maxStories: parseInt(document.getElementById("wk-max-stories").value) || 10,
          maxTargetFiles: parseInt(document.getElementById("wk-max-target-files").value) || 20,
          selfReviewEnabled: document.getElementById("wk-self-review").checked,
          blockerAutoRetryEnabled: document.getElementById("wk-blocker-auto-retry").checked,
          gracefulShutdownEnabled: document.getElementById("wk-graceful-shutdown").checked,
        });
      });
    }
    ["wk-pr-revisions", "wk-fix-retries", "wk-blocker-timeout", "wk-critic-threshold", "wk-max-parallel", "wk-max-stories", "wk-max-target-files"].forEach(function(id) {
      document.getElementById(id).addEventListener("input", saveWorkerBehavior);
    });
    ["wk-push-after-commit", "wk-planning-mode", "wk-self-review", "wk-blocker-auto-retry", "wk-graceful-shutdown"].forEach(function(id) {
      document.getElementById(id).addEventListener("change", saveWorkerBehavior);
    });
    // Show/hide threshold field based on planning mode
    document.getElementById("wk-planning-mode").addEventListener("change", function() {
      var tf = document.getElementById("wk-threshold-field");
      if (tf) tf.style.display = this.value === "strict" ? "" : "none";
    });

    // Quality gate — autosave on change
    function saveQualityGate() {
      autosave("quality-gate", 500, function() {
        vscode.postMessage({
          type: "save-quality-gate",
          qualityGateEnabled: document.getElementById("qg-enabled").checked,
          blockOnTypeErrors: document.getElementById("qg-block-type-errors").checked,
          blockOnTestFailures: document.getElementById("qg-block-test-failures").checked,
          blockOnLintErrors: document.getElementById("qg-block-lint-errors").checked,
          blockOnE2EFailures: document.getElementById("qg-block-e2e-failures").checked,
          autoFixEnabled: document.getElementById("qg-autofix").checked,
          autoFixMaxIterations: parseInt(document.getElementById("qg-autofix-iterations").value) || 3,
        });
      });
    }
    ["qg-enabled", "qg-block-type-errors", "qg-block-test-failures", "qg-block-lint-errors", "qg-block-e2e-failures", "qg-autofix"].forEach(function(id) {
      document.getElementById(id).addEventListener("change", saveQualityGate);
    });
    document.getElementById("qg-autofix-iterations").addEventListener("input", saveQualityGate);
    document.getElementById("qg-enabled").addEventListener("change", function() {
      document.getElementById("qg-options").style.display = this.checked ? "" : "none";
    });
    document.getElementById("qg-autofix").addEventListener("change", function() {
      document.getElementById("qg-autofix-iterations-field").style.display = this.checked ? "" : "none";
    });

    // Org switcher
    const orgSelect = document.getElementById("org-select");
    let currentOrgId = "";
    orgSelect.addEventListener("change", () => {
      const newOrgId = orgSelect.value;
      if (newOrgId && newOrgId !== currentOrgId) {
        vscode.postMessage({ type: "switch-org", orgId: newOrgId });
      }
    });

    // Sandbox toggle
    const sandboxToggle = document.getElementById("sandbox-toggle");
    const sandboxStatus = document.getElementById("sandbox-status");
    const sandboxWarning = document.getElementById("sandbox-warning");
    sandboxToggle.addEventListener("change", () => {
      vscode.postMessage({ type: "toggle-sandbox", enabled: sandboxToggle.checked });
    });
    document.getElementById("btn-pull-image").addEventListener("click", () => {
      vscode.postMessage({ type: "pull-sandbox-image" });
    });

    // Docker memory slider
    const memorySlider = document.getElementById("docker-memory-slider");
    const memoryValue = document.getElementById("docker-memory-value");
    const memoryField = document.getElementById("docker-memory-field");
    const memoryHint = document.getElementById("docker-memory-hint");
    let memoryDebounce = null;
    memorySlider.addEventListener("input", () => {
      memoryValue.textContent = memorySlider.value + " GB";
    });
    memorySlider.addEventListener("change", () => {
      clearTimeout(memoryDebounce);
      memoryDebounce = setTimeout(() => {
        vscode.postMessage({ type: "set-docker-memory", dockerMemoryGb: parseInt(memorySlider.value) });
      }, 300);
    });

    // Local RAG toggle
    const ragToggle = document.getElementById("local-rag-toggle");
    const ragStatus = document.getElementById("rag-status");
    const ollamaPortInput = document.getElementById("ollama-port");
    const indexBtn = document.getElementById("btn-index-repo");
    const indexStatusEl = document.getElementById("index-status");
    let ollamaPortDebounce = null;

    ragToggle.addEventListener("change", () => {
      vscode.postMessage({ type: "toggle-rag", enabled: ragToggle.checked });
    });
    ollamaPortInput.addEventListener("change", () => {
      clearTimeout(ollamaPortDebounce);
      ollamaPortDebounce = setTimeout(() => {
        vscode.postMessage({ type: "set-ollama-port", port: parseInt(ollamaPortInput.value) || 11434 });
      }, 300);
    });
    const indexRepoLabel = document.getElementById("index-repo-label");
    indexBtn.addEventListener("click", () => {
      const repo = document.getElementById("default-repo").value.trim();
      if (!repo) return;
      indexBtn.disabled = true;
      indexStatusEl.textContent = "Indexing...";
      indexStatusEl.style.color = "var(--muted)";
      vscode.postMessage({ type: "index-repo", repository: repo });
    });
    const setupRagBtn = document.getElementById("btn-setup-rag");
    const ragSetupStatus = document.getElementById("rag-setup-status");
    setupRagBtn.addEventListener("click", () => {
      setupRagBtn.disabled = true;
      setupRagBtn.textContent = "Setting up...";
      showStatus(ragSetupStatus, "info", "Starting Ollama setup...");
      vscode.postMessage({ type: "setup-rag" });
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
        settingsNav.classList.remove("hidden");
        observeSections();
        const d = msg.data;

        // Show org name so user can verify which org the API key resolves to
        if (d.orgName) {
          document.getElementById("org-label").textContent = "— " + d.orgName;
        }

        // Populate org switcher if user has multiple orgs
        const orgs = d.organizations || [];
        const orgSection = document.getElementById("org-section");
        if (orgs.length > 1) {
          orgSection.classList.remove("hidden");
          orgSelect.innerHTML = "";
          currentOrgId = d.orgId || "";
          orgs.forEach(function(org) {
            const opt = document.createElement("option");
            opt.value = org.id;
            opt.textContent = org.name + " (" + org.role + ")";
            if (org.id === currentOrgId) opt.selected = true;
            orgSelect.appendChild(opt);
          });
        } else {
          orgSection.classList.add("hidden");
        }

        // Apply plan restrictions before selecting radios
        applyPlanRestrictions(d.plan || "pro");

        // Populate model dropdowns
        populateModelSelect("model-worker", d.defaultWorkerModel || "claude-sonnet-4-6", false);
        populateModelSelect("model-reviewer", d.managerModelId || "claude-opus-4-6", true);
        populateModelSelect("model-planner", d.planningAgentModel || "claude-opus-4-6", true);

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
        const ghBadge = document.getElementById("github-badge");
        if (ghBadge) ghBadge.innerHTML = badge(d.github?.configured);
        const lnBadge = document.getElementById("linear-badge");
        if (lnBadge) lnBadge.innerHTML = badge(d.linear?.configured);

        // Populate SCM section
        document.getElementById("scm-github-badge").innerHTML = d.github?.configured ? badge(true) : "";
        document.getElementById("scm-bitbucket-badge").innerHTML = d.bitbucket?.configured ? badge(true) : "";
        document.getElementById("scm-gitlab-badge").innerHTML = d.gitlab?.configured ? badge(true) : "";

        // Fill known Bitbucket username if available
        if (d.bitbucket?.username) {
          document.getElementById("scm-bb-username").value = d.bitbucket.username;
        }

        // Select current SCM provider radio
        let scmProvider = d.scmProvider || "github";
        const scmIsPaid = orgPlan === "max" || orgPlan === "enterprise";
        if (!scmIsPaid && (scmProvider === "bitbucket" || scmProvider === "gitlab")) {
          scmProvider = "github";
        }
        const scmRadio = document.querySelector('input[name="scm"][value="' + scmProvider + '"]');
        if (scmRadio) {
          scmRadio.checked = true;
          scmRadio.dispatchEvent(new Event("change", { bubbles: true }));
        }
        scmInitialLoad = false;

        // Populate target repo from SCM-specific default
        const scm = d.scmProvider || "github";
        let defaultRepo = "";
        if (scm === "github" && d.github?.defaultRepo) defaultRepo = d.github.defaultRepo;
        else if (scm === "bitbucket" && d.bitbucket?.defaultRepo) defaultRepo = d.bitbucket.defaultRepo;
        else if (scm === "gitlab" && d.gitlab?.defaultRepo) defaultRepo = d.gitlab.defaultRepo;
        const repoInput = document.getElementById("default-repo");
        if (repoInput) repoInput.value = defaultRepo;

        // Populate worker behavior settings
        const wkPr = document.getElementById("wk-pr-revisions");
        const wkFixRetries = document.getElementById("wk-fix-retries");
        const wkBlockerTimeout = document.getElementById("wk-blocker-timeout");
        const wkPush = document.getElementById("wk-push-after-commit");
        if (wkPr) wkPr.value = String(d.maxReviewRevisions ?? 4);
        if (wkFixRetries) wkFixRetries.value = String(d.maxFixRetries ?? 5);
        if (wkBlockerTimeout) wkBlockerTimeout.value = String(d.blockerWaitTimeoutMinutes ?? 20);
        if (wkPush) wkPush.checked = d.pushAfterCommit !== false;

        // Populate quality gate settings
        var qgEnabled = document.getElementById("qg-enabled");
        var qgTypeErrors = document.getElementById("qg-block-type-errors");
        var qgTestFailures = document.getElementById("qg-block-test-failures");
        var qgLintErrors = document.getElementById("qg-block-lint-errors");
        var qgE2EFailures = document.getElementById("qg-block-e2e-failures");
        var qgAutofix = document.getElementById("qg-autofix");
        var qgAutofixIterations = document.getElementById("qg-autofix-iterations");
        if (qgEnabled) qgEnabled.checked = d.qualityGateEnabled !== false;
        if (qgTypeErrors) qgTypeErrors.checked = d.blockOnTypeErrors !== false;
        if (qgTestFailures) qgTestFailures.checked = !!d.blockOnTestFailures;
        if (qgLintErrors) qgLintErrors.checked = !!d.blockOnLintErrors;
        if (qgE2EFailures) qgE2EFailures.checked = !!d.blockOnE2EFailures;
        if (qgAutofix) qgAutofix.checked = d.autoFixEnabled !== false;
        if (qgAutofixIterations) qgAutofixIterations.value = String(d.autoFixMaxIterations ?? 3);
        var qgOptions = document.getElementById("qg-options");
        if (qgOptions) qgOptions.style.display = (d.qualityGateEnabled !== false) ? "" : "none";
        var qgIterationsField = document.getElementById("qg-autofix-iterations-field");
        if (qgIterationsField) qgIterationsField.style.display = (d.autoFixEnabled !== false) ? "" : "none";

        // Populate new worker behavior settings
        var wkPlanningMode = document.getElementById("wk-planning-mode");
        var wkCriticThreshold = document.getElementById("wk-critic-threshold");
        var wkThresholdField = document.getElementById("wk-threshold-field");
        var wkMaxParallel = document.getElementById("wk-max-parallel");
        var wkMaxStories = document.getElementById("wk-max-stories");
        var wkMaxTargetFiles = document.getElementById("wk-max-target-files");
        var wkSelfReview = document.getElementById("wk-self-review");
        var wkBlockerAutoRetry = document.getElementById("wk-blocker-auto-retry");
        var wkGracefulShutdown = document.getElementById("wk-graceful-shutdown");
        if (wkPlanningMode) wkPlanningMode.value = d.planningMode || "simplified";
        if (wkCriticThreshold) wkCriticThreshold.value = String(d.criticApprovalThreshold ?? 85);
        if (wkThresholdField) wkThresholdField.style.display = (d.planningMode || "simplified") === "strict" ? "" : "none";
        if (wkMaxParallel) wkMaxParallel.value = String(d.maxParallelExperts ?? 10);
        if (wkMaxStories) wkMaxStories.value = String(d.maxStories ?? 10);
        if (wkMaxTargetFiles) wkMaxTargetFiles.value = String(d.maxTargetFiles ?? 20);
        if (wkSelfReview) wkSelfReview.checked = d.selfReviewEnabled !== false;
        if (wkBlockerAutoRetry) wkBlockerAutoRetry.checked = d.blockerAutoRetryEnabled !== false;
        if (wkGracefulShutdown) wkGracefulShutdown.checked = d.gracefulShutdownEnabled !== false;

        // Show target repo in RAG section
        if (indexRepoLabel) {
          indexRepoLabel.textContent = defaultRepo ? defaultRepo : "No repository configured";
        }

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

      if (msg.type === "worker-behavior-saved") {
        const ws = document.getElementById("worker-behavior-status");
        showStatus(ws, "success", "Worker behavior settings saved");
        setTimeout(() => ws.classList.remove("visible"), 3000);
      }
      if (msg.type === "worker-behavior-save-error") {
        const ws = document.getElementById("worker-behavior-status");
        showStatus(ws, "error", msg.message || "Failed to save worker behavior settings");
      }

      if (msg.type === "quality-gate-saved") {
        var qgs = document.getElementById("quality-gate-status");
        showStatus(qgs, "success", "Quality gate settings saved");
        setTimeout(function() { qgs.classList.remove("visible"); }, 3000);
      }
      if (msg.type === "quality-gate-save-error") {
        var qgs2 = document.getElementById("quality-gate-status");
        showStatus(qgs2, "error", msg.message || "Failed to save quality gate settings");
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

      // SCM messages — target only the active provider's status div
      if (msg.type === "scm-saving") {
        const activeScm = (document.querySelector('input[name="scm"]:checked') || {}).value || "github";
        const el = document.getElementById("scm-" + activeScm + "-status");
        if (el) showStatus(el, "info", "Saving...");
      }
      if (msg.type === "scm-saved") {
        const activeScm = (document.querySelector('input[name="scm"]:checked') || {}).value || "github";
        const el = document.getElementById("scm-" + activeScm + "-status");
        if (el) { showStatus(el, "success", msg.message || "Credentials saved"); setTimeout(() => el.classList.remove("visible"), 3000); }
      }
      if (msg.type === "scm-save-error") {
        const activeScm = (document.querySelector('input[name="scm"]:checked') || {}).value || "github";
        const el = document.getElementById("scm-" + activeScm + "-status");
        if (el) showStatus(el, "error", msg.message || "Failed to save credentials");
      }
      // SCM test messages — target the active provider's status div
      if (msg.type === "scm-test-testing") {
        const provider = msg.provider || (document.querySelector('input[name="scm"]:checked') || {}).value || "github";
        const el = document.getElementById("scm-" + provider + "-status");
        if (el) showStatus(el, "info", "Testing connection...");
      }
      if (msg.type === "scm-test-success") {
        const provider = msg.provider || (document.querySelector('input[name="scm"]:checked') || {}).value || "github";
        const el = document.getElementById("scm-" + provider + "-status");
        if (el) { showStatus(el, "success", msg.message); setTimeout(() => el.classList.remove("visible"), 3000); }
      }
      if (msg.type === "scm-test-error") {
        const provider = msg.provider || (document.querySelector('input[name="scm"]:checked') || {}).value || "github";
        const el = document.getElementById("scm-" + provider + "-status");
        if (el) showStatus(el, "error", msg.message);
      }

      // Sandbox messages
      if (msg.type === "sandbox-loaded") {
        sandboxToggle.checked = msg.sandbox === "docker";
        sandboxWarning.classList.toggle("hidden", msg.sandbox === "docker");
        if (msg.dockerAvailable) {
          sandboxToggle.disabled = false;
          if (msg.sandbox === "docker") {
            showStatus(sandboxStatus, "success", "Docker sandbox is active");
          }
        } else if (msg.dockerInstalled) {
          sandboxToggle.disabled = true;
          showStatus(sandboxStatus, "error", "Docker is installed but not running — start Docker Desktop to enable sandbox mode");
        } else {
          sandboxToggle.disabled = true;
          showStatus(sandboxStatus, "error", "Docker not detected — install Docker to enable sandbox mode");
        }
        // Populate memory slider
        if (msg.dockerAvailable || msg.dockerInstalled) {
          memoryField.style.display = "block";
          memorySlider.min = "4";
          memorySlider.max = String(msg.maxDockerMemoryGb || 12);
          memorySlider.value = String(msg.dockerMemoryGb || 4);
          memoryValue.textContent = (msg.dockerMemoryGb || 4) + " GB";
          memoryHint.textContent = "Min 4 GB, max " + (msg.maxDockerMemoryGb || 12) + " GB (system has " + (msg.totalRamGb || "?") + " GB). Swap adds 2 GB on top.";
        }
      }
      if (msg.type === "docker-memory-saved") {
        memoryValue.textContent = msg.dockerMemoryGb + " GB";
      }
      if (msg.type === "sandbox-restarting") {
        sandboxToggle.disabled = true;
        showStatus(sandboxStatus, "info", "Restarting agent...");
      }
      if (msg.type === "sandbox-updated") {
        sandboxToggle.disabled = false;
        sandboxToggle.checked = msg.sandbox === "docker";
        sandboxWarning.classList.toggle("hidden", msg.sandbox === "docker");
        if (msg.error) {
          showStatus(sandboxStatus, "error", msg.error);
        } else {
          showStatus(sandboxStatus, "success", msg.sandbox === "docker" ? "Docker sandbox enabled — agent restarted" : "Docker sandbox disabled — agent restarted");
          setTimeout(() => { sandboxStatus.className = "status"; }, 3000);
        }
      }
      // Org switch messages
      if (msg.type === "org-switching") {
        const os = document.getElementById("org-status");
        orgSelect.disabled = true;
        showStatus(os, "info", "Switching organization...");
      }
      if (msg.type === "org-switched") {
        const os = document.getElementById("org-status");
        orgSelect.disabled = false;
        showStatus(os, "success", "Switched to " + msg.orgName);
        setTimeout(() => os.classList.remove("visible"), 3000);
      }
      if (msg.type === "org-switch-error") {
        const os = document.getElementById("org-status");
        orgSelect.disabled = false;
        showStatus(os, "error", msg.message || "Failed to switch organization");
      }
      // Local RAG messages
      if (msg.type === "rag-loaded") {
        const gpuEl = document.getElementById("gpu-status");
        const ollamaEl = document.getElementById("ollama-status");
        if (msg.gpu && msg.gpu.available) {
          gpuEl.textContent = msg.gpu.vendor + " " + (msg.gpu.model || "") + (msg.gpu.memoryMb ? " (" + msg.gpu.memoryMb + " MB)" : "");
          gpuEl.style.color = "var(--success)";
        } else {
          gpuEl.textContent = "None detected";
          gpuEl.style.color = "var(--muted)";
        }

        // Determine Ollama state and show appropriate button
        const hasModel = msg.ollama && msg.ollama.models && msg.ollama.models.some(function(m) { return m.startsWith("nomic-embed-text"); });
        if (msg.ollama && msg.ollama.running && hasModel) {
          ollamaEl.textContent = "Ready";
          ollamaEl.style.color = "var(--success)";
          setupRagBtn.classList.add("hidden");
        } else if (msg.ollama && msg.ollama.running) {
          ollamaEl.textContent = "Running (model missing)";
          ollamaEl.style.color = "var(--error)";
          setupRagBtn.textContent = "Pull Model";
          setupRagBtn.disabled = false;
          setupRagBtn.classList.remove("hidden");
        } else if (msg.ollama && msg.ollama.installed) {
          ollamaEl.textContent = "Installed but not running";
          ollamaEl.style.color = "var(--error)";
          setupRagBtn.textContent = "Start Ollama";
          setupRagBtn.disabled = false;
          setupRagBtn.classList.remove("hidden");
        } else {
          ollamaEl.textContent = "Not installed";
          ollamaEl.style.color = "var(--error)";
          setupRagBtn.textContent = "Install Ollama";
          setupRagBtn.disabled = false;
          setupRagBtn.classList.remove("hidden");
        }
        ragToggle.checked = !!msg.localRag;
        ollamaPortInput.value = msg.ollamaPort || 11434;
        indexBtn.disabled = !msg.localRag || !hasModel || !document.getElementById("default-repo").value.trim();
      }
      // RAG setup progress/completion/error
      if (msg.type === "rag-setup-progress") {
        showStatus(ragSetupStatus, "info", msg.message || "Setting up...");
      }
      if (msg.type === "rag-setup-complete") {
        showStatus(ragSetupStatus, "success", "Ollama setup complete — ready for indexing");
        setupRagBtn.classList.add("hidden");
        setTimeout(function() { ragSetupStatus.className = "status"; }, 3000);
      }
      if (msg.type === "rag-setup-error") {
        showStatus(ragSetupStatus, "error", msg.error || "Setup failed");
        setupRagBtn.disabled = false;
        setupRagBtn.textContent = "Retry Setup";
      }
      if (msg.type === "rag-restarting") {
        ragToggle.disabled = true;
        showStatus(ragStatus, "info", "Restarting agent...");
      }
      if (msg.type === "rag-updated") {
        ragToggle.disabled = false;
        ragToggle.checked = !!msg.localRag;
        if (msg.error) {
          showStatus(ragStatus, "error", msg.error);
        } else {
          showStatus(ragStatus, "success", msg.localRag ? "Local RAG enabled — agent restarted" : "Local RAG disabled — agent restarted");
          setTimeout(() => { ragStatus.className = "status"; }, 3000);
        }
      }
      if (msg.type === "ollama-port-saved") {
        ollamaPortInput.value = msg.ollamaPort;
      }
      if (msg.type === "indexing-started") {
        indexStatusEl.textContent = "Indexing started...";
        indexStatusEl.style.color = "var(--muted)";
        indexBtn.disabled = true;
      }
      if (msg.type === "index-progress") {
        indexStatusEl.textContent = msg.message || "Indexing...";
        indexStatusEl.style.color = "var(--muted)";
      }
      if (msg.type === "index-complete") {
        indexStatusEl.textContent = msg.message || "Indexing complete";
        indexStatusEl.style.color = "var(--success)";
        indexBtn.disabled = false;
        setTimeout(function() { indexStatusEl.textContent = ""; }, 3000);
      }
      if (msg.type === "index-error") {
        indexStatusEl.textContent = msg.error || "Indexing failed";
        indexStatusEl.style.color = "var(--error)";
        indexBtn.disabled = false;
      }
    });

    // Initial load
    vscode.postMessage({ type: "load-integrations" });
    vscode.postMessage({ type: "load-sandbox" });
    vscode.postMessage({ type: "load-rag" });
  </script>
</body>
</html>`;
  }
}
