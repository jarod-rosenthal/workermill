/**
 * Quality Gate - Enforce quality thresholds before PR creation
 *
 * This module evaluates quality metrics against organization-defined thresholds
 * and determines whether a PR should be created or blocked.
 */

import type { QualityMetrics } from "./quality-runner.js";

/**
 * Organization quality thresholds configuration.
 */
export interface QualityThresholds {
  /** Whether quality gates are enabled for this organization */
  qualityGateEnabled: boolean;
  /** Minimum overall quality score (0-100) */
  minQualityScore: number | null;
  /** Minimum test coverage percentage (0-100) */
  minTestCoveragePercent: number | null;
  /** Maximum allowed high-severity security vulnerabilities */
  maxSecurityHighVulns: number | null;
  /** Whether to block on any type errors */
  blockOnTypeErrors: boolean;
  /** Whether to block on any test failures */
  blockOnTestFailures: boolean;
}

/**
 * Individual quality check result.
 */
export interface QualityCheckResult {
  name: string;
  passed: boolean;
  actual: number | string;
  threshold: number | string;
  message: string;
}

/**
 * Overall quality gate evaluation result.
 */
export interface QualityGateResult {
  /** Whether the quality gate passed */
  passed: boolean;
  /** Whether quality gate was bypassed (e.g., via label) */
  bypassed: boolean;
  /** Reason for bypass if applicable */
  bypassReason?: string;
  /** Individual check results */
  checks: QualityCheckResult[];
  /** Summary message */
  summary: string;
  /** Failure reasons (only populated if passed=false) */
  failureReasons: string[];
}

/**
 * Default thresholds (permissive - quality gate disabled by default).
 */
export const DEFAULT_THRESHOLDS: QualityThresholds = {
  qualityGateEnabled: false,
  minQualityScore: null,
  minTestCoveragePercent: null,
  maxSecurityHighVulns: null,
  blockOnTypeErrors: false,
  blockOnTestFailures: false,
};

/**
 * Evaluate quality metrics against thresholds.
 *
 * @param metrics - Quality metrics from quality-runner
 * @param thresholds - Organization quality thresholds
 * @param bypass - Whether to bypass quality gate (e.g., from Jira label)
 * @param bypassReason - Reason for bypass
 * @returns Quality gate result
 */
