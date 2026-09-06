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
  prompt: "Replace the permissive job parser with strict validation for untrusted JSON input. Require exactly id, command, and timeoutMs with bounded types and values, reject arrays/inherited fields/unknown keys, and reject NUL-containing commands without mutating input.",
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
if (JSON.stringify(parseJob(valid)) !== JSON.stringify(valid) || JSON.stringify(valid) !== before) process.exit(3);
const inherited = Object.create({command:"echo inherited"}); inherited.id = "job-2"; inherited.timeoutMs = 1000;
const polluted = JSON.parse("{\\"id\\":\\"job-3\\",\\"command\\":\\"echo ok\\",\\"timeoutMs\\":1000,\\"admin\\":true}");
const nul = {id:"job-4",command:"bad\\0command",timeoutMs:1000};
for (const candidate of [
  {}, {id:"job",command:"echo",timeoutMs:99}, {id:"job",command:"echo",timeoutMs:60001},
  [], inherited, polluted, nul,
]) if (parseJob(candidate) !== null) process.exit(3);`, timeoutMs);
}

export async function validateFixture() {
  return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printValidation(await validateFixture());
