import fs from "fs";
import path from "path";
import * as logger from "./logger.js";

function learningsPath(): string {
  return path.join(process.cwd(), ".workermill", "learnings.json");
}

export function loadLearnings(): string[] {
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
  try {
    const fp = learningsPath();
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
