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
import { Organization, User, UserOrganization } from "../models/index.js";
import { logger } from "../utils/logger.js";

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
    maxParallelExperts: 14,
    ralphMaxStories: 10,
    maxPerStoryRevisions: 0,
    maxReviewRevisions: 4,
    maxFixRetries: 5,
    maxTargetFiles: 6,
    // Planning
    criticApprovalThreshold: 90,
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
    selfReviewEnabled: false,
    pushAfterCommit: true,
    gracefulShutdownEnabled: true,
    blockerAutoRetryEnabled: true,
    blockerMaxAutoRetries: 3,
    blockerWaitTimeoutMinutes: 20,
  };

  // Find or create default org — always apply defaults on startup
  let org = await orgRepo.findOne({ where: { name: LOCAL_ORG_NAME } });
  if (org) {
    // Org exists — update to latest defaults
    Object.assign(org, DEFAULTS);
    await orgRepo.save(org);
    logger.info("Local mode: updated org settings to latest defaults");
  } else {
    org = orgRepo.create({ name: LOCAL_ORG_NAME, ...DEFAULTS });
    await orgRepo.save(org);
    logger.info("Created local organization", { orgId: org.id });
  }

  // Check if admin user exists
  let adminUser = await userRepo.findOne({ where: { role: "admin" } });
  if (adminUser) {
    return;
  }

  logger.info("Local mode: seeding admin user");

  // Create admin user
  adminUser = userRepo.create({
    orgId: org.id,
    cognitoId: LOCAL_COGNITO_ID,
    email: LOCAL_ADMIN_EMAIL,
    fullName: "Local Admin",
    role: "admin",
  });
  await userRepo.save(adminUser);
  logger.info("Created local admin user", { userId: adminUser.id });

  // Create user-organization mapping
  const uoRepo = AppDataSource.getRepository(UserOrganization);
  const existing = await uoRepo.findOne({
    where: { userId: adminUser.id, orgId: org.id },
  });
  if (!existing) {
    const uo = uoRepo.create({
      userId: adminUser.id,
      orgId: org.id,
      role: "owner",
      isDefault: true,
    });
    await uoRepo.save(uo);
  }

  logger.info("Local mode bootstrap complete");
}
