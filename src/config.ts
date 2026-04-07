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
  transport?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface QualityGateCommand {
  /** Human-readable name shown in output (e.g. "models e2e") */
  name: string;
  /** Shell commands to run in sequence — stops at first failure */
  commands: string[];
}

export interface ReviewConfig {
  /** Enable tech lead review after build (default: true) */
  enabled?: boolean;
  /** Max review→revise cycles before giving up (default: 3) */
  maxRevisions?: number;
  /** Auto-revise without prompting user (default: false — prompts each time) */
  autoRevise?: boolean;
  /** Score threshold for auto-approval, 1-10 scale (default: 9) */
  approvalThreshold?: number;
  /** Have the planner generate verification commands per story, run them before review (default: false) */
  verifyEnabled?: boolean;
  /** Check the spec for ambiguities before planning and prompt to fill gaps (default: false) */
  specCheck?: boolean;
  /** Automatically proceed when /build creates a feature branch without prompting (default: false) */
  autoBranch?: boolean;
}

export interface ProgramConfig {
  /** Maximum number of sub-issues allowed in a single /program run (default: 25). */
  maxIssues?: number;
  /** Automatic retries per sub-issue before pausing the program run (default: 1). */
  maxAutoRetries?: number;
  /** Program-level gate enforcement mode (default: advisory). */
  gateMode?: "required" | "advisory";
  /**
   * Optional shell gates run at epic milestones.
   * Example: ["npm run lint", "npm test -- --runInBand"]
   */
  gates?: string[];
  // Legacy fields kept for backwards compat when reading old configs
  /** @deprecated Use maxIssues instead */
  minSubIssues?: number;
  /** @deprecated Use maxIssues instead */
  maxSubIssues?: number;
  /** @deprecated Use maxIssues instead */
  maxEpics?: number;
  /** @deprecated Always asks now */
  epicPrompt?: "ask" | "always";
}

