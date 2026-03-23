import fs from "fs";
import path from "path";
/**
 * Simple glob implementation using only Node.js built-ins.
 * Supports: *, **, ?, [abc], [!abc], {a,b,c}
 */
function globToRegex(pattern) {
    let regex = "";
    let i = 0;
    const len = pattern.length;
    while (i < len) {
        const c = pattern[i];
        if (c === "*") {
            if (pattern[i + 1] === "*") {
                // ** matches any path including separators
                if (pattern[i + 2] === "/" || pattern[i + 2] === undefined) {
                    regex += "(?:[^/]*(?:/[^/]*)*)";
                    i += pattern[i + 2] === "/" ? 3 : 2;
                    continue;
                }
            }
            // * matches anything except /
            regex += "[^/]*";
            i++;
        }
        else if (c === "?") {
            regex += "[^/]";
            i++;
        }
        else if (c === "[") {
            // Character class
            let j = i + 1;
            let classContent = "";
            if (pattern[j] === "!") {
                classContent += "^";
                j++;
            }
            while (j < len && pattern[j] !== "]") {
                classContent += pattern[j];
                j++;
            }
            regex += `[${classContent}]`;
            i = j + 1;
        }
        else if (c === "{") {
            // Brace expansion
            let j = i + 1;
            const options = [];
            let current = "";
            while (j < len && pattern[j] !== "}") {
                if (pattern[j] === ",") {
                    options.push(current);
                    current = "";
                }
                else {
                    current += pattern[j];
                }
                j++;
            }
            options.push(current);
            regex += `(?:${options.map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`;
            i = j + 1;
        }
        else if (c === "/" || c === "\\") {
            regex += "[/\\\\]";
            i++;
        }
        else if (".+^${}()|[]\\".includes(c)) {
            // Escape special regex characters
            regex += "\\" + c;
            i++;
        }
        else {
            regex += c;
            i++;
        }
    }
    return new RegExp(`^${regex}$`);
}
function walkDir(dir, files = [], maxDepth = 20, currentDepth = 0) {
    if (currentDepth > maxDepth)
        return files;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            // Skip hidden files and common ignore patterns
            if (entry.name.startsWith(".") && entry.name !== ".")
                continue;
            if (entry.name === "node_modules")
                continue;
            if (entry.name === "__pycache__")
                continue;
            if (entry.name === ".git")
                continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walkDir(fullPath, files, maxDepth, currentDepth + 1);
            }
            else if (entry.isFile()) {
                files.push(fullPath);
            }
        }
    }
    catch (_err) {
        // Skip directories we can't read
    }
    return files;
}
export const name = "glob";
export const description = 'Find files matching a glob pattern. Supports patterns like "**/*.ts", "src/**/*.js", "*.{ts,tsx}". Excludes node_modules and hidden files by default.';
export const parameters = {
    type: "object",
    properties: {
        pattern: {
            type: "string",
            description: 'Glob pattern to match files (e.g., "**/*.ts", "src/**/*.js")',
        },
        cwd: {
            type: "string",
            description: "Directory to search in (default: current working directory)",
        },
        maxResults: {
            type: "number",
            description: "Maximum number of results to return (default: 1000)",
        },
        includeHidden: {
            type: "boolean",
            description: "Include hidden files (starting with .) (default: false)",
        },
    },
    required: ["pattern"],
};
export async function execute({ pattern, cwd, maxResults = 1000, includeHidden = false, }) {
    try {
        const searchDir = cwd
            ? path.isAbsolute(cwd)
                ? cwd
                : path.resolve(process.cwd(), cwd)
            : process.cwd();
        // Check if directory exists
        if (!fs.existsSync(searchDir)) {
            return {
                success: false,
                error: `Directory not found: ${searchDir}`,
            };
        }
        // Get all files
        const allFiles = walkDir(searchDir);
        // Create regex from glob pattern
        const regex = globToRegex(pattern);
        // Filter files that match the pattern
        const matches = [];
        for (const file of allFiles) {
            // Get relative path from search directory
            const relativePath = path
                .relative(searchDir, file)
                .replace(/\\/g, "/");
            // Skip hidden files unless requested
            if (!includeHidden &&
                relativePath.split("/").some((part) => part.startsWith("."))) {
                continue;
            }
            if (regex.test(relativePath)) {
                matches.push({
                    path: file,
                    relativePath,
                });
                if (matches.length >= maxResults) {
                    break;
                }
            }
        }
        // Sort by path
        matches.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
        return {
            success: true,
            pattern,
            cwd: searchDir,
            matches: matches.map((m) => m.relativePath),
            absolutePaths: matches.map((m) => m.path),
            count: matches.length,
            truncated: matches.length >= maxResults,
        };
    }
    catch (err) {
        return {
            success: false,
            error: `Glob search failed: ${err.message}`,
        };
    }
}
