***REMOVED***!/usr/bin/env node
/**
 * Universal Agent Loop for WorkerMill
 *
 * A provider-agnostic autonomous coding agent that works like Claude Code.
 * Supports tool calling for file operations, shell commands, and search.
 *
 * Usage:
 *   node universal-agent.js --provider openai --model gpt-4o --prompt "Fix the bug in main.js"
 *   node universal-agent.js --provider ollama --model qwen2.5-coder:32b --prompt "Add tests"
 *
 * Environment Variables:
 *   OPENAI_API_KEY    - For OpenAI provider
 *   OLLAMA_HOST       - For Ollama provider (default: http://localhost:11434)
 *   GEMINI_API_KEY    - For Google Gemini provider
 *   GROQ_API_KEY      - For Groq provider
 *   MISTRAL_API_KEY   - For Mistral provider
 *   AZURE_API_KEY     - For Azure OpenAI provider
 *   AZURE_API_BASE    - Azure OpenAI endpoint URL
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const { URL } = require("url");

// ============================================================================
// Configuration
// ============================================================================

const MAX_ITERATIONS = parseInt(process.env.AGENT_MAX_ITERATIONS || "500", 10);
const VERBOSE = process.env.AGENT_VERBOSE === "true";
const WORKING_DIR = process.env.AGENT_WORKING_DIR || process.cwd();

// Output markers (compatible with WorkerMill worker system)
const MARKERS = {
  RESULT: "::result::",
  PR_URL: "::pr_url::",
  ERROR: "::error::",
  COST: "::cost::",
};

// ============================================================================
// Tool Definitions (OpenAI-compatible format)
// ============================================================================

const TOOLS = [
  {
    type: "function",
    function: {
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
            description:
              "Timeout in milliseconds (default: 120000, max: 600000)",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
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
  },
  {
    type: "function",
    function: {
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
  },
  {
    type: "function",
    function: {
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
  },
  {
    type: "function",
    function: {
      name: "glob",
      description:
        "Find files matching a glob pattern. Returns a list of matching file paths. Useful for discovering files before reading them.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description:
              'Glob pattern to match (e.g., "**/*.js", "src/**/*.ts")',
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
  },
  {
    type: "function",
    function: {
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
  },
];

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Resolve a path relative to the working directory
 */
function resolvePath(filePath) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(WORKING_DIR, filePath);
}

/**
 * Execute a shell command
 */
async function toolBash({ command, timeout = 120000 }) {
  const maxTimeout = 600000;
  const actualTimeout = Math.min(timeout, maxTimeout);

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

      resolve({
        success: code === 0 && !killed,
        output: result || `Command completed with exit code ${code}`,
        exitCode: code,
      });
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

/**
 * Read a file's contents
 */
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

/**
 * Write content to a file
 */
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
    return {
      success: true,
      output: `Successfully wrote ${content.length} bytes to ${fullPath}`,
    };
  } catch (err) {
    return { success: false, output: `Error writing file: ${err.message}` };
  }
}

/**
 * Edit a file by replacing text
 */
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
      // Count occurrences and replace all
      const regex = new RegExp(escapeRegExp(old_string), "g");
      count = (content.match(regex) || []).length;
      newContent = content.replace(regex, new_string);
    } else {
      // Replace only first occurrence
      count = 1;
      newContent = content.replace(old_string, new_string);
    }

    fs.writeFileSync(fullPath, newContent, "utf8");
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
 */
