import readline from "readline";
import chalk from "chalk";
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

interface AgentSession {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  totalTokens: number;
  totalCost: number;
}

export async function runAgent(config: CliConfig, trustAll: boolean): Promise<void> {
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

  const session: AgentSession = {
    messages: [],
    totalTokens: 0,
    totalCost: 0,
  };

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
      session.messages.push({ role: "user", content: trimmed });

      const stream = streamText({
        model,
        system: systemPrompt,
        messages: session.messages.map((m) => ({
          role: m.role as "user" | "assistant",
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
      session.messages.push({ role: "assistant", content: finalText });

      console.log();
      printStatus(provider, modelName, session.totalTokens, session.totalCost);
      console.log();
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
    }

    rl.resume();
    rl.prompt();
  });

  rl.on("close", () => {
    console.log(chalk.dim("\n  Goodbye!\n"));
    process.exit(0);
  });
}

async function handleCommand(
  cmd: string,
  config: CliConfig,
  session: AgentSession
): Promise<void> {
  const parts = cmd.slice(1).split(" ");
  const command = parts[0];

  switch (command) {
    case "help":
      console.log();
      console.log(chalk.bold("  Commands:"));
      console.log(chalk.dim("  /help     ") + "Show this help");
      console.log(chalk.dim("  /clear    ") + "Clear conversation history");
      console.log(chalk.dim("  /status   ") + "Show session status");
      console.log(chalk.dim("  /model    ") + "Show current model");
      console.log(chalk.dim("  /quit     ") + "Exit");
      console.log();
      break;
    case "clear":
      session.messages = [];
      console.log(chalk.green("\n  ✓ Conversation cleared\n"));
      break;
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
