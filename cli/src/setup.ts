import readline from "readline";
import chalk from "chalk";
import { saveConfig, type CliConfig, type ProviderConfig } from "./config.js";

const PROVIDERS = [
  { name: "ollama", display: "Ollama (local, no API key needed)", needsKey: false, defaultModel: "qwen2.5-coder:32b" },
  { name: "anthropic", display: "Anthropic (Claude)", needsKey: true, defaultModel: "claude-sonnet-4-6", envVar: "ANTHROPIC_API_KEY" },
  { name: "openai", display: "OpenAI (GPT)", needsKey: true, defaultModel: "gpt-4o", envVar: "OPENAI_API_KEY" },
  { name: "google", display: "Google (Gemini)", needsKey: true, defaultModel: "gemini-2.5-pro", envVar: "GOOGLE_API_KEY" },
];

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function runSetup(): Promise<CliConfig> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log();
  console.log(chalk.bold("  WorkerMill CLI") + chalk.dim(" — AI coding agent"));
  console.log();
  console.log(chalk.dim("  No provider configured. Let's set one up."));
  console.log();

  // Show provider options
  console.log("  Provider:");
  PROVIDERS.forEach((p, i) => {
    console.log(`    ${chalk.cyan(`${i + 1}`)}. ${p.display}`);
  });
  console.log();

  const choiceStr = await ask(rl, chalk.dim("  Choose (1-4): "));
  const choice = parseInt(choiceStr.trim(), 10) - 1;
  const selected = PROVIDERS[choice] || PROVIDERS[0];

  console.log();
  console.log(chalk.dim(`  Selected: ${selected.display}`));

  const providerConfig: ProviderConfig = { model: selected.defaultModel };

  if (selected.needsKey) {
    // Check for env var first
    const envValue = selected.envVar ? process.env[selected.envVar] : undefined;
    if (envValue) {
      console.log(chalk.green(`  ✓ Found ${selected.envVar} in environment`));
      providerConfig.apiKey = `{env:${selected.envVar}}`;
    } else {
      const key = await ask(rl, chalk.dim(`  API key: `));
      providerConfig.apiKey = key.trim();
    }
  }

  if (selected.name === "ollama") {
    providerConfig.host = "http://localhost:11434";
    // Try to connect
    try {
      const response = await globalThis.fetch("http://localhost:11434/api/tags");
      if (response.ok) {
        console.log(chalk.green("  ✓ Connected to Ollama at localhost:11434"));
        const data = (await response.json()) as { models?: { name: string }[] };
        if (data.models && data.models.length > 0) {
          console.log(chalk.dim(`  Available models: ${data.models.map((m: { name: string }) => m.name).join(", ")}`));
        }
      }
    } catch {
      console.log(chalk.yellow("  ⚠ Could not connect to Ollama. Make sure it's running."));
    }
  }

  // Ask for model override
  const modelOverride = await ask(rl, chalk.dim(`  Model [${selected.defaultModel}]: `));
  if (modelOverride.trim()) {
    providerConfig.model = modelOverride.trim();
  }

  rl.close();

  const config: CliConfig = {
    providers: { [selected.name]: providerConfig },
    default: selected.name,
  };

  saveConfig(config);

  console.log();
  console.log(chalk.green("  ✓ Config saved to ~/.workermill/cli.json"));
  console.log();

  return config;
}
