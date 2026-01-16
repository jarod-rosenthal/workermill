/**
 * =============================================================================
 * OpenAI Provider Adapter for WorkerMill
 * =============================================================================
 *
 * Uses OPENAI_API_KEY environment variable
 * Endpoint: https://api.openai.com/v1/chat/completions
 * Supports function calling format
 */

const https = require("https");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com";

/**
 * Convert WorkerMill tool format to OpenAI function format
 */
function convertToolsToFunctions(tools) {
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
 * Parse OpenAI tool calls from response
 */
function parseToolCalls(toolCalls) {
  if (!toolCalls || toolCalls.length === 0) return [];

  return toolCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: tc.function.arguments,
  }));
}

/**
 * Make HTTPS request with streaming support
 */
function makeRequest(options, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path, OPENAI_BASE_URL);

    const reqOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: options.method || "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        ...options.headers,
      },
    };

    const req = https.request(reqOptions, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(
            new Error(`OpenAI API error ${res.statusCode}: ${data}`)
          );
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

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Stream chat completion from OpenAI
 */
async function streamChat(model, messages, tools, onChunk) {
  const url = new URL("/v1/chat/completions", OPENAI_BASE_URL);

  const body = {
    model,
    messages,
    stream: true,
  };

  if (tools && tools.length > 0) {
    body.tools = convertToolsToFunctions(tools);
  }

  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
    };

    const req = https.request(reqOptions, (res) => {
      if (res.statusCode >= 400) {
        let errorData = "";
        res.on("data", (chunk) => (errorData += chunk));
        res.on("end", () => {
          reject(new Error(`OpenAI API error ${res.statusCode}: ${errorData}`));
        });
        return;
      }

      let buffer = "";
      let content = "";
      let toolCalls = [];
      let finishReason = null;

      res.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();

          if (data === "[DONE]") {
            finishReason = finishReason || "stop";
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;

            if (delta?.content) {
              content += delta.content;
              if (onChunk) onChunk({ type: "content", content: delta.content });
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                if (!toolCalls[idx]) {
                  toolCalls[idx] = {
                    id: tc.id || "",
                    name: tc.function?.name || "",
                    arguments: "",
                  };
                }
                if (tc.id) toolCalls[idx].id = tc.id;
                if (tc.function?.name) toolCalls[idx].name = tc.function.name;
                if (tc.function?.arguments) {
                  toolCalls[idx].arguments += tc.function.arguments;
                }
              }
            }

            if (parsed.choices?.[0]?.finish_reason) {
              finishReason = parsed.choices[0].finish_reason;
            }
          } catch {
            // Ignore parse errors for partial chunks
          }
        }
      });

      res.on("end", () => {
        resolve({
          content,
          toolCalls: toolCalls.filter((tc) => tc && tc.name),
          done: finishReason === "stop" || finishReason === "tool_calls",
          finishReason,
        });
      });

      res.on("error", reject);
    });

    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Non-streaming chat completion
 */
async function chat(model, messages, tools) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  const body = {
    model,
    messages,
    stream: false,
  };

  if (tools && tools.length > 0) {
    body.tools = convertToolsToFunctions(tools);
  }

  const response = await makeRequest({ path: "/v1/chat/completions" }, body);
  const parsed = JSON.parse(response.data);

  const choice = parsed.choices?.[0];
  if (!choice) {
    throw new Error("No response from OpenAI");
  }

  return {
    content: choice.message?.content || "",
    toolCalls: parseToolCalls(choice.message?.tool_calls),
    done: choice.finish_reason === "stop" || choice.finish_reason === "tool_calls",
    finishReason: choice.finish_reason,
    usage: parsed.usage,
  };
}

/**
 * List available models
 */
async function listModels() {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  const response = await makeRequest({ path: "/v1/models", method: "GET" }, null);
  const parsed = JSON.parse(response.data);
  return parsed.data?.map((m) => m.id) || [];
}

module.exports = {
  name: "openai",
  chat,
  streamChat,
  listModels,
  convertToolsToFunctions,
};
