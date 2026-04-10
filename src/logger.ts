import fs from "fs";
import { getProjectLogPath, getProjectLogsDir, ensureProjectDirs } from "./project-data.js";

// Daily log rotation: logs/YYYY-MM-DD.log
let currentLogDate = "";
let logStream: fs.WriteStream | null = null;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureLogDir(): void {
  const logsDir = getProjectLogsDir();
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  ensureProjectDirs();
}

function getStream(): fs.WriteStream {
  const today = todayStr();
  // Rotate when date changes (long-running sessions spanning midnight)
  if (logStream && currentLogDate !== today) {
    logStream.end();
    logStream = null;
  }
  if (!logStream) {
    ensureLogDir();
    const logFile = getProjectLogPath();
    logStream = fs.createWriteStream(logFile, { flags: "a" });
    currentLogDate = today;
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
