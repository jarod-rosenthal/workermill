import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface WorkerMillConfig {
  apiBaseUrl: string;
  workspacePath: string;
  authToken?: string;
  orgId?: string;
}

const CONFIG_DIR = join(homedir(), ".workermill");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: WorkerMillConfig = {
  apiBaseUrl: "https://workermill.com",
  workspacePath: join(homedir(), ".workermill", "workspace"),
};

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): WorkerMillConfig {
  ensureConfigDir();
  if (!existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: WorkerMillConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getWorkspacePath(config: WorkerMillConfig): string {
  return config.workspacePath;
}

export function getCachePath(config: WorkerMillConfig): string {
  return join(config.workspacePath, "cache");
}
