/**
 * Auto-Fix Agent
 *
 * Automatically attempts to fix quality gate failures by running common
 * fix operations (lint, type errors, etc.) and re-checking quality.
 */

import { spawn } from "child_process";
import { QualityMetrics } from "./quality-runner.js";
import { detectLanguage } from "../lib/language-profile.js";
/** Quality gate result type (formerly from quality-gate.ts, now inline) */
export interface QualityGateResult {
  passed: boolean;
  bypassed?: boolean;
  bypassReason?: string;
  checks: Array<{ name: string; passed: boolean; message: string; actual?: number; threshold?: number }>;
  summary: string;
  failureReasons: string[];
}

/**
 * Types of issues that can be auto-fixed.
 */
export type FixableIssueType =
  | "lint_errors"
  | "type_errors"
  | "test_failures"
  | "format_issues"
  | "import_issues";

/**
 * Result of a single fix attempt.
 */
export interface FixAttemptResult {
  issueType: FixableIssueType;
  fixed: boolean;
  message: string;
  filesModified: string[];
  errors?: string[];
}

/**
 * Result of an auto-fix iteration.
 */
export interface AutoFixIterationResult {
  iteration: number;
  fixAttempts: FixAttemptResult[];
  qualityGatePassed: boolean;
  previousMetrics: QualityMetrics;
  newMetrics?: QualityMetrics;
  totalFilesModified: string[];
}

/**
 * Overall result of the auto-fix process.
 */
export interface AutoFixResult {
  success: boolean;
  iterations: AutoFixIterationResult[];
  totalIterations: number;
  totalFixesApplied: number;
  issuesRemaining: string[];
  summary: string;
}

/**
 * Configuration for the auto-fix agent.
 */
export interface AutoFixConfig {
  maxIterations: number;
  enableLintFix: boolean;
  enableTypeErrorFix: boolean;
  enableTestFix: boolean;
  enableFormatFix: boolean;
  enableImportFix: boolean;
  projectRoot: string;
}

/**
 * Default configuration.
 */
export const DEFAULT_AUTO_FIX_CONFIG: AutoFixConfig = {
  maxIterations: 3,
  enableLintFix: true,
  enableTypeErrorFix: true,
  enableTestFix: false, // Test fixes are complex and risky
  enableFormatFix: true,
  enableImportFix: true,
  projectRoot: process.cwd(),
};

/**
 * Run a command and capture output.
 */
async function runCommand(
  command: string,
  args: string[],
  cwd: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { cwd, shell: true });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    proc.on("error", (err) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: err.message,
      });
    });
  });
}

/**
 * Attempt to fix lint errors using the appropriate tool for the detected language.
 */
async function fixLintErrors(projectRoot: string): Promise<FixAttemptResult> {
  const profile = detectLanguage(projectRoot);
  let result;

  switch (profile.id) {
    case "python":
      result = await runCommand("bash", ["-c", `source $HOME/.local/bin/env 2>/dev/null; uv run ruff check --fix . 2>&1 && uv run ruff format . 2>&1`], projectRoot);
      break;
    case "go":
      result = await runCommand("gofmt", ["-w", "."], projectRoot);
      break;
    case "rust":
      result = await runCommand("cargo", ["clippy", "--fix", "--allow-dirty", "--allow-staged"], projectRoot);
      break;
    case "ruby":
      result = await runCommand("bundle", ["exec", "rubocop", "-a"], projectRoot);
      break;
    default:
      result = await runCommand("npx", ["eslint", ".", "--fix", "--ext", ".ts,.tsx,.js,.jsx"], projectRoot);
  }

  const fixed = result.exitCode === 0;

  return {
    issueType: "lint_errors",
    fixed,
    message: fixed ? `Lint errors fixed (${profile.displayName})` : `Could not fix all lint errors (${profile.displayName})`,
    filesModified: [],
    errors: result.stderr ? [result.stderr] : undefined,
  };
}

/**
 * Attempt to fix formatting issues using the appropriate formatter for the detected language.
 */
