import readline from "readline";
import chalk from "chalk";

const READ_TOOLS = new Set(["read_file", "glob", "grep", "ls", "sub_agent"]);

export class PermissionManager {
  private sessionAllow = new Set<string>();
  private trustAll: boolean;
  private configTrust: Set<string>;
  private rl: readline.Interface | null = null;

  constructor(trustAll = false, configTrust: string[] = []) {
    this.trustAll = trustAll;
    this.configTrust = new Set(configTrust);
  }

  /** Bind to the agent's readline instance so we reuse it for prompts */
  setReadline(rl: readline.Interface): void {
    this.rl = rl;
  }

  async checkPermission(
    toolName: string,
    toolInput: Record<string, unknown>
  ): Promise<boolean> {
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

  /** Prompt using the shared readline, or create a temporary one if none bound */
  askUser(prompt: string): Promise<string> {
    return new Promise<string>((resolve) => {
      if (this.rl) {
        // Temporarily resume the shared readline for this question
        this.rl.resume();
        this.rl.question(prompt, (answer) => {
          this.rl!.pause();
          resolve(answer);
        });
      } else {
        // Fallback: create a temporary readline (shouldn't happen in normal flow)
        const tempRl = readline.createInterface({ input: process.stdin, output: process.stdout });
        tempRl.question(prompt, (answer) => {
          tempRl.close();
          resolve(answer);
        });
      }
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
