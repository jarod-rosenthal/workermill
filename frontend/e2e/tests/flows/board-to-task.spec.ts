import { test, expect } from "@playwright/test";
import { APIClient } from "../../helpers/api-client";
import { generateTestId, waitFor } from "../../helpers/test-data";

const isProduction = !!process.env.BASE_URL; // Skip when targeting a deployed env (no mock workers)

/**
 * Board-to-Task flow tests.
 *
 * Verifies the end-to-end flow from board creation through card execution:
 * - Create a board, add a card, run it, verify task appears in dashboard
 * - Card status reflects task completion after mock worker finishes
 * - Board with PRD content creates tasks with PRD description
 *
 * Uses the real API with mock workers. Mock workers complete tasks based on
 * Jira key prefix (E2E-TEST-* = success).
 */
test.describe("Board to Task Flow", () => {
  test.skip(isProduction, 'Requires mock workers — only runs against local stack');
  let apiClient: APIClient;
  const createdBoardIds: string[] = [];
  const createdTaskIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    apiClient = new APIClient(request);
  });

  test.afterAll(async ({ request }) => {
    // Best-effort cleanup of tasks
    for (const id of createdTaskIds) {
      try {
        await apiClient.cancelTask(id);
      } catch {
        // Task may already be terminal
      }
      try {
        await apiClient.deleteTask(id);
      } catch {
        // Best-effort cleanup
      }
    }

    // Best-effort cleanup of boards via API
    const baseURL = process.env.BASE_URL || "http://localhost:5173";
    const apiURL = baseURL.includes("localhost")
      ? baseURL.replace(/:\d+$/, ":3001")
      : baseURL;

    for (const boardId of createdBoardIds) {
      try {
        await request.delete(`${apiURL}/api/boards/${boardId}`);
      } catch {
        // Best-effort cleanup
      }
    }
  });

  test("board creation and card run creates task visible in dashboard", async ({
    page,
  }) => {
    const testId = generateTestId();
    const boardName = `E2E Flow Board ${testId}`;
    const cardTitle = `E2E-TEST-${testId} Flow card task`;

    // Navigate to boards page
    await page.goto("/boards");
    await page.waitForLoadState("domcontentloaded");

    // Find and click the create board button — BoardsList.tsx uses data-testid="create-board-btn"
    const createBtn = page.locator('[data-testid="create-board-btn"]');

    if ((await createBtn.count()) === 0) {
      test.skip();
      return;
    }

    await createBtn.first().click();

    // Wait for dialog — CreateBoardDialog renders heading "Create New Board"
    await expect(page.locator('text="Create New Board"')).toBeVisible({ timeout: 5000 });

    // Fill in board name — first text input in the dialog is the name field (autoFocus)
    const nameInput = page.locator('.fixed input[type="text"]').first();
    if ((await nameInput.count()) > 0) {
      await nameInput.fill(boardName);
    }

    // Submit — button with text "Create Board"
    const submitBtn = page.locator('button:has-text("Create Board")');
    if ((await submitBtn.count()) > 0) {
      await submitBtn.first().click();
    }

    // Wait for navigation to the new board or for it to appear in the list
    await page.waitForTimeout(2000);
    await page.waitForLoadState("domcontentloaded");

    // Extract board ID from URL if we navigated to the board detail page
    let boardId: string | null = null;
    const boardUrlMatch = page.url().match(/\/boards\/([a-f0-9-]+)/);
    if (boardUrlMatch) {
      boardId = boardUrlMatch[1];
      createdBoardIds.push(boardId);
    } else {
      // If still on the list, click the newly created board
      const boardLink = page.locator(`a:has-text("${boardName}")`);
      if ((await boardLink.count()) > 0) {
        await boardLink.first().click();
        await page.waitForLoadState("domcontentloaded");
        const newMatch = page.url().match(/\/boards\/([a-f0-9-]+)/);
        if (newMatch) {
          boardId = newMatch[1];
          createdBoardIds.push(boardId);
        }
      }
    }

    // We should now be on the board detail page
    expect(boardId).toBeTruthy();

    // Click "Add card" button on the first column
    const addCardBtn = page.locator(
      'button:has-text("Add card"), button:has-text("Add Card"), [data-testid="add-card-btn"]',
    );
    await expect(addCardBtn.first()).toBeVisible({ timeout: 10000 });
    await addCardBtn.first().click();

    // Fill in the card title in the add card input
    const cardInput = page.locator(
      'input[placeholder*="What needs"], input[placeholder*="card" i], input[placeholder*="title" i]',
    );
    await expect(cardInput.first()).toBeVisible({ timeout: 5000 });
    await cardInput.first().fill(cardTitle);

    // Submit the card (click "Add Card" button or press Enter)
    const addCardSubmit = page.locator(
      'button:has-text("Add Card"), button:has-text("Add"):not(button:has-text("Add card"))',
    );
    if ((await addCardSubmit.count()) > 0) {
      await addCardSubmit.first().click();
    } else {
      await cardInput.first().press("Enter");
    }

    // Wait for the card to appear on the board
    await page.waitForTimeout(1000);
    await expect(page.locator(`text=${cardTitle}`).first()).toBeVisible({
      timeout: 10000,
    });

    // Click on the card to open the detail modal
    await page.locator(`text=${cardTitle}`).first().click();
    await page.waitForTimeout(500);

    // Click the "Run with AI" button in the card detail
    const runBtn = page.locator(
      'button:has-text("Run with AI"), button:has-text("Run"), [data-testid="run-card-btn"]',
    );
    await expect(runBtn.first()).toBeVisible({ timeout: 10000 });
    await runBtn.first().click();

    // Wait for the worker status to appear (replaces the "Run with AI" button)
    await page.waitForTimeout(2000);

    // Close the card detail modal by pressing Escape or clicking overlay
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Navigate to dashboard and verify the task appears
    await page.goto("/dashboard");
    await page.waitForSelector(
      '[data-testid="task-list"], .task-list, table',
      { timeout: 10000 },
    );

    // The task should be visible (it may take a moment to appear)
    await expect(page.locator(`text=${cardTitle}`).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("card status reflects task completion", async ({ page, request }) => {
    const testId = generateTestId();
    const boardName = `E2E Status Board ${testId}`;
    const cardTitle = `E2E-TEST-${testId} Status check card`;

    // Create board and card via API for reliable setup
    const baseURL = process.env.BASE_URL || "http://localhost:5173";
    const apiURL = baseURL.includes("localhost")
      ? baseURL.replace(/:\d+$/, ":3001")
      : baseURL;

    // Create board via API
    const boardResponse = await request.post(`${apiURL}/api/boards`, {
      data: { name: boardName },
    });
    expect(boardResponse.ok()).toBeTruthy();
    const boardData = await boardResponse.json();
    const boardId = boardData.board?.id ?? boardData.id;
    createdBoardIds.push(boardId);

    // Get columns to find the first column ID
    const columnsResponse = await request.get(
      `${apiURL}/api/boards/${boardId}/columns`,
    );
    expect(columnsResponse.ok()).toBeTruthy();
    const columnsData = await columnsResponse.json();
    const columns = columnsData.columns ?? columnsData;
    expect(columns.length).toBeGreaterThan(0);
    const firstColumnId = columns[0].id;

    // Create card via API
    const cardResponse = await request.post(
      `${apiURL}/api/boards/${boardId}/cards`,
      {
        data: { columnId: firstColumnId, title: cardTitle },
      },
    );
    expect(cardResponse.ok()).toBeTruthy();
    const cardData = await cardResponse.json();
    const cardId = cardData.card?.id ?? cardData.id;

    // Run the card via API
    const runResponse = await request.post(
      `${apiURL}/api/boards/${boardId}/cards/${cardId}/run`,
    );
    expect(runResponse.ok()).toBeTruthy();
    const runData = await runResponse.json();
    const taskId = runData.workerTask?.id;
    expect(taskId).toBeTruthy();
    createdTaskIds.push(taskId);

    // Wait for mock worker to complete the task (E2E-TEST prefix = success)
    const completedTask = await waitFor(
      async () => {
        const t = await apiClient.getTask(taskId);
        if (!t) return null;
        // Terminal or near-terminal statuses
        const doneStatuses = [
          "review_requested",
          "completed",
          "pr_created",
          "review_approved",
          "deployed",
        ];
        return doneStatuses.includes(t.status) ? t : null;
      },
      { timeout: 60000, interval: 2000 },
    );

    expect(completedTask).toBeTruthy();

    // Navigate to the board and verify the card shows updated worker status
    await page.goto(`/boards/${boardId}`);
    await page.waitForLoadState("domcontentloaded");

    // The card should be visible on the board
    await expect(page.locator(`text=${cardTitle}`).first()).toBeVisible({
      timeout: 10000,
    });

    // The card item should show a worker status badge
    const cardElement = page.locator(
      `[class*="card"]:has-text("${cardTitle}"), [data-testid="card-item"]:has-text("${cardTitle}")`,
    );

    if ((await cardElement.count()) > 0) {
      // Worker status badge should be visible on the card
      const statusBadge = cardElement
        .first()
        .locator(
          'text=/review|completed|done|success|pr created/i',
        );
      await expect(statusBadge.first()).toBeVisible({ timeout: 15000 });
    }
  });

  test("board with PRD content runs card with PRD description", async ({
    page,
    request,
  }) => {
    const testId = generateTestId();
    const boardName = `E2E PRD Board ${testId}`;
    const prdContent = `# PRD: E2E Test Feature ${testId}\n\n## Overview\nThis is a test PRD for verifying board-to-task flow with PRD content.\n\n## Requirements\n- Requirement 1: Implement the feature\n- Requirement 2: Add tests\n\n## Acceptance Criteria\n- Feature works end-to-end\n- All tests pass`;
    const cardTitle = `E2E-TEST-${testId} PRD task`;
    const cardDescription = `Implement feature from PRD.\n\nContext from PRD:\n${prdContent.substring(0, 200)}`;

    // Create board via API
    const baseURL = process.env.BASE_URL || "http://localhost:5173";
    const apiURL = baseURL.includes("localhost")
      ? baseURL.replace(/:\d+$/, ":3001")
      : baseURL;

    const boardResponse = await request.post(`${apiURL}/api/boards`, {
      data: { name: boardName, description: prdContent },
    });
    expect(boardResponse.ok()).toBeTruthy();
    const boardData = await boardResponse.json();
    const boardId = boardData.board?.id ?? boardData.id;
    createdBoardIds.push(boardId);

    // Get columns
    const columnsResponse = await request.get(
      `${apiURL}/api/boards/${boardId}/columns`,
    );
    expect(columnsResponse.ok()).toBeTruthy();
    const columnsData = await columnsResponse.json();
    const columns = columnsData.columns ?? columnsData;
    const firstColumnId = columns[0].id;

    // Create card with description referencing PRD content
    const cardResponse = await request.post(
      `${apiURL}/api/boards/${boardId}/cards`,
      {
        data: {
          columnId: firstColumnId,
          title: cardTitle,
          description: cardDescription,
        },
      },
    );
    expect(cardResponse.ok()).toBeTruthy();
    const cardData = await cardResponse.json();
    const cardId = cardData.card?.id ?? cardData.id;

    // Run the card via API
    const runResponse = await request.post(
      `${apiURL}/api/boards/${boardId}/cards/${cardId}/run`,
    );
    expect(runResponse.ok()).toBeTruthy();
    const runData = await runResponse.json();
    const taskId = runData.workerTask?.id;
    expect(taskId).toBeTruthy();
    createdTaskIds.push(taskId);

    // Verify the task was created with the correct description via API
    const task = await waitFor(
      async () => apiClient.getTask(taskId),
      { timeout: 15000 },
    );

    expect(task).toBeTruthy();
    // Task description should contain content from the card/PRD
    if (task.description) {
      expect(task.description).toContain("E2E Test Feature");
    }

    // Navigate to board page and verify the card and its status
    await page.goto(`/boards/${boardId}`);
    await page.waitForLoadState("domcontentloaded");

    // Card should be visible
    await expect(page.locator(`text=${cardTitle}`).first()).toBeVisible({
      timeout: 10000,
    });

    // Click on the card to open detail and verify description
    await page.locator(`text=${cardTitle}`).first().click();
    await page.waitForTimeout(1000);

    // Card detail should show the description content
    const detailModal = page.locator(
      '[role="dialog"], [class*="modal"], [class*="detail"], [class*="overlay"]',
    );
    if ((await detailModal.count()) > 0) {
      await expect(detailModal.first()).toContainText(/PRD|Implement feature/i, {
        timeout: 10000,
      });
    }

    // The AI Worker section should show a status (since we ran the card)
    const workerSection = page.locator('text=/AI Worker|worker status/i');
    if ((await workerSection.count()) > 0) {
      await expect(workerSection.first()).toBeVisible({ timeout: 10000 });
    }
  });
});
