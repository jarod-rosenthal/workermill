import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fetchRemoteModels } from "../remote-models";
import type { CliConfig } from "../config.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;
globalThis.fetch = mockFetch;

// Mock fs and path
vi.mock("fs");
vi.mock("path");
vi.mock("os");

// Set up mocks before module import
vi.mocked(path.join).mockImplementation((...args) => args.join("/"));
vi.mocked(os.homedir).mockReturnValue("/mock");

describe("fetchRemoteModels", () => {
  it("function exists", () => {
    expect(typeof fetchRemoteModels).toBe("function");
  });

  const mockConfig: CliConfig = {
    providers: {},
    default: "anthropic",
  };

  const mockConfigDisabled: CliConfig = {
    ...mockConfig,
    disableModelAutoUpdate: true,
  };

  const mockModels = [
    {
      provider: "anthropic",
      id: "claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
      contextWindow: 1000000,
      inputRate: 0.003,
      outputRate: 0.015,
      tier: "balanced",
    },
  ];

  const mockEtag = '"abc123"';
  const cacheDir = "/mock/.workermill";
  const cacheFile = "/mock/.workermill/models-cache.json";

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock fs.existsSync
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array when disabled", async () => {
    const result = await fetchRemoteModels(mockConfigDisabled);
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches fresh data and caches it", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue(mockEtag),
      },
      json: vi.fn().mockResolvedValue(mockModels),
    });

    const result = await fetchRemoteModels(mockConfig);

    expect(mockFetch).toHaveBeenCalledWith("https://workermill.com/api/models.json", expect.any(Object));
    expect(result).toEqual(mockModels);
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      cacheFile,
      JSON.stringify({ models: mockModels, etag: mockEtag }, null, 2) + "\n",
      "utf-8"
    );
  });

  it("uses cached data on 304 Not Modified", async () => {
    const cachedData = { etag: mockEtag, models: mockModels };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedData));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 304,
      headers: {
        get: vi.fn(),
      },
    });

    const result = await fetchRemoteModels(mockConfig);

    expect(mockFetch).toHaveBeenCalledWith("https://workermill.com/api/models.json", {
      headers: { "If-None-Match": mockEtag },
      signal: expect.any(AbortSignal),
    });
    expect(result).toEqual(mockModels);
    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
  });

  it("falls back to cache when fetch fails", async () => {
    const cachedData = { etag: mockEtag, models: mockModels };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedData));

    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await fetchRemoteModels(mockConfig);

    expect(result).toEqual(mockModels);
  });

  it("falls back to empty array when fetch fails and no cache", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await fetchRemoteModels(mockConfig);

    expect(result).toEqual([]);
  });

  it("uses custom URL from env var", async () => {
    process.env.WM_MODELS_URL = "https://custom.url/models.json";

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue(mockEtag),
      },
      json: vi.fn().mockResolvedValue(mockModels),
    });

    await fetchRemoteModels(mockConfig);

    expect(mockFetch).toHaveBeenCalledWith("https://custom.url/models.json", expect.any(Object));

    delete process.env.WM_MODELS_URL;
  });

  it("ignores cache read errors", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("Read error");
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue(mockEtag),
      },
      json: vi.fn().mockResolvedValue(mockModels),
    });

    const result = await fetchRemoteModels(mockConfig);

    expect(result).toEqual(mockModels);
  });

  it("ignores cache write errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue(mockEtag),
      },
      json: vi.fn().mockResolvedValue(mockModels),
    });

    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error("Write error");
    });

    const result = await fetchRemoteModels(mockConfig);

    expect(result).toEqual(mockModels);
    // Should still return the data even if caching fails
  });

  it("times out after 3 seconds", async () => {
    const cachedData = { etag: mockEtag, models: mockModels };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedData));

    // Mock fetch that rejects on abort
    mockFetch.mockImplementation(({ signal }) => {
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Aborted')));
      });
    });

    const result = await fetchRemoteModels(mockConfig);

    expect(result).toEqual(mockModels); // Should fall back to cache
  }, 6000);

  it("bypasses ETag on force refresh", async () => {
    const cachedData = { etag: mockEtag, models: mockModels };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedData));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue(mockEtag),
      },
      json: vi.fn().mockResolvedValue(mockModels),
    });

    await fetchRemoteModels(mockConfig, true);

    expect(mockFetch).toHaveBeenCalledWith("https://workermill.com/api/models.json", {
      headers: {}, // No If-None-Match header
      signal: expect.any(AbortSignal),
    });
  });
});