/**
 * Session change tracker — tracks file changes for rollback and history view.
 * Supports created files, edits, and multi-file patches.
 */
import fs from "fs";
import path from "path";

interface TrackedChange {
  path: string;
  tool: "write_file" | "edit_file" | "patch";
  beforeContent: string | null; // null => file did not exist
  timestamp: number;
  persona?: string;
  storyId?: string;
}

const trackedChanges: TrackedChange[] = [];
let workingDir = process.cwd();

export function setCheckpointDir(dir: string): void {
  workingDir = dir;
}

/**
 * Track a file change before it happens. Records the pre-change state.
 * For new files, beforeContent is null. Only records first change per file in session.
 */
export function checkpoint(filePath: string, tool: string): boolean {
  const resolvedPath = path.resolve(filePath);
  // Check if already tracked
  if (trackedChanges.some(tc => tc.path === resolvedPath)) return false;

  const beforeContent = fs.existsSync(resolvedPath) ? fs.readFileSync(resolvedPath, "utf-8") : null;
  const timestamp = Date.now();
  trackedChanges.push({ path: resolvedPath, tool: tool as "write_file" | "edit_file" | "patch", beforeContent, timestamp });
  return true;
}

/**
 * Revert the last N file changes (default 1). Returns the files restored.
 */
export function undoLast(count = 1): string[] {
  const restored: string[] = [];
  for (let i = 0; i < count && trackedChanges.length > 0; i++) {
    const tc = trackedChanges.pop()!;
    try {
      if (tc.beforeContent === null) {
        // File was created, delete it
        if (fs.existsSync(tc.path)) fs.unlinkSync(tc.path);
      } else {
        // Restore previous content
        fs.writeFileSync(tc.path, tc.beforeContent, "utf-8");
      }
      restored.push(path.relative(workingDir, tc.path));
    } catch {
      // File may have been deleted or permissions issue — skip
    }
  }
  return restored;
}

/**
 * Revert a specific file to its session start state. Returns true if restored.
 */
export function undoFile(filePath: string): boolean {
  const resolvedPath = path.resolve(filePath);
  // Find the first (earliest) tracked change for this file
  const tc = trackedChanges.find(tc => tc.path === resolvedPath);
  if (!tc) return false;

  try {
    if (tc.beforeContent === null) {
      // File was created, delete it
      if (fs.existsSync(tc.path)) fs.unlinkSync(tc.path);
    } else {
      // Restore previous content
      fs.writeFileSync(tc.path, tc.beforeContent, "utf-8");
    }
    // Remove from tracked changes
    const idx = trackedChanges.indexOf(tc);
    if (idx !== -1) trackedChanges.splice(idx, 1);
    return true;
  } catch {
    return false;
  }
}

/**
 * List current tracked changes (most recent first).
 */
export function listCheckpoints(): Array<{ file: string; time: string }> {
  return trackedChanges
    .slice()
    .reverse()
    .map(tc => ({
      file: path.relative(workingDir, tc.path),
      time: new Date(tc.timestamp).toLocaleTimeString(),
    }));
}

/**
 * Get all tracked changes in this session.
 */
export function getChangedFiles(): TrackedChange[] {
  return trackedChanges.slice();
}

/**
 * Clear all tracked changes. Call on session end.
 */
export function clearCheckpoints(): void {
  trackedChanges.length = 0;
}