export function evaluateQualityGate(
  metrics: QualityMetrics,
  thresholds: QualityThresholds,
  bypass: boolean = false,
  bypassReason?: string
): QualityGateResult {
  const checks: QualityCheckResult[] = [];
  const failureReasons: string[] = [];

  // If quality gate is disabled, auto-pass
  if (!thresholds.qualityGateEnabled) {
    return {
      passed: true,
      bypassed: true,
      bypassReason: "Quality gate disabled for organization",
      checks: [],
      summary: "Quality gate disabled - all PRs allowed",
      failureReasons: [],
    };
  }

  // If bypass flag is set, skip all checks
  if (bypass) {
    return {
      passed: true,
      bypassed: true,
      bypassReason: bypassReason || "Bypass label set",
      checks: [],
      summary: `Quality gate bypassed: ${bypassReason || "Bypass label set"}`,
      failureReasons: [],
    };
  }

  // Check 1: Minimum quality score
  if (thresholds.minQualityScore !== null) {
    const passed = metrics.qualityScore >= thresholds.minQualityScore;
    checks.push({
      name: "quality_score",
      passed,
      actual: metrics.qualityScore,
      threshold: thresholds.minQualityScore,
      message: passed
        ? `Quality score ${metrics.qualityScore}% meets minimum ${thresholds.minQualityScore}%`
        : `Quality score ${metrics.qualityScore}% below minimum ${thresholds.minQualityScore}%`,
    });
    if (!passed) {
      failureReasons.push(`Quality score (${metrics.qualityScore}%) below threshold (${thresholds.minQualityScore}%)`);
    }
  }

  // Check 2: Minimum test coverage
  if (thresholds.minTestCoveragePercent !== null) {
    const passed = metrics.coverageLines >= thresholds.minTestCoveragePercent;
    checks.push({
      name: "test_coverage",
      passed,
      actual: metrics.coverageLines,
      threshold: thresholds.minTestCoveragePercent,
      message: passed
        ? `Test coverage ${metrics.coverageLines}% meets minimum ${thresholds.minTestCoveragePercent}%`
        : `Test coverage ${metrics.coverageLines}% below minimum ${thresholds.minTestCoveragePercent}%`,
    });
    if (!passed) {
      failureReasons.push(`Test coverage (${metrics.coverageLines}%) below threshold (${thresholds.minTestCoveragePercent}%)`);
    }
  }

  // Check 3: Maximum high-severity security vulnerabilities
  if (thresholds.maxSecurityHighVulns !== null) {
    const passed = metrics.securityHigh <= thresholds.maxSecurityHighVulns;
    checks.push({
      name: "security_high",
      passed,
      actual: metrics.securityHigh,
      threshold: thresholds.maxSecurityHighVulns,
      message: passed
        ? `High-severity vulnerabilities (${metrics.securityHigh}) within limit (${thresholds.maxSecurityHighVulns})`
        : `High-severity vulnerabilities (${metrics.securityHigh}) exceed limit (${thresholds.maxSecurityHighVulns})`,
    });
    if (!passed) {
      failureReasons.push(`High-severity vulnerabilities (${metrics.securityHigh}) exceed threshold (${thresholds.maxSecurityHighVulns})`);
    }
  }

  // Check 4: Type errors
  if (thresholds.blockOnTypeErrors) {
    const passed = metrics.typeErrors === 0;
    checks.push({
      name: "type_errors",
      passed,
      actual: metrics.typeErrors,
      threshold: 0,
      message: passed
        ? "No TypeScript errors"
        : `${metrics.typeErrors} TypeScript error(s) detected`,
    });
    if (!passed) {
      failureReasons.push(`${metrics.typeErrors} TypeScript error(s) must be fixed`);
    }
  }

  // Check 5: Test failures
  if (thresholds.blockOnTestFailures) {
    const passed = metrics.testsFailed === 0;
    checks.push({
      name: "test_failures",
      passed,
      actual: metrics.testsFailed,
      threshold: 0,
      message: passed
        ? "All tests passing"
        : `${metrics.testsFailed} test(s) failing`,
    });
    if (!passed) {
      failureReasons.push(`${metrics.testsFailed} test failure(s) must be fixed`);
    }
  }

  // Determine overall pass/fail
  const allPassed = checks.every((c) => c.passed);
  const passedCount = checks.filter((c) => c.passed).length;

  return {
    passed: allPassed,
    bypassed: false,
    checks,
    summary: allPassed
      ? `Quality gate passed: ${passedCount}/${checks.length} checks`
      : `Quality gate failed: ${failureReasons.length} issue(s) found`,
    failureReasons,
  };
}

/**
 * Format quality gate result for logging.
 */
export function formatQualityGateResult(result: QualityGateResult): string {
  const lines: string[] = [];

  lines.push("========================================");
  lines.push("         QUALITY GATE RESULT           ");
  lines.push("========================================");

  if (result.bypassed) {
    lines.push(`  Status: BYPASSED`);
    lines.push(`  Reason: ${result.bypassReason}`);
  } else if (result.passed) {
    lines.push(`  Status: PASSED ✅`);
  } else {
    lines.push(`  Status: FAILED ❌`);
  }

  lines.push("----------------------------------------");

  if (result.checks.length > 0) {
    for (const check of result.checks) {
      const icon = check.passed ? "✅" : "❌";
      lines.push(`  ${icon} ${check.name}: ${check.message}`);
    }
  }

  if (result.failureReasons.length > 0) {
    lines.push("----------------------------------------");
    lines.push("  Failures:");
    for (const reason of result.failureReasons) {
      lines.push(`    - ${reason}`);
    }
  }

  lines.push("========================================");

  return lines.join("\n");
}

/**
 * Generate PR body section for quality gate results.
 */
export function generateQualityGatePrSection(result: QualityGateResult): string {
  if (result.bypassed) {
    return `***REMOVED******REMOVED******REMOVED*** Quality Gate
⚠️ **Bypassed**: ${result.bypassReason}
`;
  }

  const lines: string[] = [];
  lines.push("***REMOVED******REMOVED******REMOVED*** Quality Gate");
  lines.push("");

  if (result.passed) {
    lines.push("✅ **Passed**");
  } else {
    lines.push("❌ **Failed** (PR created with bypass)");
  }

  lines.push("");
  lines.push("| Check | Result | Actual | Threshold |");
  lines.push("|-------|--------|--------|-----------|");

  for (const check of result.checks) {
    const icon = check.passed ? "✅" : "❌";
    lines.push(`| ${check.name} | ${icon} | ${check.actual} | ${check.threshold} |`);
  }

  lines.push("");

  return lines.join("\n");
}
