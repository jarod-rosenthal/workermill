/**
 * Memory tool — persistent filesystem-based memory for AI agents.
 *
 * Gives agents a structured interface for managing a `/memories` directory.
 * Agents read memory before starting tasks, create and update files as they
 * work, and reference them in future conversations. Works with any provider.
 *
 * Storage is project-scoped under `~/.workermill/projects/<id>/memories/`.
 */

import fs from "fs";
import path from "path";
import { getProjectRootDir } from "../../project-data.js";

/** Resolve the physical memories directory for the current project. */
export function getMemoriesDir(cwd?: string): string {
  return path.join(getProjectRootDir(cwd), "memories");
}

/** Ensure the memories directory exists. */
export function ensureMemoriesDir(cwd?: string): void {
  const dir = getMemoriesDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Resolve a `/memories/...` virtual path to the physical filesystem path.
 * Validates against path traversal attacks.
 */
function resolvePath(virtualPath: string, cwd?: string): string {
  const root = getMemoriesDir(cwd);
  // Strip the /memories prefix — Claude sends paths like "/memories/notes.md"
  const relative = virtualPath.replace(/^\/memories\/?/, "");
  const resolved = path.resolve(root, relative || ".");
  // Prevent traversal outside the memories directory
  if (!resolved.startsWith(root)) {
    throw new Error(`Path "${virtualPath}" is outside the memories directory.`);
  }
  return resolved;
}

/** Format a file size in human-readable form. */
function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${bytes}`;
}

/**
 * Handle a memory tool command from Claude. Returns the string result
 * that should be sent back as the tool_result content.
 */
export async function executeMemoryCommand(
  action: {
    command: string;
    path?: string;
    file_text?: string;
    old_str?: string;
    new_str?: string;
    insert_line?: number;
    insert_text?: string;
    view_range?: [number, number];
    old_path?: string;
    new_path?: string;
  },
  cwd?: string,
): Promise<string> {
  ensureMemoriesDir(cwd);

  try {
    switch (action.command) {
      case "view":
        return handleView(action.path || "/memories", action.view_range, cwd);
      case "create":
        return handleCreate(action.path!, action.file_text!, cwd);
      case "str_replace":
        return handleStrReplace(action.path!, action.old_str!, action.new_str!, cwd);
      case "insert":
        return handleInsert(action.path!, action.insert_line!, action.insert_text!, cwd);
      case "delete":
        return handleDelete(action.path!, cwd);
      case "rename":
        return handleRename(action.old_path!, action.new_path!, cwd);
      default:
        return `Error: Unknown memory command "${action.command}"`;
    }
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function handleView(
  virtualPath: string,
  viewRange?: [number, number],
  cwd?: string,
): string {
  const resolved = resolvePath(virtualPath, cwd);

  let fd: number;
  try {
    fd = fs.openSync(resolved, "r");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return `The path ${virtualPath} does not exist. Please provide a valid path.`;
    }
    if (err instanceof Error && "code" in err && err.code === "EISDIR") {
      const lines: string[] = [];
      lines.push(`Here're the files and directories up to 2 levels deep in ${virtualPath}, excluding hidden items and node_modules:`);
      listDir(resolved, virtualPath, 0, 2, lines);
      return lines.join("\n");
    }
    throw err;
  }

  let content: string;
  try {
    if (fs.fstatSync(fd).isDirectory()) {
      const lines: string[] = [];
      lines.push(`Here're the files and directories up to 2 levels deep in ${virtualPath}, excluding hidden items and node_modules:`);
      listDir(resolved, virtualPath, 0, 2, lines);
      return lines.join("\n");
    }

    // Read file with line numbers
    content = fs.readFileSync(fd, { encoding: "utf-8" });
  } finally {
    fs.closeSync(fd);
  }
  const allLines = content.split("\n");

  if (allLines.length > 999_999) {
    return `File ${virtualPath} exceeds maximum line limit of 999,999 lines.`;
  }

  let start = 1;
  let end = allLines.length;
  if (viewRange) {
    start = Math.max(1, viewRange[0]);
    end = Math.min(allLines.length, viewRange[1]);
  }

  const numbered = allLines
    .slice(start - 1, end)
    .map((line, i) => `${String(start + i).padStart(6)}\t${line}`)
    .join("\n");

  return `Here's the content of ${virtualPath} with line numbers:\n${numbered}`;
}

