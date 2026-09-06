import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { boundedFetch } from "../engine/http-request.js";
import { execute as download, MAX_DOWNLOAD_BYTES } from "../engine/tools/download-file.js";
import { execute as fetchTool } from "../engine/tools/fetch.js";
import { TicketOps } from "../ticket-ops.js";
import { resolveUrlReferences } from "../image-support.js";
import { createToolDefinitions } from "../engine/tools/index.js";
import * as configuration from "../config.js";

describe("owned HTTP lifetimes", () => {
  let server: Server;
  let base: string;
  let workspace: string;
  let handler: (request: IncomingMessage, response: ServerResponse) => void;
  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "wm-http-runtime-"));
    handler = (_request, response) => response.end("ok");
    server = createServer((request, response) => handler(request, response));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    base = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(workspace, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("makes no request when already aborted", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(boundedFetch(base, {}, { signal: controller.signal })).rejects.toThrow("cancelled");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancels a started body without closing a second owner's request", async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    let second!: ServerResponse;
    handler = (request, response) => {
      response.writeHead(200);
      response.write("first chunk");
      if (request.url === "/one") started();
      else second = response;
    };
    const controller = new AbortController();
    const one = boundedFetch(`${base}/one`, {}, { signal: controller.signal });
    const rejected = expect(one).rejects.toThrow("cancelled");
    const two = boundedFetch(`${base}/two`);
    await ready;
    await vi.waitFor(() => expect(second).toBeDefined());
    controller.abort(new Error("cancelled"));
    await rejected;
    second.end(" second chunk");
    expect(await (await two).text()).toBe("first chunk second chunk");
  });

  it("keeps the deadline active after headers arrive", async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    handler = (_request, response) => { response.writeHead(200); response.write("partial"); started(); };
    const result = boundedFetch(base, {}, { timeoutMs: 100 });
    const rejected = expect(result).rejects.toThrow(/timed out/);
    await ready;
    await rejected;
  });

  it("rejects oversized bodies before retaining unbounded content", async () => {
    handler = (_request, response) => response.end("x".repeat(2048));
    await expect(boundedFetch(base, {}, { maxResponseBytes: 1024 })).rejects.toThrow(/exceeds 1024/);
  });

  it("passes cancellation through the actual fetch tool", async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    handler = (_request, response) => { response.write("partial"); started(); };
    const controller = new AbortController();
    const result = fetchTool({ url: base }, controller.signal);
    await ready;
    controller.abort(new Error("cancelled"));
    expect(await result).toMatchObject({ success: false, error: expect.stringContaining("cancelled") });
  });

  it.each(["fetch", "download_file", "web_search", "ticket"])("binds the registered %s tool to its owning signal", async (name) => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    handler = (_request, response) => { response.write("partial"); started(); };
    // Every remote route is an offline fixture; never resolve local gh credentials.
    vi.spyOn(configuration, "loadConfig").mockReturnValue({ ticketSystem: "jira",
      jira: { baseUrl: base, email: "fixture@example.invalid", apiToken: "dummy" } } as never);
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => realFetch(base, init));
    const controller = new AbortController();
    const definitions = createToolDefinitions(workspace, undefined, true, {
      runId: `http-registry-${name}`, signal: controller.signal,
    }) as unknown as Record<string, { execute(input: Record<string, unknown>): Promise<unknown> }>;
    const input = name === "download_file" ? { url: base, destination: "download.txt" }
      : name === "web_search" ? { query: "offline fixture" }
      : name === "ticket" ? { action: "fetch", ticketKey: "TEST-1" }
      : { url: base };
    const result = definitions[name].execute(input);
    await ready;
    controller.abort(new Error("registered tool cancelled"));
    expect(JSON.stringify(await result)).toContain("registered tool cancelled");
    expect(await readdir(workspace)).toEqual([]);
  });

  it("cancels started URL expansion without fetching subsequent references", async () => {
    const requests: string[] = [];
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    handler = (request, response) => { requests.push(request.url!); response.write("partial"); started(); };
    const controller = new AbortController();
    const result = resolveUrlReferences(`@${base}/first @${base}/second`, controller.signal);
    const rejected = expect(result).rejects.toThrow("cancelled");
    await ready;
    controller.abort(new Error("cancelled"));
    await rejected;
    expect(requests).toEqual(["/first"]);
  });

  it("preserves the old destination and removes its temp file after a started download is cancelled", async () => {
    const destination = path.join(workspace, "existing.txt");
    await writeFile(destination, "original");
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    handler = (_request, response) => { response.write("new partial"); started(); };
    const controller = new AbortController();
    const result = download({ url: base, destination, overwrite: true }, controller.signal);
    await ready;
    await vi.waitFor(async () => expect((await readdir(workspace)).some((file) => file.startsWith(".workermill-download-"))).toBe(true));
    controller.abort(new Error("cancelled"));
    expect((await result).success).toBe(false);
    expect(await readFile(destination, "utf8")).toBe("original");
    expect(await readdir(workspace)).toEqual(["existing.txt"]);
  });

  it("commits a completed download and rejects an oversized one without clobbering it", async () => {
    const destination = path.join(workspace, "download.txt");
    handler = (_request, response) => response.end("complete");
    expect(await download({ url: base, destination })).toMatchObject({ success: true, size_bytes: 8 });
    handler = (_request, response) => { response.writeHead(200, { "content-length": MAX_DOWNLOAD_BYTES + 1 }); response.end(); };
    expect(await download({ url: base, destination, overwrite: true })).toMatchObject({ success: false, error: expect.stringContaining("exceeds") });
    expect(await readFile(destination, "utf8")).toBe("complete");
    expect(await readdir(workspace)).toEqual(["download.txt"]);
  });

  it("aborts a ticket transition before its second remote mutation", async () => {
    const requests: string[] = [];
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    handler = (request, response) => { requests.push(request.method!); response.write('{"transitions":'); started(); };
    const controller = new AbortController();
    const ops = new TicketOps("TEST-1", "jira", { signal: controller.signal, environment: { JIRA_BASE_URL: base, JIRA_EMAIL: "test@example.invalid", JIRA_API_TOKEN: "dummy" } });
    const transition = ops.transitionTo("done");
    const rejected = expect(transition).rejects.toThrow("cancelled");
    await ready;
    controller.abort(new Error("cancelled"));
    await rejected;
    expect(requests).toEqual(["GET"]);
  });

  it("reports failed model-directed ticket writes and keeps each credential snapshot separate", async () => {
    const auth: string[] = [];
    handler = (request, response) => { auth.push(String(request.headers.authorization)); response.writeHead(500); response.end("failed"); };
    const environment = { JIRA_BASE_URL: base, JIRA_EMAIL: "one", JIRA_API_TOKEN: "dummy-one" };
    const first = new TicketOps("TEST-1", "jira", { strict: true, environment });
    environment.JIRA_EMAIL = "two";
    const second = new TicketOps("TEST-2", "jira", { strict: true, environment });
    await expect(first.postComment("test")).rejects.toThrow(/500/);
    await expect(second.postComment("test")).rejects.toThrow(/500/);
    expect(auth).toEqual([`Basic ${Buffer.from("one:dummy-one").toString("base64")}`, `Basic ${Buffer.from("two:dummy-one").toString("base64")}`]);
  });
});
