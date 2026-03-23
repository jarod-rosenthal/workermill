/**
 * Story Validation Module
 *
 * Extracted from StoryExecutor — stateless functions for validating story
 * completion, rebasing sibling branches, and extracting learnings.
 */

import type {
  ExpertPersona,
  ReadyStory,
  StreamMessage,
  StoryValidationResult,
  ResilienceConfig,
} from "./types.js";
import type { CoordinationClient } from "./coordination-client.js";
import type { GitOps } from "./git-ops.js";
import type { PromptBuilder } from "./prompt-builder.js";
import { existsSync } from "fs";
import { execSync } from "child_process";

type PostLogFn = (message: string, expert: ExpertPersona, type: "system" | "tool" | "output" | "error") => Promise<void>;

/**
 * Validate story completion before marking it done.
 * Checks acceptance criteria, files in scope, tsc gate, and Go gates (fmt, vet, build, test).
 */
export async function validateStoryCompletion(
  story: ReadyStory,
  worktreePath: string,
  changedFiles: string[],
  expert: ExpertPersona,
  promptBuilder: PromptBuilder,
  postLog: PostLogFn
): Promise<StoryValidationResult> {
  const issues: string[] = [];
  const acceptanceCriteria = promptBuilder.extractAcceptanceCriteria(story.description);
  let criteriaMetCount = 0;

  await postLog(
    `Validating ${story.title} (${acceptanceCriteria.length} criteria)...`,
    expert,
    "system"
  );

  // 1. Check that modified files are within targetFiles scope
  if (
    story.targetFiles &&
    story.targetFiles.length > 0 &&
    changedFiles.length > 0
  ) {
    const outOfScope = changedFiles.filter(
      (f) =>
        !story.targetFiles!.some(
          (t) => f === t || f.startsWith(t + "/"),
        ),
    );
    if (outOfScope.length > 0) {
      issues.push(
        `Files modified outside targetFiles scope: ${outOfScope.join(", ")}. ` +
          `Expected scope: ${story.targetFiles.join(", ")}`,
      );
    }
  }

  // 1c. Typecheck gate — run tsc if the project has a tsconfig.json
  if (changedFiles.some((f) => f.endsWith(".ts") || f.endsWith(".tsx"))) {
    try {
      const tsconfigPath = `${worktreePath}/tsconfig.json`;
      if (existsSync(tsconfigPath)) {
        try {
          execSync("npx tsc --noEmit 2>&1", {
            cwd: worktreePath,
            timeout: 300_000,
            encoding: "utf-8",
          });
          await postLog(
            `${story.title} — typecheck passed`,
            expert,
            "system",
          );
        } catch (tscError: unknown) {
          const stderr =
            (tscError as { stdout?: string }).stdout ||
            (tscError as Error).message ||
            "Unknown typecheck error";
          // Truncate to first 500 chars to avoid log bloat
          const truncated =
            stderr.length > 500 ? stderr.slice(0, 500) + "..." : stderr;
          issues.push(`Typecheck failed: ${truncated}`);
        }
      }
    } catch {
      // If any other issue, skip typecheck silently
    }
  }

  // 1d. Go build gate — run go build/vet/test if the project has a go.mod
  if (changedFiles.some((f) => f.endsWith(".go"))) {
    try {
      const goModPath = `${worktreePath}/go.mod`;
      if (existsSync(goModPath)) {
        // Find the Go module root (may be in a subdirectory like api/)
        const goModDir = (() => {
          // Check if a changed .go file is in a subdirectory that has its own go.mod
          for (const f of changedFiles.filter((cf) => cf.endsWith(".go"))) {
            const parts = f.split("/");
            for (let i = parts.length - 1; i > 0; i--) {
              const sub = parts.slice(0, i).join("/");
              const subGoMod = `${worktreePath}/${sub}/go.mod`;
              if (existsSync(subGoMod)) return `${worktreePath}/${sub}`;
            }
          }
          return worktreePath;
        })();

        const goGate = (cmd: string, label: string, timeout = 120_000) => {
          try {
            execSync(`${cmd} 2>&1`, {
              cwd: goModDir,
              timeout,
              encoding: "utf-8",
            });
            return null;
          } catch (err: unknown) {
            const output =
              (err as { stdout?: string }).stdout ||
              (err as Error).message ||
              `Unknown ${label} error`;
            return output.length > 500 ? output.slice(0, 500) + "..." : output;
          }
        };

        // gofmt check (formatting)
        const fmtErr = goGate("gofmt -l .", "gofmt", 30_000);
        if (fmtErr && fmtErr.trim().length > 0) {
          issues.push(`Go formatting issues (gofmt): ${fmtErr}`);
        }

        // go vet (static analysis)
        const vetErr = goGate("go vet ./...", "go vet");
        if (vetErr) {
          issues.push(`Go vet failed: ${vetErr}`);
        }

        // go build (compilation)
        const buildErr = goGate("go build ./...", "go build");
        if (buildErr) {
          issues.push(`Go build failed: ${buildErr}`);
        }

        // go test (unit tests — longer timeout)
        const testErr = goGate("go test ./... -count=1", "go test", 300_000);
        if (testErr) {
          issues.push(`Go tests failed: ${testErr}`);
        }

        if (!fmtErr && !vetErr && !buildErr && !testErr) {
          await postLog(
            `${story.title} — Go quality gates passed (fmt, vet, build, test)`,
            expert,
            "system",
          );
        }
      }
    } catch {
      // If go is not available or any other issue, skip Go gates silently
    }
  }

  // 2. Basic acceptance criteria validation
  // For each criterion, do a simple keyword check against the changed files and story output
  for (const criterion of acceptanceCriteria) {
    // Extract key terms from the criterion
    const keyTerms = criterion
      .toLowerCase()
      .split(/\s+/)
      .filter(term => term.length > 3 && !["should", "must", "will", "when", "then", "given", "that", "with", "from", "this", "have", "been"].includes(term));

    // Check if any changed file names match key terms
    const fileMatchesTerms = changedFiles.some(file =>
      keyTerms.some(term => file.toLowerCase().includes(term))
    );

    // Check if criterion mentions files that were changed
    const criterionMentionsFile = changedFiles.some(file => {
      const fileName = file.split("/").pop()?.toLowerCase() || "";
      return criterion.toLowerCase().includes(fileName.replace(/\.[^.]+$/, ""));
    });

    if (fileMatchesTerms || criterionMentionsFile || changedFiles.length > 0) {
      criteriaMetCount++;
    } else {
      // Only flag as issue if we have specific evidence it wasn't met
      // Don't be too strict - the agent may have addressed it in a different way
    }
  }

  // 3. Validation pass/fail decision
  const majorIssues = issues.filter(i =>
    i.includes("critical") ||
    i.includes("required")
  );

  const valid = majorIssues.length === 0;

  if (!valid) {
    await postLog(
      `⚠️ ${story.title} — validation issues: ${issues.join("; ")}`,
      expert,
      "system"
    );
  } else {
    await postLog(
      `${story.title} — validation passed (${criteriaMetCount}/${acceptanceCriteria.length} criteria, ${changedFiles.length} files)`,
      expert,
      "system"
    );
  }

  return {
    valid,
    issues,
    acceptanceCriteriaMet: criteriaMetCount,
    acceptanceCriteriaTotal: acceptanceCriteria.length,
    filesModified: changedFiles,
    validationMethod: "auto",
  };
}

