import { pathToFileURL } from "node:url";
import { initialRevision, runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/workspace.mjs": `import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

export async function createTempWorkspace(root, name) {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function cleanupTempWorkspace(root, name) {
  await rm(join(root, name), { recursive: false });
}
`,
  "src/main.mjs": `import { createTempWorkspace, cleanupTempWorkspace } from "./workspace.mjs";
export { createTempWorkspace, cleanupTempWorkspace } from "./workspace.mjs";
export async function withTempWorkspace(root, name, callback) {
  const directory = await createTempWorkspace(root, name);
  try {
    return await callback(directory);
  } finally {
    await cleanupTempWorkspace(root, name);
  }
}
`,
};

const reference = {
  ...base,
  "src/workspace.mjs": base["src/workspace.mjs"].replace(
    "{ recursive: false }",
    "{ recursive: true, force: true }",
  ),
};

const incomplete = {
  ...reference,
  "src/workspace.mjs": reference["src/workspace.mjs"].replace("force: true", "force: false"),
};

export const fixture = {
  taskId: "r20-maintenance-temp-cleanup-v1",
  category: "maintenance",
  initialRevision: initialRevision(base),
  prompt: "Harden the test workspace lifecycle used by local checks. Cleanup must remove nested files, be safe to call again when a workspace is already absent, and still run when the callback fails. Preserve the two-module public wrapper.",
  workspace: {
    files: base,
    writableFiles: ["src/workspace.mjs", "src/main.mjs"],
    network: false,
    timeoutMs: 2000,
    toolchain: "Node.js >=22.12; built-in modules only; ESM",
  },
  acceptance: "Temporary test workspaces are recursively and idempotently cleaned after normal and failing callbacks.",
  rubric: [
    "Removes nested workspace contents (0-3).",
    "Cleanup is idempotent for an absent directory (0-2).",
    "The wrapper cleans up after callback failure and keeps both public modules wired together (0-1).",
  ],
  referenceFiles: reference,
  incompleteFiles: incomplete,
};

async function accepts(root, mainUrl, timeoutMs) {
  return runNode(root, `import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createTempWorkspace, cleanupTempWorkspace, withTempWorkspace } from ${JSON.stringify(mainUrl)};
const root = ${JSON.stringify(root)};
const directory = await createTempWorkspace(root, "nested");
await mkdir(join(directory, "deep"), { recursive: true });
await writeFile(join(directory, "deep", "case.txt"), "case");
let firstError;
try { await cleanupTempWorkspace(root, "nested"); } catch (error) { firstError = error; }
if (firstError) process.exit(3);
try { await stat(directory); process.exit(3); } catch (error) { if (error.code !== "ENOENT") process.exit(3); }
let secondError;
try { await cleanupTempWorkspace(root, "nested"); } catch (error) { secondError = error; }
if (secondError) process.exit(3);
let failed;
try { await withTempWorkspace(root, "failing", async (path) => { await writeFile(join(path, "leftover"), "x"); throw new Error("check failed"); }); }
catch (error) { failed = error; }
if (!failed || failed.message !== "check failed") process.exit(3);
try { await stat(join(root, "failing")); process.exit(3); } catch (error) { if (error.code !== "ENOENT") process.exit(3); }`, timeoutMs);
}

export async function validateFixture() {
  return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printValidation(await validateFixture());
