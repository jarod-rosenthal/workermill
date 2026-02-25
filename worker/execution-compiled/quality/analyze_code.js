***REMOVED***!/usr/bin/env npx ts-node
"use strict";
/**
 * Analyze code quality and emit metrics
 *
 * This script runs after the verify phase and aggregates quality metrics from:
 * - Lint output (eslint, biome)
 * - TypeScript type checking
 * - Test results (jest, vitest, pytest)
 * - Coverage reports
 * - Security audit (npm audit)
 *
 * Inputs (environment variables):
 * - REPO_PATH: Optional. Path to repository. Defaults to current directory
 * - PROJECT: Optional. Project subdirectory
 * - TASK_ID: Required. Task ID for posting metrics
 * - API_URL: Required. WorkerMill API URL
 * - API_KEY: Required. Organization API key
 * - LINT_OUTPUT: Optional. Path to lint results JSON
 * - TYPECHECK_OUTPUT: Optional. Path to typecheck results JSON
 * - TEST_OUTPUT: Optional. Path to test results JSON
 * - SKIP_SECURITY: Optional. Skip npm audit if "true"
 *
 * Outputs (JSON to stdout):
 * - success: boolean
 * - qualityScore: number (0-100 composite score)
 * - lintScore: number
 * - typecheckScore: number
 * - testScore: number
 * - coverageScore: number
 * - securityScore: number
 * - rawMetrics: object (detailed breakdown)
 * - error?: string
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const language_profile_js_1 = require("../../lib/dist/language-profile.js");
// Score weights (must sum to 1.0)
const WEIGHTS = {
    typecheck: 0.25, // 25% - binary pass/fail
    lint: 0.2, // 20% - error count relative to LOC
    tests: 0.3, // 30% - pass rate
    coverage: 0.15, // 15% - line coverage
    security: 0.1, // 10% - vulnerability severity
};
function exec(cmd, cwd) {
    try {
        const stdout = (0, child_process_1.execSync)(cmd, {
            cwd,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 180000, // 3 minute timeout
        });
        return { stdout, stderr: "", exitCode: 0 };
    }
    catch (error) {
        const err = error;
        return {
            stdout: err.stdout || "",
            stderr: err.stderr || "",
            exitCode: err.status || 1,
        };
    }
}
function countLinesOfCode(projectPath, profile) {
    // Build find pattern from profile extensions
    const extPatterns = profile.extensions
        .map((ext) => `-name "*${ext}"`)
        .join(" -o ");
    try {
        const result = exec(`find . \\( ${extPatterns} \\) | xargs wc -l 2>/dev/null | tail -1`, projectPath);
        const match = result.stdout.match(/(\d+)/);
        return match ? parseInt(match[1]) : 1000;
    }
    catch {
        return 1000;
    }
}
function runLint(projectPath, profile) {
    const metrics = { errors: 0, warnings: 0 };
    if (profile.lint) {
        const result = exec(profile.lint, projectPath);
        const parsed = profile.parseLint(result.stdout, result.stderr);
        metrics.errors = parsed.errors;
        metrics.warnings = parsed.warnings;
    }
    metrics.linesOfCode = countLinesOfCode(projectPath, profile);
    return metrics;
}
function runTypecheck(projectPath, profile) {
    if (!profile.typecheck) {
        return { errors: 0, passed: true };
    }
    const result = exec(profile.typecheck, projectPath);
    const parsed = profile.parseTypecheck(result.stdout, result.stderr, result.exitCode);
    return { errors: parsed.errors, passed: parsed.passed };
}
function runTests(projectPath, profile) {
    const metrics = {
        passed: 0,
        failed: 0,
        skipped: 0,
        lines: 0,
        branches: 0,
    };
    const result = exec(profile.test, projectPath);
    const parsed = profile.parseTests(result.stdout, result.stderr);
    metrics.passed = parsed.passed;
    metrics.failed = parsed.failed;
    metrics.skipped = parsed.skipped;
    // Extract coverage for TypeScript (Jest/Vitest JSON or summary output)
    if (profile.id === "typescript") {
        // Try JSON coverage from Jest
        try {
            const json = JSON.parse(result.stdout);
            if (json.coverageMap) {
                let totalLines = 0;
                let coveredLines = 0;
                let totalBranches = 0;
                let coveredBranches = 0;
                for (const file of Object.values(json.coverageMap)) {
                    const statements = Object.values(file.s || {});
                    totalLines += statements.length;
                    coveredLines += statements.filter((v) => v > 0).length;
                    const branches = Object.values(file.b || {}).flat();
                    totalBranches += branches.length;
                    coveredBranches += branches.filter((v) => v > 0).length;
                }
                if (totalLines > 0)
                    metrics.lines = (coveredLines / totalLines) * 100;
                if (totalBranches > 0)
                    metrics.branches = (coveredBranches / totalBranches) * 100;
            }
        }
        catch {
            // Parse coverage summary
            const coverageMatch = result.stdout.match(/All files\s+\|\s+[\d.]+\s+\|\s+[\d.]+\s+\|\s+[\d.]+\s+\|\s+([\d.]+)/);
            if (coverageMatch) {
                metrics.lines = parseFloat(coverageMatch[1]);
            }
        }
    }
    return metrics;
}
function runSecurityAudit(projectPath, profile) {
    if (!profile.audit) {
        return { high: 0, medium: 0, low: 0 };
    }
    const result = exec(profile.audit, projectPath);
    return profile.parseAudit(result.stdout);
}
function calculateScores(lint, typecheck, tests, coverage, security) {
    // Lint score: 100 - (errors / lines * 100), capped at 0
    const linesOfCode = lint.linesOfCode || 1000;
    const lintScore = Math.max(0, Math.round(100 - (lint.errors / linesOfCode) * 1000));
    // Typecheck score: 100 if pass, 0 if fail
    const typecheckScore = typecheck.passed ? 100 : 0;
    // Test score: pass rate
    const totalTests = tests.passed + tests.failed + tests.skipped;
    const testScore = totalTests > 0 ? Math.round((tests.passed / totalTests) * 100) : 100;
    // Coverage score: line coverage (already 0-100)
    const coverageScore = Math.round(coverage.lines);
    // Security score: 100 - (high * 20 + medium * 5 + low)
    const securityDeduction = security.high * 20 + security.medium * 5 + security.low;
    const securityScore = Math.max(0, 100 - securityDeduction);
    // Composite score (weighted average)
    const qualityScore = Math.round(lintScore * WEIGHTS.lint +
        typecheckScore * WEIGHTS.typecheck +
        testScore * WEIGHTS.tests +
        coverageScore * WEIGHTS.coverage +
        securityScore * WEIGHTS.security);
    return {
        qualityScore,
        lintScore,
        typecheckScore,
        testScore,
        coverageScore,
        securityScore,
    };
}
async function postMetricsToApi(apiUrl, apiKey, taskId, analysis) {
    const body = JSON.stringify({
        qualityMetrics: {
            qualityScore: analysis.qualityScore,
            lintScore: analysis.lintScore,
            lintErrors: analysis.raw.lint.errors,
            lintWarnings: analysis.raw.lint.warnings,
            typecheckScore: analysis.typecheckScore,
            typeErrors: analysis.raw.typecheck.errors,
            testScore: analysis.testScore,
            testsPassed: analysis.raw.tests.passed,
            testsFailed: analysis.raw.tests.failed,
            testsSkipped: analysis.raw.tests.skipped,
            coverageScore: analysis.coverageScore,
            coverageLines: analysis.raw.coverage.lines,
            coverageBranches: analysis.raw.coverage.branches,
            securityScore: analysis.securityScore,
            securityHigh: analysis.raw.security.high,
            securityMedium: analysis.raw.security.medium,
            securityLow: analysis.raw.security.low,
            analysisJson: analysis.raw,
        },
    });
    return new Promise((resolve) => {
        const url = `${apiUrl}/api/tasks/${taskId}/quality-metrics`;
        const urlObj = new URL(url);
        const protocol = urlObj.protocol === "https:" ? https : http;
        const req = protocol.request(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
                "X-API-Key": apiKey,
            },
        }, (res) => {
            resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300);
        });
        req.on("error", () => resolve(false));
        req.write(body);
        req.end();
    });
}
async function main() {
    const output = {
        success: false,
        qualityScore: 0,
        lintScore: 0,
        typecheckScore: 0,
        testScore: 0,
        coverageScore: 0,
        securityScore: 0,
        rawMetrics: {
            lint: { errors: 0, warnings: 0 },
            typecheck: { errors: 0, passed: true },
            tests: { passed: 0, failed: 0, skipped: 0 },
            coverage: { lines: 0, branches: 0 },
            security: { high: 0, medium: 0, low: 0 },
        },
        sentToApi: false,
    };
    try {
        const repoPath = process.env.REPO_PATH || process.cwd();
        const project = process.env.PROJECT || "";
        const taskId = process.env.TASK_ID;
        const apiUrl = process.env.API_URL;
        const apiKey = process.env.API_KEY;
        const skipSecurity = process.env.SKIP_SECURITY === "true";
        const projectPath = project ? path.join(repoPath, project) : repoPath;
        const profile = (0, language_profile_js_1.detectLanguageWithTestRunner)(projectPath);
        console.error(`[analyze_code] Analyzing code quality in ${projectPath} (${profile.displayName})`);
        // Run all analysis
        console.error("[analyze_code] Running lint analysis...");
        const lintMetrics = runLint(projectPath, profile);
        console.error("[analyze_code] Running typecheck analysis...");
        const typecheckMetrics = runTypecheck(projectPath, profile);
        console.error("[analyze_code] Running test analysis...");
        const testMetrics = runTests(projectPath, profile);
        let securityMetrics = { high: 0, medium: 0, low: 0 };
        if (!skipSecurity) {
            console.error("[analyze_code] Running security audit...");
            securityMetrics = runSecurityAudit(projectPath, profile);
        }
        // Calculate scores
        const scores = calculateScores(lintMetrics, typecheckMetrics, testMetrics, { lines: testMetrics.lines, branches: testMetrics.branches }, securityMetrics);
        const analysis = {
            ...scores,
            raw: {
                lint: lintMetrics,
                typecheck: typecheckMetrics,
                tests: {
                    passed: testMetrics.passed,
                    failed: testMetrics.failed,
                    skipped: testMetrics.skipped,
                },
                coverage: { lines: testMetrics.lines, branches: testMetrics.branches },
                security: securityMetrics,
            },
        };
        // Update output
        output.qualityScore = analysis.qualityScore;
        output.lintScore = analysis.lintScore;
        output.typecheckScore = analysis.typecheckScore;
        output.testScore = analysis.testScore;
        output.coverageScore = analysis.coverageScore;
        output.securityScore = analysis.securityScore;
        output.rawMetrics = analysis.raw;
        // Post to API if configured
        if (taskId && apiUrl && apiKey) {
            console.error("[analyze_code] Posting metrics to API...");
            output.sentToApi = await postMetricsToApi(apiUrl, apiKey, taskId, analysis);
        }
        output.success = true;
    }
    catch (error) {
        output.error = error instanceof Error ? error.message : String(error);
    }
    // Output JSON result
    console.log(JSON.stringify(output, null, 2));
    // Output markers for orchestrator parsing
    console.error(`::quality_score::${output.qualityScore}`);
    console.error(`::lint_score::${output.lintScore}`);
    console.error(`::typecheck_score::${output.typecheckScore}`);
    console.error(`::test_score::${output.testScore}`);
    console.error(`::coverage_score::${output.coverageScore}`);
    console.error(`::security_score::${output.securityScore}`);
    console.error(`::lint_errors::${output.rawMetrics.lint.errors}`);
    console.error(`::lint_warnings::${output.rawMetrics.lint.warnings}`);
    console.error(`::type_errors::${output.rawMetrics.typecheck.errors}`);
    console.error(`::tests_passed::${output.rawMetrics.tests.passed}`);
    console.error(`::tests_failed::${output.rawMetrics.tests.failed}`);
    console.error(`::tests_skipped::${output.rawMetrics.tests.skipped}`);
    console.error(`::coverage_lines::${output.rawMetrics.coverage.lines}`);
    console.error(`::coverage_branches::${output.rawMetrics.coverage.branches}`);
    console.error(`::security_high::${output.rawMetrics.security.high}`);
    console.error(`::security_medium::${output.rawMetrics.security.medium}`);
    console.error(`::security_low::${output.rawMetrics.security.low}`);
    process.exit(output.success ? 0 : 1);
}
main();