export interface DoctorConfig {
  /** Number of top high-risk modules to surface (default: 5) */
  maxHighRiskModules?: number;
  /** Risk score threshold where zero-coverage modules are considered trouble (default: 55) */
  riskTroubleThreshold?: number;
  /** Health score threshold to classify a module as functioning (default: 72) */
  healthFunctioningThreshold?: number;
  /** Health score threshold to classify a module as trouble (default: 45) */
  healthTroubleThreshold?: number;
  /** Enable dead-code candidate detection (default: true) */
  deadCodeEnabled?: boolean;
  /** Minimum stale age (days) for dead-code candidates (default: 45) */
  deadCodeMinDays?: number;
  /** Maximum number of dead-code candidates to report (default: 6) */
  deadCodeMaxCandidates?: number;
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
  /** Issue tracker for /build ticket references (default: "github") */
  ticketSystem?: TicketSystem;
  /** Jira credentials (only when ticketSystem === "jira") */
  jira?: JiraConfig;
  /** Linear credentials (only when ticketSystem === "linear") */
  linear?: LinearConfig;
  /** Shell commands to run after all stories complete, before tech lead review */
  qualityGates?: QualityGateCommand[];
  /** Disable automatic fetching of remote model catalog (default: false) */
  disableModelAutoUpdate?: boolean;
  /** Preferred terminal editor for /edit command: "vim", "nano", or "auto" (uses $EDITOR/$VISUAL/vi) */
  editor?: "vim" | "nano" | "auto";
  /** /program orchestration preferences */
  program?: ProgramConfig;
  /** /doctor triage thresholds */
  doctor?: DoctorConfig;
  /** Enable live browser diff view during /build runs ("auto", true, or false) */
  liveView?: boolean | "auto";
  /** Show inline edited-file previews for committed tool edits (default: true). */
  inlineEditPreview?: boolean;
  /** Enable experimental features: /doctor, /orchestrate (default: false) */
  experimental?: boolean;
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

export function loadProjectSettings(): PermissionRuleConfig | null {
  try {
    const projectSettings = path.join(process.cwd(), ".workermill", "settings.json");
    if (!fs.existsSync(projectSettings)) return null;
    const raw = fs.readFileSync(projectSettings, "utf-8");
    return JSON.parse(raw) as PermissionRuleConfig;
  } catch (err) {
    logger.error("Failed to load project settings", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export function saveProjectSettings(rules: PermissionRuleConfig, cwd = process.cwd()): void {
  const workermillDir = path.join(cwd, ".workermill");
  if (!fs.existsSync(workermillDir)) {
    fs.mkdirSync(workermillDir, { recursive: true });
  }
  const settingsPath = path.join(workermillDir, "settings.json");
  fs.writeFileSync(settingsPath, JSON.stringify(rules, null, 2) + "\n", "utf-8");
}

export function loadLocalSettings(): PermissionRuleConfig | null {
  try {
    const localSettings = path.join(process.cwd(), ".workermill", "settings.local.json");
    if (!fs.existsSync(localSettings)) return null;
    const raw = fs.readFileSync(localSettings, "utf-8");
    return JSON.parse(raw) as PermissionRuleConfig;
  } catch (err) {
    logger.error("Failed to load local settings", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export function saveLocalSettings(rules: PermissionRuleConfig, cwd = process.cwd()): void {
  const workermillDir = path.join(cwd, ".workermill");
  if (!fs.existsSync(workermillDir)) {
    fs.mkdirSync(workermillDir, { recursive: true });
  }
  const localSettingsPath = path.join(workermillDir, "settings.local.json");
  fs.writeFileSync(localSettingsPath, JSON.stringify(rules, null, 2) + "\n", "utf-8");
}

// Updated resolveConfig with new settings loading
export function resolveConfig(): CliConfig {
  const global = loadConfig();
  const project = loadProjectConfig();
  const pSettings = loadProjectSettings();
  const lSettings = loadLocalSettings();

  if (!global) {
    throw new Error("No configuration found. Run `workermill` to set up a provider.");
  }

  // Merge permissions: global → project settings → local settings
  const mergedPermissions: PermissionRuleConfig = {
    allow: [
      ...(global.permissions?.allow || []),
      ...(pSettings?.allow || []),
      ...(lSettings?.allow || []),
    ],
    ask: [
      ...(global.permissions?.ask || []),
      ...(pSettings?.ask || []),
      ...(lSettings?.ask || []),
    ],
    deny: [
      ...(global.permissions?.deny || []),
      ...(pSettings?.deny || []),
      ...(lSettings?.deny || []),
    ],
  };

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
    permissions: mergedPermissions,
    ticketSystem: project?.ticketSystem || global.ticketSystem,
    jira: project?.jira || global.jira,
    linear: project?.linear || global.linear,
    qualityGates: project?.qualityGates ?? global.qualityGates,
    disableModelAutoUpdate: project?.disableModelAutoUpdate ?? global.disableModelAutoUpdate ?? (process.env.WM_DISABLE_MODEL_AUTO_UPDATE === '1'),
    program: { ...global.program, ...(project?.program || {}) },
    doctor: { ...global.doctor, ...(project?.doctor || {}) },
    liveView: project?.liveView ?? global.liveView,
    inlineEditPreview: project?.inlineEditPreview ?? global.inlineEditPreview,
    experimental: project?.experimental ?? global.experimental,
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

  const baseProviderCandidates: string[] = [];
  let cursor = providerName;
  while (cursor.includes("_")) {
    cursor = cursor.replace(/_[^_]+$/, "");
    baseProviderCandidates.push(cursor);
  }

  const inheritedBaseProviderName = baseProviderCandidates.find((candidate) => !!config.providers[candidate]);
  const inheritedBaseProviderConfig = inheritedBaseProviderName ? config.providers[inheritedBaseProviderName] : undefined;
  const effectiveProviderConfig = inheritedBaseProviderConfig
    ? { ...inheritedBaseProviderConfig, ...providerConfig }
    : providerConfig;

  // Providers natively supported by createModel.
  const nativeProviders = new Set(["ollama", "anthropic", "openai", "google", "gemini", "lmstudio"]);

  // OpenAI-compatible providers supported by createModel default branch.
  const openAICompatibleProviders = new Set(["xai", "groq", "deepseek", "mistral"]);

  // Resolve provider name for model factory:
  // 1) native providers (direct or any role/persona suffix aliases)
  // 2) known OpenAI-compatible providers (direct or any role/persona suffix aliases)
  // 3) any provider with an explicit host (direct or inherited from base alias)
  // 4) fallback to raw provider name (will throw with a clear error if unsupported)
  const resolvedProvider = nativeProviders.has(providerName)
    ? providerName
    : openAICompatibleProviders.has(providerName)
      ? providerName
      : (() => {
          for (const candidate of baseProviderCandidates) {
            if (nativeProviders.has(candidate) || openAICompatibleProviders.has(candidate)) return candidate;
            if (config.providers[candidate]?.host) return "openai";
          }
          return effectiveProviderConfig.host ? "openai" : providerName;
        })();

  return {
    provider: resolvedProvider,
    model: effectiveProviderConfig.model,
    apiKey: effectiveProviderConfig.apiKey?.startsWith("{env:")
      ? process.env[effectiveProviderConfig.apiKey.slice(5, -1)] || undefined
      : effectiveProviderConfig.apiKey,
    host: effectiveProviderConfig.host,
    contextLength: effectiveProviderConfig.contextLength,
  };
}
