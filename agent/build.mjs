/**
 * esbuild bundler for @workermill/agent
 *
 * Produces single-file bundles for CLI and library entry points,
 * plus worker entry points (epic worker and manager worker).
 *
 * tsc runs first (via package.json "build" script) to generate dist/*.js,
 * then this script re-bundles those into output files and additionally
 * bundles worker code from ../worker/ into dist/worker.js and dist/manager-worker.js.
 */

import { build } from "esbuild";
import { builtinModules } from "module";
import { rmSync, readdirSync, statSync, readFileSync, writeFileSync, renameSync, chmodSync } from "fs";
import { join } from "path";

// Node.js built-in modules must remain external in the unified bundle.
// Both Bun and Node.js runtimes provide these natively. Without this,
// CJS packages (like form-data via axios) get wrapped in a require() shim
// that fails under Node.js ESM ("Dynamic require of X is not supported").
const nodeBuiltins = builtinModules.flatMap((m) => [m, `node:${m}`]);

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

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
  minify: false,
  treeShaking: true,
  // Keep Node builtins external (fs, path, child_process, etc.)
  packages: "external",
  // Preserve license comments from bundled dependencies at end of file
  legalComments: "eof",
  sourcemap: true,
  // Drop console.debug calls (keep console.log/error/warn for user-facing output)
  drop: [],
  define: {
    __AGENT_VERSION__: JSON.stringify(pkg.version),
    __DOCKER_IMAGE_TAG__: JSON.stringify(pkg.version),
  },
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
  banner: { js: "// WorkerMill Worker" },
});
console.log("✓ dist/worker.js bundled from worker/epic/remote-bootstrap.ts");

// Step 4: Bundle manager worker entry point
await build({
  ...shared,
  entryPoints: ["../worker/manager/index.ts"],
  outfile: "dist/manager-worker.js",
  banner: { js: "// WorkerMill Manager" },
});
console.log("✓ dist/manager-worker.js bundled from worker/manager/index.ts");

// Step 4b: Bundle multi-expert worker entry point (for npm fallback path)
await build({
  ...shared,
  entryPoints: ["../worker/multi-expert/index.ts"],
  outfile: "dist/multi-expert-worker.js",
  banner: { js: "// WorkerMill Multi-Expert" },
});
console.log("✓ dist/multi-expert-worker.js bundled from worker/multi-expert/index.ts");

// Step 4c: Bundle AI SDK executor (for npm fallback path)
await build({
  ...shared,
  entryPoints: ["../worker/agents/ai-sdk-executor.js"],
  outfile: "dist/ai-sdk-executor.js",
  banner: { js: "// WorkerMill AI SDK Executor" },
});
console.log("✓ dist/ai-sdk-executor.js bundled from worker/agents/ai-sdk-executor.js");

// Step 5: Bundle unified entry point (for standalone binary compilation)
// Bundles directly from TypeScript source (not tsc output) because the shims
// import from ../../worker/ which is outside tsc's rootDir. esbuild handles TS natively.
// This inlines ALL dependencies (not external) so the binary is self-contained.
//
// The createRequire banner provides a `require` function for Node.js ESM mode.
// CJS packages (form-data via axios) use require() for builtins — esbuild wraps these
// in a shim that checks `typeof require`. In Bun, require is always available.
// In Node.js ESM, it's not — so we create one from import.meta.url.
await build({
  ...shared,
  entryPoints: ["src/entry.ts"],
  outfile: "dist/entry.js",
  packages: undefined, // Override shared.packages: inline ALL npm packages
  external: nodeBuiltins, // Keep Node builtins external (provided by Bun & Node.js runtimes)
  banner: {
    js: `import { createRequire as __createRequire } from "module";
var require = (typeof globalThis.require !== "undefined") ? globalThis.require : __createRequire(import.meta.url);`,
  },
});
console.log("✓ dist/entry.js unified bundle (for binary compilation)");

// Remove all other .js files from dist/ (they're now bundled)
const keepFiles = new Set(["cli.js", "index.js", "worker.js", "manager-worker.js", "multi-expert-worker.js", "ai-sdk-executor.js", "entry.js"]);

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

console.log("✓ Agent bundled");
