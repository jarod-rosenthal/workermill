import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { runNode, validateVariants } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/queue.mjs": `export function recover(state) {
  return { ...state, pending: [...state.pending, ...state.running], running: [] };
}
export function enqueue(state, job) { return { ...state, pending: [...state.pending, job] }; }
`,
  "src/main.mjs": `import { recover, enqueue } from "./queue.mjs";
export function resume(state, job) { return enqueue(recover(state), job); }
`,
};
const reference = { ...base, "src/queue.mjs": `export function recover(state) {
  const known = new Set(state.done.map(({ id }) => id));
  return { ...state, pending: [...state.pending, ...state.running.filter(({ id }) => !known.has(id))], running: [] };
}
export function enqueue(state, job) {
  if (state.done.some(({ id }) => id === job.id) || state.pending.some(({ id }) => id === job.id)) return state;
  return { ...state, pending: [...state.pending, job] };
}
` };
const incomplete = { ...reference, "src/queue.mjs": reference["src/queue.mjs"].replace("state.pending.some(({ id }) => id === job.id)", "false") };
function revision(files) { const m = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([p, c]) => `${p}\0${c}`).join("\0"); return `sha256:${createHash("sha256").update(m).digest("hex")}`; }
export const fixture = {
  taskId: "r20-bugfix-queue-recovery-v1", category: "bugfix", initialRevision: revision(base),
  prompt: "Make queue resume recovery idempotent: requeue interrupted jobs, clear running, skip jobs already done, and avoid duplicate enqueue by id.",
  workspace: { files: base, writableFiles: ["src/queue.mjs"], network: false, timeoutMs: 2000, toolchain: "Node.js >=22.12; built-in modules only; ESM" },
  acceptance: "A crash-recovered running job is pending once; completed jobs are not resurrected; retrying enqueue is harmless.",
  rubric: ["Recovers interrupted work and clears running (0-2).", "Does not resurrect done jobs (0-2).", "Enqueue is idempotent and preserves the two-file dependency (0-2)."], referenceFiles: reference, incompleteFiles: incomplete,
};
async function accepts(root, mainUrl, timeoutMs) {
  const expression = `import { resume } from ${JSON.stringify(mainUrl)};
const state = { pending: [], running: [{id:"a"},{id:"done"}], done: [{id:"done"}] };
const once = resume(state, {id:"a"}); const twice = resume(once, {id:"a"});
if (JSON.stringify(once.pending) !== JSON.stringify([{id:"a"}])) process.exit(3);
if (JSON.stringify(twice.pending) !== JSON.stringify([{id:"a"}])) process.exit(3);`;
  return runNode(root, expression, timeoutMs);
}
export async function validateFixture() { return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts }); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await validateFixture(), null, 2));
