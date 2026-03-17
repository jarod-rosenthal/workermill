/**
 * Start Command — Start the WorkerMill Remote Agent.
 *
 * Loads config from ~/.workermill/config.json, validates prerequisites,
 * registers with the cloud API, and starts polling.
 *
 * Supports --detach mode for running as a daemon.
 */

import chalk from "chalk";
import { totalmem, devNull, homedir } from "os";
import { join } from "path";
import { spawn, execFileSync } from "child_process";
import { writeFileSync, readFileSync, existsSync, unlinkSync, openSync, closeSync, createWriteStream } from "fs";
import { AGENT_VERSION } from "../version.js";
import {
  loadConfigFromFile,
  checkPrerequisites,
  checkDockerAvailable,
  isDockerInstalled,
  getPidFile,
  getLogFile,
  getConfigFile,
  getPortFile,
} from "../config.js";
import type { AgentConfig } from "../config.js";
import { rotateLogs } from "../log-rotation.js";
import { startAgent } from "../index.js";
import {
  isStandaloneReady,
  isCloudMode,
  loadStandaloneConfig,
  saveStandaloneConfig,
  getRoleConfig,
  resolveApiKey,
} from "../backends/local/config.js";

/**
 * Check if an agent is already running by probing its local API port.
 * Port binding is kernel-managed — automatically released on process exit
 * including crashes and SIGKILL. Falls back to PID check for the startup
 * window before the port file is written.
 */
function isAgentRunning(): { alive: boolean; detail: string } {
  // Layer 1: Port-based liveness (authoritative)
  const portFile = getPortFile();
  try {
    const port = parseInt(readFileSync(portFile, "utf-8").trim(), 10);
    if (port > 0) {
      try {
        execFileSync("node", [
          "-e",
          `const http=require("http");const r=http.get("http://127.0.0.1:${port}/api/status",{timeout:2000},res=>{process.exit(res.statusCode===200?0:1)});r.on("error",()=>process.exit(1));r.on("timeout",()=>{r.destroy();process.exit(1)})`,
        ], { stdio: "pipe", timeout: 3000, windowsHide: true });
        return { alive: true, detail: `responding on port ${port}` };
      } catch {
        // Port not responding — stale port file, clean up
        try { unlinkSync(portFile); } catch { /* ignore */ }
      }
    }
  } catch { /* no port file */ }

  // Layer 2: PID-based fallback (covers startup window before port file is written)
  const pidFile = getPidFile();
  try {
    const existingPid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    if (existingPid && existingPid !== process.pid) {
      try {
        process.kill(existingPid, 0);
        return { alive: true, detail: `PID ${existingPid}` };
      } catch {
        // Process is dead — clean up stale PID file
        try { unlinkSync(pidFile); } catch { /* ignore */ }
      }
    }
  } catch { /* no PID file */ }

  return { alive: false, detail: "" };
}

