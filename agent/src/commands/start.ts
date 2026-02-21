/**
 * Start Command — Start the WorkerMill Remote Agent.
 *
 * Loads config from ~/.workermill/config.json, validates prerequisites,
 * registers with the cloud API, and starts polling.
 *
 * Supports --detach mode for running as a daemon.
 */

import chalk from "chalk";
import { totalmem } from "os";
import { spawn } from "child_process";
import { writeFileSync, existsSync, unlinkSync, openSync, createWriteStream } from "fs";
import { AGENT_VERSION } from "../version.js";
import {
  loadConfigFromFile,
  checkPrerequisites,
  checkDockerAvailable,
  isDockerInstalled,
  getPidFile,
  getLogFile,
  getConfigFile,
} from "../config.js";
import { startAgent } from "../index.js";

export async function startCommand(options: { detach?: boolean }): Promise<void> {
  // Check config exists
  if (!existsSync(getConfigFile())) {
    console.log(chalk.red("No configuration found."));
    console.log(`Run ${chalk.cyan("workermill-agent setup")} first.`);
    process.exit(1);
  }

  const config = loadConfigFromFile();

  // Validate prerequisites (Git, Claude CLI, Claude auth, Node.js)
  const prereqs = checkPrerequisites();
  const failing = prereqs.filter((p) => !p.ok);

  // Claude CLI and auth are soft prerequisites — only needed for Anthropic provider.
  // Non-Anthropic orgs can plan+execute without Claude CLI.
  const softPrereqs = new Set(["Claude CLI", "Claude auth"]);
  const hardFailing = failing.filter((p) => !softPrereqs.has(p.name));
  const softFailing = failing.filter((p) => softPrereqs.has(p.name));

  if (hardFailing.length > 0) {
    console.log(chalk.red("Prerequisites check failed:"));
    for (const p of hardFailing) {
      console.log(chalk.red(`  ✗ ${p.name}: ${p.detail}`));
    }
    process.exit(1);
  }

  if (softFailing.length > 0) {
    for (const p of softFailing) {
      console.log(chalk.yellow(`  ⚠ ${p.name}: ${p.detail} (required for Anthropic provider)`));
    }
  }

  // Docker sandbox pre-flight check
  if (config.sandbox === "docker") {
    if (!checkDockerAvailable()) {
      if (isDockerInstalled()) {
        console.log(chalk.red("Docker sandbox is enabled but Docker Desktop is not running."));
        console.log("Please start Docker Desktop and try again.");
      } else {
        console.log(chalk.red("Docker sandbox is enabled but Docker is not installed."));
        console.log(`Install Docker Desktop: ${chalk.cyan("https://www.docker.com/products/docker-desktop/")}`);
      }
      process.exit(1);
    }

    // Pre-pull image at startup
    try {
      const { ensureImage } = await import("../docker-spawner.js");
      await ensureImage(config);
    } catch (err) {
      console.log(chalk.yellow(`  ⚠ Docker image pull failed: ${err instanceof Error ? err.message : String(err)}`));
      console.log(chalk.yellow("    Workers will attempt to pull on first task."));
    }
  }

  if (options.detach) {
    const logFile = getLogFile();
    const pidFile = getPidFile();

    console.log(chalk.dim(`Starting agent in background...`));
    console.log(chalk.dim(`  Logs: ${logFile}`));
    console.log(chalk.dim(`  PID:  ${pidFile}`));

    // Spawn the CLI with "start" (no --detach) as a detached child, redirecting output to log file
    const logFd = openSync(logFile, "a");
    const child = spawn(process.execPath, ["start"], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    });

    if (child.pid) {
      writeFileSync(pidFile, String(child.pid), "utf-8");
      child.unref();
      console.log(chalk.green(`Agent started (PID: ${child.pid})`));
      console.log(`Check status with: ${chalk.cyan("workermill-agent status")}`);
    } else {
      console.log(chalk.red("Failed to start agent in background."));
      process.exit(1);
    }
    return;
  }

  // Foreground mode — tee stdout/stderr to log file so `workermill-agent logs` works
  const logFile = getLogFile();
  const logStream = createWriteStream(logFile, { flags: "a" });
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk: string | Uint8Array, ...args: unknown[]): boolean => {
    logStream.write(chunk);
    return (origStdoutWrite as Function)(chunk, ...args);
  };
  process.stderr.write = (chunk: string | Uint8Array, ...args: unknown[]): boolean => {
    logStream.write(chunk);
    return (origStderrWrite as Function)(chunk, ...args);
  };

  console.log();
  console.log(chalk.bold.cyan("  WorkerMill Remote Agent"));
  console.log(chalk.dim("  ─────────────────────────────────────"));
  console.log();

  // RAM check — 4 GB hard minimum for native mode, 8 GB for Docker sandbox
  const totalRamGB = Math.round(totalmem() / (1024 * 1024 * 1024));
  if (config.sandbox === "docker" && totalRamGB < 8) {
    console.log(chalk.red(`  ✗ Insufficient RAM: ${totalRamGB} GB (Docker sandbox requires at least 8 GB)`));
    process.exit(1);
  } else if (totalRamGB < 4) {
    console.log(chalk.red(`  ✗ Insufficient RAM: ${totalRamGB} GB (minimum 4 GB, recommended 8 GB)`));
    process.exit(1);
  } else if (totalRamGB < 8) {
    console.log(chalk.yellow(`  ⚠ RAM: ${totalRamGB} GB (below recommended 8 GB — workers may be slow)`));
  }

  console.log(chalk.dim(`  Agent:     ${config.agentId}`));
  console.log(chalk.dim(`  Version:   ${AGENT_VERSION}`));
  console.log();

  try {
    const cleanup = await startAgent(config);

    // Write PID file for status command
    writeFileSync(getPidFile(), String(process.pid), "utf-8");

    // Graceful shutdown with force-exit safety net
    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) {
        // Double Ctrl+C → force exit immediately
        console.log(chalk.red("\n  Force exit."));
        process.exit(1);
      }
      shuttingDown = true;

      // Force exit after 10s if cleanup hangs
      const forceTimer = setTimeout(() => {
        console.log(chalk.red("\n  Cleanup timed out. Force exit."));
        process.exit(1);
      }, 10_000);
      forceTimer.unref(); // Don't keep process alive just for this timer

      await cleanup();
      clearTimeout(forceTimer);
      try {
        unlinkSync(getPidFile());
      } catch {
        /* ignore */
      }
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.log(chalk.red(`Failed to start: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}
