/**
 * Agent Installer — download and install the WorkerMill agent binary from GitHub Releases.
 *
 * Paths match install.sh (Linux/macOS) and install.ps1 (Windows):
 *   Linux/macOS: ~/.workermill/bin/workermill-agent
 *   Windows:     %LOCALAPPDATA%\workermill\bin\workermill-agent.exe
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import { spawn } from "child_process";

const GITHUB_REPO = "workermill/workermill";

interface GHRelease {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

export function getAgentBinaryPath(): string {
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "workermill", "bin", "workermill-agent.exe");
  }
  return path.join(os.homedir(), ".workermill", "bin", "workermill-agent");
}

export function isAgentInstalled(): boolean {
  return fs.existsSync(getAgentBinaryPath());
}

function getBinaryName(): string {
  const p = process.platform;
  const a = process.arch;
  if (p === "win32") return "workermill-agent-win-x64.exe";
  if (p === "darwin" && a === "arm64") return "workermill-agent-darwin-arm64";
  if (p === "darwin") return "workermill-agent-darwin-x64";
  return "workermill-agent-linux-x64";
}

/** Fetch JSON from an HTTPS URL, following redirects. */
function httpsGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "WorkerMill-VSCode" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); // drain response body before following redirect
        httpsGetJson<T>(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body) as T);
        } catch {
          reject(new Error("Invalid JSON"));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

/** Download a file from an HTTPS URL to disk, following redirects. */
function httpsDownload(
  url: string,
  dest: string,
  onProgress?: (percent: number) => void,
  token?: vscode.CancellationToken,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (token?.isCancellationRequested) {
      reject(new Error("Cancelled"));
      return;
    }

    const req = https.get(url, { headers: { "User-Agent": "WorkerMill-VSCode" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); // drain response body before following redirect
        httpsDownload(res.headers.location, dest, onProgress, token).then(resolve, reject);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }

      const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
      let receivedBytes = 0;
      const writer = fs.createWriteStream(dest);

      const cancelListener = token?.onCancellationRequested(() => {
        req.destroy();
        writer.close();
        try {
          fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
        reject(new Error("Cancelled"));
      });

      res.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (totalBytes > 0 && onProgress) {
          onProgress(Math.round((receivedBytes / totalBytes) * 100));
        }
      });

      res.pipe(writer);
      writer.on("finish", () => {
        cancelListener?.dispose();
        resolve();
      });
      writer.on("error", (err) => {
        cancelListener?.dispose();
        reject(err);
      });
    });

    req.on("error", reject);
    req.setTimeout(120_000, () => {
      req.destroy();
      reject(new Error("Download timeout"));
    });
  });
}

/**
 * Download and install the latest agent binary from GitHub Releases.
 * Shows a VS Code progress notification with cancel support.
 */
export async function installAgent(): Promise<boolean> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Installing WorkerMill Agent",
      cancellable: true,
    },
    async (progress, token) => {
      try {
        progress.report({ message: "Finding latest release..." });

        // Find latest agent release
        const releases = await httpsGetJson<GHRelease[]>(
          `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`,
        );
        const release = releases.find((r) => r.tag_name.startsWith("agent-v"));
        if (!release) {
          vscode.window.showErrorMessage("No agent release found on GitHub.");
          return false;
        }

        // Find matching binary asset
        const binaryName = getBinaryName();
        const asset = release.assets.find((a) => a.name === binaryName);
        if (!asset) {
          vscode.window.showErrorMessage(
            `No binary for your platform (${binaryName}) in ${release.tag_name}.`,
          );
          return false;
        }

        if (token.isCancellationRequested) return false;

        // Ensure install directory exists
        const binaryPath = getAgentBinaryPath();
        const installDir = path.dirname(binaryPath);
        fs.mkdirSync(installDir, { recursive: true });

        // Download
        const version = release.tag_name.replace(/^agent-v/, "");
        progress.report({ message: `Downloading v${version}...` });

        await httpsDownload(
          asset.browser_download_url,
          binaryPath,
          (percent) => {
            progress.report({ message: `Downloading v${version}... ${percent}%` });
          },
          token,
        );

        // Make executable on Unix
        if (process.platform !== "win32") {
          fs.chmodSync(binaryPath, 0o755);
        }

        vscode.window.showInformationMessage(`WorkerMill Agent v${version} installed.`);
        return true;
      } catch (err) {
        if (err instanceof Error && err.message === "Cancelled") return false;
        vscode.window.showErrorMessage(
          `Agent install failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
    },
  );
}

/** Spawn the agent as a detached background process. */
export function startAgentProcess(): void {
  const binary = getAgentBinaryPath();
  const child = spawn(binary, ["start", "--detach"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

/** Stop a running agent by invoking `workermill-agent stop`. */
export async function stopAgentProcess(): Promise<boolean> {
  const binary = getAgentBinaryPath();
  if (!fs.existsSync(binary)) return false;

  return new Promise((resolve) => {
    const child = spawn(binary, ["stop"], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
    // Timeout after 20s (agent stop waits up to 15s internally)
    setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      resolve(false);
    }, 20_000);
  });
}

/** Check if the agent config file exists (setup has been completed). */
export function isAgentConfigured(): boolean {
  const configPath = path.join(os.homedir(), ".workermill", "config.json");
  return fs.existsSync(configPath);
}
