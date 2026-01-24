"use strict";
// V2 Reference File Resolution
//
// Resolves reference file patterns to actual file paths before step execution.
// Called by the worker to expand wildcards and verify file existence.
//
// Supports three types of reference file entries:
// - Exact paths: src/auth/Login.tsx
// - Glob patterns: src/**/*.ts (wildcard patterns)
// - Descriptions: [the main auth module]
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveReferenceFiles = resolveReferenceFiles;
const fs_1 = require("fs");
const fast_glob_1 = require("fast-glob");
const path_1 = __importDefault(require("path"));
/**
 * Classify a reference file entry
 */
function classifyReferenceFile(ref) {
    if (ref.startsWith("[") && ref.endsWith("]")) {
        return "description";
    }
    if (ref.includes("*") || ref.includes("?") || ref.includes("{")) {
        return "glob";
    }
    return "exact";
}
/**
 * Build instruction for agent when file pattern couldn't be resolved
 */
function buildUnresolvedInstruction(ref, type) {
    if (type === "description") {
        const description = ref.slice(1, -1);
        return `Find the file matching this description: "${description}"`;
    }
    return `Find files matching pattern: ${ref}`;
}
/**
 * Resolve reference file patterns to actual paths
 *
 * @param referenceFiles - Array of file paths, glob patterns, or descriptions
 * @param workDir - Working directory (repo root)
 * @returns Resolution result with resolved paths and instructions
 */
async function resolveReferenceFiles(referenceFiles, workDir) {
    const resolvedPaths = [];
    const unresolvedInstructions = [];
    const log = [];
    for (const ref of referenceFiles) {
        const type = classifyReferenceFile(ref);
        log.push(`[${type}] ${ref}`);
        if (type === "description") {
            // Descriptions can't be resolved - pass to agent
            const instruction = buildUnresolvedInstruction(ref, type);
            unresolvedInstructions.push(instruction);
            log.push(`  -> Unresolved: ${instruction}`);
            continue;
        }
        if (type === "exact") {
            // Check if exact path exists
            const fullPath = path_1.default.join(workDir, ref);
            try {
                await fs_1.promises.access(fullPath);
                resolvedPaths.push(ref);
                log.push(`  -> Resolved: ${ref}`);
            }
            catch {
                // File doesn't exist yet - might be created by earlier step
                // Pass as instruction for agent to find
                const instruction = `Verify file exists: ${ref}`;
                unresolvedInstructions.push(instruction);
                log.push(`  -> Not found: ${instruction}`);
            }
            continue;
        }
        // Glob pattern - expand it
        try {
            const matches = await (0, fast_glob_1.glob)(ref, {
                cwd: workDir,
                ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.next/**"],
                onlyFiles: true,
            });
            if (matches.length > 0) {
                resolvedPaths.push(...matches);
                log.push(`  -> Resolved ${matches.length} files: ${matches.join(", ")}`);
            }
            else {
                // Pattern matched nothing - pass to agent
                const instruction = buildUnresolvedInstruction(ref, type);
                unresolvedInstructions.push(instruction);
                log.push(`  -> No matches: ${instruction}`);
            }
        }
        catch (error) {
            log.push(`  -> Glob error: ${error}`);
            const instruction = buildUnresolvedInstruction(ref, type);
            unresolvedInstructions.push(instruction);
        }
    }
    return { resolvedPaths, unresolvedInstructions, log };
}
/**
 * CLI entrypoint for testing
 */
async function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.log("Usage: resolve-reference-files.ts <workDir> [pattern1] [pattern2] ...");
        console.log("");
        console.log("Examples:");
        console.log("  resolve-reference-files.ts . 'src/**/*.ts'");
        console.log("  resolve-reference-files.ts . 'src/auth/Login.tsx' 'src/**/auth*.ts' '[the main API module]'");
        process.exit(1);
    }
    const workDir = args[0];
    const patterns = args.slice(1);
    if (patterns.length === 0) {
        console.log("No patterns provided");
        process.exit(0);
    }
    const result = await resolveReferenceFiles(patterns, workDir);
    console.log("=== Resolution Log ===");
    result.log.forEach((line) => console.log(line));
    console.log("\n=== Resolved Paths ===");
    result.resolvedPaths.forEach((p) => console.log(`  ${p}`));
    console.log("\n=== Unresolved Instructions ===");
    result.unresolvedInstructions.forEach((i) => console.log(`  ${i}`));
    // Output JSON for script consumption
    console.log("\n=== JSON Output ===");
    console.log(JSON.stringify(result, null, 2));
}
// Run CLI if executed directly
if (require.main === module) {
    main().catch(console.error);
}
