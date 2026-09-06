import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/pager.mjs": `export function page(items, number, size) {
  const start = number * size;
  return items.slice(start, start + size);
}
`,
  "src/main.mjs": `import { page } from "./pager.mjs";
export function pageReport(items, number, size) { return { items: page(items, number, size), number }; }
`,
};
const reference = { ...base, "src/pager.mjs": base["src/pager.mjs"].replace("number * size", "(number - 1) * size") };
const incomplete = { ...base, "src/pager.mjs": base["src/pager.mjs"].replace("number * size", "(number - 1) * size").replace("start + size", "start + size - 1") };
function revision(files) {
  const material = Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([p, c]) => `${p}\0${c}`).join("\0");
  return `sha256:${createHash("sha256").update(material).digest("hex")}`;
}
export const fixture = {
  taskId: "r20-bugfix-pagination-v1", category: "bugfix", initialRevision: revision(base),
  prompt: "Fix one-based pagination while preserving ordering, page size, and partial final pages.",
  workspace: { files: base, writableFiles: ["src/pager.mjs"], network: false, timeoutMs: 2000, toolchain: "Node.js >=22.12; built-in modules only; ESM" },
  acceptance: "Pages are one-based; first, middle, and partial final pages return exactly the requested records.",
  rubric: ["Correct one-based offset (0-3).", "Handles partial and exact-boundary pages (0-2).", "Preserves the pager/main dependency (0-1)."],
  referenceFiles: reference, incompleteFiles: incomplete,
};
async function accepts(root, mainUrl, timeoutMs) {
  const expression = `import { pageReport } from ${JSON.stringify(mainUrl)};
const values = ["a","b","c","d","e"];
if (JSON.stringify(pageReport(values, 1, 2)) !== JSON.stringify({items:["a","b"],number:1})) process.exit(3);
if (JSON.stringify(pageReport(values, 2, 2).items) !== JSON.stringify(["c","d"])) process.exit(3);
if (JSON.stringify(pageReport(values, 3, 2).items) !== JSON.stringify(["e"])) process.exit(3);`;
  return runNode(root, expression, timeoutMs);
}
export async function validateFixture() { return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts }); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printValidation(await validateFixture());
