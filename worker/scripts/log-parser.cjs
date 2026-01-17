#!/usr/bin/env node
/**
 * =============================================================================
 * CRITICAL: AI Worker Log Parser - DO NOT MODIFY WITHOUT EXPLICIT APPROVAL
 * =============================================================================
 *
 * This script is essential for live log streaming to the WorkerMill dashboard.
 * It took a week to get working correctly. Any changes risk breaking the entire
 * log streaming system.
 *
 * How it works:
 * 1. Receives Claude CLI's stream-json output via stdin
 * 2. Extracts readable content from JSON events (text, tool use, etc.)
 * 3. Buffers and POSTs logs to /api/control-center/logs for SSE streaming
 * 4. Tracks token usage and reports to /api/tasks/:id/usage
 *
 * Pipeline: claude --output-format stream-json | tee output.jsonl | node log-parser.cjs
 *
 * If logs stop appearing in dashboard, check:
 * - This script is being invoked (not "cat" passthrough)
 * - ORG_API_KEY is set for authentication
 * - API endpoint /api/control-center/logs is accessible
 * - TASK_ID and ORG_ID are set
 *
 * Reference: oncallshift backend/ai-worker/scripts/log-parser.cjs
 * =============================================================================
 *
 * Usage:
 *   claude ... | node /app/scripts/log-parser.cjs
 *
 * Environment variables:
 *   - TASK_ID: Required. The AI worker task ID
 *   - ORG_ID: Required. The organization ID
 *   - API_BASE_URL: Required. WorkerMill API base URL
 *   - ORG_API_KEY: Required. Organization API key for authentication
 */

const https = require("https");
const http = require("http");
const readline = require("readline");

// Configuration
const TASK_ID = process.env.TASK_ID;
const ORG_ID = process.env.ORG_ID;
const API_BASE_URL = process.env.API_BASE_URL || "https://workermill.com";
const ORG_API_KEY = process.env.ORG_API_KEY;

// Validate required env vars
if (!TASK_ID || !ORG_ID) {
  console.error("[log-parser] Missing required env vars: TASK_ID, ORG_ID");
}
if (!ORG_API_KEY) {
  console.error("[log-parser] Missing auth: need ORG_API_KEY");
}

// Token usage tracking (accumulated across all messages)
// Use Math.max() because Claude reports cumulative tokens
const tokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};
let modelUsed = process.env.CLAUDE_MODEL || "sonnet";

// Log batching for API posts
let logBuffer = [];
let logFlushTimer = null;
const LOG_FLUSH_INTERVAL = 500; // ms

// Track if we've logged the initial state
let hasLoggedInitialState = false;

/**
 * Post log message to API for live dashboard viewing
 */
function postLogToApi(type, message, severity = "info") {
  // Log initial state once for debugging
  if (!hasLoggedInitialState) {
    hasLoggedInitialState = true;
    console.error(`[log-parser] Config: TASK_ID=${TASK_ID ? 'set' : 'missing'}, ORG_API_KEY=${ORG_API_KEY ? 'set' : 'missing'}, API_BASE_URL=${API_BASE_URL}`);
  }

  if (!TASK_ID || !ORG_API_KEY || !message) {
    return;
  }

  const url = `${API_BASE_URL}/api/control-center/logs`;
  const body = JSON.stringify({
    taskId: TASK_ID,
    type,
    message: message.substring(0, 10000), // Limit message size
    severity,
  });

  const urlObj = new URL(url);
  const protocol = urlObj.protocol === "https:" ? https : http;

  const req = protocol.request(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ORG_API_KEY,
        "Content-Length": Buffer.byteLength(body),
      },
    },
    (res) => {
      // Log first successful/failed post for debugging
      if (res.statusCode !== 200 && res.statusCode !== 201) {
        console.error(`[log-parser] Log post failed: ${res.statusCode}`);
      }
    }
  );

  req.on("error", (err) => {
    console.error(`[log-parser] Log post error: ${err.message}`);
  });
  req.write(body);
  req.end();
}

/**
 * Flush buffered logs to API
 */
function flushLogs() {
  if (logBuffer.length === 0) return;

  const message = logBuffer.join("\n");
  logBuffer = [];
  postLogToApi("claude_output", message, "info");
}

/**
 * Schedule log flush
 */
function scheduleLogFlush() {
  if (logFlushTimer) return;
  logFlushTimer = setTimeout(() => {
    logFlushTimer = null;
    flushLogs();
  }, LOG_FLUSH_INTERVAL);
}

/**
 * Add readable content to log buffer
 */
function bufferLog(content) {
  if (!content || content.trim() === "") return;

  // Echo readable content to stderr for CloudWatch visibility
  // (stdout is reserved for JSON passthrough to tee)
  console.error(content);

  logBuffer.push(content);
  scheduleLogFlush();
}

/**
 * Extract readable content from a Claude CLI stream-json event
 *
 * Claude CLI --output-format stream-json outputs events like:
 * - {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
 * - {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash",...}]}}
 * - {"type":"user","message":{"content":[{"type":"tool_result","content":"..."}]}}
 * - {"type":"result","subtype":"success","result":"..."}
 */
