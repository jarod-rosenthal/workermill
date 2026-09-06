import fs from "fs";
import os from "os";
import path from "path";
import { afterAll } from "vitest";

// Keep application state isolated per Vitest worker without changing HOME or
// CODEX_HOME. The original override is restored before the worker exits.
const originalStateRoot = process.env.WM_STATE_ROOT;
const markerPath = path.join(os.tmpdir(), `wm-test-state-marker-${process.ppid}`);
const suiteRoot = fs.readFileSync(markerPath, "utf-8").trim();
if (!path.basename(suiteRoot).startsWith("wm-test-state-suite-") || !fs.statSync(suiteRoot).isDirectory()) {
  throw new Error(`Invalid test state root: ${suiteRoot}`);
}
const workerStateRoot = fs.mkdtempSync(path.join(suiteRoot, "worker-"));
process.env.WM_STATE_ROOT = workerStateRoot;
for (const dir of ["logs", "projects", "sessions", "memory", "commands", "personas"]) {
  fs.mkdirSync(path.join(workerStateRoot, dir), { recursive: true });
}

afterAll(() => {
  if (originalStateRoot === undefined) {
    delete process.env.WM_STATE_ROOT;
  } else {
    process.env.WM_STATE_ROOT = originalStateRoot;
  }
});
