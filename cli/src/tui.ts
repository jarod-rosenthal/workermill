import chalk from "chalk";

// Track tool usage counts for status bar
const toolCounts: Record<string, number> = {};

export function incrementToolCount(toolName: string): void {
  toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;
}

export function printHeader(version: string, provider?: string, model?: string, cwd?: string): void {
  // Clear screen
  process.stdout.write("\x1b[2J\x1b[H");

  const width = process.stdout.columns || 80;

  // Top bar
  const title = ` WorkerMill v${version} `;
  const bar = "─".repeat(Math.max(0, width - title.length - 2));
  console.log(chalk.cyan("╭" + "─".repeat(title.length) + bar + "╮"));
  console.log(chalk.cyan("│") + chalk.bold.white(title) + chalk.dim(bar.replace(/./g, " ")) + chalk.cyan("│"));
  console.log(chalk.cyan("╰" + "─".repeat(title.length) + bar + "╯"));
  console.log();

  if (provider && model) {
    console.log(chalk.dim(`  Provider: `) + chalk.white(`${provider}/${model}`));
  }
  if (cwd) {
    console.log(chalk.dim(`  cwd: `) + chalk.white(cwd));
  }
  console.log(chalk.dim(`  Type `) + chalk.white("/help") + chalk.dim(` for commands, `) + chalk.white("Ctrl+C") + chalk.dim(` to exit`));
  console.log();
}

export function printToolCall(toolName: string, toolInput: Record<string, unknown>): void {
  incrementToolCount(toolName);

  switch (toolName) {
    case "bash":
      console.log(chalk.dim(`\n  > `) + chalk.yellow(String(toolInput.command || "")));
      break;

    case "read_file":
      console.log(chalk.dim(`\n  ● Read `) + chalk.white(String(toolInput.path || "")));
      break;

    case "write_file":
      console.log(chalk.dim(`\n  ● Write `) + chalk.white(String(toolInput.path || "")));
      break;

    case "edit_file": {
      const filePath = String(toolInput.path || "");
      console.log(chalk.dim(`\n  ● Edit `) + chalk.white(filePath));
      // Show diff
      if (toolInput.old_string && toolInput.new_string) {
        const oldLines = String(toolInput.old_string).split("\n");
        const newLines = String(toolInput.new_string).split("\n");
        const maxShow = 8;
        for (const line of oldLines.slice(0, maxShow)) {
          console.log(chalk.red(`    - ${line}`));
        }
        if (oldLines.length > maxShow) console.log(chalk.red(`    ... +${oldLines.length - maxShow} lines`));
        for (const line of newLines.slice(0, maxShow)) {
          console.log(chalk.green(`    + ${line}`));
        }
        if (newLines.length > maxShow) console.log(chalk.green(`    ... +${newLines.length - maxShow} lines`));
      }
      break;
    }

    case "patch": {
      console.log(chalk.dim(`\n  ● Patch `) + chalk.white("(multi-file)"));
      const patchLines = String(toolInput.patch_text || "").split("\n").slice(0, 10);
      for (const line of patchLines) {
        if (line.startsWith("+++") || line.startsWith("---")) {
          console.log(chalk.bold(`    ${line}`));
        } else if (line.startsWith("+")) {
          console.log(chalk.green(`    ${line}`));
        } else if (line.startsWith("-")) {
          console.log(chalk.red(`    ${line}`));
        } else if (line.startsWith("@@")) {
          console.log(chalk.cyan(`    ${line}`));
        } else {
          console.log(chalk.dim(`    ${line}`));
        }
      }
      break;
    }

    case "glob":
      console.log(chalk.dim(`\n  ● Glob `) + chalk.white(String(toolInput.pattern || "")));
      break;

    case "grep":
      console.log(chalk.dim(`\n  ● Grep `) + chalk.white(String(toolInput.pattern || "")));
      break;

    case "ls":
      console.log(chalk.dim(`\n  ● List `) + chalk.white(String(toolInput.path || ".")));
      break;

    case "fetch":
      console.log(chalk.dim(`\n  ● Fetch `) + chalk.white(String(toolInput.url || "")));
      break;

    case "sub_agent":
      console.log(chalk.dim(`\n  ● Agent `) + chalk.white(String(toolInput.prompt || "").slice(0, 80)));
      break;

    default:
      console.log(chalk.dim(`\n  ● ${toolName}`));
  }
}

