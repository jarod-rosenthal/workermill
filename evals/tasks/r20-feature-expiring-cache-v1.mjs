import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/cache.mjs": `export function createCache() { const values = new Map(); return { set(key, value) { values.set(key, value); }, get(key) { return values.get(key); } }; }\n`,
  "src/main.mjs": `import { createCache } from "./cache.mjs";
export function createSessionCache() { return createCache(); }\n`,
};
const reference = { ...base, "src/cache.mjs": `export function createCache(now = () => Date.now()) {
  const values = new Map();
  return {
    set(key, value, ttlMs) { values.set(key, { value, expiresAt: now() + ttlMs }); },
    get(key) { const entry = values.get(key); if (!entry || entry.expiresAt <= now()) { values.delete(key); return undefined; } return entry.value; },
  };
}\n`, "src/main.mjs": `import { createCache } from "./cache.mjs";
export function createSessionCache(now) { return createCache(now); }\n` };
const incomplete = { ...reference, "src/cache.mjs": reference["src/cache.mjs"].replace("entry.expiresAt <= now()", "entry.expiresAt < now()") };
function revision(files) { return `sha256:${createHash("sha256").update(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([p, c]) => `${p}\\0${c}`).join("\\0")).digest("hex")}`; }
export const fixture = {
  taskId: "r20-feature-expiring-cache-v1", category: "feature", initialRevision: revision(base),
  prompt: "Add TTL support to the session cache. set(key, value, ttlMs) must expire entries at the TTL boundary; get must return undefined and remove expired entries. Allow createSessionCache to receive an optional clock for deterministic callers.",
  workspace: { files: base, writableFiles: ["src/cache.mjs", "src/main.mjs"], network: false, timeoutMs: 2000, toolchain: "Node.js >=22.12; built-in modules only; ESM" },
  acceptance: "TTL values are available before expiry, absent at expiry, and use the injected clock through the public factory.",
  rubric: ["Implements expiry and cleanup (0-3).", "Uses the public factory's optional clock (0-2).", "Touches only the declared two-file dependency (0-1)."], referenceFiles: reference, incompleteFiles: incomplete,
};
async function accepts(root, mainUrl, timeoutMs) { return runNode(root, `import { createSessionCache } from ${JSON.stringify(mainUrl)};
let time = 100; const cache = createSessionCache(() => time); cache.set("token", "ok", 50);
if (cache.get("token") !== "ok") process.exit(3); time = 150;
if (cache.get("token") !== undefined || cache.get("token") !== undefined) process.exit(3);`, timeoutMs); }
export async function validateFixture() { return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts }); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printValidation(await validateFixture());
