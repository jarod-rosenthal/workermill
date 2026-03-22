import readline from "readline";
import chalk from "chalk";
import ora from "ora";
import { streamText, stepCountIs, type ToolSet } from "ai";
import { createModel } from "../../packages/engine/src/model-factory.js";
import { createToolDefinitions } from "../../packages/engine/src/tools/index.js";
import type { AIProvider } from "../../packages/engine/src/types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDef = any;
import { PermissionManager } from "./permissions.js";
import { printToolCall, printToolResult, printError, printStatus } from "./tui.js";
import type { CliConfig } from "./config.js";
import { getProviderForPersona } from "./config.js";
import { createSession, saveSession, addMessage, loadLatestSession, type Session } from "./session.js";
import { shouldCompact, compactMessages } from "./compaction.js";

export async function runAgent(config: CliConfig, trustAll: boolean, resume?: boolean): Promise<void> {
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

  // Wrap tools with permission checks
  const permissionedTools: Record<string, AnyToolDef> = {};
  for (const [name, toolDef] of Object.entries(tools)) {
    const td = toolDef as AnyToolDef;
    permissionedTools[name] = {
      ...td,
      execute: async (input: Record<string, unknown>) => {
        const allowed = await permissions.checkPermission(name, input);
        if (!allowed) {
          return "Tool execution denied by user.";
        }
        printToolCall(name, input);
        const result = await td.execute(input);
        const resultStr = typeof result === "string" ? result : JSON.stringify(result);
        printToolResult(name, resultStr);
        return result;
      },
    };
  }

  console.log(chalk.dim(`  Provider: ${provider}/${modelName}`));
  console.log(chalk.dim(`  Working directory: ${workingDir}`));
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("  > "),
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
- Use glob and grep to find relevant files before reading them`;

  rl.prompt();

  rl.on("line", async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Handle slash commands
    if (trimmed.startsWith("/")) {
      await handleCommand(trimmed, config, session);
      rl.prompt();
      return;
    }

    // Pause readline during agent execution
    rl.pause();

    try {
      addMessage(session, "user", trimmed);

      // Check if task warrants multi-expert mode
      if (session.messages.length <= 1) {
        const { classifyComplexity, runOrchestration } = await import("./orchestrator.js");

        const spinner = ora({ text: "Analyzing task complexity...", prefixText: "  " }).start();
        const classification = await classifyComplexity(config, trimmed);
        spinner.stop();

        if (classification.isMulti && classification.stories && classification.stories.length > 1) {
          console.log();
          console.log(chalk.bold("  This looks like it needs multiple experts:"));
          console.log();
          classification.stories.forEach((s, i) => {
            const persona = s.persona.replace(/_/g, " ");
            console.log(chalk.white(`    ${i + 1}. ${chalk.cyan(persona)} — ${s.title}`));
          });
          console.log();

          const rlTemp = readline.createInterface({ input: process.stdin, output: process.stdout });
          const answer = await new Promise<string>((resolve) => {
            rlTemp.question(chalk.dim("  Run this plan? (y/n): "), resolve);
          });
          rlTemp.close();

          if (answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes") {
            await runOrchestration(config, classification.stories, trustAll);
            rl.resume();
            rl.prompt();
            return;
          }
          console.log(chalk.dim("  OK, handling as single agent."));
          console.log();
        }
      }

      const stream = streamText({
        model,
        system: systemPrompt,
        messages: session.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        tools: permissionedTools as ToolSet,
        stopWhen: stepCountIs(100),
        abortSignal: AbortSignal.timeout(10 * 60 * 1000),
      });

      let fullText = "";
      process.stdout.write("\n");

      for await (const chunk of stream.textStream) {
        process.stdout.write(chalk.white(chunk));
        fullText += chunk;
      }

      if (fullText.trim()) {
        process.stdout.write("\n");
      }

      const usage = await stream.totalUsage;
      const tokens = (usage?.inputTokens || 0) + (usage?.outputTokens || 0);
      session.totalTokens += tokens;

      // Store assistant response
      const finalText = await stream.text;
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
      printStatus(provider, modelName, session.totalTokens, 0);
      console.log();
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
    }

    rl.resume();
    rl.prompt();
  });

  rl.on("close", () => {
    saveSession(session);
    console.log(chalk.dim("\n  Goodbye!\n"));
    process.exit(0);
  });
}

async function handleCommand(
  cmd: string,
  config: CliConfig,
  session: Session
): Promise<void> {
  const parts = cmd.slice(1).split(" ");
  const command = parts[0];

  switch (command) {
    case "help":
      console.log();
      console.log(chalk.bold("  Commands:"));
      console.log(chalk.dim("  /help     ") + "Show this help");
      console.log(chalk.dim("  /clear    ") + "Clear conversation history");
      console.log(chalk.dim("  /compact  ") + "Manually compact conversation history");
      console.log(chalk.dim("  /status   ") + "Show session status");
      console.log(chalk.dim("  /model    ") + "Show current model");
      console.log(chalk.dim("  /quit     ") + "Exit");
      console.log();
      break;
    case "clear":
      session.messages = [];
      saveSession(session);
      console.log(chalk.green("\n  Conversation cleared\n"));
      break;
    case "compact": {
      const { provider: cProvider, model: cModelName, host: cHost } = getProviderForPersona(config);
      const cModel = createModel(cProvider as AIProvider, cModelName, cHost);
      const plainMessages = session.messages.map(m => ({ role: m.role, content: m.content }));
      if (plainMessages.length <= 4) {
        console.log(chalk.dim("\n  Not enough messages to compact.\n"));
        break;
      }
      const spinner = ora({ text: "Compacting conversation...", prefixText: "  " }).start();
      const compacted = await compactMessages(cModel, plainMessages, "soft");
      session.messages = compacted.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: new Date().toISOString(),
      }));
      saveSession(session);
      spinner.succeed(`Compacted to ${session.messages.length} messages`);
      console.log();
      break;
    }
    case "status":
      console.log();
      console.log(chalk.bold("  Session Status:"));
      console.log(chalk.dim("  Messages: ") + session.messages.length);
      console.log(chalk.dim("  Tokens: ") + session.totalTokens.toLocaleString());
      console.log();
      break;
    case "model": {
      const { provider, model } = getProviderForPersona(config);
      console.log(chalk.dim(`\n  ${provider}/${model}\n`));
      break;
    }
    case "quit":
    case "exit":
      console.log(chalk.dim("\n  Goodbye!\n"));
      process.exit(0);
      break;
    default:
      console.log(chalk.yellow(`\n  Unknown command: /${command}. Type /help for available commands.\n`));
  }
}
