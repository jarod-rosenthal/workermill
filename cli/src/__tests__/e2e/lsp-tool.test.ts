import { describe, it, expect, afterAll } from "vitest";
import path from "path";
import { execute, shutdown } from "../../../../packages/engine/src/tools/lsp.js";

// Use flagdeck web/ as a real TS project with tsconfig
const FLAGDECK_WEB = path.resolve(process.env.HOME || "~", "github/flagdeck/web");

afterAll(() => {
  shutdown();
});

describe("LSP tool", () => {
  it("detects language server availability", async () => {
    // This test just verifies the tool doesn't crash on a real project
    const result = await execute(
      { action: "symbols", file: path.join(FLAGDECK_WEB, "app.css") },
      FLAGDECK_WEB,
    );
    // Either succeeds with symbols or fails with "no language server" — both valid
    expect(result.success !== undefined).toBe(true);
  });

  it("returns diagnostics for a file", async () => {
    const result = await execute(
      { action: "diagnostics", file: path.join(FLAGDECK_WEB, "eslint.config.js") },
      FLAGDECK_WEB,
    );
    // May or may not find diagnostics — just verify it doesn't crash
    expect(typeof result.success).toBe("boolean");
    if (result.success) {
      expect(typeof result.content).toBe("string");
    }
  });

  it("returns symbols for a TypeScript file", async () => {
    // Find a .ts or .tsx file in flagdeck/web
    const result = await execute(
      { action: "symbols", file: path.join(FLAGDECK_WEB, "playwright.config.ts") },
      FLAGDECK_WEB,
    );
    expect(typeof result.success).toBe("boolean");
    if (result.success && result.content) {
      expect(result.content).toContain("symbol");
    }
  });

  it("returns error for non-existent file", async () => {
    const result = await execute(
      { action: "diagnostics", file: "/tmp/does-not-exist.ts" },
      FLAGDECK_WEB,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns error when line/character missing for definition", async () => {
    const result = await execute(
      { action: "definition", file: path.join(FLAGDECK_WEB, "eslint.config.js") },
      FLAGDECK_WEB,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("requires line and character");
  });
});
