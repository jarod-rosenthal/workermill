import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mcpSdk = vi.hoisted(() => {
  type ClientInstance = {
    connect: ReturnType<typeof vi.fn>;
    listTools: ReturnType<typeof vi.fn>;
    callTool: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  const clients: ClientInstance[] = [];
  const Client = vi.fn(function MockClient() {
    const client: ClientInstance = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({ tools: [{ name: "remote_ping", inputSchema: { type: "object" } }] }),
      callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "remote pong" }] }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    clients.push(client);
    return client;
  });
  const StreamableHTTPClientTransport = vi.fn(function MockHttpTransport(url: URL, options: unknown) {
    return { kind: "http", url, options };
  });
  const SSEClientTransport = vi.fn(function MockSseTransport(url: URL, options: unknown) {
    return { kind: "sse", url, options };
  });
  return { clients, Client, StreamableHTTPClientTransport, SSEClientTransport };
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: mcpSdk.Client }));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({ StreamableHTTPClientTransport: mcpSdk.StreamableHTTPClientTransport }));
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({ SSEClientTransport: mcpSdk.SSEClientTransport }));

import {
  createMCPRunResources,
  getMCPServerInfo,
  getMCPTools,
  hasMCPRegistered,
  hasMCPServers,
  stopAllMCPServers,
} from "../mcp-client.js";

const fixture = fileURLToPath(new URL("./fixtures/mcp-jsonrpc-server.mjs", import.meta.url));

function config(mode: string) {
  return { command: process.execPath, args: [fixture, mode] };
}

