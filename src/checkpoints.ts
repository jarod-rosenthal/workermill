/**
 * File-level checkpoints — snapshot files before edits so they can be reverted individually.
 * Stored in .workermill/checkpoints/ (gitignored).
 */
import fs from "fs";
import path from "path";

interface Checkpoint {
  originalPath: string;
  backupPath: string;
  timestamp: number;
}

const checkpoints: Checkpoint[] = [];
let workingDir = process.cwd();

export function setCheckpointDir(dir: string): void {
  workingDir = dir;
}

function checkpointDir(): string {
  return path.join(workingDir, ".workermill", "checkpoints");
}

/**
 * Snapshot a file before it gets edited. Returns true if a checkpoint was created.
 * Skips if the file doesn't exist yet (new file — nothing to revert to).
 */
export function checkpoint(filePath: string): boolean {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) return false;

  const dir = checkpointDir();
  fs.mkdirSync(dir, { recursive: true });

  const timestamp = Date.now();
  const safeName = resolvedPath.replace(/[/\\:]/g, "_");
  const backupPath = path.join(dir, `${timestamp}-${safeName}`);

  fs.copyFileSync(resolvedPath, backupPath);
  checkpoints.push({ originalPath: resolvedPath, backupPath, timestamp });
  return true;
}

/**
 * Revert the last N file edits (default 1). Returns the files restored.
 */
export function undoLast(count = 1): string[] {
  const restored: string[] = [];
  for (let i = 0; i < count && checkpoints.length > 0; i++) {
    const cp = checkpoints.pop()!;
    try {
      fs.copyFileSync(cp.backupPath, cp.originalPath);
      fs.unlinkSync(cp.backupPath);
      restored.push(path.relative(workingDir, cp.originalPath));
    } catch {
      // File may have been deleted — skip
    }
  }
  return restored;
}

/**
 * Revert a specific file to its last checkpoint. Returns true if restored.
 */
export function undoFile(filePath: string): boolean {
  const resolvedPath = path.resolve(filePath);
  // Find the most recent checkpoint for this file
  for (let i = checkpoints.length - 1; i >= 0; i--) {
    if (checkpoints[i].originalPath === resolvedPath) {
      const cp = checkpoints.splice(i, 1)[0];
      try {
        fs.copyFileSync(cp.backupPath, cp.originalPath);
        fs.unlinkSync(cp.backupPath);
        return true;
      } catch {
        return false;
      }
    }
  }
  return false;
}

/**
 * List current checkpoints (most recent first).
 */
export function listCheckpoints(): Array<{ file: string; time: string }> {
  return checkpoints
    .slice()
    .reverse()
    .map(cp => ({
      file: path.relative(workingDir, cp.originalPath),
      time: new Date(cp.timestamp).toLocaleTimeString(),
    }));
}

/**
 * Clear all checkpoints. Call on session end.
 */
export function clearCheckpoints(): void {
  const dir = checkpointDir();
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
  checkpoints.length = 0;
}