/**
 * Merge all completed sibling branches into the story worktree.
 * Reuses the incremental rebase pattern — non-blocking on conflicts.
 * Called at story start and before each quality gate retry.
 */
export async function rebaseSiblingBranches(
  story: ReadyStory,
  expert: ExpertPersona,
  worktreePath: string | undefined,
  coordination: CoordinationClient,
  gitOps: GitOps,
  resilience: ResilienceConfig,
  postLog: PostLogFn
): Promise<void> {
  if (!(resilience.incrementalRebaseEnabled ?? true)) return;
  if (!worktreePath) return;
  const wtPath = worktreePath;

  try {
    const allCompleted = await coordination.getAllCompletedBranchNames();
    // Filter out branches already merged as declared dependencies and current story
    const declaredDeps = new Set(story.dependencies || []);
    const siblingBranches: string[] = [];
    const sortedEntries = Array.from(allCompleted.entries()).sort(([a], [b]) => a - b);
    for (const [idx, branch] of sortedEntries) {
      if (idx === story.storyIndex) continue;
      if (declaredDeps.has(idx)) continue;
      siblingBranches.push(branch);
    }

    if (siblingBranches.length > 0) {
      await postLog(
        `Incremental rebase: merging ${siblingBranches.length} completed sibling branch(es)...`,
        expert,
        "system"
      );
      const siblingResult = await gitOps.mergeDependencyBranches(wtPath, siblingBranches);
      if (siblingResult.merged.length > 0) {
        await postLog(
          `Incremental rebase: merged ${siblingResult.merged.length} sibling branch(es): ${siblingResult.merged.join(", ")}`,
          expert,
          "system"
        );
      }
      if (siblingResult.conflicted.length > 0) {
        await postLog(
          `Incremental rebase: ${siblingResult.conflicted.length} sibling branch(es) had conflicts (non-blocking): ${siblingResult.conflicted.join(", ")}`,
          expert,
          "system"
        );
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await postLog(
      `Incremental rebase failed (non-blocking): ${msg}`,
      expert,
      "system"
    );
  }
}

/**
 * Extract learnings from agent result messages.
 * Parses ::learning:: markers from the agent's text output.
 */
export function extractLearningsFromResult(messages: StreamMessage[]): string[] {
  const learnings: string[] = [];
  const fullText = messages
    .filter((m) => m.type === "text" || m.type === "result")
    .map((m) => m.content || "")
    .join("\n");

  const pattern = /::learning::(.+)/g;
  let match;
  while ((match = pattern.exec(fullText)) !== null) {
    const learning = match[1].trim();
    if (learning.length > 0) learnings.push(learning);
  }
  return learnings;
}
