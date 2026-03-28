import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

// Logs stored in ~/.workermill/logs/<project-hash>/cli.log
// Keeps the working directory clean — matches Claude Code's ~/.claude/ pattern
const projectHash = crypto.createHash("md5").update(process.cwd()).digest("hex").slice(0, 8);
const LOG_DIR = path.join(os.homedir(), ".workermill", "logs", projectHash);
const LOG_FILE = path.join(LOG_DIR, "cli.log");

let logStream: fs.WriteStream | null = null;

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
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
