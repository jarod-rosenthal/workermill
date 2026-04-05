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
        displayName: lm.id, // display name same as id; "(local)" added at render time
        source: "live" as const,
        host: lm.host,
        reachable: lm.reachable,
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

  // Track which live providers are configured but unreachable (for text output)
  const unreachableProviders = new Set<string>();
  for (const lm of liveModels) {
    if (!lm.id) unreachableProviders.add(lm.provider);
  }

  if (json) {
    // JSON output — exclude unreachable sentinel entries; only real model IDs
    const jsonModels = filteredModels
      .filter(m => m.reachable)
      .map(m => ({
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
  if (filteredModels.length === 0 && unreachableProviders.size === 0) {
    console.log("No models found matching the criteria.");
    return;
  }

  for (const providerId of sortedProviders) {
    const models = byProvider.get(providerId)!;

    // Header — include host URL for live providers (static models have host: "")
    const liveHost = models.find(m => m.host)?.host;
    const header = liveHost ? `${providerId} (${liveHost}):` : `${providerId}:`;
    console.log(`${header}`);

    // List models sorted alphabetically
    const sortedModels = [...models].sort((a, b) => a.id.localeCompare(b.id));
    for (const model of sortedModels) {
      const display = model.source === "live" ? `${model.id} (local)` : model.id;
      console.log(`  ${display}`);
    }

    // Show unreachable indicator for this provider if configured but unreachable
    if (unreachableProviders.has(providerId) && !models.some(m => m.reachable && m.source === "live")) {
      console.log(`  (not reachable)`);
    }
  }

  // Show unreachable live providers that had no reachable models (may not appear in filteredModels)
  // Skip when --available is set, as we only show reachable models in that mode
  for (const lm of liveModels) {
    if (!lm.id && !byProvider.has(lm.provider) && !available) {
      if (!filterProvider || filterProvider === lm.provider) {
        const header = `${lm.provider} (${lm.host}):`;
        console.log(`${header}`);
        console.log(`  (not reachable)`);
      }
    }
  }

  console.log();
}