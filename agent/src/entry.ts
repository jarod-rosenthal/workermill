***REMOVED***!/usr/bin/env node
/**
 * Unified Entry Point for WorkerMill Agent Binary
 *
 * Routes to CLI, worker, or manager based on __WORKERMILL_MODE env var.
 * When compiled with `bun build --compile`, this single binary serves
 * all three roles — the agent re-invokes itself with the mode env var
 * set to spawn workers as child processes.
 */

const mode = process.env.__WORKERMILL_MODE;

if (mode === "worker") {
  await import("./worker-shim.js");
} else if (mode === "manager") {
  await import("./manager-shim.js");
} else {
  await import("./cli.js");
}
