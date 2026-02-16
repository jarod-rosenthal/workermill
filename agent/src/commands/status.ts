/**
 * Status Command — Show the current state of the WorkerMill Remote Agent.
 *
 * Displays: running/stopped, agent ID, active containers, API connectivity.
 */

import chalk from "chalk";
import { existsSync, readFileSync } from "fs";
import axios from "axios";
import { getPidFile, getConfigFile, loadConfigFromFile } from "../config.js";

export async function statusCommand(): Promise<void> {
  console.log();
  console.log(chalk.bold("WorkerMill Remote Agent Status"));
  console.log(chalk.dim("─────────────────────────────────────"));
  console.log();

  // Check config
  if (!existsSync(getConfigFile())) {
    console.log(chalk.yellow("  Not configured. Run 'workermill-agent setup' first."));
    return;
  }

  const config = loadConfigFromFile();

  // Agent process status
  const pidFile = getPidFile();
  let isRunning = false;
  let pid: number | null = null;

  if (existsSync(pidFile)) {
    const pidStr = readFileSync(pidFile, "utf-8").trim();
    pid = parseInt(pidStr, 10);
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0);
        isRunning = true;
      } catch {
        isRunning = false;
      }
    }
  }

  const statusIcon = isRunning ? chalk.green("● online") : chalk.red("● offline");
  console.log(`  Status:      ${statusIcon}${pid ? chalk.dim(` (PID ${pid})`) : ""}`);
  console.log(`  Agent ID:    ${config.agentId}`);
  console.log(`  API URL:     ${config.apiUrl}`);
  console.log(`  Max workers: ${config.maxWorkers}`);

  // API connectivity
  console.log();
  console.log(chalk.bold("  API Connectivity"));

  try {
    const resp = await axios.get(`${config.apiUrl}/api/agent/config`, {
      headers: { "x-api-key": config.apiKey },
      timeout: 10000,
    });
    console.log(`  ${chalk.green("✓")} Connected to ${config.apiUrl}`);
    console.log(chalk.dim(`    SCM: ${resp.data.scmProvider}, Model: ${resp.data.defaultWorkerModel}`));
  } catch (error: unknown) {
    const err = error as { response?: { status?: number } };
    if (err.response?.status === 401) {
      console.log(`  ${chalk.red("✗")} Authentication failed (invalid API key)`);
    } else {
      console.log(`  ${chalk.red("✗")} Cannot reach ${config.apiUrl}`);
    }
  }

  console.log();
}
