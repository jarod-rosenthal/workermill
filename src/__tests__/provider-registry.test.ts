import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { fetchRemoteModels, updateModelCatalog } from "../remote-models";
import type { CliConfig } from "../config.js";

const workerStateRoot = process.env.WM_STATE_ROOT;

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;
globalThis.fetch = mockFetch;

// Mock fs and path
vi.mock("fs");
vi.mock("path");
vi.mock("os");

// Set up mocks before module import
function applyPathMocks(): void {
  vi.mocked(path.join).mockImplementation((...args) => args.join("/"));
  vi.mocked(path.resolve).mockImplementation((...args) => args.join("/"));
  vi.mocked(path.isAbsolute).mockImplementation((value) => String(value).startsWith("/"));
  vi.mocked(os.homedir).mockReturnValue("/mock");
}

applyPathMocks();

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

const updatedButSameCountModels = [
  {
    provider: "anthropic",
    id: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6 Updated",
    contextWindow: 1000000,
    inputRate: 0.003,
    outputRate: 0.015,
    tier: "balanced",
  },
];

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

  const mockEtag = '"abc123"';
  const cacheFile = "/mock/.workermill/models-cache.json";

  beforeEach(() => {
    // This fixture intentionally verifies the default ~/.workermill path via
    // the mocked home directory, so temporarily clear the worker override.
    delete process.env.WM_STATE_ROOT;
    vi.clearAllMocks();
    mockFetch.mockReset();
    applyPathMocks();
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
    vi.mocked(fs.writeFileSync).mockReset();
    vi.mocked(fs.mkdirSync).mockReset();

    // Mock fs.existsSync
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    if (workerStateRoot === undefined) delete process.env.WM_STATE_ROOT;
    else process.env.WM_STATE_ROOT = workerStateRoot;
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

    expect(mockFetch).toHaveBeenCalledWith("https://raw.githubusercontent.com/jarod-rosenthal/workermill/main/frontend/public/api/models.json", expect.any(Object));
    expect(result).toEqual(mockModels);
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(writeCall?.[0]).toBe(cacheFile);
    expect(writeCall?.[2]).toBe("utf-8");
    expect(JSON.parse(String(writeCall?.[1]))).toEqual(expect.objectContaining({
      models: mockModels,
      etag: mockEtag,
      source: "https://raw.githubusercontent.com/jarod-rosenthal/workermill/main/frontend/public/api/models.json",
      sourceKind: "remote",
      updatedAt: expect.any(String),
    }));
  });

  it("returns pinned embedded catalog without fetching remote", async () => {
    const cachedData = {
      source: "embedded",
      sourceKind: "embedded",
      models: mockModels,
    };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedData));

    const result = await fetchRemoteModels(mockConfig);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toEqual(mockModels);
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

    expect(mockFetch).toHaveBeenCalledWith("https://raw.githubusercontent.com/jarod-rosenthal/workermill/main/frontend/public/api/models.json", {
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

    expect(mockFetch).toHaveBeenCalledWith("https://raw.githubusercontent.com/jarod-rosenthal/workermill/main/frontend/public/api/models.json", {
      headers: {}, // No If-None-Match header
      signal: expect.any(AbortSignal),
    });
  });
});

describe("updateModelCatalog", () => {
  const cacheFile = "/mock/.workermill/models-cache.json";

  beforeEach(() => {
    delete process.env.WM_STATE_ROOT;
    vi.clearAllMocks();
    mockFetch.mockReset();
    applyPathMocks();
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.readFileSync).mockReset();
    vi.mocked(fs.writeFileSync).mockReset();
    vi.mocked(fs.mkdirSync).mockReset();
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    if (workerStateRoot === undefined) delete process.env.WM_STATE_ROOT;
    else process.env.WM_STATE_ROOT = workerStateRoot;
  });

  it("marks remote updates as updated when content changes but count stays the same", async () => {
    const cachedData = {
      source: "https://raw.githubusercontent.com/jarod-rosenthal/workermill/main/frontend/public/api/models.json",
      sourceKind: "remote",
      etag: '"old"',
      models: mockModels,
    };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedData));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue('"new"'),
      },
      json: vi.fn().mockResolvedValue(updatedButSameCountModels),
    });

    const result = await updateModelCatalog(undefined, false);
    expect(result.status).toBe("updated");
    expect(result.modelsCount).toBe(1);
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(writeCall?.[0]).toBe(cacheFile);
    expect(JSON.parse(String(writeCall?.[1]))).toEqual(expect.objectContaining({
      models: updatedButSameCountModels,
      etag: '"new"',
      sourceKind: "remote",
    }));
  });

  it("fails custom URL updates instead of silently reusing stale cached models", async () => {
    const cachedData = {
      source: "embedded",
      sourceKind: "embedded",
      models: mockModels,
    };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedData));
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await updateModelCatalog("https://example.com/models.json", false);

    expect(result.status).toBe("failed");
    expect(result.modelsCount).toBe(0);
    expect(result.error).toContain("Network error");
    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
  });

  it("persists file-sourced catalogs as a pinned cached source", async () => {
    vi.mocked(fs.existsSync).mockImplementation((file) => String(file).endsWith("/catalog.json"));
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockModels));

    const result = await updateModelCatalog("catalog.json", false);
    expect(result.status).toBe("updated");
    expect(result.source).toBe("catalog.json");
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(writeCall?.[0]).toBe(cacheFile);
    expect(JSON.parse(String(writeCall?.[1]))).toEqual(expect.objectContaining({
      models: mockModels,
      sourceKind: "file",
    }));
    expect(String(JSON.parse(String(writeCall?.[1])).source)).toMatch(/catalog\.json$/);
  });
});
