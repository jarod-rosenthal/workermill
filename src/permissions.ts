import readline from "readline";
import chalk from "chalk";
import { isDangerous, READ_TOOLS } from "./safety.js";

export class PermissionManager {
  private sessionAllow = new Set<string>();
  private trustAll: boolean;
  private configTrust: Set<string>;
  private rl: readline.Interface | null = null;
  private cancelCurrentPrompt: (() => void) | null = null;
  /** True while rl.question() is active — external line handlers must ignore input */
  questionActive = false;

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
    if (toolName === "bash" || toolName === "bash_background") {
      const cmd = String(toolInput.command || "");
      const danger = isDangerous(cmd);
      if (danger) {
        // Trust mode: allow silently — matches worker behavior
        if (this.trustAll) return true;
        console.log();
        console.log(chalk.red.bold(`  ⚠ DANGEROUS: ${danger}`));
        console.log(chalk.red(`  Command: ${cmd}`));
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
      chalk.dim("  Allow? ") + chalk.white("(y)es / (a) yes, don't ask again / (n)o: ")
    );

    const choice = answer.trim().toLowerCase();

    if (choice === "a" || choice === "always") {
      this.sessionAllow.add(toolName);
      return true;
    }

    return choice === "y" || choice === "yes";
  }

  /**
   * Prompt the user with a question. Sets questionActive flag so the
   * agent's line handler knows to ignore this input.
   */
  askUser(prompt: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.cancelCurrentPrompt = () => {
        this.questionActive = false;
        reject(new Error("cancelled"));
      };

      if (this.rl) {
        this.questionActive = true;
        this.rl.resume();
        this.rl.question(prompt, (answer) => {
          this.questionActive = false;
          this.cancelCurrentPrompt = null;
          this.rl!.pause();
          resolve(answer);
        });
      } else {
        const questionRl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        this.questionActive = true;
        questionRl.question(prompt, (answer) => {
          this.questionActive = false;
          this.cancelCurrentPrompt = null;
          questionRl.close();
          resolve(answer);
        });
      }
    });
  }

  private formatToolCall(toolName: string, input: Record<string, unknown>): string {
    switch (toolName) {
      case "bash":
      case "bash_background":
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
