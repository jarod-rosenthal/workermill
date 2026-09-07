import { pathToFileURL } from "node:url";
import { initialRevision, runNode, validateVariants, printValidation } from "./r20-helper.mjs";

const base = {
  "package.json": '{"type":"module"}\n',
  "src/main.mjs": `export function previewRecipients(records) {
  const recipients = new Map();
  for (const record of records) {
    const email = record.email.trim().toLowerCase();
    if (email && !recipients.has(email)) recipients.set(email, record.name.trim());
  }
  return [...recipients].map(([email, name]) => ({ email, name }));
}\n`,
};

const reference = {
  ...base,
  "src/recipient-index.mjs": `export function indexRecipients(records) {
  const recipients = new Map();
  for (const record of records) {
    const email = record.email.trim().toLowerCase();
    if (email && !recipients.has(email)) recipients.set(email, record.name.trim());
  }
  return [...recipients].map(([email, name]) => ({ email, name }));
}\n`,
  "src/main.mjs": `import { indexRecipients } from "./recipient-index.mjs";

export { indexRecipients } from "./recipient-index.mjs";

export function previewRecipients(records) {
  return indexRecipients(records);
}\n`,
};

const incomplete = {
  ...reference,
  "src/recipient-index.mjs": reference["src/recipient-index.mjs"].replace(
    "record.email.trim().toLowerCase()",
    "record.email.toLowerCase()",
  ),
};

export const fixture = {
  taskId: "r20-refactor-recipient-index-v1",
  category: "refactor",
  initialRevision: initialRevision(base),
  prompt: `Extract recipient normalization from the campaign preview into src/recipient-index.mjs.

Expose indexRecipients(records) from src/main.mjs as the reusable public boundary, and make previewRecipients delegate to it. Preserve preview behavior: trim and lowercase emails, ignore blank emails, retain the first occurrence, trim names, and preserve first-seen order.`,
  workspace: {
    files: base,
    writableFiles: ["src/main.mjs", "src/recipient-index.mjs"],
    network: false,
    timeoutMs: 2000,
    toolchain: "Node.js >=22.12; built-in modules only; ESM",
  },
  acceptance: "The new public recipient-index boundary and the existing preview produce the same normalized recipient list.",
  rubric: [
    "Provides the reusable public indexRecipients boundary (0-2).",
    "Preserves trimming, deduplication, and first-seen ordering (0-3).",
    "Routes previewRecipients through the extracted dependency (0-1).",
  ],
  referenceFiles: reference,
  incompleteFiles: incomplete,
};

async function accepts(root, mainUrl, timeoutMs) {
  return runNode(root, `import * as app from ${JSON.stringify(mainUrl)};
let extracted;
try { extracted = await import(new URL("./recipient-index.mjs", ${JSON.stringify(mainUrl)})); } catch { process.exit(3); }
if (typeof extracted.indexRecipients !== "function") process.exit(3);
if (typeof app.indexRecipients !== "function") process.exit(3);
const records = [{email:" ANA@EXAMPLE.TEST ",name:" Ana "},{email:"ana@example.test",name:"Later"},{email:"   ",name:"Ignored"},{email:"bob@example.test",name:" Bob "}];
const expected = [{email:"ana@example.test",name:"Ana"},{email:"bob@example.test",name:"Bob"}];
if (JSON.stringify(app.indexRecipients(records)) !== JSON.stringify(expected)) process.exit(3);
if (JSON.stringify(app.previewRecipients(records)) !== JSON.stringify(expected)) process.exit(3);`, timeoutMs);
}

export async function validateFixture() {
  return validateVariants({ fixture, variants: { baseline: base, reference, incomplete }, testExpression: accepts });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  printValidation(await validateFixture());
}
