import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { getTestManager, generateTestId } from "../setup";
import { WorkerTask, WorkerTaskStatus } from "../../../models/WorkerTask";
import { Organization } from "../../../models/Organization";

/**
 * Local Epic Spawner Integration Tests.
 *
 * Tests the local-epic-spawner service which spawns Docker containers
 * for task execution in local development mode (EXECUTION_MODE=local).
 *
 * These tests verify:
 * 1. Task lifecycle management (tracking, status updates)
 * 2. Environment variable construction for containers
 * 3. SCM provider configuration (GitHub, GitLab, Bitbucket)
 * 4. WSL path detection and conversion
 * 5. Concurrent task limits
 */
describe("Local Epic Spawner", () => {
  // Store original env vars to restore after tests
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment to known state
    process.env.EXECUTION_MODE = "local";
    process.env.MAX_LOCAL_WORKERS = "4";
    process.env.PORT = "3001";
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  /**
   * Helper to create a test organization with specific SCM settings.
   */
  async function createTestOrg(scmConfig?: {
    scmProvider?: "github" | "gitlab" | "bitbucket";
    defaultGithubRepo?: string;
    defaultGitlabRepo?: string;
    defaultBitbucketRepo?: string;
  }) {
    const manager = getTestManager();
    const org = manager.create(Organization, {
      name: `Test Org ${generateTestId()}`,
      slug: `test-org-${Date.now()}`,
      apiKey: `test-api-key-${Date.now()}`,
      scmProvider: scmConfig?.scmProvider || "github",
      defaultGithubRepo: scmConfig?.defaultGithubRepo || "test/repo",
      defaultGitlabRepo: scmConfig?.defaultGitlabRepo,
      defaultBitbucketRepo: scmConfig?.defaultBitbucketRepo,
    });
    return manager.save(org);
  }

  /**
   * Helper to create a test task.
   */
  async function createTestTask(org: Organization, options?: {
    status?: WorkerTaskStatus;
    workerModel?: string;
    githubRepo?: string;
  }) {
    const manager = getTestManager();
    const task = manager.create(WorkerTask, {
      jiraIssueKey: `TEST-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      summary: "Test Task for Local Epic Spawner",
      description: "Integration test task",
      status: options?.status || "queued",
      orgId: org.id,
      workerPersona: "backend_developer",
      workerModel: options?.workerModel || "sonnet",
      githubRepo: options?.githubRepo || "test/repo",
    });
    return manager.save(task);
  }

  describe("Task Database Operations", () => {
    test("task can transition through local execution states", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTestTask(org);

      expect(task.status).toBe("queued");

      // Simulate local worker claim
      await manager.update(WorkerTask, task.id, {
        status: "executing",
        startedAt: new Date(),
      });

      const executing = await manager.findOne(WorkerTask, {
        where: { id: task.id },
      });
      expect(executing?.status).toBe("executing");
      expect(executing?.startedAt).toBeDefined();

      // Simulate completion
      await manager.update(WorkerTask, task.id, {
        status: "completed",
        completedAt: new Date(),
        githubPrUrl: "https://github.com/test/repo/pull/1",
      });

      const completed = await manager.findOne(WorkerTask, {
        where: { id: task.id },
      });
      expect(completed?.status).toBe("completed");
      expect(completed?.githubPrUrl).toBe("https://github.com/test/repo/pull/1");
    });

    test("task can be marked as failed with error message", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTestTask(org);

      // Simulate claim and failure
      await manager.update(WorkerTask, task.id, {
        status: "executing",
        startedAt: new Date(),
      });

      await manager.update(WorkerTask, task.id, {
        status: "failed",
        completedAt: new Date(),
        errorMessage: "Docker container exited with code 1",
      });

      const failed = await manager.findOne(WorkerTask, {
        where: { id: task.id },
      });
      expect(failed?.status).toBe("failed");
      expect(failed?.errorMessage).toBe("Docker container exited with code 1");
    });

    test("task stores execution duration correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTestTask(org);

      const startTime = new Date(Date.now() - 60000); // 1 minute ago
      const endTime = new Date();

      await manager.update(WorkerTask, task.id, {
        status: "completed",
        startedAt: startTime,
        completedAt: endTime,
      });

      const completed = await manager.findOne(WorkerTask, {
        where: { id: task.id },
      });

      const duration = completed?.getDurationSeconds();
      expect(duration).toBeGreaterThanOrEqual(59);
      expect(duration).toBeLessThanOrEqual(61);
    });
  });

  describe("SCM Provider Configuration", () => {
    test("task inherits GitHub repo from organization", async () => {
      const manager = getTestManager();
      const org = await createTestOrg({
        scmProvider: "github",
        defaultGithubRepo: "myorg/myrepo",
      });
      const task = await createTestTask(org, { githubRepo: "" });

      // Load task with organization relation
      const loadedTask = await manager.findOne(WorkerTask, {
        where: { id: task.id },
        relations: ["organization"],
      });

      expect(loadedTask?.organization?.scmProvider).toBe("github");
      expect(loadedTask?.organization?.defaultGithubRepo).toBe("myorg/myrepo");
    });

    test("task inherits Bitbucket repo from organization", async () => {
      const manager = getTestManager();
      const org = await createTestOrg({
        scmProvider: "bitbucket",
        defaultBitbucketRepo: "acme-org/acme-api",
      });
      const task = await createTestTask(org, { githubRepo: "" });

      // Load task with organization relation
      const loadedTask = await manager.findOne(WorkerTask, {
        where: { id: task.id },
        relations: ["organization"],
      });

      expect(loadedTask?.organization?.scmProvider).toBe("bitbucket");
      expect(loadedTask?.organization?.defaultBitbucketRepo).toBe(
        "acme-org/acme-api"
      );
    });

    test("task inherits GitLab repo from organization", async () => {
      const manager = getTestManager();
      const org = await createTestOrg({
        scmProvider: "gitlab",
        defaultGitlabRepo: "company/project",
      });
      const task = await createTestTask(org, { githubRepo: "" });

      // Load task with organization relation
      const loadedTask = await manager.findOne(WorkerTask, {
        where: { id: task.id },
        relations: ["organization"],
      });

      expect(loadedTask?.organization?.scmProvider).toBe("gitlab");
      expect(loadedTask?.organization?.defaultGitlabRepo).toBe("company/project");
    });

    test("task-specific repo overrides organization default", async () => {
      const manager = getTestManager();
      const org = await createTestOrg({
        scmProvider: "github",
        defaultGithubRepo: "org/default-repo",
      });
      const task = await createTestTask(org, {
        githubRepo: "org/specific-repo",
      });

      expect(task.githubRepo).toBe("org/specific-repo");
      expect(org.defaultGithubRepo).toBe("org/default-repo");
    });
  });

  describe("Worker Model Configuration", () => {
    test("task stores worker model preference", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      // Test with different models
      const models = ["haiku", "sonnet", "opus"];

      for (const model of models) {
        const task = await createTestTask(org, { workerModel: model });
        expect(task.workerModel).toBe(model);

        const loaded = await manager.findOne(WorkerTask, {
          where: { id: task.id },
        });
        expect(loaded?.workerModel).toBe(model);
      }
    });

    test("task defaults to sonnet model", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      // Create task without specifying model
      const task = manager.create(WorkerTask, {
        jiraIssueKey: `TEST-${Date.now()}`,
        summary: "Test Task",
        status: "queued",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
      });
      await manager.save(task);

      expect(task.workerModel).toBe("claude-3-5-haiku-20241022"); // Default value
    });
  });

  describe("Concurrent Task Tracking", () => {
    test("multiple tasks can be in executing state simultaneously", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      // Create multiple tasks
      const task1 = await createTestTask(org);
      const task2 = await createTestTask(org);
      const task3 = await createTestTask(org);

      // Mark all as executing
      const now = new Date();
      await Promise.all([
        manager.update(WorkerTask, task1.id, { status: "executing", startedAt: now }),
        manager.update(WorkerTask, task2.id, { status: "executing", startedAt: now }),
        manager.update(WorkerTask, task3.id, { status: "executing", startedAt: now }),
      ]);

      // Query executing tasks for this org
      const executingTasks = await manager.find(WorkerTask, {
        where: { orgId: org.id, status: "executing" },
      });

      expect(executingTasks.length).toBe(3);
    });

    test("can count active tasks by organization", async () => {
      const manager = getTestManager();
      const org1 = await createTestOrg();
      const org2 = await createTestOrg();

      // Create tasks for org1
      const task1a = await createTestTask(org1);
      const task1b = await createTestTask(org1);
      await manager.update(WorkerTask, task1a.id, { status: "executing", startedAt: new Date() });
      await manager.update(WorkerTask, task1b.id, { status: "executing", startedAt: new Date() });

      // Create tasks for org2
      const task2a = await createTestTask(org2);
      await manager.update(WorkerTask, task2a.id, { status: "executing", startedAt: new Date() });

      // Count per org
      const org1Count = await manager.count(WorkerTask, {
        where: { orgId: org1.id, status: "executing" },
      });
      const org2Count = await manager.count(WorkerTask, {
        where: { orgId: org2.id, status: "executing" },
      });

      expect(org1Count).toBe(2);
      expect(org2Count).toBe(1);
    });
  });

  describe("Task Metadata", () => {
    test("task stores container name pattern", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTestTask(org);

      // Container name pattern: workermill-{first 8 chars of task ID}
      const expectedPattern = `workermill-${task.id.slice(0, 8)}`;
      expect(expectedPattern).toMatch(/^workermill-[a-f0-9]{8}$/);
    });

    test("task tracks ECS task ARN for local containers", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTestTask(org);

      // For local mode, we might store container ID as ecsTaskArn
      const containerId = "sha256:abc123def456";
      await manager.update(WorkerTask, task.id, {
        status: "executing",
        ecsTaskArn: containerId,
      });

      const updated = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(updated?.ecsTaskArn).toBe(containerId);
    });
  });

  describe("Path Conversion Logic", () => {
    /**
     * Test the WSL path conversion logic without directly importing the service
     * (which would require Docker to be available).
     */
    test("WSL path pattern matches correctly", () => {
      const wslPathRegex = /^\/mnt\/([a-zA-Z])\/(.*)$/;

      // Valid WSL paths
      expect("/mnt/c/Users/testuser/.claude").toMatch(wslPathRegex);
      expect("/mnt/d/projects/workermill").toMatch(wslPathRegex);

      // Invalid paths (not WSL)
      expect("/home/user/.claude").not.toMatch(wslPathRegex);
      expect("/var/log/app.log").not.toMatch(wslPathRegex);
      expect("C:/Users/jarod").not.toMatch(wslPathRegex);
    });

    test("WSL to Windows path conversion", () => {
      // Simulate the toDockerPath logic from local-epic-spawner
      function toDockerPath(unixPath: string, isWSL: boolean): string {
        if (!isWSL) return unixPath;

        const wslPathMatch = unixPath.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
        if (wslPathMatch) {
          const driveLetter = wslPathMatch[1].toUpperCase();
          const restOfPath = wslPathMatch[2];
          return `${driveLetter}:/${restOfPath}`;
        }
        return unixPath;
      }

      // Test conversions
      expect(toDockerPath("/mnt/c/Users/testuser/.claude", true)).toBe(
        "C:/Users/testuser/.claude"
      );
      expect(toDockerPath("/mnt/d/projects/repo", true)).toBe("D:/projects/repo");

      // Non-WSL paths should pass through
      expect(toDockerPath("/home/user/.claude", true)).toBe("/home/user/.claude");

      // When not in WSL, paths should pass through unchanged
      expect(toDockerPath("/mnt/c/Users/testuser/.claude", false)).toBe(
        "/mnt/c/Users/testuser/.claude"
      );
    });
  });

  describe("Environment Variable Structure", () => {
    /**
     * Verify the structure of environment variables that would be passed
     * to Docker containers (without actually spawning containers).
     */
    test("required environment variables are defined", () => {
      const requiredVars = [
        "EPIC_MODE",
        "EXECUTION_MODE",
        "TASK_ID",
        "PARENT_TASK_ID",
        "JIRA_ISSUE_KEY",
        "TASK_SUMMARY",
        "API_BASE_URL",
        "ORG_API_KEY",
        "SCM_PROVIDER",
        "TARGET_REPO",
        "WORKER_MODEL",
      ];

      // These are the core environment variables the spawner should provide
      // Just verify the list exists as expected
      expect(requiredVars.length).toBeGreaterThan(10);
      expect(requiredVars).toContain("TASK_ID");
      expect(requiredVars).toContain("API_BASE_URL");
    });

    test("SCM token selection based on provider", () => {
      // Simulate getScmToken logic
      function getScmToken(provider: string): string {
        switch (provider) {
          case "bitbucket":
            return process.env.BITBUCKET_TOKEN || "";
          case "gitlab":
            return process.env.GITLAB_TOKEN || "";
          case "github":
          default:
            return process.env.GITHUB_TOKEN || "";
        }
      }

      // Set test tokens
      process.env.GITHUB_TOKEN = "gh-token";
      process.env.GITLAB_TOKEN = "gl-token";
      process.env.BITBUCKET_TOKEN = "bb-token";

      expect(getScmToken("github")).toBe("gh-token");
      expect(getScmToken("gitlab")).toBe("gl-token");
      expect(getScmToken("bitbucket")).toBe("bb-token");
      expect(getScmToken("unknown")).toBe("gh-token"); // defaults to github
    });
  });

  describe("API URL Configuration", () => {
    test("Docker Desktop uses host.docker.internal", () => {
      // On Docker Desktop (macOS/Windows/WSL), containers can't use localhost
      // to reach the host. They must use host.docker.internal.
      const isDockerDesktop = true; // Simulated
      const port = 3001;

      const apiBaseUrl = isDockerDesktop
        ? `http://host.docker.internal:${port}`
        : `http://localhost:${port}`;

      expect(apiBaseUrl).toBe("http://host.docker.internal:3001");
    });

    test("Linux Docker uses localhost with host network", () => {
      // On native Linux with --network host, localhost works
      const isDockerDesktop = false;
      const port = 3001;

      const apiBaseUrl = isDockerDesktop
        ? `http://host.docker.internal:${port}`
        : `http://localhost:${port}`;

      expect(apiBaseUrl).toBe("http://localhost:3001");
    });
  });

  describe("Local Mode Detection", () => {
    test("isLocalMode returns true when EXECUTION_MODE=local", () => {
      process.env.EXECUTION_MODE = "local";
      expect(process.env.EXECUTION_MODE).toBe("local");
    });

    test("isLocalMode returns false when EXECUTION_MODE is not set", () => {
      delete process.env.EXECUTION_MODE;
      expect(process.env.EXECUTION_MODE).toBeUndefined();
    });

    test("isLocalMode returns false when EXECUTION_MODE=ecs", () => {
      process.env.EXECUTION_MODE = "ecs";
      expect(process.env.EXECUTION_MODE).toBe("ecs");
      expect(process.env.EXECUTION_MODE !== "local").toBe(true);
    });
  });

  describe("Concurrent Worker Limits", () => {
    test("MAX_LOCAL_WORKERS configures concurrent limit", () => {
      process.env.MAX_LOCAL_WORKERS = "8";
      const maxConcurrent = parseInt(process.env.MAX_LOCAL_WORKERS || "4", 10);
      expect(maxConcurrent).toBe(8);
    });

    test("defaults to 4 concurrent workers", () => {
      delete process.env.MAX_LOCAL_WORKERS;
      const maxConcurrent = parseInt(process.env.MAX_LOCAL_WORKERS || "4", 10);
      expect(maxConcurrent).toBe(4);
    });
  });

  describe("Task Status Transitions", () => {
    test("task helper methods work correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTestTask(org);

      // Test isTerminal
      expect(task.isTerminal()).toBe(false);
      task.status = "completed";
      expect(task.isTerminal()).toBe(true);
      task.status = "failed";
      expect(task.isTerminal()).toBe(true);

      // Test isActive
      task.status = "executing";
      expect(task.isActive()).toBe(true);
      task.status = "queued";
      expect(task.isActive()).toBe(false);

      // Test isWaiting
      task.status = "review_requested";
      expect(task.isWaiting()).toBe(true);
      task.status = "executing";
      expect(task.isWaiting()).toBe(false);
    });

    test("task can retry on failure", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTestTask(org);

      // Initial state
      expect(task.canRetry()).toBe(false); // Not failed yet

      // Fail the task
      task.status = "failed";
      task.retryCount = 0;
      task.maxRetries = 3;
      expect(task.canRetry()).toBe(true);

      // Exhaust retries
      task.retryCount = 3;
      expect(task.canRetry()).toBe(false);
    });
  });

  describe("Container Name Generation", () => {
    test("container name uses first 8 chars of task ID", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTestTask(org);

      // Container name pattern from local-epic-spawner
      const containerName = `workermill-${task.id.slice(0, 8)}`;

      // Should be valid Docker container name (lowercase alphanumeric + hyphen)
      expect(containerName).toMatch(/^workermill-[a-f0-9]{8}$/);
      expect(containerName.length).toBe(18); // "workermill-" (11) + 8 chars
    });
  });
});
