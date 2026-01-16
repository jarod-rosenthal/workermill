#!/usr/bin/env node
/**
 * =============================================================================
 * Ollama Agent for WorkerMill
 * =============================================================================
 *
 * This agent connects to a local/remote Ollama instance to execute AI tasks.
 * It mimics the output format of Claude CLI for compatibility with the
 * log-parser and dashboard streaming.
 *
 * Environment variables:
 *   - OLLAMA_HOST: Ollama API endpoint (default: http://host.docker.internal:11434)
 *   - WORKER_MODEL or CLAUDE_MODEL: Model to use (e.g., qwen3-coder:30b)
 *   - PROMPT: The task prompt (from entrypoint.sh)
 *
 * Output format:
 *   Mimics Claude CLI stream-json format for log-parser compatibility
 */

const http = require("http");
const https = require("https");
const readline = require("readline");
const fs = require("fs");

// Configuration
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://host.docker.internal:11434";
const MODEL = process.env.WORKER_MODEL || process.env.CLAUDE_MODEL || "qwen2.5-coder:32b";
const PROMPT_FILE = process.env.PROMPT_FILE || "/tmp/ollama_prompt.txt";

// Read prompt from environment or file
let PROMPT = process.env.PROMPT || "";

// Token tracking (Ollama provides token counts in response)
let inputTokens = 0;
let outputTokens = 0;

/**
 * Parse Ollama host URL
 */
function parseOllamaHost(host) {
  const url = new URL(host);
  return {
    protocol: url.protocol === "https:" ? https : http,
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 11434),
    path: url.pathname,
  };
}

/**
 * Output in Claude CLI stream-json compatible format
 */
function outputJsonEvent(type, data) {
  const event = { type, ...data };
  console.log(JSON.stringify(event));
}

/**
 * Send chat request to Ollama
 */
async function sendChatRequest(prompt) {
  const { protocol, hostname, port } = parseOllamaHost(OLLAMA_HOST);

  // Build messages array for chat API
  const messages = [
    {
      role: "user",
      content: prompt,
    },
  ];

  const requestBody = JSON.stringify({
    model: MODEL,
    messages: messages,
    stream: true,
    options: {
      // Reasonable defaults for coding tasks
      temperature: 0.7,
      num_ctx: 32768, // Context window
    },
  });

  const options = {
    hostname,
    port,
    path: "/api/chat",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(requestBody),
    },
  };

  return new Promise((resolve, reject) => {
    console.error(`[ollama-agent] Connecting to ${OLLAMA_HOST}/api/chat with model ${MODEL}`);

    // Output initial "thinking" message for log-parser
    outputJsonEvent("message_start", { model: MODEL });

    const req = protocol.request(options, (res) => {
      if (res.statusCode !== 200) {
        let errorBody = "";
        res.on("data", (chunk) => (errorBody += chunk));
        res.on("end", () => {
          console.error(`[ollama-agent] Error: ${res.statusCode} - ${errorBody}`);
          reject(new Error(`Ollama API error: ${res.statusCode} - ${errorBody}`));
        });
        return;
      }

      const rl = readline.createInterface({
        input: res,
        crlfDelay: Infinity,
      });

      let fullResponse = "";
      let tokenCount = 0;

      rl.on("line", (line) => {
        if (!line.trim()) return;

        try {
          const data = JSON.parse(line);

          // Track tokens from response
          if (data.prompt_eval_count) {
            inputTokens = data.prompt_eval_count;
          }
          if (data.eval_count) {
            outputTokens = data.eval_count;
          }

          // Extract content from message
          if (data.message && data.message.content) {
            fullResponse += data.message.content;

            // Output in Claude-compatible format for streaming
            outputJsonEvent("assistant", {
              message: {
                content: [
                  {
                    type: "text",
                    text: data.message.content,
                  },
                ],
              },
            });
          }

          // Check if done
          if (data.done) {
            // Output final result
            outputJsonEvent("result", {
              subtype: "success",
              result: fullResponse,
              usage: {
                input_tokens: inputTokens,
                output_tokens: outputTokens,
              },
            });
            resolve(fullResponse);
          }
        } catch (parseError) {
          console.error(`[ollama-agent] Parse error: ${parseError.message}`);
        }
      });

      rl.on("close", () => {
        if (fullResponse === "") {
          reject(new Error("No response from Ollama"));
        }
      });

      rl.on("error", (err) => {
        reject(err);
      });
    });

    req.on("error", (err) => {
      console.error(`[ollama-agent] Connection error: ${err.message}`);
      reject(err);
    });

    req.write(requestBody);
    req.end();
  });
}

