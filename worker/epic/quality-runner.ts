/**
 * Quality Runner - Run verification commands and extract quality metrics
 *
 * This module runs actual verification commands (typecheck, lint, test, audit)
 * on the repository and extracts quality metrics from the output.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { detectLanguageWithTestRunner, findGoModDirs } from "../lib/dist/language-profile.js";

// Score weights (must sum to 1.0)
const WEIGHTS = {
  typecheck: 0.25,
  lint: 0.20,
  tests: 0.30,
  coverage: 0.15,
  security: 0.10,
};

export interface QualityMetrics {
  qualityScore: number;
  lintScore: number;
  lintErrors: number;
  lintWarnings: number;
  typecheckScore: number;
  typeErrors: number;
  testScore: number;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  coverageScore: number;
  coverageLines: number;
  coverageBranches: number;
  securityScore: number;
  securityHigh: number;
  securityMedium: number;
  securityLow: number;
  // Check availability tracking (unavailable = tool couldn't run, not a real failure)
  typecheckAvailable?: boolean;
  testsAvailable?: boolean;
  coverageAvailable?: boolean;
  // E2E test tracking
  e2eAvailable?: boolean;
  e2ePassed?: number;
  e2eFailed?: number;
  e2eSkipped?: number;
  e2eScore?: number;
  // Changed file coverage tracking
  changedFiles?: string[];
  changedFileCoverage?: number;
  changedFileCoverageDetails?: Array<{
    file: string;
    lines: number;
    branches: number;
    covered: boolean;
  }>;
}

/**
 * Result of targeted test execution for a set of changed files.
 */
export interface TargetedTestResult {
  passed: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  testRunner: "jest" | "vitest" | "pytest" | "npm_test" | "none";
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCommand(cmd: string, cwd: string, timeoutMs: number = 120000): CommandResult {
  try {
    const stdout = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeoutMs,
      env: { ...process.env, CI: "true" }, // Prevent vitest/jest watch mode
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status || 1,
    };
  }
}

/**
 * Get list of changed files from git diff against a base branch.
 */
export function getChangedFiles(repoPath: string, baseBranch: string = "main"): string[] {
  try {
    // Try to get changed files compared to base branch
    const result = runCommand(
      `git diff --name-only ${baseBranch}...HEAD 2>/dev/null || git diff --name-only HEAD~1 2>/dev/null || echo ''`,
      repoPath
    );

    const files = result.stdout
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f.length > 0)
      // Only include source code files
      .filter((f) =>
        /\.(ts|tsx|js|jsx|py|go|java|rb|rs|c|cpp|cs|php|swift|kt)$/.test(f)
      );

    console.log(`[quality-runner] Found ${files.length} changed source files`);
    return files;
  } catch {
    console.log("[quality-runner] Could not determine changed files");
    return [];
  }
}

/**
 * Get coverage for specific files from coverage report.
 * Parses coverage-summary.json or lcov.info if available.
 */
export function getChangedFileCoverage(
  repoPath: string,
  changedFiles: string[]
): { avgCoverage: number; details: QualityMetrics["changedFileCoverageDetails"] } {
  if (changedFiles.length === 0) {
    return { avgCoverage: 0, details: [] };
  }

  const details: NonNullable<QualityMetrics["changedFileCoverageDetails"]> = [];
  let totalCoverage = 0;
  let filesWithCoverage = 0;

  // Try to read coverage-summary.json (Jest/Vitest format)
  const summaryResult = runCommand(
    "cat coverage/coverage-summary.json 2>/dev/null || echo '{}'",
    repoPath
  );

  try {
    const summary = JSON.parse(summaryResult.stdout || "{}");

    for (const file of changedFiles) {
      // Find the file in coverage report (may have different path format)
      let coverageData = null;
      for (const [key, value] of Object.entries(summary)) {
        if (key === "total") continue;
        // Match by filename (partial path match)
        if (key.endsWith(file) || file.endsWith(key.split("/").pop() || "")) {
          coverageData = value as { lines?: { pct: number }; branches?: { pct: number } };
          break;
        }
      }

      if (coverageData && coverageData.lines) {
        const lineCoverage = coverageData.lines.pct || 0;
        const branchCoverage = coverageData.branches?.pct || 0;
        details.push({
          file,
          lines: Math.round(lineCoverage),
          branches: Math.round(branchCoverage),
          covered: lineCoverage > 0,
        });
        totalCoverage += lineCoverage;
        filesWithCoverage++;
      } else {
        // File not in coverage report (possibly not covered or not testable)
        details.push({
          file,
          lines: 0,
          branches: 0,
          covered: false,
        });
      }
    }
  } catch {
    // Fall back to lcov.info parsing if JSON not available
    const lcovResult = runCommand("cat coverage/lcov.info 2>/dev/null || echo ''", repoPath);
    const lcovContent = lcovResult.stdout;

    if (lcovContent) {
      // Parse lcov format to find coverage for changed files
      for (const file of changedFiles) {
        const fileRegex = new RegExp(`SF:.*${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?end_of_record`, "i");
        const match = lcovContent.match(fileRegex);

        if (match) {
          // Extract line coverage
          const lhMatch = match[0].match(/LH:(\d+)/);
          const lfMatch = match[0].match(/LF:(\d+)/);
          const linesHit = parseInt(lhMatch?.[1] || "0");
          const linesFound = parseInt(lfMatch?.[1] || "1");
          const lineCoverage = (linesHit / linesFound) * 100;

          // Extract branch coverage
          const bhMatch = match[0].match(/BRH:(\d+)/);
          const bfMatch = match[0].match(/BRF:(\d+)/);
          const branchesHit = parseInt(bhMatch?.[1] || "0");
          const branchesFound = parseInt(bfMatch?.[1] || "1");
          const branchCoverage = branchesFound > 0 ? (branchesHit / branchesFound) * 100 : 0;

          details.push({
            file,
            lines: Math.round(lineCoverage),
            branches: Math.round(branchCoverage),
            covered: lineCoverage > 0,
          });
          totalCoverage += lineCoverage;
          filesWithCoverage++;
        } else {
          details.push({
            file,
            lines: 0,
            branches: 0,
            covered: false,
          });
        }
      }
    }
  }

  const avgCoverage = filesWithCoverage > 0 ? Math.round(totalCoverage / filesWithCoverage) : 0;

  console.log(`[quality-runner] Changed file coverage: ${avgCoverage}% (${filesWithCoverage}/${changedFiles.length} files have coverage)`);
  details.forEach((d) => {
    const status = d.covered ? "✓" : "✗";
    console.log(`[quality-runner]   ${status} ${d.file}: ${d.lines}% lines, ${d.branches}% branches`);
  });

  return { avgCoverage, details };
}

