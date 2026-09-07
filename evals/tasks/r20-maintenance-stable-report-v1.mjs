import { pathToFileURL } from "node:url";
import { initialRevision, runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/report.mjs": `export function summarizeResults(results) {
  return {
    total: results.length,
    passed: results.filter((result) => Boolean(result.ok)).length,
    failed: results.filter((result) => !result.ok).length,
    cases: results,
  };
}
`,
  "src/main.mjs": `import { summarizeResults } from "./report.mjs";
export { summarizeResults } from "./report.mjs";
`,
};

const reference = {
  ...base,
  "src/report.mjs": `export function summarizeResults(results) {
  const cases = [...results].sort((left, right) => left.name.localeCompare(right.name));
  return {
    total: cases.length,
    passed: cases.filter((result) => result.ok === true).length,
    failed: cases.filter((result) => result.ok !== true).length,
    cases,
  };
}
`,
};

const incomplete = {
  ...reference,
  "src/report.mjs": reference["src/report.mjs"].replace("const cases = [...results]", "const cases = results"),
};

export const fixture = {
  taskId: "r20-maintenance-stable-report-v1",
  category: "maintenance",
  initialRevision: initialRevision(base),
  prompt: "Make the local test result report deterministic for snapshot and CI comparisons. Sort cases by name without mutating the caller's array, and count only an explicit true ok value as passed; all other results are failures.",
  workspace: {
    files: base,
    writableFiles: ["src/report.mjs", "src/main.mjs"],
    network: false,
    timeoutMs: 2000,
    toolchain: "Node.js >=22.12; built-in modules only; ESM",
  },
  acceptance: "Test summaries have stable case ordering, strict pass counts, and non-mutating input behavior.",
  rubric: [
    "Produces deterministic name-sorted cases (0-3).",
    "Counts only explicit true results as passed (0-2).",
    "Does not mutate the caller's result array (0-1).",
  ],
  referenceFiles: reference,
  incompleteFiles: incomplete,
};

async function accepts(root, mainUrl, timeoutMs) {
  return runNode(root, `import { summarizeResults } from ${JSON.stringify(mainUrl)};
const results = [{name:"zeta",ok:true},{name:"alpha",ok:false},{name:"middle",ok:1}];
const before = JSON.stringify(results);
const report = summarizeResults(results);
if (JSON.stringify(report) !== JSON.stringify({total:3,passed:1,failed:2,cases:[
  {name:"alpha",ok:false},{name:"middle",ok:1},{name:"zeta",ok:true},
]})) process.exit(3);
if (JSON.stringify(results) !== before) process.exit(3);`, timeoutMs);
}

export async function validateFixture() {
  return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printValidation(await validateFixture());
