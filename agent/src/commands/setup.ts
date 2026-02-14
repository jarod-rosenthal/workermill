/**
 * Setup Wizard — Interactive configuration for the WorkerMill Remote Agent.
 *
 * Prerequisites checked/installed:
 *   - Docker Desktop (must be installed manually)
 *   - Git for Windows (must be installed manually — required by Claude Code on Windows)
 *   - Claude CLI → winget on Windows, curl | bash on Linux/macOS/WSL
 *   - Claude auth → launches `claude` which prompts for sign-in on first run
 *   - Worker image → `docker pull public.ecr.aws/a7k5r0v0/workermill-worker:latest`
 */

import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import { execSync, spawnSync } from "child_process";
import { existsSync } from "fs";
import { hostname, homedir, totalmem, freemem, cpus } from "os";
import { join } from "path";
import axios from "axios";
import {
  saveConfigToFile,
  getConfigFile,
  findClaudePath,
  type FileConfig,
} from "../config.js";

const isWindows = process.platform === "win32";

/**
 * Check if a command exists in PATH.
 */
function commandExists(cmd: string): boolean {
  try {
    const which = isWindows ? "where" : "which";
    execSync(`${which} ${cmd}`, { stdio: "ignore", timeout: 10000 });
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
    return execSync(`"${cmd}" --version`, { encoding: "utf-8", timeout: 10000 }).trim();
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
      const gitPath = execSync("where git", { encoding: "utf-8", timeout: 10000 }).trim().split("\n")[0];
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
        { stdio: "inherit", timeout: 180_000 },
      );
      return true;
    } catch {
      return false;
    }
  } else {
    // macOS: try Homebrew first
    if (process.platform === "darwin") {
      try {
        execSync("brew install --cask claude-code", { stdio: "inherit", timeout: 180_000 });
        return true;
      } catch { /* fall through */ }
    }
    // Linux, WSL, macOS fallback: native installer
    try {
      execSync(
        "curl -fsSL https://claude.ai/install.sh | bash",
        { stdio: "inherit", timeout: 120_000 },
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

  if (totalRamGB < 8) {
    console.log();
    console.log(chalk.red("  ✗ Insufficient RAM"));
    console.log(chalk.yellow("  WorkerMill requires at least 8 GB of RAM (16 GB recommended)."));
    console.log(chalk.yellow(`  Your system has ${totalRamGB} GB.`));
    console.log();
    process.exit(1);
  } else if (totalRamGB < 16) {
    console.log(chalk.yellow(`  ⚠ ${totalRamGB} GB RAM is below the recommended 16 GB.`));
    console.log(chalk.yellow("    Workers may run slowly or be killed by the OS under memory pressure."));
  } else {
    console.log(chalk.green("  ✓ System meets requirements"));
  }
  console.log();

  // ── Step 1: Docker ────────────────────────────────────────────────────────
  const dockerSpinner = ora("Checking Docker...").start();

  if (commandExists("docker")) {
    const version = getVersion("docker");

    // Verify Docker daemon is actually running (not just the CLI installed)
    try {
      const osType = execSync("docker info --format {{.OSType}}", {
        encoding: "utf-8",
        timeout: 15000,
      }).trim();

      // On Windows, verify Linux containers mode
      if (isWindows && osType === "windows") {
        dockerSpinner.fail("Docker is running in Windows containers mode");
        console.log();
        console.log(chalk.yellow("  WorkerMill workers require Linux containers."));
        console.log(chalk.yellow("  Right-click the Docker Desktop icon in the system tray →"));
        console.log(chalk.yellow("  'Switch to Linux containers...'"));
        console.log();
        console.log("  Then re-run: workermill-agent");
        process.exit(1);
      }
    } catch {
      dockerSpinner.fail("Docker is installed but the daemon is not running");
      console.log();
      console.log(chalk.yellow("  Start Docker Desktop, wait for it to fully initialize,"));
      console.log(chalk.yellow("  then re-run: workermill-agent"));
      process.exit(1);
    }

    dockerSpinner.succeed(`Docker ${chalk.dim(version ? `(${version})` : "")}`);
  } else {
    dockerSpinner.fail("Docker is not installed");
    console.log();
    console.log(chalk.yellow("  Docker Desktop is required but must be installed manually:"));
    console.log(`  ${chalk.cyan("https://docs.docker.com/get-docker/")}`);
    console.log();
    console.log("  Install Docker, start it, then re-run: workermill-agent");
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
        console.log("  Try manually:");
        console.log(chalk.cyan("    curl -fsSL https://claude.ai/install.sh | bash"));
        console.log("  Then re-run: workermill-agent");
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

  // ── Step 5: Node.js ──────────────────────────────────────────────────────
  console.log(chalk.green("  ✓") + ` Node.js ${chalk.dim(`(${process.version})`)}`);

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

  const { agentId } = await inquirer.prompt([
    {
      type: "input",
      name: "agentId",
      message: "Agent name:",
      default: `agent-${hostname()}`,
    },
  ]);

  // ── Step 7: AWS CLI + ECR auth + pull worker image ───────────────────────
  console.log();
  const PRIVATE_ECR_REGISTRY =
    "AWS_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com";
  const workerImage = `${PRIVATE_ECR_REGISTRY}/workermill-dev/worker:latest`;

  // Check AWS CLI
  const awsSpinner = ora("Checking AWS CLI...").start();
  if (commandExists("aws")) {
    try {
      execSync("aws sts get-caller-identity", {
        stdio: "pipe",
        timeout: 15000,
      });
      awsSpinner.succeed("AWS CLI configured");
    } catch {
      awsSpinner.warn("AWS CLI found but credentials not configured");
      console.log();
      console.log(
        chalk.yellow(
          "  Configure AWS credentials for private ECR image access:",
        ),
      );
      console.log(chalk.cyan("    aws configure"));
      console.log(
        chalk.dim(
          "  Contact your WorkerMill admin for AWS access key / secret key.",
        ),
      );
      console.log(
        chalk.dim(
          "  Setup will continue — you can configure AWS later before starting.",
        ),
      );
    }
  } else {
    awsSpinner.warn("AWS CLI not found");
    console.log();
    console.log(
      chalk.yellow(
        "  AWS CLI is required for pulling worker images from private ECR.",
      ),
    );
    console.log(
      chalk.cyan(
        "  Install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
      ),
    );
    console.log(
      chalk.dim(
        "  Setup will continue — install AWS CLI before starting the agent.",
      ),
    );
  }

  // Authenticate with ECR
  console.log();
  console.log(chalk.dim(`  Authenticating with private ECR...`));
  let ecrAuthed = false;
  try {
    execSync(
      `aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ${PRIVATE_ECR_REGISTRY}`,
      { stdio: "pipe", timeout: 30_000 },
    );
    console.log(chalk.green("  ✓ ECR authenticated"));
    ecrAuthed = true;
  } catch {
    console.log(
      chalk.yellow("  ⚠ ECR authentication failed (AWS credentials may not be configured yet)"),
    );
    console.log(
      chalk.dim("  Worker image pull will be skipped — authenticate later with:"),
    );
    console.log(
      chalk.dim(
        `    aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ${PRIVATE_ECR_REGISTRY}`,
      ),
    );
  }

  // Pull worker image (only if ECR auth succeeded)
  if (ecrAuthed) {
    console.log();
    console.log(chalk.dim(`  Pulling worker image: ${workerImage}`));
    console.log(
      chalk.dim("  This may take a few minutes on first run (~1.1 GB)..."),
    );
    console.log();

    const pullResult = spawnSync("docker", ["pull", workerImage], {
      stdio: "inherit",
      timeout: 600_000,
    });

    if (pullResult.status === 0) {
      console.log();
      console.log(chalk.green("  ✓ Worker image pulled"));
    } else {
      console.log();
      console.log(chalk.red("  ✗ Failed to pull worker image."));
      if (pullResult.error) {
        console.log(chalk.yellow(`  Error: ${pullResult.error.message}`));
      }
      console.log(
        chalk.dim(
          "  Setup will continue — you can pull the image later before starting.",
        ),
      );
    }
  }

  // ── Step 8: Save config ───────────────────────────────────────────────────
  const fileConfig: FileConfig = {
    apiUrl: apiUrl.replace(/\/$/, ""),
    apiKey,
    agentId,
    maxWorkers: 1,
    pollIntervalMs: 5000,
    heartbeatIntervalMs: 30000,
    tokens: { github: "", bitbucket: "", gitlab: "" }, // SCM tokens come from org Settings
    workerImage,
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
