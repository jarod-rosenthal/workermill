import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getStateRoot } from "./state-root.js";
import { getProjectLogPath, ensureProjectDirs } from "./project-data.js";

// Logs stored in project-specific logs/cli.log
const LOG_FILE = getProjectLogPath();
const LOG_DIR = path.dirname(LOG_FILE);

let logStream: fs.WriteStream | null = null;

function migrateLegacyLogs(): void {
  // Old path using raw cwd hash
  const oldHash = crypto.createHash("md5").update(process.cwd()).digest("hex").slice(0, 8);
  const oldLogDir = path.join(getStateRoot(), "logs", oldHash);
  const oldLogFile = path.join(oldLogDir, "cli.log");
  const newLogFile = LOG_FILE;

  if (!fs.existsSync(oldLogFile) || fs.existsSync(newLogFile)) return;

  try {
    // Move old log to new location
    fs.renameSync(oldLogFile, newLogFile);
    // Remove old dir if empty
    try {
      fs.rmdirSync(oldLogDir);
      const parentDir = path.dirname(oldLogDir);
      try { fs.rmdirSync(parentDir); } catch {} // logs dir
    } catch {}
  } catch (err) {
    // If rename fails, try copy
    try {
      fs.copyFileSync(oldLogFile, newLogFile);
      if (fs.readFileSync(oldLogFile, 'utf-8') === fs.readFileSync(newLogFile, 'utf-8')) {
        fs.unlinkSync(oldLogFile);
        try { fs.rmdirSync(oldLogDir); } catch {}
        const parentDir = path.dirname(oldLogDir);
        try { fs.rmdirSync(parentDir); } catch {}
      } else {
        try { fs.unlinkSync(newLogFile); } catch {}
      }
    } catch (copyErr) {
      // Ignore migration errors
    }
  }
}

function ensureLogDir(): void {
  migrateLegacyLogs();
  ensureProjectDirs();
}

function getStream(): fs.WriteStream {
  if (!logStream) {
    ensureLogDir();
    logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
  }
  return logStream;
}

function timestamp(): string {
  return new Date().toISOString();
}

export function log(level: string, message: string, data?: Record<string, unknown>): void {
  const entry = data
    ? `[${timestamp()}] ${level}: ${message} ${JSON.stringify(data)}`
    : `[${timestamp()}] ${level}: ${message}`;
  getStream().write(entry + "\n");
}

export function info(message: string, data?: Record<string, unknown>): void {
  log("INFO", message, data);
}

export function error(message: string, data?: Record<string, unknown>): void {
  log("ERROR", message, data);
}

export function warn(message: string, data?: Record<string, unknown>): void {
  log("WARN", message, data);
}

export function debug(message: string, data?: Record<string, unknown>): void {
  log("DEBUG", message, data);
}

export function tool(toolName: string, input: Record<string, unknown>, result?: string): void {
  const inputPreview = JSON.stringify(input).slice(0, 200);
  const resultPreview = result ? result.slice(0, 200) : "";
  log("TOOL", `${toolName}`, { input: inputPreview, result: resultPreview });
}

export function flush(): void {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}

export function getLogPath(cwd?: string): string {
  // Import here to avoid circular dependency? No, already imported at top.
  // But since it's in project-data, use it.
  return getProjectLogPath(cwd);
}

export function parseLogLine(line: string): Record<string, unknown> {
  const match = line.match(/^\[([^\]]+)\]\s+(\w+):\s+(.+)$/);
  if (!match) {
    return { raw: line };
  }
  const timestamp = match[1];
  const level = match[2];
  const rest = match[3];
  // Check if rest ends with JSON
  const jsonMatch = rest.match(/^(.+?)\s+(\{.+\})$/);
  if (jsonMatch) {
    const message = jsonMatch[1];
    try {
      const data = JSON.parse(jsonMatch[2]);
      return { timestamp, level, message, data };
    } catch {
      // If JSON parse fails, treat as raw message
      return { timestamp, level, message: rest };
    }
  } else {
    return { timestamp, level, message: rest };
  }
}
