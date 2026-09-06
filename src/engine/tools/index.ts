import { tool } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import fs from "fs";
import path from "path";

import * as bashTool from "./bash.js";
import * as bashBackgroundTool from "./bash-background.js";
import * as bashOutputTool from "./bash-output.js";
import * as bashKillTool from "./bash-kill.js";
import * as readFileTool from "./read-file.js";
import * as writeFileTool from "./write-file.js";
import * as editFileTool from "./edit-file.js";
import * as multiEditFileTool from "./multi-edit-file.js";
import * as globTool from "./glob.js";
import * as grepTool from "./grep.js";
import * as lsTool from "./ls.js";
import * as fetchTool from "./fetch.js";
import * as downloadFileTool from "./download-file.js";
import * as gitTool from "./git.js";
import * as patchTool from "./patch.js";
import * as subAgentTool from "./sub-agent.js";
import * as webSearchTool from "./web-search.js";
import * as todoTool from "./todo.js";
import * as verifyTool from "./verify.js";
import * as lspTool from "./lsp.js";
import * as viewImageTool from "./view-image.js";
import * as memoryTool from "./memory.js";
import * as ticketTool from "./ticket.js";
import {
  createPathScope,
  resolvePath,
  type PathAccess,
  type PathGrant,
  type PathScope,
} from "../path-policy.js";
import type { SandboxCapabilities } from "../../config.js";
import type { ToolExecutionContext } from "../tool-executor.js";
import { createScopedCommandRunner } from "./bash.js";

// Re-export all tool modules
export { bashTool, bashBackgroundTool, bashOutputTool, bashKillTool, readFileTool, writeFileTool, editFileTool, multiEditFileTool, globTool, grepTool, lsTool, fetchTool, downloadFileTool, gitTool, patchTool, subAgentTool, webSearchTool, todoTool, verifyTool, lspTool, viewImageTool, memoryTool, ticketTool };
export { createScopedCommandRunner };

export interface ToolDefinitionOptions {
  /** Explicit capabilities for attached/approved paths; never inferred from absoluteness. */
  extraPathGrants?: readonly PathGrant[];
  /** Immutable run identity and cancellation supplied by a caller context. */
  runId?: string;
  signal?: AbortSignal;
  /** Global-user-config capabilities, never derived from a model tool input. */
  sandboxCapabilities?: SandboxCapabilities;
  /** Reuse a caller-authorized canonical scope without re-granting paths. */
  scope?: PathScope;
  /** R10 plumbing only; policy wrapping remains the caller's responsibility. */
  executionContext?: ToolExecutionContext;
  /** Run-owned LSP lifetime. Callers await close() during their run teardown. */
  lspResources?: lspTool.LSPRunResources;
  /** Receives child model usage once, for the future run ledger adapter. */
  onSubAgentUsage?: (usage: subAgentTool.SubAgentUsage) => void | Promise<void>;
}

function rewritePatchPaths(
  patchText: string,
  resolveToolPath: (inputPath: string, access: PathAccess) => string,
): string {
  const headers = patchTool.parsePatchHeaders(patchText);
  const lines = patchText.split("\n");
  const rewrite = (lineIndex: number, headerPath: string, prefix: "a/" | "b/"): void => {
    if (headerPath === "/dev/null") return;
    const rawPath = headerPath.replace(new RegExp(`^${prefix}`), "");
    const resolved = resolveToolPath(rawPath, "read_write");
    const marker = lines[lineIndex].slice(0, 4);
    const suffix = lines[lineIndex].slice(4 + headerPath.length);
    lines[lineIndex] = `${marker}${resolved}${suffix}`;
  };
  for (const header of headers) {
    rewrite(header.oldLine, header.oldPath, "a/");
    rewrite(header.newLine, header.newPath, "b/");
  }
  return lines.join("\n");
}

/** Recursively list all files in a directory. */
function listMemoryFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) results.push(...listMemoryFiles(full));
      else results.push(full);
    }
  } catch { /* best effort */ }
  return results;
}

/**
 * Creates Vercel AI SDK tool definitions for use with generateText().
 * All file paths are resolved relative to workingDir.
 * When sandboxed=true (default), all paths are restricted to workingDir.
 */
