#!/usr/bin/env node

import { Command } from "commander";
import { checkDependencies } from "./deps.js";
import { loadConfig, saveConfig } from "./config.js";
import { authenticate, isAuthenticated } from "./auth.js";
import { startWorker, stopWorker, getWorkerStatus } from "./worker.js";

const program = new Command();

program
  .name("workermill")
  .description(
    "WorkerMill CLI — manage local AI workers that execute stories from workermill.com",
  )
  .version("0.1.0");

// Default command: start worker (auto-installs deps, authenticates, connects)
program
  .command("start", { isDefault: true })
  .description("Start the local worker (auto-installs deps, authenticates)")
  .action(async () => {
    await checkDependencies();

    const config = loadConfig();
    if (!isAuthenticated(config)) {
      await authenticate(config);
      saveConfig(config);
    } else {
      console.log("  \u2713 Already authenticated");
    }

    console.log("");
    console.log(`  Worker ready. Waiting for tasks...`);
    console.log(
      `  Dashboard: ${config.apiBaseUrl}/dashboard`,
    );
    console.log("");

    await startWorker(config);
  });

program
  .command("login")
  .description("Re-authenticate with workermill.com")
  .action(async () => {
    const config = loadConfig();
    await authenticate(config);
    saveConfig(config);
    console.log("  \u2713 Authentication updated");
  });

program
  .command("stop")
  .description("Stop the worker process")
  .action(async () => {
    await stopWorker();
  });

program
  .command("status")
  .description("Show current task, story progress, dashboard link")
  .action(async () => {
    const config = loadConfig();
    const status = await getWorkerStatus(config);
    if (status.running) {
      console.log(`  Worker: running`);
      console.log(`  Task: ${status.currentTask ?? "idle"}`);
      console.log(`  Dashboard: ${config.apiBaseUrl}/dashboard`);
    } else {
      console.log("  Worker: stopped");
      console.log('  Run "workermill start" to begin');
    }
  });

program
  .command("logs")
  .description("Tail worker output (local mirror of what dashboard shows)")
  .action(async () => {
    const status = await getWorkerStatus(loadConfig());
    if (!status.running) {
      console.log("  Worker is not running.");
      return;
    }
    // Log tailing is handled by the worker process writing to stdout.
    // This command attaches to the existing worker's output.
    console.log("  Log tailing not yet implemented for detached workers.");
    console.log("  View live logs on the dashboard.");
  });

program
  .command("config")
  .description("Show or set configuration")
  .option("--api-url <url>", "Set API base URL")
  .option("--workspace <path>", "Set workspace path")
  .action((opts: { apiUrl?: string; workspace?: string }) => {
    const config = loadConfig();
    let changed = false;

    if (opts.apiUrl) {
      config.apiBaseUrl = opts.apiUrl;
      changed = true;
    }
    if (opts.workspace) {
      config.workspacePath = opts.workspace;
      changed = true;
    }

    if (changed) {
      saveConfig(config);
      console.log("  \u2713 Configuration updated");
    }

    console.log(`  API URL:   ${config.apiBaseUrl}`);
    console.log(`  Workspace: ${config.workspacePath}`);
  });

program.parse();
