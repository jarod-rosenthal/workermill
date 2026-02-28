/**
 * Task Monitor — ECS task completion detection and dependency management
 *
 * Extracted from orchestrator.ts.
 * Used by: orchestrator.ts (pollLoop)
 *
 * Functions:
 * - monitorExecutingTasks: Detect ECS task completion, parse result markers, update status
 * - checkParentTaskCompletion: Detect when all PRD children complete, create final PR
 * - checkAndUnblockDependentTasks: Transition blocked siblings to queued when deps complete
 * - cascadeCancellationToChildren: Cancel blocked children when parent is cancelled
 */

import { In } from "typeorm";
import { AppDataSource } from "../db/connection.js";
import {
  WorkerTask,
  Organization,
  WorkerTaskLog,
  WorkerContext,
  InternalTask,
  BoardColumn,
  KbCard,
  KbColumn,
  KbComment,
  type BoardColumnType,
  type WorkerTaskStatus,
} from "../models/index.js";
import {
  config,
  getTaskCheckpoint,
} from "../config/index.js";
import { logger } from "../utils/logger.js";
import {
  checkOut,
} from "./coordination.js";
import {
  notifyTaskCompleted,
  notifyTaskFailed,
  notifyCostAlert,
} from "./notifications.js";
import { transitionJiraIssue } from "../utils/jira.js";
import { postTicketComment } from "../utils/ticket-comments.js";
import { getScmProvider } from "../scm-providers/index.js";
import { validateQualityGates } from "./quality-gates.js";
import { getCostTracker } from "./cost-tracker.js";
import { updateDirectiveOutcome } from "./directive-tracker.js";
import { deductComputeUsage } from "./credit-billing.js";
import { localEpicSpawner } from "./local-epic-spawner.js";
import { mergeStoryPRsInOrder } from "./task-dispatch.js";
import {
  getOrgRepo,
  getTaskRepo,
  isDryRunTask,
  logTaskEvent,
  ecsClient,
  DescribeTasksCommand,
} from "./orchestrator-utils.js";


/**
 * Check for parent tasks with all children complete and post summary to Jira
 * This is the "Project Manager Summary" phase of PRD orchestration
 */
