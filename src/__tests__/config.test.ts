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

    it("maps provider with host to 'openai' (OpenAI-compatible)", async () => {
      const { getProviderForPersona } = await importConfig();
      // Use an unknown provider name — known providers (lmstudio, ollama, etc.) are returned as-is
      const config = {
        providers: {
          custom_endpoint: { model: "local-model", host: "http://localhost:1234", apiKey: "key" },
        },
        default: "custom_endpoint",
      } as any;

      const result = getProviderForPersona(config);
      expect(result.provider).toBe("openai");
      expect(result.model).toBe("local-model");
      expect(result.host).toBe("http://localhost:1234");
    });

    it("strips _planner/_reviewer suffix from known providers", async () => {
      const { getProviderForPersona } = await importConfig();
      const config = {
        providers: {
          anthropic_planner: { model: "claude-opus-4-6", apiKey: "sk-test" },
        },
        default: "anthropic_planner",
      } as any;

      const result = getProviderForPersona(config);
      expect(result.provider).toBe("anthropic");
    });

    it("throws for missing provider referenced by routing", async () => {
      const { getProviderForPersona } = await importConfig();
      const config = {
        providers: {
          ollama: { model: "test", host: "http://localhost:11434" },
        },
        default: "ollama",
        routing: { planner: "nonexistent" },
      } as any;

      expect(() => getProviderForPersona(config, "planner")).toThrow('Provider "nonexistent" not found');
    });

    it("maps role-suffixed xai provider alias to xai", async () => {
      const { getProviderForPersona } = await importConfig();
      const config = {
        providers: {
          xai_tech_lead: { model: "grok-4.20-0309-reasoning", apiKey: "xai-key" },
        },
        default: "xai_tech_lead",
      } as any;

      const result = getProviderForPersona(config);
      expect(result.provider).toBe("xai");
      expect(result.model).toBe("grok-4.20-0309-reasoning");
    });

    it("maps role-suffixed aliases for all OpenAI-compatible providers", async () => {
      const { getProviderForPersona } = await importConfig();

      const cases = [
        { key: "xai_backend_developer", expected: "xai" },
        { key: "groq_frontend_developer", expected: "groq" },
        { key: "deepseek_data_engineer", expected: "deepseek" },
        { key: "mistral_security_engineer", expected: "mistral" },
      ];

      for (const c of cases) {
        const config = {
          providers: {
            [c.key]: { model: "test-model", apiKey: "test-key" },
          },
          default: c.key,
        } as any;

        const result = getProviderForPersona(config);
        expect(result.provider).toBe(c.expected);
      }
    });

    it("inherits host/apiKey/context from base provider for role aliases", async () => {
      const { getProviderForPersona } = await importConfig();
      const config = {
        providers: {
          mycustomai: { model: "base-model", host: "https://my.api.example.com/v1", apiKey: "custom-key", contextLength: 131072 },
          mycustomai_tech_lead: { model: "review-model" },
        },
        default: "mycustomai_tech_lead",
      } as any;

      const result = getProviderForPersona(config);
      expect(result.provider).toBe("openai");
      expect(result.model).toBe("review-model");
      expect(result.host).toBe("https://my.api.example.com/v1");
      expect(result.apiKey).toBe("custom-key");
      expect(result.contextLength).toBe(131072);
    });
  });

  describe("loadProjectConfig()", () => {
    let origCwd: string;
    let projectDir: string;

    beforeEach(() => {
      origCwd = process.cwd();
      projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-project-"));
    });

    afterEach(() => {
      process.chdir(origCwd);
      fs.rmSync(projectDir, { recursive: true, force: true });
    });

    it("returns null when no .workermill/config.json exists", async () => {
      process.chdir(projectDir);
      const { loadProjectConfig } = await importConfig();
      expect(loadProjectConfig()).toBeNull();
    });

    it("loads project config from .workermill/config.json in cwd", async () => {
      const wmDir = path.join(projectDir, ".workermill");
      fs.mkdirSync(wmDir, { recursive: true });
      fs.writeFileSync(
        path.join(wmDir, "config.json"),
        JSON.stringify({ default: "google", providers: { google: { model: "gemini-3.1-pro", apiKey: "gkey" } } }),
        "utf-8",
      );

      process.chdir(projectDir);
      const { loadProjectConfig } = await importConfig();
      const proj = loadProjectConfig();
      expect(proj).not.toBeNull();
      expect(proj!.default).toBe("google");
    });

    it("returns null on invalid project config JSON", async () => {
      const wmDir = path.join(projectDir, ".workermill");
      fs.mkdirSync(wmDir, { recursive: true });
      fs.writeFileSync(path.join(wmDir, "config.json"), "{{bad json", "utf-8");

      process.chdir(projectDir);
      const { loadProjectConfig } = await importConfig();
      expect(loadProjectConfig()).toBeNull();
    });
  });

  describe("resolveConfig()", () => {
    let origCwd: string;
    let projectDir: string;

    beforeEach(() => {
      origCwd = process.cwd();
      projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-resolve-"));
    });

    afterEach(() => {
      process.chdir(origCwd);
      fs.rmSync(projectDir, { recursive: true, force: true });
    });

    it("throws when no global config exists", async () => {
      process.chdir(projectDir);
      const { resolveConfig } = await importConfig();
      expect(() => resolveConfig()).toThrow("No configuration found");
    });

    it("returns global config when no project config", async () => {
      const globalConfig = {
        providers: { ollama: { model: "test-model", host: "http://localhost:11434" } },
        default: "ollama",
      };
      fs.writeFileSync(path.join(tmp.wmDir, "cli.json"), JSON.stringify(globalConfig), "utf-8");

      process.chdir(projectDir);
      const { resolveConfig } = await importConfig();
      const resolved = resolveConfig();
      expect(resolved.default).toBe("ollama");
      expect(resolved.providers.ollama.model).toBe("test-model");
    });

    it("merges project config over global config", async () => {
      const globalConfig = {
        providers: { ollama: { model: "global-model", host: "http://localhost:11434" } },
        default: "ollama",
        routing: { planner: "ollama" },
        review: { enabled: true, maxRevisions: 3 },
      };
      fs.writeFileSync(path.join(tmp.wmDir, "cli.json"), JSON.stringify(globalConfig), "utf-8");

      const wmDir = path.join(projectDir, ".workermill");
      fs.mkdirSync(wmDir, { recursive: true });
      const projectConfig = {
        default: "anthropic",
        providers: { anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-test" } },
        routing: { reviewer: "anthropic" },
        review: { maxRevisions: 5 },
      };
      fs.writeFileSync(path.join(wmDir, "config.json"), JSON.stringify(projectConfig), "utf-8");

      process.chdir(projectDir);
      const { resolveConfig } = await importConfig();
      const resolved = resolveConfig();

      // Project overrides default
      expect(resolved.default).toBe("anthropic");
      // Providers are merged
      expect(resolved.providers.ollama.model).toBe("global-model");
      expect(resolved.providers.anthropic.model).toBe("claude-sonnet-4-6");
      // Routing is merged
      expect(resolved.routing?.planner).toBe("ollama");
      expect(resolved.routing?.reviewer).toBe("anthropic");
      // Review is merged
      expect(resolved.review?.enabled).toBe(true);
      expect(resolved.review?.maxRevisions).toBe(5);
    });

    it("merges hooks arrays (global + project)", async () => {
      const globalConfig = {
        providers: { ollama: { model: "test", host: "http://localhost:11434" } },
        default: "ollama",
        hooks: { pre: [{ command: "lint", tools: ["*"] }] },
      };
      fs.writeFileSync(path.join(tmp.wmDir, "cli.json"), JSON.stringify(globalConfig), "utf-8");

      const wmDir = path.join(projectDir, ".workermill");
      fs.mkdirSync(wmDir, { recursive: true });
      const projectConfig = {
        hooks: { pre: [{ command: "format", tools: ["*"] }], post: [{ command: "test", tools: ["bash"] }] },
      };
      fs.writeFileSync(path.join(wmDir, "config.json"), JSON.stringify(projectConfig), "utf-8");

      process.chdir(projectDir);
      const { resolveConfig } = await importConfig();
      const resolved = resolveConfig();

      // Pre hooks concatenated
      expect(resolved.hooks?.pre?.length).toBe(2);
      expect(resolved.hooks?.pre?.[0].command).toBe("lint");
      expect(resolved.hooks?.pre?.[1].command).toBe("format");
      // Post hooks from project
      expect(resolved.hooks?.post?.length).toBe(1);
    });

    it("includes ticketSystem, jira, and linear from global config", async () => {
      const globalConfig = {
        providers: { ollama: { model: "test", host: "http://localhost:11434" } },
        default: "ollama",
        ticketSystem: "jira",
        jira: { baseUrl: "https://test.atlassian.net", email: "a@b.com", apiToken: "tok" },
      };
      fs.writeFileSync(path.join(tmp.wmDir, "cli.json"), JSON.stringify(globalConfig), "utf-8");

      process.chdir(projectDir);
      const { resolveConfig } = await importConfig();
      const resolved = resolveConfig();
      expect(resolved.ticketSystem).toBe("jira");
      expect(resolved.jira?.baseUrl).toBe("https://test.atlassian.net");
      expect(resolved.jira?.email).toBe("a@b.com");
      expect(resolved.jira?.apiToken).toBe("tok");
    });

    it("project ticketSystem overrides global", async () => {
      const globalConfig = {
        providers: { ollama: { model: "test", host: "http://localhost:11434" } },
        default: "ollama",
        ticketSystem: "jira",
        jira: { baseUrl: "https://test.atlassian.net", email: "a@b.com", apiToken: "tok" },
      };
      fs.writeFileSync(path.join(tmp.wmDir, "cli.json"), JSON.stringify(globalConfig), "utf-8");

      const wmDir = path.join(projectDir, ".workermill");
      fs.mkdirSync(wmDir, { recursive: true });
      fs.writeFileSync(path.join(wmDir, "config.json"), JSON.stringify({ ticketSystem: "github" }), "utf-8");

      process.chdir(projectDir);
      const { resolveConfig } = await importConfig();
      const resolved = resolveConfig();
      expect(resolved.ticketSystem).toBe("github");
    });

    it("defaults ticketSystem to undefined when not configured", async () => {
      const globalConfig = {
        providers: { ollama: { model: "test", host: "http://localhost:11434" } },
        default: "ollama",
      };
      fs.writeFileSync(path.join(tmp.wmDir, "cli.json"), JSON.stringify(globalConfig), "utf-8");

      process.chdir(projectDir);
      const { resolveConfig } = await importConfig();
      const resolved = resolveConfig();
      expect(resolved.ticketSystem).toBeUndefined();
      expect(resolved.jira).toBeUndefined();
      expect(resolved.linear).toBeUndefined();
    });

    it("uses project sandbox setting over global", async () => {
      const globalConfig = {
        providers: { ollama: { model: "test", host: "http://localhost:11434" } },
        default: "ollama",
        sandbox: true,
      };
      fs.writeFileSync(path.join(tmp.wmDir, "cli.json"), JSON.stringify(globalConfig), "utf-8");

      const wmDir = path.join(projectDir, ".workermill");
      fs.mkdirSync(wmDir, { recursive: true });
      fs.writeFileSync(path.join(wmDir, "config.json"), JSON.stringify({ sandbox: false }), "utf-8");

      process.chdir(projectDir);
      const { resolveConfig } = await importConfig();
      const resolved = resolveConfig();
      expect(resolved.sandbox).toBe(false);
    });
  });
});
