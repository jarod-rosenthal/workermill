import { listProviders, fetchLiveModels } from "./provider-registry.js";

/**
 * Run the `wm models` command.
 */
export async function runModelsCommand(
  filter: string | undefined,
  options?: { json?: boolean; provider?: string; available?: boolean }
): Promise<void> {
  const { json = false, provider: filterProvider, available = false } = options ?? {};
  const config = (await import("./config.js")).resolveConfig();

  // Fetch live models in parallel
  const liveModelsPromise = fetchLiveModels(config);

  // Get static models from providers
  const staticProviders = listProviders();
  const staticModels = staticProviders.flatMap(p =>
    p.pricingEngine.getModels().map(m => ({
      provider: p.id,
      id: m.id,
      displayName: m.displayName,
      source: "cloud",
    }))
  );

  // Wait for live models
  const liveModels = await liveModelsPromise;

  // Combine static and live models
  const allModels = [
    ...staticModels.map(m => ({
      provider: m.provider,
      id: m.id,
      displayName: m.displayName,
      source: m.source as "cloud" | "live",
      host: "",
      reachable: true,
    })),
    ...liveModels
      .filter(lm => lm.id) // only include models that were fetched
      .map(lm => ({
        provider: lm.provider,
        id: lm.id,
        displayName: lm.id + " (local)", // live models use id as display name
        source: "live" as const,
        host: lm.host,
        reachable: lm.reachable,
      })),
    ...liveModels
      .filter(lm => !lm.id) // unreachable providers
      .map(lm => ({
        provider: lm.provider,
        id: "(not reachable)",
        displayName: "(not reachable)",
        source: "live" as const,
        host: lm.host,
        reachable: false,
      })),
  ];

  // Apply filters
  let filteredModels = allModels;

  // Filter by provider
  if (filterProvider) {
    filteredModels = filteredModels.filter(m => m.provider === filterProvider);
  }

  // Filter by available (reachable)
  if (available) {
    filteredModels = filteredModels.filter(m => m.reachable);
  }

  // Filter by substring in id or displayName
  if (filter && filter !== "refresh") {
    const lowerFilter = filter.toLowerCase();
    filteredModels = filteredModels.filter(m =>
      m.id.toLowerCase().includes(lowerFilter) ||
      m.displayName.toLowerCase().includes(lowerFilter)
    );
  }

  // Group by provider
  const byProvider = new Map<string, typeof filteredModels>();
  for (const model of filteredModels) {
    if (!byProvider.has(model.provider)) {
      byProvider.set(model.provider, []);
    }
    byProvider.get(model.provider)!.push(model);
  }

  // Sort providers alphabetically
  const sortedProviders = Array.from(byProvider.keys()).sort();

  if (json) {
    // JSON output
    const jsonModels = filteredModels.map(m => ({
      provider: m.provider,
      id: m.id,
      displayName: m.displayName,
      source: m.source,
      ...(m.source === "live" && { host: m.host }),
    }));
    console.log(JSON.stringify(jsonModels, null, 2));
    return;
  }

  // Text output
  if (filteredModels.length === 0) {
    console.log("No models found matching the criteria.");
    return;
  }

  for (const providerId of sortedProviders) {
    const models = byProvider.get(providerId)!;
    const providerConfig = staticProviders.find(p => p.id === providerId);

    // Header
    const isLive = models.some(m => m.source === "live");
    const host = isLive ? models.find(m => m.host)?.host : "";
    const header = host ? `${providerId} (${host}):` : `${providerId}:`;
    console.log(`${header}`);

    // List models sorted alphabetically
    const sortedModels = models.sort((a, b) => a.id.localeCompare(b.id));
    for (const model of sortedModels) {
      const display = model.displayName !== model.id ? `${model.id} (${model.displayName})` : model.id;
      console.log(`  ${display}`);
    }
  }
  console.log();
}