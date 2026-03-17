/**
 * Onboarding — guide new users through account creation and agent setup.
 *
 * Primary flow (zero friction):
 *   "Get Started" → VS Code GitHub SSO → auto-creates account → writes config → installs agent → starts
 *   User never leaves VS Code.
 *
 * Fallback flow:
 *   "I have an API key" → paste key → validate → write config → install → start
 *
 * No terminal commands, no shell scripts — works on Windows, macOS, and Linux.
 */

import * as vscode from "vscode";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";
import { randomBytes } from "crypto";
import {
  isAgentInstalled,
  installAgent,
  startAgentProcess,
  stopAgentProcess,
  writeAgentConfig,
  waitForAgentReady,
  promptInstallGit,
  promptInstallClaudeCli,
  readAgentStartupError,
  writeApiKeyToKeychain,
  getAgentLogPath,
} from "./agent-installer";
import { storeApiKey } from "./secret-storage";

const API_BASE = "https://workermill.com";

interface OrgInfo {
  id: string;
  name: string;
  slug: string | null;
  role: string;
}

interface OnboardResponse {
  apiKey: string;
  apiUrl: string;
  orgSlug: string;
  orgId?: string;
  orgName?: string;
  userId: string;
  email: string;
  name: string;
  organizations?: OrgInfo[];
}

/** POST JSON to an HTTPS URL and return the parsed response. */
function httpsPostJson<T>(
  url: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = JSON.stringify(body);

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "User-Agent": "WorkerMill-VSCode",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode || 0,
              data: JSON.parse(data) as T,
            });
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
    req.write(payload);
    req.end();
  });
}

/** GET JSON from an HTTPS URL with an API key header. */
function httpsGetJson<T>(
  url: string,
  apiKey: string,
): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    const req = https.get(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        headers: {
          "x-api-key": apiKey,
          "User-Agent": "WorkerMill-VSCode",
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          httpsGetJson<T>(res.headers.location, apiKey).then(resolve, reject);
          return;
        }
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(body) as T });
          } catch {
            resolve({ status: res.statusCode || 0, data: {} as T });
          }
        });
      },
    );

    req.on("error", reject);
    req.setTimeout(15_000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

/** POST to an HTTPS URL with a Bearer token and return the parsed response. */
function httpsPostJsonWithBearer<T>(
  url: string,
  bearerToken: string,
): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = "{}";

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Authorization: `Bearer ${bearerToken}`,
          "User-Agent": "WorkerMill-VSCode",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode || 0,
              data: JSON.parse(data) as T,
            });
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
    req.write(payload);
    req.end();
  });
}

/** POST JSON with API key authentication. */
function httpsPostJsonWithApiKey<T>(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = JSON.stringify(body);

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "x-api-key": apiKey,
          "User-Agent": "WorkerMill-VSCode",
        },
      },
      (res) => {
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
    req.write(payload);
    req.end();
  });
}

/** GET JSON from an HTTPS URL without authentication. */
function httpsGetJsonNoAuth<T>(url: string): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    const req = https.get(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        headers: {
          "User-Agent": "WorkerMill-VSCode",
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          httpsGetJsonNoAuth<T>(res.headers.location).then(resolve, reject);
          return;
        }
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(body) as T });
          } catch {
            resolve({ status: res.statusCode || 0, data: {} as T });
          }
        });
      },
    );

    req.on("error", reject);
    req.setTimeout(15_000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

// Pending Google SSO auth — resolved when the URI handler fires
let pendingGoogleAuth: { state: string; resolve: (success: boolean) => void } | null = null;

/**
 * Prompt the user to configure SCM access after SSO sign-in.
 * Offers GitHub App install, PAT paste, or skip.
 * Returns true if SCM was configured, false if skipped.
 */
export async function promptScmSetup(
  apiKey: string,
  log: (msg: string) => void,
): Promise<boolean> {
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: "$(github) Install GitHub App (Recommended)",
        description: "One-click, no tokens to manage",
        action: "app" as const,
      },
      {
        label: "$(key) Use a Personal Access Token",
        description: "Create a GitHub PAT with repo access",
        action: "pat" as const,
      },
      {
        label: "$(debug-step-over) Skip for now",
        description: "You can configure this later in Settings",
        action: "skip" as const,
      },
    ],
    {
      placeHolder: "WorkerMill needs access to your repositories to clone and push code",
      title: "Configure Repository Access",
      ignoreFocusOut: true,
    },
  );

  if (!choice || choice.action === "skip") {
    log("SCM setup skipped — user can configure later");
    return false;
  }

  if (choice.action === "app") {
    // Open GitHub App installation page with state=orgId for callback mapping
    const configPath = path.join(os.homedir(), ".workermill", "config.json");
    let orgId = "";
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      orgId = config.orgId || "";
    } catch {
      /* no config */
    }

    const installUrl =
      `https://github.com/apps/workermill-agent/installations/new` +
      (orgId ? `?state=${orgId}` : "");
    vscode.env.openExternal(vscode.Uri.parse(installUrl));

    // Poll scm-status until configured or timeout (60s)
    const configured = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Waiting for GitHub App installation...",
      },
      async () => {
        const start = Date.now();
        while (Date.now() - start < 60_000) {
          await new Promise((r) => setTimeout(r, 5000));
          try {
            const check = await httpsGetJson<{ configured: boolean }>(
              `${API_BASE}/api/agent/scm-status`,
              apiKey,
            );
            if (check.data.configured) {
              vscode.window.showInformationMessage(
                "GitHub App installed! Repository access configured.",
              );
              return true;
            }
          } catch {
            /* retry */
          }
        }
        vscode.window.showWarningMessage(
          "GitHub App installation not detected. You can check Settings > Integrations later.",
        );
        return false;
      },
    );
    return configured;
  }

  return promptPatSetup(apiKey, log);
}

