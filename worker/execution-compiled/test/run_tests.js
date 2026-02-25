#!/usr/bin/env npx ts-node
"use strict";
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
const language_profile_js_1 = require("../../lib/dist/language-profile.js");
function exec(cmd, cwd) {
    try {
        const stdout = (0, child_process_1.execSync)(cmd, {
            cwd,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 300000, // 5 minute timeout
        });
        return { stdout, stderr: "", exitCode: 0 };
    }
    catch (error) {
        return {
            stdout: error.stdout || "",
            stderr: error.stderr || "",
            exitCode: error.status || 1,
        };
    }
}
function parseTestOutputForDetails(profile, stdout, stderr) {
    const parsed = profile.parseTests(stdout, stderr);
    const result = {
        testsPassed: parsed.passed,
        testsFailed: parsed.failed,
        testsRun: parsed.passed + parsed.failed + parsed.skipped,
        failedTests: [],
    };
    // Extract coverage from Jest/Vitest output (TS only)
    if (profile.id === "typescript") {
        const coverageMatch = stdout.match(/All files\s+\|\s+[\d.]+\s+\|\s+[\d.]+\s+\|\s+[\d.]+\s+\|\s+([\d.]+)/);
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
async function main() {
    const output = {
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
        const runnerToProfileId = {
            jest: "typescript",
            vitest: "typescript",
            mocha: "typescript",
            pytest: "python",
        };
        const profile = testRunnerEnv
            ? (0, language_profile_js_1.getProfile)(runnerToProfileId[testRunnerEnv.toLowerCase()] || testRunnerEnv)
            : (0, language_profile_js_1.detectLanguageWithTestRunner)(projectPath);
        console.error(`[run_tests] Using ${profile.displayName} profile in ${projectPath}`);
        // Build command with pattern/coverage options
        let cmd = profile.test;
        if (pattern) {
            // Append pattern flag based on language
            switch (profile.id) {
                case "typescript":
                    // Detect if vitest or jest from the command
                    if (cmd.includes("vitest"))
                        cmd = `npx vitest run --filter "${pattern}"`;
                    else if (cmd.includes("mocha"))
                        cmd = `npx mocha --grep "${pattern}"`;
                    else
                        cmd = `npx jest --testPathPattern="${pattern}" --forceExit --detectOpenHandles`;
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
            if (cmd.includes("vitest"))
                cmd += " --coverage";
            else if (cmd.includes("jest"))
                cmd += " --coverage";
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
    }
    catch (error) {
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
