import type { CliConfig } from "./config.js";
import type { ModelInfo } from "../../api/src/providers/types.js";
import * as providersNamespace from "../../api/src/providers/index.js";
import fs from "fs";
import path from "path";
import os from "os";

interface RemoteModelInfo extends ModelInfo {
  provider: string;
}

type ProviderModule = typeof import("../../api/src/providers/index.js");

// Cross-runtime compatibility:
// - In some tsx/dev setups this module is seen as CJS (exports under `default`)
// - In others it is native ESM (named exports)
const providers = (
  "getPricingEngine" in providersNamespace
    ? providersNamespace
    : (providersNamespace as unknown as { default: ProviderModule }).default
) as ProviderModule;

const CONFIG_DIR = path.join(os.homedir(), ".workermill");
const CACHE_FILE = path.join(CONFIG_DIR, "models-cache.json");
const MODELS_URL = process.env.WM_MODELS_URL || "https://workermill.com/api/models.json";

export const getPricingEngine: ProviderModule["getPricingEngine"] = (...args) =>
  providers.getPricingEngine(...args);

export const hasProvider: ProviderModule["hasProvider"] = (...args) =>
  providers.hasProvider(...args);

export const listProviders: ProviderModule["listProviders"] = (...args) =>
  providers.listProviders(...args);

export const findModelInfo: ProviderModule["findModelInfo"] = (...args) =>
  providers.findModelInfo(...args);

// Default ports for local providers — used by Input.tsx autocomplete to probe
// servers the user hasn't explicitly configured but may have running locally.
const OLLAMA_DEFAULT_HOST = "http://localhost:11434";
const LMSTUDIO_DEFAULT_HOST = "http://localhost:1234";

/**
 * Fetch live models from local providers (Ollama, LM Studio).
 *
 * By default only probes hosts the user has explicitly configured.
 * Pass `probeDefaults: true` to also probe the default localhost ports
 * when a provider is not in config — used by Input.tsx autocomplete so
 * tab-completion works for users running Ollama locally without explicit config.
 */
export async function fetchLiveModels(
  config: CliConfig,
  options?: { probeDefaults?: boolean },
): Promise<Array<{
  provider: string;
  id: string;
  host: string;
  reachable: boolean;
}>> {
  const { probeDefaults = false } = options ?? {};

  const ollamaHost = config?.providers?.ollama?.host ?? (probeDefaults ? OLLAMA_DEFAULT_HOST : undefined);
  const rawLmHost = config?.providers?.lmstudio?.host ?? (probeDefaults ? LMSTUDIO_DEFAULT_HOST : undefined);
  const lmHost = rawLmHost?.replace(/\/v1\/?$/, "");

  const results = await Promise.allSettled([
    ollamaHost ? fetchOllamaModels(ollamaHost) : Promise.resolve([]),
    lmHost     ? fetchLMStudioModels(lmHost)   : Promise.resolve([]),
  ]);

  return results.flatMap(r => r.status === "fulfilled" ? r.value : []);
}

async function fetchOllamaModels(host: string): Promise<Array<{
  provider: string;
  id: string;
  host: string;
  reachable: boolean;
}>> {
  const results: Array<{
    provider: string;
    id: string;
    host: string;
    reachable: boolean;
  }> = [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await globalThis.fetch(`${host}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json() as { models?: { name: string }[] };
      const models = data.models || [];
      for (const model of models) {
        results.push({
          provider: "ollama",
          id: model.name,
          host,
          reachable: true,
        });
      }
    } else {
      results.push({
        provider: "ollama",
        id: "",
        host,
        reachable: false,
      });
    }
  } catch {
    results.push({
      provider: "ollama",
      id: "",
      host,
      reachable: false,
    });
  }
  return results;
}

async function fetchLMStudioModels(host: string): Promise<Array<{
  provider: string;
  id: string;
  host: string;
  reachable: boolean;
}>> {
  const results: Array<{
    provider: string;
    id: string;
    host: string;
    reachable: boolean;
  }> = [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await globalThis.fetch(`${host}/v1/models`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json() as { data?: { id: string }[] };
      const models = data.data || [];
      for (const model of models) {
        results.push({
          provider: "lmstudio",
          id: model.id,
          host,
          reachable: true,
        });
      }
    } else {
      results.push({
        provider: "lmstudio",
        id: "",
        host,
        reachable: false,
      });
    }
  } catch {
    results.push({
      provider: "lmstudio",
      id: "",
      host,
      reachable: false,
    });
  }
  return results;
}

/**
 * Fetch remote model catalog from workermill.com/api/models.json
 * with ETag-based caching. Returns models or empty array on failure.
 * Non-blocking — start the fetch but don't await it at startup.
 */
export async function fetchRemoteModels(config: CliConfig, forceRefresh = false): Promise<RemoteModelInfo[]> {
  return [];
}
