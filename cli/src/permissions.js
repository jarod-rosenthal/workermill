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
function isDangerous(command) {
    for (const { pattern, label } of DANGEROUS_PATTERNS) {
        if (pattern.test(command))
            return label;
    }
    return null;
}
export class PermissionManager {
    sessionAllow = new Set();
    trustAll;
    configTrust;
    rl = null;
    cancelCurrentPrompt = null;
    /** True while rl.question() is active — external line handlers must ignore input */
    questionActive = false;
    constructor(trustAll = false, configTrust = []) {
        this.trustAll = trustAll;
        this.configTrust = new Set(configTrust);
    }
    /** Bind to the agent's readline instance so we reuse it for prompts */
    setReadline(rl) {
        this.rl = rl;
    }
    cancelPrompt() {
        if (this.cancelCurrentPrompt) {
            this.cancelCurrentPrompt();
            this.cancelCurrentPrompt = null;
        }
    }
    async checkPermission(toolName, toolInput) {
        // Dangerous command check
        if (toolName === "bash") {
            const cmd = String(toolInput.command || "");
            const danger = isDangerous(cmd);
            if (danger) {
                // Trust mode: allow silently — matches worker behavior
                if (this.trustAll)
                    return true;
                console.log();
                console.log(chalk.red.bold(`  ⚠ DANGEROUS: ${danger}`));
                console.log(chalk.red(`  Command: ${cmd}`));
                const answer = await this.askUser(chalk.red("  Are you sure? (yes to confirm): "));
                if (answer.trim().toLowerCase() !== "yes")
                    return false;
                return true;
            }
        }
        if (this.trustAll)
            return true;
        if (READ_TOOLS.has(toolName))
            return true;
        if (this.sessionAllow.has(toolName))
            return true;
        if (this.configTrust.has(toolName))
            return true;
        return this.promptUser(toolName, toolInput);
    }
    async promptUser(toolName, toolInput) {
        const display = this.formatToolCall(toolName, toolInput);
        console.log();
        console.log(chalk.cyan(`  ┌─ ${toolName} ${"─".repeat(Math.max(0, 40 - toolName.length))}┐`));
        for (const line of display.split("\n")) {
            console.log(chalk.cyan("  │ ") + chalk.white(line));
        }
        console.log(chalk.cyan(`  └${"─".repeat(43)}┘`));
        const answer = await this.askUser(chalk.dim("  Allow? ") + chalk.white("(y)es / (n)o / (a)lways this tool / (t)rust all: "));
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
     * Prompt the user with a question. Sets questionActive flag so the
     * agent's line handler knows to ignore this input.
     */
    askUser(prompt) {
        return new Promise((resolve, reject) => {
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
                    this.rl.pause();
                    resolve(answer);
                });
            }
            else {
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
    formatToolCall(toolName, input) {
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
