/**
 * Task Claimer — Find and atomically claim queued tasks
 *
 * Extracted from orchestrator.ts.
 * Used by: orchestrator.ts (pollLoop)
 *
 * Respects:
 * - System enabled: skip all tasks when system is in maintenance mode
 * - Persona concurrency: only 1 active task per persona per org
 * - Task cooldown: skip tasks whose Jira ticket had a recent attempt
 * - Max concurrent workers: limit active tasks per org
 * - Per-repo concurrency: limit active workers per repo
 * - Dependency blocking: skip tasks with unresolved dependencies
 * - Quota / budget enforcement
 */

import { In } from "typeorm";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/index.js";
import { TaskRelationship } from "../models/TaskRelationship.js";
import { syncKbCardColumn } from "./task-monitor.js";
import { logger } from "../utils/logger.js";
import { getActiveWorkerCountsByRepo } from "./coordination.js";
import { canCreateTask } from "./billing.js";
import { canStartTaskWithinBudget } from "./budget-enforcement.js";
import { getOrgRepo, getTaskRepo } from "./orchestrator-utils.js";

/**
 * Find queued tasks that can be executed
 * Respects:
 * - System enabled: skip all tasks when system is in maintenance mode
 * - Persona concurrency: only 1 active task per persona per org
 * - Task cooldown: skip tasks whose Jira ticket had a recent attempt (within org.taskCooldownSeconds)
 * - Max concurrent workers: limit active tasks per org to org.maxConcurrentWorkers
 * - Per-repo concurrency: limit active workers per repo via coordination service check-ins
 */
