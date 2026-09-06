import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const baselineFiles = {
  "package.json": '{"type":"module"}\n',
  "src/config.mjs": `export function parseBatchConfig(text) {
  const result = {};
  for (const raw of text.split(/\\r?\\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("invalid config line");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    result[key] = value;
  }
  return result;
}
`,
  "src/main.mjs": `import { parseBatchConfig } from "./config.mjs";
export function batchPlan(text) {
  const config = parseBatchConfig(text);
  return (config.jobs ?? "").split(",").filter(Boolean).map((name) => ({
    name,
    output: (config.outputDir ?? "out") + "/" + name + ".json",
    retries: Number(config.retries ?? 0),
  }));
}
`,
};

const referenceFiles = {
  ...baselineFiles,
  "src/config.mjs": `export function parseBatchConfig(text) {
  const result = {};
  for (const raw of text.split(/\\r?\\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("invalid config line");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (Object.hasOwn(result, key)) throw new Error("duplicate config key: " + key);
    result[key] = value;
  }
  return result;
}
`,
};

const incompleteFiles = {
  ...baselineFiles,
  "src/config.mjs": baselineFiles["src/config.mjs"].replace(
    'const key = line.slice(0, separator).trim();',
    'const rawKey = line.slice(0, separator);\n    const key = rawKey.trim();',
  ).replace(
    'const value = line.slice(separator + 1).trim();',
    'const value = line.slice(separator + 1).trim();\n    if (Object.hasOwn(result, rawKey)) throw new Error("duplicate config key: " + key);',
  ),
};

function revision(files) {
  const material = Object.entries(files).sort(([a], [b]) => a.localeCompare(b))
    .map(([path, contents]) => `${path}\0${contents}`).join("\0");
  return `sha256:${createHash("sha256").update(material).digest("hex")}`;
}

export const fixture = {
  taskId: "r20-bugfix-batch-config-v1",
  category: "bugfix",
  initialRevision: revision(baselineFiles),
  prompt: "Reject duplicate keys in the batch config instead of silently using the last value. Preserve comments, whitespace, values containing '=' and the existing batchPlan output.",
  workspace: {
    files: baselineFiles,
    writableFiles: ["src/config.mjs"],
    network: false,
    timeoutMs: 2000,
    toolchain: "Node.js >=20; built-in modules only; ESM",
  },
  // This is a description for a human/model, not the held-out test itself.
  acceptance: "Duplicate keys fail clearly; valid multi-file batch plans retain their existing shape; values may contain '='.",
  rubric: [
    "Rejects duplicate keys without changing valid parsing semantics (0-3).",
    "Preserves the config-to-batchPlan dependency and handles values containing '=' (0-2).",
    "Keeps the change focused, readable, and free of network/dependency additions (0-1).",
  ],
  referenceFiles,
  incompleteFiles,
};

async function materialize(root, files) {
  for (const [path, contents] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
}

function runNode(root, expression) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", expression], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputTruncated = false;
    let timedOut = false;
    const append = (current, chunk) => {
      const next = current + chunk;
      if (next.length > 16_384) outputTruncated = true;
      return next.slice(0, 16_384);
    };
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, fixture.workspace.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, signal: null, stdout, stderr, outputTruncated, timedOut, error: String(error) });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, outputTruncated, timedOut });
    });
  });
}

async function accepts(root) {
  const moduleUrl = pathToFileURL(join(root, "src/main.mjs")).href;
  const configUrl = pathToFileURL(join(root, "src/config.mjs")).href;
  const expression = `import { batchPlan } from ${JSON.stringify(moduleUrl)};
import { parseBatchConfig } from ${JSON.stringify(configUrl)};
const config = parseBatchConfig("# comment\\n jobs = alpha,beta \\noutputDir = build \\nretries=2\\nlabel=a=b");
if (JSON.stringify(config) !== JSON.stringify({jobs:"alpha,beta", outputDir:"build", retries:"2", label:"a=b"})) process.exit(2);
const good = batchPlan("jobs=alpha,beta\\noutputDir=build\\nretries=2\\nlabel=a=b");
if (JSON.stringify(good) !== JSON.stringify([
  {name:"alpha", output:"build/alpha.json", retries:2},
  {name:"beta", output:"build/beta.json", retries:2}
])) process.exit(2);
let rejected = false;
try { batchPlan("jobs=alpha\\njobs=beta"); } catch { rejected = true; }
let whitespaceRejected = false;
try { batchPlan("jobs=alpha\\n jobs = beta"); } catch { whitespaceRejected = true; }
if (!rejected || !whitespaceRejected) process.exit(3);`;
  const result = await runNode(root, expression);
  return { ...result, passed: result.code === 0 && !result.signal && !result.timedOut };
}

export async function validateFixture() {
  const root = await mkdtemp(join(tmpdir(), "wm-r20a-"));
  const outcomes = {};
  try {
    for (const [name, files] of Object.entries({ baseline: baselineFiles, reference: referenceFiles, incomplete: incompleteFiles })) {
      const workspace = join(root, name);
      await mkdir(workspace);
      await materialize(workspace, files);
      outcomes[name] = await accepts(workspace);
    }
    return {
      initialRevision: fixture.initialRevision,
      baselineFails: !outcomes.baseline.passed,
      referencePasses: outcomes.reference.passed,
      incompleteFails: !outcomes.incomplete.passed,
      outcomes,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await validateFixture();
  if (!result.baselineFails || !result.referencePasses || !result.incompleteFails) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ...result, outcomes: undefined }, null, 2));
  }
}
