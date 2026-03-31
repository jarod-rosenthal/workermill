import readline from "readline";
import { execSync } from "child_process";
import chalk from "chalk";
import { loadConfig, saveConfig, type CliConfig, type ProviderConfig } from "./config.js";
import * as logger from "./logger.js";

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
    name: "lmstudio",
    display: "LM Studio (local, no API key)",
    needsKey: false,
    models: [
      { id: "default", label: "Use loaded model" },
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
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fast, affordable)" },
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

/** OpenAI-compatible providers that work via the OpenAI SDK with a custom baseURL. */
const COMPATIBLE_PROVIDERS: Array<{ name: string; display: string; baseURL: string; envVar: string; defaultModel: string }> = [
  { name: "groq", display: "Groq (fast inference)", baseURL: "https://api.groq.com/openai/v1", envVar: "GROQ_API_KEY", defaultModel: "llama-3.3-70b-versatile" },
  { name: "deepseek", display: "DeepSeek", baseURL: "https://api.deepseek.com/v1", envVar: "DEEPSEEK_API_KEY", defaultModel: "deepseek-chat" },
  { name: "mistral", display: "Mistral AI", baseURL: "https://api.mistral.ai/v1", envVar: "MISTRAL_API_KEY", defaultModel: "mistral-large-latest" },
  { name: "openrouter", display: "OpenRouter (any model)", baseURL: "https://openrouter.ai/api/v1", envVar: "OPENROUTER_API_KEY", defaultModel: "anthropic/claude-sonnet-4" },
  { name: "together", display: "Together AI", baseURL: "https://api.together.xyz/v1", envVar: "TOGETHER_API_KEY", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { name: "xai", display: "xAI (Grok)", baseURL: "https://api.x.ai/v1", envVar: "XAI_API_KEY", defaultModel: "grok-3" },
  { name: "fireworks", display: "Fireworks AI", baseURL: "https://api.fireworks.ai/inference/v1", envVar: "FIREWORKS_API_KEY", defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct" },
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
  /** Suspend the readline — pause and detach from stdin without closing it. */
  suspend(): () => void {
    this.rl.pause();
    process.stdin.removeAllListeners("keypress");
    this.rl.removeAllListeners();
    return () => {
      this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    };
  }
  close(): void {
    // rl.close() properly removes readline's internal data/keypress listeners
    // from stdin. Without this, leftover listeners interfere with Ink's input.
    this.rl.close();
    // rl.close() pauses stdin, which lets the event loop exit before Ink can
    // take over. Resume immediately to keep the process alive.
    process.stdin.resume();
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
  console.log(`    ${chalk.cyan(`${providers.length + 1}`)}. More providers...`);
  console.log();

  const choiceStr = await p.ask(chalk.dim(`  Choose (1-${providers.length + 1}): `));
  const choice = parseInt(choiceStr.trim(), 10) - 1;

  // "More providers..." selected — show OpenAI-compatible providers
  if (choice === providers.length) {
    console.log();
    console.log(chalk.dim("  These providers use an OpenAI-compatible API:"));
    console.log();
    COMPATIBLE_PROVIDERS.forEach((cp, i) => {
      console.log(`    ${chalk.cyan(`${i + 1}`)}. ${cp.display}`);
    });
    console.log(`    ${chalk.cyan(`${COMPATIBLE_PROVIDERS.length + 1}`)}. Custom (enter base URL)`);
    console.log();

    const cpChoice = await p.ask(chalk.dim(`  Choose (1-${COMPATIBLE_PROVIDERS.length + 1}): `));
    const cpIdx = parseInt(cpChoice.trim(), 10) - 1;

    if (cpIdx >= 0 && cpIdx < COMPATIBLE_PROVIDERS.length) {
      const cp = COMPATIBLE_PROVIDERS[cpIdx];
      console.log(chalk.dim(`  → ${cp.display}`));
      // Return as an OpenAI-compatible provider with custom baseURL stored in host
      return {
        name: "openai",
        display: cp.display,
        needsKey: true,
        envVar: cp.envVar,
        models: [{ id: cp.defaultModel, label: `${cp.defaultModel} (default)` }],
        // Store baseURL in a way that gets picked up by config
        detectedModels: undefined,
        _baseURL: cp.baseURL,
        _providerName: cp.name,
      } as ProviderOption & { _baseURL: string; _providerName: string };
    }

    // Custom OpenAI-compatible provider
    const baseURL = await p.ask(chalk.dim("  Base URL (e.g., https://api.example.com/v1): "));
    const customName = await p.ask(chalk.dim("  Provider name: "));
    console.log(chalk.dim(`  → ${customName.trim() || "custom"} (${baseURL.trim()})`));
    return {
      name: "openai",
      display: customName.trim() || "Custom Provider",
      needsKey: true,
      models: [{ id: "default", label: "Enter model name" }],
      _baseURL: baseURL.trim(),
      _providerName: customName.trim().toLowerCase().replace(/\s+/g, "-") || "custom",
    } as ProviderOption & { _baseURL: string; _providerName: string };
  }

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

  // Reuse key if we already have one (from existing config or earlier in this setup)
  if (existingKeys.has(provider.name)) {
    const existing = existingKeys.get(provider.name)!;
    const masked = existing.startsWith("{env:") ? existing : `${existing.slice(0, 6)}${"•".repeat(20)}${existing.slice(-4)}`;
    console.log(chalk.green(`  ✓ Using saved ${provider.display} API key (${masked})`));
    return existing;
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

/** Format a model name for display. Strips context-window suffixes (e.g. "-64k")
 *  since context is a runtime setting, not an immutable model trait. */
function formatModelLabel(name: string): string {
  const [base, tag] = name.split(":");
  const prettyBase = base.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  if (!tag || tag === "latest") return prettyBase;
  // Strip context-window suffixes like "64k", "128k", "32k" from the tag
  const cleanTag = tag.replace(/[-_]?\d+k$/i, "").trim();
  return cleanTag ? `${prettyBase} (${cleanTag})` : prettyBase;
}

/** Fetch available models from a cloud provider's API. */
async function fetchCloudModels(
  provider: ProviderOption,
  apiKey: string,
): Promise<void> {
  if (!apiKey || apiKey.startsWith("{env:")) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let models: { id: string; label: string }[] = [];

    if (provider.name === "openai") {
      const res = await globalThis.fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = (await res.json()) as { data?: { id: string }[] };
        const allModels = (data.data || []).map(m => m.id);
        // Filter to GPT/o-series models, exclude old junk
        const relevant = allModels.filter(m =>
          (m.startsWith("gpt-") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) &&
          !m.includes("instruct") && !m.includes("realtime") && !m.includes("audio") &&
          !m.includes("gpt-3.5") && !m.includes("gpt-4-") && !m.includes("gpt-4o-mini-") &&
          !m.includes("-0") // skip dated snapshots like gpt-5.4-0325
        );
        // Sort by version number descending (gpt-5.4 before gpt-4o)
        relevant.sort((a, b) => {
          const va = parseFloat(a.match(/(\d+\.?\d*)/)?.[1] || "0");
          const vb = parseFloat(b.match(/(\d+\.?\d*)/)?.[1] || "0");
          return vb - va;
        });
        if (relevant.length > 0) {
          models = relevant.slice(0, 10).map(id => ({ id, label: id }));
        }
      }
    } else if (provider.name === "google") {
      const res = await globalThis.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { signal: controller.signal },
      );
      clearTimeout(timeout);
      if (res.ok) {
        const data = (await res.json()) as { models?: { name: string; displayName: string; supportedGenerationMethods?: string[] }[] };
        // Filter to Gemini text models suitable for coding — exclude image/video/embedding/experimental
        const EXCLUDE_PATTERNS = [
          "image", "video", "veo", "imagen", "nano", "banana",
          "embedding", "embed", "aqa", "attribution",
          "thinking-exp", "learnlm", "text-",
          "tts", "audio", "speech", "voice",
        ];
        const genModels = (data.models || [])
          .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
          .map(m => ({
            id: m.name.replace("models/", ""),
            label: m.displayName || m.name.replace("models/", ""),
          }))
          .filter(m => {
            if (!m.id.includes("gemini")) return false;
            const lower = m.id.toLowerCase();
            return !EXCLUDE_PATTERNS.some(p => lower.includes(p));
          });

        // Sort: preview models first, then by version descending
        genModels.sort((a, b) => {
          const aPreview = a.id.includes("preview") ? 1 : 0;
          const bPreview = b.id.includes("preview") ? 1 : 0;
          if (bPreview !== aPreview) return bPreview - aPreview;
          const va = parseFloat(a.id.match(/(\d+\.?\d*)/)?.[1] || "0");
          const vb = parseFloat(b.id.match(/(\d+\.?\d*)/)?.[1] || "0");
          return vb - va;
        });

        const trimmed = genModels.slice(0, 10);
        if (trimmed.length > 0) {
          models = trimmed;
        }
      }
    }

    if (models.length > 0) {
      provider.detectedModels = models;
      console.log(chalk.green(`  ✓ Found ${models.length} available models`));
    }
  } catch (err) {
    logger.debug("Failed to fetch cloud models", { provider: provider.name, error: err instanceof Error ? err.message : String(err) });
  }
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

          // Build dynamic model list — deduplicate by base name, prefer largest context variant
          if (ollamaProvider && models.length > 0) {
            const byBase = new Map<string, { name: string; score: number }>();
            for (const m of models) {
              const base = m.name.split(":")[0];
              const existing = byBase.get(base);
              const score = codingScore(m.name);
              // Keep the variant with the highest context or first seen
              if (!existing || score > existing.score) {
                byBase.set(base, { name: m.name, score });
              }
            }
            const sorted = [...byBase.values()]
              .sort((a, b) => b.score - a.score)
              .slice(0, 8);
            ollamaProvider.detectedModels = sorted.map((m, i) => ({
              id: m.name,
              label: `${formatModelLabel(m.name)}${i === 0 ? " (recommended)" : ""}`,
            }));
          }
        }
        return;
      }
    } catch {
      // Host not reachable — try next
      continue;
    }
  }

  providerConfig.host = "http://localhost:11434";
  console.log(chalk.yellow("  ⚠ Could not connect to Ollama. Make sure it's running."));
}

