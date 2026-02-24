/**
 * Logs Command — Live tail of agent logs.
 *
 * Works like `tail -f ~/.workermill/agent.log`.
 * Shows the last N lines then follows new output.
 */

import chalk from "chalk";
import { existsSync, readFileSync, watchFile, statSync, openSync, readSync, closeSync } from "fs";
import { getLogFile } from "../config.js";

export async function logsCommand(options: { lines?: string }): Promise<void> {
  const logFile = getLogFile();

  if (!existsSync(logFile)) {
    console.log(chalk.yellow("No log file found."));
    console.log(chalk.dim(`Expected at: ${logFile}`));
    console.log(chalk.dim("Start the agent with --detach to generate logs."));
    return;
  }

  const tailLines = parseInt(options.lines || "50", 10);

  // Show last N lines
  const content = readFileSync(logFile, "utf-8");
  const lines = content.split("\n");
  const startIdx = Math.max(0, lines.length - tailLines);
  const tail = lines.slice(startIdx).join("\n");

  if (tail.trim()) {
    process.stdout.write(tail);
    if (!tail.endsWith("\n")) process.stdout.write("\n");
  }

  console.log(chalk.dim(`── Following ${logFile} (Ctrl+C to stop) ──`));

  // Follow new output
  let lastSize = statSync(logFile).size;

  watchFile(logFile, { interval: 500 }, () => {
    try {
      const currentSize = statSync(logFile).size;
      if (currentSize < lastSize) {
        // File was rotated — reset to read from beginning of new file
        lastSize = 0;
      }
      if (currentSize <= lastSize) {
        return;
      }

      const fd = openSync(logFile, "r");
      const buffer = Buffer.alloc(currentSize - lastSize);
      readSync(fd, buffer, 0, buffer.length, lastSize);
      closeSync(fd);

      process.stdout.write(buffer.toString());
      lastSize = currentSize;
    } catch {
      // File may have been deleted during rotation — reset
      lastSize = 0;
    }
  });

  // Keep process alive
  await new Promise(() => {});
}