/**
 * Ensure dependencies are installed before running quality checks.
 * Detects package manager from lockfile (same logic as remote-bootstrap.ts).
 * Without this, stale node_modules produces thousands of phantom type errors.
 */
function ensureDependenciesInstalled(cwd: string, languageId: string): void {
  if (languageId === "go") {
    // Go modules: download dependencies if go.mod exists
    if (fs.existsSync(path.join(cwd, "go.mod"))) {
      console.log("[quality-runner] Installing Go dependencies...");
      try {
        execSync("go mod download", { cwd, stdio: "pipe", timeout: 120_000 });
        console.log("[quality-runner] Go dependencies installed");
      } catch {
        console.log("[quality-runner] go mod download failed (non-fatal)");
      }
    }
    return;
  }

  // JS/TS: detect package manager from lockfile and install
  let installCmd: string | null = null;
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) {
    installCmd = "pnpm install --frozen-lockfile";
  } else if (fs.existsSync(path.join(cwd, "yarn.lock"))) {
    installCmd = "yarn install --frozen-lockfile";
  } else if (fs.existsSync(path.join(cwd, "package-lock.json"))) {
    installCmd = "npm ci";
  } else if (fs.existsSync(path.join(cwd, "package.json"))) {
    installCmd = "npm install";
  }

  if (installCmd) {
    console.log(`[quality-runner] Installing dependencies: ${installCmd}`);
    try {
      execSync(installCmd, { cwd, stdio: "pipe", timeout: 300_000 });
      console.log("[quality-runner] Dependencies installed");
    } catch {
      console.log("[quality-runner] Dependency install failed (non-fatal) — proceeding with existing node_modules");
    }
  }
}

/**
 * Find a board gate command matching a quality check category.
 * Returns the full command chain (joined with &&) or undefined if no match.
 * Matches by gate name first, then by command content as fallback.
 */
function findBoardGateCommand(
  gates: { name: string; trigger: string; commands: string[] }[],
  category: "test" | "test-e2e" | "lint" | "typecheck"
): string | undefined {
  // Name patterns for each category
  const namePatterns: Record<string, RegExp> = {
    "test": /^test[-_]?(unit|backend)?$/i,
    "test-e2e": /^test[-_]?e2e/i,
    "lint": /^lint[-_]?(backend)?$/i,
    "typecheck": /^type[-_]?check[-_]?(backend)?$/i,
  };

  // Command content patterns as fallback
  const cmdPatterns: Record<string, RegExp> = {
    "test": /\b(pytest|go\s+test|npm\s+test|vitest|jest)\b/,
    "test-e2e": /\btest.e2e\b|test_e2e_workflows/,
    "lint": /\b(ruff\s+check|eslint|golangci-lint|npm\s+run\s+lint)\b/,
    "typecheck": /\b(mypy|tsc\s+--noEmit|npx\s+tsc|pyright)\b/,
  };

  const nameRe = namePatterns[category];
  const cmdRe = cmdPatterns[category];

  // Try name match first
  let match = gates.find((g) => nameRe?.test(g.name));
  // Fallback: match by command content (exclude e2e from unit test match)
  if (!match && cmdRe) {
    match = gates.find((g) => {
      const joined = g.commands.join(" ");
      if (!cmdRe.test(joined)) return false;
      // For unit tests, exclude gates that are clearly e2e
      if (category === "test" && /e2e|test_e2e/i.test(joined)) return false;
      return true;
    });
  }

  if (!match) return undefined;
  return match.commands.join(" && ");
}

