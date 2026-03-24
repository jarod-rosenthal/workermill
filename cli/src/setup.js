import readline from "readline";
import { execSync } from "child_process";
import chalk from "chalk";
import { saveConfig } from "./config.js";
const PROVIDERS = [
    { name: "ollama", display: "Ollama (local, no API key needed)", needsKey: false, defaultModel: "qwen3-coder:30b" },
    { name: "anthropic", display: "Anthropic (Claude)", needsKey: true, defaultModel: "claude-sonnet-4-6", envVar: "ANTHROPIC_API_KEY" },
    { name: "openai", display: "OpenAI (GPT)", needsKey: true, defaultModel: "gpt-5.4", envVar: "OPENAI_API_KEY" },
    { name: "google", display: "Google (Gemini)", needsKey: true, defaultModel: "gemini-3.1-pro", envVar: "GOOGLE_API_KEY" },
];
function ask(rl, question) {
    return new Promise((resolve) => rl.question(question, resolve));
}
export async function runSetup() {
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
    const providerConfig = { model: selected.defaultModel };
    if (selected.needsKey) {
        // Check for env var first
        const envValue = selected.envVar ? process.env[selected.envVar] : undefined;
        if (envValue) {
            console.log(chalk.green(`  ✓ Found ${selected.envVar} in environment`));
            providerConfig.apiKey = `{env:${selected.envVar}}`;
        }
        else {
            const key = await ask(rl, chalk.dim(`  API key: `));
            providerConfig.apiKey = key.trim();
        }
    }
    if (selected.name === "ollama") {
        // Try multiple hosts: localhost first, then WSL host IP (for Windows Ollama)
        const hostsToTry = ["http://localhost:11434"];
        // Detect WSL and add the Windows host IP
        try {
            const gateway = execSync("ip route show default 2>/dev/null | awk '{print $3}'", { encoding: "utf-8" }).trim();
            if (gateway) {
                hostsToTry.push(`http://${gateway}:11434`);
            }
        }
        catch { /* not on WSL */ }
        // Also check OLLAMA_HOST env var
        if (process.env.OLLAMA_HOST) {
            const envHost = process.env.OLLAMA_HOST.startsWith("http")
                ? process.env.OLLAMA_HOST
                : `http://${process.env.OLLAMA_HOST}`;
            hostsToTry.unshift(envHost);
        }
        let connectedHost = null;
        let models = [];
        for (const host of hostsToTry) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 3000);
                const response = await globalThis.fetch(`${host}/api/tags`, { signal: controller.signal });
                clearTimeout(timeout);
                if (response.ok) {
                    const data = (await response.json());
                    connectedHost = host;
                    models = data.models || [];
                    break;
                }
            }
            catch {
                continue;
            }
        }
        // Default context length for Ollama — 64K
        providerConfig.contextLength = 65536;
        if (connectedHost) {
            providerConfig.host = connectedHost;
            console.log(chalk.green(`  ✓ Connected to Ollama at ${connectedHost}`));
            console.log(chalk.dim(`  Context window: ${providerConfig.contextLength.toLocaleString()} tokens`));
            if (models.length > 0) {
                console.log(chalk.dim(`  Available models: ${models.map(m => m.name).join(", ")}`));
            }
        }
        else {
            providerConfig.host = "http://localhost:11434";
            console.log(chalk.yellow("  ⚠ Could not connect to Ollama. Make sure it's running."));
            console.log(chalk.dim("    Tried: " + hostsToTry.join(", ")));
        }
    }
    // Ask for model override
    console.log();
    const modelOverride = await ask(rl, chalk.dim(`  Model (press Enter for ${selected.defaultModel}): `));
    if (modelOverride.trim()) {
        providerConfig.model = modelOverride.trim();
    }
    rl.close();
    const config = {
        providers: { [selected.name]: providerConfig },
        default: selected.name,
    };
    saveConfig(config);
    console.log();
    console.log(chalk.green("  ✓ Config saved to ~/.workermill/cli.json"));
    console.log();
    return config;
}
