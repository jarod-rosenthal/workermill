import { spawn, type ChildProcess } from "node:child_process";

export interface ProcessRequest {
  runId: string;
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal: AbortSignal;
  timeoutMs: number;
  maxOutputBytes: number;
  terminationGraceMs: number;
}

export interface ProcessResult {
  reason: "exited" | "cancelled" | "timed_out" | "spawn_failed";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
}

interface ActiveProcess {
  readonly runId: string;
  readonly child: ChildProcess;
  readonly pid: number;
  readonly request: ProcessRequest;
  readonly resolve: (result: ProcessResult) => void;
  stdout: Buffer[];
  stderr: Buffer[];
  outputBytes: number;
  outputTruncated: boolean;
  exitCode: number | null;
  parentClosed: boolean;
  settled: boolean;
  terminationReason: "cancelled" | "timed_out" | null;
  terminationTimer?: NodeJS.Timeout;
  timeoutTimer?: NodeJS.Timeout;
  pollTimer?: NodeJS.Timeout;
  groupPollDeadline?: number;
  killSent: boolean;
  abortListener: () => void;
}

const activeByRun = new Map<string, Set<ActiveProcess>>();
const LEGACY_RUN_ID = "__legacy_bash_processes__";

function addActive(process: ActiveProcess): void {
  let processes = activeByRun.get(process.runId);
  if (!processes) {
    processes = new Set();
    activeByRun.set(process.runId, processes);
  }
  processes.add(process);
}

function removeActive(process: ActiveProcess): void {
  const processes = activeByRun.get(process.runId);
  processes?.delete(process);
  if (processes && processes.size === 0) activeByRun.delete(process.runId);
}

function groupExists(pid: number): boolean {
  if (process.platform === "win32") return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== "ESRCH";
  }
}

function signalGroup(active: ActiveProcess, signal: NodeJS.Signals): void {
  if (process.platform === "win32") {
    // Windows has no process-group equivalent exposed by Node. Killing the
    // shell is still preferable to leaving a foreground command running.
    if (!active.child.killed) active.child.kill(signal);
    return;
  }
  try {
    process.kill(-active.pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") {
      // A process that has already exited is harmless; other failures are
      // retried with the direct child below so cancellation remains useful.
      try {
        if (!active.child.killed) active.child.kill(signal);
      } catch {
        // The child may have exited between the two attempts.
      }
    }
  }
}

function appendOutput(process: ActiveProcess, stream: "stdout" | "stderr", chunk: Buffer): void {
  const remaining = Math.max(0, process.request.maxOutputBytes - process.outputBytes);
  if (remaining === 0) {
    process.outputTruncated = true;
    return;
  }
  const retained = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
  if (stream === "stdout") process.stdout.push(retained);
  else process.stderr.push(retained);
  process.outputBytes += retained.length;
  if (retained.length !== chunk.length) process.outputTruncated = true;
}

function clearTimers(process: ActiveProcess): void {
  if (process.terminationTimer) clearTimeout(process.terminationTimer);
  if (process.timeoutTimer) clearTimeout(process.timeoutTimer);
  if (process.pollTimer) clearTimeout(process.pollTimer);
  process.terminationTimer = undefined;
  process.timeoutTimer = undefined;
  process.pollTimer = undefined;
}

function finish(process: ActiveProcess): void {
  if (process.settled) return;
  process.settled = true;
  clearTimers(process);
  process.request.signal.removeEventListener("abort", process.abortListener);
  removeActive(process);
  process.resolve({
    reason: process.terminationReason ?? "exited",
    exitCode: process.exitCode,
    stdout: Buffer.concat(process.stdout).toString("utf8"),
    stderr: Buffer.concat(process.stderr).toString("utf8"),
    outputTruncated: process.outputTruncated,
  });
}

function pollForGroupExit(process: ActiveProcess): void {
  if (process.settled) return;
  if (!groupExists(process.pid) || (process.groupPollDeadline !== undefined && Date.now() >= process.groupPollDeadline)) {
    finish(process);
    return;
  }
  process.pollTimer = setTimeout(() => pollForGroupExit(process), 15);
}

