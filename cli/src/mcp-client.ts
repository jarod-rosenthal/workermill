import { spawn, execSync as nodeExecSync, type ChildProcess } from "child_process";
import { jsonSchema } from "ai";
import type { MCPServerConfig, MCPTransportType } from "./config.js";
import * as logger from "./logger.js";
import { VERSION } from "./version.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

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
  client: Client;
  tools: MCPTool[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDef = any;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const activeServers: Map<string, MCPServer> = new Map();

// Lazy init: store pending config so servers start on first tool use, not on CLI launch
let pendingConfig: Record<string, MCPServerConfig> | null = null;
let lazyStartPromise: Promise<void> | null = null;

type GitHubRepoContext = {
  owner: string;
  repo: string;
};

let cachedGitHubRepoContext: GitHubRepoContext | null | undefined;

function parseGitHubRepoFromRemote(remoteUrl: string): GitHubRepoContext | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;

  const sshMatch = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  const sshUrlMatch = trimmed.match(/^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (sshUrlMatch) {
    return { owner: sshUrlMatch[1], repo: sshUrlMatch[2] };
  }

  return null;
}

function getGitHubRepoContext(): GitHubRepoContext | null {
  if (cachedGitHubRepoContext !== undefined) return cachedGitHubRepoContext;

  try {
    const remoteUrl = nodeExecSync("git config --get remote.origin.url", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 1500,
    }).trim();

    cachedGitHubRepoContext = parseGitHubRepoFromRemote(remoteUrl);
    if (cachedGitHubRepoContext) {
      logger.debug("Detected GitHub repo context for MCP argument hydration", {
        owner: cachedGitHubRepoContext.owner,
        repo: cachedGitHubRepoContext.repo,
      });
    }
  } catch {
    cachedGitHubRepoContext = null;
  }

  return cachedGitHubRepoContext;
}

function normalizeMCPInput(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input;
}

