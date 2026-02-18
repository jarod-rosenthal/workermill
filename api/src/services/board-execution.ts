import { AppDataSource } from "../db/connection.js";
import { KbCard } from "../models/KbCard.js";
import { KbCardDependency } from "../models/KbCardDependency.js";
import { logger } from "../utils/logger.js";

const TERMINAL_STATUSES = ["completed", "deployed"];

export async function processUnblockedCards(
  boardId: string,
  orgId: string,
): Promise<{ triggered: number; stillBlocked: number; alreadyComplete: number }> {
  const cardRepo = AppDataSource.getRepository(KbCard);
  const depRepo = AppDataSource.getRepository(KbCardDependency);

  // Load all cards for this board with their linked worker tasks
  const cards = await cardRepo.find({
    where: { boardId },
    relations: ["workerTask"],
    order: { position: "ASC" },
  });

  if (cards.length === 0) return { triggered: 0, stillBlocked: 0, alreadyComplete: 0 };

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

  // Dynamic import to avoid circular deps — boards.ts exports runCardAsWorkerTask
  const { runCardAsWorkerTask } = await import("../routes/boards.js");

  for (const card of cards) {
    // Skip cards that already have a worker task
    if (card.workerTask) {
      const status = card.workerTask.status;
      if (TERMINAL_STATUSES.includes(status)) {
        alreadyComplete++;
      }
      // Any existing task (running, failed, etc.) — skip
      continue;
    }

    // Check if all dependencies are satisfied
    const depCardIds = depsMap.get(card.id) || [];
    const allDepsMet = depCardIds.every((depId) => {
      const depCard = cardMap.get(depId);
      return depCard?.workerTask && TERMINAL_STATUSES.includes(depCard.workerTask.status);
    });

    if (!allDepsMet) {
      stillBlocked++;
      continue;
    }

    // Card is unblocked — trigger it
    try {
      await runCardAsWorkerTask(card.id, orgId);
      triggered++;
      logger.info("PRD cascade: triggered card", {
        boardId,
        cardId: card.id,
        cardTitle: card.title,
      });
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
