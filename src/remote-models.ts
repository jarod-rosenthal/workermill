import type { CliConfig } from "./config.js";
import type { ModelInfo } from "./providers/types.js";
import fs from "fs";
import path from "path";
import os from "os";

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

interface CacheData {
  models: RemoteModelInfo[];
  etag?: string;
}

function getConfigDir(): string {
  return path.join(os.homedir(), ".workermill");
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

  const headers: Record<string, string> = {};
  if (!forceRefresh && cache?.etag) {
    headers["If-None-Match"] = cache.etag;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000); // 3 second timeout
    const res = await globalThis.fetch(getModelsUrl(), {
      signal: controller.signal,
      headers
    });
    clearTimeout(timeout);

    if (res.status === 304 && cache) {
      return cache.models;
    }

    if (res.ok) {
      const data = await res.json() as RemoteModelInfo[];
      const etag = res.headers.get("etag") || undefined;
      try {
        saveCache({ models: data, etag });
      } catch {
        // Ignore cache write errors
      }
      return data;
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
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  
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
  const cachedModels = cache?.models || [];
  const cachedEtag = cache?.etag;

  // For custom URLs, don't rely on cached etag since it's only valid for the default URL
  const headers: Record<string, string> = {};
  if (!forceRefresh && cachedEtag) {
    // Only use cached etag if we're fetching from the same default URL
    // Custom URLs bypass etag caching
    const defaultUrl = getModelsUrl();
    if (url === defaultUrl) {
      headers["If-None-Match"] = cachedEtag;
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await globalThis.fetch(url, {
      signal: controller.signal,
      headers
    });
    clearTimeout(timeout);

    if (res.status === 304 && cachedModels.length > 0) {
      return cachedModels;
    }

    if (res.ok) {
      const data = await res.json() as RemoteModelInfo[];
      const etag = res.headers.get("etag") || undefined;
      return data;
    }

    throw new Error(`Failed to fetch from ${url}: HTTP ${res.status}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("abort") || message.includes("fetch")) {
      // Network error - return cached if available
      return cachedModels;
    }
    throw err;
  }
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
  
  let models: RemoteModelInfo[] = [];
  let etag: string | undefined;
  let status: "updated" | "unchanged" | "failed" = "failed";
  let sourceDisplay = source || "default";
  let error: string | undefined;

  try {
    if (source === undefined || source === "remote") {
      // Fetch from default remote source
      const cache = loadCache();
      const headers: Record<string, string> = {};
      if (!force && cache?.etag) {
        headers["If-None-Match"] = cache.etag;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await globalThis.fetch(getModelsUrl(), {
        signal: controller.signal,
        headers
      });
      clearTimeout(timeout);

      if (res.status === 304 && cache?.models) {
        // Not modified - unchanged
        status = "unchanged";
        models = cache.models;
        etag = cache.etag;
        sourceDisplay = "remote (cached)";
      } else if (res.ok) {
        const data = await res.json() as RemoteModelInfo[];
        etag = res.headers.get("etag") || undefined;
        const previousCache = loadCache();
        const previousCount = previousCache?.models?.length || 0;
        
        // Save to cache (only models and etag, per original interface)
        saveCache({ models: data, etag });
        
        // Determine if updated based on different model count
        status = data.length !== previousCount ? "updated" : "unchanged";
        models = data;
        sourceDisplay = "remote";
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } else if (source === "embedded") {
      // Load embedded catalog
      models = loadEmbeddedModels();
      saveCache({ models }); // No etag for embedded
      status = "updated";
      sourceDisplay = "embedded";
    } else if (source.startsWith("http://") || source.startsWith("https://")) {
      // Load from URL
      models = await loadModelsFromUrl(source, force);
      saveCache({ models }); // No etag for custom URLs
      status = "updated";
      sourceDisplay = source;
    } else {
      // Treat as file path
      models = await loadModelsFromFile(source);
      saveCache({ models }); // No etag for file paths
      status = "updated";
      sourceDisplay = source;
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