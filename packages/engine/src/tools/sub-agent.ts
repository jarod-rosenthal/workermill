import { streamText, stepCountIs } from "ai";
import type { LanguageModel, tool } from "ai";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

export const name = "sub_agent";

export const description =
  "Spawn a sub-agent to explore or modify the codebase. By default, the sub-agent is read-only " +
  "(can read files, search, and list directories). Set isolated=true to run in a git worktree " +
  "with full write access — changes stay on a separate branch for you to review.";

export const parameters = {
  type: "object" as const,
  properties: {
    prompt: {
      type: "string" as const,
      description:
        "A detailed task description for the sub-agent. Be specific about what to look for or change.",
    },
    maxTurns: {
      type: "number" as const,
      description:
        "Maximum number of tool-use turns (default: 20). Higher values allow deeper exploration.",
    },
    isolated: {
      type: "boolean" as const,
      description:
        "Run in an isolated git worktree with full read+write tools. " +
        "Changes stay on a separate branch — not applied to your working tree. Default: false.",
    },
  },
  required: ["prompt"] as const,
};

interface SubAgentParams {
  prompt: string;
  maxTurns?: number;
  isolated?: boolean;
}

interface SubAgentResult {
  success: boolean;
  content: string;
  turnsUsed: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Worktree helpers
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join("-")
    .slice(0, 40) || "task";
}

interface WorktreeInfo {
  worktreePath: string;
  branchName: string;
}

function createWorktree(workingDir: string, prompt: string): WorktreeInfo {
  const slug = slugify(prompt);
  const timestamp = Math.floor(Date.now() / 1000);
  const name = `${slug}-${timestamp}`;
  const branchName = `worktree-${name}`;
  const worktreeBase = path.join(workingDir, ".workermill", "worktrees");
  let worktreePath = path.join(worktreeBase, name);

  // Handle path collision
  let suffix = 2;
  while (fs.existsSync(worktreePath)) {
    worktreePath = path.join(worktreeBase, `${name}-${suffix}`);
    suffix++;
  }

  fs.mkdirSync(worktreeBase, { recursive: true });

  execSync(
    `git worktree add -b "${branchName}" "${worktreePath}" HEAD`,
    { cwd: workingDir, stdio: "pipe", timeout: 120_000 },
  );

  return { worktreePath, branchName };
}

function hasChanges(worktreePath: string): boolean {
  try {
    const status = execSync("git status --porcelain", {
      cwd: worktreePath, encoding: "utf-8", stdio: "pipe",
    }).trim();
    // Also check if there are new commits beyond what HEAD was
    const headAtStart = execSync("git rev-parse HEAD", {
      cwd: worktreePath, encoding: "utf-8", stdio: "pipe",
    }).trim();
    // Check uncommitted changes OR new commits
    return status.length > 0 || hasNewCommits(worktreePath);
  } catch {
    return false;
  }
}

function hasNewCommits(worktreePath: string): boolean {
  try {
    // Compare current HEAD to the parent repo's HEAD
    const log = execSync("git log --oneline HEAD ^HEAD~0 2>/dev/null || true", {
      cwd: worktreePath, encoding: "utf-8", stdio: "pipe",
    }).trim();
    return log.length > 0;
  } catch {
    return false;
  }
}

function getDiffStat(worktreePath: string): string {
  try {
    // Get diff of uncommitted changes
    const uncommitted = execSync("git diff --stat HEAD", {
      cwd: worktreePath, encoding: "utf-8", stdio: "pipe",
    }).trim();
    // Get diff of committed changes vs original HEAD
    const staged = execSync("git diff --stat --cached", {
      cwd: worktreePath, encoding: "utf-8", stdio: "pipe",
    }).trim();
    return [uncommitted, staged].filter(Boolean).join("\n") || "(committed changes only)";
  } catch {
    return "";
  }
}

function removeWorktree(worktreePath: string, branchName: string, force = false): void {
  try {
    const flag = force ? "--force" : "";
    execSync(`git worktree remove ${flag} "${worktreePath}"`, { stdio: "pipe", timeout: 30_000 });
  } catch {
    // Best effort — worktree may already be gone
  }
  try {
    execSync(`git branch -d "${branchName}"`, { stdio: "pipe", timeout: 10_000 });
  } catch {
    // Branch may have commits — don't force delete
  }
}

