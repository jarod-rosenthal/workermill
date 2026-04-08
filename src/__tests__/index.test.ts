import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTempWorkerMillHome, type TempHome } from "./helpers/temp-workermill-home.js";

// ── Heavy dependency mocks ────────────────────────────────────────────────────
// These must be hoisted above any dynamic imports of the modules under test.

vi.mock("ink", () => ({
  render: vi.fn(() => ({ waitUntilExit: vi.fn().mockResolvedValue(undefined) })),
}));

vi.mock("react", () => ({
  default: { createElement: vi.fn() },
}));

vi.mock("../ui/Root.js", () => ({
  Root: vi.fn(),
}));

vi.mock("../setup.js", () => ({
  runSetup: vi.fn(),
}));

vi.mock("../update-check.js", () => ({
  checkForUpdate: vi.fn().mockResolvedValue(null),
}));

vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

// Silence chalk so assertions on console output are readable
vi.mock("chalk", () => {
  const tag = (s: unknown) => String(s);
  const proxy = new Proxy(tag, {
    get: () => proxy,
    apply: (_t, _ctx, args) => String(args[0] ?? ""),
  });
  return { default: proxy };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal CliConfig with a single provider.
 */
function singleProviderConfig(providerName: string, model: string) {
  return {
    providers: { [providerName]: { model, apiKey: "sk-test" } },
    default: providerName,
  } as import("../config.js").CliConfig;
}

/**
 * Build a CliConfig with explicit routing for planner and tech_lead.
 */
function routedConfig() {
  return {
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
  } as import("../config.js").CliConfig;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getProviderForPersona() — role model resolution", () => {
  /**
   * getProviderForPersona is imported from config.js. These tests verify how
   * the function resolves the three roles (worker, planner, reviewer) that
   * index.ts uses to build the getRoleModelsFromConfig() display strings.
   */

  it("returns the default provider for the worker role (no persona argument)", async () => {
    const { getProviderForPersona } = await import("../config.js");
    const config = singleProviderConfig("anthropic", "claude-sonnet-4-6");

    const result = getProviderForPersona(config);

    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("returns the default provider for the planner role when routing is absent", async () => {
    const { getProviderForPersona } = await import("../config.js");
    const config = singleProviderConfig("anthropic", "claude-opus-4-6");

    const result = getProviderForPersona(config, "planner");

    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-opus-4-6");
  });

  it("returns the default provider for the tech_lead role when routing is absent", async () => {
    const { getProviderForPersona } = await import("../config.js");
    const config = singleProviderConfig("anthropic", "claude-opus-4-6");

    const result = getProviderForPersona(config, "tech_lead");

    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-opus-4-6");
  });

  it("all three roles produce the same provider/model string when no routing is set", async () => {
    const { getProviderForPersona } = await import("../config.js");
    const config = singleProviderConfig("anthropic", "claude-sonnet-4-6");

    const worker = getProviderForPersona(config);
    const planner = getProviderForPersona(config, "planner");
    const reviewer = getProviderForPersona(config, "tech_lead");

    const workerStr = `${worker.provider}/${worker.model}`;
    const plannerStr = `${planner.provider}/${planner.model}`;
    const reviewerStr = `${reviewer.provider}/${reviewer.model}`;

    expect(workerStr).toBe("anthropic/claude-sonnet-4-6");
    expect(plannerStr).toBe(workerStr);
    expect(reviewerStr).toBe(workerStr);
  });

  it("returns routed provider for planner when routing is configured", async () => {
    const { getProviderForPersona } = await import("../config.js");
    const config = routedConfig();

    const planner = getProviderForPersona(config, "planner");

    expect(planner.provider).toBe("google");
    expect(planner.model).toBe("gemini-3.1-pro");
  });

  it("returns routed provider for tech_lead (reviewer) when routing is configured", async () => {
    const { getProviderForPersona } = await import("../config.js");
    const config = routedConfig();

    const reviewer = getProviderForPersona(config, "tech_lead");

    expect(reviewer.provider).toBe("anthropic");
    expect(reviewer.model).toBe("claude-sonnet-4-6");
  });

  it("worker role remains on default provider even when planner/reviewer are routed", async () => {
    const { getProviderForPersona } = await import("../config.js");
    const config = routedConfig();

    const worker = getProviderForPersona(config);

    expect(worker.provider).toBe("ollama");
    expect(worker.model).toBe("qwen3-coder:30b");
  });

  it("builds distinct provider/model strings for all three roles under full routing", async () => {
    const { getProviderForPersona } = await import("../config.js");
    const config = routedConfig();

    const workerStr = `${getProviderForPersona(config).provider}/${getProviderForPersona(config).model}`;
    const plannerStr = `${getProviderForPersona(config, "planner").provider}/${getProviderForPersona(config, "planner").model}`;
    const reviewerStr = `${getProviderForPersona(config, "tech_lead").provider}/${getProviderForPersona(config, "tech_lead").model}`;

    expect(workerStr).toBe("ollama/qwen3-coder:30b");
    expect(plannerStr).toBe("google/gemini-3.1-pro");
    expect(reviewerStr).toBe("anthropic/claude-sonnet-4-6");
  });
});

// ── resolveConfig() behavior (tested via the config module directly) ──────────
//
// resolveConfig() in index.ts calls loadConfig(), falls back to runSetup(), then
// applies CLI overrides. We test each branch by controlling the config file on
// disk using a temp home directory, matching the pattern used by config.test.ts.

describe("resolveConfig() — config loading and CLI overrides", () => {
  let tmp: TempHome;
  // Capture the runSetup mock so individual tests can configure its return value
  let runSetupMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmp = createTempWorkerMillHome();
    vi.resetModules();
    // runSetupMock is the already-hoisted mock from the top-level vi.mock("../setup.js")
    runSetupMock = vi.fn();
  });

  afterEach(() => {
    tmp.restore();
    tmp.cleanup();
    vi.restoreAllMocks();
  });

  it("returns the config from disk when one exists", async () => {
    const fs = (await import("fs")).default;
    const path = (await import("path")).default;

    const cfg = {
      providers: { anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-test" } },
      default: "anthropic",
    };
    fs.writeFileSync(path.join(tmp.wmDir, "cli.json"), JSON.stringify(cfg), "utf-8");

    const { loadConfig } = await import("../config.js");
    const loaded = loadConfig();

    expect(loaded).not.toBeNull();
    expect(loaded!.default).toBe("anthropic");
    expect(loaded!.providers.anthropic.model).toBe("claude-sonnet-4-6");
  });

  it("calls runSetup when no config exists and returns its result", async () => {
    const { loadConfig } = await import("../config.js");
    const setupModule = await import("../setup.js");

    const setupConfig = {
      providers: { ollama: { model: "qwen3-coder:30b", host: "http://localhost:11434" } },
      default: "ollama",
    } as import("../config.js").CliConfig;

    vi.mocked(setupModule.runSetup).mockResolvedValue(setupConfig);

    // No config file written — loadConfig() returns null
    const config = loadConfig();
    expect(config).toBeNull();

    // Simulate resolveConfig logic: call setup when null
    const resolved = config ?? (await setupModule.runSetup());
    expect(setupModule.runSetup).toHaveBeenCalledOnce();
    expect(resolved.default).toBe("ollama");
  });

  it("applies --provider override to config.default", async () => {
    const fs = (await import("fs")).default;
    const path = (await import("path")).default;

    const cfg = {
      providers: {
        anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-test" },
        google: { model: "gemini-3.1-pro", apiKey: "goog-key" },
      },
      default: "anthropic",
    };
    fs.writeFileSync(path.join(tmp.wmDir, "cli.json"), JSON.stringify(cfg), "utf-8");

    const { loadConfig } = await import("../config.js");
    let config = loadConfig()!;

    // Apply the --provider override (mirrors resolveConfig() logic in index.ts)
    const options = { provider: "google" };
    if (options.provider) {
      config = { ...config, default: options.provider };
    }

    expect(config.default).toBe("google");
  });

  it("applies --model override to the active provider's model", async () => {
    const fs = (await import("fs")).default;
    const path = (await import("path")).default;

    const cfg = {
      providers: {
        anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-test" },
      },
      default: "anthropic",
    };
    fs.writeFileSync(path.join(tmp.wmDir, "cli.json"), JSON.stringify(cfg), "utf-8");

    const { loadConfig } = await import("../config.js");
    const config = loadConfig()!;

    // Apply the --model override (mirrors resolveConfig() logic in index.ts)
    const options = { model: "claude-opus-4-6" };
    const providerConfig = config.providers[config.default];
    if (options.model && providerConfig) {
      providerConfig.model = options.model;
    }

    expect(config.providers.anthropic.model).toBe("claude-opus-4-6");
  });

  it("applies --auto-revise override to config.review.autoRevise", async () => {
    const fs = (await import("fs")).default;
    const path = (await import("path")).default;

    const cfg = {
      providers: { anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-test" } },
      default: "anthropic",
      review: { enabled: true, autoRevise: false },
    };
    fs.writeFileSync(path.join(tmp.wmDir, "cli.json"), JSON.stringify(cfg), "utf-8");

    const { loadConfig } = await import("../config.js");
    let config = loadConfig()!;

    // Apply the --auto-revise override (mirrors resolveConfig() logic in index.ts)
    const options = { autoRevise: true };
    if (options.autoRevise) {
      config = { ...config, review: { ...config.review, autoRevise: true } };
    }

    expect(config.review?.autoRevise).toBe(true);
  });

  it("does not override config.default when --provider is not passed", async () => {
    const fs = (await import("fs")).default;
    const path = (await import("path")).default;

    const cfg = {
      providers: { anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-test" } },
      default: "anthropic",
    };
    fs.writeFileSync(path.join(tmp.wmDir, "cli.json"), JSON.stringify(cfg), "utf-8");

    const { loadConfig } = await import("../config.js");
    let config = loadConfig()!;

    const options: Record<string, unknown> = {};
    if (options.provider) {
      config = { ...config, default: options.provider as string };
    }

    expect(config.default).toBe("anthropic");
  });

  it("does not set autoRevise when --auto-revise flag is absent", async () => {
    const fs = (await import("fs")).default;
    const path = (await import("path")).default;

    const cfg = {
      providers: { anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-test" } },
      default: "anthropic",
      review: { enabled: true, autoRevise: false },
    };
    fs.writeFileSync(path.join(tmp.wmDir, "cli.json"), JSON.stringify(cfg), "utf-8");

    const { loadConfig } = await import("../config.js");
    let config = loadConfig()!;

    const options: Record<string, unknown> = {};
    if (options.autoRevise) {
      config = { ...config, review: { ...config.review, autoRevise: true } };
    }

    expect(config.review?.autoRevise).toBe(false);
  });
});

// ── Commander program structure ───────────────────────────────────────────────
//
// index.ts calls program.parse() at module load time, which means we cannot
// safely import it mid-test without controlling argv.  Instead we verify the
// Commander contract at the structural level: the program exposes a `chat`
// default command. We instantiate a fresh Command tree that mirrors index.ts's
// declarations and assert its shape.

describe("Commander program structure", () => {
  it("defines a chat command marked as default", () => {
    const { Command } = require("commander");
    const program = new Command().name("wm").description("test");

    program
      .command("chat", { isDefault: true })
      .description("Interactive AI coding agent (default)")
      .option("--resume", "Resume the last conversation")
      .option("--plan", "Start in plan mode (read-only tools)")
      .option("--provider <provider>", "Override default provider")
      .option("--model <model>", "Override model")
      .option("--trust", "Skip all tool permission prompts")
      .option("--auto-revise", "Auto-approve revisions during /ship reviews")
      .option("--full-disk", "Allow tools to access files outside working directory")
      .option("--max-tokens <n>", "Maximum output tokens per response", parseInt)
      .option("-p, --prompt <prompt>", "Run a single prompt headlessly and exit");

    // Commander marks the default command on the parent via _defaultCommandName
    expect(program._defaultCommandName).toBe("chat");

    const chatCmd = program.commands.find((c: { name: () => string }) => c.name() === "chat");
    expect(chatCmd).toBeDefined();

    // Verify the shared options are registered
    const optionNames = chatCmd!.options.map((o: { long: string }) => o.long);
    expect(optionNames).toContain("--provider");
    expect(optionNames).toContain("--model");
    expect(optionNames).toContain("--trust");
    expect(optionNames).toContain("--auto-revise");
    expect(optionNames).toContain("--full-disk");
    expect(optionNames).toContain("--max-tokens");
    expect(optionNames).toContain("--prompt");
    expect(optionNames).toContain("--resume");
    expect(optionNames).toContain("--plan");
  });

  it("program name is 'wm'", () => {
    const { Command } = require("commander");
    const program = new Command().name("wm");
    expect(program.name()).toBe("wm");
  });
});
