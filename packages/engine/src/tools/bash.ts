import { Worker } from "worker_threads";
import {
  SandboxManager,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";

// ---------------------------------------------------------------------------
// OS-level sandboxing via @anthropic-ai/sandbox-runtime
// ---------------------------------------------------------------------------

let sandboxInitialized = false;
let sandboxInitPromise: Promise<void> | undefined;

async function initSandbox(cwd: string): Promise<void> {
  if (sandboxInitialized) return;
  if (sandboxInitPromise) return sandboxInitPromise;

  sandboxInitPromise = (async () => {
    const config: SandboxRuntimeConfig = {
      network: { allowedDomains: [], deniedDomains: [] },
      filesystem: {
        allowWrite: [cwd],
        denyWrite: [],
        denyRead: [],
      },
    };
    await SandboxManager.initialize(config);
    sandboxInitialized = true;
  })();

  return sandboxInitPromise;
}

// ---------------------------------------------------------------------------
// Worker-thread bash executor with Atomics.wait (synchronous)
// ---------------------------------------------------------------------------
// Ink Legacy mode's flushSyncWork() blocks the event loop for every setState.
// worker.on('message') is a macro task that gets delayed by 30+ seconds
// behind queued renders.
//
// Fix: use SharedArrayBuffer + Atomics.wait (SYNCHRONOUS wait on main thread).
// The worker runs spawnSync, writes result to shared memory, and notifies.
// The main thread blocks on Atomics.wait for ~2ms (the actual command time)
// which is imperceptible.  Zero event loop dependency.
// ---------------------------------------------------------------------------

const SAB_SIZE = 4 * 1024 * 1024; // 4 MB for large command outputs
const HEADER_INTS = 7;
const HEADER_BYTES = HEADER_INTS * 4;

const WORKER_SCRIPT = `
const { parentPort, workerData } = require('worker_threads');
const { spawnSync } = require('child_process');
const sab = workerData.sab;
const signal = new Int32Array(sab, 0, 7);

parentPort.on('message', (msg) => {
  const { command, cwd, timeout } = msg;
  process.stderr.write('[bash-worker] received: ' + command.slice(0, 40) + '\\n');

  const result = spawnSync('/bin/bash', ['-c', command], {
    cwd,
    env: { ...process.env, GIT_EDITOR: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  });

  const killed = !!(result.signal === 'SIGTERM' || (result.error && result.error.code === 'ETIMEDOUT'));
  let stdout = (result.stdout || '').toString().trim();
  let stderr = (result.stderr || '').toString().trim();
  const errorMsg = result.error && !killed ? result.error.message : '';

  const enc = new TextEncoder();
  const maxPayload = sab.byteLength - ${HEADER_BYTES};
  let stdoutBytes = enc.encode(stdout);
  let stderrBytes = enc.encode(stderr);
  let errorBytes = enc.encode(errorMsg);

  // Truncate to fit in SAB
  if (stdoutBytes.length + stderrBytes.length + errorBytes.length > maxPayload) {
    const errBudget = Math.min(errorBytes.length, 1024);
    const stderrBudget = Math.min(stderrBytes.length, Math.floor((maxPayload - errBudget) * 0.3));
    const stdoutBudget = maxPayload - errBudget - stderrBudget;
    if (stdoutBytes.length > stdoutBudget) stdoutBytes = stdoutBytes.slice(0, stdoutBudget);
    if (stderrBytes.length > stderrBudget) stderrBytes = stderrBytes.slice(0, stderrBudget);
    if (errorBytes.length > errBudget) errorBytes = errorBytes.slice(0, errBudget);
  }

  // Write data
  const data = new Uint8Array(sab, ${HEADER_BYTES});
  data.set(stdoutBytes, 0);
  data.set(stderrBytes, stdoutBytes.length);
  data.set(errorBytes, stdoutBytes.length + stderrBytes.length);

  // Write header
  Atomics.store(signal, 1, result.status ?? -1);
  Atomics.store(signal, 2, killed ? 1 : 0);
  Atomics.store(signal, 3, errorMsg ? 1 : 0);
  Atomics.store(signal, 4, stdoutBytes.length);
  Atomics.store(signal, 5, stderrBytes.length);
  Atomics.store(signal, 6, errorBytes.length);

  // Signal done — wakes Atomics.wait on main thread
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
});
`;

let worker: Worker | null = null;
let sab: SharedArrayBuffer | null = null;
let signal: Int32Array | null = null;

function ensureWorker(): { worker: Worker; sab: SharedArrayBuffer; signal: Int32Array } {
  if (!worker || !sab || !signal) {
    sab = new SharedArrayBuffer(SAB_SIZE);
    signal = new Int32Array(sab, 0, HEADER_INTS);
    worker = new Worker(WORKER_SCRIPT, { eval: true, workerData: { sab } });
    worker.unref();
    worker.on("error", () => { worker = null; sab = null; signal = null; });
  }
  return { worker, sab, signal };
}

// Pre-warm the worker at module load time so it's ready before the first
// Atomics.wait call.  Without this, the worker is created lazily on the
// first tool call and Atomics.wait blocks before the worker can initialize
// its message handler — causing a 30-second deadlock until timeout.
ensureWorker();

function runCommand(
  command: string,
  cwd: string,
  timeout: number,
): { exitCode: number; stdout: string; stderr: string; killed: boolean; error?: string } {
  const { worker: w, sab: buf, signal: sig } = ensureWorker();

  // Reset signal
  Atomics.store(sig, 0, 0);

  // Send command to worker
  w.postMessage({ command, cwd, timeout });

  // SYNCHRONOUS wait
  const _wt0 = Date.now();
  const _wr = Atomics.wait(sig, 0, 0, timeout + 5000);
  const _wt1 = Date.now();
  process.stderr.write(`[bash] wait=${_wt1-_wt0}ms result="${_wr}" sig=${Atomics.load(sig,0)} cmd="${command.slice(0,40)}"\n`);

  if (Atomics.load(sig, 0) !== 1) {
    return { exitCode: -1, stdout: "", stderr: "", killed: true, error: `Command timed out after ${timeout}ms` };
  }

  // Read result from shared memory
  const exitCode = Atomics.load(sig, 1);
  const killed = Atomics.load(sig, 2) === 1;
  const hasError = Atomics.load(sig, 3) === 1;
  const stdoutLen = Atomics.load(sig, 4);
  const stderrLen = Atomics.load(sig, 5);
  const errorLen = Atomics.load(sig, 6);

  const dec = new TextDecoder();
  const data = new Uint8Array(buf, HEADER_BYTES);
  const stdout = dec.decode(data.slice(0, stdoutLen));
  const stderr = dec.decode(data.slice(stdoutLen, stdoutLen + stderrLen));
  const error = hasError ? dec.decode(data.slice(stdoutLen + stderrLen, stdoutLen + stderrLen + errorLen)) : undefined;

  return { exitCode, stdout, stderr, killed, error };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function killActiveProcess(): void {
  // spawnSync in worker — command already finished by the time we could kill
}

export const name = "bash";

export const description =
  "Execute a bash command and return the output. Use for running shell commands, git operations, npm commands, etc.";

export const parameters = {
  type: "object" as const,
  properties: {
    command: {
      type: "string" as const,
      description: "The bash command to execute",
    },
    cwd: {
      type: "string" as const,
      description: "Working directory for the command (optional)",
    },
    timeout: {
      type: "number" as const,
      description: "Timeout in milliseconds (default: 120000 = 2 minutes)",
    },
  },
  required: ["command"] as const,
};

interface BashParams {
  command: string;
  cwd?: string;
  timeout?: number;
  osSandbox?: boolean;
}

interface BashResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  duration: number;
}

const LONG_RUNNING_PATTERNS = [
  /\bnpm\s+(?:run\s+)?(?:dev|start|serve)\b/,
  /\bnpx\s+(?:next|vite|webpack-dev-server|react-scripts\s+start)\b/,
  /\bnodemon\b/,
  /\btsc\s+--watch\b/,
  /\bwebpack\s+serve\b/,
  /\byarn\s+(?:dev|start|serve)\b/,
  /\bpnpm\s+(?:dev|start|serve)\b/,
  /\bpython\s+-m\s+(?:http\.server|flask\s+run|uvicorn|gunicorn)\b/,
  /\brails\s+server\b/,
  /\bphp\s+-S\b/,
  /\bdocker\s+compose\s+up(?!\s[^&|;\n]*(?:-d\b|--detach\b))/,
];

function isLongRunning(command: string): string | null {
  for (const pattern of LONG_RUNNING_PATTERNS) {
    if (pattern.test(command)) {
      const match = command.match(pattern);
      return match ? match[0] : "long-running process";
    }
  }
  return null;
}

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/(?!app\b|home\b)/, reason: "rm with absolute root path" },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+-[a-zA-Z]*f[a-zA-Z]*\s+\/\s*$/, reason: "rm -rf /" },
  { pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*\s+-[a-zA-Z]*r[a-zA-Z]*\s+\/\s*$/, reason: "rm -fr /" },
  { pattern: /\bmkfs\b/, reason: "mkfs (format filesystem)" },
  { pattern: /\bdd\s+.*of=\/dev\//, reason: "dd to device" },
  { pattern: /\bshutdown\b/, reason: "shutdown" },
  { pattern: /\breboot\b/, reason: "reboot" },
  { pattern: /\bchmod\s+(-R\s+)?777\s+\//, reason: "chmod 777 on root paths" },
  { pattern: /\bgit\s+push\s+.*--force\b/, reason: "git push --force" },
  { pattern: /\bgit\s+push\s+.*-f\b/, reason: "git push -f" },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: "git reset --hard" },
  { pattern: /\bgit\s+clean\s+.*-f/, reason: "git clean -f" },
  { pattern: /\bcurl\s+.*\|\s*(?:sudo\s+)?(?:bash|sh)\b/, reason: "curl pipe to shell" },
  { pattern: /\bwget\s+.*\|\s*(?:sudo\s+)?(?:bash|sh)\b/, reason: "wget pipe to shell" },
  { pattern: /\bsudo\b/, reason: "sudo" },
];

