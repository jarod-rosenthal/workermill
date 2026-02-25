***REMOVED***!/usr/bin/env npx ts-node

/**
 * Run TypeScript type checking
 *
 * Inputs (environment variables):
 * - REPO_PATH: Optional. Path to repository. Defaults to current directory
 * - PROJECT: Optional. Project subdirectory (e.g., "backend", "frontend")
 * - STRICT: Optional. Use strict mode if "true"
 *
 * Outputs (JSON to stdout):
 * - success: boolean
 * - errorCount: number
 * - warningCount: number
 * - errors: { file: string, line: number, message: string }[]
 * - error?: string
 */

import { execSync } from "child_process";
import * as path from "path";
import { detectLanguage } from "../../lib/dist/language-profile.js";

interface TypeCheckError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

interface Output {
  success: boolean;
  errorCount: number;
  warningCount: number;
  errors: TypeCheckError[];
  duration?: number;
  error?: string;
}

function exec(cmd: string, cwd?: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120000, // 2 minute timeout
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      exitCode: error.status || 1,
    };
  }
}

function parseTypeScriptErrors(output: string): TypeCheckError[] {
  const errors: TypeCheckError[] = [];

  // Match TypeScript error format: file(line,col): error TSxxxx: message
  const errorRegex = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/gm;

  let match;
  while ((match = errorRegex.exec(output)) !== null) {
    errors.push({
      file: match[1],
      line: parseInt(match[2]),
      column: parseInt(match[3]),
      code: match[5],
      message: match[6],
    });
  }

  // Also match alternative format: file:line:col - error TSxxxx: message
  const altRegex = /^(.+?):(\d+):(\d+)\s*-\s*(error|warning)\s+(TS\d+):\s*(.+)$/gm;

  while ((match = altRegex.exec(output)) !== null) {
    errors.push({
      file: match[1],
      line: parseInt(match[2]),
      column: parseInt(match[3]),
      code: match[5],
      message: match[6],
    });
  }

  return errors;
}

async function main(): Promise<void> {
  const output: Output = {
    success: false,
    errorCount: 0,
    warningCount: 0,
    errors: [],
  };

  const startTime = Date.now();

  try {
    const repoPath = process.env.REPO_PATH || process.cwd();
    const project = process.env.PROJECT || "";

    const projectPath = project ? path.join(repoPath, project) : repoPath;

    const profile = detectLanguage(projectPath);

    if (!profile.typecheck) {
      output.success = true;
      output.error = `No type checking available for ${profile.displayName}`;
      console.log(JSON.stringify(output));
      process.exit(0);
    }

    console.error(`[run_typecheck] Running typecheck (${profile.displayName}) in ${projectPath}`);

    const result = exec(profile.typecheck, projectPath);
    const parsed = profile.parseTypecheck(result.stdout, result.stderr, result.exitCode);

    // For TypeScript, extract detailed error locations
    if (profile.id === "typescript") {
      const allOutput = result.stdout + result.stderr;
      const errors = parseTypeScriptErrors(allOutput);
      output.errors = errors;
      output.errorCount = errors.filter(
        (e) => e.code.startsWith("TS") && !e.message.includes("warning"),
      ).length;
      output.warningCount = errors.length - output.errorCount;

      if (!parsed.passed && errors.length === 0) {
        output.error = allOutput.slice(0, 1000);
      }
    } else {
      output.errorCount = parsed.errors;
    }

    output.success = parsed.passed;
    output.duration = (Date.now() - startTime) / 1000;
  } catch (error: unknown) {
    output.error = error instanceof Error ? error.message : String(error);
    output.duration = (Date.now() - startTime) / 1000;
  }

  console.log(JSON.stringify(output));

  // Output markers
  console.error(`::type_errors::${output.errorCount}`);
  if (output.errors.length > 0) {
    output.errors.slice(0, 5).forEach((e) => {
      console.error(`::error::${e.file}:${e.line} - ${e.code}: ${e.message}`);
    });
  }

  process.exit(output.success ? 0 : 1);
}

main();
