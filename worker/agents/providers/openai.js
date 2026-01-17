/**
 * =============================================================================
 * OpenAI Provider Adapter for WorkerMill
 * =============================================================================
 *
 * Uses OPENAI_API_KEY environment variable
 * Supports both APIs:
 *   - Chat Completions API: /v1/chat/completions (gpt-4o, gpt-4o-mini, etc.)
 *   - Responses API: /v1/responses (gpt-5-codex, gpt-5.1-codex, gpt-5.2-codex)
 *
 * GPT-5-Codex models ONLY work with the Responses API and have 500K TPM limits.
 */

const https = require("https");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com";

/**
 * Models that require the Responses API (not chat completions)
 */
const RESPONSES_API_MODELS = [
  "gpt-5-codex",
  "gpt-5-codex-mini",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5.1-codex-max",
  "gpt-5.2-codex",
];

/**
 * Check if a model requires the Responses API
 */
function requiresResponsesApi(model) {
  const modelLower = model.toLowerCase();
  return RESPONSES_API_MODELS.some(m => modelLower.includes(m.toLowerCase()));
}

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
 * Non-streaming chat completion (Chat Completions API)
 */
async function chatCompletions(model, messages, tools) {
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
 * Convert chat messages to Responses API input format
 *
 * The Responses API has a different format for multi-turn conversations:
 * - System messages become "instructions"
 * - User messages use { role: "user", content: "..." }
 * - Assistant messages (without tool calls) use { role: "assistant", content: "..." }
 * - For tool calls: include as { type: "function_call", call_id, name, arguments }
 * - Tool results use { type: "function_call_output", call_id: "...", output: "..." }
 */
function convertMessagesToResponsesInput(messages) {
  let instructions = "";
  const inputMessages = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      instructions += (instructions ? "\n\n" : "") + msg.content;
    } else if (msg.role === "user") {
      inputMessages.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // For Responses API, include function calls as separate items
        if (msg.content) {
          inputMessages.push({ role: "assistant", content: msg.content });
        }
        for (const tc of msg.tool_calls) {
          inputMessages.push({
            type: "function_call",
            call_id: tc.id,
            name: tc.function?.name || tc.name,
            arguments: tc.function?.arguments || tc.arguments,
          });
        }
      } else {
        inputMessages.push({ role: "assistant", content: msg.content || "" });
      }
    } else if (msg.role === "tool") {
      // Tool results in Responses API use function_call_output type
      inputMessages.push({
        type: "function_call_output",
        call_id: msg.tool_call_id,
        output: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      });
    }
  }

  return { instructions, input: inputMessages };
}

/**
 * Convert tools to Responses API format
 */
function convertToolsToResponsesFormat(tools) {
  if (!tools || tools.length === 0) return undefined;

  return tools.map(tool => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters || { type: "object", properties: {} },
  }));
}

/**
 * Parse tool calls from Responses API output
 */
function parseResponsesToolCalls(output) {
  if (!output || !Array.isArray(output)) return [];

  const toolCalls = [];
  for (const item of output) {
    if (item.type === "function_call") {
      toolCalls.push({
        id: item.call_id || item.id,
        name: item.name,
        arguments: typeof item.arguments === "string"
          ? item.arguments
          : JSON.stringify(item.arguments),
      });
    }
  }
  return toolCalls;
}

/**
 * Responses API chat (for GPT-5-Codex models)
 * Uses POST /v1/responses endpoint
 */
async function responsesChat(model, messages, tools) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  const { instructions, input } = convertMessagesToResponsesInput(messages);

  const body = {
    model,
    input: input.length > 0 ? input : messages[messages.length - 1]?.content || "",
  };

  // Add instructions (system prompt) if present
  if (instructions) {
    body.instructions = instructions;
  }

  // Add tools if present
  if (tools && tools.length > 0) {
    body.tools = convertToolsToResponsesFormat(tools);
  }

  const response = await makeRequest({ path: "/v1/responses" }, body);
  const parsed = JSON.parse(response.data);

  // Responses API returns output array
  const output = parsed.output || [];

  // Extract text content from output
  let content = "";
  for (const item of output) {
    if (item.type === "message" && item.content) {
      // Handle array of content blocks
      if (Array.isArray(item.content)) {
        for (const block of item.content) {
          if (block.type === "output_text" || block.type === "text") {
            content += block.text || "";
          }
        }
      } else if (typeof item.content === "string") {
        content += item.content;
      }
    } else if (item.type === "text") {
      content += item.text || "";
    }
  }

  // Parse tool calls from output
  const toolCalls = parseResponsesToolCalls(output);

  // Determine finish reason
  const status = parsed.status || "completed";
  const finishReason = toolCalls.length > 0 ? "tool_calls" : "stop";

  return {
    content,
    toolCalls,
    done: status === "completed" || status === "failed",
    finishReason,
    usage: parsed.usage,
  };
}

/**
 * Main chat function - routes to appropriate API based on model
 */
async function chat(model, messages, tools) {
  if (requiresResponsesApi(model)) {
    return responsesChat(model, messages, tools);
  }
  return chatCompletions(model, messages, tools);
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
  chatCompletions,
  responsesChat,
  streamChat,
  listModels,
  convertToolsToFunctions,
  requiresResponsesApi,
  RESPONSES_API_MODELS,
};
