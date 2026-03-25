import fs from "fs";
import path from "path";

const LEARNINGS_FILE = path.join(process.cwd(), ".workermill", "learnings.json");

export function loadLearnings(): string[] {
  try {
    if (fs.existsSync(LEARNINGS_FILE)) {
      return JSON.parse(fs.readFileSync(LEARNINGS_FILE, "utf-8")) as string[];
    }
  } catch { /* ignore */ }
  return [];
}

export function saveLearnings(learnings: string[]): void {
  try {
    const dir = path.dirname(LEARNINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Keep max 50 learnings, newest last
    const trimmed = learnings.slice(-50);
    fs.writeFileSync(LEARNINGS_FILE, JSON.stringify(trimmed, null, 2) + "\n", "utf-8");
  } catch { /* ignore */ }
}

export function mergeLearnings(existing: string[], newLearnings: string[]): string[] {
  const set = new Set(existing);
  for (const l of newLearnings) {
    set.add(l);
  }
  return [...set];
}
