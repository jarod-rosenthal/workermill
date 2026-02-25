***REMOVED***!/usr/bin/env npx ts-node

/**
 * Run tests in a project
 *
 * Inputs (environment variables):
 * - REPO_PATH: Optional. Path to repository. Defaults to current directory
 * - PATTERN: Optional. Test pattern to match (e.g., "auth", "users.test")
 * - PROJECT: Optional. Project subdirectory (e.g., "backend", "frontend")
 * - TEST_RUNNER: Optional. "jest" (default), "vitest", "mocha", "pytest"
 * - COVERAGE: Optional. Generate coverage report if "true"
 *
 * Outputs (JSON to stdout):
 * - success: boolean
 * - testsRun: number
 * - testsPassed: number
 * - testsFailed: number
 * - coveragePercent?: number
 * - failedTests?: string[]
 * - error?: string
 */

import { execSync } from "child_process";
import * as path from "path";
import { detectLanguageWithTestRunner, getProfile } from "../../lib/dist/language-profile.js";
import type { LanguageProfile } from "../../lib/dist/language-profile.js";

interface Output {
  success: boolean;
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  coveragePercent?: number;
  failedTests?: string[];
  duration?: number;
  error?: string;
}

function exec(cmd: string, cwd?: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 300000, // 5 minute timeout
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      exitCode: error.status || 1,
    };
  }
}

function parseTestOutputForDetails(
  profile: LanguageProfile,
  stdout: string,
  stderr: string,
): Partial<Output> {
  const parsed = profile.parseTests(stdout, stderr);
  const result: Partial<Output> = {
    testsPassed: parsed.passed,
    testsFailed: parsed.failed,
    testsRun: parsed.passed + parsed.failed + parsed.skipped,
    failedTests: [],
  };

  // Extract coverage from Jest/Vitest output (TS only)
  if (profile.id === "typescript") {
    const coverageMatch = stdout.match(
      /All files\s+\|\s+[\d.]+\s+\|\s+[\d.]+\s+\|\s+[\d.]+\s+\|\s+([\d.]+)/,
    );
    if (coverageMatch) {
      result.coveragePercent = parseFloat(coverageMatch[1]);
    }

    // Extract failed test names
    const failedMatches = stdout.matchAll(/FAIL\s+(.+\.test\.[jt]sx?)/g);
    for (const match of failedMatches) {
      result.failedTests?.push(match[1]);
    }
  }

  // Parse time
  const timeMatch = stdout.match(/Time:\s+([\d.]+)\s*s/);
  if (timeMatch) {
    result.duration = parseFloat(timeMatch[1]);
  }

  return result;
}

async function main(): Promise<void> {
  const output: Output = {
    success: false,
    testsRun: 0,
    testsPassed: 0,
    testsFailed: 0,
  };

  const startTime = Date.now();

  try {
    const repoPath = process.env.REPO_PATH || process.cwd();
    const pattern = process.env.PATTERN || "";
    const project = process.env.PROJECT || "";
    const coverage = process.env.COVERAGE === "true";
    const testRunnerEnv = process.env.TEST_RUNNER || "";

    const projectPath = project ? path.join(repoPath, project) : repoPath;

    // Use explicit TEST_RUNNER env if set, otherwise auto-detect
    // Map runner names (jest, vitest, pytest, mocha) to language profile IDs
    const runnerToProfileId: Record<string, string> = {
      jest: "typescript",
      vitest: "typescript",
      mocha: "typescript",
      pytest: "python",
    };
    const profile = testRunnerEnv
      ? getProfile(runnerToProfileId[testRunnerEnv.toLowerCase()] || testRunnerEnv)
      : detectLanguageWithTestRunner(projectPath);

    console.error(`[run_tests] Using ${profile.displayName} profile in ${projectPath}`);

    // Build command with pattern/coverage options
    let cmd = profile.test;
    if (pattern) {
      // Append pattern flag based on language
      switch (profile.id) {
        case "typescript":
          // Detect if vitest or jest from the command
          if (cmd.includes("vitest")) cmd = `npx vitest run --filter "${pattern}"`;
          else if (cmd.includes("mocha")) cmd = `npx mocha --grep "${pattern}"`;
          else cmd = `npx jest --testPathPattern="${pattern}" --forceExit --detectOpenHandles`;
          break;
        case "python":
          cmd = `python -m pytest -v -k "${pattern}"`;
          break;
        case "rust":
          cmd = `cargo test ${pattern} 2>&1`;
          break;
        case "go":
          cmd = `go test ./... -v -count=1 -run "${pattern}" 2>&1`;
          break;
        case "ruby":
          cmd = `bundle exec rspec --tag "${pattern}" 2>&1`;
          break;
      }
    }
    if (coverage && profile.id === "typescript") {
      if (cmd.includes("vitest")) cmd += " --coverage";
      else if (cmd.includes("jest")) cmd += " --coverage";
    }
    if (coverage && profile.id === "python") {
      cmd += " --cov";
    }

    const result = exec(cmd, projectPath);
    const parsed = parseTestOutputForDetails(profile, result.stdout, result.stderr);

    Object.assign(output, parsed);
    output.success = result.exitCode === 0;
    output.duration = (Date.now() - startTime) / 1000;

    if (!output.success && result.stderr) {
      output.error = result.stderr.slice(0, 500);
    }
  } catch (error: unknown) {
    output.error = error instanceof Error ? error.message : String(error);
    output.duration = (Date.now() - startTime) / 1000;
  }

  console.log(JSON.stringify(output));

  // Output markers
  console.error(`::tests_run::${output.testsRun}`);
  console.error(`::tests_passed::${output.testsPassed}`);
  console.error(`::tests_failed::${output.testsFailed}`);
  if (output.coveragePercent) {
    console.error(`::coverage::${output.coveragePercent}%`);
  }

  process.exit(output.success ? 0 : 1);
}

main();
