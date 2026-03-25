import readline from "readline";
import { execSync } from "child_process";
import chalk from "chalk";
import { saveConfig, type CliConfig, type ProviderConfig } from "./config.js";

interface ProviderOption {
  name: string;
  display: string;
  needsKey: boolean;
  envVar?: string;
  models: { id: string; label: string }[];
  /** Dynamically detected models (set by configureOllama). Overrides `models` in pickModel. */
  detectedModels?: { id: string; label: string }[];
}

const PROVIDERS: ProviderOption[] = [
  {
    name: "ollama",
    display: "Ollama (local, no API key)",
    needsKey: false,
    models: [
      { id: "qwen3-coder:30b", label: "Qwen 3 Coder 30B (recommended)" },
      { id: "qwen2.5-coder:32b", label: "Qwen 2.5 Coder 32B" },
    ],
  },
  {
    name: "anthropic",
    display: "Anthropic (Claude)",
    needsKey: true,
    envVar: "ANTHROPIC_API_KEY",
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (recommended)" },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6 (most powerful)" },
    ],
  },
  {
    name: "openai",
    display: "OpenAI",
    needsKey: true,
    envVar: "OPENAI_API_KEY",
    models: [
      { id: "gpt-5.4", label: "GPT-5.4 (latest flagship)" },
      { id: "gpt-5.3-codex", label: "GPT-5.3 Codex (built for code)" },
    ],
  },
  {
    name: "google",
    display: "Google (Gemini)",
    needsKey: true,
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    models: [
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview (latest flagship)" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (fast, good value)" },
    ],
  },
];