export function createToolDefinitions(
  workingDir: string,
  model?: LanguageModel,
  sandboxed: boolean | "os" = true,
  options: ToolDefinitionOptions = {},
) {
  const effectiveSandbox = options.executionContext?.effectiveSandbox;
  const requestedSandbox = effectiveSandbox === "os" ? "os" : effectiveSandbox === "path" ? true : effectiveSandbox === "none" ? false : sandboxed;
  const osSandbox = requestedSandbox === "os";
  const pathSandboxed = requestedSandbox === true || requestedSandbox === "os";
  // Snapshot once: raw capability grants become canonical only here. A reused
  // scope is already an authorization decision and must not be widened again.
  const capabilitySource: SandboxCapabilities | undefined = options.sandboxCapabilities ?? (options.executionContext && {
    allowedNetworkDomains: options.executionContext.allowedNetworkDomains,
    allowLocalBinding: options.executionContext.allowLocalBinding,
    allowDockerSocket: options.executionContext.allowDockerSocket,
  });
  const sandboxCapabilities = capabilitySource && {
    extraPathGrants: capabilitySource.extraPathGrants && [...capabilitySource.extraPathGrants],
    allowedNetworkDomains: capabilitySource.allowedNetworkDomains && [...capabilitySource.allowedNetworkDomains],
    allowLocalBinding: capabilitySource.allowLocalBinding,
    allowDockerSocket: capabilitySource.allowDockerSocket,
  };
  const pathScope: PathScope = options.scope ?? options.executionContext?.scope ?? createPathScope(workingDir, [
    ...(sandboxCapabilities?.extraPathGrants ?? []),
    ...(options.extraPathGrants ?? []),
  ]);
  const runId = options.runId ?? options.executionContext?.runId;
  const signal = options.signal ?? options.executionContext?.signal;
  // Bind the LSP adapter to the context used to create these definitions.
  // In particular, child factories receive their child run ID and signal,
  // rather than a parent closure's lifetime.
  const providedLspResources = options.lspResources;
  const suppliedLspResources = providedLspResources && providedLspResources.runId === runId && providedLspResources.workspace === pathScope.workspace
    ? providedLspResources
    : undefined;
  let createdLspResources: lspTool.LSPRunResources | undefined;
  const getLspResources = (): lspTool.LSPRunResources | undefined => {
    if (suppliedLspResources) return suppliedLspResources;
    if (!runId || !signal) return undefined;
    createdLspResources ??= lspTool.createLSPRunResources({
      runId,
      workspace: pathScope.workspace,
      signal,
    });
    return createdLspResources;
  };
  const commandRunner = createScopedCommandRunner({ sandbox: requestedSandbox === "os" ? "os" : false, scope: pathScope, capabilities: sandboxCapabilities });
  const resolveToolPath = (inputPath: string, access: PathAccess = "read"): string =>
    resolvePath(pathScope, inputPath, access, { enforceScope: pathSandboxed });
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
        const canonicalCwd = resolveToolPath(resolvedCwd, "read_write");
        const result = await bashTool.execute({
          command,
          cwd: canonicalCwd,
          timeout,
          osSandbox,
          scope: pathScope,
          sandboxCapabilities,
          runId,
          signal,
          runProcess: commandRunner,
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

    bash_background: tool({
      description: bashBackgroundTool.description,
      inputSchema: z.object({
        command: z.string().describe("The bash command to execute in the background"),
        cwd: z
          .string()
          .optional()
          .describe("Working directory for the command (optional)"),
        env: z
          .record(z.string(), z.string())
          .optional()
          .describe("Environment variables to set (optional)"),
      }),
      execute: async ({ command, cwd, env }) => {
        // The background shell does not currently support OS runtime sandboxing.
        if (osSandbox) {
          return "Error: bash_background is not available with OS sandbox enabled. Use foreground `bash` or disable OS sandbox.";
        }
        const resolvedCwd = cwd
          ? path.isAbsolute(cwd)
            ? cwd
            : path.resolve(workingDir, cwd)
          : workingDir;
        const canonicalCwd = resolveToolPath(resolvedCwd, "read_write");
        const result = await bashBackgroundTool.execute({
          command,
          cwd: canonicalCwd,
          env: env as Record<string, string> | undefined,
          workspaceRoot: pathScope.workspace,
          enforceWorkspacePaths: pathSandboxed,
          runId,
          signal,
          runProcess: commandRunner,
        });
        return `Shell started: ${result.shellId}, PID: ${result.pid}`;
      },
    }),

    bash_output: tool({
      description: bashOutputTool.description,
      inputSchema: z.object({
        shellId: z.string().describe("The shell ID returned by bash_background"),
        wait: z
          .boolean()
          .optional()
          .describe("Whether to wait for the process to exit (optional)"),
      }),
      execute: async ({ shellId, wait }) => {
        const result = await bashOutputTool.execute({
          shellId,
          wait,
          runId,
          signal,
        });
        if (result.done) {
          return `Process ${result.status} (exit code: ${result.exitCode})\n${result.output}`;
        }
        return `Process ${result.status}\n${result.output}`;
      },
    }),

    bash_kill: tool({
      description: bashKillTool.description,
      inputSchema: z.object({
        shellId: z.string().describe("The shell ID returned by bash_background"),
        signal: z
          .enum(["SIGTERM", "SIGKILL"])
          .optional()
          .describe("Signal to send (default: SIGTERM)"),
      }),
      execute: async ({ shellId, signal }) => {
        const result = await bashKillTool.execute({
          shellId,
          signal,
          runId,
        });
        return result.killed ? "Process terminated" : "Process not found or already terminated";
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
        const canonicalPath = resolveToolPath(resolvedPath, "read");
        const result = await readFileTool.execute({
          path: canonicalPath,
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
        // Absolute paths require an explicit read grant; there is no implicit
        // screenshot/desktop exception.
        const canonicalPath = resolveToolPath(filePath, "read");

        const result = await viewImageTool.execute({
          path: canonicalPath,
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
        const canonicalPath = resolveToolPath(resolvedPath, "read_write");
        const result = await writeFileTool.execute({
          path: canonicalPath,
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
        const canonicalPath = resolveToolPath(resolvedPath, "read_write");
        const result = await editFileTool.execute({
          path: canonicalPath,
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

    multi_edit_file: tool({
      description: multiEditFileTool.description,
      inputSchema: z.object({
        file_path: z
          .string()
          .describe("Path to the file to edit (absolute or relative to cwd)"),
        edits: z
          .array(
            z.object({
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
              replace_all: z
                .boolean()
                .optional()
                .describe(
                  "Replace all occurrences instead of requiring unique match (default: false)"
                ),
            })
          )
          .describe("Array of edits to apply in order"),
      }),
      execute: async ({ file_path: filePath, edits }) => {
        const resolvedPath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(workingDir, filePath);
        const canonicalPath = resolveToolPath(resolvedPath, "read_write");
        const result = await multiEditFileTool.execute({
          file_path: canonicalPath,
          edits,
        });
        if (result.success) {
          return `File edited: ${result.file_path} (${result.results?.length} edits applied, ${result.linesDiff} lines)`;
        }
        const details = result.results
          ?.map((r) => `  [${r.index}] ${r.status}${r.detail ? `: ${r.detail}` : ""}`)
          .join("\n");
        return `Error: ${result.error}${details ? `\n${details}` : ""}`;
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
        const canonicalCwd = resolveToolPath(resolvedCwd, "read");
        const result = await globTool.execute({
          pattern,
          cwd: canonicalCwd,
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
        const canonicalPath = resolveToolPath(resolvedPath, "read");
        const result = await grepTool.execute({
          pattern,
          path: canonicalPath,
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
        const canonicalPath = resolveToolPath(resolvedPath, "read");
        const result = await lsTool.execute({ path: canonicalPath, ignore, maxDepth, maxFiles });
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

    download_file: tool({
      description: downloadFileTool.description,
      inputSchema: z.object({
        url: z.string().describe("The URL to download from"),
        destination: z.string().describe("Path to save the file (absolute or relative to cwd)"),
        overwrite: z.boolean().optional().describe("Whether to overwrite existing files (default: false)"),
      }),
      execute: async ({ url, destination, overwrite }) => {
        const resolvedPath = path.isAbsolute(destination)
          ? destination
          : path.resolve(workingDir, destination);
        const canonicalPath = resolveToolPath(resolvedPath, "read_write");
        return downloadFileTool.execute({ url, destination: canonicalPath, overwrite });
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
        const result = await gitTool.execute({ action, args, cwd: pathScope.workspace, runId, signal, runProcess: commandRunner });
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
        // Unified diffs may contain several targets; canonicalize and
        // authorize every header before the patch implementation can mutate.
        const result = await patchTool.execute({
          patch_text: rewritePatchPaths(patch_text, resolveToolPath),
        });
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
        const canonicalCwd = resolveToolPath(resolvedCwd, "read_write");
        let result: Awaited<ReturnType<typeof verifyTool.execute>>;
        try {
          result = await verifyTool.execute({
            command,
            cwd: canonicalCwd,
            timeout,
            runId,
            signal,
            runProcess: commandRunner,
          });
        } catch (error) {
          return `Error: Failed to execute command: ${error instanceof Error ? error.message : String(error)}`;
        }
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
        action: z.enum(["diagnostics", "definition", "references", "hover", "symbols", "symbol_references"])
          .describe(
            "diagnostics: get errors/warnings for a file. " +
            "definition: go to definition of symbol at position. " +
            "references: find all references to symbol at position. " +
            "hover: get type info for symbol at position. " +
            "symbols: list all symbols in a file. " +
            "symbol_references: find all references to a symbol by name."
          ),
        file: z.string().optional().describe("Path to the file (relative or absolute)"),
        line: z.number().optional().describe("1-indexed line number (required for definition, references, hover)"),
        character: z.number().optional().describe("1-indexed column number (required for definition, references, hover)"),
        path: z.string().optional().describe("Path to file or directory (relative or absolute) - used for directory diagnostics aggregation"),
        severity: z.enum(["error", "warning", "hint", "all"]).optional().describe("Severity level to include in diagnostics (default: error)"),
        format: z.enum(["json", "text"]).optional().describe("Output format (default: json for programmatic reliability)"),
        symbol: z.string().optional().describe("Symbol name (required for symbol_references)"),
        include_declaration: z.boolean().optional().describe("Include declaration in references (default: false for symbol_references)"),
      }),
      execute: async ({ action, file, line, character, path: targetPath, severity, format, symbol, include_declaration }) => {
        let resolvedFile = file ? (path.isAbsolute(file) ? file : path.resolve(workingDir, file)) : undefined;
        if (file) {
          resolvedFile = resolveToolPath(resolvedFile!, "read");
        }
        const resolvedTargetPath = targetPath ? resolveToolPath(targetPath, "read") : undefined;
        const input = { action, file: resolvedFile, line, character, path: resolvedTargetPath, severity, format, symbol, include_declaration };
        const lspResources = getLspResources();
        const result = lspResources
          ? await lspResources.execute(input)
          : await lspTool.execute(input, pathScope.workspace);
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
              /* Legacy ad-hoc child tools retained below only temporarily while
               * this block is replaced by the scoped registered-tool factory.
               * It is intentionally disabled; in particular download_file was
               * a write capability on a supposedly read-only child. */
              const childToolNames = ["bash", "verify", "read_file", "view_image", "write_file", "edit_file", "multi_edit_file", "glob", "grep", "ls", "git", "patch", "lsp"] as const;
              const readOnlyChildToolNames = ["read_file", "view_image", "glob", "grep", "ls", "lsp"] as const;
              const pickChildTools = (all: Record<string, unknown>, names: readonly string[]) => Object.fromEntries(
                names.flatMap((toolName) => all[toolName] ? [[toolName, all[toolName]]] : []),
              ) as Record<string, subAgentTool.ChildTool>;
              const childCapabilities: SandboxCapabilities | undefined = options.executionContext && {
                allowedNetworkDomains: options.executionContext.allowedNetworkDomains && [...options.executionContext.allowedNetworkDomains],
                allowLocalBinding: options.executionContext.allowLocalBinding,
                allowDockerSocket: false,
              };
              const childTools = (childWorkingDir: string, childScope: PathScope, childContext: ToolExecutionContext) => {
                const childExecutionContext = {
                  ...childContext, scope: childScope, workspace: childScope.workspace,
                  effectiveSandbox: childContext.effectiveSandbox === "os" ? "os" as const : "path" as const,
                };
                const all = createToolDefinitions(childWorkingDir, undefined, childExecutionContext?.effectiveSandbox === "os" ? "os" : true, {
                  runId: childExecutionContext.runId,
                  signal: childExecutionContext.signal,
                  scope: childScope,
                  sandboxCapabilities: childCapabilities,
                  executionContext: childExecutionContext,
                }) as Record<string, unknown>;
                return pickChildTools(all, childToolNames);
              };
              const readOnlyContext: ToolExecutionContext = options.executionContext
                ? { ...options.executionContext, scope: pathScope, workspace: pathScope.workspace }
                : { runId: runId ?? "sub-agent-read-only", workspace: pathScope.workspace, scope: pathScope, effectiveSandbox: "path", signal: signal ?? new AbortController().signal, getPermissionState: () => ({ mode: "default", trustAll: false, sessionAllow: new Set(), rules: {}, readOnlyRole: true, workspace: pathScope.workspace }) };
              const readOnlyTools = pickChildTools(childTools(pathScope.workspace, pathScope, readOnlyContext), readOnlyChildToolNames);
              const executor = subAgentTool.createSubAgentExecutor(model!, pathScope.workspace, readOnlyTools, {
                executionContext: options.executionContext,
                onUsage: options.onSubAgentUsage,
                createTools: childTools,
              });
              const result = await executor({ prompt, maxTurns, isolated });
              if (result.success) {
                return `Sub-agent completed (${result.turnsUsed} turns):\n\n${result.content}`;
              }
              return `Error: ${result.error}`;
            },
          }),
        }
      : {}),

    // ── Memory tool — persistent cross-session agent memory ──
    memory: tool({
      description:
        "Read, create, update, search, or delete persistent memory files. " +
        "Use this to store project patterns, corrections, preferences, and learnings " +
        "that should persist across sessions. Memory is stored per-project.",
      inputSchema: z.object({
        command: z.enum(["view", "create", "update", "search", "delete"]).describe(
          "The memory operation: view (read file/directory), create (new file), " +
          "update (edit existing file), search (find by keyword), delete (remove file)"
        ),
        path: z.string().optional().describe(
          "Memory file path (e.g. 'patterns.md', 'corrections.md'). " +
          "Omit for view to list all memory files."
        ),
        content: z.string().optional().describe(
          "File content for create, or new content for update"
        ),
        query: z.string().optional().describe(
          "Search query for the search command"
        ),
      }),
      execute: async ({ command, path: filePath, content, query }) => {
        memoryTool.ensureMemoriesDir();
        switch (command) {
          case "view":
            return memoryTool.executeMemoryCommand({
              command: "view",
              path: filePath ? `/memories/${filePath}` : "/memories",
            });
          case "create":
            if (!filePath || !content) return "Error: create requires path and content";
            return memoryTool.executeMemoryCommand({
              command: "create",
              path: `/memories/${filePath}`,
              file_text: content,
            });
          case "update":
            if (!filePath || !content) return "Error: update requires path and content";
            // Overwrite the file with new content
            const viewPath = `/memories/${filePath}`;
            return memoryTool.executeMemoryCommand({
              command: "create",
              path: viewPath,
              file_text: content,
            }).catch(() =>
              // File exists — delete and recreate
              memoryTool.executeMemoryCommand({ command: "delete", path: viewPath }).then(() =>
                memoryTool.executeMemoryCommand({ command: "create", path: viewPath, file_text: content })
              )
            );
          case "search": {
            if (!query) return "Error: search requires a query";
            const dir = memoryTool.getMemoriesDir();
            const results: string[] = [];
            try {
              const files = listMemoryFiles(dir);
              const q = query.toLowerCase();
              for (const file of files) {
                const fileContent = fs.readFileSync(file, "utf-8");
                const lines = fileContent.split("\n");
                const matches = lines
                  .map((line, i) => ({ line, num: i + 1 }))
                  .filter(({ line }) => line.toLowerCase().includes(q));
                if (matches.length > 0) {
                  const rel = path.relative(dir, file);
                  results.push(`${rel}:`);
                  for (const m of matches.slice(0, 5)) {
                    results.push(`  ${m.num}: ${m.line}`);
                  }
                  if (matches.length > 5) results.push(`  ... and ${matches.length - 5} more matches`);
                }
              }
            } catch { /* best effort */ }
            return results.length > 0
              ? `Found matches:\n${results.join("\n")}`
              : `No matches found for "${query}"`;
          }
          case "delete":
            if (!filePath) return "Error: delete requires a path";
            return memoryTool.executeMemoryCommand({
              command: "delete",
              path: `/memories/${filePath}`,
            });
          default:
            return `Error: Unknown command "${command}"`;
        }
      },
    }),

    // ── Ticket tool — structured access to issue trackers ──
    ticket: tool({
      description: ticketTool.description,
      inputSchema: z.object({
        action: z.enum(["fetch", "comment", "transition", "list"]).describe(
          "The operation: fetch (read ticket), comment (post update), transition (change status), list (search issues)"
        ),
        ticketKey: z.string().optional().describe(
          "Ticket reference (e.g. '#42', 'GH-42', 'PROJ-123', 'TEAM-42')"
        ),
        comment: z.string().optional().describe("Comment text for the comment action"),
        status: z.string().optional().describe("Target status for transition (e.g. 'done', 'in_progress')"),
        query: z.string().optional().describe("Search query for the list action"),
      }),
      execute: async (input) => {
        const result = await ticketTool.execute(input);
        if (result.success) return result.content || "Done";
        return `Error: ${result.error}`;
      },
    }),
  };
}
