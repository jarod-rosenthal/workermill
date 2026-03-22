import readline from "readline";
import fs from "fs";
import pathModule from "path";
import chalk from "chalk";
import ora from "ora";
import { execSync } from "child_process";
import { streamText, stepCountIs, type ToolSet } from "ai";
import { createModel } from "../../packages/engine/src/model-factory.js";
import { createToolDefinitions } from "../../packages/engine/src/tools/index.js";
import type { AIProvider } from "../../packages/engine/src/types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDef = any;
import { PermissionManager } from "./permissions.js";
import { killActiveProcess } from "../../packages/engine/src/tools/bash.js";
import { printToolCall, printToolResult, printError, printStatusBar, printHeader } from "./tui.js";
import { handleCommand as handleSlashCommand, type CommandContext } from "./commands.js";
import { CostTracker } from "./cost-tracker.js";

type AgentState = "idle" | "streaming" | "tool_executing" | "permission_waiting";
import type { CliConfig } from "./config.js";
import { getProviderForPersona } from "./config.js";
import { createSession, saveSession, addMessage, loadLatestSession, type Session } from "./session.js";
import { shouldCompact, compactMessages } from "./compaction.js";
import * as logger from "./logger.js";

// Input history persistence
const HISTORY_FILE = pathModule.join(process.env.HOME || "~", ".workermill", "history");
const MAX_HISTORY = 1000;

function loadHistory(): string[] {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const lines = fs.readFileSync(HISTORY_FILE, "utf-8").split("\n").filter(Boolean);
      return lines.slice(-MAX_HISTORY);
    }
  } catch { /* ignore */ }
  return [];
}

function appendHistory(line: string): void {
  try {
    const dir = pathModule.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(HISTORY_FILE, line + "\n", "utf-8");
  } catch { /* ignore */ }
}

// Slash command tab completion
const SLASH_COMMANDS = [
  "/help", "/clear", "/compact", "/status", "/model", "/quit",
  "/cost", "/git", "/editor", "/plan", "/sessions", "/exit",
];

function completer(line: string): [string[], string] {
  if (line.startsWith("/")) {
    const hits = SLASH_COMMANDS.filter(c => c.startsWith(line));
    return [hits.length ? hits : SLASH_COMMANDS, line];
  }
  return [[], line];
}

