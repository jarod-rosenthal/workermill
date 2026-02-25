/**
 * Language Profile Utility — Multi-Language Support for Worker Scripts
 *
 * Centralizes language detection, commands, and output parsers for:
 * TypeScript, Python, Rust, Go, Java, Ruby
 *
 * Used by quality-runner.ts, execution scripts (run_tests, run_typecheck, analyze_code).
 */
export interface LanguageProfile {
    id: string;
    displayName: string;
    /** Filesystem markers for detection (e.g. "Cargo.toml") */
    markers: string[];
    /** Source file extensions for LOC counting */
    extensions: string[];
    /** Commands (null = not available for this language) */
    typecheck: string | null;
    lint: string | null;
    test: string;
    testTargeted: ((files: string[]) => string) | null;
    audit: string | null;
    /** Output parsers */
    parseTypecheck(stdout: string, stderr: string, exitCode: number): {
        errors: number;
        passed: boolean;
    };
    parseLint(stdout: string, stderr: string): {
        errors: number;
        warnings: number;
    };
    parseTests(stdout: string, stderr: string): {
        passed: number;
        failed: number;
        skipped: number;
    };
    parseAudit(stdout: string): {
        high: number;
        medium: number;
        low: number;
    };
}
export declare const ALL_PROFILES: Record<string, LanguageProfile>;
/**
 * Get a language profile by ID.
 */
export declare function getProfile(id: string): LanguageProfile;
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
export declare function detectLanguage(repoPath: string): LanguageProfile;
/**
 * Detect language and create a context-aware TypeScript profile with dynamic test runner.
 * For TypeScript projects, detects jest/vitest/mocha from package.json and adjusts
 * the test + testTargeted commands accordingly.
 */
export declare function detectLanguageWithTestRunner(repoPath: string): LanguageProfile;
/**
 * Find Go module directories (including subdirectories with go.mod).
 */
export declare function findGoModDirs(repoPath: string): string[];
