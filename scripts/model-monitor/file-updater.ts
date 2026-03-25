// scripts/model-monitor/file-updater.ts

import fs from "fs";
import path from "path";
import type { ModelInfo } from "./pricing-estimator.js";

const PROVIDER_FILES: Record<string, string> = {
  openai: "api/src/providers/openai/pricing.ts",
  google: "api/src/providers/google/pricing.ts",
  anthropic: "api/src/providers/anthropic/pricing.ts",
};

// Map provider -> the const name of its models record
const RECORD_NAMES: Record<string, string> = {
  openai: "OPENAI_MODELS",
  google: "GOOGLE_MODELS",
  anthropic: "ANTHROPIC_MODELS",
};

/**
 * Extract model IDs currently defined in a pricing.ts file.
 * Handles both quoted keys ("gpt-5.4": {) and unquoted keys (o1: {).
 */
export function extractExistingModelIds(provider: string, repoRoot: string): Set<string> {
  const filePath = path.join(repoRoot, PROVIDER_FILES[provider]);
  if (!fs.existsSync(filePath)) return new Set();

  const content = fs.readFileSync(filePath, "utf-8");
  const ids = new Set<string>();

  // Match quoted keys: "model-id": { and unquoted keys: o1: {
  const regex = /^\s+(?:"([^"]+)"|(\w[\w.-]*))\s*:\s*\{$/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    ids.add(match[1] || match[2]);
  }

  return ids;
}

/**
 * Generate TypeScript code for a new model entry.
 */
function generateModelEntry(model: ModelInfo, estimationBasis: string): string {
  const lines: string[] = [];
  lines.push(`  // ${model.displayName} (auto-detected, estimated pricing)`);
  lines.push(`  // Estimation basis: ${estimationBasis}`);
  lines.push(`  "${model.id}": {`);
  lines.push(`    id: "${model.id}",`);
  lines.push(`    displayName: "${model.displayName}",`);
  lines.push(`    tier: "${model.tier}",`);
  lines.push(`    inputRate: ${model.inputRate}, // $${(model.inputRate * 1000).toFixed(2)} per 1M`);
  lines.push(`    outputRate: ${model.outputRate}, // $${(model.outputRate * 1000).toFixed(2)} per 1M`);
  if (model.cacheWriteRate !== undefined) {
    lines.push(`    cacheWriteRate: ${model.cacheWriteRate}, // $${(model.cacheWriteRate * 1000).toFixed(4)} per 1M`);
  }
  if (model.cacheReadRate !== undefined) {
    lines.push(`    cacheReadRate: ${model.cacheReadRate}, // $${(model.cacheReadRate * 1000).toFixed(4)} per 1M`);
  }
  lines.push(`    contextWindow: ${model.contextWindow},`);
  lines.push(`    supportsStreaming: ${model.supportsStreaming},`);
  lines.push(`    supportsCaching: ${model.supportsCaching},`);
  lines.push(`  },`);
  return lines.join("\n");
}

/**
 * Insert new model entries into a pricing.ts file.
 * Finds the specific *_MODELS record by name, then appends before its closing };.
 */
export function insertModels(
  provider: string,
  models: Array<{ info: ModelInfo; estimationBasis: string }>,
  repoRoot: string,
): boolean {
  const filePath = path.join(repoRoot, PROVIDER_FILES[provider]);
  if (!fs.existsSync(filePath)) return false;

  let content = fs.readFileSync(filePath, "utf-8");
  const recordName = RECORD_NAMES[provider];
  if (!recordName) return false;

  // Find the start of the models record (e.g., "const OPENAI_MODELS")
  const recordStartIdx = content.indexOf(`const ${recordName}`);
  if (recordStartIdx === -1) {
    console.error(`Could not find ${recordName} in ${filePath}`);
    return false;
  }

  // Find the closing }; of this specific record (first }; after the record start)
  const recordEndPattern = /^};\s*$/m;
  const afterStart = content.slice(recordStartIdx);
  const match = recordEndPattern.exec(afterStart);
  if (!match) {
    console.error(`Could not find closing }; for ${recordName} in ${filePath}`);
    return false;
  }

  const entries = models.map((m) => generateModelEntry(m.info, m.estimationBasis)).join("\n");
  const insertPoint = recordStartIdx + match.index;
  content = content.slice(0, insertPoint) + entries + "\n" + content.slice(insertPoint);

  fs.writeFileSync(filePath, content, "utf-8");
  return true;
}

export function getProviderFilePath(provider: string): string {
  return PROVIDER_FILES[provider];
}
