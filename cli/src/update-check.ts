import fs from "fs";
import path from "path";
import os from "os";
import * as logger from "./logger.js";

const CHECK_FILE = path.join(os.homedir(), ".workermill", "last-update-check.json");
const CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

interface CheckData {
  lastCheck: number;
  latestVersion?: string;
}

/** Compare semver strings. Returns true if b is newer than a. */
function isNewer(current: string, latest: string): boolean {
  const a = current.split(".").map(Number);
  const b = latest.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((b[i] || 0) > (a[i] || 0)) return true;
    if ((b[i] || 0) < (a[i] || 0)) return false;
  }
  return false;
}

/**
 * Check npm registry for a newer version. Returns the latest version string
 * if an update is available, null otherwise.
 */
export async function checkForUpdate(currentVersion: string): Promise<string | null> {
  try {
    let data: CheckData = { lastCheck: 0 };
    try {
      if (fs.existsSync(CHECK_FILE)) {
        data = JSON.parse(fs.readFileSync(CHECK_FILE, "utf-8"));
      }
    } catch {
      // Corrupt cache — will re-fetch
    }

    // Use cache if fresh AND the cached version is still relevant
    // (i.e., it's newer than current — meaning we already know there's an update)
    const cacheFresh = Date.now() - data.lastCheck < CHECK_INTERVAL;
    if (cacheFresh && data.latestVersion && isNewer(currentVersion, data.latestVersion)) {
      return data.latestVersion;
    }

    // If cache is fresh and no update was found last time, skip the fetch
    // UNLESS the cached version is stale (older than current = user updated)
    if (cacheFresh && data.latestVersion === currentVersion) {
      return null;
    }

    // Fetch from npm
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await globalThis.fetch("https://registry.npmjs.org/workermill/latest", {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const pkg = (await res.json()) as { version: string };
    const latest = pkg.version;

    // Save result
    const dir = path.dirname(CHECK_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CHECK_FILE, JSON.stringify({ lastCheck: Date.now(), latestVersion: latest }), "utf-8");

    if (isNewer(currentVersion, latest)) {
      return latest;
    }
    return null;
  } catch (err) {
    logger.debug("Update check failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