/** Detect LM Studio and configure host + available models. */
async function configureLmStudio(providerConfig: ProviderConfig, lmStudioProvider?: ProviderOption): Promise<void> {
  const hostsToTry = ["http://localhost:1234"];

  // Detect WSL → Windows host IP
  try {
    const gateway = execSync("ip route show default 2>/dev/null | awk '{print $3}'", { encoding: "utf-8" }).trim();
    if (gateway) hostsToTry.push(`http://${gateway}:1234`);
  } catch { /* not on WSL */ }

  for (const host of hostsToTry) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await globalThis.fetch(`${host}/v1/models`, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) {
        const data = (await response.json()) as { data?: { id: string }[] };
        providerConfig.host = `${host}/v1`;
        console.log(chalk.green(`  ✓ Connected to LM Studio at ${host}`));
        const models = data.data || [];
        if (models.length > 0) {
          console.log(chalk.dim(`  Available: ${models.map(m => m.id).join(", ")}`));
          if (lmStudioProvider && models.length > 0) {
            lmStudioProvider.detectedModels = models.map((m, i) => ({
              id: m.id,
              label: `${m.id}${i === 0 ? " (loaded)" : ""}`,
            }));
          }
        }
        return;
      }
    } catch {
      continue;
    }
  }

  providerConfig.host = "http://localhost:1234/v1";
  console.log(chalk.yellow("  ⚠ Could not connect to LM Studio. Make sure it's running."));
}