async function fixFormatIssues(projectRoot: string): Promise<FixAttemptResult> {
  const profile = detectLanguage(projectRoot);
  let result;

  switch (profile.id) {
    case "python":
      result = await runCommand("bash", ["-c", "source $HOME/.local/bin/env 2>/dev/null; uv run ruff format . 2>&1"], projectRoot);
      break;
    case "go":
      result = await runCommand("gofmt", ["-w", "."], projectRoot);
      break;
    case "rust":
      result = await runCommand("cargo", ["fmt"], projectRoot);
      break;
    default:
      result = await runCommand("npx", ["prettier", "--write", ".", "--ignore-unknown"], projectRoot);
  }

  const fixed = result.exitCode === 0;

  return {
    issueType: "format_issues",
    fixed,
    message: fixed ? `Formatting issues fixed (${profile.displayName})` : `Could not fix formatting issues (${profile.displayName})`,
    filesModified: [],
    errors: result.stderr ? [result.stderr] : undefined,
  };
}

/**
 * Attempt to fix import issues (organize imports, remove unused).
 */
async function fixImportIssues(projectRoot: string): Promise<FixAttemptResult> {
  const profile = detectLanguage(projectRoot);

  // Import fixing is primarily a JS/TS concern — other languages handle imports via lint --fix
  if (profile.id !== "typescript") {
    return {
      issueType: "import_issues",
      fixed: false,
      message: `Import auto-fix not applicable for ${profile.displayName} (handled by lint --fix)`,
      filesModified: [],
    };
  }

  const result = await runCommand(
    "npx",
    ["eslint", ".", "--fix", "--rule", '{"import/order": "error", "unused-imports/no-unused-imports": "error"}'],
    projectRoot
  );

  const fixed = result.exitCode === 0;

  return {
    issueType: "import_issues",
    fixed,
    message: fixed ? "Import issues fixed" : "Could not fix all import issues",
    filesModified: [],
    errors: result.stderr ? [result.stderr] : undefined,
  };
}

/**
 * Attempt to fix type errors. For most languages, type errors can't be auto-fixed
 * without AI — this is a best-effort check that defers to the Claude fix agent.
 */
async function fixTypeErrors(projectRoot: string): Promise<FixAttemptResult> {
  const profile = detectLanguage(projectRoot);

  // Type errors generally can't be auto-fixed by shell commands — defer to AI agent
  // Just verify current state so we don't waste iterations
  return {
    issueType: "type_errors",
    fixed: false,
    message: `Type errors require AI-assisted fixing (${profile.displayName})`,
    filesModified: [],
  };
}

/**
 * Determine which fixes are applicable based on quality gate failures.
 */
function getApplicableFixes(
  gateResult: QualityGateResult,
  config: AutoFixConfig
): FixableIssueType[] {
  const applicableFixes: FixableIssueType[] = [];

  for (const check of gateResult.checks) {
    if (check.passed) continue;

    switch (check.name) {
      case "type_errors":
        if (config.enableTypeErrorFix) {
          applicableFixes.push("type_errors");
        }
        break;
      case "lint_errors":
        if (config.enableLintFix) {
          applicableFixes.push("lint_errors");
        }
        break;
      case "test_failures":
        if (config.enableTestFix) {
          applicableFixes.push("test_failures");
        }
        break;
    }
  }

  // Always try format fixes if enabled (improves code quality)
  if (config.enableFormatFix) {
    applicableFixes.push("format_issues");
  }

  // Always try import fixes if enabled
  if (config.enableImportFix) {
    applicableFixes.push("import_issues");
  }

  // Remove duplicates
  return [...new Set(applicableFixes)];
}

/**
 * Apply a specific fix type.
 */
async function applyFix(
  issueType: FixableIssueType,
  projectRoot: string
): Promise<FixAttemptResult> {
  switch (issueType) {
    case "lint_errors":
      return fixLintErrors(projectRoot);
    case "format_issues":
      return fixFormatIssues(projectRoot);
    case "import_issues":
      return fixImportIssues(projectRoot);
    case "type_errors":
      return fixTypeErrors(projectRoot);
    case "test_failures":
      // Test failures are complex - return not fixed
      return {
        issueType: "test_failures",
        fixed: false,
        message: "Test failures require manual or AI-assisted fixing",
        filesModified: [],
      };
  }
}

/**
 * Run one iteration of auto-fix.
 */
