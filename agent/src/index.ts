/**
 * WorkerMill Remote Agent
 *
 * A lightweight process that runs on a customer's machine, polls the
 * cloud WorkerMill API for tasks, runs planning locally via Claude CLI,
 * and spawns Docker worker containers that report back to the cloud.
 *
 * Usage:
 *   1. Copy .env.remote.example to .env.remote
 *   2. Set WORKERMILL_API_URL, WORKERMILL_API_KEY, and SCM tokens
 *   3. Run: ./bin/remote-agent
 */

import "dotenv/config";
import { loadConfig, validatePrerequisites } from "./config.js";
import { initApi } from "./api.js";
import { startPolling, startHeartbeat } from "./poller.js";
import { stopAll } from "./spawner.js";

console.log("WorkerMill Remote Agent starting...");
console.log();

// Load configuration
const config = loadConfig();

// Validate prerequisites
validatePrerequisites();
console.log("Prerequisites validated (Docker, Claude CLI, worker image).");

// Initialize API client
initApi(config.apiUrl, config.apiKey);

// Verify connectivity
import { api } from "./api.js";
try {
  const configResponse = await api.get("/api/agent/config");
  console.log(`Connected to ${config.apiUrl}`);
  console.log(`  Agent ID: ${config.agentId}`);
  console.log(`  Max workers: ${config.maxWorkers}`);
  console.log(`  SCM provider: ${configResponse.data.scmProvider}`);
  console.log(`  Default model: ${configResponse.data.defaultWorkerModel}`);
  console.log();
} catch (error: unknown) {
  const err = error as { response?: { status?: number }; message?: string };
  if (err.response?.status === 401) {
    console.error("Authentication failed. Check your WORKERMILL_API_KEY.");
  } else {
    console.error("Failed to connect to WorkerMill API:", err.message || String(error));
  }
  process.exit(1);
}

// Start polling and heartbeat loops
startPolling(config);
startHeartbeat(config);

console.log("Remote Agent is running. Press Ctrl+C to stop.");

// Graceful shutdown
const shutdown = async () => {
  console.log("\nShutting down...");
  await stopAll();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