/**
 * Run quality verification on a repository and return metrics.
 * When boardGates are provided (from the board's quality gate configuration),
 * uses those commands for lint/typecheck/test instead of generic profile commands.
 * This ensures the quality runner uses the same service setup (docker compose),
 * env vars (DATABASE_URL), and tool invocations that the integration gates use.
 */
export async function runQualityVerification(
  repoPath: string,
  boardGates?: { name: string; trigger: string; commands: string[] }[]
): Promise<QualityMetrics> {
  console.log("[quality-runner] Running quality verification...");

  const metrics: QualityMetrics = {
    qualityScore: 0,
    lintScore: 100,
    lintErrors: 0,
    lintWarnings: 0,
    typecheckScore: 100,
    typeErrors: 0,
    testScore: 100,
    testsPassed: 0,
    testsFailed: 0,
    testsSkipped: 0,
    coverageScore: 0,
    coverageLines: 0,
    coverageBranches: 0,
    securityScore: 100,
    securityHigh: 0,
    securityMedium: 0,
    securityLow: 0,
  };

  // Detect project language via shared profiles
  const profile = detectLanguageWithTestRunner(repoPath);
  console.log(`[quality-runner] Detected language: ${profile.displayName}`);
  // For Go, find all module directories (including subdirectories)
  const goModDirs = profile.id === "go" ? findGoModDirs(repoPath) : [];
  const effectiveCwd = goModDirs[0] || repoPath;

  // Ensure dependencies are installed before running checks.
  // Stale or incomplete node_modules causes phantom type errors (e.g. 5000+ false TS errors).
  ensureDependenciesInstalled(effectiveCwd, profile.id);

  // When board gate commands are available, use them instead of generic profile commands.
  // This ensures the quality runner uses the same service setup (docker compose up),
  // env vars (DATABASE_URL), and tool invocations that experts and integration gates use.
  const boardLintCmd = boardGates?.length ? findBoardGateCommand(boardGates, "lint") : undefined;
  const boardTypecheckCmd = boardGates?.length ? findBoardGateCommand(boardGates, "typecheck") : undefined;
  const boardTestCmd = boardGates?.length ? findBoardGateCommand(boardGates, "test") : undefined;
  const boardTestE2eCmd = boardGates?.length ? findBoardGateCommand(boardGates, "test-e2e") : undefined;

  if (boardGates?.length) {
    const matched = [boardLintCmd && "lint", boardTypecheckCmd && "typecheck", boardTestCmd && "test", boardTestE2eCmd && "test-e2e"].filter(Boolean);
    console.log(`[quality-runner] Board gate commands available — using for: ${matched.join(", ") || "none (falling back to profile)"}`);
  }

  // Start services if any board gate uses docker compose (needed for tests).
  // Service gates are recognized by their commands containing "docker compose up".
  // Run them once before all checks; teardown happens at the end.
  let servicesStarted = false;
  if (boardGates?.length) {
    const serviceGate = boardGates.find((g) =>
      g.commands.some((c) => /docker\s+compose\s+up/i.test(c))
    );
    if (serviceGate) {
      const setupCmd = serviceGate.commands.join(" && ");
      console.log(`[quality-runner] Starting services: ${setupCmd}`);
      const serviceResult = runCommand(setupCmd, repoPath, 120000);
      if (serviceResult.exitCode === 0) {
        servicesStarted = true;
        console.log("[quality-runner] Services started successfully");
      } else {
        console.log(`[quality-runner] Service startup failed (exit ${serviceResult.exitCode}) — tests requiring services will be unavailable`);
      }
    }
  }

  // Run TypeCheck
  console.log("[quality-runner] Running typecheck...");
  let typecheckAvailable = true;
  const typecheckCmd = boardTypecheckCmd || profile.typecheck;
  if (typecheckCmd) {
    const typecheckResult = runCommand(typecheckCmd, effectiveCwd);
    const parsed = profile.parseTypecheck(typecheckResult.stdout, typecheckResult.stderr, typecheckResult.exitCode);
    metrics.typeErrors = parsed.errors;
    // If command failed but found 0 errors, the tool wasn't available (e.g. no tsconfig) — exclude from score
    if (!parsed.passed && parsed.errors === 0) {
      typecheckAvailable = false;
      metrics.typecheckScore = 0;
      console.log(`[quality-runner] Typecheck: unavailable (command failed with no errors found) — excluding from score`);
    } else {
      metrics.typecheckScore = parsed.passed ? 100 : 0;
      console.log(`[quality-runner] Typecheck (${boardTypecheckCmd ? "board gate" : profile.displayName}): ${metrics.typecheckScore}/100 (${metrics.typeErrors} errors)`);
    }
  } else {
    typecheckAvailable = false;
    metrics.typecheckScore = 0;
    console.log(`[quality-runner] Typecheck: skipped (not available for ${profile.displayName}) — excluding from score`);
  }

  // Run Lint
  console.log("[quality-runner] Running lint...");
  const lintCmd = boardLintCmd || profile.lint;
  if (lintCmd) {
    const lintResult = runCommand(lintCmd, effectiveCwd);
    const parsedLint = profile.parseLint(lintResult.stdout, lintResult.stderr);
    metrics.lintErrors = parsedLint.errors;
    metrics.lintWarnings = parsedLint.warnings;
    metrics.lintScore = Math.max(0, 100 - metrics.lintErrors);
    console.log(`[quality-runner] Lint (${boardLintCmd ? "board gate" : profile.displayName}): ${metrics.lintScore}/100 (${metrics.lintErrors} errors, ${metrics.lintWarnings} warnings)`);
  } else {
    metrics.lintScore = 100;
    console.log(`[quality-runner] Lint: skipped (not available for ${profile.displayName})`);
  }

  // Run Tests
  console.log("[quality-runner] Running tests...");
  let testsAvailable = true;
  {
    // Use board test command (includes DATABASE_URL, docker compose, etc.) or fall back to generic
    const testCmd = boardTestCmd || profile.test;
    const testResult = runCommand(testCmd, effectiveCwd, 300000);
    const parsedTests = profile.parseTests(testResult.stdout, testResult.stderr);
    metrics.testsPassed = parsedTests.passed;
    metrics.testsFailed = parsedTests.failed;
    metrics.testsSkipped = parsedTests.skipped;

    const totalTests = metrics.testsPassed + metrics.testsFailed + metrics.testsSkipped;
    // If runner failed but found no test results, tests are unavailable (missing deps, needs docker, etc.)
    if (totalTests === 0 && testResult.exitCode !== 0) {
      testsAvailable = false;
      metrics.testScore = 0;
      console.log(`[quality-runner] Tests: unavailable (runner failed with no test results) — excluding from score`);
    } else {
      metrics.testScore = totalTests > 0 ? Math.round((metrics.testsPassed / totalTests) * 100) : (testResult.exitCode === 0 ? 100 : 0);
      console.log(`[quality-runner] Tests (${boardTestCmd ? "board gate" : profile.displayName}): ${metrics.testScore}/100 (${metrics.testsPassed} passed, ${metrics.testsFailed} failed, ${metrics.testsSkipped} skipped)`);
    }

    // Extract coverage if available (Jest/Vitest format — TS only)
    if (profile.id === "typescript") {
      const coverageMatch = testResult.stdout.match(/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);
      if (coverageMatch) {
        metrics.coverageLines = parseFloat(coverageMatch[1]) || 0;
        metrics.coverageBranches = parseFloat(coverageMatch[2]) || 0;
        metrics.coverageScore = Math.round(metrics.coverageLines);
      }
    }
  }

  console.log(`[quality-runner] Coverage: ${metrics.coverageScore}/100 (${metrics.coverageLines}% lines)`);

  // Track coverage for changed files specifically
  console.log("[quality-runner] Analyzing changed file coverage...");
  const changedFiles = getChangedFiles(repoPath);
  metrics.changedFiles = changedFiles;

  if (changedFiles.length > 0) {
    const { avgCoverage, details } = getChangedFileCoverage(repoPath, changedFiles);
    metrics.changedFileCoverage = avgCoverage;
    metrics.changedFileCoverageDetails = details;
  }

  // Run Security Audit
  console.log("[quality-runner] Running security audit...");
  if (profile.audit) {
    const auditResult = runCommand(profile.audit, effectiveCwd);
    const parsedAudit = profile.parseAudit(auditResult.stdout);
    metrics.securityHigh = parsedAudit.high;
    metrics.securityMedium = parsedAudit.medium;
    metrics.securityLow = parsedAudit.low;
  }

  const securityDeduction = metrics.securityHigh * 20 + metrics.securityMedium * 5 + metrics.securityLow;
  metrics.securityScore = Math.max(0, 100 - securityDeduction);
  console.log(`[quality-runner] Security (${profile.displayName}): ${metrics.securityScore}/100 (${metrics.securityHigh}H/${metrics.securityMedium}M/${metrics.securityLow}L)`);

  // Run E2E tests if available
  console.log("[quality-runner] Checking for E2E tests...");
  try {
    if (boardTestE2eCmd) {
      // Board gate E2E command available — use it directly (includes env vars, service setup, etc.)
      metrics.e2eAvailable = true;
      console.log(`[quality-runner] Running E2E tests (board gate): ${boardTestE2eCmd}`);
      const e2eResult = runCommand(boardTestE2eCmd, repoPath, 600000);

      // Parse pytest-style output (e.g. "X passed, Y failed") and Playwright-style ("X passed")
      const parsedE2e = profile.parseTests(e2eResult.stdout, e2eResult.stderr);
      if (parsedE2e.passed > 0 || parsedE2e.failed > 0) {
        metrics.e2ePassed = parsedE2e.passed;
        metrics.e2eFailed = parsedE2e.failed;
        metrics.e2eSkipped = parsedE2e.skipped;
      } else {
        // Fallback: try Playwright-style output parsing
        const e2ePassMatch = e2eResult.stdout.match(/(\d+)\s+passed/i);
        const e2eFailMatch = e2eResult.stdout.match(/(\d+)\s+failed/i);
        const e2eSkipMatch = e2eResult.stdout.match(/(\d+)\s+skipped/i);
        metrics.e2ePassed = e2ePassMatch ? parseInt(e2ePassMatch[1]) : 0;
        metrics.e2eFailed = e2eFailMatch ? parseInt(e2eFailMatch[1]) : 0;
        metrics.e2eSkipped = e2eSkipMatch ? parseInt(e2eSkipMatch[1]) : 0;
      }

      const totalE2e = metrics.e2ePassed + metrics.e2eFailed + metrics.e2eSkipped;
      metrics.e2eScore = totalE2e > 0 ? Math.round((metrics.e2ePassed / totalE2e) * 100) : (e2eResult.exitCode === 0 ? 100 : 0);
      console.log(`[quality-runner] E2E (board gate): ${metrics.e2eScore}/100 (${metrics.e2ePassed} passed, ${metrics.e2eFailed} failed, ${metrics.e2eSkipped} skipped)`);

      if (metrics.e2eFailed > 0) {
        console.log(`[quality-runner] E2E TESTS FAILING — ${metrics.e2eFailed} failures must be fixed before PR creation`);
      }
    } else {
      // Fallback: check for test:e2e script in package.json (Playwright-style)
      const pkgJsonPath = path.join(repoPath, "package.json");
      if (fs.existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
        if (pkgJson.scripts?.["test:e2e"]) {
          metrics.e2eAvailable = true;
          console.log("[quality-runner] E2E test script found, attempting to run...");
          const e2eResult = runCommand(
            "npx playwright install --with-deps chromium 2>&1 && npm run test:e2e 2>&1",
            repoPath,
            600000
          );

          const e2ePassMatch = e2eResult.stdout.match(/(\d+)\s+passed/i);
          const e2eFailMatch = e2eResult.stdout.match(/(\d+)\s+failed/i);
          const e2eSkipMatch = e2eResult.stdout.match(/(\d+)\s+skipped/i);
          metrics.e2ePassed = e2ePassMatch ? parseInt(e2ePassMatch[1]) : 0;
          metrics.e2eFailed = e2eFailMatch ? parseInt(e2eFailMatch[1]) : 0;
          metrics.e2eSkipped = e2eSkipMatch ? parseInt(e2eSkipMatch[1]) : 0;

          const totalE2e = metrics.e2ePassed + metrics.e2eFailed + metrics.e2eSkipped;
          metrics.e2eScore = totalE2e > 0 ? Math.round((metrics.e2ePassed / totalE2e) * 100) : 100;
          console.log(`[quality-runner] E2E: ${metrics.e2eScore}/100 (${metrics.e2ePassed} passed, ${metrics.e2eFailed} failed, ${metrics.e2eSkipped} skipped)`);

          if (metrics.e2eFailed > 0) {
            console.log(`[quality-runner] E2E TESTS FAILING — ${metrics.e2eFailed} failures must be fixed before PR creation`);
          }
        } else {
          metrics.e2eAvailable = false;
          console.log("[quality-runner] No test:e2e script found — skipping E2E tests");
        }
      }
    }
  } catch (e2eError) {
    console.log(`[quality-runner] E2E tests skipped (error: ${e2eError instanceof Error ? e2eError.message : "unknown"})`);
    metrics.e2eAvailable = false;
  }

  // Calculate composite score
  // Exclude unavailable checks and redistribute their weight proportionally
  const hasCoverage = metrics.coverageScore > 0;
  const checkAvailability: Record<keyof typeof WEIGHTS, boolean> = {
    typecheck: typecheckAvailable,
    lint: true, // lint always runs (falls back to "no lint script")
    tests: testsAvailable,
    coverage: hasCoverage,
    security: true, // audit always runs
  };

  // Sum weights of available checks
  let availableWeight = 0;
  for (const [key, available] of Object.entries(checkAvailability)) {
    if (available) availableWeight += WEIGHTS[key as keyof typeof WEIGHTS];
  }

  // Guard: if no checks are available, default to 100 (nothing to score against)
  if (availableWeight === 0) {
    console.log(`[quality-runner] No checks available — defaulting composite score to 100`);
    metrics.qualityScore = 100;
    metrics.typecheckAvailable = typecheckAvailable;
    metrics.testsAvailable = testsAvailable;
    metrics.coverageAvailable = hasCoverage;
    return metrics;
  }

  // Redistribute: multiply each available weight by 1/availableWeight
  const effectiveWeights = {} as Record<keyof typeof WEIGHTS, number>;
  for (const key of Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>) {
    effectiveWeights[key] = checkAvailability[key] ? WEIGHTS[key] / availableWeight : 0;
  }

  const unavailableChecks = Object.entries(checkAvailability).filter(([, v]) => !v).map(([k]) => k);
  if (unavailableChecks.length > 0) {
    console.log(`[quality-runner] Unavailable checks: ${unavailableChecks.join(", ")} — redistributing weight to: ${Object.entries(checkAvailability).filter(([, v]) => v).map(([k]) => k).join(", ")}`);
  }

  metrics.qualityScore = Math.round(
    metrics.typecheckScore * effectiveWeights.typecheck +
    metrics.lintScore * effectiveWeights.lint +
    metrics.testScore * effectiveWeights.tests +
    metrics.coverageScore * effectiveWeights.coverage +
    metrics.securityScore * effectiveWeights.security
  );

  // Store availability flags for downstream consumers (PR report, etc.)
  metrics.typecheckAvailable = typecheckAvailable;
  metrics.testsAvailable = testsAvailable;
  metrics.coverageAvailable = hasCoverage;

  console.log("\n========================================");
  console.log("         CODE QUALITY METRICS          ");
  console.log("========================================");
  console.log(`  Overall Score: ${metrics.qualityScore}/100 ${getGrade(metrics.qualityScore)}`);
  console.log("----------------------------------------");
  console.log(`  TypeCheck:  ${typecheckAvailable ? `${metrics.typecheckScore}/100 (${metrics.typeErrors} errors)` : "---/100 (unavailable)"}`);
  console.log(`  Lint:       ${metrics.lintScore}/100 (${metrics.lintErrors} errors, ${metrics.lintWarnings} warnings)`);
  console.log(`  Tests:      ${testsAvailable ? `${metrics.testScore}/100 (${metrics.testsPassed} passed, ${metrics.testsFailed} failed)` : "---/100 (unavailable)"}`);
  console.log(`  Coverage:   ${hasCoverage ? `${metrics.coverageScore}/100 (${metrics.coverageLines}% lines)` : "---/100 (unavailable)"}`);
  if (metrics.changedFileCoverage !== undefined) {
    console.log(`  Changed:    ${metrics.changedFileCoverage}% (${metrics.changedFiles?.length || 0} files)`);
  }
  console.log(`  Security:   ${metrics.securityScore}/100 (${metrics.securityHigh}H/${metrics.securityMedium}M/${metrics.securityLow}L)`);
  if (metrics.e2eAvailable) {
    console.log(`  E2E Tests:  ${metrics.e2eScore}/100 (${metrics.e2ePassed} passed, ${metrics.e2eFailed} failed, ${metrics.e2eSkipped} skipped)`);
  }
  console.log("========================================\n");

  // Tear down services if we started them (docker compose down)
  if (servicesStarted) {
    console.log("[quality-runner] Stopping services (docker compose down)...");
    try {
      runCommand("docker compose down --remove-orphans", repoPath, 60000);
      console.log("[quality-runner] Services stopped");
    } catch {
      console.log("[quality-runner] Service teardown failed (non-fatal)");
    }
  }

  return metrics;
}

function getGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

/**
 * Post quality metrics to WorkerMill API
 */
export async function postQualityMetrics(
  apiUrl: string,
  apiKey: string,
  taskId: string,
  metrics: QualityMetrics
): Promise<boolean> {
  const body = JSON.stringify({
    qualityMetrics: {
      qualityScore: metrics.qualityScore,
      lintScore: metrics.lintScore,
      lintErrors: metrics.lintErrors,
      lintWarnings: metrics.lintWarnings,
      typecheckScore: metrics.typecheckScore,
      typeErrors: metrics.typeErrors,
      testScore: metrics.testScore,
      testsPassed: metrics.testsPassed,
      testsFailed: metrics.testsFailed,
      testsSkipped: metrics.testsSkipped,
      coverageScore: metrics.coverageScore,
      coverageLines: metrics.coverageLines,
      coverageBranches: metrics.coverageBranches,
      securityScore: metrics.securityScore,
      securityHigh: metrics.securityHigh,
      securityMedium: metrics.securityMedium,
      securityLow: metrics.securityLow,
      // Changed file coverage tracking
      changedFiles: metrics.changedFiles,
      changedFileCoverage: metrics.changedFileCoverage,
      changedFileCoverageDetails: metrics.changedFileCoverageDetails,
      analysisJson: metrics,
    },
  });

  return new Promise((resolve) => {
    const url = `${apiUrl}/api/tasks/${taskId}/quality-metrics`;
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === "https:" ? https : http;

    console.log(`[quality-runner] Posting metrics to ${url}`);

    const req = protocol.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "X-API-Key": apiKey,
        },
      },
      (res) => {
        const success = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300;
        if (success) {
          console.log(`[quality-runner] Posted quality metrics: score=${metrics.qualityScore}`);
        } else {
          console.error(`[quality-runner] Failed to post metrics: ${res.statusCode}`);
        }
        resolve(success);
      }
    );

    req.on("error", (err) => {
      console.error(`[quality-runner] Error posting metrics: ${err.message}`);
      resolve(false);
    });

    req.write(body);
    req.end();
  });
}

