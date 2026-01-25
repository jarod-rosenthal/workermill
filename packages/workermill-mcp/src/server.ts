***REMOVED***!/usr/bin/env node
/**
 * WorkerMill MCP Server
 *
 * A Model Context Protocol (MCP) server that enables AI assistants like
 * Claude Code to interact with the WorkerMill AI orchestration platform.
 *
 * This server exposes tools for managing tasks, controlling the orchestrator,
 * and configuring settings through natural language interactions.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WorkerMillClient } from "./client.js";
import { allTools, type ToolDefinition } from "./tools/index.js";

// Server configuration from environment variables
const API_KEY = process.env.WORKERMILL_API_KEY;
const BASE_URL = process.env.WORKERMILL_API_URL || "https://workermill.com";

/**
 * Validate required configuration
 */
function validateConfig(): void {
  if (!API_KEY) {
    // Use console.error for MCP servers (stdout is reserved for JSON-RPC)
    console.error("Error: WORKERMILL_API_KEY environment variable is required");
    console.error("");
    console.error("Set your API key:");
    console.error("  export WORKERMILL_API_KEY=your-api-key");
    console.error("");
    console.error("Or configure it in your MCP settings file.");
    process.exit(1);
  }
}

/**
 * Extract type info from a Zod schema, unwrapping optionals and nullables
 */
function extractZodTypeInfo(zodType: unknown): {
  type: string;
  description?: string;
  enumValues?: string[];
  isOptional: boolean;
  isNullable: boolean;
} {
  const def = (zodType as { _def?: Record<string, unknown> })?._def;
  if (!def) {
    return { type: "string", isOptional: false, isNullable: false };
  }

  const typeName = def.typeName as string | undefined;
  let description = def.description as string | undefined;
  let isOptional = false;
  let isNullable = false;
  let innerType = zodType;

  // Unwrap optional
  if (typeName === "ZodOptional") {
    isOptional = true;
    // Description might be on the optional wrapper
    if (!description && def.innerType) {
      innerType = def.innerType;
    } else {
      innerType = def.innerType;
    }
  }

  // Unwrap nullable
  const innerDef = (innerType as { _def?: Record<string, unknown> })?._def;
  if (innerDef?.typeName === "ZodNullable") {
    isNullable = true;
    innerType = innerDef.innerType;
  }

  // Get the final inner type info
  const finalDef = (innerType as { _def?: Record<string, unknown> })?._def;
  const finalTypeName = finalDef?.typeName as string | undefined;

  // Get description from the deepest level if not already found
  if (!description) {
    description = finalDef?.description as string | undefined;
  }
  // Also check the optional wrapper's description (for z.string().optional().describe("..."))
  if (!description && def.description) {
    description = def.description as string;
  }

  // Determine JSON Schema type
  let type = "string";
  let enumValues: string[] | undefined;

  switch (finalTypeName) {
    case "ZodNumber":
      type = "number";
      break;
    case "ZodBoolean":
      type = "boolean";
      break;
    case "ZodEnum":
      type = "string";
      enumValues = finalDef?.values as string[] | undefined;
      break;
    case "ZodString":
    default:
      type = "string";
  }

  return { type, description, enumValues, isOptional, isNullable };
}

/**
 * Convert Zod schema to JSON Schema format for MCP
 */
function zodToJsonSchema(tool: ToolDefinition): Record<string, unknown> {
  const zodSchema = tool.inputSchema;

  // Get the shape from zod object
  if ("shape" in zodSchema && typeof zodSchema.shape === "object") {
    const shape = zodSchema.shape as Record<string, unknown>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const typeInfo = extractZodTypeInfo(value);

      const prop: Record<string, unknown> = {
        type: typeInfo.type,
      };

      if (typeInfo.description) {
        prop.description = typeInfo.description;
      }

      if (typeInfo.enumValues) {
        prop.enum = typeInfo.enumValues;
      }

      if (typeInfo.isNullable) {
        prop.nullable = true;
      }

      properties[key] = prop;

      if (!typeInfo.isOptional) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  // Default empty object schema
  return {
    type: "object",
    properties: {},
  };
}

/**
 * Create and configure the MCP server
 */
function createServer(): Server {
  const server = new Server(
    {
      name: "workermill",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );
  return server;
}

/**
 * Register tool handlers with the server
 */
function registerToolHandlers(server: Server, client: WorkerMillClient): void {
  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: allTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool),
      })),
    };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const tool = allTools.find((t) => t.name === name);
    if (!tool) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Unknown tool: ${name}. Available tools: ${allTools.map((t) => t.name).join(", ")}`,
          },
        ],
      };
    }

    try {
      // Validate input with Zod schema
      const validatedArgs = tool.inputSchema.parse(args || {});

      // Execute the handler
      const result = await tool.handler(client, validatedArgs);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error executing tool "${name}": ${errorMessage}`,
          },
        ],
      };
    }
  });
}

/**
 * Register resource handlers (for future expansion)
 */
function registerResourceHandlers(server: Server): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    // Resources can be added here in the future
    // Examples: active tasks feed, orchestrator status
    return {
      resources: [],
    };
  });
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Validate configuration
  validateConfig();

  // Create API client
  const client = new WorkerMillClient({
    apiKey: API_KEY!,
    baseUrl: BASE_URL,
  });

  // Create server
  const server = createServer();

  // Register handlers
  registerToolHandlers(server, client);
  registerResourceHandlers(server);

  // Set up error handling
  server.onerror = (error) => {
    console.error("[MCP Server Error]", error);
  };

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.error("Shutting down MCP server...");
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.error("Shutting down MCP server...");
    await server.close();
    process.exit(0);
  });

  // Connect to transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("WorkerMill MCP server running on stdio");
  console.error(`Connected to: ${BASE_URL}`);
}

// Run the server
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
