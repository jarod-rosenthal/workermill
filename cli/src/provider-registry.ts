import * as providersNamespace from "../../api/src/providers/index.js";

type ProviderModule = typeof import("../../api/src/providers/index.js");

// Cross-runtime compatibility:
// - In some tsx/dev setups this module is seen as CJS (exports under `default`)
// - In others it is native ESM (named exports)
const providers = (
  "getPricingEngine" in providersNamespace
    ? providersNamespace
    : (providersNamespace as unknown as { default: ProviderModule }).default
) as ProviderModule;

export const getPricingEngine: ProviderModule["getPricingEngine"] = (...args) =>
  providers.getPricingEngine(...args);

export const hasProvider: ProviderModule["hasProvider"] = (...args) =>
  providers.hasProvider(...args);

export const listProviders: ProviderModule["listProviders"] = (...args) =>
  providers.listProviders(...args);

export const findModelInfo: ProviderModule["findModelInfo"] = (...args) =>
  providers.findModelInfo(...args);

import type { CliConfig } from "./config.js";

/**
 * Fetch live models from configured providers that support it.
 * Only probes providers that the user has explicitly configured.
 */
export async function fetchLiveModels(config: CliConfig): Promise<Array<{
  provider: string;
  id: string;
  host: string;
  reachable: boolean;
}>> {
  const promises: Promise<Array<{
    provider: string;
    id: string;
    host: string;
    reachable: boolean;
  }>>[] = [];

  // Ollama
  const ollamaHost = config?.providers?.ollama?.host;
  if (ollamaHost) {
    promises.push(fetchOllamaModels(ollamaHost));
  }

  // LM Studio
  const lmHost = config?.providers?.lmstudio?.host;
  if (lmHost) {
    const cleanHost = lmHost.replace(/\/v1\/?$/, "");
    promises.push(fetchLMStudioModels(cleanHost));
  }

  const resultArrays = await Promise.all(promises);
  return resultArrays.flat();
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
