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
import { getStateRoot } from "./state-root.js";
import { checkForUpdate } from "./update-check.js";
import type { RunResult } from "./run-command.js";

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
    "/build #123 or /build GH-123 fetches a GitHub issue and builds it. Set up with /setup.",
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
    .option("--strict", "Strict mode — zero gate failures, require review approval, block scope drift")
    .option("--full-disk", "Allow tools to access files outside working directory")
    .option("--max-tokens <n>", "Maximum output tokens per response", parseInt)
    .option("-p, --prompt <prompt>", "Run a single prompt headlessly and exit")
    .option("--json", "Emit structured JSON for a headless prompt")
    .option("--fork", "Fork the resumed session (use with --resume)")
    .option("--live-view", "Enable live browser diff view")
    .option("--no-live-view", "Disable live browser diff view");
}

function parseHeadlessMaxSteps(value: string): number {
  return Number(value);
}

/** Load config, apply CLI overrides, run setup if needed. */
async function loadCliConfig(options: Record<string, unknown>, nonInteractive = false) {
  let config;
  let isFirstRun = false;

  try {
    config = resolveMergedConfig();
  } catch {
    const globalConfig = loadConfig();
    if (!globalConfig) {
      if (nonInteractive) throw new Error("No configuration found. Configure a provider before running headless prompts.");
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
    if (!(options.model as string).includes('/')) {
      const providerConfig = config.providers[config.default];
      if (providerConfig) {
        providerConfig.model = options.model as string;
      }
    }
  }
  if (options.autoRevise) {
    config.review = { ...config.review, autoRevise: true };
  }
  if (options.strict) {
    config.review = { ...config.review, strict: true };
  }
  if (options.liveView) {
    config.liveView = true;
  } else if (options.noLiveView) {
    config.liveView = false;
  }
  return { config, isFirstRun };
}

function startupFailure(reason: RunResult["reason"], error: string): RunResult {
  const cancelled = reason === "cancelled";
  const exitCode = reason === "invalid_options" ? 2 : reason === "os_sandbox_unavailable" ? 6 : reason === "cancelled" ? 130 : 1;
  return {
    status: cancelled ? "cancelled" : "failed", reason, error, exitCode,
    sessionId: null, model: null, text: "", toolCalls: 0,
    tokens: { input: 0, output: 0 }, costUsd: 0, durationMs: 0,
  };
}

function renderHeadlessResult(result: RunResult, json: boolean): void {
  if (json) process.stdout.write(JSON.stringify(result) + "\n");
  else if (result.status === "ok") process.stdout.write((result.text || "(completed with tool calls only)") + "\n");
  else process.stderr.write("Error: " + (result.error || result.reason || "headless run failed") + "\n");
  process.exitCode = result.exitCode;
}

async function executeHeadless(prompt: string | undefined, options: Record<string, unknown>, singlePrompt: boolean): Promise<void> {
  const json = options.json === true;
  if (!prompt?.trim()) return renderHeadlessResult(startupFailure("invalid_options", "prompt is required"), json);
  let config;
  try {
    ({ config } = await loadCliConfig(options, true));
  } catch (error) {
    return renderHeadlessResult(startupFailure("invalid_options", error instanceof Error ? error.message : String(error)), json);
  }
  let sandboxed;
  try {
    const resolution = resolveSandboxMode(config.sandbox, options.fullDisk === true);
    sandboxed = resolution.effective;
    if (resolution.warning) process.stderr.write("[wm] " + resolution.warning + "\n");
  } catch (error) {
    return renderHeadlessResult(startupFailure("os_sandbox_unavailable", error instanceof Error ? error.message : String(error)), json);
  }
  try {
    const { runCommand } = await import("./run-command.js");
    const result = await runCommand({
      prompt, json, session: options.session as string | undefined, continue: options.continue === true,
      model: options.model as string | undefined, maxSteps: options.maxSteps as number | undefined, singlePrompt, sandboxed,
    }, config, process.cwd());
    renderHeadlessResult(result, json);
  } catch (error) {
    renderHeadlessResult(startupFailure("provider_error", error instanceof Error ? error.message : String(error)), json);
  }
}

const program = new Command()
  .name("wm")
  .description("WorkerMill — AI coding agent for your terminal")
  .version(VERSION);

// ── Run command: headless automation ──
program
  .command("run [prompt...]")
  .description("Run a prompt headlessly and exit")
  .option("--json", "Emit structured JSON result")
  .option("--session <id>", "Continue a specific session")
  .option("--continue", "Continue the most recent session")
  .option("--model <provider/model>", "Override model")
  .option("--max-steps <n>", "Cap tool/reasoning steps", parseHeadlessMaxSteps)
  .option("--full-disk", "Allow tools to access files outside working directory")
  .action(async (prompt, options) => {
    await executeHeadless(prompt?.join(" "), options, false);
  });

// ── Default command: interactive chat ──
const defaultCmd = program
  .command("chat", { isDefault: true })
  .description("Interactive AI coding agent (default)")
  .option("--resume", "Resume the last conversation")
  .option("--plan", "Start in plan mode (read-only tools)")
  .action(async (options) => {
    if (options.prompt !== undefined) {
      await executeHeadless(options.prompt as string, options, true);
      return;
    }
    const { config, isFirstRun } = await loadCliConfig(options);
    const { provider, model, apiKey, host, contextLength } = getProviderForPersona(config);
    const workingDir = process.cwd();
    const roleModels = getRoleModelsFromConfig(config);
    const sandboxResolution = resolveSandboxMode(config.sandbox, !!options.fullDisk);
    const sandboxed = sandboxResolution.effective;

    await printWelcome(workingDir, isFirstRun);

    // Check for interrupted builds and show recovery prompt
    try {
      const { detectInterruptedBuild, printRecoveryPrompt } = await import("./recovery.js");
      const recovery = detectInterruptedBuild(workingDir);
      if (recovery) {
        printRecoveryPrompt(recovery);
      }
    } catch { /* non-fatal */ }

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

    console.log();
    console.log(chalk.bold("  WorkerMill Doctor"));
    console.log();

    let issues = 0;

    // Check Node.js version
    const nodeVersion = process.version;
    const [major, minor] = nodeVersion.slice(1).split(".").map(Number);
    if (major > 22 || (major === 22 && minor >= 12)) {
      console.log(chalk.green("  ✓") + ` Node.js ${nodeVersion}`);
    } else {
      console.log(chalk.red("  ✗") + ` Node.js ${nodeVersion} — requires 22.12+`);
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
    const configPath = path.join(getStateRoot(), "cli.json");
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
          } else {
            // `apiKey` is a template reference like `{env:OPENAI_API_KEY}`,
            // never the raw key. `envVar` below is the environment variable
            // NAME, not its value, so logging it is safe.
            const keyRef = p.apiKey;
            if (keyRef?.startsWith("{env:")) {
              const envVar = keyRef.slice(5, -1);
              if (process.env[envVar]) {
                console.log(chalk.green("  ✓") + ` ${name}: API key from ${envVar}`);
              } else {
                console.log(chalk.red("  ✗") + ` ${name}: ${envVar} not set`);
                issues++;
              }
            } else if (keyRef) {
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
    const cmdDirs = [path.join(cwd, ".workermill", "commands"), path.join(getStateRoot(), "commands")];
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

// ── Model command: set or show default model outside a session ──
program
  .command("model [provider/model]")
  .description("Show or set the default model without entering a session")
  .action(async (modelArg?: string) => {
    const { loadConfig: loadCfg, saveConfig: saveCfg } = await import("./config.js");
    const cfg = loadCfg();
    if (!cfg) {
      console.error("No configuration found. Run `wm` to set up.");
      process.exit(1);
    }
    if (!modelArg) {
      const provider = cfg.default || "unknown";
      const model = cfg.providers[provider]?.model || "unknown";
      console.log(`Default: ${provider}/${model}`);
      if (cfg.routing && Object.keys(cfg.routing).length > 0) {
        console.log("\nRouting:");
        for (const [role, prov] of Object.entries(cfg.routing)) {
          const m = cfg.providers[prov]?.model || "default";
          console.log(`  ${role}: ${prov}/${m}`);
        }
      }
      return;
    }
    const parts = modelArg.split("/");
    if (parts.length < 2) {
      console.error("Usage: wm model <provider>/<model>");
      console.error("Example: wm model ollama/qwen3-coder:30b");
      process.exit(1);
    }
    const newProvider = parts[0];
    const newModel = parts.slice(1).join("/");
    if (!cfg.providers[newProvider]) {
      console.error(`Provider "${newProvider}" not configured. Add it with: wm (then /settings key ${newProvider} <key>)`);
      process.exit(1);
    }
    cfg.providers[newProvider].model = newModel;
    cfg.default = newProvider;
    saveCfg(cfg);
    console.log(`Default model set to ${newProvider}/${newModel}`);
  });

// ── Models command group ──
const modelsCmd = program
  .command("models")
  .description("Manage AI models");

// ── Models list (default): list available AI models ──
modelsCmd
  .command("list [filter]", { isDefault: true })
  .description("List available AI models with live provider discovery")
  .option("--json", "Emit as JSON array")
  .option("--provider <name>", "Filter to a single provider")
  .option("--available", "Only show confirmed-reachable models")
  .action(async (filter, options) => {
    const { runModelsCommand } = await import("./models-command.js");
    await runModelsCommand(filter, options);
  });

// ── Models update subcommand: explicit model catalog update ──
modelsCmd
  .command("update [source]")
  .description("Explicitly update the model catalog from a source")
  .option("--force", "Bypass cache/ETag and force refresh")
  .option("--json", "Output machine-readable JSON result")
  .action(async (source, options) => {
    const { runModelsUpdateCommand } = await import("./models-command.js");
    await runModelsUpdateCommand(source, options);
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

// ── Session command: manage conversation sessions ──
const sessionCmd = program
  .command("session")
  .description("Manage conversation sessions");

// ── Session list: list all sessions ──
sessionCmd
  .command("list")
  .description("List all sessions")
  .option("--json", "Emit as JSON array")
  .action(async (options) => {
    const { handleSessionList } = await import("./session-command.js");
    handleSessionList(options);
  });

// ── Session show: show a session by ID or prefix ──
sessionCmd
  .command("show <idOrPrefix>")
  .description("Show a session by ID or unique prefix")
  .option("--json", "Emit as JSON object")
  .action(async (idOrPrefix, options) => {
    const { handleSessionShow } = await import("./session-command.js");
    handleSessionShow(idOrPrefix, options);
  });

// ── Session last: show the last session ──
sessionCmd
  .command("last")
  .description("Show the most recent session")
  .option("--json", "Emit as JSON object")
  .action(async (options) => {
    const { handleSessionLast } = await import("./session-command.js");
    handleSessionLast(options);
  });

// ── Session rename: rename a session ──
sessionCmd
  .command("rename <idOrPrefix> <name>")
  .description("Rename a session by ID or unique prefix")
  .option("--json", "Emit as JSON object")
  .action(async (idOrPrefix, newName, options) => {
    const { handleSessionRename } = await import("./session-command.js");
    handleSessionRename(idOrPrefix, newName, options);
  });

// ── Session delete: delete a session ──
sessionCmd
  .command("delete <idOrPrefix>")
  .description("Delete a session by ID or unique prefix")
  .option("--json", "Emit as JSON object")
  .action(async (idOrPrefix, options) => {
    const { handleSessionDelete } = await import("./session-command.js");
    handleSessionDelete(idOrPrefix, options);
  });

// ── Schema command: emit JSON Schema for config ──
program
  .command("schema")
  .description("Emit JSON Schema for global cli.json configuration")
  .option("--out <path>", "Write schema to file instead of stdout")
  .action(async (options) => {
    const { runSchemaCommand } = await import("./schema-command.js");
    runSchemaCommand(options);
  });

// ── Stats command: cross-session usage and cost analytics ──
program
  .command("stats")
  .description("Show usage and cost analytics across sessions")
  .option("--days <n>", "Look back N days (default: 30)", parseInt)
  .option("--all", "Include all sessions regardless of age")
  .option("--cwd", "Scope to sessions from the current working directory only")
  .option("--json", "Emit raw JSON for scripting")
  .action(async (options) => {
    const { runStatsCommand } = await import("./stats-command.js");
    runStatsCommand(options);
  });

// ── Runs command: inspect past /build runs ──
const runsCmd = program
  .command("runs")
  .description("Inspect past /build run manifests");

runsCmd
  .command("list", { isDefault: true })
  .description("List recent /build runs")
  .option("--json", "Emit JSON output")
  .action(async (options) => {
    const { runsList } = await import("./runs-command.js");
    runsList(options);
  });

runsCmd
  .command("show <idOrPrefix>")
  .description("Show details of a specific run")
  .option("--json", "Emit JSON output")
  .action(async (idOrPrefix, options) => {
    const { runsShow } = await import("./runs-command.js");
    runsShow(idOrPrefix, options);
  });

runsCmd
  .command("last")
  .description("Show the most recent run")
  .option("--json", "Emit JSON output")
  .action(async (options) => {
    const { runsLast } = await import("./runs-command.js");
    runsLast(options);
  });

program.parse();
