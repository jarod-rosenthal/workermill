import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import * as logger from "./logger.js";

interface ContentPart {
  type: "text" | "image";
  text?: string;
  image?: string; // base64
  mimeType?: string;
}

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

/**
 * Parse user input for image file references.
 * Supports @path/to/image.png syntax.
 * Returns structured content parts for the AI SDK.
 */
export function parseImageReferences(
  input: string,
  workingDir: string,
): { parts: ContentPart[]; hasImages: boolean } {
  const parts: ContentPart[] = [];
  let hasImages = false;

  // Match @path/to/file.ext patterns
  const atPattern = /@([\w./-]+\.(?:png|jpg|jpeg|gif|webp|bmp))\b/gi;
  const matches = [...input.matchAll(atPattern)];

  if (matches.length === 0) {
    return { parts: [{ type: "text", text: input }], hasImages: false };
  }

  let lastIndex = 0;
  for (const match of matches) {
    const filePath = match[1];
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(workingDir, filePath);

    // Path traversal guard — stay within working directory
    const normalizedWork = path.resolve(workingDir);
    if (!path.resolve(fullPath).startsWith(normalizedWork)) {
      parts.push({ type: "text", text: `(blocked: ${filePath} is outside working directory)` });
      lastIndex = (match.index || 0) + match[0].length;
      continue;
    }

    // Add text before this match
    const textBefore = input.slice(lastIndex, match.index).trim();
    if (textBefore) {
      parts.push({ type: "text", text: textBefore });
    }

    try {
      if (fs.existsSync(fullPath)) {
        const data = fs.readFileSync(fullPath);
        const ext = path.extname(fullPath).toLowerCase();
        const mimeType = MIME_TYPES[ext] || "image/png";
        parts.push({ type: "image", image: data.toString("base64"), mimeType });
        hasImages = true;
      } else {
        parts.push({ type: "text", text: `(image not found: ${filePath})` });
      }
    } catch {
      parts.push({ type: "text", text: `(failed to read: ${filePath})` });
    }

    lastIndex = (match.index || 0) + match[0].length;
  }

  const textAfter = input.slice(lastIndex).trim();
  if (textAfter) {
    parts.push({ type: "text", text: textAfter });
  }

  return { parts, hasImages };
}

/**
 * Convert parsed content parts to AI SDK message format.
 */
export function toMessageContent(
  parts: ContentPart[],
): string | Array<{ type: "text"; text: string } | { type: "image"; image: string; mimeType?: string }> {
  if (parts.length === 1 && parts[0].type === "text") {
    return parts[0].text || "";
  }

  return parts.map((p) => {
    if (p.type === "image") {
      return { type: "image" as const, image: p.image!, mimeType: p.mimeType };
    }
    return { type: "text" as const, text: p.text || "" };
  });
}

/**
 * Parse @file references for text files (not images).
 * Returns the input with @file references replaced by file contents.
 */
export function resolveFileReferences(input: string, workingDir: string): string {
  const filePattern = /@([\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|json|yaml|yml|toml|md|txt|css|html|sql|sh|env|cfg|conf|xml))\b/gi;
  const matches = [...input.matchAll(filePattern)];

  if (matches.length === 0) return input;

  let result = input;
  for (const match of matches) {
    const filePath = match[1];
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(workingDir, filePath);

    // Path traversal guard
    const normalizedWork = path.resolve(workingDir);
    if (!path.resolve(fullPath).startsWith(normalizedWork)) {
      result = result.replace(match[0], `(blocked: ${filePath} is outside working directory)`);
      continue;
    }

    try {
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        result = result.replace(match[0], `\n\`\`\`${path.extname(filePath).slice(1)}\n// ${filePath}\n${content}\n\`\`\`\n`);
      } else {
        result = result.replace(match[0], `(file not found: ${filePath})`);
      }
    } catch {
      result = result.replace(match[0], `(failed to read: ${filePath})`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Folder skip list for directory listings
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", ".git", ".workermill", "__pycache__", ".next", "dist", ".cache"]);

/**
 * Recursively list directory contents up to a given depth.
 * Returns an indented tree string.
 */
function listDirTree(dirPath: string, prefix: string, depth: number, maxDepth: number): string[] {
  if (depth > maxDepth) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  // Sort: directories first, then files, both alphabetical
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const lines: string[] = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.isDirectory()) continue;
    const isDir = entry.isDirectory();
    lines.push(`${prefix}${isDir ? entry.name + "/" : entry.name}`);
    if (isDir && depth < maxDepth) {
      lines.push(...listDirTree(path.join(dirPath, entry.name), prefix + "  ", depth + 1, maxDepth));
    }
  }
  return lines;
}

/**
 * Resolve @folder/ references in user input.
 * Matches `@path/to/dir/` patterns (must end with `/`).
 * Replaces each match with a code block showing the directory tree (max depth 2).
 * Paths must be within workingDir.
 */
export function resolveFolderReferences(input: string, workingDir: string): string {
  // Match @some/path/ — must end with / followed by whitespace or end of input
  const folderPattern = /@([\w./-]+\/)(?=\s|$)/g;
  const matches = [...input.matchAll(folderPattern)];

  if (matches.length === 0) return input;

  let result = input;
  for (const match of matches) {
    const dirRef = match[1];
    const fullPath = path.isAbsolute(dirRef)
      ? dirRef
      : path.resolve(workingDir, dirRef);

    // Path traversal guard
    const normalizedWork = path.resolve(workingDir);
    if (!path.resolve(fullPath).startsWith(normalizedWork)) {
      result = result.replace(match[0], `(blocked: ${dirRef} is outside working directory)`);
      continue;
    }

    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        const tree = listDirTree(fullPath, "  ", 0, 2);
        result = result.replace(match[0], `\n\`\`\`\n// ${dirRef}\n${tree.join("\n")}\n\`\`\`\n`);
      } else {
        result = result.replace(match[0], `(directory not found: ${dirRef})`);
      }
    } catch {
      result = result.replace(match[0], `(failed to read: ${dirRef})`);
    }
  }

  return result;
}

/**
 * Resolve @https://... and @http://... references in user input.
 * Fetches URL content (10s timeout, max 10KB) and inlines it.
 */
export async function resolveUrlReferences(input: string): Promise<string> {
  const urlPattern = /@(https?:\/\/[^\s]+)/g;
  const matches = [...input.matchAll(urlPattern)];

  if (matches.length === 0) return input;

  let result = input;
  for (const match of matches) {
    const url = match[1];
    try {
      // Use curl for fetching — avoids adding HTTP dependencies
      const content = execSync(
        `curl -sL --max-time 10 --max-filesize 10240 ${JSON.stringify(url)}`,
        { encoding: "utf-8", timeout: 12_000 },
      ).trim();
      result = result.replace(match[0], `\n\`\`\`\n// fetched from ${url}\n${content}\n\`\`\`\n`);
    } catch (err) {
      logger.debug("Failed to fetch URL reference", { url, error: err instanceof Error ? err.message : String(err) });
      result = result.replace(match[0], `(failed to fetch: ${url})`);
    }
  }

  return result;
}
