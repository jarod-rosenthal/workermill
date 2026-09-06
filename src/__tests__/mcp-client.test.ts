import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Static mocks — must be declared before any dynamic imports
// ---------------------------------------------------------------------------

vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../version.js", () => ({
  VERSION: "0.0.0-test",
}));

// ai.jsonSchema returns a lightweight wrapper we can check against
vi.mock("ai", () => ({
  jsonSchema: vi.fn((schema: unknown) => ({ __jsonSchema: schema })),
}));

// Mock MCP SDK
const mockClient = {
  connect: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  close: vi.fn(),
};
const mockStreamableHTTPTransport = {};
const mockSSETransport = {};

const MockClient = vi.fn(function() { return mockClient; });
const MockStreamableHTTPClientTransport = vi.fn(function() { return mockStreamableHTTPTransport; });
const MockSSEClientTransport = vi.fn(function() { return mockSSETransport; });

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: MockClient,
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: MockStreamableHTTPClientTransport,
}));
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: MockSSEClientTransport,
}));

// ---------------------------------------------------------------------------
// Mock ChildProcess factory
// ---------------------------------------------------------------------------

/**
 * Creates a minimal ChildProcess-like mock whose stdout emits JSON-RPC
 * response lines whenever stdin.write is called. The `responder` callback
 * receives each written string and returns the line(s) to emit (or null to
 * emit nothing).
 */
function makeMockProcess(
  responder?: (written: string) => string | null,
): {
  proc: ReturnType<typeof buildMockProc>;
  stdinWrites: string[];
} {
  const stdinWrites: string[] = [];
  const stdout = new EventEmitter() as EventEmitter & { resume?: () => void };
  const stderr = new EventEmitter();

  const stdin = {
    write: vi.fn((data: string) => {
      stdinWrites.push(data);
      if (responder) {
        const response = responder(data);
        if (response !== null) {
          // Emit asynchronously so the listener is registered first
          setImmediate(() => stdout.emit("data", Buffer.from(response)));
        }
      }
    }),
  };

  const proc = buildMockProc(stdin, stdout, stderr);
  return { proc, stdinWrites };
}

function buildMockProc(
  stdin: { write: ReturnType<typeof vi.fn> },
  stdout: EventEmitter,
  stderr: EventEmitter,
) {
  const self = new EventEmitter() as EventEmitter & {
    stdin: typeof stdin;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  self.stdin = stdin;
  self.stdout = stdout;
  self.stderr = stderr;
  self.kill = vi.fn();
  self.pid = 12345;
  return self;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a standard MCP handshake responder.
 * - initialize  → { serverInfo: { name: "test-server" } }
 * - tools/list  → { tools: [...] }
 * Notifications get no response.
 */
function makeHandshakeResponder(tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>) {
  return (written: string): string | null => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(written.trim());
    } catch {
      return null;
    }

    const method = msg.method as string;
    const id = msg.id;

    if (method === "initialize") {
      return JSON.stringify({ jsonrpc: "2.0", id, result: { serverInfo: { name: "test-server" } } }) + "\n";
    }

    if (method === "notifications/initialized") {
      // No response — it's a notification
      return null;
    }

    if (method === "tools/list") {
      return JSON.stringify({ jsonrpc: "2.0", id, result: { tools } }) + "\n";
    }

    if (method === "tools/call") {
      const params = msg.params as Record<string, unknown>;
      return (
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `called:${params.name}` }],
          },
        }) + "\n"
      );
    }

    return null;
  };
}

// ---------------------------------------------------------------------------
// Tests — module reloaded per describe block to reset module-level state
// ---------------------------------------------------------------------------

