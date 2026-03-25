#!/usr/bin/env node
// Orchestration creates many concurrent streams — raise the listener limit
// to avoid spurious MaxListenersExceededWarning from Node.
import { EventEmitter } from "events";
EventEmitter.defaultMaxListeners = 30;

import React from "react";
import { render } from "ink";
import chalk from "chalk";
import { Command } from "commander";
import { loadConfig, getProviderForPersona } from "./config.js";
import { runSetup } from "./setup.js";
import { Root } from "./ui/Root.js";

/** Resolve display strings for all 3 roles from the full config. */
function getRoleModelsFromConfig(config: import("./config.js").CliConfig): {
  worker: string;
  planner: string;
  reviewer: string;
} {
  const worker = getProviderForPersona(config);
  const planner = getProviderForPersona(config, "planner");
  const reviewer = getProviderForPersona(config, "tech_lead");
  return {
    worker: `${worker.provider}/${worker.model}`,
    planner: `${planner.provider}/${planner.model}`,
    reviewer: `${reviewer.provider}/${reviewer.model}`,
  };
}

/** Print the branded welcome header before Ink takes over the terminal. */
function printWelcome(roleModels: { worker: string; planner: string; reviewer: string }, workingDir: string): void {
  const brand = chalk.hex("#D77757");
  const dim = chalk.dim;
  const white = chalk.white;
  console.log();
  console.log(`  ${brand("◆")} ${white.bold("WorkerMill")} ${dim("v" + VERSION)}`);
  console.log(dim("  by Jarod Rosenthal"));
  console.log();
  if (roleModels.planner === roleModels.worker && roleModels.reviewer === roleModels.worker) {
    // All roles use the same model — show a single line
    console.log(dim(`  ${roleModels.worker}`));
  } else {
    console.log(dim(`  worker:   ${roleModels.worker}`));
    console.log(dim(`  planner:  ${roleModels.planner}`));
    console.log(dim(`  reviewer: ${roleModels.reviewer}`));
  }
  console.log(dim(`  cwd: ${workingDir}`));
  console.log();
  console.log(dim("  ") + brand("/build") + dim(" to create  ") + brand("/retry") + dim(" to re-run  ") + white("/help") + dim(" for all commands"));
  console.log();
}

const VERSION = "0.7.0";

// Shared options applied to both the default command and `build`
function addSharedOptions(cmd: Command): Command {
  return cmd
    .option("--provider <provider>", "Override default provider")
    .option("--model <model>", "Override model")
    .option("--trust", "Skip all tool permission prompts")
    .option("--full-disk", "Allow tools to access files outside working directory")
    .option("--max-tokens <n>", "Maximum output tokens per response", parseInt);
}

/** Load config, apply CLI overrides, run setup if needed. */
async function resolveConfig(options: Record<string, unknown>) {
  let config = loadConfig();
  if (!config) {
    config = await runSetup();
  }
  if (options.provider) {
    config.default = options.provider as string;
  }
  if (options.model) {
    const providerConfig = config.providers[config.default];
    if (providerConfig) {
      providerConfig.model = options.model as string;
    }
  }
  return config;
}

const program = new Command()
  .name("wm")
  .description("WorkerMill — AI coding agent for your terminal")
  .version(VERSION);

// ── Default command: interactive chat ──
const defaultCmd = program
  .command("chat", { isDefault: true })
  .description("Interactive AI coding agent (default)")
  .option("--resume", "Resume the last conversation")
  .option("--plan", "Start in plan mode (read-only tools)")
  .action(async (options) => {
    const config = await resolveConfig(options);
    const { provider, model, apiKey, host, contextLength } = getProviderForPersona(config);
    const workingDir = process.cwd();
    const roleModels = getRoleModelsFromConfig(config);

    printWelcome(roleModels, workingDir);

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
        maxTokens: options.maxTokens,
        workingDir,
        roleModels,
      }),
    );

    await waitUntilExit();
  });
addSharedOptions(defaultCmd);

// ── Build command: multi-expert orchestration ──
const buildCmd = program
  .command("build [task...]")
  .description("Build software with multi-expert orchestration")
  .option("--critic", "Run critic pass on plan before execution")
  .action(async (taskParts: string[], options) => {
    const task = taskParts.join(" ");
    if (!task) {
      console.log("\n  Usage: wm build \"<task description>\"\n");
      console.log("  Example:");
      console.log("    wm build \"REST API with auth, tests, and Docker\"");
      console.log("    wm build \"Add search feature to the React frontend\"\n");
      process.exit(0);
    }

    const config = await resolveConfig(options);
    if (options.critic) {
      config.review = { ...config.review, useCritic: true };
    }

    const { provider, model, apiKey, host, contextLength } = getProviderForPersona(config);
    const roleModels = getRoleModelsFromConfig(config);
    const trustAll = options.trust || false;
    const sandboxed = !options.fullDisk;

    // Set API keys
    if (apiKey) {
      const envMap: Record<string, string> = {
        anthropic: "ANTHROPIC_API_KEY",
        openai: "OPENAI_API_KEY",
        google: "GOOGLE_GENERATIVE_AI_API_KEY",
      };
      const envVar = envMap[provider];
      if (envVar && !process.env[envVar]) {
        process.env[envVar] = apiKey;
      }
    }

    // Render the Ink app with the build task pre-loaded
    const { waitUntilExit } = render(
      React.createElement(Root, {
        provider,
        model,
        apiKey,
        host,
        contextLength,
        trustAll,
        planMode: false,
        sandboxed,
        resume: false,
        maxTokens: options.maxTokens,
        workingDir: process.cwd(),
        initialBuildTask: task,
        roleModels,
      }),
    );

    await waitUntilExit();
  });
addSharedOptions(buildCmd);

program.parse();
