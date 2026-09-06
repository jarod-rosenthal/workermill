import { pathToFileURL } from "node:url";
import { initialRevision, runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/main.mjs": `export function resumeFailedDelivery(record, attempt) {
  if (record.status === 429 || record.status >= 500) {
    return { ...record, state: "scheduled", delayMs: 100 * (2 ** attempt) };
  }
  return { ...record, state: "failed", delayMs: null };
}\n`,
};

const reference = {
  ...base,
  "src/retry-policy.mjs": `export function createRetryPolicy({ baseMs, maxMs }) {
  return {
    delayFor(attempt) { return Math.min(maxMs, baseMs * (2 ** attempt)); },
    shouldRetry(status) { return status === 429 || status >= 500; },
  };
}\n`,
  "src/main.mjs": `import { createRetryPolicy } from "./retry-policy.mjs";

export { createRetryPolicy } from "./retry-policy.mjs";

const deliveryRetry = createRetryPolicy({ baseMs: 100, maxMs: 800 });

export function resumeFailedDelivery(record, attempt) {
  if (deliveryRetry.shouldRetry(record.status)) {
    return { ...record, state: "scheduled", delayMs: deliveryRetry.delayFor(attempt) };
  }
  return { ...record, state: "failed", delayMs: null };
}\n`,
};

const incomplete = {
  ...reference,
  "src/retry-policy.mjs": reference["src/retry-policy.mjs"].replace(
    "Math.min(maxMs, baseMs * (2 ** attempt))",
    "baseMs * (2 ** attempt)",
  ),
};

export const fixture = {
  taskId: "r20-refactor-retry-policy-v1",
  category: "refactor",
  initialRevision: initialRevision(base),
  prompt: `Extract retry decisions from delivery recovery into src/retry-policy.mjs.

Export createRetryPolicy({ baseMs, maxMs }) from src/main.mjs. Its returned policy must expose delayFor(attempt) and shouldRetry(status). Make resumeFailedDelivery use the shared policy while preserving recovery behavior: 429 and 5xx failures schedule retries, other failures remain failed, and delivery delays start at 100ms and cap at 800ms.`,
  workspace: {
    files: base,
    writableFiles: ["src/main.mjs", "src/retry-policy.mjs"],
    network: false,
    timeoutMs: 2000,
    toolchain: "Node.js >=22.12; built-in modules only; ESM",
  },
  acceptance: "Interrupted delivery recovery delegates retry decisions to a configurable public policy without changing retry eligibility.",
  rubric: [
    "Exports a configurable retry-policy boundary (0-2).",
    "Keeps retry eligibility and capped exponential delays correct (0-3).",
    "Uses the shared policy from recovery rather than duplicating its decisions (0-1).",
  ],
  referenceFiles: reference,
  incompleteFiles: incomplete,
};

async function accepts(root, mainUrl, timeoutMs) {
  return runNode(root, `import * as app from ${JSON.stringify(mainUrl)};
let extracted;
try { extracted = await import(new URL("./retry-policy.mjs", ${JSON.stringify(mainUrl)})); } catch { process.exit(3); }
if (typeof extracted.createRetryPolicy !== "function") process.exit(3);
if (typeof app.createRetryPolicy !== "function") process.exit(3);
const policy = app.createRetryPolicy({baseMs:25,maxMs:90});
if (policy.delayFor(0) !== 25 || policy.delayFor(2) !== 90 || !policy.shouldRetry(429) || !policy.shouldRetry(503) || policy.shouldRetry(400)) process.exit(3);
const recovered = app.resumeFailedDelivery({id:"lost",status:503}, 5);
if (recovered.state !== "scheduled" || recovered.delayMs !== 800) process.exit(3);
const rejected = app.resumeFailedDelivery({id:"bad",status:422}, 0);
if (rejected.state !== "failed" || rejected.delayMs !== null) process.exit(3);`, timeoutMs);
}

export async function validateFixture() {
  return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  printValidation(await validateFixture());
}
