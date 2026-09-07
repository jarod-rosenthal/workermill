import {
  runProcess,
  type ProcessRequest,
  type ProcessResult,
} from "../process-runner.js";

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

export interface VerifyExecutionOptions {
  runId?: string;
  signal?: AbortSignal;
  maxOutputBytes?: number;
  terminationGraceMs?: number;
  runProcess?: (request: ProcessRequest) => Promise<ProcessResult>;
}

export interface VerifyParams extends VerifyExecutionOptions {
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

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const DEFAULT_TERMINATION_GRACE_MS = 250;
const OUTPUT_TRUNCATION_MARKER = "[output truncated: command output exceeded 10 MiB]";

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
  timeout = DEFAULT_TIMEOUT_MS,
  runId = `verify-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  signal,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
  runProcess: executeProcess = runProcess,
}: VerifyParams): Promise<VerifyResult> {
  const result = await executeProcess({
    runId,
    command,
    cwd: cwd || process.cwd(),
    signal: signal ?? new AbortController().signal,
    timeoutMs: timeout,
    maxOutputBytes,
    terminationGraceMs,
  });

  const visibleStdout = result.outputTruncated
    ? `${result.stdout}${result.stdout ? "\n" : ""}${OUTPUT_TRUNCATION_MARKER}`
    : result.stdout;
  const visibleStderr = result.outputTruncated && !visibleStdout.includes(OUTPUT_TRUNCATION_MARKER)
    ? `${result.stderr}${result.stderr ? "\n" : ""}${OUTPUT_TRUNCATION_MARKER}`
    : result.stderr;
  const combinedOutput = [visibleStdout, visibleStderr].filter(Boolean).join("\n").trim();
  const truncatedRaw = truncateLines(combinedOutput, 50);
  const raw = result.outputTruncated && !truncatedRaw.includes(OUTPUT_TRUNCATION_MARKER)
    ? `${truncatedRaw}\n${OUTPUT_TRUNCATION_MARKER}`
    : truncatedRaw;

  if (result.reason !== "exited") {
    const detail = result.reason === "timed_out"
      ? `Command timed out after ${timeout}ms`
      : result.reason === "cancelled"
        ? "Command cancelled"
        : `Failed to execute command: ${result.stderr || "process could not be spawned"}`;
    return {
      success: false,
      passed: false,
      summary: detail,
      raw,
      error: detail,
    };
  }

  const parsed = parseOutput(combinedOutput);
  const processPassed = result.exitCode === 0;
  if (parsed) {
    return {
      success: true,
      passed: processPassed && parsed.passed,
      summary: processPassed ? parsed.summary : `${parsed.summary} (exit code ${result.exitCode ?? "unknown"})`,
      passCount: parsed.passCount,
      failCount: parsed.failCount,
      raw,
    };
  }

  return {
    success: true,
    passed: processPassed,
    summary: processPassed ? "Command succeeded (exit code 0)" : `Command failed (exit code ${result.exitCode ?? "unknown"})`,
    raw,
  };
}
