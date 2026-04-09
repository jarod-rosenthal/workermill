import type { CliConfig } from "./config.js";
import type { ModelInfo } from "./providers/types.js";
import fs from "fs";
import path from "path";
import { getStateRoot } from "./state-root.js";

export interface RemoteModelInfo extends ModelInfo {
  provider: string;
}

const getModelsUrl = () =>
  process.env.WM_MODELS_URL ||
  "https://raw.githubusercontent.com/jarod-rosenthal/workermill/main/frontend/public/api/models.json";

// Embedded fallback model catalog (minimal set for offline/controlled environments)
const EMBEDDED_CATALOG: RemoteModelInfo[] = [
  {
    id: "anthropic/claude-3-5-sonnet-latest",
    displayName: "Claude 3.5 Sonnet",
    provider: "anthropic",
    tier: "powerful",
    inputRate: 3.0,
    outputRate: 15.0,
    contextWindow: 200000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  {
    id: "anthropic/claude-3-haiku-20240307",
    displayName: "Claude 3 Haiku",
    provider: "anthropic",
    tier: "budget",
    inputRate: 0.25,
    outputRate: 1.25,
    contextWindow: 200000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  {
    id: "openai/gpt-4o",
    displayName: "GPT-4o",
    provider: "openai",
    tier: "powerful",
    inputRate: 5.0,
    outputRate: 15.0,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  {
    id: "openai/gpt-4-turbo",
    displayName: "GPT-4 Turbo",
    provider: "openai",
    tier: "powerful",
    inputRate: 10.0,
    outputRate: 30.0,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  {
    id: "openai/gpt-3.5-turbo",
    displayName: "GPT-3.5 Turbo",
    provider: "openai",
    tier: "budget",
    inputRate: 0.5,
    outputRate: 1.5,
    contextWindow: 16385,
    supportsStreaming: true,
    supportsCaching: false,
  },
  {
    id: "google/gemini-2.0-flash",
    displayName: "Gemini 2.0 Flash",
    provider: "google",
    tier: "balanced",
    inputRate: 0.1,
    outputRate: 0.4,
    contextWindow: 1048576,
    supportsStreaming: true,
    supportsCaching: false,
  },
  {
    id: "google/gemini-1.5-flash",
    displayName: "Gemini 1.5 Flash",
    provider: "google",
    tier: "budget",
    inputRate: 0.075,
    outputRate: 0.3,
    contextWindow: 1048576,
    supportsStreaming: true,
    supportsCaching: false,
  },
  {
    id: "google/gemini-1.5-pro",
    displayName: "Gemini 1.5 Pro",
    provider: "google",
    tier: "powerful",
    inputRate: 3.5,
    outputRate: 10.5,
    contextWindow: 1048576,
    supportsStreaming: true,
    supportsCaching: false,
  },
  {
    id: "xai/grok-2",
    displayName: "Grok-2",
    provider: "xai",
    tier: "balanced",
    inputRate: 2.0,
    outputRate: 2.0,
    contextWindow: 131072,
    supportsStreaming: true,
    supportsCaching: false,
  },
  {
    id: "cohere/command-r-plus",
    displayName: "Command R+",
    provider: "cohere",
    tier: "balanced",
    inputRate: 3.0,
    outputRate: 3.0,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
];

export interface ModelUpdateResult {
  status: "updated" | "unchanged" | "failed";
  source: string;
  modelsCount: number;
  etag?: string;
  cacheFile: string;
  updatedAt: string;
  error?: string;
}

type CatalogSourceKind = "remote" | "url" | "file" | "embedded";

interface CacheData {
  models: RemoteModelInfo[];
  etag?: string;
  source?: string;
  sourceKind?: CatalogSourceKind;
  updatedAt?: string;
}

function getConfigDir(): string {
  return getStateRoot();
}

function getCacheFile(): string {
  return path.join(getConfigDir(), "models-cache.json");
}

function loadCache(): CacheData | null {
  try {
    const cacheFile = getCacheFile();
    if (!fs.existsSync(cacheFile)) return null;
    const raw = fs.readFileSync(cacheFile, "utf-8");
    return JSON.parse(raw) as CacheData;
  } catch {
    return null;
  }
}

function saveCache(data: CacheData): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  const cacheFile = getCacheFile();
  fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function getDefaultRemoteSource(): string {
  return getModelsUrl();
}

function getCacheSource(cache: CacheData | null): { kind: CatalogSourceKind; source: string } {
  if (cache?.sourceKind && cache.source) {
    return { kind: cache.sourceKind, source: cache.source };
  }
  return { kind: "remote", source: getDefaultRemoteSource() };
}

function catalogsEqual(a: RemoteModelInfo[] | undefined, b: RemoteModelInfo[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

function isUrlSource(source: string): boolean {
  return source.startsWith("http://") || source.startsWith("https://");
}

function normalizeFileSource(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

interface UrlFetchResult {
  models: RemoteModelInfo[];
  etag?: string;
  notModified: boolean;
}

async function fetchCatalogFromUrl(
  url: string,
  options?: { force?: boolean; etag?: string },
): Promise<UrlFetchResult> {
  const { force = false, etag } = options ?? {};
  const headers: Record<string, string> = {};
  if (!force && etag) {
    headers["If-None-Match"] = etag;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await globalThis.fetch(url, {
      signal: controller.signal,
      headers,
    });

    if (res.status === 304) {
      return { models: [], etag, notModified: true };
    }

    if (!res.ok) {
      throw new Error(`Failed to fetch from ${url}: HTTP ${res.status}`);
    }

    const models = await res.json() as RemoteModelInfo[];
    return {
      models,
      etag: res.headers.get("etag") || undefined,
      notModified: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function saveCatalogCache(data: {
  models: RemoteModelInfo[];
  etag?: string;
  source: string;
  sourceKind: CatalogSourceKind;
  updatedAt: string;
}): void {
  saveCache({
    models: data.models,
    etag: data.etag,
    source: data.source,
    sourceKind: data.sourceKind,
    updatedAt: data.updatedAt,
  });
}

/**
 * Fetch remote model catalog from GitHub (jarod-rosenthal/workermill)
 * with ETag-based caching. Returns models or empty array on failure.
 * Non-blocking — start the fetch but don't await it at startup.
 */
export async function fetchRemoteModels(config: CliConfig, forceRefresh = false): Promise<RemoteModelInfo[]> {
  if (config.disableModelAutoUpdate) {
    return [];
  }

  const cache = loadCache();
  const cacheSource = getCacheSource(cache);

  if (cacheSource.kind === "embedded" || cacheSource.kind === "file") {
    return cache?.models || [];
  }

  try {
    const result = await fetchCatalogFromUrl(cacheSource.source, {
      force: forceRefresh,
      etag: cache?.etag,
    });

    if (result.notModified && cache) {
      return cache.models;
    }

    if (result.models.length > 0) {
      try {
        saveCatalogCache({
          models: result.models,
          etag: result.etag,
          source: cacheSource.source,
          sourceKind: cacheSource.kind,
          updatedAt: new Date().toISOString(),
        });
      } catch {
        // Ignore cache write errors
      }
      return result.models;
    }
  } catch {
    // On error, return cached if available
  }

  return cache?.models || [];
}

/**
 * Load model catalog from a local file path.
 */
export async function loadModelsFromFile(filePath: string): Promise<RemoteModelInfo[]> {
  const absolutePath = normalizeFileSource(filePath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, "utf-8");
  const data = JSON.parse(raw) as RemoteModelInfo[];

  // Validate structure
  if (!Array.isArray(data)) {
    throw new Error("Invalid catalog format: expected array of models");
  }

  for (const model of data) {
    if (!model.id || !model.provider) {
      throw new Error(`Invalid model entry: missing id or provider. Got: ${JSON.stringify(model)}`);
    }
  }

  return data;
}

/**
 * Load model catalog from a remote URL.
 */
export async function loadModelsFromUrl(url: string, forceRefresh = false): Promise<RemoteModelInfo[]> {
  const cache = loadCache();
  const result = await fetchCatalogFromUrl(url, {
    force: forceRefresh,
    etag: cache?.sourceKind === "url" && cache.source === url ? cache.etag : undefined,
  });
  return result.notModified ? (cache?.models || []) : result.models;
}

/**
 * Load the embedded fallback catalog.
 */
export function loadEmbeddedModels(): RemoteModelInfo[] {
  return [...EMBEDDED_CATALOG];
}

/**
 * Update model catalog from a specified source and save to cache.
 * 
 * @param source - Source identifier: 'embedded', a URL, or a file path
 * @param force - Bypass cache/etag checks
 * @returns Result object with status and metadata
 */
export async function updateModelCatalog(source: string | undefined, force: boolean = false): Promise<ModelUpdateResult> {
  const cacheFile = getCacheFile();
  const now = new Date().toISOString();
  const previousCache = loadCache();
  const previousSource = getCacheSource(previousCache);
  
  let models: RemoteModelInfo[] = [];
  let etag: string | undefined;
  let status: "updated" | "unchanged" | "failed" = "failed";
  let sourceDisplay = source || "default";
  let error: string | undefined;

  try {
    if (source === undefined || source === "remote") {
      const remoteSource = getDefaultRemoteSource();
      const result = await fetchCatalogFromUrl(remoteSource, {
        force,
        etag: previousSource.kind === "remote" ? previousCache?.etag : undefined,
      });
      sourceDisplay = "remote";

      if (result.notModified && previousCache?.models) {
        status = "unchanged";
        models = previousCache.models;
        etag = previousCache.etag;
      } else {
        models = result.models;
        etag = result.etag;
        status =
          previousSource.kind === "remote" &&
          previousSource.source === remoteSource &&
          catalogsEqual(previousCache?.models, models)
            ? "unchanged"
            : "updated";
        saveCatalogCache({
          models,
          etag,
          source: remoteSource,
          sourceKind: "remote",
          updatedAt: now,
        });
      }
    } else if (source === "embedded") {
      models = loadEmbeddedModels();
      sourceDisplay = "embedded";
      status =
        previousSource.kind === "embedded" &&
        catalogsEqual(previousCache?.models, models)
          ? "unchanged"
          : "updated";
      saveCatalogCache({
        models,
        source: "embedded",
        sourceKind: "embedded",
        updatedAt: now,
      });
    } else if (isUrlSource(source)) {
      const result = await fetchCatalogFromUrl(source, {
        force,
        etag: previousSource.kind === "url" && previousSource.source === source ? previousCache?.etag : undefined,
      });
      sourceDisplay = source;

      if (result.notModified && previousCache?.models && previousSource.kind === "url" && previousSource.source === source) {
        status = "unchanged";
        models = previousCache.models;
        etag = previousCache.etag;
      } else {
        models = result.models;
        etag = result.etag;
        status =
          previousSource.kind === "url" &&
          previousSource.source === source &&
          catalogsEqual(previousCache?.models, models)
            ? "unchanged"
            : "updated";
        saveCatalogCache({
          models,
          etag,
          source,
          sourceKind: "url",
          updatedAt: now,
        });
      }
    } else {
      const normalizedSource = normalizeFileSource(source);
      models = await loadModelsFromFile(normalizedSource);
      sourceDisplay = source;
      status =
        previousSource.kind === "file" &&
        previousSource.source === normalizedSource &&
        catalogsEqual(previousCache?.models, models)
          ? "unchanged"
          : "updated";
      saveCatalogCache({
        models,
        source: normalizedSource,
        sourceKind: "file",
        updatedAt: now,
      });
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    status = "failed";
  }

  return {
    status,
    source: sourceDisplay,
    modelsCount: models.length,
    etag,
    cacheFile,
    updatedAt: now,
    error,
  };
}
