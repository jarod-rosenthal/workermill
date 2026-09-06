import { pathToFileURL } from "node:url";
import { initialRevision, runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/jobs.mjs": `export function parseJob(input) {
  return { id: input.id, command: input.command, timeoutMs: input.timeoutMs ?? 2000 };
}
`,
  "src/main.mjs": `import { parseJob } from "./jobs.mjs";
export { parseJob } from "./jobs.mjs";
`,
};

const reference = {
  ...base,
  "src/jobs.mjs": `const fields = new Set(["id", "command", "timeoutMs"]);

export function parseJob(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return null;
  const keys = Object.keys(input);
  if (keys.length !== fields.size || keys.some((key) => !fields.has(key))) return null;
  if (typeof input.id !== "string" || input.id.length === 0 || input.id.length > 100) return null;
  if (typeof input.command !== "string" || input.command.length === 0 || input.command.includes("\\0") || input.command.length > 2000) return null;
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 60_000) return null;
  return { id: input.id, command: input.command, timeoutMs: input.timeoutMs };
}
`,
};

const incomplete = {
  ...reference,
  "src/jobs.mjs": reference["src/jobs.mjs"].replace(
    'if (keys.length !== fields.size || keys.some((key) => !fields.has(key))) return null;',
    'if (keys.some((key) => key === "__proto__")) return null;',
  ),
};

export const fixture = {
  taskId: "r20-security-job-schema-v1",
  category: "security",
  initialRevision: initialRevision(base),
  prompt: "Replace the permissive job parser with strict validation for untrusted JSON input and return null for every invalid value. Require exactly id, command, and timeoutMs with these bounds: id is a string of length 1..100; command is a string of length 1..2000 with no NUL; timeoutMs is an integer in the inclusive range 100..60000. Reject null/non-object values, arrays, inherited fields, missing or extra keys, wrong types, NaN/Infinity/fractional/out-of-range timeouts, and do not mutate input.",
  workspace: {
    files: base,
    writableFiles: ["src/jobs.mjs", "src/main.mjs"],
    network: false,
    timeoutMs: 2000,
    toolchain: "Node.js >=22.12; built-in modules only; ESM",
  },
  acceptance: "Only a strict, own-property job shape reaches execution; malformed, polluted, and out-of-range inputs return null.",
  rubric: [
    "Accepts valid jobs and preserves their normalized values (0-2).",
    "Rejects unknown, missing, inherited, array, and out-of-range fields (0-3).",
    "Rejects NUL commands and avoids mutating caller input (0-1).",
  ],
  referenceFiles: reference,
  incompleteFiles: incomplete,
};

async function accepts(root, mainUrl, timeoutMs) {
  return runNode(root, `import { parseJob } from ${JSON.stringify(mainUrl)};
const valid = {id:"job-1",command:"echo ok",timeoutMs:1000};
const before = JSON.stringify(valid);
const expectValid = (candidate) => {
  const before = JSON.stringify(candidate);
  try {
    if (JSON.stringify(parseJob(candidate)) !== before || JSON.stringify(candidate) !== before) process.exit(3);
  } catch { process.exit(3); }
};
const expectNull = (candidate) => {
  try { if (parseJob(candidate) !== null) process.exit(3); } catch { process.exit(3); }
};
expectValid(valid);
expectValid({id:"i",command:"c",timeoutMs:100});
expectValid({id:"i".repeat(100),command:"c".repeat(2000),timeoutMs:60000});
if (JSON.stringify(valid) !== before) process.exit(3);
const inherited = Object.create({command:"echo inherited"}); inherited.id = "job-2"; inherited.timeoutMs = 1000;
const extra = {...valid, admin:true};
const polluted = JSON.parse("{\\"id\\":\\"job-3\\",\\"command\\":\\"echo ok\\",\\"timeoutMs\\":1000,\\"admin\\":true}");
const missingId = {command:"echo",timeoutMs:1000};
const missingCommand = {id:"job",timeoutMs:1000};
const missingTimeout = {id:"job",command:"echo"};
const nul = {id:"job-4",command:"bad\\0command",timeoutMs:1000};
for (const candidate of [
  null, undefined, 42, "job", true, [], {}, missingId, missingCommand, missingTimeout,
  inherited, extra, polluted, nul,
  {id:"",command:"echo",timeoutMs:1000}, {id:"i".repeat(101),command:"echo",timeoutMs:1000},
  {id:"job",command:"",timeoutMs:1000}, {id:"job",command:"c".repeat(2001),timeoutMs:1000},
  {id:1,command:"echo",timeoutMs:1000}, {id:"job",command:7,timeoutMs:1000},
  {id:"job",command:"echo",timeoutMs:"1000"}, {id:"job",command:"echo",timeoutMs:null},
  {id:"job",command:"echo",timeoutMs:99}, {id:"job",command:"echo",timeoutMs:60001},
  {id:"job",command:"echo",timeoutMs:100.5}, {id:"job",command:"echo",timeoutMs:NaN},
  {id:"job",command:"echo",timeoutMs:Infinity}, {id:"job",command:"echo",timeoutMs:-Infinity},
]) expectNull(candidate);`, timeoutMs);
}

export async function validateFixture() {
  return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printValidation(await validateFixture());
