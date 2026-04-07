import { spawn, ChildProcess } from "child_process";
import crypto from "crypto";
import path from "path";

interface ShellProcess {
  child: ChildProcess;
  buffer: string[];
  startTime: number;
  done: boolean;
  exitCode?: number;
  status: 'running' | 'done' | 'killed' | 'failed_to_start';
}

export const activeShells = new Map<string, ShellProcess>();
const MAX_CONCURRENT_SHELLS = 3;
const BUFFER_MAX_BYTES = 100 * 1024; // 100KB
const BUFFER_DROP_RATIO = 0.2; // drop oldest 20%

function generateShellId(): string {
  return `wm_shell_${crypto.randomBytes(8).toString('hex')}`;
}

function isDangerous(command: string): string | null {
  const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/(?!app\b|home\b)/, reason: "rm with absolute root path" },
    { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\/\s*$/, reason: "rm -rf /" },
    { pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\s+\/\s*$/, reason: "rm -fr /" },
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

function addToBuffer(buffer: string[], line: string): void {
  const timestamped = `${new Date().toISOString()}: ${line}`;
  buffer.push(timestamped);
  const totalBytes = buffer.reduce((sum, l) => sum + Buffer.byteLength(l, 'utf8'), 0);
  if (totalBytes > BUFFER_MAX_BYTES) {
    const dropCount = Math.floor(buffer.length * BUFFER_DROP_RATIO);
    buffer.splice(0, dropCount);
  }
}

function cleanupShell(shellId: string): void {
  const shell = activeShells.get(shellId);
  if (shell) {
    if (!shell.done) {
      shell.child.kill('SIGTERM');
      shell.status = 'killed';
      shell.done = true;
    }
    activeShells.delete(shellId);
  }
}

export function cleanupAllBackgroundProcesses(): void {
  for (const shellId of activeShells.keys()) {
    cleanupShell(shellId);
  }
}

process.on('exit', cleanupAllBackgroundProcesses);

export const name = "bash_background";

export const description =
  "Execute a bash command in the background and return immediately. Use for long-running processes like dev servers, watchers, or daemons.";

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
    env: {
      type: "object" as const,
      additionalProperties: { type: "string" },
      description: "Environment variables to set (optional)",
    },
  },
  required: ["command"] as const,
};

interface BashBackgroundParams {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}

interface BashBackgroundResult {
  shellId: string;
  pid: number;
}

export async function execute({
  command,
  cwd,
  env,
}: BashBackgroundParams): Promise<BashBackgroundResult> {
  const dangerous = isDangerous(command);
  if (dangerous) {
    throw new Error(`Blocked: "${dangerous}" is not allowed. This command could damage the system or repository.`);
  }

  const outsidePath = referencesOutsidePath(command, cwd);
  if (outsidePath) {
    throw new Error(`Blocked: command references "${outsidePath}" which is outside the working directory. All files must be created within the project directory.`);
  }

  if (activeShells.size >= MAX_CONCURRENT_SHELLS) {
    throw new Error(`Maximum concurrent background shells (${MAX_CONCURRENT_SHELLS}) reached. Wait for some to finish or kill them.`);
  }

  const shellId = generateShellId();
  const effectiveCwd = cwd || process.cwd();
  const effectiveEnv = { ...process.env, ...env };

  const child = spawn('/bin/bash', ['-c', command], {
    cwd: effectiveCwd,
    env: effectiveEnv,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const shellProcess: ShellProcess = {
    child,
    buffer: [],
    startTime: Date.now(),
    done: false,
    status: 'running',
  };

  activeShells.set(shellId, shellProcess);

  child.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString('utf8').split('\n');
    for (const line of lines) {
      if (line.trim()) addToBuffer(shellProcess.buffer, `stdout: ${line}`);
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString('utf8').split('\n');
    for (const line of lines) {
      if (line.trim()) addToBuffer(shellProcess.buffer, `stderr: ${line}`);
    }
  });

  child.on('exit', (code) => {
    shellProcess.done = true;
    shellProcess.exitCode = code ?? undefined;
    shellProcess.status = 'done';
    addToBuffer(shellProcess.buffer, `exit: code ${code}`);
  });

  child.on('error', (err) => {
    shellProcess.done = true;
    shellProcess.status = 'failed_to_start';
    addToBuffer(shellProcess.buffer, `error: ${err.message}`);
  });

  return { shellId, pid: child.pid! };
}