#!/usr/bin/env node
/**
 * AI Worker Log Parser
 *
 * Reads Claude CLI's streaming JSON output and extracts token usage.
 * Sends token data to the WorkerMill API for cost tracking.
 *
 * COPIED FROM ONCALLSHIFT - DO NOT MODIFY WITHOUT CHECKING ORIGINAL
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

/**
 * Extract and accumulate token usage from a JSON object
 * Handles various formats that Claude CLI might output
 */
function extractUsage(data) {
  // Try various paths where usage might be located
  const usagePaths = [
    data.usage,
    data.message?.usage,
    data.result?.usage,
    data.delta?.usage,
    data.content_block?.usage,
  ];

  for (const usage of usagePaths) {
    if (usage && typeof usage === "object") {
      // Accumulate tokens (Claude reports cumulative, so take max)
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
      return true; // Found usage
    }
  }
  return false;
}

/**
 * Process a line of output from Claude CLI
 */
function processLine(line) {
  // Pass through to stdout (for tee to capture full output)
  console.log(line);

  // Try to parse as JSON
  try {
    const data = JSON.parse(line);

    // Extract token usage from any event that has it
    extractUsage(data);

    // Track model if specified
    if (data.model) {
      modelUsed = data.model;
    }
  } catch {
    // Not JSON - that's fine, just pass through
  }
}

/**
 * Send token usage to the API
 *
 * Note: Cost calculation is done server-side using the shared pricing config.
 * This function only reports raw token counts.
 */
async function sendTokenUsage() {
  // Always output structured markers for orchestrator backup parsing
  // These go to stdout which ends up in CloudWatch logs
  console.log(`::input_tokens::${tokenUsage.inputTokens}`);
  console.log(`::output_tokens::${tokenUsage.outputTokens}`);
  console.log(`::cache_creation_tokens::${tokenUsage.cacheCreationInputTokens}`);
  console.log(`::cache_read_tokens::${tokenUsage.cacheReadInputTokens}`);
  console.log(`::model::${modelUsed}`);

  // Log to stderr for visibility
  console.error(`[log-parser] Token usage: input=${tokenUsage.inputTokens}, output=${tokenUsage.outputTokens}, cache_create=${tokenUsage.cacheCreationInputTokens}, cache_read=${tokenUsage.cacheReadInputTokens}`);
  console.error(`[log-parser] Model: ${modelUsed}`);

  // Skip API call if no auth available
  if (!TASK_ID || !ORG_API_KEY) {
    console.error(`[log-parser] Skipping API call - no valid auth`);
    return;
  }

  // Send to dedicated usage endpoint (same as oncallshift)
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
      {
        method: "POST",
        headers,
      },
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
      },
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
  // Send token usage (most important for cost tracking)
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