export async function runSetup(): Promise<CliConfig> {
  const p = new Prompter();
  const apiKeys = new Map<string, string>();

  // Pre-populate API keys from existing config so users don't re-enter them
  const existingConfig = loadConfig();
  if (existingConfig) {
    for (const [name, cfg] of Object.entries(existingConfig.providers)) {
      if ((cfg as ProviderConfig).apiKey) {
        apiKeys.set(name, (cfg as ProviderConfig).apiKey!);
      }
    }
  }

  console.log();
  console.log(chalk.bold("  WorkerMill CLI") + chalk.dim(" — AI coding team"));
  console.log();
  console.log(chalk.dim("  Three roles — workers, planner, reviewer — each can use a different model."));
  console.log(chalk.dim("  Best: Ollama for workers (free, local), cloud models for planning/review."));
  console.log(chalk.dim("  No local models? Haiku or Gemini Flash are low-cost cloud alternatives."));
  console.log();

  // ── Step 1: Workers (expert personas — the default provider) ──
  console.log(chalk.hex("#D77757").bold("  ① Workers") + chalk.dim(" — write code (most tokens, local model recommended)"));
  console.log();
  const workerProvider = await pickProvider(p, "Provider for workers", PROVIDERS);

  const workerConfig: ProviderConfig = { model: "" };
  if (workerProvider.name === "ollama") {
    // Detect Ollama models before asking user to pick one
    await configureOllama(workerConfig, workerProvider);
  } else if (workerProvider.name === "lmstudio") {
    await configureLmStudio(workerConfig, workerProvider);
  } else if (workerProvider.needsKey) {
    // Cloud providers: get API key first so we can fetch available models
    const workerKey = await getApiKey(p, workerProvider, apiKeys);
    if (workerKey) {
      workerConfig.apiKey = workerKey;
      await fetchCloudModels(workerProvider, workerKey.startsWith("{env:") ? (process.env[workerKey.slice(5, -1)] || "") : workerKey);
    }
  }

  const workerModel = await pickModel(p, workerProvider);
  workerConfig.model = workerModel;
  // Only ask for key if we haven't already (Ollama or key already obtained above)
  if (!workerConfig.apiKey) {
    const workerKey = await getApiKey(p, workerProvider, apiKeys);
    if (workerKey) workerConfig.apiKey = workerKey;
  }

  // Context window size — Ollama only
  if (workerProvider.name === "ollama") {
    const ctxOptions = [
      { label: "32K", value: 32768 },
      { label: "64K", value: 65536 },
      { label: "128K", value: 131072 },
      { label: "256K", value: 262144 },
    ];
    console.log(chalk.dim(`  Context window: ${ctxOptions.map((o, i) => `${chalk.cyan(String(i + 1))}=${o.label}`).join("  ")}`) + chalk.dim("  (more = better, needs VRAM)"));
    const ctxChoice = await p.ask(chalk.dim("  Choose [2]: "));
    const ctxIdx = parseInt(ctxChoice.trim(), 10) - 1;
    const selected = ctxOptions[ctxIdx] || ctxOptions[1]; // default: 64K
    workerConfig.contextLength = selected.value;
    console.log(chalk.dim(`  → ${selected.label} context`));
  }

  console.log();

  // ── Step 2: Planner ──
  console.log(chalk.hex("#D77757").bold("  ② Planner") + chalk.dim(" — reads codebase, designs the plan (runs once, flagship recommended)"));
  console.log();

  const sameForPlanner = await p.ask(chalk.dim(`  Use ${workerProvider.display} / ${workerModel}? [Y/n] `));
  let plannerProviderName: string;
  let plannerModel: string;

  if (sameForPlanner.trim().toLowerCase() === "n") {
    const plannerProvider = await pickProvider(p, "Provider for planner", PROVIDERS);
    // Get key first for cloud providers so we can fetch their model list
    const plannerKey = await getApiKey(p, plannerProvider, apiKeys);
    if (plannerKey && plannerProvider.needsKey && !plannerProvider.detectedModels) {
      const rawKey = plannerKey.startsWith("{env:") ? (process.env[plannerKey.slice(5, -1)] || "") : plannerKey;
      await fetchCloudModels(plannerProvider, rawKey);
    }
    plannerModel = await pickModel(p, plannerProvider);
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
  console.log(chalk.hex("#D77757").bold("  ③ Reviewer") + chalk.dim(" — reviews code, catches bugs (runs once, flagship recommended)"));
  console.log();

  const sameForReviewer = await p.ask(chalk.dim(`  Use ${workerProvider.display} / ${workerModel}? [Y/n] `));
  let reviewerProviderName: string;
  let reviewerModel: string;

  if (sameForReviewer.trim().toLowerCase() === "n") {
    const reviewerProvider = await pickProvider(p, "Provider for reviewer", PROVIDERS);
    const reviewerKey = await getApiKey(p, reviewerProvider, apiKeys);
    if (reviewerKey && reviewerProvider.needsKey && !reviewerProvider.detectedModels) {
      const rawKey = reviewerKey.startsWith("{env:") ? (process.env[reviewerKey.slice(5, -1)] || "") : reviewerKey;
      await fetchCloudModels(reviewerProvider, rawKey);
    }
    reviewerModel = await pickModel(p, reviewerProvider);
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
  // Handle OpenAI-compatible providers — store baseURL as host, use real provider name as key
  const wpExt = workerProvider as ProviderOption & { _baseURL?: string; _providerName?: string };
  if (wpExt._baseURL) {
    workerConfig.host = wpExt._baseURL;
  }
  // LM Studio uses the OpenAI SDK with a custom host
  const workerConfigKey = workerProvider.name === "lmstudio"
    ? "lmstudio"
    : (wpExt._providerName || workerProvider.name);

  const providers: Record<string, ProviderConfig> = {
    [workerConfigKey]: workerConfig,
  };

  // Add planner provider if different
  if (plannerProviderName !== workerProvider.name && !providers[plannerProviderName]) {
    const pProvider = PROVIDERS.find(p => p.name === plannerProviderName)!;
    const cfg: ProviderConfig = { model: plannerModel };
    const key = apiKeys.get(plannerProviderName);
    if (key) cfg.apiKey = key;
    if (pProvider.name === "ollama") await configureOllama(cfg);
    if (pProvider.name === "lmstudio") await configureLmStudio(cfg);
    providers[plannerProviderName] = cfg;
  }

  // Add reviewer provider if different
  if (reviewerProviderName !== workerProvider.name && !providers[reviewerProviderName]) {
    const rProvider = PROVIDERS.find(p => p.name === reviewerProviderName)!;
    const cfg: ProviderConfig = { model: reviewerModel };
    const key = apiKeys.get(reviewerProviderName);
    if (key) cfg.apiKey = key;
    if (rProvider.name === "ollama") await configureOllama(cfg);
    if (rProvider.name === "lmstudio") await configureLmStudio(cfg);
    providers[reviewerProviderName] = cfg;
  }

  // Build routing — only add entries that differ from default
  const routing: Record<string, string> = {};
  if (plannerProviderName !== workerConfigKey) {
    routing.planner = plannerProviderName;
    routing.critic = plannerProviderName;
  }
  if (reviewerProviderName !== workerConfigKey) {
    routing.tech_lead = reviewerProviderName;
  }

  // Handle model overrides — if planner/reviewer use the same provider as workers
  // but a different model, we need a separate provider entry with a unique key
  if (plannerProviderName === workerConfigKey && plannerModel !== workerModel) {
    const altKey = `${workerConfigKey}_planner`;
    providers[altKey] = { ...providers[workerConfigKey], model: plannerModel };
    routing.planner = altKey;
    routing.critic = altKey;
  }
  if (reviewerProviderName === workerConfigKey && reviewerModel !== workerModel) {
    const altKey = `${workerConfigKey}_reviewer`;
    providers[altKey] = { ...providers[workerConfigKey], model: reviewerModel };
    routing.tech_lead = altKey;
  }

  const config: CliConfig = {
    providers,
    default: workerConfigKey,
    ...(Object.keys(routing).length > 0 ? { routing } : {}),
  };

  saveConfig(config);

  console.log();
  console.log(chalk.green("  ✓ Config saved to ~/.workermill/cli.json"));
  console.log();
  console.log(chalk.dim("  Workers:  ") + `${workerConfigKey}/${workerModel}`);
  console.log(chalk.dim("  Planner:  ") + `${plannerProviderName}/${plannerModel}`);
  console.log(chalk.dim("  Reviewer: ") + `${reviewerProviderName}/${reviewerModel}`);
  console.log();

  return config;
}
