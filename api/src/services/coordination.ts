/**
 * Worker Coordination Service
 *
 * Enables multiple AI workers to execute tasks in parallel on the same repository
 * without collisions. Provides:
 * - Worker check-in/out for presence tracking
 * - Heartbeat for liveness detection
 * - File-level locks to prevent concurrent edits
 * - Resource reservations for shared resources (test DBs, deploy slots, etc.)
 */

import { AppDataSource } from "../db/connection.js";
import {
  WorkerCheckIn,
  WorkerFileLock,
  WorkerResourceReservation,
  WorkerTask,
} from "../models/index.js";
import type { ResourceType } from "../models/index.js";
import { logger } from "../utils/logger.js";

// SIMPLIFIED: DEFAULT_LOCK_TTL_SECONDS removed

// Default TTL for resource reservations (10 minutes)
const DEFAULT_RESOURCE_TTL_SECONDS = 600;

// Stale check-in threshold (5 minutes without heartbeat)
const STALE_CHECKIN_THRESHOLD_MS = 5 * 60 * 1000;

// Repository access helpers
const getCheckInRepo = () => AppDataSource.getRepository(WorkerCheckIn);
const getFileLockRepo = () => AppDataSource.getRepository(WorkerFileLock);
const getResourceRepo = () => AppDataSource.getRepository(WorkerResourceReservation);
const getTaskRepo = () => AppDataSource.getRepository(WorkerTask);

export interface CheckInParams {
  taskId: string;
  workerId: string;
  repo: string;
  branch: string;
  status: string;
  currentFile?: string;
  filesModified?: string[];
  metadata?: Record<string, unknown>;
}

export interface CheckInResult {
  success: boolean;
  checkInId: string;
  conflicts: Array<{
    taskId: string;
    workerId: string;
    branch: string;
    status: string;
  }>;
}

export interface HeartbeatParams {
  taskId: string;
  status?: string;
  currentFile?: string;
  filesModified?: string[];
}

export interface ActiveWorker {
  taskId: string;
  workerId: string;
  repo: string;
  branch: string;
  status: string;
  currentFile: string | null;
  filesModified: string[];
  startedAt: Date;
  heartbeatAt: Date;
  metadata: Record<string, unknown>;
}

// SIMPLIFIED: FileLockInfo interface removed

export interface AcquireLocksResult {
  success: boolean;
  acquired: string[];
  conflicts: Array<{
    filePath: string;
    heldBy: {
      taskId: string;
      workerId: string;
      expiresAt: Date;
    };
  }>;
}

export interface ResourceReservationInfo {
  resourceType: ResourceType;
  resourceId: string;
  taskId: string;
  workerId: string;
  acquiredAt: Date;
  expiresAt: Date;
}

export interface ReserveResourceResult {
  success: boolean;
  resourceId: string;
  expiresAt: Date;
  conflict?: {
    taskId: string;
    workerId: string;
    expiresAt: Date;
  };
}

// SIMPLIFIED: Manifest types section removed - file conflict detection handled via storyDependencies

export interface DeclareManifestResult {
  success: boolean;
  conflicts: Array<{
    filePath: string;
    heldBy: {
      taskId: string;
      workerId: string;
      expiresAt: Date;
    };
  }>;
  locksAcquired: string[];
}

/**
 * Worker check-in
 *
 * Called when a worker starts executing a task. Records the worker's presence
 * and returns any potential conflicts (other workers on same branch).
 */
