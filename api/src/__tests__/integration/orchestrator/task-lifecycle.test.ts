import { describe, test, expect } from "vitest";
import { getTestManager, generateTestId } from "../setup";
import { WorkerTask } from "../../../models/WorkerTask";
import { WorkerTaskLog } from "../../../models/WorkerTaskLog";
import { Organization } from "../../../models/Organization";

/**
 * Task Orchestration Lifecycle Integration Tests.
 *
 * Tests the database operations for the task lifecycle:
 * queued → executing → completed/failed
 *
 * These tests verify the atomic claim operation and status transitions.
 */
describe("Task Orchestration Lifecycle", () => {
  /**
   * Helper to create a test organization.
   */
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

  /**
   * Helper to create a queued test task.
   */
  async function createQueuedTask(org: Organization, summary?: string) {
    const manager = getTestManager();
    const task = manager.create(WorkerTask, {
      jiraIssueKey: `TEST-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      summary: summary || "Test Task",
      status: "queued",
      orgId: org.id,
      workerPersona: "backend_developer",
      githubRepo: "test/repo",
    });
    return manager.save(task);
  }

  describe("Task Claiming", () => {
    test("atomic claim transitions task from queued to executing", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createQueuedTask(org);

      expect(task.status).toBe("queued");

      // Simulate atomic claim with UPDATE...WHERE
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

      // Verify status changed
      const updated = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(updated?.status).toBe("executing");
      expect(updated?.startedAt).toBeDefined();
    });

    test("claim fails for already executing task", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createQueuedTask(org);

      // First claim succeeds
      const firstClaim = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({ status: "executing", startedAt: new Date() })
        .where("id = :id AND status = :status", { id: task.id, status: "queued" })
        .execute();

      expect(firstClaim.affected).toBe(1);

      // Second claim fails (task no longer queued)
      const secondClaim = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({ status: "executing", startedAt: new Date() })
        .where("id = :id AND status = :status", { id: task.id, status: "queued" })
        .execute();

      expect(secondClaim.affected).toBe(0);
    });
  });

  describe("Task Completion", () => {
    test("executing task can be marked as completed", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createQueuedTask(org);

      // Claim the task
      await manager.update(WorkerTask, task.id, {
        status: "executing",
        startedAt: new Date(),
      });

      // Complete the task
      const completedAt = new Date();
      await manager.update(WorkerTask, task.id, {
        status: "completed",
        completedAt,
        githubPrUrl: "https://github.com/test/test/pull/1",
      });

      const completed = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(completed?.status).toBe("completed");
      expect(completed?.githubPrUrl).toBe("https://github.com/test/test/pull/1");
      expect(completed?.completedAt).toBeDefined();
    });

    test("executing task can be marked as failed", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createQueuedTask(org);

      // Claim the task
      await manager.update(WorkerTask, task.id, {
        status: "executing",
        startedAt: new Date(),
      });

      // Fail the task
      await manager.update(WorkerTask, task.id, {
        status: "failed",
        completedAt: new Date(),
        errorMessage: "Test error",
      });

      const failed = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(failed?.status).toBe("failed");
      expect(failed?.errorMessage).toBe("Test error");
    });
  });

  describe("Log Streaming", () => {
    test("logs can be added to executing task", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createQueuedTask(org);

      // Claim the task
      await manager.update(WorkerTask, task.id, {
        status: "executing",
        startedAt: new Date(),
      });

      // Add log entries
      const log1 = manager.create(WorkerTaskLog, {
        taskId: task.id,
        type: "info",
        message: "Starting execution...",
      });
      const log2 = manager.create(WorkerTaskLog, {
        taskId: task.id,
        type: "bash_command",
        message: "Running npm install",
      });

      await manager.save([log1, log2]);

      // Query logs
      const logs = await manager.find(WorkerTaskLog, {
        where: { taskId: task.id },
        order: { createdAt: "ASC" },
      });

      expect(logs.length).toBe(2);
      expect(logs[0].message).toBe("Starting execution...");
      expect(logs[1].message).toBe("Running npm install");
    });

    test("logs maintain insertion order", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createQueuedTask(org);

      // Add multiple logs
      for (let i = 1; i <= 5; i++) {
        const log = manager.create(WorkerTaskLog, {
          taskId: task.id,
          type: "info",
          message: `Log entry ${i}`,
        });
        await manager.save(log);
        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Query logs in order
      const logs = await manager.find(WorkerTaskLog, {
        where: { taskId: task.id },
        order: { createdAt: "ASC" },
      });

      expect(logs.length).toBe(5);
      for (let i = 0; i < 5; i++) {
        expect(logs[i].message).toBe(`Log entry ${i + 1}`);
      }
    });
  });

  describe("Task Metadata", () => {
    test("cost tracking fields are updated correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createQueuedTask(org);

      // Update cost tracking
      await manager.update(WorkerTask, task.id, {
        inputTokens: 1000,
        outputTokens: 500,
        estimatedCostUsd: 0.015,
      });

      const updated = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(updated?.inputTokens).toBe(1000);
      expect(updated?.outputTokens).toBe(500);
      expect(Number(updated?.estimatedCostUsd)).toBeCloseTo(0.015, 3);
    });

    test("ECS task fields are set when executing", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createQueuedTask(org);

      const ecsTaskArn = "arn:aws:ecs:us-east-1:123456789:task/cluster/task-123";

      await manager.update(WorkerTask, task.id, {
        status: "executing",
        startedAt: new Date(),
        ecsTaskArn,
      });

      const updated = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(updated?.ecsTaskArn).toBe(ecsTaskArn);
    });
  });
});