/**
 * Clean up any stale worktrees in .workermill/worktrees/.
 * Call on CLI exit.
 */
export function cleanupStaleWorktrees(workingDir: string): void {
  const worktreeBase = path.join(workingDir, ".workermill", "worktrees");
  if (!fs.existsSync(worktreeBase)) return;
  try {
    execSync("git worktree prune", { cwd: workingDir, stdio: "pipe", timeout: 10_000 });
  } catch {
    // Best effort
  }
}

// ---------------------------------------------------------------------------
// Sub-agent executor
// ---------------------------------------------------------------------------

export function createSubAgentExecutor(
  model: LanguageModel,
  workingDir: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readOnlyTools: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  writeToolsFactory?: (worktreePath: string) => Record<string, any>,
) {
  return async function execute({
    prompt,
    maxTurns = 20,
    isolated = false,
  }: SubAgentParams): Promise<SubAgentResult> {
    // Non-isolated: read-only, same as before
    if (!isolated) {
      return runSubAgent(model, readOnlyTools, prompt, maxTurns,
        "You are a codebase exploration agent. You can read files, search for patterns, " +
        "and list directories to understand the codebase. You CANNOT modify any files. " +
        "Provide a thorough, detailed answer to the task you are given. " +
        "Include specific file paths, line numbers, and code snippets in your findings.");
    }

    // Isolated: create worktree, give full tools, run, handle teardown
    let worktree: WorktreeInfo | null = null;
    try {
      // Verify git repo
      execSync("git rev-parse --is-inside-work-tree", { cwd: workingDir, stdio: "pipe" });
    } catch {
      return {
        success: false,
        content: "",
        turnsUsed: 0,
        error: "Cannot create isolated worktree — not inside a git repository.",
      };
    }

    try {
      worktree = createWorktree(workingDir, prompt);
    } catch (err) {
      return {
        success: false,
        content: "",
        turnsUsed: 0,
        error: `Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    try {
      const tools = writeToolsFactory
        ? writeToolsFactory(worktree.worktreePath)
        : readOnlyTools;

      const result = await runSubAgent(model, tools, prompt, maxTurns,
        `You are working in an isolated copy of the repository at ${worktree.worktreePath}. ` +
        "You have full read and write access. Make your changes and commit them when done. " +
        "Your changes will NOT be automatically applied — they stay on a separate branch for review.");

      // Teardown based on whether changes were made
      if (!hasChanges(worktree.worktreePath)) {
        removeWorktree(worktree.worktreePath, worktree.branchName);
        return result;
      }

      // Changes exist — leave worktree, include info in result
      const diffStat = getDiffStat(worktree.worktreePath);
      const relPath = path.relative(workingDir, worktree.worktreePath);
      result.content += `\n\nChanges on branch \`${worktree.branchName}\` at \`${relPath}/\`\n${diffStat}`;
      return result;

    } catch (err) {
      // Failure — leave worktree for debugging
      const relPath = worktree ? path.relative(workingDir, worktree.worktreePath) : "unknown";
      return {
        success: false,
        content: "",
        turnsUsed: 0,
        error: `Sub-agent failed: ${err instanceof Error ? err.message : String(err)}\n\nWorktree preserved at \`${relPath}/\` for inspection.`,
      };
    }
  };
}

async function runSubAgent(
  model: LanguageModel,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: Record<string, any>,
  prompt: string,
  maxTurns: number,
  systemPrompt: string,
): Promise<SubAgentResult> {
  try {
    let turnsUsed = 0;
    const stream = streamText({
      model,
      system: systemPrompt,
      prompt,
      tools,
      stopWhen: stepCountIs(maxTurns),
      abortSignal: AbortSignal.timeout(5 * 60 * 1000),
      onStepFinish() {
        turnsUsed++;
      },
    });

    for await (const _chunk of stream.textStream) {
      // Consume stream to drive execution
    }

    const text = await stream.text;

    return {
      success: true,
      content: text,
      turnsUsed,
    };
  } catch (err) {
    return {
      success: false,
      content: "",
      turnsUsed: 0,
      error: `Sub-agent failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
