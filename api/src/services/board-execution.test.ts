/**
 * Board Execution Engine Tests
 *
 * Unit tests for processUnblockedCards — the cascade-trigger logic that
 * runs unblocked cards as worker tasks when their dependencies are satisfied.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock modules before importing the service under test ──
// vi.mock factories are hoisted to file top, so they cannot reference
// variables declared in this file. Use vi.hoisted() for shared state.

const { mockCardFind, mockDepCreateQueryBuilder, mockRunCardAsWorkerTask } = vi.hoisted(() => ({
  mockCardFind: vi.fn(),
  mockDepCreateQueryBuilder: vi.fn(),
  mockRunCardAsWorkerTask: vi.fn(),
}));

vi.mock("../db/connection.js", () => ({
  AppDataSource: {
    getRepository: vi.fn(() => ({
      find: mockCardFind,
      createQueryBuilder: mockDepCreateQueryBuilder,
    })),
  },
}));

vi.mock("../routes/boards.js", () => ({
  runCardAsWorkerTask: (...args: unknown[]) => mockRunCardAsWorkerTask(...args),
}));

vi.mock("../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../models/KbCard.js", () => ({
  KbCard: class KbCard {},
}));

vi.mock("../models/KbCardDependency.js", () => ({
  KbCardDependency: class KbCardDependency {},
}));

vi.mock("../models/WorkerTask.js", () => ({
  WorkerTask: class WorkerTask {},
}));

import { processUnblockedCards } from "./board-execution.js";

// ── Helper factories ──

function makeCard(overrides: {
  id: string;
  title?: string;
  boardId?: string;
  position?: number;
  workerTask?: { status: string } | null;
}) {
  return {
    id: overrides.id,
    title: overrides.title || `Card ${overrides.id}`,
    boardId: overrides.boardId || "board-1",
    position: overrides.position ?? 0,
    workerTask: overrides.workerTask ?? null,
  };
}

function setupDepsQueryBuilder(deps: Array<{ cardId: string; dependsOnCardId: string }>) {
  const mockGetMany = vi.fn().mockResolvedValue(deps);
  const mockWhere = vi.fn().mockReturnValue({ getMany: mockGetMany });
  mockDepCreateQueryBuilder.mockReturnValue({ where: mockWhere });
}

// ============================================================================
// processUnblockedCards
// ============================================================================

describe("processUnblockedCards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunCardAsWorkerTask.mockResolvedValue(undefined);
  });

  it("returns zeros when board has no cards", async () => {
    mockCardFind.mockResolvedValue([]);

    const result = await processUnblockedCards("board-1", "org-1");

    expect(result).toEqual({ triggered: 0, stillBlocked: 0, alreadyComplete: 0 });
  });

  it("triggers cards with no dependencies", async () => {
    const cards = [
      makeCard({ id: "card-a", position: 0 }),
      makeCard({ id: "card-b", position: 1 }),
    ];
    mockCardFind.mockResolvedValue(cards);
    setupDepsQueryBuilder([]); // No dependencies

    const result = await processUnblockedCards("board-1", "org-1");

    expect(result.triggered).toBe(2);
    expect(result.stillBlocked).toBe(0);
    expect(result.alreadyComplete).toBe(0);
    expect(mockRunCardAsWorkerTask).toHaveBeenCalledTimes(2);
    expect(mockRunCardAsWorkerTask).toHaveBeenCalledWith("card-a", "org-1");
    expect(mockRunCardAsWorkerTask).toHaveBeenCalledWith("card-b", "org-1");
  });

  it("does NOT trigger cards with unmet dependencies", async () => {
    // card-a has no deps, card-b depends on card-a
    // card-a has no workerTask yet (not started) — so card-b is blocked
    const cards = [
      makeCard({ id: "card-a", position: 0 }),
      makeCard({ id: "card-b", position: 1 }),
    ];
    mockCardFind.mockResolvedValue(cards);
    setupDepsQueryBuilder([
      { cardId: "card-b", dependsOnCardId: "card-a" },
    ]);

    const result = await processUnblockedCards("board-1", "org-1");

    // card-a gets triggered (no deps), card-b is blocked (card-a not completed)
    expect(result.triggered).toBe(1);
    expect(result.stillBlocked).toBe(1);
    expect(mockRunCardAsWorkerTask).toHaveBeenCalledTimes(1);
    expect(mockRunCardAsWorkerTask).toHaveBeenCalledWith("card-a", "org-1");
  });

  it("triggers a card when all dependencies are completed", async () => {
    // card-a is completed, card-b depends on card-a
    const cards = [
      makeCard({ id: "card-a", position: 0, workerTask: { status: "completed" } }),
      makeCard({ id: "card-b", position: 1 }),
    ];
    mockCardFind.mockResolvedValue(cards);
    setupDepsQueryBuilder([
      { cardId: "card-b", dependsOnCardId: "card-a" },
    ]);

    const result = await processUnblockedCards("board-1", "org-1");

    // card-a already has a completed workerTask (alreadyComplete), card-b gets triggered
    expect(result.alreadyComplete).toBe(1);
    expect(result.triggered).toBe(1);
    expect(result.stillBlocked).toBe(0);
    expect(mockRunCardAsWorkerTask).toHaveBeenCalledTimes(1);
    expect(mockRunCardAsWorkerTask).toHaveBeenCalledWith("card-b", "org-1");
  });

  it("triggers a card when dependency has 'deployed' status", async () => {
    const cards = [
      makeCard({ id: "card-a", position: 0, workerTask: { status: "deployed" } }),
      makeCard({ id: "card-b", position: 1 }),
    ];
    mockCardFind.mockResolvedValue(cards);
    setupDepsQueryBuilder([
      { cardId: "card-b", dependsOnCardId: "card-a" },
    ]);

    const result = await processUnblockedCards("board-1", "org-1");

    expect(result.alreadyComplete).toBe(1);
    expect(result.triggered).toBe(1);
  });

  it("skips cards that already have a completed worker task", async () => {
    const cards = [
      makeCard({ id: "card-a", position: 0, workerTask: { status: "completed" } }),
    ];
    mockCardFind.mockResolvedValue(cards);
    setupDepsQueryBuilder([]);

    const result = await processUnblockedCards("board-1", "org-1");

    expect(result.alreadyComplete).toBe(1);
    expect(result.triggered).toBe(0);
    expect(result.stillBlocked).toBe(0);
    expect(mockRunCardAsWorkerTask).not.toHaveBeenCalled();
  });

  it("skips cards that have a running worker task", async () => {
    const cards = [
      makeCard({ id: "card-a", position: 0, workerTask: { status: "running" } }),
    ];
    mockCardFind.mockResolvedValue(cards);
    setupDepsQueryBuilder([]);

    const result = await processUnblockedCards("board-1", "org-1");

    // running is not a terminal status, so not counted as alreadyComplete
    expect(result.alreadyComplete).toBe(0);
    expect(result.triggered).toBe(0);
    expect(result.stillBlocked).toBe(0);
    expect(mockRunCardAsWorkerTask).not.toHaveBeenCalled();
  });

  it("skips cards that have a failed worker task", async () => {
    const cards = [
      makeCard({ id: "card-a", position: 0, workerTask: { status: "failed" } }),
    ];
    mockCardFind.mockResolvedValue(cards);
    setupDepsQueryBuilder([]);

    const result = await processUnblockedCards("board-1", "org-1");

    // failed is not terminal (not completed/deployed), so not alreadyComplete
    expect(result.alreadyComplete).toBe(0);
    expect(result.triggered).toBe(0);
    expect(mockRunCardAsWorkerTask).not.toHaveBeenCalled();
  });

  it("does NOT trigger card when dependency is running (not yet complete)", async () => {
    const cards = [
      makeCard({ id: "card-a", position: 0, workerTask: { status: "running" } }),
      makeCard({ id: "card-b", position: 1 }),
    ];
    mockCardFind.mockResolvedValue(cards);
    setupDepsQueryBuilder([
      { cardId: "card-b", dependsOnCardId: "card-a" },
    ]);

    const result = await processUnblockedCards("board-1", "org-1");

    // card-a has non-terminal workerTask (skipped), card-b is blocked
    expect(result.triggered).toBe(0);
    expect(result.stillBlocked).toBe(1);
  });

  it("handles multiple dependencies — all must be met", async () => {
    // card-c depends on both card-a and card-b
    const cards = [
      makeCard({ id: "card-a", position: 0, workerTask: { status: "completed" } }),
      makeCard({ id: "card-b", position: 1, workerTask: { status: "running" } }),
      makeCard({ id: "card-c", position: 2 }),
    ];
    mockCardFind.mockResolvedValue(cards);
    setupDepsQueryBuilder([
      { cardId: "card-c", dependsOnCardId: "card-a" },
      { cardId: "card-c", dependsOnCardId: "card-b" },
    ]);

    const result = await processUnblockedCards("board-1", "org-1");

    // card-a completed, card-b running (skip), card-c blocked (card-b not done)
    expect(result.alreadyComplete).toBe(1);
    expect(result.triggered).toBe(0);
    expect(result.stillBlocked).toBe(1);
  });

  it("continues processing when runCardAsWorkerTask throws", async () => {
    const cards = [
      makeCard({ id: "card-a", position: 0 }),
      makeCard({ id: "card-b", position: 1 }),
    ];
    mockCardFind.mockResolvedValue(cards);
    setupDepsQueryBuilder([]);

    // First call throws, second succeeds
    mockRunCardAsWorkerTask
      .mockRejectedValueOnce(new Error("Spawn failed"))
      .mockResolvedValueOnce(undefined);

    const result = await processUnblockedCards("board-1", "org-1");

    // card-a trigger failed (not counted), card-b triggered
    expect(result.triggered).toBe(1);
    expect(mockRunCardAsWorkerTask).toHaveBeenCalledTimes(2);
  });
});
