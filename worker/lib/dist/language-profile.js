/**
 * Language Profile Utility — Multi-Language Support for Worker Scripts
 *
 * Centralizes language detection, commands, and output parsers for:
 * TypeScript, Python, Rust, Go, Java, Ruby
 *
 * Used by quality-runner.ts, execution scripts (run_tests, run_typecheck, analyze_code).
 */
import * as fs from "fs";
import * as path from "path";
// ─── TypeScript Profile ──────────────────────────────────────────────────────
/**
 * Detect JS/TS test runner from package.json dependencies.
 * Priority: vitest > jest > mocha. Falls back to "npx jest" if none detected.
 */
function detectJsTestRunner(repoPath) {
    const pkgPath = path.join(repoPath, "package.json");
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (deps?.vitest)
                return { test: "npx vitest run", runner: "vitest" };
            if (deps?.jest)
                return { test: "npx jest --forceExit --detectOpenHandles", runner: "jest" };
            if (deps?.mocha)
                return { test: "npx mocha", runner: "mocha" };
            // If there's a test script, use npm test
            if (pkg.scripts?.test)
                return { test: "npm test", runner: "npm_test" };
        }
        catch { /* ignore */ }
    }
    return { test: "npx jest --forceExit --detectOpenHandles", runner: "jest" };
}
const typescriptProfile = {
    id: "typescript",
    displayName: "TypeScript",
    markers: ["package.json", "tsconfig.json"],
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    typecheck: "npm run typecheck 2>&1 || npx tsc --noEmit 2>&1",
    lint: "npm run lint 2>&1 || echo 'no lint script'",
    // test command is dynamic — set at detection time via detectJsTestRunner()
    test: "npm test 2>&1",
    testTargeted: (files) => {
        // Will be overridden at detection time based on runner
        return `npx vitest run --related ${files.join(" ")} 2>&1`;
    },
    audit: "npm audit --json 2>/dev/null",
    parseTypecheck(stdout, _stderr, exitCode) {
        const errorMatches = stdout.match(/error TS\d+/g) || [];
        return { errors: errorMatches.length, passed: errorMatches.length === 0 && exitCode === 0 };
    },
    parseLint(stdout, _stderr) {
        let errors = 0;
        let warnings = 0;
        // ESLint summary: "X problems (Y errors, Z warnings)"
        const problemsMatch = stdout.match(/(\d+)\s+problems?\s*\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)/i);
        if (problemsMatch) {
            errors = parseInt(problemsMatch[2]) || 0;
            warnings = parseInt(problemsMatch[3]) || 0;
        }
        else {
            const errorMatch = stdout.match(/(\d+)\s+errors?/i);
            const warnMatch = stdout.match(/(\d+)\s+warnings?/i);
            if (errorMatch)
                errors = parseInt(errorMatch[1]) || 0;
            if (warnMatch)
                warnings = parseInt(warnMatch[1]) || 0;
        }
        return { errors, warnings };
    },
    parseTests(stdout, _stderr) {
        let passed = 0;
        let failed = 0;
        let skipped = 0;
        // Jest/Vitest: "Tests: X passed, Y failed, Z skipped"
        const testsLineMatch = stdout.match(/Tests:\s*(\d+)\s*passed(?:,\s*(\d+)\s*failed)?(?:,\s*(\d+)\s*(?:skipped|todo))?/i);
        if (testsLineMatch) {
            passed = parseInt(testsLineMatch[1]) || 0;
            failed = parseInt(testsLineMatch[2]) || 0;
            skipped = parseInt(testsLineMatch[3]) || 0;
        }
        else {
            // Alternate: "X passing", "X failing"
            const passMatch = stdout.match(/(\d+)\s+pass(?:ing|ed)?/i);
            const failMatch = stdout.match(/(\d+)\s+fail(?:ing|ed)?/i);
            const skipMatch = stdout.match(/(\d+)\s+(?:skipped|pending)/i);
            if (passMatch)
                passed = parseInt(passMatch[1]) || 0;
            if (failMatch)
                failed = parseInt(failMatch[1]) || 0;
            if (skipMatch)
                skipped = parseInt(skipMatch[1]) || 0;
        }
        return { passed, failed, skipped };
    },
    parseAudit(stdout) {
        let high = 0;
        let medium = 0;
        let low = 0;
        try {
            const audit = JSON.parse(stdout || "{}");
            const vulns = audit.metadata?.vulnerabilities || audit.vulnerabilities || {};
            if (typeof vulns === "object") {
                if ("critical" in vulns || "high" in vulns) {
                    high = (vulns.critical || 0) + (vulns.high || 0);
                    medium = vulns.moderate || 0;
                    low = (vulns.low || 0) + (vulns.info || 0);
                }
                else {
                    for (const vuln of Object.values(vulns)) {
                        if (!vuln.severity)
                            continue;
                        switch (vuln.severity) {
                            case "critical":
                            case "high":
                                high++;
                                break;
                            case "moderate":
                            case "medium":
                                medium++;
                                break;
                            case "low":
                            case "info":
                                low++;
                                break;
                        }
                    }
                }
            }
        }
        catch { /* ignore parse errors */ }
        return { high, medium, low };
    },
};
// ─── Python Profile ──────────────────────────────────────────────────────────
const pythonProfile = {
    id: "python",
    displayName: "Python",
    markers: ["pyproject.toml", "requirements.txt", "setup.py"],
    extensions: [".py"],
    typecheck: "mypy . --ignore-missing-imports 2>&1",
    lint: "ruff check . --output-format json 2>&1 || python -m flake8 --format json 2>&1 || echo 'no linter'",
    test: "python -m pytest -v 2>&1",
    testTargeted: (files) => {
        // Infer test directories from source file paths
        const testDirs = new Set();
        for (const f of files) {
            const dir = path.dirname(f);
            for (const candidate of [
                dir.replace(/^src\//, "tests/"),
                dir.replace(/^src\//, "test/"),
                `tests/${dir}`,
                `test/${dir}`,
            ]) {
                testDirs.add(candidate);
            }
        }
        const dirs = Array.from(testDirs).join(" ");
        return dirs ? `pytest ${dirs} -q 2>&1` : "python -m pytest -v 2>&1";
    },
    audit: "pip-audit --format json 2>&1 || echo '{}'",
    parseTypecheck(stdout, _stderr, exitCode) {
        // mypy: "Found X errors in Y files"
        const errorMatch = stdout.match(/Found\s+(\d+)\s+errors?/i);
        const errors = errorMatch ? parseInt(errorMatch[1]) : (exitCode !== 0 ? 1 : 0);
        return { errors, passed: exitCode === 0 };
    },
    parseLint(stdout, _stderr) {
        let errors = 0;
        let warnings = 0;
        // Try JSON (ruff output)
        try {
            const items = JSON.parse(stdout);
            if (Array.isArray(items)) {
                for (const item of items) {
                    if (item.fix) {
                        warnings++;
                    }
                    else {
                        errors++;
                    }
                }
                return { errors, warnings };
            }
        }
        catch { /* not JSON, try text */ }
        // Text output: count lines matching file:line:col pattern
        const issueLines = stdout.match(/^.+:\d+:\d+:/gm) || [];
        errors = issueLines.length;
        return { errors, warnings };
    },
    parseTests(stdout, _stderr) {
        // pytest: "X passed, Y failed, Z skipped in N.NNs"
        const passedMatch = stdout.match(/(\d+)\s+passed/);
        const failedMatch = stdout.match(/(\d+)\s+failed/);
        const skippedMatch = stdout.match(/(\d+)\s+skipped/);
        return {
            passed: passedMatch ? parseInt(passedMatch[1]) : 0,
            failed: failedMatch ? parseInt(failedMatch[1]) : 0,
            skipped: skippedMatch ? parseInt(skippedMatch[1]) : 0,
        };
    },
    parseAudit(stdout) {
        let high = 0;
        let medium = 0;
        let low = 0;
        try {
            const audit = JSON.parse(stdout || "{}");
            const deps = audit.dependencies || [];
            for (const dep of deps) {
                for (const vuln of dep.vulns || []) {
                    const sev = (vuln.fix_versions?.length ? "medium" : "high").toLowerCase();
                    if (sev === "high" || sev === "critical")
                        high++;
                    else if (sev === "medium")
                        medium++;
                    else
                        low++;
                }
            }
        }
        catch { /* ignore */ }
        return { high, medium, low };
    },
};
// ─── Rust Profile ────────────────────────────────────────────────────────────
const rustProfile = {
    id: "rust",
    displayName: "Rust",
    markers: ["Cargo.toml"],
    extensions: [".rs"],
    typecheck: "cargo check 2>&1",
    lint: "cargo clippy -- -D warnings 2>&1",
    test: "cargo test 2>&1",
    testTargeted: (files) => {
        // Rust doesn't have per-file test targeting — run all tests
        void files;
        return "cargo test 2>&1";
    },
    audit: "cargo audit --json 2>&1 || echo '{}'",
    parseTypecheck(_stdout, stderr, exitCode) {
        // cargo check outputs errors to stderr; count "error[E" patterns
        const combined = _stdout + stderr;
        const errorMatches = combined.match(/error\[E\d+\]/g) || [];
        const errors = errorMatches.length || (exitCode !== 0 ? 1 : 0);
        return { errors, passed: exitCode === 0 };
    },
    parseLint(_stdout, stderr) {
        const combined = _stdout + stderr;
        // clippy: "warning:" and "error:" lines
        const errorMatches = combined.match(/^error/gm) || [];
        const warnMatches = combined.match(/^warning(?!\[unused_imports\])/gm) || [];
        return { errors: errorMatches.length, warnings: warnMatches.length };
    },
    parseTests(stdout, _stderr) {
        // cargo test: "test result: ok. X passed; Y failed; Z ignored"
        const resultMatch = stdout.match(/test result:.*?(\d+)\s+passed;\s*(\d+)\s+failed;\s*(\d+)\s+ignored/);
        if (resultMatch) {
            return {
                passed: parseInt(resultMatch[1]),
                failed: parseInt(resultMatch[2]),
                skipped: parseInt(resultMatch[3]),
            };
        }
        // Fallback: count individual "test ... ok" lines
        const passed = (stdout.match(/test .+ \.\.\. ok/g) || []).length;
        const failed = (stdout.match(/test .+ \.\.\. FAILED/g) || []).length;
        return { passed, failed, skipped: 0 };
    },
    parseAudit(stdout) {
        let high = 0;
        let medium = 0;
        let low = 0;
        try {
            const audit = JSON.parse(stdout || "{}");
            for (const vuln of audit.vulnerabilities?.list || []) {
                const sev = (vuln.advisory?.cvss_score || 0) >= 7.0 ? "high" : (vuln.advisory?.cvss_score || 0) >= 4.0 ? "medium" : "low";
                if (sev === "high")
                    high++;
                else if (sev === "medium")
                    medium++;
                else
                    low++;
            }
        }
        catch { /* ignore */ }
        return { high, medium, low };
    },
};
// ─── Go Profile ──────────────────────────────────────────────────────────────
const goProfile = {
    id: "go",
    displayName: "Go",
    markers: ["go.mod"],
    extensions: [".go"],
    typecheck: "go build ./... 2>&1",
    lint: "go vet ./... 2>&1 && golangci-lint run ./... 2>&1 || echo 'golangci-lint not available'",
    test: "go test ./... -v -count=1 2>&1",
    testTargeted: (files) => {
        // Go tests by package, not file — extract unique dirs
        const dirs = new Set();
        for (const f of files) {
            dirs.add("./" + path.dirname(f));
        }
        return `go test ${Array.from(dirs).join(" ")} -v -count=1 2>&1`;
    },
    audit: "go vet ./... 2>&1",
    parseTypecheck(_stdout, _stderr, exitCode) {
        const errors = exitCode !== 0 ? 1 : 0;
        return { errors, passed: exitCode === 0 };
    },
    parseLint(stdout, _stderr) {
        // go vet + golangci-lint: count issue lines (file:line:col patterns)
        const vetErrors = (stdout.match(/\.go:\d+:\d+:/g) || []).length;
        // Count gofmt issues if present
        const fmtIssues = stdout
            .split("\n")
            .filter((l) => l.trim().endsWith(".go") && !l.includes("not available"))
            .length;
        return { errors: vetErrors + fmtIssues, warnings: 0 };
    },
    parseTests(stdout, _stderr) {
        // go test -v: "--- PASS:", "--- FAIL:", "--- SKIP:"
        const passed = (stdout.match(/--- PASS:/g) || []).length;
        const failed = (stdout.match(/--- FAIL:/g) || []).length;
        const skipped = (stdout.match(/--- SKIP:/g) || []).length;
        // Fallback to package-level results
        if (passed === 0 && failed === 0) {
            const pkgPass = (stdout.match(/^ok\s+/gm) || []).length;
            const pkgFail = (stdout.match(/^FAIL\s+/gm) || []).length;
            return { passed: pkgPass, failed: pkgFail, skipped };
        }
        return { passed, failed, skipped };
    },
    parseAudit(stdout) {
        // go vet as security proxy — binary pass/fail
        const hasIssues = stdout.trim().length > 0 && stdout.includes(".go:");
        return { high: hasIssues ? 1 : 0, medium: 0, low: 0 };
    },
};
// ─── Java Profile ────────────────────────────────────────────────────────────
const javaProfile = {
    id: "java",
    displayName: "Java",
    markers: ["pom.xml", "build.gradle", "build.gradle.kts"],
    extensions: [".java", ".kt"],
    typecheck: null, // Compilation is part of build; test command handles it
    lint: null,
    // Detect Maven vs Gradle at detection time
    test: "mvn test -q 2>&1 || gradle test 2>&1",
    testTargeted: null,
    audit: null,
    parseTypecheck(_stdout, _stderr, exitCode) {
        return { errors: exitCode !== 0 ? 1 : 0, passed: exitCode === 0 };
    },
    parseLint(_stdout, _stderr) {
        return { errors: 0, warnings: 0 };
    },
    parseTests(stdout, _stderr) {
        // Maven surefire: "Tests run: X, Failures: Y, Errors: Z, Skipped: W"
        const surefireMatch = stdout.match(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/);
        if (surefireMatch) {
            const total = parseInt(surefireMatch[1]);
            const failures = parseInt(surefireMatch[2]) + parseInt(surefireMatch[3]);
            const skipped = parseInt(surefireMatch[4]);
            return { passed: total - failures - skipped, failed: failures, skipped };
        }
        // Gradle: "X tests completed, Y failed"
        const gradleMatch = stdout.match(/(\d+)\s+tests?\s+completed,\s*(\d+)\s+failed/);
        if (gradleMatch) {
            const total = parseInt(gradleMatch[1]);
            const failed = parseInt(gradleMatch[2]);
            return { passed: total - failed, failed, skipped: 0 };
        }
        return { passed: 0, failed: 0, skipped: 0 };
    },
    parseAudit(_stdout) {
        return { high: 0, medium: 0, low: 0 };
    },
};
// ─── Ruby Profile ────────────────────────────────────────────────────────────
const rubyProfile = {
    id: "ruby",
    displayName: "Ruby",
    markers: ["Gemfile"],
    extensions: [".rb"],
    typecheck: null,
    lint: "rubocop --format json 2>&1 || echo '{}'",
    test: "bundle exec rspec 2>&1",
    testTargeted: (files) => {
        // RSpec can run specific spec files
        const specFiles = files
            .map((f) => f.replace(/^(app|lib)\//, "spec/").replace(/\.rb$/, "_spec.rb"))
            .join(" ");
        return `bundle exec rspec ${specFiles} 2>&1`;
    },
    audit: "bundle-audit check 2>&1 || echo 'bundle-audit not available'",
    parseTypecheck(_stdout, _stderr, exitCode) {
        return { errors: exitCode !== 0 ? 1 : 0, passed: exitCode === 0 };
    },
    parseLint(stdout, _stderr) {
        let errors = 0;
        let warnings = 0;
        try {
            const result = JSON.parse(stdout);
            if (result.summary) {
                errors = result.summary.offense_count || 0;
                // RuboCop categorizes by severity
                for (const file of result.files || []) {
                    for (const offense of file.offenses || []) {
                        if (offense.severity === "convention" || offense.severity === "refactor") {
                            warnings++;
                        }
                    }
                }
                // Errors = total - warnings
                errors = Math.max(0, errors - warnings);
            }
        }
        catch {
            // Text fallback: count offense lines
            const offenseLines = stdout.match(/^[A-Z]:.+:\d+:\d+:/gm) || [];
            errors = offenseLines.length;
        }
        return { errors, warnings };
    },
    parseTests(stdout, _stderr) {
        // RSpec: "X examples, Y failures, Z pending"
        const rspecMatch = stdout.match(/(\d+)\s+examples?,\s*(\d+)\s+failures?(?:,\s*(\d+)\s+pending)?/);
        if (rspecMatch) {
            const total = parseInt(rspecMatch[1]);
            const failed = parseInt(rspecMatch[2]);
            const pending = parseInt(rspecMatch[3] || "0");
            return { passed: total - failed - pending, failed, skipped: pending };
        }
        return { passed: 0, failed: 0, skipped: 0 };
    },
    parseAudit(stdout) {
        // bundle-audit: "X vulnerabilities found"
        const vulnMatch = stdout.match(/(\d+)\s+vulnerabilities?\s+found/i);
        if (vulnMatch) {
            const count = parseInt(vulnMatch[1]);
            // Rough split: treat all as medium unless "critical" mentioned
            const critMatch = stdout.match(/Criticality:\s*High/gi) || [];
            return { high: critMatch.length, medium: count - critMatch.length, low: 0 };
        }
        if (stdout.includes("No vulnerabilities found")) {
            return { high: 0, medium: 0, low: 0 };
        }
        return { high: 0, medium: 0, low: 0 };
    },
};
// ─── Profile Registry ────────────────────────────────────────────────────────
export const ALL_PROFILES = {
    typescript: typescriptProfile,
    python: pythonProfile,
    rust: rustProfile,
    go: goProfile,
    java: javaProfile,
    ruby: rubyProfile,
};
/**
 * Get a language profile by ID.
 */
export function getProfile(id) {
    const profile = ALL_PROFILES[id.toLowerCase()];
    if (!profile) {
        console.warn(`[language-profile] Unknown profile "${id}", falling back to TypeScript`);
        return typescriptProfile;
    }
    return profile;
}
// ─── Detection ───────────────────────────────────────────────────────────────
/**
 * Detection priority (first match wins):
 * 1. PROJECT_LANGUAGE env var
 * 2. Cargo.toml → Rust
 * 3. go.mod → Go
 * 4. pyproject.toml / requirements.txt / setup.py → Python
 * 5. Gemfile → Ruby
 * 6. pom.xml / build.gradle → Java
 * 7. package.json / tsconfig.json → TypeScript (default)
 */
export function detectLanguage(repoPath) {
    // Fast path: env var override
    const envLang = process.env.PROJECT_LANGUAGE;
    if (envLang) {
        const profile = ALL_PROFILES[envLang.toLowerCase()];
        if (profile) {
            console.log(`[language-profile] Using PROJECT_LANGUAGE="${envLang}"`);
            return profile;
        }
    }
    const exists = (file) => fs.existsSync(path.join(repoPath, file));
    // Detection order: most specific first
    if (exists("Cargo.toml"))
        return rustProfile;
    if (exists("go.mod"))
        return goProfile;
    if (exists("pyproject.toml") || exists("requirements.txt") || exists("setup.py"))
        return pythonProfile;
    if (exists("Gemfile"))
        return rubyProfile;
    if (exists("pom.xml") || exists("build.gradle") || exists("build.gradle.kts"))
        return javaProfile;
    // Default: TypeScript (covers package.json, tsconfig.json, or bare JS projects)
    return typescriptProfile;
}
/**
 * Detect language and create a context-aware TypeScript profile with dynamic test runner.
 * For TypeScript projects, detects jest/vitest/mocha from package.json and adjusts
 * the test + testTargeted commands accordingly.
 */
export function detectLanguageWithTestRunner(repoPath) {
    const profile = detectLanguage(repoPath);
    // Only customize test runner for TypeScript
    if (profile.id !== "typescript")
        return profile;
    const { test, runner } = detectJsTestRunner(repoPath);
    // Return a customized profile with the detected test runner
    return {
        ...profile,
        test: `${test} 2>&1`,
        testTargeted: runner === "vitest"
            ? (files) => `npx vitest run --related ${files.join(" ")} 2>&1`
            : runner === "jest"
                ? (files) => `npx jest --findRelatedTests ${files.join(" ")} --ci 2>&1`
                : null,
    };
}
/**
 * Find Go module directories (including subdirectories with go.mod).
 */
export function findGoModDirs(repoPath) {
    const dirs = [];
    if (fs.existsSync(path.join(repoPath, "go.mod")))
        dirs.push(repoPath);
    try {
        for (const entry of fs.readdirSync(repoPath)) {
            if (entry === "node_modules" || entry === "vendor" || entry.startsWith("."))
                continue;
            const sub = path.join(repoPath, entry);
            if (fs.statSync(sub).isDirectory() && fs.existsSync(path.join(sub, "go.mod"))) {
                dirs.push(sub);
            }
        }
    }
    catch { /* ignore */ }
    return dirs;
}
