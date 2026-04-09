/**
 * Quality gate command runner — async spawn with timeout, CI=true, watch-mode kill.
 * Mirrors worker/epic/gate-utils.ts runGateCommand; kept separate so the CLI
 * doesn't import from the worker package.
 */
import { spawn } from "child_process";

export interface GateResult {
  name: string;
  passed: boolean;
  output: string;
}

export async function runGateCommand(
  cmd: string,
  cwd: string,
  timeoutMs: number = 300_000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const shell = "/bin/bash";
    const env: NodeJS.ProcessEnv = { ...process.env, CI: "true" };
    const home = process.env.HOME || "";
    if (home && env.PATH && !env.PATH.includes(`${home}/.local/bin`)) {
      env.PATH = `${home}/.local/bin:${env.PATH}`;
    }

    const child = spawn(shell, ["-c", cmd], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let watchModeKilled = false;

    const overallTimer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    let watchModeTimer: ReturnType<typeof setTimeout> | null = null;

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
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
        resolve({ stdout, stderr });
      } else {
        const err = new Error(`Command failed with exit code ${code}`);
        (err as any).stdout = stdout;
        (err as any).stderr = stderr;
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

/**
 * Run all commands for a single gate. Stops at the first failure.
 * Returns a GateResult — never throws.
 */
export async function runGate(
  gate: { name: string; commands: string[] },
  cwd: string
): Promise<GateResult> {
  const outputs: string[] = [];
  for (const cmd of gate.commands) {
    try {
      const { stdout, stderr } = await runGateCommand(cmd, cwd);
      const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (combined) outputs.push(`$ ${cmd}\n${combined}`);
    } catch (err: any) {
      const combined = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
      const failureOutput = combined ? `$ ${cmd}\n${combined}` : `$ ${cmd}`;
      outputs.push(failureOutput);
      return { name: gate.name, passed: false, output: outputs.join("\n\n").trim() };
    }
  }
  return { name: gate.name, passed: true, output: outputs.join("\n\n").trim() };
}
