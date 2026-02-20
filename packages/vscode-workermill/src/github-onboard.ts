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
import {
  isAgentInstalled,
  installAgent,
  startAgentProcess,
  writeAgentConfig,
  promptInstallClaudeCli,
} from "./agent-installer";

const API_BASE = "https://workermill.com";

interface OnboardResponse {
  apiKey: string;
  apiUrl: string;
  orgSlug: string;
  userId: string;
  email: string;
  name: string;
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
async function finishSetup(apiKey: string, log: (msg: string) => void): Promise<boolean> {
  log("Writing agent config...");
  writeAgentConfig({ apiUrl: API_BASE, apiKey });

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

  log("Starting agent...");
  startAgentProcess(log);

  // Check if Claude Code CLI is installed — required for AI worker execution
  await promptInstallClaudeCli(log);

  return true;
}

/**
 * Sign up via GitHub SSO — stays entirely inside VS Code.
 * Uses VS Code's built-in GitHub auth, exchanges token with WorkerMill API.
 */
export async function signUpWithGitHub(
  log: (msg: string) => void,
): Promise<boolean> {
  try {
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
    const success = await finishSetup(data.apiKey, log);
    if (!success) return false;

    // Guide to next step — SCM token is already saved server-side by github-onboard,
    // but user may need to configure issue tracker
    const action = await vscode.window.showInformationMessage(
      `Welcome to WorkerMill, ${data.name || session.account.label}! Your GitHub token has been configured automatically.`,
      "Open Dashboard",
    );
    if (action === "Open Dashboard") {
      vscode.env.openExternal(vscode.Uri.parse(`${API_BASE}/dashboard`));
    }
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
    log("GitHub sign-in: requesting GitHub session...");
    const session = await vscode.authentication.getSession(
      "github",
      ["repo", "read:user", "user:email"],
      { createIfNone: true },
    );

    log(`GitHub session obtained for ${session.account.label}`);

    const { status, data } = await httpsPostJson<OnboardResponse>(
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

    log("Sign-in successful");
    const success = await finishSetup(data.apiKey, log);
    if (!success) return false;

    const action = await vscode.window.showInformationMessage(
      `Welcome back, ${data.name || session.account.label}! Agent is connecting...`,
      "Open Dashboard",
    );
    if (action === "Open Dashboard") {
      vscode.env.openExternal(vscode.Uri.parse(`${API_BASE}/dashboard`));
    }
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
    prompt: "Paste your WorkerMill API key (from Settings > Remote Agent)",
    placeHolder: "org_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    password: false,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.trim()) return "API key is required";
      if (!value.startsWith("org_")) return "API key should start with org_";
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

  // Guide to next step — they need SCM tokens configured on the web
  const action = await vscode.window.showInformationMessage(
    "Agent connected! Make sure your GitHub token is configured in Settings > Integrations.",
    "Open Settings",
  );
  if (action === "Open Settings") {
    vscode.env.openExternal(vscode.Uri.parse(`${API_BASE}/settings`));
  }

  return true;
}
