#!/usr/bin/env node
/**
 * OpenAI Responses API Executor for WorkerMill
 *
 * A dedicated executor for OpenAI models using the Responses API which has
 * built-in agent capabilities with server-side conversation management.
 *
 * Supported Models:
 *   - gpt-4o, gpt-4o-mini
 *   - gpt-5.1-codex (and other GPT-5 codex variants)
 *
 * Usage:
 *   node openai-executor.js --model gpt-4o --prompt "Fix the bug in main.js"
 *   node openai-executor.js --model gpt-5.1-codex --prompt-file task.txt
 *
 * Environment Variables:
 *   OPENAI_API_KEY        - Required: OpenAI API key
 *   AGENT_WORKING_DIR     - Working directory (default: cwd)
 *   AGENT_MAX_ITERATIONS  - Max iterations (default: 100)
 *   AGENT_VERBOSE         - Enable verbose logging (true/false)
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// ============================================================================
// Configuration
// ============================================================================

const MAX_ITERATIONS = parseInt(process.env.AGENT_MAX_ITERATIONS || "100", 10);
const VERBOSE = process.env.AGENT_VERBOSE === "true";
const WORKING_DIR = process.env.AGENT_WORKING_DIR || process.cwd();

// Output markers (compatible with WorkerMill worker system)
const MARKERS = {
  RESULT: "::result::",
  PR_URL: "::pr_url::",
  ERROR: "::error::",
  INPUT_TOKENS: "::input_tokens::",
  OUTPUT_TOKENS: "::output_tokens::",
};

// ============================================================================
// Test Result Caching
// ============================================================================

const testResultCache = new Map();
let filesModifiedSinceLastTest = false;

function isTestCommand(command) {
  const testPatterns = [
    /\bnpm\s+(run\s+)?test\b/,
    /\bnpx\s+(jest|vitest|mocha)\b/,
    /\byarn\s+(run\s+)?test\b/,
    /\bpnpm\s+(run\s+)?test\b/,
    /\bpython\s+-m\s+pytest\b/,
    /\bpytest\b/,
    /\bcargo\s+test\b/,
    /\bgo\s+test\b/,
    /\bmake\s+test\b/,
  ];
  return testPatterns.some((pattern) => pattern.test(command));
}

function markFilesModified() {
  if (!filesModifiedSinceLastTest) {
    log("[cache] Files modified, test cache invalidated");
  }
  filesModifiedSinceLastTest = true;
}

function getCachedTestResult(command) {
  if (filesModifiedSinceLastTest) return null;
  const cached = testResultCache.get(command);
  if (cached) {
    const ageSeconds = (Date.now() - cached.timestamp) / 1000;
    log(`[cache] Found cached test result (${ageSeconds.toFixed(1)}s old)`);
    return cached.result;
  }
  return null;
}

function cacheTestResult(command, result) {
  testResultCache.set(command, { result, timestamp: Date.now() });
  filesModifiedSinceLastTest = false;
  log(`[cache] Cached test result for: ${command.substring(0, 50)}`);
}

// ============================================================================
// Tool Definitions (OpenAI Responses API Format)
// ============================================================================

const TOOLS = [
  {
    type: "function",
    name: "bash",
    description:
      "Execute a shell command. Use for git operations, running scripts, installing packages, etc. Commands run in the working directory.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 120000, max: 600000)",
        },
      },
      required: ["command"],
    },
  },
  {
    type: "function",
    name: "read_file",
    description:
      "Read the contents of a file. Returns the file content as text. Use this to examine source code, configuration files, etc.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative path to the file to read",
        },
        offset: {
          type: "number",
          description: "Line number to start reading from (1-based)",
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to read",
        },
      },
      required: ["path"],
    },
  },
  {
    type: "function",
    name: "write_file",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Creates parent directories as needed.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative path to the file to write",
        },
        content: {
          type: "string",
          description: "The content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    type: "function",
    name: "edit_file",
    description:
      "Edit an existing file by replacing text. Use old_string to specify the exact text to find and new_string for the replacement. The old_string must match exactly (including whitespace).",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative path to the file to edit",
        },
        old_string: {
          type: "string",
          description: "The exact text to find and replace",
        },
        new_string: {
          type: "string",
          description: "The text to replace it with",
        },
        replace_all: {
          type: "boolean",
          description:
            "If true, replace all occurrences. If false (default), replace only the first.",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    type: "function",
    name: "glob",
    description:
      "Find files matching a glob pattern. Returns a list of matching file paths. Useful for discovering files before reading them.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: 'Glob pattern to match (e.g., "**/*.js", "src/**/*.ts")',
        },
        path: {
          type: "string",
          description:
            "Directory to search in (default: current working directory)",
        },
      },
      required: ["pattern"],
    },
  },
  {
    type: "function",
    name: "grep",
    description:
      "Search for a pattern in files. Returns matching lines with file paths and line numbers. Supports regular expressions.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regular expression pattern to search for",
        },
        path: {
          type: "string",
          description: "File or directory to search in",
        },
        include: {
          type: "string",
          description: 'File pattern to include (e.g., "*.js")',
        },
        ignore_case: {
          type: "boolean",
          description: "Case-insensitive search",
        },
      },
      required: ["pattern"],
    },
  },
];

