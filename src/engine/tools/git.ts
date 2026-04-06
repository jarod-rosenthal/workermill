import { execSync } from "child_process";

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

interface GitParams {
  action: string;
  args?: string;
  cwd?: string;
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

export async function execute({ action, args, cwd }: GitParams): Promise<GitResult> {
  const workDir = cwd || process.cwd();

  // Block dangerous operations
  const fullCmd = `${action} ${args || ""}`;
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(fullCmd)) {
      return { success: false, output: "", error: `Blocked: destructive git operation "${fullCmd}"` };
    }
  }

  const cmdMap: Record<string, string> = {
    status: `git status${args ? " " + args : " --short"}`,
    diff: `git diff${args ? " " + args : ""}`,
    log: `git log${args ? " " + args : " --oneline -20"}`,
    add: `git add ${args || "."}`,
    commit: `git commit -m "${(args || "").replace(/"/g, '\\"')}"`,
    branch: `git branch${args ? " " + args : ""}`,
    checkout: `git checkout ${args || ""}`,
    stash: `git stash${args ? " " + args : ""}`,
  };

  const cmd = cmdMap[action];
  if (!cmd) {
    return { success: false, output: "", error: `Unknown git action: ${action}` };
  }

  try {
    const output = execSync(cmd, {
      cwd: workDir,
      encoding: "utf-8",
      timeout: 30000,
    });
    return { success: true, output: output.trim() };
  } catch (err: any) {
    return {
      success: false,
      output: err.stdout?.trim() || "",
      error: err.stderr?.trim() || err.message,
    };
  }
}
