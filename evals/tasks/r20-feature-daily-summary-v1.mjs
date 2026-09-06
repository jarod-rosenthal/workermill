import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/summary.mjs": `export function dailySummary(events) { return { total: events.length }; }\n`,
  "src/main.mjs": `import { dailySummary } from "./summary.mjs";
export function dashboard(events) { return dailySummary(events); }\n`,
};
const reference = { ...base, "src/summary.mjs": `export function dailySummary(events) {
  const byType = {};
  for (const event of events) byType[event.type] = (byType[event.type] ?? 0) + 1;
  return { total: events.length, byType };
}\n` };
const incomplete = { ...reference, "src/summary.mjs": reference["src/summary.mjs"].replace("(byType[event.type] ?? 0) + 1", "1") };
function revision(files) { return `sha256:${createHash("sha256").update(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([p, c]) => `${p}\\0${c}`).join("\\0")).digest("hex")}`; }
export const fixture = {
  taskId: "r20-feature-daily-summary-v1", category: "feature", initialRevision: revision(base),
  prompt: "Extend the dashboard's daily summary with a byType count map while retaining total. Empty input must return an empty map, and event objects must not be modified.",
  workspace: { files: base, writableFiles: ["src/summary.mjs"], network: false, timeoutMs: 2000, toolchain: "Node.js >=22.12; built-in modules only; ESM" },
  acceptance: "Dashboard exposes stable totals and per-type counts for empty and repeated event types.",
  rubric: ["Counts each type correctly (0-3).", "Retains total and handles empty input (0-2).", "Preserves caller event objects and wrapper behavior (0-1)."], referenceFiles: reference, incompleteFiles: incomplete,
};
async function accepts(root, mainUrl, timeoutMs) { return runNode(root, `import { dashboard } from ${JSON.stringify(mainUrl)};
const events = [{type:"build"},{type:"test"},{type:"build"}]; const before = JSON.stringify(events);
if (JSON.stringify(dashboard(events)) !== JSON.stringify({total:3,byType:{build:2,test:1}})) process.exit(3);
if (JSON.stringify(dashboard([])) !== JSON.stringify({total:0,byType:{}}) || JSON.stringify(events) !== before) process.exit(3);`, timeoutMs); }
export async function validateFixture() { return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts }); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printValidation(await validateFixture());