async function runAutoFixIteration(
  iteration: number,
  gateResult: QualityGateResult,
  metrics: QualityMetrics,
  config: AutoFixConfig,
  runQualityChecks: () => Promise<{ metrics: QualityMetrics; gateResult: QualityGateResult }>
): Promise<AutoFixIterationResult> {
  const applicableFixes = getApplicableFixes(gateResult, config);
  const fixAttempts: FixAttemptResult[] = [];
  const allFilesModified: string[] = [];

  // Apply each applicable fix
  for (const fixType of applicableFixes) {
    const result = await applyFix(fixType, config.projectRoot);
    fixAttempts.push(result);
    allFilesModified.push(...result.filesModified);
  }

  // Re-run quality checks if any fixes were applied
  const anyFixed = fixAttempts.some((f) => f.fixed);
  let newMetrics: QualityMetrics | undefined;
  let qualityGatePassed = gateResult.passed;

  if (anyFixed) {
    const newResults = await runQualityChecks();
    newMetrics = newResults.metrics;
    qualityGatePassed = newResults.gateResult.passed;
  }

  return {
    iteration,
    fixAttempts,
    qualityGatePassed,
    previousMetrics: metrics,
    newMetrics,
    totalFilesModified: [...new Set(allFilesModified)],
  };
}

/**
 * Main auto-fix agent entry point.
 *
 * @param gateResult - Initial quality gate result
 * @param metrics - Initial quality metrics
 * @param config - Auto-fix configuration
 * @param runQualityChecks - Callback to re-run quality checks after fixes
 */
export async function runAutoFix(
  gateResult: QualityGateResult,
  metrics: QualityMetrics,
  config: Partial<AutoFixConfig>,
  runQualityChecks: () => Promise<{ metrics: QualityMetrics; gateResult: QualityGateResult }>
): Promise<AutoFixResult> {
  const fullConfig: AutoFixConfig = { ...DEFAULT_AUTO_FIX_CONFIG, ...config };
  const iterations: AutoFixIterationResult[] = [];
  let currentGateResult = gateResult;
  let currentMetrics = metrics;
  let totalFixesApplied = 0;

  // Run up to maxIterations of fix attempts
  for (let i = 1; i <= fullConfig.maxIterations; i++) {
    // If quality gate already passes, stop
    if (currentGateResult.passed) {
      break;
    }

    const iterationResult = await runAutoFixIteration(
      i,
      currentGateResult,
      currentMetrics,
      fullConfig,
      runQualityChecks
    );

    iterations.push(iterationResult);
    totalFixesApplied += iterationResult.fixAttempts.filter((f) => f.fixed).length;

    // Update current state for next iteration
    if (iterationResult.newMetrics) {
      currentMetrics = iterationResult.newMetrics;
    }

    // Re-evaluate gate for next iteration
    if (iterationResult.qualityGatePassed) {
      break;
    } else {
      // Re-run quality checks to get latest gate result
      const newResults = await runQualityChecks();
      currentGateResult = newResults.gateResult;
      currentMetrics = newResults.metrics;
    }
  }

  // Determine remaining issues
  const issuesRemaining: string[] = [];
  if (!currentGateResult.passed) {
    for (const check of currentGateResult.checks) {
      if (!check.passed) {
        issuesRemaining.push(`${check.name}: ${check.message}`);
      }
    }
  }

  const success = currentGateResult.passed;

  return {
    success,
    iterations,
    totalIterations: iterations.length,
    totalFixesApplied,
    issuesRemaining,
    summary: success
      ? `Quality gate passed after ${iterations.length} auto-fix iteration(s) with ${totalFixesApplied} fixes applied`
      : `Auto-fix completed ${iterations.length} iteration(s) but ${issuesRemaining.length} issue(s) remain`,
  };
}

/**
 * Format auto-fix result for logging.
 */
export function formatAutoFixResult(result: AutoFixResult): string {
  const lines: string[] = [];

  lines.push("========================================");
  lines.push("         AUTO-FIX RESULT               ");
  lines.push("========================================");

  if (result.success) {
    lines.push("  Status: SUCCESS ✅");
  } else {
    lines.push("  Status: INCOMPLETE ⚠️");
  }

  lines.push(`  Iterations: ${result.totalIterations}`);
  lines.push(`  Fixes Applied: ${result.totalFixesApplied}`);

  if (result.iterations.length > 0) {
    lines.push("----------------------------------------");
    for (const iteration of result.iterations) {
      lines.push(`  Iteration ${iteration.iteration}:`);
      for (const attempt of iteration.fixAttempts) {
        const icon = attempt.fixed ? "✅" : "❌";
        lines.push(`    ${icon} ${attempt.issueType}: ${attempt.message}`);
      }
    }
  }

  if (result.issuesRemaining.length > 0) {
    lines.push("----------------------------------------");
    lines.push("  Remaining Issues:");
    for (const issue of result.issuesRemaining) {
      lines.push(`    - ${issue}`);
    }
  }

  lines.push("========================================");

  return lines.join("\n");
}

