import { describe, test, expect } from "vitest";
import { getTestManager, generateTestId } from "../setup";
import { WorkerTask, type WorkerTaskStatus } from "../../../models/WorkerTask";
import { Organization } from "../../../models/Organization";

/**
 * Multi-Provider Webhook Integration Tests.
 *
 * Tests the database operations that occur when processing webhooks
 * from different SCM providers (GitHub, GitLab, Bitbucket).
 * Tests use transaction rollback for isolation.
 */
describe("Multi-Provider Webhook Integration", () => {
  /**
   * Helper to create a test organization.
   */
  async function createTestOrg(overrides?: Partial<Organization>) {
    const manager = getTestManager();
    const org = manager.create(Organization, {
      name: `Test Org ${generateTestId()}`,
      slug: `test-org-${Date.now()}`,
      apiKey: `test-api-key-${Date.now()}`,
      scmProvider: "github",
      ...overrides,
    } as Partial<Organization>);
    return manager.save(org);
  }

  /**
   * Helper to create a task in a given status with a PR URL.
   */
  async function createTaskWithPr(
    org: Organization,
    status: WorkerTaskStatus,
    prUrl: string,
    overrides?: Partial<WorkerTask>,
  ) {
    const manager = getTestManager();
    const task = manager.create(WorkerTask, {
      jiraIssueKey: `TEST-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      summary: "Test Task with PR",
      status,
      orgId: org.id,
      workerPersona: "backend_developer",
      githubRepo: "test/repo",
      githubPrUrl: prUrl,
      ...overrides,
    });
    return manager.save(task);
  }

  // =========================================================================
  // 1. GitHub Webhook — PR Approval Flow
  // =========================================================================

  describe("GitHub Webhook — PR Approval Flow", () => {
    test("approves task in pr_created status via atomic UPDATE", async () => {
      const manager = getTestManager();
      const org = await createTestOrg({ scmProvider: "github" });
      const task = await createTaskWithPr(
        org,
        "pr_created",
        "https://github.com/test/repo/pull/42",
        { scmProvider: "github" },
      );

      expect(task.status).toBe("pr_created");

      // Simulate PR approval webhook: atomic UPDATE status to pr_approved
      const result = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "pr_approved",
          githubApprovedBy: "octocat",
        })
        .where("id = :id AND status IN (:...statuses)", {
          id: task.id,
          statuses: ["pr_created", "review_requested"],
        })
        .execute();

      expect(result.affected).toBe(1);

      const updated = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(updated?.status).toBe("pr_approved");
      expect(updated?.githubApprovedBy).toBe("octocat");
    });

    test("second approval on same task is idempotent (affected=0)", async () => {
      const manager = getTestManager();
      const org = await createTestOrg({ scmProvider: "github" });
      const task = await createTaskWithPr(
        org,
        "pr_created",
        "https://github.com/test/repo/pull/43",
        { scmProvider: "github" },
      );

      // First approval succeeds
      const first = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "pr_approved",
          githubApprovedBy: "octocat",
        })
        .where("id = :id AND status IN (:...statuses)", {
          id: task.id,
          statuses: ["pr_created", "review_requested"],
        })
        .execute();

      expect(first.affected).toBe(1);

      // Second approval is a no-op (task already pr_approved)
      const second = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "pr_approved",
          githubApprovedBy: "another-user",
        })
        .where("id = :id AND status IN (:...statuses)", {
          id: task.id,
          statuses: ["pr_created", "review_requested"],
        })
        .execute();

      expect(second.affected).toBe(0);

      // Verify original approver is preserved
      const updated = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(updated?.githubApprovedBy).toBe("octocat");
    });
  });

  // =========================================================================
  // 2. GitLab Webhook — MR Approval Flow
  // =========================================================================

  describe("GitLab Webhook — MR Approval Flow", () => {
    test("approves task in pr_created status via atomic UPDATE for GitLab MR", async () => {
      const manager = getTestManager();
      const org = await createTestOrg({ scmProvider: "gitlab" });
      const task = await createTaskWithPr(
        org,
        "pr_created",
        "https://gitlab.com/test/repo/-/merge_requests/15",
        { scmProvider: "gitlab" },
      );

      expect(task.status).toBe("pr_created");

      // Simulate MR approval webhook
      const result = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "pr_approved",
          githubApprovedBy: "gitlab-user",
        })
        .where("id = :id AND status IN (:...statuses)", {
          id: task.id,
          statuses: ["pr_created", "review_requested"],
        })
        .execute();

      expect(result.affected).toBe(1);

      const updated = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(updated?.status).toBe("pr_approved");
      expect(updated?.githubApprovedBy).toBe("gitlab-user");
      expect(updated?.scmProvider).toBe("gitlab");
    });

    test("second MR approval on same task is idempotent (affected=0)", async () => {
      const manager = getTestManager();
      const org = await createTestOrg({ scmProvider: "gitlab" });
      const task = await createTaskWithPr(
        org,
        "pr_created",
        "https://gitlab.com/test/repo/-/merge_requests/16",
        { scmProvider: "gitlab" },
      );

      // First approval
      const first = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "pr_approved",
          githubApprovedBy: "gitlab-reviewer",
        })
        .where("id = :id AND status IN (:...statuses)", {
          id: task.id,
          statuses: ["pr_created", "review_requested"],
        })
        .execute();

      expect(first.affected).toBe(1);

      // Second approval is a no-op
      const second = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "pr_approved",
          githubApprovedBy: "another-gitlab-user",
        })
        .where("id = :id AND status IN (:...statuses)", {
          id: task.id,
          statuses: ["pr_created", "review_requested"],
        })
        .execute();

      expect(second.affected).toBe(0);
    });
  });

  // =========================================================================
  // 3. Bitbucket Webhook — PR Approval Flow
  // =========================================================================

  describe("Bitbucket Webhook — PR Approval Flow", () => {
    test("approves task in pr_created status via atomic UPDATE for Bitbucket PR", async () => {
      const manager = getTestManager();
      const org = await createTestOrg({ scmProvider: "bitbucket" });
      const task = await createTaskWithPr(
        org,
        "pr_created",
        "https://bitbucket.org/test/repo/pull-requests/7",
        { scmProvider: "bitbucket" },
      );

      expect(task.status).toBe("pr_created");

      // Simulate Bitbucket PR approval webhook
      const result = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "pr_approved",
          githubApprovedBy: "bb-user",
        })
        .where("id = :id AND status IN (:...statuses)", {
          id: task.id,
          statuses: ["pr_created", "review_requested"],
        })
        .execute();

      expect(result.affected).toBe(1);

      const updated = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(updated?.status).toBe("pr_approved");
      expect(updated?.githubApprovedBy).toBe("bb-user");
      expect(updated?.scmProvider).toBe("bitbucket");
    });

    test("second Bitbucket PR approval on same task is idempotent (affected=0)", async () => {
      const manager = getTestManager();
      const org = await createTestOrg({ scmProvider: "bitbucket" });
      const task = await createTaskWithPr(
        org,
        "pr_created",
        "https://bitbucket.org/test/repo/pull-requests/8",
        { scmProvider: "bitbucket" },
      );

      // First approval
      const first = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "pr_approved",
          githubApprovedBy: "bb-reviewer",
        })
        .where("id = :id AND status IN (:...statuses)", {
          id: task.id,
          statuses: ["pr_created", "review_requested"],
        })
        .execute();

      expect(first.affected).toBe(1);

      // Second approval is a no-op
      const second = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "pr_approved",
          githubApprovedBy: "another-bb-user",
        })
        .where("id = :id AND status IN (:...statuses)", {
          id: task.id,
          statuses: ["pr_created", "review_requested"],
        })
        .execute();

      expect(second.affected).toBe(0);
    });
  });

  // =========================================================================
  // 4. Webhook Task Creation — Multi-Provider
  // =========================================================================

  describe("Webhook Task Creation — Multi-Provider", () => {
    test("creates task from GitHub Issues with GH- issueKey format", async () => {
      const manager = getTestManager();
      const org = await createTestOrg({ scmProvider: "github", issueTrackerProvider: "github-issues" });

      const issueKey = `GH-${Date.now()}`;
      const task = manager.create(WorkerTask, {
        jiraIssueKey: issueKey,
        summary: "Fix login button alignment",
        description: "The login button is misaligned on mobile",
        status: "queued",
        orgId: org.id,
        workerPersona: "frontend_developer",
        githubRepo: "test/webapp",
        scmProvider: "github",
        ticketSystem: "github",
      });

      const saved = await manager.save(task);

      expect(saved.id).toBeDefined();
      expect(saved.jiraIssueKey).toBe(issueKey);
      expect(saved.ticketSystem).toBe("github");
      expect(saved.scmProvider).toBe("github");
    });

    test("creates task from Linear with LIN- issueKey format", async () => {
      const manager = getTestManager();
      const org = await createTestOrg({ scmProvider: "github", issueTrackerProvider: "linear" });

      const issueKey = `LIN-${Date.now()}`;
      const task = manager.create(WorkerTask, {
        jiraIssueKey: issueKey,
        summary: "Add dark mode support",
        description: "Implement dark mode toggle in settings",
        status: "queued",
        orgId: org.id,
        workerPersona: "frontend_developer",
        githubRepo: "test/webapp",
        scmProvider: "github",
        ticketSystem: "linear",
      });

      const saved = await manager.save(task);

      expect(saved.id).toBeDefined();
      expect(saved.jiraIssueKey).toBe(issueKey);
      expect(saved.ticketSystem).toBe("linear");
    });

    test("creates tasks with different SCM providers and stores scmProvider correctly", async () => {
      const manager = getTestManager();

      // GitHub org
      const githubOrg = await createTestOrg({ scmProvider: "github" });
      const githubTask = manager.create(WorkerTask, {
        jiraIssueKey: `GH-SCM-${Date.now()}`,
        summary: "GitHub SCM Task",
        status: "queued",
        orgId: githubOrg.id,
        workerPersona: "backend_developer",
        githubRepo: "github-org/repo",
        scmProvider: "github",
      });
      const savedGh = await manager.save(githubTask);

      // GitLab org
      const gitlabOrg = await createTestOrg({ scmProvider: "gitlab" });
      const gitlabTask = manager.create(WorkerTask, {
        jiraIssueKey: `GL-SCM-${Date.now()}`,
        summary: "GitLab SCM Task",
        status: "queued",
        orgId: gitlabOrg.id,
        workerPersona: "backend_developer",
        githubRepo: "gitlab-org/repo",
        scmProvider: "gitlab",
      });
      const savedGl = await manager.save(gitlabTask);

      // Bitbucket org
      const bbOrg = await createTestOrg({ scmProvider: "bitbucket" });
      const bbTask = manager.create(WorkerTask, {
        jiraIssueKey: `BB-SCM-${Date.now()}`,
        summary: "Bitbucket SCM Task",
        status: "queued",
        orgId: bbOrg.id,
        workerPersona: "backend_developer",
        githubRepo: "bb-workspace/repo",
        scmProvider: "bitbucket",
      });
      const savedBb = await manager.save(bbTask);

      // Verify scmProvider is stored correctly on each task
      expect(savedGh.scmProvider).toBe("github");
      expect(savedGl.scmProvider).toBe("gitlab");
      expect(savedBb.scmProvider).toBe("bitbucket");

      // Verify scmProvider is stored correctly on each org
      const reloadedGhOrg = await manager.findOne(Organization, { where: { id: githubOrg.id } });
      const reloadedGlOrg = await manager.findOne(Organization, { where: { id: gitlabOrg.id } });
      const reloadedBbOrg = await manager.findOne(Organization, { where: { id: bbOrg.id } });

      expect(reloadedGhOrg?.scmProvider).toBe("github");
      expect(reloadedGlOrg?.scmProvider).toBe("gitlab");
      expect(reloadedBbOrg?.scmProvider).toBe("bitbucket");
    });
  });

  // =========================================================================
  // 5. Atomic Status Transitions (webhook-driven)
  // =========================================================================

  describe("Atomic Status Transitions (webhook-driven)", () => {
    test("pr_created → pr_approved (approval webhook)", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTaskWithPr(org, "pr_created", "https://github.com/test/repo/pull/100");

      const result = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({ status: "pr_approved", githubApprovedBy: "reviewer" })
        .where("id = :id AND status IN (:...statuses)", {
          id: task.id,
          statuses: ["pr_created", "review_requested"],
        })
        .execute();

      expect(result.affected).toBe(1);

      const updated = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(updated?.status).toBe("pr_approved");
    });

    test("pr_approved → queued (re-queue for deployment)", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTaskWithPr(org, "pr_approved", "https://github.com/test/repo/pull/101");

      const result = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "queued",
          completedAt: undefined,
          ecsTaskArn: undefined,
          taskNotes: "DEPLOYMENT_RUN: PR #101 approved, re-queuing for deployment",
        })
        .where("id = :id AND status = :status", {
          id: task.id,
          status: "pr_approved",
        })
        .execute();

      expect(result.affected).toBe(1);

      const updated = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(updated?.status).toBe("queued");
    });

    test("review_requested → pr_approved (approval webhook)", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTaskWithPr(org, "review_requested", "https://github.com/test/repo/pull/102");

      const result = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({ status: "pr_approved", githubApprovedBy: "lead-reviewer" })
        .where("id = :id AND status IN (:...statuses)", {
          id: task.id,
          statuses: ["pr_created", "review_requested"],
        })
        .execute();

      expect(result.affected).toBe(1);

      const updated = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(updated?.status).toBe("pr_approved");
      expect(updated?.githubApprovedBy).toBe("lead-reviewer");
    });

    test("queued → executing (worker claim)", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTaskWithPr(org, "queued", "https://github.com/test/repo/pull/103");

      const result = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "executing",
          startedAt: new Date(),
          ecsTaskArn: "arn:aws:ecs:us-east-1:123456789:task/cluster/task-abc",
        })
        .where("id = :id AND status = :status", {
          id: task.id,
          status: "queued",
        })
        .execute();

      expect(result.affected).toBe(1);

      const updated = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(updated?.status).toBe("executing");
      expect(updated?.startedAt).toBeDefined();
      expect(updated?.ecsTaskArn).toBe("arn:aws:ecs:us-east-1:123456789:task/cluster/task-abc");
    });

    test("guard: completed task cannot be re-approved (affected=0)", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const task = manager.create(WorkerTask, {
        jiraIssueKey: `TEST-COMP-${Date.now()}`,
        summary: "Completed Task",
        status: "completed",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
        githubPrUrl: "https://github.com/test/repo/pull/200",
        completedAt: new Date(),
      });
      await manager.save(task);

      const result = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({ status: "pr_approved", githubApprovedBy: "attacker" })
        .where("id = :id AND status IN (:...statuses)", {
          id: task.id,
          statuses: ["pr_created", "review_requested"],
        })
        .execute();

      expect(result.affected).toBe(0);

      // Verify status unchanged
      const unchanged = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(unchanged?.status).toBe("completed");
    });

    test("guard: failed task cannot be re-approved (affected=0)", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const task = manager.create(WorkerTask, {
        jiraIssueKey: `TEST-FAIL-${Date.now()}`,
        summary: "Failed Task",
        status: "failed",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
        githubPrUrl: "https://github.com/test/repo/pull/201",
        completedAt: new Date(),
        errorMessage: "Build failed",
      });
      await manager.save(task);

      const result = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({ status: "pr_approved", githubApprovedBy: "attacker" })
        .where("id = :id AND status IN (:...statuses)", {
          id: task.id,
          statuses: ["pr_created", "review_requested"],
        })
        .execute();

      expect(result.affected).toBe(0);

      // Verify status unchanged
      const unchanged = await manager.findOne(WorkerTask, { where: { id: task.id } });
      expect(unchanged?.status).toBe("failed");
      expect(unchanged?.errorMessage).toBe("Build failed");
    });
  });

  // =========================================================================
  // 6. Deployment Re-queue
  // =========================================================================

  describe("Deployment Re-queue", () => {
    test("pr_approved task with skipManagerReview=true re-queues to queued for deployment", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const task = manager.create(WorkerTask, {
        jiraIssueKey: `TEST-DEPLOY-${Date.now()}`,
        summary: "Deploy Task",
        status: "pr_approved",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
        githubPrUrl: "https://github.com/test/repo/pull/300",
        githubPrNumber: 300,
        githubApprovedBy: "tech-lead",
        skipManagerReview: true,
        completedAt: new Date(),
        ecsTaskArn: "arn:aws:ecs:us-east-1:123456789:task/cluster/old-task",
        ecsTaskId: "old-task-id",
        startedAt: new Date(Date.now() - 60000),
      });
      const savedTask = await manager.save(task);

      expect(savedTask.status).toBe("pr_approved");
      expect(savedTask.skipManagerReview).toBe(true);

      // Simulate deployment re-queue: clear execution state, set task notes
      const deploymentNote = `DEPLOYMENT_RUN: PR #${savedTask.githubPrNumber} approved by ${savedTask.githubApprovedBy}`;

      const result = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "queued",
          completedAt: null as unknown as Date,
          ecsTaskArn: null as unknown as string,
          ecsTaskId: null as unknown as string,
          startedAt: null as unknown as Date,
          errorMessage: null as unknown as string,
          taskNotes: deploymentNote,
        })
        .where("id = :id AND status = :status", {
          id: savedTask.id,
          status: "pr_approved",
        })
        .execute();

      expect(result.affected).toBe(1);

      // Verify the re-queued state
      const requeued = await manager.findOne(WorkerTask, { where: { id: savedTask.id } });
      expect(requeued?.status).toBe("queued");
      expect(requeued?.completedAt).toBeNull();
      expect(requeued?.ecsTaskArn).toBeNull();
      expect(requeued?.ecsTaskId).toBeNull();
      expect(requeued?.startedAt).toBeNull();
      expect(requeued?.taskNotes).toContain("DEPLOYMENT_RUN");
      expect(requeued?.taskNotes).toContain("PR #300");
      expect(requeued?.taskNotes).toContain("tech-lead");

      // Verify PR metadata is preserved
      expect(requeued?.githubPrUrl).toBe("https://github.com/test/repo/pull/300");
      expect(requeued?.githubPrNumber).toBe(300);
      expect(requeued?.githubApprovedBy).toBe("tech-lead");
    });

    test("deployment re-queue does not affect task with skipManagerReview=false", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const task = manager.create(WorkerTask, {
        jiraIssueKey: `TEST-REVIEW-${Date.now()}`,
        summary: "Review Task",
        status: "pr_approved",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
        githubPrUrl: "https://github.com/test/repo/pull/301",
        skipManagerReview: false,
      });
      const savedTask = await manager.save(task);

      expect(savedTask.skipManagerReview).toBe(false);

      // This task should NOT be re-queued for direct deployment
      // (it would go through manager review first)
      // Verify the flag is correctly persisted
      const reloaded = await manager.findOne(WorkerTask, { where: { id: savedTask.id } });
      expect(reloaded?.skipManagerReview).toBe(false);
      expect(reloaded?.status).toBe("pr_approved");
    });

    test("deployment re-queue is idempotent — already queued task cannot be re-queued", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const task = manager.create(WorkerTask, {
        jiraIssueKey: `TEST-IDEM-${Date.now()}`,
        summary: "Idempotent Deploy Task",
        status: "pr_approved",
        orgId: org.id,
        workerPersona: "backend_developer",
        githubRepo: "test/repo",
        githubPrUrl: "https://github.com/test/repo/pull/302",
        skipManagerReview: true,
      });
      const savedTask = await manager.save(task);

      // First re-queue succeeds
      const first = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "queued",
          taskNotes: "DEPLOYMENT_RUN: PR #302 approved",
        })
        .where("id = :id AND status = :status", {
          id: savedTask.id,
          status: "pr_approved",
        })
        .execute();

      expect(first.affected).toBe(1);

      // Second re-queue is a no-op (already queued, not pr_approved)
      const second = await manager
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "queued",
          taskNotes: "DEPLOYMENT_RUN: duplicate attempt",
        })
        .where("id = :id AND status = :status", {
          id: savedTask.id,
          status: "pr_approved",
        })
        .execute();

      expect(second.affected).toBe(0);

      // Verify original task notes preserved
      const final = await manager.findOne(WorkerTask, { where: { id: savedTask.id } });
      expect(final?.taskNotes).toBe("DEPLOYMENT_RUN: PR #302 approved");
    });
  });
});
