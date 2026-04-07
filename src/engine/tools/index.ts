import { tool } from "ai";
import type { LanguageModel } from "ai";
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
import * as gitTool from "./git.js";
import * as patchTool from "./patch.js";
import * as subAgentTool from "./sub-agent.js";
import * as webSearchTool from "./web-search.js";
import * as todoTool from "./todo.js";
import * as verifyTool from "./verify.js";
import * as lspTool from "./lsp.js";
import * as viewImageTool from "./view-image.js";

// Re-export all tool modules
export { bashTool, readFileTool, writeFileTool, editFileTool, globTool, grepTool, lsTool, fetchTool, gitTool, patchTool, subAgentTool, webSearchTool, todoTool, verifyTool, lspTool, viewImageTool };

/**
 * Validate that a resolved path is within the allowed working directory.
 * Returns the path if valid, throws if not.
 */
function assertPathInBounds(resolvedPath: string, workingDir: string, sandboxed: boolean): string {
  if (!sandboxed) return resolvedPath;
  const normalized = path.resolve(resolvedPath);
  const normalizedWorkDir = path.resolve(workingDir);
  if (!normalized.startsWith(normalizedWorkDir + path.sep) && normalized !== normalizedWorkDir) {
    throw new Error(`Path "${resolvedPath}" is outside the working directory. Use --full-disk to allow access outside ${workingDir}`);
  }
  return normalized;
}

/**
 * Creates Vercel AI SDK tool definitions for use with generateText().
 * All file paths are resolved relative to workingDir.
 * When sandboxed=true (default), all paths are restricted to workingDir.
 */