export async function checkParentTaskCompletion(): Promise<void> {
  const taskRepo = getTaskRepo();

  // Find parent tasks in "dispatching" status (actively running children)
  const parentTasks = await taskRepo.find({
    where: { status: "dispatching" },
  });

  for (const parentTask of parentTasks) {
    if (!parentTask.childTaskIds || parentTask.childTaskIds.length === 0) {
      continue;
    }

    // Get all child tasks
    const childTasks = await taskRepo.find({
      where: { parentTaskId: parentTask.id },
    });

    if (childTasks.length === 0) {
      continue;
    }

    // CRITICAL: Ensure all expected children have been created before checking completion
    // This prevents a race condition where the first child completes via dry-run
    // before the other children are even created, causing premature parent completion
    const expectedChildCount = parentTask.childTaskIds.length;
    if (childTasks.length < expectedChildCount) {
      logger.debug("Waiting for all child tasks to be created", {
        parentTaskId: parentTask.id,
        expectedChildren: expectedChildCount,
        actualChildren: childTasks.length,
      });
      continue;
    }

    // Check if all children are in terminal states
    // For PRD workflows, review_requested counts as terminal since PRs go to feature branch
    // and will be consolidated in the final PR
    const isPrdWorkflow = parentTask.githubBranch != null;
    const terminalStatuses = isPrdWorkflow
      ? ["completed", "failed", "cancelled", "deployed", "review_requested"]
      : ["completed", "failed", "cancelled", "deployed"];
    const allComplete = childTasks.every((child) =>
      terminalStatuses.includes(child.status),
    );

    if (!allComplete) {
      // Some children still running
      continue;
    }

    // All children are done - generate and post summary
    logger.info("All child tasks complete, generating summary", {
      parentTaskId: parentTask.id,
      jiraIssueKey: parentTask.jiraIssueKey,
      childCount: childTasks.length,
      parentStatus: parentTask.status,
      childStatuses: childTasks.map((c) => ({ id: c.id, status: c.status })),
    });

    // Calculate stats
    // For PRD workflows, review_requested counts as "completed" since PRs are consolidated
    const successStatuses = isPrdWorkflow
      ? ["completed", "deployed", "review_requested"]
      : ["completed", "deployed"];
    const completed = childTasks.filter((c) =>
      successStatuses.includes(c.status),
    ).length;
    const failed = childTasks.filter((c) => c.status === "failed").length;
    const cancelled = childTasks.filter((c) => c.status === "cancelled").length;
    const totalCost = childTasks.reduce(
      (sum, c) => sum + (Number(c.estimatedCostUsd) || 0),
      0,
    );

    // Check if this is a dry-run workflow
    const parentIsDryRun = isDryRunTask(parentTask);

    // PHASE 3: Merge all story PRs in dependency order into feature branch
    // This runs BEFORE creating the final PR to main, ensuring all PRs are consolidated
    if (isPrdWorkflow && completed > 0 && !parentIsDryRun) {
      try {
        await mergeStoryPRsInOrder(parentTask);
      } catch (error) {
        logger.error("Error in Phase 3 PR merging", {
          parentTaskId: parentTask.id,
          error: error instanceof Error ? error.message : String(error),
        });
        await logTaskEvent(
          parentTask.id,
          "info",
          "Phase 3 PR merging encountered errors - continuing with final PR creation",
          { severity: "warning" }
        );
      }
    } else if (isPrdWorkflow && completed > 0 && parentIsDryRun) {
      await logTaskEvent(parentTask.id, "info", `[DRY RUN] Would merge ${completed} story PRs into feature branch`);
      logger.info("[DRY RUN] Skipped Phase 3 PR merging", { parentTaskId: parentTask.id });
    }

    // Feature branch workflow: Create final PR from feature branch to main
    const planJson = parentTask.planJson as { featureBranch?: string } | null;
    const featureBranch = planJson?.featureBranch || parentTask.githubBranch;
    let finalPrUrl: string | null = null;
    let finalPrNumber: number | null = null;

    if (featureBranch && completed > 0 && failed === 0 && !parentIsDryRun) {
      // All stories succeeded - create final PR to main
      try {
        const { createPullRequest } = await import("../utils/github.js");

        // Build PR body with story summaries
        const storyList = childTasks
          .filter((c) => successStatuses.includes(c.status))
          .map(
            (c) =>
              `- ${c.summary}${c.githubPrUrl ? ` ([PR](${c.githubPrUrl}))` : ""}`,
          )
          .join("\n");

        const prResult = await createPullRequest(parentTask.githubRepo, {
          title: `${parentTask.jiraIssueKey}: ${parentTask.summary}`,
          body: `***REMOVED******REMOVED*** Summary

This PR contains all completed stories for ${parentTask.jiraIssueKey}.

***REMOVED******REMOVED*** Stories Included

${storyList}

***REMOVED******REMOVED*** Total Cost

$${totalCost.toFixed(2)}

---
🤖 Generated by WorkerMill PRD Orchestration`,
          head: featureBranch,
          base: "main",
        });

        if (prResult.success && prResult.prUrl) {
          finalPrUrl = prResult.prUrl;
          finalPrNumber = prResult.prNumber || null;
          parentTask.githubPrUrl = finalPrUrl;
          parentTask.githubPrNumber = finalPrNumber;

          await logTaskEvent(
            parentTask.id,
            "info",
            `📝 Created final PR: ${finalPrUrl}`,
          );
          logger.info("Created final PR for feature branch", {
            parentTaskId: parentTask.id,
            jiraIssueKey: parentTask.jiraIssueKey,
            featureBranch,
            prUrl: finalPrUrl,
          });
        } else {
          await logTaskEvent(
            parentTask.id,
            "info",
            "⚠️ Could not create final PR to main",
          );
        }
      } catch (error) {
        logger.warn("Failed to create final PR", {
          error,
          parentTaskId: parentTask.id,
          featureBranch,
        });
        await logTaskEvent(
          parentTask.id,
          "info",
          "⚠️ Error creating final PR to main",
        );
      }
    } else if (featureBranch && completed > 0 && failed === 0 && parentIsDryRun) {
      await logTaskEvent(parentTask.id, "info", `[DRY RUN] Would create final PR: feature/${parentTask.jiraIssueKey} → main`);
      logger.info("[DRY RUN] Skipped final PR creation", { parentTaskId: parentTask.id });
    } else if (featureBranch && failed > 0) {
      await logTaskEvent(
        parentTask.id,
        "info",
        `⚠️ Skipping final PR - ${failed} story/stories failed. Feature branch: ${featureBranch}`,
      );
    }

    // Build summary comment
    const summaryLines: string[] = [
      "[Project Manager - Workflow Summary]",
      "",
      "***REMOVED******REMOVED*** Execution Complete",
      "",
      `Total Stories: ${childTasks.length}`,
      `✅ Completed: ${completed}`,
      failed > 0 ? `❌ Failed: ${failed}` : null,
      cancelled > 0 ? `⚠️ Cancelled: ${cancelled}` : null,
      `💰 Total Cost: $${totalCost.toFixed(2)}`,
      "",
      "***REMOVED******REMOVED*** Story Results",
      "",
    ].filter(Boolean) as string[];

    for (const child of childTasks) {
      const statusEmoji =
        child.status === "completed" || child.status === "deployed"
          ? "✅"
          : child.status === "failed"
            ? "❌"
            : "⚠️";
      const prLink = child.githubPrUrl ? ` - [PR](${child.githubPrUrl})` : "";
      summaryLines.push(`${statusEmoji} ${child.summary}${prLink}`);
    }

    // Add critical feedback section if there were failures
    if (failed > 0 || cancelled > 0) {
      summaryLines.push("");
      summaryLines.push("***REMOVED******REMOVED*** Critical Feedback");
      summaryLines.push("");

      const failedTasks = childTasks.filter(
        (c) => c.status === "failed" || c.status === "cancelled",
      );
      for (const failedTask of failedTasks) {
        summaryLines.push(`- ${failedTask.summary}: ${failedTask.status}`);
        if (failedTask.errorMessage) {
          summaryLines.push(`  Error: ${failedTask.errorMessage}`);
        }
      }

      summaryLines.push("");
      summaryLines.push(
        "Please review the failed stories and consider creating follow-up tickets.",
      );
    } else {
      summaryLines.push("");
      summaryLines.push("***REMOVED******REMOVED*** Next Steps");
      summaryLines.push("");
      if (finalPrUrl) {
        summaryLines.push(`✅ All stories completed successfully.`);
        summaryLines.push("");
        summaryLines.push(
          `📝 **Final PR**: [${parentTask.jiraIssueKey}](${finalPrUrl})`,
        );
        summaryLines.push("");
        summaryLines.push("Please review and merge the final PR when ready.");
      } else {
        summaryLines.push(
          "All stories completed successfully. Please review the PRs and merge when ready.",
        );
      }
    }

    // Post summary to Jira (only if this is a Jira-sourced task, skip in dry-run)
    if (parentTask.jiraIssueKey && !parentIsDryRun) {
      try {
        const success = await postTicketComment(
          parentTask.orgId,
          parentTask.jiraIssueKey,
          summaryLines.join("\n"),
        );
        if (success) {
          await logTaskEvent(
            parentTask.id,
            "info",
            "📝 Posted workflow summary to Jira",
          );
        } else {
          await logTaskEvent(
            parentTask.id,
            "info",
            "⚠️ Could not post summary to Jira (non-critical)",
          );
        }
      } catch (error) {
        logger.warn("Failed to post summary to Jira", {
          error,
          jiraKey: parentTask.jiraIssueKey,
        });
      }
    } else if (parentTask.jiraIssueKey && parentIsDryRun) {
      await logTaskEvent(parentTask.id, "info", `[DRY RUN] Would post workflow summary to Jira`);
      logger.info("[DRY RUN] Skipped posting summary to Jira", { parentTaskId: parentTask.id });
    }

    // Update parent task to completed
    const newStatus = failed > 0 ? "failed" : "completed";
    logger.info("Updating parent task status", {
      parentTaskId: parentTask.id,
      jiraIssueKey: parentTask.jiraIssueKey,
      oldStatus: parentTask.status,
      newStatus,
      isDryRun: parentIsDryRun,
    });
    // Atomic update to prevent clobbering concurrent changes from child tasks
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        status: newStatus as WorkerTaskStatus,
        completedAt: new Date(),
        estimatedCostUsd: totalCost,
      } as Record<string, unknown>)
      .where("id = :id", { id: parentTask.id })
      .execute();
    parentTask.status = newStatus as WorkerTaskStatus;
    logger.info("Parent task status saved successfully", {
      parentTaskId: parentTask.id,
      status: newStatus,
    });

    await logTaskEvent(
      parentTask.id,
      "status_change",
      `Workflow ${parentTask.status}: ${completed}/${childTasks.length} stories successful`,
    );

    // Transition parent Epic to Done in Jira (if all successful, skip in dry-run)
    if (parentTask.jiraIssueKey && parentTask.status === "completed" && !parentIsDryRun) {
      const transitioned = await transitionJiraIssue(
        parentTask.orgId,
        parentTask.jiraIssueKey,
        "Done",
      );
      if (transitioned) {
        await logTaskEvent(
          parentTask.id,
          "info",
          `📌 Transitioned ${parentTask.jiraIssueKey} to Done`,
        );
      }
    } else if (parentTask.jiraIssueKey && parentTask.status === "completed" && parentIsDryRun) {
      await logTaskEvent(parentTask.id, "info", `[DRY RUN] Would transition ${parentTask.jiraIssueKey} to Done`);
      logger.info("[DRY RUN] Skipped transitioning Epic to Done", { parentTaskId: parentTask.id, jiraKey: parentTask.jiraIssueKey });
    }

    // Sync parent task status back to InternalTask (for board-originated tasks)
    if (parentTask.internalTaskId) {
      try {
        await syncInternalTaskStatus(parentTask, newStatus);
      } catch (syncError) {
        logger.warn("Failed to sync parent internal task status", {
          parentTaskId: parentTask.id,
          internalTaskId: parentTask.internalTaskId,
          error: syncError instanceof Error ? syncError.message : String(syncError),
        });
      }
    }

    logger.info("Parent task marked complete", {
      parentTaskId: parentTask.id,
      jiraIssueKey: parentTask.jiraIssueKey,
      status: parentTask.status,
      completed,
      failed,
      cancelled,
      totalCost,
    });

    // Send notification
    if (parentTask.status === "completed") {
      await notifyTaskCompleted(parentTask);
    } else {
      await notifyTaskFailed(parentTask);
    }

    // Archive sibling context messages when parent completes
    // Archived messages are preserved for history/debugging but filtered out of active workflows
    try {
      const contextRepo = AppDataSource.getRepository(WorkerContext);
      const archiveResult = await contextRepo.update(
        { parentTaskId: parentTask.id, archived: false },
        { archived: true, archivedAt: new Date() },
      );
      if (archiveResult.affected && archiveResult.affected > 0) {
        logger.info("Archived sibling context messages", {
          parentTaskId: parentTask.id,
          jiraIssueKey: parentTask.jiraIssueKey,
          archivedCount: archiveResult.affected,
        });
      }
    } catch (archiveError) {
      logger.warn("Failed to archive sibling context messages", {
        parentTaskId: parentTask.id,
        error:
          archiveError instanceof Error
            ? archiveError.message
            : String(archiveError),
      });
    }

    // DRY-RUN CLEANUP: Automatically delete simulated tasks after dry-run completes
    // This prevents clutter in the task list from test runs
    // Visibility window is configurable via org settings (default 1 minute, max 60 minutes)
    if (parentIsDryRun) {
      // Fetch org to get configurable visibility window
      const orgRepo = AppDataSource.getRepository(Organization);
      const org = await orgRepo.findOne({ where: { id: parentTask.orgId } });
      const visibilityMinutes = org?.dryRunVisibilityMinutes || 1;
      const DRY_RUN_VISIBILITY_SECONDS = visibilityMinutes * 60;

      logger.info("[DRY RUN] Workflow complete - will auto-cleanup after visibility window", {
        parentTaskId: parentTask.id,
        jiraIssueKey: parentTask.jiraIssueKey,
        childCount: childTasks.length,
        cleanupInMinutes: visibilityMinutes,
      });

      // Schedule cleanup after delay (non-blocking)
      const parentId = parentTask.id;
      const parentJiraKey = parentTask.jiraIssueKey;
      const childIdsCopy = childTasks.map((c) => c.id);

      setTimeout(async () => {
        logger.info("[DRY RUN] Starting auto-cleanup after visibility window", {
          parentTaskId: parentId,
          jiraIssueKey: parentJiraKey,
        });
        try {
          const cleanupTaskRepo = AppDataSource.getRepository(WorkerTask);
          const cleanupLogRepo = AppDataSource.getRepository(WorkerTaskLog);

          // Delete child tasks first (foreign key constraint)
          const deleteChildResult = await cleanupTaskRepo.delete({
            parentTaskId: parentId,
          });

          // Delete logs for children and parent
          if (childIdsCopy.length > 0) {
            await cleanupLogRepo.delete({ taskId: In(childIdsCopy) });
          }
          await cleanupLogRepo.delete({ taskId: parentId });

          // Delete parent task
          await cleanupTaskRepo.delete({ id: parentId });

          logger.info("[DRY RUN] Auto-cleanup completed", {
            parentTaskId: parentId,
            jiraIssueKey: parentJiraKey,
            deletedChildren: deleteChildResult.affected,
          });
        } catch (cleanupError) {
          logger.warn("[DRY RUN] Auto-cleanup failed", {
            parentTaskId: parentId,
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
          });
        }
      }, DRY_RUN_VISIBILITY_SECONDS * 1000);
    }
  }
}

