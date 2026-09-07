// Real Ubuntu24.04 compatibility checks, not evidence of working OS containment.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

assert.equal(process.platform, "linux");
assert.equal((await readFile("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8")).trim(), "1");
const root = await mkdtemp(path.join(os.tmpdir(), "wm-ubuntu2404-"));
const state = path.join(root, "state");
await mkdir(state);
const cli = path.resolve("dist/index.js");
let requests = 0;
const server = createServer((request, response) => {
  if (request.method !== "POST") { response.writeHead(404); response.end(); return; }
  requests++;
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end('data: {"id":"fixture","object":"chat.completion.chunk","created":0,"model":"fixture","choices":[{"index":0,"delta":{"role":"assistant","content":"Ubuntu24.04 path mode works"},"finish_reason":null}]}\n\n'
    + 'data: {"id":"fixture","object":"chat.completion.chunk","created":0,"model":"fixture","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const config = {
  default: "lmstudio", providers: { lmstudio: { model: "fixture", host: `http://127.0.0.1:${server.address().port}/v1` } },
  disableModelAutoUpdate: true, sandbox: "os",
};
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root, detached: true, env: { ...process.env, WM_STATE_ROOT: state, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    const deadline = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 20_000);
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.on("error", error => { clearTimeout(deadline); reject(error); });
    child.on("close", code => { clearTimeout(deadline); resolve({ code, stdout, stderr }); });
  });
}
try {
  await writeFile(path.join(state, "cli.json"), JSON.stringify(config));
  const explicit = await run([cli, "run", "--json", "Do not call the provider if isolation cannot start"]);
  assert.equal(explicit.code, 6, JSON.stringify(explicit));
  const result = JSON.parse(explicit.stdout);
  assert.equal(result.reason, "os_sandbox_unavailable");
  assert.match(result.error, /runtime startup failed before model work/);
  assert.match(result.error, /bwrap:|apply-seccomp:|namespace/i);
  assert.equal(requests, 0);
  const doctor = await run([cli, "doctor"]);
  assert.match(doctor.stdout, /runtime startup failed before model work/);
  assert.doesNotMatch(doctor.stdout, /OS sandbox runtime startup passed|All checks passed/);

  config.sandbox = true;
  await writeFile(path.join(state, "cli.json"), JSON.stringify(config));
  const pathRun = await run([cli, "run", "--json", "Reply with the fixture response"]);
  assert.equal(pathRun.code, 0, JSON.stringify(pathRun));
  assert.equal(JSON.parse(pathRun.stdout).text, "Ubuntu24.04 path mode works");
  assert.equal(requests, 1);
  console.log("PASS: explicit OS mode stops before provider work; doctor reports failure; explicit path mode completes.");

  // Inspect a separately installed newer runtime without changing WorkerMill's lockfile.
  if (process.env.WM_CANDIDATE_RUNTIME) {
    const moduleUrl = pathToFileURL(path.resolve(process.env.WM_CANDIDATE_RUNTIME)).href;
    const code = `
      import { SandboxManager } from ${JSON.stringify(moduleUrl)};
      import { spawnSync } from 'node:child_process';
      try {
        await SandboxManager.initialize({ filesystem: { allowWrite: [process.cwd()], denyRead: [], denyWrite: [] }, network: { allowedDomains: [], deniedDomains: [] } });
        const command = await SandboxManager.wrapWithSandbox("printf runtime-ready");
        const child = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', timeout: 5000 });
        console.log(JSON.stringify({ code: child.status, stdout: child.stdout, stderr: child.stderr }));
      } finally { await SandboxManager.reset(); }
    `;
    const candidate = await run(["--input-type=module", "-e", code]);
    assert.equal(candidate.code, 0, JSON.stringify(candidate));
    const probe = JSON.parse(candidate.stdout.trim());
    assert.notEqual(probe.code, 0, "New runtime starts: it now needs full containment qualification before adoption");
    assert.match(probe.stderr, /bwrap:|apply-seccomp:|namespace/i);
    console.log(`Candidate runtime remains incompatible: ${probe.stderr.trim()}`);
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
