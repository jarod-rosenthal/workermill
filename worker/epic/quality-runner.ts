/**
 * Quality Runner - Run verification commands and extract quality metrics
 *
 * This module runs actual verification commands (typecheck, lint, test, audit)
 * on the repository and extracts quality metrics from the output.
 */

import { execSync } from "child_process";
import * as https from "https";
import * as http from "http";

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
 * Run quality verification on a repository and return metrics.
 */
export async function runQualityVerification(repoPath: string): Promise<QualityMetrics> {
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

  // Run TypeCheck
  console.log("[quality-runner] Running typecheck...");
  const typecheckResult = runCommand("npm run typecheck 2>&1 || npx tsc --noEmit 2>&1 || echo 'no typecheck'", repoPath);
  const typeErrors = (typecheckResult.stdout.match(/error TS\d+/g) || []).length;
  metrics.typeErrors = typeErrors;
  metrics.typecheckScore = typeErrors === 0 && typecheckResult.exitCode === 0 ? 100 : 0;
  console.log(`[quality-runner] Typecheck: ${metrics.typecheckScore}/100 (${typeErrors} errors)`);

  // Run Lint
  console.log("[quality-runner] Running lint...");
  const lintResult = runCommand("npm run lint 2>&1 || echo 'no lint script'", repoPath);

  // Parse ESLint output for error/warning counts
  const problemsMatch = lintResult.stdout.match(/(\d+)\s+problems?\s*\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)/i);
  if (problemsMatch) {
    metrics.lintErrors = parseInt(problemsMatch[2]) || 0;
    metrics.lintWarnings = parseInt(problemsMatch[3]) || 0;
  } else {
    // Try alternate format
    const errorMatch = lintResult.stdout.match(/(\d+)\s+errors?/i);
    const warnMatch = lintResult.stdout.match(/(\d+)\s+warnings?/i);
    if (errorMatch) metrics.lintErrors = parseInt(errorMatch[1]) || 0;
    if (warnMatch) metrics.lintWarnings = parseInt(warnMatch[1]) || 0;
  }
  metrics.lintScore = Math.max(0, 100 - metrics.lintErrors);
  console.log(`[quality-runner] Lint: ${metrics.lintScore}/100 (${metrics.lintErrors} errors, ${metrics.lintWarnings} warnings)`);

  // Run Tests
  console.log("[quality-runner] Running tests...");
  const testResult = runCommand("npm test 2>&1 || echo 'no test script'", repoPath, 300000); // 5 min timeout for tests

  // Parse test output (Jest/Vitest format)
  // Look for patterns like "Tests: 5 passed, 2 failed, 1 skipped"
  const testsLineMatch = testResult.stdout.match(/Tests:\s*(\d+)\s*passed(?:,\s*(\d+)\s*failed)?(?:,\s*(\d+)\s*(?:skipped|todo))?/i);
  if (testsLineMatch) {
    metrics.testsPassed = parseInt(testsLineMatch[1]) || 0;
    metrics.testsFailed = parseInt(testsLineMatch[2]) || 0;
    metrics.testsSkipped = parseInt(testsLineMatch[3]) || 0;
  } else {
    // Try alternate format: "X passing", "X failing"
    const passMatch = testResult.stdout.match(/(\d+)\s+pass(?:ing|ed)?/i);
    const failMatch = testResult.stdout.match(/(\d+)\s+fail(?:ing|ed)?/i);
    const skipMatch = testResult.stdout.match(/(\d+)\s+(?:skipped|pending)/i);
    if (passMatch) metrics.testsPassed = parseInt(passMatch[1]) || 0;
    if (failMatch) metrics.testsFailed = parseInt(failMatch[1]) || 0;
    if (skipMatch) metrics.testsSkipped = parseInt(skipMatch[1]) || 0;
  }

  const totalTests = metrics.testsPassed + metrics.testsFailed + metrics.testsSkipped;
  metrics.testScore = totalTests > 0 ? Math.round((metrics.testsPassed / totalTests) * 100) : 100;
  console.log(`[quality-runner] Tests: ${metrics.testScore}/100 (${metrics.testsPassed} passed, ${metrics.testsFailed} failed, ${metrics.testsSkipped} skipped)`);

  // Extract coverage if available
  const coverageMatch = testResult.stdout.match(/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);
  if (coverageMatch) {
    metrics.coverageLines = parseFloat(coverageMatch[1]) || 0;
    metrics.coverageBranches = parseFloat(coverageMatch[2]) || 0;
    metrics.coverageScore = Math.round(metrics.coverageLines);
  }
  console.log(`[quality-runner] Coverage: ${metrics.coverageScore}/100 (${metrics.coverageLines}% lines)`);

  // Run Security Audit
  console.log("[quality-runner] Running security audit...");
  const auditResult = runCommand("npm audit --json 2>/dev/null || echo '{}'", repoPath);
  try {
    const audit = JSON.parse(auditResult.stdout || "{}");
    const vulns = audit.metadata?.vulnerabilities || audit.vulnerabilities || {};

    // Handle both old and new npm audit formats
    if (typeof vulns === "object") {
      if ("critical" in vulns || "high" in vulns) {
        // New format: metadata.vulnerabilities has counts
        metrics.securityHigh = (vulns.critical || 0) + (vulns.high || 0);
        metrics.securityMedium = vulns.moderate || 0;
        metrics.securityLow = (vulns.low || 0) + (vulns.info || 0);
      } else {
        // Old format: vulnerabilities is an object with package names
        for (const vuln of Object.values(vulns) as Array<{ severity?: string }>) {
          if (!vuln.severity) continue;
          switch (vuln.severity) {
            case "critical":
            case "high":
              metrics.securityHigh++;
              break;
            case "moderate":
            case "medium":
              metrics.securityMedium++;
              break;
            case "low":
            case "info":
              metrics.securityLow++;
              break;
          }
        }
      }
    }
  } catch {
    // Ignore parse errors
  }

  const securityDeduction = metrics.securityHigh * 20 + metrics.securityMedium * 5 + metrics.securityLow;
  metrics.securityScore = Math.max(0, 100 - securityDeduction);
  console.log(`[quality-runner] Security: ${metrics.securityScore}/100 (${metrics.securityHigh}H/${metrics.securityMedium}M/${metrics.securityLow}L)`);

  // Calculate composite score
  metrics.qualityScore = Math.round(
    metrics.typecheckScore * WEIGHTS.typecheck +
    metrics.lintScore * WEIGHTS.lint +
    metrics.testScore * WEIGHTS.tests +
    metrics.coverageScore * WEIGHTS.coverage +
    metrics.securityScore * WEIGHTS.security
  );

  console.log("\n========================================");
  console.log("         CODE QUALITY METRICS          ");
  console.log("========================================");
  console.log(`  Overall Score: ${metrics.qualityScore}/100 ${getGrade(metrics.qualityScore)}`);
  console.log("----------------------------------------");
  console.log(`  TypeCheck:  ${metrics.typecheckScore}/100 (${metrics.typeErrors} errors)`);
  console.log(`  Lint:       ${metrics.lintScore}/100 (${metrics.lintErrors} errors, ${metrics.lintWarnings} warnings)`);
  console.log(`  Tests:      ${metrics.testScore}/100 (${metrics.testsPassed} passed, ${metrics.testsFailed} failed)`);
  console.log(`  Coverage:   ${metrics.coverageScore}/100 (${metrics.coverageLines}% lines)`);
  console.log(`  Security:   ${metrics.securityScore}/100 (${metrics.securityHigh}H/${metrics.securityMedium}M/${metrics.securityLow}L)`);
  console.log("========================================\n");

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
