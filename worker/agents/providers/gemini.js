/**
 * =============================================================================
 * Google Gemini Provider Adapter for WorkerMill
 * =============================================================================
 *
 * Uses GEMINI_API_KEY environment variable
 * Endpoint: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 * Supports function calling
 */

const https = require("https");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";

/**
 * Convert WorkerMill messages to Gemini format
 */
function convertMessages(messages) {
  const contents = [];
  let systemInstruction = null;

  for (const msg of messages) {
    if (msg.role === "system") {
      // Gemini uses systemInstruction separately
      systemInstruction = { parts: [{ text: msg.content }] };
      continue;
    }

    const role = msg.role === "assistant" ? "model" : "user";
    const parts = [];

    if (typeof msg.content === "string") {
      parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text") {
          parts.push({ text: part.text });
        } else if (part.type === "image_url") {
          // Extract base64 from data URL
          const match = part.image_url.url.match(
            /^data:([^;]+);base64,(.+)$/
          );
          if (match) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          }
        }
      }
    }

    // Handle tool calls from assistant
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        parts.push({
          functionCall: {
            name: tc.function?.name || tc.name,
            args:
              typeof tc.function?.arguments === "string"
                ? JSON.parse(tc.function.arguments)
                : tc.function?.arguments || tc.arguments,
          },
        });
      }
    }

    // Handle tool responses
    if (msg.role === "tool") {
      parts.push({
        functionResponse: {
          name: msg.name || msg.tool_call_id,
          response: {
            result: msg.content,
          },
        },
      });
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }

  return { contents, systemInstruction };
}

/**
 * Convert WorkerMill tools to Gemini function declarations
 */
function convertTools(tools) {
  if (!tools || tools.length === 0) return undefined;

  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters || { type: "object", properties: {} },
      })),
    },
  ];
}

/**
 * Parse Gemini function calls from response
 */
function parseToolCalls(candidates) {
  const toolCalls = [];

  for (const candidate of candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${toolCalls.length}_${Date.now()}`,
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {}),
        });
      }
    }
  }

  return toolCalls;
}

/**
 * Extract text content from response
 */
function extractContent(candidates) {
  let content = "";

  for (const candidate of candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.text) {
        content += part.text;
      }
    }
  }

  return content;
}

/**
 * Make HTTPS request to Gemini API
 */
function makeRequest(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, GEMINI_BASE_URL);
    url.searchParams.set("key", GEMINI_API_KEY);

    const bodyStr = body ? JSON.stringify(body) : null;

    const reqOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bodyStr && { "Content-Length": Buffer.byteLength(bodyStr) }),
      },
      timeout: 300000, // 5 minutes
    };

    const req = https.request(reqOptions, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Gemini API error ${res.statusCode}: ${data}`));
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
 * Stream chat completion from Gemini
 */
async function streamChat(model, messages, tools, onChunk) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }

  const { contents, systemInstruction } = convertMessages(messages);

  const body = {
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = systemInstruction;
  }

  if (tools && tools.length > 0) {
    body.tools = convertTools(tools);
  }

  return new Promise((resolve, reject) => {
    const path = `/v1beta/models/${model}:streamGenerateContent`;
    const url = new URL(path, GEMINI_BASE_URL);
    url.searchParams.set("key", GEMINI_API_KEY);
    url.searchParams.set("alt", "sse");

    const bodyStr = JSON.stringify(body);

    const reqOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
      },
      timeout: 300000,
    };

    const req = https.request(reqOptions, (res) => {
      if (res.statusCode >= 400) {
        let errorData = "";
        res.on("data", (chunk) => (errorData += chunk));
        res.on("end", () => {
          reject(new Error(`Gemini API error ${res.statusCode}: ${errorData}`));
        });
        return;
      }

      let buffer = "";
      let content = "";
      let toolCalls = [];
      let usageMetadata = null;

      res.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data) continue;

          try {
            const parsed = JSON.parse(data);

            // Extract content
            const chunkContent = extractContent(parsed.candidates);
            if (chunkContent) {
              content += chunkContent;
              if (onChunk) {
                onChunk({ type: "content", content: chunkContent });
              }
            }

            // Extract tool calls
            const chunkToolCalls = parseToolCalls(parsed.candidates);
            if (chunkToolCalls.length > 0) {
              toolCalls = chunkToolCalls;
              if (onChunk) {
                onChunk({ type: "tool_calls", toolCalls });
              }
            }

            // Track usage
            if (parsed.usageMetadata) {
              usageMetadata = parsed.usageMetadata;
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
          done: true,
          usage: usageMetadata
            ? {
                input_tokens: usageMetadata.promptTokenCount || 0,
                output_tokens: usageMetadata.candidatesTokenCount || 0,
              }
            : undefined,
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
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }

  const { contents, systemInstruction } = convertMessages(messages);

  const body = {
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = systemInstruction;
  }

  if (tools && tools.length > 0) {
    body.tools = convertTools(tools);
  }

  const path = `/v1beta/models/${model}:generateContent`;
  const response = await makeRequest(path, body);
  const parsed = JSON.parse(response.data);

  const content = extractContent(parsed.candidates);
  const toolCalls = parseToolCalls(parsed.candidates);

  return {
    content,
    toolCalls,
    done: true,
    usage: parsed.usageMetadata
      ? {
          input_tokens: parsed.usageMetadata.promptTokenCount || 0,
          output_tokens: parsed.usageMetadata.candidatesTokenCount || 0,
        }
      : undefined,
    finishReason: parsed.candidates?.[0]?.finishReason,
  };
}

/**
 * List available models
 */
async function listModels() {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }

  return new Promise((resolve, reject) => {
    const url = new URL("/v1beta/models", GEMINI_BASE_URL);
    url.searchParams.set("key", GEMINI_API_KEY);

    const reqOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: "GET",
      timeout: 30000,
    };

    const req = https.request(reqOptions, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Gemini API error ${res.statusCode}: ${data}`));
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const models = parsed.models
            ?.filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
            .map((m) => m.name.replace("models/", ""));
          resolve(models || []);
        } catch (e) {
          reject(new Error(`Failed to parse models: ${e.message}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });

    req.end();
  });
}

module.exports = {
  name: "gemini",
  chat,
  streamChat,
  listModels,
  convertMessages,
  convertTools,
};