function listDir(
  physicalPath: string,
  virtualPath: string,
  depth: number,
  maxDepth: number,
  lines: string[],
): void {
  const stat = fs.statSync(physicalPath);
  const size = formatSize(stat.isDirectory() ? getDirSize(physicalPath) : stat.size);
  lines.push(`${size}\t${virtualPath}`);

  if (!stat.isDirectory() || depth >= maxDepth) return;

  const entries = fs.readdirSync(physicalPath).filter(
    (e) => !e.startsWith(".") && e !== "node_modules",
  );
  for (const entry of entries.sort()) {
    const childPhysical = path.join(physicalPath, entry);
    const childVirtual = `${virtualPath}/${entry}`;
    listDir(childPhysical, childVirtual, depth + 1, maxDepth, lines);
  }
}

function getDirSize(dirPath: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dirPath)) {
      const full = path.join(dirPath, entry);
      const stat = fs.statSync(full);
      total += stat.isDirectory() ? getDirSize(full) : stat.size;
    }
  } catch { /* best effort */ }
  return total;
}

/** Build a YAML frontmatter block for memory provenance tracking. */
export function buildProvenanceHeader(
  source: "agent" | "auto-extracted" | "manual",
  confidence: "high" | "medium" | "low" = "medium",
  context?: { runId?: string; storyId?: string; persona?: string },
): string {
  const resolvedContext = {
    runId: context?.runId ?? process.env.WM_RUN_ID,
    storyId: context?.storyId ?? process.env.WM_STORY_ID,
    persona: context?.persona ?? process.env.WM_PERSONA,
  };
  const lines = [
    "---",
    `source: ${source}`,
    `confidence: ${confidence}`,
    `created: ${new Date().toISOString()}`,
  ];
  if (resolvedContext.runId) lines.push(`run_id: ${resolvedContext.runId}`);
  if (resolvedContext.storyId) lines.push(`story_id: ${resolvedContext.storyId}`);
  if (resolvedContext.persona) lines.push(`persona: ${resolvedContext.persona}`);
  lines.push("---", "", "");
  return lines.join("\n");
}

/** Parse provenance frontmatter from a memory file's content. */
export function parseProvenance(content: string): {
  source?: string;
  confidence?: string;
  created?: string;
  runId?: string;
  storyId?: string;
  persona?: string;
} | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const [key, ...rest] = line.split(": ");
    if (key && rest.length > 0) fields[key.trim()] = rest.join(": ").trim();
  }
  return {
    source: fields.source,
    confidence: fields.confidence,
    created: fields.created,
    runId: fields.run_id,
    storyId: fields.story_id,
    persona: fields.persona,
  };
}

/** List all memory files with their provenance metadata. */
export function listMemoriesWithProvenance(cwd?: string): Array<{
  file: string;
  source?: string;
  confidence?: string;
  created?: string;
  runId?: string;
  storyId?: string;
  persona?: string;
  preview: string;
}> {
  const dir = getMemoriesDir(cwd);
  const results: Array<{
    file: string;
      source?: string;
      confidence?: string;
      created?: string;
      runId?: string;
      storyId?: string;
      persona?: string;
      preview: string;
  }> = [];

  function walk(d: string, prefix: string): void {
    for (const entry of fs.readdirSync(d)) {
      if (entry.startsWith(".")) continue;
      const full = path.join(d, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      try {
        const content = fs.readFileSync(full, "utf-8");
        const prov = parseProvenance(content);
        // Preview: first non-frontmatter, non-empty line
        const body = content.replace(/^---[\s\S]*?---\n*/, "").trim();
        const preview = body.split("\n").find(l => l.trim() && !l.startsWith("#"))?.trim().slice(0, 80) || "";
        results.push({
          file: rel,
          source: prov?.source,
          confidence: prov?.confidence,
          created: prov?.created,
          runId: prov?.runId,
          storyId: prov?.storyId,
          persona: prov?.persona,
          preview,
        });
      } catch (err) {
        if (err instanceof Error && "code" in err && err.code === "EISDIR") {
          walk(full, rel);
        }
      }
    }
  }

  try {
    walk(dir, "");
  } catch (err) {
    if (!(err instanceof Error && "code" in err && err.code === "ENOENT")) {
      throw err;
    }
  }
  return results;
}

function handleCreate(
  virtualPath: string,
  fileText: string,
  cwd?: string,
): string {
  const resolved = resolvePath(virtualPath, cwd);

  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  // Add provenance header if the content doesn't already have frontmatter
  const provenanceContext = {
    runId: process.env.WM_RUN_ID,
    storyId: process.env.WM_STORY_ID,
    persona: process.env.WM_PERSONA,
  };
  const content = fileText.startsWith("---\n") ? fileText : buildProvenanceHeader("agent", "medium", provenanceContext) + fileText;
  try {
    fs.writeFileSync(resolved, content, { encoding: "utf-8", flag: "wx" });
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "EEXIST") {
      return `Error: File ${virtualPath} already exists`;
    }
    throw err;
  }
  return `File created successfully at: ${virtualPath}`;
}

