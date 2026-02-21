/**
 * esbuild bundler for Docker sandbox image
 *
 * Produces minified, mangled, tree-shaken bundles aligned with agent/build.mjs.
 * Replaces per-file whitespace minification with full IP protection:
 * bundling, tree-shaking, property mangling, and single-file output.
 *
 * Four ESM component bundles (epic, multi-expert, manager, standard) plus
 * individual minification of standalone CJS files (execution scripts, agents).
 */

import { build } from "esbuild";
import {
  rmSync,
  readdirSync,
  statSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "fs";
import { join, resolve } from "path";

// ── Shared config (matches agent/build.mjs exactly) ──────────────────────────
const shared = {
  platform: "node",
  target: "node20",
  format: "esm",
  bundle: true,
  minify: true,
  treeShaking: true,
  mangleProps: /_$/,
  packages: "external",
  legalComments: "none",
  sourcemap: false,
};

// ── Cross-component resolve plugin ───────────────────────────────────────────
// Worker components are siblings under /app/. After tsc, compiled dist/ files
// import ../epic/dist/X.js or ../lib/dist/X.js. From dist/, ../ resolves to
// the component root — not /app/. This plugin redirects ../ imports to /app/.
const crossComponentPlugin = {
  name: "cross-component-resolve",
  setup(build) {
    // Go regex (esbuild) does not support lookahead — filter broadly, check inside
    build.onResolve({ filter: /^\.\.[\\/]/ }, (args) => {
      if (args.path.startsWith("../node_modules")) return undefined;
      return { path: resolve("/app", args.path.replace(/^\.\.\//, "")) };
    });
  },
};

// ── ESM entry point bundles ──────────────────────────────────────────────────
const bundles = [
  {
    name: "epic",
    entry: "/app/epic/dist/index.js",
    out: "/app/epic/dist/index.js",
  },
  {
    name: "multi-expert",
    entry: "/app/multi-expert/dist/index.js",
    out: "/app/multi-expert/dist/index.js",
  },
  {
    name: "manager",
    entry: "/app/manager/dist/index.js",
    out: "/app/manager/dist/index.js",
  },
];

// standard/ has rootDir: ".." → tsc outputs to dist/standard/index.js
const standardEntry = existsSync("/app/standard/dist/standard/index.js")
  ? "/app/standard/dist/standard/index.js"
  : "/app/standard/dist/index.js";
bundles.push({
  name: "standard",
  entry: standardEntry,
  out: "/app/standard/dist/index.js",
});

for (const { name, entry, out } of bundles) {
  await build({
    ...shared,
    entryPoints: [entry],
    outfile: out,
    plugins: [crossComponentPlugin],
    allowOverwrite: true,
  });
  console.log(`✓ ${name} bundled → ${out}`);
}

// Wipe component dist/ dirs, keep only the bundle
for (const comp of ["epic", "multi-expert", "manager", "standard"]) {
  const distDir = `/app/${comp}/dist`;
  const bundleContent = readFileSync(`${distDir}/index.js`);
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  writeFileSync(`${distDir}/index.js`, bundleContent);
}

// ── Standalone files (subprocess-spawned, minify individually) ───────────────
// No format specified — esbuild preserves original CJS/ESM format with bundle:false
const standaloneConfig = {
  platform: "node",
  target: "node20",
  bundle: false,
  minify: true,
  mangleProps: /_$/,
  legalComments: "none",
  sourcemap: false,
  allowOverwrite: true,
};

function collectFiles(dir, exts) {
  const files = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        files.push(...collectFiles(full, exts));
      } else if (exts.some((ext) => entry.endsWith(ext))) {
        files.push(full);
      }
    }
  } catch {
    /* ignore missing dirs */
  }
  return files;
}

for (const dir of ["/app/execution-compiled", "/app/agents", "/app/scripts"]) {
  const files = collectFiles(dir, [".js", ".cjs"]);
  for (const file of files) {
    await build({ ...standaloneConfig, entryPoints: [file], outfile: file });
  }
  if (files.length > 0)
    console.log(`✓ ${files.length} standalone files minified in ${dir}`);
}

// ── Cleanup: remove source, types, maps ──────────────────────────────────────
function removeMatching(dir, predicate) {
  try {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules") continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        removeMatching(full, predicate);
        try {
          if (readdirSync(full).length === 0)
            rmSync(full, { recursive: true });
        } catch {
          /* ignore */
        }
      } else if (predicate(entry)) {
        rmSync(full);
      }
    }
  } catch {
    /* ignore */
  }
}

// Remove type declarations, source maps, tsconfig files
removeMatching("/app", (name) =>
  name.endsWith(".d.ts") ||
  name.endsWith(".d.ts.map") ||
  name.endsWith(".js.map") ||
  (name.startsWith("tsconfig") && name.endsWith(".json")),
);

// Remove TypeScript source directories
for (const dir of [
  "/app/epic/src",
  "/app/multi-expert/src",
  "/app/manager/src",
  "/app/standard/src",
  "/app/lib/src",
  "/app/execution",
]) {
  rmSync(dir, { recursive: true, force: true });
}

// Remove lib/dist (inlined into bundles; checkpoint.sh stays in lib/)
rmSync("/app/lib/dist", { recursive: true, force: true });

// Remove leftover copied directories from old cp -r approach
for (const dir of [
  "/app/epic/lib",
  "/app/multi-expert/lib",
  "/app/multi-expert/epic",
]) {
  rmSync(dir, { recursive: true, force: true });
}

console.log("✓ Docker sandbox bundled and minified (aligned with agent binary)");