export async function runAgent(config: CliConfig, trustAll: boolean, resume?: boolean, startInPlanMode?: boolean): Promise<void> {
  const { provider, model: modelName, apiKey, host } = getProviderForPersona(config);

  // Set API keys in env if provided
  if (apiKey) {
    const envMap: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      google: "GOOGLE_API_KEY",
    };
    const envVar = envMap[provider];
    if (envVar && !process.env[envVar]) {
      process.env[envVar] = apiKey;
    }
  }

  const aiProvider = provider as AIProvider;
  const model = createModel(aiProvider, modelName, host);
  const workingDir = process.cwd();
  const tools = createToolDefinitions(workingDir, model);
  const permissions = new PermissionManager(trustAll);

  // readline will be bound to permissions after creation (see below)

  // Initialize or resume session
  let session: Session;
  if (resume) {
    const loaded = loadLatestSession();
    if (loaded) {
      session = loaded;
      console.log(chalk.green(`  Resumed session ${session.id.slice(0, 8)}... (${session.messages.length} messages)\n`));
    } else {
      session = createSession(provider, modelName);
      console.log(chalk.dim("  No previous session found, starting fresh.\n"));
    }
  } else {
    session = createSession(provider, modelName);
  }

  let agentState: AgentState = "idle";
  let currentAbortController: AbortController | null = null;
  let lastCtrlCTime = 0;
  let planMode = startInPlanMode || false;
  const costTracker = new CostTracker();

  // Read-only tools allowed in plan mode
  const READ_ONLY_TOOLS = new Set(["read_file", "glob", "grep", "ls", "sub_agent"]);
  // Git is read-only in plan mode (status/diff/log only, filtered in tool wrapper)

  function getActiveTools(): Record<string, AnyToolDef> {
    if (!planMode) return permissionedTools;
    const filtered: Record<string, AnyToolDef> = {};
    for (const [name, def] of Object.entries(permissionedTools)) {
      if (READ_ONLY_TOOLS.has(name)) {
        filtered[name] = def;
      }
    }
    return filtered;
  }

  // Wrap tools with permission checks
  const permissionedTools: Record<string, AnyToolDef> = {};
  for (const [name, toolDef] of Object.entries(tools)) {
    const td = toolDef as AnyToolDef;
    permissionedTools[name] = {
      ...td,
      execute: async (input: Record<string, unknown>) => {
        const prevState = agentState;
        agentState = "permission_waiting";
        const allowed = await permissions.checkPermission(name, input);
        if (!allowed) {
          agentState = prevState;
          logger.debug("Tool denied by user", { tool: name });
          return "Tool execution denied by user.";
        }
        logger.info("Tool call", { tool: name, input: JSON.stringify(input).slice(0, 200) });
        printToolCall(name, input);
        agentState = "tool_executing";
        const result = await td.execute(input);
        agentState = "streaming";
        const resultStr = typeof result === "string" ? result : JSON.stringify(result);
        logger.debug("Tool result", { tool: name, result: resultStr.slice(0, 200) });
        printToolResult(name, resultStr);
        return result;
      },
    };
  }

  logger.info("Session started", { provider, model: modelName, workingDir, trustAll });

  // Clear screen and show header
  printHeader("0.1.0", provider, modelName, workingDir);

  // Show initial status bar
  printStatusBar(provider, modelName, 0, planMode ? "PLAN" : (trustAll ? "trust all" : "ask"), 0);
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("❯ "),
    completer,
  });

  // Load persistent history
  const history = loadHistory();
  (rl as any).history = history.reverse();

  // Bind the readline to the permission manager so it reuses the same instance
  permissions.setReadline(rl);

  process.on("SIGINT", () => {
    if (agentState === "streaming") {
      if (currentAbortController) currentAbortController.abort();
      console.log(chalk.yellow("\n  [cancelled]"));
      agentState = "idle";
      currentAbortController = null;
      processing = false;
      rl.resume();
      rl.prompt();
    } else if (agentState === "tool_executing") {
      console.log(chalk.yellow("\n  [cancelling...]"));
      killActiveProcess();
      if (currentAbortController) currentAbortController.abort();
      agentState = "idle";
      currentAbortController = null;
      processing = false;
      rl.resume();
      rl.prompt();
    } else if (agentState === "permission_waiting") {
      permissions.cancelPrompt();
      console.log(chalk.yellow("\n  [cancelled]"));
      agentState = "idle";
      currentAbortController = null;
      processing = false;
      rl.resume();
      rl.prompt();
    } else {
      // idle — double-tap to exit
      const now = Date.now();
      if (now - lastCtrlCTime < 500) {
        console.log(chalk.dim("\n  Goodbye!\n"));
        saveSession(session);
        process.exit(0);
      }
      lastCtrlCTime = now;
      console.log(chalk.dim("\n  Press Ctrl+C again to exit."));
      rl.prompt();
    }
  });

  const systemPrompt = `You are WorkerMill, an AI coding agent running in the user's terminal.
You have access to tools for reading, writing, and editing files, running bash commands, searching code, and fetching web content.

Working directory: ${workingDir}

Guidelines:
- Be concise and direct in your responses
- Use tools proactively to explore the codebase before making changes
- When editing files, read them first to understand context
- Prefer editing existing files over creating new ones
- Run tests after making changes when test infrastructure exists
- Use glob and grep to find relevant files before reading them

Focus on writing clean, production-ready code.`;

  rl.prompt();

  let processing = false;
  let multilineBacktick = false;
  let multilineBackslash = false;
  let multilineBuffer: string[] = [];

  // Command context for slash commands
  const cmdCtx: CommandContext = {
    config,
    session,
    costTracker,
    workingDir,
    planMode,
    setPlanMode: (mode: boolean) => { planMode = mode; cmdCtx.planMode = mode; },
    processInput,
  };

  function processInput(input: string): void {
    processing = true;
    rl.pause();

    (async () => {
    try {
      addMessage(session, "user", input);
      appendHistory(input);
      if (!session.name) {
        session.name = input.slice(0, 50).replace(/\n/g, " ");
      }
      logger.info("User message", { length: input.length, preview: input.slice(0, 100) });

      // On first message, check if the task warrants multi-expert orchestration
      if (session.messages.length <= 1) {
        const { classifyComplexity, runOrchestration } = await import("./orchestrator.js");

        console.log(chalk.dim("\n  Analyzing task complexity..."));
        logger.info("Running complexity classifier");
        const classification = await classifyComplexity(config, input);
        logger.info("Classification result", { isMulti: classification.isMulti, reason: classification.reason, storyCount: classification.stories?.length });

        if (classification.isMulti && classification.stories && classification.stories.length > 1) {
          console.log();
          console.log(chalk.bold("  This task needs multiple experts:"));
          console.log();
          classification.stories.forEach((s, i) => {
            const persona = s.persona.replace(/_/g, " ");
            console.log(chalk.white(`    ${i + 1}. ${chalk.cyan(persona)} — ${s.title}`));
          });
          console.log();

          let answer = "n";
          try {
            answer = await permissions.askUser(chalk.dim("  Run this plan? (y/n): "));
          } catch {
            // readline closed (piped input) — default to single agent
          }

          if (answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes") {
            await runOrchestration(config, classification.stories, trustAll);
            processing = false;
            rl.resume();
            rl.prompt();
            return;
          }
          console.log(chalk.dim("  OK, handling as single agent.\n"));
        } else {
          console.log(chalk.dim(`  → single agent (${classification.reason})\n`));
        }
      }

      logger.info("Starting streamText", { model: modelName, messageCount: session.messages.length });
      const thinkingSpinner = ora({ text: chalk.dim("Thinking..."), prefixText: " " }).start();

      currentAbortController = new AbortController();
      const timeoutId = setTimeout(() => currentAbortController?.abort(), 10 * 60 * 1000);
      agentState = "streaming";

      const stream = streamText({
        model,
        system: systemPrompt,
        messages: session.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        tools: getActiveTools() as ToolSet,
        stopWhen: stepCountIs(100),
        abortSignal: currentAbortController.signal,
      });

      let fullText = "";
      let spinnerStopped = false;

      for await (const chunk of stream.textStream) {
        if (!spinnerStopped) {
          thinkingSpinner.stop();
          spinnerStopped = true;
          process.stdout.write("\n");
        }
        process.stdout.write(chalk.white(chunk));
        fullText += chunk;
      }

      clearTimeout(timeoutId);
      agentState = "idle";
      currentAbortController = null;

      if (!spinnerStopped) {
        thinkingSpinner.stop();
      }

      if (fullText.trim()) {
        process.stdout.write("\n");
      }

      const usage = await stream.totalUsage;
      const tokens = (usage?.inputTokens || 0) + (usage?.outputTokens || 0);
      session.totalTokens += tokens;
      costTracker.addUsage("agent", provider, modelName, usage?.inputTokens || 0, usage?.outputTokens || 0);

      // Store assistant response
      const finalText = await stream.text;
      logger.info("Response complete", { tokens, textLength: finalText.length });
      addMessage(session, "assistant", finalText);

      // Auto-save session after each exchange
      saveSession(session);

      // Check for auto-compaction
      const compactionLevel = shouldCompact(session.totalTokens, modelName);
      if (compactionLevel !== "none") {
        const spinner = ora({ text: `Compacting conversation (${compactionLevel})...`, prefixText: "  " }).start();
        const plainMessages = session.messages.map(m => ({ role: m.role, content: m.content }));
        const compacted = await compactMessages(model, plainMessages, compactionLevel);
        // Rebuild session messages with timestamps
        session.messages = compacted.map(m => ({
          role: m.role,
          content: m.content,
          timestamp: new Date().toISOString(),
        }));
        saveSession(session);
        spinner.succeed("Conversation compacted");
      }

      console.log();
      printStatusBar(provider, modelName, session.totalTokens, planMode ? "PLAN" : (trustAll ? "trust all" : "ask"), costTracker.getTotalCost());
      console.log();
    } catch (err) {
      agentState = "idle";
      currentAbortController = null;
      if (err instanceof Error && err.name === "AbortError") {
        // Already handled by SIGINT handler
      } else {
        logger.error("Agent error", { error: err instanceof Error ? err.message : String(err) });
        printError(err instanceof Error ? err.message : String(err));
      }
    }

    processing = false;
    rl.resume();
    rl.prompt();
    })(); // end async IIFE
  }

  rl.on("line", (input: string) => {
    // Triple backtick multiline mode
    if (input.trim() === "```" && !multilineBacktick && !multilineBackslash) {
      multilineBacktick = true;
      multilineBuffer = [];
      process.stdout.write(chalk.dim("  ... "));
      return;
    }
    if (input.trim() === "```" && multilineBacktick) {
      multilineBacktick = false;
      const fullInput = multilineBuffer.join("\n");
      multilineBuffer = [];
      if (!fullInput.trim() || processing) {
        rl.prompt();
        return;
      }
      processInput(fullInput);
      return;
    }
    if (multilineBacktick) {
      multilineBuffer.push(input);
      process.stdout.write(chalk.dim("  ... "));
      return;
    }

    // Backslash continuation: \ as very last char (no trailing whitespace)
    if (input.endsWith("\\") && !input.endsWith("\\\\")) {
      if (!multilineBackslash) {
        multilineBackslash = true;
        multilineBuffer = [input.slice(0, -1)];
      } else {
        multilineBuffer.push(input.slice(0, -1));
      }
      process.stdout.write(chalk.dim("  ... "));
      return;
    }
    if (multilineBackslash) {
      // This line doesn't end with \ — it's the final line
      multilineBackslash = false;
      multilineBuffer.push(input);
      const fullInput = multilineBuffer.join("\n");
      multilineBuffer = [];
      if (!fullInput.trim() || processing) {
        rl.prompt();
        return;
      }
      processInput(fullInput);
      return;
    }

    const trimmed = input.trim();
    if (!trimmed || processing) {
      if (!processing) rl.prompt();
      return;
    }

    // ! prefix for direct bash execution
    if (trimmed.startsWith("!")) {
      const cmd = trimmed.slice(1).trim();
      if (cmd) {
        try {
          const output = execSync(cmd, { cwd: workingDir, encoding: "utf-8", timeout: 30000 });
          if (output.trim()) console.log(output);
        } catch (err: any) {
          console.log(chalk.red(err.stderr || err.message));
        }
      }
      rl.prompt();
      return;
    }

    // Handle slash commands
    if (trimmed.startsWith("/")) {
      processing = true;
      rl.pause();
      handleSlashCommand(trimmed, cmdCtx).then(() => {
        processing = false;
        rl.resume();
        rl.prompt();
      });
      return;
    }

    processInput(trimmed);
  });

  rl.on("close", () => {
    logger.info("Session ended", { totalTokens: session.totalTokens, messages: session.messages.length });
    logger.flush();
    // Don't exit immediately if we're still processing a request
    if (processing) {
      const checkDone = setInterval(() => {
        if (!processing) {
          clearInterval(checkDone);
          saveSession(session);
          console.log(chalk.dim("\n  Goodbye!\n"));
          process.exit(0);
        }
      }, 500);
    } else {
      saveSession(session);
      console.log(chalk.dim("\n  Goodbye!\n"));
      process.exit(0);
    }
  });
}