/** Mutable readline holder — allows close/recreate without breaking callers. */
class Prompter {
  rl: readline.Interface;
  constructor() {
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  ask(question: string): Promise<string> {
    return new Promise((resolve) => this.rl.question(question, resolve));
  }
  /** Close current rl, return a cleanup function that recreates it. */
  suspend(): () => void {
    this.rl.close();
    return () => {
      this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    };
  }
  close(): void {
    this.rl.close();
  }
}

/** Prompt user to pick a provider. Returns the ProviderOption. */
async function pickProvider(
  p: Prompter,
  label: string,
  providers: ProviderOption[],
): Promise<ProviderOption> {
  console.log(`  ${chalk.bold(label)}:`);
  providers.forEach((prov, i) => {
    console.log(`    ${chalk.cyan(`${i + 1}`)}. ${prov.display}`);
  });
  console.log();

  const choiceStr = await p.ask(chalk.dim(`  Choose (1-${providers.length}): `));
  const choice = parseInt(choiceStr.trim(), 10) - 1;
  const selected = providers[choice] || providers[0];
  console.log(chalk.dim(`  → ${selected.display}`));
  return selected;
}

/** Prompt user to pick a model from the provider's defaults, or type custom. */
async function pickModel(
  p: Prompter,
  provider: ProviderOption,
): Promise<string> {
  // Use dynamically detected models if available (Ollama), otherwise hardcoded defaults
  const models = provider.detectedModels && provider.detectedModels.length > 0
    ? provider.detectedModels
    : provider.models;

  console.log();
  models.forEach((m, i) => {
    console.log(`    ${chalk.cyan(`${i + 1}`)}. ${m.label}`);
  });
  console.log(`    ${chalk.cyan(`${models.length + 1}`)}. Custom model`);
  console.log();

  const choiceStr = await p.ask(chalk.dim(`  Choose (1-${models.length + 1}): `));
  const choice = parseInt(choiceStr.trim(), 10) - 1;

  if (choice >= 0 && choice < models.length) {
    const model = models[choice].id;
    console.log(chalk.dim(`  → ${model}`));
    return model;
  }

  // Custom model
  const custom = await p.ask(chalk.dim("  Model name: "));
  const model = custom.trim() || models[0].id;
  console.log(chalk.dim(`  → ${model}`));
  return model;
}

/** Mask an API key, showing first 6 and last 4 characters. */
function maskKey(key: string): string {
  if (key.length <= 12) return "•".repeat(key.length);
  return key.slice(0, 6) + "•".repeat(Math.min(key.length - 10, 30)) + key.slice(-4);
}

/** Get API key for a provider — check env first, then prompt. */
async function getApiKey(
  p: Prompter,
  provider: ProviderOption,
  existingKeys: Map<string, string>,
): Promise<string | undefined> {
  if (!provider.needsKey) return undefined;

  // Reuse key if we already have one for this provider
  if (existingKeys.has(provider.name)) {
    console.log(chalk.green(`  ✓ Reusing ${provider.display} API key from earlier`));
    return existingKeys.get(provider.name);
  }

  // Check env var
  const envValue = provider.envVar ? process.env[provider.envVar] : undefined;
  if (envValue) {
    console.log(chalk.green(`  ✓ Found ${provider.envVar} in environment`));
    const key = `{env:${provider.envVar}}`;
    existingKeys.set(provider.name, key);
    return key;
  }

  // Suspend readline so it doesn't echo the key in plaintext, then recreate after
  const resume = p.suspend();
  const key = await readKeyMasked(chalk.dim(`  ${provider.display} API key: `));
  resume();
  const trimmed = key.trim();
  existingKeys.set(provider.name, trimmed);
  return trimmed;
}

/**
 * Read an API key from stdin with masked display.
 * Shows first 6 chars as typed, then masks the middle, shows last 4 on Enter.
 * Press Tab to toggle reveal/mask the full key.
 *
 * Must be called AFTER the readline interface is closed (via Prompter.suspend())
 * to prevent readline from echoing keystrokes in plaintext.
 */
function readKeyMasked(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    let buffer = "";
    let revealed = false;

    process.stdout.write(prompt);

    // Put stdin into raw mode to capture individual keypresses
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const redraw = () => {
      // Clear line from prompt start
      process.stdout.write(`\r\x1b[K${prompt}`);
      if (revealed) {
        process.stdout.write(buffer);
      } else {
        process.stdout.write(maskKey(buffer));
      }
    };

    const onData = (data: Buffer) => {
      const str = data.toString();

      for (const ch of str) {
        const code = ch.charCodeAt(0);

        // Enter
        if (code === 13 || code === 10) {
          process.stdin.removeListener("data", onData);
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(wasRaw ?? false);
          }
          // Show final masked version
          process.stdout.write(`\r\x1b[K${prompt}`);
          if (buffer.length > 0) {
            process.stdout.write(chalk.green(maskKey(buffer)));
          }
          process.stdout.write("\n");
          resolve(buffer);
          return;
        }

        // Tab — toggle reveal
        if (code === 9) {
          revealed = !revealed;
          redraw();
          continue;
        }

        // Ctrl+C
        if (code === 3) {
          process.stdin.removeListener("data", onData);
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(wasRaw ?? false);
          }
          process.stdout.write("\n");
          resolve("");
          return;
        }

        // Backspace / Delete
        if (code === 127 || code === 8) {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            redraw();
          }
          continue;
        }

        // Ctrl+U — clear line
        if (code === 21) {
          buffer = "";
          redraw();
          continue;
        }

        // Paste / normal character (printable ASCII and above)
        if (code >= 32) {
          buffer += ch;
          redraw();
        }
      }
    };

    process.stdin.on("data", onData);
  });
}

/** Keywords that indicate a model is good for coding. Higher score = better for code. */
function codingScore(name: string): number {
  const lower = name.toLowerCase();
  let score = 0;
  if (lower.includes("coder") || lower.includes("codex")) score += 10;
  if (lower.includes("code")) score += 5;
  if (lower.includes("devstral") || lower.includes("starcoder")) score += 8;
  if (lower.includes("deepseek")) score += 3;
  if (lower.includes("qwen")) score += 2;
  if (lower.includes("llama")) score += 1;
  // Prefer larger models
  const sizeMatch = lower.match(/(\d+)b/);
  if (sizeMatch) score += Math.min(parseInt(sizeMatch[1], 10) / 5, 10);
  return score;
}

/** Format a model name for display. */
function formatModelLabel(name: string): string {
  // Extract size if present
  const sizeMatch = name.match(/(\d+\.?\d*)b/i);
  const size = sizeMatch ? ` (${sizeMatch[1]}B)` : "";
  const base = name.split(":")[0].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return `${base}${size}`;
}

