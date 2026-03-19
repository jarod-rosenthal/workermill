/**
 * Coordinator Stories Module
 *
 * Handles story execution flow: claiming stories, managing mutex/file-overlap
 * conflicts, dispatching stories to experts, and handling story failures.
 */

import { execSync } from "child_process";
import type {
  ExpertPersona,
  ExpertState,
  ReadyStory,
  EpicConfig,
  ResilienceConfig,
} from "./types.js";
import { matchPersonaToExpert } from "./experts.js";
import type { CoordinationClient } from "./coordination-client.js";
import type { StoryExecutor } from "./executor.js";
import type { GitOps } from "./git-ops.js";
import type { BlockerManager } from "./blocker-manager.js";
import type { CredentialRotator } from "./credential-rotator.js";
import { cleanupMessageFiles } from "./coordinator-commands.js";
import { postDashboardLog } from "./coordinator-utils.js";

/**
 * Check if a story has a mutex conflict with any currently running story.
 * Stories in the same mutex group cannot run in parallel to prevent file conflicts.
 */
export function hasMutexConflict(
  story: ReadyStory,
  runningStoryMutexGroups: Map<number, string[]>
): boolean {
  const storyMutexGroups = story.mutexGroups || [];

  if (storyMutexGroups.length === 0) {
    return false;
  }

  for (const [runningIndex, runningGroups] of runningStoryMutexGroups) {
    if (runningIndex === story.storyIndex) continue;

    for (const group of storyMutexGroups) {
      if (runningGroups.includes(group)) {
        console.log(
          `[Epic] Story ${story.storyIndex} blocked by mutex conflict with running story ${runningIndex} (group: ${group})`
        );
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a story has file-overlap conflicts with any currently running story.
 * Stories targeting the same files cannot run in parallel.
 */
export function hasFileOverlap(
  config: EpicConfig,
  story: ReadyStory,
  resilience: ResilienceConfig,
  runningStoryTargetFiles: Map<number, string[]>
): boolean {
  if (!(resilience.fileOverlapGatingEnabled ?? true)) {
    return false;
  }

  const storyFiles = story.targetFiles || [];
  if (storyFiles.length === 0) {
    return false;
  }

  const storyFilesLower = storyFiles.map((f) => f.toLowerCase());

  for (const [runningIndex, runningFiles] of runningStoryTargetFiles) {
    if (runningIndex === story.storyIndex) continue;
    if (runningFiles.length === 0) continue;

    const runningFilesLower = runningFiles.map((f) => f.toLowerCase());
    const overlap = storyFilesLower.filter((f) => runningFilesLower.includes(f));

    if (overlap.length > 0) {
      const msg = `Story ${story.storyIndex} blocked by file overlap with running story ${runningIndex} (${overlap.join(", ")})`;
      console.log(`[Epic] ${msg}`);
      postDashboardLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, msg);
      return true;
    }
  }

  return false;
}

/**
 * Register a story as running with its mutex groups and target files.
 * Called when a story is claimed and starts execution.
 */
export function registerRunningStory(
  storyIndex: number,
  mutexGroups: string[],
  targetFiles: string[] | undefined,
  runningStoryMutexGroups: Map<number, string[]>,
  runningStoryTargetFiles: Map<number, string[]>
): void {
  runningStoryMutexGroups.set(storyIndex, mutexGroups);
  runningStoryTargetFiles.set(storyIndex, targetFiles || []);
  if (mutexGroups.length > 0) {
    console.log(`[Epic] Registered story ${storyIndex} with mutex groups: ${mutexGroups.join(", ")}`);
  }
  if (targetFiles && targetFiles.length > 0) {
    console.log(`[Epic] Registered story ${storyIndex} with ${targetFiles.length} target file(s)`);
  }
}

/**
 * Unregister a story from running stories.
 * Called when a story completes (success or failure).
 */
export function unregisterRunningStory(
  storyIndex: number,
  runningStoryMutexGroups: Map<number, string[]>,
  runningStoryTargetFiles: Map<number, string[]>
): void {
  if (runningStoryMutexGroups.has(storyIndex)) {
    console.log(`[Epic] Unregistered story ${storyIndex} from mutex tracking`);
    runningStoryMutexGroups.delete(storyIndex);
  }
  runningStoryTargetFiles.delete(storyIndex);
}

/**
 * Scan running experts' worktrees for actual file modifications.
 * Updates runningStoryTargetFiles with real data so hasFileOverlap() gates
 * new stories based on actual modifications, not just planner predictions.
 */
export function scanRunningWorktrees(
  config: EpicConfig,
  expertStates: Map<ExpertPersona, ExpertState>,
  activeWorktrees: Map<number, string>,
  runningStoryTargetFiles: Map<number, string[]>,
  gitOps: GitOps
): void {
  const mainBranch = gitOps.getMainBranch();

  for (const [persona, state] of expertStates) {
    if (state.status !== "working" || state.currentStoryIndex === undefined) continue;

    const storyIndex = state.currentStoryIndex;
    const worktreePath = activeWorktrees.get(storyIndex);
    if (!worktreePath) continue;

    try {
      // Uncommitted changes (staged + unstaged)
      const uncommitted = execSync("git diff --name-only HEAD", {
        cwd: worktreePath,
        timeout: 5000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      })
        .trim()
        .split("\n")
        .filter(Boolean);

      // Committed changes on this branch vs main
      const committed = execSync(
        `git diff --name-only origin/${mainBranch}..HEAD`,
        {
          cwd: worktreePath,
          timeout: 5000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      )
        .trim()
        .split("\n")
        .filter(Boolean);

      const actualFiles = [...new Set([...uncommitted, ...committed])];
      if (actualFiles.length === 0) continue;

      const declared = runningStoryTargetFiles.get(storyIndex) || [];
      const declaredLower = new Set(declared.map((f) => f.toLowerCase()));
      const newFiles = actualFiles.filter(
        (f) => !declaredLower.has(f.toLowerCase()),
      );

      if (newFiles.length === 0) continue;

      // Merge actual files into the gating map
      const merged = [...declared, ...newFiles];
      runningStoryTargetFiles.set(storyIndex, merged);
      console.log(
        `[Epic] Worktree scan: story ${storyIndex} (${persona}) touching ${newFiles.length} undeclared file(s): ${newFiles.slice(0, 5).join(", ")}${newFiles.length > 5 ? "..." : ""}`,
      );

      // Check if newly detected files overlap with another running story
      const newFilesLower = new Set(newFiles.map((f) => f.toLowerCase()));
      for (const [otherIndex, otherFiles] of runningStoryTargetFiles) {
        if (otherIndex === storyIndex) continue;
        if (otherFiles.length === 0) continue;

        const overlap = otherFiles.filter((f) =>
          newFilesLower.has(f.toLowerCase()),
        );
        if (overlap.length > 0) {
          const msg = `⚠️ Worktree scan: story ${storyIndex} now overlaps with story ${otherIndex} on: ${overlap.join(", ")}`;
          console.warn(`[Epic] ${msg}`);
          postDashboardLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, msg);
        }
      }
    } catch {
      // Non-fatal: worktree may be mid-rebase, not yet created, or just cleaned up
    }
  }
}

/**
 * Handle a story failure - check for auto-retry or escalate as blocker.
 */
export async function handleStoryFailure(
  config: EpicConfig,
  resilience: ResilienceConfig,
  story: ReadyStory,
  expert: ExpertPersona,
  errorMessage: string,
  expertStates: Map<ExpertPersona, ExpertState>,
  failedStoryIndices: Set<number>,
  blockedStoryIndices: Set<number>,
  blockerManager: BlockerManager | null,
  coordination: CoordinationClient
): Promise<void> {
  // Update expert state to blocked
  expertStates.set(expert, {
    persona: expert,
    status: "blocked",
    currentStoryId: story.id,
    currentStoryIndex: story.storyIndex,
  });

  // Track as failed
  failedStoryIndices.add(story.storyIndex);

  if (!blockerManager) {
    console.log(`[Epic] Story ${story.storyIndex} failed (no blocker manager): ${errorMessage}`);
    return;
  }

  // Check if we should auto-retry
  if (await blockerManager.shouldAutoRetry(story.storyIndex, errorMessage)) {
    const retryCount = blockerManager.getRetryCount(story.storyIndex);
    const maxRetries = resilience.blockerMaxAutoRetries;
    console.log(`[Epic] Story ${story.storyIndex} failed - auto-retry ${retryCount + 1}/${maxRetries}`);

    blockerManager.incrementRetryCount(story.storyIndex);

    // Reset expert to idle after a short delay (to allow retry)
    setTimeout(() => {
      expertStates.set(expert, {
        persona: expert,
        status: "idle",
      });
      // Clear failed flag to allow re-execution
      failedStoryIndices.delete(story.storyIndex);
    }, 2000);

    return;
  }

  // Auto-retry exhausted or error not fixable - escalate as blocker
  console.log(`[Epic] Story ${story.storyIndex} failed - escalating to human`);

  // Get all ready stories to find dependents
  const readyStories = await coordination.getReadyStories();

  // Escalate the blocker
  await blockerManager.escalateBlocker(
    story.storyIndex,
    story.title,
    expert,
    errorMessage,
    readyStories
  );

  // Mark dependent stories as blocked
  const dependentStories = blockerManager.getDependentStories(story.storyIndex, readyStories);
  for (const depIndex of dependentStories) {
    blockedStoryIndices.add(depIndex);
  }

  // Reset expert to idle after delay
  setTimeout(() => {
    expertStates.set(expert, {
      persona: expert,
      status: "idle",
    });
  }, 2000);
}

/**
 * Execute a story asynchronously.
 * This is the core story execution handler that manages the lifecycle of a story,
 * including rate limiting, success tracking, failure handling, and cleanup.
 */
export async function executeStoryAsync(
  config: EpicConfig,
  resilience: ResilienceConfig,
  story: ReadyStory,
  expert: ExpertPersona,
  totalStories: number,
  executor: StoryExecutor,
  coordination: CoordinationClient,
  gitOps: GitOps,
  blockerManager: BlockerManager | null,
  // State references
  expertStates: Map<ExpertPersona, ExpertState>,
  activeWorktrees: Map<number, string>,
  storyBranchNames: Map<number, string>,
  storyBaselineShas: Map<number, string>,
  storyDepConflicts: Map<number, string[]>,
  completedStoryIndices: Set<number>,
  locallyCompletedStoryIndices: Set<number>,
  failedStoryIndices: Set<number>,
  blockedStoryIndices: Set<number>,
  runningStoryMutexGroups: Map<number, string[]>,
  runningStoryTargetFiles: Map<number, string[]>,
  rateLimitRetries: Map<number, number>,
  accumulatedLearnings: Array<{ learning: string; persona: string; storyIndex: number }>,
  callbacks: {
    setHasAnyCommittedCode: () => void;
  },
  userFeedback?: string
): Promise<void> {
  try {
    const result = await executor.executeStory(story, expert, totalStories, userFeedback);

    // Handle rate limiting — escalate immediately as blocker (usage caps can last hours)
    if (result.rateLimited) {
      console.log(`[Epic] Rate limit detected for story ${story.storyIndex} — escalating as blocker`);
      rateLimitRetries.delete(story.storyIndex);
      unregisterRunningStory(story.storyIndex, runningStoryMutexGroups, runningStoryTargetFiles);

      // Post a rate_limited progress event for feed visibility
      await coordination.postContext(
        "rate_limited",
        "Anthropic usage limit reached — task paused.",
        expert,
        config.parentTaskId
      );

      // Escalate as blocker with clear user-facing message
      const readyStories = await coordination.getReadyStories();
      const dependentStories = blockerManager
        ? blockerManager.getDependentStories(story.storyIndex, readyStories)
        : [];

      const summary = "Your Anthropic usage limit was reached. Check your plan at claude.ai/settings — if you have Extra Usage enabled with funds available, click Retry. Otherwise, wait for your limit to reset.";

      await coordination.postContext(
        "blocker",
        summary,
        expert,
        undefined,
        {
          storyIndex: story.storyIndex,
          storyTitle: story.title,
          persona: expert,
          errorCategory: "rate_limit",
          summary,
          fullErrorMessage: "Claude CLI returned rate_limit_error. This typically means your weekly/session usage cap has been reached. Usage caps reset on a schedule (check claude.ai/settings for your reset time).",
          affectedFiles: [],
          autoRetryAttempts: 0,
          maxAutoRetries: 0,
          dependentStories,
          isEscalated: true,
          isFixable: false,
        },
        `${expert}-story-${story.storyIndex}`
      );

      // Update expert state and mark dependent stories blocked
      expertStates.set(expert, {
        persona: expert,
        status: "blocked",
        currentStoryId: story.id,
        currentStoryIndex: story.storyIndex,
      });
      failedStoryIndices.add(story.storyIndex);
      for (const depIndex of dependentStories) {
        blockedStoryIndices.add(depIndex);
      }

      // Reset expert to idle after delay
      setTimeout(() => {
        expertStates.set(expert, { persona: expert, status: "idle" });
      }, 2000);

      return;
    }

    // Unregister from mutex tracking now that execution is complete
    unregisterRunningStory(story.storyIndex, runningStoryMutexGroups, runningStoryTargetFiles);

    // Clean up any message file left in the worktree
    cleanupMessageFiles(activeWorktrees, story.storyIndex);

    if (result.success) {
      // Mark that we have committed code on a remote branch
      callbacks.setHasAnyCommittedCode();

      // Track locally so checkMissionComplete works even if postCompletion API failed
      locallyCompletedStoryIndices.add(story.storyIndex);

      // Update expert state to completed
      expertStates.set(expert, {
        persona: expert,
        status: "completed",
        currentStoryId: story.id,
        currentStoryIndex: story.storyIndex,
      });

      // Store baseline SHA for scoped review diff
      if (result.postRebaseBaseSha) {
        storyBaselineShas.set(story.storyIndex, result.postRebaseBaseSha);
      }

      // Track dependency merge conflicts for review-skip logic
      if (result.depConflicts?.length) {
        storyDepConflicts.set(story.storyIndex, result.depConflicts);
      }

      // Accumulate learnings from successful stories
      if (result.learnings?.length) {
        for (const learning of result.learnings) {
          accumulatedLearnings.push({ learning, persona: expert, storyIndex: story.storyIndex });
        }
        console.log(`[Epic] Captured ${result.learnings.length} learning(s) from ${expert} (story ${story.storyIndex})`);
      }

      // Clear any retry counts on success
      if (blockerManager) {
        blockerManager.resetRetryCount(story.storyIndex);
      }
    } else {
      // Story failed - handle with blocker system
      await handleStoryFailure(
        config, resilience, story, expert, result.error || "Unknown error",
        expertStates, failedStoryIndices, blockedStoryIndices, blockerManager, coordination
      );
    }

    // Reset to idle after a delay
    setTimeout(() => {
      const state = expertStates.get(expert);
      if (state && state.currentStoryId === story.id) {
        expertStates.set(expert, {
          persona: expert,
          status: "idle",
        });
      }
    }, 2000);
  } catch (error) {
    console.error("[Epic] Story execution failed:", error);
    // Unregister from mutex tracking on exception
    unregisterRunningStory(story.storyIndex, runningStoryMutexGroups, runningStoryTargetFiles);

    // Clean up orphaned worktree if it was created before the exception
    if (activeWorktrees.has(story.storyIndex)) {
      const worktreePath = activeWorktrees.get(story.storyIndex)!;
      try {
        await gitOps.forceRemoveWorktree(worktreePath);
      } catch {
        // Ignore cleanup errors — worktree may already be removed
      }
      activeWorktrees.delete(story.storyIndex);
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    await handleStoryFailure(
      config, resilience, story, expert, errorMessage,
      expertStates, failedStoryIndices, blockedStoryIndices, blockerManager, coordination
    );
  }
}
