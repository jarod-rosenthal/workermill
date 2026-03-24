#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import chalk from "chalk";
import { Command } from "commander";
import { loadConfig, getProviderForPersona } from "./config.js";
import { runSetup } from "./setup.js";
import { Root } from "./ui/Root.js";

/** Print the branded welcome header before Ink takes over the terminal. */
function printWelcome(provider: string, model: string, workingDir: string): void {
  const brand = chalk.hex("#D77757");
  const dim = chalk.dim;
  const white = chalk.white;
  console.log();
  console.log(`  ${brand("◆")} ${white.bold("WorkerMill")} ${dim("v" + VERSION)}`);
  console.log();
  console.log(dim(`  ${provider}/${model}`));
  console.log(dim(`  cwd: ${workingDir}`));
  console.log();
  console.log(dim("  Ask me anything, or use ") + brand("/build") + dim(" to create software with multi-expert AI."));
  console.log(dim("  Type ") + white("/help") + dim(" for all commands."));
  console.log();
}

const VERSION = "0.4.0";

// Shared options applied to both the default command and `build`
function addSharedOptions(cmd: Command): Command {
  return cmd
    .option("--provider <provider>", "Override default provider")
    .option("--model <model>", "Override model")
    .option("--trust", "Skip all tool permission prompts")
    .option("--full-disk", "Allow tools to access files outside working directory");
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

    printWelcome(provider, model, workingDir);

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
        workingDir: process.cwd(),
        initialBuildTask: task,
      }),
    );

    await waitUntilExit();
  });
addSharedOptions(buildCmd);

program.parse();
