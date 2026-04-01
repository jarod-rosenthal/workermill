import { spawn } from "child_process";
import {
  SandboxManager,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";

let activeChild: ReturnType<typeof spawn> | null = null;

// ---------------------------------------------------------------------------
// OS-level sandboxing via @anthropic-ai/sandbox-runtime
// ---------------------------------------------------------------------------

let sandboxInitialized = false;
let sandboxInitPromise: Promise<void> | undefined;

/**
 * Initialize the sandbox runtime once per session.
 * Uses a minimal config: allow writes to cwd, no network filtering.
 */
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

export function killActiveProcess(): void {
  if (activeChild?.pid) {
    try {
      process.kill(-activeChild.pid, "SIGTERM");
      setTimeout(() => {
        try {
          if (activeChild?.pid) process.kill(-activeChild.pid, "SIGKILL");
        } catch { /* already exited */ }
      }, 3000);
    } catch { /* already exited */ }
  }
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
  /** Use OS-level sandboxing (bwrap on Linux) if available. */
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

/** Patterns that indicate long-running/interactive processes */
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
  /\bdocker\s+compose\s+up(?!\s+--build\b.*--exit)/,
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

/** Patterns that indicate destructive or dangerous commands */
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

/** Well-known absolute paths outside any project directory */
const OUTSIDE_PATHS = ["/tmp", "/var", "/etc", "/opt", "/usr", "/sys", "/proc", "/dev", "/boot", "/root"];

/**
 * Check if a bash command references paths outside the working directory.
 * Returns the offending path or null.
 */
function referencesOutsidePath(command: string, cwd?: string): string | null {
  // Skip commands that are just reading (cat, ls, head, etc.) — only block writes
  if (/^\s*(?:cat|head|tail|less|more|wc|file|stat|which|type|echo)\s/.test(command)) return null;

  for (const p of OUTSIDE_PATHS) {
    // Match the path as a standalone token (not as substring of another word)
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
  // Block known long-running processes
  const longRunning = isLongRunning(command);
  if (longRunning) {
    return {
      success: false,
      exitCode: -1,
      stdout: "",
      stderr: "",
      error: `Blocked: "${longRunning}" is a long-running process that would block execution. Use a one-shot command instead (e.g., "npx tsc --noEmit" to check compilation, "npm test" to run tests).`,
      duration: 0,
    };
  }

  // Block destructive/dangerous commands
  const dangerous = isDangerous(command);
  if (dangerous) {
    return {
      success: false,
      exitCode: -1,
      stdout: "",
      stderr: "",
      error: `Blocked: "${dangerous}" is not allowed. This command could damage the system or repository.`,
      duration: 0,
    };
  }

  // Block commands that write to paths outside the working directory
  const outsidePath = referencesOutsidePath(command, cwd);
  if (outsidePath) {
    return {
      success: false,
      exitCode: -1,
      stdout: "",
      stderr: "",
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

  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let killed = false;

    const child = spawn("/bin/bash", ["-c", shellCommand], {
      cwd: effectiveCwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    activeChild = child;

    // Set up timeout
    const timeoutId = setTimeout(() => {
      killed = true;
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch { /* ESRCH: already exited */ }
      setTimeout(() => {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch { /* ESRCH: already exited */ }
      }, 5000);
    }, timeout);

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
      // Truncate if output is too large (1MB limit)
      if (stdout.length > 1024 * 1024) {
        stdout = stdout.slice(0, 1024 * 1024) + "\n... [output truncated]";
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      // Truncate if output is too large (1MB limit)
      if (stderr.length > 1024 * 1024) {
        stderr = stderr.slice(0, 1024 * 1024) + "\n... [output truncated]";
      }
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timeoutId);
      activeChild = null;
      if (useSandbox) SandboxManager.cleanupAfterCommand();
      const duration = Date.now() - startTime;

      if (killed) {
        resolve({
          success: false,
          exitCode: code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          error: `Command timed out after ${timeout}ms`,
          duration,
        });
      } else if (code === 0) {
        resolve({
          success: true,
          exitCode: 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          duration,
        });
      } else {
        const finalStderr = useSandbox
          ? SandboxManager.annotateStderrWithSandboxFailures(command, stderr.trim())
          : stderr.trim();
        resolve({
          success: false,
          exitCode: code,
          stdout: stdout.trim(),
          stderr: finalStderr,
          error: `Command exited with code ${code}`,
          duration,
        });
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(timeoutId);
      activeChild = null;
      const duration = Date.now() - startTime;
      resolve({
        success: false,
        exitCode: -1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: `Failed to execute command: ${err.message}`,
        duration,
      });
    });
  });
}