/**
 * Guide the user through creating and pasting a GitHub PAT.
 */
async function promptPatSetup(
  apiKey: string,
  log: (msg: string) => void,
): Promise<boolean> {
  // Open GitHub PAT creation page with pre-filled scopes
  const createAction = await vscode.window.showInformationMessage(
    "Create a Personal Access Token on GitHub with 'repo' scope, then paste it here.",
    { modal: false },
    "Create Token on GitHub",
    "I already have one",
  );

  if (createAction === "Create Token on GitHub") {
    vscode.env.openExternal(
      vscode.Uri.parse(
        "https://github.com/settings/tokens/new?scopes=repo,workflow&description=WorkerMill%20Agent",
      ),
    );
  } else if (!createAction) {
    // Dismissed — skip
    return false;
  }

  // Prompt for the token
  const token = await vscode.window.showInputBox({
    prompt: "Paste your GitHub Personal Access Token (starts with ghp_ or github_pat_)",
    placeHolder: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.trim()) return "Token is required";
      if (!value.startsWith("ghp_") && !value.startsWith("github_pat_")) {
        return "Token should start with ghp_ (classic) or github_pat_ (fine-grained)";
      }
      return null;
    },
  });

  if (!token) return false;

  // Send to API for validation and storage
  log("Validating GitHub token...");
  try {
    const { status, data } = await httpsPostJsonWithApiKey<{
      configured: boolean;
      username: string;
    }>(
      `${API_BASE}/api/agent/configure-scm`,
      apiKey,
      { token: token.trim(), provider: "github" },
    );

    if (status === 401) {
      vscode.window.showErrorMessage(
        "Token validation failed. Make sure your PAT has 'repo' scope and hasn't expired.",
      );
      return false;
    }

    if (status < 200 || status >= 300) {
      vscode.window.showErrorMessage(`Failed to save token (HTTP ${status}).`);
      return false;
    }

    log(`GitHub token validated — authenticated as ${data.username}`);
    vscode.window.showInformationMessage(
      `Repository access configured as ${data.username}. You're all set!`,
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`SCM token setup failed: ${msg}`);
    vscode.window.showErrorMessage(`Failed to configure repository access: ${msg}`);
    return false;
  }
}

/**
 * Show an org picker if the user belongs to multiple orgs.
 * If user picks a different org, calls switch-org-key to get a new API key.
 * Returns the (possibly updated) apiKey and orgInfo.
 */
