import { listProviders, fetchLiveModels, fetchRemoteModels } from "./provider-registry.js";
import { updateModelCatalog, type ModelUpdateResult } from "./remote-models.js";
import type { CliConfig } from "./config.js";

interface ModelEntry {
  provider: string;
  id: string;
  displayName: string;
  source: "cloud" | "live";
  host?: string;
  reachable?: boolean;
}

/**
 * Run the `wm models update` command.
 */
export async function runModelsUpdateCommand(
  source?: string,
  options?: { force?: boolean; json?: boolean }
): Promise<void> {
  const { force = false, json = false } = options ?? {};

  try {
    const result: ModelUpdateResult = await updateModelCatalog(source, force);

    if (json) {
      // JSON output for automation
      const output: Record<string, unknown> = {
        status: result.status,
        source: result.source,
        modelsCount: result.modelsCount,
        cacheFile: result.cacheFile,
        updatedAt: result.updatedAt,
      };
      if (result.etag) output.etag = result.etag;
      if (result.error) output.error = result.error;
      console.log(JSON.stringify(output, null, 2));
    } else {
      // Human-readable output
      if (result.status === "updated") {
        console.log(`✓ Model catalog updated from "${result.source}"`);
        console.log(`  Models: ${result.modelsCount}`);
        console.log(`  Cache: ${result.cacheFile}`);
      } else if (result.status === "unchanged") {
        console.log(`✓ Model catalog unchanged (cached from "${result.source}")`);
        console.log(`  Models: ${result.modelsCount}`);
      } else {
        console.log(`✗ Failed to update model catalog`);
        if (result.error) {
          console.log(`  Error: ${result.error}`);
        }
        process.exit(1);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (json) {
      console.log(JSON.stringify({
        status: "failed" as const,
        source: source || "default",
        modelsCount: 0,
        error: message,
      }, null, 2));
    } else {
      console.log(`✗ Error updating model catalog: ${message}`);
    }
    process.exit(1);
  }
}

/**
 * Run the `wm models` command.
 */
export async function runModelsCommand(
  filter: string | undefined,
  options?: { json?: boolean; provider?: string; available?: boolean }
): Promise<void> {
  const { json = false, provider: filterProvider, available = false } = options ?? {};
  const configModule = await import("./config.js");
  let config: CliConfig;
  try {
    config = configModule.resolveConfig();
  } catch {
    // `wm models` should still work without an initialized CLI profile.
    config = ("loadConfig" in configModule ? configModule.loadConfig() : null) ?? { providers: {}, default: "anthropic" };
  }

  // Handle refresh command
  const isRefresh = filter === "refresh";

  // Fetch models in parallel: live, remote, and static
  const [liveModels, remoteModels] = await Promise.all([
    fetchLiveModels(config),
    fetchRemoteModels(config, isRefresh),
  ]);

  // Get static models from providers
  const staticProviders = listProviders();
  const staticModels: ModelEntry[] = staticProviders.flatMap(p =>
    p.pricingEngine.getModels().map(m => ({
      provider: p.id,
      id: m.id,
      displayName: m.displayName,
      source: "cloud" as const,
    }))
  );

  // Merge remote models into static models (remote takes precedence for same provider/id)
  const remoteModelMap = new Map<string, ModelEntry>();
  for (const remoteModel of remoteModels) {
    const key = `${remoteModel.provider}/${remoteModel.id}`;
    remoteModelMap.set(key, {
      provider: remoteModel.provider,
      id: remoteModel.id,
      displayName: remoteModel.displayName,
      source: "cloud",
    });
  }

  const mergedStaticModels: ModelEntry[] = staticModels.map(staticModel => {
    const key = `${staticModel.provider}/${staticModel.id}`;
    return remoteModelMap.get(key) || staticModel;
  });

  // Add any remote models not in static registry
  for (const remoteModel of remoteModels) {
    const key = `${remoteModel.provider}/${remoteModel.id}`;
    if (!mergedStaticModels.some(m => `${m.provider}/${m.id}` === key)) {
      mergedStaticModels.push({
        provider: remoteModel.provider,
        id: remoteModel.id,
        displayName: remoteModel.displayName,
        source: "cloud",
      });
    }
  }

  // Combine merged static and live models
  const allModels = [
    ...mergedStaticModels.map(m => ({
      provider: m.provider,
      id: m.id,
      displayName: m.displayName,
      source: m.source,
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
  const searchFilter = isRefresh ? undefined : filter;
  if (searchFilter) {
    const lowerFilter = searchFilter.toLowerCase();
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
