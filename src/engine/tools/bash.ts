import {
  SandboxManager,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";
import path from "path";
import {
  cancelLegacyProcesses,
  legacyProcessRunId,
  runProcess,
} from "../process-runner.js";

// ---------------------------------------------------------------------------
// OS-level sandboxing via @anthropic-ai/sandbox-runtime
// ---------------------------------------------------------------------------

let sandboxInitialized = false;
let sandboxInitPromise: Promise<void> | undefined;
let sandboxUnavailableReason: string | null = null;
let sandboxWarningAppended = false;
let sandboxRootPath: string | null = null;

async function initSandbox(cwd: string): Promise<void> {
  if (sandboxUnavailableReason) {
    throw new Error(sandboxUnavailableReason);
  }
  const normalizedRoot = path.resolve(cwd);
  if (sandboxInitialized && sandboxRootPath === normalizedRoot) return;
  if (sandboxInitialized && sandboxRootPath && sandboxRootPath !== normalizedRoot) {
    await SandboxManager.reset();
    sandboxInitialized = false;
    sandboxInitPromise = undefined;
    sandboxWarningAppended = false;
  }
  if (sandboxInitPromise) return sandboxInitPromise;

  sandboxInitPromise = (async () => {
    const deps = SandboxManager.checkDependencies();
    if (deps.errors.length > 0) {
      sandboxUnavailableReason = deps.errors.join(", ");
      sandboxInitPromise = undefined;
      throw new Error(`Sandbox dependencies not available: ${sandboxUnavailableReason}`);
    }
    // Allow writes to project root + package manager caches so installs work
    const home = process.env.HOME || "/home/" + (process.env.USER || "user");
    const cacheAllowList = [
      path.join(home, ".cache/uv"),       // uv (Python)
      path.join(home, ".cache/pip"),       // pip
      path.join(home, ".npm"),             // npm
      path.join(home, ".local"),           // pip --user, pipx
      "/tmp",                              // build artifacts, temp files
    ];
    const config: SandboxRuntimeConfig = {
      network: {
        allowedDomains: [
          // Package registries — workers need to install dependencies
          "pypi.org", "files.pythonhosted.org",       // pip / uv
          "registry.npmjs.org",                        // npm
          "registry.yarnpkg.com",                      // yarn
          // Common dev APIs
          "github.com", "api.github.com", "raw.githubusercontent.com",
          "objects.githubusercontent.com",
        ],
        deniedDomains: [],
        // Docker socket access — workers run docker compose for services
        allowUnixSockets: ["/var/run/docker.sock"],
        // Workers need localhost for DB connections, dev servers, etc.
        allowLocalBinding: true,
      },
      filesystem: {
        allowWrite: [normalizedRoot, ...cacheAllowList],
        denyWrite: [],
        denyRead: [],
      },
    };
    try {
      await SandboxManager.initialize(config);
      sandboxInitialized = true;
      sandboxRootPath = normalizedRoot;
    } catch (err) {
      sandboxUnavailableReason = err instanceof Error ? err.message : String(err);
      sandboxInitPromise = undefined;
      throw err;
    }
  })();

  return sandboxInitPromise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function killActiveProcess(): void {
  // Compatibility for callers that predate run-scoped cancellation. Scoped
  // calls use their own runId and are deliberately not affected.
  cancelLegacyProcesses();
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

export interface BashParams {
  command: string;
  cwd?: string;
  timeout?: number;
  osSandbox?: boolean;
  sandboxRoot?: string;
  signal?: AbortSignal;
  runId?: string;
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
const BASH_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const OUTPUT_TRUNCATION_MARKER = "[output truncated: command output exceeded 10 MiB]";

function referencesOutsidePath(command: string, cwd?: string): string | null {
  if (/^\s*(?:cat|head|tail|less|more|wc|file|stat|which|type|echo)\s/.test(command)) return null;
  // Docker/compose commands legitimately reference /var/run/docker.sock, /tmp, etc.
  if (commandUsesDocker(command)) return null;
  for (const p of OUTSIDE_PATHS) {
    if (cwd && cwd.startsWith(p + "/")) continue;
    const regex = new RegExp(`(?:^|\\s|>|"|')${p.replace("/", "\\/")}(?:\\/|\\s|"|'|$)`);
    if (regex.test(command)) return p;
  }
  return null;
}

export function commandUsesDocker(command: string): boolean {
  const segments = command.split(/&&|\|\||;|\n/);
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const stripped = trimmed.replace(/^(?:[A-Z_][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*/g, "");
    if (/^(?:docker|docker-compose)\b/i.test(stripped)) {
      return true;
    }
  }
  return false;
}

export async function execute({
  command,
  cwd,
  timeout = 120000,
  osSandbox = false,
  sandboxRoot,
  signal,
  runId,
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
  const effectiveSandboxRoot = sandboxRoot || effectiveCwd;
  const sandboxRequested = osSandbox && SandboxManager.isSupportedPlatform();
  const dockerCommand = commandUsesDocker(command);
  let useSandbox = sandboxRequested && !sandboxUnavailableReason && !dockerCommand;

  let shellCommand = command;
  if (useSandbox) {
    try {
      await initSandbox(effectiveSandboxRoot);
      shellCommand = await SandboxManager.wrapWithSandbox(command);
    } catch (err) {
      // Graceful fallback: if OS sandbox init fails (e.g. missing dependencies
      // like socat/ripgrep), continue without OS sandbox instead of failing
      // every bash command.
      sandboxUnavailableReason = err instanceof Error ? err.message : String(err);
      useSandbox = false;
    }
  }

  const startTime = Date.now();
  const result = await runProcess({
    runId: runId ?? legacyProcessRunId,
    command: shellCommand,
    cwd: effectiveCwd,
    signal: signal ?? new AbortController().signal,
    timeoutMs: timeout,
    maxOutputBytes: BASH_MAX_OUTPUT_BYTES,
    terminationGraceMs: 250,
  });
  if (useSandbox) SandboxManager.cleanupAfterCommand();
  const duration = Date.now() - startTime;
  // Keep the bash tool's established presentation contract: command output
  // is returned without surrounding whitespace.
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  const visibleStdout = result.outputTruncated
    ? `${stdout}${stdout ? "\n" : ""}${OUTPUT_TRUNCATION_MARKER}`
    : stdout;

  if (result.reason === "spawn_failed") {
    return {
      success: false, exitCode: null,
      stdout: visibleStdout, stderr,
      error: `Failed to execute command: ${stderr}`,
      duration,
    };
  }

  if (result.reason === "timed_out") {
    return {
      success: false, exitCode: result.exitCode,
      stdout: visibleStdout, stderr,
      error: `Command timed out after ${timeout}ms`,
      duration,
    };
  }

  if (result.reason === "cancelled") {
    return {
      success: false, exitCode: result.exitCode,
      stdout: visibleStdout, stderr,
      error: "Command cancelled",
      duration,
    };
  }

  if (result.exitCode === 0) {
    return { success: true, exitCode: 0, stdout: visibleStdout, stderr, duration };
  }

  let finalStderr = useSandbox
    ? SandboxManager.annotateStderrWithSandboxFailures(command, stderr)
    : stderr;
  if (!useSandbox && sandboxRequested && sandboxUnavailableReason && !sandboxWarningAppended) {
    const warning = `OS sandbox unavailable (${sandboxUnavailableReason}); running commands with path safety only.`;
    finalStderr = finalStderr ? `${finalStderr}\n${warning}` : warning;
    sandboxWarningAppended = true;
  }
  return {
    success: false, exitCode: result.exitCode, stdout: visibleStdout, stderr: finalStderr,
    error: result.exitCode === null ? "Command terminated by signal" : `Command exited with code ${result.exitCode}`,
    duration,
  };
}
