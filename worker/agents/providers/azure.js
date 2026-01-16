/**
 * =============================================================================
 * Azure OpenAI Provider Adapter for WorkerMill
 * =============================================================================
 *
 * Environment variables:
 *   - AZURE_API_KEY: Azure OpenAI API key
 *   - AZURE_API_BASE: Azure OpenAI endpoint (e.g., https://your-resource.openai.azure.com)
 *   - AZURE_API_VERSION: API version (default: 2024-02-15-preview)
 *
 * Endpoint: {AZURE_API_BASE}/openai/deployments/{model}/chat/completions
 * Note: In Azure, the "model" is actually the deployment name
 */

const https = require("https");

const AZURE_API_KEY = process.env.AZURE_API_KEY;
const AZURE_API_BASE = process.env.AZURE_API_BASE;
const AZURE_API_VERSION = process.env.AZURE_API_VERSION || "2024-02-15-preview";

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
 * Validate Azure configuration
 */
function validateConfig() {
  if (!AZURE_API_KEY) {
    throw new Error("AZURE_API_KEY environment variable is required");
  }
  if (!AZURE_API_BASE) {
    throw new Error("AZURE_API_BASE environment variable is required");
  }
}

/**
 * Build the Azure OpenAI endpoint path
 */
function buildPath(deploymentName) {
  return `/openai/deployments/${deploymentName}/chat/completions?api-version=${AZURE_API_VERSION}`;
}

/**
 * Make HTTPS request to Azure OpenAI API
 */
function makeRequest(path, body, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, AZURE_API_BASE);

    const reqOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: options.method || "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": AZURE_API_KEY,
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
          reject(
            new Error(`Azure OpenAI API error ${res.statusCode}: ${data}`)
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
 * Stream chat completion from Azure OpenAI
 */
async function streamChat(model, messages, tools, onChunk) {
  validateConfig();

  const body = {
    messages,
    stream: true,
  };

  if (tools && tools.length > 0) {
    body.tools = convertToolsToFunctions(tools);
  }

  return new Promise((resolve, reject) => {
    const path = buildPath(model);
    const url = new URL(path, AZURE_API_BASE);

    const bodyStr = JSON.stringify(body);

    const reqOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": AZURE_API_KEY,
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
            new Error(`Azure OpenAI API error ${res.statusCode}: ${errorData}`)
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
  validateConfig();

  const body = {
    messages,
    stream: false,
  };

  if (tools && tools.length > 0) {
    body.tools = convertToolsToFunctions(tools);
  }

  const path = buildPath(model);
  const response = await makeRequest(path, body);
  const parsed = JSON.parse(response.data);

  const choice = parsed.choices?.[0];
  if (!choice) {
    throw new Error("No response from Azure OpenAI");
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
 * List available deployments
 * Note: Azure doesn't have a direct API for this in the OpenAI endpoint
 * This requires Azure Management API access
 */
async function listModels() {
  validateConfig();

  // Azure OpenAI doesn't expose deployment listing via the inference API
  // You would need Azure Management API for this
  // Return common deployment names as placeholders
  return [
    "gpt-4",
    "gpt-4-turbo",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-35-turbo",
    "gpt-35-turbo-16k",
  ];
}

/**
 * Get embeddings from Azure OpenAI
 */
async function embed(deploymentName, input) {
  validateConfig();

  const path = `/openai/deployments/${deploymentName}/embeddings?api-version=${AZURE_API_VERSION}`;

  const body = {
    input: Array.isArray(input) ? input : [input],
  };

  const response = await makeRequest(path, body);
  const parsed = JSON.parse(response.data);

  return {
    embeddings: parsed.data?.map((d) => d.embedding) || [],
    usage: parsed.usage
      ? {
          input_tokens: parsed.usage.prompt_tokens || 0,
          output_tokens: 0,
        }
      : undefined,
  };
}

module.exports = {
  name: "azure",
  chat,
  streamChat,
  listModels,
  embed,
  convertToolsToFunctions,
};
