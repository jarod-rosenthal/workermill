/**
 * =============================================================================
 * Ollama Provider Adapter for WorkerMill
 * =============================================================================
 *
 * Uses OLLAMA_HOST environment variable (default: http://localhost:11434)
 * Endpoint: /api/chat
 * Supports Ollama's native tool format
 */

const http = require("http");
const https = require("https");

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";

/**
 * Parse Ollama host URL
 */
function parseHost(host) {
  const url = new URL(host);
  return {
    protocol: url.protocol === "https:" ? https : http,
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 11434),
  };
}

/**
 * Convert WorkerMill tool format to Ollama tool format
 */
function convertTools(tools) {
  if (!tools || tools.length === 0) return undefined;

  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters || { type: "object", properties: {} },
    },
  }));
}

/**
 * Parse Ollama tool calls from response
 */
function parseToolCalls(message) {
  if (!message?.tool_calls || message.tool_calls.length === 0) return [];

  return message.tool_calls.map((tc, idx) => ({
    id: `call_${idx}_${Date.now()}`,
    name: tc.function?.name || "",
    arguments:
      typeof tc.function?.arguments === "string"
        ? tc.function.arguments
        : JSON.stringify(tc.function?.arguments || {}),
  }));
}

/**
 * Make HTTP request to Ollama
 */
function makeRequest(path, body, options = {}) {
  return new Promise((resolve, reject) => {
    const { protocol, hostname, port } = parseHost(OLLAMA_HOST);
    const bodyStr = body ? JSON.stringify(body) : null;

    const reqOptions = {
      hostname,
      port,
      path,
      method: options.method || "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bodyStr && { "Content-Length": Buffer.byteLength(bodyStr) }),
      },
      timeout: options.timeout || 300000, // 5 minutes default
    };

    const req = protocol.request(reqOptions, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Ollama API error ${res.statusCode}: ${data}`));
          return;
        }
        resolve({ statusCode: res.statusCode, data, headers: res.headers });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

/**
 * Stream chat completion from Ollama
 */
async function streamChat(model, messages, tools, onChunk) {
  const { protocol, hostname, port } = parseHost(OLLAMA_HOST);

  const body = {
    model,
    messages,
    stream: true,
    options: {
      temperature: 0.7,
      num_ctx: 32768,
    },
  };

  if (tools && tools.length > 0) {
    body.tools = convertTools(tools);
  }

  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);

    const reqOptions = {
      hostname,
      port,
      path: "/api/chat",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
      },
      timeout: 600000, // 10 minutes for long responses
    };

    const req = protocol.request(reqOptions, (res) => {
      if (res.statusCode >= 400) {
        let errorData = "";
        res.on("data", (chunk) => (errorData += chunk));
        res.on("end", () => {
          reject(new Error(`Ollama API error ${res.statusCode}: ${errorData}`));
        });
        return;
      }

      let buffer = "";
      let content = "";
      let toolCalls = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let done = false;

      res.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const parsed = JSON.parse(line);

            // Track tokens
            if (parsed.prompt_eval_count) {
              inputTokens = parsed.prompt_eval_count;
            }
            if (parsed.eval_count) {
              outputTokens = parsed.eval_count;
            }

            // Extract content
            if (parsed.message?.content) {
              content += parsed.message.content;
              if (onChunk) {
                onChunk({ type: "content", content: parsed.message.content });
              }
            }

            // Extract tool calls
            if (parsed.message?.tool_calls) {
              toolCalls = parseToolCalls(parsed.message);
              if (onChunk) {
                onChunk({ type: "tool_calls", toolCalls });
              }
            }

            // Check if done
            if (parsed.done) {
              done = true;
            }
          } catch {
            // Ignore parse errors for partial chunks
          }
        }
      });

      res.on("end", () => {
        resolve({
          content,
          toolCalls,
          done,
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
          },
        });
      });

      res.on("error", reject);
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });

    req.write(bodyStr);
    req.end();
  });
}

/**
 * Non-streaming chat completion
 */
async function chat(model, messages, tools) {
  const body = {
    model,
    messages,
    stream: false,
    options: {
      temperature: 0.7,
      num_ctx: 32768,
    },
  };

  if (tools && tools.length > 0) {
    body.tools = convertTools(tools);
  }

  const response = await makeRequest("/api/chat", body);
  const parsed = JSON.parse(response.data);

  return {
    content: parsed.message?.content || "",
    toolCalls: parseToolCalls(parsed.message),
    done: parsed.done || true,
    usage: {
      input_tokens: parsed.prompt_eval_count || 0,
      output_tokens: parsed.eval_count || 0,
    },
  };
}

/**
 * List available models
 */
async function listModels() {
  const response = await makeRequest("/api/tags", null, { method: "GET" });
  const parsed = JSON.parse(response.data);
  return parsed.models?.map((m) => m.name) || [];
}

/**
 * Check connection to Ollama
 */
async function checkConnection() {
  try {
    const models = await listModels();
    return { connected: true, models };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

/**
 * Pull a model from Ollama registry
 */
async function pullModel(model, onProgress) {
  const { protocol, hostname, port } = parseHost(OLLAMA_HOST);

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ name: model });

    const reqOptions = {
      hostname,
      port,
      path: "/api/pull",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 3600000, // 1 hour for large models
    };

    const req = protocol.request(reqOptions, (res) => {
      if (res.statusCode >= 400) {
        let errorData = "";
        res.on("data", (chunk) => (errorData += chunk));
        res.on("end", () => {
          reject(new Error(`Ollama API error ${res.statusCode}: ${errorData}`));
        });
        return;
      }

      let buffer = "";

      res.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (onProgress) onProgress(parsed);
          } catch {
            // Ignore parse errors
          }
        }
      });

      res.on("end", () => {
        resolve({ success: true, model });
      });

      res.on("error", reject);
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = {
  name: "ollama",
  chat,
  streamChat,
  listModels,
  checkConnection,
  pullModel,
  convertTools,
};