export async function startCommand(options: { detach?: boolean }): Promise<void> {
  // Check config exists
  if (!existsSync(getConfigFile())) {
    console.log(chalk.red("No configuration found."));
    console.log(`Run ${chalk.cyan("workermill-agent setup")} first.`);
    process.exit(1);
  }

  // Single-instance guard: refuse to start if another agent is alive.
  // Prevents the double-planning bug where two agent processes poll and both
  // claim the same task (each has its own planningInProgress set in memory).
  const existing = isAgentRunning();
  if (existing.alive) {
    console.log(chalk.yellow(`Agent is already running (${existing.detail}).`));
    console.log(`Stop it first with: ${chalk.cyan("workermill-agent stop")}`);
    process.exit(1);
  }

  // ── Auto-migrate: old configs with apiUrl but no explicit mode ──
  // Existing cloud users have apiUrl but no mode field. Set mode: "cloud"
  // so isCloudMode() works without heuristics.
  const rawConfig = loadStandaloneConfig();
  if ((rawConfig as unknown as Record<string, unknown>).apiUrl && !rawConfig.mode) {
    rawConfig.mode = "cloud";
    saveStandaloneConfig(rawConfig);
  }

  // ── Standalone mode detection ──
  // Standalone config has `mode: "standalone"` with `roles` but no `apiUrl`.
  // Detect it early to skip cloud-specific validation.
  // Use loadStandaloneConfig() directly — don't gate on isStandaloneReady()
  // which validates API keys (may fail if OAuth token is expired/missing).
  let config: AgentConfig;
  const standaloneCheck = loadStandaloneConfig();

  if (standaloneCheck.mode === "self-hosted") {
    const sc = standaloneCheck;
    config = {
      apiUrl: "http://localhost:3001",
      apiKey: "self-hosted",
      agentId: `agent-${homedir().split(/[\\/]/).pop() || "local"}`,
      maxWorkers: sc.settings?.maxParallelExperts ?? 4,
      pollIntervalMs: 5000,
      heartbeatIntervalMs: 30000,
      githubToken: sc.scm?.token || "",
      bitbucketToken: "",
      gitlabToken: "",
      githubReviewerToken: "",
      sandbox: (sc.sandbox === "none" ? "none" : "docker") as "docker" | "none",
      dockerImage: "ghcr.io/jarod-rosenthal/worker",
      dockerMemoryGb: 4,
      localRag: false,
      ollamaPort: 11434,
    };
  } else if (standaloneCheck.mode === "standalone" && !isCloudMode()) {
    const sc = standaloneCheck;
    config = {
      apiUrl: "",
      apiKey: "",
      agentId: "standalone",
      maxWorkers: sc.settings?.maxParallelExperts ?? 0,
      pollIntervalMs: 5000,
      heartbeatIntervalMs: 30000,
      githubToken: sc.scm?.token || "",
      bitbucketToken: sc.scm?.token || "",
      gitlabToken: "",
      githubReviewerToken: "",
      sandbox: (sc.sandbox === "none" ? "none" : "docker") as "docker" | "none",
      dockerImage: "ghcr.io/jarod-rosenthal/worker",
      dockerMemoryGb: 4,
      localRag: false,
      ollamaPort: 11434,
    };
  } else {
    config = loadConfigFromFile();
  }

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

  // Docker sandbox pre-flight check (skip pre-pull in detach mode — child does its own)
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

    if (!options.detach) {
      // Pre-pull image at startup (foreground only — detached child will pull on its own start)
      try {
        const { ensureImage } = await import("../docker-spawner.js");
        await ensureImage(config);
      } catch (err) {
        console.log(chalk.yellow(`  ⚠ Docker image pull failed: ${err instanceof Error ? err.message : String(err)}`));
        console.log(chalk.yellow("    Workers will attempt to pull on first task."));
      }
    }
  }

  if (options.detach) {
    const logFile = getLogFile();
    const pidFile = getPidFile();

    console.log(chalk.dim(`Starting agent in background...`));
    console.log(chalk.dim(`  Logs: ${logFile}`));
    console.log(chalk.dim(`  PID:  ${pidFile}`));

    // Rotate log files before starting (prevents unbounded growth across restarts)
    rotateLogs();

    // Spawn the CLI with "start" (no --detach) as a detached child, redirecting output to log file
    const logFd = openSync(logFile, "a");
    const stdinFd = openSync(devNull, "r");
    const wmDir = join(homedir(), ".workermill");
    const child = spawn(process.execPath, ["start"], {
      detached: true,
      stdio: [stdinFd, logFd, logFd],
      cwd: wmDir,
      windowsHide: true,
    });

    // Close fds after spawn inherits them
    try { closeSync(stdinFd); closeSync(logFd); } catch { /* ignore */ }

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

  // Foreground mode — tee stdout/stderr to log file so `workermill-agent logs` works.
  // Skip the tee if stdout is already redirected to a file (e.g. VS Code spawns us
  // with stdio: ["ignore", logFd, logFd], so stdout IS agent.log — tee would double-write).
  // Log rotation happens at startup only (rotateLogs above) — current session is always one file.
  const logFile = getLogFile();
  rotateLogs();
  if (process.stdout.isTTY) {
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
  }

  console.log();
  console.log(chalk.bold.cyan("  WorkerMill Remote Agent"));
  console.log(chalk.dim("  ─────────────────────────────────────"));
  console.log();

  // RAM check — 4 GB hard minimum for native mode, dockerMemoryGb + 4 GB for Docker sandbox
  const totalRamGB = Math.round(totalmem() / (1024 * 1024 * 1024));
  const dockerMinRam = config.dockerMemoryGb + 4; // container + OS headroom
  if (config.sandbox === "docker" && totalRamGB < dockerMinRam) {
    console.log(chalk.red(`  ✗ Insufficient RAM: ${totalRamGB} GB (Docker sandbox with ${config.dockerMemoryGb} GB container requires at least ${dockerMinRam} GB)`));
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