function requestTermination(process: ActiveProcess, reason: "cancelled" | "timed_out"): void {
  if (process.settled) return;
  if (!process.terminationReason) process.terminationReason = reason;
  if (process.terminationTimer || process.killSent) return;

  signalGroup(process, "SIGTERM");
  const grace = Math.max(0, process.request.terminationGraceMs);
  process.terminationTimer = setTimeout(() => {
    process.terminationTimer = undefined;
    if (process.settled) return;
    process.killSent = true;
    signalGroup(process, "SIGKILL");
    // Keep checking after the shell's close event. Descendants can outlive
    // their parent and retain the process group even after stdio is closed.
    process.groupPollDeadline = Date.now() + Math.max(1_000, grace * 4);
    pollForGroupExit(process);
  }, grace);
}

function checkAfterClose(process: ActiveProcess): void {
  if (!process.parentClosed || process.settled) return;
  if (groupExists(process.pid)) {
    if (!process.terminationReason) {
      // A shell can exit while a background descendant remains. Contain that
      // descendant before reporting success so no child escapes this run.
      process.terminationReason = "cancelled";
    }
    requestTermination(process, process.terminationReason);
    return;
  }
  finish(process);
}

function spawnFailed(
  request: ProcessRequest,
  resolve: (result: ProcessResult) => void,
  message: string,
): void {
  resolve({
    reason: "spawn_failed",
    exitCode: null,
    stdout: "",
    stderr: message,
    outputTruncated: false,
  });
}

export function runProcess(request: ProcessRequest): Promise<ProcessResult> {
  if (request.signal.aborted) {
    return Promise.resolve({
      reason: "cancelled",
      exitCode: null,
      stdout: "",
      stderr: "",
      outputTruncated: false,
    });
  }

  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn("/bin/bash", ["-c", request.command], {
        cwd: request.cwd,
        env: { ...process.env, ...request.env, GIT_EDITOR: "true" },
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      spawnFailed(request, resolve, error instanceof Error ? error.message : String(error));
      return;
    }

    const pid = child.pid;
    if (!pid) {
      child.once("error", (error) => {
        spawnFailed(request, resolve, error instanceof Error ? error.message : String(error));
      });
      child.once("close", () => {
        // A spawn error normally emits before close. The fallback keeps the
        // promise settled if a platform only reports close for this failure.
        spawnFailed(request, resolve, "Unable to determine spawned process id");
      });
      return;
    }

    const processState = {} as ActiveProcess;
    const abortListener = () => requestTermination(processState, "cancelled");
    Object.assign(processState, {
      runId: request.runId,
      child,
      pid,
      request,
      resolve,
      stdout: [],
      stderr: [],
      outputBytes: 0,
      outputTruncated: false,
      exitCode: null,
      parentClosed: false,
      settled: false,
      terminationReason: null,
      killSent: false,
      abortListener,
    });
    addActive(processState);

    child.stdout?.on("data", (chunk: Buffer) => appendOutput(processState, "stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => appendOutput(processState, "stderr", chunk));
    child.once("error", (error) => {
      if (!processState.parentClosed) {
        processState.parentClosed = true;
        processState.stderr.push(Buffer.from(error.message));
        processState.exitCode = null;
        processState.terminationReason = null;
        finish(processState);
      }
    });
    child.once("exit", (code) => {
      processState.exitCode = typeof code === "number" ? code : null;
    });
    child.once("close", () => {
      processState.parentClosed = true;
      checkAfterClose(processState);
    });

    request.signal.addEventListener("abort", abortListener, { once: true });
    if (request.signal.aborted) requestTermination(processState, "cancelled");
    if (request.timeoutMs >= 0) {
      processState.timeoutTimer = setTimeout(
        () => requestTermination(processState, "timed_out"),
        request.timeoutMs,
      );
    }
  });
}

export function cancelRunProcesses(runId: string): void {
  const processes = activeByRun.get(runId);
  if (!processes) return;
  for (const process of [...processes]) requestTermination(process, "cancelled");
}

export function cancelLegacyProcesses(): void {
  cancelRunProcesses(LEGACY_RUN_ID);
}

export const legacyProcessRunId = LEGACY_RUN_ID;
