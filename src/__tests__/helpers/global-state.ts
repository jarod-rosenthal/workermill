import fs from "fs";
import os from "os";
import path from "path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    workerMillTestStateRoot: string;
  }
}

export default function globalSetup(project: TestProject): () => void {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "wm-test-state-suite-"));
  // Vitest transfers provided values to both fork and thread pools. Avoid
  // assuming a worker's parent PID identifies the test coordinator.
  project.provide("workerMillTestStateRoot", parent);

  return () => {
    fs.rmSync(parent, { recursive: true, force: true });
  };
}
