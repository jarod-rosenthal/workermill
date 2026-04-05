import type { CliConfig } from "./config.js";
import type { ModelInfo } from "../../api/src/providers/types.js";
import fs from "fs";
import path from "path";
import os from "os";

export interface RemoteModelInfo extends ModelInfo {
  provider: string;
}

const getModelsUrl = () => process.env.WM_MODELS_URL || "https://workermill.com/api/models.json";

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
 * Fetch remote model catalog from workermill.com/api/models.json
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