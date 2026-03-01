/**
 * Shared gate command runner — used by both executor.ts and inline-gate-fixer.ts.
 * Extracted to prevent drift between the two copies.
 */

import { spawn } from "child_process";

/**
 * Spawn a gate command as a child process with timeout and watch-mode detection.
 * Sets CI=true in the environment so tools like Vitest/Jest exit after running.
 */
export function runGateCommand(
  cmd: string,
  cwd: string,
  timeoutMs: number = 300_000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const shell = process.platform === "win32" ? "cmd" : "/bin/sh";
    const shellArgs = process.platform === "win32" ? ["/c", cmd] : ["-c", cmd];
    // On Windows (Git Bash / MSYS2), the Bun-compiled agent binary may not inherit
    // Windows user env vars like APPDATA, LOCALAPPDATA, GOCACHE. Go toolchain needs
    // these to locate the build cache. Inject sensible defaults if missing.
    const env: Record<string, string | undefined> = { ...process.env, CI: "true" };
    if (process.platform === "win32" || process.env.MSYSTEM) {
      const home = process.env.HOME || process.env.USERPROFILE || "";
      if (!env.APPDATA && home) env.APPDATA = `${home}/AppData/Roaming`;
      if (!env.LOCALAPPDATA && home) env.LOCALAPPDATA = `${home}/AppData/Local`;
      if (!env.GOCACHE && home) env.GOCACHE = `${home}/.cache/go-build`;
    }

    const child = spawn(shell, shellArgs, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let watchModeKilled = false;

    const overallTimer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    let watchModeTimer: ReturnType<typeof setTimeout> | null = null;

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
      // Detect watch mode — kill early instead of waiting for full timeout
      if (/waiting for file changes|press [hq] to/i.test(stdout) && !watchModeTimer) {
        watchModeTimer = setTimeout(() => {
          watchModeKilled = true;
          child.kill("SIGTERM");
        }, 2000);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(overallTimer);
      if (watchModeTimer) clearTimeout(watchModeTimer);

      if (watchModeKilled || code === 0) {
        resolve({ stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 2000) });
      } else {
        const err = new Error(`Command failed with exit code ${code}`);
        (err as any).stdout = stdout.slice(0, 4000);
        (err as any).stderr = stderr.slice(0, 2000);
        (err as any).code = code;
        reject(err);
      }
    });

    child.on("error", (err) => {
      clearTimeout(overallTimer);
      if (watchModeTimer) clearTimeout(watchModeTimer);
      reject(err);
    });
  });
}