async function pickOrgIfMultiple(
  apiKey: string,
  currentOrgId: string | undefined,
  organizations: OrgInfo[] | undefined,
  log: (msg: string) => void,
): Promise<{ apiKey: string; orgId?: string; orgName?: string; orgSlug?: string }> {
  if (!organizations || organizations.length <= 1) {
    return { apiKey };
  }

  const items = organizations.map((org) => ({
    label: org.name,
    description: `${org.role}${org.id === currentOrgId ? " (current)" : ""}`,
    orgId: org.id,
    orgName: org.name,
    orgSlug: org.slug,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select an organization",
    title: "Which organization do you want to use?",
  });

  if (!picked || picked.orgId === currentOrgId) {
    // User cancelled or picked the current org — no change
    return { apiKey };
  }

  // Switch to the picked org — get a new API key
  log(`Switching to org: ${picked.label}`);
  try {
    const switchResult = await httpsPostJsonWithApiKey<{
      apiKey: string;
      orgId: string;
      orgName: string;
      orgSlug: string;
    }>(`${API_BASE}/api/auth/switch-org-key`, apiKey, { orgId: picked.orgId });

    if (switchResult.status >= 200 && switchResult.status < 300) {
      log(`Switched to ${switchResult.data.orgName}`);
      return {
        apiKey: switchResult.data.apiKey,
        orgId: switchResult.data.orgId,
        orgName: switchResult.data.orgName,
        orgSlug: switchResult.data.orgSlug,
      };
    }
    log(`Failed to switch org (HTTP ${switchResult.status}) — using default`);
  } catch (err) {
    log(`Org switch failed: ${err instanceof Error ? err.message : String(err)} — using default`);
  }

  return { apiKey };
}

/**
 * Install agent binary if needed, start it, and set context.
 * Shared by both SSO and API key flows.
 */
async function finishSetup(
  apiKey: string,
  log: (msg: string) => void,
  orgInfo?: { orgId?: string; orgName?: string; orgSlug?: string },
): Promise<boolean> {
  // Store API key securely — VS Code SecretStorage + OS keychain for agent binary
  log("Storing API key securely...");
  await storeApiKey(apiKey);
  const keychainOk = writeApiKeyToKeychain(apiKey);
  if (!keychainOk) {
    log("Warning: OS keychain not available — API key will be stored in config.json as fallback");
    if (process.platform === "linux") {
      vscode.window.showWarningMessage(
        "Credentials stored in plaintext (config.json). Install libsecret-tools for secure keychain storage.",
      );
    }
  }

  // Write config.json WITHOUT apiKey (it's now in the keychain).
  // If keychain write failed, include apiKey in config as fallback.
  log("Writing agent config...");
  writeAgentConfig({ apiUrl: API_BASE, apiKey: keychainOk ? "" : apiKey, ...orgInfo });

  // Set context key immediately so welcome view switches from "Create Account" to "Connect"
  // even if the install step below fails
  vscode.commands.executeCommand("setContext", "workermill.agentConfigured", true);

  if (!isAgentInstalled()) {
    log("Agent not installed — downloading...");
    const installed = await installAgent();
    if (!installed) {
      vscode.window.showWarningMessage(
        "Account connected but agent binary install failed. Run 'WorkerMill: Connect' to retry.",
      );
      return false;
    }
  }

  // Check dependencies BEFORE starting the agent — Git is a hard requirement
  const hasGit = await promptInstallGit(log);
  if (!hasGit) {
    vscode.window.showWarningMessage(
      "Git is required for WorkerMill. Install Git and reload VS Code to continue.",
    );
    return false;
  }

  // Claude CLI check — prompt before starting agent so the user can install it
  // before the agent's prerequisite check runs. "Skip" continues anyway.
  await promptInstallClaudeCli(log);

  log("Starting agent...");
  startAgentProcess(log);

  // Wait for agent to be ready (port file written) with progress indicator
  const port = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Starting WorkerMill agent...",
    },
    () => waitForAgentReady(log),
  );

  if (!port) {
    const error = readAgentStartupError();
    if (error) {
      if (/pulling|downloading|starting ollama/i.test(error)) {
        vscode.window.showInformationMessage(
          "WorkerMill agent is starting up (this may take a moment).",
        );
      } else {
        vscode.window.showErrorMessage(`WorkerMill agent failed to start: ${error}`);
      }
    } else {
      vscode.window.showWarningMessage(
        `Agent didn't start. Check ${getAgentLogPath()} for details.`,
      );
    }
    return false;
  }

  // Auto-enable Docker sandbox if available with sufficient RAM, otherwise warn
  const ramGB = Math.round(os.totalmem() / (1024 * 1024 * 1024));
  if (checkDockerAvailable() && ramGB >= 8) {
    // Auto-enable Docker sandbox — no prompt
    log("Docker detected with sufficient RAM — enabling sandbox mode");
    enableDockerSandbox(log);
    await stopAgentProcess();
    startAgentProcess(log);
    const dockerPort = await waitForAgentReady(log);
    if (!dockerPort) {
      // Docker sandbox failed to start — fall back to native
      log("Docker sandbox failed — falling back to native mode");
      disableDockerSandbox(log);
      startAgentProcess(log);
      await waitForAgentReady(log);
    }
  } else if (isDockerInstalled() && ramGB >= 8) {
    // Docker installed but not running — explain why Docker matters + confirm to skip
    let showPrompt = true;
    while (showPrompt) {
      const action = await vscode.window.showWarningMessage(
        "Docker Desktop is installed but not running. Without it, workers run as native processes " +
          "without filesystem isolation. Start Docker and WorkerMill will use it automatically.",
        "Open Docker Desktop",
        "Continue Without Sandbox",
      );
      if (action === "Continue Without Sandbox") {
        const confirm = await vscode.window.showInformationMessage(
          "You can start Docker later and enable sandbox in WorkerMill Settings.",
          "I Understand, Continue",
          "Go Back",
        );
        if (confirm === "I Understand, Continue") {
          showPrompt = false;
        }
        // "Go Back" or dismissed → loop back to step 1
        if (confirm !== "I Understand, Continue") {
          continue;
        }
      } else if (action === "Open Docker Desktop") {
        showPrompt = false;
        let launched = false;
        try {
          if (process.platform === "darwin") {
            execFileSync("open", ["-a", "Docker"], { timeout: 5000, stdio: "pipe", windowsHide: true });
            launched = true;
          } else if (process.platform === "linux") {
            // Linux: try starting Docker Engine via systemctl (most common setup)
            try {
              execFileSync("systemctl", ["start", "docker"], { timeout: 10_000, stdio: "pipe" });
              launched = true;
            } catch {
              // systemctl may require sudo or Docker Desktop may be installed instead
              try {
                execFileSync("systemctl", ["--user", "start", "docker-desktop"], { timeout: 10_000, stdio: "pipe" });
                launched = true;
              } catch {
                /* neither worked — will show manual start message below */
              }
            }
          } else {
            // Windows — try common Docker Desktop executable paths
            const dockerPaths = [
              "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe",
              `${process.env.LOCALAPPDATA || ""}\\Docker\\Docker Desktop.exe`,
              `${process.env.PROGRAMFILES || ""}\\Docker\\Docker\\Docker Desktop.exe`,
            ];
            for (const p of dockerPaths) {
              try {
                if (fs.existsSync(p)) {
                  execFileSync("cmd.exe", ["/c", "start", "", p], {
                    timeout: 5000,
                    stdio: "pipe",
                    windowsHide: true,
                  });
                  launched = true;
                  break;
                }
              } catch {
                /* try next path */
              }
            }
          }
        } catch (err) {
          log(`Failed to launch Docker Desktop: ${err instanceof Error ? err.message : String(err)}`);
        }

        if (launched) {
          vscode.window.showInformationMessage(
            "Docker Desktop is starting. WorkerMill will use it automatically once it's ready.",
          );
        } else {
          log("Could not find Docker Desktop executable — prompting manual start");
          vscode.window.showWarningMessage(
            "Could not launch Docker Desktop automatically. Please start it manually, then WorkerMill will use it automatically.",
          );
        }
      } else {
        // Dismissed — exit loop
        showPrompt = false;
      }
    }
  } else {
    // No Docker or insufficient RAM — two-step flow before native mode
    let showPrompt = true;
    while (showPrompt) {
      const action = await vscode.window.showWarningMessage(
        "Without Docker, AI workers run as native processes with the same permissions as any program " +
          "on your machine. For filesystem and network isolation, install Docker Desktop.",
        "Install Docker (Recommended)",
        "Continue Without Sandbox",
      );
      if (action === "Install Docker (Recommended)") {
        showPrompt = false;
        vscode.env.openExternal(
          vscode.Uri.parse("https://www.docker.com/products/docker-desktop/"),
        );
      } else if (action === "Continue Without Sandbox") {
        const confirm = await vscode.window.showInformationMessage(
          "You can enable sandbox mode later in WorkerMill Settings if you install Docker.",
          "I Understand, Continue",
          "Go Back",
        );
        if (confirm === "I Understand, Continue") {
          showPrompt = false;
        }
        // "Go Back" or dismissed → loop back to step 1
      } else {
        // Dismissed — exit loop
        showPrompt = false;
      }
    }
  }

  return true;
}

function checkDockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version"], { timeout: 5000, stdio: "pipe", windowsHide: true });
    return true;
  } catch {
    // On macOS, Docker CLI may not be in the extension host PATH even when installed.
    // Try via login shell (same approach used for findClaudeCli).
    if (process.platform === "darwin") {
      try {
        const shell = process.env.SHELL || "/bin/zsh";
        execFileSync(shell, ["-l", "-c", "docker version"], { timeout: 10_000, stdio: "pipe" });
        return true;
      } catch { /* truly not available */ }
    }
    return false;
  }
}

function isDockerInstalled(): boolean {
  try {
    execFileSync("docker", ["--version"], { timeout: 5000, stdio: "pipe", windowsHide: true });
    return true;
  } catch {
    if (process.platform === "darwin") {
      try {
        const shell = process.env.SHELL || "/bin/zsh";
        execFileSync(shell, ["-l", "-c", "docker --version"], { timeout: 10_000, stdio: "pipe" });
        return true;
      } catch { /* truly not installed */ }
    }
    return false;
  }
}

function enableDockerSandbox(log?: (msg: string) => void): void {
  const configPath = path.join(os.homedir(), ".workermill", "config.json");
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    /* no existing config */
  }
  config.sandbox = "docker";
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  log?.("Docker sandbox enabled in config");
}