function handleStrReplace(
  virtualPath: string,
  oldStr: string,
  newStr: string,
  cwd?: string,
): string {
  const resolved = resolvePath(virtualPath, cwd);

  let content: string;
  try {
    content = fs.readFileSync(resolved, "utf-8");
  } catch (err) {
    if (err instanceof Error && "code" in err && (err.code === "ENOENT" || err.code === "EISDIR")) {
      return `Error: The path ${virtualPath} does not exist. Please provide a valid path.`;
    }
    throw err;
  }
  const lines = content.split("\n");

  // Find all occurrences
  const matchLines: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = content.indexOf(oldStr, searchFrom);
    if (idx === -1) break;
    const lineNum = content.substring(0, idx).split("\n").length;
    matchLines.push(lineNum);
    searchFrom = idx + oldStr.length;
  }

  if (matchLines.length === 0) {
    return `No replacement was performed, old_str \`${oldStr}\` did not appear verbatim in ${virtualPath}.`;
  }

  if (matchLines.length > 1) {
    return `No replacement was performed. Multiple occurrences of old_str \`${oldStr}\` in lines: ${matchLines.join(", ")}. Please ensure it is unique`;
  }

  const newContent = content.replace(oldStr, newStr);
  fs.writeFileSync(resolved, newContent, "utf-8");

  // Show snippet around the replacement
  const replacementLine = matchLines[0];
  const newLines = newContent.split("\n");
  const snippetStart = Math.max(0, replacementLine - 3);
  const snippetEnd = Math.min(newLines.length, replacementLine + 3);
  const snippet = newLines
    .slice(snippetStart, snippetEnd)
    .map((line, i) => `${String(snippetStart + i + 1).padStart(6)}\t${line}`)
    .join("\n");

  return `The memory file has been edited.\n${snippet}`;
}

function handleInsert(
  virtualPath: string,
  insertLine: number,
  insertText: string,
  cwd?: string,
): string {
  const resolved = resolvePath(virtualPath, cwd);

  let content: string;
  try {
    content = fs.readFileSync(resolved, "utf-8");
  } catch (err) {
    if (err instanceof Error && "code" in err && (err.code === "ENOENT" || err.code === "EISDIR")) {
      return `Error: The path ${virtualPath} does not exist`;
    }
    throw err;
  }
  const lines = content.split("\n");

  if (insertLine < 0 || insertLine > lines.length) {
    return `Error: Invalid \`insert_line\` parameter: ${insertLine}. It should be within the range of lines of the file: [0, ${lines.length}]`;
  }

  lines.splice(insertLine, 0, insertText);
  fs.writeFileSync(resolved, lines.join("\n"), "utf-8");
  return `The file ${virtualPath} has been edited.`;
}

function handleDelete(virtualPath: string, cwd?: string): string {
  const resolved = resolvePath(virtualPath, cwd);

  try {
    fs.rmSync(resolved, { recursive: true, force: false });
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return `Error: The path ${virtualPath} does not exist`;
    }
    throw err;
  }
  return `Successfully deleted ${virtualPath}`;
}

function handleRename(
  oldPath: string,
  newPath: string,
  cwd?: string,
): string {
  const resolvedOld = resolvePath(oldPath, cwd);
  const resolvedNew = resolvePath(newPath, cwd);

  if (!fs.existsSync(resolvedOld)) {
    return `Error: The path ${oldPath} does not exist`;
  }

  if (fs.existsSync(resolvedNew)) {
    return `Error: The destination ${newPath} already exists`;
  }

  const dir = path.dirname(resolvedNew);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(resolvedOld, resolvedNew);
  return `Successfully renamed ${oldPath} to ${newPath}`;
}
