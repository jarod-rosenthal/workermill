import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/notes.mjs": `export function renderRelease(title, changes) {
  return "# " + title + "\\n" + changes.map((change) => "- " + change).join("\\n");
}\n`,
  "src/main.mjs": `import { renderRelease } from "./notes.mjs";
export function publishableRelease(title, changes) { return renderRelease(title, changes); }\n`,
};
const reference = { ...base, "src/notes.mjs": `export function renderRelease(title, changes) {
  const lines = ["# " + title, "", "## Changes"];
  for (const change of changes) lines.push("- " + change);
  return lines.join("\\n") + "\\n";
}\n` };
const incomplete = { ...base, "src/notes.mjs": reference["src/notes.mjs"].replace('"## Changes"', '"Changes"') };
function revision(files) { return `sha256:${createHash("sha256").update(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([p, c]) => `${p}\\0${c}`).join("\\0")).digest("hex")}`; }
export const fixture = {
  taskId: "r20-feature-release-notes-v1", category: "feature", initialRevision: revision(base),
  prompt: "Add a structured release-notes format: an H1 title, a Changes H2, one bullet per change, and exactly one trailing newline. Empty changes must still render a valid section. Keep the public publishableRelease wrapper working.",
  workspace: { files: base, writableFiles: ["src/notes.mjs"], network: false, timeoutMs: 2000, toolchain: "Node.js >=22.12; built-in modules only; ESM" },
  acceptance: "Release notes have stable Markdown structure for empty and non-empty change lists through the public wrapper.",
  rubric: ["Produces the requested headings and bullets (0-3).", "Preserves the notes/main module dependency (0-2).", "Uses a single trailing newline (0-1)."], referenceFiles: reference, incompleteFiles: incomplete,
};
async function accepts(root, mainUrl, timeoutMs) { return runNode(root, `import { publishableRelease } from ${JSON.stringify(mainUrl)};
if (publishableRelease("1.2.0", ["Fix cache", "Add export"]) !== "# 1.2.0\\n\\n## Changes\\n- Fix cache\\n- Add export\\n") process.exit(3);
if (publishableRelease("1.2.1", []) !== "# 1.2.1\\n\\n## Changes\\n") process.exit(3);`, timeoutMs); }
export async function validateFixture() { return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts }); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printValidation(await validateFixture());
