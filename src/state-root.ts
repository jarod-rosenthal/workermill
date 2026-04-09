/**
 * Central state root resolver — all WorkerMill state paths derive from this.
 *
 * Default: ~/.workermill
 * Override: set WM_STATE_ROOT environment variable (used by tests)
 *
 * Usage:
 *   import { getStateRoot } from "./state-root.js";
 *   const configDir = path.join(getStateRoot(), "cli.json");
 */

import os from "os";
import path from "path";

/** Get the root directory for all WorkerMill state. */
export function getStateRoot(): string {
  return process.env.WM_STATE_ROOT || path.join(os.homedir(), ".workermill");
}
