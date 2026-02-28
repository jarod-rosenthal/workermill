#!/usr/bin/env node

/**
 * WorkerMill Remote Agent CLI
 *
 * Smart default: running `workermill-agent` with no args auto-launches
 * setup if no config exists, or starts the agent if already configured.
 */

import { existsSync } from "fs";
import { Command } from "commander";
import { setupCommand } from "./commands/setup.js";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { statusCommand } from "./commands/status.js";
import { logsCommand } from "./commands/logs.js";
import { pullCommand } from "./commands/pull.js";
import { updateCommand } from "./commands/update.js";
import { initStandaloneCommand } from "./commands/init-standalone.js";
import { runStandaloneCommand } from "./commands/run-standalone.js";
import { prdStandaloneCommand } from "./commands/prd-standalone.js";
import { getConfigFile } from "./config.js";
import { isStandaloneReady } from "./backends/local/config.js";
import { AGENT_VERSION } from "./version.js";

const program = new Command();

program
  .name("workermill-agent")
  .description("WorkerMill Remote Agent - Run AI workers locally with your own AI provider credentials")
  .version(AGENT_VERSION);

program
  .command("setup")
  .description("Interactive setup wizard - configure API key and validate prerequisites")
  .action(setupCommand);

program
  .command("start")
  .description("Start the agent, polling the cloud API for tasks")
  .option("--detach", "Run in background (daemon mode)")
  .action(startCommand);

program
  .command("stop")
  .description("Stop the running agent")
  .action(stopCommand);

program
  .command("status")
  .description("Show agent status and API connectivity")
  .action(statusCommand);

program
  .command("logs")
  .description("Live tail of agent logs (like tail -f)")
  .option("-n, --lines <count>", "Number of lines to show initially", "50")
  .action(logsCommand);

program
  .command("pull")
  .description("Pull/update the Docker sandbox image")
  .action(pullCommand);

program
  .command("update")
  .description("Update the agent to the latest version")
  .action(updateCommand);

program
  .command("init")
  .description("Initialize standalone mode - configure LLM keys and repo")
  .option("--standalone", "Run in standalone mode (no cloud API)")
  .action(async (opts) => {
    if (opts.standalone) {
      await initStandaloneCommand();
    } else {
      console.log("Use --standalone for offline mode, or 'workermill-agent setup' for cloud mode.");
    }
  });

program
  .command("run")
  .description("Run a task in standalone mode")
  .option("--repo <url>", "Target repository URL")
  .requiredOption("--task <description>", "Task description for the AI worker")
  .action(runStandaloneCommand);

program
  .command("prd")
  .description("Decompose a PRD into a board with cards")
  .option("--repo <url>", "Target repository URL")
  .option("--file <path>", "Path to PRD file")
  .option("--content <text>", "PRD content as text")
  .action(prdStandaloneCommand);

// If no command given, auto-detect: run setup if no config, otherwise start
if (process.argv.length <= 2) {
  if (existsSync(getConfigFile()) || isStandaloneReady()) {
    startCommand({ detach: false });
  } else {
    // No config at all — prompt for setup
    console.log("No configuration found. Choose a setup mode:");
    console.log("  workermill-agent setup         — Connect to WorkerMill Cloud");
    console.log("  workermill-agent init --standalone — Run fully offline");
    process.exit(0);
  }
} else {
  program.parse();
}