// ============================================================================
// Tool Implementations
// ============================================================================

function resolvePath(filePath) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(WORKING_DIR, filePath);
}

async function toolBash({ command, timeout = 120000 }) {
  const maxTimeout = 600000;
  const actualTimeout = Math.min(timeout, maxTimeout);

  // Check for cached test results
  if (isTestCommand(command)) {
    const cached = getCachedTestResult(command);
    if (cached) {
      log(`[bash] Returning cached test result`);
      return {
        ...cached,
        output: cached.output + "\n\n[Cached result - no file changes since last run]",
      };
    }
  }

  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let killed = false;

    log(`[bash] Executing: ${command}`);

    const proc = spawn("bash", ["-c", command], {
      cwd: WORKING_DIR,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 5000);
    }, actualTimeout);

    proc.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      if (VERBOSE) process.stdout.write(text);
    });

    proc.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      if (VERBOSE) process.stderr.write(text);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;

      let result = "";
      if (stdout) result += stdout;
      if (stderr) result += (result ? "\n" : "") + stderr;

      if (killed) {
        result += `\n[Command timed out after ${actualTimeout}ms]`;
      }

      log(`[bash] Exit code: ${code}, Duration: ${duration}ms`);

      const commandResult = {
        success: code === 0 && !killed,
        output: result || `Command completed with exit code ${code}`,
        exitCode: code,
      };

      // Cache successful test results
      if (isTestCommand(command) && commandResult.success) {
        cacheTestResult(command, commandResult);
      }

      resolve(commandResult);
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: `Failed to execute command: ${err.message}`,
        exitCode: -1,
      });
    });
  });
}

async function toolReadFile({ path: filePath, offset, limit }) {
  try {
    const fullPath = resolvePath(filePath);
    log(`[read_file] Reading: ${fullPath}`);

    if (!fs.existsSync(fullPath)) {
      return { success: false, output: `File not found: ${fullPath}` };
    }

    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      return {
        success: false,
        output: `Path is a directory, not a file: ${fullPath}`,
      };
    }

    let content = fs.readFileSync(fullPath, "utf8");

    // Apply offset and limit if specified
    if (offset !== undefined || limit !== undefined) {
      const lines = content.split("\n");
      const startLine = (offset || 1) - 1;
      const endLine = limit ? startLine + limit : lines.length;
      content = lines.slice(startLine, endLine).join("\n");
    }

    return { success: true, output: content };
  } catch (err) {
    return { success: false, output: `Error reading file: ${err.message}` };
  }
}

async function toolWriteFile({ path: filePath, content }) {
  try {
    const fullPath = resolvePath(filePath);
    log(`[write_file] Writing: ${fullPath}`);

    // Create parent directories if needed
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, "utf8");
    markFilesModified();

    return {
      success: true,
      output: `Successfully wrote ${content.length} bytes to ${fullPath}`,
    };
  } catch (err) {
    return { success: false, output: `Error writing file: ${err.message}` };
  }
}

