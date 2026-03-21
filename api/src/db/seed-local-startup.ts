/**
 * Local Mode Startup Seeder
 *
 * When EXECUTION_MODE=local, ensures a default organization and admin user exist.
 * This enables zero-configuration self-hosted mode — the API creates everything
 * needed on first startup from a fresh database.
 *
 * Idempotent — safe to call on every startup.
 */

import { AppDataSource } from "./connection.js";
import { Organization, User, UserOrganization, WebhookEndpoint } from "../models/index.js";
import { logger } from "../utils/logger.js";
import { TOS_VERSION } from "../constants/tos.js";

const LOCAL_ORG_NAME = "Local";
const LOCAL_ADMIN_EMAIL = "admin@localhost";
const LOCAL_COGNITO_ID = "00000000-0000-0000-0000-000000000001";

export async function seedLocalModeIfNeeded(): Promise<void> {
  if (process.env.EXECUTION_MODE !== "local") {
    return;
  }

  const orgRepo = AppDataSource.getRepository(Organization);
  const userRepo = AppDataSource.getRepository(User);

  // Production-tested defaults from workermill-examples org
  const DEFAULTS: Partial<Organization> = {
    plan: "enterprise",
    slug: "local",
    scmProvider: "github",
    maxConcurrentWorkers: 1,
    // Models
    defaultWorkerModel: "claude-sonnet-4-6",
    managerModelId: "claude-opus-4-6",
    planningAgentModel: "claude-opus-4-6",
    primaryProvider: "anthropic",
    planningAgentProvider: "anthropic",
    managerProvider: "anthropic",
    // Capacity
    maxParallelExperts: 10,
    ralphMaxStories: 10,
    maxPerStoryRevisions: 0,
    maxReviewRevisions: 4,
    maxFixRetries: 5,
    maxTargetFiles: 20,
    // Planning
    // 90 matches production (workermill-examples org). CLAUDE.md mentions 85 but that's outdated.
    criticApprovalThreshold: 85,
    planningMode: "simplified",
    prdPlanningMode: "strict",
    taskPlanningMode: "simplified",
    // Quality gates
    qualityGateEnabled: true,
    blockOnTypeErrors: true,
    blockOnTestFailures: true,
    blockOnLintErrors: true,
    blockOnE2EFailures: true,
    autoFixEnabled: true,
    autoFixMaxIterations: 3,
    // Behavior
    autoReviewEnabled: true,
    selfReviewEnabled: false,
    pushAfterCommit: true,
    gracefulShutdownEnabled: true,
    blockerAutoRetryEnabled: true,
    blockerMaxAutoRetries: 3,
    blockerWaitTimeoutMinutes: 20,
  };

  // Find or create default org
  let org = await orgRepo.findOne({ where: { name: LOCAL_ORG_NAME } });
  if (!org) {
    org = orgRepo.create({ name: LOCAL_ORG_NAME, ...DEFAULTS });
    await orgRepo.save(org);
    logger.info("Created local organization", { orgId: org.id });
  }

  // Find or create admin user
  let adminUser = await userRepo.findOne({ where: { email: LOCAL_ADMIN_EMAIL } });
  if (!adminUser) {
    logger.info("Local mode: seeding admin user");
    adminUser = userRepo.create({
      orgId: org.id,
      cognitoId: LOCAL_COGNITO_ID,
      email: LOCAL_ADMIN_EMAIL,
      fullName: "Local Admin",
      role: "admin",
      tosAcceptedAt: new Date(),
      tosVersion: TOS_VERSION,
    });
    await userRepo.save(adminUser);
    logger.info("Created local admin user", { userId: adminUser.id });
  } else {
    // Ensure TOS is accepted (may have been seeded before TOS fix)
    if (!adminUser.tosVersion || adminUser.tosVersion !== TOS_VERSION) {
      adminUser.tosAcceptedAt = new Date();
      adminUser.tosVersion = TOS_VERSION;
      await userRepo.save(adminUser);
      logger.info("Updated local admin TOS version");
    }
  }

  // Ensure user-organization mapping exists
  const uoRepo = AppDataSource.getRepository(UserOrganization);
  const uoExisting = await uoRepo.findOne({
    where: { userId: adminUser.id, orgId: org.id },
  });
  if (!uoExisting) {
    const uo = uoRepo.create({
      userId: adminUser.id,
      orgId: org.id,
      role: "owner",
      isDefault: true,
    });
    await uoRepo.save(uo);
  }

  // Ensure Jira webhook endpoint exists (for E2E tests and local development)
  // Signature verification is disabled so local webhooks work without secrets
  const webhookRepo = AppDataSource.getRepository(WebhookEndpoint);
  const jiraEndpoint = await webhookRepo.findOne({
    where: { orgId: org.id, integrationType: "jira" },
  });
  if (!jiraEndpoint) {
    const endpoint = webhookRepo.create({
      orgId: org.id,
      integrationType: "jira" as const,
      webhookSecret: "local-dev-secret",
      isActive: true,
      config: { skipSignatureValidation: true },
    });
    await webhookRepo.save(endpoint);
    logger.info("Created local Jira webhook endpoint", {
      url: `/api/webhooks/${org.slug}/jira`,
    });
  }

  logger.info("Local mode bootstrap complete");
}
