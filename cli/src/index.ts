#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { Command } from "commander";
import { loadConfig, getProviderForPersona } from "./config.js";
import { runSetup } from "./setup.js";
import { Root } from "./ui/Root.js";

const VERSION = "0.2.0";

const program = new Command()
  .name("workermill")
  .description("AI coding agent with multi-provider support")
  .version(VERSION)
  .option("--provider <provider>", "Override default provider")
  .option("--model <model>", "Override model")
  .option("--trust", "Skip all tool permission prompts")
  .option("--resume", "Resume the last conversation")
  .option("--plan", "Start in plan mode (read-only tools)")
  .option("--full-disk", "Allow tools to access files outside working directory")
  .action(async (options) => {
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

    const { provider, model, apiKey, host, contextLength } = getProviderForPersona(config);
    const workingDir = process.cwd();

    // Render the Ink application
    const { waitUntilExit } = render(
      React.createElement(Root, {
        provider,
        model,
        apiKey,
        host,
        contextLength,
        trustAll: options.trust || false,
        planMode: options.plan || false,
        sandboxed: !options.fullDisk,
        resume: options.resume || false,
        workingDir,
      }),
    );

    await waitUntilExit();
  });

program.parse();
