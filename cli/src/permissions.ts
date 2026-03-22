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

    // Read a single keypress directly from stdin to avoid conflicting
    // with the agent's readline instance
    const answer = await new Promise<string>((resolve) => {
      const wasRaw = process.stdin.isRaw;
      process.stdout.write(
        chalk.dim("  Allow? ") + chalk.white("(y)es / (n)o / (a)lways: ")
      );

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      const onData = (buf: Buffer) => {
        const ch = buf.toString();
        process.stdin.removeListener("data", onData);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(wasRaw ?? false);
        }
        process.stdout.write(ch + "\n");
        resolve(ch.trim().toLowerCase());
      };

      process.stdin.on("data", onData);
    });

    if (answer === "a") {
      this.sessionAllow.add(toolName);
      return true;
    }

    return answer === "y";
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
