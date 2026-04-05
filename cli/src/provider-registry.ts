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

export async function fetchLiveModels(config: import("../config.js").CliConfig): Promise<Array<{
  provider: string;
  id: string;
  displayName: string;
  host?: string;
  source: "live";
}>> {
  const results: Array<{ provider: string; id: string; displayName: string; host?: string; source: "live" }> = [];

  // Ollama
  const ollamaHost = config?.providers?.ollama?.host || "http://localhost:11434";
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 2000);
    const res = await globalThis.fetch(`${ollamaHost}/api/tags`, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (data?.models) {
        for (const m of data.models) {
          results.push({ provider: "ollama", id: m.name, displayName: m.name, host: ollamaHost, source: "live" });
        }
      }
    }
  } catch {
    results.push({ provider: "ollama", id: "(not reachable)", displayName: "(not reachable)", host: ollamaHost, source: "live" });
  }

  // LM Studio
  const lmHost = (config?.providers?.lmstudio?.host?.replace(/\/v1\/?$/, "") || "http://localhost:1234");
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 2000);
    const res = await globalThis.fetch(`${lmHost}/v1/models`, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (data?.data) {
        for (const m of data.data) {
          results.push({ provider: "lmstudio", id: m.id, displayName: m.id, host: lmHost, source: "live" });
        }
      }
    }
  } catch {
    results.push({ provider: "lmstudio", id: "(not reachable)", displayName: "(not reachable)", host: lmHost, source: "live" });
  }

  return results;
}
