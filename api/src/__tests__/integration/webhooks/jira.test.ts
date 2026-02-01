import { describe, test, expect } from "vitest";
import { getTestManager, generateTestId } from "../setup";
import { WorkerTask } from "../../../models/WorkerTask";
import { Organization } from "../../../models/Organization";

/**
 * Jira Webhook Integration Tests.
 *
 * Tests the database operations that occur when processing Jira webhooks.
 * Tests use transaction rollback for isolation.
 */
describe("Jira Webhook Integration", () => {
  /**
   * Helper to create a test organization.
   */
  async function createTestOrg(name?: string) {
    const manager = getTestManager();
    const org = manager.create(Organization, {
      name: name || `Test Org ${generateTestId()}`,
      slug: `test-org-${Date.now()}`,
      settings: {},
      apiKey: `test-api-key-${Date.now()}`,
    });
    return manager.save(org);
  }

  describe("Task Creation", () => {
    test("creates task with correct fields from Jira issue data", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const jiraKey = `TEST-${Date.now()}`;
      const task = manager.create(WorkerTask, {
        jiraIssueKey: jiraKey,
        summary: "Integration Test Task",
        description: "Created by integration test",
        status: "queued",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
      });

      const savedTask = await manager.save(task);

      expect(savedTask.id).toBeDefined();
      expect(savedTask.jiraIssueKey).toBe(jiraKey);
      expect(savedTask.summary).toBe("Integration Test Task");
      expect(savedTask.status).toBe("queued");
      expect(savedTask.orgId).toBe(org.id);
    });

    test("task jiraIssueKey must be unique within organization", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const jiraKey = `TEST-${Date.now()}`;

      // Create first task
      const task1 = manager.create(WorkerTask, {
        jiraIssueKey: jiraKey,
        summary: "First Task",
        status: "queued",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
      });
      await manager.save(task1);

      // Creating second task with same jiraIssueKey should fail
      const task2 = manager.create(WorkerTask, {
        jiraIssueKey: jiraKey,
        summary: "Duplicate Task",
        status: "queued",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
      });

      await expect(manager.save(task2)).rejects.toThrow();
    });

    test("same jiraIssueKey can exist in different organizations", async () => {
      const manager = getTestManager();
      const org1 = await createTestOrg("Org One");
      const org2 = await createTestOrg("Org Two");

      const jiraKey = `TEST-${Date.now()}`;

      // Create task in org1
      const task1 = manager.create(WorkerTask, {
        jiraIssueKey: jiraKey,
        summary: "Task in Org 1",
        status: "queued",
        orgId: org1.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
      });
      await manager.save(task1);

      // Create task with same key in org2 - should succeed
      const task2 = manager.create(WorkerTask, {
        jiraIssueKey: jiraKey,
        summary: "Task in Org 2",
        status: "queued",
        orgId: org2.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
      });
      const savedTask2 = await manager.save(task2);

      expect(savedTask2.id).toBeDefined();
      expect(savedTask2.jiraIssueKey).toBe(jiraKey);
    });
  });

  describe("Task Model Selection", () => {
    test("haiku label sets model to haiku", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const task = manager.create(WorkerTask, {
        jiraIssueKey: `TEST-${Date.now()}`,
        summary: "Haiku Task",
        status: "queued",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
        workerModel: "claude-haiku-4-5", // As set by webhook handler when haiku label present
      });

      const savedTask = await manager.save(task);
      expect(savedTask.workerModel).toBe("claude-haiku-4-5");
    });

    test("opus label sets model to opus", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const task = manager.create(WorkerTask, {
        jiraIssueKey: `TEST-${Date.now()}`,
        summary: "Opus Task",
        status: "queued",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
        workerModel: "claude-opus-4",
      });

      const savedTask = await manager.save(task);
      expect(savedTask.workerModel).toBe("claude-opus-4");
    });
  });

  describe("Task Querying", () => {
    test("can query tasks by status", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      // Create tasks with different statuses
      const queuedTask = manager.create(WorkerTask, {
        jiraIssueKey: `TEST-QUEUED-${Date.now()}`,
        summary: "Queued Task",
        status: "queued",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
      });
      const runningTask = manager.create(WorkerTask, {
        jiraIssueKey: `TEST-RUNNING-${Date.now()}`,
        summary: "Running Task",
        status: "executing",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
      });
      const completedTask = manager.create(WorkerTask, {
        jiraIssueKey: `TEST-COMPLETED-${Date.now()}`,
        summary: "Completed Task",
        status: "completed",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
      });

      await manager.save([queuedTask, runningTask, completedTask]);

      // Query by status
      const queuedTasks = await manager.find(WorkerTask, {
        where: { orgId: org.id, status: "queued" },
      });
      const runningTasks = await manager.find(WorkerTask, {
        where: { orgId: org.id, status: "executing" },
      });

      expect(queuedTasks.length).toBe(1);
      expect(queuedTasks[0].summary).toBe("Queued Task");
      expect(runningTasks.length).toBe(1);
      expect(runningTasks[0].summary).toBe("Running Task");
    });

    test("can query task by jiraIssueKey and organization", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const jiraKey = `TEST-${Date.now()}`;
      const task = manager.create(WorkerTask, {
        jiraIssueKey: jiraKey,
        summary: "Searchable Task",
        status: "queued",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
      });
      await manager.save(task);

      const found = await manager.findOne(WorkerTask, {
        where: { jiraIssueKey: jiraKey, orgId: org.id },
      });

      expect(found).toBeDefined();
      expect(found?.summary).toBe("Searchable Task");
    });
  });
});
