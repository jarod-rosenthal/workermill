import { spawn, execSync as nodeExecSync, type ChildProcess } from "child_process";
import { jsonSchema } from "ai";
import type { MCPServerConfig } from "./config.js";
import * as logger from "./logger.js";
import { VERSION } from "./version.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { runProcess } from "./engine/process-runner.js";

interface MCPTool { name: string; description?: string; inputSchema: Record<string, unknown>; }
interface PendingRequest { reject: (error: Error) => void; cleanup: () => void; resolve: (result: unknown) => void; }
interface MCPServer {
  name: string; transport: "stdio" | "http" | "sse"; process?: ChildProcess; client?: Client; tools: MCPTool[]; nextId: number;
  stdoutBuffer: Buffer; stderrBytes: number; pending: Map<number, PendingRequest>; closed: boolean; closePromise?: Promise<void>;
}
// MCP JSON Schemas are runtime data, so a static ToolSet cannot describe its keys.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDef = any;

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_MAX_STDERR_BYTES = 65_536;
const DEFAULT_TERMINATION_GRACE_MS = 500;

export interface MCPRunResourcesOptions {
  runId: string;
  workspace: string;
  signal: AbortSignal;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  maxStderrBytes?: number;
  terminationGraceMs?: number;
}

/** A run's exclusive MCP lifetime. Equal server names in separate runs never share state. */
export interface MCPRunResources {
  readonly runId: string;
  readonly workspace: string;
  register(config: Record<string, MCPServerConfig>): void;
  ensureStarted(): Promise<void>;
  startServer(name: string, config: MCPServerConfig): Promise<void>;
  startAll(config: Record<string, MCPServerConfig>): Promise<void>;
  callTool(serverName: string, toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
  getToolDefinitions(): Record<string, AnyToolDef>;
  getTools(): Array<{ serverName: string; tool: MCPTool }>;
  hasServers(): boolean;
  close(): Promise<void>;
}

interface Collection {
  servers: Map<string, MCPServer>; starting: Map<string, Promise<MCPServer>>; startingServers: Map<string, MCPServer>; workspace: string; signal?: AbortSignal;
  ownedServers: Set<MCPServer>;
  startupTimeoutMs: number; requestTimeoutMs: number; maxResponseBytes: number; maxStderrBytes: number; terminationGraceMs: number;
  closed: boolean; closePromise?: Promise<void>; controller?: AbortController; parentSignal?: AbortSignal; parentAbortListener?: () => void;
  pendingConfig?: Record<string, MCPServerConfig>; lazyStartPromise?: Promise<void>;
}

const activeServers = new Map<string, MCPServer>();
type GitHubRepoContext = { owner: string; repo: string };
const gitHubRepoContexts = new Map<string, GitHubRepoContext | null>();
const runCollections = new Set<Collection>();

function validateLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) throw new Error(`${name} must be a finite non-negative integer no greater than 2147483647`);
  return value;
}
function makeCollection(options: MCPRunResourcesOptions): Collection {
  const startupTimeoutMs = validateLimit("MCP startupTimeoutMs", options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
  const requestTimeoutMs = validateLimit("MCP requestTimeoutMs", options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  const maxResponseBytes = validateLimit("MCP maxResponseBytes", options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
  const maxStderrBytes = validateLimit("MCP maxStderrBytes", options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES);
  const terminationGraceMs = validateLimit("MCP terminationGraceMs", options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS);
  const controller = new AbortController();
  const parentAbortListener = () => controller.abort(options.signal.reason);
  if (options.signal.aborted) parentAbortListener(); else options.signal.addEventListener("abort", parentAbortListener, { once: true });
  return {
    servers: new Map(), starting: new Map(), startingServers: new Map(), ownedServers: new Set(), workspace: options.workspace, signal: controller.signal, controller,
    parentSignal: options.signal, parentAbortListener,
    startupTimeoutMs, requestTimeoutMs, maxResponseBytes, maxStderrBytes, terminationGraceMs, closed: false,
  };
}
function parseGitHubRepoFromRemote(remoteUrl: string): GitHubRepoContext | null {
  const match = remoteUrl.trim().match(/^(?:git@github\.com:|https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return match ? { owner: match[1], repo: match[2] } : null;
}
function getGitHubRepoContext(workspace: string): GitHubRepoContext | null {
  if (gitHubRepoContexts.has(workspace)) return gitHubRepoContexts.get(workspace) ?? null;
  let context: GitHubRepoContext | null = null;
  try { context = parseGitHubRepoFromRemote(nodeExecSync("git config --get remote.origin.url", { cwd: workspace, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 1500 }).trim()); } catch { /* no GitHub remote */ }
  gitHubRepoContexts.set(workspace, context);
  return context;
}
function hydrateGitHubIssueToolArgs(workspace: string, serverName: string, toolName: string, input: Record<string, unknown> | undefined): Record<string, unknown> {
  const args = { ...(input ?? {}) };
  if (!serverName.toLowerCase().includes("docker") && !serverName.toLowerCase().includes("github")) return args;
  const repo = getGitHubRepoContext(workspace);
  if (!repo) return args;
  if (toolName === "list_issues") {
    if (typeof args.owner !== "string" || !args.owner.trim()) args.owner = repo.owner;
    if (typeof args.repo !== "string" || !args.repo.trim()) args.repo = repo.repo;
  } else if (toolName === "search_issues" && (typeof args.query !== "string" || !args.query.trim())) args.query = `repo:${repo.owner}/${repo.repo} is:issue is:open`;
  return args;
}
function scopedSignal(parents: readonly (AbortSignal | undefined)[], timeoutMs: number, label: string): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const listeners = parents.filter((parent): parent is AbortSignal => parent !== undefined).map((parent) => {
    const abort = () => controller.abort(parent.reason instanceof Error ? parent.reason : new Error(`${label} cancelled`));
    if (parent.aborted) abort(); else parent.addEventListener("abort", abort, { once: true });
    return { parent, abort };
  });
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out`)), timeoutMs);
  return { signal: controller.signal, cleanup: () => { clearTimeout(timer); for (const { parent, abort } of listeners) parent.removeEventListener("abort", abort); } };
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal, label: string): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error(`${label} cancelled`));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason instanceof Error ? signal.reason : new Error(`${label} cancelled`));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (result) => { cleanup(); resolve(result); },
      (error) => { cleanup(); reject(error); },
    );
  });
}
function rejectPending(server: MCPServer, error: Error): void {
  for (const pending of server.pending.values()) { pending.cleanup(); pending.reject(error); }
  server.pending.clear();
}
function parseStdout(server: MCPServer, collection: Collection, chunk: Buffer): void {
  if (server.closed) return;
  const combined = Buffer.concat([server.stdoutBuffer, chunk]);
  if (combined.length > collection.maxResponseBytes) {
    server.stdoutBuffer = Buffer.alloc(0); rejectPending(server, new Error(`MCP response buffer exceeded ${collection.maxResponseBytes} bytes`)); return;
  }
  let offset = 0;
  for (let index = 0; index < combined.length; index += 1) {
    if (combined[index] !== 10) continue;
    const line = combined.subarray(offset, index).toString("utf8").trim(); offset = index + 1;
    if (!line) continue;
    try {
      const response = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
      if (typeof response.id !== "number") continue;
      const pending = server.pending.get(response.id);
      if (!pending) continue;
      server.pending.delete(response.id); pending.cleanup();
      if (response.error) pending.reject(new Error(response.error.message ?? "MCP request failed")); else pending.resolve(response.result);
    } catch { /* Ignore non-JSON diagnostics on stdout. */ }
  }
  server.stdoutBuffer = combined.subarray(offset);
}
function listenToProcess(server: MCPServer, collection: Collection): void {
  const proc = server.process!;
  proc.stdout?.on("data", (chunk: Buffer) => parseStdout(server, collection, chunk));
  proc.stderr?.on("data", (chunk: Buffer) => {
    server.stderrBytes += chunk.length;
    if (server.stderrBytes <= collection.maxStderrBytes) logger.debug(`MCP ${server.name} stderr: ${chunk.toString().trim()}`);
  });
  proc.on("error", (error) => { logger.error(`MCP ${server.name} error: ${error.message}`); rejectPending(server, error); });
  proc.on("exit", (code) => {
    logger.info(`MCP ${server.name} exited with code ${code}`);
    rejectPending(server, new Error(`MCP server ${server.name} exited`));
    // The shell may be gone while descendants retain its process group. Keep
    // this owned instance reachable until closeServer verifies group teardown.
    void closeServer(collection, server).catch((error) => logger.error(`MCP ${server.name} teardown failed: ${error instanceof Error ? error.message : String(error)}`));
  });
}
function sendRequest(server: MCPServer, collection: Collection, method: string, params: unknown, signal: AbortSignal | undefined, timeoutMs: number): Promise<unknown> {
  if (!server.process || server.closed) return Promise.reject(new Error(`No transport available for server ${server.name}`));
  const scoped = scopedSignal([collection.signal, signal], timeoutMs, `MCP request ${method}`);
  if (scoped.signal.aborted) { scoped.cleanup(); return Promise.reject(scoped.signal.reason); }
  const proc = server.process;
  return new Promise((resolve, reject) => {
    const id = server.nextId++;
    const onAbort = () => { if (server.pending.delete(id)) { cleanup(); reject(scoped.signal.reason instanceof Error ? scoped.signal.reason : new Error(`MCP request ${method} cancelled`)); } };
    const cleanup = () => { scoped.cleanup(); scoped.signal.removeEventListener("abort", onAbort); };
    server.pending.set(id, { resolve, reject, cleanup }); scoped.signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (!proc.stdin?.writable) throw new Error(`MCP server ${server.name} stdin is closed`);
      proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    } catch (error) {
      server.pending.delete(id);
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
function signalProcessGroup(proc: ChildProcess, signal: NodeJS.Signals): void {
  try { if (proc.pid && process.platform !== "win32") process.kill(-proc.pid, signal); else proc.kill(signal); } catch { try { proc.kill(signal); } catch { /* already exited */ } }
}
function processGroupExists(pid: number | undefined): boolean {
  if (!pid || process.platform === "win32") return false;
  try { process.kill(-pid, 0); return true; } catch { return false; }
}
function waitForProcessExit(proc: ChildProcess, graceMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = () => {
      if (done || processGroupExists(proc.pid)) return;
      done = true; clearTimeout(killTimer); clearTimeout(endTimer); clearInterval(pollTimer);
      proc.removeListener("close", finish); proc.removeListener("exit", finish); resolve();
    };
    const fail = () => {
      if (done) return;
      done = true; clearTimeout(killTimer); clearInterval(pollTimer);
      proc.removeListener("close", finish); proc.removeListener("exit", finish);
      reject(new Error(`MCP subprocess ${proc.pid ?? "unknown"} did not stop after SIGTERM/SIGKILL`));
    };
    const killTimer = setTimeout(() => signalProcessGroup(proc, "SIGKILL"), graceMs);
    const endTimer = setTimeout(fail, Math.max(1_000, graceMs * 4));
    const pollTimer = setInterval(finish, 20);
    proc.once("close", finish); proc.once("exit", finish);
    signalProcessGroup(proc, "SIGTERM");
    finish();
  });
}
async function closeServer(collection: Collection, server: MCPServer): Promise<void> {
  if (server.closePromise) return server.closePromise;
  server.closePromise = (async () => {
    server.closed = true;
    rejectPending(server, new Error(`MCP server ${server.name} closed`));
    if (server.process) await waitForProcessExit(server.process, collection.terminationGraceMs);
    if (server.client) {
      const scoped = scopedSignal([], Math.max(1_000, collection.terminationGraceMs * 4), `MCP close ${server.name}`);
      try { await abortable(Promise.resolve(server.client.close()), scoped.signal, `MCP close ${server.name}`); } finally { scoped.cleanup(); }
    }
    if (collection.servers.get(server.name) === server) collection.servers.delete(server.name);
    collection.startingServers.delete(server.name);
    collection.ownedServers.delete(server);
  })();
  return server.closePromise;
}
async function startServer(collection: Collection, name: string, config: MCPServerConfig): Promise<MCPServer> {
  if (collection.closed || collection.signal?.aborted) throw collection.signal?.reason instanceof Error ? collection.signal.reason : new Error("MCP resources are closed");
  const current = collection.servers.get(name); if (current && !current.closed) return current;
  const pending = collection.starting.get(name); if (pending) return pending;
  const startup = startServerInner(collection, name, config).finally(() => collection.starting.delete(name));
  collection.starting.set(name, startup); return startup;
}
async function startServerInner(collection: Collection, name: string, config: MCPServerConfig): Promise<MCPServer> {
  const transport = config.transport ?? "stdio";
  const startup = scopedSignal([collection.signal], collection.startupTimeoutMs, `MCP startup ${name}`);
  let server: MCPServer | undefined;
  try {
    if (startup.signal.aborted) throw startup.signal.reason instanceof Error ? startup.signal.reason : new Error(`MCP startup ${name} cancelled`);
    if (transport === "stdio") {
      if (!config.command) throw new Error(`MCP server ${name}: command required for stdio transport`);
      if (startup.signal.aborted) throw startup.signal.reason instanceof Error ? startup.signal.reason : new Error(`MCP startup ${name} cancelled`);
      const proc = spawn(config.command, config.args ?? [], { cwd: collection.workspace, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32", env: { ...process.env, ...(config.env ?? {}) } });
      server = { name, transport, process: proc, tools: [], nextId: 1, stdoutBuffer: Buffer.alloc(0), stderrBytes: 0, pending: new Map(), closed: false };
      collection.startingServers.set(name, server);
      collection.ownedServers.add(server);
      listenToProcess(server, collection);
      await sendRequest(server, collection, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "workermill-cli", version: VERSION } }, startup.signal, collection.startupTimeoutMs);
      proc.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
      const result = await sendRequest(server, collection, "tools/list", {}, startup.signal, collection.startupTimeoutMs) as { tools?: MCPTool[] };
      server.tools = result.tools ?? [];
    } else if (transport === "http" || transport === "sse") {
      if (!config.url) throw new Error(`MCP server ${name}: URL required for ${transport} transport`);
      const clientTransport = transport === "http" ? new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers ?? {} } }) : new SSEClientTransport(new URL(config.url), { requestInit: { headers: config.headers ?? {} } });
      const client = new Client({ name: "workermill-cli", version: VERSION }, { capabilities: {} });
      server = { name, transport, client, tools: [], nextId: 1, stdoutBuffer: Buffer.alloc(0), stderrBytes: 0, pending: new Map(), closed: false };
      collection.startingServers.set(name, server);
      collection.ownedServers.add(server);
      const connected = Promise.resolve(client.connect(clientTransport, { signal: startup.signal, timeout: collection.startupTimeoutMs }));
      try { await abortable(connected, startup.signal, `MCP startup ${name}`); } catch (error) { void connected.then(() => client.close()).catch(() => {}); throw error; }
      if (startup.signal.aborted) throw startup.signal.reason instanceof Error ? startup.signal.reason : new Error(`MCP startup ${name} cancelled`);
      const result = await abortable(Promise.resolve(client.listTools({}, { signal: startup.signal, timeout: collection.startupTimeoutMs })), startup.signal, `MCP startup ${name}`);
      server.tools = result.tools ?? [];
    } else throw new Error(`Unsupported MCP transport: ${transport}`);
    if (startup.signal.aborted || collection.closed) throw startup.signal.reason instanceof Error ? startup.signal.reason : new Error(`MCP startup ${name} cancelled`);
    collection.startingServers.delete(name);
    collection.servers.set(name, server);
    logger.info(`MCP ${name}: ${server.tools.length} tools available`, { tools: server.tools.map((tool) => tool.name).join(", ") });
    return server;
  } catch (error) { if (server) await closeServer(collection, server); throw error; } finally { collection.startingServers.delete(name); startup.cleanup(); }
}
function textResult(result: unknown): string {
  const content = typeof result === "object" && result !== null && Array.isArray((result as { content?: unknown }).content)
    ? (result as { content: Array<{ type?: unknown; text?: unknown }> }).content : [];
  const text = content.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n"); return text || JSON.stringify(result);
}
async function callTool(collection: Collection, serverName: string, toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const server = collection.servers.get(serverName); if (!server || server.closed) throw new Error(`MCP server "${serverName}" not found`);
  if (server.client) {
    const scoped = scopedSignal([collection.signal, signal], collection.requestTimeoutMs, "MCP request tools/call");
    try {
      if (scoped.signal.aborted) throw scoped.signal.reason instanceof Error ? scoped.signal.reason : new Error("MCP request tools/call cancelled");
      return textResult(await abortable(Promise.resolve(server.client.callTool({ name: toolName, arguments: args }, undefined, { signal: scoped.signal, timeout: collection.requestTimeoutMs })), scoped.signal, "MCP request tools/call"));
    } finally { scoped.cleanup(); }
  }
  return textResult(await sendRequest(server, collection, "tools/call", { name: toolName, arguments: args }, signal, collection.requestTimeoutMs) as { content?: Array<{ type: string; text?: string }> });
}
function getTools(collection: Collection): Array<{ serverName: string; tool: MCPTool }> { return Array.from(collection.servers, ([serverName, server]) => server.tools.map((tool) => ({ serverName, tool }))).flat(); }
function getToolDefinitions(collection: Collection, invoke: (server: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>): Record<string, AnyToolDef> {
  const defs: Record<string, AnyToolDef> = {};
  for (const [serverName, server] of collection.servers) for (const mcpTool of server.tools) {
    const schema = Object.keys(mcpTool.inputSchema ?? {}).length ? { ...mcpTool.inputSchema, type: "object" as const } : { type: "object" as const, properties: {} };
    const key = `mcp__${serverName.replace(/[^a-zA-Z0-9_]/g, "_")}__${mcpTool.name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    defs[key] = { description: `[MCP: ${serverName}] ${mcpTool.description ?? mcpTool.name}`, inputSchema: jsonSchema(schema), execute: (input: Record<string, unknown>, options?: { abortSignal?: AbortSignal }) => invoke(serverName, mcpTool.name, hydrateGitHubIssueToolArgs(collection.workspace, serverName, mcpTool.name, input), options?.abortSignal) };
  }
  return defs;
}

/** Create the compact lifetime API used by cancellation-aware adapters. */
export function createMCPRunResources(options: MCPRunResourcesOptions): MCPRunResources {
  const collection = makeCollection(options);
  const close = (): Promise<void> => {
    if (collection.closePromise) return collection.closePromise;
    collection.closed = true;
    collection.controller?.abort(new Error(`MCP run ${options.runId} closed`));
    collection.closePromise = (async () => {
      const servers = new Set(collection.ownedServers);
      const results = await Promise.allSettled([...servers].map((server) => closeServer(collection, server)));
      // Acquirers observe configuration/startup errors directly. The server
      // snapshot above retains and reports teardown errors from partial starts.
      await Promise.allSettled([...collection.starting.values()]);
      runCollections.delete(collection);
      options.signal.removeEventListener("abort", onRunAbort);
      if (collection.parentSignal && collection.parentAbortListener) collection.parentSignal.removeEventListener("abort", collection.parentAbortListener);
      const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason);
      if (errors.length > 0) throw new AggregateError(errors, `MCP run ${options.runId} cleanup failed`);
    })();
    return collection.closePromise;
  };
  runCollections.add(collection);
  const onRunAbort = () => { void close().catch((error) => logger.error(`MCP run ${options.runId} cleanup failed: ${error instanceof Error ? error.message : String(error)}`)); };
  if (options.signal.aborted) onRunAbort(); else options.signal.addEventListener("abort", onRunAbort, { once: true });
  return {
    runId: options.runId, workspace: options.workspace,
    register: (config) => {
      if (collection.closed) throw new Error("MCP resources are closed");
      if (Object.keys(config).length > 0) collection.pendingConfig = config;
    },
    ensureStarted: async () => {
      if (collection.lazyStartPromise) return collection.lazyStartPromise;
      if (!collection.pendingConfig) return;
      const config = collection.pendingConfig;
      collection.pendingConfig = undefined;
      collection.lazyStartPromise = Promise.all(Object.entries(config).map(async ([name, server]) => startServer(collection, name, server))).then(() => undefined);
      try { await collection.lazyStartPromise; } finally { collection.lazyStartPromise = undefined; }
    },
    startServer: async (name, config) => { await startServer(collection, name, config); },
    startAll: async (config) => { await Promise.all(Object.entries(config).map(async ([name, server]) => startServer(collection, name, server))); },
    callTool: (server, tool, args, signal) => callTool(collection, server, tool, args, signal),
    getToolDefinitions: () => getToolDefinitions(collection, (server, tool, args, signal) => callTool(collection, server, tool, args, signal)),
    getTools: () => getTools(collection), hasServers: () => collection.servers.size > 0, close,
  };
}

/**
 * Process-global status remains for the UI and system prompt. MCP execution
 * is run-owned; these APIs deliberately do not expose another run's tools.
 */
export function hasMCPRegistered(): boolean { return activeServers.size > 0; }
export function getMCPTools(): Array<{ serverName: string; tool: MCPTool }> {
  return Array.from(activeServers, ([serverName, server]) => server.tools.map((tool) => ({ serverName, tool }))).flat();
}
export function hasMCPServers(): boolean { return activeServers.size > 0; }

/** Async discovery for active runs: probes remain responsive to cancellation. */
export async function autoDetectMCPServersForRun(
  existing: Record<string, MCPServerConfig>,
  context: { runId: string; workspace: string; signal: AbortSignal },
): Promise<Record<string, MCPServerConfig>> {
  context.signal.throwIfAborted();
  if (existing.docker) return existing;
  for (const command of ["/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe", "docker.exe", "docker"]) {
    context.signal.throwIfAborted();
    // These executable candidates are constants, never model/user shell text.
    const result = await runProcess({
      runId: context.runId, cwd: context.workspace, signal: context.signal,
      command: `"${command}" mcp server list`, timeoutMs: 5_000,
      maxOutputBytes: 64 * 1024, terminationGraceMs: 500,
    });
    context.signal.throwIfAborted();
    if (result.reason === "cancelled") throw new Error("MCP discovery cancelled");
    if (result.reason === "exited" && result.exitCode === 0 && !result.outputTruncated
      && `${result.stdout}${result.stderr}`.includes("enabled")) {
      return { ...existing, docker: { command, args: ["mcp", "gateway", "run"] } };
    }
  }
  return existing;
}
function emergencyStopServer(server: MCPServer): void {
  server.closed = true;
  rejectPending(server, new Error(`MCP server ${server.name} closed during CLI exit`));
  if (server.process) signalProcessGroup(server.process, "SIGKILL");
  if (server.client) {
    try { void Promise.resolve(server.client.close()).catch(() => {}); }
    catch { /* Emergency exit must still attempt the other owned resources. */ }
  }
}
/** Global CLI-exit cleanup, deliberately not a run-scoped operation. */
export function stopAllMCPServers(): void {
  for (const collection of runCollections) void (async () => {
    collection.closed = true;
    collection.controller?.abort(new Error("CLI exiting"));
    for (const server of collection.ownedServers) emergencyStopServer(server);
    await Promise.allSettled([...collection.starting.values()]);
    runCollections.delete(collection);
  })();
  activeServers.clear();
}
export function getMCPServerInfo(): Array<{ name: string; transport: string; toolCount: number }> { return Array.from(activeServers.values()).map((server) => ({ name: server.name, transport: server.transport, toolCount: server.tools.length })); }
