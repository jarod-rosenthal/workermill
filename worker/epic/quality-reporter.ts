/**
 * Quality Reporter - Extract metrics from verify phase and report to API
 *
 * This module:
 * 1. Extracts quality metrics from verify phase outputs
 * 2. Runs additional security audit if not already done
 * 3. Calculates composite quality score
 * 4. Posts metrics to WorkerMill API
 */

import { execSync } from "child_process";
import * as https from "https";
import * as http from "http";
import { VerifyOutputs, CommandOutput } from "./phased-types.js";

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

interface SecurityMetrics {
  high: number;
  medium: number;
  low: number;
}

function runSecurityAudit(repoPath: string): SecurityMetrics {
  const metrics: SecurityMetrics = { high: 0, medium: 0, low: 0 };

  try {
    const result = execSync("npm audit --json 2>/dev/null || echo '{}'", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 60000,
    });

    const audit = JSON.parse(result || "{}");
    const vulnerabilities = audit.vulnerabilities || {};

    for (const vuln of Object.values(vulnerabilities) as Array<{ severity: string }>) {
      switch (vuln.severity) {
        case "critical":
        case "high":
          metrics.high++;
          break;
        case "moderate":
        case "medium":
          metrics.medium++;
          break;
        case "low":
        case "info":
          metrics.low++;
          break;
      }
    }
  } catch {
    // Ignore errors, return zeros
  }

  return metrics;
}

function extractLintMetrics(commandOutputs: CommandOutput[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;

  for (const cmd of commandOutputs) {
    if (cmd.command.includes("lint") || cmd.command.includes("eslint")) {
      // Try to parse ESLint output
      const errorMatch = cmd.truncatedLog.match(/(\d+)\s+error/i);
      const warnMatch = cmd.truncatedLog.match(/(\d+)\s+warning/i);
      const problemsMatch = cmd.truncatedLog.match(/(\d+)\s+problems?\s*\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)/i);

      if (problemsMatch) {
        errors += parseInt(problemsMatch[2]) || 0;
        warnings += parseInt(problemsMatch[3]) || 0;
      } else {
        if (errorMatch) errors += parseInt(errorMatch[1]) || 0;
        if (warnMatch) warnings += parseInt(warnMatch[1]) || 0;
      }
    }
  }

  return { errors, warnings };
}

function extractTypeErrors(commandOutputs: CommandOutput[]): number {
  let typeErrors = 0;

  for (const cmd of commandOutputs) {
    if (cmd.command.includes("typecheck") || cmd.command.includes("tsc")) {
      // Count TypeScript errors
      const matches = cmd.truncatedLog.match(/error TS\d+/g);
      typeErrors += matches ? matches.length : 0;
    }
  }

  return typeErrors;
}

function extractCoverage(commandOutputs: CommandOutput[]): { lines: number; branches: number } {
  let lines = 0;
  let branches = 0;

  for (const cmd of commandOutputs) {
    if (cmd.command.includes("test") || cmd.command.includes("coverage")) {
      // Try to parse coverage from Jest/Vitest output
      // Format: All files | 85.5 | 72.3 | 90.1 | 85.5
      const coverageMatch = cmd.truncatedLog.match(
        /All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/
      );
      if (coverageMatch) {
        lines = parseFloat(coverageMatch[1]) || 0;
        branches = parseFloat(coverageMatch[2]) || 0;
      }
    }
  }

  return { lines, branches };
}

/**
 * Extract quality metrics from verify phase outputs
 */
export function extractQualityMetrics(
  verifyOutputs: VerifyOutputs,
  repoPath: string
): QualityMetrics {
  // Extract lint metrics
  const lint = extractLintMetrics(verifyOutputs.commandOutputs);
  const lintScore = Math.max(0, 100 - lint.errors);

  // Extract typecheck metrics
  const typeErrors = extractTypeErrors(verifyOutputs.commandOutputs);
  const typecheckScore = verifyOutputs.typeCheckPassed ? 100 : 0;

  // Extract test metrics
  const testsPassed = verifyOutputs.testResults?.passed ?? 0;
  const testsFailed = verifyOutputs.testResults?.failed ?? 0;
  const testsSkipped = verifyOutputs.testResults?.skipped ?? 0;
  const totalTests = testsPassed + testsFailed + testsSkipped;
  const testScore = totalTests > 0 ? Math.round((testsPassed / totalTests) * 100) : 100;

  // Extract coverage metrics
  const coverage = extractCoverage(verifyOutputs.commandOutputs);
  const coverageScore = Math.round(coverage.lines);

  // Run security audit
  const security = runSecurityAudit(repoPath);
  const securityDeduction = security.high * 20 + security.medium * 5 + security.low;
  const securityScore = Math.max(0, 100 - securityDeduction);

  // Calculate composite score
  const qualityScore = Math.round(
    lintScore * WEIGHTS.lint +
    typecheckScore * WEIGHTS.typecheck +
    testScore * WEIGHTS.tests +
    coverageScore * WEIGHTS.coverage +
    securityScore * WEIGHTS.security
  );

  return {
    qualityScore,
    lintScore,
    lintErrors: lint.errors,
    lintWarnings: lint.warnings,
    typecheckScore,
    typeErrors,
    testScore,
    testsPassed,
    testsFailed,
    testsSkipped,
    coverageScore,
    coverageLines: coverage.lines,
    coverageBranches: coverage.branches,
    securityScore,
    securityHigh: security.high,
    securityMedium: security.medium,
    securityLow: security.low,
  };
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
          console.log(`[quality-reporter] Posted quality metrics: score=${metrics.qualityScore}`);
        } else {
          console.error(`[quality-reporter] Failed to post metrics: ${res.statusCode}`);
        }
        resolve(success);
      }
    );

    req.on("error", (err) => {
      console.error(`[quality-reporter] Error posting metrics: ${err.message}`);
      resolve(false);
    });

    req.write(body);
    req.end();
  });
}

/**
 * Log quality metrics summary to console
 */
export function logQualityMetrics(metrics: QualityMetrics): void {
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
}

function getGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}
