/**
 * workermill-agent init --standalone
 *
 * Interactive setup for standalone (non-cloud) mode.
 * Configures per-role LLM providers/models, default repo, and SCM token.
 */

import chalk from "chalk";
import inquirer from "inquirer";
import {
  loadStandaloneConfig,
  saveStandaloneConfig,
  detectExistingKey,
  type StandaloneConfig,
  type RoleConfig,
} from "../backends/local/config.js";

const PROVIDERS = [
  { name: "Anthropic (Claude)", value: "anthropic" },
  { name: "OpenAI (GPT)", value: "openai" },
  { name: "Google (Gemini)", value: "google" },
];

// Model choices per provider — mirrored from VS Code extension settings-panel.ts
const MODELS: Record<string, Array<{ name: string; value: string }>> = {
  anthropic: [
    { name: "Claude Opus 4.6", value: "claude-opus-4-6" },
    { name: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" },
    { name: "Claude Haiku 4.5", value: "claude-haiku-4-5-20251001" },
  ],
  openai: [
    { name: "GPT-5.2", value: "gpt-5.2" },
    { name: "o3 Pro (Reasoning)", value: "o3-pro" },
    { name: "GPT-5 Mini", value: "gpt-5-mini" },
  ],
  google: [
    { name: "Gemini 3.1 Pro", value: "gemini-3.1-pro-preview" },
    { name: "Gemini 3 Pro", value: "gemini-3-pro-preview" },
    { name: "Gemini 3 Flash", value: "gemini-3-flash-preview" },
  ],
};

function defaultModel(provider: string): string {
  return MODELS[provider]?.[0]?.value || "";
}

function providerLabel(provider: string): string {
  switch (provider) {
    case "anthropic": return "Anthropic";
    case "openai": return "OpenAI";
    case "google": return "Google";
    default: return provider;
  }
}

/** Prompt for a single role's provider + model. */
async function promptRole(
  roleName: string,
  roleLabel: string,
  existing: RoleConfig | undefined,
): Promise<RoleConfig> {
  console.log(chalk.bold(`  ${roleLabel}`));

  const { provider } = await inquirer.prompt([
    {
      type: "list",
      name: "provider",
      message: `${roleLabel} — AI provider:`,
      choices: PROVIDERS,
      default: existing?.provider || "anthropic",
    },
  ]);

  const modelChoices = MODELS[provider] || [{ name: defaultModel(provider), value: defaultModel(provider) }];
  const { model } = await inquirer.prompt([
    {
      type: "list",
      name: "model",
      message: `${roleLabel} — Model:`,
      choices: modelChoices,
      default: existing?.model || defaultModel(provider),
    },
  ]);

  console.log();
  return { provider, model };
}

export async function initStandaloneCommand(): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("  WorkerMill Standalone Setup"));
  console.log(chalk.dim("  ─────────────────────────────────────"));
  console.log();
  console.log("  Configure WorkerMill to run fully offline with your own AI keys.");
  console.log("  Each role can use a different AI provider and model.");
  console.log();

  const existing = loadStandaloneConfig();

  // ── Step 1: Per-role provider + model ──

  console.log(chalk.bold.white("  Step 1: Configure AI models per role"));
  console.log(chalk.dim("  Choose a provider and model for each role."));
  console.log();

  const planner = await promptRole(
    "planner",
    "Planning Agent (decomposes PRDs, creates plans)",
    existing.roles?.planner,
  );

  const worker = await promptRole(
    "worker",
    "Workers (AI experts that write code)",
    existing.roles?.worker,
  );

  const techLead = await promptRole(
    "techLead",
    "Tech Lead (reviews work, coordinates)",
    existing.roles?.techLead,
  );

  // ── Step 2: Collect API keys (only for providers that need them) ──

  console.log(chalk.bold.white("  Step 2: API keys"));
  console.log(chalk.dim("  Keys are only needed if not already set via environment variables or OAuth."));
  console.log();

  // Deduplicate providers across roles
  const uniqueProviders = [...new Set([planner.provider, worker.provider, techLead.provider])];
  const apiKeys: Record<string, string> = {};

  for (const provider of uniqueProviders) {
    const existingKey = detectExistingKey(provider);
    if (existingKey) {
      const masked = existingKey.slice(0, 8) + "..." + existingKey.slice(-4);
      console.log(`  ${chalk.green("✓")} ${providerLabel(provider)}: detected existing key (${masked})`);
      apiKeys[provider] = existingKey;
    } else {
      // Check if we had a key in old config for this provider
      const oldKey =
        existing.roles?.planner?.provider === provider ? existing.roles.planner.apiKey :
        existing.roles?.worker?.provider === provider ? existing.roles.worker.apiKey :
        existing.roles?.techLead?.provider === provider ? existing.roles.techLead.apiKey :
        existing.llm?.provider === provider ? existing.llm.apiKey :
        undefined;

      const { key } = await inquirer.prompt([
        {
          type: "password",
          name: "key",
          message: `${providerLabel(provider)} API key:`,
          mask: "*",
          default: oldKey || undefined,
          validate: (input: string) => input.length > 0 || `${providerLabel(provider)} API key is required`,
        },
      ]);
      apiKeys[provider] = key;
    }
  }
  console.log();

  // Assign keys to roles
  planner.apiKey = apiKeys[planner.provider];
  worker.apiKey = apiKeys[worker.provider];
  techLead.apiKey = apiKeys[techLead.provider];

  // ── Step 3: Repository + SCM ──

  console.log(chalk.bold.white("  Step 3: Repository"));
  console.log();

  const repoAnswers = await inquirer.prompt([
    {
      type: "input",
      name: "defaultRepo",
      message: "Default repository (e.g., https://github.com/user/repo):",
      default: existing.defaultRepo || "",
    },
    {
      type: "list",
      name: "scmProvider",
      message: "SCM provider:",
      choices: [
        { name: "GitHub", value: "github" },
        { name: "Bitbucket", value: "bitbucket" },
      ],
      default: existing.scm?.provider || "github",
    },
    {
      type: "password",
      name: "scmToken",
      message: "SCM token (for pushing branches/PRs):",
      mask: "*",
      default: existing.scm?.token || undefined,
    },
  ]);

  // ── Save config ──

  const config: StandaloneConfig = {
    mode: "standalone",
    roles: {
      planner,
      worker,
      techLead,
    },
    scm: {
      provider: repoAnswers.scmProvider,
      token: repoAnswers.scmToken || "",
    },
    defaultRepo: repoAnswers.defaultRepo || undefined,
    settings: existing.settings || {
      maxParallelExperts: 4,
      maxStories: 8,
    },
  };

  saveStandaloneConfig(config);

  console.log();
  console.log(`  ${chalk.green("✓")} Configuration saved to ~/.workermill/config.json`);
  console.log();
  console.log(chalk.dim("  Roles:"));
  console.log(`    Planning Agent: ${chalk.cyan(planner.provider)} / ${planner.model}`);
  console.log(`    Workers:        ${chalk.cyan(worker.provider)} / ${worker.model}`);
  console.log(`    Tech Lead:      ${chalk.cyan(techLead.provider)} / ${techLead.model}`);
  console.log();
  console.log(`  Run ${chalk.cyan("workermill-agent")} to start the agent.`);
  console.log();
}
