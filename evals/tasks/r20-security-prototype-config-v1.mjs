import { pathToFileURL } from "node:url";
import { initialRevision, runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/config.mjs": `export function mergeConfig(defaults, overrides) {
  const result = { ...defaults };
  Object.assign(result, overrides);
  return result;
}
`,
  "src/main.mjs": `import { mergeConfig } from "./config.mjs";
export { mergeConfig } from "./config.mjs";
`,
};

const reference = {
  ...base,
  "src/config.mjs": `const blocked = new Set(["__proto__", "constructor", "prototype"]);

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneRecord(value) {
  if (Array.isArray(value)) return value.map(cloneRecord);
  if (!value || typeof value !== "object") return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("config must contain plain objects");
  const copy = {};
  for (const key of Object.keys(value)) {
    if (blocked.has(key)) throw new Error("reserved config key");
    copy[key] = cloneRecord(value[key]);
  }
  return copy;
}

function mergeRecords(left, right) {
  if (!left || typeof left !== "object" || Array.isArray(left) || !right || typeof right !== "object" || Array.isArray(right)) return right;
  const result = { ...left };
  for (const key of Object.keys(right)) {
    result[key] = left[key] && typeof left[key] === "object" && !Array.isArray(left[key]) && right[key] && typeof right[key] === "object" && !Array.isArray(right[key])
      ? mergeRecords(left[key], right[key])
      : right[key];
  }
  return result;
}

export function mergeConfig(defaults, overrides) {
  try {
    if (!isPlainRecord(defaults) || !isPlainRecord(overrides)) return null;
    return mergeRecords(cloneRecord(defaults), cloneRecord(overrides));
  }
  catch { return null; }
}
`,
};

const incomplete = {
  ...reference,
  "src/config.mjs": reference["src/config.mjs"].replace(
    'const blocked = new Set(["__proto__", "constructor", "prototype"]);',
    'const blocked = new Set(["__proto__"]);',
  ),
};

export const fixture = {
  taskId: "r20-security-prototype-config-v1",
  category: "security",
  initialRevision: initialRevision(base),
  prompt: "Harden configuration merging against prototype-pollution payloads. Require both top-level inputs to be plain records (ordinary or null-prototype objects; reject primitives, arrays, Date, and custom-prototype roots). Recursively reject __proto__, constructor, and prototype keys inside records and arrays, reject Date/custom-prototype nested values, deep-merge legitimate nested records while replacing arrays, and ensure the returned object shares no mutable aliases with either input. Return null for invalid input.",
  workspace: {
    files: base,
    writableFiles: ["src/config.mjs", "src/main.mjs"],
    network: false,
    timeoutMs: 2000,
    toolchain: "Node.js >=22.12; built-in modules only; ESM",
  },
  acceptance: "Untrusted nested configuration cannot alter object prototypes, while safe nested overrides retain defaults and replace arrays predictably.",
  rubric: [
    "Rejects all reserved prototype-pollution keys at any depth (0-3).",
    "Deep-merges plain records and replaces arrays without mutating inputs (0-2).",
    "Rejects non-plain object values and returns a safe failure result (0-1).",
  ],
  referenceFiles: reference,
  incompleteFiles: incomplete,
};

async function accepts(root, mainUrl, timeoutMs) {
  return runNode(root, `import { mergeConfig } from ${JSON.stringify(mainUrl)};
const defaults = {server:{host:"localhost",port:80},features:{safe:true},list:["stable"]};
const safe = {server:{port:8080},features:{beta:true},list:["canary"]};
const before = JSON.stringify(safe);
const merged = mergeConfig(defaults, safe);
if (JSON.stringify(merged) !== JSON.stringify({server:{host:"localhost",port:8080},features:{safe:true,beta:true},list:["canary"]})) process.exit(3);
if (JSON.stringify(safe) !== before || defaults.server.port !== 80) process.exit(3);
safe.server.port = 7070; safe.features.beta = false; safe.list[0] = "changed";
if (merged.server.port !== 8080 || merged.features.beta !== true || merged.list[0] !== "canary") process.exit(3);
merged.server.port = 9090; merged.features.safe = false; merged.list[0] = "output";
if (defaults.server.port !== 80 || defaults.features.safe !== true || defaults.list[0] !== "stable") process.exit(3);
if (safe.server.port !== 7070 || safe.features.beta !== false || safe.list[0] !== "changed") process.exit(3);
for (const key of ["__proto__", "constructor", "prototype"]) {
  const nested = {[key]: {polluted:true}};
  if (mergeConfig(defaults, {features:nested}) !== null) process.exit(3);
  if (mergeConfig(defaults, {features:[nested]}) !== null) process.exit(3);
}
if (Object.prototype.polluted !== undefined) process.exit(3);
const nullRoot = Object.create(null); nullRoot.mode = "safe";
if (mergeConfig(defaults, nullRoot) === null || mergeConfig(nullRoot, nullRoot) === null) process.exit(3);
const custom = Object.create({kind:"custom"}); custom.value = true;
for (const candidate of [[], null, 7, new Date(), custom]) if (mergeConfig(defaults, candidate) !== null || mergeConfig(candidate, defaults) !== null) process.exit(3);
if (mergeConfig(defaults, {features:{when:new Date()}}) !== null) process.exit(3);
if (mergeConfig(defaults, {features:{custom}}) !== null) process.exit(3);`, timeoutMs);
}

export async function validateFixture() {
  return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printValidation(await validateFixture());