function disableDockerSandbox(log?: (msg: string) => void): void {
  const configPath = path.join(os.homedir(), ".workermill", "config.json");
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    /* no existing config */
  }
  delete config.sandbox;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  log?.("Docker sandbox removed from config");
}

/**
 * Sign up via GitHub SSO — stays entirely inside VS Code.
 * Uses VS Code's built-in GitHub auth, exchanges token with WorkerMill API.
 */
export async function signUpWithGitHub(
  log: (msg: string) => void,
): Promise<boolean> {
  try {
    // Require TOS acceptance before proceeding with account creation
    // "View Terms" opens the URL and loops back to the prompt
    let tosAccepted = false;
    while (!tosAccepted) {
      const tosChoice = await vscode.window.showInformationMessage(
        "By creating a WorkerMill account, you agree to our Terms of Service and Privacy Policy.",
        { modal: true, detail: "https://workermill.com/terms\nhttps://workermill.com/privacy" },
        "I Agree",
        "View Terms",
      );
      if (tosChoice === "View Terms") {
        vscode.env.openExternal(vscode.Uri.parse("https://workermill.com/terms"));
        continue;
      }
      if (tosChoice !== "I Agree") return false;
      tosAccepted = true;
    }

    log("GitHub sign-up: requesting GitHub session...");
    const session = await vscode.authentication.getSession(
      "github",
      ["repo", "read:user", "user:email"],
      { createIfNone: true },
    );

    log(`GitHub session obtained for ${session.account.label}`);

    const { status, data } = await httpsPostJson<OnboardResponse>(
      `${API_BASE}/api/auth/github-onboard`,
      {
        githubToken: session.accessToken,
        githubUsername: session.account.label,
        tosAccepted: true,
      },
    );

    if (status === 409) {
      // Account exists — try sign-in automatically
      log("Account already exists — trying sign-in...");
      return signInWithGitHub(log);
    }

    if (status === 429) {
      vscode.window.showErrorMessage("Too many requests. Please wait a moment and try again.");
      return false;
    }

    if (status < 200 || status >= 300) {
      vscode.window.showErrorMessage(`Sign-up failed (HTTP ${status}). Please try again.`);
      return false;
    }

    log("Sign-up successful");

    // Prompt for SCM access before finishing setup
    await promptScmSetup(data.apiKey, log);

    const success = await finishSetup(data.apiKey, log, {
      orgId: data.orgId,
      orgName: data.orgName,
      orgSlug: data.orgSlug,
    });
    if (!success) return false;

    // Fire-and-forget — don't block client.connect() in extension.ts
    vscode.window
      .showInformationMessage(
        `Welcome to WorkerMill, ${data.name || session.account.label}! Your agent is connecting...`,
        "Open Dashboard",
      )
      .then((action) => {
        if (action === "Open Dashboard") {
          vscode.env.openExternal(vscode.Uri.parse(`${API_BASE}/dashboard`));
        }
      });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`GitHub sign-up error: ${msg}`);
    vscode.window.showErrorMessage(`GitHub sign-up failed: ${msg}`);
    return false;
  }
}

/**
 * Sign in via GitHub SSO — stays entirely inside VS Code.
 */