export async function checkIn(params: CheckInParams): Promise<CheckInResult> {
  const { taskId, workerId, repo, branch, status, currentFile, filesModified, metadata } = params;

  const checkInRepo = getCheckInRepo();
  const taskRepo = getTaskRepo();

  // Get the task to determine org
  const task = await taskRepo.findOne({ where: { id: taskId } });
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const orgId = task.orgId;

  // Check for existing check-in for this task
  const existingCheckIn = await checkInRepo.findOne({ where: { taskId } });

  let checkIn: WorkerCheckIn;
  const now = new Date();

  if (existingCheckIn) {
    // Update existing check-in
    existingCheckIn.workerId = workerId;
    existingCheckIn.repo = repo;
    existingCheckIn.branch = branch;
    existingCheckIn.status = status;
    existingCheckIn.currentFile = currentFile || null;
    existingCheckIn.filesModified = filesModified || [];
    existingCheckIn.heartbeatAt = now;
    existingCheckIn.metadata = metadata || {};
    checkIn = await checkInRepo.save(existingCheckIn);
  } else {
    // Create new check-in
    checkIn = checkInRepo.create({
      taskId,
      orgId,
      workerId,
      repo,
      branch,
      status,
      currentFile: currentFile || null,
      filesModified: filesModified || [],
      heartbeatAt: now,
      startedAt: now,
      metadata: metadata || {},
    });
    checkIn = await checkInRepo.save(checkIn);
  }

  // Find other workers on the same repo (potential conflicts)
  const otherWorkers = await checkInRepo
    .createQueryBuilder("ci")
    .where("ci.org_id = :orgId", { orgId })
    .andWhere("ci.repo = :repo", { repo })
    .andWhere("ci.task_id != :taskId", { taskId })
    .getMany();

  // Filter to non-stale workers
  const activeOthers = otherWorkers.filter((w) => !w.isStale(STALE_CHECKIN_THRESHOLD_MS));

  const conflicts = activeOthers.map((w) => ({
    taskId: w.taskId,
    workerId: w.workerId,
    branch: w.branch,
    status: w.status,
  }));

  logger.info("Worker checked in", {
    taskId,
    workerId,
    repo,
    branch,
    status,
    conflictCount: conflicts.length,
  });

  return {
    success: true,
    checkInId: checkIn.id,
    conflicts,
  };
}

/**
 * Worker check-out
 *
 * Called when a worker finishes executing a task.
 * Removes the check-in record and releases all locks held by this task.
 */
export async function checkOut(taskId: string): Promise<{ success: boolean }> {
  const checkInRepo = getCheckInRepo();
  const fileLockRepo = getFileLockRepo();
  const resourceRepo = getResourceRepo();

  // Remove check-in
  await checkInRepo.delete({ taskId });

  // Release all file locks held by this task
  await fileLockRepo.delete({ taskId });

  // Release all resource reservations held by this task
  await resourceRepo.delete({ taskId });

  logger.info("Worker checked out", { taskId });

  return { success: true };
}

/**
 * Worker heartbeat
 *
 * Called periodically by workers to indicate they're still alive.
 * Updates the heartbeat timestamp and optionally the current file/status.
 */
export async function heartbeat(params: HeartbeatParams): Promise<{ success: boolean }> {
  const { taskId, status, currentFile, filesModified } = params;

  const checkInRepo = getCheckInRepo();
  const taskRepo = getTaskRepo();

  const checkIn = await checkInRepo.findOne({ where: { taskId } });
  if (!checkIn) {
    throw new Error(`No check-in found for task: ${taskId}`);
  }

  const now = new Date();
  checkIn.heartbeatAt = now;

  if (status !== undefined) {
    checkIn.status = status;
  }

  if (currentFile !== undefined) {
    checkIn.currentFile = currentFile;
  }

  if (filesModified !== undefined) {
    checkIn.filesModified = filesModified;
  }

  await checkInRepo.save(checkIn);

  // Also update the task's lastHeartbeatAt for dashboard visibility
  try {
    await taskRepo.update(taskId, { lastHeartbeatAt: now });
  } catch (error) {
    // Don't fail the heartbeat if task update fails
    logger.debug("Failed to update task heartbeat", { taskId, error });
  }

  return { success: true };
}

/**
 * Get active workers for a repository
 *
 * Returns all workers currently checked in for a specific repo.
 * Filters out stale workers (no heartbeat for 5+ minutes).
 */
export async function getActiveWorkers(
  orgId: string,
  repo?: string
): Promise<{ workers: ActiveWorker[]; fileLocks: unknown[] }> {
  const checkInRepo = getCheckInRepo();
  const fileLockRepo = getFileLockRepo();

  // Build query for check-ins
  const queryBuilder = checkInRepo
    .createQueryBuilder("ci")
    .where("ci.org_id = :orgId", { orgId });

  if (repo) {
    queryBuilder.andWhere("ci.repo = :repo", { repo });
  }

  const checkIns = await queryBuilder.getMany();

  // Filter to non-stale workers
  const activeCheckIns = checkIns.filter((ci) => !ci.isStale(STALE_CHECKIN_THRESHOLD_MS));

  const workers: ActiveWorker[] = activeCheckIns.map((ci) => ({
    taskId: ci.taskId,
    workerId: ci.workerId,
    repo: ci.repo,
    branch: ci.branch,
    status: ci.status,
    currentFile: ci.currentFile,
    filesModified: ci.filesModified,
    startedAt: ci.startedAt,
    heartbeatAt: ci.heartbeatAt,
    metadata: ci.metadata,
  }));

  // SIMPLIFIED: File locks no longer returned - workers use separate branches for conflict avoidance
  // Return empty array for backward compatibility
  const fileLocks: unknown[] = [];

  return { workers, fileLocks };
}