/**
 * Check Ollama connection
 */
async function checkOllamaConnection() {
  const { protocol, hostname, port } = parseOllamaHost(OLLAMA_HOST);

  return new Promise((resolve, reject) => {
    const req = protocol.request(
      {
        hostname,
        port,
        path: "/api/tags",
        method: "GET",
        timeout: 10000,
      },
      (res) => {
        if (res.statusCode === 200) {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            try {
              const data = JSON.parse(body);
              const models = data.models || [];
              console.error(`[ollama-agent] Connected to Ollama. Available models: ${models.map((m) => m.name).join(", ")}`);

              // Check if our model is available
              const modelAvailable = models.some(
                (m) => m.name === MODEL || m.name.startsWith(MODEL.split(":")[0])
              );
              if (!modelAvailable) {
                console.error(`[ollama-agent] WARNING: Model ${MODEL} may not be available. Available models: ${models.map((m) => m.name).join(", ")}`);
              }

              resolve(true);
            } catch {
              resolve(true);
            }
          });
        } else {
          reject(new Error(`Ollama not responding: ${res.statusCode}`));
        }
      }
    );

    req.on("error", (err) => {
      reject(new Error(`Cannot connect to Ollama at ${OLLAMA_HOST}: ${err.message}`));
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Connection to Ollama timed out`));
    });

    req.end();
  });
}

/**
 * Main execution
 */
async function main() {
  try {
    console.error(`[ollama-agent] Starting Ollama agent`);
    console.error(`[ollama-agent] OLLAMA_HOST: ${OLLAMA_HOST}`);
    console.error(`[ollama-agent] Model: ${MODEL}`);

    // Check if prompt file exists and read from it
    if (!PROMPT && fs.existsSync(PROMPT_FILE)) {
      PROMPT = fs.readFileSync(PROMPT_FILE, "utf8");
      console.error(`[ollama-agent] Read prompt from ${PROMPT_FILE}`);
    }

    if (!PROMPT) {
      // Read from stdin if no prompt provided
      console.error(`[ollama-agent] No prompt provided via env or file, reading from stdin...`);
      const rl = readline.createInterface({
        input: process.stdin,
        crlfDelay: Infinity,
      });

      const lines = [];
      for await (const line of rl) {
        lines.push(line);
      }
      PROMPT = lines.join("\n");
    }

    if (!PROMPT || PROMPT.trim() === "") {
      console.error(`[ollama-agent] ERROR: No prompt provided`);
      console.log("::result::failed");
      process.exit(1);
    }

    console.error(`[ollama-agent] Prompt length: ${PROMPT.length} characters`);

    // Check Ollama connection
    await checkOllamaConnection();

    // Send request
    const response = await sendChatRequest(PROMPT);

    // Output token usage markers (for orchestrator backup parsing)
    console.log(`::input_tokens::${inputTokens}`);
    console.log(`::output_tokens::${outputTokens}`);
    console.log(`::model::${MODEL}`);

    console.error(`[ollama-agent] Completed successfully`);
    console.error(`[ollama-agent] Tokens: input=${inputTokens}, output=${outputTokens}`);

    // Parse the response for result markers
    if (response.includes("::result::")) {
      // Response contains result marker, pass through
      const resultMatch = response.match(/::result::(\w+)/);
      if (resultMatch) {
        console.log(`::result::${resultMatch[1]}`);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error(`[ollama-agent] FATAL: ${error.message}`);
    outputJsonEvent("result", {
      subtype: "error",
      error: error.message,
    });
    console.log("::result::failed");
    process.exit(1);
  }
}

main();
