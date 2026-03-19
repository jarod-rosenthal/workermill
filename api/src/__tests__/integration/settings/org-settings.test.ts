import { describe, test, expect } from "vitest";
import { getTestManager, generateTestId } from "../setup";
import { Organization } from "../../../models/Organization";

/**
 * Organization Settings Integration Tests.
 *
 * Tests that settings mutations are properly persisted to the database
 * and can be read back correctly. Validates default values, individual
 * and batch updates, quality gate settings, and worker model settings.
 */
describe("Organization Settings", () => {
  /**
   * Helper to create a test organization with optional overrides.
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

  describe("Default Settings", () => {
    test("new org has correct default for maxParallelExperts", async () => {
      const org = await createTestOrg();
      expect(org.maxParallelExperts).toBe(3);
    });

    test("new org has correct default for maxTargetFiles", async () => {
      const org = await createTestOrg();
      expect(org.maxTargetFiles).toBe(15);
    });

    test("new org has correct default for criticApprovalThreshold", async () => {
      const org = await createTestOrg();
      expect(org.criticApprovalThreshold).toBe(85);
    });

    test("new org has correct default for ralphMaxStories", async () => {
      const org = await createTestOrg();
      expect(org.ralphMaxStories).toBe(10);
    });

    test("new org has correct default for qualityGateEnabled", async () => {
      const org = await createTestOrg();
      expect(org.qualityGateEnabled).toBe(false);
    });

    test("new org has correct default for blockOnTestFailures", async () => {
      const org = await createTestOrg();
      expect(org.blockOnTestFailures).toBe(true);
    });

    test("new org has correct default for blockOnTypeErrors", async () => {
      const org = await createTestOrg();
      expect(org.blockOnTypeErrors).toBe(false);
    });

    test("new org has correct default for blockOnLintErrors", async () => {
      const org = await createTestOrg();
      expect(org.blockOnLintErrors).toBe(false);
    });

    test("new org has correct default for blockOnE2EFailures", async () => {
      const org = await createTestOrg();
      expect(org.blockOnE2EFailures).toBe(false);
    });

    test("new org has correct default for autoFixEnabled", async () => {
      const org = await createTestOrg();
      expect(org.autoFixEnabled).toBe(false);
    });

    test("new org has correct default for autoFixMaxIterations", async () => {
      const org = await createTestOrg();
      expect(org.autoFixMaxIterations).toBe(3);
    });

    test("new org has correct default for defaultWorkerModel", async () => {
      const org = await createTestOrg();
      expect(org.defaultWorkerModel).toBe("claude-sonnet-4-6");
    });

    test("new org has correct default for planningAgentModel", async () => {
      const org = await createTestOrg();
      expect(org.planningAgentModel).toBe("claude-opus-4-6");
    });

    test("new org has correct default for managerModelId", async () => {
      const org = await createTestOrg();
      expect(org.managerModelId).toBe("claude-opus-4-6");
    });

    test("new org has correct default for primaryProvider", async () => {
      const org = await createTestOrg();
      expect(org.primaryProvider).toBe("anthropic");
    });

    test("new org has correct default for pushAfterCommit", async () => {
      const org = await createTestOrg();
      expect(org.pushAfterCommit).toBe(true);
    });

    test("new org has correct default for autoReviewEnabled", async () => {
      const org = await createTestOrg();
      expect(org.autoReviewEnabled).toBe(false);
    });

    test("new org has correct default for selfReviewEnabled", async () => {
      const org = await createTestOrg();
      expect(org.selfReviewEnabled).toBe(false);
    });

    test("new org has correct default for maxFixRetries", async () => {
      const org = await createTestOrg();
      expect(org.maxFixRetries).toBe(3);
    });

    test("new org has correct default for maxReviewRevisions", async () => {
      const org = await createTestOrg();
      expect(org.maxReviewRevisions).toBe(3);
    });

    test("new org has correct default for maxPerStoryRevisions", async () => {
      const org = await createTestOrg();
      expect(org.maxPerStoryRevisions).toBe(1);
    });

    test("new org has correct default for minQualityScore", async () => {
      const org = await createTestOrg();
      expect(org.minQualityScore).toBeNull();
    });
  });

  describe("Settings Mutations", () => {
    test("update maxParallelExperts persists correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ maxParallelExperts: 14 })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.maxParallelExperts).toBe(14);
    });

    test("update criticApprovalThreshold persists correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ criticApprovalThreshold: 90 })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.criticApprovalThreshold).toBe(90);
    });

    test("update defaultWorkerModel persists correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ defaultWorkerModel: "gpt-4o" })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.defaultWorkerModel).toBe("gpt-4o");
    });

    test("update autoReviewEnabled persists correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      expect(org.autoReviewEnabled).toBe(false);

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ autoReviewEnabled: true })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.autoReviewEnabled).toBe(true);
    });

    test("update pushAfterCommit persists correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      expect(org.pushAfterCommit).toBe(true);

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ pushAfterCommit: false })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.pushAfterCommit).toBe(false);
    });

    test("update multiple settings in one save persists all values", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({
          maxParallelExperts: 8,
          criticApprovalThreshold: 95,
          defaultWorkerModel: "gemini-2.5-pro",
          autoReviewEnabled: true,
          pushAfterCommit: false,
          maxFixRetries: 5,
        })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.maxParallelExperts).toBe(8);
      expect(updated?.criticApprovalThreshold).toBe(95);
      expect(updated?.defaultWorkerModel).toBe("gemini-2.5-pro");
      expect(updated?.autoReviewEnabled).toBe(true);
      expect(updated?.pushAfterCommit).toBe(false);
      expect(updated?.maxFixRetries).toBe(5);
    });
  });

  describe("Settings Validation (DB level)", () => {
    test("maxParallelExperts = 0 saves successfully", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ maxParallelExperts: 0 })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.maxParallelExperts).toBe(0);
    });

    test("atomic update does not clobber other fields", async () => {
      const manager = getTestManager();
      const org = await createTestOrg({
        maxParallelExperts: 7,
        criticApprovalThreshold: 92,
        defaultWorkerModel: "claude-sonnet-4-6",
        autoReviewEnabled: true,
        pushAfterCommit: false,
      } as Partial<Organization>);

      // Update only maxParallelExperts via atomic UPDATE
      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ maxParallelExperts: 14 })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.maxParallelExperts).toBe(14);
      // Other fields must remain untouched
      expect(updated?.criticApprovalThreshold).toBe(92);
      expect(updated?.defaultWorkerModel).toBe("claude-sonnet-4-6");
      expect(updated?.autoReviewEnabled).toBe(true);
      expect(updated?.pushAfterCommit).toBe(false);
    });

    test("negative maxParallelExperts saves at DB level", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ maxParallelExperts: -1 })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.maxParallelExperts).toBe(-1);
    });
  });

  describe("Quality Gate Settings", () => {
    test("toggle qualityGateEnabled on and off", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      expect(org.qualityGateEnabled).toBe(false);

      // Enable
      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ qualityGateEnabled: true })
        .where("id = :id", { id: org.id })
        .execute();

      let updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.qualityGateEnabled).toBe(true);

      // Disable
      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ qualityGateEnabled: false })
        .where("id = :id", { id: org.id })
        .execute();

      updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.qualityGateEnabled).toBe(false);
    });

    test("update blockOnTypeErrors persists correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ blockOnTypeErrors: true })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.blockOnTypeErrors).toBe(true);
    });

    test("update blockOnTestFailures persists correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      // Default is true, flip to false
      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ blockOnTestFailures: false })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.blockOnTestFailures).toBe(false);
    });

    test("update blockOnLintErrors persists correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ blockOnLintErrors: true })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.blockOnLintErrors).toBe(true);
    });

    test("update blockOnE2EFailures persists correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ blockOnE2EFailures: true })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.blockOnE2EFailures).toBe(true);
    });

    test("update autoFixEnabled persists correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ autoFixEnabled: true })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.autoFixEnabled).toBe(true);
    });

    test("update autoFixMaxIterations persists correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ autoFixMaxIterations: 5 })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.autoFixMaxIterations).toBe(5);
    });

    test("update minQualityScore persists correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ minQualityScore: 80 })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.minQualityScore).toBe(80);
    });

    test("update all quality gate settings together", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({
          qualityGateEnabled: true,
          blockOnTypeErrors: true,
          blockOnTestFailures: true,
          blockOnLintErrors: true,
          blockOnE2EFailures: true,
          autoFixEnabled: true,
          autoFixMaxIterations: 5,
          minQualityScore: 75,
        })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.qualityGateEnabled).toBe(true);
      expect(updated?.blockOnTypeErrors).toBe(true);
      expect(updated?.blockOnTestFailures).toBe(true);
      expect(updated?.blockOnLintErrors).toBe(true);
      expect(updated?.blockOnE2EFailures).toBe(true);
      expect(updated?.autoFixEnabled).toBe(true);
      expect(updated?.autoFixMaxIterations).toBe(5);
      expect(updated?.minQualityScore).toBe(75);
    });
  });

  describe("Worker Model Settings", () => {
    test("update defaultWorkerModel to openai model", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ defaultWorkerModel: "gpt-4o" })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.defaultWorkerModel).toBe("gpt-4o");
    });

    test("update planningAgentModel persists correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ planningAgentModel: "gpt-4o" })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.planningAgentModel).toBe("gpt-4o");
    });

    test("update managerModelId persists correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ managerModelId: "gemini-2.5-pro" })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.managerModelId).toBe("gemini-2.5-pro");
    });

    test("update primaryProvider persists correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ primaryProvider: "openai" })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.primaryProvider).toBe("openai");
    });

    test("update all model settings together", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({
          defaultWorkerModel: "gemini-2.5-flash",
          planningAgentModel: "gemini-2.5-pro",
          managerModelId: "gpt-4o",
          primaryProvider: "google",
          planningAgentProvider: "google",
          managerProvider: "openai",
        })
        .where("id = :id", { id: org.id })
        .execute();

      const updated = await manager.findOne(Organization, { where: { id: org.id } });
      expect(updated?.defaultWorkerModel).toBe("gemini-2.5-flash");
      expect(updated?.planningAgentModel).toBe("gemini-2.5-pro");
      expect(updated?.managerModelId).toBe("gpt-4o");
      expect(updated?.primaryProvider).toBe("google");
      expect(updated?.planningAgentProvider).toBe("google");
      expect(updated?.managerProvider).toBe("openai");
    });
  });

  describe("Settings Read-Back", () => {
    test("all settings match what was written on creation", async () => {
      const manager = getTestManager();
      const org = await createTestOrg({
        maxParallelExperts: 14,
        ralphMaxStories: 8,
        maxTargetFiles: 6,
        criticApprovalThreshold: 90,
        defaultWorkerModel: "gpt-4o",
        planningAgentModel: "gemini-2.5-pro",
        managerModelId: "claude-opus-4-6",
        primaryProvider: "openai",
        qualityGateEnabled: true,
        blockOnTypeErrors: true,
        blockOnTestFailures: true,
        blockOnLintErrors: true,
        blockOnE2EFailures: true,
        autoFixEnabled: true,
        autoFixMaxIterations: 5,
        minQualityScore: 85,
        autoReviewEnabled: true,
        pushAfterCommit: false,
        selfReviewEnabled: true,
        maxFixRetries: 5,
        maxReviewRevisions: 4,
        maxPerStoryRevisions: 0,
      } as Partial<Organization>);

      // Read back from DB
      const readBack = await manager.findOne(Organization, { where: { id: org.id } });

      expect(readBack).not.toBeNull();
      expect(readBack?.maxParallelExperts).toBe(14);
      expect(readBack?.ralphMaxStories).toBe(8);
      expect(readBack?.maxTargetFiles).toBe(6);
      expect(readBack?.criticApprovalThreshold).toBe(90);
      expect(readBack?.defaultWorkerModel).toBe("gpt-4o");
      expect(readBack?.planningAgentModel).toBe("gemini-2.5-pro");
      expect(readBack?.managerModelId).toBe("claude-opus-4-6");
      expect(readBack?.primaryProvider).toBe("openai");
      expect(readBack?.qualityGateEnabled).toBe(true);
      expect(readBack?.blockOnTypeErrors).toBe(true);
      expect(readBack?.blockOnTestFailures).toBe(true);
      expect(readBack?.blockOnLintErrors).toBe(true);
      expect(readBack?.blockOnE2EFailures).toBe(true);
      expect(readBack?.autoFixEnabled).toBe(true);
      expect(readBack?.autoFixMaxIterations).toBe(5);
      expect(readBack?.minQualityScore).toBe(85);
      expect(readBack?.autoReviewEnabled).toBe(true);
      expect(readBack?.pushAfterCommit).toBe(false);
      expect(readBack?.selfReviewEnabled).toBe(true);
      expect(readBack?.maxFixRetries).toBe(5);
      expect(readBack?.maxReviewRevisions).toBe(4);
      expect(readBack?.maxPerStoryRevisions).toBe(0);
    });

    test("settings survive update and read-back cycle", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      // Update settings
      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({
          maxParallelExperts: 10,
          criticApprovalThreshold: 88,
          defaultWorkerModel: "claude-opus-4-6",
          qualityGateEnabled: true,
          autoFixEnabled: true,
          autoFixMaxIterations: 7,
          pushAfterCommit: false,
          autoReviewEnabled: true,
        })
        .where("id = :id", { id: org.id })
        .execute();

      // Read back
      const readBack = await manager.findOne(Organization, { where: { id: org.id } });
      expect(readBack).not.toBeNull();
      expect(readBack?.maxParallelExperts).toBe(10);
      expect(readBack?.criticApprovalThreshold).toBe(88);
      expect(readBack?.defaultWorkerModel).toBe("claude-opus-4-6");
      expect(readBack?.qualityGateEnabled).toBe(true);
      expect(readBack?.autoFixEnabled).toBe(true);
      expect(readBack?.autoFixMaxIterations).toBe(7);
      expect(readBack?.pushAfterCommit).toBe(false);
      expect(readBack?.autoReviewEnabled).toBe(true);
    });

    test("second update overwrites first update correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      // First update
      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ maxParallelExperts: 5, criticApprovalThreshold: 70 })
        .where("id = :id", { id: org.id })
        .execute();

      // Second update
      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({ maxParallelExperts: 12, criticApprovalThreshold: 95 })
        .where("id = :id", { id: org.id })
        .execute();

      const readBack = await manager.findOne(Organization, { where: { id: org.id } });
      expect(readBack?.maxParallelExperts).toBe(12);
      expect(readBack?.criticApprovalThreshold).toBe(95);
    });

    test("JSONB fields persist and read back correctly", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      const providerRouting = {
        qa_engineer: { provider: "ollama", model: "qwen2.5-coder:32b" },
        backend_developer: { provider: "anthropic", model: "claude-sonnet-4-6" },
      };

      const providerSettings = {
        anthropic: { maxTokens: 8192 },
        openai: { temperature: 0.7 },
      };

      await manager
        .createQueryBuilder()
        .update(Organization)
        .set({
          providerRouting,
          providerSettings,
        })
        .where("id = :id", { id: org.id })
        .execute();

      const readBack = await manager.findOne(Organization, { where: { id: org.id } });
      expect(readBack?.providerRouting).toEqual(providerRouting);
      expect(readBack?.providerSettings).toEqual(providerSettings);
    });
  });
});
