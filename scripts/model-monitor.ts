#!/usr/bin/env npx tsx
// scripts/model-monitor.ts
//
// Daily model monitor — detects new models from OpenAI, Google, and Anthropic,
// estimates pricing, and updates pricing engine files.
// Run: npx tsx scripts/model-monitor.ts [--dry-run]

import { fetchOpenAIModels } from "./model-monitor/fetch-openai.js";
import { fetchGoogleModels } from "./model-monitor/fetch-google.js";
import { fetchAnthropicModels } from "./model-monitor/fetch-anthropic.js";
import { buildModelInfo, estimatePricing } from "./model-monitor/pricing-estimator.js";
import {
  extractExistingModelIds,
  insertModels,
  getProviderFilePath,
} from "./model-monitor/file-updater.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { RemoteModel } from "./model-monitor/fetch-openai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Provider definitions — avoids duplicating the same fetch/compare/insert logic 3 times
const PROVIDERS = [
  { name: "openai", envVar: "OPENAI_API_KEY", fetch: fetchOpenAIModels },
  { name: "google", envVar: "GOOGLE_API_KEY", fetch: fetchGoogleModels },
  { name: "anthropic", envVar: "ANTHROPIC_API_KEY", fetch: fetchAnthropicModels },
] as const;

interface NewModel { id: string; provider: string; }

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("=== WorkerMill Model Monitor ===");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log();

  const allNew: NewModel[] = [];
  const updatedFiles: string[] = [];

  for (const provider of PROVIDERS) {
    const apiKey = process.env[provider.envVar];
    if (!apiKey) {
      console.log(`Skipping ${provider.name} (no ${provider.envVar})`);
      continue;
    }

    console.log(`Fetching ${provider.name} models...`);
    const remote: RemoteModel[] = await provider.fetch(apiKey);
    const existing = extractExistingModelIds(provider.name, REPO_ROOT);
    const newModels = remote.filter((m) => !existing.has(m.id));

    console.log(`  Found ${remote.length} remote, ${existing.size} local, ${newModels.length} new`);

    if (newModels.length > 0 && !dryRun) {
      const entries = newModels
        .map((m) => {
          const info = buildModelInfo(m.id, provider.name);
          const estimate = estimatePricing(m.id, provider.name);
          if (!info || !estimate) return null;
          return { info, estimationBasis: estimate.estimationBasis };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);

      if (entries.length > 0) {
        insertModels(provider.name, entries, REPO_ROOT);
        updatedFiles.push(getProviderFilePath(provider.name));
        console.log(`  Added ${entries.length} new ${provider.name} models`);
      }
    }

    for (const m of newModels) allNew.push({ id: m.id, provider: provider.name });
  }

  // --- Summary & GitHub Actions output ---
  console.log();
  const hasChanges = allNew.length > 0;

  if (!hasChanges) {
    console.log("No new models detected. All providers up to date.");
  } else {
    console.log(`Detected ${allNew.length} new model(s):`);
    for (const m of allNew) console.log(`  - [${m.provider}] ${m.id}`);
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_changes=${hasChanges}\n`);
    if (hasChanges) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `new_models=${allNew.map((m) => `${m.provider}/${m.id}`).join(", ")}\n`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `updated_files=${updatedFiles.join(" ")}\n`);
    }
  }
}

main().catch((err) => {
  console.error("Model monitor failed:", err);
  process.exit(1);
});
