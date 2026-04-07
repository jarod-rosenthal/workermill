import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import * as logger from "./logger.js";
import { getProjectLearningsPath, ensureProjectDirs } from "./project-data.js";

function learningsPath(): string {
  return getProjectLearningsPath();
}

function migrateLegacyLearnings(): void {
  // Old path using raw cwd hash
  const oldHash = crypto.createHash("md5").update(process.cwd()).digest("hex").slice(0, 8);
  const oldPath = path.join(os.homedir(), ".workermill", "learnings", `${oldHash}.json`);
  const newPath = learningsPath();

  if (!fs.existsSync(oldPath) || fs.existsSync(newPath)) return;

  try {
    fs.copyFileSync(oldPath, newPath);
    if (fs.readFileSync(oldPath, 'utf-8') === fs.readFileSync(newPath, 'utf-8')) {
      fs.unlinkSync(oldPath);
      // Remove old dir if empty
      const oldDir = path.dirname(oldPath);
      try {
        fs.rmdirSync(oldDir);
      } catch {}
    } else {
      // Remove failed copy
      try { fs.unlinkSync(newPath); } catch {}
    }
  } catch (err) {
    logger.error("Failed to migrate legacy learnings", { error: err instanceof Error ? err.message : String(err) });
  }
}

export function loadLearnings(): string[] {
  migrateLegacyLearnings();
  try {
    const fp = learningsPath();
    if (fs.existsSync(fp)) {
      return JSON.parse(fs.readFileSync(fp, "utf-8")) as string[];
    }
  } catch (err) {
    logger.error("Failed to load learnings", { error: err instanceof Error ? err.message : String(err) });
  }
  return [];
}

export function saveLearnings(learnings: string[]): void {
  migrateLegacyLearnings();
  try {
    const fp = learningsPath();
    ensureProjectDirs();
    // Keep max 50 learnings, newest last
    const trimmed = learnings.slice(-50);
    fs.writeFileSync(fp, JSON.stringify(trimmed, null, 2) + "\n", "utf-8");
  } catch (err) {
    logger.error("Failed to save learnings", { error: err instanceof Error ? err.message : String(err) });
  }
}

export function mergeLearnings(existing: string[], newLearnings: string[]): string[] {
  const set = new Set(existing);
  for (const l of newLearnings) {
    set.add(l);
  }
  return [...set];
}
