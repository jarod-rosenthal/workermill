import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { createTempDir, cleanupTempDir } from "../helpers/temp-dir.js";
import * as lspTool from "../../tools/lsp.js";

// ---------------------------------------------------------------------------
// Unit tests — no language server required
// ---------------------------------------------------------------------------

describe("lsp tool — unit tests", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempDir("wm-lsp-unit-");
  });

  afterEach(() => {
    lspTool.shutdown();
    cleanupTempDir(dir);
  });

  // ---- Static exports ----

  describe("exports", () => {
    it("has correct name", () => {
      expect(lspTool.name).toBe("lsp");
    });

    it("has a description covering all actions", () => {
      expect(lspTool.description).toContain("diagnostics");
      expect(lspTool.description).toContain("go-to-definition");
      expect(lspTool.description).toContain("find-references");
    });

    it("has correct parameter schema", () => {
      expect(lspTool.parameters.type).toBe("object");
      expect(lspTool.parameters.properties.action.enum).toEqual([
        "diagnostics", "definition", "references", "hover", "symbols",
      ]);
      expect(lspTool.parameters.required).toContain("action");
      expect(lspTool.parameters.required).toContain("file");
    });
  });

  // ---- File not found ----

  it("returns error for missing file", async () => {
    const result = await lspTool.execute(
      { action: "diagnostics", file: "does-not-exist.ts" },
      dir,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("File not found");
  });

  it("includes original path in error", async () => {
    const result = await lspTool.execute(
      { action: "symbols", file: "nonexistent/file.py" },
      dir,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("nonexistent/file.py");
  });

  // ---- Missing position params ----

  it("requires line and character for definition", async () => {
    fs.writeFileSync(path.join(dir, "test.ts"), "const x = 1;");
    const result = await lspTool.execute(
      { action: "definition", file: path.join(dir, "test.ts") },
      dir,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("requires line and character");
  });

  it("requires line and character for references", async () => {
    fs.writeFileSync(path.join(dir, "test.ts"), "const x = 1;");
    const result = await lspTool.execute(
      { action: "references", file: path.join(dir, "test.ts") },
      dir,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("requires line and character");
  });

  it("requires line and character for hover", async () => {
    fs.writeFileSync(path.join(dir, "test.ts"), "const x = 1;");
    const result = await lspTool.execute(
      { action: "hover", file: path.join(dir, "test.ts") },
      dir,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("requires line and character");
  });

  // ---- State helpers ----

  it("isRunning returns false initially", () => {
    expect(lspTool.isRunning()).toBe(false);
  });

  it("getServerLanguage returns null initially", () => {
    expect(lspTool.getServerLanguage()).toBe(null);
  });

  // ---- No language server ----

  it("returns error for project with no recognized markers", async () => {
    fs.writeFileSync(path.join(dir, "random.txt"), "hello");
    const result = await lspTool.execute(
      { action: "diagnostics", file: path.join(dir, "random.txt") },
      dir,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("No language server found");
    expect(result.error).toContain("Install one");
  });

  it("shutdown does not throw when no server is running", () => {
    expect(() => lspTool.shutdown()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Integration tests — requires typescript-language-server (available via npx)
// ---------------------------------------------------------------------------

describe("lsp tool — integration (typescript-language-server)", () => {
  let dir: string;
  let canRun = true;

  beforeEach(() => {
    dir = createTempDir("wm-lsp-integ-");

    // Create a minimal TypeScript project
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
        },
        include: ["*.ts"],
      }),
    );

    // typescript-language-server needs `typescript` in the project's node_modules.
    // In the monorepo, typescript is hoisted to the root node_modules.
    const rootNodeModules = path.resolve(__dirname, "../../../../../node_modules");
    const engineNodeModules = path.resolve(__dirname, "../../../node_modules");
    const nmSource = fs.existsSync(path.join(engineNodeModules, "typescript"))
      ? engineNodeModules
      : fs.existsSync(path.join(rootNodeModules, "typescript"))
        ? rootNodeModules
        : null;
    if (nmSource) {
      fs.symlinkSync(nmSource, path.join(dir, "node_modules"));
    }
  });

  afterEach(() => {
    lspTool.shutdown();
    cleanupTempDir(dir);
  });

  it("detects diagnostics for a file with type errors", { timeout: 30000 }, async () => {
    fs.writeFileSync(
      path.join(dir, "bad.ts"),
      `const x: number = "not a number";\n`,
    );

    const result = await lspTool.execute(
      { action: "diagnostics", file: path.join(dir, "bad.ts") },
      dir,
    );

    expect(result.success).toBe(true);
    expect(lspTool.isRunning()).toBe(true);
    expect(lspTool.getServerLanguage()).toBe("typescript");
    expect(result.content).toMatch(/ERROR|error/i);
    expect(result.content).toMatch(/not assignable|Type.*string/i);
  });

  it("reports clean diagnostics for valid file", { timeout: 30000 }, async () => {
    fs.writeFileSync(
      path.join(dir, "good.ts"),
      `const x: number = 42;\nexport { x };\n`,
    );

    const result = await lspTool.execute(
      { action: "diagnostics", file: path.join(dir, "good.ts") },
      dir,
    );

    expect(result.success).toBe(true);
    expect(result.content).toMatch(/No diagnostics|Diagnostics not available/);
  });

  it("returns symbols for a file", { timeout: 30000 }, async () => {
    fs.writeFileSync(
      path.join(dir, "symbols.ts"),
      `export function greet(name: string): string {\n  return "Hello " + name;\n}\n\nexport const VERSION = "1.0";\n`,
    );

    const result = await lspTool.execute(
      { action: "symbols", file: path.join(dir, "symbols.ts") },
      dir,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("greet");
    expect(result.content).toContain("VERSION");
    expect(result.content).toMatch(/Function|Variable/);
  });

  it("provides hover info for a symbol", { timeout: 30000 }, async () => {
    fs.writeFileSync(
      path.join(dir, "hover.ts"),
      `const greeting: string = "hello";\nconsole.log(greeting);\n`,
    );

    const result = await lspTool.execute(
      { action: "hover", file: path.join(dir, "hover.ts"), line: 1, character: 7 },
      dir,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("string");
  });

  it("finds definition of a symbol", { timeout: 30000 }, async () => {
    fs.writeFileSync(
      path.join(dir, "def.ts"),
      `function add(a: number, b: number): number {\n  return a + b;\n}\nconst result = add(1, 2);\n`,
    );

    const result = await lspTool.execute(
      { action: "definition", file: path.join(dir, "def.ts"), line: 4, character: 16 },
      dir,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Definition");
    expect(result.content).toContain("def.ts:1:");
  });

  it("finds references to a symbol", { timeout: 30000 }, async () => {
    fs.writeFileSync(
      path.join(dir, "refs.ts"),
      `const value = 42;\nconsole.log(value);\nconst doubled = value * 2;\n`,
    );

    const result = await lspTool.execute(
      { action: "references", file: path.join(dir, "refs.ts"), line: 1, character: 7 },
      dir,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("reference(s)");
    expect(result.content).toMatch(/[23] reference/);
  });

  it("recovers after shutdown (re-initializes)", { timeout: 45000 }, async () => {
    fs.writeFileSync(path.join(dir, "crash.ts"), `const x: number = 1;\n`);

    // First call — starts the server
    const result1 = await lspTool.execute(
      { action: "diagnostics", file: path.join(dir, "crash.ts") },
      dir,
    );
    expect(result1.success).toBe(true);
    expect(lspTool.isRunning()).toBe(true);

    // Kill the server
    lspTool.shutdown();
    expect(lspTool.isRunning()).toBe(false);

    // Next call should auto-restart
    const result2 = await lspTool.execute(
      { action: "diagnostics", file: path.join(dir, "crash.ts") },
      dir,
    );
    expect(result2.success).toBe(true);
    expect(lspTool.isRunning()).toBe(true);
  });

  it("detects updated diagnostics after file change", { timeout: 45000 }, async () => {
    const filePath = path.join(dir, "evolve.ts");

    // Start with a type error
    fs.writeFileSync(filePath, `const x: number = "bad";\n`);
    const result1 = await lspTool.execute(
      { action: "diagnostics", file: filePath },
      dir,
    );
    expect(result1.success).toBe(true);
    expect(result1.content).toMatch(/ERROR|error/i);

    // Fix the error
    fs.writeFileSync(filePath, `const x: number = 42;\n`);
    const result2 = await lspTool.execute(
      { action: "diagnostics", file: filePath },
      dir,
    );
    expect(result2.success).toBe(true);
    expect(result2.content).toContain("No diagnostics");
  });
});
