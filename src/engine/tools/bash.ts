import {
  cancelLegacyProcesses,
  legacyProcessRunId,
  runProcess as runRawProcess,
  type ProcessRequest,
  type ProcessResult,
} from "../process-runner.js";
import { createPathScope, type PathScope } from "../path-policy.js";
import { runScopedProcess, type ScopedProcessOptions } from "../scoped-process.js";
import type { SandboxCapabilities } from "../../config.js";

/** A command runner already bound to a process boundary. */
export type CommandRunner = (request: ProcessRequest) => Promise<ProcessResult>;

/** Bind one immutable scope/capability snapshot for tools and future gate adapters. */
export function createScopedCommandRunner(options: ScopedProcessOptions): CommandRunner {
  return (request) => runScopedProcess(request, options);
}

export function killActiveProcess(): void {
  // Compatibility for unscoped callers only; scoped calls have separate run IDs.
  cancelLegacyProcesses();
}

export const name = "bash";
export const description = "Execute a bash command and return the output. Use for running shell commands, git operations, npm commands, etc.";
export const parameters = {
  type: "object" as const,
  properties: {
    command: { type: "string" as const, description: "The bash command to execute" },
    cwd: { type: "string" as const, description: "Working directory for the command (optional)" },
    timeout: { type: "number" as const, description: "Timeout in milliseconds (default: 120000 = 2 minutes)" },
  },
  required: ["command"] as const,
};

export interface BashParams {
  command: string;
  cwd?: string;
  timeout?: number;
  /** Explicit OS isolation; unavailable isolation is a command failure. */
  osSandbox?: boolean;
  /** Compatibility root for direct callers which do not already carry a scope. */
  sandboxRoot?: string;
  scope?: PathScope;
  sandboxCapabilities?: SandboxCapabilities;
  signal?: AbortSignal;
  runId?: string;
  /** Process runner injection for path-mode adapters and deterministic tests. */
  runProcess?: CommandRunner;
}

interface BashResult { success: boolean; exitCode: number | null; stdout: string; stderr: string; error?: string; duration: number; }

const LONG_RUNNING_PATTERNS = [
  /\bnpm\s+(?:run\s+)?(?:dev|start|serve)\b/, /\bnpx\s+(?:next|vite|webpack-dev-server|react-scripts\s+start)\b/,
  /\bnodemon\b/, /\btsc\s+--watch\b/, /\bwebpack\s+serve\b/, /\byarn\s+(?:dev|start|serve)\b/,
  /\bpnpm\s+(?:dev|start|serve)\b/, /\bpython\s+-m\s+(?:http\.server|flask\s+run|uvicorn|gunicorn)\b/,
  /\brails\s+server\b/, /\bphp\s+-S\b/, /\bdocker\s+compose\s+up(?!\s[^&|;\n]*(?:-d\b|--detach\b))/,
];
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/(?!app\b|home\b)/, reason: "rm with absolute root path" },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+-[a-zA-Z]*f[a-zA-Z]*\s+\/\s*$/, reason: "rm -rf /" },
  { pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*\s+-[a-zA-Z]*r[a-zA-Z]*\s+\/\s*$/, reason: "rm -fr /" },
  { pattern: /\bmkfs\b/, reason: "mkfs (format filesystem)" }, { pattern: /\bdd\s+.*of=\/dev\//, reason: "dd to device" },
  { pattern: /\bshutdown\b/, reason: "shutdown" }, { pattern: /\breboot\b/, reason: "reboot" },
  { pattern: /\bchmod\s+(-R\s+)?777\s+\//, reason: "chmod 777 on root paths" },
  { pattern: /\bgit\s+push\s+.*--force\b/, reason: "git push --force" }, { pattern: /\bgit\s+push\s+.*-f\b/, reason: "git push -f" },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: "git reset --hard" }, { pattern: /\bgit\s+clean\s+.*-f/, reason: "git clean -f" },
  { pattern: /\bcurl\s+.*\|\s*(?:sudo\s+)?(?:bash|sh)\b/, reason: "curl pipe to shell" },
  { pattern: /\bwget\s+.*\|\s*(?:sudo\s+)?(?:bash|sh)\b/, reason: "wget pipe to shell" }, { pattern: /\bsudo\b/, reason: "sudo" },
];
const OUTSIDE_PATHS = ["/tmp", "/var", "/etc", "/opt", "/usr", "/sys", "/proc", "/dev", "/boot", "/root"];
const BASH_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const OUTPUT_TRUNCATION_MARKER = "[output truncated: command output exceeded 10 MiB]";

