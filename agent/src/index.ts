/**
 * WorkerMill Remote Agent
 *
 * Importable module for starting the agent programmatically.
 * Can also be run directly via `bin/remote-agent` (backward compat with dotenv).
 */

import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { AgentConfig } from "./config.js";
import { initApi, api } from "./api.js";
import { startPolling, startHeartbeat, stopPolling, reportDiagnostic } from "./poller.js";
import { stopAll } from "./spawner.js";
import { AGENT_VERSION } from "./version.js";
import { selfUpdate, restartAgent } from "./updater.js";
import { startLocalApi, stopLocalApi } from "./local-api.js";
import { detectGpu } from "./gpu-detector.js";
import { ensureOllamaRunning, pullModel, stopOllama, findOllamaPath, installOllama } from "./ollama-manager.js";

// ── Single-instance enforcement via PID file ────────────────────────────
const PID_FILE = path.join(os.homedir(), ".workermill", "agent.pid");

function killExistingAgent(): void {
  try {
    const oldPid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (oldPid && oldPid !== process.pid) {
      try {
        process.kill(oldPid, 0); // Check if alive
        console.log(chalk.dim(`  Stopping previous agent (PID ${oldPid})...`));
        process.kill(oldPid, "SIGTERM");
        // Give it a moment to die
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          try { process.kill(oldPid, 0); } catch { break; } // Dead
          const waitMs = 100;
          const start = Date.now();
          while (Date.now() - start < waitMs) { /* busy wait — no async available here */ }
        }
        // Force kill if still alive
        try { process.kill(oldPid, "SIGKILL"); } catch { /* already dead */ }
      } catch {
        // Process doesn't exist — stale PID file
      }
    }
  } catch {
    // No PID file — first run
  }
}

function writePidFile(): void {
  try {
    fs.writeFileSync(PID_FILE, String(process.pid), { mode: 0o644 });
  } catch { /* best effort */ }
}