/**
 * Acquire file locks
 *
 * Attempts to acquire exclusive locks on the specified files.
 * Returns the files that were successfully locked and any conflicts.
 */
// SIMPLIFIED: acquireFileLocks function removed - no longer needed
/**
 * Release file locks
 *
 * Releases locks on the specified files held by this task.
 */
// SIMPLIFIED: releaseFileLocks function removed - no longer needed
/**
 * Get file locks for a repository
 *
 * Returns all active (non-expired) file locks for a specific repo.
 */
// SIMPLIFIED: getFileLocks function removed - no longer needed
/**
 * Reserve a resource
 *
 * Attempts to reserve a shared resource (test DB, deploy slot, etc.).
 * If resourceId is not provided, generates one automatically.
 */
export async function reserveResource(
  taskId: string,
  resourceType: ResourceType,
  resourceId?: string,
  ttlSeconds: number = DEFAULT_RESOURCE_TTL_SECONDS
): Promise<ReserveResourceResult> {
  const resourceRepo = getResourceRepo();
  const taskRepo = getTaskRepo();

  // Get the task to determine org and worker ID
  const task = await taskRepo.findOne({ where: { id: taskId } });
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const orgId = task.orgId;
  const workerId = task.ecsTaskId || taskId;
  const actualResourceId = resourceId || `${resourceType}-${Date.now()}`;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const now = new Date();

  // Check for existing reservation (that hasn't expired)
  const existingReservation = await resourceRepo
    .createQueryBuilder("rr")
    .where("rr.org_id = :orgId", { orgId })
    .andWhere("rr.resource_type = :resourceType", { resourceType })
    .andWhere("rr.resource_id = :resourceId", { resourceId: actualResourceId })
    .andWhere("rr.expires_at > NOW()")
    .getOne();

  if (existingReservation) {
    if (existingReservation.taskId === taskId) {
      // We already hold this reservation - extend it
      existingReservation.expiresAt = expiresAt;
      await resourceRepo.save(existingReservation);

      return {
        success: true,
        resourceId: actualResourceId,
        expiresAt,
      };
    } else {
      // Another task holds this reservation
      return {
        success: false,
        resourceId: actualResourceId,
        expiresAt: existingReservation.expiresAt,
        conflict: {
          taskId: existingReservation.taskId,
          workerId: existingReservation.workerId,
          expiresAt: existingReservation.expiresAt,
        },
      };
    }
  }

  // No existing reservation - try to acquire it
  try {
    await resourceRepo
      .createQueryBuilder()
      .insert()
      .into(WorkerResourceReservation)
      .values({
        orgId,
        resourceType,
        resourceId: actualResourceId,
        taskId,
        workerId,
        acquiredAt: now,
        expiresAt,
      })
      .orIgnore()
      .execute();

    // Verify we got the reservation
    const verifyReservation = await resourceRepo
      .createQueryBuilder("rr")
      .where("rr.org_id = :orgId", { orgId })
      .andWhere("rr.resource_type = :resourceType", { resourceType })
      .andWhere("rr.resource_id = :resourceId", { resourceId: actualResourceId })
      .andWhere("rr.task_id = :taskId", { taskId })
      .getOne();

    if (verifyReservation) {
      logger.info("Resource reserved", {
        taskId,
        resourceType,
        resourceId: actualResourceId,
        expiresAt,
      });

      return {
        success: true,
        resourceId: actualResourceId,
        expiresAt,
      };
    }

    // Someone else got it first
    const otherReservation = await resourceRepo
      .createQueryBuilder("rr")
      .where("rr.org_id = :orgId", { orgId })
      .andWhere("rr.resource_type = :resourceType", { resourceType })
      .andWhere("rr.resource_id = :resourceId", { resourceId: actualResourceId })
      .getOne();

    return {
      success: false,
      resourceId: actualResourceId,
      expiresAt: otherReservation?.expiresAt || new Date(),
      conflict: otherReservation
        ? {
            taskId: otherReservation.taskId,
            workerId: otherReservation.workerId,
            expiresAt: otherReservation.expiresAt,
          }
        : undefined,
    };
  } catch (error) {
    logger.error("Error reserving resource", {
      taskId,
      resourceType,
      resourceId: actualResourceId,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

/**
 * Release a resource
 *
 * Releases a resource reservation held by this task.
 */
export async function releaseResource(
  taskId: string,
  resourceType: ResourceType,
  resourceId: string
): Promise<{ success: boolean }> {
  const resourceRepo = getResourceRepo();

  await resourceRepo
    .createQueryBuilder()
    .delete()
    .from(WorkerResourceReservation)
    .where("task_id = :taskId", { taskId })
    .andWhere("resource_type = :resourceType", { resourceType })
    .andWhere("resource_id = :resourceId", { resourceId })
    .execute();

  logger.info("Resource released", {
    taskId,
    resourceType,
    resourceId,
  });

  return { success: true };
}

/**
 * Clean up expired locks and stale check-ins
 *
 * Should be called periodically (e.g., every minute) to clean up:
 * - Expired file locks
 * - Expired resource reservations
 * - Stale worker check-ins (no heartbeat for 5+ minutes)
 */
export async function cleanupExpiredLocks(): Promise<{
  expiredLocks: number;
  expiredReservations: number;
  staleCheckIns: number;
}> {
  const checkInRepo = getCheckInRepo();
  const fileLockRepo = getFileLockRepo();
  const resourceRepo = getResourceRepo();

  // Delete expired file locks
  const lockResult = await fileLockRepo
    .createQueryBuilder()
    .delete()
    .from(WorkerFileLock)
    .where("expires_at < NOW()")
    .execute();

  // Delete expired resource reservations
  const resourceResult = await resourceRepo
    .createQueryBuilder()
    .delete()
    .from(WorkerResourceReservation)
    .where("expires_at < NOW()")
    .execute();

  // Delete stale check-ins (no heartbeat for 5+ minutes)
  const staleThreshold = new Date(Date.now() - STALE_CHECKIN_THRESHOLD_MS);
  const checkInResult = await checkInRepo
    .createQueryBuilder()
    .delete()
    .from(WorkerCheckIn)
    .where("heartbeat_at < :threshold", { threshold: staleThreshold })
    .execute();

  const result = {
    expiredLocks: lockResult.affected || 0,
    expiredReservations: resourceResult.affected || 0,
    staleCheckIns: checkInResult.affected || 0,
  };

  if (result.expiredLocks > 0 || result.expiredReservations > 0 || result.staleCheckIns > 0) {
    logger.info("Coordination cleanup completed", result);
  }

  return result;
}

// =============================================================================
// Git Manifest Functions
// =============================================================================
// The manifest system allows workers to declare intent to modify files before
// actually editing them. This prevents merge conflicts by:
// 1. Checking for existing file locks before a worker starts editing
// 2. Auto-acquiring locks for declared files if no conflicts exist
// 3. Tracking which files each worker intends to modify

// Default TTL for manifests (30 minutes - longer than file locks since manifests
// represent intent for the entire task duration)
const DEFAULT_MANIFEST_TTL_SECONDS = 30 * 60;

/**
 * Declare a manifest of files a worker intends to modify
 *
 * This is called BEFORE a worker starts editing files. It:
 * 1. Checks for conflicts with existing file locks
 * 2. If no conflicts, acquires locks for all declared files
 * 3. Returns any conflicts so the worker can decide how to proceed
 *
 * @param params - taskId, repo, branch, and list of files to modify
 * @returns Success status, any conflicts, and list of locks acquired
 */
// SIMPLIFIED: declareManifest function removed - no longer needed
/**
 * Get all active manifests for a repository
 *
 * Returns the list of workers that have declared intent to modify files
 * in the specified repository. Optionally filter by branch.
 *
 * @param orgId - Organization ID
 * @param repo - Repository (owner/name)
 * @param branch - Optional branch filter
 * @returns List of active manifests
 */
// SIMPLIFIED: getManifests function removed - no longer needed
/**
 * Clear a manifest when a task completes
 *
 * This releases all file locks held by the task and removes the manifest
 * metadata from the check-in. Called automatically on task completion
 * or can be called explicitly if a worker decides not to modify certain files.
 *
 * @param taskId - Task ID whose manifest should be cleared
 * @returns Success status and number of locks released
 */
// SIMPLIFIED: clearManifest function removed - no longer needed
// =============================================================================
// Stale Worker Cleanup
// =============================================================================

/**
 * Clean up stale coordination data
 *
 * This function finds workers that have not sent a heartbeat in 5+ minutes
 * and cleans up their check-ins, file locks, and resource reservations.
 * Should be called periodically by the orchestrator (e.g., every minute).
 *
 * @returns Cleanup statistics
 */
export async function cleanupStaleCoordination(): Promise<{
  staleCheckIns: number;
  releasedLocks: number;
  releasedReservations: number;
  taskIds: string[];
}> {
  const checkInRepo = getCheckInRepo();
  const fileLockRepo = getFileLockRepo();
  const resourceRepo = getResourceRepo();

  const staleThreshold = new Date(Date.now() - STALE_CHECKIN_THRESHOLD_MS);

  // Find stale check-ins first to get task IDs for targeted cleanup
  const staleCheckIns = await checkInRepo
    .createQueryBuilder("ci")
    .select(["ci.id", "ci.taskId", "ci.workerId", "ci.repo", "ci.heartbeatAt"])
    .where("ci.heartbeat_at < :threshold", { threshold: staleThreshold })
    .getMany();

  if (staleCheckIns.length === 0) {
    return {
      staleCheckIns: 0,
      releasedLocks: 0,
      releasedReservations: 0,
      taskIds: [],
    };
  }

  const staleTaskIds = staleCheckIns.map((ci) => ci.taskId);

  logger.info("Found stale worker check-ins", {
    count: staleCheckIns.length,
    taskIds: staleTaskIds,
    oldestHeartbeat: staleCheckIns[0]?.heartbeatAt,
  });

  // Release file locks held by stale workers
  const lockResult = await fileLockRepo
    .createQueryBuilder()
    .delete()
    .from(WorkerFileLock)
    .where("task_id IN (:...taskIds)", { taskIds: staleTaskIds })
    .execute();

  // Release resource reservations held by stale workers
  const resourceResult = await resourceRepo
    .createQueryBuilder()
    .delete()
    .from(WorkerResourceReservation)
    .where("task_id IN (:...taskIds)", { taskIds: staleTaskIds })
    .execute();

  // Remove stale check-ins
  const checkInResult = await checkInRepo
    .createQueryBuilder()
    .delete()
    .from(WorkerCheckIn)
    .where("heartbeat_at < :threshold", { threshold: staleThreshold })
    .execute();

  const result = {
    staleCheckIns: checkInResult.affected || 0,
    releasedLocks: lockResult.affected || 0,
    releasedReservations: resourceResult.affected || 0,
    taskIds: staleTaskIds,
  };

  logger.info("Cleaned up stale coordination data", result);

  return result;
}

/**
 * Get count of active workers per repository
 *
 * Returns a map of repository -> active worker count.
 * Used by orchestrator for per-repo concurrency limits.
 *
 * @param orgId - Organization ID
 * @returns Map of repo to active worker count
 */
export async function getActiveWorkerCountsByRepo(orgId: string): Promise<Map<string, number>> {
  const checkInRepo = getCheckInRepo();

  const staleThreshold = new Date(Date.now() - STALE_CHECKIN_THRESHOLD_MS);

  // Count active (non-stale) check-ins grouped by repo
  const results = await checkInRepo
    .createQueryBuilder("ci")
    .select("ci.repo", "repo")
    .addSelect("COUNT(*)", "count")
    .where("ci.org_id = :orgId", { orgId })
    .andWhere("ci.heartbeat_at >= :threshold", { threshold: staleThreshold })
    .groupBy("ci.repo")
    .getRawMany<{ repo: string; count: string }>();

  const countMap = new Map<string, number>();
  for (const row of results) {
    countMap.set(row.repo, parseInt(row.count, 10));
  }

  return countMap;
}
