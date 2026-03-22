import chalk from "chalk";

function highlightCode(code: string, language: string): string {
  // Highlight strings (both single and double quoted)
  code = code.replace(/(["'`])(?:(?=(\\?))\2.)*?\1/g, (match) => chalk.green(match));

  // Highlight comments
  code = code.replace(/(\/\/.*$)/gm, (match) => chalk.dim(match));
  code = code.replace(/(\/\*[\s\S]*?\*\/)/g, (match) => chalk.dim(match));
  code = code.replace(/(#.*$)/gm, (match) => chalk.dim(match));

  // Highlight keywords (JS/TS/Python common)
  const keywords = /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|this|def|self|yield|with|as)\b/g;
  code = code.replace(keywords, (match) => chalk.magenta(match));

  // Highlight types/builtins
  const types = /\b(string|number|boolean|void|null|undefined|true|false|none|True|False|None|int|float|dict|list|Promise|Array|Object|Map|Set)\b/g;
  code = code.replace(types, (match) => chalk.yellow(match));

  return code;
}

export function printHeader(version: string): void {
  console.log();
  console.log(chalk.bold.cyan("  ╦ ╦┌─┐┬─┐┬┌─┌─┐┬─┐╔╦╗┬┬  ┬  "));
  console.log(chalk.bold.cyan("  ║║║│ │├┬┘├┴┐├┤ ├┬┘║║║││  │  "));
  console.log(chalk.bold.cyan("  ╚╩╝└─┘┴└─┴ ┴└─┘┴└─╩ ╩┴┴─┘┴─┘"));
  console.log(chalk.dim(`  v${version} — AI coding agent`));
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
      if (toolInput.old_string && toolInput.new_string) {
        const oldLines = String(toolInput.old_string).split("\n");
        const newLines = String(toolInput.new_string).split("\n");
        for (const line of oldLines.slice(0, 10)) {
          console.log(chalk.red("  - " + line));
        }
        if (oldLines.length > 10) console.log(chalk.red(`  ... (${oldLines.length - 10} more lines)`));
        for (const line of newLines.slice(0, 10)) {
          console.log(chalk.green("  + " + line));
        }
        if (newLines.length > 10) console.log(chalk.green(`  ... (${newLines.length - 10} more lines)`));
      }
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
  const maxLines = 30;
  const lines = result.split("\n");
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;

  // Color based on tool type
  const isError = result.startsWith("Error:");
  const color = isError ? chalk.red : chalk.dim;

  for (const line of displayLines) {
    // Highlight file paths in results
    const highlighted = line.replace(
      /([a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|py|go|rs|java|md|json|yaml|yml|css|html))/g,
      (match) => chalk.cyan(match)
    );
    console.log(color("  │ ") + highlighted);
  }
  if (truncated) {
    console.log(chalk.dim(`  │ ... (${lines.length - maxLines} more lines)`));
  }
  console.log(chalk.dim("  │"));
}

export function printAgentText(text: string): void {
  if (!text.trim()) return;
  console.log();

  let inCodeBlock = false;
  let codeLanguage = "";
  let codeLines: string[] = [];

  for (const line of text.split("\n")) {
    if (line.startsWith("```") && !inCodeBlock) {
      inCodeBlock = true;
      codeLanguage = line.slice(3).trim();
      codeLines = [];
      console.log(chalk.dim("  ┌─" + (codeLanguage ? ` ${codeLanguage} ` : "") + "─".repeat(Math.max(0, 40 - codeLanguage.length))));
    } else if (line.startsWith("```") && inCodeBlock) {
      inCodeBlock = false;
      const highlighted = highlightCode(codeLines.join("\n"), codeLanguage);
      for (const codeLine of highlighted.split("\n")) {
        console.log(chalk.dim("  │ ") + codeLine);
      }
      console.log(chalk.dim("  └" + "─".repeat(43)));
    } else if (inCodeBlock) {
      codeLines.push(line);
    } else if (line.startsWith("# ")) {
      console.log(chalk.bold.white("\n  " + line.slice(2)));
    } else if (line.startsWith("## ")) {
      console.log(chalk.bold.white("\n  " + line.slice(3)));
    } else if (line.startsWith("### ")) {
      console.log(chalk.bold.dim("\n  " + line.slice(4)));
    } else if (line.startsWith("- ")) {
      console.log(chalk.white("  • " + line.slice(2)));
    } else if (line.startsWith("> ")) {
      console.log(chalk.dim("  ▎ ") + chalk.italic(line.slice(2)));
    } else if (line.match(/^\d+\. /)) {
      console.log(chalk.white("  " + line));
    } else if (line.startsWith("**") && line.endsWith("**")) {
      console.log(chalk.bold.white("  " + line.slice(2, -2)));
    } else {
      console.log(chalk.white("  " + line));
    }
  }

  // Close unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    const highlighted = highlightCode(codeLines.join("\n"), codeLanguage);
    for (const codeLine of highlighted.split("\n")) {
      console.log(chalk.dim("  │ ") + codeLine);
    }
    console.log(chalk.dim("  └" + "─".repeat(43)));
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