async function toolEditFile({
  path: filePath,
  old_string,
  new_string,
  replace_all = false,
}) {
  try {
    const fullPath = resolvePath(filePath);
    log(`[edit_file] Editing: ${fullPath}`);

    if (!fs.existsSync(fullPath)) {
      return { success: false, output: `File not found: ${fullPath}` };
    }

    let content = fs.readFileSync(fullPath, "utf8");

    if (!content.includes(old_string)) {
      return {
        success: false,
        output: `Could not find the specified text in ${fullPath}. Make sure old_string matches exactly.`,
      };
    }

    let newContent;
    let count = 0;

    if (replace_all) {
      const regex = new RegExp(escapeRegExp(old_string), "g");
      count = (content.match(regex) || []).length;
      newContent = content.replace(regex, new_string);
    } else {
      count = 1;
      newContent = content.replace(old_string, new_string);
    }

    fs.writeFileSync(fullPath, newContent, "utf8");
    markFilesModified();

    return {
      success: true,
      output: `Successfully replaced ${count} occurrence(s) in ${fullPath}`,
    };
  } catch (err) {
    return { success: false, output: `Error editing file: ${err.message}` };
  }
}

/**
 * Find files matching a glob pattern
 *
 * Properly handles directory paths in patterns:
 * - "*.md" -> search current dir only
 * - "directives/qa_engineer/*.md" -> search that specific directory only
 * - "src/**\/*.ts" -> recursively search src/ for .ts files
 */
async function toolGlob({ pattern, path: searchPath }) {
  try {
    const baseDir = searchPath ? resolvePath(searchPath) : WORKING_DIR;
    log(`[glob] Searching for: ${pattern} in ${baseDir}`);

    let findCmd;

    if (pattern.includes("**")) {
      // Recursive search pattern like "src/**/*.ts" or "**/*.md"
      const parts = pattern.split("**");
      const pathPrefix = parts[0].replace(/\/$/, "");
      const namePart = parts[1]?.replace(/^\//, "") || "*";
      const name = namePart.includes("/") ? namePart.split("/").pop() : namePart;

      const searchDir = pathPrefix ? `${baseDir}/${pathPrefix}` : baseDir;
      findCmd = `find "${searchDir}" -type f -name "${name}" 2>/dev/null | head -500`;
    } else if (pattern.includes("/")) {
      // Pattern has directory component like "directives/qa_engineer/*.md"
      const lastSlash = pattern.lastIndexOf("/");
      const dirPath = pattern.substring(0, lastSlash);
      const name = pattern.substring(lastSlash + 1);

      const searchDir = `${baseDir}/${dirPath}`;
      findCmd = `find "${searchDir}" -maxdepth 1 -type f -name "${name}" 2>/dev/null | head -500`;
    } else {
      // Just a filename pattern in current directory like "*.md"
      findCmd = `find "${baseDir}" -maxdepth 1 -type f -name "${pattern}" 2>/dev/null | head -500`;
    }

    log(`[glob] Running: ${findCmd}`);
    const result = await toolBash({ command: findCmd, timeout: 30000 });

    if (result.success && result.output.trim()) {
      const files = result.output.trim().split("\n").filter(Boolean);
      log(`[glob] Found ${files.length} files`);
      return {
        success: true,
        output: files.length > 0 ? files.join("\n") : "No matching files found",
      };
    }

    return { success: true, output: "No matching files found" };
  } catch (err) {
    return { success: false, output: `Error in glob: ${err.message}` };
  }
}

async function toolGrep({ pattern, path: searchPath, include, ignore_case }) {
  try {
    const targetPath = searchPath ? resolvePath(searchPath) : WORKING_DIR;
    log(`[grep] Searching for: ${pattern} in ${targetPath}`);

    let grepCmd = "grep -rn";
    if (ignore_case) grepCmd += " -i";
    if (include) grepCmd += ` --include="${include}"`;

    grepCmd += ` "${pattern}" "${targetPath}" 2>/dev/null | head -100`;

    const result = await toolBash({ command: grepCmd, timeout: 30000 });

    if (result.output.trim()) {
      return { success: true, output: result.output };
    }

    return { success: true, output: "No matches found" };
  } catch (err) {
    return { success: false, output: `Error in grep: ${err.message}` };
  }
}

async function executeTool(name, args) {
  switch (name) {
    case "bash":
      return toolBash(args);
    case "read_file":
      return toolReadFile(args);
    case "write_file":
      return toolWriteFile(args);
    case "edit_file":
      return toolEditFile(args);
    case "glob":
      return toolGlob(args);
    case "grep":
      return toolGrep(args);
    default:
      return { success: false, output: `Unknown tool: ${name}` };
  }
}

// ============================================================================
// OpenAI Responses API Client
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Make an HTTPS request with retry logic for rate limits
 */
async function makeRequest(url, options, body) {
  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 2000;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await makeRequestOnce(url, options, body);

    if (response.status !== 429) {
      return response;
    }

    // Rate limit hit - extract retry delay from response if available
    const retryAfter = response.data?.error?.message?.match(
      /try again in (\d+\.?\d*)s/
    );
    let delayMs = BASE_DELAY_MS * Math.pow(2, attempt);

    if (retryAfter) {
      delayMs = Math.max(parseFloat(retryAfter[1]) * 1000 + 500, delayMs);
    }

    if (attempt < MAX_RETRIES) {
      console.error(
        `[Rate Limit] 429 received, waiting ${(delayMs / 1000).toFixed(1)}s before retry ${attempt + 1}/${MAX_RETRIES}...`
      );
      await sleep(delayMs);
    } else {
      console.error(
        `[Rate Limit] Max retries (${MAX_RETRIES}) exceeded, returning 429 response`
      );
      return response;
    }
  }
}

