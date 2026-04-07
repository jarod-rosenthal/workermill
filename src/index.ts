#!/usr/bin/env node
// Orchestration creates many concurrent streams — raise the listener limit
// to avoid spurious MaxListenersExceededWarning from Node.
import { EventEmitter } from "events";
EventEmitter.defaultMaxListeners = 30;

import React from "react";
import { render } from "ink";
import chalk from "chalk";
import { Command } from "commander";
import { loadConfig, resolveConfig as resolveMergedConfig, getProviderForPersona } from "./config.js";
import { findProjectInstructionSource } from "./instructions.js";
import { runSetup } from "./setup.js";
import { getOSSandboxDependencyStatus, resolveSandboxMode } from "./sandbox-mode.js";
import { Root } from "./ui/Root.js";
import { checkForUpdate } from "./update-check.js";
import { runCommand } from "./run-command.js";

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
async function printWelcome(workingDir: string, isFirstRun = false): Promise<void> {
  const brand = chalk.hex("#D77757");
  const dim = chalk.dim;
  const white = chalk.white;

  console.log();
  console.log(`  ${brand("◆")} ${white.bold("WorkerMill")} ${dim("v" + VERSION)}`);

  if (isFirstRun) {
    console.log();
    console.log(brand("  Welcome aboard!") + dim(" You have a team of AI experts ready to work."));
    console.log(dim("  Try /build <task> to plan, build, review, and commit — all in one shot."));
    console.log(dim("  Or just describe what you need and your team will figure it out."));
  }
  console.log();

  const tips = [
    "/build <task> assigns a team of experts to plan, build, review, and commit your feature.",
    "/as backend_developer <task> gives you a single dedicated expert for focused work.",
    "/review runs a tech lead code review on your uncommitted changes.",
    "/init creates an AGENT.md — project context that every expert reads before starting.",
    "Switch your planner or reviewer model: `/model planner google/gemini-3.1-pro`.",
    "Use /model <provider>/<model> to switch models mid-session without restarting.",
    "Next time, launch with `workermill --resume` to restore this session's messages and context.",
    "/build GH-42 or /build #42 fetches a GitHub issue and builds it. Set up with /setup.",
    "/build PROJ-123 fetches a Jira or Linear ticket and builds it. Configure with /setup.",
  ];
  console.log(dim(`  ${tips[Math.floor(Math.random() * tips.length)]}`));
  console.log(dim(`  Type ${white("/help")} for all commands.`));
  console.log();

  // Blocking update check — must print before Ink takes over stdout
  const latest = await checkForUpdate(VERSION);
  if (latest) {
    console.log(chalk.yellow(`\n  Update available: ${VERSION} → ${latest}`));
    console.log(chalk.yellow(`  Run: npx workermill@${latest}\n`));
  }
}

import { VERSION } from "./version.js";

// Shared options applied to both the default command and `build`
function addSharedOptions(cmd: Command): Command {
  return cmd
    .option("--provider <provider>", "Override default provider")
    .option("--model <model>", "Override model")
    .option("--trust", "Skip all tool permission prompts")
    .option("--auto-revise", "Auto-approve revisions during /build reviews")
    .option("--full-disk", "Allow tools to access files outside working directory")
    .option("--max-tokens <n>", "Maximum output tokens per response", parseInt)
    .option("-p, --prompt <prompt>", "Run a single prompt headlessly and exit")
    .option("--fork", "Fork the resumed session (use with --resume)")
    .option("--live-view", "Enable live browser diff view")
    .option("--no-live-view", "Disable live browser diff view");
}

