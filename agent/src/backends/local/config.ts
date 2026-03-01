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
import { readApiKeyFromKeychain } from "../../keychain.js";

const CONFIG_DIR = join(homedir(), ".workermill");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/** Per-role LLM configuration. Each role can use a different provider/model. */
export interface RoleConfig {
  provider: string;
  model: string;
  apiKey?: string;
}

export interface StandaloneConfig {
  mode: "standalone" | "cloud";
  /** Per-role LLM configuration (planner, worker, techLead). */
  roles?: {
    planner?: RoleConfig;
    worker?: RoleConfig;
    techLead?: RoleConfig;
  };
  /** @deprecated Use `roles` instead. Kept for backward compatibility. */
  llm?: {
    provider: string;
    model: string;
    apiKey: string;
  };
  scm?: {
    provider: string;
    token: string;
  };
  issueTracker?: {
    provider: "internal" | "jira" | "linear" | "github-issues";
    jira?: { baseUrl: string; email: string; apiToken: string };
    linear?: { apiKey: string };
    // github-issues uses scm.token — no extra credentials needed
  };
  defaultRepo?: string;
  sandbox?: "docker" | "none";
  settings?: {
    maxParallelExperts?: number;
    maxStories?: number;
    maxPerStoryRevisions?: number;
    maxReviewRevisions?: number;
    qualityGateMaxRetries?: number;
    maxCiFixRetries?: number;
    blockerWaitTimeoutMinutes?: number;
    pushAfterCommit?: boolean;
  };
}

const DEFAULT_CONFIG: StandaloneConfig = {
  mode: "standalone",
  roles: {
    planner: { provider: "anthropic", model: "claude-opus-4-6" },
    worker: { provider: "anthropic", model: "claude-sonnet-4-6" },
    techLead: { provider: "anthropic", model: "claude-opus-4-6" },
  },
  settings: {
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

/**
 * Get the effective config for a role, with fallback chain:
 * roles.<role> → legacy llm → defaults
 */
export function getRoleConfig(config: StandaloneConfig, role: "planner" | "worker" | "techLead"): RoleConfig {
  // New per-role config
  const roleConf = config.roles?.[role];
  if (roleConf?.provider && roleConf?.model) return roleConf;

  // Legacy flat llm config (backward compat)
  if (config.llm?.provider && config.llm?.model) {
    return {
      provider: config.llm.provider,
      model: config.llm.model,
      apiKey: config.llm.apiKey,
    };
  }

  // Defaults
  return { provider: "anthropic", model: "claude-sonnet-4-6" };
}

/**
 * Resolve the API key for a role. Priority:
 * 1. Explicit key in role config
 * 2. Legacy llm.apiKey
 * 3. Environment variable (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
 * 4. Claude OAuth credentials (~/.claude/.credentials.json)
 */
export function resolveApiKey(config: StandaloneConfig, role: "planner" | "worker" | "techLead"): string {
  const rc = getRoleConfig(config, role);

  // Explicit key in config
  if (rc.apiKey) return rc.apiKey;

  // Legacy flat key
  if (config.llm?.apiKey && config.llm?.provider === rc.provider) return config.llm.apiKey;

  // Environment variable
  const envKey = getEnvKeyForProvider(rc.provider);
  if (envKey && process.env[envKey]) return process.env[envKey]!;

  // Claude OAuth token (Anthropic only)
  if (rc.provider === "anthropic") {
    const oauthKey = readClaudeOAuthKey();
    if (oauthKey) return oauthKey;
  }

  return "";
}

/** Check if standalone mode is configured (has at least one role with a resolvable API key). */
export function isStandaloneReady(): boolean {
  const config = loadStandaloneConfig();
  if (config.mode !== "standalone") return false;

  // Check if any role has a key (config, env var, or OAuth)
  return (
    !!resolveApiKey(config, "planner") ||
    !!resolveApiKey(config, "worker") ||
    !!resolveApiKey(config, "techLead")
  );
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

    // Resolve API key: config file first, then OS keychain
    const hasApiKey = !!parsed.apiKey || !!readApiKeyFromKeychain();

    // Explicit cloud mode
    if (parsed.mode === "cloud" && hasApiKey) return true;

    // Backward compat: existing cloud config has apiUrl + apiKey but no mode field
    if (!parsed.mode && !!parsed.apiUrl && hasApiKey) return true;

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

// ── Internal helpers ──

/** Map provider name to environment variable. */
function getEnvKeyForProvider(provider: string): string | null {
  switch (provider) {
    case "anthropic": return "ANTHROPIC_API_KEY";
    case "openai": return "OPENAI_API_KEY";
    case "google": return "GOOGLE_GENERATIVE_AI_API_KEY";
    default: return null;
  }
}

/** Read the OAuth API key from ~/.claude/.credentials.json if it exists. */
function readClaudeOAuthKey(): string | null {
  try {
    const credsPath = join(homedir(), ".claude", ".credentials.json");
    if (!existsSync(credsPath)) return null;
    const creds = JSON.parse(readFileSync(credsPath, "utf-8"));
    return creds?.claudeAiOauth?.accessToken || creds?.apiKey || null;
  } catch {
    return null;
  }
}

/** Check if an API key is available for a provider (env var, OAuth, etc.) without config. */
export function detectExistingKey(provider: string): string | null {
  // Environment variable
  const envKey = getEnvKeyForProvider(provider);
  if (envKey && process.env[envKey]) return process.env[envKey]!;

  // Claude OAuth (Anthropic only)
  if (provider === "anthropic") {
    const oauth = readClaudeOAuthKey();
    if (oauth) return oauth;
  }

  return null;
}
