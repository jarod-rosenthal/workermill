/**
 * esbuild bundler for @workermill/agent
 *
 * Produces minified, mangled single-file bundles for CLI and library entry points,
 * plus worker entry points (epic worker and manager worker).
 *
 * tsc runs first (via package.json "build" script) to generate dist/*.js,
 * then this script re-bundles those into minified output and additionally
 * bundles worker code from ../worker/ into dist/worker.js and dist/manager-worker.js.
 */

import { build } from "esbuild";
import { rmSync, readdirSync, statSync, readFileSync, writeFileSync, renameSync, chmodSync } from "fs";
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
writeFileSync("dist/cli.js", cliContent.replace(/^***REMOVED***!.*\n/, ""), "utf-8");

// Step 1: Bundle CLI entry point (bin)
await build({
  ...shared,
  entryPoints: ["dist/cli.js"],
  outfile: "dist/cli.bundle.js",
  banner: { js: "***REMOVED***!/usr/bin/env node" },
});

// Step 2: Bundle library entry point
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

// Ensure CLI is executable (npm preserves file permissions from publish)
chmodSync("dist/cli.js", 0o755);

// Step 3: Bundle epic worker entry point (from worker/ source)
await build({
  ...shared,
  entryPoints: ["../worker/epic/remote-bootstrap.ts"],
  outfile: "dist/worker.js",
  banner: { js: "// WorkerMill Worker - minified" },
});
console.log("✓ dist/worker.js bundled from worker/epic/remote-bootstrap.ts");

// Step 4: Bundle manager worker entry point
await build({
  ...shared,
  entryPoints: ["../worker/manager/index.ts"],
  outfile: "dist/manager-worker.js",
  banner: { js: "// WorkerMill Manager - minified" },
});
console.log("✓ dist/manager-worker.js bundled from worker/manager/index.ts");

// Remove all other .js files from dist/ (they're now bundled)
const keepFiles = new Set(["cli.js", "index.js", "worker.js", "manager-worker.js"]);

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
        !keepFiles.has(entry)
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
