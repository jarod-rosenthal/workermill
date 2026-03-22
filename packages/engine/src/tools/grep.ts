import fs from "fs";
import path from "path";

interface ContextLine {
  line: number;
  content: string;
}

interface FileMatch {
  line: number;
  content: string;
  fullLine: string;
  before?: ContextLine[];
  after?: ContextLine[];
}

/**
 * Walk directory and collect files for searching
 */
function walkDir(
  dir: string,
  files: string[] = [],
  maxDepth: number = 20,
  currentDepth: number = 0
): string[] {
  if (currentDepth > maxDepth) return files;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip common ignore patterns
      if (entry.name === "node_modules") continue;
      if (entry.name === "__pycache__") continue;
      if (entry.name === ".git") continue;
      if (entry.name === "dist") continue;
      if (entry.name === "build") continue;
      if (entry.name === ".next") continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) {
          walkDir(fullPath, files, maxDepth, currentDepth + 1);
        }
      } else if (entry.isFile()) {
        // Skip binary and large files
        const ext = path.extname(entry.name).toLowerCase();
        const binaryExts = [
          ".png",
          ".jpg",
          ".jpeg",
          ".gif",
          ".ico",
          ".pdf",
          ".zip",
          ".tar",
          ".gz",
          ".exe",
          ".dll",
          ".so",
          ".dylib",
          ".woff",
          ".woff2",
          ".ttf",
          ".eot",
        ];
        if (!binaryExts.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch (_err) {
    // Skip directories we can't read
  }

  return files;
}

/**
 * Search a single file for pattern matches
 */
function searchFile(
  filePath: string,
  regex: RegExp,
  contextLines: number = 0
): FileMatch[] {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const matches: FileMatch[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (regex.test(line)) {
        const match: FileMatch = {
          line: i + 1,
          content: line.trim(),
          fullLine: line,
        };

        // Add context if requested
        if (contextLines > 0) {
          const beforeStart = Math.max(0, i - contextLines);
          const afterEnd = Math.min(lines.length - 1, i + contextLines);
          match.before = lines
            .slice(beforeStart, i)
            .map((l, idx) => ({
              line: beforeStart + idx + 1,
              content: l,
            }));
          match.after = lines
            .slice(i + 1, afterEnd + 1)
            .map((l, idx) => ({
              line: i + 2 + idx,
              content: l,
            }));
        }

        matches.push(match);
      }
    }

    return matches;
  } catch (_err) {
    return [];
  }
}

export const name = "grep";

export const description =
  "Search for a pattern in files. Uses regex pattern matching. Returns matching lines with file paths and line numbers.";

export const parameters = {
  type: "object" as const,
  properties: {
    pattern: {
      type: "string" as const,
      description: "Regex pattern to search for",
    },
    path: {
      type: "string" as const,
      description:
        "File or directory to search in (default: current directory)",
    },
    filePattern: {
      type: "string" as const,
      description: 'Glob pattern to filter files (e.g., "*.ts", "*.js")',
    },
    ignoreCase: {
      type: "boolean" as const,
      description: "Case-insensitive search (default: false)",
    },
    contextLines: {
      type: "number" as const,
      description:
        "Number of context lines before and after match (default: 0)",
    },
    maxResults: {
      type: "number" as const,
      description:
        "Maximum number of total matches to return (default: 100)",
    },
  },
  required: ["pattern"] as const,
};

interface GrepParams {
  pattern: string;
  path?: string;
  filePattern?: string;
  ignoreCase?: boolean;
  contextLines?: number;
  maxResults?: number;
}

interface GrepMatchEntry {
  line: number;
  content: string;
  before?: ContextLine[];
  after?: ContextLine[];
}

interface GrepResult {
  success: boolean;
  pattern?: string;
  searchPath?: string;
  matchCount?: number;
  fileCount?: number;
  truncated?: boolean;
  results?: Record<string, GrepMatchEntry[]>;
  error?: string;
}

export async function execute({
  pattern,
  path: searchPath,
  filePattern,
  ignoreCase = false,
  contextLines = 0,
  maxResults = 100,
}: GrepParams): Promise<GrepResult> {
  try {
    // Create regex from pattern
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, ignoreCase ? "gi" : "g");
    } catch (err) {
      return {
        success: false,
        error: `Invalid regex pattern: ${(err as Error).message}`,
      };
    }

    const targetPath = searchPath
      ? path.isAbsolute(searchPath)
        ? searchPath
        : path.resolve(process.cwd(), searchPath)
      : process.cwd();

    // Check if path exists
    if (!fs.existsSync(targetPath)) {
      return {
        success: false,
        error: `Path not found: ${targetPath}`,
      };
    }

    const stats = fs.statSync(targetPath);
    let filesToSearch: string[] = [];

    if (stats.isFile()) {
      filesToSearch = [targetPath];
    } else if (stats.isDirectory()) {
      filesToSearch = walkDir(targetPath);
    }

    // Apply file pattern filter if specified
    if (filePattern) {
      const ext = filePattern.replace("*", "");
      filesToSearch = filesToSearch.filter((f) => f.endsWith(ext));
    }

    // Search files
    const results: Array<{
      file: string;
      absolutePath: string;
      line: number;
      content: string;
      before?: ContextLine[];
      after?: ContextLine[];
    }> = [];
    let totalMatches = 0;

    for (const file of filesToSearch) {
      if (totalMatches >= maxResults) break;

      const matches = searchFile(file, regex, contextLines);
      if (matches.length > 0) {
        const relativePath =
          path.relative(targetPath, file).replace(/\\/g, "/") ||
          path.basename(file);

        for (const match of matches) {
          if (totalMatches >= maxResults) break;

          results.push({
            file: relativePath,
            absolutePath: file,
            line: match.line,
            content: match.content,
            ...(contextLines > 0
              ? { before: match.before, after: match.after }
              : {}),
          });
          totalMatches++;
        }
      }
    }

    // Group by file for cleaner output
    const byFile: Record<string, GrepMatchEntry[]> = {};
    for (const result of results) {
      if (!byFile[result.file]) {
        byFile[result.file] = [];
      }
      byFile[result.file].push({
        line: result.line,
        content: result.content,
        ...(result.before ? { before: result.before } : {}),
        ...(result.after ? { after: result.after } : {}),
      });
    }

    return {
      success: true,
      pattern,
      searchPath: targetPath,
      matchCount: totalMatches,
      fileCount: Object.keys(byFile).length,
      truncated: totalMatches >= maxResults,
      results: byFile,
    };
  } catch (err) {
    return {
      success: false,
      error: `Grep search failed: ${(err as Error).message}`,
    };
  }
}
