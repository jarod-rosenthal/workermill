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
      vscode.window.showErrorMessage(`WorkerMill agent failed to start: ${error}`);
    } else {
      vscode.window.showWarningMessage(
        "Agent didn't start. Check ~/.workermill/agent.log for details.",
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
    // Docker installed but not running — prompt to start it
    const action = await vscode.window.showWarningMessage(
      "Docker Desktop is installed but not running. Start it to enable sandbox mode — " +
        "WorkerMill will use it automatically.",
      "Open Docker Desktop",
      "Continue Without Docker",
    );
    if (action === "Open Docker Desktop") {
      let launched = false;
      try {
        if (process.platform === "darwin") {
          execFileSync("open", ["-a", "Docker"], { timeout: 5000, stdio: "pipe", windowsHide: true });
          launched = true;
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
    }
  } else {
    // No Docker or insufficient RAM — warn the user
    const action = await vscode.window.showWarningMessage(
      "AI workers will run with full access to your filesystem and network. " +
        "For isolated execution, install Docker Desktop — WorkerMill will use it automatically.",
      "Install Docker Desktop",
      "Continue Without Docker",
    );
    if (action === "Install Docker Desktop") {
      vscode.env.openExternal(
        vscode.Uri.parse("https://www.docker.com/products/docker-desktop/"),
      );
    }
  }

  return true;
}

function checkDockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version"], { timeout: 5000, stdio: "pipe", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function isDockerInstalled(): boolean {
  try {
    execFileSync("docker", ["--version"], { timeout: 5000, stdio: "pipe", windowsHide: true });
    return true;
  } catch {
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
    const success = await finishSetup(data.apiKey, log, {
      orgId: data.orgId,
      orgName: data.orgName,
      orgSlug: data.orgSlug,
    });
    if (!success) return false;

    // Fire-and-forget — don't block client.connect() in extension.ts
    vscode.window
      .showInformationMessage(
        `Welcome to WorkerMill, ${data.name || session.account.label}! Your GitHub token has been configured automatically.`,
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