/**
 * Generate coverage report markdown for PR body.
 * Includes overall coverage and per-file coverage for changed files.
 */
export function generateCoverageReport(metrics: QualityMetrics): string {
  const lines: string[] = [];

  lines.push("### Test Coverage");
  lines.push("");

  // Overall coverage
  const coverageEmoji = metrics.coverageLines >= 80 ? "🟢" : metrics.coverageLines >= 60 ? "🟡" : "🔴";
  lines.push(`${coverageEmoji} **Overall**: ${metrics.coverageLines.toFixed(1)}% lines, ${metrics.coverageBranches.toFixed(1)}% branches`);

  // Changed file coverage
  if (metrics.changedFileCoverage !== undefined && metrics.changedFiles && metrics.changedFiles.length > 0) {
    lines.push("");
    const changedEmoji = metrics.changedFileCoverage >= 80 ? "🟢" : metrics.changedFileCoverage >= 60 ? "🟡" : "🔴";
    lines.push(`${changedEmoji} **Changed Files**: ${metrics.changedFileCoverage}% average`);

    // Per-file breakdown
    if (metrics.changedFileCoverageDetails && metrics.changedFileCoverageDetails.length > 0) {
      lines.push("");
      lines.push("<details>");
      lines.push(`<summary>Coverage for ${metrics.changedFileCoverageDetails.length} changed files</summary>`);
      lines.push("");
      lines.push("| File | Lines | Branches | Status |");
      lines.push("|------|-------|----------|--------|");

      for (const detail of metrics.changedFileCoverageDetails) {
        const status = detail.covered ? (detail.lines >= 80 ? "✅" : "⚠️") : "❌";
        const shortFile = detail.file.length > 50 ? "..." + detail.file.slice(-47) : detail.file;
        lines.push(`| \`${shortFile}\` | ${detail.lines}% | ${detail.branches}% | ${status} |`);
      }

      lines.push("");
      lines.push("</details>");
    }
  } else if (metrics.changedFiles && metrics.changedFiles.length === 0) {
    lines.push("");
    lines.push("*No source files changed*");
  }

  return lines.join("\n");
}