/**
 * Check and unblock dependent tasks when a child task completes.
 *
 * This function IS actively called from:
 * - tasks.ts: when worker status updates to terminal state
 * - webhooks.ts: when GitHub PR events arrive
 * - orchestrator.ts: when task monitor detects completion
 *
 * Dependency Flow:
 * 1. Stories with dependencies start as "blocked" status
 * 2. When a dependency completes AND its PR merges, blocked stories are checked
 * 3. If all dependencies are satisfied, the story transitions to "queued"
 * 4. Phase 3 then merges all PRs in storyIndex order
 *
 * PRD Workflow Dependency Rules:
 * - For "deployed" status: PR is merged, dependents can proceed
 * - For "review_requested" status: PR created but not merged, verify PR merge status
 * - For "completed" status: Task done but no PR, dependents can proceed
 */
export async function checkAndUnblockDependentTasks(
  completedTask: WorkerTask,
): Promise<void> {
  // Only process child tasks (tasks with a parent)
  if (!completedTask.parentTaskId) {
    logger.debug("[UNBLOCK] Skipping - task has no parent", { taskId: completedTask.id });
    return;
  }

  const taskRepo = getTaskRepo();
  const orgRepo = getOrgRepo();
  const contextRepo = AppDataSource.getRepository(WorkerContext);

  // Get org for SCM provider
  const org = await orgRepo.findOne({ where: { id: completedTask.orgId } });
  const scmProvider = org ? getScmProvider(org) : null;

  // Get the completed task's story index from jiraFields
  const completedFields = completedTask.jiraFields as {
    storyIndex?: number;
  } | null;
  const completedStoryIndex = completedFields?.storyIndex;

  logger.info("[UNBLOCK] Starting dependency check", {
    taskId: completedTask.id,
    jiraKey: completedTask.jiraIssueKey,
    parentTaskId: completedTask.parentTaskId,
    storyIndex: completedStoryIndex,
    taskStatus: completedTask.status,
    jiraFields: completedTask.jiraFields,
  });

  if (!completedStoryIndex) {
    logger.warn("[UNBLOCK] Skipping - task has no storyIndex in jiraFields", {
      taskId: completedTask.id,
      jiraFields: completedTask.jiraFields,
    });
    return;
  }

  // Post completion notification for siblings to see
  try {
    await contextRepo.save({
      parentTaskId: completedTask.parentTaskId,
      taskId: completedTask.id,
      orgId: completedTask.orgId,
      persona: completedTask.workerPersona || "worker",
      messageType: "completion" as const,
      content: `Completed: ${completedTask.summary || completedTask.jiraIssueKey}. PR: ${completedTask.githubPrUrl || "N/A"}`,
      metadata: {
        status: completedTask.status,
        prUrl: completedTask.githubPrUrl,
        prNumber: completedTask.githubPrNumber,
        storyIndex: completedStoryIndex,
        filesModified:
          (completedTask.jiraFields as { filesModified?: string[] } | null)
            ?.filesModified || [],
      },
    });
    logger.debug("Posted completion context notification", {
      taskId: completedTask.id,
      parentTaskId: completedTask.parentTaskId,
      storyIndex: completedStoryIndex,
    });
  } catch (contextError) {
    logger.warn("Failed to post completion context", {
      taskId: completedTask.id,
      error:
        contextError instanceof Error
          ? contextError.message
          : String(contextError),
    });
  }

  // Find all blocked sibling tasks
  const blockedSiblings = await taskRepo.find({
    where: {
      parentTaskId: completedTask.parentTaskId,
      status: "blocked",
    },
  });

  logger.info("[UNBLOCK] Found blocked siblings", {
    completedTaskId: completedTask.id,
    completedStoryIndex,
    blockedCount: blockedSiblings.length,
    blockedTasks: blockedSiblings.map(t => ({
      id: t.id,
      jiraKey: t.jiraIssueKey,
      storyIndex: (t.jiraFields as { storyIndex?: number } | null)?.storyIndex,
      storyDependencies: (t.jiraFields as { storyDependencies?: number[] } | null)?.storyDependencies,
    })),
  });

  if (blockedSiblings.length === 0) {
    logger.info("[UNBLOCK] No blocked siblings to unblock", { completedTaskId: completedTask.id });
    return;
  }

  // Get all sibling tasks to check completion status
  const allSiblings = await taskRepo.find({
    where: { parentTaskId: completedTask.parentTaskId },
  });

  // Check if this is a PRD workflow (parent has feature branch = multi-story plan)
  // For PRD workflows, we DON'T wait for PR merge - all child PRs go to feature branch
  // and will be consolidated in a final PR to main
  const parentTask = await taskRepo.findOne({
    where: { id: completedTask.parentTaskId! },
  });
  const isPrdWorkflow = parentTask?.githubBranch != null;

  // Build a map of storyIndex -> { isComplete, isFailed, prMerged, task }
  // For true dependency completion, we need PR to be merged (or no PR exists)
  // EXCEPTION: PRD workflows skip PR merge check - they use feature branch consolidation
  const completionMap = new Map<
    number,
    {
      isComplete: boolean;
      isFailed: boolean;
      prMerged: boolean;
      task: WorkerTask;
    }
  >();

  for (const sibling of allSiblings) {
    const siblingFields = sibling.jiraFields as { storyIndex?: number } | null;
    const siblingIndex = siblingFields?.storyIndex;
    if (siblingIndex) {
      // Check if task reached a "complete enough" status
      const statusComplete = [
        "completed",
        "deployed",
        "review_requested",
      ].includes(sibling.status);
      // Check if task failed (dependency chain is broken)
      const statusFailed = ["failed", "cancelled"].includes(sibling.status);

      // For deployed tasks, PR is merged by definition
      // For review_requested, we need to verify PR merge status
      // For completed (no PR), it's ready
      // EXCEPTION: PRD workflows treat review_requested as complete (no merge wait)
      let prMerged = true; // Default to true (no PR needed)

      if (
        sibling.status === "review_requested" &&
        sibling.githubPrNumber &&
        sibling.githubRepo &&
        !isPrdWorkflow &&
        scmProvider
      ) {
        // Task has a PR in review - check if it's actually merged
        // Skip this check for PRD workflows - they consolidate PRs at the end
        try {
          const repoId = scmProvider.parseRepoIdentifier(sibling.githubRepo);
          const prStatus = await scmProvider.getPullRequestStatus(
            repoId,
            sibling.githubPrNumber,
          );
          prMerged = prStatus?.merged === true;

          if (!prMerged) {
            logger.debug("Dependency PR not yet merged", {
              dependencyTaskId: sibling.id,
              storyIndex: siblingIndex,
              prNumber: sibling.githubPrNumber,
              prState: prStatus?.state,
            });
          }
        } catch (prError) {
          // On error, be conservative - assume not merged
          prMerged = false;
          logger.warn("Failed to check PR merge status", {
            taskId: sibling.id,
            prNumber: sibling.githubPrNumber,
            error: prError instanceof Error ? prError.message : String(prError),
          });
        }
      } else if (sibling.status === "deployed") {
        // Deployed means PR was merged
        prMerged = true;
      }

      completionMap.set(siblingIndex, {
        isComplete: statusComplete,
        isFailed: statusFailed,
        prMerged,
        task: sibling,
      });
    }
  }

  // Log the completion map for debugging
  logger.info("[UNBLOCK] Built completion map", {
    completedTaskId: completedTask.id,
    isPrdWorkflow,
    completionMap: Array.from(completionMap.entries()).map(([idx, data]) => ({
      storyIndex: idx,
      isComplete: data.isComplete,
      isFailed: data.isFailed,
      prMerged: data.prMerged,
      taskStatus: data.task.status,
      taskId: data.task.id,
    })),
  });

  // Check each blocked sibling to see if its dependencies are now met (or failed)
  for (const blockedTask of blockedSiblings) {
    const blockedFields = blockedTask.jiraFields as {
      storyDependencies?: number[];
    } | null;
    const dependencies = blockedFields?.storyDependencies || [];
    const blockedStoryIndex = (blockedTask.jiraFields as { storyIndex?: number } | null)?.storyIndex;

    logger.info("[UNBLOCK] Checking blocked task dependencies", {
      blockedTaskId: blockedTask.id,
      blockedStoryIndex,
      dependencies,
      dependencyStatuses: dependencies.map(depIdx => {
        const depStatus = completionMap.get(depIdx);
        return {
          depIndex: depIdx,
          found: !!depStatus,
          isComplete: depStatus?.isComplete,
          isFailed: depStatus?.isFailed,
          prMerged: depStatus?.prMerged,
          taskStatus: depStatus?.task?.status,
        };
      }),
    });

    if (dependencies.length === 0) {
      // No dependencies, shouldn't be blocked - queue it — atomic update with status guard
      await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({ status: "queued" as WorkerTaskStatus })
        .where("id = :id AND status = :expected", { id: blockedTask.id, expected: "blocked" })
        .execute();
      blockedTask.status = "queued";
      await logTaskEvent(
        blockedTask.id,
        "status_change",
        "Unblocked: no dependencies",
      );
      continue;
    }

    // Check if any dependency has failed - if so, cancel this blocked task
    const failedDeps: number[] = [];
    for (const depIndex of dependencies) {
      const depStatus = completionMap.get(depIndex);
      if (depStatus?.isFailed) {
        failedDeps.push(depIndex);
      }
    }

    if (failedDeps.length > 0) {
      // Dependency failed - cancel this blocked task — atomic update with status guard
      await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({ status: "cancelled" as WorkerTaskStatus })
        .where("id = :id AND status = :expected", { id: blockedTask.id, expected: "blocked" })
        .execute();
      blockedTask.status = "cancelled";

      const failedList = failedDeps.map((d) => `S${d}`).join(", ");
      await logTaskEvent(
        blockedTask.id,
        "status_change",
        `Cancelled: dependency failed (${failedList})`,
      );

      logger.info("Cancelled blocked task due to failed dependency", {
        taskId: blockedTask.id,
        jiraIssueKey: blockedTask.jiraIssueKey,
        failedDependencies: failedDeps,
      });
      continue;
    }

    // Check if all dependencies are complete AND their PRs are merged
    // This prevents race conditions where dependent starts before dependency PR is merged
    const pendingDeps: number[] = [];
    const pendingPrMerge: number[] = [];

    for (const depIndex of dependencies) {
      const depStatus = completionMap.get(depIndex);
      if (!depStatus?.isComplete) {
        pendingDeps.push(depIndex);
      } else if (!depStatus.prMerged) {
        pendingPrMerge.push(depIndex);
      }
    }

    const allDepsComplete =
      pendingDeps.length === 0 && pendingPrMerge.length === 0;

    logger.info("[UNBLOCK] Dependency check result", {
      blockedTaskId: blockedTask.id,
      blockedStoryIndex,
      allDepsComplete,
      pendingDeps,
      pendingPrMerge,
      willUnblock: allDepsComplete,
    });

    if (allDepsComplete) {
      // Atomic update with status guard to prevent double-unblocking
      await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({ status: "queued" as WorkerTaskStatus })
        .where("id = :id AND status = :expected", { id: blockedTask.id, expected: "blocked" })
        .execute();
      blockedTask.status = "queued";
      logger.info("[UNBLOCK] Successfully unblocked task", {
        taskId: blockedTask.id,
        storyIndex: blockedStoryIndex,
      });

      const depList = dependencies.map((d) => `S${d}`).join(", ");
      await logTaskEvent(
        blockedTask.id,
        "status_change",
        `Unblocked: dependencies complete (${depList})`,
      );

      logger.info("Unblocked dependent task", {
        taskId: blockedTask.id,
        jiraIssueKey: blockedTask.jiraIssueKey,
        dependencies,
        completedStoryIndex,
      });
    } else if (pendingPrMerge.length > 0 && pendingDeps.length === 0) {
      // All tasks are done but PRs not merged - log for visibility
      logger.debug("Dependency tasks complete but PRs not yet merged", {
        blockedTaskId: blockedTask.id,
        pendingPrMerge: pendingPrMerge.map((d) => `S${d}`),
      });
    }
  }
}

