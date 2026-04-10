import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { detectProjectContext, formatPromptProjectContext } from "../project-context.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wm-project-context-"));
}

describe("project-context", () => {
  it("returns empty prompt context when no recognizable project files exist", () => {
    const dir = makeTempDir();
    try {
      expect(formatPromptProjectContext(dir)).toBe("");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects package manager, stack, scripts, configs, and lsp for a TypeScript repo", () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
        name: "demo",
        packageManager: "pnpm@10.0.0",
        scripts: {
          dev: "vite",
          build: "tsup",
          test: "vitest run",
          typecheck: "tsc --noEmit",
        },
        dependencies: {
          react: "^19.0.0",
          express: "^5.0.0",
        },
        devDependencies: {
          vite: "^7.0.0",
          vitest: "^4.0.0",
        },
      }, null, 2));
      fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'");
      fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}");
      fs.writeFileSync(path.join(dir, "vite.config.ts"), "export default {}");

      const context = detectProjectContext(dir);
      expect(context.packageManager).toBe("pnpm");
      expect(context.manifests).toContain("package.json");
      expect(context.lockfiles).toContain("pnpm-lock.yaml");
      expect(context.frameworks).toEqual(expect.arrayContaining(["React", "Express", "Vite", "Vitest"]));
      expect(context.scripts).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "dev", command: "vite" }),
        expect.objectContaining({ name: "build", command: "tsup" }),
        expect.objectContaining({ name: "test", command: "vitest run" }),
        expect.objectContaining({ name: "typecheck", command: "tsc --noEmit" }),
      ]));
      expect(context.keyConfigs).toEqual(expect.arrayContaining(["tsconfig.json", "vite.config.ts"]));
      expect(context.lsp).toEqual(expect.objectContaining({
        language: "TypeScript",
        status: "available",
      }));

      const promptContext = formatPromptProjectContext(dir);
      expect(promptContext).toContain("## Project Context");
      expect(promptContext).toContain("Package manager: pnpm");
      expect(promptContext).toContain("Detected stack:");
      expect(promptContext).toContain("React");
      expect(promptContext).toContain("Express");
      expect(promptContext).toContain("Vite");
      expect(promptContext).toContain("Vitest");
      expect(promptContext).toContain('dev="vite"');
      expect(promptContext).toContain('typecheck="tsc --noEmit"');
      expect(promptContext).toContain("LSP: TypeScript available");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to lockfile detection when packageManager is not declared", () => {
    const dir = makeTempDir();
    try {
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "demo" }, null, 2));
      fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");

      const context = detectProjectContext(dir);
      expect(context.packageManager).toBe("npm");
      expect(formatPromptProjectContext(dir)).toContain("Package manager: npm");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