/**
 * Generate full quality metrics section for PR body.
 * Includes overall score, all metric categories, and coverage report.
 */
/**
 * Generate security vulnerability summary markdown for PR body.
 */
export function generateSecuritySummary(metrics: QualityMetrics): string {
  const lines: string[] = [];

  lines.push("### Security Findings");
  lines.push("");

  // Overall security score
  const scoreEmoji = metrics.securityScore === 100 ? "🟢" : metrics.securityScore >= 80 ? "🟡" : "🔴";
  lines.push(`${scoreEmoji} **Security Score**: ${metrics.securityScore}/100`);
  lines.push("");

  // Vulnerability counts
  const totalVulns = metrics.securityHigh + metrics.securityMedium + metrics.securityLow;

  if (totalVulns === 0) {
    lines.push("✅ **No vulnerabilities detected**");
  } else {
    lines.push("| Severity | Count | Impact |");
    lines.push("|----------|-------|--------|");

    if (metrics.securityHigh > 0) {
      lines.push(`| 🔴 Critical/High | ${metrics.securityHigh} | -${metrics.securityHigh * 20} points |`);
    }
    if (metrics.securityMedium > 0) {
      lines.push(`| 🟠 Medium | ${metrics.securityMedium} | -${metrics.securityMedium * 5} points |`);
    }
    if (metrics.securityLow > 0) {
      lines.push(`| 🟡 Low/Info | ${metrics.securityLow} | -${metrics.securityLow} points |`);
    }

    lines.push("");
    lines.push(`**Total**: ${totalVulns} vulnerabilities found`);

    if (metrics.securityHigh > 0) {
      lines.push("");
      lines.push("> ⚠️ **Action Required**: Critical/high severity vulnerabilities should be addressed before merging.");
    }
  }

  return lines.join("\n");
}