function hydrateGitHubIssueToolArgs(
  serverName: string,
  toolName: string,
  input: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const args = { ...normalizeMCPInput(input) };
  const normalizedServer = serverName.toLowerCase();
  const isLikelyGitHubServer = normalizedServer.includes("docker") || normalizedServer.includes("github");
  if (!isLikelyGitHubServer) return args;

  const repoContext = getGitHubRepoContext();

  if (!repoContext) return args;

  if (toolName === "list_issues") {
    if (typeof args.owner !== "string" || !args.owner.trim()) args.owner = repoContext.owner;
    if (typeof args.repo !== "string" || !args.repo.trim()) args.repo = repoContext.repo;
    return args;
  }

  if (toolName === "search_issues" && (typeof args.query !== "string" || !args.query.trim())) {
    args.query = `repo:${repoContext.owner}/${repoContext.repo} is:issue is:open`;
  }

  return args;
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

export async function startMCPServer(name: string, config: MCPServerConfig): Promise<MCPServer> {
  logger.info(`Starting MCP server: ${name}`, { transport: config.transport });

  const client = new Client(
    { name: "workermill-cli", version: VERSION },
    { capabilities: {} }
  );

  let transport;

  if (config.transport === 'stdio') {
    if (!config.command) {
      throw new Error(`MCP server "${name}": command is required for stdio transport`);
    }
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    if (config.env) {
      Object.assign(env, config.env);
    }
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env,
    });
  } else if (config.transport === 'http') {
    if (!config.endpoint) {
      throw new Error(`MCP server "${name}": endpoint is required for http transport`);
    }
    transport = new StreamableHTTPClientTransport(
      new URL(config.endpoint),
      { requestInit: config.headers ? { headers: config.headers } : undefined }
    );
  } else if (config.transport === 'sse') {
    if (!config.endpoint) {
      throw new Error(`MCP server "${name}": endpoint is required for sse transport`);
    }
    transport = new SSEClientTransport(
      new URL(config.endpoint),
      { requestInit: config.headers ? { headers: config.headers } : undefined }
    );
  } else {
    throw new Error(`MCP server "${name}": unknown transport type "${config.transport}"`);
  }

  try {
    await client.connect(transport);

    // List tools
    const toolsResult = await client.listTools();
    const tools = toolsResult.tools || [];
    logger.info(`MCP ${name}: ${tools.length} tools available`, {
      tools: tools.map((t) => t.name).join(", "),
    });

    const server: MCPServer = { name, client, tools };
    activeServers.set(name, server);
    return server;
  } catch (err) {
    logger.error(`MCP ${name} init failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
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

/**
 * Register MCP server config for lazy start. Servers won't spawn until
 * ensureMCPStarted() is called (triggered by first tool use or /mcp).
 */
export function registerMCPServers(mcpConfig: Record<string, MCPServerConfig>): void {
  if (Object.keys(mcpConfig).length > 0) {
    pendingConfig = mcpConfig;
    logger.info(`Registered ${Object.keys(mcpConfig).length} MCP server(s) for lazy start`, {
      servers: Object.keys(mcpConfig).join(", "),
    });
  }
}

/**
 * Start pending MCP servers if not already started. Safe to call multiple times.
 */
export async function ensureMCPStarted(): Promise<void> {
  if (!pendingConfig) return;
  if (lazyStartPromise) return lazyStartPromise;

  const config = pendingConfig;
  pendingConfig = null;

  lazyStartPromise = startAllMCPServers(config);
  try {
    await lazyStartPromise;
  } finally {
    lazyStartPromise = null;
  }
}

/**
 * Returns true if MCP servers are registered (pending or active).
 */
export function hasMCPRegistered(): boolean {
  return pendingConfig !== null || activeServers.size > 0;
}

// ---------------------------------------------------------------------------
// Tool call
// ---------------------------------------------------------------------------

export async function callMCPTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  // Lazy start: if servers are pending, start them now
  await ensureMCPStarted();

  const server = activeServers.get(serverName);
  if (!server) throw new Error(`MCP server "${serverName}" not found`);

  const result = await server.client.callTool({
    name: toolName,
    arguments: args
  }) as { content: Array<{ type: string; text?: string }> };

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
 * Async version: ensures lazy-started servers are up, then returns tool defs.
 */
export async function getMCPToolDefinitionsAsync(): Promise<Record<string, AnyToolDef>> {
  await ensureMCPStarted();
  return getMCPToolDefinitions();
}

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
      // Ensure every MCP tool schema has type: "object" — Anthropic's API
      // rejects tools without input_schema.type. Force it unconditionally.
      const rawSchema = (mcpTool.inputSchema && typeof mcpTool.inputSchema === "object" && Object.keys(mcpTool.inputSchema).length > 0)
        ? { type: "object" as const, ...mcpTool.inputSchema }
        : { type: "object" as const, properties: {} };
      const schema = { ...rawSchema, type: "object" as const };

      // Capture loop variables for the closure
      const capturedServerName = serverName;
      const capturedToolName = mcpTool.name;

      defs[toolKey] = {
        description: `[MCP: ${serverName}] ${mcpTool.description || mcpTool.name}`,
        parameters: jsonSchema(schema),
        execute: async (input: Record<string, unknown>) => {
          const hydratedInput = hydrateGitHubIssueToolArgs(capturedServerName, capturedToolName, input);
          return callMCPTool(capturedServerName, capturedToolName, hydratedInput);
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
// Auto-detect Docker Desktop MCP gateway
// ---------------------------------------------------------------------------

/**
 * Detect if Docker Desktop's MCP gateway is available.
 * Checks for `docker.exe` (WSL) or `docker` with the `mcp` subcommand.
 * Returns an MCPServerConfig if available, null otherwise.
 */
export function detectDockerMCP(): MCPServerConfig | null {
  // Candidate docker binaries — WSL needs docker.exe from Windows side
  const candidates = [
    "/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe",
    "docker.exe",
    "docker",
  ];

  for (const bin of candidates) {
    try {
      const result = nodeExecSync(`"${bin}" mcp server list 2>&1`, {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      // Check if there are enabled servers (output contains "enabled")
      if (result.includes("enabled")) {
        logger.info("Docker Desktop MCP gateway detected", { binary: bin });
        return {
          transport: 'stdio',
          command: bin,
          args: ["mcp", "gateway", "run"],
        };
      }
    } catch {
      // This binary doesn't have mcp support or isn't available
    }
  }

  return null;
}

/**
 * Auto-detect available MCP servers and merge with user config.
 * Currently detects Docker Desktop's MCP gateway.
 */
export function autoDetectMCPServers(existing: Record<string, MCPServerConfig>): Record<string, MCPServerConfig> {
  // Don't auto-detect if user already has a "docker" MCP server configured
  if (existing.docker) return existing;

  const dockerConfig = detectDockerMCP();
  if (dockerConfig) {
    return { ...existing, docker: dockerConfig };
  }

  return existing;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function stopAllMCPServers(): void {
  for (const [name, server] of activeServers) {
    try {
      server.client.close();
    } catch {
      // Already closed or error — safe to ignore
    }
    logger.info(`MCP ${name} stopped`);
  }
  activeServers.clear();
}
