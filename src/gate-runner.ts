/**
 * Quality gate command runner — uses the shared process boundary for
 * cancellation, bounded output, timeout, and process-tree cleanup.
 */
import {
  runProcess,
  type ProcessRequest,
  type ProcessResult,
} from "./engine/process-runner.js";

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const DEFAULT_TERMINATION_GRACE_MS = 250;
const WATCH_GRACE_MS = 2_000;
const OUTPUT_TRUNCATION_MARKER = "[output truncated: command output exceeded 10 MiB]";

function gateEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: "true" };
  const home = process.env.HOME || "";
  if (home && env.PATH && !env.PATH.includes(`${home}/.local/bin`)) {
    env.PATH = `${home}/.local/bin:${env.PATH}`;
  }
  return env;
}

export interface GateExecutionOptions {
  runId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
  terminationGraceMs?: number;
  runProcess?: (request: ProcessRequest) => Promise<ProcessResult>;
}

export interface GateResult {
  name: string;
  passed: boolean;
  /** A cancellation is never reported as a passing gate. */
  status: GateStatus;
  output: string;
}

export type GateStatus = "passed" | "failed" | "cancelled";

export type GateCommandFailureReason = ProcessResult["reason"] | "watch_killed";

/** Typed failure returned by runGateCommand for all non-success outcomes. */
export class GateCommandError extends Error {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly reason: GateCommandFailureReason;

  constructor(
    message: string,
    details: { stdout: string; stderr: string; code: number | null; reason: GateCommandFailureReason },
  ) {
    super(message);
    this.name = "GateCommandError";
    this.stdout = details.stdout;
    this.stderr = details.stderr;
    this.code = details.code;
    this.reason = details.reason;
  }
}

function visibleOutput(result: ProcessResult): { stdout: string; stderr: string } {
  if (!result.outputTruncated) return { stdout: result.stdout, stderr: result.stderr };
  return {
    stdout: `${result.stdout}${result.stdout ? "\n" : ""}${OUTPUT_TRUNCATION_MARKER}`,
    stderr: result.stderr,
  };
}

function normalizeCommandOptions(
  timeoutOrOptions: number | GateExecutionOptions | undefined,
  options: GateExecutionOptions | undefined,
): { timeoutMs: number; options: GateExecutionOptions } {
  if (typeof timeoutOrOptions === "number" || timeoutOrOptions === undefined) {
    return { timeoutMs: timeoutOrOptions ?? DEFAULT_TIMEOUT_MS, options: options ?? {} };
  }
  return {
    timeoutMs: timeoutOrOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    options: timeoutOrOptions,
  };
}

/**
 * Run one command. Successful callers retain the established stdout/stderr
 * shape; failures reject with typed output and process termination details.
 */
export async function runGateCommand(
  cmd: string,
  cwd: string,
  timeoutOrOptions: number | GateExecutionOptions = DEFAULT_TIMEOUT_MS,
  options?: GateExecutionOptions,
): Promise<{ stdout: string; stderr: string }> {
  const normalized = normalizeCommandOptions(timeoutOrOptions, options);
  const callerController = new AbortController();
  const callerSignal = normalized.options.signal;
  const relayAbort = () => callerController.abort();
  if (callerSignal) {
    if (callerSignal.aborted) callerController.abort();
    else callerSignal.addEventListener("abort", relayAbort, { once: true });
  }

  let watchModeKilled = false;
  let watchModeTimer: NodeJS.Timeout | undefined;
  let watchTail = "";
  const onOutput = (_stream: "stdout" | "stderr", chunk: Buffer): void => {
    if (watchModeTimer || watchModeKilled) return;
    watchTail = `${watchTail}${chunk.toString("utf8")}`.slice(-4_096);
    if (!/waiting for file changes|press [hq] to/i.test(watchTail)) return;
    watchModeTimer = setTimeout(() => {
      watchModeKilled = true;
      callerController.abort();
    }, WATCH_GRACE_MS);
  };

  const executeProcess = normalized.options.runProcess ?? runProcess;
  let result: ProcessResult;
  try {
    result = await executeProcess({
      runId: normalized.options.runId ?? `gate-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      command: cmd,
      cwd,
      env: gateEnvironment(),
      signal: callerController.signal,
      timeoutMs: normalized.timeoutMs,
      maxOutputBytes: normalized.options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      terminationGraceMs: normalized.options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
      onOutput,
    });
  } finally {
    if (watchModeTimer) clearTimeout(watchModeTimer);
    if (callerSignal) callerSignal.removeEventListener("abort", relayAbort);
  }

  const output = visibleOutput(result);
  if (watchModeKilled) {
    throw new GateCommandError("Watch-mode command was terminated after its grace period", {
      stdout: output.stdout,
      stderr: output.stderr,
      code: result.exitCode,
      reason: "watch_killed",
    });
  }
  if (callerSignal?.aborted) {
    throw new GateCommandError("Command cancelled", {
      stdout: output.stdout, stderr: output.stderr, code: result.exitCode, reason: "cancelled",
    });
  }
  if (result.reason !== "exited") {
    const message = result.reason === "timed_out"
      ? `Command timed out after ${normalized.timeoutMs}ms`
      : result.reason === "cancelled"
        ? "Command cancelled"
        : `Failed to execute command: ${result.stderr || "process could not be spawned"}`;
    throw new GateCommandError(message, {
      stdout: output.stdout,
      stderr: output.stderr,
      code: result.exitCode,
      reason: result.reason,
    });
  }
  if (result.exitCode !== 0) {
    throw new GateCommandError(`Command failed with exit code ${result.exitCode ?? "unknown"}`, {
      stdout: output.stdout,
      stderr: output.stderr,
      code: result.exitCode,
      reason: "exited",
    });
  }
  return output;
}

function failureOutput(command: string, error: GateCommandError): string {
  const combined = [error.stdout, error.stderr].filter(Boolean).join("\n").trim();
  const reason = `[gate failure: ${error.reason}${error.code === null ? "" : `, exit code ${error.code}`}]`;
  return combined
    ? `$ ${command}\n${combined}\n${reason}`
    : `$ ${command}\n${error.message}\n${reason}`;
}

/** Run all commands for one gate, stopping at the first structured failure. */
export async function runGate(
  gate: { name: string; commands: string[] },
  cwd: string,
  options: GateExecutionOptions = {},
): Promise<GateResult> {
  const outputs: string[] = [];
  for (const cmd of gate.commands) {
    if (options.signal?.aborted) {
      outputs.push(`$ ${cmd}\nCommand cancelled`);
      return { name: gate.name, passed: false, status: "cancelled", output: outputs.join("\n\n").trim() };
    }
    try {
      const { stdout, stderr } = await runGateCommand(cmd, cwd, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options);
      const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (combined) outputs.push(`$ ${cmd}\n${combined}`);
    } catch (error: unknown) {
      const typed = error instanceof GateCommandError
        ? error
        : new GateCommandError(error instanceof Error ? error.message : "Gate command failed", {
          stdout: "",
          stderr: "",
          code: null,
          reason: "spawn_failed",
        });
      outputs.push(failureOutput(cmd, typed));
      return {
        name: gate.name,
        passed: false,
        status: typed.reason === "cancelled" ? "cancelled" : "failed",
        output: outputs.join("\n\n").trim(),
      };
    }
  }
  return { name: gate.name, passed: true, status: "passed", output: outputs.join("\n\n").trim() };
}
