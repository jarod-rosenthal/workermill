import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { createTempWorkerMillHome, type TempHome } from "./helpers/temp-workermill-home.js";

// Mock logger to avoid file writes
vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

describe("config", () => {
  let tmp: TempHome;

  beforeEach(() => {
    tmp = createTempWorkerMillHome();
    // Reset module registry so config.ts re-evaluates its path constants
    vi.resetModules();
  });

  afterEach(() => {
    tmp.restore();
    tmp.cleanup();
  });

  async function importConfig() {
    return await import("../config.js");
  }

  describe("loadConfig()", () => {
    it("returns null when no config file exists", async () => {
      const { loadConfig } = await importConfig();
      expect(loadConfig()).toBeNull();
    });

    it("loads config from ~/.workermill/cli.json", async () => {
      const config = {
        providers: {
          ollama: { model: "test-model", host: "http://localhost:11434" },
        },
        default: "ollama",
      };
      fs.writeFileSync(
        path.join(tmp.wmDir, "cli.json"),
        JSON.stringify(config),
        "utf-8",
      );

      const { loadConfig } = await importConfig();
      const loaded = loadConfig();
      expect(loaded).not.toBeNull();
      expect(loaded!.default).toBe("ollama");
      expect(loaded!.providers.ollama.model).toBe("test-model");
    });

    it("returns null on invalid JSON", async () => {
      fs.writeFileSync(
        path.join(tmp.wmDir, "cli.json"),
        "not valid json{{{",
        "utf-8",
      );
      const { loadConfig } = await importConfig();
      expect(loadConfig()).toBeNull();
    });
  });

  describe("saveConfig()", () => {
    it("writes config to disk and round-trips with loadConfig()", async () => {
      const { saveConfig, loadConfig } = await importConfig();

      const config = {
        providers: {
          anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-test" },
        },
        default: "anthropic",
      } as any;

      saveConfig(config);

      const filePath = path.join(tmp.wmDir, "cli.json");
      expect(fs.existsSync(filePath)).toBe(true);

      const loaded = loadConfig();
      expect(loaded).not.toBeNull();
      expect(loaded!.default).toBe("anthropic");
      expect(loaded!.providers.anthropic.model).toBe("claude-sonnet-4-6");
    });
  });

  describe("getProviderForPersona()", () => {
    it("returns default provider when no persona specified", async () => {
      const { getProviderForPersona } = await importConfig();
      const config = {
        providers: {
          ollama: { model: "test-model", host: "http://localhost:11434" },
        },
        default: "ollama",
      } as any;

      const result = getProviderForPersona(config);
      expect(result.provider).toBe("ollama");
      expect(result.model).toBe("test-model");
      expect(result.host).toBe("http://localhost:11434");
    });

    it("uses routing overrides for specific personas", async () => {
      const { getProviderForPersona } = await importConfig();
      const config = {
        providers: {
          ollama: { model: "qwen3-coder:30b", host: "http://localhost:11434" },
          google: { model: "gemini-3.1-pro", apiKey: "goog-key" },
          anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-key" },
        },
        default: "ollama",
        routing: {
          planner: "google",
          tech_lead: "anthropic",
        },
      } as any;

      const planner = getProviderForPersona(config, "planner");
      expect(planner.provider).toBe("google");
      expect(planner.model).toBe("gemini-3.1-pro");

      const techLead = getProviderForPersona(config, "tech_lead");
      expect(techLead.provider).toBe("anthropic");
      expect(techLead.model).toBe("claude-sonnet-4-6");
    });

    it("falls back to default when persona has no routing", async () => {
      const { getProviderForPersona } = await importConfig();
      const config = {
        providers: {
          ollama: { model: "test-model", host: "http://localhost:11434" },
        },
        default: "ollama",
        routing: {},
      } as any;

      const result = getProviderForPersona(config, "frontend_developer");
      expect(result.provider).toBe("ollama");
    });

    it("expands {env:VAR} in apiKey", async () => {
      const { getProviderForPersona } = await importConfig();
      const originalEnv = process.env.TEST_API_KEY;
      process.env.TEST_API_KEY = "secret-key-from-env";

      try {
        const config = {
          providers: {
            anthropic: { model: "claude-sonnet-4-6", apiKey: "{env:TEST_API_KEY}" },
          },
          default: "anthropic",
        } as any;

        const result = getProviderForPersona(config);
        expect(result.apiKey).toBe("secret-key-from-env");
      } finally {
        if (originalEnv === undefined) {
          delete process.env.TEST_API_KEY;
        } else {
          process.env.TEST_API_KEY = originalEnv;
        }
      }
    });

    it("returns undefined for {env:VAR} when env var not set", async () => {
      const { getProviderForPersona } = await importConfig();
      delete process.env.NONEXISTENT_VAR_12345;

      const config = {
        providers: {
          anthropic: { model: "claude-sonnet-4-6", apiKey: "{env:NONEXISTENT_VAR_12345}" },
        },
        default: "anthropic",
      } as any;

      const result = getProviderForPersona(config);
      expect(result.apiKey).toBeUndefined();
    });

    it("throws when provider not found", async () => {
      const { getProviderForPersona } = await importConfig();
      const config = {
        providers: {},
        default: "nonexistent",
      } as any;

      expect(() => getProviderForPersona(config)).toThrow('Provider "nonexistent" not found');
    });

    it("returns contextLength when configured", async () => {
      const { getProviderForPersona } = await importConfig();
      const config = {
        providers: {
          ollama: { model: "test", host: "http://localhost:11434", contextLength: 65536 },
        },
        default: "ollama",
      } as any;

      const result = getProviderForPersona(config);
      expect(result.contextLength).toBe(65536);
    });
  });
});
