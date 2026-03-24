import type { LanguageModel } from "ai";
import * as bashTool from "./bash.js";
import * as readFileTool from "./read-file.js";
import * as writeFileTool from "./write-file.js";
import * as editFileTool from "./edit-file.js";
import * as globTool from "./glob.js";
import * as grepTool from "./grep.js";
import * as lsTool from "./ls.js";
import * as fetchTool from "./fetch.js";
import * as patchTool from "./patch.js";
import * as subAgentTool from "./sub-agent.js";
import * as gitTool from "./git.js";
import * as webSearchTool from "./web-search.js";
import * as todoTool from "./todo.js";
export { bashTool, readFileTool, writeFileTool, editFileTool, globTool, grepTool, lsTool, fetchTool, patchTool, subAgentTool, gitTool, webSearchTool, todoTool };
/**
 * Creates Vercel AI SDK tool definitions for use with generateText().
 * All file paths are resolved relative to workingDir.
 * When sandboxed=true (default), all paths are restricted to workingDir.
 */
export declare function createToolDefinitions(workingDir: string, model?: LanguageModel, sandboxed?: boolean): {
    sub_agent?: import("ai").Tool<{
        prompt: string;
        maxTurns?: number | undefined;
    }, string> | undefined;
    bash: import("ai").Tool<{
        command: string;
        cwd?: string | undefined;
        timeout?: number | undefined;
    }, string>;
    read_file: import("ai").Tool<{
        path: string;
        encoding?: string | undefined;
        maxLines?: number | undefined;
        startLine?: number | undefined;
    }, string>;
    write_file: import("ai").Tool<{
        path: string;
        content: string;
        encoding?: string | undefined;
        append?: boolean | undefined;
    }, string>;
    edit_file: import("ai").Tool<{
        path: string;
        old_string: string;
        new_string: string;
        replaceAll?: boolean | undefined;
    }, string>;
    glob: import("ai").Tool<{
        pattern: string;
        cwd?: string | undefined;
        maxResults?: number | undefined;
        includeHidden?: boolean | undefined;
    }, string>;
    grep: import("ai").Tool<{
        pattern: string;
        path?: string | undefined;
        maxResults?: number | undefined;
        filePattern?: string | undefined;
        ignoreCase?: boolean | undefined;
        contextLines?: number | undefined;
    }, string>;
    ls: import("ai").Tool<{
        path: string;
        ignore?: string[] | undefined;
        maxDepth?: number | undefined;
        maxFiles?: number | undefined;
    }, string>;
    fetch: import("ai").Tool<{
        url: string;
        timeout?: number | undefined;
        format?: "text" | "markdown" | "html" | undefined;
    }, string>;
    patch: import("ai").Tool<{
        patch_text: string;
    }, string>;
    git: import("ai").Tool<{
        action: "add" | "status" | "diff" | "log" | "commit" | "branch" | "checkout" | "stash";
        args?: string | undefined;
    }, string>;
    web_search: import("ai").Tool<{
        query: string;
        maxResults?: number | undefined;
    }, string>;
    todo: import("ai").Tool<{
        action: "add" | "update" | "list" | "clear";
        text?: string | undefined;
        id?: string | undefined;
        status?: "pending" | "in_progress" | "completed" | undefined;
    }, string>;
};