export async function signInWithGitHub(
  log: (msg: string) => void,
): Promise<boolean> {
  try {
    log("GitHub sign-in: checking for existing GitHub session...");

    // Check if there's already a cached GitHub session
    let session = await vscode.authentication.getSession(
      "github",
      ["repo", "read:user", "user:email"],
      { createIfNone: false },
    );

    if (session) {
      // Session exists — let user confirm or switch accounts
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: `Sign in as ${session.account.label}`,
            description: "Use your current GitHub account",
            action: "use" as const,
          },
          {
            label: "Use a different GitHub account",
            description: "Sign out and authenticate with another account",
            action: "switch" as const,
          },
        ],
        {
          placeHolder: `Signed into GitHub as ${session.account.label}`,
          title: "GitHub Account",
        },
      );

      if (!choice) return false; // cancelled

      if (choice.action === "switch") {
        log("User requested different GitHub account — forcing new session");
        session = await vscode.authentication.getSession(
          "github",
          ["repo", "read:user", "user:email"],
          { forceNewSession: true },
        );
      }
    } else {
      // No session — prompt to authenticate
      log("No GitHub session found — requesting authentication...");
      session = await vscode.authentication.getSession(
        "github",
        ["repo", "read:user", "user:email"],
        { createIfNone: true },
      );
    }

    log(`GitHub session obtained for ${session.account.label}`);

    let { status, data } = await httpsPostJson<OnboardResponse>(
      `${API_BASE}/api/auth/github-signin`,
      { githubToken: session.accessToken },
    );

    if (status === 404) {
      // No account — try sign-up automatically
      log("No account found — trying sign-up...");
      return signUpWithGitHub(log);
    }

    if (status === 429) {
      vscode.window.showErrorMessage("Too many requests. Please wait a moment and try again.");
      return false;
    }

    if (status < 200 || status >= 300) {
      vscode.window.showErrorMessage(`Sign-in failed (HTTP ${status}). Please try again.`);
      return false;
    }

    // If user belongs to multiple orgs, let them pick which one
    if (data.organizations && data.organizations.length > 1) {
      const items = data.organizations.map((org) => ({
        label: org.name,
        description: `${org.role}${org.id === data.orgId ? " (default)" : ""}`,
        orgId: org.id,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "Select an organization",
        title: "Which organization do you want to use?",
      });

      if (!picked) {
        // User cancelled — use the default org
        log("Org picker cancelled — using default org");
      } else if (picked.orgId !== data.orgId) {
        // User picked a different org — re-sign-in with that org
        log(`Switching to org: ${picked.label}`);
        const retry = await httpsPostJson<OnboardResponse>(
          `${API_BASE}/api/auth/github-signin`,
          { githubToken: session.accessToken, orgId: picked.orgId },
        );
        if (retry.status >= 200 && retry.status < 300) {
          data = retry.data;
        } else {
          log(`Failed to switch org (HTTP ${retry.status}) — using default`);
        }
      }
    }

    log("Sign-in successful");

    // Prompt for SCM access before finishing setup (skip if already configured)
    try {
      const scmCheck = await httpsGetJson<{ configured: boolean }>(
        `${API_BASE}/api/agent/scm-status`,
        data.apiKey,
      );
      if (!scmCheck.data.configured) {
        await promptScmSetup(data.apiKey, log);
      }
    } catch {
      // SCM status check failed — prompt anyway
      await promptScmSetup(data.apiKey, log);
    }

    const success = await finishSetup(data.apiKey, log, {
      orgId: data.orgId,
      orgName: data.orgName,
      orgSlug: data.orgSlug,
    });
    if (!success) return false;

    // Fire-and-forget — don't block client.connect() in extension.ts
    vscode.window
      .showInformationMessage(
        `Welcome back, ${data.name || session.account.label}! Agent is connecting...`,
        "Open Dashboard",
      )
      .then((action) => {
        if (action === "Open Dashboard") {
          vscode.env.openExternal(vscode.Uri.parse(`${API_BASE}/dashboard`));
        }
      });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`GitHub sign-in error: ${msg}`);
    vscode.window.showErrorMessage(`GitHub sign-in failed: ${msg}`);
    return false;
  }
}

/**
 * Fallback: prompt user to paste their API key manually.
 * For users who created their account on the web.
 */
