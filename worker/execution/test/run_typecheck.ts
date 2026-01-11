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
import * as fs from "fs";

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

function hasTsConfig(projectPath: string): boolean {
  return (
    fs.existsSync(path.join(projectPath, "tsconfig.json")) ||
    fs.existsSync(path.join(projectPath, "tsconfig.build.json"))
  );
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
    const strict = process.env.STRICT === "true";

    const projectPath = project ? path.join(repoPath, project) : repoPath;

    if (!hasTsConfig(projectPath)) {
      output.success = true;
      output.error = "No tsconfig.json found, skipping type check";
      console.log(JSON.stringify(output));
      process.exit(0);
    }

    console.error(`[run_typecheck] Running tsc in ${projectPath}`);

    // Build tsc command
    let cmd = "npx tsc --noEmit";
    if (strict) {
      cmd += " --strict";
    }

    // Check if using project references (tsc -b)
    const tsConfig = JSON.parse(fs.readFileSync(path.join(projectPath, "tsconfig.json"), "utf-8"));
    if (tsConfig.references) {
      cmd = "npx tsc -b --dry";
    }

    const result = exec(cmd, projectPath);

    // Parse errors
    const allOutput = result.stdout + result.stderr;
    const errors = parseTypeScriptErrors(allOutput);

    output.errors = errors;
    output.errorCount = errors.filter((e) => e.code.startsWith("TS") && !e.message.includes("warning")).length;
    output.warningCount = errors.length - output.errorCount;
    output.success = result.exitCode === 0;
    output.duration = (Date.now() - startTime) / 1000;

    if (!output.success && errors.length === 0) {
      // No parsed errors but still failed - include raw output
      output.error = allOutput.slice(0, 1000);
    }
  } catch (error: unknown) {
    output.error = error instanceof Error ? error.message : String(error);
    output.duration = (Date.now() - startTime) / 1000;
  }

  console.log(JSON.stringify(output));

  // Output markers
  console.error(`::type_errors::${output.errorCount}`);
  if (output.errors.length > 0) {
    // Output first few errors for quick visibility
    output.errors.slice(0, 5).forEach((e) => {
      console.error(`::error::${e.file}:${e.line} - ${e.code}: ${e.message}`);
    });
  }

  process.exit(output.success ? 0 : 1);
}

main();
