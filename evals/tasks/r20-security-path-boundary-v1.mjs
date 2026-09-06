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
  "src/path-policy.mjs": `import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";

function isWithin(rootPath, candidatePath) {
  const distance = relative(rootPath, candidatePath);
  return distance === "" || (distance !== ".." && !distance.startsWith(".." + sep) && !isAbsolute(distance));
}

async function canonicalCandidate(target) {
  let cursor = target;
  const suffix = [];
  while (true) {
    try {
      const existing = await realpath(cursor);
      return resolve(existing, ...suffix);
    } catch (error) {
      if (error.code !== "ENOENT") return null;
      const parent = dirname(cursor);
      if (parent === cursor) return null;
      suffix.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

export async function resolveWithin(root, candidate) {
  if (typeof root !== "string" || typeof candidate !== "string" || candidate.includes("\\0") || candidate.includes("\\\\")) return null;
  if (isAbsolute(candidate)) return null;
  let rootPath;
  try { rootPath = await realpath(root); } catch { return null; }
  const target = resolve(rootPath, candidate);
  const canonical = await canonicalCandidate(target);
  return canonical && isWithin(rootPath, canonical) ? canonical : null;
}
`,
};

const incomplete = {
  ...reference,
  "src/path-policy.mjs": `import { isAbsolute, relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
export async function resolveWithin(root, candidate) {
  if (typeof root !== "string" || typeof candidate !== "string" || candidate.includes("\\0") || candidate.includes("\\\\")) return null;
  if (isAbsolute(candidate)) return null;
  const rootPath = await realpath(root);
  const target = resolve(rootPath, candidate);
  let canonical = target;
  try { canonical = await realpath(target); } catch (error) { if (error.code !== "ENOENT") return null; }
  const distance = relative(rootPath, canonical);
  return distance === "" || (distance !== ".." && !distance.startsWith(".." + sep) && !isAbsolute(distance)) ? canonical : null;
}
`,
};

export const fixture = {
  taskId: "r20-security-path-boundary-v1",
  category: "security",
  initialRevision: initialRevision(base),
  prompt: "Harden the workspace path policy. Make resolveWithin(root, candidate) asynchronous: realpath the existing root, resolve a relative candidate, and canonicalize the candidate itself when it exists or its nearest existing ancestor when it is a new target. Return the canonical in-root path for normal files, new in-root targets, and symlinks that resolve inside; return null for missing roots, absolute paths, traversal/prefix-confusion escapes, symlink escapes, NUL bytes, or Windows separator tricks.",
  workspace: {
    files: base,
    writableFiles: ["src/path-policy.mjs", "src/main.mjs"],
    network: false,
    timeoutMs: 2000,
    toolchain: "Node.js >=22.12; built-in modules only; ESM",
  },
  acceptance: "Untrusted workspace paths are checked against real filesystem canonical paths, including created symlinks and the nearest existing ancestor for new targets, while safe paths return a usable canonical destination.",
  rubric: [
    "Canonicalizes the root and existing/nearest-ancestor candidate while preserving safe in-root destinations (0-2).",
    "Rejects traversal, absolute, prefix-confusion, and symlink escapes (0-3).",
    "Rejects NUL and backslash separator bypasses and returns an actually writable safe path (0-1).",
  ],
  referenceFiles: reference,
  incompleteFiles: incomplete,
};

async function accepts(root, mainUrl, timeoutMs) {
  return runNode(root, `import { mkdtemp, mkdir, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { resolveWithin } from ${JSON.stringify(mainUrl)};
const fixtureRoot = await mkdtemp(join(${JSON.stringify(root)}, "path-boundary-"));
const inside = join(fixtureRoot, "inside");
const outside = join(dirname(fixtureRoot), basename(fixtureRoot) + "-outside");
await mkdir(inside); await mkdir(outside);
await writeFile(join(inside, "existing.txt"), "inside");
await writeFile(join(outside, "secret.txt"), "outside");
await symlink(inside, join(fixtureRoot, "link-inside"));
await symlink(outside, join(fixtureRoot, "link-outside"));
const canonicalRoot = await realpath(fixtureRoot);
const existing = await resolveWithin(fixtureRoot, "inside/existing.txt");
if (existing !== join(canonicalRoot, "inside", "existing.txt")) process.exit(3);
const newTarget = await resolveWithin(fixtureRoot, "inside/new.txt");
if (newTarget !== join(canonicalRoot, "inside", "new.txt")) process.exit(3);
await writeFile(newTarget, "probe");
if (!(await stat(newTarget)).isFile()) process.exit(3);
const inSymlink = await resolveWithin(fixtureRoot, "link-inside/existing.txt");
if (inSymlink !== join(canonicalRoot, "inside", "existing.txt")) process.exit(3);
for (const candidate of [
  "link-outside/secret.txt", "link-outside/new.txt", "../" + basename(fixtureRoot) + "-evil/secret.txt",
  "src/../../outside", join(outside, "secret.txt"), "safe\\\\..\\\\secret", "safe\\0name",
]) if (await resolveWithin(fixtureRoot, candidate) !== null) process.exit(3);
if (dirname(newTarget) !== join(canonicalRoot, "inside")) process.exit(3);`, timeoutMs);
}

export async function validateFixture() {
  return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printValidation(await validateFixture());
