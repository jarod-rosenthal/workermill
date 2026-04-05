import fs from "fs";
import path from "path";
import { getLogPath, parseLogLine } from "./logger.js";

export interface LogsOptions {
  tail?: number;
  follow?: boolean;
  cwd?: string;
  level?: string;
  json?: boolean;
}

export function runLogsCommand(options: LogsOptions): void {
  const logPath = getLogPath(options.cwd);
  if (!fs.existsSync(logPath)) {
    console.error(`No log file found at ${logPath}`);
    process.exit(1);
    return;
  }

  const tailCount = options.follow ? (options.tail ?? 10) : (options.tail ?? 50);
  const levelFilter = options.level?.toUpperCase();
  let lastByteOffset = 0;

  function processLines(content: string, fromOffset = 0): void {
    const lines = content.slice(fromOffset).trim().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = parseLogLine(line);
      if (parsed.raw) {
        if (!options.json) {
          console.log(parsed.raw);
        } else {
          console.log(JSON.stringify(parsed));
        }
        continue;
      }
      if (levelFilter && (parsed as any).level !== levelFilter) continue;
      if (options.json) {
        console.log(JSON.stringify(parsed));
      } else {
        const entry = parsed as any;
        console.log(`[${entry.timestamp}] ${entry.level}: ${entry.message}`);
      }
    }
  }

  if (!options.follow) {
    // Read entire file, show last tailCount lines
    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n").slice(-tailCount);
    processLines(lines.join("\n"));
  } else {
    // Print header
    console.error(`Watching: ${logPath}`);

    // First, print the last tailCount lines
    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n");
    if (lines.length > 0) {
      const tailLines = lines.slice(-tailCount);
      processLines(tailLines.join("\n"));
      lastByteOffset = Buffer.byteLength(tailLines.join("\n") + "\n", "utf-8");
    }

    // Watch for changes
    fs.watchFile(logPath, { interval: 250 }, (curr, prev) => {
      if (curr.mtime > prev.mtime) {
        try {
          const newContent = fs.readFileSync(logPath, "utf-8");
          const newBytes = Buffer.byteLength(newContent, "utf-8");
          if (newBytes > lastByteOffset) {
            const addedContent = newContent.slice(lastByteOffset);
            processLines(addedContent);
            lastByteOffset = newBytes;
          }
        } catch (err) {
          console.error(`Error reading log file: ${(err as Error).message}`);
        }
      }
    });

    // Handle exit
    process.on("SIGINT", () => {
      fs.unwatchFile(logPath);
      process.exit(0);
    });
  }
}