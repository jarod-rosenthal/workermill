import { randomUUID } from "node:crypto";
import { runProcess, type ProcessRequest, type ProcessResult } from "../process-runner.js";

export const name = "git";

export const description =
  "Execute git operations. Supports: status, diff, log, add, commit, branch, checkout, stash. Blocks destructive operations like force-push or reset --hard.";

export const parameters = {
  type: "object" as const,
  properties: {
    action: {
      type: "string" as const,
      enum: ["status", "diff", "log", "add", "commit", "branch", "checkout", "stash"],
      description: "The git action to perform",
    },
    args: {
      type: "string" as const,
      description: "Additional arguments (e.g., file paths, branch name, commit message)",
    },
  },
  required: ["action"] as const,
};

export interface GitParams {
  action: string;
  args?: string;
  cwd?: string;
  runId?: string;
  signal?: AbortSignal;
  /** Registered tools bind this to their selected sandbox and scope. */
  runProcess?: (request: ProcessRequest) => Promise<ProcessResult>;
}

interface GitResult {
  success: boolean;
  output: string;
  error?: string;
}

const BLOCKED_PATTERNS = [
  /--force/,
  /--hard/,
  /push.*-f\b/,
  /reset.*--hard/,
  /clean\s+-[a-z]*f/,
  /branch\s+-D\b/,
];

function parseArgs(args: string | undefined): string[] {
  if (!args?.trim()) return [];

  const result: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaping = false;

  for (const ch of args) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      continue;
    }
    if ((ch === "'" || ch === "\"") && !quote) {
      quote = ch;
      continue;
    }
    if (ch === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(ch) && !quote) {
      if (current) {
        result.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (escaping) current += "\\";
  if (quote) throw new Error("Unterminated quoted git argument");
  if (current) result.push(current);
  return result;
}

export async function execute({ action, args, cwd, runId, signal, runProcess: runner = runProcess }: GitParams): Promise<GitResult> {
  const workDir = cwd || process.cwd();

  // Block dangerous operations
  const fullCmd = `${action} ${args || ""}`;
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(fullCmd)) {
      return { success: false, output: "", error: `Blocked: destructive git operation "${fullCmd}"` };
    }
  }

  let gitArgs: string[];
  try {
    switch (action) {
      case "status":
        gitArgs = ["status", ...(args ? parseArgs(args) : ["--short"])];
        break;
      case "diff":
        gitArgs = ["diff", ...parseArgs(args)];
        break;
      case "log":
        gitArgs = ["log", ...(args ? parseArgs(args) : ["--oneline", "-20"])];
        break;
      case "add":
        gitArgs = ["add", ...(args ? parseArgs(args) : ["."])];
        break;
      case "commit":
        gitArgs = ["commit", "-m", args || ""];
        break;
      case "branch":
        gitArgs = ["branch", ...parseArgs(args)];
        break;
      case "checkout":
        gitArgs = ["checkout", ...parseArgs(args)];
        break;
      case "stash":
        gitArgs = ["stash", ...parseArgs(args)];
        break;
      default:
        return { success: false, output: "", error: `Unknown git action: ${action}` };
    }
  } catch (err) {
    return { success: false, output: "", error: err instanceof Error ? err.message : String(err) };
  }

  try {
    // The shared runner takes a shell command so it can wrap OS isolation.
    // Quote each parsed argument separately: model input never becomes shell
    // syntax, including command substitution inside a commit message.
    const command = ["git", ...gitArgs].map((argument) => `'${argument.replaceAll("'", "'\\''")}'`).join(" ");
    const result = await runner({
      command,
      cwd: workDir,
      runId: runId ?? `git-${randomUUID()}`,
      signal: signal ?? new AbortController().signal,
      timeoutMs: 30_000,
      maxOutputBytes: 1024 * 1024,
      terminationGraceMs: 250,
    });
    const marker = result.outputTruncated ? "\n[output truncated: git output exceeded 1 MiB]" : "";
    const output = result.stdout.trim() + marker;
    if (result.reason === "exited" && result.exitCode === 0) return { success: true, output };
    return {
      success: false,
      output,
      error: result.reason === "exited"
        ? result.stderr.trim() || `Git exited with code ${result.exitCode}`
        : `Git ${result.reason}: ${result.stderr.trim()}`,
    };
  } catch (err: unknown) {
    return {
      success: false,
      output: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