/** Detect Ollama and configure host/context. */
async function configureOllama(providerConfig: ProviderConfig, ollamaProvider?: ProviderOption): Promise<void> {
  const hostsToTry = ["http://localhost:11434"];

  // Detect WSL → Windows host IP
  try {
    const gateway = execSync("ip route show default 2>/dev/null | awk '{print $3}'", { encoding: "utf-8" }).trim();
    if (gateway) hostsToTry.push(`http://${gateway}:11434`);
  } catch { /* not on WSL */ }

  if (process.env.OLLAMA_HOST) {
    const envHost = process.env.OLLAMA_HOST.startsWith("http")
      ? process.env.OLLAMA_HOST
      : `http://${process.env.OLLAMA_HOST}`;
    hostsToTry.unshift(envHost);
  }

  providerConfig.contextLength = 65536;

  for (const host of hostsToTry) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await globalThis.fetch(`${host}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) {
        const data = (await response.json()) as { models?: { name: string }[] };
        providerConfig.host = host;
        console.log(chalk.green(`  ✓ Connected to Ollama at ${host}`));
        const models = data.models || [];
        if (models.length > 0) {
          console.log(chalk.dim(`  Available: ${models.map(m => m.name).join(", ")}`));

          // Build dynamic model list sorted by coding relevance
          if (ollamaProvider && models.length > 0) {
            const sorted = [...models]
              .sort((a, b) => codingScore(b.name) - codingScore(a.name))
              .slice(0, 8); // Show top 8
            ollamaProvider.detectedModels = sorted.map((m, i) => ({
              id: m.name,
              label: `${formatModelLabel(m.name)}${i === 0 ? " (recommended)" : ""}`,
            }));
          }
        }
        return;
      }
    } catch { continue; }
  }

  providerConfig.host = "http://localhost:11434";
  console.log(chalk.yellow("  ⚠ Could not connect to Ollama. Make sure it's running."));
}

export async function runSetup(): Promise<CliConfig> {
  const p = new Prompter();
  const apiKeys = new Map<string, string>();

  console.log();
  console.log(chalk.bold("  WorkerMill CLI") + chalk.dim(" — AI coding agent"));
  console.log();
  console.log(chalk.dim("  WorkerMill uses three roles. Each can use a different provider."));
  console.log(chalk.dim("  Workers build code, the planner designs the plan, the reviewer checks quality."));
  console.log();

  // ── Step 1: Workers (expert personas — the default provider) ──
  console.log(chalk.hex("#D77757").bold("  ① Workers") + chalk.dim(" — expert personas that write code"));
  console.log();
  const workerProvider = await pickProvider(p, "Provider for workers", PROVIDERS);

  // Detect Ollama models before asking user to pick one
  const workerConfig: ProviderConfig = { model: "" };
  if (workerProvider.name === "ollama") await configureOllama(workerConfig, workerProvider);

  const workerModel = await pickModel(p, workerProvider);
  workerConfig.model = workerModel;
  const workerKey = await getApiKey(p, workerProvider, apiKeys);
  if (workerKey) workerConfig.apiKey = workerKey;

  console.log();

  // ── Step 2: Planner (also used for critic) ──
  console.log(chalk.hex("#D77757").bold("  ② Planner") + chalk.dim(" — plans stories and validates the approach"));
  console.log();

  const sameForPlanner = await p.ask(chalk.dim(`  Same as workers (${workerProvider.display} / ${workerModel})? [Y/n] `));
  let plannerProviderName: string;
  let plannerModel: string;

  if (sameForPlanner.trim().toLowerCase() === "n") {
    const plannerProvider = await pickProvider(p, "Provider for planner", PROVIDERS);
    plannerModel = await pickModel(p, plannerProvider);
    const plannerKey = await getApiKey(p, plannerProvider, apiKeys);
    plannerProviderName = plannerProvider.name;
    if (plannerKey && plannerProvider.name !== workerProvider.name) {
      // Will be added to providers below
    }
  } else {
    plannerProviderName = workerProvider.name;
    plannerModel = workerModel;
    console.log(chalk.dim(`  → ${workerProvider.display} / ${workerModel}`));
  }

  console.log();

  // ── Step 3: Reviewer (tech_lead) ──
  console.log(chalk.hex("#D77757").bold("  ③ Reviewer") + chalk.dim(" — tech lead that reviews code quality"));
  console.log();

  const sameForReviewer = await p.ask(chalk.dim(`  Same as workers (${workerProvider.display} / ${workerModel})? [Y/n] `));
  let reviewerProviderName: string;
  let reviewerModel: string;

  if (sameForReviewer.trim().toLowerCase() === "n") {
    const reviewerProvider = await pickProvider(p, "Provider for reviewer", PROVIDERS);
    reviewerModel = await pickModel(p, reviewerProvider);
    const reviewerKey = await getApiKey(p, reviewerProvider, apiKeys);
    reviewerProviderName = reviewerProvider.name;
    if (reviewerKey && reviewerProvider.name !== workerProvider.name) {
      // Will be added to providers below
    }
  } else {
    reviewerProviderName = workerProvider.name;
    reviewerModel = workerModel;
    console.log(chalk.dim(`  → ${workerProvider.display} / ${workerModel}`));
  }

  p.close();

  // ── Build config ──
  const providers: Record<string, ProviderConfig> = {
    [workerProvider.name]: workerConfig,
  };

  // Add planner provider if different
  if (plannerProviderName !== workerProvider.name && !providers[plannerProviderName]) {
    const pProvider = PROVIDERS.find(p => p.name === plannerProviderName)!;
    const cfg: ProviderConfig = { model: plannerModel };
    const key = apiKeys.get(plannerProviderName);
    if (key) cfg.apiKey = key;
    if (pProvider.name === "ollama") await configureOllama(cfg);
    providers[plannerProviderName] = cfg;
  }

  // Add reviewer provider if different
  if (reviewerProviderName !== workerProvider.name && !providers[reviewerProviderName]) {
    const rProvider = PROVIDERS.find(p => p.name === reviewerProviderName)!;
    const cfg: ProviderConfig = { model: reviewerModel };
    const key = apiKeys.get(reviewerProviderName);
    if (key) cfg.apiKey = key;
    if (rProvider.name === "ollama") await configureOllama(cfg);
    providers[reviewerProviderName] = cfg;
  }

  // Build routing — only add entries that differ from default
  const routing: Record<string, string> = {};
  if (plannerProviderName !== workerProvider.name) {
    routing.planner = plannerProviderName;
    routing.critic = plannerProviderName;
  }
  if (reviewerProviderName !== workerProvider.name) {
    routing.tech_lead = reviewerProviderName;
  }

  // Handle model overrides — if planner/reviewer use the same provider as workers
  // but a different model, we need a separate provider entry with a unique key
  if (plannerProviderName === workerProvider.name && plannerModel !== workerModel) {
    const altKey = `${plannerProviderName}_planner`;
    providers[altKey] = { ...providers[plannerProviderName], model: plannerModel };
    routing.planner = altKey;
    routing.critic = altKey;
  }
  if (reviewerProviderName === workerProvider.name && reviewerModel !== workerModel) {
    const altKey = `${reviewerProviderName}_reviewer`;
    providers[altKey] = { ...providers[reviewerProviderName], model: reviewerModel };
    routing.tech_lead = altKey;
  }

  const config: CliConfig = {
    providers,
    default: workerProvider.name,
    ...(Object.keys(routing).length > 0 ? { routing } : {}),
  };

  saveConfig(config);

  console.log();
  console.log(chalk.green("  ✓ Config saved to ~/.workermill/cli.json"));
  console.log();
  console.log(chalk.dim("  Workers:  ") + `${workerProvider.name}/${workerModel}`);
  console.log(chalk.dim("  Planner:  ") + `${plannerProviderName}/${plannerModel}`);
  console.log(chalk.dim("  Reviewer: ") + `${reviewerProviderName}/${reviewerModel}`);
  console.log();

  return config;
}
