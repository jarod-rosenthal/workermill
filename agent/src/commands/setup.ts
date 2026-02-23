/**
 * Setup Wizard — Interactive configuration for the WorkerMill Remote Agent.
 *
 * Prerequisites checked/installed:
 *   - Git (must be installed)
 *   - Git for Windows (must be installed manually — required by Claude Code on Windows)
 *   - Claude CLI → winget on Windows, curl | bash on Linux/macOS/WSL
 *   - Claude auth → launches `claude` which prompts for sign-in on first run
 */

import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import { execSync, execFileSync, spawnSync } from "child_process";
import { existsSync } from "fs";
import { hostname, homedir, totalmem, cpus } from "os";
import { join } from "path";
import axios from "axios";
import {
  saveConfigToFile,
  getConfigFile,
  findClaudePath,
  checkDockerAvailable,
  isDockerInstalled,
  type FileConfig,
} from "../config.js";
import { writeApiKeyToKeychain } from "../keychain.js";

const isWindows = process.platform === "win32";

/**
 * Check if a command exists in PATH.
 */
function commandExists(cmd: string): boolean {
  try {
    // Use execFileSync to avoid cmd.exe shell flash on Windows
    const which = isWindows ? "where.exe" : "which";
    execFileSync(which, [cmd], { stdio: "pipe", timeout: 10000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get version string from a command, or null.
 */
function getVersion(cmd: string): string | null {
  try {
    // .cmd files (npm global) need shell — .exe files use execFileSync to avoid terminal flash
    if (cmd.endsWith(".cmd")) {
      return execSync(`"${cmd}" --version`, { encoding: "utf-8", timeout: 10000, windowsHide: true }).trim();
    }
    return execFileSync(cmd, ["--version"], { encoding: "utf-8", timeout: 10000, windowsHide: true }).trim();
  } catch {
    return null;
  }
}

/**
 * Find Git Bash on Windows. Returns path to bash.exe or null.
 */
function findGitBash(): string | null {
  if (!isWindows) return null; // Not needed on non-Windows

  // Check if git is in PATH (Git for Windows adds it)
  if (commandExists("git")) {
    try {
      const gitPath = execFileSync("where.exe", ["git.exe"], { encoding: "utf-8", timeout: 10000, windowsHide: true }).trim().split("\n")[0];
      // git.exe is at Git/cmd/git.exe, bash.exe is at Git/bin/bash.exe
      const gitDir = join(gitPath, "..", "..", "bin", "bash.exe");
      if (existsSync(gitDir)) return gitDir;
    } catch { /* ignore */ }
  }

  // Check common install locations
  const candidates = [
    join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe"),
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    join(homedir(), "scoop", "apps", "git", "current", "bin", "bash.exe"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Install Claude CLI using the official installer.
 * Returns true on success.
 */
function installClaudeCli(): boolean {
  if (isWindows) {
    // Windows: use winget (built into Windows 10/11)
    try {
      execSync(
        "winget install Anthropic.ClaudeCode --accept-package-agreements --accept-source-agreements",
        { stdio: "inherit", timeout: 180_000, windowsHide: true },
      );
      return true;
    } catch {
      return false;
    }
  } else {
    // macOS: try Homebrew first
    if (process.platform === "darwin") {
      try {
        execSync("brew install --cask claude-code", { stdio: "inherit", timeout: 180_000, windowsHide: true });
        return true;
      } catch { /* fall through */ }
    }
    // Linux, WSL, macOS fallback: native installer
    try {
      execSync(
        "curl -fsSL https://claude.ai/install.sh | bash",
        { stdio: "inherit", timeout: 120_000, windowsHide: true },
      );
      return true;
    } catch {
      return false;
    }
  }
}

export async function setupCommand(): Promise<void> {
  // Welcome banner
  console.log();
  console.log(chalk.bold.cyan("  WorkerMill Remote Agent Setup"));
  console.log(chalk.dim("  ─────────────────────────────────────"));
  console.log();
  console.log("  Run AI workers locally with your Claude Max subscription.");
  console.log("  Workers execute on your machine, logs stream to the cloud dashboard.");
  console.log();

  // ── Step 0: System Requirements ───────────────────────────────────────────
  const totalRamGB = Math.round(totalmem() / (1024 * 1024 * 1024));
  const cpuCount = cpus().length;

  console.log(chalk.dim("  System"));
  console.log(`  ${chalk.dim("RAM:")}  ${totalRamGB} GB   ${chalk.dim("CPUs:")} ${cpuCount}`);

  if (totalRamGB < 4) {
    console.log();
    console.log(chalk.red("  ✗ Insufficient RAM"));
    console.log(chalk.yellow("  WorkerMill requires at least 4 GB of RAM (8 GB recommended)."));
    console.log(chalk.yellow(`  Your system has ${totalRamGB} GB.`));
    console.log();
    process.exit(1);
  } else if (totalRamGB < 8) {
    console.log(chalk.yellow(`  ⚠ ${totalRamGB} GB RAM is below the recommended 8 GB.`));
    console.log(chalk.yellow("    Workers may run slowly or be killed by the OS under memory pressure."));
  } else {
    console.log(chalk.green("  ✓ System meets requirements"));
  }
  console.log();

  // ── Step 1: Git ──────────────────────────────────────────────────────────
  const gitSpinner = ora("Checking Git...").start();

  if (commandExists("git")) {
    const version = getVersion("git");
    gitSpinner.succeed(`Git ${chalk.dim(version ? `(${version})` : "")}`);
  } else {
    gitSpinner.fail("Git is not installed");
    console.log();
    console.log(chalk.yellow("  Git is required. Install it from:"));
    console.log(`  ${chalk.cyan("https://git-scm.com/downloads")}`);
    console.log();
    console.log("  Then re-run: workermill-agent");
    process.exit(1);
  }

  // ── Step 2: Git for Windows (required by Claude Code on Windows) ────────
  if (isWindows) {
    const gitSpinner = ora("Checking Git for Windows...").start();
    const gitBashPath = findGitBash();

    if (gitBashPath) {
      gitSpinner.succeed(`Git for Windows ${chalk.dim(`(${gitBashPath})`)}`);

      // Set CLAUDE_CODE_GIT_BASH_PATH so Claude can find it
      process.env.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
    } else {
      gitSpinner.fail("Git for Windows is not installed");
      console.log();
      console.log(chalk.yellow("  Claude Code on Windows requires Git for Windows (Git Bash):"));
      console.log(`  ${chalk.cyan("https://git-scm.com/downloads/win")}`);
      console.log();
      console.log("  Install Git for Windows, then re-run: workermill-agent");
      process.exit(1);
    }
  }

  // ── Step 3: Claude CLI ────────────────────────────────────────────────────
  const claudeSpinner = ora("Checking Claude CLI...").start();
  let claudePath = findClaudePath();

  if (claudePath) {
    const version = getVersion(claudePath);
    claudeSpinner.succeed(`Claude CLI ${chalk.dim(version ? `(${version})` : "")}`);
  } else {
    claudeSpinner.warn("Claude CLI not found — installing...");
    console.log();

    const installed = installClaudeCli();

    if (installed) {
      claudePath = findClaudePath();
    }

    if (claudePath) {
      const version = getVersion(claudePath);
      console.log();
      console.log(chalk.green(`  ✓ Claude CLI installed ${chalk.dim(version ? `(${version})` : "")}`));
    } else {
      console.log();
      console.log(chalk.red("  Claude CLI was installed but could not be found."));
      console.log();
      if (isWindows) {
        console.log(chalk.yellow("  Winget updated your PATH but this shell doesn't have it yet."));
        console.log(chalk.yellow("  Close this terminal, open a new one, and re-run: workermill-agent"));
      } else {
        console.log("  Install Claude Code manually, then re-run: workermill-agent");
      }
      process.exit(1);
    }
  }

  // ── Step 4: Claude auth ───────────────────────────────────────────────────
  const authSpinner = ora("Checking Claude authentication...").start();
  const credsPath = join(homedir(), ".claude", ".credentials.json");

  if (existsSync(credsPath)) {
    authSpinner.succeed("Claude authenticated");
  } else {
    authSpinner.warn("Not authenticated — launching Claude...");
    console.log();
    console.log(chalk.dim("  Claude will open and prompt you to authenticate."));
    console.log(chalk.dim("  Sign in with your Claude Max account, then exit Claude (Ctrl+C)."));
    console.log();

    // Pass Git Bash path on Windows so Claude can find it
    const env = { ...process.env };
    if (isWindows) {
      const gitBash = findGitBash();
      if (gitBash) env.CLAUDE_CODE_GIT_BASH_PATH = gitBash;
    }

    spawnSync(claudePath, [], {
      stdio: "inherit",
      timeout: 300_000,
      env,
      windowsHide: true,
    });

    if (existsSync(credsPath)) {
      console.log();
      console.log(chalk.green("  ✓ Claude authenticated"));
    } else {
      console.log();
      console.log(chalk.red("  Authentication failed or was cancelled."));
      console.log(`  Try manually: open a new terminal and run 'claude'`);
      console.log("  Then re-run: workermill-agent");
      process.exit(1);
    }
  }

  console.log();

  // ── Step 6: Configuration prompts ─────────────────────────────────────────
  console.log(chalk.bold("Configuration"));
  console.log();

  const { apiUrl } = await inquirer.prompt([
    {
      type: "input",
      name: "apiUrl",
      message: "WorkerMill API URL:",
      default: "https://workermill.com",
      validate: (v: string) =>
        v.startsWith("http://") || v.startsWith("https://") ? true : "Must be a valid URL",
    },
  ]);

  const { apiKey } = await inquirer.prompt([
    {
      type: "password",
      name: "apiKey",
      message: "API Key (from Settings > Integrations):",
      mask: "*",
      validate: (v: string) => (v.length > 0 ? true : "API key is required"),
    },
  ]);

  // Validate API key
  const validateSpinner = ora("Validating API key...").start();
  let scmProvider = "github";
  try {
    const resp = await axios.get(`${apiUrl.replace(/\/$/, "")}/api/agent/config`, {
      headers: { "x-api-key": apiKey },
      timeout: 15000,
    });
    scmProvider = resp.data.scmProvider || "github";
    validateSpinner.succeed(`Connected! SCM provider: ${scmProvider}`);
  } catch (error: unknown) {
    const err = error as { response?: { status?: number } };
    if (err.response?.status === 401) {
      validateSpinner.fail("Invalid API key. Check Settings > Integrations on the dashboard.");
    } else {
      validateSpinner.fail("Failed to connect to WorkerMill API. Check the URL and try again.");
    }
    process.exit(1);
  }

  // SCM tokens come from org Settings > Integrations (no local prompt needed)
  console.log(
    chalk.dim(
      "  SCM tokens are managed via Settings > Integrations on the dashboard.",
    ),
  );
  console.log();

  // Optional: GitHub reviewer token (separate account for PR approvals)
  const { githubReviewerToken } = await inquirer.prompt([
    {
      type: "password",
      name: "githubReviewerToken",
      message: "GitHub Reviewer PAT (optional, for PR approvals):",
      mask: "*",
      default: "",
    },
  ]);

  if (githubReviewerToken) {
    console.log(chalk.green("  ✓") + " Reviewer token configured (avoids self-approval restriction)");
  } else {
    console.log(chalk.dim("  Skipped — will use reviewer token from org Settings if configured."));
  }
  console.log();

  const { agentId } = await inquirer.prompt([
    {
      type: "input",
      name: "agentId",
      message: "Agent name:",
      default: hostname(),
    },
  ]);

  // ── Docker sandbox: opt-in only ─────────────────────────────────────────────
  // Sandbox mode is NOT auto-enabled. Users can opt in by adding "sandbox": "docker"
  // to ~/.workermill/config.json after setup.
  const sandboxMode: "docker" | undefined = undefined;

  if (checkDockerAvailable()) {
    console.log(chalk.green("  ✓") + " Docker detected");
    console.log(chalk.dim("    To enable sandboxed execution, add \"sandbox\": \"docker\" to ~/.workermill/config.json"));
  } else {
    console.log(chalk.dim("  Docker not detected — workers will run as native processes"));
  }
  console.log();

  // ── Step 7: Store API key in OS keychain + save config ──────────────────
  const keychainOk = writeApiKeyToKeychain(apiKey);
  if (keychainOk) {
    console.log(chalk.green("  ✓") + " API key stored in OS keychain");
  } else {
    console.log(chalk.yellow("  ⚠") + " OS keychain not available — API key in config file only");
  }

  const fileConfig: FileConfig = {
    apiUrl: apiUrl.replace(/\/$/, ""),
    apiKey: keychainOk ? "" : apiKey, // Only write to disk if keychain failed
    agentId,
    maxWorkers: 1,
    pollIntervalMs: 5000,
    heartbeatIntervalMs: 30000,
    tokens: { github: "", bitbucket: "", gitlab: "", githubReviewer: githubReviewerToken || "" }, // SCM tokens come from org Settings
    sandbox: sandboxMode,
    setupCompletedAt: new Date().toISOString(),
  };

  saveConfigToFile(fileConfig);

  console.log();
  console.log(chalk.green.bold("  Setup complete!"));
  console.log();
  console.log(`  Config saved to: ${chalk.dim(getConfigFile())}`);
  console.log();
  console.log(`  Start the agent with: ${chalk.cyan("workermill-agent start")}`);
  console.log();
}