async function toolGlob({ pattern, path: searchPath }) {
  try {
    const baseDir = searchPath ? resolvePath(searchPath) : WORKING_DIR;
    log(`[glob] Searching for: ${pattern} in ${baseDir}`);

    // Use find command for glob matching (more reliable than implementing in JS)
    const findPattern = pattern
      .replace(/\*\*/g, "DOUBLESTAR")
      .replace(/\*/g, "*")
      .replace(/DOUBLESTAR/g, "**");

    // Convert glob to find command
    let findCmd;
    if (pattern.includes("**")) {
      // Recursive search
      const name = pattern.split("/").pop();
      findCmd = `find "${baseDir}" -type f -name "${name}" 2>/dev/null | head -500`;
    } else {
      const name = pattern.replace(/^.*\//, "");
      findCmd = `find "${baseDir}" -type f -name "${name}" 2>/dev/null | head -500`;
    }

    const result = await toolBash({ command: findCmd, timeout: 30000 });

    if (result.success && result.output.trim()) {
      const files = result.output.trim().split("\n").filter(Boolean);
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

/**
 * Search for a pattern in files
 */
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

/**
 * Execute a tool by name
 */
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
// Provider Implementations
// ============================================================================

/**
 * Make an HTTP/HTTPS request
 */
function makeRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";
    const client = isHttps ? https : http;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || "POST",
      headers: options.headers || {},
    };

    const req = client.request(reqOptions, (res) => {
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
 * Provider: OpenAI (and OpenAI-compatible APIs)
 */
async function callOpenAI(model, messages, tools, apiKey, baseUrl) {
  const url = `${baseUrl}/chat/completions`;

  const body = {
    model,
    messages: formatMessagesForOpenAI(messages),
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? "auto" : undefined,
    max_tokens: 4096,
  };

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
      `OpenAI API error: ${response.status} - ${JSON.stringify(response.data)}`
    );
  }

  return parseOpenAIResponse(response.data);
}

/**
 * Provider: Ollama
 */
async function callOllama(model, messages, tools, host) {
  const url = `${host}/api/chat`;

  const body = {
    model,
    messages: formatMessagesForOllama(messages),
    tools: tools.length > 0 ? tools : undefined,
    stream: false,
    options: {
      num_predict: 4096,
      num_ctx: 65536, // 64K context window
    },
  };

  const response = await makeRequest(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    },
    body
  );

  if (response.status !== 200) {
    throw new Error(
      `Ollama API error: ${response.status} - ${JSON.stringify(response.data)}`
    );
  }

  return parseOllamaResponse(response.data);
}

/**
 * Provider: Google Gemini
 */
async function callGemini(model, messages, tools, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: formatMessagesForGemini(messages),
    tools:
      tools.length > 0
        ? [{ functionDeclarations: tools.map((t) => t.function) }]
        : undefined,
    generationConfig: {
      maxOutputTokens: 4096,
    },
  };

  const response = await makeRequest(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    },
    body
  );

  if (response.status !== 200) {
    throw new Error(
      `Gemini API error: ${response.status} - ${JSON.stringify(response.data)}`
    );
  }

  return parseGeminiResponse(response.data);
}

/**
 * Provider: Groq
 */
async function callGroq(model, messages, tools, apiKey) {
  // Groq uses OpenAI-compatible API
  return callOpenAI(model, messages, tools, apiKey, "https://api.groq.com/openai/v1");
}

/**
 * Provider: Mistral
 */
async function callMistral(model, messages, tools, apiKey) {
  const url = "https://api.mistral.ai/v1/chat/completions";

  const body = {
    model,
    messages: formatMessagesForOpenAI(messages),
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? "auto" : undefined,
    max_tokens: 4096,
  };

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
      `Mistral API error: ${response.status} - ${JSON.stringify(response.data)}`
    );
  }

  return parseOpenAIResponse(response.data);
}

/**
 * Provider: Azure OpenAI
 */
async function callAzure(model, messages, tools, apiKey, baseUrl) {
  // Azure uses deployment name, API version in URL
  const url = `${baseUrl}/openai/deployments/${model}/chat/completions?api-version=2024-02-15-preview`;

  const body = {
    messages: formatMessagesForOpenAI(messages),
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? "auto" : undefined,
    max_tokens: 4096,
  };

  const response = await makeRequest(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
    },
    body
  );

  if (response.status !== 200) {
    throw new Error(
      `Azure API error: ${response.status} - ${JSON.stringify(response.data)}`
    );
  }

  return parseOpenAIResponse(response.data);
}

// ============================================================================
// Message Formatting
// ============================================================================