export function printToolResult(toolName: string, result: string): void {
  // Truncate long results
  const maxLines = 25;
  const lines = result.split("\n");
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;

  const isError = result.startsWith("Error:");

  for (const line of displayLines) {
    if (isError) {
      console.log(chalk.red(`    ${line}`));
    } else {
      // Highlight file paths
      const highlighted = line.replace(
        /([a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|py|go|rs|java|md|json|yaml|yml|css|html|sql|sh))/g,
        (match) => chalk.cyan(match)
      );
      console.log(chalk.dim(`    ${highlighted}`));
    }
  }
  if (truncated) {
    console.log(chalk.dim(`    ... ${lines.length - maxLines} more lines`));
  }
}

export function printAgentText(text: string): void {
  if (!text.trim()) return;

  let inCodeBlock = false;
  let codeLanguage = "";
  let codeLines: string[] = [];

  for (const line of text.split("\n")) {
    if (line.startsWith("```") && !inCodeBlock) {
      inCodeBlock = true;
      codeLanguage = line.slice(3).trim();
      codeLines = [];
      continue;
    }

    if (line.startsWith("```") && inCodeBlock) {
      inCodeBlock = false;
      // Print code block
      if (codeLanguage) {
        console.log(chalk.dim(`    ${codeLanguage}`));
      }
      for (const codeLine of codeLines) {
        console.log(chalk.white(`    ${highlightCode(codeLine)}`));
      }
      console.log();
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Markdown rendering
    if (line.startsWith("# ")) {
      console.log(chalk.bold.white(`\n  ${line.slice(2)}`));
    } else if (line.startsWith("## ")) {
      console.log(chalk.bold.white(`\n  ${line.slice(3)}`));
    } else if (line.startsWith("### ")) {
      console.log(chalk.bold.dim(`\n  ${line.slice(4)}`));
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      console.log(chalk.white(`  ${line}`));
    } else if (line.startsWith("> ")) {
      console.log(chalk.dim(`  ${line}`));
    } else if (line.trim() === "") {
      console.log();
    } else {
      // Inline formatting
      let formatted = line;
      formatted = formatted.replace(/\*\*(.*?)\*\*/g, (_, text) => chalk.bold(text));
      formatted = formatted.replace(/`([^`]+)`/g, (_, code) => chalk.cyan(code));
      console.log(chalk.white(`  ${formatted}`));
    }
  }

  // Close unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    for (const codeLine of codeLines) {
      console.log(chalk.white(`    ${highlightCode(codeLine)}`));
    }
  }
}

function highlightCode(line: string): string {
  let result = line;
  // Strings
  result = result.replace(/(["'`])(?:(?=(\\?))\2.)*?\1/g, (m) => chalk.green(m));
  // Comments
  result = result.replace(/(\/\/.*$)/gm, (m) => chalk.dim(m));
  result = result.replace(/(#.*$)/gm, (m) => chalk.dim(m));
  // Keywords
  result = result.replace(
    /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|this|def|self|type|interface)\b/g,
    (m) => chalk.magenta(m)
  );
  // Types
  result = result.replace(
    /\b(string|number|boolean|void|null|undefined|true|false|Promise|Array)\b/g,
    (m) => chalk.yellow(m)
  );
  return result;
}

export function printError(message: string): void {
  console.log(chalk.red(`\n  ✗ ${message}\n`));
}

export function printSuccess(message: string): void {
  console.log(chalk.green(`\n  ✓ ${message}\n`));
}

export function printStatusBar(
  provider: string,
  model: string,
  tokens: number,
  permissionMode: string
): void {
  const width = process.stdout.columns || 80;

  // Build tool counts
  const shortNames: Record<string, string> = {
    bash: "Bash",
    read_file: "Read",
    write_file: "Write",
    edit_file: "Edit",
    glob: "Glob",
    grep: "Grep",
    ls: "List",
    fetch: "Fetch",
    patch: "Patch",
    sub_agent: "Agent",
  };

  const countParts = Object.entries(toolCounts)
    .filter(([_, count]) => count > 0)
    .map(([name, count]) => `${shortNames[name] || name} ${count}`);

  const left = ` ${provider}/${model}`;
  const toolStr = countParts.length > 0 ? " │ " + countParts.join(" │ ") : "";
  const right = `${tokens.toLocaleString()} tok `;
  const permStr = permissionMode ? ` ${permissionMode} ` : "";

  // Calculate padding
  const contentLen = left.length + toolStr.length + right.length + permStr.length + 3;
  const pad = Math.max(1, width - contentLen);

  // Render full-width bar
  const bar =
    chalk.bgRgb(30, 30, 30).white(left) +
    chalk.bgRgb(30, 30, 30).dim(toolStr) +
    chalk.bgRgb(30, 30, 30)(" ".repeat(pad)) +
    chalk.bgRgb(30, 30, 30).white(right) +
    (permissionMode
      ? chalk.bgRgb(30, 30, 30).dim("│ ") + chalk.bgRgb(30, 30, 30).green(permStr)
      : "");

  console.log(bar);
}