/**
 * Cascade cancellation from a parent task to all its blocked children.
 * When a parent task (one with childTaskIds) is cancelled or failed,
 * its blocked children should also be cancelled since they can never proceed.
 *
 * This is called from the task cancel endpoint when a parent task is cancelled.
 *
 * @param parentTask - The parent task that was cancelled/failed
 * @param reason - The reason for cancellation (for logging)
 */
export async function cascadeCancellationToChildren(
  parentTask: WorkerTask,
  reason: string = "Parent task was cancelled",
): Promise<{ cancelledCount: number; cancelledTaskIds: string[] }> {
  const taskRepo = getTaskRepo();

  // Only process if this task is a parent (has children)
  if (!parentTask.childTaskIds || parentTask.childTaskIds.length === 0) {
    return { cancelledCount: 0, cancelledTaskIds: [] };
  }

  // Find all blocked child tasks
  const blockedChildren = await taskRepo.find({
    where: {
      parentTaskId: parentTask.id,
      status: "blocked" as const,
    },
  });

  if (blockedChildren.length === 0) {
    return { cancelledCount: 0, cancelledTaskIds: [] };
  }

  const cancelledTaskIds: string[] = [];

  for (const child of blockedChildren) {
    // Atomic update with status guard
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        status: "cancelled" as WorkerTaskStatus,
        completedAt: new Date(),
        errorMessage: reason,
      })
      .where("id = :id AND status = :expected", { id: child.id, expected: "blocked" })
      .execute();
    child.status = "cancelled";

    // Log the cancellation
    await logTaskEvent(child.id, "status_change", `Cancelled: ${reason}`);

    cancelledTaskIds.push(child.id);

    logger.info("Cancelled blocked child task due to parent cancellation", {
      childTaskId: child.id,
      childJiraKey: child.jiraIssueKey,
      parentTaskId: parentTask.id,
      parentJiraKey: parentTask.jiraIssueKey,
      reason,
    });
  }

  logger.info("Cascaded cancellation to blocked children", {
    parentTaskId: parentTask.id,
    parentJiraKey: parentTask.jiraIssueKey,
    cancelledCount: cancelledTaskIds.length,
    cancelledTaskIds,
  });

  return { cancelledCount: cancelledTaskIds.length, cancelledTaskIds };
}


/**
 * Monitor all executing tasks and detect completion via ECS status
 * This is the PRIMARY completion detection mechanism - worker callbacks are a backup
 *
 * When ECS task stops, we:
 * 1. Read the result markers from task logs (::result::, ::pr_url::, etc.)
 * 2. Update task status based on the actual result, not just exit code
 * 3. Capture PR details if present
 */
