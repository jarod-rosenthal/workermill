import { AppDataSource } from "./connection.js";
import { Organization, User, UserOrganization } from "../models/index.js";
import { logger } from "../utils/logger.js";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";

/**
 * Seed initial data for WorkerMill
 */
async function seed() {
  try {
    await AppDataSource.initialize();
    logger.info("Database connection established");

    const orgRepo = AppDataSource.getRepository(Organization);
    const userRepo = AppDataSource.getRepository(User);

    // Check if organization already exists
    let org = await orgRepo.findOne({ where: { name: "OnCallShift" } });

    if (!org) {
      // Create organization
      const seedRawKey = `org_${randomUUID().replace(/-/g, "")}`;
      org = orgRepo.create({
        name: "OnCallShift",
        plan: "enterprise",
        apiKeyHash: await bcrypt.hash(seedRawKey, 10),
        apiKeyPrefix: seedRawKey.substring(0, 12),
        scmProvider: "bitbucket",
        defaultBitbucketRepo: "oncallshift/oncallshift-api",
      });
      await orgRepo.save(org);
      logger.info("Created organization", { orgId: org.id, name: org.name });
      logger.info("Organization API key (one-time display)", { apiKey: seedRawKey });
    } else {
      logger.info("Organization already exists", { orgId: org.id });
    }

    // Check if user already exists
    const cognitoId =
      process.env.SEED_COGNITO_ID || "00000000-0000-0000-0000-000000000001";
    let user = await userRepo.findOne({ where: { cognitoId } });

    if (!user) {
      // Create admin user
      user = userRepo.create({
        orgId: org.id, // Keep for backwards compatibility
        cognitoId,
        email: process.env.SEED_EMAIL || "admin@localhost",
        fullName: process.env.SEED_FULL_NAME || "Admin User",
        role: "admin",
        status: "active",
      });
      await userRepo.save(user);
      logger.info("Created user", { userId: user.id, email: user.email });

      // Create UserOrganization record (source of truth for multi-org membership)
      const userOrgRepo = AppDataSource.getRepository(UserOrganization);
      const userOrg = userOrgRepo.create({
        userId: user.id,
        orgId: org.id,
        role: user.role as "owner" | "admin" | "member" | "viewer",
        isDefault: true,
      });
      await userOrgRepo.save(userOrg);
      logger.info("Created user organization membership", {
        userId: user.id,
        orgId: org.id,
        role: userOrg.role,
      });
    } else {
      logger.info("User already exists", { userId: user.id });
    }

    console.log("\n=== Seed Complete ===");
    console.log(`Organization: ${org.name}`);
    console.log(`API Key: (hashed — shown at creation time only)`);
    console.log(`User: ${user.email} (${user.role})`);
    console.log("");

    await AppDataSource.destroy();
    process.exit(0);
  } catch (error) {
    logger.error("Seed failed", { error });
    process.exit(1);
  }
}

seed();
