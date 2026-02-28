/**
 * Standalone Mode Configuration
 *
 * Manages ~/.workermill/config.json for standalone (non-cloud) operation.
 * Sensitive values (API keys, tokens) live here, not in SQLite.
 *
 * This is separate from agent/src/config.ts which handles cloud agent config.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".workermill");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface StandaloneConfig {
  mode: "standalone" | "cloud";
  llm?: {
    provider: string;
    model: string;
    apiKey: string;
  };
  scm?: {
    provider: string;
    token: string;
  };
  defaultRepo?: string;
  settings?: {
    maxParallelExperts?: number;
    maxStories?: number;
  };
}

const DEFAULT_CONFIG: StandaloneConfig = {
  mode: "standalone",
  llm: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiKey: "",
  },
  settings: {
    maxParallelExperts: 4,
    maxStories: 8,
  },
};

/** Load standalone config from disk. Returns defaults if file doesn't exist. */
export function loadStandaloneConfig(): StandaloneConfig {
  if (!existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as StandaloneConfig;
    return parsed;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** Save standalone config to disk with restricted permissions. */
export function saveStandaloneConfig(config: StandaloneConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");

  try {
    chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // chmod may not work on Windows
  }
}

/** Check if standalone mode is configured (has LLM API key). */
export function isStandaloneReady(): boolean {
  const config = loadStandaloneConfig();
  return config.mode === "standalone" && !!config.llm?.apiKey;
}

/**
 * Check if the config file indicates cloud mode.
 *
 * Detects two cases:
 * 1. Explicit: config has `mode: "cloud"` with an `apiKey` field
 * 2. Backward compat: config has `apiUrl` + `apiKey` but no explicit `mode`
 *    (existing cloud setups written by agent/src/config.ts before standalone mode)
 */
export function isCloudMode(): boolean {
  if (!existsSync(CONFIG_FILE)) return false;
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);

    // Explicit cloud mode
    if (parsed.mode === "cloud" && !!parsed.apiKey) return true;

    // Backward compat: existing cloud config has apiUrl + apiKey but no mode field
    if (!parsed.mode && !!parsed.apiUrl && !!parsed.apiKey) return true;

    return false;
  } catch {
    return false;
  }
}

/** Get the config directory path. */
export function getStandaloneConfigDir(): string {
  return CONFIG_DIR;
}

/** Get the config file path. */
export function getStandaloneConfigFile(): string {
  return CONFIG_FILE;
}
