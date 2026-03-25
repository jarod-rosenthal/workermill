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
import { checkForUpdate } from "./update-check.js";

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

  // Non-blocking update check
  void checkForUpdate(VERSION).then((latest) => {
    if (latest) {
      console.log(chalk.yellow(`  Update available: ${VERSION} → ${latest} — run: npm i -g workermill`));
    }
  });
}

const VERSION = "0.8.8";

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

// ── Doctor command: check setup health ──
program
  .command("doctor")
  .description("Check your WorkerMill setup for issues")
  .action(async () => {
    const chalk = (await import("chalk")).default;
    const { execSync } = await import("child_process");
    const fs = (await import("fs")).default;
    const path = (await import("path")).default;
    const os = (await import("os")).default;

    console.log();
    console.log(chalk.bold("  WorkerMill Doctor"));
    console.log();

    let issues = 0;

    // Check Node.js version
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.slice(1), 10);
    if (major >= 20) {
      console.log(chalk.green("  ✓") + ` Node.js ${nodeVersion}`);
    } else {
      console.log(chalk.red("  ✗") + ` Node.js ${nodeVersion} — requires 20+`);
      issues++;
    }

    // Check git
    try {
      const gitVersion = execSync("git --version", { encoding: "utf-8" }).trim();
      console.log(chalk.green("  ✓") + ` ${gitVersion}`);
    } catch {
      console.log(chalk.red("  ✗") + " git not found — install git for full functionality");
      issues++;
    }

    // Check config
    const configPath = path.join(os.homedir(), ".workermill", "cli.json");
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        console.log(chalk.green("  ✓") + ` Config found (default: ${config.default})`);

        // Check each provider
        for (const [name, prov] of Object.entries(config.providers || {})) {
          const p = prov as any;
          if (name === "ollama" || name.includes("ollama")) {
            const host = p.host || "http://localhost:11434";
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 3000);
              const res = await globalThis.fetch(`${host}/api/tags`, { signal: controller.signal });
              clearTimeout(timeout);
              if (res.ok) {
                const data = await res.json() as { models?: { name: string }[] };
                const models = data.models || [];
                console.log(chalk.green("  ✓") + ` Ollama connected at ${host} (${models.length} models)`);
                if (p.model && !models.find((m: any) => m.name === p.model)) {
                  console.log(chalk.yellow("  ⚠") + ` Model "${p.model}" not found in Ollama — pull it with: ollama pull ${p.model}`);
                  issues++;
                }
              } else {
                console.log(chalk.red("  ✗") + ` Ollama not responding at ${host}`);
                issues++;
              }
            } catch {
              console.log(chalk.red("  ✗") + ` Ollama not reachable at ${host}`);
              issues++;
            }
          } else if (p.apiKey) {
            if (p.apiKey.startsWith("{env:")) {
              const envVar = p.apiKey.slice(5, -1);
              if (process.env[envVar]) {
                console.log(chalk.green("  ✓") + ` ${name}: API key from ${envVar}`);
              } else {
                console.log(chalk.red("  ✗") + ` ${name}: ${envVar} not set`);
                issues++;
              }
            } else {
              console.log(chalk.green("  ✓") + ` ${name}: API key configured`);
            }
          }
        }
      } catch {
        console.log(chalk.red("  ✗") + " Config file is invalid JSON");
        issues++;
      }
    } else {
      console.log(chalk.yellow("  ⚠") + " No config found — run `workermill` to set up");
      issues++;
    }

    // Check project instructions
    const cwd = process.cwd();
    const instructionFiles = [".workermill/instructions.md", "CLAUDE.md", ".cursorrules", ".github/copilot-instructions.md"];
    const found = instructionFiles.find(f => fs.existsSync(path.join(cwd, f)));
    if (found) {
      console.log(chalk.green("  ✓") + ` Project instructions: ${found}`);
    } else {
      console.log(chalk.dim("  ○") + " No project instructions — use /init to create one");
    }

    // Check learnings
    const learningsPath = path.join(cwd, ".workermill", "learnings.json");
    if (fs.existsSync(learningsPath)) {
      try {
        const learnings = JSON.parse(fs.readFileSync(learningsPath, "utf-8"));
        console.log(chalk.green("  ✓") + ` ${learnings.length} project learnings saved`);
      } catch {
        console.log(chalk.dim("  ○") + " No learnings yet");
      }
    } else {
      console.log(chalk.dim("  ○") + " No learnings yet");
    }

    // Check custom commands
    const cmdDirs = [path.join(cwd, ".workermill", "commands"), path.join(os.homedir(), ".workermill", "commands")];
    let cmdCount = 0;
    for (const dir of cmdDirs) {
      try {
        if (fs.existsSync(dir)) {
          cmdCount += fs.readdirSync(dir).filter(f => f.endsWith(".md")).length;
        }
      } catch { /* ignore */ }
    }
    if (cmdCount > 0) {
      console.log(chalk.green("  ✓") + ` ${cmdCount} custom command${cmdCount > 1 ? "s" : ""}`);
    } else {
      console.log(chalk.dim("  ○") + " No custom commands");
    }

    console.log();
    if (issues === 0) {
      console.log(chalk.green("  All checks passed!"));
    } else {
      console.log(chalk.yellow(`  ${issues} issue${issues > 1 ? "s" : ""} found`));
    }
    console.log();
  });

program.parse();
