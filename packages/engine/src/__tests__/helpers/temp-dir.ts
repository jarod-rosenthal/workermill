import fs from "fs";
import os from "os";
import path from "path";

export function createTempDir(prefix = "wm-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
