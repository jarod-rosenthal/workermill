import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const OUTPUT_LIMIT = 16_384;

// New R20c fixtures share this exact algorithm so their pinned revisions are
// stable over their sorted workspace paths and raw file bytes.
export function initialRevision(files) {
  const material = Object.entries(files).sort(([a], [b]) => a.localeCompare(b))
    .map(([filePath, contents]) => `${filePath}\0${contents}`).join("\0");
  return `sha256:${createHash("sha256").update(material).digest("hex")}`;
}

export async function materialize(root, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const normalized = normalize(relativePath);
    if (isAbsolute(relativePath) || normalized === ".." || normalized.startsWith(`..${sep}`)) {
      throw new Error(`fixture path escapes workspace: ${relativePath}`);
    }
    const target = join(root, normalized);
    if (relative(root, target).startsWith(`..${sep}`) || isAbsolute(relative(root, target))) {
      throw new Error(`fixture path escapes workspace: ${relativePath}`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
}

export function runNode(root, expression, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", expression], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let outputTruncated = false;
    let timedOut = false;
    const append = (current, chunk) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length > OUTPUT_LIMIT) outputTruncated = true;
      return next.subarray(0, OUTPUT_LIMIT);
    };
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const finish = (result) => {
      clearTimeout(timer);
      resolve({ ...result, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), outputTruncated, timedOut,
        passed: result.code === 0 && !result.signal && !timedOut });
    };
    child.once("error", (error) => finish({ code: null, signal: null, error: String(error) }));
    child.once("close", (code, signal) => finish({ code, signal }));
  });
}

export async function validateVariants({ fixture, variants, testExpression }) {
  const root = await mkdtemp(join(tmpdir(), "wm-r20-"));
  const outcomes = {};
  try {
    for (const [name, files] of Object.entries(variants)) {
      const workspace = join(root, name);
      await mkdir(workspace);
      await materialize(workspace, files);
      const mainUrl = pathToFileURL(join(workspace, "src/main.mjs")).href;
      outcomes[name] = await testExpression(workspace, mainUrl, fixture.workspace.timeoutMs);
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

export function semanticExpression(moduleUrl, source) {
  return `import * as app from ${JSON.stringify(moduleUrl)};\n${source}`;
}

export function printValidation(result) {
  console.log(JSON.stringify(result, null, 2));
  if (!result.baselineFails || !result.referencePasses || !result.incompleteFails) process.exitCode = 1;
}
