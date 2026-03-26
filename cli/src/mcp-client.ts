import { spawn, type ChildProcess } from "child_process";
import { jsonSchema } from "ai";
import type { MCPServerConfig } from "./config.js";
import * as logger from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface MCPServer {
  name: string;
  process: ChildProcess;
  tools: MCPTool[];
  nextId: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDef = any;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const activeServers: Map<string, MCPServer> = new Map();

// ---------------------------------------------------------------------------
// JSON-RPC transport over stdio
// ---------------------------------------------------------------------------

function sendRequest(server: MCPServer, method: string, params?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = server.nextId++;
    const request = JSON.stringify({ jsonrpc: "2.0", id, method, params: params || {} }) + "\n";

    let buffer = "";
    const onData = (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            server.process.stdout?.removeListener("data", onData);
            clearTimeout(timer);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
          }
        } catch {
          // Partial JSON — still accumulating data, not an error
        }
      }
    };

    server.process.stdout?.on("data", onData);
    server.process.stdin?.write(request);

    // Timeout after 30s
    const timer = setTimeout(() => {
      server.process.stdout?.removeListener("data", onData);
      reject(new Error(`MCP request timed out: ${method}`));
    }, 30_000);
  });
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

export async function startMCPServer(name: string, config: MCPServerConfig): Promise<MCPServer> {
  logger.info(`Starting MCP server: ${name}`, { command: config.command, args: (config.args || []).join(" ") });

  const proc = spawn(config.command, config.args || [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...(config.env || {}) },
  });

  const server: MCPServer = { name, process: proc, tools: [], nextId: 1 };

  // Log stderr
  proc.stderr?.on("data", (data: Buffer) => {
    logger.debug(`MCP ${name} stderr: ${data.toString().trim()}`);
  });

  proc.on("error", (err) => {
    logger.error(`MCP ${name} error: ${err.message}`);
  });

  proc.on("exit", (code) => {
    logger.info(`MCP ${name} exited with code ${code}`);
    activeServers.delete(name);
  });

  // Initialize handshake
  try {
    await sendRequest(server, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "workermill-cli", version: "0.9.1" },
    });

    // Send initialized notification (no response expected)
    server.process.stdin?.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
    );

    // List tools
    const toolsResult = (await sendRequest(server, "tools/list", {})) as {
      tools: MCPTool[];
    };
    server.tools = toolsResult.tools || [];
    logger.info(`MCP ${name}: ${server.tools.length} tools available`, {
      tools: server.tools.map((t) => t.name).join(", "),
    });
  } catch (err) {
    logger.error(`MCP ${name} init failed: ${err instanceof Error ? err.message : String(err)}`);
    proc.kill();
    throw err;
  }

  activeServers.set(name, server);
  return server;
}

export async function startAllMCPServers(mcpConfig: Record<string, MCPServerConfig>): Promise<void> {
  const startPromises = Object.entries(mcpConfig).map(async ([name, config]) => {
    try {
      await startMCPServer(name, config);
    } catch (err) {
      logger.error(
        `Failed to start MCP server "${name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
  await Promise.all(startPromises);
}

// ---------------------------------------------------------------------------
// Tool call
// ---------------------------------------------------------------------------

export async function callMCPTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const server = activeServers.get(serverName);
  if (!server) throw new Error(`MCP server "${serverName}" not found`);

  const result = (await sendRequest(server, "tools/call", {
    name: toolName,
    arguments: args,
  })) as { content: Array<{ type: string; text?: string }> };

  // Extract text from content blocks
  return (
    (result.content || [])
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n") || JSON.stringify(result)
  );
}

// ---------------------------------------------------------------------------
// Build AI SDK tool definitions from active MCP servers
// ---------------------------------------------------------------------------

/**
 * Returns a map of AI SDK-compatible tool definitions for all tools
 * registered across all active MCP servers. Tool names are prefixed
 * with `mcp__<serverName>__` to avoid collisions.
 */
export function getMCPToolDefinitions(): Record<string, AnyToolDef> {
  const defs: Record<string, AnyToolDef> = {};

  for (const [serverName, server] of activeServers) {
    for (const mcpTool of server.tools) {
      // Sanitise the key: AI SDK tool names must be valid identifiers.
      // Replace anything that isn't alphanumeric/underscore with underscore.
      const safeName = mcpTool.name.replace(/[^a-zA-Z0-9_]/g, "_");
      const safeServer = serverName.replace(/[^a-zA-Z0-9_]/g, "_");
      const toolKey = `mcp__${safeServer}__${safeName}`;

      // Use the MCP tool's inputSchema directly via AI SDK's jsonSchema().
      // Fall back to an empty-object schema if none is provided.
      const schema = mcpTool.inputSchema && Object.keys(mcpTool.inputSchema).length > 0
        ? mcpTool.inputSchema
        : { type: "object" as const, properties: {} };

      // Capture loop variables for the closure
      const capturedServerName = serverName;
      const capturedToolName = mcpTool.name;

      defs[toolKey] = {
        description: `[MCP: ${serverName}] ${mcpTool.description || mcpTool.name}`,
        parameters: jsonSchema(schema),
        execute: async (input: Record<string, unknown>) => {
          return callMCPTool(capturedServerName, capturedToolName, input);
        },
      };
    }
  }

  return defs;
}

/**
 * Returns raw tool info for display/logging purposes.
 */
export function getMCPTools(): Array<{ serverName: string; tool: MCPTool }> {
  const allTools: Array<{ serverName: string; tool: MCPTool }> = [];
  for (const [name, server] of activeServers) {
    for (const t of server.tools) {
      allTools.push({ serverName: name, tool: t });
    }
  }
  return allTools;
}

/**
 * Returns true if any MCP servers are active.
 */
export function hasMCPServers(): boolean {
  return activeServers.size > 0;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function stopAllMCPServers(): void {
  for (const [name, server] of activeServers) {
    try {
      server.process.kill();
    } catch {
      // Process already exited — safe to ignore
    }
    logger.info(`MCP ${name} stopped`);
  }
  activeServers.clear();
}
