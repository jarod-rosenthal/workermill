import fs from "fs";
import path from "path";

/**
 * Project instruction file paths, checked in priority order (first found wins).
 * Supports WorkerMill native, Claude Code, Cursor, and GitHub Copilot formats.
 */
const INSTRUCTION_FILES = [
  ".workermill/instructions.md",
  "CLAUDE.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
];

/**
 * Load project instructions from the working directory.
 * Checks predefined paths in priority order and returns the first one found.
 */
export function loadProjectInstructions(workingDir: string): string | null {
  for (const relPath of INSTRUCTION_FILES) {
    const fullPath = path.join(workingDir, relPath);
    try {
      const content = fs.readFileSync(fullPath, "utf-8").trim();
      if (content) return content;
    } catch {
      // File doesn't exist or unreadable — try next
    }
  }
  return null;
}

/**
 * Format project instructions for inclusion in a prompt.
 * Returns empty string if no instructions found.
 */
export function formatProjectInstructions(workingDir: string): string {
  const instructions = loadProjectInstructions(workingDir);
  if (!instructions) return "";
  return `\n\n## Project Instructions\n\n${instructions}\n\n---`;
}
