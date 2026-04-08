import { execSync } from "child_process";
import type { CliConfig } from "./config.js";
import * as providersNamespace from "./providers/index.js";

type ProviderModule = typeof import("./providers/index.js");

// Cross-runtime compatibility:
// - In some tsx/dev setups this module is seen as CJS (exports under `default`)
// - In others it is native ESM (named exports)
const providers = (
  "getPricingEngine" in providersNamespace
    ? providersNamespace
    : ("default" in providersNamespace
      ? (Reflect.get(providersNamespace, "default") as ProviderModule | undefined)
      : undefined)
) as ProviderModule;

if (!providers) {
  throw new Error("Provider registry exports are unavailable (missing named/default exports).");
}

export const getPricingEngine: ProviderModule["getPricingEngine"] = (...args) =>
  providers.getPricingEngine(...args);

export const hasProvider: ProviderModule["hasProvider"] = (...args) =>
  providers.hasProvider(...args);

export const listProviders: ProviderModule["listProviders"] = (...args) =>
  providers.listProviders(...args);

export const findModelInfo: ProviderModule["findModelInfo"] = (...args) =>
  providers.findModelInfo(...args);

export { fetchRemoteModels } from "./remote-models.js";

// Default ports for local providers — used by Input.tsx autocomplete to probe
// servers the user hasn't explicitly configured but may have running locally.
const OLLAMA_DEFAULT_HOST = "http://localhost:11434";
const LMSTUDIO_DEFAULT_HOST = "http://localhost:1234";

/** Detect WSL gateway IP for reaching Windows-side services. */
function getWslGatewayIp(): string | undefined {
  try {
    if (process.platform !== "linux") return undefined;
    if (!process.env.WSL_DISTRO_NAME && !process.env.WSL_INTEROP) return undefined;
    const gateway = execSync("ip route show default 2>/dev/null | awk '{print $3}'", { encoding: "utf-8" }).trim();
    return gateway || undefined;
  } catch {
    return undefined;
  }
}

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

  const explicitOllamaHost = config?.providers?.ollama?.host;
  const ollamaConfigured = Boolean(config?.providers?.ollama);
  const rawLmHost = config?.providers?.lmstudio?.host ?? (probeDefaults ? LMSTUDIO_DEFAULT_HOST : undefined);
  const lmHost = rawLmHost?.replace(/\/v1\/?$/, "");

  // Build list of Ollama hosts to probe: explicit config, then defaults.
  // In WSL, also try Windows host via gateway IP (Ollama runs on Windows).
  // Probe defaults when: explicitly asked (probeDefaults) OR ollama is a configured
  // provider but has no host set (user ran setup, wants ollama, just didn't save a host).
  const ollamaHosts: string[] = [];
  if (explicitOllamaHost) {
    ollamaHosts.push(explicitOllamaHost);
  } else if (probeDefaults || ollamaConfigured) {
    ollamaHosts.push(OLLAMA_DEFAULT_HOST);
    const gateway = getWslGatewayIp();
    if (gateway) ollamaHosts.push(`http://${gateway}:11434`);
  }

  const results = await Promise.allSettled([
    (async () => {
      for (const host of ollamaHosts) {
        const models = await fetchOllamaModels(host);
        if (models.some(m => m.reachable)) return models;
      }
      return ollamaHosts.length ? [{ provider: "ollama", id: "", host: ollamaHosts[0], reachable: false }] : [];
    })(),
    lmHost ? fetchLMStudioModels(lmHost) : Promise.resolve([]),
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
