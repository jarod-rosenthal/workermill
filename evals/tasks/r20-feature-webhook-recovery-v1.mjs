import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/outbox.mjs": `export function recoverOutbox(state) { return { ...state, pending: [...state.pending], sending: [] }; }
export function nextDelivery(state) { return state.pending[0] ?? null; }\n`,
  "src/main.mjs": `import { recoverOutbox, nextDelivery } from "./outbox.mjs";
export function resumeDelivery(state) { const recovered = recoverOutbox(state); return { state: recovered, next: nextDelivery(recovered) }; }\n`,
};
const reference = { ...base, "src/outbox.mjs": `export function recoverOutbox(state) {
  const delivered = new Set(state.delivered.map(({ id }) => id));
  const pending = [];
  for (const event of [...state.pending, ...state.sending]) {
    if (!delivered.has(event.id)) { delivered.add(event.id); pending.push(event); }
  }
  return { ...state, pending, sending: [] };
}
export function nextDelivery(state) { return state.pending[0] ?? null; }\n` };
const incomplete = { ...reference, "src/outbox.mjs": reference["src/outbox.mjs"].replace("...state.pending, ...state.sending", "...state.sending") };
function revision(files) { return `sha256:${createHash("sha256").update(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([p, c]) => `${p}\\0${c}`).join("\\0")).digest("hex")}`; }
export const fixture = {
  taskId: "r20-feature-webhook-recovery-v1", category: "feature", initialRevision: revision(base),
  prompt: "Implement outbox recovery after an interrupted webhook delivery. Move undelivered sending events back to pending, preserve pending order, clear sending, skip delivered events, and do not duplicate ids. resumeDelivery must expose the first recovered event.",
  workspace: { files: base, writableFiles: ["src/outbox.mjs"], network: false, timeoutMs: 2000, toolchain: "Node.js >=22.12; built-in modules only; ESM" },
  acceptance: "Recovery is idempotent and resumes the oldest undelivered event without resurrecting delivered work.",
  rubric: ["Recovers interrupted sending events (0-3).", "Deduplicates and excludes delivered ids (0-2).", "Preserves the outbox/main dependency (0-1)."], referenceFiles: reference, incompleteFiles: incomplete,
};
async function accepts(root, mainUrl, timeoutMs) { return runNode(root, `import { resumeDelivery } from ${JSON.stringify(mainUrl)};
const input = { pending:[{id:"old"}], sending:[{id:"lost"},{id:"old"},{id:"done"}], delivered:[{id:"done"}] };
const result = resumeDelivery(input);
if (JSON.stringify(result.state.pending) !== JSON.stringify([{id:"old"},{id:"lost"}])) process.exit(3);
if (result.state.sending.length || result.next?.id !== "old" || input.sending.length !== 3) process.exit(3);
if (JSON.stringify(resumeDelivery(result.state).state.pending) !== JSON.stringify([{id:"old"},{id:"lost"}])) process.exit(3);`, timeoutMs); }
export async function validateFixture() { return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts }); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printValidation(await validateFixture());
