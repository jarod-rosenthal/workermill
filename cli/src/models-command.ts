import { loadConfig } from "./config.js";
import { listProviders, fetchLiveModels } from "./provider-registry.js";

export async function runModelsCommand(filter: string | undefined, options: { json: boolean; provider?: string; available?: boolean; refresh?: boolean }) {
  const config = loadConfig();
  if (!config) {
    console.error("No config found. Run `workermill` to set up.");
    return;
  }

  // Get static models
  const staticModels = listProviders().flatMap(p =>
    p.pricingEngine.getModels().map(m => ({
      provider: p.id,
      id: m.id,
      displayName: m.displayName,
      source: "static" as const,
    }))
  );

  // Get live models
  const liveModels = await fetchLiveModels(config);

  // Merge all models
  let models = [...staticModels, ...liveModels];

  // Apply filter
  if (filter && filter !== "refresh") {
    models = models.filter(m =>
      m.id.toLowerCase().includes(filter.toLowerCase()) ||
      m.displayName.toLowerCase().includes(filter.toLowerCase())
    );
  }

  // Apply provider filter
  if (options.provider) {
    models = models.filter(m => m.provider === options.provider);
  }

  // Apply available filter
  if (options.available) {
    models = models.filter(m => m.source === "static" || m.id !== "(not reachable)");
  }

  if (options.json) {
    const jsonModels = models.map(m => ({
      provider: m.provider,
      id: m.id,
      displayName: m.displayName,
      source: m.source,
      ...(m.host && { host: m.host }),
    }));
    console.log(JSON.stringify(jsonModels, null, 2));
  } else {
    // Group by provider
    const grouped = new Map<string, typeof models>();
    for (const m of models) {
      if (!grouped.has(m.provider)) grouped.set(m.provider, []);
      grouped.get(m.provider)!.push(m);
    }

    // Sort providers alphabetically
    const sortedProviders = Array.from(grouped.keys()).sort();

    for (const provider of sortedProviders) {
      const ms = grouped.get(provider)!.sort((a, b) => a.id.localeCompare(b.id));
      const host = ms.find(m => m.host)?.host;
      console.log(`${provider}${host ? `  (${host})` : ""}`);
      for (const m of ms) {
        if (m.id === "(not reachable)") {
          console.log(`    (not reachable)`);
        } else {
          const display = m.source === "live" ? "local" : m.displayName;
          console.log(`    ${m.id.padEnd(26)} ${display}`);
        }
      }
      console.log();
    }
  }
}