export async function enterApiKey(
  log: (msg: string) => void,
): Promise<boolean> {
  const apiKey = await vscode.window.showInputBox({
    prompt: "Paste your WorkerMill API key (from Settings > Integrations)",
    placeHolder: "usr_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    password: false,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.trim()) return "API key is required";
      return null;
    },
  });

  if (!apiKey) return false;

  // Validate the key against the API
  log("Validating API key...");
  try {
    const { status } = await httpsGetJson<{ scmProvider?: string }>(
      `${API_BASE}/api/agent/config`,
      apiKey.trim(),
    );

    if (status === 401 || status === 403) {
      vscode.window.showErrorMessage(
        "Invalid API key. Check your key in Settings > Remote Agent at workermill.com.",
      );
      return false;
    }

    if (status < 200 || status >= 300) {
      vscode.window.showErrorMessage(`API key validation failed (HTTP ${status}). Try again.`);
      return false;
    }

    log("API key valid");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Validation error: ${msg}`);
    vscode.window.showErrorMessage(`Could not reach workermill.com: ${msg}`);
    return false;
  }

  const success = await finishSetup(apiKey.trim(), log);
  if (!success) return false;

  // Fire-and-forget — don't block client.connect() in extension.ts
  vscode.window
    .showInformationMessage(
      "Agent connected! Make sure your GitHub token is configured in Settings > Integrations.",
      "Open Settings",
    )
    .then((action) => {
      if (action === "Open Settings") {
        vscode.env.openExternal(vscode.Uri.parse(`${API_BASE}/settings`));
      }
    });

  return true;
}

/**
 * Sign in with email and password.
 * Handles MFA challenge if enabled on the account.
 * Exchanges JWT for a usr_ API key via /vscode-exchange.
 */
export async function signInWithEmail(log: (msg: string) => void): Promise<boolean> {
  try {
    const email = await vscode.window.showInputBox({
      prompt: "Enter your WorkerMill email address",
      placeHolder: "you@example.com",
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value.trim()) return "Email is required";
        if (!value.includes("@")) return "Please enter a valid email";
        return null;
      },
    });
    if (!email) return false;

    const password = await vscode.window.showInputBox({
      prompt: "Enter your password",
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value) return "Password is required";
        return null;
      },
    });
    if (!password) return false;

    log("Signing in with email...");

    const loginResult = await httpsPostJson<{
      tokens?: { accessToken: string; refreshToken: string; idToken: string };
      challengeRequired?: boolean;
      challengeName?: string;
      session?: string;
      email?: string;
      error?: string;
    }>(`${API_BASE}/api/auth/login`, { email: email.trim(), password });

    if (loginResult.status === 401) {
      vscode.window.showErrorMessage(
        (loginResult.data as any)?.error || "Invalid email or password.",
      );
      return false;
    }

    if (loginResult.status === 429) {
      vscode.window.showErrorMessage("Too many attempts. Please wait and try again.");
      return false;
    }

    if (loginResult.status < 200 || loginResult.status >= 300) {
      vscode.window.showErrorMessage(
        (loginResult.data as any)?.error || `Sign-in failed (HTTP ${loginResult.status}).`,
      );
      return false;
    }

    let accessToken: string;

    // Handle MFA challenge
    if (loginResult.data.challengeRequired) {
      log("MFA challenge required");
      const code = await vscode.window.showInputBox({
        prompt: "Enter your 6-digit authenticator code",
        placeHolder: "123456",
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value || !/^\d{6}$/.test(value)) return "Please enter a 6-digit code";
          return null;
        },
      });
      if (!code) return false;

      const mfaResult = await httpsPostJson<{
        tokens?: { accessToken: string };
        error?: string;
      }>(`${API_BASE}/api/auth/mfa-challenge`, {
        email: email.trim(),
        session: loginResult.data.session,
        code,
      });

      if (mfaResult.status < 200 || mfaResult.status >= 300) {
        vscode.window.showErrorMessage(
          (mfaResult.data as any)?.error || "MFA verification failed. Please try again.",
        );
        return false;
      }

      if (!mfaResult.data.tokens?.accessToken) {
        vscode.window.showErrorMessage("MFA verification failed: no token received.");
        return false;
      }

      accessToken = mfaResult.data.tokens.accessToken;
    } else {
      if (!loginResult.data.tokens?.accessToken) {
        vscode.window.showErrorMessage("Sign-in failed: no token received.");
        return false;
      }
      accessToken = loginResult.data.tokens.accessToken;
    }

    // Exchange JWT for API key
    log("Exchanging token for API key...");
    const exchangeResult = await httpsPostJsonWithBearer<OnboardResponse>(
      `${API_BASE}/api/auth/vscode-exchange`,
      accessToken,
    );

    if (exchangeResult.status < 200 || exchangeResult.status >= 300) {
      const errorMsg = (exchangeResult.data as any)?.error || `HTTP ${exchangeResult.status}`;
      vscode.window.showErrorMessage(`Failed to complete sign-in: ${errorMsg}`);
      return false;
    }

    const data = exchangeResult.data;
    log("Sign-in successful");

    // If user belongs to multiple orgs, let them pick which one
    const orgChoice = await pickOrgIfMultiple(data.apiKey, data.orgId, data.organizations, log);
    const activeApiKey = orgChoice.apiKey;
    const activeOrgId = orgChoice.orgId || data.orgId;
    const activeOrgName = orgChoice.orgName || data.orgName;
    const activeOrgSlug = orgChoice.orgSlug || data.orgSlug;

    const success = await finishSetup(activeApiKey, log, {
      orgId: activeOrgId,
      orgName: activeOrgName,
      orgSlug: activeOrgSlug,
    });
    if (!success) return false;

    // Fire-and-forget
    vscode.window
      .showInformationMessage(
        `Welcome back, ${data.name || email}! Agent is connecting...`,
        "Open Dashboard",
      )
      .then((action) => {
        if (action === "Open Dashboard") {
          vscode.env.openExternal(vscode.Uri.parse(`${API_BASE}/dashboard`));
        }
      });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Email sign-in error: ${msg}`);
    vscode.window.showErrorMessage(`Sign-in failed: ${msg}`);
    return false;
  }
}

/**
 * Sign in with Google SSO via browser OAuth + URI handler.
 * Opens the browser to Cognito hosted UI with Google identity provider.
 * Server exchanges code and redirects back to vscode:// URI with API key.
 */