export async function findQueuedTasks(): Promise<WorkerTask[]> {
  const taskRepo = getTaskRepo();
  const orgRepo = getOrgRepo();

  // Get all queued tasks (exclude tasks claimed by a remote agent — those run locally)
  // REMOTE AGENT: Also skip tasks from orgs with active remote agents (heartbeat within 2 min).
  // This prevents the cloud orchestrator from racing the agent to claim queued tasks.
  const activeAgentCutoff = new Date(Date.now() - 2 * 60 * 1000);
  const queuedTasks = await taskRepo
    .createQueryBuilder("task")
    .where("task.status = :status", { status: "queued" })
    .andWhere("task.claimed_by_agent IS NULL")
    .andWhere(
      `task.org_id NOT IN (
        SELECT DISTINCT org_id FROM remote_agents
        WHERE status = 'online' AND last_heartbeat_at > :activeAgentCutoff
      )`,
      { activeAgentCutoff },
    )
    .orderBy("task.createdAt", "ASC")
    .take(10)
    .getMany();

  if (queuedTasks.length === 0) {
    return [];
  }

  // Get unique org IDs from queued tasks to check systemEnabled
  const orgIds = [...new Set(queuedTasks.map((t) => t.orgId))];
  const orgsForCheck = await orgRepo.find({
    where: { id: In(orgIds) },
    select: ["id", "systemEnabled"],
  });

  // Build set of orgs with system disabled (maintenance mode)
  const maintenanceOrgs = new Set<string>();
  for (const org of orgsForCheck) {
    if (!org.systemEnabled) {
      maintenanceOrgs.add(org.id);
      logger.debug("Organization in maintenance mode - skipping tasks", {
        orgId: org.id,
      });
    }
  }

  // Filter out tasks from orgs in maintenance mode early
  const nonMaintenanceTasks = queuedTasks.filter(
    (task) => !maintenanceOrgs.has(task.orgId),
  );

  if (nonMaintenanceTasks.length === 0) {
    return [];
  }

  // Filter out tasks blocked by TaskRelationship dependencies (depends_on, blocks)
  // A task is blocked if it has a "depends_on" relationship where the source task is not terminal
  const taskIds = nonMaintenanceTasks.map((t) => t.id);
  const blockingRelationships = await AppDataSource.getRepository(
    TaskRelationship,
  )
    .createQueryBuilder("rel")
    .innerJoin("worker_tasks", "source", "source.id = rel.source_task_id")
    .where("rel.target_task_id IN (:...taskIds)", { taskIds })
    .andWhere("rel.relationship_type IN (:...types)", {
      types: ["depends_on", "blocks"],
    })
    .andWhere("source.status NOT IN (:...terminalStatuses)", {
      terminalStatuses: ["completed", "deployed", "failed", "cancelled"],
    })
    .select(["rel.target_task_id"])
    .getMany();

  const blockedTaskIds = new Set(
    blockingRelationships.map((r) => r.targetTaskId),
  );
  const unblockedTasks = nonMaintenanceTasks.filter((t) => {
    if (blockedTaskIds.has(t.id)) {
      logger.info(
        "Task blocked by dependency — skipping until blocker completes",
        {
          taskId: t.id,
          jiraIssueKey: t.jiraIssueKey,
        },
      );
      return false;
    }
    return true;
  });

  if (unblockedTasks.length === 0) {
    return [];
  }

  // Get active tasks to check persona concurrency and org limits
  // Include "planning" — remote agent plans tasks locally, consuming a worker slot
  const activeTasks = await taskRepo.find({
    where: {
      status: In([
        "planning",
        "claimed",
        "environment_setup",
        "executing",
        "deploying",
        "dispatching",
      ]),
    },
  });

  // Build a set of occupied persona slots per org
  const occupiedSlots = new Set<string>();
  // Count active tasks per org
  const activeCountByOrg = new Map<string, number>();

  for (const task of activeTasks) {
    occupiedSlots.add(`${task.orgId}:${task.workerPersona}`);
    activeCountByOrg.set(
      task.orgId,
      (activeCountByOrg.get(task.orgId) || 0) + 1,
    );
  }

  // Fetch org settings for cooldown and maxConcurrentWorkers
  // Note: orgIds was already computed above for the maintenance check
  const orgs = await orgRepo.find({
    where: { id: In(orgIds) },
  });
  const orgSettings = new Map(orgs.map((o) => [o.id, o]));

  // Get active worker counts per repo from coordination service (Phase 7)
  // This tracks actual running workers via check-ins, more accurate than task status
  const activeWorkersByRepoByOrg = new Map<string, Map<string, number>>();
  for (const orgId of orgIds) {
    try {
      const repoWorkerCounts = await getActiveWorkerCountsByRepo(orgId);
      activeWorkersByRepoByOrg.set(orgId, repoWorkerCounts);
    } catch (error) {
      logger.warn("Failed to get active worker counts for org", {
        orgId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue without repo-level limits on error
      activeWorkersByRepoByOrg.set(orgId, new Map());
    }
  }

  // Get recent failed/completed tasks to check cooldown (by Jira issue key)
  const jiraIssueKeys = [
    ...new Set(unblockedTasks.map((t) => t.jiraIssueKey)),
  ];
  const recentTasks = await taskRepo
    .createQueryBuilder("task")
    .select(["task.jiraIssueKey", "task.orgId", "task.updatedAt"])
    .where("task.jiraIssueKey IN (:...keys)", { keys: jiraIssueKeys })
    .andWhere("task.status IN (:...statuses)", {
      statuses: ["failed", "completed", "deployed", "cancelled"],
    })
    .orderBy("task.updatedAt", "DESC")
    .getMany();

  // Build map of most recent attempt time per Jira issue key per org
  const lastAttemptByIssue = new Map<string, Date>();
  for (const task of recentTasks) {
    const key = `${task.orgId}:${task.jiraIssueKey}`;
    if (!lastAttemptByIssue.has(key)) {
      lastAttemptByIssue.set(key, task.updatedAt);
    }
  }

  const now = Date.now();

  // Check quota eligibility for each org
  // LOCAL MODE: Skip quota checks - using user's Claude Max subscription
  const quotaEligibleOrgs = new Set<string>();
  const quotaBlockedOrgs = new Set<string>();
  const isLocalMode = process.env.EXECUTION_MODE === "local";

  for (const orgId of orgIds) {
    const org = orgSettings.get(orgId);
    if (!org) continue;

    // Skip quota check in local mode
    if (isLocalMode) {
      quotaEligibleOrgs.add(orgId);
      continue;
    }

    const quotaCheck = await canCreateTask(org);
    if (quotaCheck.allowed) {
      quotaEligibleOrgs.add(orgId);
    } else {
      quotaBlockedOrgs.add(orgId);
      logger.warn(
        "Organization blocked by quota - tasks will remain queued",
        {
          orgId,
          orgName: org.name,
          reason: quotaCheck.reason,
          usage: quotaCheck.usage,
        },
      );
    }
  }

  // Check budget limits for each org (AI FinOps)
  // LOCAL MODE: Skip budget checks - using user's Claude Max subscription
  const budgetBlockedOrgs = new Set<string>();

  for (const orgId of orgIds) {
    const org = orgSettings.get(orgId);
    if (!org) continue;

    // Skip budget check in local mode
    if (isLocalMode) {
      continue;
    }

    const withinBudget = await canStartTaskWithinBudget(org);
    if (!withinBudget) {
      budgetBlockedOrgs.add(orgId);
      logger.warn(
        "Organization blocked by budget limit - tasks will remain queued",
        {
          orgId,
          orgName: org.name,
        },
      );
    }
  }

  // Filter to tasks that can be executed
  // Note: already filtered out maintenance orgs and dependency-blocked tasks above
  const eligibleTasks = unblockedTasks.filter((task) => {
    const org = orgSettings.get(task.orgId);
    if (!org) {
      logger.warn("Organization not found for task", {
        taskId: task.id,
        orgId: task.orgId,
      });
      return false;
    }

    // Check quota
    if (quotaBlockedOrgs.has(task.orgId)) {
      return false;
    }

    // Check budget limits (AI FinOps)
    if (budgetBlockedOrgs.has(task.orgId)) {
      return false;
    }

    // Check persona concurrency
    // EXCEPTION: Skip persona check for child tasks in PRD workflows
    // PRD siblings should run in parallel even with the same persona
    const slotKey = `${task.orgId}:${task.workerPersona}`;
    if (occupiedSlots.has(slotKey) && !task.parentTaskId) {
      return false;
    }

    // Check maxConcurrentWorkers per org
    const activeCount = activeCountByOrg.get(task.orgId) || 0;
    if (activeCount >= org.maxConcurrentWorkers) {
      return false;
    }

    // Check per-repo concurrency (Phase 7)
    // Use coordination service check-ins to count active workers per repo
    const repoWorkerCounts = activeWorkersByRepoByOrg.get(task.orgId);
    if (repoWorkerCounts && task.githubRepo) {
      const activeRepoWorkers = repoWorkerCounts.get(task.githubRepo) || 0;
      // Limit to maxConcurrentWorkers per repo (same limit as org-wide)
      if (activeRepoWorkers >= org.maxConcurrentWorkers) {
        logger.debug("Repo at max concurrent workers", {
          taskId: task.id,
          repo: task.githubRepo,
          activeRepoWorkers,
          maxConcurrentWorkers: org.maxConcurrentWorkers,
        });
        return false;
      }
    }

    // Check cooldown: skip if last attempt was within cooldown period
    const issueKey = `${task.orgId}:${task.jiraIssueKey}`;
    const lastAttempt = lastAttemptByIssue.get(issueKey);
    if (lastAttempt) {
      const cooldownMs = org.taskCooldownSeconds * 1000;
      const timeSinceLastAttempt = now - lastAttempt.getTime();
      if (timeSinceLastAttempt < cooldownMs) {
        logger.debug("Task in cooldown", {
          taskId: task.id,
          jiraIssueKey: task.jiraIssueKey,
          cooldownSeconds: org.taskCooldownSeconds,
          secondsRemaining: Math.ceil(
            (cooldownMs - timeSinceLastAttempt) / 1000,
          ),
        });
        return false;
      }
    }

    return true;
  });

  return eligibleTasks.slice(0, 5); // Process up to 5 at a time
}

/**
 * Atomically claim a task
 * Returns true if successfully claimed, false if already claimed by another process
 */
export async function claimTask(taskId: string): Promise<boolean> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);

  const result = await taskRepo
    .createQueryBuilder()
    .update(WorkerTask)
    .set({ status: "claimed" })
    .where("id = :id AND status = :status AND claimed_by_agent IS NULL", {
      id: taskId,
      status: "queued",
    })
    .execute();

  const claimed = (result.affected || 0) > 0;

  // Move linked KbCard to "In Progress" column
  if (claimed) {
    syncKbCardColumn(taskId, "claimed").catch(() => {});
  }

  return claimed;
}