function makeRequestOnce(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || "POST",
      headers: options.headers || {},
    };

    const req = https.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(300000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Call OpenAI Responses API
 *
 * The Responses API manages conversation state server-side.
 * Use previous_response_id to continue conversations.
 */
async function callResponsesApi(model, input, instructions, previousResponseId) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  const url = "https://api.openai.com/v1/responses";

  const body = {
    model,
    input,
    tools: TOOLS,
  };

  if (instructions) {
    body.instructions = instructions;
  }

  if (previousResponseId) {
    body.previous_response_id = previousResponseId;
  }

  log(`[API] Calling Responses API: model=${model}, input_length=${JSON.stringify(input).length}`);

  const response = await makeRequest(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    },
    body
  );

  if (response.status !== 200) {
    throw new Error(
      `OpenAI Responses API error: ${response.status} - ${JSON.stringify(response.data)}`
    );
  }

  return response.data;
}

/**
 * Parse Responses API response to extract content and tool calls
 */
function parseResponse(data) {
  const output = data.output || [];
  const responseId = data.id;
  const usage = data.usage;

  let textContent = "";
  const functionCalls = [];

  for (const item of output) {
    if (item.type === "message" && item.content) {
      // Handle message content array
      if (Array.isArray(item.content)) {
        for (const block of item.content) {
          if (block.type === "output_text" || block.type === "text") {
            textContent += block.text || "";
          }
        }
      } else if (typeof item.content === "string") {
        textContent += item.content;
      }
    } else if (item.type === "text") {
      textContent += item.text || "";
    } else if (item.type === "function_call") {
      functionCalls.push({
        callId: item.call_id || item.id,
        name: item.name,
        arguments: safeParseJSON(item.arguments),
      });
    }
  }

  return {
    responseId,
    textContent,
    functionCalls,
    usage,
    // Agent is done when there are no function calls to execute
    done: functionCalls.length === 0,
  };
}

// ============================================================================
// Main Agent Loop
// ============================================================================

