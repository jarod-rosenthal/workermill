import { pathToFileURL } from "node:url";
import { initialRevision, runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/main.mjs": `export function renderRun(run) {
  return { id: run.id, outcome: run.outcome, gateCount: run.gates.length, approved: run.review === "approved" };
}\n`,
};

const reference = {
  ...base,
  "src/report-projection.mjs": `export function projectRun(run) {
  return {
    id: run.id,
    outcome: run.outcome,
    gateCount: run.gates.length,
    approved: run.review === "approved",
  };
}\n`,
  "src/main.mjs": `import { projectRun } from "./report-projection.mjs";

export { projectRun } from "./report-projection.mjs";

export function renderRun(run) {
  return projectRun(run);
}\n`,
};

const incomplete = {
  ...reference,
  "src/report-projection.mjs": reference["src/report-projection.mjs"].replace(
    "gateCount: run.gates.length",
    "gateCount: 0",
  ),
};

export const fixture = {
  taskId: "r20-refactor-report-projection-v1",
  category: "refactor",
  initialRevision: initialRevision(base),
  prompt: `Extract the run report projection into src/report-projection.mjs.

Expose projectRun(run) from src/main.mjs and have renderRun delegate to it. Preserve the public report shape exactly: id and outcome pass through, gateCount is the number of gates, and approved is true only for an approved review. Do not mutate the supplied run record.`,
  workspace: {
    files: base,
    writableFiles: ["src/main.mjs", "src/report-projection.mjs"],
    network: false,
    timeoutMs: 2000,
    toolchain: "Node.js >=22.12; built-in modules only; ESM",
  },
  acceptance: "The extracted projection is a public API and preserves the existing renderer's observable report and input immutability.",
  rubric: [
    "Provides the projectRun API boundary (0-2).",
    "Preserves report fields for approved and non-approved runs (0-3).",
    "Delegates rendering without mutating the supplied record (0-1).",
  ],
  referenceFiles: reference,
  incompleteFiles: incomplete,
};

async function accepts(root, mainUrl, timeoutMs) {
  return runNode(root, `import * as app from ${JSON.stringify(mainUrl)};
if (typeof app.projectRun !== "function") process.exit(3);
const run = {id:"r-7",outcome:"partial",gates:[{id:"lint"},{id:"test"}],review:"rejected"};
const before = JSON.stringify(run); const expected = {id:"r-7",outcome:"partial",gateCount:2,approved:false};
if (JSON.stringify(app.projectRun(run)) !== JSON.stringify(expected)) process.exit(3);
if (JSON.stringify(app.renderRun(run)) !== JSON.stringify(expected) || JSON.stringify(run) !== before) process.exit(3);
if (app.projectRun({...run,gates:[],review:"approved"}).approved !== true) process.exit(3);`, timeoutMs);
}

export async function validateFixture() {
  return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  printValidation(await validateFixture());
}
