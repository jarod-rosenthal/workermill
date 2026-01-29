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
  if (metrics.changedFileCoverage !== undefined) {
    console.log(`  Changed:    ${metrics.changedFileCoverage}% (${metrics.changedFiles?.length || 0} files)`);
  }
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
  const typeIcon = metrics.typecheckScore === 100 ? "✅" : "❌";
  lines.push(`| TypeCheck | ${typeIcon} ${metrics.typecheckScore}/100 | ${metrics.typeErrors} errors |`);

  // Lint
  const lintIcon = metrics.lintScore >= 90 ? "✅" : metrics.lintScore >= 70 ? "⚠️" : "❌";
  lines.push(`| Lint | ${lintIcon} ${metrics.lintScore}/100 | ${metrics.lintErrors} errors, ${metrics.lintWarnings} warnings |`);

  // Tests
  const testIcon = metrics.testScore === 100 ? "✅" : metrics.testScore >= 80 ? "⚠️" : "❌";
  lines.push(`| Tests | ${testIcon} ${metrics.testScore}/100 | ${metrics.testsPassed} passed, ${metrics.testsFailed} failed, ${metrics.testsSkipped} skipped |`);

  // Coverage
  const covIcon = metrics.coverageScore >= 80 ? "✅" : metrics.coverageScore >= 60 ? "⚠️" : "❌";
  lines.push(`| Coverage | ${covIcon} ${metrics.coverageScore}/100 | ${metrics.coverageLines.toFixed(1)}% lines |`);

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
