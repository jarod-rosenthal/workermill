import { tool } from "ai";
import { z } from "zod";
import path from "path";

import * as bashTool from "./bash.js";
import * as readFileTool from "./read-file.js";
import * as writeFileTool from "./write-file.js";
import * as editFileTool from "./edit-file.js";
import * as globTool from "./glob.js";
import * as grepTool from "./grep.js";
import * as lsTool from "./ls.js";
import * as fetchTool from "./fetch.js";
import * as patchTool from "./patch.js";

// Re-export all tool modules
export { bashTool, readFileTool, writeFileTool, editFileTool, globTool, grepTool, lsTool, fetchTool, patchTool };

/**
 * Creates Vercel AI SDK tool definitions for use with generateText().
 * All file paths are resolved relative to workingDir.
 */
export function createToolDefinitions(workingDir: string) {
  return {
    bash: tool({
      description: bashTool.description,
      inputSchema: z.object({
        command: z.string().describe("The bash command to execute"),
        cwd: z
          .string()
          .optional()
          .describe("Working directory for the command (optional)"),
        timeout: z
          .number()
          .optional()
          .describe("Timeout in milliseconds (default: 120000 = 2 minutes)"),
      }),
      execute: async ({ command, cwd, timeout }) => {
        const resolvedCwd = cwd
          ? path.isAbsolute(cwd)
            ? cwd
            : path.resolve(workingDir, cwd)
          : workingDir;
        const result = await bashTool.execute({
          command,
          cwd: resolvedCwd,
          timeout,
        });
        if (result.success) {
          return result.stdout || "(no output)";
        }
        return `Error: ${result.error || result.stderr}\n${result.stdout || ""}`.trim();
      },
    }),

    read_file: tool({
      description: readFileTool.description,
      inputSchema: z.object({
        path: z
          .string()
          .describe("Path to the file to read (absolute or relative to cwd)"),
        encoding: z.string().optional().describe("File encoding (default: utf8)"),
        maxLines: z
          .number()
          .optional()
          .describe(
            "Maximum number of lines to read (optional, reads entire file if not specified)"
          ),
        startLine: z
          .number()
          .optional()
          .describe("Line number to start reading from (1-indexed, optional)"),
      }),
      execute: async ({ path: filePath, encoding, maxLines, startLine }) => {
        const resolvedPath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(workingDir, filePath);
        const result = await readFileTool.execute({
          path: resolvedPath,
          encoding: encoding as BufferEncoding | undefined,
          maxLines,
          startLine,
        });
        if (result.success) {
          return result.content || "";
        }
        return `Error: ${result.error}`;
      },
    }),

    write_file: tool({
      description: writeFileTool.description,
      inputSchema: z.object({
        path: z
          .string()
          .describe("Path to the file to write (absolute or relative to cwd)"),
        content: z.string().describe("Content to write to the file"),
        encoding: z
          .string()
          .optional()
          .describe("File encoding (default: utf8)"),
        append: z
          .boolean()
          .optional()
          .describe("Append to file instead of overwriting (default: false)"),
      }),
      execute: async ({ path: filePath, content, encoding, append }) => {
        const resolvedPath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(workingDir, filePath);
        const result = await writeFileTool.execute({
          path: resolvedPath,
          content,
          encoding: encoding as BufferEncoding | undefined,
          append,
        });
        if (result.success) {
          return `File ${result.action} successfully: ${result.path} (${result.linesWritten} lines, ${result.size} bytes)`;
        }
        return `Error: ${result.error}`;
      },
    }),

    edit_file: tool({
      description: editFileTool.description,
      inputSchema: z.object({
        path: z
          .string()
          .describe("Path to the file to edit (absolute or relative to cwd)"),
        old_string: z
          .string()
          .describe(
            "The exact text to find and replace. Must match exactly including whitespace and indentation."
          ),
        new_string: z
          .string()
          .describe(
            "The text to replace old_string with. Can be empty string to delete."
          ),
        replaceAll: z
          .boolean()
          .optional()
          .describe(
            "Replace all occurrences instead of requiring unique match (default: false)"
          ),
      }),
      execute: async ({ path: filePath, old_string, new_string, replaceAll }) => {
        const resolvedPath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(workingDir, filePath);
        const result = await editFileTool.execute({
          path: resolvedPath,
          old_string,
          new_string,
          replaceAll,
        });
        if (result.success) {
          return `File edited: ${result.path} (${result.replacements} replacement(s), ${result.linesDiff} lines)`;
        }
        return `Error: ${result.error}${result.hint ? `\nHint: ${result.hint}` : ""}`;
      },
    }),

    glob: tool({
      description: globTool.description,
      inputSchema: z.object({
        pattern: z
          .string()
          .describe('Glob pattern to match files (e.g., "**/*.ts", "src/**/*.js")'),
        cwd: z
          .string()
          .optional()
          .describe("Directory to search in (default: current working directory)"),
        maxResults: z
          .number()
          .optional()
          .describe("Maximum number of results to return (default: 1000)"),
        includeHidden: z
          .boolean()
          .optional()
          .describe("Include hidden files (starting with .) (default: false)"),
      }),
      execute: async ({ pattern, cwd, maxResults, includeHidden }) => {
        const resolvedCwd = cwd
          ? path.isAbsolute(cwd)
            ? cwd
            : path.resolve(workingDir, cwd)
          : workingDir;
        const result = await globTool.execute({
          pattern,
          cwd: resolvedCwd,
          maxResults,
          includeHidden,
        });
        if (result.success) {
          if (result.count === 0) {
            return `No files found matching pattern: ${pattern}`;
          }
          return `Found ${result.count} file(s)${result.truncated ? " (truncated)" : ""}:\n${result.matches!.join("\n")}`;
        }
        return `Error: ${result.error}`;
      },
    }),

    grep: tool({
      description: grepTool.description,
      inputSchema: z.object({
        pattern: z.string().describe("Regex pattern to search for"),
        path: z
          .string()
          .optional()
          .describe("File or directory to search in (default: current directory)"),
        filePattern: z
          .string()
          .optional()
          .describe('Glob pattern to filter files (e.g., "*.ts", "*.js")'),
        ignoreCase: z
          .boolean()
          .optional()
          .describe("Case-insensitive search (default: false)"),
        contextLines: z
          .number()
          .optional()
          .describe(
            "Number of context lines before and after match (default: 0)"
          ),
        maxResults: z
          .number()
          .optional()
          .describe(
            "Maximum number of total matches to return (default: 100)"
          ),
      }),
      execute: async ({
        pattern,
        path: searchPath,
        filePattern,
        ignoreCase,
        contextLines,
        maxResults,
      }) => {
        const resolvedPath = searchPath
          ? path.isAbsolute(searchPath)
            ? searchPath
            : path.resolve(workingDir, searchPath)
          : workingDir;
        const result = await grepTool.execute({
          pattern,
          path: resolvedPath,
          filePattern,
          ignoreCase,
          contextLines,
          maxResults,
        });
        if (result.success) {
          if (result.matchCount === 0) {
            return `No matches found for pattern: ${pattern}`;
          }
          const lines: string[] = [
            `Found ${result.matchCount} match(es) in ${result.fileCount} file(s)${result.truncated ? " (truncated)" : ""}:`,
          ];
          for (const [file, matches] of Object.entries(result.results!)) {
            for (const match of matches) {
              lines.push(`${file}:${match.line}: ${match.content}`);
            }
          }
          return lines.join("\n");
        }
        return `Error: ${result.error}`;
      },
    }),

    ls: tool({
      description: lsTool.description,
      inputSchema: z.object({
        path: z.string().describe("Directory path to list (absolute or relative to cwd)"),
        ignore: z.array(z.string()).optional().describe('Glob patterns to exclude (e.g., ["node_modules", "dist"])'),
        maxDepth: z.number().optional().describe("Maximum directory depth to traverse (default: 3)"),
        maxFiles: z.number().optional().describe("Maximum number of entries to return (default: 1000)"),
      }),
      execute: async ({ path: dirPath, ignore, maxDepth, maxFiles }) => {
        const resolvedPath = path.isAbsolute(dirPath) ? dirPath : path.resolve(workingDir, dirPath);
        const result = await lsTool.execute({ path: resolvedPath, ignore, maxDepth, maxFiles });
        if (result.success) {
          return `${result.tree}\n\n${result.totalFiles} files, ${result.totalDirs} directories${result.truncated ? " (truncated)" : ""}`;
        }
        return `Error: ${result.error}`;
      },
    }),

    fetch: tool({
      description: fetchTool.description,
      inputSchema: z.object({
        url: z.string().describe("The URL to fetch"),
        format: z.enum(["text", "markdown", "html"]).optional().describe("Output format (default: markdown)"),
        timeout: z.number().optional().describe("Timeout in milliseconds (default: 30000, max: 120000)"),
      }),
      execute: async ({ url, format, timeout }) => {
        const result = await fetchTool.execute({ url, format, timeout });
        if (result.success) {
          return `Content from ${result.url} (${result.contentType || "unknown"}):\n\n${result.content}`;
        }
        return `Error: ${result.error}`;
      },
    }),

    patch: tool({
      description: patchTool.description,
      inputSchema: z.object({
        patch_text: z.string().describe("Unified diff patch text with --- and +++ headers and @@ hunk markers"),
      }),
      execute: async ({ patch_text }) => {
        const result = await patchTool.execute({ patch_text });
        if (result.success) {
          const parts: string[] = ["Patch applied successfully:"];
          if (result.filesCreated.length > 0) parts.push(`  Created: ${result.filesCreated.join(", ")}`);
          if (result.filesModified.length > 0) parts.push(`  Modified: ${result.filesModified.join(", ")}`);
          if (result.filesDeleted.length > 0) parts.push(`  Deleted: ${result.filesDeleted.join(", ")}`);
          return parts.join("\n");
        }
        return `Error: ${result.error}${result.hint ? `\nHint: ${result.hint}` : ""}`;
      },
    }),
  };
}