function isDangerous(command: string): string | null {
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return reason;
  }
  return null;
}

const OUTSIDE_PATHS = ["/tmp", "/var", "/etc", "/opt", "/usr", "/sys", "/proc", "/dev", "/boot", "/root"];

function referencesOutsidePath(command: string, cwd?: string): string | null {
  if (/^\s*(?:cat|head|tail|less|more|wc|file|stat|which|type|echo)\s/.test(command)) return null;
  for (const p of OUTSIDE_PATHS) {
    if (cwd && cwd.startsWith(p + "/")) continue;
    const regex = new RegExp(`(?:^|\\s|>|"|')${p.replace("/", "\\/")}(?:\\/|\\s|"|'|$)`);
    if (regex.test(command)) return p;
  }
  return null;
}

export async function execute({
  command,
  cwd,
  timeout = 120000,
  osSandbox = false,
}: BashParams): Promise<BashResult> {
  const longRunning = isLongRunning(command);
  if (longRunning) {
    return {
      success: false, exitCode: -1, stdout: "", stderr: "",
      error: `Blocked: "${longRunning}" is a long-running process that would block execution. Use a one-shot command instead (e.g., "npx tsc --noEmit" to check compilation, "npm test" to run tests).`,
      duration: 0,
    };
  }

  const dangerous = isDangerous(command);
  if (dangerous) {
    return {
      success: false, exitCode: -1, stdout: "", stderr: "",
      error: `Blocked: "${dangerous}" is not allowed. This command could damage the system or repository.`,
      duration: 0,
    };
  }

  const outsidePath = referencesOutsidePath(command, cwd);
  if (outsidePath) {
    return {
      success: false, exitCode: -1, stdout: "", stderr: "",
      error: `Blocked: command references "${outsidePath}" which is outside the working directory. All files must be created within the project directory.`,
      duration: 0,
    };
  }

  const effectiveCwd = cwd || process.cwd();
  const useSandbox = osSandbox && SandboxManager.isSupportedPlatform();

  let shellCommand = command;
  if (useSandbox) {
    await initSandbox(effectiveCwd);
    shellCommand = await SandboxManager.wrapWithSandbox(command);
  }

  const startTime = Date.now();
  const result = runCommand(shellCommand, effectiveCwd, timeout);
  if (useSandbox) SandboxManager.cleanupAfterCommand();
  const duration = Date.now() - startTime;

  if (result.error) {
    return {
      success: false, exitCode: result.exitCode ?? -1,
      stdout: result.stdout, stderr: result.stderr,
      error: result.killed ? `Command timed out after ${timeout}ms` : `Failed to execute command: ${result.error}`,
      duration,
    };
  }

  if (result.killed) {
    return {
      success: false, exitCode: result.exitCode,
      stdout: result.stdout, stderr: result.stderr,
      error: `Command timed out after ${timeout}ms`,
      duration,
    };
  }

  if (result.exitCode === 0) {
    return { success: true, exitCode: 0, stdout: result.stdout, stderr: result.stderr, duration };
  }

  const finalStderr = useSandbox
    ? SandboxManager.annotateStderrWithSandboxFailures(command, result.stderr)
    : result.stderr;
  return {
    success: false, exitCode: result.exitCode, stdout: result.stdout, stderr: finalStderr,
    error: `Command exited with code ${result.exitCode}`,
    duration,
  };
}
