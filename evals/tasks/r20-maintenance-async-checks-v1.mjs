import { pathToFileURL } from "node:url";
import { initialRevision, runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/checks.mjs": `export async function runChecks(checks) {
  const results = [];
  for (const check of checks) {
    try {
      results.push({ name: check.name, ok: Boolean(check()) });
    } catch (error) {
      results.push({ name: check.name, ok: false, error: String(error?.message ?? error) });
    }
  }
  return results;
}
`,
  "src/main.mjs": `import { runChecks } from "./checks.mjs";
export { runChecks } from "./checks.mjs";
`,
};

const reference = {
  ...base,
  "src/checks.mjs": `export async function runChecks(checks) {
  const results = [];
  for (const check of checks) {
    try {
      const value = await check();
      results.push({ name: check.name, ok: value !== false });
    } catch (error) {
      results.push({ name: check.name, ok: false, error: String(error?.message ?? error) });
    }
  }
  return results;
}
`,
};

const incomplete = {
  ...reference,
  "src/checks.mjs": reference["src/checks.mjs"].replace("value !== false", "true"),
};

export const fixture = {
  taskId: "r20-maintenance-async-checks-v1",
  category: "maintenance",
  initialRevision: initialRevision(base),
  prompt: "Repair the regression-check utility so it awaits synchronous and asynchronous checks, records false results as failures, records rejected checks without aborting the suite, and continues to later checks.",
  workspace: {
    files: base,
    writableFiles: ["src/checks.mjs", "src/main.mjs"],
    network: false,
    timeoutMs: 2000,
    toolchain: "Node.js >=22.12; built-in modules only; ESM",
  },
  acceptance: "The maintenance check runner reports sync, async, and rejected checks consistently while completing the remaining suite.",
  rubric: [
    "Awaits asynchronous checks and treats an explicit false result as failed (0-3).",
    "Captures thrown and rejected failures without stopping later checks (0-2).",
    "Preserves the public wrapper export and result names (0-1).",
  ],
  referenceFiles: reference,
  incompleteFiles: incomplete,
};

async function accepts(root, mainUrl, timeoutMs) {
  return runNode(root, `import { runChecks } from ${JSON.stringify(mainUrl)};
const named = (name, check) => Object.defineProperty(check, "name", { value: name });
const checks = [
  named("sync-pass", () => true),
  named("async-false", async () => false),
  named("async-rejected", async () => { throw new Error("rejected"); }),
  named("sync-thrown", () => { throw new Error("thrown"); }),
  named("after-failure", async () => true),
];
const result = await runChecks(checks);
if (JSON.stringify(result) !== JSON.stringify([
  {name:"sync-pass",ok:true},
  {name:"async-false",ok:false},
  {name:"async-rejected",ok:false,error:"rejected"},
  {name:"sync-thrown",ok:false,error:"thrown"},
  {name:"after-failure",ok:true},
])) process.exit(3);`, timeoutMs);
}

export async function validateFixture() {
  return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printValidation(await validateFixture());
