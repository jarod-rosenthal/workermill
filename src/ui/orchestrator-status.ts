export const ORCHESTRATOR_STATUS_THROTTLE_MS = 2000;

/**
 * Decide whether a new orchestrator status text should be committed to UI.
 *
 * Rules:
 * - Always allow clear (`next === ""`) to avoid stale busy indicators.
 * - Always allow first non-empty status.
 * - Suppress identical text updates.
 * - Throttle changing non-empty statuses to reduce terminal flicker.
 */
export function shouldCommitStatusUpdate(
  previous: string,
  next: string,
  msSinceLastCommit: number,
): boolean {
  if (next === previous) return false;
  if (!next) return true;
  if (!previous) return true;
  return msSinceLastCommit >= ORCHESTRATOR_STATUS_THROTTLE_MS;
}
