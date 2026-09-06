import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

type PtyProcess = {
  write(data: string): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number }) => void): void;
};
type PtyModule = { spawn(file: string, args: string[], options: Record<string, unknown>): PtyProcess };

const roots: string[] = [];
const source = path.resolve(process.cwd());
const packageMetadata = JSON.parse(await readFile(path.join(source, "package.json"), "utf8")) as { name: string; version: string };
let installRoot = "";
let server: Server;
let baseUrl = "";
let requests = 0;
let holdResponse = false;
let closedModelRequests = 0;

function command(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 60_000 });
}

function run(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(installRoot, "node_modules", ".bin", "wm"), args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const deadline = setTimeout(() => child.kill("SIGKILL"), 10_000);
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (data) => { stdout += data; });
    child.stderr!.on("data", (data) => { stderr += data; });
    child.on("error", error => { clearTimeout(deadline); reject(error); });
    child.on("close", (code) => { clearTimeout(deadline); resolve({ code, stdout, stderr }); });
  });
}

function start(args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(path.join(installRoot, "node_modules", ".bin", "wm"), args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
}

function waitUntil(predicate: () => boolean, message: string, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve();
    };
    const deadline = setTimeout(() => finish(new Error(message)), timeoutMs);
    const check = () => {
      if (settled) return;
      if (predicate()) { clearTimeout(deadline); finish(); return; }
      setTimeout(check, 25);
    };
    check();
  });
}

async function writeConfig(root: string): Promise<NodeJS.ProcessEnv> {
  const state = path.join(root, "state");
  await mkdir(state, { recursive: true });
  await writeFile(path.join(state, "cli.json"), JSON.stringify({
    providers: { lmstudio: { model: "fixture-model", host: `${baseUrl}/v1` } },
    default: "lmstudio",
    sandbox: false,
  }));
  return { ...process.env, WM_STATE_ROOT: state, NO_COLOR: "1" };
}

function jsonResponse(response: import("node:http").ServerResponse): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(
    'data: {"id":"fixture","object":"chat.completion.chunk","created":0,"model":"fixture-model","choices":[{"index":0,"delta":{"role":"assistant","content":"offline package response"},"finish_reason":null}]}\n\n'
      + 'data: {"id":"fixture","object":"chat.completion.chunk","created":0,"model":"fixture-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n'
      + "data: [DONE]\n\n",
  );
}