async function runAgent(prompt, model, systemPrompt = null) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`OpenAI Responses API Executor`);
  console.log(`Model: ${model}`);
  console.log(`Working Directory: ${WORKING_DIR}`);
  console.log(`Max Iterations: ${MAX_ITERATIONS}`);
  console.log(`${"=".repeat(60)}\n`);

  // Build instructions (system prompt)
  const instructions = systemPrompt || getDefaultSystemPrompt();

  // Initial input is just the user prompt
  let input = prompt;
  let previousResponseId = null;
  let iteration = 0;
  let finalContent = "";

  // Track token usage
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`\n--- Iteration ${iteration}/${MAX_ITERATIONS} ---\n`);

    try {
      // Call the Responses API
      const rawResponse = await callResponsesApi(
        model,
        input,
        iteration === 1 ? instructions : null, // Only send instructions on first call
        previousResponseId
      );

      // Parse the response
      const response = parseResponse(rawResponse);

      // Track response ID for continuation
      previousResponseId = response.responseId;

      // Accumulate token usage
      if (response.usage) {
        totalInputTokens +=
          response.usage.input_tokens || response.usage.prompt_tokens || 0;
        totalOutputTokens +=
          response.usage.output_tokens || response.usage.completion_tokens || 0;
      }

      // Print assistant's text response
      if (response.textContent) {
        console.log(`\nAssistant: ${response.textContent}\n`);
        finalContent = response.textContent;
      }

      // Check for explicit completion markers
      const contentLower = (response.textContent || "").toLowerCase();
      const hasCompletionMarker =
        contentLower.includes("::result::") ||
        contentLower.includes("task complete") ||
        contentLower.includes("i have completed") ||
        contentLower.includes("i've completed") ||
        contentLower.includes("changes have been made") ||
        contentLower.includes("pr has been created") ||
        contentLower.includes("pull request created") ||
        contentLower.includes("no changes needed") ||
        contentLower.includes("no changes required") ||
        contentLower.includes("nothing to change");

      // Check if done
      if (response.done || hasCompletionMarker) {
        console.log("\n--- Agent Complete ---\n");
        break;
      }

      // Execute function calls and build tool results
      const toolResults = [];

      for (const fc of response.functionCalls) {
        console.log(`\n[Tool] ${fc.name}(${JSON.stringify(fc.arguments)})\n`);

        const result = await executeTool(fc.name, fc.arguments);

        // Truncate very long outputs
        let output = result.output;
        if (output.length > 50000) {
          output =
            output.substring(0, 25000) +
            "\n\n... [output truncated] ...\n\n" +
            output.substring(output.length - 25000);
        }

        console.log(
          `[Result] ${result.success ? "Success" : "Failed"}: ${output.substring(0, 500)}${output.length > 500 ? "..." : ""}\n`
        );

        // Build function_call_output for Responses API
        toolResults.push({
          type: "function_call_output",
          call_id: fc.callId,
          output: output,
        });
      }

      // Set input for next iteration to be the tool results
      input = toolResults;
    } catch (error) {
      console.error(`\n${MARKERS.ERROR}${error.message}`);

      // Try to continue with error context
      input = [
        {
          role: "user",
          content: `An error occurred: ${error.message}. Please try a different approach.`,
        },
      ];

      // If we hit too many errors, bail out
      if (iteration > 3) {
        const errorCount = iteration; // Simplified error tracking
        if (errorCount > 3) {
          console.log("\nToo many errors, stopping agent.");
          break;
        }
      }
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    console.log(`\n${MARKERS.ERROR}Max iterations (${MAX_ITERATIONS}) reached`);
  }

  // Extract and print markers from final content
  extractMarkers(finalContent);

  // Output token usage markers for cost tracking
  if (totalInputTokens > 0 || totalOutputTokens > 0) {
    console.log(`\n${MARKERS.INPUT_TOKENS}${totalInputTokens}`);
    console.log(`${MARKERS.OUTPUT_TOKENS}${totalOutputTokens}`);
  }

  return finalContent;
}

/**
 * Extract WorkerMill markers from content
 */
function extractMarkers(content) {
  if (!content) return;

  // Check for result markers
  const resultMatch = content.match(/::result::(\w+)/);
  if (resultMatch) {
    console.log(`\n${MARKERS.RESULT}${resultMatch[1]}`);
  }

  // Check for PR URL
  const prMatch = content.match(/::pr_url::(https?:\/\/[^\s]+)/);
  if (prMatch) {
    console.log(`\n${MARKERS.PR_URL}${prMatch[1]}`);
  }
}

