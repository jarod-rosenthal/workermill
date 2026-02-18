/**
 * GitHub Onboarding — sign up or sign in to WorkerMill via GitHub OAuth.
 *
 * Uses VS Code's built-in GitHub authentication provider to get an access token,
 * then exchanges it with the WorkerMill API for an agent API key.
 */

import * as vscode from "vscode";
import * as https from "https";
import {
  isAgentInstalled,
  installAgent,
  startAgentProcess,
  writeAgentConfig,
} from "./agent-installer";

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
            reject(new Error(`Invalid JSON response (HTTP ${res.statusCode})`));
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
      "https://workermill.com/api/auth/github-onboard",
      {
        githubToken: session.accessToken,
        githubUsername: session.account.label,
      },
    );

    if (status === 409) {
      vscode.window.showWarningMessage(
        "A WorkerMill account already exists for this GitHub user. Try signing in instead.",
      );
      return false;
    }

    if (status === 429) {
      vscode.window.showErrorMessage(
        "Too many requests. Please wait a moment and try again.",
      );
      return false;
    }

    if (status < 200 || status >= 300) {
      vscode.window.showErrorMessage(
        `Sign-up failed (HTTP ${status}). Please try again.`,
      );
      return false;
    }

    log("Sign-up successful — writing agent config...");
    writeAgentConfig({
      apiUrl: data.apiUrl,
      apiKey: data.apiKey,
      githubToken: session.accessToken,
    });

    if (!isAgentInstalled()) {
      log("Agent not installed — installing...");
      const installed = await installAgent();
      if (!installed) {
        vscode.window.showWarningMessage(
          "Account created but agent install failed. Run 'WorkerMill: Install Agent' to retry.",
        );
        return false;
      }
    }

    log("Starting agent...");
    startAgentProcess(log);

    vscode.commands.executeCommand(
      "setContext",
      "workermill.agentConfigured",
      true,
    );

    vscode.window.showInformationMessage(
      `Welcome to WorkerMill, ${data.name || session.account.label}!`,
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`GitHub sign-up error: ${msg}`);
    vscode.window.showErrorMessage(`GitHub sign-up failed: ${msg}`);
    return false;
  }
}

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
      "https://workermill.com/api/auth/github-signin",
      {
        githubToken: session.accessToken,
      },
    );

    if (status === 404) {
      vscode.window.showWarningMessage(
        "No WorkerMill account found for this GitHub user. Try signing up first.",
      );
      return false;
    }

    if (status === 429) {
      vscode.window.showErrorMessage(
        "Too many requests. Please wait a moment and try again.",
      );
      return false;
    }

    if (status < 200 || status >= 300) {
      vscode.window.showErrorMessage(
        `Sign-in failed (HTTP ${status}). Please try again.`,
      );
      return false;
    }

    log("Sign-in successful — writing agent config...");
    writeAgentConfig({
      apiUrl: data.apiUrl,
      apiKey: data.apiKey,
      githubToken: session.accessToken,
    });

    if (!isAgentInstalled()) {
      log("Agent not installed — installing...");
      const installed = await installAgent();
      if (!installed) {
        vscode.window.showWarningMessage(
          "Signed in but agent install failed. Run 'WorkerMill: Install Agent' to retry.",
        );
        return false;
      }
    }

    log("Starting agent...");
    startAgentProcess(log);

    vscode.commands.executeCommand(
      "setContext",
      "workermill.agentConfigured",
      true,
    );

    vscode.window.showInformationMessage(
      `Welcome back, ${data.name || session.account.label}!`,
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`GitHub sign-in error: ${msg}`);
    vscode.window.showErrorMessage(`GitHub sign-in failed: ${msg}`);
    return false;
  }
}