function isLongRunning(command: string): string | null {
  for (const pattern of LONG_RUNNING_PATTERNS) if (pattern.test(command)) return command.match(pattern)?.[0] ?? "long-running process";
  return null;
}
function isDangerous(command: string): string | null {
  for (const { pattern, reason } of DANGEROUS_PATTERNS) if (pattern.test(command)) return reason;
  return null;
}
function referencesOutsidePath(command: string, cwd?: string): string | null {
  if (/^\s*(?:cat|head|tail|less|more|wc|file|stat|which|type|echo)\s/.test(command)) return null;
  for (const entry of OUTSIDE_PATHS) {
    if (cwd?.startsWith(`${entry}/`)) continue;
    if (new RegExp(`(?:^|\\s|>|"|')${entry.replace("/", "\\/")}(?:\\/|\\s|"|'|$)`).test(command)) return entry;
  }
  return null;
}

/** Docker commands are classified but never bypass explicit OS isolation. */
export function commandUsesDocker(command: string): boolean {
  return command.split(/&&|\|\||;|\n/).some((segment) => /^(?:[A-Z_][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*(?:docker|docker-compose)\b/i.test(segment.trim()));
}

export async function execute({ command, cwd, timeout = 120_000, osSandbox = false, sandboxRoot, scope, sandboxCapabilities, signal, runId, runProcess }: BashParams): Promise<BashResult> {
  const blocked = isLongRunning(command) ?? isDangerous(command) ?? referencesOutsidePath(command, cwd);
  if (blocked) {
    const isPath = OUTSIDE_PATHS.includes(blocked);
    return { success: false, exitCode: -1, stdout: "", stderr: "", error: isPath
      ? `Blocked: command references "${blocked}" which is outside the working directory. All files must be created within the project directory.`
      : `Blocked: "${blocked}" is not allowed. This command could damage the system or repository.`, duration: 0 };
  }
  const effectiveCwd = cwd || process.cwd();
  const effectiveScope = scope ?? createPathScope(sandboxRoot ?? effectiveCwd);
  // Explicit OS mode never accepts an injected raw process runner: doing so
  // would turn a test seam into a fail-open path. The factory below is bound
  // to the supplied immutable scope and capabilities before launch.
  const runner = osSandbox
    ? createScopedCommandRunner({ sandbox: "os", scope: effectiveScope, capabilities: sandboxCapabilities })
    : runProcess ?? runRawProcess;
  const startTime = Date.now();
  let result: ProcessResult;
  try {
    result = await runner({ runId: runId ?? legacyProcessRunId, command, cwd: effectiveCwd,
      signal: signal ?? new AbortController().signal, timeoutMs: timeout, maxOutputBytes: BASH_MAX_OUTPUT_BYTES, terminationGraceMs: 250 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, exitCode: null, stdout: "", stderr: message, error: `Failed to execute command: ${message}`, duration: Date.now() - startTime };
  }
  const duration = Date.now() - startTime;
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  const visibleStdout = result.outputTruncated ? `${stdout}${stdout ? "\n" : ""}${OUTPUT_TRUNCATION_MARKER}` : stdout;
  if (result.reason === "spawn_failed") return { success: false, exitCode: null, stdout: visibleStdout, stderr, error: `Failed to execute command: ${stderr}`, duration };
  if (result.reason === "timed_out") return { success: false, exitCode: result.exitCode, stdout: visibleStdout, stderr, error: `Command timed out after ${timeout}ms`, duration };
  if (result.reason === "cancelled") return { success: false, exitCode: result.exitCode, stdout: visibleStdout, stderr, error: "Command cancelled", duration };
  if (result.exitCode === 0) return { success: true, exitCode: 0, stdout: visibleStdout, stderr, duration };
  return { success: false, exitCode: result.exitCode, stdout: visibleStdout, stderr, error: result.exitCode === null ? "Command terminated by signal" : `Command exited with code ${result.exitCode}`, duration };
}