describe("mcp-client", () => {
  // We re-import the module before each test so that `activeServers` starts
  // empty. vi.resetModules() clears the module registry between tests.
  let mcpClient: typeof import("../mcp-client.js");
  let spawnMock: ReturnType<typeof vi.fn>;
  let execSyncMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    spawnMock = vi.fn();
    execSyncMock = vi.fn();
    vi.doMock("child_process", () => ({ spawn: spawnMock, execSync: execSyncMock }));

    // Reset MCP SDK mocks
    mockClient.connect.mockReset();
    mockClient.listTools.mockReset();
    mockClient.callTool.mockReset();
    mockClient.close.mockReset();
    MockStreamableHTTPClientTransport.mockClear();
    MockSSEClientTransport.mockClear();

    mcpClient = await import("../mcp-client.js");
  });

  // -------------------------------------------------------------------------
  // hasMCPServers
  // -------------------------------------------------------------------------

  describe("hasMCPServers", () => {
    it("returns false when no servers are active", () => {
      expect(mcpClient.hasMCPServers()).toBe(false);
    });

    it("returns true after a server is started", async () => {
      const { proc } = makeMockProcess(makeHandshakeResponder([]));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("srv", { command: "node", args: ["server.js"] });
      expect(mcpClient.hasMCPServers()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getMCPTools
  // -------------------------------------------------------------------------

  describe("getMCPTools", () => {
    it("returns an empty array when no servers are active", () => {
      expect(mcpClient.getMCPTools()).toEqual([]);
    });

    it("returns tools from active servers", async () => {
      const tools = [
        { name: "read_file", description: "Read a file", inputSchema: { type: "object" } },
        { name: "write_file", description: "Write a file", inputSchema: { type: "object" } },
      ];
      const { proc } = makeMockProcess(makeHandshakeResponder(tools));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("filesys", { command: "node", args: ["fs-server.js"] });

      const result = mcpClient.getMCPTools();
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ serverName: "filesys", tool: tools[0] });
      expect(result[1]).toEqual({ serverName: "filesys", tool: tools[1] });
    });

    it("returns tools from multiple active servers", async () => {
      const toolsA = [{ name: "tool_a", inputSchema: { type: "object" } }];
      const toolsB = [{ name: "tool_b", inputSchema: { type: "object" } }];

      const { proc: procA } = makeMockProcess(makeHandshakeResponder(toolsA));
      const { proc: procB } = makeMockProcess(makeHandshakeResponder(toolsB));
      spawnMock.mockReturnValueOnce(procA).mockReturnValueOnce(procB);

      await mcpClient.startMCPServer("serverA", { command: "node", args: ["a.js"] });
      await mcpClient.startMCPServer("serverB", { command: "node", args: ["b.js"] });

      const result = mcpClient.getMCPTools();
      expect(result).toHaveLength(2);
      const serverNames = result.map((r) => r.serverName);
      expect(serverNames).toContain("serverA");
      expect(serverNames).toContain("serverB");
    });
  });

  // -------------------------------------------------------------------------
  // getMCPToolDefinitions
  // -------------------------------------------------------------------------

  describe("getMCPToolDefinitions", () => {
    it("returns an empty object when no servers are active", () => {
      expect(mcpClient.getMCPToolDefinitions()).toEqual({});
    });

    it("builds tool definitions with mcp__<server>__<tool> key format", async () => {
      const tools = [
        {
          name: "search",
          description: "Search the web",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
        },
      ];
      const { proc } = makeMockProcess(makeHandshakeResponder(tools));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("brave", { command: "npx", args: ["brave-search"] });

      const defs = mcpClient.getMCPToolDefinitions();
      expect(Object.keys(defs)).toEqual(["mcp__brave__search"]);
    });

    it("includes a description prefixed with [MCP: <serverName>]", async () => {
      const tools = [{ name: "list_repos", description: "List repositories", inputSchema: {} }];
      const { proc } = makeMockProcess(makeHandshakeResponder(tools));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("github", { command: "mcp-github", args: [] });

      const defs = mcpClient.getMCPToolDefinitions();
      expect(defs["mcp__github__list_repos"].description).toBe("[MCP: github] List repositories");
    });

    it("falls back to the tool name in description when description is missing", async () => {
      const tools = [{ name: "get_user", inputSchema: {} }];
      const { proc } = makeMockProcess(makeHandshakeResponder(tools));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("gh", { command: "mcp-gh", args: [] });

      const defs = mcpClient.getMCPToolDefinitions();
      expect(defs["mcp__gh__get_user"].description).toBe("[MCP: gh] get_user");
    });

    it("passes the inputSchema through jsonSchema()", async () => {
      const inputSchema = { type: "object", properties: { q: { type: "string" } } };
      const tools = [{ name: "search", description: "Search", inputSchema }];
      const { proc } = makeMockProcess(makeHandshakeResponder(tools));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("search_srv", { command: "search-mcp", args: [] });

      const defs = mcpClient.getMCPToolDefinitions();
      // ai.jsonSchema wraps the schema — our mock returns { __jsonSchema: schema }
      expect(defs["mcp__search_srv__search"].inputSchema).toEqual({ __jsonSchema: inputSchema });
    });

    it("falls back to empty-object schema when inputSchema is missing", async () => {
      const tools = [{ name: "noop", inputSchema: {} }];
      const { proc } = makeMockProcess(makeHandshakeResponder(tools));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("noop_srv", { command: "noop-mcp", args: [] });

      const defs = mcpClient.getMCPToolDefinitions();
      expect(defs["mcp__noop_srv__noop"].inputSchema).toEqual({
        __jsonSchema: { type: "object", properties: {} },
      });
    });

    it("sanitizes special characters in server names to underscores", async () => {
      const tools = [{ name: "ping", inputSchema: {} }];
      const { proc } = makeMockProcess(makeHandshakeResponder(tools));
      spawnMock.mockReturnValue(proc);

      // Server name contains hyphens and dots
      await mcpClient.startMCPServer("my-server.v2", { command: "mcp", args: [] });

      const defs = mcpClient.getMCPToolDefinitions();
      expect(Object.keys(defs)).toEqual(["mcp__my_server_v2__ping"]);
    });

    it("sanitizes special characters in tool names to underscores", async () => {
      const tools = [{ name: "my-tool.v1", inputSchema: {} }];
      const { proc } = makeMockProcess(makeHandshakeResponder(tools));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("srv", { command: "mcp", args: [] });

      const defs = mcpClient.getMCPToolDefinitions();
      expect(Object.keys(defs)).toEqual(["mcp__srv__my_tool_v1"]);
    });

    it("sanitizes special characters in both server and tool names simultaneously", async () => {
      const tools = [{ name: "do:something!", inputSchema: {} }];
      const { proc } = makeMockProcess(makeHandshakeResponder(tools));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("my-server/prod", { command: "mcp", args: [] });

      const defs = mcpClient.getMCPToolDefinitions();
      expect(Object.keys(defs)).toEqual(["mcp__my_server_prod__do_something_"]);
    });

    it("definitions include an execute function", async () => {
      const tools = [{ name: "run", inputSchema: {} }];
      const { proc } = makeMockProcess(makeHandshakeResponder(tools));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("runner", { command: "mcp", args: [] });

      const defs = mcpClient.getMCPToolDefinitions();
      expect(typeof defs["mcp__runner__run"].execute).toBe("function");
    });

    it("execute function delegates to callMCPTool", async () => {
      const tools = [{ name: "ping", inputSchema: {} }];
      const { proc } = makeMockProcess(makeHandshakeResponder(tools));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("pinger", { command: "mcp", args: [] });

      const defs = mcpClient.getMCPToolDefinitions();
      // Calling execute triggers a tools/call JSON-RPC request; the mock
      // responder returns "called:ping"
      const result = await defs["mcp__pinger__ping"].execute({ arg1: "value" });
      expect(result).toBe("called:ping");
    });

    it("hydrates missing owner/repo for list_issues from git remote", async () => {
      execSyncMock.mockReturnValue("git@github.com:acme/widgets.git\n");

      const tools = [{
        name: "list_issues",
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string" },
            repo: { type: "string" },
            state: { type: "string" },
          },
        },
      }];

      let capturedArgs: Record<string, unknown> | undefined;
      const { proc } = makeMockProcess((written: string) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(written.trim()); } catch { return null; }
        const method = msg.method as string;
        const id = msg.id;
        if (method === "initialize") {
          return JSON.stringify({ jsonrpc: "2.0", id, result: { serverInfo: {} } }) + "\n";
        }
        if (method === "notifications/initialized") return null;
        if (method === "tools/list") {
          return JSON.stringify({ jsonrpc: "2.0", id, result: { tools } }) + "\n";
        }
        if (method === "tools/call") {
          const params = msg.params as { arguments?: Record<string, unknown> };
          capturedArgs = params.arguments;
          return JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: "ok" }] },
          }) + "\n";
        }
        return null;
      });
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("docker", { command: "mcp", args: [] });
      const defs = mcpClient.getMCPToolDefinitions();
      await defs["mcp__docker__list_issues"].execute({ state: "open" });

      expect(capturedArgs).toMatchObject({ owner: "acme", repo: "widgets", state: "open" });
    });

    it("hydrates missing query for search_issues from git remote", async () => {
      execSyncMock.mockReturnValue("https://github.com/octo/sample-repo.git\n");

      const tools = [{
        name: "search_issues",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
        },
      }];

      let capturedArgs: Record<string, unknown> | undefined;
      const { proc } = makeMockProcess((written: string) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(written.trim()); } catch { return null; }
        const method = msg.method as string;
        const id = msg.id;
        if (method === "initialize") {
          return JSON.stringify({ jsonrpc: "2.0", id, result: { serverInfo: {} } }) + "\n";
        }
        if (method === "notifications/initialized") return null;
        if (method === "tools/list") {
          return JSON.stringify({ jsonrpc: "2.0", id, result: { tools } }) + "\n";
        }
        if (method === "tools/call") {
          const params = msg.params as { arguments?: Record<string, unknown> };
          capturedArgs = params.arguments;
          return JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: "ok" }] },
          }) + "\n";
        }
        return null;
      });
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("docker", { command: "mcp", args: [] });
      const defs = mcpClient.getMCPToolDefinitions();
      await defs["mcp__docker__search_issues"].execute({});

      expect(capturedArgs).toMatchObject({
        query: "repo:octo/sample-repo is:issue is:open",
      });
    });

    it("does not override explicit owner/repo/query values", async () => {
      execSyncMock.mockReturnValue("git@github.com:acme/widgets.git\n");

      const tools = [
        {
          name: "list_issues",
          inputSchema: {
            type: "object",
            properties: { owner: { type: "string" }, repo: { type: "string" } },
          },
        },
        {
          name: "search_issues",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      ];

      const capturedToolArgs: Record<string, Record<string, unknown>> = {};
      const { proc } = makeMockProcess((written: string) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(written.trim()); } catch { return null; }
        const method = msg.method as string;
        const id = msg.id;
        if (method === "initialize") {
          return JSON.stringify({ jsonrpc: "2.0", id, result: { serverInfo: {} } }) + "\n";
        }
        if (method === "notifications/initialized") return null;
        if (method === "tools/list") {
          return JSON.stringify({ jsonrpc: "2.0", id, result: { tools } }) + "\n";
        }
        if (method === "tools/call") {
          const params = msg.params as { name: string; arguments?: Record<string, unknown> };
          capturedToolArgs[params.name] = params.arguments || {};
          return JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: "ok" }] },
          }) + "\n";
        }
        return null;
      });
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("docker", { command: "mcp", args: [] });
      const defs = mcpClient.getMCPToolDefinitions();

      await defs["mcp__docker__list_issues"].execute({ owner: "other", repo: "repo2" });
      await defs["mcp__docker__search_issues"].execute({ query: "repo:other/repo2 is:issue" });

      expect(capturedToolArgs.list_issues).toMatchObject({ owner: "other", repo: "repo2" });
      expect(capturedToolArgs.search_issues).toMatchObject({ query: "repo:other/repo2 is:issue" });
    });

    it("does not hydrate non-github server tools", async () => {
      execSyncMock.mockReturnValue("git@github.com:acme/widgets.git\n");

      const tools = [{
        name: "list_issues",
        inputSchema: {
          type: "object",
          properties: { owner: { type: "string" }, repo: { type: "string" } },
        },
      }];

      let capturedArgs: Record<string, unknown> | undefined;
      const { proc } = makeMockProcess((written: string) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(written.trim()); } catch { return null; }
        const method = msg.method as string;
        const id = msg.id;
        if (method === "initialize") {
          return JSON.stringify({ jsonrpc: "2.0", id, result: { serverInfo: {} } }) + "\n";
        }
        if (method === "notifications/initialized") return null;
        if (method === "tools/list") {
          return JSON.stringify({ jsonrpc: "2.0", id, result: { tools } }) + "\n";
        }
        if (method === "tools/call") {
          const params = msg.params as { arguments?: Record<string, unknown> };
          capturedArgs = params.arguments;
          return JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: "ok" }] },
          }) + "\n";
        }
        return null;
      });
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("tracker", { command: "mcp", args: [] });
      const defs = mcpClient.getMCPToolDefinitions();
      await defs["mcp__tracker__list_issues"].execute({ state: "open" });

      expect(capturedArgs).toMatchObject({ state: "open" });
      expect(capturedArgs).not.toHaveProperty("owner");
      expect(capturedArgs).not.toHaveProperty("repo");
    });
  });

  // -------------------------------------------------------------------------
  // stopAllMCPServers
  // -------------------------------------------------------------------------

  describe("stopAllMCPServers", () => {
    it("is a no-op when no servers are active", () => {
      expect(() => mcpClient.stopAllMCPServers()).not.toThrow();
    });

    it("kills all active server processes", async () => {
      const { proc: procA } = makeMockProcess(makeHandshakeResponder([]));
      const { proc: procB } = makeMockProcess(makeHandshakeResponder([]));
      spawnMock.mockReturnValueOnce(procA).mockReturnValueOnce(procB);

      await mcpClient.startMCPServer("srvA", { command: "mcp-a", args: [] });
      await mcpClient.startMCPServer("srvB", { command: "mcp-b", args: [] });

      mcpClient.stopAllMCPServers();

      expect(procA.kill).toHaveBeenCalledOnce();
      expect(procB.kill).toHaveBeenCalledOnce();
    });

    it("clears the active servers map so hasMCPServers returns false", async () => {
      const { proc } = makeMockProcess(makeHandshakeResponder([]));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("srv", { command: "mcp", args: [] });
      expect(mcpClient.hasMCPServers()).toBe(true);

      mcpClient.stopAllMCPServers();
      expect(mcpClient.hasMCPServers()).toBe(false);
    });

    it("continues stopping remaining servers when kill throws", async () => {
      const { proc: procA } = makeMockProcess(makeHandshakeResponder([]));
      const { proc: procB } = makeMockProcess(makeHandshakeResponder([]));
      spawnMock.mockReturnValueOnce(procA).mockReturnValueOnce(procB);

      procA.kill.mockImplementation(() => {
        throw new Error("ESRCH: process already exited");
      });

      await mcpClient.startMCPServer("srvA", { command: "mcp-a", args: [] });
      await mcpClient.startMCPServer("srvB", { command: "mcp-b", args: [] });

      // Should not throw even though procA.kill() throws
      expect(() => mcpClient.stopAllMCPServers()).not.toThrow();
      expect(procB.kill).toHaveBeenCalledOnce();
    });

    it("calls client.close for HTTP/SSE servers", async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });

      await mcpClient.startMCPServer("http-srv", {
        transport: "http",
        url: "http://example.com",
      });

      mcpClient.stopAllMCPServers();

      expect(mockClient.close).toHaveBeenCalled();
    });

    it("getMCPToolDefinitions returns empty after stopAllMCPServers", async () => {
      const tools = [{ name: "tool1", inputSchema: {} }];
      const { proc } = makeMockProcess(makeHandshakeResponder(tools));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("srv", { command: "mcp", args: [] });
      expect(Object.keys(mcpClient.getMCPToolDefinitions())).toHaveLength(1);

      mcpClient.stopAllMCPServers();
      expect(mcpClient.getMCPToolDefinitions()).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // callMCPTool
  // -------------------------------------------------------------------------

  describe("callMCPTool", () => {
    it("throws when the named server is not found", async () => {
      await expect(
        mcpClient.callMCPTool("nonexistent", "some_tool", {}),
      ).rejects.toThrow('MCP server "nonexistent" not found');
    });

    it("sends a tools/call request and returns extracted text content", async () => {
      const { proc } = makeMockProcess(makeHandshakeResponder([]));
      spawnMock.mockReturnValue(proc);

      // Override responder to return multi-block content
      let callCount = 0;
      proc.stdin.write.mockImplementation((data: string) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(data.trim()); } catch { return; }
        const method = msg.method as string;
        const id = msg.id;

        if (method === "initialize") {
          setImmediate(() => proc.stdout.emit("data", Buffer.from(
            JSON.stringify({ jsonrpc: "2.0", id, result: { serverInfo: {} } }) + "\n",
          )));
        } else if (method === "notifications/initialized") {
          // no response
        } else if (method === "tools/list") {
          setImmediate(() => proc.stdout.emit("data", Buffer.from(
            JSON.stringify({ jsonrpc: "2.0", id, result: { tools: [] } }) + "\n",
          )));
        } else if (method === "tools/call") {
          callCount++;
          setImmediate(() => proc.stdout.emit("data", Buffer.from(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  { type: "text", text: "line one" },
                  { type: "text", text: "line two" },
                  { type: "image", url: "http://example.com/img.png" },
                ],
              },
            }) + "\n",
          )));
        }
      });

      await mcpClient.startMCPServer("srv", { command: "mcp", args: [] });
      const result = await mcpClient.callMCPTool("srv", "my_tool", { arg: "val" });

      expect(result).toBe("line one\nline two");
      expect(callCount).toBe(1);
    });

    it("falls back to JSON.stringify when content has no text blocks", async () => {
      const { proc } = makeMockProcess(makeHandshakeResponder([]));
      spawnMock.mockReturnValue(proc);

      proc.stdin.write.mockImplementation((data: string) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(data.trim()); } catch { return; }
        const method = msg.method as string;
        const id = msg.id;

        if (method === "initialize") {
          setImmediate(() => proc.stdout.emit("data", Buffer.from(
            JSON.stringify({ jsonrpc: "2.0", id, result: {} }) + "\n",
          )));
        } else if (method === "notifications/initialized") {
          // no response
        } else if (method === "tools/list") {
          setImmediate(() => proc.stdout.emit("data", Buffer.from(
            JSON.stringify({ jsonrpc: "2.0", id, result: { tools: [] } }) + "\n",
          )));
        } else if (method === "tools/call") {
          const imageOnlyResult = { content: [{ type: "image", url: "http://img.com" }] };
          setImmediate(() => proc.stdout.emit("data", Buffer.from(
            JSON.stringify({ jsonrpc: "2.0", id, result: imageOnlyResult }) + "\n",
          )));
        }
      });

      await mcpClient.startMCPServer("srv2", { command: "mcp", args: [] });
      const result = await mcpClient.callMCPTool("srv2", "get_image", {});

      // No text blocks → JSON.stringify(result)
      expect(result).toContain("image");
    });

    it("calls client.callTool for HTTP/SSE servers", async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      mockClient.callTool.mockResolvedValue({
        content: [{ type: "text", text: "response from http server" }],
      });

      await mcpClient.startMCPServer("http-srv", {
        transport: "http",
        url: "http://example.com/mcp",
      });

      const result = await mcpClient.callMCPTool("http-srv", "some_tool", { arg: "value" });

      expect(mockClient.callTool).toHaveBeenCalledWith(
        { name: "some_tool", arguments: { arg: "value" } },
        undefined,
        expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 }),
      );
      expect(result).toBe("response from http server");
    });
  });

  // -------------------------------------------------------------------------
  // startMCPServer
  // -------------------------------------------------------------------------

  describe("startMCPServer", () => {
    it("spawns process with correct command and args", async () => {
      const { proc } = makeMockProcess(makeHandshakeResponder([]));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("my-srv", {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
      });

      expect(spawnMock).toHaveBeenCalledWith(
        "npx",
        ["-y", "@modelcontextprotocol/server-filesystem"],
        expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
      );
    });

    it("merges config env with process.env", async () => {
      const { proc } = makeMockProcess(makeHandshakeResponder([]));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("env-srv", {
        command: "mcp",
        args: [],
        env: { MY_TOKEN: "abc123" },
      });

      const spawnCall = spawnMock.mock.calls[0][2];
      expect(spawnCall.env).toMatchObject({ MY_TOKEN: "abc123" });
    });

    it("uses empty args array when config.args is omitted", async () => {
      const { proc } = makeMockProcess(makeHandshakeResponder([]));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("no-args-srv", { command: "mcp-binary" } as any);

      expect(spawnMock).toHaveBeenCalledWith("mcp-binary", [], expect.any(Object));
    });

    it("performs initialize handshake and sends notifications/initialized", async () => {
      const { proc, stdinWrites } = makeMockProcess(makeHandshakeResponder([]));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("handshake-srv", { command: "mcp", args: [] });

      const messages = stdinWrites.map((s) => JSON.parse(s.trim()));

      const initMsg = messages.find((m) => m.method === "initialize");
      expect(initMsg).toBeDefined();
      expect(initMsg.params.protocolVersion).toBe("2024-11-05");
      expect(initMsg.params.clientInfo.name).toBe("workermill-cli");

      const notifMsg = messages.find((m) => m.method === "notifications/initialized");
      expect(notifMsg).toBeDefined();
      // Notifications have no id
      expect(notifMsg.id).toBeUndefined();
    });

    it("sends tools/list request after initialize", async () => {
      const { proc, stdinWrites } = makeMockProcess(makeHandshakeResponder([]));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("list-srv", { command: "mcp", args: [] });

      const messages = stdinWrites.map((s) => JSON.parse(s.trim()));
      const listMsg = messages.find((m) => m.method === "tools/list");
      expect(listMsg).toBeDefined();
    });

    it("populates server tools from tools/list response", async () => {
      const tools = [
        { name: "search", description: "Search", inputSchema: { type: "object" } },
        { name: "scrape", description: "Scrape", inputSchema: { type: "object" } },
      ];
      const { proc } = makeMockProcess(makeHandshakeResponder(tools));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("tool-srv", { command: "mcp", args: [] });

      const allTools = mcpClient.getMCPTools();
      expect(allTools).toHaveLength(2);
      expect(allTools.map((t) => t.tool.name)).toEqual(["search", "scrape"]);
    });

    it("registers the server so hasMCPServers returns true", async () => {
      const { proc } = makeMockProcess(makeHandshakeResponder([]));
      spawnMock.mockReturnValue(proc);

      expect(mcpClient.hasMCPServers()).toBe(false);
      await mcpClient.startMCPServer("reg-srv", { command: "mcp", args: [] });
      expect(mcpClient.hasMCPServers()).toBe(true);
    });

    it("kills process and throws when initialize fails", async () => {
      const { proc } = makeMockProcess((written: string) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(written.trim()); } catch { return null; }
        if (msg.method === "initialize") {
          return (
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              error: { code: -32600, message: "Invalid request" },
            }) + "\n"
          );
        }
        return null;
      });
      spawnMock.mockReturnValue(proc);

      await expect(
        mcpClient.startMCPServer("fail-srv", { command: "bad-mcp", args: [] }),
      ).rejects.toThrow("Invalid request");

      expect(proc.kill).toHaveBeenCalled();
    });

    it("does not register a failed server in activeServers", async () => {
      const { proc } = makeMockProcess((written: string) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(written.trim()); } catch { return null; }
        if (msg.method === "initialize") {
          return (
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              error: { code: -32600, message: "Boot failure" },
            }) + "\n"
          );
        }
        return null;
      });
      spawnMock.mockReturnValue(proc);

      await expect(
        mcpClient.startMCPServer("failed-srv", { command: "mcp", args: [] }),
      ).rejects.toThrow();

      expect(mcpClient.hasMCPServers()).toBe(false);
    });

    it("removes server from activeServers when process exits", async () => {
      const { proc } = makeMockProcess(makeHandshakeResponder([]));
      spawnMock.mockReturnValue(proc);

      await mcpClient.startMCPServer("exit-srv", { command: "mcp", args: [] });
      expect(mcpClient.hasMCPServers()).toBe(true);

      // Simulate process exit
      proc.emit("exit", 0);
      expect(mcpClient.hasMCPServers()).toBe(false);
    });

    it("handles multi-chunk JSON-RPC responses correctly", async () => {
      // Simulate a response split across two data events
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      let writeCallIdx = 0;
      const stdin = {
        write: vi.fn((data: string) => {
          let msg: Record<string, unknown>;
          try { msg = JSON.parse(data.trim()); } catch { return; }
          const method = msg.method as string;
          const id = msg.id;
          writeCallIdx++;

          if (method === "initialize") {
            const full = JSON.stringify({ jsonrpc: "2.0", id, result: {} });
            // Split in the middle of the JSON
            const half = Math.floor(full.length / 2);
            setImmediate(() => {
              stdout.emit("data", Buffer.from(full.slice(0, half)));
              stdout.emit("data", Buffer.from(full.slice(half) + "\n"));
            });
          } else if (method === "notifications/initialized") {
            // no response
          } else if (method === "tools/list") {
            setImmediate(() => stdout.emit("data", Buffer.from(
              JSON.stringify({ jsonrpc: "2.0", id, result: { tools: [] } }) + "\n",
            )));
          }
        }),
      };

      const proc = buildMockProc(stdin, stdout, stderr);
      spawnMock.mockReturnValue(proc);

      // Should resolve correctly even with chunked delivery
      await expect(
        mcpClient.startMCPServer("chunk-srv", { command: "mcp", args: [] }),
      ).resolves.not.toThrow();
    });

    it("creates StreamableHTTP client transport for http transport", async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });

      await mcpClient.startMCPServer("http-srv", {
        transport: "http",
        url: "http://localhost:3000/mcp",
        headers: { Authorization: "Bearer token" },
      });

      expect(MockStreamableHTTPClientTransport).toHaveBeenCalledWith(
        new URL("http://localhost:3000/mcp"),
        { requestInit: { headers: { Authorization: "Bearer token" } } },
      );
      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.listTools).toHaveBeenCalled();
    });

    it("creates SSE client transport for sse transport", async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });

      await mcpClient.startMCPServer("sse-srv", {
        transport: "sse",
        url: "http://localhost:3000/sse",
      });

      expect(MockSSEClientTransport).toHaveBeenCalledWith(
        new URL("http://localhost:3000/sse"),
        { requestInit: { headers: {} } },
      );
      expect(mockClient.connect).toHaveBeenCalled();
    });

    it("throws error for unsupported transport", async () => {
      await expect(
        mcpClient.startMCPServer("bad-transport", {
          transport: "websocket" as any,
          url: "ws://example.com",
        }),
      ).rejects.toThrow("Unsupported MCP transport: websocket");
    });

    it("throws error when url is missing for http/sse transport", async () => {
      await expect(
        mcpClient.startMCPServer("no-url", { transport: "http" }),
      ).rejects.toThrow("MCP server no-url: URL required for http transport");
    });

    it("aborts a partially connected HTTP resource and awaits client close", async () => {
      let finishConnect: (() => void) | undefined;
      mockClient.connect.mockImplementation(() => new Promise<void>((resolve) => { finishConnect = resolve; }));
      mockClient.close.mockResolvedValue(undefined);
      const abort = new AbortController();
      const resources = mcpClient.createMCPRunResources({
        runId: "partial-http",
        workspace: process.cwd(),
        signal: abort.signal,
        startupTimeoutMs: 5_000,
      });

      const starting = resources.startServer("remote", { transport: "http", url: "http://example.test/mcp" });
      abort.abort(new Error("test cancellation"));
      await expect(starting).rejects.toThrow("test cancellation");
      finishConnect?.();
      await expect(resources.close()).resolves.toBeUndefined();
      expect(mockClient.close).toHaveBeenCalled();
      expect(resources.hasServers()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // startAllMCPServers
  // -------------------------------------------------------------------------

  describe("startAllMCPServers", () => {
    it("starts multiple servers in parallel", async () => {
      const { proc: procA } = makeMockProcess(makeHandshakeResponder([]));
      const { proc: procB } = makeMockProcess(makeHandshakeResponder([]));
      spawnMock.mockReturnValueOnce(procA).mockReturnValueOnce(procB);

      await mcpClient.startAllMCPServers({
        alpha: { command: "mcp-alpha", args: [] },
        beta: { command: "mcp-beta", args: [] },
      });

      expect(spawnMock).toHaveBeenCalledTimes(2);
      expect(mcpClient.getMCPTools()).toHaveLength(0);
    });

    it("does not throw when one server fails to start", async () => {
      const { proc: goodProc } = makeMockProcess(makeHandshakeResponder([]));
      const { proc: badProc } = makeMockProcess((written: string) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(written.trim()); } catch { return null; }
        if (msg.method === "initialize") {
          return (
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              error: { code: -1, message: "Startup error" },
            }) + "\n"
          );
        }
        return null;
      });

      spawnMock.mockReturnValueOnce(goodProc).mockReturnValueOnce(badProc);

      await expect(
        mcpClient.startAllMCPServers({
          good: { command: "good-mcp", args: [] },
          bad: { command: "bad-mcp", args: [] },
        }),
      ).resolves.not.toThrow();

      // Only the good server registered
      expect(mcpClient.hasMCPServers()).toBe(true);
      const tools = mcpClient.getMCPTools();
      expect(tools.every((t) => t.serverName === "good")).toBe(true);
    });

    it("logs an error for the failing server", async () => {
      const logger = await import("../logger.js");
      const { proc: goodProc } = makeMockProcess(makeHandshakeResponder([]));
      const { proc: failProc } = makeMockProcess((written: string) => {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(written.trim()); } catch { return null; }
        if (msg.method === "initialize") {
          return (
            JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -1, message: "Init error" } }) + "\n"
          );
        }
        return null;
      });

      spawnMock.mockReturnValueOnce(goodProc).mockReturnValueOnce(failProc);

      await mcpClient.startAllMCPServers({
        ok: { command: "ok-mcp", args: [] },
        err: { command: "err-mcp", args: [] },
      });

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to start MCP server "err"'),
      );
    });

    it("is a no-op with an empty config object", async () => {
      await expect(mcpClient.startAllMCPServers({})).resolves.not.toThrow();
      expect(spawnMock).not.toHaveBeenCalled();
      expect(mcpClient.hasMCPServers()).toBe(false);
    });
  });
});
