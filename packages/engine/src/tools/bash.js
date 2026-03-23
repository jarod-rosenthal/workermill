import { spawn } from "child_process";
let activeChild = null;
export function killActiveProcess() {
    if (activeChild?.pid) {
        try {
            process.kill(-activeChild.pid, "SIGTERM");
            setTimeout(() => {
                try {
                    if (activeChild?.pid)
                        process.kill(-activeChild.pid, "SIGKILL");
                }
                catch { /* already exited */ }
            }, 3000);
        }
        catch { /* already exited */ }
    }
}
export const name = "bash";
export const description = "Execute a bash command and return the output. Use for running shell commands, git operations, npm commands, etc.";
export const parameters = {
    type: "object",
    properties: {
        command: {
            type: "string",
            description: "The bash command to execute",
        },
        cwd: {
            type: "string",
            description: "Working directory for the command (optional)",
        },
        timeout: {
            type: "number",
            description: "Timeout in milliseconds (default: 120000 = 2 minutes)",
        },
    },
    required: ["command"],
};
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
function isLongRunning(command) {
    for (const pattern of LONG_RUNNING_PATTERNS) {
        if (pattern.test(command)) {
            const match = command.match(pattern);
            return match ? match[0] : "long-running process";
        }
    }
    return null;
}
export async function execute({ command, cwd, timeout = 120000, }) {
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
                process.kill(-child.pid, "SIGTERM");
            }
            catch { /* ESRCH: already exited */ }
            setTimeout(() => {
                try {
                    process.kill(-child.pid, "SIGKILL");
                }
                catch { /* ESRCH: already exited */ }
            }, 5000);
        }, timeout);
        child.stdout.on("data", (data) => {
            stdout += data.toString();
            // Truncate if output is too large (1MB limit)
            if (stdout.length > 1024 * 1024) {
                stdout = stdout.slice(0, 1024 * 1024) + "\n... [output truncated]";
            }
        });
        child.stderr.on("data", (data) => {
            stderr += data.toString();
            // Truncate if output is too large (1MB limit)
            if (stderr.length > 1024 * 1024) {
                stderr = stderr.slice(0, 1024 * 1024) + "\n... [output truncated]";
            }
        });
        child.on("close", (code) => {
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
            }
            else if (code === 0) {
                resolve({
                    success: true,
                    exitCode: 0,
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    duration,
                });
            }
            else {
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
        child.on("error", (err) => {
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
