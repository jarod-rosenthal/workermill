/**
 * Agent Installer — download and install the WorkerMill agent binary from CDN.
 *
 * CDN: https://workermill.com/agent/latest/{binary}
 * Version manifest: https://workermill.com/agent/latest.json
 *
 * Install paths match install.sh (Linux/macOS) and install.ps1 (Windows):
 *   Linux/macOS: ~/.workermill/bin/workermill-agent
 *   Windows:     %LOCALAPPDATA%\workermill\bin\workermill-agent.exe
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import { spawn, execFileSync } from "child_process";

const CDN_BASE = "https://workermill.com/agent/latest";

/**
 * Check if Git is installed and on PATH.
 * Returns the path if found, null if not.
 */
export function findGit(): string | null {
  const isWin = process.platform === "win32";
  const name = isWin ? "git.exe" : "git";

  try {
    const cmd = isWin ? "where.exe" : "which";
    const result = execFileSync(cmd, [name], { encoding: "utf-8", timeout: 5000, windowsHide: true }).trim();
    const firstMatch = result.split("\n")[0];
    if (firstMatch && fs.existsSync(firstMatch)) return firstMatch;
  } catch { /* not on PATH */ }

  // On Windows, re-read PATH from registry to detect post-startup installs
  if (isWin) {
    const freshResult = findOnFreshWindowsPath(name);
    if (freshResult) return freshResult;
  }

  // Check known install locations on Windows
  if (isWin) {
    const candidates = [
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "cmd", "git.exe"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "git.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Git", "cmd", "git.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Git", "bin", "git.exe"),
      path.join(os.homedir(), "AppData", "Local", "Programs", "Git", "cmd", "git.exe"),
      path.join(os.homedir(), "AppData", "Local", "Programs", "Git", "bin", "git.exe"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }

  return null;
}

/**
 * Prompt the user to install Git if missing.
 * Runs the installer in a VS Code terminal (winget on Windows, brew/apt on Unix),
 * then polls for the binary — same pattern as promptInstallClaudeCli.
 */
export async function promptInstallGit(
  log?: (msg: string) => void,
): Promise<boolean> {
  if (findGit()) return true;

  log?.("Git not found — prompting user to install");

  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const action = await vscode.window.showWarningMessage(
    "Git is required for WorkerMill to clone repositories and run tasks. Install it now?",
    "Install Git",
    "Skip for Now",
  );

  if (action !== "Install Git") return false;

  let installCmd: string;
  if (isWin) {
    installCmd = "winget install --id Git.Git -e --source winget";
  } else if (isMac) {
    installCmd = "xcode-select --install 2>/dev/null || brew install git";
  } else {
    installCmd = "sudo apt-get install -y git || sudo dnf install -y git || sudo pacman -S --noconfirm git";
  }

  const terminal = vscode.window.createTerminal({
    name: "Install Git",
    iconPath: new vscode.ThemeIcon("cloud-download"),
  });
  terminal.show();
  terminal.sendText(installCmd);

  log?.(`Running: ${installCmd}`);

  // Poll for git to appear
  const found = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Waiting for Git install to complete...",
      cancellable: true,
    },
    async (_progress, token) => {
      const maxWaitMs = 120_000;
      const pollMs = 3_000;
      const start = Date.now();

      while (Date.now() - start < maxWaitMs) {
        if (token.isCancellationRequested) return false;
        await new Promise((r) => setTimeout(r, pollMs));
        if (findGit()) return true;
      }
      return false;
    },
  );

  if (found) {
    log?.(`Git detected at: ${findGit()}`);
    vscode.window.showInformationMessage("Git installed successfully!");
    return true;
  }

  log?.("Git not detected after install — may need VS Code reload");
  const reload = await vscode.window.showWarningMessage(
    "Git install finished but wasn't detected. You may need to reload VS Code for PATH changes to take effect.",
    "Reload Window",
    "Continue Anyway",
  );

  if (reload === "Reload Window") {
    vscode.commands.executeCommand("workbench.action.reloadWindow");
    return false;
  }

  return true;
}

/**
 * On Windows, read the FULL current PATH from the registry (user + system)
 * so we can detect binaries installed after the extension host started.
 * Returns the resolved path if found, null otherwise.
 */
