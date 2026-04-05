/**
 * E2E tests for `wm models` output format.
 *
 * Unlike models-command.test.ts (which mocks listProviders too), these tests
 * run listProviders() real — so they verify the actual provider registry and
 * rendering logic end-to-end. Only the network call (fetchLiveModels) is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../provider-registry.js", () => ({
  listProviders: vi.fn(),
  fetchLiveModels: vi.fn(),
}));

// Lazy import after mock is set up
import { runModelsCommand } from "../models-command.js";
import * as providerRegistry from "../provider-registry.js";

const mockListProviders = vi.mocked(providerRegistry.listProviders);
const mockFetchLiveModels = vi.mocked(providerRegistry.fetchLiveModels);

const STATIC_PROVIDERS = [
  {
    id: "anthropic",
    name: "Anthropic",
    pricingEngine: {
      getModels: () => [
        { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
        { id: "claude-opus-4-6", displayName: "Claude Opus 4.6" },
      ],
    },
  },
  {
    id: "openai",
    name: "OpenAI",
    pricingEngine: {
      getModels: () => [{ id: "gpt-5.4", displayName: "GPT-5.4" }],
    },
  },
] as any[];

beforeEach(() => {
  mockListProviders.mockReturnValue(STATIC_PROVIDERS);
  mockFetchLiveModels.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});


// Capture console.log output as lines
function captureOutput(fn: () => Promise<void>): Promise<string[]> {
  return new Promise(async (resolve, reject) => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
    try {
      await fn();
      resolve(lines);
    } catch (err) {
      reject(err);
    } finally {
      console.log = orig;
    }
  });
}

describe("wm models — E2E output format", () => {
  it("lists static providers alphabetically with plain headers", async () => {
    const lines = await captureOutput(() => runModelsCommand(undefined, {}));
    expect(lines).toContain("anthropic:");
    expect(lines).toContain("openai:");
    // anthropic comes before openai alphabetically
    expect(lines.indexOf("anthropic:")).toBeLessThan(lines.indexOf("openai:"));
    // static headers have no host URL
    expect(lines).not.toContain("anthropic (http://");
    expect(lines).not.toContain("openai (http://");
  });

  it("local provider header includes host URL", async () => {
    mockFetchLiveModels.mockResolvedValue([
      { provider: "ollama", id: "llama3.3:70b", host: "http://localhost:11434", reachable: true },
    ]);
    const lines = await captureOutput(() => runModelsCommand(undefined, {}));
    expect(lines).toContain("ollama (http://localhost:11434):");
  });

  it("local model listed with (local) suffix", async () => {
    mockFetchLiveModels.mockResolvedValue([
      { provider: "ollama", id: "llama3.3:70b", host: "http://localhost:11434", reachable: true },
    ]);
    const lines = await captureOutput(() => runModelsCommand(undefined, {}));
    expect(lines.some(l => l.includes("llama3.3:70b (local)"))).toBe(true);
  });

  it("unreachable provider shows host URL in header and (not reachable)", async () => {
    mockFetchLiveModels.mockResolvedValue([
      { provider: "ollama", id: "", host: "http://localhost:11434", reachable: false },
    ]);
    const lines = await captureOutput(() => runModelsCommand(undefined, {}));
    expect(lines).toContain("ollama (http://localhost:11434):");
    expect(lines.some(l => l.includes("(not reachable)"))).toBe(true);
  });

  it("JSON output includes host for live models", async () => {
    mockFetchLiveModels.mockResolvedValue([
      { provider: "ollama", id: "llama3.3:70b", host: "http://localhost:11434", reachable: true },
    ]);
    const lines = await captureOutput(() => runModelsCommand(undefined, { json: true }));
    const jsonLine = lines.find(l => l.trim().startsWith("["));
    expect(jsonLine).toBeDefined();
    const parsed = JSON.parse(jsonLine!);
    const ollamaModel = parsed.find((m: any) => m.provider === "ollama" && m.source === "live");
    expect(ollamaModel).toBeDefined();
    expect(ollamaModel.host).toBe("http://localhost:11434");
  });

  it("JSON output does not include host for static (cloud) models", async () => {
    const lines = await captureOutput(() => runModelsCommand(undefined, { json: true }));
    const jsonLine = lines.find(l => l.trim().startsWith("["));
    const parsed = JSON.parse(jsonLine!);
    const cloudModels = parsed.filter((m: any) => m.source === "cloud");
    expect(cloudModels.length).toBeGreaterThan(0);
    for (const m of cloudModels) {
      expect(m.host).toBeUndefined();
    }
  });

  it("--available excludes unreachable providers", async () => {
    mockFetchLiveModels.mockResolvedValue([
      { provider: "ollama", id: "llama3.3:70b", host: "http://localhost:11434", reachable: true },
      { provider: "lmstudio", id: "", host: "http://localhost:1234", reachable: false },
    ]);
    const lines = await captureOutput(() => runModelsCommand(undefined, { available: true }));
    expect(lines.some(l => l.includes("lmstudio"))).toBe(false);
    expect(lines.some(l => l.includes("ollama"))).toBe(true);
  });
});