/** Load config, apply CLI overrides, run setup if needed. */
async function loadCliConfig(options: Record<string, unknown>) {
  let config;
  let isFirstRun = false;

  try {
    config = resolveMergedConfig();
  } catch {
    const globalConfig = loadConfig();
    if (!globalConfig) {
      await runSetup();
      isFirstRun = true;
      config = resolveMergedConfig();
    } else {
      throw new Error("Failed to resolve configuration.");
    }
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
  if (options.autoRevise) {
    config.review = { ...config.review, autoRevise: true };
  }
  if (options.liveView) {
    config.liveView = true;
  } else if (options.noLiveView) {
    config.liveView = false;
  }
  return { config, isFirstRun };
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
    const { config, isFirstRun } = await loadCliConfig(options);
    const { provider, model, apiKey, host, contextLength } = getProviderForPersona(config);
    const workingDir = process.cwd();
    const roleModels = getRoleModelsFromConfig(config);
    const sandboxResolution = resolveSandboxMode(config.sandbox, !!options.fullDisk);
    const sandboxed = sandboxResolution.effective;

    if (options.prompt) {
      // Headless mode — run single prompt, print result, exit
      const { streamText, stepCountIs } = await import("ai");
      const { createModel, buildOllamaOptions } = await import("./engine/model-factory.js");
      const { createToolDefinitions } = await import("./engine/tools/index.js");
      const { formatProjectInstructions } = await import("./instructions.js");
      const { loadLearnings } = await import("./learnings.js");
      const { startAllMCPServers, getMCPToolDefinitions, stopAllMCPServers, autoDetectMCPServers } = await import("./mcp-client.js");

      // Start MCP servers — auto-detect Docker Desktop + user config
      const mcpConfig = autoDetectMCPServers(config.mcp || {});
      if (Object.keys(mcpConfig).length > 0) {
        await startAllMCPServers(mcpConfig);
      }

      const aiModel = createModel(provider as any, model, host, contextLength);
      const baseTools = createToolDefinitions(workingDir, aiModel, sandboxed);
      const mcpToolDefs = getMCPToolDefinitions();
      const tools = { ...baseTools, ...mcpToolDefs };

      if (sandboxResolution.warning) {
        console.error(`[wm] ${sandboxResolution.warning}`);
      }

      let systemPrompt = `You are WorkerMill, an AI coding agent. Working directory: ${workingDir}\n`;
      const instructions = formatProjectInstructions(workingDir);
      if (instructions) systemPrompt += instructions;
      const learnings = loadLearnings();
      if (learnings.length > 0) {
        systemPrompt += `\n\n## Project Learnings\n${learnings.map(l => `- ${l}`).join("\n")}`;
      }
      const mcpToolKeys = Object.keys(mcpToolDefs);
      if (mcpToolKeys.length > 0) {
        const serverNames = [...new Set(mcpToolKeys.map(k => k.split("__")[1]))];
        systemPrompt += `\n\n## MCP Tools\n\nYou have additional tools from MCP server(s): ${serverNames.join(", ")}. `;
        systemPrompt += `Tools prefixed with \`mcp__<server>__\` are real, working tools. Use them confidently and trust their results.\n`;
      }

      const stream = streamText({
        model: aiModel,
        system: systemPrompt,
        prompt: options.prompt as string,
        tools: tools as any,
        stopWhen: stepCountIs(50),
        ...buildOllamaOptions(provider as any, contextLength),
      });

      for await (const chunk of stream.textStream) {
        process.stdout.write(chunk);
      }

      const finalText = await stream.text;
      if (!finalText) {
        // If no text was streamed (tool-only response), check tool results
        console.log("(completed with tool calls only)");
      }
      console.log(); // newline at end
      stopAllMCPServers();
      const { shutdown: shutdownLSP } = await import("./engine/tools/lsp.js");
      shutdownLSP();
      process.exit(0);
    }

    await printWelcome(workingDir, isFirstRun);
    if (sandboxResolution.warning) {
      console.log(chalk.yellow(`  ⚠ ${sandboxResolution.warning}`));
      console.log();
    }

    // Enable synchronized output (DEC mode 2026) to prevent terminal tearing.
    // Wraps each stdout.write in begin/end synchronized update sequences so the
    // terminal renders each frame atomically instead of showing partial redraws.
    if (process.stdout.isTTY) {
      const BSU = "\x1b[?2026h";  // Begin Synchronized Update
      const ESU = "\x1b[?2026l";  // End Synchronized Update
      const origWrite = process.stdout.write.bind(process.stdout) as (chunk: string | Uint8Array, encoding?: BufferEncoding, cb?: (err?: Error | null) => void) => boolean;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stdout as any).write = function (chunk: string | Uint8Array, encodingOrCb?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void): boolean {
        const str = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
        if (str.includes("\x1b[") && str.length > 20) {
          if (typeof encodingOrCb === "function") return origWrite(BSU + str + ESU, undefined, encodingOrCb);
          return origWrite(BSU + str + ESU, encodingOrCb, cb);
        }
        if (typeof encodingOrCb === "function") return origWrite(chunk, undefined, encodingOrCb);
        return origWrite(chunk, encodingOrCb, cb);
      };
    }

    const { waitUntilExit } = render(
      React.createElement(Root, {
        provider,
        model,
        apiKey,
        host,
        contextLength,
        trustAll: options.trust || false,
        planMode: options.plan || false,
        sandboxed,
        resume: options.resume || false,
        fork: options.fork || false,
        maxTokens: options.maxTokens,
        workingDir,
        roleModels,
        cliConfig: config,
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
        const requestedSandbox = config.sandbox ?? true;
        if (requestedSandbox === "os") {
          const status = getOSSandboxDependencyStatus();
          if (!status.supported) {
            console.log(chalk.red("  ✗") + " OS sandbox requested but unsupported on this platform");
            issues++;
          } else if (status.errors.length > 0) {
            console.log(chalk.red("  ✗") + ` OS sandbox dependencies missing: ${status.errors.join(", ")}`);
            issues++;
          } else {
            console.log(chalk.green("  ✓") + " OS sandbox dependencies installed");
            if (status.warnings.length > 0) {
              console.log(chalk.yellow("  ⚠") + ` OS sandbox warnings: ${status.warnings.join(", ")}`);
            }
          }
        } else if (requestedSandbox === true) {
          console.log(chalk.dim("  ○") + " Sandbox mode: path sandbox (default)");
        } else {
          console.log(chalk.yellow("  ⚠") + " Sandbox mode: disabled (full disk)");
        }

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
    const found = findProjectInstructionSource(cwd);
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

// ── Models command: list available AI models ──
program
  .command("models [filter]")
  .description("List available AI models with live provider discovery")
  .option("--json", "Emit as JSON array")
  .option("--provider <name>", "Filter to a single provider")
  .option("--available", "Only show confirmed-reachable models")
  .action(async (filter, options) => {
    const { runModelsCommand } = await import("./models-command.js");
    await runModelsCommand(filter, options);
  });

// ── Logs command: stream or tail log entries ──
program
  .command("logs")
  .description("Stream or tail CLI log entries for the current project")
  .option("--tail <n>", "Show last N log entries", parseInt, 50)
  .option("--follow", "Stream new entries as they are appended")
  .option("--cwd <path>", "Resolve log file for a specific project directory instead of cwd")
  .option("--level <level>", "Filter by log level")
  .option("--json", "Emit each entry as a parsed JSON object, one per line")
  .action(async (options) => {
    const { runLogsCommand } = await import("./logs-command.js");
    runLogsCommand(options);
  });

// ── Run command: headless execution ──
program
  .command("run")
  .description("Run a single prompt headlessly")
  .argument("[prompt...]", "the prompt to run")
  .option("--json", "emit structured result object")
  .option("--session <id>", "continue a specific session")
  .option("--continue", "continue most recent session")
  .option("--model <provider/model>", "override worker model")
  .option("--max-steps <n>", "cap tool/reasoning steps", parseInt)
  .action(async (promptParts: string[], options) => {
    const prompt = promptParts.join(" ");
    if (!prompt) {
      console.error("Error: prompt is required");
      process.exit(2);
    }
    let providerOverride, modelOverride;
    if (options.model) {
      const parts = options.model.split("/");
      if (parts.length !== 2) {
        console.error("Error: --model must be in format provider/model");
        process.exit(2);
      }
      [providerOverride, modelOverride] = parts;
    }
    // Load config with overrides
    const cliOptions = {
      provider: providerOverride,
      model: modelOverride,
    };
    const { config } = await loadCliConfig(cliOptions);
    const { provider, model, apiKey, host, contextLength } = getProviderForPersona(config);
    try {
      const result = await runCommand({
        prompt,
        json: options.json,
        session: options.session,
        continue: options.continue,
        model: options.model,
        maxSteps: options.maxSteps,
        config,
        provider,
        modelName: model,
        host,
        contextLength,
        apiKey,
        trustAll: false,
        fullDisk: false,
      });
      if (options.json) {
        console.log(JSON.stringify(result));
      }
      if (result.status === "ok") {
        process.exit(0);
      } else if (result.status === "error") {
        process.exit(1);
      } else if (result.status === "cancelled") {
        process.exit(130);
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program.parse();
