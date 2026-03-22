import chalk from "chalk";

export function printHeader(version: string): void {
  console.log();
  console.log(chalk.bold.white("  WorkerMill") + chalk.dim(` v${version}`));
  console.log(chalk.dim("  AI coding agent with multi-expert orchestration"));
  console.log(chalk.dim("  Type /help for commands, Ctrl+C to exit"));
  console.log();
}

export function printToolCall(toolName: string, toolInput: Record<string, unknown>): void {
  const icon = getToolIcon(toolName);
  console.log();
  console.log(chalk.cyan(`  ${icon} ${toolName}`));

  switch (toolName) {
    case "bash":
      console.log(chalk.dim("  $ ") + chalk.white(String(toolInput.command || "")));
      break;
    case "read_file":
      console.log(chalk.dim("  → ") + chalk.white(String(toolInput.path || "")));
      break;
    case "write_file":
      console.log(chalk.dim("  → ") + chalk.white(String(toolInput.path || "")));
      break;
    case "edit_file":
      console.log(chalk.dim("  → ") + chalk.white(String(toolInput.path || "")));
      break;
    case "glob":
      console.log(chalk.dim("  → ") + chalk.white(String(toolInput.pattern || "")));
      break;
    case "grep":
      console.log(chalk.dim("  → ") + chalk.white(String(toolInput.pattern || "")));
      break;
    case "ls":
      console.log(chalk.dim("  → ") + chalk.white(String(toolInput.path || "")));
      break;
    case "fetch":
      console.log(chalk.dim("  → ") + chalk.white(String(toolInput.url || "")));
      break;
    case "patch": {
      const lines = String(toolInput.patch_text || "").split("\n").slice(0, 5);
      for (const line of lines) {
        if (line.startsWith("+")) console.log(chalk.green("  " + line));
        else if (line.startsWith("-")) console.log(chalk.red("  " + line));
        else console.log(chalk.dim("  " + line));
      }
      break;
    }
    case "sub_agent":
      console.log(chalk.dim("  → ") + chalk.white(String(toolInput.prompt || "").slice(0, 100)));
      break;
    default:
      console.log(chalk.dim("  " + JSON.stringify(toolInput).slice(0, 100)));
  }
}

export function printToolResult(toolName: string, result: string): void {
  // Truncate long results
  const maxLines = 20;
  const lines = result.split("\n");
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;

  for (const line of displayLines) {
    console.log(chalk.dim("  │ ") + line);
  }
  if (truncated) {
    console.log(chalk.dim(`  │ ... (${lines.length - maxLines} more lines)`));
  }
}

export function printAgentText(text: string): void {
  if (!text.trim()) return;
  console.log();
  // Simple markdown-ish rendering
  for (const line of text.split("\n")) {
    if (line.startsWith("# ")) {
      console.log(chalk.bold.white("  " + line.slice(2)));
    } else if (line.startsWith("## ")) {
      console.log(chalk.bold.white("  " + line.slice(3)));
    } else if (line.startsWith("```")) {
      console.log(chalk.dim("  " + line));
    } else if (line.startsWith("- ")) {
      console.log(chalk.white("  " + line));
    } else {
      console.log(chalk.white("  " + line));
    }
  }
}

export function printError(message: string): void {
  console.log(chalk.red(`\n  ✗ ${message}\n`));
}

export function printSuccess(message: string): void {
  console.log(chalk.green(`\n  ✓ ${message}\n`));
}

export function printStatus(provider: string, model: string, tokens: number, cost: number): void {
  const costStr = cost > 0 ? ` | $${cost.toFixed(4)}` : "";
  console.log(chalk.dim(`  ${provider}/${model} | ${tokens.toLocaleString()} tokens${costStr}`));
}

function getToolIcon(toolName: string): string {
  const icons: Record<string, string> = {
    bash: "⚡",
    read_file: "📄",
    write_file: "✏️",
    edit_file: "✏️",
    glob: "🔍",
    grep: "🔎",
    ls: "📁",
    fetch: "🌐",
    patch: "🩹",
    sub_agent: "🤖",
  };
  return icons[toolName] || "🔧";
}
