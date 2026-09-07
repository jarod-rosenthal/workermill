import type { CliConfig } from "../config.js";
import { createPathScope } from "../engine/path-policy.js";
import { runScopedProcess } from "../engine/scoped-process.js";
import { runProcess } from "../engine/process-runner.js";

export class ReviewGitError extends Error {
  constructor(message: string) { super(message); this.name = "ReviewGitError"; }
}

/** Repository-derived context is evidence, not permission to run host filters. */
export function createReviewGit(options: {
  workingDir: string;
  runId: string;
  signal?: AbortSignal;
  sandboxed: boolean | "os";
  capabilities?: CliConfig["sandboxCapabilities"];
}) {
  const scope = createPathScope(options.workingDir, options.capabilities?.extraPathGrants);
  const signal = options.signal ?? new AbortController().signal;
  const quote = (arg: string) => `'${arg.replace(/'/g, "'\\''")}'`;
  const run = async (args: string[], executable: "git" | "gh" = "git"): Promise<string> => {
    signal.throwIfAborted();
    const request = {
      runId: `${options.runId}-review-context`, cwd: scope.workspace, signal,
      timeoutMs: executable === "gh" ? 30_000 : 10_000,
      maxOutputBytes: 16 * 1024 * 1024, terminationGraceMs: 250,
      command: [executable, ...(executable === "git"
        ? ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "color.ui=false"] : []), ...args].map(quote).join(" "),
    };
    let result: Awaited<ReturnType<typeof runProcess>>;
    try {
      result = executable === "git"
        ? await runScopedProcess(request, { sandbox: options.sandboxed, scope, capabilities: options.capabilities })
        : await runProcess(request);
    } catch {
      signal.throwIfAborted();
      throw new ReviewGitError("Review context process boundary failed");
    }
    signal.throwIfAborted();
    if (result.reason !== "exited" || result.exitCode !== 0 || result.outputTruncated) {
      throw new ReviewGitError(`Could not read complete review context (${executable}: ${result.reason}, exit ${result.exitCode})`);
    }
    return result.stdout.trim();
  };
  const resolveCommit = async (ref: string): Promise<string> => {
    const hash = await run(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
    if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new ReviewGitError("Invalid review revision identity");
    return hash;
  };
  const diff = (args: string[]) => run(["diff", "--no-ext-diff", "--no-textconv", ...args, "--"]);
  return {
    head: () => resolveCommit("HEAD"),
    async defaultBranch(): Promise<string> {
      try { return (await run(["symbolic-ref", "refs/remotes/origin/HEAD"])).replace(/^refs\/remotes\/origin\//, ""); }
      catch { signal.throwIfAborted(); return "main"; }
    },
    async branchDiff(base: string): Promise<{ stat: string; diff: string }> {
      const range = `${await resolveCommit(base)}..HEAD`;
      return { stat: await diff(["--stat", range]), diff: await diff([range]) };
    },
    async delta(base: string): Promise<string> { return diff([`${await resolveCommit(base)}..HEAD`]); },
    async uncommitted(): Promise<{ stat: string; diff: string }> {
      // No fallback from an unavailable HEAD to apparently empty evidence.
      return { stat: await diff(["--stat", "HEAD"]), diff: await diff(["HEAD"]) };
    },
    async prDiff(number: string): Promise<string> {
      if (!/^\d+$/.test(number)) throw new ReviewGitError("Invalid pull request number");
      return run(["pr", "diff", number], "gh");
    },
    async priorWork(base: string, storyIndex: number): Promise<string> {
      if (!Number.isSafeInteger(storyIndex) || storyIndex < 1) throw new ReviewGitError("Invalid story index");
      const range = `${await resolveCommit(base)}..HEAD`;
      const log = await run(["log", range, "--format=%H%x09%s", "--no-merges", `--grep=Story: S${storyIndex}`, "-10", "--"]);
      if (!log) return "";
      const commits = log.split("\n");
      const files = new Set<string>();
      for (const commit of commits) {
        const hash = commit.split("\t")[0];
        if (!/^[a-f0-9]{40,64}$/.test(hash)) throw new ReviewGitError("Invalid prior-work revision identity");
        const changed = await run(["diff-tree", "--no-commit-id", "--name-only", "--no-ext-diff", "--no-textconv", "-r", hash, "--"]);
        for (const file of changed.split("\n").filter(Boolean)) files.add(file);
      }
      return [`### What You Did Last Time (Story ${storyIndex})`,
        "Use the recorded prior work to avoid repeating the same mistakes.",
        "**Commits from previous attempt:**", ...commits.map(commit => `- ${commit}`),
        `**Files changed (${files.size}):** ${[...files].join(", ")}`].join("\n");
    },
  };
}
