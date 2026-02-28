import { AppDataSource } from "../db/connection.js";
import { KbCard } from "../models/KbCard.js";
import { KbCardDependency } from "../models/KbCardDependency.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { logger } from "../utils/logger.js";

// Statuses that count as "done" for dependency resolution — work is complete and validated
const DONE_STATUSES = ["completed", "deployed", "pr_approved", "review_approved"];

/**
 * Check if a task is truly done for cascade purposes.
 * "completed" with an unmerged PR is NOT done — the code never landed on main,
 * so dependent tasks would build on stale code.
 * "completed" without a PR (no-code/analysis tasks) IS done.
 */
function isTaskDoneForCascade(task: WorkerTask): boolean {
  if (!DONE_STATUSES.includes(task.status)) return false;
  if (task.status === "completed" && task.githubPrUrl) {
    logger.warn("Cascade blocked: task completed with unmerged PR", {
      taskId: task.id,
      prUrl: task.githubPrUrl,
    });
    return false;
  }
  return true;
}

/**
 * Safety-net sweep for stalled board cascades.
 * Finds boards where completed tasks exist but no next card was triggered,
 * and no active (running/queued) tasks remain. Calls processUnblockedCards
 * to kick the cascade back into motion.
 */
export async function sweepStalledBoards(): Promise<number> {
  const cardRepo = AppDataSource.getRepository(KbCard);

  try {
    // Find distinct boards that have:
    // 1. At least one card with a completed worker task (cascade should have continued)
    // 2. At least one card with NO worker task whose deps might be met
    // 3. NO currently active (non-terminal) worker tasks
    //
    // We use a raw query to efficiently filter across joins.
    const stalledBoards: { board_id: string; org_id: string }[] =
      await cardRepo.query(
        `
        SELECT DISTINCT b.id AS board_id, b.org_id
        FROM kb_boards b
        JOIN kb_cards c_done ON c_done.board_id = b.id
        JOIN worker_tasks wt_done ON wt_done.id = c_done.worker_task_id
          AND wt_done.status IN ('completed', 'deployed', 'pr_approved', 'review_approved')
        JOIN kb_cards c_pending ON c_pending.board_id = b.id
          AND c_pending.worker_task_id IS NULL
        WHERE b.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM kb_cards c_active
            JOIN worker_tasks wt_active ON wt_active.id = c_active.worker_task_id
            WHERE c_active.board_id = b.id
              AND wt_active.status NOT IN ('completed', 'deployed', 'pr_approved', 'review_approved', 'failed', 'cancelled')
          )
        LIMIT 10
        `,
      );

    let unstuckCount = 0;
    for (const row of stalledBoards) {
      logger.info("Board cascade safety net: triggered stalled board", {
        boardId: row.board_id,
      });
      const result = await processUnblockedCards(row.board_id, row.org_id);
      if (result.triggered > 0) {
        unstuckCount++;
      }
    }

    return unstuckCount;
  } catch (error) {
    logger.error("Error in sweepStalledBoards", {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

export async function processUnblockedCards(
  boardId: string,
  orgId: string,
  boardExecutionId?: string,
): Promise<{ triggered: number; stillBlocked: number; alreadyComplete: number }> {
  const cardRepo = AppDataSource.getRepository(KbCard);
  const depRepo = AppDataSource.getRepository(KbCardDependency);

  // Load all cards for this board with their linked worker tasks
  const cards = await cardRepo.find({
    where: { boardId },
    relations: ["workerTask"],
    order: { position: "ASC" },
  });

  if (cards.length === 0) {
    logger.debug("processUnblockedCards: no cards on board", { boardId });
    return { triggered: 0, stillBlocked: 0, alreadyComplete: 0 };
  }

  logger.debug("processUnblockedCards: evaluating cards", {
    boardId,
    totalCards: cards.length,
    cardsWithTask: cards.filter((c) => c.workerTask).length,
    cardsWithoutTask: cards.filter((c) => !c.workerTask).length,
  });

  // Load all dependencies for cards on this board
  const allDeps = await depRepo
    .createQueryBuilder("dep")
    .where("dep.card_id IN (:...cardIds)", {
      cardIds: cards.map((c) => c.id),
    })
    .getMany();

  // Build a map: cardId -> [dependsOnCardIds]
  const depsMap = new Map<string, string[]>();
  for (const dep of allDeps) {
    const list = depsMap.get(dep.cardId) || [];
    list.push(dep.dependsOnCardId);
    depsMap.set(dep.cardId, list);
  }

  // Build a map: cardId -> card (for status lookups)
  const cardMap = new Map(cards.map((c) => [c.id, c]));

  let triggered = 0;
  let stillBlocked = 0;
  let alreadyComplete = 0;

  // Serial execution: only one card runs at a time per board.
  // Each epic spawns multiple expert workers — running 2+ epics in parallel
  // would starve the user's machine of resources.
  const hasActiveCard = cards.some(
    (c) =>
      c.workerTask &&
      !isTaskDoneForCascade(c.workerTask) &&
      c.workerTask.status !== "failed" &&
      c.workerTask.status !== "cancelled",
  );

  if (hasActiveCard) {
    const activeCards = cards.filter(
      (c) =>
        c.workerTask &&
        !isTaskDoneForCascade(c.workerTask) &&
        c.workerTask.status !== "failed" &&
        c.workerTask.status !== "cancelled",
    );
    logger.debug("processUnblockedCards: board already has active card, waiting", {
      boardId,
      activeCards: activeCards.map((c) => ({
        cardId: c.id,
        title: c.title,
        status: c.workerTask?.status,
      })),
    });
    return { triggered: 0, stillBlocked: cards.length, alreadyComplete };
  }

  // Dynamic import to avoid circular deps — boards.ts exports runCardAsWorkerTask
  const { runCardAsWorkerTask } = await import("../routes/boards.js");

  for (const card of cards) {
    // Skip cards that already have a worker task
    if (card.workerTask) {
      if (isTaskDoneForCascade(card.workerTask)) {
        alreadyComplete++;
      }
      // Any existing task (running, failed, etc.) — skip
      continue;
    }

    // Check if all dependencies are satisfied
    const depCardIds = depsMap.get(card.id) || [];
    const allDepsMet = depCardIds.every((depId) => {
      const depCard = cardMap.get(depId);
      return depCard?.workerTask && isTaskDoneForCascade(depCard.workerTask);
    });

    if (!allDepsMet) {
      const unmetDeps = depCardIds.filter((depId) => {
        const depCard = cardMap.get(depId);
        return !depCard?.workerTask || !isTaskDoneForCascade(depCard.workerTask);
      });
      logger.debug("processUnblockedCards: card still blocked", {
        cardId: card.id,
        cardTitle: card.title,
        unmetDeps: unmetDeps.map((depId) => ({
          depCardId: depId,
          depCardTitle: cardMap.get(depId)?.title,
          taskStatus: cardMap.get(depId)?.workerTask?.status ?? "no task",
        })),
      });
      stillBlocked++;
      continue;
    }

    // Card is unblocked — trigger it (only one at a time for serial execution)
    try {
      await runCardAsWorkerTask(card.id, orgId, boardExecutionId);
      triggered++;
      logger.info("PRD cascade: triggered card", {
        boardId,
        cardId: card.id,
        cardTitle: card.title,
      });
      // Serial: stop after triggering one card — the cascade will
      // trigger the next one when this card completes.
      break;
    } catch (err) {
      logger.error("PRD cascade: failed to trigger card", {
        boardId,
        cardId: card.id,
        error: String(err),
      });
    }
  }

  return { triggered, stillBlocked, alreadyComplete };
}
