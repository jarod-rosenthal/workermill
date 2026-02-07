/**
 * Task Spawner — Strategy Pattern for Worker Execution
 *
 * Provides a unified interface for spawning workers, abstracting over:
 * - LocalDockerSpawner: Docker containers for local dev (wraps LocalEpicSpawner)
 * - ECSSpawner: AWS ECS Fargate tasks for cloud production (wraps ECSTaskRunner)
 *
 * The factory auto-detects which spawner to use based on EXECUTION_MODE.
 */

import { WorkerTask } from "../models/WorkerTask.js";
import { localEpicSpawner } from "./local-epic-spawner.js";
import { logger } from "../utils/logger.js";

// ============================================================================
// TYPES
// ============================================================================

export interface SpawnResult {
  /** Unique identifier for the spawned task (container name or ECS task ARN) */
  taskIdentifier: string;
  /** Whether the spawn was successful */
  success: boolean;
}

export type SpawnStatus = "running" | "completed" | "failed" | "unknown";

/**
 * Unified interface for spawning worker tasks.
 */
export interface TaskSpawner {
  /** Spawn a worker for the given task. */
  spawn(task: WorkerTask): Promise<SpawnResult>;
  /** Stop a running worker. */
  stop(taskId: string): Promise<boolean>;
  /** Get the status of a running worker. */
  getStatus(taskId: string): SpawnStatus | undefined;
  /** Get the count of active workers. */
  getActiveCount(): number;
  /** Whether this spawner supports external monitoring (ECS: true, Docker: false). */
  supportsExternalMonitoring(): boolean;
  /** Whether this spawner is for local execution. */
  isLocal(): boolean;
}

// ============================================================================
// LOCAL DOCKER SPAWNER (wraps LocalEpicSpawner)
// ============================================================================

class LocalDockerSpawner implements TaskSpawner {
  async spawn(task: WorkerTask): Promise<SpawnResult> {
    await localEpicSpawner.spawnEpicCoordinator(task);
    const status = localEpicSpawner.getTaskStatus(task.id);
    return {
      taskIdentifier: status?.containerName || `workermill-${task.id.slice(0, 8)}`,
      success: true,
    };
  }

  async stop(taskId: string): Promise<boolean> {
    return localEpicSpawner.stopTask(taskId);
  }

  getStatus(taskId: string): SpawnStatus | undefined {
    const process = localEpicSpawner.getTaskStatus(taskId);
    return process?.status;
  }

  getActiveCount(): number {
    return localEpicSpawner.getActiveCount();
  }

  supportsExternalMonitoring(): boolean {
    return false; // Local Docker containers don't have ECS monitoring
  }

  isLocal(): boolean {
    return true;
  }
}

// ============================================================================
// ECS SPAWNER (wraps ECSTaskRunner — deferred to orchestrator's existing code)
// ============================================================================

/**
 * ECS spawner is a marker class — the actual ECS spawning logic remains in
 * the orchestrator's spawnWorker() function because it involves complex
 * credential resolution, provider routing, and environment variable setup
 * that's tightly coupled to the orchestrator state.
 *
 * This class provides the interface methods for status checks and
 * monitoring decisions.
 */
class ECSSpawner implements TaskSpawner {
  async spawn(_task: WorkerTask): Promise<SpawnResult> {
    // ECS spawning is handled by the orchestrator's spawnWorker() directly
    // because it requires credential resolution, provider routing, etc.
    throw new Error(
      "ECS spawning should be done through the orchestrator's spawnWorker() function. " +
      "Use spawner.isLocal() to check before calling spawn()."
    );
  }

  async stop(_taskId: string): Promise<boolean> {
    // ECS task stopping is handled via StopTaskCommand in the orchestrator
    return false;
  }

  getStatus(_taskId: string): SpawnStatus | undefined {
    // ECS task status is checked via DescribeTasksCommand in monitorExecutingTasks()
    return undefined;
  }

  getActiveCount(): number {
    // ECS active count is tracked by the orchestrator state
    return 0;
  }

  supportsExternalMonitoring(): boolean {
    return true; // ECS tasks have CloudWatch monitoring
  }

  isLocal(): boolean {
    return false;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

let _spawner: TaskSpawner | null = null;

/**
 * Get the task spawner for the current execution mode.
 * Returns a singleton instance.
 */
export function getTaskSpawner(): TaskSpawner {
  if (!_spawner) {
    const isLocal = process.env.EXECUTION_MODE === "local";
    _spawner = isLocal ? new LocalDockerSpawner() : new ECSSpawner();
    logger.info("Task spawner initialized", {
      type: isLocal ? "LocalDockerSpawner" : "ECSSpawner",
      executionMode: process.env.EXECUTION_MODE,
    });
  }
  return _spawner;
}

/**
 * Check if we should skip ECS-specific operations (monitoring, orphan detection, etc.)
 * Convenience function that replaces `localEpicSpawner.isLocalMode()` guards.
 */
export function skipExternalMonitoring(): boolean {
  return getTaskSpawner().isLocal();
}
