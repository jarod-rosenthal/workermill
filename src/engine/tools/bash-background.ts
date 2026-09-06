import crypto from "node:crypto";
import {
  cancelRunProcesses,
  killRunProcessGroupsSynchronously,
  runProcess as runRawProcess,
  type ProcessRequest,
  type ProcessResult,
} from "../process-runner.js";
import type { CommandRunner } from "./bash.js";

export type BackgroundStatus = "running" | "done" | "killed" | "failed_to_start";
export interface ShellProcess {
  readonly runId: string;
  readonly controller: AbortController;
  readonly completion: Promise<void>;
  pid: number;
  buffer: string[];
  bufferBytes: number;
  startTime: number;
  completionTime?: number;
  done: boolean;
  exitCode?: number;
  status: BackgroundStatus;
}

export const activeShells = new Map<string, ShellProcess>();
const MAX_CONCURRENT_SHELLS = 3;
const BUFFER_MAX_BYTES = 100 * 1024;
const FINISHED_TTL_MS = 10 * 60 * 1000;
const MAX_FINISHED_SHELLS = 100;
/** Finite deadline prevents a background command holding run resources forever. */
export const DEFAULT_BACKGROUND_TIMEOUT_MS = 15 * 60 * 1000;

function generateShellId(): string { return `wm_shell_${crypto.randomBytes(8).toString("hex")}`; }
function isDangerous(command: string): string | null {
  const patterns: Array<[RegExp, string]> = [[/\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/(?!app\b|home\b)/, "rm with absolute root path"], [/\bmkfs\b/, "mkfs (format filesystem)"], [/\bsudo\b/, "sudo"]];
  return patterns.find(([pattern]) => pattern.test(command))?.[1] ?? null;
}
const OUTSIDE_PATHS = ["/tmp", "/var", "/etc", "/opt", "/usr", "/sys", "/proc", "/dev", "/boot", "/root", "/home", "/mnt"];
function referencesOutsidePath(command: string, workspaceRoot: string, cwd?: string): string | null {
  for (const entry of OUTSIDE_PATHS) {
    if ((cwd && cwd.startsWith(`${entry}/`)) || workspaceRoot === entry || workspaceRoot.startsWith(`${entry}/`)) continue;
    if (new RegExp(`(?:^|\\s|>|"|')${entry.replace("/", "\\/")}(?:\\/|\\s|"|'|$)`).test(command)) return entry;
  }
  return null;
}
function append(shell: ShellProcess, value: string): void {
  const line = `${new Date().toISOString()}: ${value}`;
  shell.buffer.push(line);
  shell.bufferBytes += Buffer.byteLength(line, "utf8");
  while (shell.bufferBytes > BUFFER_MAX_BYTES && shell.buffer.length > 1) {
    shell.bufferBytes -= Buffer.byteLength(shell.buffer.shift()!, "utf8");
  }
  if (shell.bufferBytes > BUFFER_MAX_BYTES) {
    const retained = Buffer.from(shell.buffer[0], "utf8").subarray(-BUFFER_MAX_BYTES).toString("utf8");
    shell.buffer[0] = retained;
    shell.bufferBytes = Buffer.byteLength(retained, "utf8");
  }
}
function prune(): void {
  const now = Date.now();
  const finished = [...activeShells.entries()].filter(([, shell]) => shell.done);
  for (const [id, shell] of finished) if (shell.completionTime && now - shell.completionTime > FINISHED_TTL_MS) activeShells.delete(id);
  const remaining = [...activeShells.entries()].filter(([, shell]) => shell.done).sort((a, b) => (a[1].completionTime ?? 0) - (b[1].completionTime ?? 0));
  while (remaining.length > MAX_FINISHED_SHELLS) activeShells.delete(remaining.shift()![0]);
}
function finish(shell: ShellProcess, result: ProcessResult): void {
  shell.done = true;
  shell.exitCode = result.exitCode ?? undefined;
  shell.completionTime = Date.now();
  shell.status = result.reason === "spawn_failed" ? "failed_to_start" : result.reason === "cancelled" || result.reason === "timed_out" ? "killed" : "done";
  if (result.reason !== "exited") append(shell, `error: ${result.stderr || result.reason}`);
  append(shell, `exit: code ${result.exitCode}`);
  prune();
}