export function generateQualityMetricsPrSection(metrics: QualityMetrics): string {
  const lines: string[] = [];

  lines.push("### Quality Metrics");
  lines.push("");

  // Overall score with grade
  const grade = getGrade(metrics.qualityScore);
  const scoreEmoji = grade === "A" ? "🏆" : grade === "B" ? "🟢" : grade === "C" ? "🟡" : "🔴";
  lines.push(`${scoreEmoji} **Overall Score**: ${metrics.qualityScore}/100 (Grade: ${grade})`);
  lines.push("");

  // Summary table
  lines.push("| Category | Score | Details |");
  lines.push("|----------|-------|---------|");

  // TypeCheck
  if (metrics.typecheckAvailable === false) {
    lines.push(`| TypeCheck | ⏭️ N/A | not available (excluded from score) |`);
  } else {
    const typeIcon = metrics.typecheckScore === 100 ? "✅" : "❌";
    lines.push(`| TypeCheck | ${typeIcon} ${metrics.typecheckScore}/100 | ${metrics.typeErrors} errors |`);
  }

  // Lint
  const lintIcon = metrics.lintScore >= 90 ? "✅" : metrics.lintScore >= 70 ? "⚠️" : "❌";
  lines.push(`| Lint | ${lintIcon} ${metrics.lintScore}/100 | ${metrics.lintErrors} errors, ${metrics.lintWarnings} warnings |`);

  // Tests
  if (metrics.testsAvailable === false) {
    lines.push(`| Tests | ⏭️ N/A | not available (excluded from score) |`);
  } else {
    const testIcon = metrics.testScore === 100 ? "✅" : metrics.testScore >= 80 ? "⚠️" : "❌";
    lines.push(`| Tests | ${testIcon} ${metrics.testScore}/100 | ${metrics.testsPassed} passed, ${metrics.testsFailed} failed, ${metrics.testsSkipped} skipped |`);
  }

  // Coverage
  if (metrics.coverageAvailable === false) {
    lines.push(`| Coverage | ⏭️ N/A | not available (excluded from score) |`);
  } else {
    const covIcon = metrics.coverageScore >= 80 ? "✅" : metrics.coverageScore >= 60 ? "⚠️" : "❌";
    lines.push(`| Coverage | ${covIcon} ${metrics.coverageScore}/100 | ${metrics.coverageLines.toFixed(1)}% lines |`);
  }

  // Changed file coverage
  if (metrics.changedFileCoverage !== undefined) {
    const changedIcon = metrics.changedFileCoverage >= 80 ? "✅" : metrics.changedFileCoverage >= 60 ? "⚠️" : "❌";
    lines.push(`| Changed Files | ${changedIcon} ${metrics.changedFileCoverage}% | ${metrics.changedFiles?.length || 0} files |`);
  }

  // Security
  const secIcon = metrics.securityScore === 100 ? "✅" : metrics.securityScore >= 80 ? "⚠️" : "❌";
  lines.push(`| Security | ${secIcon} ${metrics.securityScore}/100 | ${metrics.securityHigh}H/${metrics.securityMedium}M/${metrics.securityLow}L vulns |`);

  // Per-file coverage details (collapsible)
  if (metrics.changedFileCoverageDetails && metrics.changedFileCoverageDetails.length > 0) {
    lines.push("");
    lines.push("<details>");
    lines.push(`<summary>📊 Changed file coverage breakdown (${metrics.changedFileCoverageDetails.length} files)</summary>`);
    lines.push("");
    lines.push("| File | Lines | Branches | Status |");
    lines.push("|------|-------|----------|--------|");

    for (const detail of metrics.changedFileCoverageDetails) {
      const status = detail.covered ? (detail.lines >= 80 ? "✅" : "⚠️") : "❌";
      const shortFile = detail.file.length > 50 ? "..." + detail.file.slice(-47) : detail.file;
      lines.push(`| \`${shortFile}\` | ${detail.lines}% | ${detail.branches}% | ${status} |`);
    }

    lines.push("");
    lines.push("</details>");
  }

  return lines.join("\n");
}

