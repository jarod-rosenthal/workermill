import fs from "fs";
import path from "path";
import os from "os";
import * as logger from "./logger.js";

export interface ProviderConfig {
  model: string;
  apiKey?: string;
  host?: string;
  /** Ollama context window size (num_ctx). Default: 2048 by Ollama. Set to e.g. 65536 for 64K. */
  contextLength?: number;
}

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ReviewConfig {
  /** Enable tech lead review after build (default: true) */
  enabled?: boolean;
  /** Max review→revise cycles before giving up (default: 3) */
  maxRevisions?: number;
  /** Auto-revise without prompting user (default: false — prompts each time) */
  autoRevise?: boolean;
  /** Score threshold for auto-approval, 1-10 scale (default: 8) */
  approvalThreshold?: number;
  /** Score threshold for critic plan approval, 1-10 scale (default: 8) */
  criticThreshold?: number;
  /** Enable critic pass on the plan before execution (default: false) */
  useCritic?: boolean;
}

export interface HookConfig {
  /** Shell command to run (for "command" type, default) */
  command?: string;
  /** URL to POST to (for "http" type) */
  url?: string;
  /** Hook type: "command" (default) or "http" */
  type?: "command" | "http";
  /** Which tool(s) this hook applies to. "*" for all. Only for pre/post hooks. */
  tools?: string[];
}

export interface HooksConfig {
  /** Run before tool execution */
  pre?: HookConfig[];
  /** Run after tool execution */
  post?: HookConfig[];
  /** Run on lifecycle events */
  on?: Record<string, HookConfig[]>;
}

export interface GitConfig {
  // Branch prefix is derived from the repo name automatically — no config needed.
}

export interface PermissionRuleConfig {
  /** Patterns to auto-allow, e.g. "bash(npm run *)", "bash(git status)" */
  allow?: string[];
  /** Patterns that force a prompt even in acceptEdits mode */
  ask?: string[];
  /** Patterns to always deny, e.g. "bash(rm *)", "write_file(.env)" — deny wins over all */
  deny?: string[];
}

export type TicketSystem = "github" | "jira" | "linear" | "none";

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface LinearConfig {
  apiKey: string;
}

export interface CliConfig {
  providers: Record<string, ProviderConfig>;
  default: string;
  routing?: Record<string, string>;
  mcp?: Record<string, MCPServerConfig>;
  review?: ReviewConfig;
  hooks?: HooksConfig;
  git?: GitConfig;
  /** Restrict file/bash tools to the working directory (default: true). Set to "os" for OS-level sandboxing via @anthropic-ai/sandbox-runtime. */
  sandbox?: boolean | "os";
  /** Play a beep sound when builds complete (default: false) */
  bell?: boolean;
  /** Granular permission rules — pattern-based allow/deny per tool */
  permissions?: PermissionRuleConfig;
  /** Issue tracker for /ship ticket references (default: "github") */
  ticketSystem?: TicketSystem;
  /** Jira credentials (only when ticketSystem === "jira") */
  jira?: JiraConfig;
  /** Linear credentials (only when ticketSystem === "linear") */
  linear?: LinearConfig;
}

const CONFIG_DIR = path.join(os.homedir(), ".workermill");
const CONFIG_FILE = path.join(CONFIG_DIR, "cli.json");

export function loadConfig(): CliConfig | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as CliConfig;
  } catch (err) {
    logger.error("Failed to load config", { path: CONFIG_FILE, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export function saveConfig(config: CliConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function loadProjectConfig(): Partial<CliConfig> | null {
  try {
    const projectConfig = path.join(process.cwd(), ".workermill", "config.json");
    if (!fs.existsSync(projectConfig)) return null;
    const raw = fs.readFileSync(projectConfig, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    logger.error("Failed to load project config", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export function resolveConfig(): CliConfig {
  const global = loadConfig();
  const project = loadProjectConfig();

  if (!global) {
    throw new Error("No configuration found. Run `workermill` to set up a provider.");
  }

  // Project config overrides global
  return {
    providers: { ...global.providers, ...(project?.providers || {}) },
    default: project?.default || global.default,
    routing: { ...global.routing, ...(project?.routing || {}) },
    mcp: { ...global.mcp, ...(project?.mcp || {}) },
    review: { ...global.review, ...(project?.review || {}) },
    hooks: {
      pre: [...(global.hooks?.pre || []), ...(project?.hooks?.pre || [])],
      post: [...(global.hooks?.post || []), ...(project?.hooks?.post || [])],
    },
    git: { ...global.git, ...(project?.git || {}) },
    sandbox: project?.sandbox ?? global.sandbox,
    bell: project?.bell ?? global.bell,
    permissions: {
      allow: [...(global.permissions?.allow || []), ...(project?.permissions?.allow || [])],
      ask: [...(global.permissions?.ask || []), ...(project?.permissions?.ask || [])],
      deny: [...(global.permissions?.deny || []), ...(project?.permissions?.deny || [])],
    },
    ticketSystem: project?.ticketSystem || global.ticketSystem,
    jira: project?.jira || global.jira,
    linear: project?.linear || global.linear,
  };
}

export function getProviderForPersona(
  config: CliConfig,
  persona?: string
): { provider: string; model: string; apiKey?: string; host?: string; contextLength?: number } {
  const providerName = (persona && config.routing?.[persona]) || config.default;
  const providerConfig = config.providers[providerName];

  if (!providerConfig) {
    throw new Error(`Provider "${providerName}" not found in configuration. Run \`workermill\` to set up this provider or check your routing config.`);
  }

  // Map OpenAI-compatible providers to "openai" for the model factory
  const knownProviders = new Set(["ollama", "anthropic", "openai", "google", "gemini", "lmstudio"]);
  const resolvedProvider = knownProviders.has(providerName) || knownProviders.has(providerName.replace(/_.*$/, ""))
    ? providerName.replace(/_.*$/, "") // strip _planner/_reviewer suffix
    : providerConfig.host ? "openai" : providerName; // has baseURL → OpenAI-compatible

  return {
    provider: resolvedProvider,
    model: providerConfig.model,
    apiKey: providerConfig.apiKey?.startsWith("{env:")
      ? process.env[providerConfig.apiKey.slice(5, -1)] || undefined
      : providerConfig.apiKey,
    host: providerConfig.host,
    contextLength: providerConfig.contextLength,
  };
}