export function createToolDefinitions(workingDir: string, model?: LanguageModel, sandboxed: boolean | "os" = true) {
  const osSandbox = sandboxed === "os";
  const pathSandboxed = sandboxed === true || sandboxed === "os";
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
        assertPathInBounds(resolvedCwd, workingDir, pathSandboxed);
        const result = await bashTool.execute({
          command,
          cwd: resolvedCwd,
          timeout,
          osSandbox,
          sandboxRoot: workingDir,
        });
        if (result.success) {
          return result.stdout || "(no output)";
        }
        // Show stderr first (the actual error), then stdout, then the exit code
        const parts: string[] = [];
        if (result.stderr) parts.push(result.stderr);
        if (result.stdout) parts.push(result.stdout);
        if (result.error) parts.push(result.error);
        return `Error: ${parts.join("\n")}`.trim();
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
        assertPathInBounds(resolvedPath, workingDir, pathSandboxed);
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

    view_image: tool({
      description: viewImageTool.description,
      inputSchema: z.object({
        path: z
          .string()
          .describe("Path to the image to read (absolute or relative to cwd)"),
      }),
      execute: async ({ path: filePath }) => {
        const isAbsolute = path.isAbsolute(filePath);
        const resolvedPath = isAbsolute
          ? filePath
          : path.resolve(workingDir, filePath);

        // Allow explicit absolute image paths (e.g. desktop screenshots),
        // while keeping relative paths constrained to the workspace.
        if (!isAbsolute) {
          assertPathInBounds(resolvedPath, workingDir, pathSandboxed);
        }

        const result = await viewImageTool.execute({
          path: resolvedPath,
        });
        if (result.success) {
          return { content: result.content };
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
        assertPathInBounds(resolvedPath, workingDir, pathSandboxed);
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
        assertPathInBounds(resolvedPath, workingDir, pathSandboxed);
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
        assertPathInBounds(resolvedCwd, workingDir, pathSandboxed);
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
        assertPathInBounds(resolvedPath, workingDir, pathSandboxed);
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
        assertPathInBounds(resolvedPath, workingDir, pathSandboxed);
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

    git: tool({
      description: gitTool.description,
      inputSchema: z.object({
        action: z.enum(["status", "diff", "log", "add", "commit", "branch", "checkout", "stash"])
          .describe("The git action to perform"),
        args: z.string().optional().describe("Additional arguments (e.g., file paths, branch name, commit message)"),
      }),
      execute: async ({ action, args }) => {
        const result = await gitTool.execute({ action, args, cwd: workingDir });
        if (result.success) {
          return result.output || "(no output)";
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

    web_search: tool({
      description: webSearchTool.description,
      inputSchema: z.object({
        query: z.string().describe("Search query — be specific, include library names, error messages, etc."),
        maxResults: z.number().optional().describe("Maximum results to return (default: 8)"),
      }),
      execute: async ({ query, maxResults }) => {
        const result = await webSearchTool.execute({ query, maxResults });
        if (result.success && result.results && result.results.length > 0) {
          return result.results
            .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
            .join("\n\n");
        }
        return result.error || "No results found";
      },
    }),

    todo: tool({
      description: todoTool.description,
      inputSchema: z.object({
        action: z.enum(["add", "update", "list", "clear"]).describe("Action to perform"),
        text: z.string().optional().describe("Todo text (for add/update)"),
        id: z.string().optional().describe("Todo ID (for update)"),
        status: z.enum(["pending", "in_progress", "completed"]).optional().describe("New status (for update)"),
      }),
      execute: async ({ action, text, id, status }) => {
        const result = await todoTool.execute({ action, text, id, status });
        if (result.success) {
          if (result.item) {
            return `[${result.item.status}] ${result.item.id}: ${result.item.text}`;
          }
          if (result.items) {
            if (result.items.length === 0) return "No todos";
            const pending = result.items.filter(t => t.status !== "completed").length;
            const done = result.items.filter(t => t.status === "completed").length;
            return result.items
              .map(t => `[${t.status === "completed" ? "✓" : t.status === "in_progress" ? "→" : " "}] ${t.id}: ${t.text}`)
              .join("\n") + `\n\n${done}/${result.items.length} completed, ${pending} remaining`;
          }
        }
        return result.error || "Unknown error";
      },
    }),

    verify: tool({
      description: verifyTool.description,
      inputSchema: z.object({
        command: z.string().describe("The verification command to run (e.g., 'npm test', 'npx tsc --noEmit', 'pytest')"),
        cwd: z.string().optional().describe("Working directory for the command (optional)"),
        timeout: z.number().optional().describe("Timeout in milliseconds (default: 120000 = 2 minutes)"),
      }),
      execute: async ({ command, cwd, timeout }) => {
        const resolvedCwd = cwd
          ? path.isAbsolute(cwd)
            ? cwd
            : path.resolve(workingDir, cwd)
          : workingDir;
        assertPathInBounds(resolvedCwd, workingDir, pathSandboxed);
        const result = await verifyTool.execute({
          command,
          cwd: resolvedCwd,
          timeout,
        });
        if (!result.success) {
          return `Error: ${result.error || result.summary}`;
        }
        const parts: string[] = [
          `Result: ${result.passed ? "PASSED" : "FAILED"}`,
          `Summary: ${result.summary}`,
        ];
        if (result.raw) {
          parts.push("---", result.raw);
        }
        return parts.join("\n");
      },
    }),

    lsp: tool({
      description: lspTool.description,
      inputSchema: z.object({
        action: z.enum(["diagnostics", "definition", "references", "hover", "symbols"])
          .describe(
            "diagnostics: get errors/warnings for a file. " +
            "definition: go to definition of symbol at position. " +
            "references: find all references to symbol at position. " +
            "hover: get type info for symbol at position. " +
            "symbols: list all symbols in a file."
          ),
        file: z.string().describe("Path to the file (relative or absolute)"),
        line: z.number().optional().describe("1-indexed line number (required for definition, references, hover)"),
        character: z.number().optional().describe("1-indexed column number (required for definition, references, hover)"),
      }),
      execute: async ({ action, file, line, character }) => {
        const resolvedFile = path.isAbsolute(file)
          ? file
          : path.resolve(workingDir, file);
        assertPathInBounds(resolvedFile, workingDir, pathSandboxed);
        const result = await lspTool.execute({ action, file: resolvedFile, line, character }, workingDir);
        if (result.success) {
          return result.content || "No results.";
        }
        return `Error: ${result.error}`;
      },
    }),

    ...(model
      ? {
          sub_agent: tool({
            description: subAgentTool.description,
            inputSchema: z.object({
              prompt: z
                .string()
                .describe("Detailed task description for the sub-agent. Be specific about what to look for."),
              maxTurns: z
                .number()
                .optional()
                .describe("Maximum tool-use turns (default: 20)"),
              isolated: z
                .boolean()
                .optional()
                .describe("Run in an isolated git worktree with full write tools. Changes stay on a separate branch. Default: false."),
            }),
            execute: async ({ prompt, maxTurns, isolated }) => {
              const readOnlyTools = {
                read_file: tool({
                  description: readFileTool.description,
                  inputSchema: z.object({
                    path: z.string().describe("Path to the file to read"),
                    maxLines: z.number().optional().describe("Max lines to read"),
                    startLine: z.number().optional().describe("Start line (1-indexed)"),
                  }),
                  execute: async ({ path: filePath, maxLines, startLine }) => {
                    const resolvedPath = path.isAbsolute(filePath)
                      ? filePath
                      : path.resolve(workingDir, filePath);
                    assertPathInBounds(resolvedPath, workingDir, pathSandboxed);
                    const result = await readFileTool.execute({ path: resolvedPath, maxLines, startLine });
                    return result.success ? result.content || "" : `Error: ${result.error}`;
                  },
                }),
                glob: tool({
                  description: globTool.description,
                  inputSchema: z.object({
                    pattern: z.string().describe("Glob pattern to match files"),
                    cwd: z.string().optional().describe("Directory to search in"),
                  }),
                  execute: async ({ pattern, cwd }) => {
                    const resolvedCwd = cwd
                      ? path.isAbsolute(cwd) ? cwd : path.resolve(workingDir, cwd)
                      : workingDir;
                    assertPathInBounds(resolvedCwd, workingDir, pathSandboxed);
                    const result = await globTool.execute({ pattern, cwd: resolvedCwd });
                    return result.success
                      ? result.count === 0
                        ? `No files found matching: ${pattern}`
                        : `Found ${result.count} file(s):\n${result.matches!.join("\n")}`
                      : `Error: ${result.error}`;
                  },
                }),
                grep: tool({
                  description: grepTool.description,
                  inputSchema: z.object({
                    pattern: z.string().describe("Regex pattern to search for"),
                    path: z.string().optional().describe("File or directory to search in"),
                    filePattern: z.string().optional().describe("Glob to filter files"),
                  }),
                  execute: async ({ pattern, path: searchPath, filePattern }) => {
                    const resolvedPath = searchPath
                      ? path.isAbsolute(searchPath) ? searchPath : path.resolve(workingDir, searchPath)
                      : workingDir;
                    assertPathInBounds(resolvedPath, workingDir, pathSandboxed);
                    const result = await grepTool.execute({ pattern, path: resolvedPath, filePattern });
                    if (!result.success) return `Error: ${result.error}`;
                    if (result.matchCount === 0) return `No matches for: ${pattern}`;
                    const lines: string[] = [`Found ${result.matchCount} match(es):`];
                    for (const [file, matches] of Object.entries(result.results!)) {
                      for (const match of matches) {
                        lines.push(`${file}:${match.line}: ${match.content}`);
                      }
                    }
                    return lines.join("\n");
                  },
                }),
                ls: tool({
                  description: lsTool.description,
                  inputSchema: z.object({
                    path: z.string().describe("Directory path to list"),
                    maxDepth: z.number().optional().describe("Max depth (default: 3)"),
                  }),
                  execute: async ({ path: dirPath, maxDepth }) => {
                    const resolvedPath = path.isAbsolute(dirPath)
                      ? dirPath
                      : path.resolve(workingDir, dirPath);
                    assertPathInBounds(resolvedPath, workingDir, pathSandboxed);
                    const result = await lsTool.execute({ path: resolvedPath, maxDepth });
                    return result.success ? result.tree : `Error: ${result.error}`;
                  },
                }),
              };

              // Factory that creates full tool set for an isolated worktree
              const writeToolsFactory = (worktreePath: string) => {
                const wtTools = createToolDefinitions(worktreePath, model, false); // not sandboxed within worktree
                // Remove sub_agent from isolated tools (no nesting)
                const { sub_agent: _removed, ...safeTools } = wtTools as Record<string, unknown>;
                return safeTools;
              };

              const executor = subAgentTool.createSubAgentExecutor(model!, workingDir, readOnlyTools, writeToolsFactory);
              const result = await executor({ prompt, maxTurns, isolated });
              if (result.success) {
                return `Sub-agent completed (${result.turnsUsed} turns):\n\n${result.content}`;
              }
              return `Error: ${result.error}`;
            },
          }),
        }
      : {}),
  };
}