/**
 * Default system prompt for the agent
 */
function getDefaultSystemPrompt() {
  return `You are an autonomous coding agent. Follow the workflow instructions provided in the task prompt.

TOOLS AVAILABLE:
- read_file: Read file contents
- edit_file: Edit existing files (old_string -> new_string)
- write_file: Create/overwrite files
- bash: Run shell commands (git, npm, node scripts, gh, etc.)
- glob: Find files by pattern
- grep: Search file contents

EXECUTION RULES:
- Execute tool calls one at a time, wait for result before next call
- If a target file path is given in the task, go directly to it
- Follow the Agent Workflow section in the task prompt exactly
- Use execution scripts from /app/execution-compiled/ as documented

CRITICAL - FOLLOW THE TASK PROMPT:
The task prompt contains detailed workflow instructions (AGENTS.md) including:
- Adding Jira comments before/after work
- PR creation with detailed body
- Ticket transitions
- Output markers (::result::, ::pr_url::)

Read and follow those instructions carefully.`;
}

// ============================================================================
// Utility Functions
// ============================================================================

function safeParseJSON(str) {
  try {
    return typeof str === "string" ? JSON.parse(str) : str;
  } catch {
    return str;
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function log(message) {
  if (VERBOSE) {
    console.error(`[DEBUG] ${message}`);
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

function parseArgs(args) {
  const parsed = {
    model: "gpt-4o",
    prompt: null,
    promptFile: null,
    system: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--model":
      case "-m":
        parsed.model = next;
        i++;
        break;
      case "--prompt":
        parsed.prompt = next;
        i++;
        break;
      case "--prompt-file":
        parsed.promptFile = next;
        i++;
        break;
      case "--system":
        parsed.system = next;
        i++;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        // If no flag, treat as prompt
        if (!arg.startsWith("-") && !parsed.prompt) {
          parsed.prompt = arg;
        }
    }
  }

  // If prompt-file is provided, read from file
  if (parsed.promptFile && !parsed.prompt) {
    try {
      parsed.prompt = fs.readFileSync(parsed.promptFile, "utf-8").trim();
    } catch (err) {
      console.error(`Error reading prompt file: ${err.message}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`
OpenAI Responses API Executor - WorkerMill

USAGE:
  node openai-executor.js [OPTIONS] [PROMPT]

OPTIONS:
  --model, -m <name>      Model name (default: gpt-4o)
                          Supported: gpt-4o, gpt-4o-mini, gpt-5.1-codex
  --prompt <text>         Task prompt
  --prompt-file <path>    Read prompt from file
  --system <text>         Custom system prompt (instructions)
  --help, -h              Show this help

ENVIRONMENT VARIABLES:
  OPENAI_API_KEY          Required: OpenAI API key
  AGENT_MAX_ITERATIONS    Max agent loop iterations (default: 100)
  AGENT_VERBOSE           Enable verbose logging (true/false)
  AGENT_WORKING_DIR       Working directory for file operations

EXAMPLES:
  # Basic usage
  node openai-executor.js --model gpt-4o --prompt "Add unit tests for auth.js"

  # With GPT-5.1 Codex
  node openai-executor.js -m gpt-5.1-codex "Refactor the database module"

  # Read prompt from file
  node openai-executor.js --model gpt-4o --prompt-file task.txt

NOTES:
  This executor uses the OpenAI Responses API which:
  - Manages conversation state server-side
  - Has built-in tool execution support
  - Returns structured output with function calls

  For other providers (Ollama, Gemini, etc.), use universal-agent.js instead.
`);
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.prompt) {
    console.error("Error: No prompt provided. Use --prompt or pass as argument.");
    console.error("Use --help for usage information.");
    process.exit(1);
  }

  try {
    await runAgent(args.prompt, args.model, args.system);
    process.exit(0);
  } catch (error) {
    console.error(`\n${MARKERS.ERROR}${error.message}`);
    process.exit(1);
  }
}

// Export for programmatic use
module.exports = {
  runAgent,
  executeTool,
  TOOLS,
  MARKERS,
};

// Run if executed directly
if (require.main === module) {
  main();
}