/**
 * Format messages for OpenAI-style API
 */
function formatMessagesForOpenAI(messages) {
  return messages.map((msg) => {
    if (msg.role === "tool") {
      return {
        role: "tool",
        tool_call_id: msg.tool_call_id,
        content:
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content),
      };
    }
    if (msg.role === "assistant" && msg.tool_calls) {
      return {
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.tool_calls,
      };
    }
    return {
      role: msg.role,
      content: msg.content,
    };
  });
}

/**
 * Format messages for Ollama API
 */
function formatMessagesForOllama(messages) {
  return messages.map((msg) => {
    if (msg.role === "tool") {
      return {
        role: "tool",
        content:
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content),
      };
    }
    return {
      role: msg.role,
      content: msg.content,
    };
  });
}

/**
 * Format messages for Gemini API
 */
function formatMessagesForGemini(messages) {
  const contents = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // Gemini handles system prompts differently, prepend to first user message
      continue;
    }

    if (msg.role === "tool") {
      contents.push({
        role: "function",
        parts: [
          {
            functionResponse: {
              name: msg.tool_name || "function",
              response: {
                result:
                  typeof msg.content === "string"
                    ? msg.content
                    : JSON.stringify(msg.content),
              },
            },
          },
        ],
      });
    } else if (msg.role === "assistant" && msg.tool_calls) {
      const parts = [];
      if (msg.content) {
        parts.push({ text: msg.content });
      }
      for (const tc of msg.tool_calls) {
        parts.push({
          functionCall: {
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments),
          },
        });
      }
      contents.push({ role: "model", parts });
    } else {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }
  }

  // Handle system prompt
  const systemMsg = messages.find((m) => m.role === "system");
  if (systemMsg && contents.length > 0 && contents[0].role === "user") {
    const firstUserPart = contents[0].parts[0];
    if (firstUserPart.text) {
      firstUserPart.text = `${systemMsg.content}\n\n${firstUserPart.text}`;
    }
  }

  return contents;
}

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Parse OpenAI-style response
 */
function parseOpenAIResponse(data) {
  const choice = data.choices?.[0];
  if (!choice) {
    return { content: "", toolCalls: [], done: true };
  }

  const message = choice.message;
  const finishReason = choice.finish_reason;

  const toolCalls = (message.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: safeParseJSON(tc.function.arguments),
  }));

  return {
    content: message.content || "",
    toolCalls,
    done: finishReason === "stop" && toolCalls.length === 0,
    usage: data.usage,
  };
}

/**
 * Extract thinking blocks from Qwen model output
 * Qwen models use <think>...</think> tags for chain-of-thought reasoning
 */
function extractThinking(content) {
  if (!content) return { thinking: "", response: content || "" };

  const thinkPattern = /<think>([\s\S]*?)<\/think>/gi;
  let thinking = "";
  let match;

  while ((match = thinkPattern.exec(content)) !== null) {
    thinking += match[1].trim() + "\n";
  }

  // Remove think blocks from response
  const response = content.replace(thinkPattern, "").trim();

  return { thinking: thinking.trim(), response };
}

/**
 * Extract tool calls from content text
 * Some models output tool calls as JSON in their response text instead of using
 * the proper tool_calls API. This function attempts to parse those.
 */
