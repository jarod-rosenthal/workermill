import type { CliConfig } from "../config.js";
import { createPathScope } from "../engine/path-policy.js";
import { runScopedProcess } from "../engine/scoped-process.js";

/**
 * Stage and commit the current candidate before it is used as final evidence.
 * Git filters can execute code, so this intentionally uses the selected
 * process boundary instead of a raw child process.
 */
export async function prepareCandidate(args: {
  config: CliConfig;
  workingDir: string;
  featureBranch: string | null;
  runId: string;
  signal?: AbortSignal;
  sandboxed: boolean | "os";
}): Promise<{ prepared: boolean; reason?: string }> {
  const signal = args.signal ?? new AbortController().signal;
  if (signal.aborted) return { prepared: false, reason: "Build cancelled before candidate preparation." };
  if (!args.featureBranch) return { prepared: true };
  const scope = createPathScope(args.workingDir, args.config.sandboxCapabilities?.extraPathGrants ?? []);
  const run = (command: string) => runScopedProcess({
    runId: `${args.runId}-candidate-preparation`,
    cwd: scope.workspace,
    signal,
    timeoutMs: 120_000,
    maxOutputBytes: 64 * 1024,
    terminationGraceMs: 2_000,
    command,
  }, {
    sandbox: args.sandboxed,
    scope,
    capabilities: args.config.sandboxCapabilities,
  });
  const failure = (result: Awaited<ReturnType<typeof run>>) => ({
    prepared: false,
    reason: (result.stderr || result.stdout || `candidate preparation ${result.reason}, exit ${result.exitCode}`).slice(0, 1_000),
  });
  // Keep exit statuses separate: failed inspection is not permission to commit.
  // These are constant commands, never interpolated user or model shell text.
  const git = "git -c core.hooksPath=/dev/null -c core.fsmonitor=false";
  const branch = await run(`${git} symbolic-ref --quiet --short HEAD`);
  if (branch.reason !== "exited" || branch.exitCode !== 0 || branch.outputTruncated) return failure(branch);
  if (branch.stdout.trim() !== args.featureBranch) return { prepared: false, reason: "The expected feature branch is no longer checked out." };
  const staged = await run(`${git} add --all`);
  if (staged.reason !== "exited" || staged.exitCode !== 0 || staged.outputTruncated) return failure(staged);
  const diff = await run(`${git} diff --cached --no-ext-diff --no-textconv --quiet`);
  if (diff.reason !== "exited" || diff.outputTruncated || (diff.exitCode !== 0 && diff.exitCode !== 1)) return failure(diff);
  if (diff.exitCode === 1) {
    const committed = await run(`${git} commit --no-verify -m 'chore: uncommitted changes from /build session'`);
    if (committed.reason !== "exited" || committed.exitCode !== 0 || committed.outputTruncated) return failure(committed);
  }
  if (signal.aborted) return { prepared: false, reason: "Build cancelled during candidate preparation." };
  return { prepared: true };
}
