#!/usr/bin/env npx ts-node

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
import * as fs from "fs";

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

function detectTestRunner(projectPath: string): string {
  const packageJsonPath = path.join(projectPath, "package.json");

  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    if (deps.vitest) return "vitest";
    if (deps.jest) return "jest";
    if (deps.mocha) return "mocha";
  }

  // Check for Python
  if (fs.existsSync(path.join(projectPath, "pytest.ini")) ||
      fs.existsSync(path.join(projectPath, "pyproject.toml"))) {
    return "pytest";
  }

  return "jest"; // Default
}

function parseJestOutput(stdout: string): Partial<Output> {
  const result: Partial<Output> = {
    testsRun: 0,
    testsPassed: 0,
    testsFailed: 0,
    failedTests: [],
  };

  // Parse Jest summary line: "Tests: X passed, Y failed, Z total"
  const testsMatch = stdout.match(/Tests:\s+(\d+)\s+passed(?:,\s+(\d+)\s+failed)?(?:,\s+(\d+)\s+total)?/);
  if (testsMatch) {
    result.testsPassed = parseInt(testsMatch[1]) || 0;
    result.testsFailed = parseInt(testsMatch[2]) || 0;
    result.testsRun = parseInt(testsMatch[3]) || result.testsPassed + result.testsFailed;
  }

  // Parse coverage
  const coverageMatch = stdout.match(/All files\s+\|\s+[\d.]+\s+\|\s+[\d.]+\s+\|\s+[\d.]+\s+\|\s+([\d.]+)/);
  if (coverageMatch) {
    result.coveragePercent = parseFloat(coverageMatch[1]);
  }

  // Extract failed test names
  const failedMatches = stdout.matchAll(/FAIL\s+(.+\.test\.[jt]sx?)/g);
  for (const match of failedMatches) {
    result.failedTests?.push(match[1]);
  }

  // Parse time
  const timeMatch = stdout.match(/Time:\s+([\d.]+)\s*s/);
  if (timeMatch) {
    result.duration = parseFloat(timeMatch[1]);
  }

  return result;
}

function parseVitestOutput(stdout: string): Partial<Output> {
  const result: Partial<Output> = {
    testsRun: 0,
    testsPassed: 0,
    testsFailed: 0,
    failedTests: [],
  };

  // Vitest format: "Tests  X passed | Y failed (Z)"
  const testsMatch = stdout.match(/Tests\s+(\d+)\s+passed(?:\s+\|\s+(\d+)\s+failed)?/);
  if (testsMatch) {
    result.testsPassed = parseInt(testsMatch[1]) || 0;
    result.testsFailed = parseInt(testsMatch[2]) || 0;
    result.testsRun = result.testsPassed + result.testsFailed;
  }

  return result;
}

function parsePytestOutput(stdout: string): Partial<Output> {
  const result: Partial<Output> = {
    testsRun: 0,
    testsPassed: 0,
    testsFailed: 0,
    failedTests: [],
  };

  // Pytest format: "X passed, Y failed in Z.XXs"
  const passedMatch = stdout.match(/(\d+)\s+passed/);
  const failedMatch = stdout.match(/(\d+)\s+failed/);

  if (passedMatch) result.testsPassed = parseInt(passedMatch[1]);
  if (failedMatch) result.testsFailed = parseInt(failedMatch[1]);
  result.testsRun = (result.testsPassed ?? 0) + (result.testsFailed ?? 0);

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
    let testRunner = process.env.TEST_RUNNER || "";

    const projectPath = project ? path.join(repoPath, project) : repoPath;

    if (!testRunner) {
      testRunner = detectTestRunner(projectPath);
    }

    console.error(`[run_tests] Using ${testRunner} in ${projectPath}`);

    let cmd: string;

    switch (testRunner.toLowerCase()) {
      case "vitest":
        cmd = "npx vitest run";
        if (pattern) cmd += ` --filter "${pattern}"`;
        if (coverage) cmd += " --coverage";
        break;

      case "mocha":
        cmd = "npx mocha";
        if (pattern) cmd += ` --grep "${pattern}"`;
        break;

      case "pytest":
        cmd = "python -m pytest -v";
        if (pattern) cmd += ` -k "${pattern}"`;
        if (coverage) cmd += " --cov";
        break;

      case "jest":
      default:
        cmd = "npx jest";
        if (pattern) cmd += ` --testPathPattern="${pattern}"`;
        if (coverage) cmd += " --coverage";
        cmd += " --forceExit --detectOpenHandles";
        break;
    }

    const result = exec(cmd, projectPath);

    // Parse output based on runner
    let parsed: Partial<Output>;
    switch (testRunner.toLowerCase()) {
      case "vitest":
        parsed = parseVitestOutput(result.stdout);
        break;
      case "pytest":
        parsed = parsePytestOutput(result.stdout);
        break;
      case "jest":
      default:
        parsed = parseJestOutput(result.stdout);
        break;
    }

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
