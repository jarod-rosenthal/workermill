#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { runSetup } from "./setup.js";
import { runAgent } from "./agent.js";
import { printHeader } from "./tui.js";

const VERSION = "0.1.3";

const program = new Command()
  .name("workermill")
  .description("AI coding agent with multi-expert orchestration")
  .version(VERSION)
  .option("--provider <provider>", "Override default provider")
  .option("--model <model>", "Override model")
  .option("--trust", "Skip all tool permission prompts")
  .option("--resume", "Resume the last conversation")
  .option("--plan", "Start in plan mode (read-only tools)")
  .option("--auto-revise", "Auto-revise on failed reviews without prompting")
  .option("--max-revisions <n>", "Max review→revise cycles (default: 2)", parseInt)
  .option("--critic", "Run separate critic pass on plan before execution")
  .option("--full-disk", "Allow tools to access files outside working directory (default: restricted to cwd)")
  .action(async (options) => {
    // Header is shown by runAgent after config is loaded (so it can show provider info)

    // Load or create config
    let config = loadConfig();
    if (!config) {
      config = await runSetup();
    }

    // Apply CLI overrides
    if (options.provider) {
      config.default = options.provider;
    }
    if (options.model) {
      const providerConfig = config.providers[config.default];
      if (providerConfig) {
        providerConfig.model = options.model;
      }
    }

    // Apply review overrides
    if (options.autoRevise || options.maxRevisions || options.critic) {
      config.review = {
        ...config.review,
        ...(options.autoRevise ? { autoRevise: true } : {}),
        ...(options.maxRevisions ? { maxRevisions: options.maxRevisions } : {}),
        ...(options.critic ? { useCritic: true } : {}),
      };
    }

    // Run interactive agent
    const fullDisk = options.fullDisk || false;
    await runAgent(config, options.trust || false, options.resume || false, options.plan || false, fullDisk);
  });

program.parse();
