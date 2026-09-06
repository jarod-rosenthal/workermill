import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMCPRunResources,
  getMCPServerInfo,
  getMCPTools,
  hasMCPRegistered,
  hasMCPServers,
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
});
