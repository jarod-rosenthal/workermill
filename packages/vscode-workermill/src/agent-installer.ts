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
import * as crypto from "crypto";
import { spawn, execFileSync } from "child_process";

const GITHUB_REPO = "workermill/workermill";

interface GHRelease {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

/** Canonical install location used by install.sh / install.ps1 and the installer. */
function getCanonicalInstallPath(): string {
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "workermill", "bin", "workermill-agent.exe");
  }
  return path.join(os.homedir(), ".workermill", "bin", "workermill-agent");
}

/**
 * Resolve the agent binary path.
 * Checks: canonical install → direct PATH → login shell PATH (for nvm/brew/etc).
 */
export function getAgentBinaryPath(): string {
  const canonical = getCanonicalInstallPath();
  if (fs.existsSync(canonical)) return canonical;

  const name = process.platform === "win32" ? "workermill-agent.exe" : "workermill-agent";

  // Check direct PATH (works if nvm/etc is already in extension host PATH)
  try {
    const cmd = process.platform === "win32" ? "where.exe" : "which";
    const result = execFileSync(cmd, [name], { encoding: "utf-8", timeout: 5000 }).trim();
    const firstMatch = result.split("\n")[0];
    if (firstMatch && fs.existsSync(firstMatch)) return firstMatch;
  } catch { /* not on PATH */ }

  // Check via login shell (nvm, brew, etc. are initialized in .bashrc/.zshrc)
  if (process.platform !== "win32") {
    try {
      const shell = process.env.SHELL || "/bin/bash";
      const result = execFileSync(shell, ["-l", "-c", `which ${name}`], {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      const firstMatch = result.split("\n")[0];
      if (firstMatch && fs.existsSync(firstMatch)) return firstMatch;
    } catch { /* not found via login shell either */ }
  }

  // Return canonical as default (used as install target when binary doesn't exist yet)
  return canonical;
}

export function isAgentInstalled(): boolean {
  const binary = getAgentBinaryPath();
  return fs.existsSync(binary);
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

        // Ensure install directory exists (always install to canonical location)
        const binaryPath = getCanonicalInstallPath();
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

/** Read the PID from the agent PID file, or 0 if missing/invalid. */
function readAgentPid(): number {
  const pidFile = path.join(os.homedir(), ".workermill", "agent.pid");
  try {
    return parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/** Check if a process is alive. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Remove stale PID and port files. */
function cleanAgentState(): void {
  const wmDir = path.join(os.homedir(), ".workermill");
  for (const name of ["agent.pid", "agent.port"]) {
    try {
      fs.unlinkSync(path.join(wmDir, name));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Spawn the agent as a detached background process.
 *
 * We run `start` in foreground mode (NOT `--detach`) because the agent's
 * --detach uses process.execPath which only works for the compiled binary.
 * For npm-linked installs, process.execPath is the Node.js binary which
 * can't re-invoke itself. Instead, we detach from the VS Code side by
 * redirecting stdio to the log file and calling child.unref().
 */
export function startAgentProcess(log?: (msg: string) => void): void {
  const binary = getAgentBinaryPath();
  log?.(`Binary resolved to: ${binary}`);
  log?.(`Binary exists: ${fs.existsSync(binary)}`);

  // If agent is already running, don't start another
  const existingPid = readAgentPid();
  if (existingPid && isProcessAlive(existingPid)) {
    log?.(`Agent already running (PID ${existingPid}) — skipping start`);
    return;
  }
  if (existingPid) {
    log?.(`Stale PID ${existingPid} found — cleaning up`);
  }

  // Agent is not running — clean up any stale state files
  cleanAgentState();

  // Redirect agent output to its log file
  const wmDir = path.join(os.homedir(), ".workermill");
  fs.mkdirSync(wmDir, { recursive: true });
  const logFile = path.join(wmDir, "agent.log");
  const logFd = fs.openSync(logFile, "a");

  try {
    const child = spawn(binary, ["start"], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });

    child.on("error", (err) => {
      log?.(`Spawn error: ${err.message}`);
    });

    child.unref();
    log?.(`Agent spawned (child PID ${child.pid})`);
  } catch (err) {
    log?.(`Spawn failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    fs.closeSync(logFd);
  }
}

/** Stop a running agent — tries graceful stop, then falls back to SIGTERM + cleanup. */
export async function stopAgentProcess(): Promise<boolean> {
  const binary = getAgentBinaryPath();

  // Try graceful stop via CLI command
  if (fs.existsSync(binary)) {
    const stopped = await new Promise<boolean>((resolve) => {
      const child = spawn(binary, ["stop"], { stdio: "ignore" });
      child.on("close", (code) => resolve(code === 0));
      child.on("error", () => resolve(false));
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        resolve(false);
      }, 10_000);
    });
    if (stopped) {
      cleanAgentState();
      return true;
    }
  }

  // Graceful stop failed — kill process directly via PID
  const pid = readAgentPid();
  if (pid && isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* ignore */
    }
    // Wait briefly for it to die
    await new Promise((r) => setTimeout(r, 1000));
    if (isProcessAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }

  cleanAgentState();
  return true;
}

/** Check if the agent config file exists (setup has been completed). */
export function isAgentConfigured(): boolean {
  const configPath = path.join(os.homedir(), ".workermill", "config.json");
  return fs.existsSync(configPath);
}

/** Write agent config file. SCM tokens come from the API at runtime, not from the extension. */
export function writeAgentConfig(opts: {
  apiUrl: string;
  apiKey: string;
}): void {
  const wmDir = path.join(os.homedir(), ".workermill");
  fs.mkdirSync(wmDir, { recursive: true });
  const configPath = path.join(wmDir, "config.json");

  // Preserve existing config if present (don't clobber agent name, tokens, etc.)
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    /* no existing config */
  }

  const config = {
    ...existing,
    apiUrl: opts.apiUrl,
    apiKey: opts.apiKey,
    agentId: (existing.agentId as string) || `agent-${os.hostname()}`,
    maxWorkers: (existing.maxWorkers as number) || 1,
    pollIntervalMs: (existing.pollIntervalMs as number) || 5000,
    heartbeatIntervalMs: (existing.heartbeatIntervalMs as number) || 30000,
    setupCompletedAt: new Date().toISOString(),
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}