/**
 * Generate PR body section for auto-fix results.
 */
export function generateAutoFixPrSection(result: AutoFixResult): string {
  const lines: string[] = [];
  lines.push("### Auto-Fix Agent");
  lines.push("");

  if (result.success) {
    lines.push(`✅ **Quality gate passed** after ${result.totalIterations} auto-fix iteration(s)`);
  } else {
    lines.push(`⚠️ **Auto-fix incomplete** - ${result.issuesRemaining.length} issue(s) remain after ${result.totalIterations} iteration(s)`);
  }

  lines.push("");
  lines.push(`**Fixes applied:** ${result.totalFixesApplied}`);

  if (result.iterations.length > 0) {
    lines.push("");
    lines.push("<details>");
    lines.push("<summary>Fix Details</summary>");
    lines.push("");

    for (const iteration of result.iterations) {
      lines.push(`**Iteration ${iteration.iteration}:**`);
      for (const attempt of iteration.fixAttempts) {
        const icon = attempt.fixed ? "✅" : "❌";
        lines.push(`- ${icon} ${attempt.issueType}: ${attempt.message}`);
      }
      lines.push("");
    }

    lines.push("</details>");
  }

  if (result.issuesRemaining.length > 0) {
    lines.push("");
    lines.push("**Remaining issues:**");
    for (const issue of result.issuesRemaining) {
      lines.push(`- ${issue}`);
    }
  }

  lines.push("");

  return lines.join("\n");
}

/**
 * Calculate fix success stats for tracking.
 */
export function calculateFixStats(result: AutoFixResult): {
  totalAttempts: number;
  successfulFixes: number;
  failedFixes: number;
  fixesByType: Record<string, { attempts: number; successes: number }>;
} {
  const fixesByType: Record<string, { attempts: number; successes: number }> = {};
  let totalAttempts = 0;
  let successfulFixes = 0;
  let failedFixes = 0;

  for (const iteration of result.iterations) {
    for (const attempt of iteration.fixAttempts) {
      totalAttempts++;

      if (!fixesByType[attempt.issueType]) {
        fixesByType[attempt.issueType] = { attempts: 0, successes: 0 };
      }

      fixesByType[attempt.issueType].attempts++;

      if (attempt.fixed) {
        successfulFixes++;
        fixesByType[attempt.issueType].successes++;
      } else {
        failedFixes++;
      }
    }
  }

  return {
    totalAttempts,
    successfulFixes,
    failedFixes,
    fixesByType,
  };
}

/**
 * Post auto-fix stats to the API for tracking.
 * Should be called after each auto-fix run completes.
 */
export async function postAutoFixStats(
  result: AutoFixResult,
  apiBaseUrl: string,
  apiKey: string
): Promise<boolean> {
  try {
    const stats = calculateFixStats(result);

    const response = await fetch(`${apiBaseUrl}/api/analytics/auto-fix-stats`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(stats),
    });

    if (!response.ok) {
      console.error(`Failed to post auto-fix stats: ${response.status}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error posting auto-fix stats:", error);
    return false;
  }
}

/**
 * Run auto-fix and post stats to API.
 * Convenience wrapper that handles the full flow.
 */
export async function runAutoFixWithTracking(
  gateResult: QualityGateResult,
  metrics: QualityMetrics,
  config: Partial<AutoFixConfig>,
  runQualityChecks: () => Promise<{ metrics: QualityMetrics; gateResult: QualityGateResult }>,
  apiConfig?: { baseUrl: string; apiKey: string }
): Promise<AutoFixResult> {
  // Run the auto-fix
  const result = await runAutoFix(gateResult, metrics, config, runQualityChecks);

  // Post stats if API config provided
  if (apiConfig) {
    await postAutoFixStats(result, apiConfig.baseUrl, apiConfig.apiKey);
  }

  return result;
}
