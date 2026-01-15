import { DataSource } from "typeorm";
import { config } from "../config/index.js";
import { Organization, User, WorkerTask, WorkerTaskLog, OrgInvite } from "../models/index.js";
import { InitialSchema1704067200000 } from "./migrations/1704067200000-InitialSchema.js";
import { AddWorkerTaskColumns1704067200001 } from "./migrations/1704067200001-AddWorkerTaskColumns.js";
import { AddOrganizationSettings1704067200002 } from "./migrations/1704067200002-AddOrganizationSettings.js";
import { AddCountersResetAt1704067200003 } from "./migrations/1704067200003-AddCountersResetAt.js";
import { AddCostTracking1704067200004 } from "./migrations/1704067200004-AddCostTracking.js";
import { AddWorkflowColumns1704067200005 } from "./migrations/1704067200005-AddWorkflowColumns.js";
import { AddWorkerTaskLogs1704067200006 } from "./migrations/1704067200006-AddWorkerTaskLogs.js";
import { GenerateOrgApiKeys1704067200007 } from "./migrations/1704067200007-GenerateOrgApiKeys.js";
import { AddUniqueTaskConstraint1704067200008 } from "./migrations/1704067200008-AddUniqueTaskConstraint.js";
import { CleanupDuplicatesAndAddConstraint1704067200009 } from "./migrations/1704067200009-CleanupDuplicatesAndAddConstraint.js";
import { AddOrgSettings1704067200010 } from "./migrations/1704067200010-AddOrgSettings.js";
import { AddCompletedTaskDisplayMinutes1704067200011 } from "./migrations/1704067200011-AddCompletedTaskDisplayMinutes.js";
import { AddWorkflowModeColumns1704067200012 } from "./migrations/1704067200012-AddWorkflowModeColumns.js";
import { AddManagerEcsColumns1704067200013 } from "./migrations/1704067200013-AddManagerEcsColumns.js";
import { logger } from "../utils/logger.js";

export const AppDataSource = new DataSource({
  type: "postgres",
  url: config.database.url,
  host: config.database.url ? undefined : config.database.host,
  port: config.database.url ? undefined : config.database.port,
  username: config.database.url ? undefined : config.database.username,
  password: config.database.url ? undefined : config.database.password,
  database: config.database.url ? undefined : config.database.name,
  entities: [Organization, User, WorkerTask, WorkerTaskLog, OrgInvite],
  migrations: [
    InitialSchema1704067200000,
    AddWorkerTaskColumns1704067200001,
    AddOrganizationSettings1704067200002,
    AddCountersResetAt1704067200003,
    AddCostTracking1704067200004,
    AddWorkflowColumns1704067200005,
    AddWorkerTaskLogs1704067200006,
    GenerateOrgApiKeys1704067200007,
    AddUniqueTaskConstraint1704067200008,
    CleanupDuplicatesAndAddConstraint1704067200009,
    AddOrgSettings1704067200010,
    AddCompletedTaskDisplayMinutes1704067200011,
    AddWorkflowModeColumns1704067200012,
    AddManagerEcsColumns1704067200013,
  ],
  synchronize: false, // Use migrations in production
  logging: config.nodeEnv === "development",
  ssl: config.database.url?.includes("rds.amazonaws.com")
    ? { rejectUnauthorized: false }
    : false,
});

export async function initializeDatabase(): Promise<DataSource> {
  try {
    await AppDataSource.initialize();
    logger.info("Database connection established");
    return AppDataSource;
  } catch (error) {
    logger.error("Error connecting to database", { error });
    throw error;
  }
}

export async function runMigrations(): Promise<void> {
  try {
    const migrations = await AppDataSource.runMigrations();
    if (migrations.length > 0) {
      logger.info(`Ran ${migrations.length} migrations`, {
        migrations: migrations.map((m) => m.name),
      });
    }
    logger.info("Migrations completed");
  } catch (error) {
    logger.error("Error running migrations", { error });
    throw error;
  }
}