function removePidFile(): void {
  try {
    const content = fs.readFileSync(PID_FILE, "utf-8").trim();
    if (content === String(process.pid)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch { /* best effort */ }
}

export { loadConfig, loadConfigFromFile, validatePrerequisites, getSystemInfo, findClaudePath } from "./config.js";
export type { AgentConfig } from "./config.js";

/**
 * Start the remote agent with the given config.
 * Returns a cleanup function to stop the agent.
 */
export async function startAgent(config: AgentConfig): Promise<() => Promise<void>> {
  // Kill any existing agent process to prevent double-polling
  killExistingAgent();
  writePidFile();

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
    console.log();

    const cloud = configResponse.data;

    // ── Identity ──
    console.log(`  ${chalk.dim("Agent:")}      ${config.agentId}`);
    console.log(`  ${chalk.dim("Version:")}    ${AGENT_VERSION}`);
    console.log();

    // ── Capacity ──
    console.log(`  ${chalk.dim("Workloads:")}  ${chalk.yellow(String(config.maxWorkers))} parallel`);
    console.log(`  ${chalk.dim("Experts:")}    up to ${chalk.yellow(String(cloud.maxParallelExperts))} per workload`);
    console.log(`  ${chalk.dim("SCM:")}        ${cloud.scmProvider}`);
    console.log();

    // ── Models ──
    const workerProvider = cloud.primaryProvider ?? "anthropic";
    const workerModel = cloud.defaultWorkerModel;
    const plannerProvider = cloud.planningAgentProvider ?? workerProvider;
    const plannerModel = cloud.planningAgentModel ?? workerModel;
    const reviewerRouting = cloud.providerRouting?.tech_lead as
      | { provider?: string; model?: string }
      | undefined;
    const reviewerProvider = reviewerRouting?.provider ?? workerProvider;
    const reviewerModel = reviewerRouting?.model ?? workerModel;

    console.log(`  ${chalk.dim("Models")}`);
    console.log(`  ${chalk.dim("  Worker:")}   ${workerProvider} / ${chalk.yellow(workerModel)}`);
    console.log(`  ${chalk.dim("  Planner:")}  ${plannerProvider} / ${chalk.yellow(plannerModel)}`);
    console.log(`  ${chalk.dim("  Reviewer:")} ${reviewerProvider} / ${chalk.yellow(reviewerModel)}`);
    console.log();

    // ── Runtime ──
    if (config.sandbox === "docker") {
      console.log(`  ${chalk.dim("Sandbox:")}    ${chalk.blue("Docker")} (${config.dockerImage})`);
    } else {
      console.log(`  ${chalk.dim("Sandbox:")}    off`);
    }

    // RAG status
    const cloudRag = cloud.codebaseIndexingEnabled === true;
    const ragLabel = config.localRag ? "local (Ollama)" : cloudRag ? "enabled" : "off";
    console.log(`  ${chalk.dim("RAG:")}        ${ragLabel}`);

    // GPU detection
    const gpu = detectGpu();
    console.log(
      `  ${chalk.dim("GPU:")}        ${gpu.available ? chalk.green("●") + ` ${gpu.vendor} ${gpu.model}` : chalk.yellow("None")}`,
    );

    // Local RAG: auto-install Ollama if needed, start it, pull embedding model
    if (config.localRag) {
      if (!findOllamaPath()) {
        console.log(`  ${chalk.dim("Ollama:")}   ${chalk.yellow("Not found")} — installing automatically...`);
        const installed = await installOllama((msg) => console.log(`  ${chalk.dim("  ")} ${msg}`));
        if (!installed) {
          console.log(`  ${chalk.yellow("⚠")} Ollama install failed — local RAG disabled`);
        }
      }
      const ollamaOk = await ensureOllamaRunning(config.ollamaPort);
      if (ollamaOk) {
        await pullModel("nomic-embed-text", config.ollamaPort);
        console.log(
          `  ${chalk.dim("Ollama:")}   ${chalk.green("●")} nomic-embed-text ready (port ${config.ollamaPort})`,
        );
      } else {
        console.log(`  ${chalk.yellow("⚠")} Ollama failed to start — local RAG disabled`);
        reportDiagnostic("warn", "startup", "Ollama failed to start — local RAG disabled");
      }
    }

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
    const registerResponse = await api.post("/api/agent/register", {
      agentId: config.agentId,
      maxWorkers: config.maxWorkers,
      agentVersion: AGENT_VERSION,
    });

    const { updateAvailable, updateRequired, latestVersion } = registerResponse.data;

    if (updateRequired) {
      console.log(chalk.red(`  ⚠ Agent update required (current: ${AGENT_VERSION}, required: ${latestVersion})`));
      const success = await selfUpdate();
      if (success) {
        restartAgent();
      } else {
        console.log(chalk.yellow("  Auto-update failed. Run: npm install -g @workermill/agent@latest"));
      }
    } else if (updateAvailable) {
      console.log(chalk.yellow(`  Update available: ${latestVersion} (current: ${AGENT_VERSION}). Run: workermill-agent update`));
    }
  } catch {
    // Registration is best-effort, don't fail startup
  }

  // Start polling and heartbeat loops
  startPolling(config);
  startHeartbeat(config);

  // Start local API server for VS Code extension and other local clients
  let localApiPort: number | undefined;
  try {
    localApiPort = await startLocalApi(config);
    console.log(`  ${chalk.dim("Local API:")} http://127.0.0.1:${localApiPort}/api/status`);
  } catch (err) {
    console.log(`  ${chalk.yellow("⚠")} Local API failed to start: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log(chalk.dim("  ─────────────────────────────────────"));
  console.log(`  ${chalk.green("●")} Agent is running. ${chalk.dim("Press Ctrl+C to stop.")}`);
  console.log();

  // Return cleanup function
  return async () => {
    console.log();
    console.log(chalk.dim("  Shutting down..."));
    // Stop poll/heartbeat loops first so nothing re-fires during cleanup
    stopPolling();
    // Stop Ollama if we started it
    await stopOllama();
    // Stop local API server
    await stopLocalApi();
    try {
      await api.post("/api/agent/deregister", { agentId: config.agentId });
    } catch {
      // Best-effort deregister
    }
    await stopAll();
    removePidFile();
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
