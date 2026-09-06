import { pathToFileURL } from "node:url";
import { initialRevision, runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/path-policy.mjs": `import { join } from "node:path";
export function resolveWithin(root, candidate) {
  const target = join(root, candidate);
  return target.startsWith(root) ? target : null;
}
`,
  "src/main.mjs": `import { resolveWithin } from "./path-policy.mjs";
export { resolveWithin } from "./path-policy.mjs";
`,
};

const reference = {
  ...base,
  "src/path-policy.mjs": `import { isAbsolute, relative, resolve, sep } from "node:path";
export function resolveWithin(root, candidate) {
  if (typeof root !== "string" || typeof candidate !== "string" || candidate.includes("\\0") || candidate.includes("\\\\")) return null;
  if (isAbsolute(candidate)) return null;
  const rootPath = resolve(root);
  const target = resolve(rootPath, candidate);
  const distance = relative(rootPath, target);
  if (distance === "" || (distance !== ".." && !distance.startsWith(".." + sep) && !isAbsolute(distance))) return target;
  return null;
}
`,
};

const incomplete = {
  ...reference,
  "src/path-policy.mjs": `import { isAbsolute, relative, resolve, sep } from "node:path";
export function resolveWithin(root, candidate) {
  if (typeof root !== "string" || typeof candidate !== "string" || candidate.includes("\\0")) return null;
  if (isAbsolute(candidate)) return null;
  const rootPath = resolve(root);
  const target = resolve(rootPath, candidate);
  const distance = relative(rootPath, target);
  if (distance === "" || (distance !== ".." && !distance.startsWith(".." + sep) && !isAbsolute(distance))) return target;
  return null;
}
`,
};

export const fixture = {
  taskId: "r20-security-path-boundary-v1",
  category: "security",
  initialRevision: initialRevision(base),
  prompt: "Harden the workspace path policy. Resolve candidates against a canonical workspace root and return null for absolute paths, traversal that escapes the root, NUL bytes, or Windows separator tricks; keep normal in-root paths usable.",
  workspace: {
    files: base,
    writableFiles: ["src/path-policy.mjs", "src/main.mjs"],
    network: false,
    timeoutMs: 2000,
    toolchain: "Node.js >=22.12; built-in modules only; ESM",
  },
  acceptance: "Untrusted workspace paths cannot escape the canonical root through traversal, absolute paths, NUL bytes, or cross-platform separators.",
  rubric: [
    "Allows ordinary in-root paths and normalized in-root traversal (0-2).",
    "Rejects canonical escapes and absolute paths, including prefix-confusion paths (0-3).",
    "Rejects NUL and backslash separator bypasses (0-1).",
  ],
  referenceFiles: reference,
  incompleteFiles: incomplete,
};

async function accepts(root, mainUrl, timeoutMs) {
  return runNode(root, `import { resolveWithin } from ${JSON.stringify(mainUrl)};
const root = "/tmp/wm-secure-root";
const inside = resolveWithin(root, "src/../config.mjs");
if (inside !== "/tmp/wm-secure-root/config.mjs") process.exit(3);
for (const candidate of ["../wm-secure-root-evil/secret", "src/../../outside", "/etc/passwd", "safe\\\\..\\\\secret", "safe\\0name"]) {
  if (resolveWithin(root, candidate) !== null) process.exit(3);
}
if (resolveWithin(root, "src/worker.mjs") !== "/tmp/wm-secure-root/src/worker.mjs") process.exit(3);`, timeoutMs);
}

export async function validateFixture() {
  return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printValidation(await validateFixture());
