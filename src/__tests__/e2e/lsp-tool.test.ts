import { describe, it, expect, afterAll, beforeAll } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import { execute, shutdown } from "../../engine/tools/lsp.js";

let tempDir: string;
// Real language servers must not be downloaded or contacted by the test suite.
// Protocol/lifecycle coverage uses the local fixture in lsp-run-resources.test.ts.
let lsAvailable = false;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lsp-test-"));

  fs.writeFileSync(
    path.join(tempDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { target: "es2020", module: "esnext", strict: true },
    }),
  );

  fs.writeFileSync(
    path.join(tempDir, "math.ts"),
    `export function add(a: number, b: number): number {
  return a + b;
}

export function divide(a: number, b: number): number {
  return a / b;
}

export const PI: number = 3.14159;
`,
  );

  fs.writeFileSync(
    path.join(tempDir, "app.ts"),
    `import { add } from "./math";

const result: string = add(1, 2);  // Type error: number not assignable to string
console.log(result);
`,
  );

});

afterAll(() => {
  shutdown();
  if (tempDir) {
    // Give the server process time to exit before cleaning up
    setTimeout(() => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    }, 3000);
  }
});

function skipIfNoLS() {
  if (!lsAvailable) {
    console.log("Skipping: no TypeScript language server available");
    return true;
  }
  return false;
}

describe("LSP tool", () => {
  it("returns symbols for a TypeScript file", async () => {
    if (skipIfNoLS()) return;

    const result = await execute(
      { action: "symbols", file: path.join(tempDir, "math.ts") },
      tempDir,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("add");
    expect(result.content).toContain("divide");
    expect(result.content).toContain("PI");
  });

  it("detects type errors via diagnostics", async () => {
    if (skipIfNoLS()) return;

    const result = await execute(
      { action: "diagnostics", file: path.join(tempDir, "app.ts") },
      tempDir,
    );

    expect(result.success).toBe(true);
    // The type error should mention string, number, or assignability
    const content = result.content ?? "";
    const hasTypeError =
      content.includes("string") ||
      content.includes("number") ||
      content.includes("not assignable");
    expect(hasTypeError).toBe(true);
  });

  it("returns definition location", async () => {
    if (skipIfNoLS()) return;

    // Line 3: `const result: string = add(1, 2);`
    // `add` starts at column 24 (1-indexed)
    const result = await execute(
      { action: "definition", file: path.join(tempDir, "app.ts"), line: 3, character: 24 },
      tempDir,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("math.ts");
  });

  it("returns error for non-existent file", async () => {
    const result = await execute(
      { action: "diagnostics", file: "/tmp/does-not-exist-xyz.ts" },
      tempDir,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns error when line/character missing for hover", async () => {
    const result = await execute(
      { action: "hover", file: path.join(tempDir, "math.ts") },
      tempDir,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("requires line and character");
  });

  it("returns symbol references for a symbol name", async () => {
    if (skipIfNoLS()) return;

    const result = await execute(
      { action: "symbol_references", symbol: "add" },
      tempDir,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.content!);
    expect(parsed.lsp_available).toBe(true);
    expect(parsed.symbol).toBe("add");
    expect(parsed.declaration).toBeDefined();
    expect(parsed.declaration.file).toContain("math.ts");
    expect(Array.isArray(parsed.references)).toBe(true);
    // Should have at least the declaration and the usage in app.ts
    expect(parsed.references.length).toBeGreaterThanOrEqual(2);
    expect(parsed.references.some((ref: any) => ref.file.includes("app.ts"))).toBe(true);
  });

  it("returns empty references for non-existent symbol", async () => {
    if (skipIfNoLS()) return;

    const result = await execute(
      { action: "symbol_references", symbol: "nonExistentFunction" },
      tempDir,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.content!);
    expect(parsed.lsp_available).toBe(true);
    expect(parsed.symbol).toBe("nonExistentFunction");
    expect(parsed.references).toEqual([]);
  });
});
