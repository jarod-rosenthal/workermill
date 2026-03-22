import { spawn } from "child_process";

let activeChild: ReturnType<typeof spawn> | null = null;

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
}

interface BashResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  duration: number;
}

export async function execute({
  command,
  cwd,
  timeout = 120000,
}: BashParams): Promise<BashResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let killed = false;

    // Use shell to execute the command
    // Use /bin/bash explicitly to ensure it's found in container environments
    const child = spawn("/bin/bash", ["-c", command], {
      cwd: cwd || process.cwd(),
      env: {
        ...process.env,
        PATH: "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      },
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
        resolve({
          success: false,
          exitCode: code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
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