beforeAll(async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "wm-pack-artifact-"));
  roots.push(artifactRoot);
  // CI's npm ci has already cached the exact locked dependencies. A custom
  // npm cache can be supplied without copying a developer's entire cache.
  const npmCache = process.env.npm_config_cache ?? path.join(os.homedir(), ".npm");
  const packed = command("npm", ["pack", "--json", "--pack-destination", artifactRoot, "--cache", npmCache], source);
  if (packed.status !== 0) throw new Error(`npm pack failed: ${packed.stderr || packed.stdout}`);
  // npm's JSON output is suppressed by a few test runners; the tarball name
  // remains deterministic from package metadata and is independently checked.
  const filename = `${packageMetadata.name}-${packageMetadata.version}.tgz`;
  const artifact = path.join(artifactRoot, filename);
  expect(existsSync(artifact)).toBe(true);

  installRoot = await mkdtemp(path.join(os.tmpdir(), "wm-pack-install-"));
  roots.push(installRoot);
  const packageJson = { name: "workermill-packed-test", private: true, dependencies: { [packageMetadata.name]: `file:${artifact}` } };
  await writeFile(path.join(installRoot, "package.json"), JSON.stringify(packageJson));
  // Reuse the revision's exact dependency nodes but give the temporary root a
  // coherent file dependency. `npm ci` therefore cannot resolve a newer range
  // or touch the network while it installs the artifact and native modules.
  const lock = JSON.parse(await readFile(path.join(source, "package-lock.json"), "utf8")) as {
    packages: Record<string, Record<string, unknown>>;
  };
  const packedPackageNode = lock.packages[""];
  lock.packages[""] = packageJson as unknown as Record<string, unknown>;
  lock.packages[`node_modules/${packageMetadata.name}`] = {
    ...packedPackageNode,
    resolved: `file:${artifact}`,
  };
  await writeFile(path.join(installRoot, "package-lock.json"), JSON.stringify(lock));
  const installed = command("npm", ["ci", "--offline", "--omit=dev", "--cache", npmCache], installRoot);
  if (installed.status !== 0) throw new Error(`offline artifact install failed: ${installed.stderr || installed.stdout}`);
  expect(existsSync(path.join(installRoot, "node_modules", "workermill", "dist", "index.js"))).toBe(true);
  expect(existsSync(path.join(installRoot, "node_modules", "workermill", "personas"))).toBe(true);
  expect(existsSync(path.join(installRoot, "node_modules", "ink"))).toBe(true);

  server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404); response.end(); return;
    }
    requests += 1;
    response.on("close", () => { closedModelRequests += 1; });
    if (!holdResponse) jsonResponse(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not expose a TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("installed package and supported OS runtime", () => {
  it("runs help and version through the packed package bin", async () => {
    const env = await writeConfig(installRoot);
    const help = await run(["--help"], installRoot, env);
    const version = await run(["--version"], installRoot, env);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("WorkerMill");
    expect(version).toMatchObject({ code: 0 });
    expect(version.stdout.trim()).toBe(packageMetadata.version);
  });

  it("returns headless JSON and exit status through the installed artifact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wm-pack-workspace-"));
    roots.push(root);
    const env = await writeConfig(root);
    const result = await run(["run", "--json", "offline prompt"], root, env);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "ok", exitCode: 0, text: "offline package response" });
    expect(requests).toBeGreaterThan(0);
  });

  it("maps SIGINT cancellation to JSON exit 130 using the local provider transport", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wm-pack-cancel-"));
    roots.push(root);
    const env = await writeConfig(root);
    holdResponse = true;
    const child = start(["run", "--json", "wait for cancellation"], root, env);
    let stdout = "";
    child.stdout!.on("data", (data) => { stdout += data; });
    const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
    const requestCountBefore = requests;
    try {
      await waitUntil(() => requests > requestCountBefore, "fixture request did not start");
      child.kill("SIGINT");
      const code = await exited;
      expect(code).toBe(130);
      expect(JSON.parse(stdout)).toMatchObject({ reason: "cancelled", exitCode: 130 });
    } finally {
      holdResponse = false;
      if (child.exitCode === null) child.kill("SIGKILL");
      await exited;
    }
  });

  it("keeps the installed interactive UI responsive in a PTY and cancels without provider credentials", async () => {
    if (process.platform === "win32") {
      // Native Windows shells are outside R17 support; WSL is covered by Linux.
      console.log("Skipping PTY check: native Windows shell support is not in the supported matrix");
      return;
    }
    const installedRequire = createRequire(path.join(installRoot, "node_modules", "workermill", "package.json"));
    const pty = installedRequire("node-pty") as PtyModule;
    const root = await mkdtemp(path.join(os.tmpdir(), "wm-pack-pty-"));
    roots.push(root);
    const env = await writeConfig(root);
    holdResponse = true;
    const requestCountBefore = requests;
    const terminal = pty.spawn(process.execPath, [path.join(installRoot, "node_modules", "workermill", "dist", "index.js")], {
      cwd: root,
      name: "xterm-256color",
      cols: 120,
      rows: 32,
      env: { ...env, TERM: "xterm-256color" },
    });
    let output = "";
    terminal.onData((data) => { output += data; });
    const exited = new Promise<number>((resolve) => terminal.onExit(({ exitCode }) => resolve(exitCode)));
    try {
      await waitUntil(() => output.includes("\u001b[?2004h"), `PTY did not render its startup heartbeat: ${output.slice(-1500)}`);
      terminal.write("wait for cancellation");
      await waitUntil(() => output.includes("wait for cancellation"), "PTY did not accept prompt input");
      terminal.write("\r");
      await waitUntil(() => requests > requestCountBefore, "PTY prompt did not reach offline fixture");
      const closedBefore = closedModelRequests;
      terminal.write("\u001b");
      await waitUntil(() => closedModelRequests > closedBefore, "PTY cancellation did not close the active model request");
      terminal.write("/status");
      await waitUntil(() => output.includes("/status"), "PTY did not accept status input after cancellation");
      terminal.write("\r");
      await waitUntil(() => output.includes("Session Status"), `PTY did not become idle after cancellation: ${output.slice(-1500)}`);
      terminal.write("\u0003");
      expect(await exited).toBe(0);
    } catch (error) {
      throw new Error(String(error) + "\nPTY output:\n" + output.slice(-6000));
    } finally {
      holdResponse = false;
      terminal.kill();
      await exited;
    }
  });
});
