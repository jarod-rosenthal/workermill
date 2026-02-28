/**
 * WorkerMill Orchestrator Service
 *
 * Background service that polls for queued tasks and spawns ECS workers.
 * Runs in the API process and can be started/stopped via API endpoints.
 *
 * Shared utilities (logTaskEvent, state, AWS clients, constants) are in orchestrator-utils.ts.
 */

import { logger } from "../utils/logger.js";
import { cleanupStaleCoordination } from "./coordination.js";
import { checkTrialReminders } from "./trial-reminder.js";
// ensureValidOAuthToken removed — refresh moved to local-epic-spawner.ts pre-spawn
import { findV2PipelineTasks, runSequentialPipeline } from "./pipeline-executor.js";
import { maintainAllWarmPools } from "./warm-pool.js";
import { cleanupLoop, failHungTasks, failOrphanedTasks, boardCascadeSweep } from "./task-cleanup.js";
import { findQueuedTasks, claimTask } from "./task-claimer.js";
import { findPlanningTasks, processPlanningTask } from "./planning-workflow.js";
import {
  findTasksNeedingManagerReview,
  findTasksNeedingLogAnalysis,
  findApprovedTasksNeedingDeployment,
  requeueForDeployment,
  spawnManagerReview,
  spawnManagerLogAnalysis,
  monitorManagerTasks,
} from "./manager-workflow.js";
import { dispatchMultiStoryPlan } from "./task-dispatch.js";
import { monitorExecutingTasks, checkParentTaskCompletion } from "./task-monitor.js";
import { spawnWorker } from "./worker-spawner.js";
import { executeMarketingAgentMission } from "./marketing-agent-executor.js";
import { Organization } from "../models/index.js";
import {
  logTaskEvent,
  state,
  trackOperation,
  type OrchestratorState,
} from "./orchestrator-utils.js";
import { redis } from "./redis-client.js";

// Redis-based distributed locks for cron jobs (safe with multiple orchestrator instances)
// setnx returns true if this instance "won" the lock — only one instance runs the job per interval.

/**
 * Main polling loop
 */
