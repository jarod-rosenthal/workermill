/**
 * Run manifest — persists a full record of every /build run for debugging,
 * analytics, and reproducibility.
 *
 * Stored at ~/.workermill/projects/<id>/runs/<run-id>.json
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getProjectRootDir } from "./project-data.js";
import * as logger from "./logger.js";

export interface RunManifestStory {
  id: string;
  title: string;
  persona: string;
  provider?: string;
  model?: string;
  status: "completed" | "failed" | "skipped";
  retryCount: number;
  failureCode?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface RunManifestGate {
  name: string;
  passed: boolean;
  output?: string;
}

export interface RunManifestReview {
  round: number;
  provider: string;
  model: string;
  score: number;
  decision: "approved" | "revision_needed" | "rejected";
  inputTokens?: number;
  outputTokens?: number;
}

export interface RunManifest {
  id: string;
  startedAt: string;
  completedAt?: string;
  userTask: string;
  ticketKey?: string;
  featureBranch?: string | null;
  mainBranch?: string;
  outcome: "success" | "partial" | "failed" | "cancelled";
  stories: RunManifestStory[];
  gates: RunManifestGate[];
  reviews: RunManifestReview[];
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

function runsDir(cwd?: string): string {
  return path.join(getProjectRootDir(cwd), "runs");
}

/** Generate a short deterministic run ID. */
export function generateRunId(): string {
  return `run-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

/** Create a new empty run manifest. */
export function createRunManifest(userTask: string, ticketKey?: string): RunManifest {
  return {
    id: generateRunId(),
    startedAt: new Date().toISOString(),
    userTask: userTask.slice(0, 5000),
    ticketKey,
    outcome: "cancelled",
    stories: [],
    gates: [],
    reviews: [],
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };
}

/** Save the run manifest to disk. */
export function saveRunManifest(manifest: RunManifest, cwd?: string): void {
  try {
    const dir = runsDir(cwd);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${manifest.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  } catch (err) {
    logger.warn("Failed to save run manifest", { id: manifest.id, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Load a run manifest by ID. */
export function loadRunManifest(runId: string, cwd?: string): RunManifest | null {
  try {
    const filePath = path.join(runsDir(cwd), `${runId}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as RunManifest;
  } catch {
    return null;
  }
}

/** List all run manifests, newest first. */
export function listRunManifests(cwd?: string, limit = 20): RunManifest[] {
  try {
    const dir = runsDir(cwd);
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, limit);
    return files
      .map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as RunManifest;
        } catch { return null; }
      })
      .filter((m): m is RunManifest => m !== null);
  } catch {
    return [];
  }
}