function extractReadableContent(data) {
  const results = [];

  // Handle "assistant" type events - extract text and tool use
  if (data.type === "assistant" && data.message?.content) {
    for (const block of data.message.content) {
      if (block.type === "text" && block.text) {
        results.push(block.text);
      }
      if (block.type === "tool_use" && block.name) {
        // Show tool name with brief input summary
        let toolInfo = `\n[Tool: ${block.name}]`;
        if (block.input?.command) {
          // For Bash commands, show the command
          const cmd = block.input.command.substring(0, 100);
          toolInfo += ` ${cmd}${block.input.command.length > 100 ? '...' : ''}`;
        } else if (block.input?.file_path) {
          // For file operations, show the path
          toolInfo += ` ${block.input.file_path}`;
        }
        results.push(toolInfo);
      }
    }
  }

  // Handle "user" type events (tool results) - just note completion
  if (data.type === "user" && data.message?.content) {
    for (const block of data.message.content) {
      if (block.type === "tool_result") {
        if (block.is_error) {
          results.push(`[Tool Error]`);
        }
        // Don't show full tool results - they can be very long
      }
    }
  }

  // Handle final "result" event
  if (data.type === "result") {
    if (data.result) {
      // Truncate long results
      const resultText = data.result.length > 500
        ? data.result.substring(0, 500) + '...'
        : data.result;
      results.push(`\n[Task Complete]\n${resultText}`);
    }
  }

  // Legacy format support (API streaming format)
  if (data.type === "content_block_delta" && data.delta?.text) {
    results.push(data.delta.text);
  }
  if (data.type === "content_block_start" && data.content_block?.text) {
    results.push(data.content_block.text);
  }
  if (data.type === "message_start") {
    results.push(`[Claude thinking...]`);
  }

  return results.length > 0 ? results.join("") : null;
}

/**
 * Extract and accumulate token usage from a JSON object
 */
function extractUsage(data) {
  const usagePaths = [
    data.usage,
    data.message?.usage,
    data.result?.usage,
    data.delta?.usage,
    data.content_block?.usage,
  ];

  for (const usage of usagePaths) {
    if (usage && typeof usage === "object") {
      if (typeof usage.input_tokens === "number") {
        tokenUsage.inputTokens = Math.max(tokenUsage.inputTokens, usage.input_tokens);
      }
      if (typeof usage.output_tokens === "number") {
        tokenUsage.outputTokens = Math.max(tokenUsage.outputTokens, usage.output_tokens);
      }
      if (typeof usage.cache_creation_input_tokens === "number") {
        tokenUsage.cacheCreationInputTokens = Math.max(
          tokenUsage.cacheCreationInputTokens,
          usage.cache_creation_input_tokens
        );
      }
      if (typeof usage.cache_read_input_tokens === "number") {
        tokenUsage.cacheReadInputTokens = Math.max(
          tokenUsage.cacheReadInputTokens,
          usage.cache_read_input_tokens
        );
      }
      return true;
    }
  }
  return false;
}

/**
 * Process a line of output from Claude CLI
 */
function processLine(line) {
  // Try to parse as JSON
  try {
    const data = JSON.parse(line);

    // Pass through JSON to stdout (for tee to capture full output)
    // Only JSON lines go to stdout - plain text goes only to stderr to avoid duplicates
    console.log(line);

    // Extract token usage
    extractUsage(data);

    // Track model if specified
    if (data.model) {
      modelUsed = data.model;
    }

    // Extract readable content and buffer for API
    const readable = extractReadableContent(data);
    if (readable) {
      bufferLog(readable);
    }
  } catch {
    // Not JSON - plain text output from universal-agent or other sources
    // Only send to stderr (via bufferLog) to avoid duplicate CloudWatch logs
    // DO NOT console.log() here - that would duplicate with bufferLog's console.error()
    if (line.trim()) {
      bufferLog(line);
    }
  }
}

/**
 * Send token usage to the API
 */
async function sendTokenUsage() {
  // Output structured markers for orchestrator backup parsing
  console.log(`::input_tokens::${tokenUsage.inputTokens}`);
  console.log(`::output_tokens::${tokenUsage.outputTokens}`);
  console.log(`::cache_creation_tokens::${tokenUsage.cacheCreationInputTokens}`);
  console.log(`::cache_read_tokens::${tokenUsage.cacheReadInputTokens}`);
  console.log(`::model::${modelUsed}`);

  console.error(`[log-parser] Token usage: input=${tokenUsage.inputTokens}, output=${tokenUsage.outputTokens}, cache_create=${tokenUsage.cacheCreationInputTokens}, cache_read=${tokenUsage.cacheReadInputTokens}`);
  console.error(`[log-parser] Model: ${modelUsed}`);

  if (!TASK_ID || !ORG_API_KEY) {
    console.error(`[log-parser] Skipping API call - no valid auth`);
    return;
  }

  const url = `${API_BASE_URL}/api/tasks/${TASK_ID}/usage`;
  const body = JSON.stringify({
    model: modelUsed,
    inputTokens: tokenUsage.inputTokens,
    outputTokens: tokenUsage.outputTokens,
    cacheCreationTokens: tokenUsage.cacheCreationInputTokens,
    cacheReadTokens: tokenUsage.cacheReadInputTokens,
  });

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": ORG_API_KEY,
    "Content-Length": Buffer.byteLength(body),
  };

  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === "https:" ? https : http;

    const req = protocol.request(
      url,
      { method: "POST", headers },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            console.error(`[log-parser] Token usage reported successfully`);
          } else {
            console.error(`[log-parser] Failed to report token usage: ${res.statusCode} ${data}`);
          }
          resolve();
        });
      }
    );

    req.on("error", (err) => {
      console.error(`[log-parser] Error reporting token usage: ${err.message}`);
      resolve();
    });

    req.write(body);
    req.end();
  });
}

/**
 * Send final summary when done
 */
async function sendSummary() {
  // Flush any remaining logs
  flushLogs();

  // Send token usage
  await sendTokenUsage();
}

// Main: read stdin line by line
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", processLine);

rl.on("close", async () => {
  await sendSummary();
  process.exit(0);
});

// Handle SIGTERM/SIGINT gracefully
process.on("SIGTERM", async () => {
  await sendSummary();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await sendSummary();
  process.exit(0);
});
