import fs from "fs";
import os from "os";
import path from "path";
import { afterAll } from "vitest";

// Keep application state isolated per Vitest worker without changing HOME or
// CODEX_HOME. The original override is restored before the worker exits.
const originalStateRoot = process.env.WM_STATE_ROOT;
const workerStateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wm-test-state-"));
process.env.WM_STATE_ROOT = workerStateRoot;
for (const dir of ["logs", "projects", "sessions", "memory", "commands", "personas"]) {
  fs.mkdirSync(path.join(workerStateRoot, dir), { recursive: true });
}

afterAll(async () => {
  // Logger streams are asynchronous; allow their final writes to settle before
  // removing the worker root.
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (originalStateRoot === undefined) {
    delete process.env.WM_STATE_ROOT;
  } else {
    process.env.WM_STATE_ROOT = originalStateRoot;
  }
  fs.rmSync(workerStateRoot, { recursive: true, force: true });
});
