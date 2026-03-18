/**
 * Agent Configuration
 *
 * Manages ~/.workermill/config.json for cloud agent operation.
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
  mode: "cloud";
  apiUrl?: string;
  apiKey?: string;
  orgId?: string;
  scm?: {
    provider: string;
    token: string;
    username?: string;  // Bitbucket: git clone username (resolved from API, NOT email)
    email?: string;     // Bitbucket: login email (for REST API auth)
  };
  defaultRepo?: string;
  sandbox?: "docker";
  settings?: {
    maxParallelExperts?: number;
    maxStories?: number;
    maxTargetFiles?: number;
    maxPerStoryRevisions?: number;
    maxReviewRevisions?: number;
    maxFixRetries?: number;
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

/** Load config from disk. Returns minimal cloud config if file doesn't exist. */
export function loadStandaloneConfig(): StandaloneConfig {
  if (!existsSync(CONFIG_FILE)) {
    return { mode: "cloud" } as StandaloneConfig;
  }

  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as StandaloneConfig;
    return parsed;
  } catch {
    return { mode: "cloud" } as StandaloneConfig;
  }
}

/** Save config to disk with restricted permissions. */
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
    return parsed.mode === "cloud";
  } catch {
    return false;
  }
}