async function pollLoop(): Promise<void> {
  while (state.running) {
    try {
      state.lastPollAt = new Date();

      // Write heartbeat to Redis — API instances read this to report status
      redis.set("orchestrator:heartbeat", new Date().toISOString(), 30).catch(() => {});

      // Process queued tasks (spawn workers)
      const tasks = await findQueuedTasks();

      for (const task of tasks) {
        if (!state.running) break;

        // Note: Quota is already checked in findQueuedTasks() which filters out
        // orgs that exceed their quota. Tasks from blocked orgs won't reach here.
        // The task stays queued until quota resets at billing cycle.

        // Try to claim the task
        if (await claimTask(task.id)) {
          logger.info("Task claimed", {
            taskId: task.id,
            jiraIssueKey: task.jiraIssueKey,
          });

          // Note: Task usage is incremented in spawnWorker() after successful ECS spawn
          // to avoid counting failed spawn attempts against quota

          // Log task claimed event for real-time streaming
          await logTaskEvent(
            task.id,
            "status_change",
            "Task claimed by orchestrator",
          );

          // Check if this is a V2 pipeline task with execution plan - route to sequential pipeline
          if (task.isV2Pipeline() && task.executionPlanV2) {
            logger.info("V2 pipeline task claimed, routing to sequential pipeline", {
              taskId: task.id,
              jiraIssueKey: task.jiraIssueKey,
              stepCount: task.executionPlanV2.steps?.length || 0,
            });
            const pipelineOp = runSequentialPipeline(task.id).catch((error) => {
              logger.error("Error in V2 runSequentialPipeline", {
                taskId: task.id,
                error: error instanceof Error ? error.message : String(error),
              });
            });
            trackOperation(pipelineOp);
            continue;
          }

          // Check if this is a multi-story PRD plan that needs to be dispatched
          const wasDispatched = await dispatchMultiStoryPlan(task);

          if (wasDispatched) {
            // Multi-story plan was dispatched - child tasks are now queued
            // They will be picked up in subsequent poll loops
            logger.info("Multi-story plan dispatched, child tasks queued", {
              taskId: task.id,
              jiraIssueKey: task.jiraIssueKey,
            });
          } else {
            // Single-story or regular task - spawn worker directly
            await logTaskEvent(
              task.id,
              "status_change",
              `Assigned to worker ${task.id.substring(0, 8)}`,
            );

            // Spawn worker directly (no staggering needed with separate story branches)
            const spawnOp = spawnWorker(task).catch((error) => {
              logger.error("Error in spawnWorker", {
                taskId: task.id,
                error: error instanceof Error ? error.message : String(error),
              });
            });
            trackOperation(spawnOp);
          }
        }
      }

      // Process PRD tasks needing planning analysis (prd label workflow)
      const planningTasks = await findPlanningTasks();
      for (const task of planningTasks) {
        if (!state.running) break;

        // Process planning task (don't await - let it run in parallel)
        const planOp = processPlanningTask(task).catch((error) => {
          logger.error("Error in processPlanningTask", {
            taskId: task.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        trackOperation(planOp);
      }

      // Process V2 Pipeline tasks ready for sequential execution
      const v2PipelineTasks = await findV2PipelineTasks();
      for (const task of v2PipelineTasks) {
        if (!state.running) break;

        logger.info("Starting V2 sequential pipeline execution", {
          taskId: task.id,
          jiraIssueKey: task.jiraIssueKey,
          stepCount: task.executionPlanV2?.steps?.length || 0,
          currentStepIndex: task.currentStepIndex,
        });

        // Run V2 sequential pipeline (don't await - let it run async)
        const v2Op = runSequentialPipeline(task.id).catch((error) => {
          logger.error("Error in V2 runSequentialPipeline", {
            taskId: task.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        trackOperation(v2Op);
      }

      // Process tasks needing manager review (review workflow)
      const reviewTasks = await findTasksNeedingManagerReview();
      for (const task of reviewTasks) {
        if (!state.running) break;

        // Spawn manager (don't await - let it run in parallel)
        const reviewOp = spawnManagerReview(task).catch((error) => {
          logger.error("Error in spawnManagerReview", {
            taskId: task.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        trackOperation(reviewOp);
      }

      // Process tasks needing log analysis (manager "training wheels" workflow)
      const analysisTasks = await findTasksNeedingLogAnalysis();
      for (const task of analysisTasks) {
        if (!state.running) break;

        // Spawn manager log analysis (don't await - let it run in parallel)
        const analysisOp = spawnManagerLogAnalysis(task).catch((error) => {
          logger.error("Error in spawnManagerLogAnalysis", {
            taskId: task.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        trackOperation(analysisOp);
      }

      // Check for approved tasks that need deployment (deploy label added after approval)
      const deploymentTasks = await findApprovedTasksNeedingDeployment();
      for (const task of deploymentTasks) {
        if (!state.running) break;

        // Re-queue for deployment
        const deployOp = requeueForDeployment(task).catch((error) => {
          logger.error("Error in requeueForDeployment", {
            taskId: task.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        trackOperation(deployOp);
      }

      // Monitor executing tasks - detect completion via ECS status
      // This is the PRIMARY completion mechanism (worker callbacks are backup)
      await monitorExecutingTasks().catch((error) => {
        logger.error("Error in monitorExecutingTasks", {
          error: error instanceof Error ? error.message : String(error),
        });
      });

      // Monitor manager tasks - detect manager completion via ECS status and log markers
      await monitorManagerTasks().catch((error) => {
        logger.error("Error in monitorManagerTasks", {
          error: error instanceof Error ? error.message : String(error),
        });
      });

      // Check for parent tasks with all children complete (PRD orchestration summary)
      await checkParentTaskCompletion().catch((error) => {
        logger.error("Error in checkParentTaskCompletion", {
          error: error instanceof Error ? error.message : String(error),
        });
      });

      // Clean up stale coordination data (Phase 8: Watcher/Cleanup)
      // Run every ~1 minute (12 polls * 5 seconds = 60 seconds)
      // Distributed lock: only one orchestrator runs cleanup per interval
      if (state.tasksProcessed % 12 === 0 || state.tasksProcessed === 0) {
        const wonCleanup = await redis.setnx("orchestrator:lock:stale-coordination", "1", 55);
        if (wonCleanup) {
          await cleanupStaleCoordination().catch((error) => {
            logger.error("Error in cleanupStaleCoordination", {
              error: error instanceof Error ? error.message : String(error),
            });
          });

          // Fail tasks with stale heartbeats (hung workers) or no heartbeat at all
          await failHungTasks().catch((error) => {
            logger.error("Error in failHungTasks", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }

      // Board cascade safety net — catch stalled PRD board cascades
      // Run every ~1 minute — distributed lock prevents duplicate runs
      if (state.tasksProcessed % 12 === 0 || state.tasksProcessed === 0) {
        const wonCascade = await redis.setnx("orchestrator:lock:board-cascade-sweep", "1", 55);
        if (wonCascade) {
          await boardCascadeSweep().catch((error) => {
            logger.error("Error in boardCascadeSweep", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }

      // Fail orphaned tasks (ECS task missing or stuck without check-in)
      // Run every ~5 minutes — distributed lock prevents duplicate runs
      if (state.tasksProcessed % 60 === 0 || state.tasksProcessed === 0) {
        const wonOrphan = await redis.setnx("orchestrator:lock:orphaned-tasks", "1", 280);
        if (wonOrphan) {
          await failOrphanedTasks().catch((error) => {
            logger.error("Error in failOrphanedTasks", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }

      // NOTE: OAuth token refresh was REMOVED from the orchestrator poll loop.
      // Refreshing here races with running containers — OAuth refresh tokens are single-use,
      // so consuming one here invalidates the copy cached by any running Claude CLI process.
      // Token refresh now happens at spawn time in local-epic-spawner.ts (pre-spawn refresh),
      // ensuring each container starts with a fresh 8-hour access token that never expires mid-run.

      // Maintain warm container pools
      // Run every ~30 seconds — distributed lock prevents duplicate runs
      if (state.tasksProcessed % 6 === 0) {
        const wonWarmPool = await redis.setnx("orchestrator:lock:warm-pools", "1", 25);
        if (wonWarmPool) {
          await maintainAllWarmPools().catch((error) => {
            logger.error("Error in maintainAllWarmPools", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }

      // Check trial reminders — once per hour (distributed lock via Redis)
      if (state.tasksProcessed % 720 === 0) {
        const won = await redis.setnx("orchestrator:lock:trial-reminders", "1", 3600);
        if (won) {
          checkTrialReminders().catch((err) =>
            logger.error("Trial reminder check failed", {
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }

      // Marketing agent — configurable interval (distributed lock via Redis)
      try {
        const platformOrg = await Organization.getPlatformOrg();
        if (platformOrg?.marketingAgentEnabled) {
          const intervalMinutes = platformOrg.marketingAgentIntervalMinutes || 120;
          const won = await redis.setnx(
            "orchestrator:lock:marketing-agent",
            "1",
            intervalMinutes * 60,
          );
          if (won) {
            const config = platformOrg.marketingAgentConfig as Record<string, unknown>;
            const timeWindow = (config.missionTimeWindow as string) || "06:00-22:00";
            const [startStr, endStr] = timeWindow.split("-");
            const startHour = parseInt(startStr.split(":")[0], 10);
            const endHour = parseInt(endStr.split(":")[0], 10);
            const currentHour = new Date().getUTCHours();

            if (currentHour >= startHour && currentHour < endHour) {
              executeMarketingAgentMission(platformOrg).catch((err) =>
                logger.error("Marketing agent mission failed", {
                  error: err instanceof Error ? err.message : String(err),
                }),
              );
            }
          }
        }
      } catch (err) {
        logger.error("Marketing agent cron check failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      state.tasksProcessed++;

      // Sleep between polls
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (error) {
      logger.error("Error in orchestrator poll loop", {
        error: error instanceof Error ? error.message : String(error),
      });
      state.errors++;

      // Back off on errors
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
}

/**
 * Start the orchestrator
 */
export function startOrchestrator(): void {
  if (state.running) {
    logger.warn("Orchestrator already running");
    return;
  }

  logger.info("Starting orchestrator");
  state.running = true;
  state.tasksProcessed = 0;
  state.errors = 0;

  // Start polling loop (don't await)
  pollLoop().catch((error) => {
    logger.error("Orchestrator poll loop crashed", {
      error: error instanceof Error ? error.message : String(error),
    });
    state.running = false;
  });

  // Start cleanup loop (runs hourly, don't await)
  cleanupLoop().catch((error) => {
    logger.error("Cleanup loop crashed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * Stop the orchestrator
 */
export function stopOrchestrator(): void {
  if (!state.running) {
    logger.warn("Orchestrator not running");
    return;
  }

  logger.info("Stopping orchestrator");
  state.running = false;
}

/**
 * Get orchestrator status
 */
export function getOrchestratorStatus(): OrchestratorState {
  return { ...state };
}

/**
 * Check if orchestrator is running
 */
export function isOrchestratorRunning(): boolean {
  return state.running;
}
