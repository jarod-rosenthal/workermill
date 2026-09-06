import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const OUTPUT_LIMIT = 16_384;

export async function materialize(root, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const normalized = normalize(relativePath);
    if (isAbsolute(relativePath) || normalized === ".." || normalized.startsWith(`..${"/"}`)) {
      throw new Error(`fixture path escapes workspace: ${relativePath}`);
    }
    const target = join(root, normalized);
    if (relative(root, target).startsWith(`..${"/"}`) || isAbsolute(relative(root, target))) {
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
    let stdout = "";
    let stderr = "";
    let outputTruncated = false;
    let timedOut = false;
    const append = (current, chunk) => {
      const next = current + chunk;
      if (next.length > OUTPUT_LIMIT) outputTruncated = true;
      return next.slice(0, OUTPUT_LIMIT);
    };
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk.toString()); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk.toString()); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const finish = (result) => {
      clearTimeout(timer);
      resolve({ ...result, stdout, stderr, outputTruncated, timedOut,
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
