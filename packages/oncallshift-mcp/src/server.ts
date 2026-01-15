#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const ONCALLSHIFT_API_URL = process.env.ONCALLSHIFT_API_URL || "https://oncallshift.com/api";
const ONCALLSHIFT_API_KEY = process.env.ONCALLSHIFT_API_KEY;

if (!ONCALLSHIFT_API_KEY) {
  console.error("Error: ONCALLSHIFT_API_KEY environment variable is required");
  process.exit(1);
}

async function fetchFromApi(endpoint: string): Promise<unknown> {
  const response = await fetch(`${ONCALLSHIFT_API_URL}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${ONCALLSHIFT_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

const server = new Server(
  {
    name: "oncallshift",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_incidents",
        description: "Get a list of recent incidents from OnCallShift",
        inputSchema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              description: "Filter by status: open, acknowledged, resolved",
              enum: ["open", "acknowledged", "resolved"],
            },
            limit: {
              type: "number",
              description: "Maximum number of incidents to return (default: 20)",
            },
          },
        },
      },
      {
        name: "get_schedules",
        description: "Get on-call schedules from OnCallShift",
        inputSchema: {
          type: "object",
          properties: {
            team: {
              type: "string",
              description: "Filter by team name",
            },
          },
        },
      },
      {
        name: "get_current_oncall",
        description: "Get who is currently on-call for each schedule",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_teams",
        description: "Get a list of teams from OnCallShift",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_users",
        description: "Get a list of users from OnCallShift",
        inputSchema: {
          type: "object",
          properties: {
            team: {
              type: "string",
              description: "Filter by team name",
            },
          },
        },
      },
      {
        name: "get_escalation_policies",
        description: "Get escalation policies from OnCallShift",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    switch (name) {
      case "get_incidents": {
        const params = new URLSearchParams();
        if (args?.status) params.set("status", String(args.status));
        if (args?.limit) params.set("limit", String(args.limit));
        const query = params.toString() ? `?${params.toString()}` : "";
        result = await fetchFromApi(`/v1/incidents${query}`);
        break;
      }

      case "get_schedules": {
        const params = new URLSearchParams();
        if (args?.team) params.set("team", String(args.team));
        const query = params.toString() ? `?${params.toString()}` : "";
        result = await fetchFromApi(`/v1/schedules${query}`);
        break;
      }

      case "get_current_oncall": {
        result = await fetchFromApi("/v1/oncall/current");
        break;
      }

      case "get_teams": {
        result = await fetchFromApi("/v1/teams");
        break;
      }

      case "get_users": {
        const params = new URLSearchParams();
        if (args?.team) params.set("team", String(args.team));
        const query = params.toString() ? `?${params.toString()}` : "";
        result = await fetchFromApi(`/v1/users${query}`);
        break;
      }

      case "get_escalation_policies": {
        result = await fetchFromApi("/v1/escalation-policies");
        break;
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("OnCallShift MCP server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
