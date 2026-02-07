/**
 * Stop Command — Stop a running WorkerMill Remote Agent daemon.
 *
 * Reads PID from ~/.workermill/agent.pid, sends SIGTERM, waits for exit.
 */

import chalk from "chalk";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { getPidFile } from "../config.js";

export async function stopCommand(): Promise<void> {
  const pidFile = getPidFile();

  if (!existsSync(pidFile)) {
    console.log(chalk.yellow("No running agent found (no PID file)."));
    console.log(chalk.dim(`Expected PID file at: ${pidFile}`));
    return;
  }

  const pidStr = readFileSync(pidFile, "utf-8").trim();
  const pid = parseInt(pidStr, 10);

  if (isNaN(pid)) {
    console.log(chalk.red(`Invalid PID in ${pidFile}: ${pidStr}`));
    unlinkSync(pidFile);
    return;
  }

  // Check if process is running
  try {
    process.kill(pid, 0); // Signal 0 = check existence
  } catch {
    console.log(chalk.yellow(`Agent (PID ${pid}) is not running. Cleaning up PID file.`));
    unlinkSync(pidFile);
    return;
  }

  // Send SIGTERM
  console.log(chalk.dim(`Stopping agent (PID ${pid})...`));
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    console.log(chalk.red(`Failed to stop agent: ${error instanceof Error ? error.message : String(error)}`));
    return;
  }

  // Wait for process to exit (up to 15 seconds)
  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      process.kill(pid, 0);
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      // Process has exited
      break;
    }
  }

  // Clean up PID file
  try {
    unlinkSync(pidFile);
  } catch {
    /* ignore */
  }

  console.log(chalk.green("Agent stopped."));
}