function findOnFreshWindowsPath(name: string): string | null {
  const allDirs: string[] = [];

  // Read system PATH (HKLM — where Git installer typically writes)
  try {
    const sysOut = execFileSync(
      "reg",
      ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", "/v", "Path"],
      { encoding: "utf-8", timeout: 5000, windowsHide: true },
    );
    const match = sysOut.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
    if (match) {
      allDirs.push(...match[1].trim().split(";").filter(Boolean));
    }
  } catch { /* registry read failed */ }

  // Read user PATH (HKCU — where some winget installs write)
  try {
    const userOut = execFileSync(
      "reg",
      ["query", "HKCU\\Environment", "/v", "Path"],
      { encoding: "utf-8", timeout: 5000, windowsHide: true },
    );
    const match = userOut.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
    if (match) {
      allDirs.push(...match[1].trim().split(";").filter(Boolean));
    }
  } catch { /* registry read failed */ }

  for (const dir of allDirs) {
    const expanded = dir.replace(/%([^%]+)%/g, (_, v) => process.env[v] || "");
    const candidate = path.join(expanded, name);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

/** Read the full fresh PATH string from Windows registry (user + system). */
function getFreshWindowsPath(): string {
  const parts: string[] = [];

  try {
    const sysOut = execFileSync(
      "reg",
      ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", "/v", "Path"],
      { encoding: "utf-8", timeout: 5000, windowsHide: true },
    );
    const match = sysOut.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
    if (match) parts.push(match[1].trim().replace(/%([^%]+)%/g, (_, v) => process.env[v] || ""));
  } catch { /* ignore */ }

  try {
    const userOut = execFileSync(
      "reg",
      ["query", "HKCU\\Environment", "/v", "Path"],
      { encoding: "utf-8", timeout: 5000, windowsHide: true },
    );
    const match = userOut.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
    if (match) parts.push(match[1].trim().replace(/%([^%]+)%/g, (_, v) => process.env[v] || ""));
  } catch { /* ignore */ }

  return parts.join(";");
}

/**
 * Check if Claude Code CLI is installed. Mirrors the agent's findClaudePath() logic.
 * Returns the path if found, null if not.
 */
export function findClaudeCli(): string | null {
  const isWin = process.platform === "win32";
  const name = isWin ? "claude.exe" : "claude";

  // Check PATH first (uses extension host's cached PATH)
  try {
    const cmd = isWin ? "where.exe" : "which";
    const result = execFileSync(cmd, [name], { encoding: "utf-8", timeout: 5000, windowsHide: true }).trim();
    const firstMatch = result.split("\n")[0];
    if (firstMatch && fs.existsSync(firstMatch)) return firstMatch;
  } catch { /* not on PATH */ }

  // On Windows, re-read PATH from registry to detect post-startup installs
  if (isWin) {
    const freshResult = findOnFreshWindowsPath(name);
    if (freshResult) return freshResult;
  }

  // Check via login shell (nvm, brew, etc.)
  if (!isWin) {
    try {
      const shell = process.env.SHELL || "/bin/bash";
      const result = execFileSync(shell, ["-l", "-c", `which ${name}`], {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      const firstMatch = result.split("\n")[0];
      if (firstMatch && fs.existsSync(firstMatch)) return firstMatch;
    } catch { /* not found */ }
  }

  // Check known install locations
  const candidates: string[] = [];
  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    candidates.push(
      // winget install locations
      path.join(localAppData, "Microsoft", "WinGet", "Links", "claude.exe"),
      path.join(localAppData, "Microsoft", "WindowsApps", "claude.exe"),
      // Standard install locations
      path.join(process.env.ProgramFiles || "C:\\Program Files", "ClaudeCode", "claude.exe"),
      path.join(localAppData, "Programs", "ClaudeCode", "claude.exe"),
      path.join(localAppData, "Programs", "claude-code", "claude.exe"),
      // npm global
      path.join(appData, "npm", "claude.cmd"),
      path.join(localAppData, "npm", "claude.cmd"),
      // Other
      path.join(os.homedir(), ".local", "bin", "claude.exe"),
      path.join(os.homedir(), ".claude", "bin", "claude.exe"),
    );
  } else {
    candidates.push(
      path.join(os.homedir(), ".local", "bin", "claude"),
      path.join(os.homedir(), ".claude", "bin", "claude"),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
    );
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }

  return null;
}

/**
 * Prompt the user to install Claude Code CLI if missing.
 * Runs the installer in a VS Code terminal, then polls for the binary
 * so we can confirm success and continue the setup flow.
 * Returns true if Claude was already installed or was successfully installed.
 */
export async function promptInstallClaudeCli(
  log?: (msg: string) => void,
): Promise<boolean> {
  if (findClaudeCli()) return true;

  log?.("Claude Code CLI not found — prompting user to install");

  const isWin = process.platform === "win32";
  const action = await vscode.window.showWarningMessage(
    "Claude Code CLI is required for AI workers to run tasks. Install it now?",
    "Install Claude Code",
    "Skip for Now",
  );

  if (action !== "Install Claude Code") return false;

  const installCmd = isWin
    ? "winget install Anthropic.ClaudeCode"
    : "curl -fsSL https://claude.ai/install.sh | bash";

  const terminal = vscode.window.createTerminal({
    name: "Install Claude Code",
    iconPath: new vscode.ThemeIcon("cloud-download"),
  });
  terminal.show();
  terminal.sendText(installCmd);

  log?.(`Running: ${installCmd}`);

  // Poll for the binary to appear (installer writes to known paths)
  const found = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Waiting for Claude Code install to complete...",
      cancellable: true,
    },
    async (_progress, token) => {
      const maxWaitMs = 120_000; // 2 minutes
      const pollMs = 3_000;
      const start = Date.now();

      while (Date.now() - start < maxWaitMs) {
        if (token.isCancellationRequested) return false;
        await new Promise((r) => setTimeout(r, pollMs));
        if (findClaudeCli()) return true;
      }
      return false;
    },
  );

  if (found) {
    log?.(`Claude Code CLI detected at: ${findClaudeCli()}`);
    vscode.window.showInformationMessage(
      "Claude Code installed successfully! Your WorkerMill setup is complete.",
    );
    return true;
  }

  // Install may have succeeded but binary is in a path we don't check,
  // or the extension host needs a reload to pick up PATH changes
  log?.("Claude Code CLI not detected after install — may need VS Code reload");
  const reload = await vscode.window.showWarningMessage(
    "Claude Code install finished but wasn't detected. You may need to reload VS Code for PATH changes to take effect.",
    "Reload Window",
    "Continue Anyway",
  );

  if (reload === "Reload Window") {
    vscode.commands.executeCommand("workbench.action.reloadWindow");
    return false; // won't reach here after reload
  }

  return true; // user chose to continue
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
    const result = execFileSync(cmd, [name], { encoding: "utf-8", timeout: 5000, windowsHide: true }).trim();
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
 * Download and install the latest agent binary from the CDN.
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
        progress.report({ message: "Checking latest version..." });

        const manifest = await httpsGetJson<{ version: string }>(
          "https://workermill.com/agent/latest.json",
        );
        const version = manifest.version;
        const binaryName = getBinaryName();

        if (token.isCancellationRequested) return false;

        // Ensure install directory exists (always install to canonical location)
        const binaryPath = getCanonicalInstallPath();
        const installDir = path.dirname(binaryPath);
        fs.mkdirSync(installDir, { recursive: true });

        progress.report({ message: `Downloading v${version}...` });

        await httpsDownload(
          `${CDN_BASE}/${binaryName}`,
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
  // Open os.devNull with an absolute path (\\.\nul on Windows) to avoid
  // Node resolving NUL relative to the extension host CWD (VS Code install dir).
  const stdinFd = fs.openSync(os.devNull, "r");

  try {
    // Build a PATH that includes known binary locations so the agent's
    // prerequisite checks pass even when VS Code's inherited PATH is stale
    // (e.g. Git/Claude installed via winget after VS Code launched)
    const env = { ...process.env };
    const extraDirs: string[] = [];

    // Add Git's directory if we can find it, and pass the full path
    // as WORKERMILL_GIT_PATH so the agent doesn't need to re-discover it
    const gitPath = findGit();
    if (gitPath) {
      extraDirs.push(path.dirname(gitPath));
      env.WORKERMILL_GIT_PATH = gitPath;
      log?.(`Found Git at: ${gitPath}`);
    }

    // Add Claude CLI's directory if we can find it, and pass the full path
    // as CLAUDE_CLI_PATH so the agent doesn't need to re-discover it
    const claudePath = findClaudeCli();
    if (claudePath) {
      extraDirs.push(path.dirname(claudePath));
      env.CLAUDE_CLI_PATH = claudePath;
      log?.(`Found Claude CLI at: ${claudePath}`);
    }

    // On Windows, read fresh PATH from registry (both system HKLM + user HKCU)
    // This is critical because Git installer writes to HKLM, not HKCU
    if (process.platform === "win32") {
      const freshPath = getFreshWindowsPath();
      if (freshPath) {
        extraDirs.push(freshPath);
        log?.("Refreshed PATH from registry (system + user)");
      }
    }

    if (extraDirs.length > 0) {
      const sep = process.platform === "win32" ? ";" : ":";
      env.PATH = `${extraDirs.join(sep)}${sep}${process.env.PATH || ""}`;
    }

    const child = spawn(binary, ["start"], {
      detached: true,
      stdio: [stdinFd, logFd, logFd],
      env,
      cwd: wmDir,
      windowsHide: true,
    });

    child.on("error", (err) => {
      log?.(`Spawn error: ${err.message}`);
    });

    child.unref();
    log?.(`Agent spawned (child PID ${child.pid})`);
  } catch (err) {
    log?.(`Spawn failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    fs.closeSync(stdinFd);
    fs.closeSync(logFd);
  }
}

/**
 * Stop a running agent — SIGTERM via PID first (fast), then CLI fallback.
 * VS Code's deactivate() has a tight time budget, so we skip the slow CLI
 * "stop" command and go straight to SIGTERM. The agent handles SIGTERM
 * gracefully (deregisters, cleans up workers, removes PID file).
 */
export async function stopAgentProcess(): Promise<boolean> {
  // Fast path: SIGTERM via PID (completes in <1s typically)
  const pid = readAgentPid();
  if (pid && isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* ignore */
    }
    // Brief wait for graceful exit
    await new Promise((r) => setTimeout(r, 2000));
    if (isProcessAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
    cleanAgentState();
    return true;
  }

  // No PID or process already dead — try CLI stop as fallback
  // (handles edge case where PID file was deleted but process is alive)
  const binary = getAgentBinaryPath();
  if (fs.existsSync(binary)) {
    const stopped = await new Promise<boolean>((resolve) => {
      const child = spawn(binary, ["stop"], { stdio: "pipe", cwd: os.homedir(), windowsHide: true });
      child.on("close", (code) => resolve(code === 0));
      child.on("error", () => resolve(false));
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        resolve(false);
      }, 5_000);
    });
    if (stopped) {
      cleanAgentState();
      return true;
    }
  }

  cleanAgentState();
  return true;
}

/**
 * Wait for the agent to start and be ready (port file written).
 * Returns the port number if ready, 0 if timeout.
 */
export async function waitForAgentReady(
  log?: (msg: string) => void,
  timeoutMs = 15_000,
): Promise<number> {
  const portFile = path.join(os.homedir(), ".workermill", "agent.port");
  const pollMs = 500;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const port = parseInt(fs.readFileSync(portFile, "utf-8").trim(), 10);
      if (port > 0) {
        log?.(`Agent ready on port ${port}`);
        return port;
      }
    } catch {
      /* port file not written yet */
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  log?.("Agent did not become ready within timeout");
  return 0;
}

/**
 * Read the agent log file and extract an actionable error message.
 * Called when the agent fails to start (port file never appears).
 */
export function readAgentStartupError(): string | null {
  const logFile = path.join(os.homedir(), ".workermill", "agent.log");
  try {
    const content = fs.readFileSync(logFile, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    const tail = lines.slice(-30);
    const combined = tail.join("\n");

    // Check known error patterns and return actionable messages
    const ramMatch = combined.match(/Insufficient RAM:\s*(\d+)\s*GB/);
    if (ramMatch) {
      return `Your system has ${ramMatch[1]} GB RAM but WorkerMill requires at least 4 GB (8 GB recommended). Close other applications or upgrade your system.`;
    }

    if (/Git is not installed/i.test(combined) || /Git:.*not found/i.test(combined)) {
      return "Git is required. Install Git and reload VS Code.";
    }

    if (/Claude CLI/i.test(combined) && /(not found|not installed)/i.test(combined)) {
      return "Claude Code CLI is required for AI workers. Install it and restart.";
    }

    if (/Docker sandbox is enabled but Docker is not running/i.test(combined)) {
      return "Docker sandbox is enabled but Docker isn't running. Start Docker or disable sandbox mode.";
    }

    // Generic "Failed to start" or API errors — show the raw line
    for (let i = tail.length - 1; i >= 0; i--) {
      if (/Failed to start|ECONNREFUSED|ENOTFOUND|API.*error/i.test(tail[i])) {
        return tail[i].trim();
      }
    }

    // Fallback: return the last non-empty line
    if (tail.length > 0) {
      return tail[tail.length - 1].trim();
    }

    return null;
  } catch {
    return null;
  }
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
