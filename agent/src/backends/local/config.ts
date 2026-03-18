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

/** Per-role LLM configuration. Each role can use a different provider/model. */
export interface RoleConfig {
  provider: string;
  model: string;
  apiKey?: string;
}

export interface StandaloneConfig {
  mode: "standalone" | "cloud" | "self-hosted";
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
    username?: string;
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
    maxTargetFiles?: number;
    maxPerStoryRevisions?: number;
    maxReviewRevisions?: number;
    qualityGateMaxRetries?: number;
    maxCiFixRetries?: number;
    blockerWaitTimeoutMinutes?: number;
    pushAfterCommit?: boolean;
    prdPlanningMode?: "strict" | "simplified";
    planningMode?: "strict" | "simplified";
    criticApprovalThreshold?: number;
    // Resilience & workflow flags (parity with cloud org settings)
    blockerAutoRetryEnabled?: boolean;
    blockerMaxAutoRetries?: number;
    gracefulShutdownEnabled?: boolean;
    selfReviewEnabled?: boolean;
    codebaseIndexingEnabled?: boolean;
    // Quality gate thresholds
    qualityGateEnabled?: boolean;
    minQualityScore?: number | null;
    minTestCoveragePercent?: number | null;
    maxSecurityHighVulns?: number | null;
    blockOnTypeErrors?: boolean;
    blockOnTestFailures?: boolean;
    blockOnLintErrors?: boolean;
    blockOnE2EFailures?: boolean;
    autoFixEnabled?: boolean;
    autoFixMaxIterations?: number;
    // Org-level guidelines
    aiGuidelines?: string;
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
    // Planning
    maxParallelExperts: 8,
    maxStories: 8,
    maxTargetFiles: 15,
    prdPlanningMode: "simplified",
    planningMode: "simplified",
    criticApprovalThreshold: 85,
    // Worker behavior
    maxPerStoryRevisions: 1,
    maxReviewRevisions: 3,
    qualityGateMaxRetries: 5,
    maxCiFixRetries: 3,
    blockerWaitTimeoutMinutes: 20,
    pushAfterCommit: true,
    // Resilience
    blockerAutoRetryEnabled: true,
    blockerMaxAutoRetries: 3,
    gracefulShutdownEnabled: true,
    selfReviewEnabled: true,
    // Quality gate
    qualityGateEnabled: true,
    blockOnTypeErrors: true,
    blockOnTestFailures: false,
    blockOnLintErrors: true,
    blockOnE2EFailures: false,
    autoFixEnabled: true,
    autoFixMaxIterations: 3,
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
  if (config.mode !== "standalone" && config.mode !== "self-hosted") return false;

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
 * Simple: `mode: "cloud"` in config = cloud. Everything else = not cloud.
 * No keychain reads, no apiUrl sniffing, no heuristics.
 */
export function isCloudMode(): boolean {
  if (!existsSync(CONFIG_FILE)) return false;
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.mode === "cloud" || parsed.mode === "self-hosted";
  } catch {
    return false;
  }
}

/** True when running in self-hosted mode (Docker Compose local stack). */
export function isSelfHostedMode(): boolean {
  try {
    if (!existsSync(CONFIG_FILE)) return false;
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const config = JSON.parse(raw);
    return config.mode === "self-hosted";
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
