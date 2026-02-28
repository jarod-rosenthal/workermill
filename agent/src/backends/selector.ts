/**
 * Backend Selector
 *
 * Reads ~/.workermill/config.json and returns the appropriate backend.
 * - mode: "cloud" + apiKey → CloudBackend
 * - mode: "standalone" or no config → LocalBackend
 */

import { isCloudMode } from "./local/config.js";
import type { AgentBackend } from "./types.js";

let activeBackend: AgentBackend | null = null;

/**
 * Get or create the active backend based on config.
 * Caches the instance — call resetBackend() to force re-evaluation.
 */
export async function getBackend(): Promise<AgentBackend> {
  if (activeBackend) return activeBackend;

  if (isCloudMode()) {
    const { CloudBackend } = await import("./cloud/index.js");
    activeBackend = new CloudBackend();
  } else {
    const { LocalBackend } = await import("./local/index.js");
    activeBackend = new LocalBackend();
  }

  await activeBackend.initialize();
  return activeBackend;
}

/** Get the active backend without initializing (returns null if not yet created). */
export function getActiveBackend(): AgentBackend | null {
  return activeBackend;
}

/** Shut down and reset the active backend. */
export async function resetBackend(): Promise<void> {
  if (activeBackend) {
    await activeBackend.shutdown();
    activeBackend = null;
  }
}