/**
 * Run targeted tests for a set of changed files.
 * Detects the test runner (jest, vitest, pytest) and runs only related tests.
 * Falls back to full test suite if no targeted runner is detected.
 */
export function runTargetedTests(
  repoPath: string,
  changedFiles: string[],
  timeoutMs: number = 300000
): TargetedTestResult {
  if (changedFiles.length === 0) {
    console.log("[quality-runner] No changed files — skipping targeted tests");
    return { passed: true, stdout: "", stderr: "", exitCode: 0, testRunner: "none" };
  }

  const profile = detectLanguageWithTestRunner(repoPath);

  if (profile.testTargeted) {
    const cmd = profile.testTargeted(changedFiles);
    console.log(`[quality-runner] Running targeted tests (${profile.displayName}) for ${changedFiles.length} files`);
    const result = runCommand(cmd, repoPath, timeoutMs);
    const runner = profile.id === "typescript" ? (cmd.includes("vitest") ? "vitest" : cmd.includes("jest") ? "jest" : "npm_test") : profile.id === "python" ? "pytest" : "npm_test";
    return { ...result, passed: result.exitCode === 0, testRunner: runner as TargetedTestResult["testRunner"] };
  }

  // No targeted test support — fall back to full test suite
  console.log(`[quality-runner] No targeted tests for ${profile.displayName} — running full suite`);
  const result = runCommand(profile.test, repoPath, timeoutMs);
  return { ...result, passed: result.exitCode === 0, testRunner: "npm_test" };
}
