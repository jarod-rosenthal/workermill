import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { createModel } from "./engine/model-factory.js";
import type { AIProvider } from "./engine/types.js";
import { compactMessages } from "./compaction.js";
import { getProviderForPersona, type CliConfig } from "./config.js";
import { CostTracker } from "./cost-tracker.js";
import { saveSession, listSessions, loadSessionById, deleteSession, type Session } from "./session.js";

export interface CommandContext {
  config: CliConfig;
  session: Session;
  costTracker: CostTracker;
  workingDir: string;
  planMode: boolean;
  setPlanMode: (mode: boolean) => void;
  processInput: (input: string) => void;
}

export async function handleCommand(
  cmd: string,
  ctx: CommandContext,
): Promise<void> {
  const parts = cmd.slice(1).split(" ");
  const command = parts[0];

  switch (command) {
    case "help":
      console.log();
      console.log(chalk.bold("  Commands:"));
      console.log(chalk.dim("  /help      ") + "Show this help");
      console.log(chalk.dim("  /clear     ") + "Clear conversation history");
      console.log(chalk.dim("  /compact   ") + "Manually compact conversation");
      console.log(chalk.dim("  /status    ") + "Show session status");
      console.log(chalk.dim("  /model     ") + "Show current model");
      console.log(chalk.dim("  /cost      ") + "Show token cost breakdown");
      console.log(chalk.dim("  /git       ") + "Show git status");
      console.log(chalk.dim("  /sessions  ") + "List/switch sessions");
      console.log(chalk.dim("  /edit      ") + "Open $EDITOR for input");
      console.log(chalk.dim("  /plan      ") + "Toggle plan mode (read-only)");
      console.log(chalk.dim("  /quit      ") + "Exit");
      console.log();
      console.log(chalk.dim("  Prefix ! for bash: ") + chalk.white("!git status"));
      console.log(chalk.dim("  Multiline: ``` to start/end, or \\ at end of line"));
      console.log();
      break;

    case "clear":
      ctx.session.messages = [];
      saveSession(ctx.session);
      console.log(chalk.green("\n  Conversation cleared\n"));
      break;

    case "compact": {
      const { provider, model: modelName, host } = getProviderForPersona(ctx.config);
      const model = createModel(provider as AIProvider, modelName, host);
      const plainMessages = ctx.session.messages.map(m => ({ role: m.role, content: m.content }));
      if (plainMessages.length <= 4) {
        console.log(chalk.dim("\n  Not enough messages to compact.\n"));
        break;
      }
      const spinner = ora({ stream: process.stdout, text: "Compacting conversation...", prefixText: "  " }).start();
      const compacted = await compactMessages(model, plainMessages, "soft");
      ctx.session.messages = compacted.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: new Date().toISOString(),
      }));
      saveSession(ctx.session);
      spinner.succeed(`Compacted to ${ctx.session.messages.length} messages`);
      console.log();
      break;
    }

    case "status":
      console.log();
      console.log(chalk.bold("  Session Status:"));
      console.log(chalk.dim("  Messages: ") + ctx.session.messages.length);
      console.log(chalk.dim("  Tokens: ") + ctx.session.totalTokens.toLocaleString());
      console.log(chalk.dim("  Cost (est.): ") + `~$${ctx.costTracker.getTotalCost().toFixed(2)}`);
      console.log(chalk.dim("  Mode: ") + (ctx.planMode ? chalk.cyan("PLAN (read-only)") : "normal"));
      console.log();
      break;

    case "model": {
      const { provider, model } = getProviderForPersona(ctx.config);
      console.log(chalk.dim(`\n  ${provider}/${model}\n`));
      break;
    }

    case "cost":
      console.log(chalk.dim(`\n  ${ctx.costTracker.getSummary()}\n`));
      break;

    case "git": {
      try {
        const status = execSync("git status --short", { cwd: ctx.workingDir, encoding: "utf-8" });
        const branch = execSync("git branch --show-current", { cwd: ctx.workingDir, encoding: "utf-8" }).trim();
        console.log(chalk.dim(`\n  Branch: `) + chalk.white(branch));
        if (status.trim()) {
          console.log(chalk.dim("  Changes:"));
          for (const line of status.trim().split("\n")) {
            console.log(chalk.dim(`    ${line}`));
          }
        } else {
          console.log(chalk.dim("  Working tree clean"));
        }
        console.log();
      } catch {
        console.log(chalk.dim("\n  Not a git repository.\n"));
      }
      break;
    }

    case "sessions": {
      const args = parts.slice(1).join(" ").trim();

      if (args.startsWith("delete ")) {
        const deleteId = args.slice(7).trim();
        if (deleteSession(deleteId)) {
          console.log(chalk.green(`\n  Session ${deleteId.slice(0, 8)} deleted.\n`));
        } else {
          console.log(chalk.red(`\n  Session not found: ${deleteId}\n`));
        }
        break;
      }

      if (args) {
        // Resume specific session by ID or index
        const targetId = args;
        let loaded = loadSessionById(targetId);
        if (!loaded) {
          const sessions = listSessions();
          const idx = parseInt(targetId, 10) - 1;
          if (idx >= 0 && idx < sessions.length) {
            loaded = loadSessionById(sessions[idx].id);
          }
        }
        if (loaded) {
          Object.assign(ctx.session, loaded);
          console.log(chalk.green(`\n  Switched to session ${loaded.id.slice(0, 8)} (${loaded.messages.length} messages)\n`));
        } else {
          console.log(chalk.red(`\n  Session not found: ${targetId}\n`));
        }
        break;
      }

      // List sessions
      const sessions = listSessions();
      if (sessions.length === 0) {
        console.log(chalk.dim("\n  No saved sessions.\n"));
        break;
      }
      console.log(chalk.bold("\n  Recent Sessions:"));
      sessions.forEach((s, i) => {
        const date = new Date(s.startedAt).toLocaleDateString();
        const current = s.id === ctx.session.id ? chalk.green(" <- current") : "";
        console.log(
          chalk.dim(`  ${i + 1}. `) +
          chalk.white(`${s.name || s.preview}`) +
          chalk.dim(` (${s.messageCount} msgs, ${date})`) +
          current
        );
      });
      console.log(chalk.dim(`\n  Use /sessions <n> to switch, /sessions delete <id> to delete.\n`));
      break;
    }

    case "edit": {
      const editor = process.env.EDITOR || process.env.VISUAL || "vi";
      const tmpFile = path.join(os.tmpdir(), `workermill-${Date.now()}.md`);
      fs.writeFileSync(tmpFile, "", "utf-8");
      try {
        execSync(`${editor} ${tmpFile}`, { stdio: "inherit" });
        const content = fs.readFileSync(tmpFile, "utf-8").trim();
        fs.unlinkSync(tmpFile);
        if (content) {
          ctx.processInput(content);
        } else {
          console.log(chalk.dim("\n  Empty input, cancelled.\n"));
        }
      } catch {
        console.log(chalk.red("\n  Editor failed.\n"));
      }
      break;
    }

    case "plan": {
      const arg = parts[1];
      if (arg === "off" || ctx.planMode) {
        ctx.setPlanMode(false);
        console.log(chalk.green("\n  Plan mode off. Full tools available.\n"));
      } else {
        ctx.setPlanMode(true);
        console.log(chalk.cyan("\n  [PLAN MODE] Read-only tools only. Use /plan off to exit.\n"));
      }
      break;
    }

    case "quit":
    case "exit": {
      console.log(chalk.dim("  Goodbye!"));
      process.exit(0);
      break;
    }

    default:
      console.log(chalk.yellow(`\n  Unknown command: /${command}. Type /help for available commands.\n`));
  }
}