export async function signInWithGoogle(log: (msg: string) => void): Promise<boolean> {
  try {
    // Get SSO config to build the authorize URL
    log("Fetching SSO configuration...");
    const ssoResult = await httpsGetJsonNoAuth<{
      hostedUiBaseUrl: string;
      clientId: string;
      providers: { name: string }[];
    }>(`${API_BASE}/api/auth/sso-config`);

    if (ssoResult.status !== 200) {
      vscode.window.showErrorMessage("Failed to get SSO configuration.");
      return false;
    }

    const hasGoogle = ssoResult.data.providers?.some((p) => p.name === "Google");
    if (!hasGoogle) {
      vscode.window.showErrorMessage("Google SSO is not enabled for this WorkerMill instance.");
      return false;
    }

    // Generate random state for CSRF protection
    const state = randomBytes(16).toString("hex");

    // Create a promise that resolves when the URI handler fires
    const result = new Promise<boolean>((resolve) => {
      pendingGoogleAuth = { state, resolve };
      // Timeout after 5 minutes
      setTimeout(() => {
        if (pendingGoogleAuth?.state === state) {
          pendingGoogleAuth = null;
          resolve(false);
        }
      }, 5 * 60 * 1000);
    });

    // Open browser with Cognito hosted UI pointing to Google
    const redirectUri = `${API_BASE}/api/auth/vscode-sso-callback`;
    const authorizeUrl =
      `${ssoResult.data.hostedUiBaseUrl}/oauth2/authorize` +
      `?identity_provider=Google` +
      `&client_id=${ssoResult.data.clientId}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=openid+email+profile` +
      `&state=${state}`;

    log("Opening browser for Google sign-in...");
    vscode.env.openExternal(vscode.Uri.parse(authorizeUrl));

    vscode.window.showInformationMessage(
      "Complete sign-in in your browser. VS Code will connect automatically.",
    );

    return await result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Google sign-in error: ${msg}`);
    vscode.window.showErrorMessage(`Google sign-in failed: ${msg}`);
    return false;
  }
}

/**
 * Handle the vscode://workermill.workermill/auth-callback URI.
 * Called by the URI handler registered in extension.ts.
 * Parses API key from query params and completes agent setup.
 */
export async function handleAuthCallback(
  uri: vscode.Uri,
  log: (msg: string) => void,
): Promise<boolean> {
  const params = new URLSearchParams(uri.query);

  const error = params.get("error");
  if (error) {
    vscode.window.showErrorMessage(`Sign-in failed: ${error}`);
    if (pendingGoogleAuth) {
      pendingGoogleAuth.resolve(false);
      pendingGoogleAuth = null;
    }
    return false;
  }

  const apiKey = params.get("apiKey");
  const state = params.get("state");

  if (!apiKey) {
    vscode.window.showErrorMessage("Sign-in failed: no API key received.");
    if (pendingGoogleAuth) {
      pendingGoogleAuth.resolve(false);
      pendingGoogleAuth = null;
    }
    return false;
  }

  // Validate state if we have a pending auth
  if (pendingGoogleAuth && state !== pendingGoogleAuth.state) {
    vscode.window.showErrorMessage("Sign-in failed: state mismatch. Please try again.");
    pendingGoogleAuth.resolve(false);
    pendingGoogleAuth = null;
    return false;
  }

  log("SSO callback received — setting up agent...");

  let activeApiKey = apiKey;
  const orgInfo = {
    orgId: params.get("orgId") || undefined,
    orgName: params.get("orgName") || undefined,
    orgSlug: params.get("orgSlug") || undefined,
  };

  // Google SSO redirect only carries the default org — fetch full org list
  // and let the user pick if they belong to multiple orgs.
  try {
    const orgsResult = await httpsGetJson<{
      organizations: OrgInfo[];
      currentOrgId: string;
    }>(`${API_BASE}/api/settings/organizations`, apiKey);

    if (orgsResult.status >= 200 && orgsResult.status < 300) {
      const orgChoice = await pickOrgIfMultiple(
        apiKey,
        orgInfo.orgId,
        orgsResult.data.organizations,
        log,
      );
      activeApiKey = orgChoice.apiKey;
      if (orgChoice.orgId) {
        orgInfo.orgId = orgChoice.orgId;
        orgInfo.orgName = orgChoice.orgName;
        orgInfo.orgSlug = orgChoice.orgSlug;
      }
    }
  } catch {
    // Org fetch failed — proceed with default org
    log("Could not fetch org list — using default org");
  }

  const success = await finishSetup(activeApiKey, log, orgInfo);

  if (pendingGoogleAuth) {
    pendingGoogleAuth.resolve(success);
    pendingGoogleAuth = null;
  }

  if (success) {
    const name = params.get("name") || params.get("email") || "there";
    // Fire-and-forget
    vscode.window
      .showInformationMessage(`Welcome, ${name}! Agent is connecting...`, "Open Dashboard")
      .then((action) => {
        if (action === "Open Dashboard") {
          vscode.env.openExternal(vscode.Uri.parse(`${API_BASE}/dashboard`));
        }
      });
  }

  return success;
}
