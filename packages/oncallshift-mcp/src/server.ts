#!/usr/bin/env node
/**
 * OnCallShift MCP Server
 *
 * A Model Context Protocol (MCP) server that enables AI assistants like
 * Claude Code to interact with the OnCallShift incident management platform.
 *
 * This server exposes tools for managing incidents, on-call schedules,
 * services, and teams through natural language interactions.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { OnCallShiftClient } from './client.js';
import { TOOL_DEFINITIONS, TOOL_HANDLERS } from './tools/index.js';
import { ANALYTICS_TOOL_DEFINITIONS, ANALYTICS_TOOL_HANDLERS } from './tools/analytics.js';
import { PROMPT_DEFINITIONS, getPromptContent } from './prompts.js';

// Combine all tool definitions and handlers
const ALL_TOOL_DEFINITIONS = [...TOOL_DEFINITIONS, ...ANALYTICS_TOOL_DEFINITIONS];
const ALL_TOOL_HANDLERS = { ...TOOL_HANDLERS, ...ANALYTICS_TOOL_HANDLERS };

// Server configuration from environment variables
const API_KEY = process.env.ONCALLSHIFT_API_KEY;
const BASE_URL = process.env.ONCALLSHIFT_BASE_URL || 'https://oncallshift.com/api/v1';

/**
 * Validate required configuration
 */
function validateConfig(): void {
  if (!API_KEY) {
    // Use console.error for MCP servers (stdout is reserved for JSON-RPC)
    console.error('Error: ONCALLSHIFT_API_KEY environment variable is required');
    console.error('');
    console.error('Set your API key:');
    console.error('  export ONCALLSHIFT_API_KEY=your-api-key');
    console.error('');
    console.error('Or configure it in your MCP settings file.');
    process.exit(1);
  }
}

/**
 * Create and configure the MCP server
 */
function createServer(): Server {
  const server = new Server(
    {
      name: 'oncallshift',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );
  return server;
}

/**
 * Register tool handlers with the server
 */
function registerToolHandlers(server: Server, client: OnCallShiftClient): void {
  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: ALL_TOOL_DEFINITIONS,
    };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const handler = ALL_TOOL_HANDLERS[name];
    if (!handler) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `Unknown tool: ${name}. Available tools: ${ALL_TOOL_DEFINITIONS.map((t) => t.name).join(', ')}`,
          },
        ],
      };
    }

    try {
      const result = await handler(client, args || {});
      return {
        isError: result.isError,
        content: result.content.map(c => ({ type: 'text' as const, text: c.text })),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
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
    // Examples: current incidents feed, on-call schedule calendar
    return {
      resources: [],
    };
  });
}

/**
 * Register prompt handlers for guided workflows
 */
function registerPromptHandlers(server: Server): void {
  // List available prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: PROMPT_DEFINITIONS,
    };
  });

  // Get prompt content
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const prompt = PROMPT_DEFINITIONS.find(p => p.name === name);
    if (!prompt) {
      throw new Error(`Unknown prompt: ${name}`);
    }

    const content = getPromptContent(name, args || {});

    return {
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: content,
          },
        },
      ],
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
  const client = new OnCallShiftClient({
    apiKey: API_KEY!,
    baseUrl: BASE_URL,
  });

  // Create server
  const server = createServer();

  // Register handlers
  registerToolHandlers(server, client);
  registerResourceHandlers(server);
  registerPromptHandlers(server);

  // Set up error handling
  server.onerror = (error) => {
    console.error('[MCP Server Error]', error);
  };

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.error('Shutting down MCP server...');
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.error('Shutting down MCP server...');
    await server.close();
    process.exit(0);
  });

  // Connect to transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('OnCallShift MCP server running on stdio');
  console.error(`Connected to: ${BASE_URL}`);
}

// Run the server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
