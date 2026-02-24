/**
 * Log Rotation — Prevents agent.log from growing unbounded.
 *
 * Rotates at startup only:
 *   agent.log → agent.log.1 → agent.log.2 → agent.log.3 → deleted
 *
 * - Rotates when file exceeds MAX_LOG_SIZE (10 MB)
 * - Keeps MAX_LOG_FILES rotated files (3 = old sessions only)
 * - Current session always writes to agent.log (one file to look at)
 */

import { existsSync, statSync, renameSync, unlinkSync } from "fs";
import { getLogFile } from "./config.js";

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_LOG_FILES = 3;

/**
 * Rotate log files if the current log exceeds MAX_LOG_SIZE.
 *
 * Called once at startup. Renames agent.log → agent.log.1, etc.
 * Deletes files beyond MAX_LOG_FILES.
 *
 * Returns true if rotation occurred.
 */
export function rotateLogs(): boolean {
  const logFile = getLogFile();

  if (!existsSync(logFile)) return false;

  let size: number;
  try {
    size = statSync(logFile).size;
  } catch {
    return false;
  }

  if (size < MAX_LOG_SIZE) return false;

  // Delete the oldest rotated file if it exists
  const oldest = `${logFile}.${MAX_LOG_FILES}`;
  try {
    if (existsSync(oldest)) unlinkSync(oldest);
  } catch { /* ignore */ }

  // Shift rotated files: .2 → .3, .1 → .2
  for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
    const from = `${logFile}.${i}`;
    const to = `${logFile}.${i + 1}`;
    try {
      if (existsSync(from)) renameSync(from, to);
    } catch { /* ignore */ }
  }

  // Rotate current log → .1
  try {
    renameSync(logFile, `${logFile}.1`);
  } catch { /* ignore */ }

  return true;
}
