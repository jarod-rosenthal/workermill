import { AppDataSource } from "../db/connection.js";
import { KbCard } from "../models/KbCard.js";
import { KbCardDependency } from "../models/KbCardDependency.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { logger } from "../utils/logger.js";

// Statuses that count as "done" for dependency resolution — work is complete and validated
const DONE_STATUSES = ["completed", "deployed", "pr_approved", "review_approved"];

/**
 * Check if a task is truly done for cascade purposes.
 * Any task in a DONE_STATUS is considered complete — board card workers
 * auto-merge their PRs before reaching "completed", so a PR URL being
 * present does NOT mean the code hasn't landed on main.
 */
function isTaskDoneForCascade(task: WorkerTask): boolean {
  return DONE_STATUSES.includes(task.status);
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

  // Dynamic import to avoid circular deps — boards/index.ts re-exports runCardAsWorkerTask
  const { runCardAsWorkerTask } = await import("../routes/boards/index.js");

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

    // Cards with NO dependencies should only run when explicitly triggered
    // (via run-all or the /run endpoint). Without this check, the sweep
    // auto-triggers manually created cards on boards that have completed cards.
    if (depCardIds.length === 0 && !boardExecutionId) {
      stillBlocked++;
      continue;
    }

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
