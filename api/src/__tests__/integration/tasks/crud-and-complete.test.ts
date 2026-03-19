import { describe, test, expect } from "vitest";
import { getTestManager, generateTestId } from "../setup";
import { WorkerTask } from "../../../models/WorkerTask";
import { Organization } from "../../../models/Organization";

/**
 * Task CRUD and Worker-Complete Integration Tests.
 *
 * Tests the database operations that happen during the task lifecycle:
 * creation, status transitions, atomic token updates, and completion fields.
 *
 * All tests use transaction-based isolation (rollback after each test).
 */
describe("Task CRUD and Worker-Complete", () => {
  /**
   * Helper to create a test organization.
   */
  async function createTestOrg(overrides?: Partial<Organization>) {
    const manager = getTestManager();
    const org = manager.create(Organization, {
      name: `Test Org ${generateTestId()}`,
      slug: `test-org-${Date.now()}`,
      settings: {},
      apiKey: `test-api-key-${Date.now()}`,
      ...overrides,
    });
    return manager.save(org);
  }

  /**
   * Helper to create a test task.
   */
  async function createTask(org: Organization, overrides?: Partial<WorkerTask>) {
    const manager = getTestManager();
    const task = manager.create(WorkerTask, {
      jiraIssueKey: `TEST-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      summary: "Test Task",
      status: "queued",
      orgId: org.id,
      workerPersona: "backend_developer",
      githubRepo: "test/repo",
      ...overrides,
    });
    return manager.save(task);
  }

  // =========================================================================
  // 1. Task Creation
  // =========================================================================

  describe("Task Creation", () => {
    test("create task with required fields and verify all saved correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const task = await createTask(org);

      const loaded = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(loaded).toBeDefined();
      expect(loaded!.summary).toBe("Test Task");
      expect(loaded!.status).toBe("queued");
      expect(loaded!.orgId).toBe(org.id);
      expect(loaded!.workerPersona).toBe("backend_developer");
      expect(loaded!.githubRepo).toBe("test/repo");
      expect(loaded!.jiraIssueKey).toContain("TEST-");
      expect(loaded!.createdAt).toBeInstanceOf(Date);
      expect(loaded!.updatedAt).toBeInstanceOf(Date);
      expect(loaded!.startedAt).toBeNull();
      expect(loaded!.completedAt).toBeNull();
      expect(loaded!.errorMessage).toBeNull();
      expect(loaded!.inputTokens).toBe(0);
      expect(loaded!.outputTokens).toBe(0);
    });

    test("create task with optional fields (workerModel, description, labels)", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const task = await createTask(org, {
        workerModel: "claude-opus-4-6",
        description: "Detailed description of the task",
        deploymentEnabled: true,
        skipManagerReview: false,
        improvementEnabled: true,
        priority: 1,
      });

      const loaded = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(loaded).toBeDefined();
      expect(loaded!.workerModel).toBe("claude-opus-4-6");
      expect(loaded!.description).toBe("Detailed description of the task");
      expect(loaded!.deploymentEnabled).toBe(true);
      expect(loaded!.skipManagerReview).toBe(false);
      expect(loaded!.improvementEnabled).toBe(true);
      expect(loaded!.priority).toBe(1);
    });

    test("task uses default workerModel when not specified", async () => {
      const manager = getTestManager();
      const org = await createTestOrg({
        defaultWorkerModel: "claude-opus-4-6",
      });

      // Create task without specifying workerModel — column default applies
      const task = await createTask(org);

      const loaded = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(loaded).toBeDefined();
      // The column default is "claude-opus-4-6" from the WorkerTask entity definition
      expect(loaded!.workerModel).toBe("claude-opus-4-6");

      // Verify org has the custom default stored
      const loadedOrg = await manager.findOne(Organization, { where: { id: org.id } });
      expect(loadedOrg!.defaultWorkerModel).toBe("claude-opus-4-6");
    });

    test("task with duplicate jiraIssueKey in same org rejects", async () => {
      const org = await createTestOrg();
      const issueKey = `DUP-${Date.now()}`;

      await createTask(org, { jiraIssueKey: issueKey });

      // Second task with same jiraIssueKey in same org should fail
      await expect(
        createTask(org, { jiraIssueKey: issueKey })
      ).rejects.toThrow();
    });

    test("task with duplicate jiraIssueKey in different org succeeds", async () => {
      const org1 = await createTestOrg();
      const org2 = await createTestOrg();
      const issueKey = `CROSS-${Date.now()}`;

      const task1 = await createTask(org1, { jiraIssueKey: issueKey });
      const task2 = await createTask(org2, { jiraIssueKey: issueKey });

      expect(task1.id).not.toBe(task2.id);
      expect(task1.jiraIssueKey).toBe(issueKey);
      expect(task2.jiraIssueKey).toBe(issueKey);
      expect(task1.orgId).toBe(org1.id);
      expect(task2.orgId).toBe(org2.id);
    });
  });

  // =========================================================================
  // 2. Task Status Transitions
  // =========================================================================

  describe("Task Status Transitions", () => {
    test("queued -> executing (atomic claim)", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTask(org);

      const result = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "executing",
          startedAt: new Date(),
        })
        .where("id = :id AND status = :status", {
          id: task.id,
          status: "queued",
        })
        .execute();

      expect(result.affected).toBe(1);

      const updated = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(updated!.status).toBe("executing");
      expect(updated!.startedAt).toBeInstanceOf(Date);
    });

    test("executing -> completed (with PR URL, branch, revision count)", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTask(org);

      // Claim first
      await manager.update(WorkerTask, task.id, {
        status: "executing",
        startedAt: new Date(),
      });

      // Complete with PR details
      const completedAt = new Date();
      await manager.update(WorkerTask, task.id, {
        status: "completed",
        completedAt,
        githubPrUrl: "https://github.com/test/repo/pull/42",
        githubBranch: "feature/test-branch",
        revisionCount: 2,
      });

      const completed = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(completed!.status).toBe("completed");
      expect(completed!.completedAt).toBeDefined();
      expect(completed!.githubPrUrl).toBe("https://github.com/test/repo/pull/42");
      expect(completed!.githubBranch).toBe("feature/test-branch");
      expect(completed!.revisionCount).toBe(2);
    });

    test("executing -> failed (with error message)", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTask(org);

      await manager.update(WorkerTask, task.id, {
        status: "executing",
        startedAt: new Date(),
      });

      await manager.update(WorkerTask, task.id, {
        status: "failed",
        completedAt: new Date(),
        errorMessage: "npm install failed: ENOENT package.json not found",
      });

      const failed = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(failed!.status).toBe("failed");
      expect(failed!.errorMessage).toBe("npm install failed: ENOENT package.json not found");
      expect(failed!.completedAt).toBeDefined();
    });

    test("executing -> review_requested (with PR URL and number)", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTask(org);

      await manager.update(WorkerTask, task.id, {
        status: "executing",
        startedAt: new Date(),
      });

      await manager.update(WorkerTask, task.id, {
        status: "review_requested",
        githubPrUrl: "https://github.com/test/repo/pull/99",
        githubPrNumber: 99,
      });

      const reviewed = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(reviewed!.status).toBe("review_requested");
      expect(reviewed!.githubPrUrl).toBe("https://github.com/test/repo/pull/99");
      expect(reviewed!.githubPrNumber).toBe(99);
    });

    test("executing -> escalated", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTask(org);

      await manager.update(WorkerTask, task.id, {
        status: "executing",
        startedAt: new Date(),
      });

      await manager.update(WorkerTask, task.id, {
        status: "escalated",
        errorMessage: "Unclear requirements: API endpoint not specified in ticket",
      });

      const escalated = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(escalated!.status).toBe("escalated");
      expect(escalated!.errorMessage).toBe("Unclear requirements: API endpoint not specified in ticket");
    });

    test("double claim prevention (second claim returns affected=0)", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTask(org);

      // First claim succeeds
      const firstClaim = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({ status: "executing", startedAt: new Date() })
        .where("id = :id AND status = :status", { id: task.id, status: "queued" })
        .execute();

      expect(firstClaim.affected).toBe(1);

      // Second claim fails — task is no longer "queued"
      const secondClaim = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({ status: "executing", startedAt: new Date() })
        .where("id = :id AND status = :status", { id: task.id, status: "queued" })
        .execute();

      expect(secondClaim.affected).toBe(0);

      // Task is still executing from first claim
      const loaded = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(loaded!.status).toBe("executing");
    });
  });

  // =========================================================================
  // 3. Atomic Token Updates (worker-complete pattern)
  // =========================================================================

  describe("Atomic Token Updates", () => {
    test("atomic SQL increment pattern accumulates tokens correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTask(org);

      // First increment
      await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          inputTokens: () => `COALESCE(input_tokens, 0) + 100`,
          outputTokens: () => `COALESCE(output_tokens, 0) + 50`,
        })
        .where("id = :id", { id: task.id })
        .execute();

      const after1 = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(after1!.inputTokens).toBe(100);
      expect(after1!.outputTokens).toBe(50);

      // Second increment
      await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          inputTokens: () => `COALESCE(input_tokens, 0) + 200`,
          outputTokens: () => `COALESCE(output_tokens, 0) + 75`,
        })
        .where("id = :id", { id: task.id })
        .execute();

      const after2 = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(after2!.inputTokens).toBe(300);
      expect(after2!.outputTokens).toBe(125);
    });

    test("simulate concurrent updates — both increments are added", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTask(org);

      // Execute two increments concurrently (within same transaction, simulating rapid calls)
      await Promise.all([
        manager
          .createQueryBuilder()
          .update(WorkerTask)
          .set({
            inputTokens: () => `COALESCE(input_tokens, 0) + 500`,
            outputTokens: () => `COALESCE(output_tokens, 0) + 200`,
          })
          .where("id = :id", { id: task.id })
          .execute(),
        manager
          .createQueryBuilder()
          .update(WorkerTask)
          .set({
            inputTokens: () => `COALESCE(input_tokens, 0) + 300`,
            outputTokens: () => `COALESCE(output_tokens, 0) + 100`,
          })
          .where("id = :id", { id: task.id })
          .execute(),
      ]);

      const loaded = await manager.findOne(WorkerTask, { where: { id: task.id } });
      // Both increments should be applied (order may vary but total is deterministic)
      expect(loaded!.inputTokens).toBe(800);
      expect(loaded!.outputTokens).toBe(300);
    });

    test("COALESCE handles NULL initial values", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTask(org);

      // Force tokens to NULL via raw query
      await manager.query(
        `UPDATE worker_tasks SET input_tokens = NULL, output_tokens = NULL WHERE id = $1`,
        [task.id]
      );

      // Verify they are NULL
      const nulled = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(nulled!.inputTokens).toBeNull();
      expect(nulled!.outputTokens).toBeNull();

      // Atomic increment on NULL values should work via COALESCE
      await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          inputTokens: () => `COALESCE(input_tokens, 0) + 100`,
          outputTokens: () => `COALESCE(output_tokens, 0) + 50`,
        })
        .where("id = :id", { id: task.id })
        .execute();

      const loaded = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(loaded!.inputTokens).toBe(100);
      expect(loaded!.outputTokens).toBe(50);
    });
  });

  // =========================================================================
  // 4. Task Completion Fields
  // =========================================================================

  describe("Task Completion Fields", () => {
    test("completedAt set on terminal status", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      // Test "completed" terminal status
      const task1 = await createTask(org);
      await manager.update(WorkerTask, task1.id, {
        status: "executing",
        startedAt: new Date(),
      });
      const completedAt = new Date();
      await manager.update(WorkerTask, task1.id, {
        status: "completed",
        completedAt,
      });
      const loaded1 = await manager.findOne(WorkerTask, { where: { id: task1.id } });
      expect(loaded1!.completedAt).toBeDefined();
      expect(loaded1!.isTerminal()).toBe(true);

      // Test "failed" terminal status
      const task2 = await createTask(org);
      await manager.update(WorkerTask, task2.id, {
        status: "executing",
        startedAt: new Date(),
      });
      await manager.update(WorkerTask, task2.id, {
        status: "failed",
        completedAt: new Date(),
        errorMessage: "build failed",
      });
      const loaded2 = await manager.findOne(WorkerTask, { where: { id: task2.id } });
      expect(loaded2!.completedAt).toBeDefined();
      expect(loaded2!.isTerminal()).toBe(true);

      // Test "cancelled" terminal status
      const task3 = await createTask(org);
      await manager.update(WorkerTask, task3.id, {
        status: "cancelled",
        completedAt: new Date(),
      });
      const loaded3 = await manager.findOne(WorkerTask, { where: { id: task3.id } });
      expect(loaded3!.completedAt).toBeDefined();
      expect(loaded3!.isTerminal()).toBe(true);
    });

    test("ecsTaskSeconds calculated from startedAt", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTask(org);

      const startedAt = new Date(Date.now() - 120_000); // 2 minutes ago
      await manager.update(WorkerTask, task.id, {
        status: "executing",
        startedAt,
      });

      // Simulate worker-complete setting ecsTaskSeconds
      const ecsTaskSeconds = 120;
      await manager.update(WorkerTask, task.id, {
        status: "completed",
        completedAt: new Date(),
        ecsTaskSeconds,
      });

      const loaded = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(loaded!.ecsTaskSeconds).toBe(120);

      // Also verify the helper method
      expect(loaded!.getDurationSeconds()).toBeGreaterThanOrEqual(119);
    });

    test("githubPrUrl and githubPrNumber set on completion", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTask(org);

      await manager.update(WorkerTask, task.id, {
        status: "executing",
        startedAt: new Date(),
      });

      await manager.update(WorkerTask, task.id, {
        status: "completed",
        completedAt: new Date(),
        githubPrUrl: "https://github.com/test/repo/pull/77",
        githubPrNumber: 77,
        githubBranch: "workermill/TEST-123",
      });

      const loaded = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(loaded!.githubPrUrl).toBe("https://github.com/test/repo/pull/77");
      expect(loaded!.githubPrNumber).toBe(77);
      expect(loaded!.githubBranch).toBe("workermill/TEST-123");
    });

    test("errorMessage set on failure", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTask(org);

      await manager.update(WorkerTask, task.id, {
        status: "executing",
        startedAt: new Date(),
      });

      const longError = "Error: ENOMEM - out of memory\n  at Worker.spawn (worker.ts:42)\n  at TaskRunner.execute (runner.ts:100)";
      await manager.update(WorkerTask, task.id, {
        status: "failed",
        completedAt: new Date(),
        errorMessage: longError,
      });

      const loaded = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(loaded!.status).toBe("failed");
      expect(loaded!.errorMessage).toBe(longError);
      expect(loaded!.completedAt).toBeDefined();
      expect(loaded!.isTerminal()).toBe(true);
    });
  });
});
