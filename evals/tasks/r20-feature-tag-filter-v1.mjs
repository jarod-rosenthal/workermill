import { pathToFileURL } from "node:url";
import { initialRevision, runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/tasks.mjs": `export function filterTasks(tasks, tag) { return tasks; }\n`,
  "src/main.mjs": `import { filterTasks } from "./tasks.mjs";
export function visibleTasks(tasks, tag) { return filterTasks(tasks, tag); }\n`,
};
const reference = { ...base, "src/tasks.mjs": `export function filterTasks(tasks, tag) {
  if (!tag) return tasks;
  const wanted = tag.toLowerCase();
  return tasks.filter((task) => task.tags.some((item) => item.toLowerCase() === wanted));
}\n` };
const incomplete = { ...reference, "src/tasks.mjs": reference["src/tasks.mjs"].replace("item.toLowerCase() === wanted", "item === wanted") };
export const fixture = {
  taskId: "r20-feature-tag-filter-v1", category: "feature", initialRevision: initialRevision(base),
  prompt: "Add optional tag filtering to visible tasks. Match tags case-insensitively, retain original ordering and task objects, and return all tasks when the filter is empty.",
  workspace: { files: base, writableFiles: ["src/tasks.mjs"], network: false, timeoutMs: 2000, toolchain: "Node.js >=22.12; built-in modules only; ESM" },
  acceptance: "A case-insensitive tag filter selects only matching tasks without changing unfiltered output.",
  rubric: ["Filters by tag accurately (0-3).", "Handles case and empty filters (0-2).", "Preserves the public wrapper and ordering (0-1)."], referenceFiles: reference, incompleteFiles: incomplete,
};
async function accepts(root, mainUrl, timeoutMs) {
  return runNode(root, `import { visibleTasks } from ${JSON.stringify(mainUrl)};
const tasks = [{id:1,tags:["Bug"]},{id:2,tags:["feature","urgent"]},{id:3,tags:["bug","urgent"]}];
const before = JSON.stringify(tasks);
if (JSON.stringify(visibleTasks(tasks, "BUG").map((x) => x.id)) !== JSON.stringify([1,3])) process.exit(3);
if (visibleTasks(tasks, "").length !== 3 || visibleTasks(tasks, "missing").length !== 0) process.exit(3);
const urgent = visibleTasks(tasks, "urgent");
if (urgent[0] !== tasks[1] || urgent[1] !== tasks[2] || JSON.stringify(tasks) !== before) process.exit(3);`, timeoutMs);
}
export async function validateFixture() { return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts }); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printValidation(await validateFixture());
