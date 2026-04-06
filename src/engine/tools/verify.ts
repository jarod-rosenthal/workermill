import { spawn } from "child_process";

export const name = "verify";

export const description =
  "Run a verification command (tests, linting, type checking) and return structured pass/fail results with parsed test counts.";

export const parameters = {
  type: "object" as const,
  properties: {
    command: {
      type: "string" as const,
      description: "The verification command to run (e.g., 'npm test', 'npx tsc --noEmit', 'pytest')",
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

interface VerifyParams {
  command: string;
  cwd?: string;
  timeout?: number;
}

export interface VerifyResult {
  success: boolean;
  passed: boolean;
  summary: string;
  passCount?: number;
  failCount?: number;
  raw: string;
  error?: string;
}

/** Truncate output to first N lines */
function truncateLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + `\n... [truncated, ${lines.length - maxLines} more lines]`;
}

/** Parse Jest/Vitest output: "Tests:  5 passed, 2 failed" or "Test Suites: 3 passed" */
function parseJestVitest(output: string): { passed: boolean; summary: string; passCount?: number; failCount?: number } | null {
  // Match "Tests:  X passed" with optional failures
  const testsMatch = output.match(/Tests:\s+(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+skipped,?\s*)?(?:(\d+)\s+passed)/);
  if (testsMatch) {
    const failCount = testsMatch[1] ? parseInt(testsMatch[1], 10) : 0;
    const passCount = testsMatch[3] ? parseInt(testsMatch[3], 10) : 0;
    const passed = failCount === 0;
    return { passed, summary: `${passCount} passed, ${failCount} failed`, passCount, failCount };
  }

  // Match "Test Suites:  X passed"
  const suitesMatch = output.match(/Test Suites:\s+(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+passed)/);
  if (suitesMatch) {
    const failCount = suitesMatch[1] ? parseInt(suitesMatch[1], 10) : 0;
    const passCount = suitesMatch[2] ? parseInt(suitesMatch[2], 10) : 0;
    const passed = failCount === 0;
    return { passed, summary: `${passCount} suites passed, ${failCount} failed`, passCount, failCount };
  }

  return null;
}

/** Parse pytest output: "5 passed, 2 failed" or "====== 5 passed ======" */
function parsePytest(output: string): { passed: boolean; summary: string; passCount?: number; failCount?: number } | null {
  // "X passed" with optional "Y failed"
  const match = output.match(/=+\s*(?:(\d+)\s+failed,?\s*)?(\d+)\s+passed(?:,?\s*(\d+)\s+failed)?/);
  if (match) {
    const failCount = (match[1] ? parseInt(match[1], 10) : 0) + (match[3] ? parseInt(match[3], 10) : 0);
    const passCount = parseInt(match[2], 10);
    const passed = failCount === 0;
    return { passed, summary: `${passCount} passed, ${failCount} failed`, passCount, failCount };
  }

  // Simple "X passed, Y failed" without the === markers
  const simpleMatch = output.match(/(\d+)\s+passed(?:,\s*(\d+)\s+failed)?/);
  if (simpleMatch) {
    const passCount = parseInt(simpleMatch[1], 10);
    const failCount = simpleMatch[2] ? parseInt(simpleMatch[2], 10) : 0;
    const passed = failCount === 0;
    return { passed, summary: `${passCount} passed, ${failCount} failed`, passCount, failCount };
  }

  return null;
}

/** Parse go test output: "ok" or "FAIL" lines, "--- FAIL:" markers */
function parseGoTest(output: string): { passed: boolean; summary: string; passCount?: number; failCount?: number } | null {
  const okLines = (output.match(/^ok\s+/gm) || []).length;
  const failLines = (output.match(/^FAIL\s+/gm) || []).length;
  const failMarkers = (output.match(/^--- FAIL:/gm) || []).length;

  if (okLines === 0 && failLines === 0 && failMarkers === 0) return null;

  const failCount = failLines + failMarkers;
  const passed = failCount === 0;
  return {
    passed,
    summary: `${okLines} ok, ${failCount} failed`,
    passCount: okLines,
    failCount,
  };
}

/** Parse tsc output: count of "error TS" lines (0 = pass) */
function parseTsc(output: string): { passed: boolean; summary: string; passCount?: number; failCount?: number } | null {
  const errorCount = (output.match(/error TS\d+/g) || []).length;
  // Only treat as tsc output if there are TS errors or the command looks like tsc
  if (errorCount > 0) {
    return {
      passed: false,
      summary: `${errorCount} type error(s)`,
      failCount: errorCount,
    };
  }
  return null;
}

/** Parse eslint output: "X problems" or "X errors" or clean exit = pass */
function parseEslint(output: string): { passed: boolean; summary: string; passCount?: number; failCount?: number } | null {
  const problemsMatch = output.match(/(\d+)\s+problems?\s*\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)/);
  if (problemsMatch) {
    const errors = parseInt(problemsMatch[2], 10);
    const warnings = parseInt(problemsMatch[3], 10);
    return {
      passed: errors === 0,
      summary: `${errors} error(s), ${warnings} warning(s)`,
      failCount: errors,
    };
  }

  const errorsMatch = output.match(/(\d+)\s+errors?/);
  if (errorsMatch) {
    const errors = parseInt(errorsMatch[1], 10);
    return {
      passed: errors === 0,
      summary: `${errors} error(s)`,
      failCount: errors,
    };
  }

  return null;
}

/** Parse Playwright output: "X passed" "X failed" */
function parsePlaywright(output: string): { passed: boolean; summary: string; passCount?: number; failCount?: number } | null {
  const match = output.match(/(\d+)\s+passed(?:.*?(\d+)\s+failed)?/);
  if (!match) return null;

  const passCount = parseInt(match[1], 10);
  const failCount = match[2] ? parseInt(match[2], 10) : 0;
  const passed = failCount === 0;
  return { passed, summary: `${passCount} passed, ${failCount} failed`, passCount, failCount };
}

/** Try all parsers in order, return first match */
function parseOutput(output: string): { passed: boolean; summary: string; passCount?: number; failCount?: number } | null {
  return (
    parseJestVitest(output) ||
    parsePytest(output) ||
    parseGoTest(output) ||
    parseTsc(output) ||
    parseEslint(output) ||
    parsePlaywright(output)
  );
}

export async function execute({
  command,
  cwd,
  timeout = 120000,
}: VerifyParams): Promise<VerifyResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let killed = false;

    const child = spawn("/bin/bash", ["-c", command], {
      cwd: cwd || process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    const timeoutId = setTimeout(() => {
      killed = true;
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch { /* already exited */ }
      setTimeout(() => {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch { /* already exited */ }
      }, 5000);
    }, timeout);

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > 1024 * 1024) {
        stdout = stdout.slice(0, 1024 * 1024) + "\n... [output truncated]";
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > 1024 * 1024) {
        stderr = stderr.slice(0, 1024 * 1024) + "\n... [output truncated]";
      }
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timeoutId);

      if (killed) {
        resolve({
          success: false,
          passed: false,
          summary: `Command timed out after ${timeout}ms`,
          raw: truncateLines((stdout + "\n" + stderr).trim(), 50),
          error: `Command timed out after ${timeout}ms`,
        });
        return;
      }

      const combinedOutput = (stdout + "\n" + stderr).trim();
      const raw = truncateLines(combinedOutput, 50);

      // Try to parse structured results from the output
      const parsed = parseOutput(combinedOutput);

      if (parsed) {
        resolve({
          success: true,
          passed: parsed.passed,
          summary: parsed.summary,
          passCount: parsed.passCount,
          failCount: parsed.failCount,
          raw,
        });
      } else if (code === 0) {
        // Generic pass: exit code 0 with no recognized test output
        resolve({
          success: true,
          passed: true,
          summary: "Command succeeded (exit code 0)",
          raw,
        });
      } else {
        // Generic fail: non-zero exit
        // Check for tsc with clean exit but errors in output
        const tscResult = parseTsc(combinedOutput);
        if (tscResult) {
          resolve({
            success: true,
            passed: false,
            summary: tscResult.summary,
            failCount: tscResult.failCount,
            raw,
          });
          return;
        }

        resolve({
          success: true,
          passed: false,
          summary: `Command failed (exit code ${code})`,
          raw,
        });
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        passed: false,
        summary: `Failed to execute: ${err.message}`,
        raw: "",
        error: `Failed to execute command: ${err.message}`,
      });
    });
  });
}
