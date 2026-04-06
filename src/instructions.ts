import fs from "fs";
import path from "path";

/**
 * Project instruction file paths, checked in priority order (first found wins).
 * Supports WorkerMill native plus common conventions across major agent tools.
 */
const FILE_SOURCES = [
  "AGENT.md",
  "AGENTS.md",
  ".workermill/instructions.md",
  "CLAUDE.md",
  "GEMINI.md",
  ".cursorrules",
  ".windsurfrules",
  ".clinerules",
  ".clinerules.md",
  ".github/copilot-instructions.md",
] as const;

const DIRECTORY_SOURCES: Array<{ dir: string; exts: string[] }> = [
  { dir: ".cursor/rules", exts: [".mdc", ".md"] },
  { dir: ".windsurf/rules", exts: [".mdc", ".md"] },
];

function readTrimmedFile(fullPath: string): string | null {
  try {
    const content = fs.readFileSync(fullPath, "utf-8").trim();
    return content || null;
  } catch {
    return null;
  }
}

function listRuleFiles(absoluteDir: string, exts: string[]): string[] {
  const files: string[] = [];
  try {
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(absoluteDir, entry.name);
      if (entry.isFile() && exts.some((ext) => entry.name.endsWith(ext))) {
        files.push(fullPath);
      }
    }
  } catch {
    return [];
  }
  return files.sort((a, b) => a.localeCompare(b));
}

/**
 * Resolve the first instruction source file/directory that contains content.
 * Returns the source label (relative path) and the content to inject.
 */
export function resolveProjectInstructions(workingDir: string): { source: string; content: string } | null {
  for (const relPath of FILE_SOURCES) {
    const fullPath = path.join(workingDir, relPath);
    const content = readTrimmedFile(fullPath);
    if (content) {
      return { source: relPath, content };
    }
  }

  for (const source of DIRECTORY_SOURCES) {
    const absoluteDir = path.join(workingDir, source.dir);
    const files = listRuleFiles(absoluteDir, source.exts);
    if (files.length === 0) continue;
    const chunks: string[] = [];
    for (const fullPath of files) {
      const content = readTrimmedFile(fullPath);
      if (!content) continue;
      const rel = path.relative(workingDir, fullPath);
      chunks.push(`## ${rel}\n\n${content}`);
    }
    if (chunks.length > 0) {
      return { source: source.dir, content: chunks.join("\n\n---\n\n") };
    }
  }

  return null;
}

/** Return the relative path/label for whichever instruction source is active. */
export function findProjectInstructionSource(workingDir: string): string | null {
  const resolved = resolveProjectInstructions(workingDir);
  return resolved?.source ?? null;
}

/**
 * Load project instructions from the working directory.
 * Checks predefined paths in priority order and returns the first one found.
 */
export function loadProjectInstructions(workingDir: string): string | null {
  const resolved = resolveProjectInstructions(workingDir);
  return resolved?.content ?? null;
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
