/**
 * esbuild bundler for @workermill/agent
 *
 * Produces minified, mangled single-file bundles for CLI and library entry points.
 * This replaces the raw tsc output in dist/ with obfuscated code that's harder
 * to reverse-engineer, protecting proprietary planning logic and system architecture.
 *
 * tsc runs first (via package.json "build" script) to generate dist/*.js,
 * then this script re-bundles those into minified output.
 */

import { build } from "esbuild";
import { rmSync, readdirSync, statSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";

// Clean dist/ of .d.ts and .d.ts.map files — we don't publish type definitions
function cleanTypes(dir) {
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        cleanTypes(full);
      } else if (entry.endsWith(".d.ts") || entry.endsWith(".d.ts.map")) {
        rmSync(full);
      }
    }
  } catch {
    // ignore
  }
}

const shared = {
  platform: "node",
  target: "node20",
  format: "esm",
  bundle: true,
  minify: true,
  treeShaking: true,
  // Mangle all non-exported identifiers
  mangleProps: /_$/,
  // Keep Node builtins external (fs, path, child_process, etc.)
  packages: "external",
  // Banner to preserve shebang for CLI entry point
  legalComments: "none",
  sourcemap: false,
  // Drop console.debug calls (keep console.log/error/warn for user-facing output)
  drop: [],
};

// Strip shebang from tsc output before bundling (esbuild treats it as syntax error)
const cliContent = readFileSync("dist/cli.js", "utf-8");
writeFileSync("dist/cli.js", cliContent.replace(/^#!.*\n/, ""), "utf-8");

// Bundle CLI entry point (bin)
await build({
  ...shared,
  entryPoints: ["dist/cli.js"],
  outfile: "dist/cli.bundle.js",
  banner: { js: "#!/usr/bin/env node" },
});

// Bundle library entry point
await build({
  ...shared,
  entryPoints: ["dist/index.js"],
  outfile: "dist/index.bundle.js",
});

// Replace original files with bundles
rmSync("dist/cli.js");
rmSync("dist/index.js");
renameSync("dist/cli.bundle.js", "dist/cli.js");
renameSync("dist/index.bundle.js", "dist/index.js");

// Remove all other .js files (they're now bundled into cli.js and index.js)
function cleanUnbundled(dir) {
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        cleanUnbundled(full);
        // Remove empty directories
        try {
          const remaining = readdirSync(full);
          if (remaining.length === 0) rmSync(full, { recursive: true });
        } catch { /* ignore */ }
      } else if (
        entry.endsWith(".js") &&
        full !== join("dist", "cli.js") &&
        full !== join("dist", "index.js")
      ) {
        rmSync(full);
      }
    }
  } catch {
    // ignore
  }
}

cleanUnbundled("dist");
cleanTypes("dist");

console.log("✓ Agent bundled and minified");
