import readline from "readline";
import chalk from "chalk";

const READ_TOOLS = new Set(["read_file", "glob", "grep", "ls", "sub_agent"]);

const DANGEROUS_PATTERNS = [
  { pattern: /rm\s+(-[a-z]*f|-[a-z]*r|--force|--recursive)/i, label: "recursive/forced delete" },
  { pattern: /git\s+reset\s+--hard/i, label: "hard reset" },
  { pattern: /git\s+push\s+.*--force/i, label: "force push" },
  { pattern: /git\s+clean\s+-[a-z]*f/i, label: "git clean" },
  { pattern: /drop\s+table/i, label: "drop table" },
  { pattern: /truncate\s+/i, label: "truncate" },
  { pattern: /DELETE\s+FROM\s+\w+\s*;/i, label: "DELETE without WHERE" },
  { pattern: /chmod\s+777/i, label: "chmod 777" },
  { pattern: />(\/dev\/sda|\/dev\/disk)/i, label: "write to disk device" },
];

function isDangerous(command: string): string | null {
  for (const { pattern, label } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return label;
  }
  return null;
}

export class PermissionManager {
  private sessionAllow = new Set<string>();
  private trustAll: boolean;
  private configTrust: Set<string>;
  private rl: readline.Interface | null = null;
  private cancelCurrentPrompt: (() => void) | null = null;

  constructor(trustAll = false, configTrust: string[] = []) {
    this.trustAll = trustAll;
    this.configTrust = new Set(configTrust);
  }

  /** Bind to the agent's readline instance so we reuse it for prompts */
  setReadline(rl: readline.Interface): void {
    this.rl = rl;
  }

  cancelPrompt(): void {
    if (this.cancelCurrentPrompt) {
      this.cancelCurrentPrompt();
      this.cancelCurrentPrompt = null;
    }
  }

  async checkPermission(
    toolName: string,
    toolInput: Record<string, unknown>
  ): Promise<boolean> {
    // Dangerous command check
    if (toolName === "bash") {
      const cmd = String(toolInput.command || "");
      const danger = isDangerous(cmd);
      if (danger) {
        console.log();
        console.log(chalk.red.bold(`  ⚠ DANGEROUS: ${danger}`));
        console.log(chalk.red(`  Command: ${cmd}`));
        if (this.trustAll) {
          // In trust mode: warn but allow
          console.log(chalk.yellow("  (allowed by --trust mode)"));
          return true;
        }
        const answer = await this.askUser(chalk.red("  Are you sure? (yes to confirm): "));
        if (answer.trim().toLowerCase() !== "yes") return false;
        return true;
      }
    }

    if (this.trustAll) return true;
    if (READ_TOOLS.has(toolName)) return true;
    if (this.sessionAllow.has(toolName)) return true;
    if (this.configTrust.has(toolName)) return true;
    return this.promptUser(toolName, toolInput);
  }

  private async promptUser(
    toolName: string,
    toolInput: Record<string, unknown>
  ): Promise<boolean> {
    const display = this.formatToolCall(toolName, toolInput);

    console.log();
    console.log(chalk.cyan(`  ┌─ ${toolName} ${"─".repeat(Math.max(0, 40 - toolName.length))}┐`));
    for (const line of display.split("\n")) {
      console.log(chalk.cyan("  │ ") + chalk.white(line));
    }
    console.log(chalk.cyan(`  └${"─".repeat(43)}┘`));

    const answer = await this.askUser(
      chalk.dim("  Allow? ") + chalk.white("(y)es / (n)o / (a)lways this tool / (t)rust all: ")
    );

    const choice = answer.trim().toLowerCase();

    if (choice === "t" || choice === "trust") {
      this.trustAll = true;
      return true;
    }

    if (choice === "a" || choice === "always") {
      this.sessionAllow.add(toolName);
      return true;
    }

    return choice === "y" || choice === "yes";
  }

  /**
   * Prompt the user with a question. Uses a dedicated temporary readline
   * to avoid conflicts with the main agent readline's line event handler.
   */
  askUser(prompt: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.cancelCurrentPrompt = () => {
        reject(new Error("cancelled"));
      };

      // Pause the main readline so it doesn't compete for stdin
      if (this.rl) {
        this.rl.pause();
      }

      // Create a dedicated readline for this question
      const questionRl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      questionRl.question(prompt, (answer) => {
        this.cancelCurrentPrompt = null;
        questionRl.close();
        resolve(answer);
      });
    });
  }

  private formatToolCall(toolName: string, input: Record<string, unknown>): string {
    switch (toolName) {
      case "bash":
        return String(input.command || "");
      case "write_file":
      case "edit_file":
        return `${input.path || ""}`;
      case "patch":
        return String(input.patch_text || "").slice(0, 200) + "...";
      case "fetch":
        return String(input.url || "");
      default:
        return JSON.stringify(input, null, 2).slice(0, 200);
    }
  }
}
