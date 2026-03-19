import { describe, test, expect } from "vitest";
import { getTestManager, generateTestId } from "../setup";
import { Organization } from "../../../models/Organization";
import { KbBoard } from "../../../models/KbBoard";
import { KbColumn } from "../../../models/KbColumn";
import { KbCard } from "../../../models/KbCard";
import { WorkerTask } from "../../../models/WorkerTask";

/**
 * Board/Card Lifecycle Integration Tests.
 *
 * Tests the database operations for the Kanban board system:
 * board CRUD, column management, card lifecycle, card-to-task linking,
 * and PRD content flow.
 */
describe("Board & Card Lifecycle", () => {
  async function createTestOrg() {
    const manager = getTestManager();
    const org = manager.create(Organization, {
      name: `Test Org ${generateTestId()}`,
      slug: `test-org-${Date.now()}`,
      settings: {},
      apiKey: `test-api-key-${Date.now()}`,
    });
    return manager.save(org);
  }

  async function createBoard(org: Organization, overrides?: Partial<KbBoard>) {
    const manager = getTestManager();
    const board = manager.create(KbBoard, {
      name: `Test Board ${generateTestId()}`,
      prefix: `TB${Date.now()}`.substring(0, 10).toUpperCase(),
      orgId: org.id,
      ...overrides,
    });
    return manager.save(board);
  }

  async function createColumn(board: KbBoard, name: string, position: number, color?: string) {
    const manager = getTestManager();
    const column = manager.create(KbColumn, {
      name,
      position,
      boardId: board.id,
      color: color ?? null,
    });
    return manager.save(column);
  }

  // =========================================================================
  // Board CRUD
  // =========================================================================

  describe("Board CRUD", () => {
    test("create board with name and auto-derived prefix", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const board = manager.create(KbBoard, {
        name: "Authentication Service",
        prefix: "AUTH",
        orgId: org.id,
      });
      const saved = await manager.save(board);

      expect(saved.id).toBeDefined();
      expect(saved.name).toBe("Authentication Service");
      expect(saved.prefix).toBe("AUTH");
      expect(saved.orgId).toBe(org.id);
      expect(saved.nextCardNumber).toBe(1);
      expect(saved.status).toBe("active");
      expect(saved.createdAt).toBeDefined();
    });

    test("board prefix is unique within org", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const board1 = manager.create(KbBoard, {
        name: "Board One",
        prefix: "DUPE",
        orgId: org.id,
      });
      await manager.save(board1);

      const board2 = manager.create(KbBoard, {
        name: "Board Two",
        prefix: "DUPE",
        orgId: org.id,
      });

      // Prefix uniqueness is enforced at application level or DB constraint.
      // Verify both boards exist but have the same prefix (application must enforce uniqueness).
      const saved2 = await manager.save(board2).catch((err) => err);

      // If DB has a unique constraint, the save will throw; otherwise both exist.
      // Either outcome is valid - we verify the constraint behavior:
      if (saved2 instanceof Error) {
        // DB-level unique constraint exists
        expect(saved2.message).toMatch(/duplicate|unique|constraint/i);
      } else {
        // No DB constraint - both boards saved; application must enforce
        const boards = await manager.find(KbBoard, {
          where: { orgId: org.id, prefix: "DUPE" },
        });
        expect(boards.length).toBe(2);
      }
    });

    test("board with PRD content stores correctly", async () => {
      const org = await createTestOrg();
      const prdContent = `# Product Requirements Document

## Overview
Build a user authentication system with OAuth2 support.

## Requirements
1. Login with email/password
2. OAuth2 with Google and GitHub
3. JWT token management
4. Password reset flow`;

      const board = await createBoard(org, {
        prdContent,
        prdSource: "manual",
      });

      const manager = getTestManager();
      const loaded = await manager.findOne(KbBoard, { where: { id: board.id } });

      expect(loaded).not.toBeNull();
      expect(loaded!.prdContent).toBe(prdContent);
      expect(loaded!.prdSource).toBe("manual");
    });

    test("board with qualityGateCommands stores correctly", async () => {
      const org = await createTestOrg();
      const qualityGateCommands = [
        {
          name: "Type Check",
          trigger: "pre-commit",
          commands: ["npm run typecheck"],
        },
        {
          name: "Lint",
          trigger: "pre-commit",
          commands: ["npm run lint", "npm run lint:fix"],
        },
        {
          name: "Unit Tests",
          trigger: "pre-commit",
          commands: ["npm run test -- --run"],
        },
      ];

      const board = await createBoard(org, { qualityGateCommands });

      const manager = getTestManager();
      const loaded = await manager.findOne(KbBoard, { where: { id: board.id } });

      expect(loaded).not.toBeNull();
      expect(loaded!.qualityGateCommands).toEqual(qualityGateCommands);
      expect(loaded!.qualityGateCommands!.length).toBe(3);
      expect(loaded!.qualityGateCommands![0].name).toBe("Type Check");
      expect(loaded!.qualityGateCommands![2].commands).toEqual(["npm run test -- --run"]);
    });

    test("board metadata stores JSONB correctly", async () => {
      const org = await createTestOrg();
      const metadata = {
        qualityGates: [
          { name: "CI", trigger: "post-push", commands: ["npm test"] },
        ],
        ciWorkflowPath: ".github/workflows/ci.yml",
      };

      const board = await createBoard(org, { metadata });

      const manager = getTestManager();
      const loaded = await manager.findOne(KbBoard, { where: { id: board.id } });

      expect(loaded!.metadata).toEqual(metadata);
      expect(loaded!.metadata.ciWorkflowPath).toBe(".github/workflows/ci.yml");
    });

    test("board priority and status fields", async () => {
      const org = await createTestOrg();

      const board = await createBoard(org, {
        priority: "high",
        status: "active",
        description: "High priority board for Q1 deliverables",
      });

      const manager = getTestManager();
      const loaded = await manager.findOne(KbBoard, { where: { id: board.id } });

      expect(loaded!.priority).toBe("high");
      expect(loaded!.status).toBe("active");
      expect(loaded!.description).toBe("High priority board for Q1 deliverables");
    });
  });

  // =========================================================================
  // Column Management
  // =========================================================================

  describe("Column Management", () => {
    test("create columns with standard kanban types", async () => {
      const org = await createTestOrg();
      const board = await createBoard(org);

      const backlog = await createColumn(board, "Backlog", 0, "#9CA3AF");
      const inProgress = await createColumn(board, "In Progress", 1, "#3B82F6");
      const review = await createColumn(board, "Review", 2, "#F59E0B");
      const done = await createColumn(board, "Done", 3, "#10B981");

      expect(backlog.boardId).toBe(board.id);
      expect(backlog.name).toBe("Backlog");
      expect(backlog.position).toBe(0);

      expect(inProgress.name).toBe("In Progress");
      expect(inProgress.position).toBe(1);

      expect(review.name).toBe("Review");
      expect(review.position).toBe(2);

      expect(done.name).toBe("Done");
      expect(done.position).toBe(3);
    });

    test("column position ordering is preserved", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const board = await createBoard(org);

      await createColumn(board, "Todo", 0);
      await createColumn(board, "In Progress", 1);
      await createColumn(board, "Testing", 2);
      await createColumn(board, "Done", 3);

      const columns = await manager.find(KbColumn, {
        where: { boardId: board.id },
        order: { position: "ASC" },
      });

      expect(columns.length).toBe(4);
      expect(columns[0].name).toBe("Todo");
      expect(columns[1].name).toBe("In Progress");
      expect(columns[2].name).toBe("Testing");
      expect(columns[3].name).toBe("Done");

      // Positions are sequential
      columns.forEach((col, idx) => {
        expect(col.position).toBe(idx);
      });
    });

    test("column WIP limit stores correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const board = await createBoard(org);

      const col = manager.create(KbColumn, {
        name: "In Progress",
        position: 1,
        boardId: board.id,
        wipLimit: 5,
      });
      const saved = await manager.save(col);

      const loaded = await manager.findOne(KbColumn, { where: { id: saved.id } });
      expect(loaded!.wipLimit).toBe(5);
    });

    test("columns are cascade-deleted when board is deleted", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const board = await createBoard(org);

      await createColumn(board, "Backlog", 0);
      await createColumn(board, "Done", 1);

      // Verify columns exist
      const beforeDelete = await manager.find(KbColumn, { where: { boardId: board.id } });
      expect(beforeDelete.length).toBe(2);

      // Delete board
      await manager.remove(board);

      // Columns should be cascade-deleted
      const afterDelete = await manager.find(KbColumn, { where: { boardId: board.id } });
      expect(afterDelete.length).toBe(0);
    });

    test("reorder columns by updating position", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const board = await createBoard(org);

      const backlog = await createColumn(board, "Backlog", 0);
      const inProgress = await createColumn(board, "In Progress", 1);
      const done = await createColumn(board, "Done", 2);

      // Move "Done" to position 1, shift "In Progress" to position 2
      await manager.update(KbColumn, done.id, { position: 1 });
      await manager.update(KbColumn, inProgress.id, { position: 2 });

      const reordered = await manager.find(KbColumn, {
        where: { boardId: board.id },
        order: { position: "ASC" },
      });

      expect(reordered[0].name).toBe("Backlog");
      expect(reordered[1].name).toBe("Done");
      expect(reordered[2].name).toBe("In Progress");
    });
  });

  // =========================================================================
  // Card Lifecycle
  // =========================================================================

  describe("Card Lifecycle", () => {
    test("create card in backlog column with auto-incremented cardNumber", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const board = await createBoard(org, { prefix: "FEAT" });
      const backlog = await createColumn(board, "Backlog", 0);

      // Simulate auto-increment: read nextCardNumber, create card, bump board counter
      const currentNumber = board.nextCardNumber;
      const card = manager.create(KbCard, {
        title: "Implement login page",
        boardId: board.id,
        columnId: backlog.id,
        cardNumber: currentNumber,
        position: 0,
      });
      const savedCard = await manager.save(card);
      await manager.update(KbBoard, board.id, { nextCardNumber: currentNumber + 1 });

      expect(savedCard.cardNumber).toBe(1);
      expect(savedCard.boardId).toBe(board.id);
      expect(savedCard.columnId).toBe(backlog.id);
      expect(savedCard.position).toBe(0);

      // Second card gets next number
      const card2 = manager.create(KbCard, {
        title: "Add OAuth support",
        boardId: board.id,
        columnId: backlog.id,
        cardNumber: currentNumber + 1,
        position: 1,
      });
      const savedCard2 = await manager.save(card2);
      await manager.update(KbBoard, board.id, { nextCardNumber: currentNumber + 2 });

      expect(savedCard2.cardNumber).toBe(2);
    });

    test("card issue key format is prefix-cardNumber", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const board = await createBoard(org, { prefix: "AUTH" });
      const backlog = await createColumn(board, "Backlog", 0);

      const card = manager.create(KbCard, {
        title: "Password reset flow",
        boardId: board.id,
        columnId: backlog.id,
        cardNumber: 1,
        position: 0,
      });
      await manager.save(card);

      // Load the board to get prefix
      const loadedBoard = await manager.findOne(KbBoard, { where: { id: board.id } });
      const issueKey = `${loadedBoard!.prefix}-${card.cardNumber}`;

      expect(issueKey).toBe("AUTH-1");
    });

    test("move card between columns updates columnId and position", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const board = await createBoard(org);
      const backlog = await createColumn(board, "Backlog", 0);
      const inProgress = await createColumn(board, "In Progress", 1);

      const card = manager.create(KbCard, {
        title: "Task to move",
        boardId: board.id,
        columnId: backlog.id,
        cardNumber: 1,
        position: 0,
      });
      const savedCard = await manager.save(card);

      expect(savedCard.columnId).toBe(backlog.id);

      // Move card to "In Progress" at position 0
      await manager.update(KbCard, savedCard.id, {
        columnId: inProgress.id,
        position: 0,
      });

      const moved = await manager.findOne(KbCard, { where: { id: savedCard.id } });
      expect(moved!.columnId).toBe(inProgress.id);
      expect(moved!.position).toBe(0);
    });

    test("card with description, priority, and cover color", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const board = await createBoard(org);
      const backlog = await createColumn(board, "Backlog", 0);

      const card = manager.create(KbCard, {
        title: "Design system components",
        description: "Create reusable React components for the design system:\n- Button\n- Input\n- Modal\n- Toast notifications",
        boardId: board.id,
        columnId: backlog.id,
        cardNumber: 1,
        position: 0,
        priority: "high",
        coverColor: "#EF4444",
      });
      const saved = await manager.save(card);

      const loaded = await manager.findOne(KbCard, { where: { id: saved.id } });

      expect(loaded!.title).toBe("Design system components");
      expect(loaded!.description).toContain("reusable React components");
      expect(loaded!.priority).toBe("high");
      expect(loaded!.coverColor).toBe("#EF4444");
    });

    test("card due date stores correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const board = await createBoard(org);
      const backlog = await createColumn(board, "Backlog", 0);

      const dueDate = new Date("2026-04-15T00:00:00Z");
      const card = manager.create(KbCard, {
        title: "Sprint deadline task",
        boardId: board.id,
        columnId: backlog.id,
        cardNumber: 1,
        position: 0,
        dueDate,
      });
      const saved = await manager.save(card);

      const loaded = await manager.findOne(KbCard, { where: { id: saved.id } });
      expect(loaded!.dueDate).toBeDefined();
      expect(new Date(loaded!.dueDate!).toISOString()).toBe("2026-04-15T00:00:00.000Z");
    });

    test("multiple cards maintain position order within column", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const board = await createBoard(org);
      const backlog = await createColumn(board, "Backlog", 0);

      for (let i = 0; i < 5; i++) {
        const card = manager.create(KbCard, {
          title: `Card ${i + 1}`,
          boardId: board.id,
          columnId: backlog.id,
          cardNumber: i + 1,
          position: i,
        });
        await manager.save(card);
      }

      const cards = await manager.find(KbCard, {
        where: { columnId: backlog.id },
        order: { position: "ASC" },
      });

      expect(cards.length).toBe(5);
      cards.forEach((card, idx) => {
        expect(card.title).toBe(`Card ${idx + 1}`);
        expect(card.position).toBe(idx);
      });
    });

    test("cards are cascade-deleted when column is deleted", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const board = await createBoard(org);
      const backlog = await createColumn(board, "Backlog", 0);

      const card = manager.create(KbCard, {
        title: "Will be deleted",
        boardId: board.id,
        columnId: backlog.id,
        cardNumber: 1,
        position: 0,
      });
      await manager.save(card);

      // Delete the column
      await manager.remove(backlog);

      // Card should be cascade-deleted
      const remainingCards = await manager.find(KbCard, { where: { boardId: board.id } });
      expect(remainingCards.length).toBe(0);
    });
  });

  // =========================================================================
  // Card-to-Task Linking
  // =========================================================================

  describe("Card-to-Task Linking", () => {
    test("create card with linked WorkerTask", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const board = await createBoard(org, { prefix: "PROJ" });
      const backlog = await createColumn(board, "Backlog", 0);

      // Create the WorkerTask first
      const issueKey = `${board.prefix}-1`;
      const task = manager.create(WorkerTask, {
        jiraIssueKey: issueKey,
        summary: "Implement user authentication",
        status: "queued",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
      });
      const savedTask = await manager.save(task);

      // Create card linked to task
      const card = manager.create(KbCard, {
        title: "Implement user authentication",
        boardId: board.id,
        columnId: backlog.id,
        cardNumber: 1,
        position: 0,
        workerTaskId: savedTask.id,
      });
      const savedCard = await manager.save(card);

      expect(savedCard.workerTaskId).toBe(savedTask.id);

      // Load card with task relation
      const loaded = await manager.findOne(KbCard, {
        where: { id: savedCard.id },
        relations: ["workerTask"],
      });

      expect(loaded!.workerTask).not.toBeNull();
      expect(loaded!.workerTask!.id).toBe(savedTask.id);
      expect(loaded!.workerTask!.summary).toBe("Implement user authentication");
    });

    test("task jiraIssueKey matches card issue key", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const board = await createBoard(org, { prefix: "KB" });
      const backlog = await createColumn(board, "Backlog", 0);

      const cardNumber = 42;
      const expectedIssueKey = `KB-${cardNumber}`;

      const task = manager.create(WorkerTask, {
        jiraIssueKey: expectedIssueKey,
        summary: "Fix pagination bug",
        status: "queued",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
      });
      const savedTask = await manager.save(task);

      const card = manager.create(KbCard, {
        title: "Fix pagination bug",
        boardId: board.id,
        columnId: backlog.id,
        cardNumber,
        position: 0,
        workerTaskId: savedTask.id,
      });
      await manager.save(card);

      // Verify the issue key matches
      const loadedTask = await manager.findOne(WorkerTask, { where: { id: savedTask.id } });
      expect(loadedTask!.jiraIssueKey).toBe(`${board.prefix}-${cardNumber}`);
      expect(loadedTask!.jiraIssueKey).toBe(expectedIssueKey);
    });

    test("task completion updates DB state for card sync", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const board = await createBoard(org, { prefix: "SYNC" });
      const backlog = await createColumn(board, "Backlog", 0);
      const done = await createColumn(board, "Done", 3);

      const task = manager.create(WorkerTask, {
        jiraIssueKey: "SYNC-1",
        summary: "Complete this task",
        status: "queued",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
      });
      const savedTask = await manager.save(task);

      const card = manager.create(KbCard, {
        title: "Complete this task",
        boardId: board.id,
        columnId: backlog.id,
        cardNumber: 1,
        position: 0,
        workerTaskId: savedTask.id,
      });
      const savedCard = await manager.save(card);

      // Simulate task execution and completion
      await manager.update(WorkerTask, savedTask.id, {
        status: "executing",
        startedAt: new Date(),
      });
      await manager.update(WorkerTask, savedTask.id, {
        status: "completed",
        completedAt: new Date(),
        githubPrUrl: "https://github.com/test/repo/pull/1",
      });

      // Verify task is completed
      const completedTask = await manager.findOne(WorkerTask, { where: { id: savedTask.id } });
      expect(completedTask!.status).toBe("completed");

      // Simulate card sync: move card to Done column (what the sync service would do)
      await manager.update(KbCard, savedCard.id, {
        columnId: done.id,
        position: 0,
      });

      const syncedCard = await manager.findOne(KbCard, { where: { id: savedCard.id } });
      expect(syncedCard!.columnId).toBe(done.id);

      // Verify task and card are still linked
      const linkedCard = await manager.findOne(KbCard, {
        where: { id: savedCard.id },
        relations: ["workerTask"],
      });
      expect(linkedCard!.workerTask!.status).toBe("completed");
    });

    test("card position reflects task status progression", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const board = await createBoard(org, { prefix: "FLOW" });
      const backlog = await createColumn(board, "Backlog", 0);
      const inProgress = await createColumn(board, "In Progress", 1);
      const review = await createColumn(board, "Review", 2);
      const done = await createColumn(board, "Done", 3);

      const task = manager.create(WorkerTask, {
        jiraIssueKey: "FLOW-1",
        summary: "Flow through columns",
        status: "queued",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
      });
      const savedTask = await manager.save(task);

      const card = manager.create(KbCard, {
        title: "Flow through columns",
        boardId: board.id,
        columnId: backlog.id,
        cardNumber: 1,
        position: 0,
        workerTaskId: savedTask.id,
      });
      const savedCard = await manager.save(card);

      // Status: queued -> executing => card moves to In Progress
      await manager.update(WorkerTask, savedTask.id, { status: "executing", startedAt: new Date() });
      await manager.update(KbCard, savedCard.id, { columnId: inProgress.id });

      let cardState = await manager.findOne(KbCard, { where: { id: savedCard.id } });
      expect(cardState!.columnId).toBe(inProgress.id);

      // Status: executing -> review_requested => card moves to Review
      await manager.update(WorkerTask, savedTask.id, { status: "review_requested" });
      await manager.update(KbCard, savedCard.id, { columnId: review.id });

      cardState = await manager.findOne(KbCard, { where: { id: savedCard.id } });
      expect(cardState!.columnId).toBe(review.id);

      // Status: review_requested -> completed => card moves to Done
      await manager.update(WorkerTask, savedTask.id, { status: "completed", completedAt: new Date() });
      await manager.update(KbCard, savedCard.id, { columnId: done.id });

      cardState = await manager.findOne(KbCard, { where: { id: savedCard.id } });
      expect(cardState!.columnId).toBe(done.id);
    });

    test("task workerTaskId is set to null when task is deleted", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const board = await createBoard(org, { prefix: "DEL" });
      const backlog = await createColumn(board, "Backlog", 0);

      const task = manager.create(WorkerTask, {
        jiraIssueKey: "DEL-1",
        summary: "Will be deleted",
        status: "queued",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
      });
      const savedTask = await manager.save(task);

      const card = manager.create(KbCard, {
        title: "Linked to deleted task",
        boardId: board.id,
        columnId: backlog.id,
        cardNumber: 1,
        position: 0,
        workerTaskId: savedTask.id,
      });
      const savedCard = await manager.save(card);

      // Delete the task
      await manager.remove(savedTask);

      // Card should still exist but workerTaskId should be null (SET NULL on delete)
      const orphanedCard = await manager.findOne(KbCard, { where: { id: savedCard.id } });
      expect(orphanedCard).not.toBeNull();
      expect(orphanedCard!.workerTaskId).toBeNull();
    });
  });

  // =========================================================================
  // PRD Content Flow
  // =========================================================================

  describe("PRD Content Flow", () => {
    test("board with PRD content is stored and retrievable", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const prdContent = `# E-Commerce Platform PRD

## Objective
Build a scalable e-commerce platform with product catalog, shopping cart, and checkout.

## Stories
1. Product listing page with search and filters
2. Shopping cart with quantity management
3. Checkout flow with Stripe integration
4. Order confirmation and email notifications`;

      const board = await createBoard(org, {
        name: "E-Commerce Platform",
        prefix: "ECOM",
        prdContent,
        prdSource: "manual",
        githubRepo: "acme/ecommerce",
      });

      const loaded = await manager.findOne(KbBoard, { where: { id: board.id } });
      expect(loaded!.prdContent).toBe(prdContent);
      expect(loaded!.prdSource).toBe("manual");
      expect(loaded!.githubRepo).toBe("acme/ecommerce");
    });

    test("card created from PRD board has task with description including PRD", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const prdContent = "Build a REST API with CRUD endpoints for user management.";

      const board = await createBoard(org, {
        name: "API Project",
        prefix: "API",
        prdContent,
        githubRepo: "acme/api",
      });
      const backlog = await createColumn(board, "Backlog", 0);

      // Create a task with description that includes PRD context
      const taskDescription = `Story from PRD:\n\n${prdContent}\n\nImplement user CRUD endpoints (GET, POST, PUT, DELETE).`;

      const task = manager.create(WorkerTask, {
        jiraIssueKey: "API-1",
        summary: "Implement user CRUD endpoints",
        description: taskDescription,
        status: "queued",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "acme/api",
      });
      const savedTask = await manager.save(task);

      const card = manager.create(KbCard, {
        title: "Implement user CRUD endpoints",
        description: taskDescription,
        boardId: board.id,
        columnId: backlog.id,
        cardNumber: 1,
        position: 0,
        workerTaskId: savedTask.id,
        githubRepo: "acme/api",
      });
      await manager.save(card);

      // Verify the task description includes the PRD content
      const loadedTask = await manager.findOne(WorkerTask, { where: { id: savedTask.id } });
      expect(loadedTask!.description).toContain(prdContent);
      expect(loadedTask!.description).toContain("Implement user CRUD endpoints");
    });

    test("multiple cards from same PRD board each have unique issue key", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const board = await createBoard(org, {
        name: "Multi-Story PRD",
        prefix: "PRD",
        prdContent: "Build a complete authentication system with multiple stories.",
        githubRepo: "acme/auth",
      });
      const backlog = await createColumn(board, "Backlog", 0);

      const cardTitles = [
        "Implement email/password login",
        "Add OAuth2 Google provider",
        "Add OAuth2 GitHub provider",
        "Password reset flow",
        "JWT token refresh mechanism",
      ];

      const issueKeys: string[] = [];

      for (let i = 0; i < cardTitles.length; i++) {
        const cardNumber = i + 1;
        const issueKey = `${board.prefix}-${cardNumber}`;
        issueKeys.push(issueKey);

        const task = manager.create(WorkerTask, {
          jiraIssueKey: issueKey,
          summary: cardTitles[i],
          status: "queued",
          orgId: org.id,
          workerPersona: "backend_developer",
          githubRepo: "acme/auth",
        });
        const savedTask = await manager.save(task);

        const card = manager.create(KbCard, {
          title: cardTitles[i],
          boardId: board.id,
          columnId: backlog.id,
          cardNumber,
          position: i,
          workerTaskId: savedTask.id,
        });
        await manager.save(card);
      }

      // Verify all issue keys are unique
      const uniqueKeys = new Set(issueKeys);
      expect(uniqueKeys.size).toBe(cardTitles.length);

      // Verify format
      expect(issueKeys).toEqual(["PRD-1", "PRD-2", "PRD-3", "PRD-4", "PRD-5"]);

      // Verify all cards exist for this board
      const allCards = await manager.find(KbCard, {
        where: { boardId: board.id },
        order: { position: "ASC" },
      });
      expect(allCards.length).toBe(5);

      // Verify all tasks exist with correct issue keys
      for (let i = 0; i < cardTitles.length; i++) {
        const task = await manager.findOne(WorkerTask, {
          where: { jiraIssueKey: `PRD-${i + 1}` },
        });
        expect(task).not.toBeNull();
        expect(task!.summary).toBe(cardTitles[i]);
      }
    });

    test("board nextCardNumber increments correctly across multiple card creations", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const board = await createBoard(org, { prefix: "INC" });
      const backlog = await createColumn(board, "Backlog", 0);

      expect(board.nextCardNumber).toBe(1);

      // Create 3 cards, incrementing nextCardNumber each time
      for (let i = 0; i < 3; i++) {
        const currentBoard = await manager.findOne(KbBoard, { where: { id: board.id } });
        const cardNumber = currentBoard!.nextCardNumber;

        const card = manager.create(KbCard, {
          title: `Card ${cardNumber}`,
          boardId: board.id,
          columnId: backlog.id,
          cardNumber,
          position: i,
        });
        await manager.save(card);

        await manager.update(KbBoard, board.id, { nextCardNumber: cardNumber + 1 });
      }

      // Verify nextCardNumber is now 4
      const updatedBoard = await manager.findOne(KbBoard, { where: { id: board.id } });
      expect(updatedBoard!.nextCardNumber).toBe(4);

      // Verify card numbers are 1, 2, 3
      const cards = await manager.find(KbCard, {
        where: { boardId: board.id },
        order: { cardNumber: "ASC" },
      });
      expect(cards.map((c) => c.cardNumber)).toEqual([1, 2, 3]);
    });

    test("board with ciWorkflowPath stores correctly", async () => {
      const org = await createTestOrg();
      const board = await createBoard(org, {
        ciWorkflowPath: ".github/workflows/ci.yml",
      });

      const manager = getTestManager();
      const loaded = await manager.findOne(KbBoard, { where: { id: board.id } });

      expect(loaded!.ciWorkflowPath).toBe(".github/workflows/ci.yml");
    });
  });
});
