/**
 * Shared active process tracking — used by both spawner.ts and docker-spawner.ts.
 *
 * Extracted to avoid a circular import between the two modules.
 */

import type { ChildProcess } from "child_process";

export interface ActiveProcess {
  taskId: string;
  process: ChildProcess;
  startedAt: Date;
  status: "running" | "completed" | "failed";
  /** True if we saw a ::result:: marker in stdout */
  resultEmitted: boolean;
  /** Temp working directory for this task (empty string for Docker workers) */
  workDir: string;
}

/**
 * Tracks all active worker processes (native + Docker).
 * Shared across spawner.ts and docker-spawner.ts so that
 * getActiveCount() / getActiveTaskIds() work regardless of spawn method.
 */
export const activeProcesses = new Map<string, ActiveProcess>();
