import fs from "fs";
import path from "path";

export const name = "ls";

export const description =
  "List directory contents in a tree format. Shows file names, types, and sizes. " +
  "More efficient than bash ls — no subprocess needed, returns structured output.";

export const parameters = {
  type: "object" as const,
  properties: {
    path: {
      type: "string" as const,
      description: "Directory path to list (absolute or relative to cwd)",
    },
    ignore: {
      type: "array" as const,
      items: { type: "string" as const },
      description:
        'Glob patterns to exclude (e.g., ["node_modules", "dist"]). Defaults to node_modules and .git.',
    },
    maxDepth: {
      type: "number" as const,
      description: "Maximum directory depth to traverse (default: 3)",
    },
    maxFiles: {
      type: "number" as const,
      description: "Maximum number of entries to return (default: 1000)",
    },
  },
  required: ["path"] as const,
};

interface LsParams {
  path: string;
  ignore?: string[];
  maxDepth?: number;
  maxFiles?: number;
}

interface LsResult {
  success: boolean;
  tree: string;
  totalFiles: number;
  totalDirs: number;
  truncated: boolean;
  error?: string;
}

const DEFAULT_IGNORE = ["node_modules", ".git", "__pycache__", ".next", ".nuxt", ".workermill"];

function shouldIgnore(name: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((pattern) => {
    if (pattern.startsWith("*.")) {
      return name.endsWith(pattern.slice(1));
    }
    return name === pattern;
  });
}

function buildTree(
  dirPath: string,
  prefix: string,
  depth: number,
  maxDepth: number,
  ignorePatterns: string[],
  state: { files: number; dirs: number; lines: string[]; maxFiles: number }
): void {
  if (depth > maxDepth || state.files + state.dirs >= state.maxFiles) {
    if (depth > maxDepth) {
      state.lines.push(`${prefix}... (max depth reached)`);
    }
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    state.lines.push(`${prefix}[permission denied]`);
    return;
  }

  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  entries = entries.filter((e) => !shouldIgnore(e.name, ignorePatterns));

  for (let i = 0; i < entries.length; i++) {
    if (state.files + state.dirs >= state.maxFiles) {
      state.lines.push(`${prefix}... (${state.maxFiles} entries limit reached)`);
      return;
    }

    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      state.dirs++;
      state.lines.push(`${prefix}${connector}${entry.name}/`);
      buildTree(fullPath, prefix + childPrefix, depth + 1, maxDepth, ignorePatterns, state);
    } else {
      state.files++;
      let size = "";
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size < 1024) size = ` (${stat.size}B)`;
        else if (stat.size < 1024 * 1024) size = ` (${(stat.size / 1024).toFixed(1)}KB)`;
        else size = ` (${(stat.size / (1024 * 1024)).toFixed(1)}MB)`;
      } catch {
        // Skip size on error
      }
      state.lines.push(`${prefix}${connector}${entry.name}${size}`);
    }
  }
}

export async function execute({
  path: dirPath,
  ignore,
  maxDepth = 3,
  maxFiles = 1000,
}: LsParams): Promise<LsResult> {
  try {
    if (!fs.existsSync(dirPath)) {
      return { success: false, tree: "", totalFiles: 0, totalDirs: 0, truncated: false, error: `Directory not found: ${dirPath}` };
    }

    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      return { success: false, tree: "", totalFiles: 0, totalDirs: 0, truncated: false, error: `Not a directory: ${dirPath}` };
    }

    const ignorePatterns = ignore ? [...DEFAULT_IGNORE, ...ignore] : DEFAULT_IGNORE;
    const state = { files: 0, dirs: 0, lines: [] as string[], maxFiles };

    state.lines.push(dirPath);
    buildTree(dirPath, "", 0, maxDepth, ignorePatterns, state);

    const truncated = state.files + state.dirs >= maxFiles;

    return { success: true, tree: state.lines.join("\n"), totalFiles: state.files, totalDirs: state.dirs, truncated };
  } catch (err) {
    return { success: false, tree: "", totalFiles: 0, totalDirs: 0, truncated: false, error: `Failed to list directory: ${err instanceof Error ? err.message : String(err)}` };
  }
}
