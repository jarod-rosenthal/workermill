/**
 * Persists /build run state so /retry can resume after terminal restart.
 *
 * Keyed by feature branch (unique per /build run). Multiple runs per repo.
 * /retry picks the most recent incomplete run for the current working directory.
 * Stored at ~/.workermill/ship-runs.json.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { getStateRoot } from "./state-root.js";
import type { Story } from "./orchestrator.js";

const STATE_FILE = path.join(getStateRoot(), "ship-runs.json");

export interface ShipRun {
  workingDir: string;
  featureBranch: string;
  mainBranch: string; // original branch before /build (e.g. "main", "master", "develop")
  userTask: string;
  stories: Story[];
  completedStoryIds: string[];
  updatedAt: string; // ISO timestamp
}

/** All persisted runs, keyed by feature branch. */
type ShipRunMap = Record<string, ShipRun>;

function readAll(): ShipRunMap {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as ShipRunMap;
  } catch {
    return {};
  }
}

function writeAll(runs: ShipRunMap): void {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(runs, null, 2) + "\n", "utf-8");
}

/** Save or update a run. Called after each story completes. */
export function saveShipRun(run: ShipRun): void {
  const runs = readAll();
  runs[run.featureBranch] = { ...run, updatedAt: new Date().toISOString() };

  // Prune runs older than 7 days
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [branch, r] of Object.entries(runs)) {
    if (new Date(r.updatedAt).getTime() < cutoff) delete runs[branch];
  }

  writeAll(runs);
}

/**
 * Get the most recent incomplete run for a working directory.
 * Returns null if no retryable runs exist.
 */
export function getRetryableRun(workingDir: string): ShipRun | null {
  const runs = readAll();
  let best: ShipRun | null = null;
  let bestTime = 0;

  for (const run of Object.values(runs)) {
    if (run.workingDir !== workingDir) continue;
    // Skip fully completed runs
    if (run.completedStoryIds.length >= run.stories.length) continue;

    // Verify the branch still exists — if deleted, clear the stale state
    if (run.featureBranch) {
      try {
        execSync(`git rev-parse --verify "${run.featureBranch}"`, {
          cwd: workingDir,
          stdio: "pipe",
        });
      } catch {
        // Branch is gone — clean up stale state
        clearShipRun(run.featureBranch);
        continue;
      }
    }

    const t = new Date(run.updatedAt).getTime();
    if (t > bestTime) {
      best = run;
      bestTime = t;
    }
  }

  return best;
}

/** Remove a run by branch (called on successful completion). */
export function clearShipRun(featureBranch: string): void {
  const runs = readAll();
  delete runs[featureBranch];
  writeAll(runs);
}
