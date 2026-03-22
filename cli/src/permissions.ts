import readline from "readline";
import chalk from "chalk";

const READ_TOOLS = new Set(["read_file", "glob", "grep", "ls", "sub_agent"]);

export class PermissionManager {
  private sessionAllow = new Set<string>();
  private trustAll: boolean;
  private configTrust: Set<string>;

  constructor(trustAll = false, configTrust: string[] = []) {
    this.trustAll = trustAll;
    this.configTrust = new Set(configTrust);
  }

  async checkPermission(
    toolName: string,
    toolInput: Record<string, unknown>
  ): Promise<boolean> {
    // Trust mode — allow everything
    if (this.trustAll) return true;

    // Read tools — always allowed
    if (READ_TOOLS.has(toolName)) return true;

    // Session-level always allow
    if (this.sessionAllow.has(toolName)) return true;

    // Config-level trust
    if (this.configTrust.has(toolName)) return true;

    // Ask the user
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

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question(
        chalk.dim("  Allow? ") + chalk.white("(y)es / (n)o / (a)lways: "),
        resolve
      );
    });
    rl.close();

    const choice = answer.trim().toLowerCase();

    if (choice === "a" || choice === "always") {
      this.sessionAllow.add(toolName);
      return true;
    }

    return choice === "y" || choice === "yes";
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
