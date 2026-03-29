/**
 * Unit tests for browser.ts
 *
 * Strategy: mock child_process and logger at the top level, then use
 * vi.mocked().mockImplementation() to vary execSync behaviour per test.
 * For module-level state (chromeProcess, cdpClient) we use vi.resetModules()
 * + vi.doMock() + dynamic import inside each test so every test starts with
 * a fresh module instance where both are null.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Top-level hoisted mocks — these are registered before any module loads.
// ---------------------------------------------------------------------------

vi.mock("child_process", () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => { throw new Error("command not found"); }),
}));

vi.mock("../logger.js", () => ({
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helper: load a fresh copy of browser.ts with the current mock state.
// Must be called after vi.resetModules() + vi.doMock() calls.
// ---------------------------------------------------------------------------
async function freshBrowser() {
  return import("../browser.js");
}

// ---------------------------------------------------------------------------
// Suite helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  vi.resetModules();
  // Re-register mocks after resetModules clears the registry so the fresh
  // dynamic import picks them up.
  vi.doMock("child_process", () => ({
    spawn: vi.fn(),
    execSync: vi.fn(() => { throw new Error("command not found"); }),
  }));
  vi.doMock("../logger.js", () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }));
}

// ---------------------------------------------------------------------------
// Tests: default state (no browser open)
// ---------------------------------------------------------------------------

describe("browser module — no browser open", () => {
  beforeEach(resetMocks);

  it("isBrowserOpen returns false initially", async () => {
    const { isBrowserOpen } = await freshBrowser();
    expect(isBrowserOpen()).toBe(false);
  });

  it("browserNavigate returns 'Browser not open' when not connected", async () => {
    const { browserNavigate } = await freshBrowser();
    const result = await browserNavigate("https://example.com");
    expect(result).toContain("Browser not open");
  });

  it("browserClick returns 'Browser not open' when not connected", async () => {
    const { browserClick } = await freshBrowser();
    const result = await browserClick("#submit-btn");
    expect(result).toContain("Browser not open");
  });

  it("browserFill returns 'Browser not open' when not connected", async () => {
    const { browserFill } = await freshBrowser();
    const result = await browserFill("input[name=email]", "user@example.com");
    expect(result).toContain("Browser not open");
  });

  it("browserEvaluate returns 'Browser not open' when not connected", async () => {
    const { browserEvaluate } = await freshBrowser();
    const result = await browserEvaluate("document.title");
    expect(result).toContain("Browser not open");
  });

  it("browserConsole returns 'Browser not open' when not connected", async () => {
    const { browserConsole } = await freshBrowser();
    const result = await browserConsole();
    expect(result).toContain("Browser not open");
  });

  it("browserScreenshot returns empty base64 and 'Browser not open' when not connected", async () => {
    const { browserScreenshot } = await freshBrowser();
    const result = await browserScreenshot();
    expect(result.base64).toBe("");
    expect(result.description).toContain("Browser not open");
  });

  it("browserClose returns 'Browser closed.' even when no browser is open", async () => {
    const { browserClose } = await freshBrowser();
    const result = await browserClose();
    expect(result).toBe("Browser closed.");
  });
});

// ---------------------------------------------------------------------------
// Tests: browserOpen when Chrome is not installed
// ---------------------------------------------------------------------------

describe("browserOpen — Chrome not found", () => {
  beforeEach(resetMocks);

  it("returns Chrome not found message when no Chrome binary exists", async () => {
    // execSync already throws for everything (default mock) — findChrome returns null
    const { browserOpen } = await freshBrowser();
    const result = await browserOpen();
    expect(result).toMatch(/Chrome.*not found|not found.*Chrome/i);
  });
});

// ---------------------------------------------------------------------------
// Tests: findChrome path scanning via browserOpen side-effect
// ---------------------------------------------------------------------------

describe("findChrome — platform path scanning", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns null (Chrome not found) when execSync throws for every candidate", async () => {
    vi.doMock("child_process", () => ({
      spawn: vi.fn(),
      execSync: vi.fn(() => { throw new Error("command not found"); }),
    }));
    vi.doMock("../logger.js", () => ({
      info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn(),
    }));

    const { browserOpen } = await freshBrowser();
    const result = await browserOpen();
    // findChrome returned null → this specific message
    expect(result).toBe(
      "Chrome/Chromium not found. Install Google Chrome to use browser tools."
    );
  });

  it("proceeds past findChrome when a Chrome candidate is found (spawn called, CDP polling times out)", { timeout: 8000 }, async () => {
    // execSync succeeds for `which google-chrome`, fails for everything else
    const execSyncMock = vi.fn((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("uname")) {
        throw new Error("not WSL");
      }
      if (typeof cmd === "string" && cmd.includes("which") && cmd.includes("google-chrome")) {
        return "/usr/bin/google-chrome\n";
      }
      throw new Error("not found");
    });

    const spawnMock = vi.fn(() => {
      // Return a minimal fake ChildProcess that won't throw
      return {
        pid: 12345,
        kill: vi.fn(),
        on: vi.fn(),
        stdio: "pipe",
        stdout: null,
        stderr: null,
      };
    });

    vi.doMock("child_process", () => ({
      spawn: spawnMock,
      execSync: execSyncMock,
    }));
    vi.doMock("../logger.js", () => ({
      info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn(),
    }));

    // Stub fetch so CDP /json/version polling always fails immediately
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as typeof globalThis.fetch;

    const { browserOpen } = await freshBrowser();
    const result = await browserOpen();

    // findChrome succeeded → spawn was called → CDP polling timed out
    expect(spawnMock).toHaveBeenCalledOnce();
    expect(result).toContain("Failed to connect to Chrome");
  });
});
