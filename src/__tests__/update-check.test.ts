import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { createTempWorkerMillHome, type TempHome } from "./helpers/temp-workermill-home.js";

// Mock logger to avoid file writes during tests
vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

const CACHE_FILENAME = "last-update-check.json";

describe("update-check", () => {
  let tmp: TempHome;

  beforeEach(() => {
    tmp = createTempWorkerMillHome();
    // Reset module registry so update-check.ts re-evaluates its CHECK_FILE path
    vi.resetModules();
  });

  afterEach(() => {
    tmp.restore();
    tmp.cleanup();
    vi.restoreAllMocks();
  });

  async function importCheckForUpdate() {
    const mod = await import("../update-check.js");
    return mod.checkForUpdate;
  }

  function cacheFile(): string {
    return path.join(tmp.wmDir, CACHE_FILENAME);
  }

  function writeCache(data: { lastCheck: number; latestVersion?: string }): void {
    fs.writeFileSync(cacheFile(), JSON.stringify(data), "utf-8");
  }

  function mockFetch(version: string, ok = true): void {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok,
      json: async () => ({ version }),
    }) as unknown as typeof fetch;
  }

  function mockFetchError(err: Error): void {
    globalThis.fetch = vi.fn().mockRejectedValue(err) as unknown as typeof fetch;
  }

  // -------------------------------------------------------------------
  // isNewer — exercised indirectly via checkForUpdate
  // -------------------------------------------------------------------

  describe("isNewer (via checkForUpdate)", () => {
    it("returns the latest version when npm has a newer patch version", async () => {
      mockFetch("1.0.1");
      const checkForUpdate = await importCheckForUpdate();
      const result = await checkForUpdate("1.0.0");
      expect(result).toBe("1.0.1");
    });

    it("returns the latest version when npm has a newer minor version", async () => {
      mockFetch("1.1.0");
      const checkForUpdate = await importCheckForUpdate();
      const result = await checkForUpdate("1.0.0");
      expect(result).toBe("1.1.0");
    });

    it("returns the latest version when npm has a newer major version", async () => {
      mockFetch("2.0.0");
      const checkForUpdate = await importCheckForUpdate();
      const result = await checkForUpdate("1.9.9");
      expect(result).toBe("2.0.0");
    });

    it("returns null when npm version equals current", async () => {
      mockFetch("1.0.0");
      const checkForUpdate = await importCheckForUpdate();
      const result = await checkForUpdate("1.0.0");
      expect(result).toBeNull();
    });

    it("returns null when npm version is older than current", async () => {
      mockFetch("0.9.0");
      const checkForUpdate = await importCheckForUpdate();
      const result = await checkForUpdate("1.0.0");
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // Cache — fresh, within 24 hours
  // -------------------------------------------------------------------

  describe("cache behaviour (fresh < 24h)", () => {
    it("returns cached version when cache is fresh and update is available", async () => {
      writeCache({ lastCheck: Date.now(), latestVersion: "2.0.0" });
      const checkForUpdate = await importCheckForUpdate();
      // fetch should NOT be called — we expect the cached path
      globalThis.fetch = vi.fn() as unknown as typeof fetch;

      const result = await checkForUpdate("1.0.0");
      expect(result).toBe("2.0.0");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("returns null and skips fetch when fresh cache says current version matches", async () => {
      writeCache({ lastCheck: Date.now(), latestVersion: "1.0.0" });
      const checkForUpdate = await importCheckForUpdate();
      globalThis.fetch = vi.fn() as unknown as typeof fetch;

      const result = await checkForUpdate("1.0.0");
      expect(result).toBeNull();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("fetches when cache is fresh but cached version is older than current (user upgraded)", async () => {
      // Cached version 1.0.0, but current is now 1.5.0 — user has upgraded
      // The fresh-cache guard for same-version doesn't fire; the newer-than-current
      // guard also doesn't fire, so it falls through to fetch.
      mockFetch("1.5.0");
      writeCache({ lastCheck: Date.now(), latestVersion: "1.0.0" });
      const checkForUpdate = await importCheckForUpdate();

      const result = await checkForUpdate("1.5.0");
      // npm says 1.5.0 === current — no update
      expect(result).toBeNull();
      expect(globalThis.fetch).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------
  // Cache — stale, older than 24 hours
  // -------------------------------------------------------------------

  describe("stale cache (> 24h)", () => {
    it("fetches from npm when cache is stale and returns newer version", async () => {
      const stalePast = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
      writeCache({ lastCheck: stalePast, latestVersion: "1.0.0" });
      mockFetch("1.1.0");

      const checkForUpdate = await importCheckForUpdate();
      const result = await checkForUpdate("1.0.0");

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      expect(result).toBe("1.1.0");
    });

    it("fetches from npm when cache is stale even though no update was previously found", async () => {
      const stalePast = Date.now() - 25 * 60 * 60 * 1000;
      writeCache({ lastCheck: stalePast, latestVersion: "1.0.0" });
      mockFetch("1.0.0");

      const checkForUpdate = await importCheckForUpdate();
      const result = await checkForUpdate("1.0.0");

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // Error / fail-safe paths
  // -------------------------------------------------------------------

  describe("error handling", () => {
    it("returns null when fetch throws a network error", async () => {
      mockFetchError(new Error("Network unreachable"));
      const checkForUpdate = await importCheckForUpdate();
      const result = await checkForUpdate("1.0.0");
      expect(result).toBeNull();
    });

    it("returns null when npm registry returns a non-ok HTTP response", async () => {
      mockFetch("", false); // ok = false
      const checkForUpdate = await importCheckForUpdate();
      const result = await checkForUpdate("1.0.0");
      expect(result).toBeNull();
    });

    it("handles a corrupt cache file and fetches fresh data", async () => {
      // Write invalid JSON to the cache file
      fs.writeFileSync(cacheFile(), "{{not json}}", "utf-8");
      mockFetch("1.2.0");

      const checkForUpdate = await importCheckForUpdate();
      const result = await checkForUpdate("1.0.0");

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      expect(result).toBe("1.2.0");
    });

    it("handles a missing cache file and fetches fresh data", async () => {
      // No cache file written — starts from scratch
      mockFetch("1.3.0");
      const checkForUpdate = await importCheckForUpdate();
      const result = await checkForUpdate("1.0.0");

      expect(globalThis.fetch).toHaveBeenCalledOnce();
      expect(result).toBe("1.3.0");
    });
  });

  // -------------------------------------------------------------------
  // Cache persistence after a successful fetch
  // -------------------------------------------------------------------

  describe("cache persistence", () => {
    it("saves cache file after a successful npm fetch", async () => {
      mockFetch("1.5.0");
      const checkForUpdate = await importCheckForUpdate();
      const before = Date.now();
      await checkForUpdate("1.0.0");
      const after = Date.now();

      expect(fs.existsSync(cacheFile())).toBe(true);
      const saved = JSON.parse(fs.readFileSync(cacheFile(), "utf-8"));
      expect(saved.latestVersion).toBe("1.5.0");
      expect(saved.lastCheck).toBeGreaterThanOrEqual(before);
      expect(saved.lastCheck).toBeLessThanOrEqual(after);
    });

    it("overwrites stale cache with fresh data after fetch", async () => {
      const stalePast = Date.now() - 25 * 60 * 60 * 1000;
      writeCache({ lastCheck: stalePast, latestVersion: "0.9.0" });
      mockFetch("2.0.0");

      const checkForUpdate = await importCheckForUpdate();
      await checkForUpdate("1.0.0");

      const saved = JSON.parse(fs.readFileSync(cacheFile(), "utf-8"));
      expect(saved.latestVersion).toBe("2.0.0");
      // Timestamp must have been refreshed
      expect(saved.lastCheck).toBeGreaterThan(stalePast);
    });

    it("does NOT write cache file when fetch fails", async () => {
      mockFetchError(new Error("timeout"));
      const checkForUpdate = await importCheckForUpdate();
      await checkForUpdate("1.0.0");
      expect(fs.existsSync(cacheFile())).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // npm registry URL
  // -------------------------------------------------------------------

  describe("npm registry call", () => {
    it("fetches from the correct npm registry endpoint", async () => {
      mockFetch("1.0.1");
      const checkForUpdate = await importCheckForUpdate();
      await checkForUpdate("1.0.0");

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://registry.npmjs.org/workermill/latest",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });
});
