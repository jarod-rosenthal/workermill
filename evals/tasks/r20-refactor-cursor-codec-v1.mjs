import { pathToFileURL } from "node:url";
import { initialRevision, runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/main.mjs": `export function nextPage(items, cursor) {
  const start = cursor ? Number(cursor) : 0;
  return { items: items.slice(start, start + 2), cursor: start + 2 < items.length ? String(start + 2) : null };
}\n`,
};

const reference = {
  ...base,
  "src/cursor-codec.mjs": `export function decodeCursor(cursor) {
  if (cursor === null || cursor === undefined) return 0;
  if (!/^(0|[1-9][0-9]*)$/.test(cursor)) return null;
  return Number(cursor);
}

export function encodeCursor(offset, total) {
  return offset < total ? String(offset) : null;
}\n`,
  "src/main.mjs": `import { decodeCursor, encodeCursor } from "./cursor-codec.mjs";

export { decodeCursor, encodeCursor } from "./cursor-codec.mjs";

export function nextPage(items, cursor) {
  const start = decodeCursor(cursor);
  if (start === null) return { items: [], cursor: null };
  return { items: items.slice(start, start + 2), cursor: encodeCursor(start + 2, items.length) };
}\n`,
};

const incomplete = {
  ...reference,
  "src/cursor-codec.mjs": reference["src/cursor-codec.mjs"].replace(
    "if (!/^(0|[1-9][0-9]*)$/.test(cursor)) return null;",
    "",
  ),
};

export const fixture = {
  taskId: "r20-refactor-cursor-codec-v1",
  category: "refactor",
  initialRevision: initialRevision(base),
  prompt: `Extract pagination cursor handling into src/cursor-codec.mjs.

Export decodeCursor(cursor) and encodeCursor(offset, total) from src/main.mjs, and have nextPage use them. Keep valid cursor behavior unchanged. Invalid cursors (negative, decimal, leading-zero, or non-numeric) must produce an empty page with a null cursor rather than silently selecting data.`,
  workspace: {
    files: base,
    writableFiles: ["src/main.mjs", "src/cursor-codec.mjs"],
    network: false,
    timeoutMs: 2000,
    toolchain: "Node.js >=22.12; built-in modules only; ESM",
  },
  acceptance: "The public codec becomes the sole pagination boundary while valid pages remain stable and malformed cursors recover safely.",
  rubric: [
    "Exports a cursor codec with encode and decode boundaries (0-2).",
    "Preserves valid two-item pagination and terminal cursor behavior (0-2).",
    "Rejects malformed cursors without exposing an unintended page (0-2).",
  ],
  referenceFiles: reference,
  incompleteFiles: incomplete,
};

async function accepts(root, mainUrl, timeoutMs) {
  return runNode(root, `import * as app from ${JSON.stringify(mainUrl)};
if (typeof app.decodeCursor !== "function" || typeof app.encodeCursor !== "function") process.exit(3);
if (app.decodeCursor(null) !== 0 || app.decodeCursor("2") !== 2 || app.decodeCursor("02") !== null || app.decodeCursor("-1") !== null || app.encodeCursor(2,3) !== "2" || app.encodeCursor(3,3) !== null) process.exit(3);
const items = ["a","b","c"]; const first = app.nextPage(items, null); const second = app.nextPage(items, first.cursor);
if (JSON.stringify(first) !== JSON.stringify({items:["a","b"],cursor:"2"}) || JSON.stringify(second) !== JSON.stringify({items:["c"],cursor:null})) process.exit(3);
if (JSON.stringify(app.nextPage(items, "02")) !== JSON.stringify({items:[],cursor:null})) process.exit(3);`, timeoutMs);
}

export async function validateFixture() {
  return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  printValidation(await validateFixture());
}