function extractToolCallsFromContent(content) {
  if (!content) return { toolCalls: [], cleanedContent: content };

  const toolCalls = [];
  let cleanedContent = content;

  // Pattern 1: JSON object with "name" and "arguments" fields
  // Matches: { "name": "tool_name", "arguments": {...} }
  const jsonToolPattern = /\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[^{}]*\})\s*\}/g;
  let match;

  while ((match = jsonToolPattern.exec(content)) !== null) {
    try {
      const name = match[1];
      const args = JSON.parse(match[2]);
      toolCalls.push({
        id: `content_call_${toolCalls.length}`,
        name,
        arguments: args,
      });
      // Remove the matched JSON from content
      cleanedContent = cleanedContent.replace(match[0], "").trim();
    } catch (e) {
      // Failed to parse, skip
    }
  }

  // Pattern 2: Function call style - tool_name({"arg": "value"})
  const funcCallPattern = /(\w+)\((\{[^()]*\})\)/g;
  while ((match = funcCallPattern.exec(content)) !== null) {
    try {
      const name = match[1];
      // Only accept known tool names
      const validTools = ["bash", "read_file", "write_file", "edit_file", "glob", "grep"];
      if (validTools.includes(name)) {
        const args = JSON.parse(match[2]);
        toolCalls.push({
          id: `content_call_${toolCalls.length}`,
          name,
          arguments: args,
        });
        cleanedContent = cleanedContent.replace(match[0], "").trim();
      }
    } catch (e) {
      // Failed to parse, skip
    }
  }

  return { toolCalls, cleanedContent };
}

/**
 * Parse Ollama response
 */
function parseOllamaResponse(data) {
  const message = data.message;
  if (!message) {
    return { content: "", thinking: "", toolCalls: [], done: false };
  }

  // First, try to get native tool_calls from the API
  let toolCalls = (message.tool_calls || []).map((tc, idx) => ({
    id: `call_${idx}`,
    name: tc.function.name,
    arguments: tc.function.arguments,
  }));

  // Extract thinking blocks from Qwen models
  const { thinking, response } = extractThinking(message.content);

  // If no native tool calls, try to extract them from response content
  // Some models (like qwen2.5-coder) output tool calls as JSON text
  let finalContent = response;
  if (toolCalls.length === 0 && response) {
    const extracted = extractToolCallsFromContent(response);
    if (extracted.toolCalls.length > 0) {
      console.log(`[Fallback] Extracted ${extracted.toolCalls.length} tool call(s) from content`);
      toolCalls = extracted.toolCalls;
      finalContent = extracted.cleanedContent;
    }
  }

  // Note: Ollama's `data.done` means "streaming complete", NOT "task complete"
  // We never set done=true from the parser - let the agent loop determine completion
  // based on content analysis (completion markers, planning detection, etc.)
  return {
    content: finalContent,
    thinking,
    toolCalls,
    done: false,
  };
}

/**
 * Parse Gemini response
 */
function parseGeminiResponse(data) {
  const candidate = data.candidates?.[0];
  if (!candidate) {
    return { content: "", toolCalls: [], done: true };
  }

  const parts = candidate.content?.parts || [];
  let content = "";
  const toolCalls = [];

  for (const part of parts) {
    if (part.text) {
      content += part.text;
    }
    if (part.functionCall) {
      toolCalls.push({
        id: `call_${toolCalls.length}`,
        name: part.functionCall.name,
        arguments: part.functionCall.args,
      });
    }
  }

  const finishReason = candidate.finishReason;
  return {
    content,
    toolCalls,
    done: finishReason === "STOP" && toolCalls.length === 0,
  };
}

// ============================================================================
// Main Agent Loop
// ============================================================================

/**
 * Call the LLM based on provider
 */