export const name = "bash_background";
export const description = "Execute a bash command in the background and return immediately. Output is bounded to 100 KiB and commands have a 15-minute deadline.";
export const parameters = { type: "object" as const, properties: { command: { type: "string" as const, description: "The bash command to execute" }, cwd: { type: "string" as const, description: "Working directory for the command (optional)" }, env: { type: "object" as const, additionalProperties: { type: "string" }, description: "Environment variables to set (optional)" } }, required: ["command"] as const };

export interface BashBackgroundParams {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  workspaceRoot?: string;
  enforceWorkspacePaths?: boolean;
  runId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  runProcess?: CommandRunner;
}
export interface BashBackgroundResult { shellId: string; pid: number; }

export async function execute({ command, cwd, env, workspaceRoot = process.cwd(), enforceWorkspacePaths = true, runId, signal, timeoutMs = DEFAULT_BACKGROUND_TIMEOUT_MS, runProcess = runRawProcess }: BashBackgroundParams): Promise<BashBackgroundResult> {
  const dangerous = isDangerous(command);
  if (dangerous) throw new Error(`Blocked: "${dangerous}" is not allowed. This command could damage the system or repository.`);
  const outsidePath = enforceWorkspacePaths ? referencesOutsidePath(command, workspaceRoot, cwd) : null;
  if (outsidePath) throw new Error(`Blocked: command references "${outsidePath}" which is outside the working directory. All files must be created within the project directory.`);
  prune();
  if ([...activeShells.values()].filter((shell) => !shell.done).length >= MAX_CONCURRENT_SHELLS) throw new Error(`Maximum concurrent background shells (${MAX_CONCURRENT_SHELLS}) reached. Wait for some to finish or kill them.`);

  const shellId = generateShellId();
  const ownerRunId = runId ?? `background-${shellId}`;
  const controller = new AbortController();
  const abortParent = () => controller.abort();
  signal?.addEventListener("abort", abortParent, { once: true });
  let shell!: ShellProcess;
  let start!: () => void;
  const completion = new Promise<void>((resolve) => {
    start = () => { void (async () => {
      try {
        const result = await runProcess({ runId: ownerRunId, command, cwd: cwd || process.cwd(), env,
          signal: controller.signal, timeoutMs, maxOutputBytes: BUFFER_MAX_BYTES, terminationGraceMs: 250,
          onSpawn: (pid) => { shell.pid = pid; },
          onOutput: (stream, chunk) => append(shell, `${stream}: ${chunk.toString("utf8")}`),
        });
        finish(shell, result);
      } finally {
        signal?.removeEventListener("abort", abortParent);
        resolve();
      }
    })(); };
  });
  shell = { runId: ownerRunId, controller, completion, pid: 0, buffer: [], bufferBytes: 0, startTime: Date.now(), done: false, status: "running" };
  activeShells.set(shellId, shell);
  start();
  return { shellId, pid: shell.pid };
}

/** Abort and await only commands owned by this run. */
export async function cleanupScopedBackgroundProcesses(runId: string): Promise<void> {
  const owned = [...activeShells.values()].filter((shell) => shell.runId === runId && !shell.done);
  for (const shell of owned) shell.controller.abort();
  cancelRunProcesses(runId);
  await Promise.allSettled(owned.map((shell) => shell.completion));
}
export const cleanupRunBackgroundProcesses = cleanupScopedBackgroundProcesses;

/** Legacy CLI-exit cleanup. Normal run cancellation must call the scoped API. */
export function cleanupAllBackgroundProcesses(): void {
  for (const shell of activeShells.values()) if (!shell.done) shell.controller.abort();
  killRunProcessGroupsSynchronously();
}

process.on("exit", cleanupAllBackgroundProcesses);
