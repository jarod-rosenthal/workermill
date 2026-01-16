/**
 * =============================================================================
 * Mistral Provider Adapter for WorkerMill
 * =============================================================================
 *
 * Uses MISTRAL_API_KEY environment variable
 * Endpoint: https://api.mistral.ai/v1/chat/completions
 * OpenAI-compatible format with Mistral's high-quality models
 */

const https = require("https");

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_BASE_URL = "https://api.mistral.ai";

/**
 * Convert WorkerMill tool format to OpenAI-compatible function format
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
 * Parse tool calls from response
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
 * Make HTTPS request to Mistral API
 */
function makeRequest(options, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path, MISTRAL_BASE_URL);

    const reqOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: options.method || "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
        ...options.headers,
      },
      timeout: options.timeout || 300000, // 5 minutes
    };

    const req = https.request(reqOptions, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Mistral API error ${res.statusCode}: ${data}`));
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
 * Stream chat completion from Mistral
 */
async function streamChat(model, messages, tools, onChunk) {
  if (!MISTRAL_API_KEY) {
    throw new Error("MISTRAL_API_KEY environment variable is required");
  }

  const body = {
    model,
    messages,
    stream: true,
  };

  if (tools && tools.length > 0) {
    body.tools = convertToolsToFunctions(tools);
    body.tool_choice = "auto";
  }

  return new Promise((resolve, reject) => {
    const url = new URL("/v1/chat/completions", MISTRAL_BASE_URL);

    const bodyStr = JSON.stringify(body);

    const reqOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
        "Content-Length": Buffer.byteLength(bodyStr),
      },
      timeout: 300000,
    };

    const req = https.request(reqOptions, (res) => {
      if (res.statusCode >= 400) {
        let errorData = "";
        res.on("data", (chunk) => (errorData += chunk));
        res.on("end", () => {
          reject(
            new Error(`Mistral API error ${res.statusCode}: ${errorData}`)
          );
        });
        return;
      }

      let buffer = "";
      let content = "";
      let toolCalls = [];
      let finishReason = null;
      let usage = null;

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
                const idx = tc.index !== undefined ? tc.index : toolCalls.length;
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

            if (parsed.usage) {
              usage = parsed.usage;
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
          usage: usage
            ? {
                input_tokens: usage.prompt_tokens || 0,
                output_tokens: usage.completion_tokens || 0,
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
  if (!MISTRAL_API_KEY) {
    throw new Error("MISTRAL_API_KEY environment variable is required");
  }

  const body = {
    model,
    messages,
    stream: false,
  };

  if (tools && tools.length > 0) {
    body.tools = convertToolsToFunctions(tools);
    body.tool_choice = "auto";
  }

  const response = await makeRequest(
    { path: "/v1/chat/completions" },
    body
  );
  const parsed = JSON.parse(response.data);

  const choice = parsed.choices?.[0];
  if (!choice) {
    throw new Error("No response from Mistral");
  }

  return {
    content: choice.message?.content || "",
    toolCalls: parseToolCalls(choice.message?.tool_calls),
    done:
      choice.finish_reason === "stop" || choice.finish_reason === "tool_calls",
    finishReason: choice.finish_reason,
    usage: parsed.usage
      ? {
          input_tokens: parsed.usage.prompt_tokens || 0,
          output_tokens: parsed.usage.completion_tokens || 0,
        }
      : undefined,
  };
}

/**
 * List available models
 */
async function listModels() {
  if (!MISTRAL_API_KEY) {
    throw new Error("MISTRAL_API_KEY environment variable is required");
  }

  const response = await makeRequest(
    { path: "/v1/models", method: "GET" },
    null
  );
  const parsed = JSON.parse(response.data);
  return parsed.data?.map((m) => m.id) || [];
}

module.exports = {
  name: "mistral",
  chat,
  streamChat,
  listModels,
  convertToolsToFunctions,
};