export async function monitorExecutingTasks(): Promise<void> {
  // Skip ECS monitoring in local mode - local tasks complete via API calls or local monitoring
  if (localEpicSpawner.isLocalMode()) {
    return;
  }

  const taskRepo = getTaskRepo();

  // Find ALL executing tasks (not just stale ones)
  const executingTasks = await taskRepo
    .createQueryBuilder("task")
    .where("task.status IN (:...statuses)", {
      statuses: ["executing", "environment_setup"],
    })
    .andWhere("task.ecs_task_arn IS NOT NULL")
    .limit(10)
    .getMany();

  if (executingTasks.length === 0) return;

  // Batch describe ECS tasks for efficiency
  const taskArns = executingTasks.map((t) => t.ecsTaskArn!).filter(Boolean);
  if (taskArns.length === 0) return;

  const ecsTasksMap: Map<
    string,
    {
      lastStatus: string;
      stopCode?: string;
      stoppedReason?: string;
      stoppedAt?: Date;
      exitCode: number;
      capacityProviderName?: string;
    }
  > = new Map();

  try {
    const describeResult = await ecsClient.send(
      new DescribeTasksCommand({
        cluster: config.aws.ecsCluster,
        tasks: taskArns,
      }),
    );

    for (const ecsTask of describeResult.tasks || []) {
      const container = ecsTask.containers?.find((c) => c.name === "worker");
      ecsTasksMap.set(ecsTask.taskArn!, {
        lastStatus: ecsTask.lastStatus || "UNKNOWN",
        stopCode: ecsTask.stopCode,
        stoppedReason: ecsTask.stoppedReason,
        stoppedAt: ecsTask.stoppedAt,
        exitCode: container?.exitCode ?? -1,
        capacityProviderName: ecsTask.capacityProviderName,
      });
    }
  } catch (error) {
    logger.error("Error describing ECS tasks", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  for (const task of executingTasks) {
    try {
      const ecsInfo = ecsTasksMap.get(task.ecsTaskArn!);

      if (!ecsInfo) {
        // ECS task not found - mark as failed (atomic to prevent clobbering)
        logger.warn("ECS task not found", {
          taskId: task.id,
          ecsTaskArn: task.ecsTaskArn,
        });
        await taskRepo
          .createQueryBuilder()
          .update(WorkerTask)
          .set({
            status: "failed" as WorkerTaskStatus,
            completedAt: new Date(),
            errorMessage: "ECS task not found",
          })
          .where("id = :id AND status NOT IN (:...terminal)", {
            id: task.id,
            terminal: ["completed", "failed", "cancelled"],
          })
          .execute();
        task.status = "failed";
        await notifyTaskFailed(task);
        await logTaskEvent(
          task.id,
          "error",
          "Task failed: ECS task not found",
          { severity: "error" },
        );
        continue;
      }

      // Only process stopped tasks
      if (ecsInfo.lastStatus !== "STOPPED") continue;

      logger.info("Detected ECS task completion", {
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        exitCode: ecsInfo.exitCode,
        stopCode: ecsInfo.stopCode,
        stoppedReason: ecsInfo.stoppedReason,
        capacityProvider: ecsInfo.capacityProviderName,
      });

      // Detect Spot interruptions via multiple indicators:
      // 1. stopCode="SpotInterruption" (ECS native indicator)
      // 2. Exit code 137 with Spot-related reason (SIGKILL after SIGTERM timeout)
      // 3. Exit code 137 on FARGATE_SPOT capacity provider
      // 4. Checkpoint stage="interrupted" (worker saved state before termination)
      let isSpotInterruption =
        ecsInfo.stopCode === "SpotInterruption" ||
        (ecsInfo.exitCode === 137 &&
          ecsInfo.stoppedReason?.toLowerCase().includes("spot")) ||
        (ecsInfo.exitCode === 137 &&
          ecsInfo.capacityProviderName === "FARGATE_SPOT");

      // Check checkpoint for "interrupted" stage as a fallback detection method
      // This catches cases where the worker gracefully handled SIGTERM
      if (
        !isSpotInterruption &&
        (ecsInfo.exitCode === 0 || ecsInfo.exitCode === 137)
      ) {
        try {
          const checkpoint = await getTaskCheckpoint(task.id);
          if (checkpoint && checkpoint.stage === "interrupted") {
            isSpotInterruption = true;
            logger.info("Spot interruption detected via checkpoint stage", {
              taskId: task.id,
              jiraIssueKey: task.jiraIssueKey,
              checkpointStage: checkpoint.stage,
              lastAction: checkpoint.lastAction,
            });
          }
        } catch (checkpointError) {
          // Checkpoint retrieval failed - continue with ECS-based detection only
          logger.warn("Failed to retrieve checkpoint for Spot detection", {
            taskId: task.id,
            error:
              checkpointError instanceof Error
                ? checkpointError.message
                : String(checkpointError),
          });
        }
      }

      if (isSpotInterruption) {
        // Check if task can be retried
        if (task.retryCount < task.maxRetries) {
          logger.info(
            "Spot interruption detected, re-queueing task for retry",
            {
              taskId: task.id,
              jiraIssueKey: task.jiraIssueKey,
              retryCount: task.retryCount,
              maxRetries: task.maxRetries,
            },
          );

          // Re-queue the task for retry (atomic increment to prevent double-retry)
          const newRetryCount = task.retryCount + 1;
          await taskRepo
            .createQueryBuilder()
            .update(WorkerTask)
            .set({
              status: "queued" as WorkerTaskStatus,
              retryCount: () => "retry_count + 1",
              ecsTaskArn: null,
              ecsTaskId: null,
              startedAt: null,
              completedAt: null,
              taskNotes: `SPOT_RETRY: Retry ${newRetryCount}/${task.maxRetries} after Spot capacity interruption`,
            })
            .where("id = :id AND status = :expected", {
              id: task.id,
              expected: "executing",
            })
            .execute();
          task.retryCount = newRetryCount;

          await logTaskEvent(
            task.id,
            "status_change",
            `Spot capacity reclaimed - re-queuing for retry (${task.retryCount}/${task.maxRetries})`,
            {
              severity: "warning",
              metadata: {
                stopCode: ecsInfo.stopCode,
                exitCode: ecsInfo.exitCode,
              },
            },
          );
          continue;
        } else {
          // Max retries exceeded, fail the task
          logger.warn("Spot interruption: max retries exceeded", {
            taskId: task.id,
            jiraIssueKey: task.jiraIssueKey,
            retryCount: task.retryCount,
            maxRetries: task.maxRetries,
          });

          const errorMsg = `Spot capacity reclaimed ${task.maxRetries} times - max retries exceeded`;
          await taskRepo
            .createQueryBuilder()
            .update(WorkerTask)
            .set({
              status: "failed" as WorkerTaskStatus,
              completedAt: ecsInfo.stoppedAt || new Date(),
              errorMessage: errorMsg,
            })
            .where("id = :id AND status NOT IN (:...terminal)", {
              id: task.id,
              terminal: ["completed", "failed", "cancelled"],
            })
            .execute();
          task.status = "failed";
          task.errorMessage = errorMsg;
          await notifyTaskFailed(task);

          await logTaskEvent(
            task.id,
            "error",
            `Task failed: Spot capacity reclaimed ${task.maxRetries} times (max retries exceeded)`,
            { severity: "error" },
          );
          continue;
        }
      }

      // Read result markers from task logs (include severity for error detection)
      const logs = await AppDataSource.query(
        `SELECT message, severity, type FROM worker_task_logs
         WHERE task_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [task.id],
      );

      let detectedResult: string | null = null;
      let detectedPrUrl: string | null = null;
      let detectedPrNumber: number | null = null;
      let detectedErrorMessage: string | null = null;
      let lastErrorSeverityMessage: string | null = null;

      for (const log of logs) {
        const msg = log.message || "";
        const severity = log.severity || "";
        const logType = log.type || "";

        // Look for result marker
        const resultMatch = msg.match(/::result::(\w+)/);
        if (resultMatch && !detectedResult) {
          detectedResult = resultMatch[1];
        }

        // Look for PR URL marker (GitHub, GitLab, Bitbucket)
        const prUrlMatch = msg.match(
          /::pr_url::(https:\/\/(?:github\.com|gitlab\.com|bitbucket\.org)\/[^\s]+)/,
        );
        if (prUrlMatch && !detectedPrUrl) {
          detectedPrUrl = prUrlMatch[1];
        }

        // Look for PR number marker
        const prNumMatch = msg.match(/::pr_number::(\d+)/);
        if (prNumMatch && !detectedPrNumber) {
          detectedPrNumber = parseInt(prNumMatch[1], 10);
        }

        // Look for explicit error marker (::error::message) - highest priority
        const errorMatch = msg.match(/::error::(.+)/);
        if (errorMatch && !detectedErrorMessage) {
          detectedErrorMessage = errorMatch[1].trim();
        }

        // Look for revision count marker (for inline reviews in Epic/Multi-Expert mode)
        const revisionMatch = msg.match(/::revision_count::(\d+)/);
        if (revisionMatch) {
          const parsedRevision = parseInt(revisionMatch[1], 10);
          if (!isNaN(parsedRevision) && parsedRevision >= 0) {
            task.revisionCount = parsedRevision;
          }
        }

        // Capture last error severity log message (fallback for error detection)
        // Only capture meaningful error messages, not generic markers
        if ((severity === "error" || logType === "error") && !lastErrorSeverityMessage) {
          // Skip generic result markers and capture actual error content
          if (!msg.startsWith("::") && msg.length > 10) {
            lastErrorSeverityMessage = msg;
          }
        }
      }

      // Use error severity message as fallback if no explicit ::error:: marker
      if (!detectedErrorMessage && lastErrorSeverityMessage) {
        detectedErrorMessage = lastErrorSeverityMessage;
      }

      // Determine final status based on detected result or exit code
      let newStatus: typeof task.status;
      if (detectedResult) {
        switch (detectedResult) {
          case "deployed":
            newStatus = "deployed";
            break;
          case "pr_created":
            newStatus = "pr_created";
            break;
          case "review_requested":
            newStatus = "review_requested";
            break;
          case "pr_approved":
            newStatus = "pr_approved";
            break;
          case "escalated":
            newStatus = "escalated";
            break;
          case "no_changes":
          case "completed":
            newStatus = "completed";
            break;
          case "failed":
            newStatus = "failed";
            break;
          default:
            newStatus = ecsInfo.exitCode === 0 ? "completed" : "failed";
        }
      } else {
        // No result marker found - fall back to exit code
        newStatus = ecsInfo.exitCode === 0 ? "completed" : "failed";
      }

      // Update task - use partial update to avoid overwriting token/cost data
      const completedAt = ecsInfo.stoppedAt || new Date();
      const updateFields: {
        status: typeof newStatus;
        completedAt: Date;
        githubPrUrl?: string;
        githubPrNumber?: number;
        ecsTaskSeconds?: number;
        errorMessage?: string;
      } = {
        status: newStatus,
        completedAt,
      };

      if (detectedPrUrl && !task.githubPrUrl) {
        updateFields.githubPrUrl = detectedPrUrl;
      }
      if (detectedPrNumber && !task.githubPrNumber) {
        updateFields.githubPrNumber = detectedPrNumber;
      }

      // Calculate duration if not set
      if (task.startedAt && !task.ecsTaskSeconds) {
        updateFields.ecsTaskSeconds = Math.floor(
          (completedAt.getTime() - task.startedAt.getTime()) / 1000,
        );
      }

      // Capture error message when task fails
      if (newStatus === "failed") {
        // Priority: 1) ::error:: marker from logs, 2) ECS stopped reason, 3) Generic message
        if (detectedErrorMessage) {
          updateFields.errorMessage = detectedErrorMessage;
        } else if (ecsInfo.stoppedReason) {
          updateFields.errorMessage = ecsInfo.stoppedReason;
        } else {
          updateFields.errorMessage = `Task failed with exit code ${ecsInfo.exitCode}`;
        }
        logger.info("Captured error message for failed task", {
          taskId: task.id,
          errorMessage: updateFields.errorMessage,
          source: detectedErrorMessage ? "log_marker" : (ecsInfo.stoppedReason ? "ecs_reason" : "exit_code"),
        });
      }

      // Conditional update: only overwrite if task is still executing
      // worker-complete callback may have already set the final status
      const updateResult = await taskRepo.update(
        { id: task.id, status: In(["executing", "environment_setup"]) },
        updateFields,
      );

      if (updateResult.affected === 0) {
        logger.info("Task already transitioned by worker-complete, skipping ECS monitor update", {
          taskId: task.id,
          detectedStatus: newStatus,
        });
        continue;
      }

      // Update local task object for subsequent logic
      task.status = newStatus;
      task.completedAt = completedAt;
      if (updateFields.githubPrUrl) task.githubPrUrl = updateFields.githubPrUrl;
      if (updateFields.githubPrNumber) task.githubPrNumber = updateFields.githubPrNumber;
      if (updateFields.ecsTaskSeconds) task.ecsTaskSeconds = updateFields.ecsTaskSeconds;
      if (updateFields.errorMessage) task.errorMessage = updateFields.errorMessage;

      // COST RECOVERY: If usage wasn't reported via the /usage endpoint, try to recover from:
      // 1. Partial tokens (from incremental /usage/partial reports during execution)
      // 2. Log markers (::input_tokens::, ::output_tokens::, etc.)
      // This ensures costs are captured even when workers fail/crash before final POST
      const freshTask = await taskRepo.findOne({ where: { id: task.id } });
      if (freshTask && !freshTask.usageReportedAt) {
        let recovered = false;

        // Option A: Use partial tokens if they were captured during execution
        if (
          freshTask.partialTokensUpdatedAt &&
          (freshTask.inputTokens > 0 || freshTask.outputTokens > 0)
        ) {
          const recoveredCost = freshTask.calculateCost();
          // Atomic update for cost recovery — prevents clobbering concurrent token updates
          await taskRepo
            .createQueryBuilder()
            .update(WorkerTask)
            .set({
              estimatedCostUsd: recoveredCost,
              usageReportedAt: new Date(),
            } as Record<string, unknown>)
            .where("id = :id", { id: freshTask.id })
            .execute();
          freshTask.estimatedCostUsd = recoveredCost;

          // Update org cumulative cost
          try {
            const costTracker = getCostTracker(AppDataSource);
            await costTracker.recordTaskCost(freshTask.id);
          } catch (costError) {
            logger.warn("Failed to record recovered cost to org", {
              taskId: task.id,
              error: costError instanceof Error ? costError.message : String(costError),
            });
          }

          logger.info("COST_RECOVERED_FROM_PARTIAL: Captured cost from incremental reports", {
            taskId: task.id,
            jiraIssueKey: task.jiraIssueKey,
            inputTokens: freshTask.inputTokens,
            outputTokens: freshTask.outputTokens,
            estimatedCostUsd: freshTask.estimatedCostUsd,
          });
          recovered = true;
        }

        // Option B: Parse logs for token markers if no partial tokens
        if (!recovered) {
          let recoveredInput = 0;
          let recoveredOutput = 0;
          let recoveredCacheCreate = 0;
          let recoveredCacheRead = 0;

          for (const log of logs) {
            const msg = log.message || "";

            const inputMatch = msg.match(/::input_tokens::(\d+)/);
            if (inputMatch) {
              recoveredInput = Math.max(recoveredInput, parseInt(inputMatch[1], 10));
            }

            const outputMatch = msg.match(/::output_tokens::(\d+)/);
            if (outputMatch) {
              recoveredOutput = Math.max(recoveredOutput, parseInt(outputMatch[1], 10));
            }

            const cacheCreateMatch = msg.match(/::cache_creation_tokens::(\d+)/);
            if (cacheCreateMatch) {
              recoveredCacheCreate = Math.max(recoveredCacheCreate, parseInt(cacheCreateMatch[1], 10));
            }

            const cacheReadMatch = msg.match(/::cache_read_tokens::(\d+)/);
            if (cacheReadMatch) {
              recoveredCacheRead = Math.max(recoveredCacheRead, parseInt(cacheReadMatch[1], 10));
            }
          }

          if (recoveredInput > 0 || recoveredOutput > 0) {
            freshTask.inputTokens = recoveredInput;
            freshTask.outputTokens = recoveredOutput;
            freshTask.cacheCreationTokens = recoveredCacheCreate;
            freshTask.cacheReadTokens = recoveredCacheRead;
            const markerCost = freshTask.calculateCost();
            // Atomic update for log-marker cost recovery
            await taskRepo
              .createQueryBuilder()
              .update(WorkerTask)
              .set({
                inputTokens: recoveredInput,
                outputTokens: recoveredOutput,
                cacheCreationTokens: recoveredCacheCreate,
                cacheReadTokens: recoveredCacheRead,
                estimatedCostUsd: markerCost,
                usageReportedAt: new Date(),
              } as Record<string, unknown>)
              .where("id = :id", { id: freshTask.id })
              .execute();
            freshTask.estimatedCostUsd = markerCost;

            // Update org cumulative cost
            try {
              const costTracker = getCostTracker(AppDataSource);
              await costTracker.recordTaskCost(freshTask.id);
            } catch (costError) {
              logger.warn("Failed to record recovered cost to org", {
                taskId: task.id,
                error: costError instanceof Error ? costError.message : String(costError),
              });
            }

            logger.info("COST_RECOVERED_FROM_MARKERS: Captured cost from log markers", {
              taskId: task.id,
              jiraIssueKey: task.jiraIssueKey,
              inputTokens: recoveredInput,
              outputTokens: recoveredOutput,
              cacheCreationTokens: recoveredCacheCreate,
              cacheReadTokens: recoveredCacheRead,
              estimatedCostUsd: freshTask.estimatedCostUsd,
            });
          }
          // NOTE: Dead code removed - else-if had same condition as if, so could never execute.
          // Cost audit discrepancy check was intended but had logic bug.
        }
      }

      // Validate quality gates for completed/deployed tasks
      // This ensures quality gates are actually enforced, not just decorative
      if (["completed", "deployed", "review_requested"].includes(newStatus)) {
        try {
          const gateValidation = await validateQualityGates(task);

          // Log validation results
          if (gateValidation.failures.length > 0) {
            const failureMsg = gateValidation.failures.join("\n");
            await logTaskEvent(
              task.id,
              "error",
              `Quality gates validation: ${gateValidation.failures.length} gate(s) failed:\n${failureMsg}`,
              { severity: "warning", metadata: { gateValidation } },
            );
          }

          if (gateValidation.warnings.length > 0) {
            const warningMsg = gateValidation.warnings.join("\n");
            await logTaskEvent(
              task.id,
              "info",
              `Quality gates validation: ${gateValidation.warnings.length} gate(s) have warnings:\n${warningMsg}`,
              { severity: "info", metadata: { gateValidation } },
            );
          }

          if (gateValidation.passed) {
            await logTaskEvent(task.id, "info", "✅ All quality gates passed");
          } else {
            await logTaskEvent(
              task.id,
              "error",
              "⚠️ Quality gates validation: Not all gates passed",
            );
          }

          // Store validation result with task for audit/debugging
          // (doesn't affect task status - gates are monitored but not blocking)
          const qualityGatesSummary = `\n\nQuality Gates Summary:\nPassed: ${gateValidation.passed}\nFailures: ${gateValidation.failures.length}\nWarnings: ${gateValidation.warnings.length}`;
          const updatedTaskNotes = (task.taskNotes || "") + qualityGatesSummary;
          await taskRepo.update(task.id, { taskNotes: updatedTaskNotes });
          task.taskNotes = updatedTaskNotes;
        } catch (gateError) {
          logger.warn("Error validating quality gates", {
            taskId: task.id,
            error:
              gateError instanceof Error
                ? gateError.message
                : String(gateError),
          });
          await logTaskEvent(
            task.id,
            "error",
            `Could not validate quality gates: ${gateError instanceof Error ? gateError.message : "Unknown error"}`,
            { severity: "warning" },
          );
        }
      }

      // COST VALIDATION: Warn if completed task has zero cost (possible tracking gap)
      if (["completed", "deployed", "review_requested"].includes(newStatus)) {
        const finalTask = await taskRepo.findOne({ where: { id: task.id } });
        if (finalTask) {
          const hasCost = (finalTask.estimatedCostUsd ?? 0) > 0;
          const hasTokens = (finalTask.inputTokens ?? 0) > 0 || (finalTask.outputTokens ?? 0) > 0;

          if (!hasCost && !hasTokens) {
            // Zero cost on completed task - likely a tracking gap
            logger.warn("COST_VALIDATION_WARNING: Completed task has zero cost - possible tracking gap", {
              taskId: task.id,
              jiraIssueKey: task.jiraIssueKey,
              status: newStatus,
              inputTokens: finalTask.inputTokens,
              outputTokens: finalTask.outputTokens,
              estimatedCostUsd: finalTask.estimatedCostUsd,
              usageReportedAt: finalTask.usageReportedAt,
            });

            await logTaskEvent(
              task.id,
              "info",
              "⚠️ Cost tracking: Task completed with $0.00 cost. Tokens may not have been captured.",
              { severity: "warning", metadata: { estimatedCostUsd: 0, inputTokens: 0, outputTokens: 0 } },
            );

            // Flag the task for dashboard visibility
            await taskRepo.update(task.id, {
              taskNotes: (finalTask.taskNotes || "") + "\n\n⚠️ COST_WARNING: Zero cost on completion - review token tracking",
            });
          }
        }
      }

      // DIRECTIVE EFFECTIVENESS: Update directive metrics when task reaches terminal state
      if (["completed", "deployed", "failed"].includes(newStatus)) {
        try {
          const finalTaskForDirectives = await taskRepo.findOne({ where: { id: task.id } });
          if (finalTaskForDirectives && finalTaskForDirectives.directivesUsed?.length > 0) {
            const success = newStatus === "completed" || newStatus === "deployed";
            await updateDirectiveOutcome(task.id, {
              success,
              qualityScore: finalTaskForDirectives.qualityScore,
              accuracyScore: finalTaskForDirectives.accuracyScore,
              reviewOutcome: finalTaskForDirectives.reviewOutcome,
            });
            logger.debug("Updated directive effectiveness metrics", {
              taskId: task.id,
              success,
              directivesCount: finalTaskForDirectives.directivesUsed.length,
            });
          }
        } catch (directiveError) {
          logger.warn("Failed to update directive effectiveness metrics", {
            taskId: task.id,
            error: directiveError instanceof Error ? directiveError.message : String(directiveError),
          });
        }
      }

      // CLOUD COMPUTE BILLING: Deduct compute usage when cloud tasks reach terminal state
      // Only deduct for cloud ECS tasks (not agent-claimed local tasks)
      if (
        ["completed", "deployed", "failed"].includes(newStatus) &&
        !task.claimedByAgent &&
        task.startedAt &&
        !localEpicSpawner.isLocalMode()
      ) {
        try {
          const durationMinutes = Math.max(
            1,
            (completedAt.getTime() - task.startedAt.getTime()) / (1000 * 60),
          );
          const deductResult = await deductComputeUsage(
            task.orgId,
            task.id,
            durationMinutes,
          );
          logger.info("Deducted cloud compute usage", {
            taskId: task.id,
            orgId: task.orgId,
            durationMinutes: Math.ceil(durationMinutes),
            deductedCents: deductResult.totalDeducted,
            balanceAfterCents: deductResult.balanceAfter,
            autoRechargeTriggered: deductResult.autoRechargeTriggered,
          });
        } catch (billingError) {
          logger.error("Failed to deduct cloud compute usage", {
            taskId: task.id,
            orgId: task.orgId,
            error: billingError instanceof Error ? billingError.message : String(billingError),
          });
        }
      }

      // INTERNAL TASK SYNC: Update InternalTask status and board column when WorkerTask completes
      if (task.internalTaskId && ["completed", "deployed", "failed", "review_requested", "pr_created", "pr_approved", "escalated"].includes(newStatus)) {
        try {
          await syncInternalTaskStatus(task, newStatus);
        } catch (syncError) {
          logger.warn("Failed to sync internal task status", {
            taskId: task.id,
            internalTaskId: task.internalTaskId,
            error: syncError instanceof Error ? syncError.message : String(syncError),
          });
        }
      }

      // KB CARD: Move linked KbCard to appropriate column and post status comment
      if (["completed", "deployed", "failed", "review_requested", "pr_created", "pr_approved", "escalated"].includes(newStatus)) {
        // Move card to matching column (Done, Review, To Do)
        try {
          await syncKbCardColumn(task.id, newStatus);
        } catch (cardMoveError) {
          logger.warn("Failed to move KbCard column", {
            taskId: task.id,
            error: cardMoveError instanceof Error ? cardMoveError.message : String(cardMoveError),
          });
        }

        // Check if completing this card unblocks dependent cards on the same board
        if (["completed", "deployed", "pr_approved", "review_approved"].includes(newStatus)) {
          try {
            const kbCardRepo = AppDataSource.getRepository(KbCard);
            const kbCard = await kbCardRepo.findOne({
              where: { workerTaskId: task.id },
              relations: ["board"],
            });
            if (!kbCard) {
              logger.debug("PRD cascade (monitor): no KbCard linked to task", { taskId: task.id });
            } else if (!kbCard.board) {
              logger.warn("PRD cascade (monitor): KbCard has no board", { taskId: task.id, cardId: kbCard.id });
            } else {
              const orgRepo = AppDataSource.getRepository(Organization);
              const org = await orgRepo.findOne({ where: { id: kbCard.board.orgId } });
              if (!org?.prdAutoRun) {
                logger.debug("PRD cascade (monitor): prdAutoRun disabled", { taskId: task.id, orgId: kbCard.board.orgId });
              } else {
                const { processUnblockedCards } = await import("./board-execution.js");
                const cascadeResult = await processUnblockedCards(kbCard.board.id, kbCard.board.orgId, task.boardExecutionId ?? undefined);
                logger.info("PRD cascade (monitor) result", {
                  taskId: task.id,
                  boardId: kbCard.board.id,
                  triggered: cascadeResult.triggered,
                  stillBlocked: cascadeResult.stillBlocked,
                  alreadyComplete: cascadeResult.alreadyComplete,
                });
              }
            }
          } catch (cascadeErr) {
            logger.error("PRD cascade check failed", { taskId: task.id, error: String(cascadeErr) });
          }
        }

        // Post status comment
        try {
          const linkedCard = await AppDataSource.getRepository(KbCard).findOne({
            where: { workerTaskId: task.id },
            select: ["id"],
          });
          if (linkedCard) {
            const statusMessages: Record<string, string> = {
              completed: "Worker task completed successfully.",
              deployed: "Worker task deployed successfully.",
              failed: "Worker task failed.",
              review_requested: `Worker task created a PR for review.${task.githubPrUrl ? ` PR: ${task.githubPrUrl}` : ""}`,
              pr_created: `Worker task created a PR.${task.githubPrUrl ? ` PR: ${task.githubPrUrl}` : ""}`,
              escalated: "Worker task escalated — needs clarification.",
            };
            const content = `[WorkerMill] ${statusMessages[newStatus] || `Status changed to ${newStatus}.`}`;
            const commentRepo = AppDataSource.getRepository(KbComment);
            await commentRepo.save(commentRepo.create({
              cardId: linkedCard.id,
              authorId: null,
              content,
            }));
          }
        } catch (cardCommentError) {
          logger.warn("Failed to post KbCard status comment", {
            taskId: task.id,
            error: cardCommentError instanceof Error ? cardCommentError.message : String(cardCommentError),
          });
        }
      }

      // Unblock dependent sibling tasks when a child task completes
      // Tasks with dependencies start as "blocked" and need to be transitioned to "queued"
      // when their dependencies reach a terminal state (completed, deployed, review_requested)
      if (task.parentTaskId && ["completed", "deployed", "review_requested"].includes(newStatus)) {
        try {
          await checkAndUnblockDependentTasks(task);
        } catch (unblockError) {
          logger.warn("Failed to unblock dependent tasks from monitor", {
            taskId: task.id,
            error: unblockError instanceof Error ? unblockError.message : String(unblockError),
          });
        }
      }

      // PRD Workflow: Auto-merge child PRs to feature branch
      // This consolidates all child work onto the feature branch for the final PR
      if (
        newStatus === "review_requested" &&
        task.githubPrNumber &&
        task.githubRepo
      ) {
        try {
          const parentTask = task.parentTaskId
            ? await taskRepo.findOne({ where: { id: task.parentTaskId } })
            : null;
          const isPrdWorkflow = parentTask?.githubBranch != null;

          if (isPrdWorkflow) {
            const { mergePullRequest } = await import("../utils/github.js");
            const merged = await mergePullRequest(
              task.githubRepo,
              task.githubPrNumber,
              {
                mergeMethod: "squash",
                commitTitle: `${task.jiraIssueKey}: ${task.summary}`,
              },
            );

            if (merged) {
              // Use partial update to avoid overwriting token/cost data
              await taskRepo.update(task.id, { status: "deployed" });
              task.status = "deployed"; // Update local object for consistency
              await logTaskEvent(
                task.id,
                "status_change",
                `✅ Auto-merged PR ***REMOVED***${task.githubPrNumber} to feature branch`,
              );
              logger.info("Auto-merged child PR to feature branch", {
                taskId: task.id,
                prNumber: task.githubPrNumber,
                parentTaskId: task.parentTaskId,
              });
            } else {
              await logTaskEvent(
                task.id,
                "info",
                `⚠️ Could not auto-merge PR ***REMOVED***${task.githubPrNumber} - manual merge may be needed`,
              );
              logger.warn("Failed to auto-merge child PR", {
                taskId: task.id,
                prNumber: task.githubPrNumber,
              });
            }
          }
        } catch (mergeError) {
          logger.warn("Error in auto-merge flow", {
            taskId: task.id,
            error:
              mergeError instanceof Error
                ? mergeError.message
                : String(mergeError),
          });
        }
      }

      // Clean up coordination data for completed task (Phase 8)
      // This releases file locks, resource reservations, and removes check-in
      await checkOut(task.id).catch((checkOutError) => {
        logger.warn("Failed to check out completed task from coordination", {
          taskId: task.id,
          error:
            checkOutError instanceof Error
              ? checkOutError.message
              : String(checkOutError),
        });
      });

      // Send Slack notifications for terminal and waiting statuses
      // Wrap in try/catch so notification failures don't break orchestration
      try {
        // Notify on all terminal and waiting states where the worker has finished
        // - completed/deployed: Task fully done
        // - pr_approved: Tech Lead approved, ready for merge/deploy
        // - review_requested: PR created, waiting for human review
        // - escalated: Task needs human intervention
        if (newStatus === "completed" || newStatus === "deployed" ||
            newStatus === "pr_approved" || newStatus === "review_requested" ||
            newStatus === "escalated") {
          await notifyTaskCompleted(task);
          logger.debug("Sent task completed notification", {
            taskId: task.id,
            status: newStatus,
          });
        } else if (newStatus === "failed") {
          await notifyTaskFailed(task);
          logger.debug("Sent task failed notification", {
            taskId: task.id,
          });
        }

        // Check if cost alert threshold exceeded after task completion
        const org = await getOrgRepo().findOne({ where: { id: task.orgId } });
        if (org && org.costAlertThresholdUsd && task.estimatedCostUsd) {
          // Get total cost this month from all tasks
          const costResult = await AppDataSource.query(
            `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total_cost
             FROM worker_tasks
             WHERE org_id = $1
               AND created_at >= $2`,
            [
              task.orgId,
              org.billingCycleStart || new Date(new Date().setDate(1)),
            ],
          );
          const totalCost = parseFloat(costResult[0]?.total_cost || "0");
          if (totalCost >= org.costAlertThresholdUsd) {
            await notifyCostAlert(
              task.orgId,
              totalCost,
              org.costAlertThresholdUsd,
            );
            logger.info("Sent cost alert notification", {
              orgId: task.orgId,
              totalCost,
              threshold: org.costAlertThresholdUsd,
            });
          }
        }
      } catch (notifyError) {
        logger.warn("Failed to send Slack notification", {
          taskId: task.id,
          error:
            notifyError instanceof Error
              ? notifyError.message
              : String(notifyError),
        });
      }

      const logMessage = detectedResult
        ? `Task completed via ECS monitoring: result=${detectedResult}, status=${newStatus}`
        : `Task completed via ECS monitoring: exit_code=${ecsInfo.exitCode}, status=${newStatus}`;

      await logTaskEvent(task.id, "status_change", logMessage, {
        severity: newStatus === "failed" ? "error" : "info",
      });

      logger.info("Task completion detected and processed", {
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        newStatus,
        detectedResult,
        exitCode: ecsInfo.exitCode,
        prUrl: detectedPrUrl,
      });
    } catch (error) {
      logger.error("Error processing task completion", {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Move a linked KbCard to the appropriate board column based on WorkerTask status.
 * Maps worker statuses to standard kanban column names (case-insensitive match).
 */
export async function syncKbCardColumn(
  taskId: string,
  newStatus: string,
): Promise<void> {
  const cardRepo = AppDataSource.getRepository(KbCard);
  const columnRepo = AppDataSource.getRepository(KbColumn);

  const linkedCard = await cardRepo.findOne({
    where: { workerTaskId: taskId },
    select: ["id", "boardId", "columnId"],
  });
  if (!linkedCard) return;

  // Map worker status to target column name (with fallbacks for boards that use different names)
  let targetColumnNames: string[] | null;
  switch (newStatus) {
    case "claimed":
    case "executing":
    case "planning":
    case "environment_setup":
    case "integration_check":
      targetColumnNames = ["In Progress"];
      break;
    case "review_requested":
    case "pr_created":
      targetColumnNames = ["Review"];
      break;
    case "pr_approved":
      targetColumnNames = ["Approved", "PR Approved"];
      break;
    case "completed":
    case "deployed":
      targetColumnNames = ["Deployed", "Done"];
      break;
    case "failed":
    case "escalated":
    case "cancelled":
      targetColumnNames = null; // Stay in current column
      break;
    default:
      return; // Unknown status, don't move
  }

  if (!targetColumnNames) return; // No column movement needed

  // Find the target column on the same board (try each name in priority order, case-insensitive)
  let targetColumn: KbColumn | null = null;
  for (const name of targetColumnNames) {
    targetColumn = await columnRepo
      .createQueryBuilder("col")
      .where("col.board_id = :boardId", { boardId: linkedCard.boardId })
      .andWhere("LOWER(col.name) = LOWER(:name)", { name })
      .getOne();
    if (targetColumn) break;
  }

  if (!targetColumn || targetColumn.id === linkedCard.columnId) return;

  // Get next position in the target column
  const maxPosResult = await cardRepo
    .createQueryBuilder("card")
    .where("card.column_id = :columnId", { columnId: targetColumn.id })
    .select("MAX(card.position)", "maxPos")
    .getRawOne();
  const newPosition = (maxPosResult?.maxPos ?? -1) + 1;

  await cardRepo.update(
    { id: linkedCard.id },
    { columnId: targetColumn.id, position: newPosition },
  );

  logger.debug("Moved KbCard to column", {
    cardId: linkedCard.id,
    targetColumn: targetColumn.name,
    workerStatus: newStatus,
  });
}

/**
 * Sync WorkerTask status back to the originating InternalTask.
 * Updates the InternalTask status and moves the card to the appropriate board column.
 */
export async function syncInternalTaskStatus(
  workerTask: WorkerTask,
  newStatus: string,
): Promise<void> {
  if (!workerTask.internalTaskId) return;

  const internalTaskRepo = AppDataSource.getRepository(InternalTask);
  const columnRepo = AppDataSource.getRepository(BoardColumn);

  const internalTask = await internalTaskRepo.findOne({
    where: { id: workerTask.internalTaskId },
  });
  if (!internalTask) {
    logger.warn("InternalTask not found for sync", {
      internalTaskId: workerTask.internalTaskId,
      workerTaskId: workerTask.id,
    });
    return;
  }

  // Map WorkerTask status to InternalTask status and target column type
  let internalStatus: typeof internalTask.status;
  let targetColumnType: BoardColumnType | null;

  switch (newStatus) {
    case "review_requested":
    case "pr_created":
      internalStatus = "review";
      targetColumnType = "review";
      break;
    case "pr_approved":
      internalStatus = "pr_approved";
      targetColumnType = "pr_approved";
      break;
    case "completed":
    case "deployed":
      internalStatus = "deployed";
      targetColumnType = "deployed";
      break;
    case "escalated":
      // Stay in current column — needs human attention
      internalStatus = internalTask.status; // no status change
      targetColumnType = null;
      break;
    case "failed":
      internalStatus = "failed";
      targetColumnType = null; // Stay in current column
      break;
    default:
      return; // Unknown status, don't sync
  }

  // Update InternalTask status
  internalTask.status = internalStatus;

  // Move card to appropriate board column (null = stay in current column)
  let targetColumn = null;
  if (targetColumnType) {
    targetColumn = await columnRepo.findOne({
      where: { projectId: internalTask.projectId, columnType: targetColumnType },
    });

    if (targetColumn) {
      const maxPosResult = await internalTaskRepo
        .createQueryBuilder("task")
        .where("task.columnId = :columnId", { columnId: targetColumn.id })
        .select("MAX(task.columnPosition)", "maxPos")
        .getRawOne();
      const newPosition = (maxPosResult?.maxPos ?? -1) + 1;

      internalTask.columnId = targetColumn.id;
      internalTask.columnPosition = newPosition;
    }
  }

  // Atomic update to prevent clobbering concurrent board changes
  const updateSet: Record<string, unknown> = { status: internalStatus };
  if (targetColumn) {
    updateSet.columnId = internalTask.columnId;
    updateSet.columnPosition = internalTask.columnPosition;
  }
  await internalTaskRepo
    .createQueryBuilder()
    .update("internal_tasks")
    .set(updateSet)
    .where("id = :id", { id: internalTask.id })
    .execute();

  logger.info("Synced InternalTask status from WorkerTask", {
    internalTaskId: internalTask.id,
    taskKey: internalTask.taskKey,
    workerTaskId: workerTask.id,
    internalStatus,
    workerStatus: newStatus,
    targetColumnType,
  });
}