async function callLLM(provider, model, messages, tools) {
  switch (provider) {
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY not set");
      return callOpenAI(model, messages, tools, apiKey, "https://api.openai.com/v1");
    }

    case "ollama": {
      const host = process.env.OLLAMA_HOST || "http://localhost:11434";
      return callOllama(model, messages, tools, host);
    }

    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY not set");
      return callGemini(model, messages, tools, apiKey);
    }

    case "groq": {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) throw new Error("GROQ_API_KEY not set");
      return callGroq(model, messages, tools, apiKey);
    }

    case "mistral": {
      const apiKey = process.env.MISTRAL_API_KEY;
      if (!apiKey) throw new Error("MISTRAL_API_KEY not set");
      return callMistral(model, messages, tools, apiKey);
    }

    case "azure": {
      const apiKey = process.env.AZURE_API_KEY;
      const baseUrl = process.env.AZURE_API_BASE;
      if (!apiKey) throw new Error("AZURE_API_KEY not set");
      if (!baseUrl) throw new Error("AZURE_API_BASE not set");
      return callAzure(model, messages, tools, apiKey, baseUrl);
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Run the autonomous agent loop
 */
async function runAgent(prompt, provider, model, systemPrompt = null) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Universal Agent Starting`);
  console.log(`Provider: ${provider} | Model: ${model}`);
  console.log(`Working Directory: ${WORKING_DIR}`);
  console.log(`Max Iterations: ${MAX_ITERATIONS}`);
  console.log(`${"=".repeat(60)}\n`);

  const messages = [];

  // Add system prompt if provided
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  } else {
    messages.push({
      role: "system",
      content: getDefaultSystemPrompt(),
    });
  }

  // Add user prompt
  messages.push({ role: "user", content: prompt });

  let iteration = 0;
  let finalContent = "";

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`\n--- Iteration ${iteration}/${MAX_ITERATIONS} ---\n`);

    try {
      const response = await callLLM(provider, model, messages, TOOLS);

      // Print thinking (Qwen models use <think> tags)
      if (response.thinking) {
        console.log(`\n💭 Thinking:\n${response.thinking}\n`);
      }

      // Print assistant's response
      if (response.content) {
        console.log(`\nAssistant: ${response.content}\n`);
        finalContent = response.content;
      }

      // Check for explicit completion markers in content
      const contentLower = (response.content || "").toLowerCase();
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

      // Check for completion - only stop if:
      // 1. Explicitly marked done by provider
      // 2. OR has completion marker in content
      // 3. OR no tool calls AND content looks like a summary (not a plan/question)
      const looksLikePlanning =
        contentLower.includes("let me") ||
        contentLower.includes("i'll ") ||
        contentLower.includes("i will") ||
        contentLower.includes("first,") ||
        contentLower.includes("next,") ||
        contentLower.includes("now let") ||
        contentLower.includes("let's ");

      if (response.done || hasCompletionMarker) {
        console.log("\n--- Agent Complete (explicit) ---\n");
        break;
      }

      if (!response.toolCalls?.length && !looksLikePlanning) {
        // No tool calls and doesn't look like planning - probably done
        console.log("\n--- Agent Complete (no more actions) ---\n");
        break;
      }

      if (!response.toolCalls?.length && looksLikePlanning) {
        // Model is planning but didn't call a tool - prompt it to take action
        console.log("\n[System] Model is planning without action - prompting to continue...\n");
        messages.push({
          role: "user",
          content: "Please proceed with your plan. Use the available tools (bash, read_file, write_file, edit_file, glob, grep) to take action. Don't just describe what you'll do - actually do it."
        });
        continue;
      }

      // Add assistant message with tool calls
      messages.push({
        role: "assistant",
        content: response.content || null,
        tool_calls: response.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      });

      // Execute each tool call
      for (const toolCall of response.toolCalls) {
        console.log(`\n[Tool] ${toolCall.name}(${JSON.stringify(toolCall.arguments)})\n`);

        const result = await executeTool(toolCall.name, toolCall.arguments);

        // Truncate very long outputs
        let output = result.output;
        if (output.length > 50000) {
          output =
            output.substring(0, 25000) +
            "\n\n... [output truncated] ...\n\n" +
            output.substring(output.length - 25000);
        }

        console.log(`[Result] ${result.success ? "Success" : "Failed"}: ${output.substring(0, 500)}${output.length > 500 ? "..." : ""}\n`);

        // Add tool result to messages
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          tool_name: toolCall.name,
          content: output,
        });
      }
    } catch (error) {
      console.error(`\n${MARKERS.ERROR}${error.message}`);

      // Try to continue with error context
      messages.push({
        role: "user",
        content: `An error occurred: ${error.message}. Please try a different approach.`,
      });

      // If we hit too many errors, bail out
      if (iteration > 3 && messages.filter((m) => m.content?.includes("An error occurred")).length > 3) {
        console.log("\nToo many errors, stopping agent.");
        break;
      }
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    console.log(`\n${MARKERS.ERROR}Max iterations (${MAX_ITERATIONS}) reached`);
  }

  // Extract and print markers from final content
  extractMarkers(finalContent);

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

  // Check for cost info
  const costMatch = content.match(/::cost::(\d+\.?\d*)/);
  if (costMatch) {
    console.log(`\n${MARKERS.COST}${costMatch[1]}`);
  }
}

/**
 * Default system prompt for the agent
 */
function getDefaultSystemPrompt() {
  return `You are an autonomous coding agent. Complete tasks with MINIMUM steps.

TOOLS:
- read_file: Read file contents
- edit_file: Edit existing files (old_string -> new_string)
- write_file: Create/overwrite files
- bash: Run shell commands (git, npm, gh, etc.)
- glob: Find files by pattern (ONLY if target unknown)
- grep: Search file contents (ONLY if needed)

EFFICIENCY RULES:
- If a target file path is given, go DIRECTLY to it with read_file
- Do NOT glob or grep unless the target file is unknown
- Do NOT search for strings from the ticket title
- Focus on the TASK, not exploring the codebase

WORKFLOW:
1. Read the target file (if path given, use it directly)
2. Make the required edit
3. Commit: git add . && git commit -m "feat(TICKET): description"
4. Push: git push -u origin HEAD
5. Create PR with DETAILED body:
   gh pr create --title "TICKET: summary" --body "***REMOVED******REMOVED*** Summary
   <what was done and why>

   ***REMOVED******REMOVED*** Changes
   - <file1>: <what changed>
   - <file2>: <what changed>

   ***REMOVED******REMOVED*** Testing
   <how to verify>"
6. Output:
   ::result::review_requested
   ::pr_url::<actual URL from gh pr create>

RULES:
- ONE tool call at a time
- Wait for result before next call
- MUST push and create PR
- Use REAL PR URL, not placeholder`;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Safe JSON parse
 */
function safeParseJSON(str) {
  try {
    return typeof str === "string" ? JSON.parse(str) : str;
  } catch {
    return str;
  }
}

/**
 * Escape string for use in regex
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Log helper (respects VERBOSE flag)
 */
function log(message) {
  if (VERBOSE) {
    console.log(`[DEBUG] ${message}`);
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

function parseArgs(args) {
  const parsed = {
    provider: "openai",
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
      case "--provider":
      case "-p":
        parsed.provider = next;
        i++;
        break;
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
Universal Agent - Autonomous Coding Agent for WorkerMill

USAGE:
  node universal-agent.js [OPTIONS] [PROMPT]

OPTIONS:
  --provider, -p <name>   LLM provider (openai, ollama, gemini, groq, mistral, azure)
  --model, -m <name>      Model name (e.g., gpt-4o, qwen2.5-coder:32b)
  --prompt <text>         Task prompt
  --system <text>         Custom system prompt
  --help, -h              Show this help

ENVIRONMENT VARIABLES:
  OPENAI_API_KEY          API key for OpenAI
  OLLAMA_HOST             Ollama server URL (default: http://localhost:11434)
  GEMINI_API_KEY          API key for Google Gemini
  GROQ_API_KEY            API key for Groq
  MISTRAL_API_KEY         API key for Mistral
  AZURE_API_KEY           API key for Azure OpenAI
  AZURE_API_BASE          Azure OpenAI endpoint URL
  AGENT_MAX_ITERATIONS    Max agent loop iterations (default: 500)
  AGENT_VERBOSE           Enable verbose logging (true/false)
  AGENT_WORKING_DIR       Working directory for file operations

EXAMPLES:
  ***REMOVED*** Using OpenAI
  node universal-agent.js --provider openai --model gpt-4o --prompt "Add unit tests for auth.js"

  ***REMOVED*** Using Ollama locally
  node universal-agent.js --provider ollama --model qwen2.5-coder:32b "Fix the bug in main.js"

  ***REMOVED*** Using Groq
  node universal-agent.js -p groq -m llama-3.3-70b-versatile "Refactor the database module"
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
    await runAgent(args.prompt, args.provider, args.model, args.system);
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
