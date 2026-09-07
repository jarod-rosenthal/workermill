import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/retry.mjs": `export function retryDelay(attempt, baseMs = 100, maxMs = 1000) {
  return baseMs * 2 ** attempt;
}
`,
  "src/main.mjs": `import { retryDelay } from "./retry.mjs";
export function schedule(attempts) { return attempts.map((attempt) => retryDelay(attempt, 100, 1000)); }
`,
};
const reference = { ...base, "src/retry.mjs": base["src/retry.mjs"].replace("return baseMs * 2 ** attempt;", "return Math.min(maxMs, baseMs * 2 ** attempt);") };
const incomplete = { ...reference, "src/retry.mjs": reference["src/retry.mjs"].replace("Math.min(maxMs, baseMs * 2 ** attempt)", "Math.min(maxMs, baseMs * 2 ** (attempt + 1))") };
function revision(files) { const m = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([p, c]) => `${p}\0${c}`).join("\0"); return `sha256:${createHash("sha256").update(m).digest("hex")}`; }
export const fixture = {
  taskId: "r20-bugfix-retry-backoff-v1", category: "bugfix", initialRevision: revision(base),
  prompt: "Bound exponential retry backoff by maxMs. Keep attempt zero at baseMs and use a deterministic calculation without sleeping.",
  workspace: { files: base, writableFiles: ["src/retry.mjs"], network: false, timeoutMs: 2000, toolchain: "Node.js >=22.12; built-in modules only; ESM" },
  acceptance: "Backoff grows exponentially until the configured maximum; attempt zero is the base delay and no real timers are needed.",
  rubric: ["Caps large attempts (0-3).", "Preserves base delay and exponential growth (0-2).", "Remains deterministic and dependency-free (0-1)."], referenceFiles: reference, incompleteFiles: incomplete,
};
async function accepts(root, mainUrl, timeoutMs) {
  const expression = `import { schedule } from ${JSON.stringify(mainUrl)};
if (JSON.stringify(schedule([0,1,2,10])) !== JSON.stringify([100,200,400,1000])) process.exit(3);`;
  return runNode(root, expression, timeoutMs);
}
export async function validateFixture() { return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts }); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printValidation(await validateFixture());
