import fs from "fs";
import path from "path";
import os from "os";

const CHECK_FILE = path.join(os.homedir(), ".workermill", "last-update-check.json");
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

interface CheckData {
  lastCheck: number;
  latestVersion?: string;
}

/**
 * Check npm registry for a newer version. Returns the latest version string
 * if an update is available, null otherwise. Checks at most once per 24h.
 */
export async function checkForUpdate(currentVersion: string): Promise<string | null> {
  try {
    // Read last check time
    let data: CheckData = { lastCheck: 0 };
    try {
      if (fs.existsSync(CHECK_FILE)) {
        data = JSON.parse(fs.readFileSync(CHECK_FILE, "utf-8"));
      }
    } catch { /* ignore */ }

    // Skip if checked recently
    if (Date.now() - data.lastCheck < CHECK_INTERVAL) {
      if (data.latestVersion && data.latestVersion !== currentVersion) {
        return data.latestVersion;
      }
      return null;
    }

    // Fetch latest version from npm
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await globalThis.fetch("https://registry.npmjs.org/workermill/latest", {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const pkg = (await res.json()) as { version: string };
    const latest = pkg.version;

    // Save check result
    const dir = path.dirname(CHECK_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CHECK_FILE, JSON.stringify({ lastCheck: Date.now(), latestVersion: latest }), "utf-8");

    if (latest !== currentVersion) {
      return latest;
    }
    return null;
  } catch {
    return null; // Network error, npm down, etc. — don't bother the user
  }
}