function tempDirectory(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function git(directory: string, args: string[]): string {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

afterEach(() => {
  // Status APIs intentionally bind to the caller's workspace, so restore the
  // suite's directory after each two-workspace fixture.
  process.chdir(path.resolve(import.meta.dirname, "../.."));
});

describe("run-owned MCP client behavior", () => {
  it("sanitizes MCP names and malformed SDK input schemas before exposing a tool definition", async () => {
    const workspace = tempDirectory("wm-mcp-schema-");
    const resources = createMCPRunResources({ runId: "schema", workspace, signal: new AbortController().signal, terminationGraceMs: 50 });
    try {
      await resources.startServer("server-name.v1", config("schema"));
      const definition = resources.getToolDefinitions()["mcp__server_name_v1__do_something_"] as {
        description: string;
        inputSchema: { jsonSchema: Record<string, unknown> };
      };

      expect(definition.description).toBe("[MCP: server-name.v1] Schema fixture");
      expect(definition.inputSchema.jsonSchema).toEqual({ type: "object", properties: {} });
    } finally {
      await resources.close();
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("converts run-owned mixed MCP content to text and hydrates missing GitHub issue arguments", async () => {
    const workspace = tempDirectory("wm-mcp-github-");
    git(workspace, ["init"]);
    git(workspace, ["remote", "add", "origin", "git@github.com:acme/widgets.git"]);
    const content = createMCPRunResources({ runId: "content", workspace, signal: new AbortController().signal, terminationGraceMs: 50 });
    const github = createMCPRunResources({ runId: "github", workspace, signal: new AbortController().signal, terminationGraceMs: 50 });
    try {
      await content.startServer("content", config("rich-content"));
      await github.startServer("github", config("github-issues"));

      await expect(content.callTool("content", "ping", {})).resolves.toBe("line one\nline two");
      const definitions = github.getToolDefinitions();
      const result = await definitions["mcp__github__list_issues"].execute({ state: "open" }) as string;
      expect(JSON.parse(result)).toMatchObject({ owner: "acme", repo: "widgets", state: "open" });
    } finally {
      await Promise.allSettled([content.close(), github.close()]);
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("reports registered and started metadata only for the current canonical workspace", async () => {
    const firstWorkspace = tempDirectory("wm-mcp-status-first-");
    const secondWorkspace = tempDirectory("wm-mcp-status-second-");
    const previousDirectory = process.cwd();
    const first = createMCPRunResources({ runId: "first", workspace: firstWorkspace, signal: new AbortController().signal, terminationGraceMs: 50 });
    const second = createMCPRunResources({ runId: "second", workspace: secondWorkspace, signal: new AbortController().signal, terminationGraceMs: 50 });
    try {
      process.chdir(firstWorkspace);
      first.register({ alpha: config("normal") });
      expect(hasMCPRegistered()).toBe(true);
      expect(hasMCPServers()).toBe(false);
      expect(getMCPTools()).toEqual([]);

      await first.ensureStarted();
      expect(getMCPTools().map((tool) => tool.serverName)).toEqual(["alpha"]);
      expect(getMCPServerInfo()).toEqual([{ name: "alpha", transport: "stdio", toolCount: 1 }]);

      await second.startServer("beta", config("normal"));
      process.chdir(secondWorkspace);
      expect(getMCPTools().map((tool) => tool.serverName)).toEqual(["beta"]);
      expect(getMCPServerInfo()).toEqual([{ name: "beta", transport: "stdio", toolCount: 1 }]);

      process.chdir(firstWorkspace);
      expect(getMCPTools().map((tool) => tool.serverName)).toEqual(["alpha"]);
    } finally {
      process.chdir(previousDirectory);
      await Promise.allSettled([first.close(), second.close()]);
      fs.rmSync(firstWorkspace, { recursive: true, force: true });
      fs.rmSync(secondWorkspace, { recursive: true, force: true });
    }
  });

  it.each([
    ["http", mcpSdk.StreamableHTTPClientTransport],
    ["sse", mcpSdk.SSEClientTransport],
  ] as const)("constructs, connects, and calls a run-owned %s transport", async (transport, Transport) => {
    const workspace = tempDirectory(`wm-mcp-${transport}-`);
    const resources = createMCPRunResources({ runId: transport, workspace, signal: new AbortController().signal, terminationGraceMs: 50 });
    const clientsBefore = mcpSdk.clients.length;
    try {
      await resources.startServer("remote", {
        transport,
        url: `https://mcp.example.test/${transport}`,
        headers: { authorization: "Bearer test" },
      });

      expect(Transport).toHaveBeenCalledTimes(1);
      const [url, options] = Transport.mock.calls.at(-1) ?? [];
      expect(url).toBeInstanceOf(URL);
      expect(url.toString()).toBe(`https://mcp.example.test/${transport}`);
      expect(options).toEqual({ requestInit: { headers: { authorization: "Bearer test" } } });

      const client = mcpSdk.clients[clientsBefore]!;
      expect(client.connect).toHaveBeenCalledWith(
        expect.objectContaining({ kind: transport }),
        expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 15_000 }),
      );
      expect(client.listTools).toHaveBeenCalledOnce();
      await expect(resources.callTool("remote", "remote_ping", { value: 1 })).resolves.toBe("remote pong");
      expect(client.callTool).toHaveBeenCalledWith(
        { name: "remote_ping", arguments: { value: 1 } },
        undefined,
        expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 }),
      );
    } finally {
      await resources.close();
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("rejects an unsupported run-owned transport before creating an SDK client", async () => {
    const workspace = tempDirectory("wm-mcp-unsupported-");
    const resources = createMCPRunResources({ runId: "unsupported", workspace, signal: new AbortController().signal, terminationGraceMs: 50 });
    const clientCount = mcpSdk.clients.length;
    try {
      await expect(resources.startServer("unsupported", { transport: "websocket" } as never)).rejects.toThrow("Unsupported MCP transport: websocket");
      expect(mcpSdk.clients).toHaveLength(clientCount);
    } finally {
      await resources.close();
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("emergency-stop closes every run-owned remote client and clears workspace status", async () => {
    const workspace = tempDirectory("wm-mcp-emergency-");
    const previousDirectory = process.cwd();
    const http = createMCPRunResources({ runId: "emergency-http", workspace, signal: new AbortController().signal, terminationGraceMs: 50 });
    const sse = createMCPRunResources({ runId: "emergency-sse", workspace, signal: new AbortController().signal, terminationGraceMs: 50 });
    const clientsBefore = mcpSdk.clients.length;
    try {
      process.chdir(workspace);
      await http.startServer("http", { transport: "http", url: "https://mcp.example.test/http" });
      await sse.startServer("sse", { transport: "sse", url: "https://mcp.example.test/sse" });
      expect(hasMCPServers()).toBe(true);

      stopAllMCPServers();

      for (const client of mcpSdk.clients.slice(clientsBefore)) expect(client.close).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(hasMCPServers()).toBe(false));
      expect(getMCPTools()).toEqual([]);
    } finally {
      process.chdir(previousDirectory);
      await Promise.allSettled([http.close(), sse.close()]);
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
