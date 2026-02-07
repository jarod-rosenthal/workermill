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
import { writeFileSync, existsSync, unlinkSync, openSync } from "fs";
import {
  loadConfigFromFile,
  checkPrerequisites,
  getSystemInfo,
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

  // Validate prerequisites
  const prereqs = checkPrerequisites(config.workerImage);
  const failing = prereqs.filter((p) => !p.ok);

  // Auto-pull worker image if it's the only missing prereq
  const imageMissing = failing.find((p) => p.name === "Worker image");
  const otherFailing = failing.filter((p) => p.name !== "Worker image");

  if (otherFailing.length > 0) {
    console.log(chalk.red("Prerequisites check failed:"));
    for (const p of otherFailing) {
      console.log(chalk.red(`  ✗ ${p.name}: ${p.detail}`));
    }
    process.exit(1);
  }

  if (imageMissing) {
    console.log(chalk.yellow(`  Worker image not found locally. Pulling ${config.workerImage}...`));
    const { spawnSync } = await import("child_process");
    const pull = spawnSync("docker", ["pull", config.workerImage], {
      stdio: "inherit",
      timeout: 600_000,
    });
    if (pull.status !== 0) {
      console.log(chalk.red(`  Failed to pull worker image.`));
      process.exit(1);
    }
    console.log(chalk.green(`  ✓ Worker image pulled`));
  }

  if (options.detach) {
    const logFile = getLogFile();
    const pidFile = getPidFile();

    console.log(chalk.dim(`Starting agent in background...`));
    console.log(chalk.dim(`  Logs: ${logFile}`));
    console.log(chalk.dim(`  PID:  ${pidFile}`));

    // Spawn the CLI with "start" (no --detach) as a detached child, redirecting output to log file
    const logFd = openSync(logFile, "a");
    const child = spawn("workermill-agent", ["start"], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      shell: true, // Required on Windows to find .cmd wrappers
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

  // Foreground mode
  console.log();
  console.log(chalk.bold.cyan("  WorkerMill Remote Agent"));
  console.log(chalk.dim("  ─────────────────────────────────────"));
  console.log();

  // RAM check
  const totalRamGB = Math.round(totalmem() / (1024 * 1024 * 1024));
  if (totalRamGB < 8) {
    console.log(chalk.red(`  ✗ Insufficient RAM: ${totalRamGB} GB (minimum 8 GB, recommended 16 GB)`));
    process.exit(1);
  } else if (totalRamGB < 16) {
    console.log(chalk.yellow(`  ⚠ RAM: ${totalRamGB} GB (below recommended 16 GB — workers may be slow)`));
  }

  // Register with system info
  const sysInfo = getSystemInfo();
  console.log(chalk.dim(`  Agent:    ${config.agentId}`));
  console.log(chalk.dim(`  Host:     ${sysInfo.hostname}`));
  console.log(chalk.dim(`  Platform: ${sysInfo.platform}`));
  console.log(chalk.dim(`  Image:    ${config.workerImage}`));
  console.log();

  try {
    const cleanup = await startAgent(config);

    // Write PID file for status command
    writeFileSync(getPidFile(), String(process.pid), "utf-8");

    // Graceful shutdown
    const shutdown = async () => {
      await cleanup();
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
