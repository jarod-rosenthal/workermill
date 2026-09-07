import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/config.mjs": `export function mergeConfig(defaults, overrides) {
  return { ...defaults, ...overrides };
}
`,
  "src/main.mjs": `import { mergeConfig } from "./config.mjs";
export function buildConfig(overrides) { return mergeConfig({ server: { host: "localhost", port: 80 }, tags: ["stable"] }, overrides); }
`,
};
const reference = { ...base, "src/config.mjs": `export function mergeConfig(defaults, overrides) {
  const merge = (left, right) => Object.fromEntries([...new Set([...Object.keys(left), ...Object.keys(right)])].map((key) => {
    const a = left[key], b = right[key];
    return [key, a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b) ? merge(a, b) : (Object.hasOwn(right, key) ? b : a)];
  }));
  return merge(defaults, overrides);
}
` };
const incomplete = { ...reference, "src/config.mjs": reference["src/config.mjs"].replace("!Array.isArray(a) && !Array.isArray(b)", "true") };
function revision(files) { const m = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([p, c]) => `${p}\0${c}`).join("\0"); return `sha256:${createHash("sha256").update(m).digest("hex")}`; }
export const fixture = {
  taskId: "r20-bugfix-deep-config-v1", category: "bugfix", initialRevision: revision(base),
  prompt: "Deep-merge nested configuration objects, but replace arrays and do not mutate either input.",
  workspace: { files: base, writableFiles: ["src/config.mjs"], network: false, timeoutMs: 2000, toolchain: "Node.js >=22.12; built-in modules only; ESM" },
  acceptance: "Nested server overrides retain defaults; arrays are replaced; source objects remain unchanged.",
  rubric: ["Recursively merges plain objects (0-3).", "Replaces arrays rather than concatenating/merging them (0-2).", "Does not mutate inputs (0-1)."], referenceFiles: reference, incompleteFiles: incomplete,
};
async function accepts(root, mainUrl, timeoutMs) {
  const expression = `import { buildConfig } from ${JSON.stringify(mainUrl)};
const input = { server: { port: 8080 }, tags: ["canary"] };
const before = JSON.stringify(input);
const result = buildConfig(input);
if (JSON.stringify(input) !== before) process.exit(3);
if (JSON.stringify(result) !== JSON.stringify({server:{host:"localhost",port:8080},tags:["canary"]})) process.exit(3);
if (JSON.stringify(buildConfig({})) !== JSON.stringify({server:{host:"localhost",port:80},tags:["stable"]})) process.exit(3);`;
  return runNode(root, expression, timeoutMs);
}
export async function validateFixture() { return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts }); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printValidation(await validateFixture());
