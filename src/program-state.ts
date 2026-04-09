/**
 * Persists /program run state so long-running multi-issue execution can resume
 * after interruption or a controlled pause.
 *
 * Stored at ~/.workermill/program-runs.json and keyed by:
 *   <workingDir>::<parentIssueRef>
 */

import fs from "fs";
import path from "path";
import { getStateRoot } from "./state-root.js";
import type { ProgramEpic } from "./program-queue.js";

const STATE_FILE = path.join(getStateRoot(), "program-runs.json");

export interface ProgramRunState {
  workingDir: string;
  parentIssueRef: string;
  parentTitle: string;
  epics: ProgramEpic[];
  completedIssueKeys: string[];
  currentEpicIndex: number;
  currentIssueIndex: number;
  status: "running" | "paused" | "complete";
  lastFailureCode?: string;
  lastFailureMessage?: string;
  updatedAt: string; // ISO timestamp
}

type ProgramRunMap = Record<string, ProgramRunState>;

function makeKey(workingDir: string, parentIssueRef: string): string {
  return `${workingDir}::${parentIssueRef}`;
}

function readAll(): ProgramRunMap {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as ProgramRunMap;
  } catch {
    return {};
  }
}

function writeAll(runs: ProgramRunMap): void {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(runs, null, 2) + "\n", "utf-8");
}

export function saveProgramRun(state: ProgramRunState): void {
  const runs = readAll();
  const key = makeKey(state.workingDir, state.parentIssueRef);
  runs[key] = {
    ...state,
    completedIssueKeys: [...new Set(state.completedIssueKeys)],
    updatedAt: new Date().toISOString(),
  };

  // Prune stale rows older than 14 days.
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  for (const [rowKey, row] of Object.entries(runs)) {
    if (new Date(row.updatedAt).getTime() < cutoff) delete runs[rowKey];
  }

  writeAll(runs);
}

export function getProgramRun(workingDir: string, parentIssueRef: string): ProgramRunState | null {
  const runs = readAll();
  const key = makeKey(workingDir, parentIssueRef);
  return runs[key] || null;
}

export function clearProgramRun(workingDir: string, parentIssueRef: string): void {
  const runs = readAll();
  const key = makeKey(workingDir, parentIssueRef);
  delete runs[key];
  writeAll(runs);
}

