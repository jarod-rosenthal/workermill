/**
 * WorkerMill Remote Agent
 *
 * Importable module for starting the agent programmatically.
 * Can also be run directly via `bin/remote-agent` (backward compat with dotenv).
 */

import chalk from "chalk";
import type { AgentConfig } from "./config.js";
import { initApi, api } from "./api.js";
import { startPolling, startHeartbeat } from "./poller.js";
import { stopAll } from "./spawner.js";

export { loadConfig, loadConfigFromFile, validatePrerequisites, getSystemInfo, findClaudePath } from "./config.js";
export type { AgentConfig } from "./config.js";

/**
 * Start the remote agent with the given config.
 * Returns a cleanup function to stop the agent.
 */
export async function startAgent(config: AgentConfig): Promise<() => Promise<void>> {
  console.log();
  console.log(chalk.bold.cyan("  WorkerMill Remote Agent"));
  console.log(chalk.dim("  ─────────────────────────────────────"));
  console.log();

  // Initialize API client
  initApi(config.apiUrl, config.apiKey);

  // Verify connectivity
  try {
    const configResponse = await api.get("/api/agent/config");

    // Override maxWorkers from cloud settings if available
    const cloudMaxWorkers = configResponse.data.maxConcurrentWorkers;
    if (cloudMaxWorkers && typeof cloudMaxWorkers === "number") {
      config.maxWorkers = cloudMaxWorkers;
    }

    console.log(`  ${chalk.green("●")} Connected to ${chalk.cyan(config.apiUrl)}`);
    console.log(`  ${chalk.dim("Agent:")}     ${config.agentId}`);
    console.log(`  ${chalk.dim("Workers:")}   ${chalk.yellow(String(config.maxWorkers))} parallel`);
    console.log(`  ${chalk.dim("Image:")}     ${config.workerImage}`);
    console.log(`  ${chalk.dim("SCM:")}       ${configResponse.data.scmProvider}`);
    console.log(`  ${chalk.dim("Model:")}     ${chalk.yellow(configResponse.data.defaultWorkerModel)}`);
    console.log();
  } catch (error: unknown) {
    const err = error as { response?: { status?: number }; message?: string };
    if (err.response?.status === 401) {
      throw new Error("Authentication failed. Check your API key.");
    } else {
      throw new Error(`Failed to connect to WorkerMill API: ${err.message || String(error)}`);
    }
  }

  // Register agent
  try {
    await api.post("/api/agent/register", {
      agentId: config.agentId,
      maxWorkers: config.maxWorkers,
    });
  } catch {
    // Registration is best-effort, don't fail startup
  }

  // Start polling and heartbeat loops
  startPolling(config);
  startHeartbeat(config);

  console.log(chalk.dim("  ─────────────────────────────────────"));
  console.log(`  ${chalk.green("●")} Agent is running. ${chalk.dim("Press Ctrl+C to stop.")}`);
  console.log();

  // Return cleanup function
  return async () => {
    console.log();
    console.log(chalk.dim("  Shutting down..."));
    try {
      await api.post("/api/agent/deregister", { agentId: config.agentId });
    } catch {
      // Best-effort deregister
    }
    await stopAll();
    console.log(`  ${chalk.red("●")} Agent stopped.`);
  };
}

// Direct execution support (for bin/remote-agent backward compat)
// Only runs when this file is the main module
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/index.ts") || process.argv[1].endsWith("/index.js"));

if (isDirectRun) {
  // Dynamic import dotenv for backward compat (not a dependency in published package)
  try {
    await import("dotenv/config");
  } catch {
    // dotenv not available in published package — that's fine
  }

  const { loadConfig, validatePrerequisites: validate } = await import("./config.js");

  const config = loadConfig();
  validate();
  console.log(chalk.dim("  Prerequisites validated."));

  const cleanup = await startAgent(config);

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await cleanup();
    process.exit(0);
  });
}
